/**
 * The reviewer's ordered path + "আরও কাজ দিন" (owner, 19 Nov 2026,
 * .claude/plans/review-next-chunk.md).
 *
 * Reads  - myReviewPath, myReviewMoreStatus: the caller's OWN work (plan_review:review or
 *          question_review:review); reviewSelfServe: review_program:supervise.
 * Writes - requestMoreReview: the reviewer's own request (same two permissions);
 *          updateReviewSelfServe, setReviewLadder: review_program:manage.
 * No new permission: each action reuses the catalogue entry that already covers it.
 */
import { callerHasPermission } from "@scd/shared";
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { expectedGraphQLError } from "../../../observability/sentry";
import { ReviewError } from "../../content/services/ReviewService";
import {
  myReviewPath,
  type ReviewPath,
  type ReviewPathBook,
  type ReviewPathChapter,
  type ReviewPathItem,
  type ReviewPathNext,
} from "../services/ReviewPathService";
import {
  myReviewMoreStatus,
  requestMoreReview,
  selfServeOverview,
  setReviewerLadder,
  updateSelfServeSettings,
  type LadderBookView,
  type LadderRowView,
  type MoreCaps,
  type MoreResult,
  type MoreStatus,
  type SelfServeOverview,
} from "../services/ReviewMoreService";

function mapError(err: unknown): never {
  if (err instanceof ReviewError) throw expectedGraphQLError(err.message);
  throw err;
}

function actorOf(ctx: { auth?: { userId: string; role: string } | null }) {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return { id: ctx.auth.userId, role: ctx.auth.role };
}

/** Only the half of a chapter the caller may review (a plan-only reviewer is never handed questions). */
function capsOf(ctx: { auth?: Parameters<typeof callerHasPermission>[0] | null }): MoreCaps {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return {
    plans: callerHasPermission(ctx.auth, "plan_review:review"),
    questions: callerHasPermission(ctx.auth, "question_review:review"),
  };
}

// ---------------------------------------------------------------------------
// The path
// ---------------------------------------------------------------------------

const ItemRef = builder.objectRef<ReviewPathItem>("ReviewPathItem");
ItemRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    kind: t.exposeString("kind", { description: "CHAPTER_PLAN | SESSION_PLAN | PLAN | QUESTIONS" }),
    titleBn: t.exposeString("titleBn"),
    left: t.exposeInt("left"),
    total: t.exposeInt("total"),
    decided: t.exposeBoolean("decided"),
    screen: t.exposeString("screen", { description: "A screen of the ReviewTab stack." }),
    paramsJson: t.exposeString("paramsJson"),
  }),
});

const ChapterRef = builder.objectRef<ReviewPathChapter>("ReviewPathChapter");
ChapterRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    chapter: t.exposeString("chapter"),
    chapterNo: t.int({ nullable: true, resolve: (c) => c.chapterNo }),
    labelBn: t.exposeString("labelBn"),
    left: t.exposeInt("left"),
    total: t.exposeInt("total"),
    decided: t.exposeBoolean("decided"),
    dueKey: t.string({ nullable: true, resolve: (c) => c.dueKey }),
    items: t.field({ type: [ItemRef], resolve: (c) => c.items }),
  }),
});

const BookRef = builder.objectRef<ReviewPathBook>("ReviewPathBook");
BookRef.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    anchorWord: t.exposeString("anchorWord"),
    titleBn: t.exposeString("titleBn"),
    left: t.exposeInt("left"),
    total: t.exposeInt("total"),
    chapters: t.field({ type: [ChapterRef], resolve: (b) => b.chapters }),
  }),
});

const NextRef = builder.objectRef<ReviewPathNext>("ReviewPathNext");
NextRef.implement({
  fields: (t) => ({
    bookTitleBn: t.exposeString("bookTitleBn"),
    chapterLabelBn: t.exposeString("chapterLabelBn"),
    item: t.field({ type: ItemRef, resolve: (n) => n.item }),
  }),
});

const PathRef = builder.objectRef<ReviewPath>("ReviewPath");
PathRef.implement({
  fields: (t) => ({
    books: t.field({ type: [BookRef], resolve: (p) => p.books }),
    next: t.field({ type: NextRef, nullable: true, resolve: (p) => p.next }),
    totalLeft: t.exposeInt("totalLeft"),
  }),
});

builder.queryField("myReviewPath", (t) =>
  t.field({
    type: PathRef,
    description:
      "The caller's open review work as books -> chapters (number order) -> items: the chapter plan, " +
      "its session plans, then the chapter's questions; finished chapters last. `next` is the first " +
      "undecided item. Requires plan_review:review or question_review:review.",
    authScopes: { hasAnyPermission: ["plan_review:review", "question_review:review"] },
    resolve: async (_r, _a, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return myReviewPath(ctx.auth);
    },
  }),
);

// ---------------------------------------------------------------------------
// "আরও কাজ দিন"
// ---------------------------------------------------------------------------

const MoreStatusRef = builder.objectRef<MoreStatus>("ReviewMoreStatus");
MoreStatusRef.implement({
  fields: (t) => ({
    canRequest: t.exposeBoolean("canRequest"),
    reason: t.string({ nullable: true, resolve: (s) => s.reason, description: "STILL_OPEN | DAILY_CAP | NOT_ENABLED | BUSY, or null when canRequest." }),
    leftPlans: t.exposeInt("leftPlans"),
    leftQuestions: t.exposeInt("leftQuestions"),
    requestsToday: t.exposeInt("requestsToday"),
    maxRequestsPerDay: t.exposeInt("maxRequestsPerDay"),
    chunkChapters: t.exposeInt("chunkChapters"),
  }),
});

