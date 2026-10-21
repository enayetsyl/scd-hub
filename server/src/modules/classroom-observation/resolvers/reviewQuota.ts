/**
 * Review-quota resolvers (owner ask 2026-10-12). `myReviewQuota` is the caller's OWN
 * progress against their daily review target — null for everyone without a quota, so
 * the Today card renders for that observer alone. `setReviewQuota` is Principal-only.
 * Identity/operational plane — no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { reviewQuotaProgress, setReviewQuota, type QuotaDay, type QuotaProgress } from "../services/ReviewQuotaService";

const QuotaDayRef = builder.objectRef<QuotaDay>("ReviewQuotaDay").implement({
  description: "One day of an observer's review-quota running total.",
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    working: t.exposeBoolean("working"),
    reviewed: t.exposeInt("reviewed"),
    cumulative: t.exposeInt("cumulative"),
    expected: t.exposeInt("expected"),
    diff: t.exposeInt("diff"),
    isToday: t.exposeBoolean("isToday"),
  }),
});

const QuotaProgressRef = builder.objectRef<QuotaProgress>("ReviewQuotaProgress").implement({
  description:
    "The caller's progress against their daily review target: per-day reviews, running total, target, and " +
    "how far behind (negative) or ahead (positive) they are as of yesterday, plus what today still needs.",
  fields: (t) => ({
    perDay: t.exposeInt("perDay"),
    startKey: t.exposeString("startKey"),
    todayKey: t.exposeString("todayKey"),
    days: t.field({ type: [QuotaDayRef], resolve: (p) => p.days }),
    reviewedTotal: t.exposeInt("reviewedTotal"),
    reviewedThroughYesterday: t.exposeInt("reviewedThroughYesterday"),
    expectedThroughYesterday: t.exposeInt("expectedThroughYesterday"),
    diffThroughYesterday: t.exposeInt("diffThroughYesterday"),
    todayWorking: t.exposeBoolean("todayWorking"),
    todayReviewed: t.exposeInt("todayReviewed"),
    todayTarget: t.exposeInt("todayTarget"),
    neededToday: t.exposeInt("neededToday"),
  }),
});

builder.queryField("myReviewQuota", (t) =>
  t.field({
    type: QuotaProgressRef,
    nullable: true,
    description: "The caller's review-quota progress, or null when they have no active quota.",
    authScopes: { authenticated: true },
    resolve: async (_r, _a, ctx) => (ctx.auth ? reviewQuotaProgress(ctx.auth.userId) : null),
  }),
);

builder.mutationField("setReviewQuota", (t) =>
  t.field({
    type: "Boolean",
    description:
      "Set, change or switch off an observer's daily review target. Requires classroom_observation:set_quota " +
      "(default Principal only).",
    authScopes: { hasPermission: "classroom_observation:set_quota" },
    args: {
      userId: t.arg.string({ required: true }),
      perDay: t.arg.int({ required: true }),
      startKey: t.arg.string({ required: true }),
      weekdays: t.arg.intList({ required: false }),
      active: t.arg.boolean({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError();
      await setReviewQuota({ ...args, actorId: ctx.auth.userId });
      return true;
    },
  }),
);
