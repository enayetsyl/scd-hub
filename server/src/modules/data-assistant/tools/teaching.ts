/**
 * homework_status, assignment_status, lesson_progress, routine_lookup (docs/prd-data-assistant-mcp.md
 * §7 tools 8, 9, 14, 15). Office keeps the report views (`pending` / `load`); the teacher-style
 * `summary` modes need `homework:view` / `assignment:view` exactly as the screens (owner Q1b, P9).
 */
import { z } from "zod";
import { callerHasPermission } from "@scd/shared";
import { assertCanViewHomeworkDay } from "../../trackers/resolvers/homework";
import { homeworkSectionOverview } from "../../trackers/services/HomeworkSummaryService";
import { homeworkLifecycleReport } from "../../trackers/services/HomeworkLifecycleReportService";
import { assignmentSummary } from "../../trackers/services/AssignmentSummaryService";
import { assignmentLoadReport } from "../../trackers/services/AssignmentLoadReportService";
import { progressOverview, sectionTracker } from "../../lesson-progress/services/LessonProgressService";
import { routineForDate, slotsForTeacherOnDate } from "../../routine/services/RoutineSlotService";
import { coversForDate } from "../../routine/services/RoutineCoverService";
import { liveClassBoard } from "../../routine/services/LiveClassBoardService";
import { enrichRoutineSlots } from "../../routine/slotView";
import { resolveUserIdForStaff } from "../../hr/services/staffMatch";
import { assertRule, gateOf } from "../gates";
import { ToolDenied, ToolInvalid, type ToolDef } from "../types";
import { addDays, cap, checkDay, checkRange, CLASS_LEVEL, currentSections, currentYearIdOrThrow, DATE_KEY, OBJECT_ID, sectionClassId, sectionLabels, SUBJECT } from "./common";

// ---------------------------------------------------------------------------
// 8 homework_status
// ---------------------------------------------------------------------------

const HW_SUMMARY = { anyOf: ["homework:view"] } as const;
const HW_PENDING = { anyOf: ["reports:hw_lifecycle"] } as const;

export const homeworkStatus: ToolDef = {
  name: "homework_status",
  label_bn: "বাড়ির কাজ",
  label_en: "Homework",
  description:
    "Homework status (বাড়ির কাজ, জমা, যাচাই, ফেরত, বাকি). mode summary: per section — pending checking, open resubmissions, active chases, on-time %. " +
    "mode pending: the whole school's lifecycle for a date range (≤ 31 days, default the last 7): per teacher given/submitted/checked/returned and the " +
    "backlog per section. Does not list individual students' contacts.",
  input: {
    mode: z.enum(["summary", "pending"]),
    class_level: CLASS_LEVEL.optional(),
    section_id: OBJECT_ID.optional(),
    subject: SUBJECT.optional(),
    from: DATE_KEY.optional(),
    to: DATE_KEY.optional(),
  },
  gates: [
    { mode: "summary", rule: HW_SUMMARY, resolver: { file: "modules/trackers/resolvers/homework.ts", field: "homeworkClassOverview" } },
    { mode: "pending", rule: HW_PENDING, resolver: { file: "modules/trackers/resolvers/hwLifecycleReport.ts", field: "homeworkLifecycleReport" } },
  ],
  maxRows: 100,
  async run(ctx, a) {
    const args = a as { mode: "summary" | "pending"; class_level?: number; section_id?: string; subject?: string; from?: string; to?: string };
    assertRule(ctx.auth, gateOf(homeworkStatus, args.mode));
    if (args.mode === "pending") {
      const to = args.to ?? ctx.today;
      const from = args.from ?? addDays(to, -6);
      checkRange(from, to, 31);
      const r = await homeworkLifecycleReport(from, to, { classLevel: args.class_level ?? null, subject: args.subject ?? null });
      const teachers = cap(r.teachers, 100);
      const backlog = cap(r.backlog, 100);
      return {
        data: {
          from: r.fromKey,
          to: r.toKey,
          backlog_threshold_days: r.backlogThresholdDays,
          teachers: teachers.rows.map((t) => ({
            teacher: t.teacherName,
            given: t.given,
            submitted: t.submitted,
            checked: t.checked,
            returned: t.returned,
            pending_submission: t.pendingSubmission,
            pending_checking: t.pendingChecking,
            pending_return: t.pendingReturn,
            chased_pending: t.chasedPending,
          })),
          backlog: backlog.rows.map((b) => ({ section_id: b.sectionId, section_label_bn: b.sectionNameBn, class_level: b.classLevel, subject: b.subject, teacher: b.teacherName, count: b.count, oldest_days: b.oldestDays })),
        },
        rowCount: teachers.rows.length + backlog.rows.length,
        truncated: teachers.truncated || backlog.truncated,
      };
    }
    // summary: the overview's per-section path; each section passes the screen's own day gate
    // (a section that fails is skipped, as the resolver does).
    const refs = args.section_id ? [{ sectionId: args.section_id, classId: await sectionClassId(args.section_id) }] : await currentSections(args.class_level);
    const allowed: Array<{ classId: string; sectionId: string }> = [];
    for (const r of refs) {
      try {
        await assertCanViewHomeworkDay(ctx.app, r.sectionId, r.classId);
        allowed.push(r);
      } catch {
        /* not this person's section */
      }
    }
    if (allowed.length === 0) throw new ToolDenied(["homework:view_all"], "এই শাখার বাড়ির কাজ দেখার অনুমতি নেই");
    const teacherId = callerHasPermission(ctx.auth, "homework:view_all") ? null : ctx.auth.userId;
    const rows = await homeworkSectionOverview(allowed, Date.now(), { teacherId });
    const labels = await sectionLabels(rows.map((r) => r.sectionId ?? ""));
    const c = cap(rows, 100);
    return {
      data: c.rows.map((r) => ({
        ...(r.sectionId ? labels.get(r.sectionId) ?? { section_id: r.sectionId } : { class_id: r.classId }),
        pending_checking: r.pendingChecking,
        open_resubmissions: r.openResubmissions,
        active_chases: r.activeChases,
        on_time_pct: r.onTimePct,
        days_over_ceiling_this_week: r.overCeilingDaysThisWeek,
      })),
      rowCount: c.rows.length,
      truncated: c.truncated,
      total: c.total,
    };
  },
};

