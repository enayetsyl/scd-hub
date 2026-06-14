/**
 * Classroom-observation REVIEWER-EFFECTIVENESS resolver (CO-7, prd-classroom-observation
 * §CO-7 — the LAST CO slice). The PRIVATE, developmental "how is this observer doing?"
 * read. All five aggregates are DERIVED (D-#85) — nothing stored, no mutation here, no new
 * audit kind, NO new permission (reuses CO-1's observation:manage; the fairness CAPTURE
 * mutation lives with the other observation mutations and reuses observation:read).
 *
 * RBAC — `observation:manage` ONLY (Principal/Office). This is the §CO-7 "Principal only"
 * surface: there is NO observer leaderboard for wider staff and NO self-serve view (an
 * observer does NOT get their own effectiveness here). GUARDIAN holds no observation:*
 * permission, so is rejected at the scope layer (§7).
 *
 * Identity/operational plane (names observerId/teacherId); no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import {
  reviewerEffectiveness,
  type ReviewerEffectiveness,
  type CalibrationStats,
  type TimelinessStats,
  type ThroughputStats,
  type DevelopmentalImpactStats,
  type FairnessStats,
} from "../services/ReviewerEffectivenessService";

// ---------------------------------------------------------------------------
// GraphQL shapes — the five private/developmental aggregates (§CO-7)
// ---------------------------------------------------------------------------

const CalibrationRef = builder.objectRef<CalibrationStats>("ReviewerCalibration");
CalibrationRef.implement({
  description:
    "Calibration (REF-11 §1.2): over recordings this observer co-reviewed with another observer, the per-domain " +
    "within-one-level agreement ratio (|Δlevel| ≤ 1 = agree) + the sample. Null ratio when there is no overlap.",
  fields: (t) => ({
    doubleReviewedRecordings: t.exposeInt("doubleReviewedRecordings"),
    comparedDomainScores: t.exposeInt("comparedDomainScores"),
    agreedWithinOne: t.exposeInt("agreedWithinOne"),
    agreementRatio: t.float({ nullable: true, resolve: (r) => r.agreementRatio }),
  }),
});

const TimelinessRef = builder.objectRef<TimelinessStats>("ReviewerTimeliness");
TimelinessRef.implement({
  description:
    "Timeliness: mean/median assigned→reviewed days over this observer's reviewed observations + the current " +
    "backlog (ASSIGNED, not yet reviewed) count and oldest age.",
  fields: (t) => ({
    reviewedCount: t.exposeInt("reviewedCount"),
    meanDaysToReview: t.float({ nullable: true, resolve: (r) => r.meanDaysToReview }),
    medianDaysToReview: t.float({ nullable: true, resolve: (r) => r.medianDaysToReview }),
    backlogCount: t.exposeInt("backlogCount"),
    oldestBacklogDays: t.int({ nullable: true, resolve: (r) => r.oldestBacklogDays }),
  }),
});

const ThroughputRef = builder.objectRef<ThroughputStats>("ReviewerThroughput");
ThroughputRef.implement({
  description: "Throughput: reviews this observer completed (reached REVIEWED) in the last 30 / 90 days.",
  fields: (t) => ({
    reviewedLast30Days: t.exposeInt("reviewedLast30Days"),
    reviewedLast90Days: t.exposeInt("reviewedLast90Days"),
  }),
});

const ImpactRef = builder.objectRef<DevelopmentalImpactStats>("ReviewerDevelopmentalImpact");
ImpactRef.implement({
  description:
    "Developmental impact (gentle, low-weight): over this observer's reviews later re-reviewed, did the prior " +
    "review's growthFocus domain level improve in the new review? improved/same/declined tally, attributed to " +
    "this observer as the PRIOR reviewer. Pairs with no attributable focus domain are left out.",
  fields: (t) => ({
    attributablePairs: t.exposeInt("attributablePairs"),
    improved: t.exposeInt("improved"),
    same: t.exposeInt("same"),
    declined: t.exposeInt("declined"),
  }),
});

const FairnessAggRef = builder.objectRef<FairnessStats>("ReviewerFairnessAggregate");
FairnessAggRef.implement({
  description:
    "Teacher fairness rating aggregate: mean fairnessRating (1–5) + count over this observer's reviews that " +
    "received one. SEPARATE from calibration agreement (§CO-7) — a teacher may disagree yet rate the review fair.",
  fields: (t) => ({
    ratedCount: t.exposeInt("ratedCount"),
    meanRating: t.float({ nullable: true, resolve: (r) => r.meanRating }),
  }),
});

const ReviewerEffectivenessRef = builder.objectRef<ReviewerEffectiveness>("ReviewerEffectiveness");
ReviewerEffectivenessRef.implement({
  description:
    "One observer's PRIVATE/developmental reviewer-effectiveness read (CO-7, §CO-7): calibration + timeliness + " +
    "throughput + developmental impact + teacher fairness. All DERIVED (D-#85). Principal/Office only — never a " +
    "staff leaderboard. Identity plane (ADR-005).",
  fields: (t) => ({
    observerId: t.exposeString("observerId"),
    calibration: t.field({ type: CalibrationRef, resolve: (r) => r.calibration }),
    timeliness: t.field({ type: TimelinessRef, resolve: (r) => r.timeliness }),
    throughput: t.field({ type: ThroughputRef, resolve: (r) => r.throughput }),
    developmentalImpact: t.field({ type: ImpactRef, resolve: (r) => r.developmentalImpact }),
    fairness: t.field({ type: FairnessAggRef, resolve: (r) => r.fairness }),
  }),
});

// ---------------------------------------------------------------------------
// Query — observation:manage ONLY (Principal/Office; no staff leaderboard)
// ---------------------------------------------------------------------------

builder.queryField("reviewerEffectiveness", (t) =>
  t.field({
    type: ReviewerEffectivenessRef,
    description:
      "One observer's private/developmental reviewer-effectiveness (CO-7, §CO-7): calibration, timeliness, " +
      "throughput, developmental impact, and teacher fairness — all DERIVED. Requires observation:manage " +
      "(Principal/Office ONLY); there is no observer leaderboard for wider staff and no self-serve view.",
    authScopes: { hasPermission: "observation:manage" },
    args: { observerId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => reviewerEffectiveness(args.observerId, new Date()),
  }),
);
