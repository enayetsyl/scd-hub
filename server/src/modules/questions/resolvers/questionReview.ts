/**
 * Question review & publish resolvers (QR-2; D-#508).
 *
 * Mutations:
 *   assignQuestionReview / assignQuestionReviewBulk — content:assign_review (Principal/Office)
 *   submitQuestionReview — content:review (the ASSIGNED reviewer only). Reason optional.
 *   publishQuestion / publishQuestionBulk — content:promote_gold (Principal-locked)
 *
 * Queries:
 *   myQuestionReviews    — content:review. The caller's question queue.
 *   questionReviewInbox  — content:assign_review. Submitted rounds, filterable by verdict:
 *                          APPROVE = the publish queue, CHANGES_REQUESTED = the rejected list.
 *   questionReviewThread — round history for one question.
 *   assignableQuestions  — content:assign_review. The picker.
 *
 * Permissions are the SAME ones the plan loop uses — D-#508 adds none.
 */
import { GraphQLError } from "graphql";
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { isAdminStaff } from "../../foundation/services/RoleScope";
import { ReviewError } from "../../content/services/ReviewService";
import {
  assignQuestionReviewOne as assignSvc,
  assignQuestionReviewBulk as assignBulkSvc,
  assignQuestionReviewByChapter as assignByChapterSvc,
  clearQuestionCondition as clearConditionSvc,
  submitQuestionReview as submitSvc,
  submitQuestionReviewBulk as submitBulkSvc,
  publishQuestion as publishSvc,
  publishQuestionBulk as publishBulkSvc,
  listMyQuestionReviews,
  countMyQuestionReviews,
  questionReviewInbox as inboxSvc,
  questionReviewThread as threadSvc,
  listAssignableQuestions,
  type QuestionReviewRoundDTO,
  type AssignableQuestionDTO,
  type PublishQuestionResult,
  type BulkResult,
} from "../services/QuestionReviewService";

// ---------------------------------------------------------------------------
// Object shapes
// ---------------------------------------------------------------------------

const QuestionReviewRoundRef = builder.objectRef<QuestionReviewRoundDTO>("QuestionReviewRound");
QuestionReviewRoundRef.implement({
  description:
    "One question-review round plus enough of its question to decide in place (D-#508). " +
    "Identity-plane; behind the ADR-005 firewall.",
  fields: (t) => ({
    id: t.exposeString("id"),
    artifactId: t.exposeString("artifactId"),
    qid: t.string({ nullable: true, resolve: (r) => r.qid }),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    anchorWord: t.exposeString("anchorWord"),
    addressNumber: t.exposeString("addressNumber"),
    reviewerId: t.exposeString("reviewerId"),
    reviewerName: t.string({ nullable: true, resolve: (r) => r.reviewerName }),
    assignedBy: t.exposeString("assignedBy"),
    assignedAt: t.exposeString("assignedAt"),
    roundNumber: t.exposeInt("roundNumber"),
    status: t.exposeString("status"),
    verdict: t.string({ nullable: true, resolve: (r) => r.verdict }),
    /** The reviewer's rejection reason — OPTIONAL for questions (Q2.4), so often null. */
    reason: t.string({ nullable: true, resolve: (r) => r.feedback }),
    submittedAt: t.string({ nullable: true, resolve: (r) => r.submittedAt }),
    questionText: t.string({ nullable: true, resolve: (r) => r.questionText }),
    questionType: t.string({ nullable: true, resolve: (r) => r.questionType }),
    marks: t.float({ nullable: true, resolve: (r) => r.marks }),
    topicTag: t.string({ nullable: true, resolve: (r) => r.topicTag }),
    payloadJson: t.string({ nullable: true, resolve: (r) => r.payloadJson }),
    artifactReviewStatus: t.string({ nullable: true, resolve: (r) => r.artifactReviewStatus }),
    artifactSuperseded: t.exposeBoolean("artifactSuperseded"),
  }),
});

const AssignableQuestionRef = builder.objectRef<AssignableQuestionDTO>("AssignableQuestion");
AssignableQuestionRef.implement({
  fields: (t) => ({
    artifactId: t.exposeString("artifactId"),
    qid: t.string({ nullable: true, resolve: (r) => r.qid }),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    anchorWord: t.exposeString("anchorWord"),
    addressNumber: t.exposeString("addressNumber"),
    questionText: t.string({ nullable: true, resolve: (r) => r.questionText }),
    questionType: t.string({ nullable: true, resolve: (r) => r.questionType }),
    marks: t.float({ nullable: true, resolve: (r) => r.marks }),
    topicTag: t.string({ nullable: true, resolve: (r) => r.topicTag }),
    reviewStatus: t.exposeString("reviewStatus"),
    currentReviewerId: t.string({ nullable: true, resolve: (r) => r.currentReviewerId }),
    currentReviewerName: t.string({ nullable: true, resolve: (r) => r.currentReviewerName }),
    currentAssignmentId: t.string({ nullable: true, resolve: (r) => r.currentAssignmentId }),
    roundStatus: t.string({ nullable: true, resolve: (r) => r.roundStatus }),
  }),
});

