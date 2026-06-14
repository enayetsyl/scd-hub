/**
 * ObservationScheduleService (CO-6, prd-classroom-observation §CO-6) — the review
 * SCHEDULER: a "due for review" SUGGESTION list. This NEVER auto-assigns or creates an
 * observation — there is NO write side-effect anywhere in this file (no model.create,
 * no save, no emit). It only DERIVES (D-#85), at read time, who is due.
 *
 * Per teacher with REAL teaching sessions:
 *   - derive `lastReviewedAt` = the max release date over their released observations;
 *   - derive a `SUPPORT_TIERS` tier from review DATA only (REF-11 domains-at-≥3 vs 2/1
 *     + a recent gate BREACH; Quran = avg rating + compliance ratio);
 *   - tier → review interval = baseIntervalDays × the tier multiplier, FLOORED by the
 *     frequency cap (the guardrail);
 *   - never-reviewed (no released observation) → the most-overdue bucket (soonest due).
 * The list is overdue-aware and sorted by tier (Needs-support first) then lateness.
 *
 * Routine/calendar awareness: only teachers with an ACTIVE, NON-break teaching slot in
 * the routine are considered (the RoutineSlot.teacherId set — the CO-4 / HR-G2 source);
 * a teacher with no teaching session is excluded entirely. (Teaching-DAY filtering of
 * the due date is left to the consuming view — the suggestion is the date, not a
 * calendar event; the routine slot set already restricts WHO is in scope.)
 *
 * Config (admin-tunable, ObservationScheduleConfig; read-time defaults, no seed —
 * D-#97). `setObservationScheduleConfig` is gated `observation:manage` in the resolver
 * and audited here.
 *
 * The tier is a SUPPORT signal, NEVER a ranking; the list is visible to Principal/
 * Office/observers, not wider staff (the resolver gate). Identity/operational plane
 * (names teacherId) — no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import type { SupportTier } from "@scd/shared";
import { ClassroomObservation, type IClassroomObservation } from "../models/ClassroomObservation";
import {
  ObservationScheduleConfig,
  type IObservationScheduleConfig,
} from "../models/ObservationScheduleConfig";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { writeAudit } from "../../platform/services/AuditService";
import { ClassroomObservationError } from "./ClassroomObservationService";

// ---------------------------------------------------------------------------
// Released-observation state (a teacher-visible data point — matches CO-4)
// ---------------------------------------------------------------------------

/** State of a released (reviewed, data-point) observation. */
const RELEASED_STATES = ["REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"] as const;

// ---------------------------------------------------------------------------
// Config (admin-tunable; read-time defaults, no seed write — D-#97)
// ---------------------------------------------------------------------------

export interface ScheduleConfigValues {
  /** The DEVELOPING (base) review interval, days. */
  baseIntervalDays: number;
  /** STRONG-tier multiplier (longest cadence). */
  strongMultiplier: number;
  /** DEVELOPING-tier multiplier (base). */
  developingMultiplier: number;
  /** NEEDS_SUPPORT-tier multiplier (shortest cadence). */
  needsSupportMultiplier: number;
  /** Guardrail: the minimum days between suggested reviews (floors the interval). */
  frequencyCapDays: number;
}

/** The CO-6 default cadence: 30-day base, ×2 / ×1 / ×0.5 tiers, 14-day cap. */
export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfigValues = {
  baseIntervalDays: 30,
  strongMultiplier: 2,
  developingMultiplier: 1,
  needsSupportMultiplier: 0.5,
  frequencyCapDays: 14,
};

export interface EffectiveScheduleConfig extends ScheduleConfigValues {
  /** True when no admin row exists and the working defaults apply. */
  isDefault: boolean;
}

/** The cadence in force: the singleton row, else the working defaults (D-#97). */
export async function getScheduleConfig(): Promise<EffectiveScheduleConfig> {
  const row = (await ObservationScheduleConfig.findOne({ key: "SINGLETON" }).lean()) as
    | IObservationScheduleConfig
    | null;
  if (row) {
    return {
      baseIntervalDays: row.baseIntervalDays,
      strongMultiplier: row.strongMultiplier,
      developingMultiplier: row.developingMultiplier,
      needsSupportMultiplier: row.needsSupportMultiplier,
      frequencyCapDays: row.frequencyCapDays,
      isDefault: false,
    };
  }
  return { ...DEFAULT_SCHEDULE_CONFIG, isDefault: true };
}

