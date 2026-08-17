/**
 * liveWindow day-boundary regression (D-#502).
 *
 * THE BUG, as the owner hit it on prod: a Quran group's routine slot created with
 * "effective from = today" showed in the routine editor but the attendance marker
 * resolved to "Nobody assigned" — the same slot simultaneously live and dead.
 *
 * Cause: the window compared raw INSTANTS, and the two ends are not built the same
 * way. `effectiveFrom` is stored by `new Date("YYYY-MM-DD")` → UTC midnight, while
 * readers pass either `new Date()` (now) or a LOCAL-midnight Date (attendance's
 * `parseDateKey`, `new Date(y, m-1, d)`). On a UTC+6 server local midnight is
 * 18:00Z the previous day — earlier than the slot's 00:00Z — so the local-midnight
 * reader filtered the slot out while the `new Date()` reader kept it.
 *
 * The module's own contract already said the window is "day-granular, INCLUSIVE at
 * both ends"; the implementation just wasn't. These tests pin that contract.
 *
 * Pure — no DB, no mocks.
 */
import { liveWindow, isLiveOn, startOfDay, endOfDay } from "../modules/routine/liveWindow";

/** How the create resolver stores a date-only value: `new Date("YYYY-MM-DD")` = UTC midnight. */
const storedAs = (key: string): Date => new Date(key);
/** How attendance reads a date: `parseDateKey` → LOCAL midnight. */
const readAs = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const DAY = "2026-08-17";

describe("day bounds", () => {
  it("startOfDay/endOfDay bracket the same local calendar day", () => {
    const noon = new Date(2026, 7, 17, 12, 0, 0);
    expect(startOfDay(noon).getDate()).toBe(17);
    expect(startOfDay(noon).getHours()).toBe(0);
    expect(endOfDay(noon).getDate()).toBe(17);
    expect(endOfDay(noon).getHours()).toBe(23);
    expect(endOfDay(noon).getTime()).toBeGreaterThan(startOfDay(noon).getTime());
  });
});

describe("isLiveOn — a slot effective TODAY is live today, however 'today' was built", () => {
  const slot = { effectiveFrom: storedAs(DAY), effectiveTo: null };

  it("is live when the reader passes LOCAL midnight (the attendance path — this was the bug)", () => {
    expect(isLiveOn(slot, readAs(DAY))).toBe(true);
  });

  it("is live when the reader passes the current instant (the routine-editor path)", () => {
    expect(isLiveOn(slot, new Date(2026, 7, 17, 10, 30))).toBe(true);
  });

  it("is live at the very first instant of the day", () => {
    expect(isLiveOn(slot, startOfDay(readAs(DAY)))).toBe(true);
  });

  it("is live at the very last instant of the day", () => {
    expect(isLiveOn(slot, endOfDay(readAs(DAY)))).toBe(true);
  });

  it("is NOT live the day before — the widening must not leak backwards", () => {
    expect(isLiveOn(slot, readAs("2026-08-16"))).toBe(false);
    expect(isLiveOn(slot, endOfDay(readAs("2026-08-16")))).toBe(false);
  });

  it("is still live on later days", () => {
    expect(isLiveOn(slot, readAs("2026-09-01"))).toBe(true);
  });
});

describe("isLiveOn — the closing end stays inclusive", () => {
  const closed = { effectiveFrom: storedAs("2026-08-01"), effectiveTo: storedAs("2026-08-17") };

  it("is live ON its final day", () => {
    expect(isLiveOn(closed, readAs(DAY))).toBe(true);
    expect(isLiveOn(closed, endOfDay(readAs(DAY)))).toBe(true);
  });

  it("is dead the day after", () => {
    expect(isLiveOn(closed, readAs("2026-08-18"))).toBe(false);
  });
});

describe("isLiveOn — versioned handover (endOfDayBefore) must not overlap", () => {
  // Replacing a slot on 2026-08-17 closes the old row at the END OF 08-16 and opens
  // the new one on 08-17. Exactly one may be live on the changeover day, or the
  // conflict engine would see the replacement collide with the row it replaces.
  const oldRow = {
    effectiveFrom: storedAs("2026-06-01"),
    effectiveTo: new Date(2026, 7, 16, 23, 59, 59, 999),
  };
  const newRow = { effectiveFrom: storedAs(DAY), effectiveTo: null };

  it("only the NEW row is live on the changeover day", () => {
    expect(isLiveOn(oldRow, readAs(DAY))).toBe(false);
    expect(isLiveOn(newRow, readAs(DAY))).toBe(true);
  });

  it("only the OLD row is live the day before", () => {
    expect(isLiveOn(oldRow, readAs("2026-08-16"))).toBe(true);
    expect(isLiveOn(newRow, readAs("2026-08-16"))).toBe(false);
  });
});

describe("liveWindow — the Mongo predicate mirrors isLiveOn", () => {
  it("bounds effectiveFrom by the END of the day, not the raw instant", () => {
    const w = liveWindow(readAs(DAY)) as { effectiveFrom: { $lte: Date } };
    expect(w.effectiveFrom.$lte.getTime()).toBe(endOfDay(readAs(DAY)).getTime());
    // The stored UTC-midnight value must fall inside that bound — the regression.
    expect(storedAs(DAY).getTime()).toBeLessThanOrEqual(w.effectiveFrom.$lte.getTime());
  });

  it("bounds effectiveTo by the START of the day, and keeps the null branches", () => {
    const w = liveWindow(readAs(DAY)) as {
      $or: Array<Record<string, unknown>>;
    };
    expect(w.$or).toHaveLength(3);
    const gte = w.$or.find((c) => (c.effectiveTo as { $gte?: Date } | null)?.$gte) as {
      effectiveTo: { $gte: Date };
    };
    expect(gte.effectiveTo.$gte.getTime()).toBe(startOfDay(readAs(DAY)).getTime());
    expect(w.$or).toEqual(
      expect.arrayContaining([{ effectiveTo: { $exists: false } }, { effectiveTo: null }]),
    );
  });
});
