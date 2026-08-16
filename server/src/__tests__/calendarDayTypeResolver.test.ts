/**
 * buildDayTypeResolver (perf fix, 2026-08-16) — ONE query for a whole date range,
 * replacing `resolveDayType`'s per-date round trip.
 *
 * This exists because the class-test dashboard was spending 224 of its 265 database
 * round trips re-reading a single-row holiday table: every exam rebuilt a ~70-day
 * calendar one `findOne` per day. The resolver must therefore (a) issue exactly ONE
 * query however wide the range, and (b) give the SAME answers `resolveDayType` gave —
 * a faster calendar that disagrees with the old one would silently move every
 * class-test deadline.
 */
const mockFind = jest.fn();
const mockFindOne = jest.fn();

jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: {
    find: () => ({ select: () => ({ lean: async () => mockFind() }) }),
    findOne: () => ({ lean: async () => mockFindOne() }),
  },
}));

import { buildDayTypeResolver, resolveDayType, dayTypeFor } from "../modules/routine/calendar";

// 2026-08: 09=Sun, 10=Mon, 13=Thu, 14=Fri, 15=Sat
const d = (day: number): Date => new Date(2026, 7, day);

beforeEach(() => {
  jest.clearAllMocks();
  mockFind.mockResolvedValue([]);
  mockFindOne.mockResolvedValue(null);
});

describe("buildDayTypeResolver", () => {
  test("issues exactly ONE query for a 90-day range", async () => {
    await buildDayTypeResolver(d(1), new Date(2026, 9, 30));
    expect(mockFind).toHaveBeenCalledTimes(1);
  });

  test("keeps the base week rule: Sun–Thu FULL, Fri OFF, Sat QURAN_ONLY", async () => {
    const dayType = await buildDayTypeResolver(d(9), d(15));
    expect(dayType(d(9))).toBe("FULL"); // Sunday
    expect(dayType(d(13))).toBe("FULL"); // Thursday
    expect(dayType(d(14))).toBe("OFF"); // Friday
    expect(dayType(d(15))).toBe("QURAN_ONLY"); // Saturday
  });

  test("a single-day holiday overrides that day only", async () => {
    mockFind.mockResolvedValue([{ fromDate: d(10), toDate: d(10) }]);
    const dayType = await buildDayTypeResolver(d(9), d(13));
    expect(dayType(d(10))).toBe("HOLIDAY");
    expect(dayType(d(9))).toBe("FULL");
    expect(dayType(d(11))).toBe("FULL");
  });

  test("a MULTI-day holiday covers every day inclusive of both ends", async () => {
    mockFind.mockResolvedValue([{ fromDate: d(10), toDate: d(12) }]);
    const dayType = await buildDayTypeResolver(d(9), d(13));
    expect([d(10), d(11), d(12)].map(dayType)).toEqual(["HOLIDAY", "HOLIDAY", "HOLIDAY"]);
    expect(dayType(d(9))).toBe("FULL");
    expect(dayType(d(13))).toBe("FULL");
  });

  test("a holiday given with a mid-day timestamp still covers its whole day", async () => {
    mockFind.mockResolvedValue([
      { fromDate: new Date(2026, 7, 10, 14, 30), toDate: new Date(2026, 7, 10, 18, 0) },
    ]);
    const dayType = await buildDayTypeResolver(d(9), d(13));
    expect(dayType(new Date(2026, 7, 10, 8, 0))).toBe("HOLIDAY");
  });

  test("AGREES with resolveDayType across a fortnight, holiday and all", async () => {
    // The equivalence that matters: a faster calendar that disagrees would move
    // every class-test deadline without anyone noticing.
    const holiday = { fromDate: d(11), toDate: d(12) };
    mockFind.mockResolvedValue([holiday]);
    const dayType = await buildDayTypeResolver(d(3), d(16));
    for (let day = 3; day <= 16; day++) {
      const date = d(day);
      const covered = day >= 11 && day <= 12;
      mockFindOne.mockResolvedValue(covered ? holiday : null);
      expect(dayType(date)).toBe(await resolveDayType(date));
      expect(dayType(date)).toBe(dayTypeFor(date, covered));
    }
  });

  test("a date outside the loaded window falls back to the weekday rule, never throws", async () => {
    const dayType = await buildDayTypeResolver(d(9), d(10));
    expect(dayType(new Date(2027, 0, 6))).toBe("FULL"); // a Wednesday, far outside
  });
});
