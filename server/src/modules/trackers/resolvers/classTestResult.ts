/**
 * Class-test result (per-student marks + derived score) resolvers (CT-2,
 * prd-tracker-class-test §3.3/§4/§5, D-#121/#158).
 *
 * RBAC — composes EXISTING permissions only (D-#94/#17, no new role/permission):
 *   - Enter / edit a result (`enterClassTestResult`): `tracker:write` +
 *     `assertCanWrite` on the test's section (resolved server-side) — exactly the
 *     CT-1 request / homework / assignment posture. A teacher can't score a section
 *     they don't write.
 *   - Reads (`classTestStudentResult` / `classTestResults` / `classTestReportStatus`):
 *     `tracker:read`; teachers additionally need read-scope on the test's section
 *     (Principal/Office are unscoped staff) — the CT-1 `classTest` read pattern.
 *
 * `teacherAction` is exposed here because this is a STAFF read; the GUARDIAN-facing
 * result card (CT-3) is a separate gate that never exposes it (J7/D-#68).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import {
  enterResult,
  studentResult,
  testResults,
  examReportStatus,
  type ClassTestResultShape,
  type ExamReportStatus,
} from "../services/ClassTestResultService";
import { getClassTest } from "../services/ClassTestService";
import {
  publishResult,
  publishExam,
  unpublishResult,
  unpublishExam,
  type ClassTestMessageRecipient,
  type PublishResultOutcome,
  type UnpublishOutcome,
} from "../services/ClassTestPublishService";
import { assertCanWrite, assertCanRead, ForbiddenError } from "../../../middleware/authz";

/** Resolve the test's section + enforce staff read-scope on it (teachers only). */
async function assertReadTest(ctx: AppContext, testId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const test = await getClassTest(testId);
  if (!test) throw new ForbiddenError("Class test not found");
  if (ctx.auth.role !== "PRINCIPAL" && ctx.auth.role !== "OFFICE") {
    await assertCanRead(ctx, test.sectionId, test.classId);
  }
}

/** Resolve the test's section + enforce WRITE scope on it (publish/unpublish, J4). */
async function assertWriteTest(ctx: AppContext, testId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const test = await getClassTest(testId);
  if (!test) throw new ForbiddenError("Class test not found");
  await assertCanWrite(ctx, test.sectionId);
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const ClassTestResultRef = builder.objectRef<ClassTestResultShape>("ClassTestResult");
ClassTestResultRef.implement({
  description:
    "A student's DERIVED class-test result (CT-2; percent/pass-fail computed, never stored — D-#85). " +
    "ABSENT carries null marks/percent/pass (excluded from denominators, §4). Operational plane (ADR-005).",
  fields: (t) => ({
    id: t.exposeString("id"),
    testId: t.exposeString("testId"),
    studentId: t.exposeString("studentId"),
    status: t.exposeString("status"),
    marks: t.int({ nullable: true, resolve: (r) => r.marks }),
    totalMarks: t.exposeInt("totalMarks"),
    percent: t.float({ nullable: true, resolve: (r) => r.percent }),
    pass: t.boolean({ nullable: true, resolve: (r) => r.pass }),
    weakness: t.string({ nullable: true, resolve: (r) => r.weakness }),
    teacherAction: t.string({ nullable: true, resolve: (r) => r.teacherAction }),
    guardianAction: t.string({ nullable: true, resolve: (r) => r.guardianAction }),
    publishedAt: t.string({ nullable: true, resolve: (r) => r.publishedAt }),
    publishedVersion: t.exposeInt("publishedVersion"),
  }),
});

const ExamReportStatusRef = builder.objectRef<ExamReportStatus>("ClassTestReportStatus");
ExamReportStatusRef.implement({
  description:
    "Per-exam completion + the school-day-aware, exam-date-anchored deadline/overdue derivation (CT-2, D-#50/#120). " +
    "The cross-exam Reports-Status / dashboard aggregates are CT-4.",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    ctId: t.exposeString("ctId"),
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
  }),
});

// ---------------------------------------------------------------------------
// Mutation — enter / edit a student's result (tracker:write + section verify, J3)
// ---------------------------------------------------------------------------

