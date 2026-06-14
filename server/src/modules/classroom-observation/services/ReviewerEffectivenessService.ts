/**
 * ReviewerEffectivenessService (CO-7, prd-classroom-observation §CO-7 — the LAST CO
 * slice) — the PRIVATE, developmental "how is this observer doing as a reviewer?" read.
 * Everything here is DERIVED at read time (D-#85 — never stored); `now` is injected for
 * determinism. There is NO write side-effect anywhere in this file (no model.create / no
 * save / no emit / no audit) — the one CO-7 write (the teacher's fairness rating) lives in
 * ClassroomObservationService.rateObservationFairness.
 *
 * Per observer, five aggregates:
 *   1. calibration         — over recordings (`recordingId`) this observer reviewed that
 *                            ALSO carry another observer's released review on the SAME
 *                            recording, the per-domain WITHIN-ONE-LEVEL agreement ratio
 *                            (REF-11 §1.2: |levelA − levelB| ≤ 1 = agree) + the sample.
 *   2. timeliness          — mean/median assigned→reviewed days over this observer's
 *                            reviewed observations + the current backlog (ASSIGNED, not
 *                            yet reviewed) count + oldest age.
 *   3. throughput          — count reviewed (reached REVIEWED) in the last 30 / 90 days.
 *   4. developmentalImpact — over this observer's reviews later RE-reviewed (a newer
 *                            observation's `prevObservationId` points at one of theirs),
 *                            did the PRIOR review's growthFocus domain level improve in the
 *                            new review? improved/same/declined tally — gentle, low-weight,
 *                            attributed to this observer as the PRIOR reviewer.
 *   5. fairness            — mean fairnessRating + count over this observer's reviews that
 *                            received one (SEPARATE from agreement, §CO-7).
 *
 * Surface: Principal/Office (observation:manage) ONLY — the resolver gate. NO observer
 * leaderboard is exposed to wider staff (the §CO-7 guardrail). The heavy lifting lives in
 * PURE helpers (`domainAgreementWithinOne`, `focusDomainOf`, `impactDelta`) so they
 * unit-test without a DB.
 *
 * Identity/operational plane (names observerId/teacherId) — no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { OBSERVATION_DOMAINS } from "@scd/shared";
import type { ObservationDomain } from "@scd/shared";
import { ClassroomObservation, type IClassroomObservation } from "../models/ClassroomObservation";

// ---------------------------------------------------------------------------
// Released-observation state (a teacher-visible, released data point — matches CO-4/CO-6)
// ---------------------------------------------------------------------------

/** State of a released review — a real calibration/throughput/impact data point. */
const RELEASED_STATES = ["REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"] as const;
const RELEASED_SET = new Set<string>(RELEASED_STATES);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ===========================================================================
// PURE helpers (no DB, no clock) — unit-tested directly
// ===========================================================================

/** A minimal domain score the agreement helper reads. */
export interface DomainLevel {
  domain: string;
  level: number;
}

/**
 * The per-domain WITHIN-ONE-LEVEL agreement ratio between two reviews of the SAME
 * recording (REF-11 §1.2). For each domain present in BOTH reviews, |levelA − levelB| ≤ 1
 * counts as agreement. Returns the agreement ratio over the SHARED domains + the shared
 * sample count. No shared domain ⇒ ratio null, count 0 (not a crash, not a 0%).
 */
export function domainAgreementWithinOne(
  a: DomainLevel[],
  b: DomainLevel[],
): { agreed: number; total: number; ratio: number | null } {
  const bByDomain = new Map<string, number>();
  for (const d of b ?? []) bByDomain.set(d.domain, d.level);

  let agreed = 0;
  let total = 0;
  for (const d of a ?? []) {
    if (!bByDomain.has(d.domain)) continue; // only domains scored by BOTH count
    total += 1;
    if (Math.abs(d.level - bByDomain.get(d.domain)!) <= 1) agreed += 1;
  }
  return { agreed, total, ratio: total === 0 ? null : agreed / total };
}

