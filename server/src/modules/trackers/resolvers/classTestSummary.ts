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
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import type { Role } from "@scd/shared";
import {
  reportsStatus,
  principalDashboard,
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
/** Exported so the cross-tracker whole-picture reuses the SAME report-read scope rule. */
export async function assertReportRead(
  ctx: AppContext,
  sectionId?: string | null,
  opts?: { selfTeacherId?: string | null },
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const role = ctx.auth.role as Role;
  if (isAdminStaff(ctx.auth)) return;
  if (role === "GUARDIAN" || !callerHasPermission(ctx.auth, "tracker:read")) throw new ForbiddenError();
  // Self-scope: a teacher's own reports need no section — requestedBy IS the scope.
  if (!sectionId && opts?.selfTeacherId && opts.selfTeacherId === (ctx.auth.userId as string)) return;
  if (!sectionId) throw new ForbiddenError("শিক্ষকের রিপোর্ট পড়তে সেকশন উল্লেখ করতে হবে");
  const section = (await Section.findById(sectionId).select("classId").lean()) as { classId: Types.ObjectId } | null;
  if (!section) throw new ForbiddenError("Section not found");
  await assertCanRead(ctx, sectionId, section.classId.toString());
}

/** Principal/Office only — the school-wide dashboard (J5). */
function assertDashboardAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!isAdminStaff(ctx.auth)) {
    throw new ForbiddenError("ড্যাশবোর্ড অফিস/অধ্যক্ষের জন্য");
  }
}

/** Overdue-chase: message:dispatch + Principal/Office (D-#88 — the Office chases). */
function assertChaseAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const role = ctx.auth.role as Role;
  if (isAdminStaff(ctx.auth) && callerHasPermission(ctx.auth, "message:dispatch")) return;
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
}): SummaryFilter {
  const asOf = args.asOf ? new Date(args.asOf) : undefined;
  if (asOf && Number.isNaN(asOf.getTime())) throw new ForbiddenError("asOf is not a valid date");
  return {
    academicYearId: args.academicYearId ?? undefined,
    classLevel: args.classLevel ?? undefined,
    sectionId: args.sectionId ?? undefined,
    subject: args.subject ?? undefined,
    retired: args.retired ?? undefined,
    teacherId: args.teacherId ?? undefined,
    asOf,
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
    classLevel: t.exposeInt("classLevel"),
    sectionId: t.exposeString("sectionId"),
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
    overdue: t.exposeBoolean("overdue"),
    schoolDaysLate: t.exposeInt("schoolDaysLate"),
    state: t.exposeString("state"),
  }),
});

builder.queryField("classTestReportsStatus", (t) =>
  t.field({
    type: [ReportStatusRowRef],
    description:
      "Per-exam Reports Status (CT-4, J5): submitted/pending/overdue + school-days late + report state. " +
      "Principal/Office unscoped; a teacher must pass a section they can read (assertReportRead, D-#196).",
    authScopes: { authenticated: true },
    args: {
      academicYearId: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      sectionId: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      teacherId: t.arg.string({ required: false }),
      asOf: t.arg.string({ required: false }),
      /** true → list RETIRED exams instead of live ones, so a retirement can be undone. */
      retired: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReportRead(ctx, args.sectionId, { selfTeacherId: args.teacherId });
      return reportsStatus(filterFromArgs(args));
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
    completionRatePct: t.int({ nullable: true, resolve: (r) => r.completionRatePct }),
    overdueByTeacher: t.field({ type: [OverdueByTeacherRef], resolve: (r) => r.overdueByTeacher }),
  }),
});

builder.queryField("classTestPrincipalDashboard", (t) =>
  t.field({
    type: DashboardRef,
    description: "Class-test KPIs + overdue-by-teacher (CT-4, J5). Principal/Office only (assertDashboardAdmin, D-#196).",
    authScopes: { authenticated: true },
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
    description: "Class×subject progression + trend (CT-4, §9). Principal/Office unscoped; teacher scoped to the section (assertReportRead, D-#196).",
    authScopes: { authenticated: true },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReportRead(ctx, args.sectionId);
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
    description: "A student's class-test profile across subjects (CT-4, J6). Principal/Office unscoped; teacher scoped to the student's section (D-#196).",
    authScopes: { authenticated: true },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const role = ctx.auth.role as Role;
      if (!isAdminStaff(ctx.auth)) {
        // Teacher: scope to the student's own section.
        const student = (await Student.findById(args.studentId).select("sectionId").lean()) as {
          sectionId: Types.ObjectId;
        } | null;
        if (!student) throw new ForbiddenError("Student not found");
        await assertReportRead(ctx, student.sectionId.toString());
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
      "message:dispatch + Principal/Office (the Office chases — teachers never chase themselves, D-#88).",
    authScopes: { hasPermission: "message:dispatch" },
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
