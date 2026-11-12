/**
 * Guardian question hints (GH-1, docs/prd-guardian-help.md §2, D-#1520/#1521).
 *
 *   importQuestionHints   — question_hint:import; dry run (apply=false) or load a hint file's JSON
 *   childAssignedQuestions — guardian:read_child + the guardian link; the bank questions assigned to
 *                           the child (text only — no answer field exists on these types)
 *   openQuestionHint      — guardian:read_child + the guardian link; step N only after step N-1
 */
import { builder } from "../../../schema";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import { importQuestionHints, type HintEntryProblem, type HintImportReport } from "../services/QuestionHintService";
import {
  childAssignedQuestions,
  openQuestionHint,
  type AssignedQuestionView,
  type HintStepText,
  type OpenedHint,
} from "../services/GuardianHintService";

// -- the loader --------------------------------------------------------------

const ProblemRef = builder.objectRef<HintEntryProblem>("QuestionHintProblem");
ProblemRef.implement({ fields: (t) => ({ qid: t.exposeString("qid"), message: t.exposeString("message") }) });

const ReportRef = builder.objectRef<HintImportReport>("QuestionHintImportReport");
ReportRef.implement({
  fields: (t) => ({
    ok: t.exposeBoolean("ok"),
    dryRun: t.exposeBoolean("dryRun"),
    total: t.exposeInt("total"),
    created: t.exposeInt("created"),
    updated: t.exposeInt("updated"),
    unchanged: t.exposeInt("unchanged"),
    refused: t.exposeInt("refused"),
    problems: t.field({ type: [ProblemRef], resolve: (r) => r.problems }),
    warnings: t.field({ type: [ProblemRef], resolve: (r) => r.warnings }),
    fileError: t.string({ nullable: true, resolve: (r) => r.fileError }),
  }),
});

builder.mutationField("importQuestionHints", (t) =>
  t.field({
    type: ReportRef,
    description:
      "Dry run (apply=false) or load a hint file `{ hints: [{ qid, steps: [3] }] }`. An entry is refused when its qid has " +
      "no current bank question, it has not exactly 3 non-empty steps, or a step contains the item's answer; the rest load.",
    authScopes: { hasPermission: "question_hint:import" },
    args: { hintsJson: t.arg.string({ required: true }), apply: t.arg.boolean({ required: true }) },
    resolve: async (_r, args, ctx) => {
      if (!ctx.auth) throw new Error("লগইন প্রয়োজন।");
      return importQuestionHints(args.hintsJson, { userId: ctx.auth.userId, role: ctx.auth.role }, { dryRun: !args.apply });
    },
  }),
);

// -- the guardian plane -----------------------------------------------------

const StepRef = builder.objectRef<HintStepText>("ChildHintStep");
StepRef.implement({ fields: (t) => ({ step: t.exposeInt("step"), textBn: t.exposeString("textBn") }) });

const AssignedRef = builder.objectRef<AssignedQuestionView>("ChildAssignedQuestion");
AssignedRef.implement({
  description: "A bank question assigned to the child, as the guardian may see it: the question text and the hint ladder state. No answer, no options.",
  fields: (t) => ({
    qid: t.exposeString("qid"),
    textBn: t.exposeString("textBn"),
    source: t.exposeString("source"),
    subject: t.exposeString("subject"),
    date: t.exposeString("date"),
    hintCount: t.exposeInt("hintCount"),
    opened: t.field({ type: [StepRef], resolve: (q) => q.opened }),
  }),
});

builder.queryField("childAssignedQuestions", (t) =>
  t.field({
    type: [AssignedRef],
    description:
      "The bank questions assigned to the linked child (assignment sheets, extra homework, homework), newest first, with the " +
      "hint ladder state. Link-gated (assertGuardianOfStudent).",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return childAssignedQuestions(ctx.auth!.userId, args.studentId);
    },
  }),
);

const OpenedRef = builder.objectRef<OpenedHint>("OpenedQuestionHint");
OpenedRef.implement({
  fields: (t) => ({
    qid: t.exposeString("qid"),
    step: t.exposeInt("step"),
    textBn: t.exposeString("textBn"),
    hasNext: t.exposeBoolean("hasNext"),
  }),
});

builder.mutationField("openQuestionHint", (t) =>
  t.field({
    type: OpenedRef,
    description:
      "Open hint step N of a question assigned to the linked child. Step N needs steps 1..N-1 opened by this guardian for this " +
      "child. Writes one HintView per step per Dhaka day. Link-gated (assertGuardianOfStudent).",
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      studentId: t.arg.string({ required: true }),
      qid: t.arg.string({ required: true }),
      step: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      return openQuestionHint(ctx.auth!.userId, args.studentId, args.qid, args.step);
    },
  }),
);