// ---------------------------------------------------------------------------
// 9 assignment_status
// ---------------------------------------------------------------------------

const AS_SUMMARY = { anyOf: ["assignment:view"] } as const;
const AS_LOAD = { anyOf: ["reports:assignment_load"] } as const;

export const assignmentStatus: ToolDef = {
  name: "assignment_status",
  label_bn: "অ্যাসাইনমেন্ট",
  label_en: "Assignments",
  description:
    "Weekly assignment status for the current school year (অ্যাসাইনমেন্ট, জমা, বিতরণ). mode summary: scheduled vs delivered per class / section / teacher / week, " +
    "submission rate, chases (week_from / week_to are week numbers). mode load: planned / delivered / issued per subject and per teacher.",
  input: {
    mode: z.enum(["summary", "load"]),
    week_from: z.number().int().min(1).max(53).optional(),
    week_to: z.number().int().min(1).max(53).optional(),
  },
  gates: [
    { mode: "summary", rule: AS_SUMMARY, resolver: { file: "modules/trackers/resolvers/assignment.ts", field: "assignmentSummary" } },
    { mode: "load", rule: AS_LOAD, resolver: { file: "modules/trackers/resolvers/assignment.ts", field: "assignmentLoadReport" } },
  ],
  maxRows: 100,
  async run(ctx, a) {
    const args = a as { mode: "summary" | "load"; week_from?: number; week_to?: number };
    assertRule(ctx.auth, gateOf(assignmentStatus, args.mode));
    const academicYearId = await currentYearIdOrThrow();
    if (args.mode === "load") {
      const r = await assignmentLoadReport(academicYearId);
      const row = (x: { key: string; label: string; planned: number; delivered: number; issued: number }) => ({ label: x.label, planned: x.planned, delivered: x.delivered, issued: x.issued });
      return { data: { by_subject: r.bySubject.slice(0, 100).map(row), by_teacher: r.byTeacher.slice(0, 100).map(row) }, rowCount: r.bySubject.length + r.byTeacher.length };
    }
    const teacherId = callerHasPermission(ctx.auth, "assignment:view_all") ? undefined : ctx.auth.userId;
    let s;
    try {
      s = await assignmentSummary({ academicYearId, weekFrom: args.week_from, weekTo: args.week_to, teacherId });
    } catch (e) {
      throw new ToolInvalid((e as Error).message);
    }
    const rate = (x: { key: string; scheduled: number; delivered: number; deliveryRatePct: number | null }) => ({ key: x.key, scheduled: x.scheduled, delivered: x.delivered, delivery_rate_pct: x.deliveryRatePct });
    const n = s.byClass.length + s.bySection.length + s.byTeacher.length + s.byWeek.length;
    return {
      data: {
        week_from: s.weekFrom,
        week_to: s.weekTo,
        scheduled: s.scheduledTotal,
        delivered: s.deliveredTotal,
        submission_rate_pct: s.submissionRatePct,
        chases: s.chaseVolume,
        open_resubmissions: s.openResubmissions,
        avg_checking_days: s.avgCheckingLatencyDays,
        students_needing_attention: s.attentionStudentIds.length,
        by_class: s.byClass.map(rate),
        by_section: s.bySection.slice(0, 100).map(rate),
        by_teacher: s.byTeacher.slice(0, 100).map(rate),
        by_week: s.byWeek.map(rate),
      },
      rowCount: n,
    };
  },
};

