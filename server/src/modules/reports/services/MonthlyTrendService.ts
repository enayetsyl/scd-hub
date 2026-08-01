/**
 * MonthlyTrendService (MR-2, prd-monthly-report §6.1, D-#395) — a trend is a RULE,
 * not a delta.
 *
 * Raw month-over-month arithmetic manufactures trends out of short months, Ramadan
 * schedules and subjects with two homeworks in them. So every comparison resolves in
 * this order:
 *
 *   NOT_COMPARABLE  either month is below the metric's MINIMUM SAMPLE, or either
 *                   value is missing. Printed as "তুলনাযোগ্য নয়" — a first-class
 *                   answer, not a hidden zero.
 *   DOWN            delta <= -threshold
 *   UP              delta >= +threshold
 *   STEADY          inside the band
 *
 * Three ABSOLUTE flags bypass trend entirely, because a run reads worse than a total
 * and a serious matter is not a rate: an absence streak, uncovered absences, and any
 * SERIOUS_MATTER concern.
 *
 * PURE — no DB, no clock. The config is passed in (and frozen into the snapshot by
 * the caller, D-#395), so a released report can always be re-explained.
 */
import type { MonthlyReportConfigShape } from "./MonthlyReportConfigService";
import type { Coverage, StudentMonthMetrics } from "./MonthlyMetricsService";

export const TREND_STATES = ["UP", "STEADY", "DOWN", "NOT_COMPARABLE"] as const;
export type TrendState = (typeof TREND_STATES)[number];

export interface TrendResult {
  state: TrendState;
  /** Signed change in the metric's own unit; null when not comparable. */
  delta: number | null;
  current: number | null;
  previous: number | null;
  /** The rule that produced the state — printed in the sheet's appendix. */
  threshold: number;
  minSample: number;
  sampleNow: number;
  samplePrev: number;
}

export interface TrendInput {
  current: number | null;
  previous: number | null;
  sampleNow: number;
  samplePrev: number;
  threshold: number;
  minSample: number;
}

/** PURE. One comparison, one rule. */
export function trendOf(input: TrendInput): TrendResult {
  const { current, previous, sampleNow, samplePrev, threshold, minSample } = input;
  const base = { current, previous, threshold, minSample, sampleNow, samplePrev };

  const comparable =
    current != null && previous != null && sampleNow >= minSample && samplePrev >= minSample;
  if (!comparable) return { ...base, state: "NOT_COMPARABLE", delta: null };

  const delta = Math.round((current - previous) * 10) / 10;
  if (delta <= -threshold) return { ...base, state: "DOWN", delta };
  if (delta >= threshold) return { ...base, state: "UP", delta };
  return { ...base, state: "STEADY", delta };
}

// ---------------------------------------------------------------------------
// Absolute flags
// ---------------------------------------------------------------------------

export const REPORT_FLAGS = ["ABSENT_STREAK", "ABSENT_UNCOVERED", "SERIOUS_MATTER"] as const;
export type ReportFlag = (typeof REPORT_FLAGS)[number];

export interface FlagResult {
  flag: ReportFlag;
  /** The observed number that tripped it. */
  value: number;
  threshold: number;
}

/** PURE. These surface regardless of direction — an improving month with a 4-day
 *  absence run still needs the run said out loud. */
export function flagsOf(m: StudentMonthMetrics, cfg: MonthlyReportConfigShape): FlagResult[] {
  const flags: FlagResult[] = [];
  if (m.attendance.absentStreakMax >= cfg.absentStreakFlag) {
    flags.push({ flag: "ABSENT_STREAK", value: m.attendance.absentStreakMax, threshold: cfg.absentStreakFlag });
  }
  if (m.attendance.absentUncovered >= cfg.absentUncoveredFlag) {
    flags.push({ flag: "ABSENT_UNCOVERED", value: m.attendance.absentUncovered, threshold: cfg.absentUncoveredFlag });
  }
  if (m.concerns.seriousMatters > 0) {
    flags.push({ flag: "SERIOUS_MATTER", value: m.concerns.seriousMatters, threshold: 1 });
  }
  return flags;
}

// ---------------------------------------------------------------------------
// The month's trend block
// ---------------------------------------------------------------------------

export interface MonthTrends {
  attendance: TrendResult;
  homeworkSubmission: TrendResult;
  homeworkQuality: TrendResult;
  assignmentSubmission: TrendResult;
  assignmentQuality: TrendResult;
  classTest: TrendResult;
  concerns: TrendResult;
  resubmissions: TrendResult;
}

/**
 * PURE. Every metric against the same month last time.
 *
 * `previous` null (no report for the prior month, or the child was not enrolled)
 * yields NOT_COMPARABLE across the board rather than a fabricated baseline of zero.
 */
