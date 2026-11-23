/**
 * Scenario 4 (AL-7): one objective most of a section fails in class -> the re-teach proposal
 * (prd-academic-loop-2027 sections 3.8, 9.3; AL-6's in-school rule). Run it after scenario 2.5.
 *
 * Per Class 1..5 section: TWO in-class work sheets (source CW, in-school evidence) on ONE objective, on two fake days, THROUGH
 * `createPaper`, with MOST children ticked wrong on both; `confirmPaper` writes the evidence and `evaluateSectionTriggers` reads it,
 * so the section trigger opens a `MasteryAction`. It needs TWO in-school papers on the objective (`sectionTriggerMinAssessments`
 * = 2) - one sheet never opened a proposal - and at least half the roster assessed in school (`sectionTriggerMinAssessedPct`).
 * A CW sheet is dated today or earlier, so the dev clock is set to each fake day.
 */
import { Types } from "mongoose";
import { MasteryAction } from "../../../modules/mastery/models/MasteryAction";
import { MasteryEnablement } from "../../../modules/mastery/models/MasteryEnablement";
import { MasteryPaper } from "../../../modules/mastery/models/MasteryPaper";
import { MasteryPolicy } from "../../../modules/mastery/models/MasteryPolicy";
import { isTaggedRow } from "../../../modules/mastery/rollup";
import { lockedOutcomes } from "../../../modules/mastery/services/MasteryDiagnosisService";
import { goldBank, marksTable } from "../../../modules/mastery/services/MasteryAssignmentService";
import { evaluateSectionTriggers } from "../../../modules/mastery/services/MasteryActionService";
import { classTokenForLevel, confirmPaper, createPaper, saveResults, type Auth } from "../../../modules/mastery/services/MasteryWorkService";
import { isLoop2027On } from "../../../modules/assessment/services/QuestionUseService";
import { Student } from "../../../modules/foundation/models/Student";
import { slotsForDate } from "../../../modules/routine/services/RoutineSlotService";
import { resolveDayType } from "../../../modules/routine/calendar";
import { parseDateKey } from "../../../modules/attendance/dates";
import type { MasterySubject } from "@scd/shared";
import type { Scenario, ScenarioCtx } from "./types";

export const scenario4: Scenario = {
  id: 4,
  name: "reteach-from-class-work",
  collections: [{ model: "MasteryPaper" }, { model: "MasteryResult" }, { model: "MasteryAction" }],
  async run(ctx: ScenarioCtx): Promise<Record<string, number>> {
    const c: Record<string, number> = { cwPapers: 0, wrongTicks: 0, confirmed: 0, proposals: 0, refused: 0, noStock: 0 };
    if (!(await isLoop2027On())) {
      await MasteryPolicy.updateOne({ scopeKey: "SCHOOL" }, { $set: { "values.academicLoop2027On": true }, $setOnInsert: { scopeKey: "SCHOOL" } }, { upsert: true });
      ctx.switchedOn.push("academicLoop2027On");
    }
    // The last two open school days of the first two weeks (a holiday is skipped).
    const open: string[] = [];
    for (const k of ctx.dayKeys.slice(0, 10)) if ((await resolveDayType(parseDateKey(k))) === "FULL") open.push(k);
    const days = open.slice(-2);
    if (days.length < 2) return c;
    const since = new Date();
    for (const sec of ctx.sections.filter((s) => s.level >= 1)) {
      const token = classTokenForLevel(sec.level);
      if (!token) continue;
      const enabled = await MasteryEnablement.find({ academicYearId: ctx.academicYearId, classToken: token, enabled: true }).select("subject").lean();
      // The routine teacher of each day (the row rule reads the paper's date, so each sheet needs that day's teacher).
      const teacherOn = new Map<string, Map<string, string>>();
      for (const day of days) {
        const slots = (await slotsForDate("section", sec.sectionId, parseDateKey(day))).filter((s) => !s.isBreak && s.teacherId);
        const m = new Map<string, string>();
        for (const s of slots) if (!m.has(s.subject)) m.set(s.subject, String(s.teacherId));
        teacherOn.set(day, m);
      }
      const subject = ctx.pick(enabled.map((e) => e.subject as string).filter((s) => days.every((d) => teacherOn.get(d)!.has(s))), 1)[0];
      if (!subject) continue;
      const outcomes = (await lockedOutcomes(token, subject as MasterySubject)).filter((o) => o.assess === "QUESTION" && isTaggedRow(o));
      const bank = await goldBank(outcomes.map((o) => o.code));
      const marks = await marksTable(token, subject as MasterySubject);
      // The objective with the most bank questions: two sheets of three DIFFERENT questions when it has six.
      const target = [...outcomes].sort((a, b) => bank.filter((q) => q.loCodes.includes(b.code)).length - bank.filter((q) => q.loCodes.includes(a.code)).length)[0];
      const pool = target ? bank.filter((q) => q.loCodes.includes(target.code)) : [];
      const type = target?.questionTypeCodes?.find((t) => marks.has(t)) ?? [...marks.keys()][0];
      if (!target || !type || pool.length === 0) {
        c.noStock++;
        continue;
      }
      const kids = (await Student.find({ sectionId: sec.sectionId, active: true }).select("_id").lean()).map((k) => String(k._id));
      // MOST of the class fails every question (three children in four), well past the section line, on both sheets.
      const failing = ctx.pick(kids, Math.max(1, Math.ceil(kids.length * 0.75)));
      try {
        for (const [n, day] of days.entries()) {
          ctx.clock(day);
          const auth = { userId: teacherOn.get(day)!.get(subject)!, role: "TEACHER" } as unknown as Auth;
          const picks = pool.length >= 6 ? pool.slice(n * 3, n * 3 + 3) : pool.slice(0, 3);
          const cw = await createPaper(
            { sectionId: sec.sectionId, subject: subject as MasterySubject, source: "CW", date: day, items: picks.map((q) => ({ origin: "BANK" as const, artifactId: q.artifactId, loCode: target.code, questionTypeCode: q.qtCode ?? type })) },
            auth,
          );
          c.cwPapers++;
          const paper = await MasteryPaper.findOne({ paperId: cw.paperId });
          const rows = failing.map((studentId) => ({ studentId, items: (paper?.items ?? []).map((it) => ({ itemNo: it.itemNo, marks: 0 })) }));
          if (rows.length > 0) {
            await saveResults(cw.paperId, rows, auth);
            c.wrongTicks += rows.length;
          }
          await confirmPaper(cw.paperId, auth);
          c.confirmed++;
        }
        await evaluateSectionTriggers(new Types.ObjectId(sec.sectionId), subject as MasterySubject); // the confirm hook already did; this is the explicit read
        if (await MasteryAction.exists({ sectionId: sec.sectionId, subject, loCode: target.code })) c.proposals++;
      } catch (e) {
        c.refused++;
        ctx.refuse("refused", e);
      }
    }
    await ctx.tagSince(since);
    return c;
  },
};
