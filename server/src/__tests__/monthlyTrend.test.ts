/**
 * MR-2 — the trend rule, the absolute flags, the coverage gate and the config merge
 * (docs/prd-monthly-report.md §6.1, D-#394/#395).
 *
 * The rule these tests exist to defend: a trend is NEVER a bare delta. Below the
 * minimum sample the answer is "not comparable" — which is what stops a six-day
 * Ramadan month reading as a collapse.
 */
import {
  coverageVerdictOf,
  flagsOf,
  invert,
  monthTrendsOf,
  trendOf,
} from "../modules/reports/services/MonthlyTrendService";
import {
  DEFAULT_MONTHLY_REPORT_CONFIG,
  MonthlyReportConfigError,
  mergeMonthlyReportConfig,
  validateMonthlyReportConfig,
  type MonthlyReportConfigShape,
} from "../modules/reports/services/MonthlyReportConfigService";
import type { StudentMonthMetrics } from "../modules/reports/services/MonthlyMetricsService";

const CFG = DEFAULT_MONTHLY_REPORT_CONFIG;

const metrics = (p: {
  rate?: number | null;
  schoolDays?: number;
  streak?: number;
  uncovered?: number;
  hwRate?: number | null;
  hwExpected?: number;
  hwQuality?: number | null;
  hwChecked?: number;
  hwCoverage?: number | null;
  asCoverage?: number | null;
  ctCoverage?: number | null;
  ctRate?: number | null;
  ctAttended?: number;
  concerns?: number;
  serious?: number;
  resubs?: number;
  issued?: number;
}): StudentMonthMetrics =>
  ({
    attendance: {
      rate: p.rate ?? null,
      schoolDays: p.schoolDays ?? 22,
      absentStreakMax: p.streak ?? 0,
      absentUncovered: p.uncovered ?? 0,
    },
    homework: {
      submissionRate: p.hwRate ?? null,
      expectedWhilePresent: p.hwExpected ?? 10,
      qualityRate: p.hwQuality ?? null,
      checked: p.hwChecked ?? 10,
      resubmissions: p.resubs ?? 0,
      issued: p.issued ?? 10,
      coverage: { settled: 0, total: 10, pct: p.hwCoverage === undefined ? 100 : p.hwCoverage },
    },
    assignment: {
      submissionRate: null,
      expectedWhilePresent: 0,
      qualityRate: null,
      checked: 0,
      resubmissions: 0,
      issued: 0,
      coverage: { settled: 0, total: 0, pct: p.asCoverage === undefined ? null : p.asCoverage },
    },
    classTest: {
      rate: p.ctRate ?? null,
      attended: p.ctAttended ?? 4,
      coverage: { settled: 0, total: 4, pct: p.ctCoverage === undefined ? 100 : p.ctCoverage },
    },
    concerns: { concern: p.concerns ?? 0, seriousMatters: p.serious ?? 0 },
  }) as unknown as StudentMonthMetrics;

