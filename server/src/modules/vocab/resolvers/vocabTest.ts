/**
 * Vocab test + position + weekly-assignment resolvers (VC-2; prd-vocabulary-tracker
 * §3.3–§3.5/§5, D-#106/#127).
 *
 * RBAC (composes existing perms, NO new permission — D-#94/#106):
 *   - Weekly tester assignment (`assignVocabTester`, reads): `roster:manage`
 *     (Principal/Office — the admin gate).
 *   - Test build (create / update / lay positions): `tracker:write` + the OPERATOR
 *     gate — the caller must be the current assigned tester OR hold an active proxy
 *     grant on the section (§5); Principal is unscoped, Office/Guardian denied.
 *   - Reads (`vocabTest`/`vocabTests`/positions): `tracker:read`.
 *
 * Identity/operational plane; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  createVocabTest,
  updateVocabTest,
  setVocabTestPositions,
  getVocabTest,
  positionsForTest,
  listVocabTests,
  type DirectionSelection,
} from "../services/VocabTestService";
import {
  assignWeeklyTester,
  currentAssignment,
  assignmentsForTeacher,
  assignmentHistory,
} from "../services/VocabAssignmentService";
import { assertCanOperateVocab } from "../services/vocabGate";
import { resolveDefaultTestDate, weekStartFor } from "../services/vocabCalendar";
import type { IVocabTest } from "../models/VocabTest";
import type { IVocabTestPosition } from "../models/VocabTestPosition";
import type { IVocabTestAssignment } from "../models/VocabTestAssignment";

/** Parse an ISO date arg or throw a Bangla-free dev error. */
function parseDate(iso: string, label: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new ForbiddenError(`${label} is not a valid date`);
  return d;
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const VocabTestRef = builder.objectRef<IVocabTest>("VocabTest");
VocabTestRef.implement({
  description: "A program's vocab test for a section on a date (VC-2; §3.3).",
  fields: (t) => ({
    id: t.string({ resolve: (x) => x._id.toString() }),
    program: t.exposeString("program"),
    sectionId: t.string({ resolve: (x) => x.sectionId.toString() }),
    classLevel: t.exposeInt("classLevel"),
    testDate: t.string({ resolve: (x) => new Date(x.testDate).toISOString() }),
    weekOf: t.string({ resolve: (x) => new Date(x.weekOf).toISOString() }),
    label: t.exposeString("label"),
    totalMarks: t.exposeInt("totalMarks"),
    dictationHalfMissCounts: t.exposeBoolean("dictationHalfMissCounts"),
    status: t.exposeString("status"),
    createdBy: t.string({ resolve: (x) => x.createdBy.toString() }),
  }),
});

const VocabTestPositionRef = builder.objectRef<IVocabTestPosition>("VocabTestPosition");
VocabTestPositionRef.implement({
  description: "One (direction, qNumber) slot on a test pointing at a word (VC-2; §3.4).",
  fields: (t) => ({
    id: t.string({ resolve: (x) => x._id.toString() }),
    testId: t.string({ resolve: (x) => x.testId.toString() }),
    direction: t.exposeString("direction"),
    qNumber: t.exposeInt("qNumber"),
    wordId: t.string({ resolve: (x) => x.wordId.toString() }),
  }),
});

const VocabTestAssignmentRef = builder.objectRef<IVocabTestAssignment>("VocabTestAssignment");
VocabTestAssignmentRef.implement({
  description: "A weekly (section × program) tester assignment (VC-2; §3.5, append-only).",
  fields: (t) => ({
    id: t.string({ resolve: (x) => x._id.toString() }),
    sectionId: t.string({ resolve: (x) => x.sectionId.toString() }),
    program: t.exposeString("program"),
    weekOf: t.string({ resolve: (x) => new Date(x.weekOf).toISOString() }),
    assignedTeacherId: t.string({ resolve: (x) => x.assignedTeacherId.toString() }),
    assignedBy: t.string({ resolve: (x) => x.assignedBy.toString() }),
    source: t.exposeString("source"),
    proxyGrantId: t.string({ nullable: true, resolve: (x) => x.proxyGrantId?.toString() ?? null }),
    createdAt: t.string({ resolve: (x) => new Date(x.createdAt).toISOString() }),
  }),
});

// ---------------------------------------------------------------------------
// Mutations — build a test (tracker:write + operator gate)
// ---------------------------------------------------------------------------

builder.mutationField("createVocabTest", (t) =>
  t.field({
    type: VocabTestRef,
    description:
      "Create a vocab test (draft) for a (section × program). testDate defaults to the " +
      "Thursday of its week, holiday-rolled (D-#50); pass testDate to override. Requires " +
      "tracker:write + being the assigned/covering tester. Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      program: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      label: t.arg.string({ required: true }),
      totalMarks: t.arg.int({ required: true }),
      dictationHalfMissCounts: t.arg.boolean({ required: false }),
      testDate: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const testDate = args.testDate
        ? parseDate(args.testDate, "testDate")
        : await resolveDefaultTestDate(new Date());
      await assertCanOperateVocab(ctx, args.sectionId, args.program, weekStartFor(testDate));
      return createVocabTest({
        program: args.program,
        sectionId: args.sectionId,
        classLevel: args.classLevel,
        testDate,
        label: args.label,
        totalMarks: args.totalMarks,
        dictationHalfMissCounts: args.dictationHalfMissCounts ?? false,
        actorId: ctx.auth!.userId,
      });
    },
  }),
);

