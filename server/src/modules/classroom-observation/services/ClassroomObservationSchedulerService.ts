/**
 * ClassroomObservationSchedulerService (CO-6, prd-classroom-observation §CO-6) — the
 * review-cadence SCHEDULER that SUGGESTS who's due for a classroom review. It never
 * auto-assigns (the §CO-6 guardrail): the output is a ranked "due for review" list;
 * Principal/Office still decide and assign (CO-1).
 *
 * Everything here is DERIVED at read time (D-#85 — never stored). A teacher's
 * SUPPORT_TIER comes from their most recent RELEASED review:
 *   REF-11 → a recent gate BREACH or any domain at level 1 ⇒ NEEDS_SUPPORT; all
 *            domains ≥3 (working standard) ⇒ STRONG; otherwise DEVELOPING.
 *   Quran  → average rating ≥4 with full compliance ⇒ STRONG; average ≤2.5 or
 *            <half compliance ⇒ NEEDS_SUPPORT; otherwise DEVELOPING.
 * The tier sets the review INTERVAL (ObservationScheduleConfig): DEVELOPING = base,
 * STRONG = base × strongMultiplier (longest), NEEDS_SUPPORT = base × needsSupportMultiplier
 * (shortest), clamped up to the `minIntervalDays` frequency cap.
 *
 * Routine/calendar-aware: only teachers with REAL teaching sessions are candidates —
 * the distinct `teacherId` over active, non-break RoutineSlots. A never-reviewed teacher
 * goes to the soonest bucket. The list is sorted weakest/most-overdue first.
 *
 * Tier is derived from REVIEW DATA ONLY (the §CO-6 guardrail). Staff-only (names a
 * teacherId) — no corpus/student path; the ADR-005 firewall test stays green.
 */
import { Types } from "mongoose";
import { SUPPORT_TIERS } from "@scd/shared";
import type { SupportTier } from "@scd/shared";
import { ClassroomObservation, type IClassroomObservation } from "../models/ClassroomObservation";
import {
  ObservationScheduleConfig,
  type IObservationScheduleConfig,
} from "../models/ObservationScheduleConfig";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { writeAudit } from "../../platform/services/AuditService";
import { ClassroomObservationError } from "./ClassroomObservationService";
import { calendarDaysBetween } from "./ObservationEscalationService";

// ---------------------------------------------------------------------------
// Released-observation states (matches the CO-4 trend + canReadObservation set)
// ---------------------------------------------------------------------------

const RELEASED_STATES = ["REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"] as const;

// ---------------------------------------------------------------------------
// Config (admin-tunable cadence; read-time defaults, no seed write — D-#97)
// ---------------------------------------------------------------------------

export interface ScheduleConfigValues {
  /** The DEVELOPING (base) review interval, calendar days. */
  baseIntervalDays: number;
  /** STRONG interval = base × this (≥1 → longest cadence). */
  strongMultiplier: number;
  /** NEEDS_SUPPORT interval = base × this (0<·≤1 → shortest cadence). */
  needsSupportMultiplier: number;
  /** Frequency cap (calendar days) — never suggest more often than this. */
  minIntervalDays: number;
}

/** The CO-6 default cadence: DEVELOPING every 30 days, STRONG ×2 (60), NEEDS_SUPPORT
 *  ×0.5 (15), never more often than every 7 days. */
export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfigValues = {
  baseIntervalDays: 30,
  strongMultiplier: 2,
  needsSupportMultiplier: 0.5,
  minIntervalDays: 7,
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
      needsSupportMultiplier: row.needsSupportMultiplier,
      minIntervalDays: row.minIntervalDays,
      isDefault: false,
    };
  }
  return { ...DEFAULT_SCHEDULE_CONFIG, isDefault: true };
}

/**
 * Set the admin cadence (observation:manage — gated by the resolver). The base + cap are
 * whole calendar days ≥ 1; strongMultiplier ≥ 1 (STRONG is the longest); needsSupportMultiplier
 * in (0, 1] (NEEDS_SUPPORT is the shortest). Together they keep the tier ordering
 * STRONG ≥ DEVELOPING ≥ NEEDS_SUPPORT. Audited.
 */