describe("MR-2 D-#395 — a trend is a rule, not a delta", () => {
  const rule = { threshold: 5, minSample: 10 };

  test("a fall past the threshold is DOWN, a rise past it is UP", () => {
    expect(trendOf({ current: 82, previous: 91, sampleNow: 22, samplePrev: 22, ...rule }).state).toBe("DOWN");
    expect(trendOf({ current: 91, previous: 82, sampleNow: 22, samplePrev: 22, ...rule }).state).toBe("UP");
  });

  test("movement inside the band is STEADY, and the delta is still reported", () => {
    const t = trendOf({ current: 84, previous: 79, sampleNow: 22, samplePrev: 22, threshold: 10, minSample: 5 });
    expect(t.state).toBe("STEADY");
    expect(t.delta).toBe(5);
  });

  test("exactly ON the threshold counts — the band is closed", () => {
    expect(trendOf({ current: 87, previous: 92, sampleNow: 22, samplePrev: 22, ...rule }).state).toBe("DOWN");
    expect(trendOf({ current: 92, previous: 87, sampleNow: 22, samplePrev: 22, ...rule }).state).toBe("UP");
  });

  test("A SHORT MONTH IS NOT A COLLAPSE — below the minimum sample there is no trend", () => {
    // 6 school days (Ramadan), 50 % vs last month's 90 %: a raw delta says -40.
    const t = trendOf({ current: 50, previous: 90, sampleNow: 6, samplePrev: 22, ...rule });
    expect(t.state).toBe("NOT_COMPARABLE");
    expect(t.delta).toBeNull();
  });

  test("a short month LAST month is equally uncomparable", () => {
    expect(trendOf({ current: 90, previous: 50, sampleNow: 22, samplePrev: 6, ...rule }).state).toBe("NOT_COMPARABLE");
  });

  test("a missing value is not a zero", () => {
    expect(trendOf({ current: null, previous: 90, sampleNow: 22, samplePrev: 22, ...rule }).state).toBe("NOT_COMPARABLE");
    expect(trendOf({ current: 90, previous: null, sampleNow: 22, samplePrev: 22, ...rule }).state).toBe("NOT_COMPARABLE");
  });

  test("the rule that produced the state travels with it, for the sheet's appendix", () => {
    expect(trendOf({ current: 82, previous: 91, sampleNow: 22, samplePrev: 21, ...rule })).toMatchObject({
      threshold: 5, minSample: 10, sampleNow: 22, samplePrev: 21, delta: -9,
    });
  });
});

describe("MR-2 — metrics where MORE is worse read the other way round", () => {
  test("a rise in concerns is 'needs attention', and still prints +2", () => {
    const up = trendOf({ current: 3, previous: 1, sampleNow: 1, samplePrev: 1, threshold: 2, minSample: 1 });
    expect(up.state).toBe("UP");
    const flipped = invert(up);
    expect(flipped.state).toBe("DOWN");
    expect(flipped.delta).toBe(2);
  });

  test("STEADY and NOT_COMPARABLE are unaffected by the flip", () => {
    const steady = trendOf({ current: 2, previous: 1, sampleNow: 1, samplePrev: 1, threshold: 2, minSample: 1 });
    expect(invert(steady).state).toBe("STEADY");
    const na = trendOf({ current: 2, previous: null, sampleNow: 1, samplePrev: 0, threshold: 2, minSample: 1 });
    expect(invert(na).state).toBe("NOT_COMPARABLE");
  });
});

describe("MR-2 — the month's trend block", () => {
  test("no previous month yields NOT_COMPARABLE everywhere, never a zero baseline", () => {
    const t = monthTrendsOf(metrics({ rate: 82, hwRate: 90 }), null, CFG);
    for (const v of Object.values(t)) expect(v.state).toBe("NOT_COMPARABLE");
  });

  test("attendance, homework and class test each apply their OWN threshold", () => {
    const now = metrics({ rate: 82, hwRate: 84, ctRate: 79, ctAttended: 4 });
    const prev = metrics({ rate: 91, hwRate: 79, ctRate: 74, ctAttended: 4 });
    const t = monthTrendsOf(now, prev, CFG);
    expect(t.attendance.state).toBe("DOWN"); // -9 against ±5
    expect(t.homeworkSubmission.state).toBe("STEADY"); // +5 against ±10
    expect(t.classTest.state).toBe("UP"); // +5 against ±5
  });

  test("a subject with too little work is not compared", () => {
    const now = metrics({ hwRate: 100, hwExpected: 2 });
    const prev = metrics({ hwRate: 40, hwExpected: 2 });
    expect(monthTrendsOf(now, prev, CFG).homeworkSubmission.state).toBe("NOT_COMPARABLE");
  });

  test("concerns rising past the count threshold reads as needing attention", () => {
    const t = monthTrendsOf(metrics({ concerns: 3 }), metrics({ concerns: 1 }), CFG);
    expect(t.concerns.state).toBe("DOWN");
    expect(t.concerns.delta).toBe(2);
  });
});

