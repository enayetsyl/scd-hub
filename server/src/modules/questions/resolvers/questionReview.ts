/**
 * Question review & publish resolvers (QR-2; D-#508).
 *
 * Mutations:
 *   assignQuestionReview / assignQuestionReviewBulk — content:assign_review (Principal/Office)
 *   submitQuestionReview — content:review (the ASSIGNED reviewer only). Reason optional.
 *   publishQuestion / publishQuestionBulk — content:promote_gold (Principal-locked)
 *   publishQuestionsMatching — content:promote_gold. Publish everything matching the inbox
 *                          filter (QR-6, D-#538). APPROVE only, capped per call.
 *
 * Queries:
 *   myQuestionReviews    — content:review. The caller's question queue.
 *   questionReviewInbox / questionReviewInboxCount
 *                        — content:assign_review. Submitted rounds, filterable by verdict:
 *                          APPROVE = the publish queue, CHANGES_REQUESTED = the rejected list;
 *                          plus subject / class / chapter / type / search, paginated (QR-6).
 *   questionReviewThread — round history for one question.
 *   assignableQuestions  — content:assign_review. The picker.
 *   questionReviewerProgress / questionReviewerRounds / questionReviewerRoundCount
 *                        — content:assign_review. Who was given what, and how they ruled
 *                          (QR-5, D-#537). Verdict-bucketed, so publishing a question does
 *                          not erase the reviewer's decision from their tally.
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
  questionCoverage as coverageSvc,
  questionReviewerSlices as slicesSvc,
  myReviewChapters as myChaptersSvc,
  type ReviewerSliceDTO,
  type QuestionCoverageDTO,
  listMyQuestionReviews,
  countMyQuestionReviews,
  questionReviewInbox as inboxSvc,
  countQuestionReviewInbox as inboxCountSvc,
  publishQuestionsMatching as publishMatchingSvc,
  questionReviewThread as threadSvc,
  listAssignableQuestions,
  questionReviewerProgress as progressSvc,
  listQuestionReviewerRounds as reviewerRoundsSvc,
  countQuestionReviewerRounds as reviewerRoundCountSvc,
  type InboxFilterArgs,
  type QuestionReviewRoundDTO,
  type QuestionReviewerProgressDTO,
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
    /** Marked important (QR-9, D-#550) — shown as a tag, and the reviewer toggles it here. */
    important: t.exposeBoolean("important"),
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

const PublishAllResultRef = builder.objectRef<BulkResult & { remaining: number }>(
  "PublishAllResult",
);
PublishAllResultRef.implement({
  description:
    "Outcome of a publish-all (QR-6). `remaining` is how many matching questions are still " +
    "unpublished after this call — non-zero when the batch hit its per-call ceiling, so the " +
    "client can say 'press again' instead of quietly stopping short.",
  fields: (t) => ({
    okCount: t.exposeInt("okCount"),
    failedCount: t.exposeInt("failedCount"),
    remaining: t.exposeInt("remaining"),
    failures: t.field({
      type: ["String"],
      resolve: (r) => r.failures.map((f) => `${f.artifactId}: ${f.error}`),
    }),
  }),
});

builder.mutationField("publishQuestionsMatching", (t) =>
  t.field({
    type: PublishAllResultRef,
    description:
      "Publish EVERY accepted question matching the given filter (QR-6) — the same filter the " +
      "inbox list and its count take, so the number in the confirmation is the number that " +
      "publishes. verdict MUST be APPROVE: a rejected question needs a per-question override " +
      "reason (D-#525), so a bulk call over rejected rounds is refused rather than failing " +
      "every item. Capped per call; read `remaining`. Requires content:promote_gold.",
    authScopes: { hasPermission: "content:promote_gold" },
    args: {
      verdict: t.arg.string({ required: true }),
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      chapter: t.arg.int({ required: false }),
      questionType: t.arg.string({ required: false }),
      search: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await publishMatchingSvc({
          filter: filterFromArgs(args),
          actorId: ctx.auth.userId,
          actorRole: ctx.auth.role,
        });
      } catch (err) {
        return mapReviewError(err);
      }
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
      /** The QR-11 filter (D-#559) — same axes as the publish inbox, plus `undecided`. */
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      chapter: t.arg.int({ required: false }),
      questionType: t.arg.string({ required: false }),
      search: t.arg.string({ required: false }),
      important: t.arg.boolean({ required: false }),
      undecided: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return listMyQuestionReviews(
        ctx.auth.userId,
        { limit: args.limit, offset: args.offset },
        {
        subject: args.subject,
        classLevel: args.classLevel,
        chapter: args.chapter,
        questionType: args.questionType,
        search: args.search,
        important: args.important,
        undecided: args.undecided,
        },
      );
    },
  }),
);

