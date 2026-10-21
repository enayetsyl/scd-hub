/**
 * Class-test summary / dashboard resolvers (CT-4, prd-tracker-class-test §6/§9,
 * J5/J6, D-#44). All READ aggregates (D-#85 — derived, never stored); `asOf`
 * overrides the clock for deterministic reads.
 *
 * RBAC — composes EXISTING permissions only (D-#94/#17, no new role/permission):
 *   - Reports Status / Class×Subject / Student Profile: Principal/Office unscoped, a
 *     TEACHER scoped to a section they can read (`assertReportRead`/`assertCanRead`).
 *   - Principal Dashboard: Principal/Office only (the school-wide KPI view, J5).
 *   - Overdue-chase: `message:dispatch` + Principal/Office (the AS-T4 posture, D-#88
 *     — the Office chases; a teacher never chases themselves).
 *
 * authScopes note (D-#196): the four reads gate `{ authenticated: true }`, NOT
 * `{ hasPermission: "tracker:read" }`. OFFICE legitimately reads the dashboard +
 * reports (§6/§9) but does NOT hold `tracker:read` — gating the scope on it rejected
 * Office at the Pothos scope-auth layer BEFORE the resolver's gate could run, making
 * the intended OFFICE branch dead code. The gate helpers below (the `assertChaseAdmin`
 * pattern) are the real authority: P/O pass unscoped, a teacher passes scoped, and
 * GUARDIAN / any role without `tracker:read` is denied.
 *
 * PM (trackers-classtest.md): the reads name `class_test:view` / `class_test:view_all`
 * (CLASS_TEST_REPORT_GATE), the dashboard `class_test:view_all`, the chase
 * `class_test:remind`. Same people by default; the legacy names above are history.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import type { Permission, Role } from "@scd/shared";
import {
  reportsStatus,
  principalDashboard,
  overdueCounts,
  type OverdueCounts,
  classSubjectAnalysis,
  studentProfile,
  overdueChaseList,
  type ReportStatusRow,
  type PrincipalDashboard,
  type OverdueByTeacherRow,
  type ClassSubjectAnalysis,
  type ClassSubjectStudentRow,
  type StudentProfile,
  type StudentProfileResult,
  type StudentProfileSubjectRow,
  type StudentProfileAnalytics,
  type WeaknessTally,
  type OverdueChaseList,
  type OverdueChaseEntry,
  type OverdueChaseExam,
  type SummaryFilter,
} from "../services/ClassTestSummaryService";
import { Section } from "../../foundation/models/Section";
import { Student } from "../../foundation/models/Student";
import { assertCanRead, ForbiddenError } from "../../../middleware/authz";
import type { Types } from "mongoose";
import { isAdminStaff } from "../../foundation/services/RoleScope";

// ---------------------------------------------------------------------------
// Gate helpers
// ---------------------------------------------------------------------------

/** Reports read: Principal/Office unscoped; a TEACHER must scope to a section they
 *  can read (classId resolved server-side) OR to their OWN reports
 *  (`selfTeacherId` === caller — the Today pending-results card); Guardians denied. */
/** Exported so the cross-tracker whole-picture reuses the SAME report-read scope rule.
 *
 *  PM (D-#793): pass `gate` and the feature's actions decide — `viewAll` unscoped (the
 *  isAdminStaff bypass), `view` scoped (the `tracker:read` half). Omitted → the
 *  pre-matrix rule exactly (the monthly-report callers keep it until their own sweep). */
export interface ReportReadGate {
  view: Permission;
  viewAll: Permission;
}
export const CLASS_TEST_REPORT_GATE: ReportReadGate = {
  view: "class_test:view",
  viewAll: "class_test:view_all",
};
export const STUDENT_PROFILE_REPORT_GATE: ReportReadGate = {
  view: "student_profile:view",
  viewAll: "student_profile:view_all",
};

/** True when a staff caller holds the gate's unscoped action (never a guardian). */
export function holdsViewAll(ctx: AppContext, gate: ReportReadGate): boolean {
  return !!ctx.auth && ctx.auth.role !== "GUARDIAN" && callerHasPermission(ctx.auth, gate.viewAll);
}