describe("MR-2 §6.1 — absolute flags bypass the trend", () => {
  test("an absence run and uncovered absences both flag at 3", () => {
    const f = flagsOf(metrics({ streak: 3, uncovered: 4 }), CFG);
    expect(f.map((x) => x.flag)).toEqual(["ABSENT_STREAK", "ABSENT_UNCOVERED"]);
    expect(f[1]).toMatchObject({ value: 4, threshold: 3 });
  });

  test("a serious matter always surfaces, however good the month was", () => {
    expect(flagsOf(metrics({ rate: 100, serious: 1 }), CFG).map((x) => x.flag)).toEqual(["SERIOUS_MATTER"]);
  });

  test("a clean month raises nothing", () => {
    expect(flagsOf(metrics({ streak: 2, uncovered: 2 }), CFG)).toEqual([]);
  });
});

describe("MR-2 D-#394 — the coverage gate", () => {
  test("an unchecked assignment pile makes the report provisional", () => {
    const v = coverageVerdictOf(metrics({ asCoverage: 67 }), CFG);
    expect(v.provisional).toBe(true);
    expect(v.belowGate.map((b) => b.stream)).toEqual(["assignment"]);
    expect(v.gatePct).toBe(80);
  });

  test("several streams below the gate are all named", () => {
    const v = coverageVerdictOf(metrics({ hwCoverage: 50, asCoverage: 60, ctCoverage: 20 }), CFG);
    expect(v.belowGate.map((b) => b.stream)).toEqual(["homework", "assignment", "classTest"]);
  });

  test("a stream with NOTHING in it is vacuously complete — an empty month cannot block release forever", () => {
    const v = coverageVerdictOf(metrics({ hwCoverage: null, asCoverage: null, ctCoverage: null }), CFG);
    expect(v.provisional).toBe(false);
  });

  test("exactly at the gate passes", () => {
    expect(coverageVerdictOf(metrics({ hwCoverage: 80 }), CFG).provisional).toBe(false);
    expect(coverageVerdictOf(metrics({ hwCoverage: 79.9 }), CFG).provisional).toBe(true);
  });
});

describe("MR-2 D-#97 — the config has read-time defaults and is never seeded", () => {
  test("no stored row at all yields the working defaults", () => {
    expect(mergeMonthlyReportConfig(null)).toEqual(DEFAULT_MONTHLY_REPORT_CONFIG);
  });

  test("a partial row overrides only what it sets — a field added later still has a default", () => {
    const merged = mergeMonthlyReportConfig({ attendanceThresholdPp: 8, showFees: false });
    expect(merged.attendanceThresholdPp).toBe(8);
    expect(merged.showFees).toBe(false);
    expect(merged.coverageGatePct).toBe(DEFAULT_MONTHLY_REPORT_CONFIG.coverageGatePct);
  });

  test("junk in the stored row falls back rather than blanking the knob", () => {
    const merged = mergeMonthlyReportConfig({
      attendanceThresholdPp: null,
      coverageGatePct: "80",
      showClassBest: 1,
      classTestMinTests: Number.NaN,
    });
    expect(merged.attendanceThresholdPp).toBe(5);
    expect(merged.coverageGatePct).toBe(80);
    expect(merged.showClassBest).toBe(true);
    expect(merged.classTestMinTests).toBe(2);
  });

  test("a calendar that closes before it opens is refused", () => {
    const bad = (p: Partial<MonthlyReportConfigShape>): MonthlyReportConfigShape => ({ ...CFG, ...p });
    expect(() => validateMonthlyReportConfig(bad({ hardLockDays: 10, revisionWindowDays: 14 }))).toThrow(
      MonthlyReportConfigError,
    );
    expect(() => validateMonthlyReportConfig(bad({ draftDay: 20, revisionWindowDays: 14 }))).toThrow(
      MonthlyReportConfigError,
    );
    expect(() => validateMonthlyReportConfig(CFG)).not.toThrow();
  });
});
