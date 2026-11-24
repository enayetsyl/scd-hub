/**
 * Scenario 9 (AL-15): the realistic fake 2027 term, 3 January to `--until` (default 30 June), on the dev generator.
 * docs/dev-test-scenarios-2027.md is the spec; the base rates of its section 1 drive the personas.
 *
 * ONE pass over the school days (the loop below), each day through the real services with the generator clock set to that day:
 *   attendance by child persona x weekday; class notes + lesson deliveries by teacher persona; homework given by subject weight,
 *   handed in by child persona and marked on the teacher's schedule; the weekly assignment cycle (ASDRAFT, edits, finalise,
 *   delivery, hand-in, marking); class-work sheets; class tests about every three weeks per subject (with and without a sheet);
 *   teacher leave with covers; the Wednesday guardian message run; the 09:30 marks ladder; and the guaranteed events of section 3.
 * Exam days are not teaching days; the preparation week gives little homework and no assignment (the pause windows of the calendar).
 * After the pass the term targets / behind-target pass of scenario 6 runs once, and the report prints the achieved rates.
 * The dev calendar is seeded by the frame BEFORE this runs (`needsCalendar`).
 */
import { Types } from "mongoose";
import { MasteryPolicy } from "../../../modules/mastery/models/MasteryPolicy";
import { RoutineSlot } from "../../../modules/routine/models/RoutineSlot";
import { Student } from "../../../modules/foundation/models/Student";
import { isLoop2027On } from "../../../modules/assessment/services/QuestionUseService";
import { isLessonPlanQuestionOn, setLessonPlanQuestionOn } from "../../../modules/lesson-progress/services/LessonPlanQuestionSwitch";
import { resolveDayType } from "../../../modules/routine/calendar";
import { parseDateKey } from "../../../modules/attendance/dates";
import { assignChildPersonas, assignTeacherPersonas } from "../term/personas";
import { isExamDay } from "../term/calendar";
import { Sim } from "../term/state";
import { absentBySection, attendanceDay, guardianSummaryRun, homeworkDay, hwQueue, lessonsDay, markHomeworkDue, marksLadder, resetDailyState } from "../term/daily";
import { asTracks, resetWeeklyState, weeklyDay } from "../term/weekly";
import { classTestDay, cwDay, planClassTests, weekdayOf } from "../term/tests";
import { leavesStartingOn, planLeaves } from "../term/staff";
import { buildStages, closeStages, resetEventState, runStages } from "../term/events";
import { buildReport, reportLines } from "../term/report";
import { scenario6 } from "./6-behind-target";
import { scenario8 } from "./8-loop-health";
import { restoreGuardianRun, snapshotGuardianRun } from "../term/bookkeeping";
import type { Scenario, ScenarioCtx } from "./types";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU"];
const LONG_ABSENCE_DAYS = 13; // a 2-3 week illness (p50 4, p90 12, p95 24 in 2026)

/** The Sunday-based week number of a day since 3 Jan 2027. */
const weekOf = (k: string): number => {
  const [y, m, d] = k.split("-").map(Number) as [number, number, number];
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(2027, 0, 3)) / (7 * 86_400_000));
};

export const scenario9: Scenario = {
  id: 9,
  name: "realistic-term",
  needsCalendar: true,
  collections: [
    // lessons, attendance
    { model: "ClassNote" }, { model: "LessonDelivery" }, { model: "StudentAttendanceDay" }, { model: "AttendanceCorrectionNote" },
    // homework, class work, class tests, the weekly assignment
    { model: "HomeworkItem" }, { model: "HomeworkStudentRecord" }, { model: "HomeworkReconciliation" },
    { model: "MasteryPaper" }, { model: "MasteryResult" }, { model: "MasteryAssignment" }, { model: "MasteryAssignmentSheet" },
    { model: "ClassTest" }, { model: "ClassTestResult" }, { model: "StoredFile" },
    { model: "AssignmentItem" }, { model: "AssignmentStudentRecord" },
    // the guaranteed events
    { model: "IntegrityCase" }, { model: "MasteryAction" }, { model: "Student" }, { model: "Enrolment" },
    // teacher leave + covers
    { model: "StaffLeaveApplication" }, { model: "StaffCoverSlot" }, { model: "RoutineSubstitution" }, { model: "ScopeGrant" }, { model: "ProbationLeaveDebt" },
    // the 09:30 ladder, the guardian run bookkeeping, term targets, the dev calendar
    { model: "MarkEscalation" }, { model: "GuardianSummaryRun" }, { model: "SyllabusTarget" },
    { model: "HolidayException" }, { model: "AcademicPause" }, { model: "Exam" }, { model: "ExamRoutine" },
    // the late joiner's guardian login + her attendance group
    { model: "Guardian" }, { model: "GuardianLink" }, { model: "SubjectGroupMembership" },
  ],
  async run(ctx: ScenarioCtx): Promise<Record<string, number>> {
    // The guardian run log is put back as it was, even when the run fails (and `--remove` does it again from the manifest).
    const guardianRunBefore = await snapshotGuardianRun();
    await ctx.saveManifest({ bookkeeping: { guardianRunBefore } });
    try {
      return await runTerm(ctx);
    } finally {
      await restoreGuardianRun(guardianRunBefore);
    }
  },
};