builder.mutationField("enterClassTestResult", (t) =>
  t.field({
    type: ClassTestResultRef,
    description:
      "Record/edit one student's class-test result (J3): PRESENT + marks (0..totalMarks) or ABSENT, " +
      "plus weakness + teacher/guardian actions. Only on a PRINTED exam, on/after the exam date. " +
      "One row per student per exam (no retake, D-#121). Requires tracker:write on the section. Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      status: t.arg.string({ required: true }),
      marks: t.arg.float({ required: false }),
      weakness: t.arg.string({ required: false }),
      teacherAction: t.arg.string({ required: false }),
      guardianAction: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const test = await getClassTest(args.testId);
      if (!test) throw new ForbiddenError("Class test not found");
      await assertCanWrite(ctx, test.sectionId);
      return enterResult({
        testId: args.testId,
        studentId: args.studentId,
        status: args.status,
        marks: args.marks ?? undefined,
        weakness: args.weakness ?? undefined,
        teacherAction: args.teacherAction ?? undefined,
        guardianAction: args.guardianAction ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries (tracker:read + section read-scope for teachers)
// ---------------------------------------------------------------------------

builder.queryField("classTestStudentResult", (t) =>
  t.field({
    type: ClassTestResultRef,
    nullable: true,
    description: "One student's derived class-test result (CT-2). Null if not yet entered. Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      return studentResult(args.testId, args.studentId);
    },
  }),
);

builder.queryField("classTestResults", (t) =>
  t.field({
    type: [ClassTestResultRef],
    description: "Every entered student result on a class test, with derived scores (CT-2). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      return testResults(args.testId);
    },
  }),
);

builder.queryField("classTestReportStatus", (t) =>
  t.field({
    type: ExamReportStatusRef,
    description:
      "Per-exam completion + the exam-date-anchored, school-day-aware deadline/overdue (CT-2). " +
      "`asOf` (ISO) overrides the clock for deterministic reads. Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      testId: t.arg.string({ required: true }),
      asOf: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      const now = args.asOf ? new Date(args.asOf) : new Date();
      if (Number.isNaN(now.getTime())) throw new ForbiddenError("asOf is not a valid date");
      return examReportStatus(args.testId, now);
    },
  }),
);

// ===========================================================================
// J4 — publish / unpublish (tracker:write + section verify); guardian delivery
// ===========================================================================

const ClassTestMessageRecipientRef = builder.objectRef<ClassTestMessageRecipient>("ClassTestMessageRecipient");
ClassTestMessageRecipientRef.implement({
  description:
    "One published-result delivery (CT-3, J4): the rendered Bangla body, a wa.me link for the family " +
    "(ADR-003), and the login-enabled guardians who got an in-app Notification (D-#72).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    kind: t.exposeString("kind"),
    messageBn: t.exposeString("messageBn"),
    waLink: t.string({ nullable: true, resolve: (r) => r.waLink }),
    unreachableByWa: t.exposeBoolean("unreachableByWa"),
    notifiedGuardianIds: t.exposeStringList("notifiedGuardianIds"),
    publishedVersion: t.exposeInt("publishedVersion"),
  }),
});

const PublishResultOutcomeRef = builder.objectRef<PublishResultOutcome>("ClassTestPublishOutcome");
PublishResultOutcomeRef.implement({
  description: "The result of publishing a student / a whole exam (CT-3, J4) — per-recipient delivery + unreachable count.",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    recipients: t.field({ type: [ClassTestMessageRecipientRef], resolve: (r) => r.recipients }),
    unreachableCount: t.exposeInt("unreachableCount"),
  }),
});

const UnpublishOutcomeRef = builder.objectRef<UnpublishOutcome>("ClassTestUnpublishOutcome");
UnpublishOutcomeRef.implement({
  description: "The result of unpublishing a student / a whole exam (CT-3, J4) — count pulled from the guardian card.",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    unpublishedCount: t.exposeInt("unpublishedCount"),
  }),
});

builder.mutationField("publishClassTestResult", (t) =>
  t.field({
    type: PublishResultOutcomeRef,
    description:
      "Publish ONE student's class-test result (J4): stamps publishedAt + bumps publishedVersion, then " +
      "delivers (wa.me for the family + in-app Notification for login-enabled guardians). A re-publish " +
      "RE-notifies (versioned dedupeKey, D-#122). Requires tracker:write on the section.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertWriteTest(ctx, args.testId);
      return publishResult(args.testId, args.studentId, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("publishClassTestExam", (t) =>
  t.field({
    type: PublishResultOutcomeRef,
    description:
      "Publish ALL entered results for a class test in one go (J4) — same delivery + versioning as the " +
      "per-student publish. Requires tracker:write on the section.",
    authScopes: { hasPermission: "tracker:write" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertWriteTest(ctx, args.testId);
      return publishExam(args.testId, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("unpublishClassTestResult", (t) =>
  t.field({
    type: UnpublishOutcomeRef,
    description:
      "Unpublish ONE student's result (J4) — clears publishedAt so it leaves the guardian card. " +
      "publishedVersion is left as-is; a later re-publish bumps it → re-notify. Requires tracker:write.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertWriteTest(ctx, args.testId);
      return unpublishResult(args.testId, args.studentId, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("unpublishClassTestExam", (t) =>
  t.field({
    type: UnpublishOutcomeRef,
    description: "Unpublish ALL published results for a class test (J4). Requires tracker:write on the section.",
    authScopes: { hasPermission: "tracker:write" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertWriteTest(ctx, args.testId);
      return unpublishExam(args.testId, ctx.auth!.userId as string);
    },
  }),
);