const MoreResultRef = builder.objectRef<MoreResult>("ReviewMoreResult");
MoreResultRef.implement({
  fields: (t) => ({
    outcome: t.exposeString("outcome", { description: "ADDED | STILL_OPEN | DAILY_CAP | NOTHING_LEFT | NOT_ENABLED | BUSY" }),
    bookTitleBn: t.string({ nullable: true, resolve: (r) => r.bookTitleBn }),
    anchorWord: t.string({ nullable: true, resolve: (r) => r.anchorWord }),
    chapters: t.field({ type: ["String"], resolve: (r) => r.chapters }),
    addedPlans: t.exposeInt("addedPlans"),
    addedQuestions: t.exposeInt("addedQuestions"),
    status: t.field({ type: MoreStatusRef, resolve: (r) => r.status }),
  }),
});

builder.queryField("myReviewMoreStatus", (t) =>
  t.field({
    type: MoreStatusRef,
    description: "Whether the caller's 'আরও কাজ দিন' button is live, and why not. Requires plan_review:review or question_review:review.",
    authScopes: { hasAnyPermission: ["plan_review:review", "question_review:review"] },
    resolve: async (_r, _a, ctx) => {
      try {
        return await myReviewMoreStatus(actorOf(ctx).id, capsOf(ctx));
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.mutationField("requestMoreReview", (t) =>
  t.field({
    type: MoreResultRef,
    description:
      "The reviewer takes the next chunk of chapters themselves (ladder + threshold + daily cap from the review program). " +
      "A refusal comes back as an outcome, not an error. Requires plan_review:review or question_review:review.",
    authScopes: { hasAnyPermission: ["plan_review:review", "question_review:review"] },
    resolve: async (_r, _a, ctx) => {
      try {
        return await requestMoreReview(actorOf(ctx), capsOf(ctx));
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Principal: settings + ladders
// ---------------------------------------------------------------------------

const SettingsRef = builder.objectRef<SelfServeOverview["settings"]>("ReviewSelfServeSettings");
SettingsRef.implement({
  fields: (t) => ({
    enabled: t.exposeBoolean("enabled"),
    chunkChapters: t.exposeInt("chunkChapters"),
    releasePlansLeft: t.exposeInt("releasePlansLeft"),
    releaseQuestionsLeft: t.exposeInt("releaseQuestionsLeft"),
    maxRequestsPerDay: t.exposeInt("maxRequestsPerDay"),
  }),
});

const LadderBookRef = builder.objectRef<LadderBookView>("ReviewLadderBook");
LadderBookRef.implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    anchorWord: t.exposeString("anchorWord"),
    labelBn: t.exposeString("labelBn"),
  }),
});

const LadderRowRef = builder.objectRef<LadderRowView>("ReviewLadderRow");
LadderRowRef.implement({
  fields: (t) => ({
    reviewerId: t.exposeString("reviewerId"),
    reviewerName: t.string({ nullable: true, resolve: (r) => r.reviewerName }),
    custom: t.exposeBoolean("custom"),
    books: t.field({ type: [LadderBookRef], resolve: (r) => r.books }),
  }),
});

const OverviewRef = builder.objectRef<SelfServeOverview>("ReviewSelfServe");
OverviewRef.implement({
  fields: (t) => ({
    programId: t.exposeString("programId"),
    settings: t.field({ type: SettingsRef, resolve: (o) => o.settings }),
    ladders: t.field({ type: [LadderRowRef], resolve: (o) => o.ladders }),
    availableBooks: t.field({ type: [LadderBookRef], resolve: (o) => o.availableBooks }),
  }),
});

const LadderBookInput = builder.inputType("ReviewLadderBookInput", {
  fields: (t) => ({
    subject: t.string({ required: true }),
    classLevel: t.int({ required: true }),
    anchorWord: t.string({ required: true }),
  }),
});

builder.queryField("reviewSelfServe", (t) =>
  t.field({
    type: OverviewRef,
    description: "The 'আরও কাজ দিন' settings and each reviewer's ladder (the default shown when none is set). Requires review_program:supervise.",
    authScopes: { hasPermission: "review_program:supervise" },
    args: { programId: t.arg.string({ required: true }) },
    resolve: async (_r, a) => {
      try {
        return await selfServeOverview(a.programId);
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.mutationField("updateReviewSelfServe", (t) =>
  t.field({
    type: OverviewRef,
    description: "Change the self-serve settings (omitted fields keep their value). Requires review_program:manage.",
    authScopes: { hasPermission: "review_program:manage" },
    args: {
      programId: t.arg.string({ required: true }),
      enabled: t.arg.boolean({ required: false }),
      chunkChapters: t.arg.int({ required: false }),
      releasePlansLeft: t.arg.int({ required: false }),
      releaseQuestionsLeft: t.arg.int({ required: false }),
      maxRequestsPerDay: t.arg.int({ required: false }),
    },
    resolve: async (_r, a, ctx) => {
      try {
        return await updateSelfServeSettings({ ...a, actor: actorOf(ctx) });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);

builder.mutationField("setReviewLadder", (t) =>
  t.field({
    type: OverviewRef,
    description: "Set one reviewer's ladder (ordered books); `books` null goes back to the default ladder. Requires review_program:manage.",
    authScopes: { hasPermission: "review_program:manage" },
    args: {
      programId: t.arg.string({ required: true }),
      reviewerId: t.arg.string({ required: true }),
      books: t.arg({ type: [LadderBookInput], required: false }),
    },
    resolve: async (_r, a, ctx) => {
      try {
        return await setReviewerLadder({
          programId: a.programId, reviewerId: a.reviewerId, books: a.books ?? null, actor: actorOf(ctx),
        });
      } catch (e) {
        return mapError(e);
      }
    },
  }),
);
