/**
 * Review daily statistics (owner 22 Nov 2026, D-#1680, .claude/plans/review-daily-stats.md).
 *
 * Reads - myReviewStats / myReviewStatsSummary: the caller's OWN numbers (review_stats:view_own).
 *         reviewStats / reviewStatsSummary / reviewStatsReviewers: anyone's, or the whole team when
 *         reviewerId is null (review_stats:view_all).
 * A view_own caller can never read another reviewer: the own fields take no reviewer id and the
 * `statsScope` guard backs the all-fields up.
 */
import { Types } from "mongoose";
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { expectedGraphQLError } from "../../../observability/sentry";
import {
  reviewStatsPage,
  reviewStatsSummary,
  reviewersWithStats,
  statsScope,
  type DayRow,
  type KindCounts,
  type StatsReviewer,
  type StatsSummary,
} from "../services/ReviewStatsService";

function authOf(ctx: { auth?: AuthPayload | null }): AuthPayload {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return ctx.auth;
}

/** A reviewer id from the client must be a real ObjectId, or the caller gets a plain refusal (never a BSONError). */
function scopeOf(ctx: { auth?: AuthPayload | null }, reviewerId: string | null | undefined): string | undefined {
  if (reviewerId && !Types.ObjectId.isValid(reviewerId)) throw expectedGraphQLError("That reviewer id is not valid");
  return statsScope(authOf(ctx), reviewerId);
}

const CountsRef = builder.objectRef<KindCounts>("ReviewKindCounts");
CountsRef.implement({
  fields: (t) => ({
    chapterPlans: t.exposeInt("chapterPlans"),
    sessionPlans: t.exposeInt("sessionPlans"),
    questions: t.exposeInt("questions"),
    total: t.exposeInt("total"),
  }),
});

const DayRowRef = builder.objectRef<DayRow>("ReviewStatsDay");
DayRowRef.implement({
  fields: (t) => ({
    dayKey: t.exposeString("dayKey", { description: "Dhaka day, YYYY-MM-DD" }),
    counts: t.field({ type: CountsRef, resolve: (r) => r.counts }),
    delta: t.field({ type: CountsRef, description: "This day minus the previous calendar day.", resolve: (r) => r.delta }),
  }),
});
const DayPageRef = pageRef("ReviewStatsDayPage", DayRowRef);

const SummaryRef = builder.objectRef<StatsSummary>("ReviewStatsSummary");
SummaryRef.implement({
  fields: (t) => ({
    todayKey: t.exposeString("todayKey"),
    today: t.field({ type: CountsRef, resolve: (s) => s.today }),
    yesterday: t.field({ type: CountsRef, resolve: (s) => s.yesterday }),
    delta: t.field({ type: CountsRef, resolve: (s) => s.delta }),
    last7Days: t.field({ type: CountsRef, resolve: (s) => s.last7Days }),
    allTime: t.field({ type: CountsRef, resolve: (s) => s.allTime }),
  }),
});

const ReviewerRef = builder.objectRef<StatsReviewer>("ReviewStatsReviewer");
ReviewerRef.implement({
  fields: (t) => ({ id: t.exposeString("id"), name: t.exposeString("name") }),
});

builder.queryField("myReviewStats", (t) =>
  t.field({
    type: DayPageRef,
    description: "The caller's own reviewed counts per Dhaka day, newest first, zero days included. review_stats:view_own.",
    authScopes: { hasPermission: "review_stats:view_own" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => reviewStatsPage({ reviewerId: authOf(ctx).userId, page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("myReviewStatsSummary", (t) =>
  t.field({
    type: SummaryRef,
    description: "The caller's own today / yesterday / last 7 days / all-time review counts. review_stats:view_own.",
    authScopes: { hasPermission: "review_stats:view_own" },
    resolve: (_r, _a, ctx) => reviewStatsSummary(authOf(ctx).userId),
  }),
);

builder.queryField("reviewStats", (t) =>
  t.field({
    type: DayPageRef,
    description: "One reviewer's reviewed counts per Dhaka day (reviewerId null = the whole team). review_stats:view_all.",
    authScopes: { hasPermission: "review_stats:view_all" },
    args: {
      reviewerId: t.arg.string({ required: false }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: (_r, a, ctx) =>
      reviewStatsPage({ reviewerId: scopeOf(ctx, a.reviewerId), page: a.page, pageSize: a.pageSize }),
  }),
);

builder.queryField("reviewStatsSummary", (t) =>
  t.field({
    type: SummaryRef,
    description: "Today / yesterday / last 7 days / all-time for one reviewer or the whole team. review_stats:view_all.",
    authScopes: { hasPermission: "review_stats:view_all" },
    args: { reviewerId: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => reviewStatsSummary(scopeOf(ctx, a.reviewerId)),
  }),
);

builder.queryField("reviewStatsReviewers", (t) =>
  t.field({
    type: [ReviewerRef],
    description: "Reviewers with a first verdict or an open round, for the picker. review_stats:view_all.",
    authScopes: { hasPermission: "review_stats:view_all" },
    resolve: () => reviewersWithStats(),
  }),
);