export async function assertReportRead(
  ctx: AppContext,
  sectionId?: string | null,
  opts?: { selfTeacherId?: string | null; gate?: ReportReadGate },
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const role = ctx.auth.role as Role;
  const gate = opts?.gate;
  if (gate ? holdsViewAll(ctx, gate) : isAdminStaff(ctx.auth)) return;
  if (role === "GUARDIAN" || !callerHasPermission(ctx.auth, gate ? gate.view : "class_test:view")) {
    throw new ForbiddenError();
  }
  // Self-scope: a teacher's own reports need no section — requestedBy IS the scope.
  if (!sectionId && opts?.selfTeacherId && opts.selfTeacherId === (ctx.auth.userId as string)) return;
  if (!sectionId) throw new ForbiddenError("শিক্ষকের রিপোর্ট পড়তে সেকশন উল্লেখ করতে হবে");
  const section = (await Section.findById(sectionId).select("classId").lean()) as { classId: Types.ObjectId } | null;
  if (!section) throw new ForbiddenError("Section not found");
  await assertCanRead(ctx, sectionId, section.classId.toString(), undefined, gate ? { viewAll: gate.viewAll } : undefined);
}

/** The school-wide dashboard (J5) — `class_test:view_all` (Principal/Office by default). */
function assertDashboardAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!holdsViewAll(ctx, CLASS_TEST_REPORT_GATE)) {
    throw new ForbiddenError("ড্যাশবোর্ড অফিস/অধ্যক্ষের জন্য");
  }
}

/** Overdue-chase: `class_test:remind` (D-#88 — the Office chases; a teacher never chases
 *  themselves — the action is Office/Principal by default). */
function assertChaseAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (callerHasPermission(ctx.auth, "class_test:remind")) return;
  throw new ForbiddenError("ক্লাস টেস্ট ফলো-আপ অফিস/অধ্যক্ষের কাজ");
}

function filterFromArgs(args: {
  academicYearId?: string | null;
  classLevel?: number | null;
  sectionId?: string | null;
  subject?: string | null;
  teacherId?: string | null;
  asOf?: string | null;
  retired?: boolean | null;
  examFrom?: string | null;
  examTo?: string | null;
}): SummaryFilter {
  const asOf = args.asOf ? new Date(args.asOf) : undefined;
  if (asOf && Number.isNaN(asOf.getTime())) throw new ForbiddenError("asOf is not a valid date");
  for (const k of [args.examFrom, args.examTo]) {
    if (k && !/^\d{4}-\d{2}-\d{2}$/.test(k)) throw new ForbiddenError("examFrom/examTo must be YYYY-MM-DD");
  }
  return {
    academicYearId: args.academicYearId ?? undefined,
    classLevel: args.classLevel ?? undefined,
    sectionId: args.sectionId ?? undefined,
    subject: args.subject ?? undefined,
    retired: args.retired ?? undefined,
    teacherId: args.teacherId ?? undefined,
    asOf,
    examFrom: args.examFrom ?? undefined,
    examTo: args.examTo ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// 1. Reports Status
// ---------------------------------------------------------------------------

const ReportStatusRowRef = builder.objectRef<ReportStatusRow>("ClassTestReportStatusRow");
ReportStatusRowRef.implement({
  description: "Per-exam Reports-Status row (CT-4): completion + deadline/overdue + the derived report state.",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    ctId: t.exposeString("ctId"),
    subject: t.exposeString("subject"),
    testNumber: t.exposeInt("testNumber"),
    // D-#507: both null on a group-anchored exam. They MUST be declared nullable —
    // an exposeInt/exposeString over null fails the field at REQUEST time (Pothos
    // types do not catch it), which would take the whole Reports-Status list down
    // rather than blank one cell.
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    sectionId: t.string({ nullable: true, resolve: (r) => r.sectionId }),
    subjectGroupId: t.string({ nullable: true, resolve: (r) => r.subjectGroupId }),
    teacherId: t.exposeString("teacherId"),
    // D-#339: drill-down row enrichment.
    teacherName: t.exposeString("teacherName"),
    submittedAt: t.string({ nullable: true, resolve: (r) => r.submittedAt }),
    publishedAt: t.string({ nullable: true, resolve: (r) => r.publishedAt }),
    examDate: t.exposeString("examDate"),
    deadline: t.exposeString("deadline"),
    deadlineDays: t.exposeInt("deadlineDays"),
    rosterCount: t.exposeInt("rosterCount"),
    enteredCount: t.exposeInt("enteredCount"),
    presentCount: t.exposeInt("presentCount"),
    absentCount: t.exposeInt("absentCount"),
    pendingCount: t.exposeInt("pendingCount"),
    complete: t.exposeBoolean("complete"),
    submittedCount: t.exposeInt("submittedCount"),
    publishedCount: t.exposeInt("publishedCount"),
    submitComplete: t.exposeBoolean("submitComplete"),
    publishComplete: t.exposeBoolean("publishComplete"),
    overdue: t.exposeBoolean("overdue", {
      description: "Past deadline and NOT yet published (D-#603) — entering marks no longer clears it.",
    }),
    teacherOverdue: t.exposeBoolean("teacherOverdue", {
      description: "The teacher's share of the delay: past deadline, not yet submitted.",
    }),
    publishOverdue: t.exposeBoolean("publishOverdue", {
      description: "Office/Principal's share: submitted by the teacher, still unpublished past the deadline.",
    }),
    schoolDaysLate: t.exposeInt("schoolDaysLate"),
    state: t.exposeString("state"),
    scriptStage: t.string({
      nullable: true,
      description: "CS-1 (D-#715): the script stage (CT_SCRIPT_STAGES) — null when not in the script flow.",
      resolve: (r) => r.scriptStage,
    }),
  }),
});

