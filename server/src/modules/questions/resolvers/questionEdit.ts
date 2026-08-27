/**
 * Question correction resolvers (QR-8, D-#548).
 *
 *   updateQuestionContent — fix what a question says or what its answer is.
 *   retireQuestion        — soft delete; hidden from bank/picker/assembly, sets still resolve.
 *   restoreQuestion       — undo a retirement.
 *   setQuestionImportant  — raise or lower the IMPORTANT mark (QR-9, D-#550).
 *
 * The first three require `question:manage` (Principal + Office). A TEACHER — reviewer included —
 * never edits directly: they raise a verdict, and the desk acts on it. That is the whole
 * shape of the review loop, and letting a reviewer edit would quietly bypass it.
 *
 * `setQuestionImportant` is the ONE exception, and only in a confined way: a reviewer may
 * mark a question she currently holds an open round for. Marking says “look at this”; it
 * changes no content, no answer and no status, so it cannot bypass a verdict.
 *
 * Every mutation writes an audit row naming the actor, the question, and exactly which
 * fields moved with their before and after values.
 */
import { callerHasPermission } from "@scd/shared";
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { expectedGraphQLError } from "../../../observability/sentry";
import { ReviewError } from "../../content/services/ReviewService";
import {
  updateQuestionContent as updateSvc,
  retireQuestion as retireSvc,
  restoreQuestion as restoreSvc,
  setQuestionImportant as setImportantSvc,
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
    /** The IMPORTANT mark AFTER the call (QR-9, D-#550). */
    important: t.exposeBoolean("important"),
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
    throw expectedGraphQLError(err.message);
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

builder.mutationField("setQuestionImportant", (t) =>
  t.field({
    type: QuestionEditResultRef,
    description:
      "Raise or lower the IMPORTANT mark on a question (QR-9, D-#550). Normal is the usual " +
      "state; the mark is visible to EVERYONE who can see the question, teachers included, " +
      "and is separately filterable via questions(important: true). Principal and Office may " +
      "mark any question at any time (question:manage); a reviewer (content:review) may mark " +
      "only a question in her own open review queue. Setting the state it already holds " +
      "writes nothing.",
    // Either gate opens this door, so the scope check lives in the service where it can be
    // executed against a real round rather than asserted about a permission string.
    authScopes: { hasAnyPermission: ["question:manage", "content:review"] },
    args: {
      artifactId: t.arg.string({ required: true }),
      important: t.arg.boolean({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await setImportantSvc({
          artifactId: args.artifactId,
          important: args.important,
          actorId: ctx.auth.userId,
          actorRole: ctx.auth.role,
          mayManage: callerHasPermission(ctx.auth, "question:manage"),
        });
      } catch (err) {
        return mapEditError(err);
      }
    },
  }),
);
