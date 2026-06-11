/**
 * Routine R-1 tests — calendar day-types + schedule maths + grid validation.
 *
 * R1.1 — dayTypeFor / dayTypeAdmitsTrack / resolveDayType (FULL/OFF/QURAN_ONLY/HOLIDAY)
 * R1.2 — holiday override → HOLIDAY (HolidayException mocked)
 * R1.5 — periodsValid (distinct numbers, positive durations) + computePeriodTimes
 * R1.6 — windowFor (pick covering window), dateRangesOverlap, computed clock times,
 *        winter shift (P1/P2 45→30, P3 duration unchanged, whole grid slides)
 *
 * DB-free: the HolidayException model is mocked; everything else is pure (the
 * calendar/schedule maths take dates + durations in, never read the clock).
 */
import mongoose from "mongoose";

const mockHolidayFindOne = jest.fn();
jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: { findOne: (q: unknown) => ({ lean: () => mockHolidayFindOne(q) }) },
}));

import { dayTypeFor, dayTypeAdmitsTrack, resolveDayType } from "../modules/routine/calendar";
import {
  computePeriodTimes,
  periodsValid,
  windowFor,
  dateRangesOverlap,
  minutesToHHMM,
  hhmmToMinutes,
} from "../modules/routine/schedule";
import type { IGridPeriod } from "../modules/routine/models/PeriodGrid";

/** A date whose local day-of-week equals `target` (0=Sun … 6=Sat). */
function dateWithDay(target: number): Date {
  const d = new Date(2026, 5, 1, 9, 0, 0); // June 2026, 09:00 local
  while (d.getDay() !== target) d.setDate(d.getDate() + 1);
  return d;
}

const A_SUNDAY = dateWithDay(0);
const A_TUESDAY = dateWithDay(2);
const A_THURSDAY = dateWithDay(4);
const A_FRIDAY = dateWithDay(5);
const A_SATURDAY = dateWithDay(6);

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// R1.1 — day-types (pure)
// ---------------------------------------------------------------------------
describe("R1.1 dayTypeFor (D-#50)", () => {
  test("Sun–Thu are FULL", () => {
    for (const d of [A_SUNDAY, A_TUESDAY, A_THURSDAY]) expect(dayTypeFor(d, false)).toBe("FULL");
  });
  test("Friday is OFF, Saturday is QURAN_ONLY", () => {
    expect(dayTypeFor(A_FRIDAY, false)).toBe("OFF");
    expect(dayTypeFor(A_SATURDAY, false)).toBe("QURAN_ONLY");
  });
  test("a holiday override beats any weekday", () => {
    expect(dayTypeFor(A_TUESDAY, true)).toBe("HOLIDAY");
    expect(dayTypeFor(A_SATURDAY, true)).toBe("HOLIDAY");
  });
});

