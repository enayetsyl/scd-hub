/**
 * Scenario 4 (AL-7): one objective most of a section fails in class -> the re-teach proposal
 * (prd-academic-loop-2027 sections 3.8, 9.3; AL-6's in-school rule). Run it after scenario 2.5.
 *
 * Per Class 1..5 section: one in-class work sheet (source CW, in-school evidence) of a few questions on ONE objective, THROUGH
 * `createPaper`, with MOST children ticked wrong; `confirmPaper` writes the evidence and `evaluateSectionTriggers` reads it, so
 * the section trigger (half the class below the line, enough children assessed in school) opens a `MasteryAction`.
 */
import { Types } from "mongoose";
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
    const day = ctx.dayKeys[Math.min(ctx.dayKeys.length - 1, 9)];
    if (!day) return c;
    const since = new Date();
    for (const sec of ctx.sections.filter((s) => s.level >= 1)) {
      const token = classTokenForLevel(sec.level);
      if (!token) continue;
      const enabled = await MasteryEnablement.find({ academicYearId: ctx.academicYearId, classToken: token, enabled: true }).select("subject").lean();
      const slots = (await slotsForDate("section", sec.sectionId, new Date(`${day}T00:00:00.000Z`))).filter((s) => !s.isBreak && s.teacherId);
      const teacherOf = new Map<string, string>();
      for (const s of slots) if (!teacherOf.has(s.subject)) teacherOf.set(s.subject, String(s.teacherId));
      const subject = ctx.pick(enabled.map((e) => e.subject as string).filter((s) => teacherOf.has(s)), 1)[0];
      if (!subject) continue;
      const auth = { userId: teacherOf.get(subject)!, role: "TEACHER" } as unknown as Auth;
      const outcomes = (await lockedOutcomes(token, subject as MasterySubject)).filter((o) => o.assess === "QUESTION" && isTaggedRow(o));
      const bank = await goldBank(outcomes.map((o) => o.code));
      const marks = await marksTable(token, subject as MasterySubject);
      const target = outcomes.find((o) => bank.some((q) => q.loCodes.includes(o.code)));
      const type = target?.questionTypeCodes?.find((t) => marks.has(t)) ?? [...marks.keys()][0];
      const picks = target ? bank.filter((q) => q.loCodes.includes(target.code)).slice(0, 3) : [];
      if (!target || !type || picks.length === 0) {
        c.noStock++;
        continue;
      }
      try {
        const cw = await createPaper(
          { sectionId: sec.sectionId, subject: subject as MasterySubject, source: "CW", date: day, items: picks.map((q) => ({ origin: "BANK" as const, artifactId: q.artifactId, loCode: target.code, questionTypeCode: q.qtCode ?? type })) },
          auth,
        );
        c.cwPapers++;
        const kids = (await Student.find({ sectionId: sec.sectionId, active: true }).select("_id").lean()).map((k) => String(k._id));
        const paper = await MasteryPaper.findOne({ paperId: cw.paperId });
        // MOST of the class fails every question (three children in four), well past the section line.
        const failing = ctx.pick(kids, Math.max(1, Math.ceil(kids.length * 0.75)));
        const rows = failing.map((studentId) => ({ studentId, items: (paper?.items ?? []).map((it) => ({ itemNo: it.itemNo, marks: 0 })) }));
        if (rows.length > 0) {
          await saveResults(cw.paperId, rows, auth);
          c.wrongTicks += rows.length;
        }
        await confirmPaper(cw.paperId, auth);
        c.confirmed++;
        c.proposals += await evaluateSectionTriggers(new Types.ObjectId(sec.sectionId), subject as MasterySubject).catch(() => 0);
      } catch {
        c.refused++;
      }
    }
    await ctx.tagSince(since);
    return c;
  },
};
