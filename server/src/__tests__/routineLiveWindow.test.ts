/**
 * D-#47(3) — the routine effective-window helper.
 *
 * The whole versioning scheme rests on one boundary rule: a row closed for a
 * changeover on day D must stop the day BEFORE D, because reads match
 * `effectiveTo: { $gte: date }` and the conflict engine's `effectiveOverlap` is
 * inclusive at both ends. Closing ON D would leave two rows live that day and make a
 * replacement collide with the row it replaces. These tests pin that down against the
 * real `effectiveOverlap`, so the two modules can never drift apart.
 *
 * Pure — no mocks, no DB.
 */
import { liveWindow, isLiveOn, startOfDay, endOfDay, endOfDayBefore } from "../modules/routine/liveWindow";
import { effectiveOverlap } from "../modules/routine/conflicts";

const D = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

describe("startOfDay / endOfDayBefore", () => {
  test("startOfDay strips the time", () => {
    expect(startOfDay(new Date(2026, 8, 1, 14, 33, 12, 7))).toEqual(new Date(2026, 8, 1, 0, 0, 0, 0));
  });

  test("endOfDayBefore is the last instant of the previous day", () => {
    expect(endOfDayBefore(D("2026-09-01"))).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });

  test("it crosses a month boundary correctly", () => {
    expect(endOfDayBefore(D("2026-03-01"))).toEqual(new Date(2026, 1, 28, 23, 59, 59, 999));
  });
});

describe("the changeover boundary does not double-book (the reason for day-before)", () => {
  const oldFrom = D("2026-01-01");
  const changeover = D("2026-09-01");

  test("closing the day BEFORE the changeover leaves no overlap", () => {
    const oldTo = endOfDayBefore(changeover);
    expect(effectiveOverlap(oldFrom, oldTo, changeover, null)).toBe(false);
  });

  test("closing ON the changeover date WOULD overlap — the bug the rule prevents", () => {
    expect(effectiveOverlap(oldFrom, changeover, changeover, null)).toBe(true);
  });

  test("exactly one row is live on the changeover date, and on the day before", () => {
    const oldTo = endOfDayBefore(changeover);
    const oldRow = { effectiveFrom: oldFrom, effectiveTo: oldTo };
    const newRow = { effectiveFrom: changeover, effectiveTo: null };

    expect(isLiveOn(oldRow, D("2026-08-31"))).toBe(true);
    expect(isLiveOn(newRow, D("2026-08-31"))).toBe(false);

    expect(isLiveOn(oldRow, changeover)).toBe(false);
    expect(isLiveOn(newRow, changeover)).toBe(true);
  });
});

describe("isLiveOn", () => {
  const row = { effectiveFrom: D("2026-03-01"), effectiveTo: D("2026-06-30") };

  test("inclusive at both ends", () => {
    expect(isLiveOn(row, D("2026-03-01"))).toBe(true);
    expect(isLiveOn(row, D("2026-06-30"))).toBe(true);
  });

  test("excludes before and after", () => {
    expect(isLiveOn(row, D("2026-02-28"))).toBe(false);
    expect(isLiveOn(row, D("2026-07-01"))).toBe(false);
  });

  test("a null / absent effectiveTo is open-ended", () => {
    expect(isLiveOn({ effectiveFrom: D("2026-01-01"), effectiveTo: null }, D("2030-01-01"))).toBe(true);
    expect(isLiveOn({ effectiveFrom: D("2026-01-01") }, D("2030-01-01"))).toBe(true);
  });

  test("accepts ISO strings as stored/serialised", () => {
    expect(isLiveOn({ effectiveFrom: "2026-03-01", effectiveTo: "2026-06-30" }, D("2026-04-01"))).toBe(true);
  });
});

describe("liveWindow (the Mongo predicate)", () => {
  // D-#502: the bounds are the DAY's edges, not the raw instant. Previously this
  // asserted identity with `on`, which pinned an instant comparison — and that made
  // the window depend on how each caller happened to construct its Date. See
  // liveWindowDayBoundary.test.ts for the prod failure that forced the change.
  test("matches open-ended, null and still-running rows, and nothing that started later", () => {
    const on = D("2026-09-01");
    const f = liveWindow(on) as { effectiveFrom: { $lte: Date }; $or: Array<Record<string, unknown>> };
    expect(f.effectiveFrom.$lte).toEqual(endOfDay(on));
    expect(f.$or).toEqual([
      { effectiveTo: { $exists: false } },
      { effectiveTo: null },
      { effectiveTo: { $gte: startOfDay(on) } },
    ]);
  });

  test("a row that starts LATER is still excluded", () => {
    const f = liveWindow(D("2026-09-01")) as { effectiveFrom: { $lte: Date } };
    // The widening reaches the end of 09-01 and no further — 09-02 stays out.
    expect(D("2026-09-02").getTime()).toBeGreaterThan(f.effectiveFrom.$lte.getTime());
  });

  test("defaults to now", () => {
    const before = Date.now();
    const f = liveWindow() as { effectiveFrom: { $lte: Date } };
    expect(f.effectiveFrom.$lte.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("it carries its own $or, so callers with one of their own must use $and", () => {
    // Guards the documented composition rule: spreading liveWindow() into a filter that
    // already has a top-level $or would silently drop one of them.
    expect(Object.keys(liveWindow())).toContain("$or");
  });
});