const PublishQuestionResultRef = builder.objectRef<PublishQuestionResult>("PublishQuestionResult");
PublishQuestionResultRef.implement({
  fields: (t) => ({
    artifactId: t.exposeString("artifactId"),
    reviewStatus: t.exposeString("reviewStatus"),
    override: t.exposeBoolean("override"),
  }),
});

const QuestionBulkResultRef = builder.objectRef<BulkResult>("QuestionBulkResult");
QuestionBulkResultRef.implement({
  fields: (t) => ({
    okCount: t.exposeInt("okCount"),
    failedCount: t.exposeInt("failedCount"),
    failures: t.field({
      type: ["String"],
      resolve: (r) => r.failures.map((f) => `${f.artifactId}: ${f.error}`),
    }),
  }),
});

/** ReviewError → a client-facing error whose message survives Yoga's masking. */
function mapReviewError(err: unknown): never {
  if (err instanceof ReviewError) {
    if (err.message.startsWith("FORBIDDEN")) throw new ForbiddenError(err.message);
    const closed = /not open for submission/i.test(err.message);
    throw new GraphQLError(
      closed
        ? "This review round is closed — the question was published or a newer version was imported."
        : err.message,
    );
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("assignQuestionReview", (t) =>
  t.field({
    type: QuestionReviewRoundRef,
    description:
      "Assign ONE question to a teacher reviewer. The round is anchored on the question's qid, " +
      "so questions sharing a unit address stay independent. Requires content:assign_review.",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      artifactId: t.arg.string({ required: true }),
      reviewerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await assignSvc({
          artifactId: args.artifactId,
          reviewerId: args.reviewerId,
          assignedBy: ctx.auth.userId,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

builder.mutationField("assignQuestionReviewBulk", (t) =>
  t.field({
    type: QuestionBulkResultRef,
    description:
      "Assign MANY questions to ONE reviewer in a single call — the normal path (Q2.1). " +
      "Per-question failures are collected, not fatal. Requires content:assign_review.",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      artifactIds: t.arg.stringList({ required: true }),
      reviewerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return assignBulkSvc({
        artifactIds: args.artifactIds,
        reviewerId: args.reviewerId,
        assignedBy: ctx.auth.userId,
        actorRole: ctx.auth.role,
      });
    },
  }),
);

const ChapterAssignResultRef = builder
  .objectRef<{
    assigned: number;
    skippedPublished: number;
    skippedReviewed: number;
    skippedOpenRound: number;
    total: number;
  }>("QuestionChapterAssignResult");
ChapterAssignResultRef.implement({
  description:
    "Outcome of assigning whole chapters to one reviewer (D-#525). Every skip is counted " +
    "and reasoned — a bare 'n assigned' out of a 240-question chapter reads as a bug.",
  fields: (t) => ({
    assigned: t.exposeInt("assigned"),
    skippedPublished: t.exposeInt("skippedPublished"),
    skippedReviewed: t.exposeInt("skippedReviewed"),
    skippedOpenRound: t.exposeInt("skippedOpenRound"),
    total: t.exposeInt("total"),
  }),
});

builder.mutationField("assignQuestionReviewByChapter", (t) =>
  t.field({
    type: ChapterAssignResultRef,
    description:
      "Assign every eligible question of one or more CHAPTERS to a single reviewer in one " +
      "action (D-#525). Already-published, already-reviewed and in-flight questions are " +
      "SKIPPED, never reassigned, and each skip is reported. Requires content:assign_review.",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      subject: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      chapters: t.arg.intList({ required: true }),
      reviewerId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await assignByChapterSvc({
          subject: args.subject,
          classLevel: args.classLevel,
          chapters: args.chapters,
          reviewerId: args.reviewerId,
          assignedBy: ctx.auth.userId,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

builder.mutationField("clearQuestionCondition", (t) =>
  t.field({
    type: QuestionReviewRoundRef,
    description:
      "Clear an APPROVE_WITH_CONDITION hold and send the question BACK to the same reviewer " +
      "for a fresh round (D-#525) — clearing does NOT publish. Refuses unless the latest " +
      "round really is a submitted APPROVE_WITH_CONDITION. Requires content:assign_review.",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      artifactId: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await clearConditionSvc({
          artifactId: args.artifactId,
          note: args.note ?? null,
          actorId: ctx.auth.userId,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

builder.mutationField("submitQuestionReview", (t) =>
  t.field({
    type: QuestionReviewRoundRef,
    description:
      "Accept (APPROVE) or reject (CHANGES_REQUESTED) an assigned question. The rejection " +
      "`reason` is OPTIONAL. Only the assigned reviewer may submit; they may edit their own " +
      "decision until the round closes. APPROVE drives draft→reviewed. Requires content:review.",
    authScopes: { hasPermission: "content:review" },
    args: {
      assignmentId: t.arg.string({ required: true }),
      verdict: t.arg.string({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await submitSvc({
          assignmentId: args.assignmentId,
          reviewerId: ctx.auth.userId,
          verdict: args.verdict,
          reason: args.reason ?? undefined,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);


builder.mutationField("submitQuestionReviewBulk", (t) =>
  t.field({
    type: QuestionBulkResultRef,
    description:
      "Apply ONE verdict to a multi-selection of the caller's own rounds (D-#527) — the " +
      "reviewer works a whole chapter, so deciding one card at a time is the bottleneck. " +
      "APPROVE_WITH_CONDITION is refused: a condition belongs to ONE question. Per-item " +
      "failures are collected, not fatal. Requires content:review.",
    authScopes: { hasPermission: "content:review" },
    args: {
      assignmentIds: t.arg.stringList({ required: true }),
      verdict: t.arg.string({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await submitBulkSvc({
          assignmentIds: args.assignmentIds,
          verdict: args.verdict,
          reason: args.reason ?? undefined,
          reviewerId: ctx.auth.userId,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);
builder.mutationField("publishQuestion", (t) =>
  t.field({
    type: PublishQuestionResultRef,
    description:
      "Principal publish: put a question on the teachers' shelf (→ gold) and close its review " +
      "thread. An accepted ('reviewed') question publishes directly; a rejected/draft one may be " +
      "published by override — `overrideReason` is then REQUIRED and recorded. " +
      "Requires content:promote_gold (Principal-locked).",
    authScopes: { hasPermission: "content:promote_gold" },
    args: {
      artifactId: t.arg.string({ required: true }),
      overrideReason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await publishSvc({
          artifactId: args.artifactId,
          actorId: ctx.auth.userId,
          actorRole: ctx.auth.role,
          overrideReason: args.overrideReason ?? undefined,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

builder.mutationField("publishQuestionBulk", (t) =>
  t.field({
    type: QuestionBulkResultRef,
    description:
      "Publish a multi-selection of ACCEPTED questions (Q2.10). Carries no override reason — " +
      "an override is per question, so a rejected question must be published one at a time. " +
      "Requires content:promote_gold (Principal-locked).",
    authScopes: { hasPermission: "content:promote_gold" },
    args: {
      artifactIds: t.arg.stringList({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return publishBulkSvc({
        artifactIds: args.artifactIds,
        actorId: ctx.auth.userId,
        actorRole: ctx.auth.role,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("myQuestionReviews", (t) =>
  t.field({
    type: [QuestionReviewRoundRef],
    description:
      "The caller's question-review queue: assigned (awaiting a verdict) first, then submitted " +
      "(decided, still editable). PAGINATED — `limit` defaults to 50 and is capped at 200. " +
      "Requires content:review.",
    authScopes: { hasPermission: "content:review" },
    args: {
      limit: t.arg.int({ required: false }),
      offset: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return listMyQuestionReviews(ctx.auth.userId, { limit: args.limit, offset: args.offset });
    },
  }),
);

builder.queryField("myQuestionReviewCount", (t) =>
  t.int({
    description:
      "How many rounds the caller's question-review queue holds in total — the pager's " +
      "denominator, so the screen can say '50 of 2,742' rather than implying the page is all " +
      "there is. Requires content:review.",
    authScopes: { hasPermission: "content:review" },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return countMyQuestionReviews(ctx.auth.userId);
    },
  }),
);

builder.queryField("questionReviewInbox", (t) =>
  t.field({
    type: [QuestionReviewRoundRef],
    description:
      "Submitted question rounds, newest first. verdict=APPROVE is the Principal's publish queue " +
      "(Q2.6); verdict=CHANGES_REQUESTED is the rejected list with each reviewer's reason (Q2.7). " +
      "Requires content:assign_review (Principal/Office).",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      verdict: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await inboxSvc(args.verdict ?? undefined);
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

builder.queryField("questionReviewThread", (t) =>
  t.field({
    type: [QuestionReviewRoundRef],
    description:
      "The full round history for one question (by any of its versions), oldest→newest. " +
      "Principal/Office see any thread; a teacher sees only threads they reviewed.",
    authScopes: { authenticated: true },
    args: {
      artifactId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      let thread: QuestionReviewRoundDTO[];
      try {
        thread = await threadSvc(args.artifactId);
      } catch (err) {
        return mapReviewError(err);
      }
      if (!isAdminStaff(ctx.auth)) {
        const isParticipant = thread.some((r) => r.reviewerId === ctx.auth!.userId);
        if (!isParticipant) throw new ForbiddenError();
      }
      return thread;
    },
  }),
);

builder.queryField("assignableQuestions", (t) =>
  t.field({
    type: [AssignableQuestionRef],
    description:
      "Current, NOT-yet-published questions with their open-round state, for the assign picker " +
      "(Q2.2). Requires content:assign_review (Principal/Office).",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      topicTag: t.arg.string({ required: false }),
      reviewStatus: t.arg.string({ required: false }),
      search: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return listAssignableQuestions({
        subject: args.subject,
        classLevel: args.classLevel,
        topicTag: args.topicTag,
        reviewStatus: args.reviewStatus,
        search: args.search,
        limit: args.limit,
      });
    },
  }),
);