/**
 * The REF-11 domain a free-text `growthFocus` targets, if it names one (PURE). The
 * growthFocus is author free text; when it CONTAINS a canonical domain code (D1..D5,
 * word-bounded, case-insensitive) we attribute the developmental movement to that domain.
 * No recognisable code ⇒ null (the re-review pair is skipped for the impact tally — gentle,
 * never guesses).
 */
export function focusDomainOf(growthFocus: string | null | undefined): ObservationDomain | null {
  const text = (growthFocus ?? "").toUpperCase();
  for (const d of OBSERVATION_DOMAINS) {
    // Word-bounded so "D1" doesn't match "D10"/"AD1" etc. (codes are D1..D5).
    if (new RegExp(`\\b${d}\\b`).test(text)) return d;
  }
  return null;
}

export type ImpactDelta = "improved" | "same" | "declined" | "unknown";

/**
 * The developmental movement on the prior review's growthFocus domain (PURE): the level of
 * that domain in the PRIOR review vs the NEW (re-)review. Improved = new > prior; declined
 * = new < prior; same = equal. `unknown` when the focus names no domain, or either review
 * does not score that domain (can't attribute a movement — left out of the tally).
 */
export function impactDelta(
  priorGrowthFocus: string | null | undefined,
  priorDomains: DomainLevel[],
  currentDomains: DomainLevel[],
): ImpactDelta {
  const focus = focusDomainOf(priorGrowthFocus);
  if (!focus) return "unknown";
  const priorLevel = (priorDomains ?? []).find((d) => d.domain === focus)?.level;
  const currentLevel = (currentDomains ?? []).find((d) => d.domain === focus)?.level;
  if (priorLevel === undefined || currentLevel === undefined) return "unknown";
  if (currentLevel > priorLevel) return "improved";
  if (currentLevel < priorLevel) return "declined";
  return "same";
}

/** Median of a numeric list (sorted-copy; even length ⇒ mean of the two middles). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Round to 2 dp (the wire shape for the derived means/ratios). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ===========================================================================
// Aggregate shapes
// ===========================================================================

export interface CalibrationStats {
  /** Recordings this observer reviewed that ALSO carry another observer's released review. */
  doubleReviewedRecordings: number;
  /** Shared-domain comparisons made across those double-reviewed recordings. */
  comparedDomainScores: number;
  /** Of those, how many agreed within one level (REF-11 §1.2). */
  agreedWithinOne: number;
  /** agreedWithinOne / comparedDomainScores (null when there is no overlap to compare). */
  agreementRatio: number | null;
}

export interface TimelinessStats {
  reviewedCount: number;
  meanDaysToReview: number | null;
  medianDaysToReview: number | null;
  /** Current backlog: ASSIGNED to this observer, not yet reviewed. */
  backlogCount: number;
  /** Age (days) of the oldest backlog item (null when no backlog). */
  oldestBacklogDays: number | null;
}

export interface ThroughputStats {
  reviewedLast30Days: number;
  reviewedLast90Days: number;
}

export interface DevelopmentalImpactStats {
  /** Re-reviewed pairs where the prior focus domain could be attributed (improved+same+declined). */
  attributablePairs: number;
  improved: number;
  same: number;
  declined: number;
}

export interface FairnessStats {
  /** Of this observer's reviews, how many received a teacher fairness rating. */
  ratedCount: number;
  meanRating: number | null;
}

export interface ReviewerEffectiveness {
  observerId: string;
  calibration: CalibrationStats;
  timeliness: TimelinessStats;
  throughput: ThroughputStats;
  developmentalImpact: DevelopmentalImpactStats;
  fairness: FairnessStats;
}

// ===========================================================================
// reviewerEffectiveness (DERIVED read; `now` injected; NO write side-effect)
// ===========================================================================

function domainLevels(o: IClassroomObservation): DomainLevel[] {
  return (o.domains ?? []).map((d) => ({ domain: d.domain, level: d.level }));
}

