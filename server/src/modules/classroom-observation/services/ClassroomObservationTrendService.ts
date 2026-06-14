/**
 * ClassroomObservationTrendService (CO-4, prd-classroom-observation §CO-4, REF-11
 * §2.2/§8) — the READ-side, DERIVED aggregates over the classroom-observation plane.
 * Everything here is computed at read time (D-#85 — never stored); nothing is persisted.
 *
 *   teacherDomainTrend     — one teacher's per-domain (D1..D5) level series over time
 *                            (REF-11 §2.2): the chronological [{classDate, level,
 *                            observationId}] series per domain + a ↑/↓/→ trend
 *                            indicator (latest vs previous — mirrors CT-4's `trendOf`).
 *                            There is NO total/average ACROSS domains — by design
 *                            (§4, D-#194): each domain trends on its own.
 *   schoolObservationPatterns — the school-wide weakest-domain training-need SIGNAL
 *                            (REF-11 §8): the per-domain mean level over ALL released
 *                            REF-11 observations (staff-wide aggregate), surfacing the
 *                            lowest-aggregate domains. A signal, never attached to an
 *                            individual as a score.
 *
 * "Released" = state ∈ {REVIEWED, TEACHER_RESPONDED, SUPERSEDED} — an UPLOADED/ASSIGNED
 * draft is not yet a data point (matches `canReadObservation`'s teacher-visible set).
 * Ordering is chronological: by classDate (YYYY-MM-DD string) then createdAt.
 *
 * Staff aggregates only (names teacherId/observerId) — NO student/corpus path; the
 * ADR-005 firewall test must stay green.
 */
import { Types } from "mongoose";
import { OBSERVATION_DOMAINS } from "@scd/shared";
import type { ObservationDomain } from "@scd/shared";
import { ClassroomObservation, type IClassroomObservation } from "../models/ClassroomObservation";

// ---------------------------------------------------------------------------
// Released-observation helpers
// ---------------------------------------------------------------------------

/** State of a released (teacher-visible, data-point) observation. */
const RELEASED_STATES = ["REVIEWED", "TEACHER_RESPONDED", "SUPERSEDED"] as const;

// ---------------------------------------------------------------------------
// Trend indicator (mirrors CT-4 `trendOf`) — latest vs previous; one point ⇒ flat
// ---------------------------------------------------------------------------

export type Trend = "up" | "down" | "flat";

/** latest vs previous level (REF-11 §2.2). One data point ⇒ flat. */
export function trendOf(latest: number | null, previous: number | null): Trend {
  if (latest === null || previous === null) return "flat";
  if (latest > previous) return "up";
  if (latest < previous) return "down";
  return "flat";
}

// ---------------------------------------------------------------------------
// teacherDomainTrend — one teacher's per-domain level series + trend (§2.2)
// ---------------------------------------------------------------------------

export interface DomainTrendPoint {
  classDate: string;
  level: number;
  observationId: string;
}

export interface DomainTrendRow {
  domain: ObservationDomain;
  /** Chronological level series for this domain (oldest → newest). */
  series: DomainTrendPoint[];
  latestLevel: number | null;
  previousLevel: number | null;
  /** ↑/↓/→ latest-vs-previous for THIS domain (never across domains). */
  trend: Trend;
}

export interface TeacherDomainTrend {
  teacherId: string;
  /** Count of released REF-11 observations contributing to the trend. */
  observationCount: number;
  /** classDate of the earliest / latest contributing observation (null when none). */
  firstClassDate: string | null;
  lastClassDate: string | null;
  /** One row per REF-11 domain (D1..D5), in canonical order. */
  domains: DomainTrendRow[];
  // CO-5: a parallel Quran rating/compliance trend ships with the Quran payload; its
  // QURAN-form rows carry no REF-11 `domains` and are excluded here until then.
}

/**
 * Chronological sort over the released observations: classDate (YYYY-MM-DD string,
 * lexicographic = chronological) then createdAt as the tiebreaker. Same-day re-reviews
 * keep a stable created order.
 */