builder.queryField("myQuestionReviewCount", (t) =>
  t.field({
    type: "Int",
    description:
      "How many rounds the caller's question-review queue holds in total — the pager's " +
      "denominator, so the screen can say '50 of 2,742' rather than implying the page is all " +
      "there is. Requires content:review.",
    authScopes: { hasPermission: "content:review" },
    args: {
      /** The QR-11 filter (D-#559) — same axes as the publish inbox, plus `undecided`. */
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      chapter: t.arg.int({ required: false }),
      questionType: t.arg.string({ required: false }),
      search: t.arg.string({ required: false }),
      important: t.arg.boolean({ required: false }),
      undecided: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return countMyQuestionReviews(ctx.auth.userId, {
        subject: args.subject,
        classLevel: args.classLevel,
        chapter: args.chapter,
        questionType: args.questionType,
        search: args.search,
        important: args.important,
        undecided: args.undecided,
      });
    },
  }),
);

/**
 * The inbox filter, read off the GraphQL args in ONE place.
 *
 * The list, its count and publish-all all take the same six arguments and all build the
 * filter through here, so "publish all 47" cannot come to mean a different 47 from the one
 * the screen is showing — which, for a one-way operation, is the difference between a
 * feature and an incident.
 */
function filterFromArgs(a: {
  verdict?: string | null;
  subject?: string | null;
  classLevel?: number | null;
  chapter?: number | null;
  questionType?: string | null;
  search?: string | null;
}): InboxFilterArgs {
  return {
    verdict: a.verdict,
    subject: a.subject,
    classLevel: a.classLevel,
    chapter: a.chapter,
    questionType: a.questionType,
    search: a.search,
  };
}

