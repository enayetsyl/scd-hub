/**
 * Scenario 7 (AL-12): high homework + low class-test on ONE objective -> an outside-help case (prd-academic-loop-2027
 * section 3.4, journey H, R16/R18, D-#1676). Runs regardless of the release switch (PRD section 3.6) - it does not switch
 * anything on.
 *
 * For up to SECTIONS_MAX sections of Class 1..5 (one subject with mastery on and a gold bank each), THROUGH the real services:
 *   - an unlinked HW sheet on ONE objective, nobody ticked wrong, confirmed -> HW 100 %;
 *   - a CT sheet on the SAME objective (other questions: the class-test block R19 refuses a repeat), a few children ticked
 *     wrong on every item, confirmed -> CT 0 % for them;
 *   - `recomputeForPaper` (awaited, so the run does not depend on the fire-and-forget hook) opens a case per low child;
 *     the new-case notice goes to the class teacher + the Principal (the generator mutes the emitters, so nobody is told).
 * One case per section is then closed with the outcome "guardian did it" so the term tag has something to show.
 * Cases, papers and evidence are tagged and removed with the run (IntegrityCase is a declared collection).
 */
import { Types } from "mongoose";
import type { MasterySubject } from "@scd/shared";
import { MasteryEnablement } from "../../../modules/mastery/models/MasteryEnablement";
import { MasteryPaper } from "../../../modules/mastery/models/MasteryPaper";
import { isTaggedRow } from "../../../modules/mastery/rollup";
import { lockedOutcomes } from "../../../modules/mastery/services/MasteryDiagnosisService";
import { goldBank, marksTable } from "../../../modules/mastery/services/MasteryAssignmentService";
import { classTokenForLevel, confirmPaper, createPaper, saveResults, type Auth, type PaperItemInput } from "../../../modules/mastery/services/MasteryWorkService";
import { recomputeForPaper, recordOutcome } from "../../../modules/homework-integrity/services/IntegrityService";
import { IntegrityCase } from "../../../modules/homework-integrity/models/IntegrityCase";
import { slotsForDate } from "../../../modules/routine/services/RoutineSlotService";
import { resolveDayType } from "../../../modules/routine/calendar";
import { parseDateKey } from "../../../modules/attendance/dates";
import { Student } from "../../../modules/foundation/models/Student";
import type { Scenario, ScenarioCtx } from "./types";

const SECTIONS_MAX = 3;
const LOW_CHILDREN = 3;

