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
import {
  childTestResults,
  childTestResultsPage,
  type GuardianClassTestResult,
} from "../services/ClassTestResultService";
import { pageRef } from "../../../pageRef";
import { childScriptInfo, type GuardianScriptInfo } from "../services/ClassTestScriptService";

/** CS-3 (D-#716): the child's scanned script rides on the result row — pages only
 *  once the Office published them, `scriptPending` while they are being scanned. */
type GuardianResultWithScript = GuardianClassTestResult & { script: GuardianScriptInfo };

const GuardianScriptPageRef = builder
  .objectRef<{ fileId: string; mime: string }>("GuardianScriptPage")
  .implement({
    description: "One scanned page of the child's class-test script (opened via GET /files/:id).",
    fields: (t) => ({
      fileId: t.exposeString("fileId"),
      mime: t.exposeString("mime"),
    }),
  });

const GuardianClassTestResultRef = builder.objectRef<GuardianResultWithScript>("GuardianClassTestResult");
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
    // D-#507: null on a group-anchored exam. It MUST be declared nullable — an
    // exposeInt over a null value fails the field at request time, which would take
    // the parent's whole result list down rather than one label.
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    /** The Arabic group's name, when the exam was a group exam (D-#507) — a parent
     *  should read "আরবি বই ২" and not their child's class. */
    groupNameBn: t.string({ nullable: true, resolve: (r) => r.groupNameBn }),
    status: t.exposeString("status"),
    marks: t.int({ nullable: true, resolve: (r) => r.marks }),
    totalMarks: t.exposeInt("totalMarks"),
    percent: t.float({ nullable: true, resolve: (r) => r.percent }),
    pass: t.boolean({ nullable: true, resolve: (r) => r.pass }),
    weakness: t.string({ nullable: true, resolve: (r) => r.weakness }),
    guardianAction: t.string({ nullable: true, resolve: (r) => r.guardianAction }),
    publishedAt: t.string({ nullable: true, resolve: (r) => r.publishedAt }),
    scriptPages: t.field({
      type: [GuardianScriptPageRef],
      description: "The child's scanned script pages — empty until the Office publishes the scripts (D-#716).",
      resolve: (r) => r.script.pages,
    }),
    scriptPending: t.boolean({
      description: "The paper is at the office being scanned — not yet published (CS-3).",
      resolve: (r) => r.script.pending,
    }),
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
      const rows = await childTestResults(args.studentId);
      const info = await childScriptInfo(args.studentId, rows.map((r) => r.testId));
      return rows.map((r) => ({ ...r, script: info.get(r.testId) ?? { pages: [], pending: false } }));
    },
  }),
);

// D-#761: the Class Test tab pages its result list. The tab's summary (average, best /
// weakest subject, NEW count) still covers EVERY result, so it reads the light
// childTestResultStats rows below instead of the full list.
const GuardianClassTestResultPageRef = pageRef("GuardianClassTestResultPage", GuardianClassTestResultRef);

builder.queryField("childTestResultsPage", (t) =>
  t.field({
    type: GuardianClassTestResultPageRef,
    description:
      "One page of the linked child's PUBLISHED class-test results, newest exam first (D-#761), " +
      "optionally one subject. Same gate and shape as childTestResults; script info is read for the page only.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: false }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      const p = await childTestResultsPage(args.studentId, args.subject, args);
      const info = await childScriptInfo(args.studentId, p.rows.map((r) => r.testId));
      return { ...p, rows: p.rows.map((r) => ({ ...r, script: info.get(r.testId) ?? { pages: [], pending: false } })) };
    },
  }),
);

type GuardianClassTestStat = Pick<GuardianClassTestResult, "testId" | "subject" | "status" | "percent" | "publishedAt">;

const GuardianClassTestStatRef = builder.objectRef<GuardianClassTestStat>("GuardianClassTestStat").implement({
  description:
    "The few fields of a published result the guardian summary needs (D-#761) — subject, status, " +
    "percent, publishedAt. No marks text, weakness, action or script.",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    subject: t.exposeString("subject"),
    status: t.exposeString("status"),
    percent: t.float({ nullable: true, resolve: (r) => r.percent }),
    publishedAt: t.string({ nullable: true, resolve: (r) => r.publishedAt }),
  }),
});

builder.queryField("childTestResultStats", (t) =>
  t.field({
    type: [GuardianClassTestStatRef],
    description:
      "Every PUBLISHED result of the linked child, newest exam first, as light summary rows (D-#761): " +
      "the Class Test tab's figures and subject chips, and the Today 'new result' count. Same gate as childTestResults.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      const rows = await childTestResults(args.studentId);
      return rows.map((r) => ({
        testId: r.testId,
        subject: r.subject,
        status: r.status,
        percent: r.percent,
        publishedAt: r.publishedAt,
      }));
    },
  }),
);
