/**
 * Scenario 3 (AL-7): the suggestion engine — children who improve, and children who missed a class
 * (prd-academic-loop-2027 sections 4.4 and 9.3). Run it after scenarios 0 (lessons, absences) and 2.5 (evidence).
 *
 * For each Class 1..5 section, ONE class x subject with mastery on and a locked tree, THROUGH the real services:
 *   week 1  `buildSuggestedDraft` (the engine) -> approve -> send -> the weak children get wrong ticks -> confirm;
 *   week 2  the engine again (a later due day): the weak objectives feed those children's Part B (band WEAK) and a child who
 *           missed a taught class gets "ক্লাস মিস" easy items (band MISSED); this week's AS paper is confirmed with NO wrong
 *           ticks, so the weak children read IMPROVING (the existing rule).
 * Refusals (budget, a section with no stock / no tree) are counted, never fatal.
 */
import { MasteryEnablement } from "../../../modules/mastery/models/MasteryEnablement";
import { MasteryAssignmentSheet } from "../../../modules/mastery/models/MasteryAssignmentSheet";
import { MasteryPaper } from "../../../modules/mastery/models/MasteryPaper";
import { MasteryPolicy } from "../../../modules/mastery/models/MasteryPolicy";
import { sendAssignment } from "../../../modules/mastery/services/MasteryAssignmentService";
import { buildSuggestedDraft } from "../../../modules/mastery/services/AssignmentSuggestionService";
import { classTokenForLevel, confirmPaper, saveResults, type Auth } from "../../../modules/mastery/services/MasteryWorkService";
import { isLoop2027On } from "../../../modules/assessment/services/QuestionUseService";
import { Student } from "../../../modules/foundation/models/Student";
import { slotsForDate } from "../../../modules/routine/services/RoutineSlotService";
import type { MasterySubject } from "@scd/shared";
import { approveWithReview } from "./helpers";
import type { Scenario, ScenarioCtx } from "./types";

const WEAK_CHILDREN = 3;

export const scenario3: Scenario = {
  id: 3,
  name: "engine-weak-absent",
  collections: [{ model: "MasteryPaper" }, { model: "MasteryResult" }, { model: "MasteryAssignment" }, { model: "MasteryAssignmentSheet" }, { model: "AssignmentItem" }, { model: "AssignmentStudentRecord" }],
  async run(ctx: ScenarioCtx): Promise<Record<string, number>> {
    const c: Record<string, number> = { drafts: 0, sent: 0, refused: 0, weakTicks: 0, improvedConfirms: 0, missedEasyItems: 0, weakItems: 0, noStock: 0, noPaper: 0, emptyPapers: 0, gapApprovals: 0 };
    if (!(await isLoop2027On())) {
      await MasteryPolicy.updateOne({ scopeKey: "SCHOOL" }, { $set: { "values.academicLoop2027On": true }, $setOnInsert: { scopeKey: "SCHOOL" } }, { upsert: true });
      ctx.switchedOn.push("academicLoop2027On");
    }
    const first = ctx.dayKeys[Math.min(ctx.dayKeys.length - 1, 7)];
    if (!first) return c;
    const since = new Date();
    ctx.clock(first); // "today" = the fake day: the engine's due-day, delivery and routine-teacher rules read it
    for (const sec of ctx.sections.filter((s) => s.level >= 1)) {
      const token = classTokenForLevel(sec.level);
      if (!token) continue;
      const enabled = await MasteryEnablement.find({ academicYearId: ctx.academicYearId, classToken: token, enabled: true }).select("subject").lean();
      const slots = (await slotsForDate("section", sec.sectionId, new Date(`${first}T00:00:00.000Z`))).filter((s) => !s.isBreak && s.teacherId);
      const teacherOf = new Map<string, string>();
      for (const s of slots) if (!teacherOf.has(s.subject)) teacherOf.set(s.subject, String(s.teacherId));
      const subject = ctx.pick(enabled.map((e) => e.subject as string).filter((s) => teacherOf.has(s)), 1)[0];
      if (!subject) continue;
      const auth = { userId: teacherOf.get(subject)!, role: "TEACHER" } as unknown as Auth;
      const kids = (await Student.find({ sectionId: sec.sectionId, active: true }).select("_id").lean()).map((k) => String(k._id));
      try {
        // Due on SCHOOL days (two Sundays, a week apart): the confirm reads the routine teacher of the paper's own date, and a Friday
        // has none, so a Friday due day was refused at the confirm.
        const dues = [ctx.dayKeys[Math.min(ctx.dayKeys.length - 1, 10)]!, ctx.dayKeys[Math.min(ctx.dayKeys.length - 1, 15)]!];
        for (const [week, due] of [[1, dues[0]!], [2, dues[1]!]] as const) {
          const dueSlots = (await slotsForDate("section", sec.sectionId, new Date(`${due}T00:00:00.000Z`))).filter((s) => !s.isBreak && s.teacherId && s.subject === subject);
          const dueAuth = { userId: dueSlots[0] ? String(dueSlots[0].teacherId) : auth.userId, role: "TEACHER" } as unknown as Auth;
          const r = await buildSuggestedDraft({ sectionId: sec.sectionId, subject: subject as MasterySubject, dueYmd: due, nSubjects: 2, builtBy: "ENGINE", actorId: auth.userId, rebuild: true });
          if (!r.assignment) {
            c.noStock++;
            break;
          }
          c.drafts++;
          const sheets = await MasteryAssignmentSheet.find({ assignmentId: r.assignment._id }).lean();
          for (const s of sheets) {
            c.missedEasyItems += s.items.filter((i) => i.band === "MISSED").length;
            c.weakItems += s.items.filter((i) => i.band === "WEAK").length;
          }
          c.gapApprovals += await approveWithReview(String(r.assignment._id), auth);
          const sent = await sendAssignment(String(r.assignment._id), auth);
          c.sent++;
          if (!sent.paperId) {
            c.noPaper++;
            continue;
          }
          const paper = await MasteryPaper.findOne({ paperId: sent.paperId });
          if (!paper || paper.items.length === 0) {
            // every unseen question of the objectives was already given (HW / CT / AS of the run): a sheet with nothing to tick
            c.emptyPapers++;
            ctx.refuse("emptyPapers", "the sent AS paper carries no question (the bank has no unseen question left for this section)");
            continue;
          }
          if (week === 1) {
            // The weak children: wrong on the first item of the sheet.
            // (the first item of the child's OWN list: each child's sheet is Part A + their own Part B; a child whose sheet is empty is skipped)
            const withSheet = kids.filter((studentId) => (paper.perStudentItems?.find((l) => String(l.studentId) === studentId)?.itemNos.length ?? 0) > 0);
            const rows = ctx.pick(withSheet, Math.min(WEAK_CHILDREN, withSheet.length)).map((studentId) => {
              const own = paper.perStudentItems!.find((l) => String(l.studentId) === studentId)!.itemNos;
              return { studentId, items: [{ itemNo: Math.min(...own), marks: 0 }] };
            });
            if (rows.length > 0) {
              await saveResults(sent.paperId, rows, dueAuth);
              c.weakTicks += rows.length;
            }
          } else c.improvedConfirms++; // week 2: every child right, so the weak children read IMPROVING
          await confirmPaper(sent.paperId, dueAuth);
        }
      } catch (e) {
        c.refused++;
        ctx.refuse("refused", e);
      }
    }
    await ctx.tagSince(since);
    return c;
  },
};