/**
 * Set the admin cadence (observation:manage — gated by the resolver). `baseIntervalDays`
 * + `frequencyCapDays` are whole days ≥ 1; the three multipliers are finite numbers ≥ 0.
 * To keep the tiers ordered the way the PRD intends (Strong = longest, Needs-support =
 * shortest), we require strongMultiplier ≥ developingMultiplier ≥ needsSupportMultiplier.
 * Audited.
 */
export async function setScheduleConfig(
  values: ScheduleConfigValues,
  actorId: string,
): Promise<EffectiveScheduleConfig> {
  for (const key of ["baseIntervalDays", "frequencyCapDays"] as const) {
    const v = values[key];
    if (!Number.isInteger(v) || v < 1) {
      throw new ClassroomObservationError(`${key} must be a whole number of days ≥ 1`);
    }
  }
  for (const key of ["strongMultiplier", "developingMultiplier", "needsSupportMultiplier"] as const) {
    const v = values[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new ClassroomObservationError(`${key} must be a number ≥ 0`);
    }
  }
  if (
    !(
      values.strongMultiplier >= values.developingMultiplier &&
      values.developingMultiplier >= values.needsSupportMultiplier
    )
  ) {
    throw new ClassroomObservationError(
      "Multipliers must order the cadence Strong ≥ Developing ≥ Needs-support (Strong = longest interval)",
    );
  }
  await ObservationScheduleConfig.updateOne({ key: "SINGLETON" }, { $set: { ...values } }, { upsert: true });
  await writeAudit({
    eventKind: "OBSERVATION_SCHEDULE_CONFIG_SET",
    actorId,
    targetKind: "ObservationScheduleConfig",
    meta: { ...values },
  });
  return getScheduleConfig();
}

// ---------------------------------------------------------------------------
// Tiering (PURE, derived, deterministic — no DB, no clock)
// ---------------------------------------------------------------------------

/** The minimal review signal the tiering reads (a released observation's payload). */
export interface ReviewSignal {
  form: string; // REF11 | QURAN
  /** REF-11 domain levels (1–4) on this review. */
  domains: Array<{ level: number }>;
  /** REF-11 gate results on this review (PASS | BREACH). */
  gates: Array<{ result: string }>;
  /** Quran ratings (1–5) on this review (QURAN form only). */
  quranRatings: number[];
  /** Quran compliance answers (true = yes) on this review (QURAN form only). */
  quranCompliance: boolean[];
}

/**
 * The support tier derived from a teacher's recent released reviews (PURE, §CO-6).
 * Read from review DATA only — never a ranking.
 *
 * REF-11 signal: across the reviews, the share of domain scores at the WORKING STANDARD
 * (level ≥ 3) vs below (2/1). A recent gate BREACH pulls toward NEEDS_SUPPORT.
 * Quran signal: the average rating (1–5) + the compliance YES ratio.
 *
 * Deterministic, documented thresholds (read-time; no seed):
 *   - ANY gate BREACH in the recent reviews ⇒ NEEDS_SUPPORT (a breach stands on its own).
 *   - else, combine each present signal into a 0..1 "strength":
 *       REF-11 strength  = (count of domain levels ≥ 3) / (total domain levels);
 *       Quran  strength  = 0.5·((avgRating − 1)/4) + 0.5·(complianceYesRatio).
 *     The teacher's strength = the mean of whichever signals are present.
 *   - strength ≥ 0.75 ⇒ STRONG; strength ≥ 0.45 ⇒ DEVELOPING; else NEEDS_SUPPORT.
 *
 * No reviews ⇒ `null` (a never-reviewed teacher is NOT a tier — the due-list treats them
 * as most-overdue, not a tier crash).
 */
