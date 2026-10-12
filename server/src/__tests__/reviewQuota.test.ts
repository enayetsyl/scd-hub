/**
 * Review quota (owner ask 2026-10-12) — the pure running-total maths, checked against
 * Mahzabin Yasmin's real record: 3 reviews per working day (Sun–Thu) from 2 Oct 2026.
 */
import { buildQuotaProgress } from "../modules/classroom-observation/services/ReviewQuotaService";

// 2 Oct 2026 is a Friday. Sun–Thu working; no holidays in the window.
const WEEKDAY: Record<string, number> = {};
for (let d = 2; d <= 12; d++) WEEKDAY[`2026-10-${String(d).padStart(2, "0")}`] = new Date(2026, 9, d).getDay();
const sunToThu = (k: string) => [0, 1, 2, 3, 4].includes(WEEKDAY[k]);

// Reviews per day as recorded on prod (reviewedAt, Dhaka day).
const reviewed = new Map([
  ["2026-10-03", 1], // Saturday — counts in the total, raises no target
  ["2026-10-04", 1],
  ["2026-10-05", 4],
  ["2026-10-06", 2],
  ["2026-10-07", 2],
  ["2026-10-08", 1],
  ["2026-10-10", 1], // Saturday
  ["2026-10-11", 3],
]);

describe("buildQuotaProgress", () => {
  const p = buildQuotaProgress({ startKey: "2026-10-02", todayKey: "2026-10-12", perDay: 3, isWorking: sunToThu, reviewedByDay: reviewed });

  test("working days raise the target; a Saturday review still counts", () => {
    const row = (k: string) => p.days.find((d) => d.dateKey === k)!;
    expect(row("2026-10-03")).toMatchObject({ working: false, reviewed: 1, cumulative: 1, expected: 0, diff: 1 });
    expect(row("2026-10-05")).toMatchObject({ working: true, reviewed: 4, cumulative: 6, expected: 6, diff: 0 });
    expect(row("2026-10-08")).toMatchObject({ cumulative: 11, expected: 15, diff: -4 });
    expect(row("2026-10-11")).toMatchObject({ cumulative: 15, expected: 18, diff: -3 });
    // Fri 2 and Fri 9 had no reviews and are not working days — not listed.
    expect(p.days.some((d) => d.dateKey === "2026-10-02" || d.dateKey === "2026-10-09")).toBe(false);
  });

  test("as of yesterday she is 3 behind; today needs 6 to be level by tonight", () => {
    expect(p.reviewedThroughYesterday).toBe(15);
    expect(p.expectedThroughYesterday).toBe(18);
    expect(p.diffThroughYesterday).toBe(-3);
    expect(p.todayWorking).toBe(true);
    expect(p.todayTarget).toBe(3);
    expect(p.todayReviewed).toBe(0);
    expect(p.neededToday).toBe(6);
    expect(p.days[p.days.length - 1]).toMatchObject({ dateKey: "2026-10-12", isToday: true, expected: 21 });
  });

  test("ahead of target: nothing needed today", () => {
    const ahead = buildQuotaProgress({
      startKey: "2026-10-04", todayKey: "2026-10-05", perDay: 3, isWorking: sunToThu,
      reviewedByDay: new Map([["2026-10-04", 5], ["2026-10-05", 2]]),
    });
    expect(ahead.diffThroughYesterday).toBe(2);
    expect(ahead.neededToday).toBe(0);
  });

  test("a holiday raises no target", () => {
    const withHoliday = buildQuotaProgress({
      startKey: "2026-10-04", todayKey: "2026-10-06", perDay: 3,
      isWorking: (k) => sunToThu(k) && k !== "2026-10-05", reviewedByDay: new Map(),
    });
    expect(withHoliday.expectedThroughYesterday).toBe(3);
    expect(withHoliday.days.map((d) => d.dateKey)).toEqual(["2026-10-04", "2026-10-06"]);
  });
});
