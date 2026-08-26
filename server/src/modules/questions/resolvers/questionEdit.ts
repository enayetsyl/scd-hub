/**
 * Question correction resolvers (QR-8, D-#548).
 *
 *   updateQuestionContent — fix what a question says or what its answer is.
 *   retireQuestion        — soft delete; hidden from bank/picker/assembly, sets still resolve.
 *   restoreQuestion       — undo a retirement.
 *
 * All three require `question:manage` (Principal + Office). A TEACHER — reviewer included —
 * never edits directly: they raise a verdict, and the desk acts on it. That is the whole
 * shape of the review loop, and letting a reviewer edit would quietly bypass it.
 *
 * Every mutation writes an audit row naming the actor, the question, and exactly which
 * fields moved with their before and after values.
 */
import { GraphQLError } from "graphql";
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { ReviewError } from "../../content/services/ReviewService";
import {
  updateQuestionContent as updateSvc,
  retireQuestion as retireSvc,
  restoreQuestion as restoreSvc,
  type QuestionEditResult,
} from "../services/QuestionEditService";

const QuestionEditResultRef = builder.objectRef<QuestionEditResult>("QuestionEditResult");
QuestionEditResultRef.implement({
  description:
    "Outcome of a question correction (D-#548). `changedFields` is empty when the save was a " +
    "no-op — nothing was written and nothing was logged.",
  fields: (t) => ({
    artifactId: t.exposeString("artifactId"),
    qid: t.string({ nullable: true, resolve: (r) => r.qid }),
    changedFields: t.exposeStringList("changedFields"),
    /** True when the edited question was already on the published shelf. */
    wasPublished: t.exposeBoolean("wasPublished"),
    retiredAt: t.string({ nullable: true, resolve: (r) => r.retiredAt }),
  }),
});

const QuestionOptionInputRef = builder.inputType("QuestionOptionInput", {
  fields: (t) => ({
    optionId: t.string({ required: false }),
    text: t.string({ required: true }),
    isCorrect: t.boolean({ required: true }),
  }),
});

const QuestionBlankInputRef = builder.inputType("QuestionBlankInput", {
  fields: (t) => ({
    blankNo: t.int({ required: true }),
    accepted: t.stringList({ required: true }),
  }),
});

function mapEditError(err: unknown): never {
  if (err instanceof ReviewError) {
    if (err.message.startsWith("FORBIDDEN")) throw new ForbiddenError(err.message);
    throw new GraphQLError(err.message);
  }
  throw err;
}

builder.mutationField("updateQuestionContent", (t) =>
  t.field({
    type: QuestionEditResultRef,
    description:
      "Correct a question's CONTENT or ANSWER in place (D-#548). Any field left out is " +
      "untouched. Subject, class, chapter and question_type are deliberately NOT editable — " +
      "they are the question's address and carrier shape, and moving them would strand open " +
      "review rounds and change what an assembled set contains. A PUBLISHED question may be " +
      "corrected; the audit row records that it was. Requires question:manage.",
    authScopes: { hasPermission: "question:manage" },
    args: {
      artifactId: t.arg.string({ required: true }),
      questionText: t.arg.string({ required: false }),
      marks: t.arg.float({ required: false }),
      options: t.arg({ type: [QuestionOptionInputRef], required: false }),
      tfAnswer: t.arg.boolean({ required: false }),
      blanks: t.arg({ type: [QuestionBlankInputRef], required: false }),
      answerAccepted: t.arg.stringList({ required: false }),
      modelNote: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await updateSvc({
          artifactId: args.artifactId,
          patch: {
            questionText: args.questionText,
            marks: args.marks,
            options: args.options?.map((o) => ({
              optionId: o.optionId ?? null,
              text: o.text,
              isCorrect: o.isCorrect,
            })),
            tfAnswer: args.tfAnswer,
            blanks: args.blanks?.map((b) => ({ blankNo: b.blankNo, accepted: b.accepted })),
            answerAccepted: args.answerAccepted,
            modelNote: args.modelNote,
          },
          actorId: ctx.auth.userId,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapEditError(err);
      }
    },
  }),
);

builder.mutationField("retireQuestion", (t) =>
  t.field({
    type: QuestionEditResultRef,
    description:
      "Retire a question (D-#548): a SOFT delete. It leaves the bank, the assign picker and " +
      "set assembly, and any open review round on it is closed — but the document stays, so " +
      "an AssessmentSet that already references it keeps resolving. A hard delete would " +
      "orphan every set the question was assembled into. Reversible via restoreQuestion. " +
      "Requires question:manage.",
    authScopes: { hasPermission: "question:manage" },
    args: {
      artifactId: t.arg.string({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await retireSvc({
          artifactId: args.artifactId,
          reason: args.reason,
          actorId: ctx.auth.userId,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapEditError(err);
      }
    },
  }),
);

builder.mutationField("restoreQuestion", (t) =>
  t.field({
    type: QuestionEditResultRef,
    description:
      "Undo a retirement — the question returns to the bank. Find retired questions with " +
      "questions(retired: true). Requires question:manage.",
    authScopes: { hasPermission: "question:manage" },
    args: {
      artifactId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await restoreSvc({
          artifactId: args.artifactId,
          actorId: ctx.auth.userId,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapEditError(err);
      }
    },
  }),
);