export function tierForTeacher(reviews: ReviewSignal[]): SupportTier | null {
  if (!reviews || reviews.length === 0) return null;

  // A recent gate BREACH pulls straight to NEEDS_SUPPORT (REF-11 §2.1 posture).
  const hasBreach = reviews.some((r) => (r.gates ?? []).some((g) => g.result === "BREACH"));
  if (hasBreach) return "NEEDS_SUPPORT";

  const strengths: number[] = [];

  // REF-11 strength: share of domain levels at the working standard (≥ 3).
  let domainTotal = 0;
  let domainAtStandard = 0;
  for (const r of reviews) {
    for (const d of r.domains ?? []) {
      domainTotal += 1;
      if (d.level >= 3) domainAtStandard += 1;
    }
  }
  if (domainTotal > 0) strengths.push(domainAtStandard / domainTotal);

  // Quran strength: avg rating (normalised 1..5 → 0..1) + compliance YES ratio.
  let ratingSum = 0;
  let ratingCount = 0;
  let compYes = 0;
  let compCount = 0;
  for (const r of reviews) {
    for (const s of r.quranRatings ?? []) {
      ratingSum += s;
      ratingCount += 1;
    }
    for (const c of r.quranCompliance ?? []) {
      compCount += 1;
      if (c) compYes += 1;
    }
  }
  if (ratingCount > 0 || compCount > 0) {
    const avgRatingNorm = ratingCount > 0 ? (ratingSum / ratingCount - 1) / 4 : 0;
    const compRatio = compCount > 0 ? compYes / compCount : 0;
    // Weight each present sub-signal equally; if only one is present, use it alone.
    if (ratingCount > 0 && compCount > 0) {
      strengths.push(0.5 * avgRatingNorm + 0.5 * compRatio);
    } else if (ratingCount > 0) {
      strengths.push(avgRatingNorm);
    } else {
      strengths.push(compRatio);
    }
  }

  // No scored signal at all (reviews exist but carry no domains/ratings) ⇒ treat as the
  // base tier (a recorded-but-empty review is not evidence of weakness or strength).
  if (strengths.length === 0) return "DEVELOPING";

  const strength = strengths.reduce((a, b) => a + b, 0) / strengths.length;
  if (strength >= 0.75) return "STRONG";
  if (strength >= 0.45) return "DEVELOPING";
  return "NEEDS_SUPPORT";
}

// ---------------------------------------------------------------------------
// Interval math (PURE)
// ---------------------------------------------------------------------------

/** Tier rank for sorting the due list — Needs-support first (most urgent). */
const TIER_RANK: Record<SupportTier, number> = {
  NEEDS_SUPPORT: 0,
  DEVELOPING: 1,
  STRONG: 2,
};

/** Whole CALENDAR days between two instants (floor; no school-calendar lookup). */
export function calendarDaysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.floor((to.getTime() - new Date(from).getTime()) / MS_PER_DAY);
}

/**
 * The review interval (days) for a tier under a config (PURE): base × the tier
 * multiplier, then FLOORED by the frequency cap (the guardrail — never suggest more
 * often than the cap). A null tier (never-reviewed) uses the NEEDS_SUPPORT multiplier so
 * the soonest-bucket interval is the shortest.
 */
export function intervalForTier(tier: SupportTier | null, cfg: ScheduleConfigValues): number {
  const mult =
    tier === "STRONG"
      ? cfg.strongMultiplier
      : tier === "DEVELOPING"
        ? cfg.developingMultiplier
        : cfg.needsSupportMultiplier; // NEEDS_SUPPORT + null (never-reviewed)
  const raw = cfg.baseIntervalDays * mult;
  return Math.max(Math.round(raw), cfg.frequencyCapDays);
}

// ---------------------------------------------------------------------------
// Due list (DERIVED read; NO write side-effect — suggestion only)
// ---------------------------------------------------------------------------

export interface DueRow {
  teacherId: string;
  /** The derived tier, or null when never-reviewed (the soonest bucket). */
  tier: SupportTier | null;
  /** Max release date over the teacher's released observations (null = never). */
  lastReviewedAt: string | null;
  /** Count of released observations contributing the tier signal. */
  reviewCount: number;
  /** The interval (days) applied to this teacher (base × tier mult, capped). */
  intervalDays: number;
  /** The suggested next-review date (YYYY-MM-DD), null for a never-reviewed teacher. */
  dueDate: string | null;
  /** Days overdue (now − dueDate); never-reviewed sorts most-overdue. */
  overdueDays: number;
  /** True when overdueDays > 0 (or never-reviewed). */
  overdue: boolean;
  /** True when the teacher has never been reviewed (soonest bucket). */
  neverReviewed: boolean;
}