builder.mutationField("updateVocabTest", (t) =>
  t.field({
    type: VocabTestRef,
    description: "Edit a test's label/marks/half-miss/date (not once marked). tracker:write + operator gate. Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      testId: t.arg.string({ required: true }),
      label: t.arg.string({ required: false }),
      totalMarks: t.arg.int({ required: false }),
      dictationHalfMissCounts: t.arg.boolean({ required: false }),
      testDate: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const test = await getVocabTest(args.testId);
      if (!test) throw new ForbiddenError("Test not found");
      await assertCanOperateVocab(ctx, test.sectionId.toString(), test.program, test.weekOf);
      // VC-2 follow-up (coordinator): a testDate move into a DIFFERENT week must also
      // satisfy the operator gate for that target week — else a Week-1 tester could
      // reschedule a test into a week they don't operate.
      const newDate = args.testDate ? parseDate(args.testDate, "testDate") : undefined;
      if (newDate) {
        const newWeek = weekStartFor(newDate);
        if (newWeek.getTime() !== new Date(test.weekOf).getTime()) {
          await assertCanOperateVocab(ctx, test.sectionId.toString(), test.program, newWeek);
        }
      }
      return updateVocabTest({
        testId: args.testId,
        label: args.label ?? undefined,
        totalMarks: args.totalMarks ?? undefined,
        dictationHalfMissCounts: args.dictationHalfMissCounts ?? undefined,
        testDate: newDate,
        actorId: ctx.auth!.userId,
      });
    },
  }),
);

const PositionSelectionInput = builder.inputType("VocabPositionSelectionInput", {
  description: "Words selected for one direction; positions are laid 1..n in this order (§3.4).",
  fields: (t) => ({
    direction: t.string({ required: true }),
    wordIds: t.stringList({ required: true }),
  }),
});

builder.mutationField("setVocabTestPositions", (t) =>
  t.field({
    type: [VocabTestPositionRef],
    description:
      "Auto-lay a test's positions from selected words per direction (§3.4) — rebuilds " +
      "positions wholesale + flips the test to ready. tracker:write + operator gate. Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      testId: t.arg.string({ required: true }),
      selections: t.arg({ type: [PositionSelectionInput], required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const test = await getVocabTest(args.testId);
      if (!test) throw new ForbiddenError("Test not found");
      await assertCanOperateVocab(ctx, test.sectionId.toString(), test.program, test.weekOf);
      const selections: DirectionSelection[] = args.selections.map((s) => ({
        direction: s.direction,
        wordIds: s.wordIds,
      }));
      return setVocabTestPositions({ testId: args.testId, selections, actorId: ctx.auth!.userId });
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutation — weekly tester assignment (roster:manage)
// ---------------------------------------------------------------------------

builder.mutationField("assignVocabTester", (t) =>
  t.field({
    type: VocabTestAssignmentRef,
    description:
      "Assign the weekly tester for a (section × program) — append-only (§3.5, D-#106). " +
      "weekOf is any date inside the target week. Requires roster:manage (Principal/Office). Audited.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      sectionId: t.arg.string({ required: true }),
      program: t.arg.string({ required: true }),
      weekOf: t.arg.string({ required: true }),
      teacherId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) =>
      assignWeeklyTester({
        sectionId: args.sectionId,
        program: args.program,
        weekOf: parseDate(args.weekOf, "weekOf"),
        teacherId: args.teacherId,
        actorId: ctx.auth!.userId,
      }),
  }),
);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("vocabTest", (t) =>
  t.field({
    type: VocabTestRef,
    nullable: true,
    description: "One vocab test by id (VC-2). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => getVocabTest(args.testId) as unknown as Promise<IVocabTest | null>,
  }),
);

builder.queryField("vocabTestPositions", (t) =>
  t.field({
    type: [VocabTestPositionRef],
    description: "A test's laid-out positions, ordered by direction + qNumber (VC-2). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => positionsForTest(args.testId) as unknown as Promise<IVocabTestPosition[]>,
  }),
);

builder.queryField("vocabTests", (t) =>
  t.field({
    type: [VocabTestRef],
    description: "Vocab tests filtered by section / program / week (VC-2). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: false }),
      program: t.arg.string({ required: false }),
      weekOf: t.arg.string({ required: false }),
    },
    resolve: async (_root, args) =>
      listVocabTests({
        sectionId: args.sectionId ?? undefined,
        program: args.program ?? undefined,
        weekOf: args.weekOf ? parseDate(args.weekOf, "weekOf") : undefined,
      }) as unknown as Promise<IVocabTest[]>,
  }),
);

builder.queryField("vocabTesterAssignment", (t) =>
  t.field({
    type: VocabTestAssignmentRef,
    nullable: true,
    description: "The CURRENT weekly tester assignment for a (section × program × week) (VC-2). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      program: t.arg.string({ required: true }),
      weekOf: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) =>
      currentAssignment(args.sectionId, args.program, parseDate(args.weekOf, "weekOf")) as unknown as Promise<IVocabTestAssignment | null>,
  }),
);

builder.queryField("vocabAssignmentHistory", (t) =>
  t.field({
    type: [VocabTestAssignmentRef],
    description: "The append-only assignment history for a (section × program), newest first (VC-2). Requires roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      sectionId: t.arg.string({ required: true }),
      program: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) =>
      assignmentHistory(args.sectionId, args.program) as unknown as Promise<IVocabTestAssignment[]>,
  }),
);

builder.queryField("myVocabAssignments", (t) =>
  t.field({
    type: [VocabTestAssignmentRef],
    description: "The caller's own weekly tester assignments from a week onward (own-row, VC-2). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: { fromWeek: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return assignmentsForTeacher(
        ctx.auth.userId,
        args.fromWeek ? parseDate(args.fromWeek, "fromWeek") : undefined,
      ) as unknown as Promise<IVocabTestAssignment[]>;
    },
  }),
);
