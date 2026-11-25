/**
 * Review speed / rubber-stamp flag (owner GO 25 Nov 2026, D-#1684, .claude/plans/review-speed-flag.md).
 *
 * reviewQuality: every reviewer's flag + figures over the last `days` Dhaka days (today included).
 * Management only (review_stats:view_all OR review_program:supervise). There is deliberately NO own-view
 * query: a reviewer never sees quality data about themselves.
 */
import { Types } from "mongoose";
import { builder } from "../../../schema";
import { expectedGraphQLError } from "../../../observability/sentry";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { addDaysToKey } from "../services/ReviewStatsService";
import { reviewQuality, type KindQuality, type ReviewQualityRow } from "../services/ReviewQualityService";

const KindRef = builder.objectRef<KindQuality>("ReviewQualityKind");
KindRef.implement({
  fields: (t) => ({
    n: t.exposeInt("n"),
    medianGapSec: t.float({ nullable: true, resolve: (k) => k.medianGapSec }),
    fastPct: t.exposeInt("fastPct"),
    approvePct: t.exposeInt("approvePct"),
    changesPct: t.exposeInt("changesPct"),
    silentApprovePct: t.exposeInt("silentApprovePct"),
  }),
});

const RowRef = builder.objectRef<ReviewQualityRow>("ReviewQualityRow");
RowRef.implement({
  fields: (t) => ({
    reviewerId: t.exposeString("reviewerId"),
    name: t.exposeString("name"),
    flag: t.exposeString("flag", { description: "NONE | GREEN | AMBER | RED" }),
    reasonsBn: t.exposeStringList("reasonsBn"),
    questions: t.field({ type: KindRef, resolve: (r) => r.questions }),
    plans: t.field({ type: KindRef, resolve: (r) => r.plans }),
  }),
});

builder.queryField("reviewQuality", (t) =>
  t.field({
    type: [RowRef],
    description:
      "Review speed / rubber-stamp flag per reviewer over the last `days` Dhaka days (1..60, default 7). review_stats:view_all or review_program:supervise.",
    authScopes: { hasAnyPermission: ["review_stats:view_all", "review_program:supervise"] },
    args: { days: t.arg.int({ required: false }), reviewerId: t.arg.string({ required: false }) },
    resolve: (_r, a) => {
      const days = a.days ?? 7;
      if (days < 1 || days > 60) throw expectedGraphQLError("days must be between 1 and 60");
      if (a.reviewerId && !Types.ObjectId.isValid(a.reviewerId)) throw expectedGraphQLError("That reviewer id is not valid");
      const toKey = dhakaDayKey(new Date());
      return reviewQuality({ fromKey: addDaysToKey(toKey, -(days - 1)), toKey, reviewerId: a.reviewerId ?? undefined });
    },
  }),
);
