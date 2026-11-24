/**
 * Scenario 5 (AL-9): late marking (prd-academic-loop-2027 section 7, R3, R30, B10). Run it after scenario 2.
 *
 * For up to three sections of Class 1..5, ONE homework is declared and issued on a later day of the run THROUGH the real
 * services, the children hand it in, a few wrong ticks are saved - and the paper is NOT confirmed. Then the 09:30 ladder
 * runs "the day after the run's last school day" (an explicit `asOf`, so the result does not depend on the real clock):
 * `runMarkEscalation` finds those papers late (`MarkDeadlineService`), writes the MarkEscalation snapshot (rows tagged stage
 * MARKS) and - the dev year being in its second term, or term 1 not - the quiet staff-mistake rows. Nothing reaches a real
 * person (the generator mutes the emitters).
 */
import { classToken, HW_SUBJECTS, subjectAllowedForClassLevel } from "@scd/shared";
import { MasteryPolicy } from "../../../modules/mastery/models/MasteryPolicy";
import { Student } from "../../../modules/foundation/models/Student";
import { HomeworkItem } from "../../../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../../../modules/trackers/models/HomeworkStudentRecord";
import { MasteryPaper } from "../../../modules/mastery/models/MasteryPaper";
import { declareHomeworkItem, issueHomeworkItem, transitionRecord } from "../../../modules/trackers/services/HomeworkService";
import { saveResults, type Auth } from "../../../modules/mastery/services/MasteryWorkService";
import { runMarkEscalation } from "../../../modules/trackers/services/MarkReminderService";
import { isLoop2027On } from "../../../modules/assessment/services/QuestionUseService";
import { slotsForDate } from "../../../modules/routine/services/RoutineSlotService";
import { resolveDayType } from "../../../modules/routine/calendar";
import { dateKeyOf, parseDateKey } from "../../../modules/attendance/dates";
import { pickAllowedHomeworkQids } from "./helpers";
import type { Scenario, ScenarioCtx } from "./types";

const SECTIONS = 3;

