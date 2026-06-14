/**
 * Guardian child-class-test rider (CT-3; prd-tracker-class-test §6/J7, D-#68/#160).
 *
 * ONE read query: a linked guardian sees their child's PUBLISHED class-test results,
 * read-only. RBAC: `guardian:read_child` (GUARDIAN-only, default-deny) + row-scope
 * `assertGuardianOfStudent` (active GuardianLink, D-#68). The shape carries the derived
 * score + the parent-facing fields ONLY — `teacherAction` is structurally ABSENT, so
 * the internal note can never reach a guardian (J7). Guardians get NO class-test
 * mutation. Identity-plane; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import { childTestResults, type GuardianClassTestResult } from "../services/ClassTestResultService";

const GuardianClassTestResultRef = builder.objectRef<GuardianClassTestResult>("GuardianClassTestResult");
GuardianClassTestResultRef.implement({
  description:
    "A child's PUBLISHED class-test result as the guardian portal shows it — read-only (CT-3, J7). " +
    "Carries subject/exam#/marks/total/%/pass-fail/weakness/guardianAction; NEVER teacherAction (D-#68).",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    ctId: t.exposeString("ctId"),
    subject: t.exposeString("subject"),
    testNumber: t.exposeInt("testNumber"),
    examDate: t.exposeString("examDate"),
    classLevel: t.exposeInt("classLevel"),
    status: t.exposeString("status"),
    marks: t.int({ nullable: true, resolve: (r) => r.marks }),
    totalMarks: t.exposeInt("totalMarks"),
    percent: t.float({ nullable: true, resolve: (r) => r.percent }),
    pass: t.boolean({ nullable: true, resolve: (r) => r.pass }),
    weakness: t.string({ nullable: true, resolve: (r) => r.weakness }),
    guardianAction: t.string({ nullable: true, resolve: (r) => r.guardianAction }),
    publishedAt: t.string({ nullable: true, resolve: (r) => r.publishedAt }),
  }),
});

builder.queryField("childTestResults", (t) =>
  t.field({
    type: [GuardianClassTestResultRef],
    description:
      "The linked child's PUBLISHED class-test results — read-only (CT-3, J7). Gated by the guardian-link " +
      "row scope (D-#68). Unpublished results are excluded; teacherAction is never exposed. No mutations exist for guardians.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childTestResults(args.studentId);
    },
  }),
);