export function monthTrendsOf(
  current: StudentMonthMetrics,
  previous: StudentMonthMetrics | null,
  cfg: MonthlyReportConfigShape,
): MonthTrends {
  const p = previous;
  return {
    attendance: trendOf({
      current: current.attendance.rate,
      previous: p ? p.attendance.rate : null,
      sampleNow: current.attendance.schoolDays,
      samplePrev: p ? p.attendance.schoolDays : 0,
      threshold: cfg.attendanceThresholdPp,
      minSample: cfg.attendanceMinDays,
    }),
    homeworkSubmission: trendOf({
      current: current.homework.submissionRate,
      previous: p ? p.homework.submissionRate : null,
      sampleNow: current.homework.expectedWhilePresent,
      samplePrev: p ? p.homework.expectedWhilePresent : 0,
      threshold: cfg.homeworkThresholdPp,
      minSample: cfg.homeworkMinSheets,
    }),
    homeworkQuality: trendOf({
      current: current.homework.qualityRate,
      previous: p ? p.homework.qualityRate : null,
      sampleNow: current.homework.checked,
      samplePrev: p ? p.homework.checked : 0,
      threshold: cfg.qualityThresholdPp,
      minSample: cfg.qualityMinChecked,
    }),
    assignmentSubmission: trendOf({
      current: current.assignment.submissionRate,
      previous: p ? p.assignment.submissionRate : null,
      sampleNow: current.assignment.expectedWhilePresent,
      samplePrev: p ? p.assignment.expectedWhilePresent : 0,
      threshold: cfg.assignmentThresholdPp,
      minSample: cfg.assignmentMinItems,
    }),
    assignmentQuality: trendOf({
      current: current.assignment.qualityRate,
      previous: p ? p.assignment.qualityRate : null,
      sampleNow: current.assignment.checked,
      samplePrev: p ? p.assignment.checked : 0,
      threshold: cfg.qualityThresholdPp,
      minSample: cfg.qualityMinChecked,
    }),
    classTest: trendOf({
      current: current.classTest.rate,
      previous: p ? p.classTest.rate : null,
      sampleNow: current.classTest.attended,
      samplePrev: p ? p.classTest.attended : 0,
      threshold: cfg.classTestThresholdPp,
      minSample: cfg.classTestMinTests,
    }),
    // Counts, not rates: no minimum sample, and MORE concerns is a DOWN, so the
    // sign is inverted before the band is applied.
    concerns: invert(
      trendOf({
        current: current.concerns.concern,
        previous: p ? p.concerns.concern : null,
        sampleNow: 1,
        samplePrev: p ? 1 : 0,
        threshold: cfg.concernThreshold,
        minSample: 1,
      }),
    ),
    resubmissions: invert(
      trendOf({
        current: current.homework.resubmissions + current.assignment.resubmissions,
        previous: p ? p.homework.resubmissions + p.assignment.resubmissions : null,
        sampleNow: current.homework.issued + current.assignment.issued,
        samplePrev: p ? p.homework.issued + p.assignment.issued : 0,
        threshold: cfg.resubmissionThreshold,
        minSample: cfg.resubmissionMinIssued,
      }),
    ),
  };
}

/** PURE. For a metric where MORE is worse (concerns, resubmissions), the direction
 *  label flips while the signed delta keeps its arithmetic meaning — the page says
 *  "needs attention" for a rise, and still prints +2. */
export function invert(t: TrendResult): TrendResult {
  if (t.state === "UP") return { ...t, state: "DOWN" };
  if (t.state === "DOWN") return { ...t, state: "UP" };
  return t;
}

// ---------------------------------------------------------------------------
// The coverage gate (D-#394)
// ---------------------------------------------------------------------------

export interface CoverageVerdict {
  provisional: boolean;
  gatePct: number;
  /** The streams that are below the gate, with what they actually are. */
  belowGate: Array<{ stream: "homework" | "assignment" | "classTest"; coverage: Coverage }>;
}

/**
 * PURE. A stream with nothing in it (`pct === null`) is vacuously complete — a month
 * with no assignments must not block a release forever.
 */
export function coverageVerdictOf(
  m: StudentMonthMetrics,
  cfg: MonthlyReportConfigShape,
): CoverageVerdict {
  const streams: Array<{ stream: "homework" | "assignment" | "classTest"; coverage: Coverage }> = [
    { stream: "homework", coverage: m.homework.coverage },
    { stream: "assignment", coverage: m.assignment.coverage },
    { stream: "classTest", coverage: m.classTest.coverage },
  ];
  const belowGate = streams.filter((s) => s.coverage.pct != null && s.coverage.pct < cfg.coverageGatePct);
  return { provisional: belowGate.length > 0, gatePct: cfg.coverageGatePct, belowGate };
}