builder.queryField("questionReviewInbox", (t) =>
  t.field({
    type: [QuestionReviewRoundRef],
    description:
      "Submitted question rounds, newest first. verdict=APPROVE is the Principal's publish queue " +
      "(Q2.6); verdict=CHANGES_REQUESTED is the rejected list with each reviewer's reason (Q2.7). " +
      "Narrowable by subject / classLevel / chapter / questionType / search (QR-6). PAGINATED: " +
      "`limit` defaults to 50 and is capped at 200. Requires content:assign_review.",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      verdict: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      chapter: t.arg.int({ required: false }),
      questionType: t.arg.string({ required: false }),
      search: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
      offset: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await inboxSvc(filterFromArgs(args), { limit: args.limit, offset: args.offset });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

builder.queryField("questionReviewInboxCount", (t) =>
  t.field({
    type: "Int",
    description:
      "How many submitted rounds match the same filter — the pager's denominator, and the " +
      "number the publish-all confirmation quotes. Requires content:assign_review.",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      verdict: t.arg.string({ required: false }),
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      chapter: t.arg.int({ required: false }),
      questionType: t.arg.string({ required: false }),
      search: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await inboxCountSvc(filterFromArgs(args));
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

// ---------------------------------------------------------------------------
// Reviewer progress (QR-5, D-#537)
// ---------------------------------------------------------------------------

const QuestionCoverageRef = builder.objectRef<QuestionCoverageDTO>("QuestionCoverage");
QuestionCoverageRef.implement({
  description:
    "Coverage for one (subject × class × chapter) slice (QR-13, D-#567): how many questions " +
    "exist, how many were ever put into review, how many are still untouched, how many were " +
    "ruled on and how many reached the shelf. `assigned`/`reviewed` count DISTINCT QUESTIONS, " +
    "not rounds — a second round on the same question must not count twice.",
  fields: (t) => ({
    inBank: t.exposeInt("inBank"),
    assigned: t.exposeInt("assigned"),
    notAssigned: t.exposeInt("notAssigned"),
    reviewed: t.exposeInt("reviewed"),
    published: t.exposeInt("published"),
  }),
});

const QuestionReviewerProgressRef =
  builder.objectRef<QuestionReviewerProgressDTO>("QuestionReviewerProgress");
QuestionReviewerProgressRef.implement({
  description:
    "One reviewer's question-review workload and how they ruled on it (D-#537). Counts are " +
    "bucketed by VERDICT, not by round status, so a decision keeps counting after the " +
    "question it was about has been published. Identity-plane; behind the ADR-005 firewall.",
  fields: (t) => ({
    reviewerId: t.exposeString("reviewerId"),
    reviewerName: t.string({ nullable: true, resolve: (r) => r.reviewerName }),
    assigned: t.exposeInt("assigned"),
    pending: t.exposeInt("pending"),
    approved: t.exposeInt("approved"),
    approvedWithCondition: t.exposeInt("approvedWithCondition"),
    rejected: t.exposeInt("rejected"),
    cancelled: t.exposeInt("cancelled"),
    decided: t.exposeInt("decided"),
  }),
});

builder.queryField("questionReviewerProgress", (t) =>
  t.field({
    type: [QuestionReviewerProgressRef],
    description:
      "Per-reviewer question-review progress, optionally narrowed to one class and/or subject " +
      "(Q5.1). Reviewers who still owe work come first. Requires content:assign_review.",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      classLevel: t.arg.int({ required: false }),
      subject: t.arg.string({ required: false }),
      chapter: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return progressSvc({ classLevel: args.classLevel, subject: args.subject, chapter: args.chapter });
    },
  }),
);

builder.queryField("questionReviewerRounds", (t) =>
  t.field({
    type: [QuestionReviewRoundRef],
    description:
      "One reviewer's rounds in ONE bucket (PENDING | APPROVE | APPROVE_WITH_CONDITION | " +
      "CHANGES_REQUESTED | CANCELLED) — the drill-down behind a progress counter (Q5.2). " +
      "Unlike questionReviewInbox this is NOT limited to still-open rounds, so a decision " +
      "stays visible after its question is published. PAGINATED: `limit` defaults to 50 and " +
      "is capped at 200. Requires content:assign_review.",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      reviewerId: t.arg.string({ required: true }),
      bucket: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: false }),
      subject: t.arg.string({ required: false }),
      limit: t.arg.int({ required: false }),
      offset: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await reviewerRoundsSvc({
          reviewerId: args.reviewerId,
          bucket: args.bucket,
          classLevel: args.classLevel,
          subject: args.subject,
          limit: args.limit,
          offset: args.offset,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

builder.queryField("questionReviewerRoundCount", (t) =>
  t.field({
    type: "Int",
    description:
      "How many rounds one reviewer × bucket holds in total — the drill-down pager's " +
      "denominator, so the screen can say '50 of 2,742'. Requires content:assign_review.",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      reviewerId: t.arg.string({ required: true }),
      bucket: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: false }),
      subject: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      try {
        return await reviewerRoundCountSvc({
          reviewerId: args.reviewerId,
          bucket: args.bucket,
          classLevel: args.classLevel,
          subject: args.subject,
        });
      } catch (err) {
        return mapReviewError(err);
      }
    },
  }),
);

builder.queryField("questionCoverage", (t) =>
  t.field({
    type: QuestionCoverageRef,
    description:
      "How much of a (subject × class × chapter) slice has been put into review at all, and " +
      "how far it got (QR-13, D-#567). The progress screen could say how the ASSIGNED work was " +
      "going and nothing about how much of the subject had been assigned, so a reviewer at 13% " +
      "looked the same whether she held the whole subject or a tenth of it. Requires " +
      "content:assign_review.",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      chapter: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return coverageSvc({ subject: args.subject, classLevel: args.classLevel, chapter: args.chapter });
    },
  }),
);

const ReviewerSliceRef = builder.objectRef<ReviewerSliceDTO>("ReviewerSlice");
ReviewerSliceRef.implement({
  description:
    "One (reviewer × subject × class × chapter) slice — who received what (QR-14, D-#568). " +
    "Counts ROUNDS, not distinct questions, so a reviewer’s slices sum to the total on their " +
    "progress card. Identity-plane; behind the ADR-005 firewall.",
  fields: (t) => ({
    reviewerId: t.exposeString("reviewerId"),
    reviewerName: t.string({ nullable: true, resolve: (r) => r.reviewerName }),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    chapter: t.exposeString("chapter"),
    assigned: t.exposeInt("assigned"),
    decided: t.exposeInt("decided"),
    pending: t.exposeInt("pending"),
  }),
});

builder.queryField("questionReviewerSlices", (t) =>
  t.field({
    type: [ReviewerSliceRef],
    description:
      "Which subject/class/chapter slices each reviewer holds, and how far through each " +
      "(QR-14, D-#568). The progress card gave only a total, so ‘which chapters did I give " +
      "her’ meant tapping through every subject × class combination. Requires " +
      "content:assign_review.",
    authScopes: { hasPermission: "content:assign_review" },
    args: {
      classLevel: t.arg.int({ required: false }),
      subject: t.arg.string({ required: false }),
      chapter: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return slicesSvc({ classLevel: args.classLevel, subject: args.subject, chapter: args.chapter });
    },
  }),
);

builder.queryField("myReviewChapters", (t) =>
  t.field({
    type: ["Int"],
    description:
      "The chapters the CALLER actually holds rounds for (QR-14, D-#568). Her queue filter " +
      "used to read `questionChapters`, which walks the bank and is publish-gated for a " +
      "teacher — so she was offered only chapters whose work was already done. Requires " +
      "content:review.",
    authScopes: { hasPermission: "content:review" },
    args: {
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return myChaptersSvc(ctx.auth.userId, { subject: args.subject, classLevel: args.classLevel });
    },
  }),
);
