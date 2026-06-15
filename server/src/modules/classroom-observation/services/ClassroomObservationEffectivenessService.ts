/**
 * ClassroomObservationEffectivenessService (CO-7, prd-classroom-observation §CO-7) —
 * a PRIVATE, developmental read on how well the OBSERVERS themselves review. NOT a
 * public scoreboard: surfaced to the Principal (`observation:manage`) only, never to
 * wider staff, never an individual teacher's view of another observer.
 *
 * Five per-observer signals, all DERIVED at read time (D-#85 — nothing stored except
 * the teacher fairness rating, which the teacher writes):
 *   (1) Calibration       — two observers on ONE recording: per-domain agreement WITHIN
 *                           ONE level (REF-11 §1.2). The re-review pipeline (CO-1
 *                           `requestReReview`) is what puts ≥2 observers on a recording.
 *   (2) Timeliness        — assign→review turnaround (days) + current backlog (ASSIGNED,
 *                           not yet reviewed).
 *   (3) Throughput        — reviews completed (released rows the observer reviewed).
 *   (4) Developmental impact — on a teacher's RE-REVIEW, did the domains move up vs the
 *                           prior observation, ATTRIBUTED to the PRIOR observer (gentle,
 *                           low-weight). growthFocus is free text in CO-1, so the proxy
 *                           is overall domain movement on the re-review chain (D-#231).
 *   (5) Teacher fairness  — the observed teacher's 1–5 fairness/usefulness rating of the
 *                           review (NOT agreement) — the only WRITE here (`rateReview`).
 *
 * Staff-only (names observerId/teacherId) — no corpus/student path; the ADR-005 firewall
 * test stays green.
 */
import { Types } from "mongoose";
import { ClassroomObservation, type IClassroomObservation } from "../models/ClassroomObservation";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { ClassroomObservationError } from "./ClassroomObservationService";

const RELEASED_STATES = ["REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"] as const;
const RATING_MIN = 1;
const RATING_MAX = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// rateReview — the observed teacher rates the review (the only write, §CO-7(5))
// ---------------------------------------------------------------------------

export interface RateReviewInput {
  observationId: string;
  /** The authenticated actor — MUST be the observed teacher (obs.teacherId). */
  actorId: string;
  /** 1–5 fairness rating of the REVIEW (not agreement). */
  fairnessRating: number;
  /** 1–5 usefulness rating (optional). */
  usefulnessRating?: number | null;
}

export interface RateReviewResult {
  observationId: string;
  observerId: string | null;
  fairnessRating: number;
  usefulnessRating: number | null;
  fairnessRatedAt: string;
}

function assertRating(v: number, label: string): number {
  if (!Number.isInteger(v) || v < RATING_MIN || v > RATING_MAX) {
    throw new ClassroomObservationError(`${label} must be a whole number ${RATING_MIN}–${RATING_MAX}`);
  }
  return v;
}

/**
 * The observed teacher rates the fairness/usefulness of a RELEASED review (CO-7). Only
 * the observed teacher may rate, only on a REVIEWED / TEACHER_RESPONDED row (they must
 * have seen it). Re-rating overwrites (the latest rating stands). Audited. This is a
 * judgement of the REVIEW, not of agreement with the scores.
 */
