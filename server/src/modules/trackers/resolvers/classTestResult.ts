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
  unpublishResult,
  unpublishExam,
  submitExam,
  recallExam,
  sendBackExam,
  approveExam,
  type ClassTestMessageRecipient,
  type PublishResultOutcome,
  type UnpublishOutcome,
  type SubmitOutcome,
} from "../services/ClassTestPublishService";
import { Subject } from "../../foundation/models/Subject";
import { ForbiddenError } from "../../../middleware/authz";
import { assertAnchorRead, assertAnchorWrite, classTestRosterStudents } from "../classTestAnchor";

async function resolveSubjectId(subject: string): Promise<string> {
  const doc = await Subject.findOne({ code: subject }).select("_id").lean();
  if (!doc) throw new Error(`Subject not found: ${subject}`);
  return doc._id.toString();
}

/** Resolve the test's unit + enforce staff read-scope on it (teachers only).
 *  Anchor-aware since D-#507: a group exam is read-scoped by "you teach that
 *  group", since it has no section to hold a grant. */
async function assertReadTest(ctx: AppContext, testId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const test = await getClassTest(testId);
  if (!test) throw new ForbiddenError("Class test not found");
  await assertAnchorRead(ctx, test);
}

/** Resolve the test's unit + enforce WRITE scope on it (publish/unpublish, J4).
 *  Tagged `enter_classtest_result` (ACS-3): the result lifecycle is one duty — a
 *  delegate who may enter marks may also submit/publish that same result set. */
async function assertWriteTest(ctx: AppContext, testId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const test = await getClassTest(testId);
  if (!test) throw new ForbiddenError("Class test not found");
  await assertAnchorWrite(ctx, test, () => resolveSubjectId(test.subject), "enter_classtest_result");
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
    submittedAt: t.string({ nullable: true, resolve: (r) => r.submittedAt }),
    sendBackReason: t.string({ nullable: true, resolve: (r) => r.sendBackReason }),
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
      await assertAnchorWrite(ctx, test, () => resolveSubjectId(test.subject), "enter_classtest_result");
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

/** The exam's own roster — D-#507. The marks screen used `studentsInSection`, which
 *  a group-anchored exam has no answer for: its students come from several sections.
 *  One anchor-aware read means the client never has to know which shape it is. */
const ClassTestRosterStudentRef = builder
  .objectRef<{ id: string; schoolId: string; name: string; nameBn: string | null; sectionNameBn: string | null }>(
    "ClassTestRosterStudent",
  )
  .implement({
    fields: (t) => ({
      id: t.exposeString("id"),
      schoolId: t.exposeString("schoolId"),
      name: t.exposeString("name"),
      nameBn: t.string({ nullable: true, resolve: (s) => s.nameBn }),
      /** Set for a GROUP exam: which section the child comes from — the group mixes
       *  several, and a teacher marking 11 children from 4 classes needs to tell them
       *  apart. Null on a section exam, where it would repeat the header. */
      sectionNameBn: t.string({ nullable: true, resolve: (s) => s.sectionNameBn }),
    }),
  });

builder.queryField("classTestRoster", (t) =>
  t.field({
    type: [ClassTestRosterStudentRef],
    description:
      "The active students who sat this exam (D-#507): the section's roster, or the Arabic " +
      "GROUP's members for a group-anchored exam. Requires tracker:read + read scope on the unit.",
    authScopes: { hasPermission: "tracker:read" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      const test = await getClassTest(args.testId);
      if (!test) throw new ForbiddenError("Class test not found");
      return classTestRosterStudents(test);
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

const SubmitOutcomeRef = builder.objectRef<SubmitOutcome>("ClassTestSubmitOutcome");
SubmitOutcomeRef.implement({
  description: "CT-8 approval-gate transition result — the number of result rows affected.",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    count: t.exposeInt("count"),
  }),
});

// --- CT-8 approval gate: teacher SUBMIT / RECALL (tracker:write + section verify) ---

builder.mutationField("submitClassTestExam", (t) =>
  t.field({
    type: SubmitOutcomeRef,
    description:
      "CT-8: teacher submits an exam's results for Office/Principal approval. Marks rows SUBMITTED " +
      "(guardians do NOT see yet) and clears any prior send-back. Requires tracker:write on the section.",
    authScopes: { hasPermission: "tracker:write" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertWriteTest(ctx, args.testId);
      return submitExam(args.testId, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("recallClassTestExam", (t) =>
  t.field({
    type: SubmitOutcomeRef,
    description: "CT-8: teacher recalls a pending submission back to draft so it can be edited. Requires tracker:write.",
    authScopes: { hasPermission: "tracker:write" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertWriteTest(ctx, args.testId);
      return recallExam(args.testId, ctx.auth!.userId as string);
    },
  }),
);

// --- CT-8 approval gate: Office/Principal APPROVE / SEND-BACK / UNPUBLISH (roster:manage).
// assertReadTest only enforces existence for admins (it skips the teacher section check for
// PRINCIPAL/OFFICE) — NOT assertWriteTest, which denies OFFICE. ---

builder.mutationField("publishClassTestExam", (t) =>
  t.field({
    type: PublishResultOutcomeRef,
    description:
      "CT-8 APPROVE: Office/Principal releases a SUBMITTED exam's results → guardian delivery (wa.me + " +
      "in-app). Requires the teacher to have submitted first. roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      return approveExam(args.testId, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("publishClassTestResult", (t) =>
  t.field({
    type: PublishResultOutcomeRef,
    description:
      "CT-8: Office/Principal releases ONE student's result (per-student override of the per-exam approve). " +
      "Stamps publishedAt + delivers; re-publish RE-notifies. roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      return publishResult(args.testId, args.studentId, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("sendBackClassTestExam", (t) =>
  t.field({
    type: SubmitOutcomeRef,
    description: "CT-8: Office/Principal sends a submitted exam back to the teacher (→ draft) with a reason. roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      testId: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      return sendBackExam(args.testId, ctx.auth!.userId as string, args.reason);
    },
  }),
);

builder.mutationField("unpublishClassTestResult", (t) =>
  t.field({
    type: UnpublishOutcomeRef,
    description:
      "CT-8: Office/Principal unpublishes ONE student's result — clears publishedAt (leaves the guardian card) " +
      "and the submission, back to draft. roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      return unpublishResult(args.testId, args.studentId, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("unpublishClassTestExam", (t) =>
  t.field({
    type: UnpublishOutcomeRef,
    description: "CT-8: Office/Principal unpublishes ALL released results for a class test (→ draft). roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      return unpublishExam(args.testId, ctx.auth!.userId as string);
    },
  }),
);