export async function setScheduleConfig(
  values: ScheduleConfigValues,
  actorId: string,
): Promise<EffectiveScheduleConfig> {
  for (const key of ["baseIntervalDays", "minIntervalDays"] as const) {
    const v = values[key];
    if (!Number.isInteger(v) || v < 1) {
      throw new ClassroomObservationError(`${key} must be a whole number of days ≥ 1`);
    }
  }
  if (!(typeof values.strongMultiplier === "number" && values.strongMultiplier >= 1)) {
    throw new ClassroomObservationError("strongMultiplier must be ≥ 1 (STRONG is the longest interval)");
  }
  if (
    !(
      typeof values.needsSupportMultiplier === "number" &&
      values.needsSupportMultiplier > 0 &&
      values.needsSupportMultiplier <= 1
    )
  ) {
    throw new ClassroomObservationError(
      "needsSupportMultiplier must be in (0, 1] (NEEDS_SUPPORT is the shortest interval)",
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
// Pure: tier derivation + interval (no DB/clock)
// ---------------------------------------------------------------------------

/**
 * Derive a teacher's support tier from their most recent RELEASED review (pure).
 * REF-11 reads the domain levels + a gate breach; Quran reads the average rating +
 * compliance. A row with no usable payload defaults to DEVELOPING (the base cadence).
 */
export function deriveTier(obs: Pick<IClassroomObservation, "form" | "domains" | "gates" | "quran">): SupportTier {
  if (obs.form === "QURAN") {
    const ratings = obs.quran?.ratings ?? [];
    const compliance = obs.quran?.compliance ?? [];
    if (ratings.length === 0) return "DEVELOPING";
    const avg = ratings.reduce((s, r) => s + r.score, 0) / ratings.length;
    const yes = compliance.filter((c) => c.yesNo).length;
    const complianceRatio = compliance.length === 0 ? 1 : yes / compliance.length;
    const allCompliant = compliance.length > 0 && yes === compliance.length;
    if (avg <= 2.5 || complianceRatio < 0.5) return "NEEDS_SUPPORT";
    if (avg >= 4 && allCompliant) return "STRONG";
    return "DEVELOPING";
  }
  // REF-11
  const domains = obs.domains ?? [];
  const gates = obs.gates ?? [];
  const hasBreach = gates.some((g) => g.result === "BREACH");
  if (hasBreach) return "NEEDS_SUPPORT";
  if (domains.length === 0) return "DEVELOPING";
  if (domains.some((d) => d.level === 1)) return "NEEDS_SUPPORT";
  if (domains.every((d) => d.level >= 3)) return "STRONG";
  return "DEVELOPING";
}

/** Tier → review interval (calendar days), clamped up to the frequency cap (pure). */
export function intervalForTier(tier: SupportTier, cfg: ScheduleConfigValues): number {
  const base = cfg.baseIntervalDays;
  const raw =
    tier === "STRONG" ? base * cfg.strongMultiplier : tier === "NEEDS_SUPPORT" ? base * cfg.needsSupportMultiplier : base;
  return Math.max(cfg.minIntervalDays, Math.floor(raw));
}

/** Tier severity for ranking — NEEDS_SUPPORT (weakest) first. */
function tierSeverity(tier: SupportTier): number {
  return tier === "NEEDS_SUPPORT" ? 0 : tier === "DEVELOPING" ? 1 : 2;
}

// ---------------------------------------------------------------------------
// dueForReview — the routine-aware "due for review" list
// ---------------------------------------------------------------------------

export interface DueReviewItem {
  teacherId: string;
  /** Tier from the most recent review; null when never reviewed. */
  tier: SupportTier | null;
  /** Most recent release timestamp (ISO); null when never reviewed. */
  lastReviewedAt: string | null;
  /** The most recent released observation id; null when never reviewed. */
  lastObservationId: string | null;
  /** The tier-derived interval (calendar days) — the base interval for never-reviewed. */
  intervalDays: number;
  /** When the next review is due (ISO date-time); null when never reviewed. */
  dueDate: string | null;
  /** Calendar days past due (≥0 = overdue). 0 for never-reviewed (soonest bucket). */
  overdueDays: number;
  /** Never had a released review — goes to the soonest bucket. */
  neverReviewed: boolean;
}

export interface DueReviewList {
  /** The instant the list was computed (ISO). */
  now: string;
  config: EffectiveScheduleConfig;
  /** Distinct teachers with real teaching sessions considered. */
  candidateCount: number;
  /** The due/overdue + never-reviewed teachers, weakest/most-overdue first. */
  items: DueReviewItem[];
}

/** Distinct teacherIds with a real (active, non-break, teacher-assigned) routine slot. */
async function teachingTeacherIds(): Promise<string[]> {
  const ids = (await RoutineSlot.distinct("teacherId", {
    active: true,
    isBreak: false,
    teacherId: { $ne: null },
  })) as Types.ObjectId[];
  return ids.filter((id) => !!id).map((id) => id.toString());
}

/** Chronology key for picking a teacher's MOST RECENT released review. */
function reviewInstant(obs: IClassroomObservation): number {
  if (obs.reviewedAt) return new Date(obs.reviewedAt).getTime();
  return new Date(obs.createdAt).getTime();
}

/**
 * The "due for review" list (CO-6, §CO-6). Candidates are teachers with real teaching
 * sessions; each is tiered off their most recent released review, given a tier interval,
 * and ranked. Only the DUE/overdue teachers (and never-reviewed, in the soonest bucket)
 * are returned — a recently-reviewed teacher whose interval has not elapsed is omitted.
 * `now` is injected for determinism. SUGGESTION ONLY — never assigns.
 */
export async function dueForReview(now: Date = new Date()): Promise<DueReviewList> {
  const cfg = await getScheduleConfig();
  const teacherIds = await teachingTeacherIds();

  let candidates: DueReviewItem[] = [];
  if (teacherIds.length > 0) {
    const oids = teacherIds.map((id) => new Types.ObjectId(id));
    const docs = (await ClassroomObservation.find({
      teacherId: { $in: oids },
      state: { $in: RELEASED_STATES as unknown as string[] },
    }).lean()) as unknown as IClassroomObservation[];

    // Most recent released review per teacher.
    const latestByTeacher = new Map<string, IClassroomObservation>();
    for (const obs of docs) {
      const tid = obs.teacherId.toString();
      const prev = latestByTeacher.get(tid);
      if (!prev || reviewInstant(obs) > reviewInstant(prev)) latestByTeacher.set(tid, obs);
    }

    candidates = teacherIds.map((teacherId) => {
      const latest = latestByTeacher.get(teacherId);
      if (!latest) {
        return {
          teacherId,
          tier: null,
          lastReviewedAt: null,
          lastObservationId: null,
          intervalDays: cfg.baseIntervalDays,
          dueDate: null,
          overdueDays: 0,
          neverReviewed: true,
        };
      }
      const tier = deriveTier(latest);
      const intervalDays = intervalForTier(tier, cfg);
      const reviewedAt = latest.reviewedAt ? new Date(latest.reviewedAt) : new Date(latest.createdAt);
      const dueDate = new Date(reviewedAt.getTime() + intervalDays * 24 * 60 * 60 * 1000);
      const overdueDays = calendarDaysBetween(dueDate, now);
      return {
        teacherId,
        tier,
        lastReviewedAt: reviewedAt.toISOString(),
        lastObservationId: latest._id.toString(),
        intervalDays,
        dueDate: dueDate.toISOString(),
        overdueDays,
        neverReviewed: false,
      };
    });
  }

  // The due list: never-reviewed (soonest bucket) + anyone past due (overdueDays ≥ 0).
  const items = candidates
    .filter((c) => c.neverReviewed || c.overdueDays >= 0)
    .sort((a, b) => {
      // never-reviewed floats to the top (soonest bucket)
      if (a.neverReviewed !== b.neverReviewed) return a.neverReviewed ? -1 : 1;
      // then weakest tier first
      const sa = a.tier ? tierSeverity(a.tier) : 1;
      const sb = b.tier ? tierSeverity(b.tier) : 1;
      if (sa !== sb) return sa - sb;
      // then most overdue first
      if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
      return a.teacherId < b.teacherId ? -1 : a.teacherId > b.teacherId ? 1 : 0;
    });

  return { now: now.toISOString(), config: cfg, candidateCount: teacherIds.length, items };
}