async function runTerm(ctx: ScenarioCtx): Promise<Record<string, number>> {
  {
    // ---- the release switches (configuration, not run data: recorded, kept by --remove) -------------------------------
    if (!(await isLoop2027On())) {
      await MasteryPolicy.updateOne({ scopeKey: "SCHOOL" }, { $set: { "values.academicLoop2027On": true }, $setOnInsert: { scopeKey: "SCHOOL" } }, { upsert: true });
      ctx.switchedOn.push("academicLoop2027On");
    }
    if (!(await isLessonPlanQuestionOn())) {
      await setLessonPlanQuestionOn(true, new Types.ObjectId().toString());
      ctx.switchedOn.push("classNoteQuestionOn");
    }

    resetDailyState();
    resetWeeklyState();
    resetEventState();
    const sim = new Sim(ctx, ctx.sections);
    const runStart = new Date();

    // ---- the school days of the run --------------------------------------------------------------------------------------
    for (const k of ctx.dayKeys) if ((await resolveDayType(parseDateKey(k))) === "FULL") sim.openDays.push(k);
    sim.teachDays = sim.openDays.filter((k) => !isExamDay(k));
    if (sim.openDays.length === 0) return {};

    // ---- the routine facts: cell teacher, weekdays of each subject, every teacher ------------------------------------------
    const slots = await RoutineSlot.find({ groupType: "section", groupId: { $in: ctx.sections.map((s) => s.sectionId) }, active: true })
      .select("groupId subject teacherId dayOfWeek periodNumber isBreak")
      .sort({ periodNumber: 1 })
      .lean();
    const teachers = new Set<string>();
    for (const s of slots) {
      if (s.isBreak || !s.teacherId) continue;
      const k = `${String(s.groupId)}|${s.subject}`;
      if (!sim.cellTeacher.has(k)) sim.cellTeacher.set(k, String(s.teacherId));
      const set = sim.subjectDays.get(k) ?? new Set<number>();
      set.add(Math.max(0, DAYS.indexOf(s.dayOfWeek as string)));
      sim.subjectDays.set(k, set);
      teachers.add(String(s.teacherId));
    }

    // ---- personas (persisted in the manifest as ids only) ---------------------------------------------------------------
    const byLevel = new Map<number, string[]>();
    const sectionOf = new Map<string, string>();
    for (const st of await Student.find({ active: true, sectionId: { $in: ctx.sections.map((s) => s.sectionId) } }).select("_id sectionId").lean()) {
      const level = sim.level.get(String(st.sectionId));
      if (level === undefined) continue;
      byLevel.set(level, [...(byLevel.get(level) ?? []), String(st._id)]);
      sectionOf.set(String(st._id), String(st.sectionId));
    }
    for (const [id, p] of assignChildPersonas(ctx.rng, byLevel)) sim.childPersona.set(id, p);
    for (const [id, sectionId] of sectionOf) sim.childSection.set(id, sectionId);
    for (const [id, p] of assignTeacherPersonas(ctx.rng, [...teachers])) sim.teacherPersona.set(id, p);
    // C4: a long illness in February (week 5 onwards), the children one after another a few days apart
    let n4 = 0;
    for (const [id, p] of [...sim.childPersona.entries()].sort()) {
      if (p !== "C4") continue;
      const from = sim.openDays.findIndex((k) => weekOf(k) >= 5);
      const first = from + (n4++ % 4) * 2;
      const last = Math.min(sim.openDays.length - 1, first + LONG_ABSENCE_DAYS - 1);
      if (from >= 0 && first < sim.openDays.length) sim.streaks.set(id, [sim.openDays[first] as string, sim.openDays[last] as string]);
    }
    sim.leaves = planLeaves(sim);
    await planClassTests(sim, weekOf);
    const stages = buildStages(sim);
    ctx.log(`[dev-fake] term: ${sim.openDays.length} school days (${sim.teachDays.length} teaching), ${sim.childPersona.size} children, ${teachers.size} teachers, ${sim.leaves.length} planned leaves, ${sim.ctPlan.size} planned class tests, ${stages.length} guaranteed events`);

    // ---- the pass --------------------------------------------------------------------------------------------------------
    let windowStart = new Date();
    for (const [i, dayKey] of sim.openDays.entries()) {
      ctx.clock(dayKey); // every date rule in the services reads the fake day
      const exam = isExamDay(dayKey);
      await sim.safe("leaves", () => leavesStartingOn(sim, dayKey));
      await runStages(sim, stages, dayKey, "pre");
      await sim.safe("attendance", () => attendanceDay(sim, dayKey));
      if (!exam) {
        await sim.safe("lessons", () => lessonsDay(sim, dayKey));
        await sim.safe("hwMark", () => markHomeworkDue(sim, dayKey));
        await sim.safe("hwGive", () => homeworkDay(sim, dayKey));
        await sim.safe("cw", () => cwDay(sim, dayKey));
        await sim.safe("classTests", () => classTestDay(sim, dayKey));
      }
      await sim.safe("weekly", () => weeklyDay(sim, dayKey, runStart));
      await runStages(sim, stages, dayKey, "post");
      const weekday = weekdayOf(dayKey);
      if (weekday === 1) await marksLadder(sim, dayKey); // Monday 09:30: the late-marks list of the week before
      if (weekday === 3) await guardianSummaryRun(sim, dayKey); // Wednesday 18:00
      if (weekday === 4 || i === sim.openDays.length - 1) {
        await ctx.tagSince(windowStart); // a week at a time: one sweep over the declared collections, not one a day
        windowStart = new Date();
        if (weekday === 4) ctx.log(`[dev-fake] week ${weekOf(dayKey) + 1} done (${dayKey}): notes ${sim.c.notes ?? 0}, hw ${sim.c.hwDeclared ?? 0}, as sent ${sim.c.asSent ?? 0}, tests ${(sim.c.ctWithSheet ?? 0) + (sim.c.ctWithoutSheet ?? 0)}`);
      }
    }
    const lastDay = sim.openDays[sim.openDays.length - 1] as string;
    ctx.clock(lastDay);
    await sim.safe("hwMark", () => markHomeworkDue(sim, lastDay, true)); // whatever was still waiting for its marking day
    closeStages(sim, stages, lastDay);
    // a last sweep: the events' fire-and-forget writes (integrity cases, audits) land a moment after the call returns
    await new Promise((r) => setTimeout(r, 400));
    await ctx.tagSince(windowStart);

    // ---- the term targets + the behind-target pass (T5 / S5), once, at the end -----------------------------------------------
    const before = new Date();
    const behind = await sim.safe("targets", () => scenario6.run(ctx));
    for (const [k, v] of Object.entries(behind ?? {})) sim.c[`targets_${k}`] = v;
    await ctx.tagSince(before);
    ctx.clock(null);

    // ---- the loop-health read (scenario 8), AFTER the term, so it reads the generated data ----------------------------------------
    const health = await sim.safe("health", () => scenario8.run(ctx));
    for (const [k, v] of Object.entries(health ?? {})) sim.c[`health_${k}`] = v;

    // ---- the report -----------------------------------------------------------------------------------------------------------
    const report = await buildReport(sim, { behindSections: behind?.behindSections, targetsSet: behind?.targetsSet, healthRows: health?.sectionRows });
    for (const line of reportLines(report)) ctx.log(line);
    const ids = (m: Map<string, string>): Record<string, string[]> => {
      const out: Record<string, string[]> = {};
      for (const [id, p] of m) (out[p] ??= []).push(id);
      return out;
    };
    await ctx.saveManifest({
      personas: { children: ids(sim.childPersona), teachers: ids(sim.teacherPersona), streaks: Object.fromEntries(sim.streaks) },
      events: report.scenarios.map(({ names: _names, ...rest }) => rest),
      rates: report.rates,
      until: ctx.until,
    });
    void absentBySection;
    sim.c.pendingHw = hwQueue.length;
    sim.c.pendingAs = asTracks.size;
    return { ...sim.c };
  }
}