export async function rateReview(input: RateReviewInput): Promise<RateReviewResult> {
  const fairness = assertRating(input.fairnessRating, "fairnessRating");
  const usefulness =
    input.usefulnessRating === undefined || input.usefulnessRating === null
      ? null
      : assertRating(input.usefulnessRating, "usefulnessRating");

  const doc = (await ClassroomObservation.findById(input.observationId)) as IClassroomObservation | null;
  if (!doc) throw new ClassroomObservationError("Observation not found");
  if (doc.teacherId.toString() !== input.actorId) {
    throw new ClassroomObservationError("শুধু সংশ্লিষ্ট শিক্ষকই এই পর্যালোচনার মূল্যায়ন করতে পারবেন");
  }
  if (doc.state !== "REVIEWED" && doc.state !== "TEACHER_RESPONDED") {
    throw new ClassroomObservationError("শুধু প্রকাশিত পর্যবেক্ষণের পর্যালোচনাই মূল্যায়ন করা যাবে");
  }

  const now = new Date();
  doc.fairnessRating = fairness;
  doc.usefulnessRating = usefulness;
  doc.fairnessRatedAt = now;
  await doc.save();

  await writeAudit({
    eventKind: "OBSERVATION_REVIEW_RATED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassroomObservation",
    meta: { observerId: doc.observerId ? doc.observerId.toString() : null, fairnessRating: fairness, usefulnessRating: usefulness },
  });

  return {
    observationId: doc._id.toString(),
    observerId: doc.observerId ? doc.observerId.toString() : null,
    fairnessRating: fairness,
    usefulnessRating: usefulness,
    fairnessRatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers — calibration agreement + domain movement
// ---------------------------------------------------------------------------

export interface DomainLevel {
  domain: string;
  level: number;
}

/** Per-domain agreement WITHIN ONE level between two observers' REF-11 scores (§1.2).
 *  Only domains both scored are compared. */
export function agreementWithinOne(
  a: DomainLevel[],
  b: DomainLevel[],
): { compared: number; agreed: number; rate: number | null } {
  const bByDomain = new Map(b.map((d) => [d.domain, d.level]));
  let compared = 0;
  let agreed = 0;
  for (const da of a) {
    const lb = bByDomain.get(da.domain);
    if (lb === undefined) continue;
    compared += 1;
    if (Math.abs(da.level - lb) <= 1) agreed += 1;
  }
  return { compared, agreed, rate: compared === 0 ? null : agreed / compared };
}

/** Domain movement from a prior to a fresh (re-review) observation: how many domains
 *  improved / declined + the net level change. Only domains in both are counted. */
export function domainMovement(
  prior: DomainLevel[],
  fresh: DomainLevel[],
): { improved: number; declined: number; net: number } {
  const priorByDomain = new Map(prior.map((d) => [d.domain, d.level]));
  let improved = 0;
  let declined = 0;
  let net = 0;
  for (const f of fresh) {
    const lp = priorByDomain.get(f.domain);
    if (lp === undefined) continue;
    const delta = f.level - lp;
    net += delta;
    if (delta > 0) improved += 1;
    else if (delta < 0) declined += 1;
  }
  return { improved, declined, net };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => (xs.length === 0 ? null : round2(xs.reduce((s, x) => s + x, 0) / xs.length));

// ---------------------------------------------------------------------------
// reviewerEffectiveness — the per-observer private read (Principal only)
// ---------------------------------------------------------------------------

export interface ReviewerEffectivenessRow {
  observerId: string;
  observerName: string | null;
  /** (3) Throughput — released reviews this observer completed. */
  reviewsCompleted: number;
  /** (2) Timeliness — mean assign→review turnaround (days); null if none timed. */
  avgTurnaroundDays: number | null;
  /** (2) Backlog — ASSIGNED rows still awaiting this observer's review. */
  backlog: number;
  /** (1) Calibration — mean per-domain agreement-within-one over shared recordings. */
  calibrationAgreement: number | null;
  calibrationPairs: number;
  /** (4) Developmental impact — mean domains-improved on re-reviews of this observer's
   *      prior growth focus (attributed to the PRIOR observer). */
  impactAvgDomainsImproved: number | null;
  impactReReviews: number;
  /** (5) Teacher fairness — mean 1–5 fairness / usefulness rating + count. */
  avgFairness: number | null;
  avgUsefulness: number | null;
  ratingsReceived: number;
}

export interface ReviewerEffectiveness {
  now: string;
  observers: ReviewerEffectivenessRow[];
}

const domainLevels = (o: IClassroomObservation): DomainLevel[] =>
  (o.domains ?? []).map((d) => ({ domain: d.domain, level: d.level }));

/**
 * The full per-observer effectiveness read (CO-7) — DERIVED in one pass over the
 * observation set, `now` injected for determinism. Principal-only (the resolver gates
 * `observation:manage`). Returns one row per observer who has ever been assigned.
 */
export async function reviewerEffectiveness(now: Date = new Date()): Promise<ReviewerEffectiveness> {
  const all = (await ClassroomObservation.find({ observerId: { $ne: null } }).lean()) as unknown as IClassroomObservation[];

  // Accumulators keyed by observerId.
  const reviewsCompleted = new Map<string, number>();
  const turnarounds = new Map<string, number[]>();
  const backlog = new Map<string, number>();
  const calibrationRates = new Map<string, number[]>();
  const impactImproved = new Map<string, number[]>();
  const fairness = new Map<string, number[]>();
  const usefulness = new Map<string, number[]>();
  const observerIds = new Set<string>();

  const push = (m: Map<string, number[]>, k: string, v: number) => {
    const list = m.get(k) ?? [];
    list.push(v);
    m.set(k, list);
  };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  const byId = new Map<string, IClassroomObservation>();
  for (const o of all) byId.set(o._id.toString(), o);

  const released = (o: IClassroomObservation) => (RELEASED_STATES as readonly string[]).includes(o.state);

  for (const o of all) {
    const obs = o.observerId ? o.observerId.toString() : null;
    if (!obs) continue;
    observerIds.add(obs);

    // (2) backlog — still ASSIGNED to this observer.
    if (o.state === "ASSIGNED") bump(backlog, obs);

    // (3) throughput + (2) timeliness — released reviews this observer completed.
    if (released(o) && o.reviewedAt) {
      bump(reviewsCompleted, obs);
      if (o.assignedAt) {
        const days = (new Date(o.reviewedAt).getTime() - new Date(o.assignedAt).getTime()) / MS_PER_DAY;
        if (days >= 0) push(turnarounds, obs, days);
      }
    }

    // (5) teacher fairness — a rating the observed teacher left on this observer's review.
    if (o.fairnessRating != null) {
      push(fairness, obs, o.fairnessRating);
      if (o.usefulnessRating != null) push(usefulness, obs, o.usefulnessRating);
    }

    // (4) developmental impact — this row RE-REVIEWS a prior one; attribute the domain
    //     movement to the PRIOR observer (whose growth focus it was). REF-11 only.
    if (o.prevObservationId && o.form === "REF11" && released(o)) {
      const prior = byId.get(o.prevObservationId.toString());
      if (prior && prior.observerId && prior.form === "REF11") {
        const move = domainMovement(domainLevels(prior), domainLevels(o));
        push(impactImproved, prior.observerId.toString(), move.improved);
      }
    }
  }

  // (1) calibration — group released REF-11 rows by recordingId; any recording with ≥2
  //     distinct observers yields per-pair agreement, credited to each observer.
  const byRecording = new Map<string, IClassroomObservation[]>();
  for (const o of all) {
    if (!o.recordingId || o.form !== "REF11" || !released(o)) continue;
    const key = o.recordingId.toString();
    const list = byRecording.get(key) ?? [];
    list.push(o);
    byRecording.set(key, list);
  }
  for (const group of byRecording.values()) {
    // One observation per observer on this recording (latest reviewed wins a duplicate).
    const byObserver = new Map<string, IClassroomObservation>();
    for (const o of group) {
      if (!o.observerId) continue;
      const k = o.observerId.toString();
      const prev = byObserver.get(k);
      if (!prev || (o.reviewedAt && prev.reviewedAt && new Date(o.reviewedAt) > new Date(prev.reviewedAt))) {
        byObserver.set(k, o);
      }
    }
    const entries = [...byObserver.entries()];
    if (entries.length < 2) continue;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [idA, obsA] = entries[i];
        const [idB, obsB] = entries[j];
        const { rate } = agreementWithinOne(domainLevels(obsA), domainLevels(obsB));
        if (rate === null) continue;
        push(calibrationRates, idA, rate);
        push(calibrationRates, idB, rate);
      }
    }
  }

  // Resolve observer names (identity plane → same plane, allowed; no corpus path).
  const ids = [...observerIds];
  const users = (await User.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
    .select("_id name")
    .lean()) as Array<{ _id: Types.ObjectId; name?: string }>;
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name ?? null]));

  const observers: ReviewerEffectivenessRow[] = ids
    .map((observerId) => ({
      observerId,
      observerName: nameById.get(observerId) ?? null,
      reviewsCompleted: reviewsCompleted.get(observerId) ?? 0,
      avgTurnaroundDays: mean(turnarounds.get(observerId) ?? []),
      backlog: backlog.get(observerId) ?? 0,
      calibrationAgreement: mean(calibrationRates.get(observerId) ?? []),
      calibrationPairs: (calibrationRates.get(observerId) ?? []).length,
      impactAvgDomainsImproved: mean(impactImproved.get(observerId) ?? []),
      impactReReviews: (impactImproved.get(observerId) ?? []).length,
      avgFairness: mean(fairness.get(observerId) ?? []),
      avgUsefulness: mean(usefulness.get(observerId) ?? []),
      ratingsReceived: (fairness.get(observerId) ?? []).length,
    }))
    // Most active reviewers first; stable by id.
    .sort((a, b) => b.reviewsCompleted - a.reviewsCompleted || (a.observerId < b.observerId ? -1 : 1));

  return { now: now.toISOString(), observers };
}