export const scenario7: Scenario = {
  id: 7,
  name: "outside-help",
  collections: [
    { model: "MasteryPaper" },
    { model: "MasteryResult" },
    { model: "IntegrityCase" },
  ],
  async run(ctx: ScenarioCtx): Promise<Record<string, number>> {
    const c: Record<string, number> = { sections: 0, hwPapers: 0, ctPapers: 0, refused: 0, noStock: 0, casesOpened: 0, outcomesRecorded: 0 };
    const days: string[] = [];
    for (const k of ctx.dayKeys) {
      if ((await resolveDayType(parseDateKey(k))) === "FULL") days.push(k);
      if (days.length >= 2) break;
    }
    if (days.length < 2) return c;
    const [hwDay, ctDay] = days as [string, string];
    const since = new Date();
    ctx.clock(ctDay);

    for (const sec of ctx.sections.filter((s) => s.level >= 1)) {
      if (c.sections >= SECTIONS_MAX) break;
      const token = classTokenForLevel(sec.level);
      if (!token) continue;
      const enabled = await MasteryEnablement.find({ academicYearId: ctx.academicYearId, classToken: token, enabled: true }).select("subject").lean();
      const slots = (await slotsForDate("section", sec.sectionId, parseDateKey(ctDay))).filter((s) => !s.isBreak && s.teacherId);
      const teacherOf = new Map<string, string>();
      for (const s of slots) if (!teacherOf.has(s.subject)) teacherOf.set(s.subject, String(s.teacherId));
      const subject = ctx.pick(enabled.map((e) => e.subject as string).filter((s) => teacherOf.has(s)), 1)[0];
      if (!subject) continue;
      const auth = { userId: teacherOf.get(subject)!, role: "TEACHER" } as unknown as Auth;

      const outcomes = (await lockedOutcomes(token, subject as MasterySubject)).filter((o) => o.assess === "QUESTION" && isTaggedRow(o));
      const bank = await goldBank(outcomes.map((o) => o.code));
      const marks = await marksTable(token, subject as MasterySubject);
      // One objective with at least four usable bank questions: two for the HW sheet, two (other) for the CT sheet.
      let picked: { loCode: string; hw: PaperItemInput[]; ctPool: PaperItemInput[] } | null = null;
      for (const o of outcomes) {
        const usable: PaperItemInput[] = [];
        for (const q of bank) {
          if (!q.loCodes.includes(o.code)) continue;
          const type = q.qtCode ?? o.questionTypeCodes?.[0];
          if (!type || !marks.has(type)) continue;
          usable.push({ origin: "BANK", artifactId: q.artifactId, loCode: o.code, questionTypeCode: type });
        }
        if (usable.length >= 4) {
          picked = { loCode: o.code, hw: usable.slice(0, 2), ctPool: usable.slice(2) };
          break;
        }
      }
      if (!picked) {
        c.noStock++;
        continue;
      }
      const kids = (await Student.find({ sectionId: sec.sectionId, active: true }).select("_id").lean()).map((k) => String(k._id));
      if (kids.length < 2) continue;
      try {
        const hw = await createPaper({ sectionId: sec.sectionId, subject: subject as MasterySubject, source: "HW", date: hwDay, items: picked.hw }, auth);
        c.hwPapers++;
        await confirmPaper(hw.paperId, auth); // nobody ticked wrong: HW 100 %
        // The class-test block (R19) refuses a question the section had as homework / assignment in the no-repeat window, and the run's
        // own earlier scenarios gave out many: walk the objective's other questions, two at a time, until one pair is accepted.
        let ct: { paperId: string } | null = null;
        for (let i = 0; i < picked.ctPool.length && i < 12 && !ct; i += 2) {
          try {
            ct = await createPaper({ sectionId: sec.sectionId, subject: subject as MasterySubject, source: "CT", date: ctDay, items: picked.ctPool.slice(i, i + 2) }, auth);
          } catch (e) {
            ctx.refuse("ctBlocked", e);
          }
        }
        if (!ct) {
          c.refused++;
          continue;
        }
        c.ctPapers++;
        const paper = await MasteryPaper.findOne({ paperId: ct.paperId });
        if (!paper) continue;
        const low = ctx.pick(kids, Math.min(LOW_CHILDREN, kids.length));
        await saveResults(ct.paperId, low.map((studentId) => ({ studentId, items: paper.items.map((it) => ({ itemNo: it.itemNo, marks: 0 })) })), auth);
        await confirmPaper(ct.paperId, auth);
        const r = await recomputeForPaper(paper._id as Types.ObjectId, paper.academicYearId as Types.ObjectId);
        c.casesOpened += r.opened;
        c.sections++;
        // One case per section gets its outcome: "guardian did it" -> the staff tag + the guardian's gentle note until the term ends.
        const open = await IntegrityCase.findOne({ sectionId: sec.sectionId, loCode: picked.loCode, status: "OPEN" });
        if (open) {
          await recordOutcome(String(open._id), "GUARDIAN_DID", "ফেক ডেটা", { userId: auth.userId, role: "TEACHER", all: true });
          c.outcomesRecorded++;
        }
      } catch (e) {
        c.refused++;
        ctx.refuse("refused", e);
      }
      await ctx.tagSince(since);
    }
    await ctx.tagSince(since);
    return c;
  },
};