// ---------------------------------------------------------------------------
// 14 lesson_progress
// ---------------------------------------------------------------------------

const LP_SCHOOL = { anyOf: ["lesson_progress:view_all", "reports:lesson_progress"] } as const;
const LP_SECTION = { anyOf: ["lesson_progress:view", "lesson_progress:view_all"] } as const;

export const lessonProgress: ToolDef = {
  name: "lesson_progress",
  label_bn: "পাঠের অগ্রগতি",
  label_en: "Lesson-plan progress",
  description:
    "Lesson-plan progress (পাঠ পরিকল্পনার অগ্রগতি, কতটা পিছিয়ে, সেশন). Without section_id: every section × subject — sessions planned, finished, behind by. " +
    "With section_id + subject: that section's session list.",
  input: { class_level: CLASS_LEVEL.optional(), subject: SUBJECT.optional(), section_id: OBJECT_ID.optional() },
  gates: [
    { mode: "school", rule: LP_SCHOOL, resolver: { file: "modules/lesson-progress/resolvers/lessonProgress.ts", field: "lessonProgressOverview" } },
    { mode: "section", rule: LP_SECTION, resolver: { file: "modules/lesson-progress/resolvers/lessonProgress.ts", field: "lessonSectionTracker" } },
  ],
  maxRows: 100,
  async run(ctx, a) {
    const args = a as { class_level?: number; subject?: string; section_id?: string };
    const row = (r: Awaited<ReturnType<typeof progressOverview>>[number]) => ({
      section_id: r.sectionId,
      class_level: r.classLevel,
      class_label_bn: r.classNameBn,
      section_label_bn: r.sectionNameBn,
      subject: r.subject,
      planned_sessions: r.total,
      finished: r.finished,
      pct: r.pct,
      behind_by: r.lagSessions,
      last_finished_on: r.lastFinishedKey,
      days_since_last: r.daysSinceLastFinished,
      skipped: r.skipped,
      pace_per_week: r.pacePerWeek,
      projected_finish: r.projectedFinishKey,
    });
    if (args.section_id) {
      if (!args.subject) throw new ToolInvalid("subject is needed with section_id.");
      assertRule(ctx.auth, LP_SECTION);
      // The service runs the screen's row check (assertMayViewSection).
      const t = await sectionTracker(args.section_id, args.subject, ctx.auth);
      const s = cap(t.sessions, 100);
      return {
        data: {
          ...row(t.row),
          sessions: s.rows.map((x) => ({ chapter: x.chapter, session: x.sessionIndex, of: x.sessionOf, title_bn: x.titleBn, status: x.status, finished_on: x.finishedOn, teachers: x.teacherNames })),
        },
        rowCount: s.rows.length,
        truncated: s.truncated,
      };
    }
    assertRule(ctx.auth, LP_SCHOOL);
    const rows = cap(await progressOverview({ classLevel: args.class_level ?? null, subject: args.subject ?? null }), 100);
    return { data: rows.rows.map(row), rowCount: rows.rows.length, truncated: rows.truncated, total: rows.total };
  },
};

// ---------------------------------------------------------------------------
// 15 routine_lookup
// ---------------------------------------------------------------------------

const RT_VIEW = { anyOf: ["routine:view"] } as const;
const RT_TEACHER = { anyOf: ["routine:view", "routine:view_all"] } as const;
const RT_LIVE = { anyOf: ["routine:view_all", "reports:live_classes"] } as const;