export const scenario5: Scenario = {
  id: 5,
  legacy: true,
  name: "late-marking",
  collections: [
    { model: "HomeworkItem" },
    { model: "HomeworkStudentRecord" },
    { model: "MasteryPaper" },
    { model: "MasteryResult" },
    { model: "HomeworkReconciliation" },
    { model: "MarkEscalation" },
    { model: "StaffMistake" },
    { model: "StaffMistakeNote" },
  ],
  async run(ctx: ScenarioCtx): Promise<Record<string, number>> {
    const c: Record<string, number> = { declared: 0, declareRefused: 0, issued: 0, unconfirmed: 0, snapshotRows: 0 };
    if (!(await isLoop2027On())) {
      await MasteryPolicy.updateOne(
        { scopeKey: "SCHOOL" },
        { $set: { "values.academicLoop2027On": true }, $setOnInsert: { scopeKey: "SCHOOL" } },
        { upsert: true },
      );
      ctx.switchedOn.push("academicLoop2027On");
    }
    const open: string[] = [];
    for (const k of ctx.dayKeys) if ((await resolveDayType(parseDateKey(k))) === "FULL") open.push(k);
    if (open.length < 3) return c;
    const dayKey = open[Math.max(0, open.length - 3)]!; // a late-in-run day scenario 2 did not use
    const day = parseDateKey(dayKey);
    const since = new Date();
    ctx.clock(dayKey);
    const hwSubjects = new Set<string>(HW_SUBJECTS);

    for (const sec of ctx.pick(ctx.sections.filter((s) => s.level >= 1), SECTIONS)) {
      const slots = (await slotsForDate("section", sec.sectionId, day)).filter((s) => !s.isBreak && s.teacherId && hwSubjects.has(s.subject));
      const bySubject = new Map<string, string>();
      for (const s of slots) if (!bySubject.has(s.subject)) bySubject.set(s.subject, String(s.teacherId));
      // A subject the section has that day AND a usable bank for: a free-line-only sheet has no paper to leave unconfirmed (the
      // run declared 3 and issued 0 when the random subject had no bank).
      let subject: string | undefined;
      let qids: string[] = [];
      for (const cand of ctx.pick([...bySubject.keys()].filter((s) => subjectAllowedForClassLevel(s as never, sec.level)), bySubject.size)) {
        const got = await pickAllowedHomeworkQids(ctx, sec, cand, dayKey, 3);
        if (got.length > 0) {
          subject = cand;
          qids = got;
          break;
        }
      }
      // No subject had bank stock: a teacher-written marked item still makes a paper.
      const fallbackSubject = ctx.pick([...bySubject.keys()].filter((s) => subjectAllowedForClassLevel(s as never, sec.level)), 1)[0];
      if (!subject) subject = fallbackSubject;
      if (!subject) continue;
      const teacherId = bySubject.get(subject)!;
      let itemId: string;
      try {
        const item = await declareHomeworkItem({
          academicYearId: ctx.academicYearId,
          classId: sec.classId,
          classLevel: sec.level,
          sectionId: sec.sectionId,
          subject,
          dateGiven: dayKey,
          topTags: [`TOP-${subject}-${classToken(sec.level)}-GEN`],
          qCount: Math.max(1, qids.length),
          selectedQids: qids,
          ...(qids.length === 0 ? { teacherItems: [{ textBn: "নিজে একটি বাক্য লেখো।", marks: 2 }] } : {}),
          description: `ফেক বাড়ির কাজ (নম্বর বাকি) — ${subject}`,
          actorId: teacherId,
        });
        itemId = item.itemId;
        c.declared++;
      } catch (e) {
        c.declareRefused++;
        ctx.refuse("declareRefused", e);
        continue;
      }
      const doc = await HomeworkItem.findById(itemId);
      if (!doc?.paperId) continue; // a free-lines-only homework has no paper to confirm
      const kids = await Student.find({ sectionId: sec.sectionId, active: true }).select("_id").lean();
      if (kids.length === 0) continue;
      await issueHomeworkItem(itemId, kids.map((k) => ({ studentId: String(k._id), present: true })), teacherId);
      c.issued++;
      const recs = await HomeworkStudentRecord.find({ hwItemId: doc._id, state: "GIVEN" }).select("_id studentId").lean();
      const handedIn: string[] = [];
      for (const r of recs) {
        await transitionRecord({ recordId: String(r._id), toState: "DUE", actorId: teacherId });
        await transitionRecord({ recordId: String(r._id), toState: "SUBMITTED", actorId: teacherId });
        handedIn.push(String(r.studentId));
      }
      const paper = await MasteryPaper.findById(doc.paperId);
      if (paper) {
        const auth = { userId: teacherId, role: "TEACHER" } as unknown as Auth;
        const rows = ctx.pick(handedIn, Math.min(2, handedIn.length)).map((studentId) => ({
          studentId,
          items: [{ itemNo: paper.items[0]!.itemNo, marks: 0 }],
        }));
        if (rows.length > 0) await saveResults(paper.paperId, rows, auth);
        c.unconfirmed++; // deliberately never confirmed
      }
    }

    // The 09:30 ladder on the day after the run's last school day.
    // (the marks stage is silent on a closed day, so walk to the first OPEN day after the last school day)
    let next = parseDateKey(open[open.length - 1]!);
    for (let i = 0; i < 14; i++) {
      next = new Date(next.getFullYear(), next.getMonth(), next.getDate() + 1);
      if ((await resolveDayType(next)) === "FULL") break;
    }
    const asOf = new Date(`${dateKeyOf(next)}T09:30:00+06:00`);
    c.snapshotRows = await runMarkEscalation(asOf);
    await ctx.tagSince(since);
    return c;
  },
};