builder.queryField("classTestReportsStatus", (t) =>
  t.field({
    type: [ReportStatusRowRef],
    description:
      "Per-exam Reports Status (CT-4, J5): submitted/pending/overdue + school-days late + report state. " +
      "class_test:view_all unscoped; class_test:view must pass a section they can read (assertReportRead, D-#196).",
    authScopes: { hasAnyPermission: ["class_test:view", "class_test:view_all"] },
    args: {
      academicYearId: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      sectionId: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      teacherId: t.arg.string({ required: false }),
      asOf: t.arg.string({ required: false }),
      /** true → list RETIRED exams instead of live ones, so a retirement can be undone. */
      retired: t.arg.boolean({ required: false }),
      // D-#761: optional exam-date window (Dhaka days, inclusive). Omitted = every
      // date, exactly as before, so released bundles are unaffected.
      examFrom: t.arg.string({ required: false, description: "Earliest exam date, YYYY-MM-DD (Dhaka), inclusive." }),
      examTo: t.arg.string({ required: false, description: "Latest exam date, YYYY-MM-DD (Dhaka), inclusive." }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReportRead(ctx, args.sectionId, { selfTeacherId: args.teacherId, gate: CLASS_TEST_REPORT_GATE });
      return reportsStatus(filterFromArgs(args), { withScriptStages: true });
    },
  }),
);

// ---------------------------------------------------------------------------
// 2. Principal Dashboard
// ---------------------------------------------------------------------------

const OverdueByTeacherRef = builder.objectRef<OverdueByTeacherRow>("ClassTestOverdueByTeacher");
OverdueByTeacherRef.implement({
  description: "Overdue class-test reports grouped by the report author (teacher), highest first (CT-4, J5).",
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    teacherName: t.exposeString("teacherName"),
    overdueCount: t.exposeInt("overdueCount"),
  }),
});

const DashboardRef = builder.objectRef<PrincipalDashboard>("ClassTestDashboard");
DashboardRef.implement({
  description: "Principal dashboard KPIs over the official exams in scope (CT-4, J5) — derived, never stored (D-#44/#85).",
  fields: (t) => ({
    logged: t.exposeInt("logged"),
    complete: t.exposeInt("complete"),
    inProgress: t.exposeInt("inProgress"),
    notStarted: t.exposeInt("notStarted"),
    overdue: t.exposeInt("overdue"),
    awaitingSubmit: t.exposeInt("awaitingSubmit", {
      description: "Overdue and still with the teacher (D-#603) — the chase-list population.",
    }),
    awaitingPublish: t.exposeInt("awaitingPublish", {
      description: "Overdue and waiting on Office/Principal approval (D-#603).",
    }),
    completionRatePct: t.int({ nullable: true, resolve: (r) => r.completionRatePct }),
    overdueByTeacher: t.field({ type: [OverdueByTeacherRef], resolve: (r) => r.overdueByTeacher }),
  }),
});