/**
 * The five CO-7 effectiveness reads for one observer (§CO-7), all DERIVED. `now` is
 * injected for determinism. PRINCIPAL/OFFICE-only (the resolver gate) — never a staff
 * leaderboard.
 */
export async function reviewerEffectiveness(
  observerId: string,
  now: Date = new Date(),
): Promise<ReviewerEffectiveness> {
  const empty: ReviewerEffectiveness = {
    observerId,
    calibration: { doubleReviewedRecordings: 0, comparedDomainScores: 0, agreedWithinOne: 0, agreementRatio: null },
    timeliness: { reviewedCount: 0, meanDaysToReview: null, medianDaysToReview: null, backlogCount: 0, oldestBacklogDays: null },
    throughput: { reviewedLast30Days: 0, reviewedLast90Days: 0 },
    developmentalImpact: { attributablePairs: 0, improved: 0, same: 0, declined: 0 },
    fairness: { ratedCount: 0, meanRating: null },
  };
  if (!Types.ObjectId.isValid(observerId)) return empty;
  const observerOid = new Types.ObjectId(observerId);

  // ---------------------------------------------------------------------------
  // 1. This observer's own observations (released reviews + the open backlog).
  // ---------------------------------------------------------------------------
  const mine = (await ClassroomObservation.find({ observerId: observerOid }).lean()) as unknown as IClassroomObservation[];

  const myReleased = mine.filter((o) => RELEASED_SET.has(o.state));
  const myBacklog = mine.filter((o) => o.state === "ASSIGNED");

  // ---------------------------------------------------------------------------
  // calibration — per shared recording, another observer's released review (§1.2)
  // ---------------------------------------------------------------------------
  const myRecordingIds = [
    ...new Set(myReleased.filter((o) => o.recordingId).map((o) => o.recordingId!.toString())),
  ];
  let doubleReviewedRecordings = 0;
  let comparedDomainScores = 0;
  let agreedWithinOne = 0;
  if (myRecordingIds.length > 0) {
    const peers = (await ClassroomObservation.find({
      recordingId: { $in: myRecordingIds.map((id) => new Types.ObjectId(id)) },
      observerId: { $ne: observerOid },
      state: { $in: RELEASED_STATES as unknown as string[] },
    }).lean()) as unknown as IClassroomObservation[];

    // Group peers by recording; for each of MY released reviews on a recording, compare to
    // every other observer's released review of the same recording.
    const peersByRecording = new Map<string, IClassroomObservation[]>();
    for (const p of peers) {
      if (!p.recordingId) continue;
      const k = p.recordingId.toString();
      const list = peersByRecording.get(k) ?? [];
      list.push(p);
      peersByRecording.set(k, list);
    }
    const recordingsWithOverlap = new Set<string>();
    for (const o of myReleased) {
      if (!o.recordingId) continue;
      const k = o.recordingId.toString();
      const otherReviews = peersByRecording.get(k);
      if (!otherReviews || otherReviews.length === 0) continue;
      recordingsWithOverlap.add(k);
      const a = domainLevels(o);
      for (const other of otherReviews) {
        const cmp = domainAgreementWithinOne(a, domainLevels(other));
        comparedDomainScores += cmp.total;
        agreedWithinOne += cmp.agreed;
      }
    }
    doubleReviewedRecordings = recordingsWithOverlap.size;
  }
  const calibration: CalibrationStats = {
    doubleReviewedRecordings,
    comparedDomainScores,
    agreedWithinOne,
    agreementRatio: comparedDomainScores === 0 ? null : round2(agreedWithinOne / comparedDomainScores),
  };

  // ---------------------------------------------------------------------------
  // timeliness — assigned→reviewed days + the current backlog
  // ---------------------------------------------------------------------------
  const daysToReview: number[] = [];
  for (const o of myReleased) {
    if (!o.assignedAt || !o.reviewedAt) continue;
    const d = (new Date(o.reviewedAt).getTime() - new Date(o.assignedAt).getTime()) / MS_PER_DAY;
    if (d >= 0) daysToReview.push(d);
  }
  const meanDays = daysToReview.length > 0 ? daysToReview.reduce((a, b) => a + b, 0) / daysToReview.length : null;
  const medDays = median(daysToReview);
  let oldestBacklogDays: number | null = null;
  for (const o of myBacklog) {
    const since = o.assignedAt ?? o.createdAt;
    if (!since) continue;
    const age = (now.getTime() - new Date(since).getTime()) / MS_PER_DAY;
    if (oldestBacklogDays === null || age > oldestBacklogDays) oldestBacklogDays = age;
  }
  const timeliness: TimelinessStats = {
    reviewedCount: myReleased.length,
    meanDaysToReview: meanDays === null ? null : round2(meanDays),
    medianDaysToReview: medDays === null ? null : round2(medDays),
    backlogCount: myBacklog.length,
    oldestBacklogDays: oldestBacklogDays === null ? null : Math.floor(oldestBacklogDays),
  };

  // ---------------------------------------------------------------------------
  // throughput — reviews reaching REVIEWED in the last 30 / 90 days from `now`
  // ---------------------------------------------------------------------------
  const cut30 = now.getTime() - 30 * MS_PER_DAY;
  const cut90 = now.getTime() - 90 * MS_PER_DAY;
  let reviewedLast30Days = 0;
  let reviewedLast90Days = 0;
  for (const o of myReleased) {
    if (!o.reviewedAt) continue;
    const t = new Date(o.reviewedAt).getTime();
    if (t > now.getTime()) continue;
    if (t >= cut30) reviewedLast30Days += 1;
    if (t >= cut90) reviewedLast90Days += 1;
  }
  const throughput: ThroughputStats = { reviewedLast30Days, reviewedLast90Days };

  // ---------------------------------------------------------------------------
  // developmentalImpact — re-reviews of MY reviews: did the focus domain improve?
  // ---------------------------------------------------------------------------
  // A newer observation whose prevObservationId points at one of MY reviews carries the
  // movement; attribute to me (the PRIOR reviewer). Look up those re-reviews in one query.
  const myIds = mine.map((o) => o._id);
  let improved = 0;
  let same = 0;
  let declined = 0;
  if (myIds.length > 0) {
    const reReviews = (await ClassroomObservation.find({
      prevObservationId: { $in: myIds },
      state: { $in: RELEASED_STATES as unknown as string[] },
    }).lean()) as unknown as IClassroomObservation[];
    const myById = new Map<string, IClassroomObservation>(mine.map((o) => [o._id.toString(), o]));
    for (const next of reReviews) {
      const prior = next.prevObservationId ? myById.get(next.prevObservationId.toString()) : undefined;
      if (!prior) continue; // defensive (the $in already restricted to mine)
      const delta = impactDelta(prior.growthFocus, domainLevels(prior), domainLevels(next));
      if (delta === "improved") improved += 1;
      else if (delta === "same") same += 1;
      else if (delta === "declined") declined += 1;
      // "unknown" (no attributable focus domain) is left out of the tally — never guessed.
    }
  }
  const developmentalImpact: DevelopmentalImpactStats = {
    attributablePairs: improved + same + declined,
    improved,
    same,
    declined,
  };

  // ---------------------------------------------------------------------------
  // fairness — mean teacher fairness rating over MY reviews that received one
  // ---------------------------------------------------------------------------
  const ratings = mine
    .map((o) => o.fairness?.rating)
    .filter((r): r is number => typeof r === "number");
  const fairness: FairnessStats = {
    ratedCount: ratings.length,
    meanRating: ratings.length === 0 ? null : round2(ratings.reduce((a, b) => a + b, 0) / ratings.length),
  };

  return { observerId, calibration, timeliness, throughput, developmentalImpact, fairness };
}