describe("R1.1 dayTypeAdmitsTrack (R2.1 slot rule)", () => {
  test("FULL admits all tracks", () => {
    for (const tr of ["general", "quran", "arabic"] as const)
      expect(dayTypeAdmitsTrack("FULL", tr)).toBe(true);
  });
  test("QURAN_ONLY admits only quran", () => {
    expect(dayTypeAdmitsTrack("QURAN_ONLY", "quran")).toBe(true);
    expect(dayTypeAdmitsTrack("QURAN_ONLY", "general")).toBe(false);
    expect(dayTypeAdmitsTrack("QURAN_ONLY", "arabic")).toBe(false);
  });
  test("OFF and HOLIDAY admit nothing", () => {
    for (const dt of ["OFF", "HOLIDAY"] as const)
      for (const tr of ["general", "quran", "arabic"] as const)
        expect(dayTypeAdmitsTrack(dt, tr)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R1.1 / R1.2 — resolveDayType (mocked holiday)
// ---------------------------------------------------------------------------
describe("R1.2 resolveDayType consults HolidayException (D-#50)", () => {
  test("no holiday → weekday rule applies", async () => {
    mockHolidayFindOne.mockResolvedValue(null);
    await expect(resolveDayType(A_TUESDAY)).resolves.toBe("FULL");
    await expect(resolveDayType(A_SATURDAY)).resolves.toBe("QURAN_ONLY");
  });
  test("a covering holiday → HOLIDAY (even on a school day)", async () => {
    mockHolidayFindOne.mockResolvedValue({ _id: new mongoose.Types.ObjectId(), type: "eid" });
    await expect(resolveDayType(A_TUESDAY)).resolves.toBe("HOLIDAY");
  });
});

// ---------------------------------------------------------------------------
// R1.5 — period grid validation + computed times (pure)
// ---------------------------------------------------------------------------
function p(number: number, durationMin: number, track: IGridPeriod["track"], isBreak = false): IGridPeriod {
  return { number, durationMin, track, isBreak, nameBn: `P${number}` };
}

/** Class 1–5 regular grid (D-#57): Quran double (P1,P2) + Arabic (P3) + Tiffin + 4 general. */
const CLASS_1_5_REGULAR: IGridPeriod[] = [
  p(1, 45, "quran"),
  p(2, 45, "quran"),
  p(3, 40, "arabic"),
  p(4, 30, "general", true), // Tiffin
  p(5, 35, "general"),
  p(6, 35, "general"),
  p(7, 35, "general"),
  p(8, 35, "general"),
];

/** Class 1–5 winter grid: only P1/P2 compress 45→30 (D-#57); P3 + afternoon unchanged. */
const CLASS_1_5_WINTER: IGridPeriod[] = [
  p(1, 30, "quran"),
  p(2, 30, "quran"),
  p(3, 40, "arabic"),
  p(4, 30, "general", true),
  p(5, 35, "general"),
  p(6, 35, "general"),
  p(7, 35, "general"),
  p(8, 35, "general"),
];

describe("R1.5 periodsValid", () => {
  test("accepts distinct numbers + positive durations", () => {
    expect(periodsValid(CLASS_1_5_REGULAR)).toBe(true);
  });
  test("rejects duplicate period numbers", () => {
    expect(periodsValid([p(1, 45, "quran"), p(1, 45, "quran")])).toBe(false);
  });
  test("rejects a non-positive duration", () => {
    expect(periodsValid([p(1, 0, "quran")])).toBe(false);
  });
  test("rejects an empty grid", () => {
    expect(periodsValid([])).toBe(false);
  });
});

describe("R1.5/R1.6 computePeriodTimes (D-#55)", () => {
  test("computes back-to-back clock times from a 07:00 start", () => {
    const times = computePeriodTimes(420, CLASS_1_5_REGULAR); // 07:00
    expect(times[0].startHHMM).toBe("07:00");
    expect(times[0].endHHMM).toBe("07:45"); // P1 45m
    expect(times[1].startHHMM).toBe("07:45");
    expect(times[2].startHHMM).toBe("08:30"); // after P1+P2 = 90m
    expect(times[2].endHHMM).toBe("09:10"); // P3 40m
    // P5 (first general after Tiffin) lands at 09:40
    expect(times[4].startHHMM).toBe("09:40");
    expect(times[7].endHHMM).toBe("12:00"); // day ends noon
  });
  test("does not mutate the input grid", () => {
    const copy = JSON.parse(JSON.stringify(CLASS_1_5_REGULAR));
    computePeriodTimes(420, CLASS_1_5_REGULAR);
    expect(CLASS_1_5_REGULAR).toEqual(copy);
  });
  test("orders by period number regardless of input order", () => {
    const shuffled = [CLASS_1_5_REGULAR[2], CLASS_1_5_REGULAR[0], CLASS_1_5_REGULAR[1]];
    const times = computePeriodTimes(420, shuffled);
    expect(times.map((t) => t.number)).toEqual([1, 2, 3]);
    expect(times[0].startHHMM).toBe("07:00");
  });
});

describe("R1.6 winter shift (D-#57)", () => {
  test("winter start 07:30 slides the whole grid; P3 duration unchanged", () => {
    const winter = computePeriodTimes(450, CLASS_1_5_WINTER); // 07:30 start
    expect(winter[0].startHHMM).toBe("07:30"); // grid starts at the window day-start
    expect(winter[0].durationMin).toBe(30); // P1 compressed
    expect(winter[1].durationMin).toBe(30); // P2 compressed
    expect(winter[2].durationMin).toBe(40); // P3 (Arabic) UNCHANGED
    // P1(30)+P2(30) = 60m, so P3 starts 08:30 — same wall-clock as regular despite the 30-min-later start
    expect(winter[2].startHHMM).toBe("08:30");
  });
});

// ---------------------------------------------------------------------------
// R1.6 — schedule windows (pure)
// ---------------------------------------------------------------------------
const D = (s: string) => new Date(s);

describe("R1.6 windowFor (D-#55)", () => {
  const windows = [
    { fromDate: D("2026-01-01"), toDate: D("2026-11-30"), season: "regular", dayStartMinutes: 420 },
    { fromDate: D("2026-12-01"), toDate: D("2026-12-31"), season: "winter", dayStartMinutes: 435 }, // 07:15
    { fromDate: D("2027-01-01"), toDate: D("2027-01-31"), season: "winter", dayStartMinutes: 450 }, // 07:30
  ];
  test("picks the window covering a date (inclusive)", () => {
    expect(windowFor(D("2026-06-15"), windows)?.season).toBe("regular");
    expect(windowFor(D("2026-12-15"), windows)?.dayStartMinutes).toBe(435);
    expect(windowFor(D("2027-01-15"), windows)?.dayStartMinutes).toBe(450);
  });
  test("boundary dates are inclusive", () => {
    expect(windowFor(D("2026-12-01"), windows)?.season).toBe("winter");
    expect(windowFor(D("2026-11-30"), windows)?.season).toBe("regular");
  });
  test("returns null when no window covers the date", () => {
    expect(windowFor(D("2025-06-01"), windows)).toBeNull();
  });
});

describe("R1.6 dateRangesOverlap (reject overlapping windows)", () => {
  test("detects overlap (inclusive)", () => {
    expect(dateRangesOverlap(D("2026-01-01"), D("2026-06-30"), D("2026-06-30"), D("2026-12-31"))).toBe(true);
  });
  test("adjacent-but-not-overlapping is false", () => {
    expect(dateRangesOverlap(D("2026-01-01"), D("2026-06-30"), D("2026-07-01"), D("2026-12-31"))).toBe(false);
  });
});

describe("HH:MM helpers", () => {
  test("round-trips minutes ↔ HH:MM", () => {
    expect(minutesToHHMM(420)).toBe("07:00");
    expect(minutesToHHMM(435)).toBe("07:15");
    expect(minutesToHHMM(720)).toBe("12:00");
    expect(hhmmToMinutes("07:30")).toBe(450);
    expect(hhmmToMinutes("12:00")).toBe(720);
  });
});