builder.queryField("classTestPrincipalDashboard", (t) =>
  t.field({
    type: DashboardRef,
    description: "Class-test KPIs + overdue-by-teacher (CT-4, J5). class_test:view_all (assertDashboardAdmin, D-#196).",
    authScopes: { hasPermission: "class_test:view_all" },
    args: {
      academicYearId: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      sectionId: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      teacherId: t.arg.string({ required: false }),
      asOf: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertDashboardAdmin(ctx);
      return principalDashboard(filterFromArgs(args));
    },
  }),
);

// ---------------------------------------------------------------------------
// 2b. Overdue counters — the drawer badge + dashboard tiles (D-#603)
// ---------------------------------------------------------------------------

const OverdueCountsRef = builder.objectRef<OverdueCounts>("ClassTestOverdueCounts");
OverdueCountsRef.implement({
  description:
    "Overdue class-test report counters (D-#603). Role-scoped: Principal/Office see the school, " +
    "a teacher sees only their OWN reports — a school-wide number on a teacher's drawer is noise they cannot act on.",
  fields: (t) => ({
    open: t.exposeInt("open", {
      description:
        "Exam sat and results not yet published (D-#620) — the whole outstanding pile. `overdue` is a strict subset.",
    }),
    overdue: t.exposeInt("overdue"),
    awaitingSubmit: t.exposeInt("awaitingSubmit"),
    awaitingPublish: t.exposeInt("awaitingPublish"),
  }),
});

builder.queryField("classTestOverdueCounts", (t) =>
  t.field({
    type: OverdueCountsRef,
    description:
      "Counters behind the ক্লাস টেস্ট drawer badge and the dashboard's delay tiles (D-#603). " +
      "Polled — deliberately name-free so it costs one query less than the full Reports Status.",
    authScopes: { authenticated: true },
    args: {
      academicYearId: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      sectionId: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      asOf: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const role = ctx.auth.role as Role;
      const admin = holdsViewAll(ctx, CLASS_TEST_REPORT_GATE);
      // Returns ZEROES rather than throwing for a role with nothing to see. This
      // field feeds a drawer badge that every signed-in client polls, and a badge
      // probe that CAN be refused is what white-screened the app in 791e5fe — the
      // same reason mySyllabusApprovalCount is unrefusable. It leaks nothing: a
      // count of zero is what such a caller would legitimately be told anyway.
      const blind = !admin && (role === "GUARDIAN" || !callerHasPermission(ctx.auth, "class_test:view"));
      if (blind) return { open: 0, overdue: 0, awaitingSubmit: 0, awaitingPublish: 0 };
      // A teacher's badge counts only what they are accountable for (the same
      // `teacherId ?? requestedBy` attribution the dashboard uses).
      return overdueCounts({
        ...filterFromArgs(args),
        teacherId: admin ? undefined : (ctx.auth.userId as string),
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// 3. Class × Subject Analysis
// ---------------------------------------------------------------------------

const ClassSubjectStudentRef = builder.objectRef<ClassSubjectStudentRow>("ClassTestClassSubjectStudent");
ClassSubjectStudentRef.implement({
  description: "One student's progression in a (section × subject): PRESENT percents + trend (CT-4, §9).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    percents: t.exposeFloatList("percents"),
    latestPercent: t.float({ nullable: true, resolve: (r) => r.latestPercent }),
    previousPercent: t.float({ nullable: true, resolve: (r) => r.previousPercent }),
    trend: t.exposeString("trend"),
    examsTaken: t.exposeInt("examsTaken"),
  }),
});

const ClassSubjectAnalysisRef = builder.objectRef<ClassSubjectAnalysis>("ClassTestClassSubjectAnalysis");
ClassSubjectAnalysisRef.implement({
  description: "Per-student progression + trend ↑/↓/→ for a (section × subject) (CT-4, J6/§9).",
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    subject: t.exposeString("subject"),
    examCount: t.exposeInt("examCount"),
    students: t.field({ type: [ClassSubjectStudentRef], resolve: (r) => r.students }),
  }),
});

builder.queryField("classTestClassSubjectAnalysis", (t) =>
  t.field({
    type: ClassSubjectAnalysisRef,
    description: "Class×subject progression + trend (CT-4, §9). class_test:view_all unscoped; class_test:view scoped to the section (assertReportRead, D-#196).",
    authScopes: { hasAnyPermission: ["class_test:view", "class_test:view_all"] },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReportRead(ctx, args.sectionId, { gate: CLASS_TEST_REPORT_GATE });
      return classSubjectAnalysis(args.sectionId, args.subject);
    },
  }),
);

// ---------------------------------------------------------------------------
// 4. Student Profile
// ---------------------------------------------------------------------------

const StudentProfileResultRef = builder.objectRef<StudentProfileResult>("ClassTestStudentProfileResult");
StudentProfileResultRef.implement({
  description: "One class-test result in a student's profile (CT-4) — derived score, staff read.",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    ctId: t.exposeString("ctId"),
    subject: t.exposeString("subject"),
    testNumber: t.exposeInt("testNumber"),
    examDate: t.exposeString("examDate"),
    status: t.exposeString("status"),
    marks: t.int({ nullable: true, resolve: (r) => r.marks }),
    totalMarks: t.exposeInt("totalMarks"),
    percent: t.float({ nullable: true, resolve: (r) => r.percent }),
    pass: t.boolean({ nullable: true, resolve: (r) => r.pass }),
    weakness: t.string({ nullable: true, resolve: (r) => r.weakness }),
    teacherAction: t.string({ nullable: true, resolve: (r) => r.teacherAction }),
    guardianAction: t.string({ nullable: true, resolve: (r) => r.guardianAction }),
  }),
});

