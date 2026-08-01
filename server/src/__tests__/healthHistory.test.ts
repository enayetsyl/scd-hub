/**
 * HealthHistoryService (SH-4..SH-6, D-#416).
 *
 * The projection is the part that can lie. A least-squares fit will happily return a
 * confident date from two points, from a flat line, or from a shrinking one — and that
 * date is what the Principal would plan against. These tests pin the refusals as hard as
 * the arithmetic.
 */
import {
  projectToLimit,
  PRUNABLE,
  TRACKED_COLLECTIONS,
  HISTORY_DAYS,
} from "../modules/platform/services/HealthHistoryService";

const MB = 1024 ** 2;

/** A rising series: `days` points climbing by `perDay` from `start`. */
function rising(days: number, start: number, perDay: number, estimated = false) {
  return Array.from({ length: days }, (_, i) => ({
    dateKey: `2026-08-${String(i + 1).padStart(2, "0")}`,
    value: start + i * perDay,
    estimated,
  }));
}

describe("projectToLimit — the forecast must refuse to guess", () => {
  test("fits a clean slope and dates the crossing", () => {
    // 10 days climbing 1 MB/day, ending at 109 MB against a 512 MB cap:
    // 403 MB of headroom / 1 MB per day ≈ 403 days.
    const p = projectToLimit(rising(10, 100 * MB, MB), 512 * MB, new Date(2026, 7, 10));
    expect(p.bytesPerDay).toBeCloseTo(MB, -3);
    expect(p.daysToLimit).toBe(403);
    expect(p.limitDateKey).toBe("2027-09-17");
    expect(p.points).toBe(10);
  });

  test("fewer than three points is NOT a trend", () => {
    // Two points always fit a perfect line; reporting a date off that is the classic
    // way a dashboard invents certainty.
    const p = projectToLimit(rising(2, 100 * MB, 5 * MB), 512 * MB);
    expect(p.daysToLimit).toBeNull();
    expect(p.bytesPerDay).toBeNull();
    expect(p.points).toBe(2);
  });

  test("a flat series reports its rate but no crossing date", () => {
    const flat = rising(10, 100 * MB, 0);
    const p = projectToLimit(flat, 512 * MB);
    expect(p.bytesPerDay).toBe(0);
    expect(p.daysToLimit).toBeNull();
    expect(p.limitDateKey).toBeNull();
  });

  test("a SHRINKING series never produces a date", () => {
    // A negative slope would divide into a negative "days remaining" and render as a
    // date in the past — worse than saying nothing.
    const p = projectToLimit(rising(10, 200 * MB, -2 * MB), 512 * MB);
    expect(p.bytesPerDay).toBeLessThan(0);
    expect(p.daysToLimit).toBeNull();
    expect(p.limitDateKey).toBeNull();
  });

  test("already past the limit reports zero days, not a negative", () => {
    const p = projectToLimit(rising(5, 600 * MB, MB), 512 * MB, new Date(2026, 7, 10));
    expect(p.daysToLimit).toBe(0);
    expect(p.limitDateKey).toBe("2026-08-10");
  });

  test("null values are skipped, not read as zero", () => {
    // An unmeasured day is a gap. Treating it as 0 bytes would invent a cliff and then a
    // recovery, and the slope would be nonsense.
    const series = [
      { dateKey: "2026-08-01", value: 100 * MB },
      { dateKey: "2026-08-02", value: null },
      { dateKey: "2026-08-03", value: 102 * MB },
      { dateKey: "2026-08-04", value: 103 * MB },
    ];
    const p = projectToLimit(series, 512 * MB);
    expect(p.points).toBe(3);
    expect(p.bytesPerDay).toBeGreaterThan(0);
  });

  test("carries the estimated flag through, so the panel can caveat the line", () => {
    expect(projectToLimit(rising(5, 100 * MB, MB, true), 512 * MB).usesEstimates).toBe(true);
    expect(projectToLimit(rising(5, 100 * MB, MB, false), 512 * MB).usesEstimates).toBe(false);
  });

  test("an empty series is answerable, not a crash", () => {
    expect(projectToLimit([], 512 * MB)).toMatchObject({ points: 0, daysToLimit: null });
  });
});

describe("the prune allowlist", () => {
  test("NEVER offers to prune the audit log", () => {
    // ADR-008 makes audits append-only. A "reclaim 300 KB" suggestion against it would be
    // an invitation to break that, so its absence is a rule, not an oversight.
    expect(PRUNABLE.map((p) => p.collection)).not.toContain("audits");
  });

  test("offers only regenerable or purely historical collections", () => {
    // School records are the product, not exhaust — none of them may appear here.
    const names = PRUNABLE.map((p) => p.collection);
    for (const school of [
      "students",
      "guardians",
      "homeworkstudentrecords",
      "assignmentstudentrecords",
      "classnotes",
      "monthlyreports",
      "studentattendances",
    ]) {
      expect(names).not.toContain(school);
    }
    expect(names.length).toBeGreaterThan(0);
  });

  test("every rule states an age and a human reason", () => {
    for (const rule of PRUNABLE) {
      expect(rule.olderThanDays).toBeGreaterThan(0);
      expect(rule.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("history sizing", () => {
  test("tracks a bounded number of collections and days", () => {
    // The history must not become a meaningful consumer of the cap it watches.
    expect(TRACKED_COLLECTIONS).toBeLessThanOrEqual(10);
    expect(HISTORY_DAYS).toBeLessThanOrEqual(120);
  });
});