function chronological(a: IClassroomObservation, b: IClassroomObservation): number {
  if (a.classDate !== b.classDate) return a.classDate < b.classDate ? -1 : 1;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

/** A teacher's released REF-11 observations, oldest → newest (the trend data points). */
async function releasedRef11ForTeacher(teacherId: string): Promise<IClassroomObservation[]> {
  if (!Types.ObjectId.isValid(teacherId)) return [];
  const docs = (await ClassroomObservation.find({
    teacherId: new Types.ObjectId(teacherId),
    form: "REF11",
    state: { $in: RELEASED_STATES as unknown as string[] },
  }).lean()) as unknown as IClassroomObservation[];
  return docs.sort(chronological);
}

/**
 * Per-domain (D1..D5) chronological level trend for one teacher over their released
 * REF-11 observations (REF-11 §2.2). QURAN-form rows are excluded (the query filters to
 * form REF11 — a Quran observation carries no REF-11 `domains` payload; CO-5 trends it
 * separately). NO average across domains — each domain trends independently.
 */
export async function teacherDomainTrend(teacherId: string): Promise<TeacherDomainTrend> {
  const docs = await releasedRef11ForTeacher(teacherId);

  // Collect the per-domain series in chronological order.
  const seriesByDomain = new Map<ObservationDomain, DomainTrendPoint[]>();
  for (const d of OBSERVATION_DOMAINS) seriesByDomain.set(d, []);

  for (const obs of docs) {
    const obsId = obs._id.toString();
    for (const ds of obs.domains ?? []) {
      const list = seriesByDomain.get(ds.domain);
      if (!list) continue; // defensive: ignore an unknown domain code
      list.push({ classDate: obs.classDate, level: ds.level, observationId: obsId });
    }
  }

  const domains: DomainTrendRow[] = OBSERVATION_DOMAINS.map((domain) => {
    const series = seriesByDomain.get(domain)!;
    const latestLevel = series.length > 0 ? series[series.length - 1].level : null;
    const previousLevel = series.length > 1 ? series[series.length - 2].level : null;
    return { domain, series, latestLevel, previousLevel, trend: trendOf(latestLevel, previousLevel) };
  });

  return {
    teacherId,
    observationCount: docs.length,
    firstClassDate: docs.length > 0 ? docs[0].classDate : null,
    lastClassDate: docs.length > 0 ? docs[docs.length - 1].classDate : null,
    domains,
  };
}

// ---------------------------------------------------------------------------
// schoolObservationPatterns — the school-wide weakest-domain signal (§8)
// ---------------------------------------------------------------------------

export interface DomainSignalRow {
  domain: ObservationDomain;
  /** Mean recorded level for this domain across staff-wide released REF-11 rows. */
  meanLevel: number | null;
  /** How many domain scores contributed to the mean. */
  sampleCount: number;
}

export interface SchoolObservationPatterns {
  /** Count of released REF-11 observations contributing school-wide. */
  observationCount: number;
  /** Per-domain mean level, weakest (lowest mean) first — a school aggregate. */
  domains: DomainSignalRow[];
  /** The lowest-mean domain code(s) — the training-need signal (REF-11 §8). Empty
   *  when there is no data. Ties surface every domain at the minimum mean. */
  weakestDomains: ObservationDomain[];
}

/**
 * The school-wide per-domain mean level over ALL released REF-11 observations (REF-11
 * §8) → the weakest domains as the training-need SIGNAL. This is a STAFF-WIDE aggregate
 * (a signal, OK here) and is NEVER attached to an individual as a score. NO average
 * across domains — each domain is summarised on its own. No student/corpus path.
 */
export async function schoolObservationPatterns(): Promise<SchoolObservationPatterns> {
  const docs = (await ClassroomObservation.find({
    form: "REF11",
    state: { $in: RELEASED_STATES as unknown as string[] },
  }).lean()) as unknown as IClassroomObservation[];

  // Sum + count per domain.
  const sumByDomain = new Map<ObservationDomain, number>();
  const countByDomain = new Map<ObservationDomain, number>();
  for (const d of OBSERVATION_DOMAINS) {
    sumByDomain.set(d, 0);
    countByDomain.set(d, 0);
  }
  for (const obs of docs) {
    for (const ds of obs.domains ?? []) {
      if (!sumByDomain.has(ds.domain)) continue; // defensive
      sumByDomain.set(ds.domain, sumByDomain.get(ds.domain)! + ds.level);
      countByDomain.set(ds.domain, countByDomain.get(ds.domain)! + 1);
    }
  }

  const domainRows: DomainSignalRow[] = OBSERVATION_DOMAINS.map((domain) => {
    const sampleCount = countByDomain.get(domain)!;
    const meanLevel = sampleCount === 0 ? null : Math.round((sumByDomain.get(domain)! / sampleCount) * 100) / 100;
    return { domain, meanLevel, sampleCount };
  });

  // Weakest = lowest mean (only domains that actually have a sample). Ties included.
  const scored = domainRows.filter((r) => r.meanLevel !== null) as Array<DomainSignalRow & { meanLevel: number }>;
  let weakestDomains: ObservationDomain[] = [];
  if (scored.length > 0) {
    const min = Math.min(...scored.map((r) => r.meanLevel));
    weakestDomains = scored.filter((r) => r.meanLevel === min).map((r) => r.domain);
  }

  // Sort the surfaced rows weakest (lowest mean) first; an empty (null-mean) domain
  // sorts last so the signal leads.
  const domains = [...domainRows].sort((a, b) => {
    if (a.meanLevel === null && b.meanLevel === null) return 0;
    if (a.meanLevel === null) return 1;
    if (b.meanLevel === null) return -1;
    return a.meanLevel - b.meanLevel;
  });

  return { observationCount: docs.length, domains, weakestDomains };
}