const StudentProfileSubjectRef = builder.objectRef<StudentProfileSubjectRow>("ClassTestStudentProfileSubject");
StudentProfileSubjectRef.implement({
  description: "A student's per-subject roll-up across class tests (CT-4) — avg/latest/previous percent + trend.",
  fields: (t) => ({
    subject: t.exposeString("subject"),
    examsTaken: t.exposeInt("examsTaken"),
    avgPercent: t.float({ nullable: true, resolve: (r) => r.avgPercent }),
    latestPercent: t.float({ nullable: true, resolve: (r) => r.latestPercent }),
    previousPercent: t.float({ nullable: true, resolve: (r) => r.previousPercent }),
    trend: t.exposeString("trend"),
    classAvgPercent: t.float({ nullable: true, resolve: (r) => r.classAvgPercent }),
    classHighestPercent: t.float({ nullable: true, resolve: (r) => r.classHighestPercent }),
  }),
});

const WeaknessTallyRef = builder.objectRef<WeaknessTally>("ClassTestWeaknessTally");
WeaknessTallyRef.implement({
  description: "A recurring weakness note + how many times it appeared (CT-10).",
  fields: (t) => ({
    tag: t.exposeString("tag"),
    count: t.exposeInt("count"),
  }),
});

export const StudentAnalyticsRef = builder.objectRef<StudentProfileAnalytics>("ClassTestStudentAnalytics");
StudentAnalyticsRef.implement({
  description: "CT-10 derived per-student analytics — trajectory, consistency, at-risk, streaks, rank. Never stored (D-#85).",
  fields: (t) => ({
    examsPresent: t.exposeInt("examsPresent"),
    avgPercent: t.float({ nullable: true, resolve: (r) => r.avgPercent }),
    consistency: t.float({ nullable: true, resolve: (r) => r.consistency }),
    slope: t.float({ nullable: true, resolve: (r) => r.slope }),
    trajectory: t.exposeString("trajectory"),
    atRisk: t.exposeBoolean("atRisk"),
    streakKind: t.string({ nullable: true, resolve: (r) => r.streakKind }),
    streakLength: t.exposeInt("streakLength"),
    bestSubject: t.string({ nullable: true, resolve: (r) => r.bestSubject }),
    weakestSubject: t.string({ nullable: true, resolve: (r) => r.weakestSubject }),
    recurringWeaknesses: t.field({ type: [WeaknessTallyRef], resolve: (r) => r.recurringWeaknesses }),
    latestRank: t.int({ nullable: true, resolve: (r) => r.latestRank }),
    latestRankOf: t.int({ nullable: true, resolve: (r) => r.latestRankOf }),
    classAvgPercent: t.float({ nullable: true, resolve: (r) => r.classAvgPercent }),
    classHighestPercent: t.float({ nullable: true, resolve: (r) => r.classHighestPercent }),
  }),
});

