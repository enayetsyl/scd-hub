/**
 * Vocab result (mistake-capture + derived score) resolvers (VC-3; prd-vocabulary-
 * tracker §3.6/§4/§6, D-#142).
 *
 * RBAC (composes existing perms — D-#94/#106/#127, no new permission):
 *   - Mark (`submitVocabStudentResult`): `tracker:write` + the OPERATOR gate
 *     (assigned/covering tester on the test's section, §5).
 *   - Reads (`vocabStudentResult` / `vocabTestResults`): `tracker:read`.
 *
 * Identity-plane (names studentIds); NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  submitStudentResult,
  studentResult,
  testResults,
  type DerivedStudentResult,
  type WrongWord,
  type MistakeInput,
} from "../services/VocabResultService";
import { getVocabTest } from "../services/VocabTestService";
import { assertCanOperateVocab } from "../services/vocabGate";

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const WrongWordRef = builder.objectRef<WrongWord>("VocabWrongWord");
WrongWordRef.implement({
  description: "A word a student got wrong on a test, by direction (VC-3; feeds reports + guardian messages).",
  fields: (t) => ({
    positionId: t.exposeString("positionId"),
    direction: t.exposeString("direction"),
    headword: t.exposeString("headword"),
    banglaMeaning: t.exposeString("banglaMeaning"),
    wrongFields: t.exposeIntList("wrongFields"),
  }),
});

const DerivedStudentResultRef = builder.objectRef<DerivedStudentResult>("VocabStudentResult");
DerivedStudentResultRef.implement({
  description: "A student's DERIVED result on a vocab test (VC-3; §3.6 — score/counts never stored, D-#85).",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    studentId: t.exposeString("studentId"),
    status: t.exposeString("status"),
    score: t.int({ nullable: true, resolve: (r) => r.score }),
    totalMarks: t.exposeInt("totalMarks"),
    marksLost: t.int({ nullable: true, resolve: (r) => r.marksLost }),
    wrongCount: t.int({ nullable: true, resolve: (r) => r.wrongCount }),
    wrongWords: t.field({ type: [WrongWordRef], resolve: (r) => r.wrongWords }),
  }),
});

const MistakeInputType = builder.inputType("VocabMistakeInput", {
  description: "One position marked wrong: the position id + the 1-based wrong-field indices (§4).",
  fields: (t) => ({
    positionId: t.string({ required: true }),
    wrongFields: t.intList({ required: true }),
  }),
});

// ---------------------------------------------------------------------------
// Mutation — record a student's marks (tracker:write + operator gate)
// ---------------------------------------------------------------------------

builder.mutationField("submitVocabStudentResult", (t) =>
  t.field({
    type: DerivedStudentResultRef,
    description:
      "Record a student's result for a test (wholesale, §3.6): set PRESENT/ABSENT + replace their " +
      "per-position mistakes. ABSENT clears marks + is excluded from scoring (§4). Flips the test to " +
      "marked. Requires tracker:write + being the assigned/covering tester. Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      status: t.arg.string({ required: true }),
      mistakes: t.arg({ type: [MistakeInputType], required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const test = await getVocabTest(args.testId);
      if (!test) throw new ForbiddenError("Test not found");
      await assertCanOperateVocab(ctx, test.sectionId.toString(), test.program, test.weekOf);
      const mistakes: MistakeInput[] = (args.mistakes ?? []).map((m) => ({
        positionId: m.positionId,
        wrongFields: m.wrongFields,
      }));
      await submitStudentResult({
        testId: args.testId,
        studentId: args.studentId,
        status: args.status,
        mistakes,
        actorId: ctx.auth!.userId,
      });
      const derived = await studentResult(args.testId, args.studentId);
      if (!derived) throw new ForbiddenError("Result not found after recording");
      return derived;
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries (tracker:read)
// ---------------------------------------------------------------------------

builder.queryField("vocabStudentResult", (t) =>
  t.field({
    type: DerivedStudentResultRef,
    nullable: true,
    description: "A student's derived result on a test (VC-3). Null if not yet recorded. Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) => studentResult(args.testId, args.studentId),
  }),
);

builder.queryField("vocabTestResults", (t) =>
  t.field({
    type: [DerivedStudentResultRef],
    description: "The derived results for every recorded student on a test (VC-3 per-test report). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => testResults(args.testId),
  }),
);