/** The release date of an observation (reviewedAt, falling back to updatedAt). */
function releaseDate(o: IClassroomObservation): Date {
  return new Date(o.reviewedAt ?? o.updatedAt ?? o.createdAt);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** The overdue sentinel for a never-reviewed teacher — sorts most-overdue, 32-bit-safe
 *  (GraphQL Int). Larger than any realistic real overdue-days count. */
const NEVER_REVIEWED_OVERDUE = 1_000_000_000;
/** YYYY-MM-DD (UTC) of an instant — the due-date wire shape. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A ReviewSignal projected from a stored released observation (for the tiering). */
function signalOf(o: IClassroomObservation): ReviewSignal {
  return {
    form: o.form,
    domains: (o.domains ?? []).map((d) => ({ level: d.level })),
    gates: (o.gates ?? []).map((g) => ({ result: g.result })),
    quranRatings: (o.quran?.ratings ?? []).map((r) => r.score),
    quranCompliance: (o.quran?.compliance ?? []).map((c) => c.yesNo),
  };
}

/**
 * The "due for review" suggestion list (CO-6, §CO-6). DERIVED — NO write, NEVER creates
 * or assigns an observation. `now` is injected for determinism.
 *
 * 1. Scope: teachers with an ACTIVE, NON-break teaching slot (RoutineSlot.teacherId).
 * 2. Per teacher: lastReviewedAt (max release date), tier (from released reviews),
 *    interval (base × tier mult, capped), dueDate = lastReviewedAt + interval,
 *    overdueDays = now − dueDate. Never-reviewed ⇒ most-overdue bucket.
 * 3. Sort: tier (Needs-support first, then Developing, then Strong; never-reviewed ranks
 *    with Needs-support), then overdueDays desc, then teacherId for stability.
 */
export async function observationDueList(now: Date = new Date()): Promise<DueRow[]> {
  // 1. Teachers with a real teaching session (active, non-break slot with a teacher).
  const slotTeacherIds = (await RoutineSlot.find({
    active: true,
    isBreak: false,
    teacherId: { $ne: null },
  })
    .distinct("teacherId")) as unknown as Types.ObjectId[];

  const teacherIds = [...new Set(slotTeacherIds.map((id) => id.toString()))];
  if (teacherIds.length === 0) return [];

  // 2. Their released observations (one query, grouped in memory).
  const docs = (await ClassroomObservation.find({
    teacherId: { $in: teacherIds.map((id) => new Types.ObjectId(id)) },
    state: { $in: RELEASED_STATES as unknown as string[] },
  }).lean()) as unknown as IClassroomObservation[];

  const byTeacher = new Map<string, IClassroomObservation[]>();
  for (const d of docs) {
    const k = d.teacherId.toString();
    const list = byTeacher.get(k) ?? [];
    list.push(d);
    byTeacher.set(k, list);
  }

  const cfg = await getScheduleConfig();

  const rows: DueRow[] = teacherIds.map((teacherId) => {
    const reviews = byTeacher.get(teacherId) ?? [];
    const reviewCount = reviews.length;

    if (reviewCount === 0) {
      // Never reviewed → the soonest / most-overdue bucket (not a tier crash).
      return {
        teacherId,
        tier: null,
        lastReviewedAt: null,
        reviewCount: 0,
        intervalDays: intervalForTier(null, cfg),
        dueDate: null,
        // A never-reviewed teacher is the MOST overdue (soonest bucket). A large but
        // 32-bit-safe sentinel keeps GraphQL Int happy while still sorting first.
        overdueDays: NEVER_REVIEWED_OVERDUE,
        overdue: true,
        neverReviewed: true,
      };
    }

    const lastReviewed = reviews
      .map(releaseDate)
      .reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
    const tier = tierForTeacher(reviews.map(signalOf));
    const intervalDays = intervalForTier(tier, cfg);
    const due = new Date(lastReviewed.getTime() + intervalDays * MS_PER_DAY);
    const overdueDays = Math.floor((now.getTime() - due.getTime()) / MS_PER_DAY);

    return {
      teacherId,
      tier,
      lastReviewedAt: lastReviewed.toISOString(),
      reviewCount,
      intervalDays,
      dueDate: ymd(due),
      overdueDays,
      overdue: overdueDays > 0,
      neverReviewed: false,
    };
  });

  // 3. Sort: tier (Needs-support first; never-reviewed ranks with Needs-support), then
  //    overdueDays desc, then teacherId for a stable order.
  const tierRank = (r: DueRow): number => (r.tier === null ? TIER_RANK.NEEDS_SUPPORT : TIER_RANK[r.tier]);
  rows.sort((a, b) => {
    if (tierRank(a) !== tierRank(b)) return tierRank(a) - tierRank(b);
    if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
    return a.teacherId < b.teacherId ? -1 : a.teacherId > b.teacherId ? 1 : 0;
  });

  return rows;
}