/** Exported so the student-profile hub (SP-2) can serve the SAME type from its own
 *  narrowing gate instead of declaring a second class-test profile shape. */
export const StudentProfileRef = builder.objectRef<StudentProfile>("ClassTestStudentProfile");
StudentProfileRef.implement({
  description: "One student across subjects (CT-4) — per-result list (newest first) + per-subject roll-up + CT-10 analytics.",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    results: t.field({ type: [StudentProfileResultRef], resolve: (r) => r.results }),
    bySubject: t.field({ type: [StudentProfileSubjectRef], resolve: (r) => r.bySubject }),
    analytics: t.field({ type: StudentAnalyticsRef, resolve: (r) => r.analytics }),
  }),
});

builder.queryField("classTestStudentProfile", (t) =>
  t.field({
    type: StudentProfileRef,
    description: "A student's class-test profile across subjects (CT-4, J6). class_test:view_all unscoped; class_test:view scoped to the student's section (D-#196).",
    authScopes: { hasAnyPermission: ["class_test:view", "class_test:view_all"] },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (!holdsViewAll(ctx, CLASS_TEST_REPORT_GATE)) {
        // Teacher: scope to the student's own section.
        const student = (await Student.findById(args.studentId).select("sectionId").lean()) as {
          sectionId: Types.ObjectId;
        } | null;
        if (!student) throw new ForbiddenError("Student not found");
        await assertReportRead(ctx, student.sectionId.toString(), { gate: CLASS_TEST_REPORT_GATE });
      }
      return studentProfile(args.studentId);
    },
  }),
);

// ---------------------------------------------------------------------------
// 5. Office overdue-chase list
// ---------------------------------------------------------------------------

const OverdueChaseExamRef = builder.objectRef<OverdueChaseExam>("ClassTestOverdueChaseExam");
OverdueChaseExamRef.implement({
  description: "One overdue exam in a teacher's chase entry (CT-4, J6).",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    ctId: t.exposeString("ctId"),
    subject: t.exposeString("subject"),
    testNumber: t.exposeInt("testNumber"),
    examDate: t.exposeString("examDate"),
    schoolDaysLate: t.exposeInt("schoolDaysLate"),
    pendingCount: t.exposeInt("pendingCount"),
  }),
});

const OverdueChaseEntryRef = builder.objectRef<OverdueChaseEntry>("ClassTestOverdueChaseEntry");
OverdueChaseEntryRef.implement({
  description:
    "A teacher with overdue class-test reports + the rendered wa.me nudge (CT-4, J6; ADR-003 manual send).",
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    teacherName: t.exposeString("teacherName"),
    unreachableByWa: t.exposeBoolean("unreachableByWa"),
    overdueCount: t.exposeInt("overdueCount"),
    exams: t.field({ type: [OverdueChaseExamRef], resolve: (r) => r.exams }),
    messageBn: t.exposeString("messageBn"),
    waLink: t.string({ nullable: true, resolve: (r) => r.waLink }),
  }),
});

const OverdueChaseListRef = builder.objectRef<OverdueChaseList>("ClassTestOverdueChase");
OverdueChaseListRef.implement({
  description: "The Office overdue-chase list (CT-4, J6) — one entry per teacher with overdue reports.",
  fields: (t) => ({
    entries: t.field({ type: [OverdueChaseEntryRef], resolve: (r) => r.entries }),
    unreachableCount: t.exposeInt("unreachableCount"),
  }),
});

builder.queryField("classTestOverdueChase", (t) =>
  t.field({
    type: OverdueChaseListRef,
    description:
      "The Office chase list (CT-4, J6): teachers with overdue class-test reports + a wa.me nudge each. " +
      "class_test:remind (the Office chases — teachers never chase themselves, D-#88).",
    authScopes: { hasPermission: "class_test:remind" },
    args: {
      academicYearId: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      sectionId: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      teacherId: t.arg.string({ required: false }),
      asOf: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertChaseAdmin(ctx);
      return overdueChaseList(filterFromArgs(args));
    },
  }),
);
