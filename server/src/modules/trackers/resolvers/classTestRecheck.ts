/**
 * CT-RC — unusual-mark recheck resolvers (docs/prd-ct-mark-recheck.md).
 *
 * RBAC composes EXISTING class-test actions (D-#94/#17 — no new permission):
 *   - read the flags (`classTestRecheck`) / the rules: class_test:view + read scope on the test;
 *   - the teacher's tick (`confirmClassTestRecheck`): class_test:enter_results + WRITE scope
 *     on the test — the same gate as entering the marks themselves;
 *   - the approver's hold / release / correct, the held list and changing the % rules:
 *     class_test:publish — the approvers (Principal/Office by default).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { getClassTest } from "../services/ClassTestService";
import {
  assertAnchorRead,
  assertAnchorWrite,
  CLASS_TEST_REACH,
  subjectIdOrNull,
} from "../classTestAnchor";
import {
  confirmRecheck,
  recheckRules,
  recheckView,
  saveRecheckRules,
  type RecheckClassView,
  type RecheckRowView,
  type RecheckRulesShape,
  type RecheckView,
} from "../services/ClassTestRecheckService";
import {
  correctHeld,
  heldResults,
  releaseHeld,
  setRecheckHold,
  type HeldResultShape,
} from "../services/ClassTestRecheckHoldService";
import { PublishResultOutcomeRef } from "./classTestResult";

async function assertReadTest(ctx: AppContext, testId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const test = await getClassTest(testId);
  if (!test) throw new ForbiddenError("Class test not found");
  await assertAnchorRead(ctx, test, CLASS_TEST_REACH);
}

async function assertWriteTest(ctx: AppContext, testId: string): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const test = await getClassTest(testId);
  if (!test) throw new ForbiddenError("Class test not found");
  await assertAnchorWrite(ctx, test, () => subjectIdOrNull(test.subject), "enter_classtest_result", CLASS_TEST_REACH);
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const RulesRef = builder.objectRef<RecheckRulesShape>("ClassTestRecheckRules").implement({
  description:
    "CT-RC thresholds, every one in PERCENTAGE POINTS of the test's total (a 20-mark test: 1 mark = 5%). " +
    "Read-time defaults until someone saves (isDefault).",
  fields: (t) => ({
    enabled: t.exposeBoolean("enabled"),
    highPct: t.exposeInt("highPct"),
    lowPct: t.exposeInt("lowPct"),
    fullMarksBelowPct: t.exposeInt("fullMarksBelowPct"),
    classHighPct: t.exposeInt("classHighPct"),
    minPriorTests: t.exposeInt("minPriorTests"),
    isDefault: t.exposeBoolean("isDefault"),
  }),
});

/** The flagged-mark fields, shared by a test's view and the held list (HeldResultShape
 *  extends RecheckRowView). Pothos' field-builder type is per-object, so it is taken loosely. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowFields = (t: any) => ({
  studentId: t.exposeString("studentId"),
  studentName: t.exposeString("studentName"),
  marks: t.float({ resolve: (r: RecheckRowView) => r.marks }),
  totalMarks: t.exposeInt("totalMarks"),
  percent: t.exposeFloat("percent"),
  averagePct: t.float({ nullable: true, resolve: (r: RecheckRowView) => r.averagePct }),
  basis: t.exposeString("basis", { description: "SUBJECT | ALL (fell back to every subject) | NONE (too little history)" }),
  priorCount: t.exposeInt("priorCount"),
  kinds: t.exposeStringList("kinds", { description: "HIGH | LOW | FULL" }),
  confirmed: t.exposeBoolean("confirmed", { description: "The teacher's tick, valid only for the current mark." }),
  confirmedAt: t.string({ nullable: true, resolve: (r: RecheckRowView) => r.confirmedAt }),
  confirmedByName: t.string({ nullable: true, resolve: (r: RecheckRowView) => r.confirmedByName }),
  note: t.string({ nullable: true, resolve: (r: RecheckRowView) => r.note }),
  classCovers: t.exposeBoolean("classCovers", { description: "R4 is up and this mark is only high/full — the class tick covers it." }),
  submitted: t.exposeBoolean("submitted"),
  published: t.exposeBoolean("published"),
  held: t.exposeBoolean("held"),
  heldAt: t.string({ nullable: true, resolve: (r: RecheckRowView) => r.heldAt }),
});

const RowRef = builder.objectRef<RecheckRowView>("ClassTestRecheckRow").implement({
  description: "One flagged (unusually high / low / full) class-test mark — derived on read, never stored.",
  fields: (t) => rowFields(t),
});

const ClassRef = builder.objectRef<RecheckClassView>("ClassTestRecheckClass").implement({
  description: "Rule R4: the whole class scored unusually high against its usual level in the subject.",
  fields: (t) => ({
    classPct: t.exposeFloat("classPct"),
    usualPct: t.exposeFloat("usualPct"),
    usualTests: t.exposeInt("usualTests"),
    confirmed: t.exposeBoolean("confirmed"),
    confirmedAt: t.string({ nullable: true, resolve: (c) => c.confirmedAt }),
    confirmedByName: t.string({ nullable: true, resolve: (c) => c.confirmedByName }),
    note: t.string({ nullable: true, resolve: (c) => c.note }),
  }),
});

const ViewRef = builder.objectRef<RecheckView>("ClassTestRecheck").implement({
  description: "CT-RC: the unusual marks on one class test + what still needs a tick.",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    rules: t.field({ type: RulesRef, resolve: (v) => v.rules }),
    rows: t.field({ type: [RowRef], resolve: (v) => v.rows }),
    classFlag: t.field({ type: ClassRef, nullable: true, resolve: (v) => v.classFlag }),
    unconfirmedCount: t.exposeInt("unconfirmedCount"),
    awaitingApprovalCount: t.exposeInt("awaitingApprovalCount"),
  }),
});

const HeldRef = builder.objectRef<HeldResultShape>("ClassTestHeldResult").implement({
  description: "CT-RC Option B: a result an approver held at approval to see the paper.",
  fields: (t) => ({
    ...rowFields(t),
    testId: t.exposeString("testId"),
    ctId: t.exposeString("ctId"),
    subject: t.exposeString("subject"),
    classLevel: t.int({ nullable: true, resolve: (h) => h.classLevel }),
    examDate: t.exposeString("examDate"),
  }),
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

builder.queryField("classTestRecheck", (t) =>
  t.field({
    type: ViewRef,
    description: "CT-RC: every unusual mark on a class test, the teacher's ticks and any holds. class_test:view.",
    authScopes: { hasPermission: "class_test:view" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      return recheckView(args.testId);
    },
  }),
);

builder.queryField("classTestRecheckRules", (t) =>
  t.field({
    type: RulesRef,
    description: "CT-RC: the unusual-mark % thresholds. class_test:view.",
    authScopes: { hasPermission: "class_test:view" },
    resolve: () => recheckRules(),
  }),
);

builder.queryField("classTestHeldResults", (t) =>
  t.field({
    type: [HeldRef],
    description: "CT-RC Option B: every held, still-unpublished result (the Principal's Today card). class_test:publish.",
    authScopes: { hasPermission: "class_test:publish" },
    resolve: () => heldResults(),
  }),
);

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

builder.mutationField("confirmClassTestRecheck", (t) =>
  t.field({
    type: ViewRef,
    description:
      "CT-RC: the teacher's \"I checked the script a second time and the mark is right\" — for one student, " +
      "or (no studentId) for the whole class under rule R4. confirmed:false removes it. Only before submit. " +
      "class_test:enter_results on the test.",
    authScopes: { hasPermission: "class_test:enter_results" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: false }),
      confirmed: t.arg.boolean({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      await assertWriteTest(ctx, args.testId);
      return confirmRecheck({
        testId: args.testId,
        studentId: args.studentId ?? null,
        confirmed: args.confirmed,
        note: args.note ?? null,
        actorId: ctx.auth!.userId as string,
      });
    },
  }),
);

builder.mutationField("holdClassTestResult", (t) =>
  t.field({
    type: ViewRef,
    description:
      "CT-RC Option B: hold (or un-hold) one submitted result so the approver can see the paper; the rest of " +
      "the class still publishes at Approve. class_test:publish.",
    authScopes: { hasPermission: "class_test:publish" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      hold: t.arg.boolean({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      await setRecheckHold(args.testId, args.studentId, args.hold, ctx.auth!.userId as string);
      return recheckView(args.testId);
    },
  }),
);

builder.mutationField("releaseHeldClassTestResult", (t) =>
  t.field({
    type: PublishResultOutcomeRef,
    description: "CT-RC Option B: the paper was seen and the mark stands — publish the held result. class_test:publish.",
    authScopes: { hasPermission: "class_test:publish" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      return releaseHeld(args.testId, args.studentId, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("correctHeldClassTestResult", (t) =>
  t.field({
    type: PublishResultOutcomeRef,
    description:
      "CT-RC Option B: the paper was seen and the mark was wrong — set the right mark and publish it. A changed " +
      "mark leaves a quiet note in the teacher's staff mistake record (tier 2). class_test:publish.",
    authScopes: { hasPermission: "class_test:publish" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      marks: t.arg.float({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertReadTest(ctx, args.testId);
      return correctHeld(args.testId, args.studentId, args.marks, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("saveClassTestRecheckRules", (t) =>
  t.field({
    type: RulesRef,
    description:
      "CT-RC: change the unusual-mark thresholds (whole numbers, percentage points). Omitted fields keep " +
      "their value. Audited. class_test:publish.",
    authScopes: { hasPermission: "class_test:publish" },
    args: {
      enabled: t.arg.boolean({ required: false }),
      highPct: t.arg.int({ required: false }),
      lowPct: t.arg.int({ required: false }),
      fullMarksBelowPct: t.arg.int({ required: false }),
      classHighPct: t.arg.int({ required: false }),
      minPriorTests: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return saveRecheckRules(
        {
          enabled: args.enabled ?? undefined,
          highPct: args.highPct ?? undefined,
          lowPct: args.lowPct ?? undefined,
          fullMarksBelowPct: args.fullMarksBelowPct ?? undefined,
          classHighPct: args.classHighPct ?? undefined,
          minPriorTests: args.minPriorTests ?? undefined,
        },
        ctx.auth.userId as string,
      );
    },
  }),
);
