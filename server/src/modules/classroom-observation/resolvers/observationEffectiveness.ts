/**
 * Classroom-observation REVIEWER-EFFECTIVENESS resolvers (CO-7, prd-classroom-observation
 * §CO-7). Two surfaces:
 *   - `rateObservationReview` (mutation) — the observed teacher rates the REVIEW's
 *     fairness/usefulness. Gated `observation:read`; the service enforces the
 *     observed-teacher + released-state checks (the CO-3 respond pattern). The teacher
 *     already holds observation:read at/after REVIEWED.
 *   - `reviewerEffectiveness` (query) — the PRIVATE per-observer developmental read
 *     (calibration / timeliness / throughput / impact / fairness). Gated
 *     `observation:manage` (Principal/Office) — NOT a public scoreboard, never wider
 *     staff (§CO-7).
 *
 * Staff-internal — GUARDIAN holds no observation:* permission (§7). Identity plane
 * (names observerId/teacherId); no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  rateReview,
  reviewerEffectiveness,
  type RateReviewResult,
  type ReviewerEffectiveness,
  type ReviewerEffectivenessRow,
} from "../services/ClassroomObservationEffectivenessService";

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

const RateReviewResultRef = builder.objectRef<RateReviewResult>("ObservationReviewRating");
RateReviewResultRef.implement({
  description:
    "The observed teacher's fairness/usefulness rating of a review (CO-7, §CO-7(5)) — a judgement of the REVIEW, " +
    "not agreement with the scores.",
  fields: (t) => ({
    observationId: t.exposeString("observationId"),
    observerId: t.string({ nullable: true, resolve: (r) => r.observerId }),
    fairnessRating: t.exposeInt("fairnessRating"),
    usefulnessRating: t.int({ nullable: true, resolve: (r) => r.usefulnessRating }),
    fairnessRatedAt: t.exposeString("fairnessRatedAt"),
  }),
});

const ReviewerRowRef = builder.objectRef<ReviewerEffectivenessRow>("ReviewerEffectivenessRow");
ReviewerRowRef.implement({
  description:
    "One observer's private developmental signals (CO-7, §CO-7): throughput, timeliness + backlog, calibration " +
    "agreement-within-one, developmental impact on re-reviews, and the teacher fairness/usefulness ratings received.",
  fields: (t) => ({
    observerId: t.exposeString("observerId"),
    observerName: t.string({ nullable: true, resolve: (r) => r.observerName }),
    reviewsCompleted: t.exposeInt("reviewsCompleted"),
    avgTurnaroundDays: t.float({ nullable: true, resolve: (r) => r.avgTurnaroundDays }),
    backlog: t.exposeInt("backlog"),
    calibrationAgreement: t.float({ nullable: true, resolve: (r) => r.calibrationAgreement }),
    calibrationPairs: t.exposeInt("calibrationPairs"),
    impactAvgDomainsImproved: t.float({ nullable: true, resolve: (r) => r.impactAvgDomainsImproved }),
    impactReReviews: t.exposeInt("impactReReviews"),
    avgFairness: t.float({ nullable: true, resolve: (r) => r.avgFairness }),
    avgUsefulness: t.float({ nullable: true, resolve: (r) => r.avgUsefulness }),
    ratingsReceived: t.exposeInt("ratingsReceived"),
  }),
});

const ReviewerEffectivenessRef = builder.objectRef<ReviewerEffectiveness>("ReviewerEffectiveness");
ReviewerEffectivenessRef.implement({
  description:
    "The private reviewer-effectiveness read (CO-7, §CO-7) — one row per observer, most active first. Principal/" +
    "Office only; NOT a public scoreboard.",
  fields: (t) => ({
    now: t.exposeString("now"),
    observers: t.field({ type: [ReviewerRowRef], resolve: (r) => r.observers }),
  }),
});

// ---------------------------------------------------------------------------
// Mutation — the observed teacher rates the review (observation:read; service-gated)
// ---------------------------------------------------------------------------

builder.mutationField("rateObservationReview", (t) =>
  t.field({
    type: RateReviewResultRef,
    description:
      "The observed teacher rates a released review's fairness (+ optional usefulness), 1–5 (CO-7, §CO-7(5)). " +
      "Requires observation:read; the service enforces the observed-teacher + released-state checks. Audited.",
    authScopes: { hasPermission: "observation:read" },
    args: {
      observationId: t.arg.string({ required: true }),
      fairnessRating: t.arg.int({ required: true }),
      usefulnessRating: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx: AppContext) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return rateReview({
        observationId: args.observationId,
        actorId: ctx.auth.userId as string,
        fairnessRating: args.fairnessRating,
        usefulnessRating: args.usefulnessRating ?? null,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Query — the private per-observer effectiveness read (observation:manage)
// ---------------------------------------------------------------------------

builder.queryField("reviewerEffectiveness", (t) =>
  t.field({
    type: ReviewerEffectivenessRef,
    description:
      "The private reviewer-effectiveness read across observers (CO-7, §CO-7). Requires observation:manage " +
      "(Principal/Office) — never exposed to wider staff.",
    authScopes: { hasPermission: "observation:manage" },
    resolve: async () => reviewerEffectiveness(),
  }),
);