export const routineLookup: ToolDef = {
  name: "routine_lookup",
  label_bn: "রুটিন",
  label_en: "Routine",
  description:
    "The class routine (রুটিন, পিরিয়ড, কে কোন ক্লাস নিচ্ছেন, বদলি/কভার). mode section_day: a section's periods on a date; teacher_day: one teacher's periods " +
    "(your own — leave staff_id empty — or anyone's with the whole-routine permission, staff_id from find_staff); live_now: classes running now " +
    "and uncovered periods; covers: cover arrangements on a date. date defaults to today.",
  input: {
    mode: z.enum(["section_day", "teacher_day", "live_now", "covers"]),
    date: DATE_KEY.optional(),
    section_id: OBJECT_ID.optional(),
    staff_id: OBJECT_ID.optional(),
  },
  gates: [
    { mode: "section_day", rule: RT_VIEW, resolver: { file: "modules/routine/resolvers/routineSlots.ts", field: "routineForDate" } },
    {
      mode: "teacher_day",
      rule: RT_TEACHER,
      resolver: null,
      note: "No single query: own day = myRoutineSlots (routine:view); another teacher's = routineMaster (routine:view_all). The tool checks routine:view_all when staff_id is not the caller.",
    },
    { mode: "live_now", rule: RT_LIVE, resolver: { file: "modules/routine/resolvers/liveClassBoard.ts", field: "liveClassBoard" } },
    { mode: "covers", rule: RT_VIEW, resolver: { file: "modules/routine/resolvers/routineSlots.ts", field: "coversForDate" } },
  ],
  maxRows: 60,
  async run(ctx, a) {
    const args = a as { mode: "section_day" | "teacher_day" | "live_now" | "covers"; date?: string; section_id?: string; staff_id?: string };
    assertRule(ctx.auth, gateOf(routineLookup, args.mode));
    const date = args.date ?? ctx.today;
    checkDay(date, addDays(ctx.today, 60), 400);
    const slotRow = (s: { periodNumber: number; subject?: string | null; isBreak?: boolean; startTime: string | null; endTime: string | null; teacherName: string | null; coverTeacherName: string | null; groupName: string | null }) => ({
      period: s.periodNumber,
      start: s.startTime,
      end: s.endTime,
      subject: s.isBreak ? "break" : s.subject ?? null,
      group: s.groupName,
      teacher: s.teacherName,
      cover_teacher: s.coverTeacherName,
    });
    if (args.mode === "section_day") {
      if (!args.section_id) throw new ToolInvalid("section_id is needed for section_day.");
      const slots = await enrichRoutineSlots(await routineForDate("section", args.section_id, new Date(date)));
      const c = cap([...slots].sort((x, y) => x.periodNumber - y.periodNumber), 60);
      return { data: { date, periods: c.rows.map(slotRow) }, rowCount: c.rows.length, truncated: c.truncated };
    }
    if (args.mode === "teacher_day") {
      const teacherId = args.staff_id ? await resolveUserIdForStaff(args.staff_id) : ctx.auth.userId;
      if (!teacherId) throw new ToolInvalid("This staff member has no app login, so no routine is linked.");
      if (teacherId !== ctx.auth.userId) assertRule(ctx.auth, { anyOf: ["routine:view_all"] });
      const slots = await enrichRoutineSlots(await slotsForTeacherOnDate(teacherId, new Date(date)));
      const c = cap([...slots].sort((x, y) => x.periodNumber - y.periodNumber), 60);
      return { data: { date, periods: c.rows.map(slotRow) }, rowCount: c.rows.length, truncated: c.truncated };
    }
    if (args.mode === "covers") {
      const covers = cap(await coversForDate(new Date(date)), 60);
      return {
        data: { date, covers: covers.rows.map((x) => ({ period: x.periodNumber, group: x.groupName, subject: x.subject, absent_teacher: x.absentTeacherName, cover_teacher: x.coverTeacherName })) },
        rowCount: covers.rows.length,
        truncated: covers.truncated,
      };
    }
    const b = await liveClassBoard(date);
    const cells = cap(b.cells, 60);
    return {
      data: {
        date: b.date,
        now: b.nowHHMM,
        live_count: b.liveCount,
        uncovered_now: b.uncoveredNowCount,
        uncovered_today: b.uncoveredTodayCount,
        cells: cells.rows.map((c) => ({ period: c.periodNumber, start: c.startTime, end: c.endTime, group: c.groupName, subject: c.subject, teacher: c.teacherName, cover_teacher: c.coverTeacherName, status: c.status, phase: c.phase, absence: c.absenceReason })),
      },
      rowCount: cells.rows.length,
      truncated: cells.truncated,
    };
  },
};
