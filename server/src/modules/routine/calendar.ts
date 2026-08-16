/**
 * Routine calendar — day-type resolution (D-#50).
 *
 * Extends the base school-week rule (trackers/calendar.ts: Sun–Thu teach) with the
 * routine's day-types and holiday overrides — ONE calendar source, no second truth:
 *   FULL       — Sun–Thu (all tracks run)
 *   OFF        — Fri
 *   QURAN_ONLY — Sat (only the quran track, for Quran groups)
 *   HOLIDAY    — a HolidayException override (no routine; attendance not expected)
 *
 * The HW Fri/Sat block (HW-T2) stays correct for homework; routine layers the
 * Saturday-Quran exception on the same source.
 */
import type { DayType, PeriodTrack } from "@scd/shared";
import { isSchoolDay } from "../trackers/calendar";
import { HolidayException } from "./models/HolidayException";

/**
 * Pure day-type resolver. Reuses `isSchoolDay` (Sun–Thu) so the base school-week
 * rule has a single source; Saturday (getDay 6) is Quran-only, Friday is off.
 */
export function dayTypeFor(date: Date, isHoliday: boolean): DayType {
  if (isHoliday) return "HOLIDAY";
  if (isSchoolDay(date)) return "FULL";
  return date.getDay() === 6 ? "QURAN_ONLY" : "OFF";
}

/**
 * True iff a track may run on the given day-type (R2.1 slot rule). FULL admits all;
 * QURAN_ONLY admits only quran; OFF/HOLIDAY admit none.
 */
export function dayTypeAdmitsTrack(dayType: DayType, track: PeriodTrack): boolean {
  if (dayType === "FULL") return true;
  if (dayType === "QURAN_ONLY") return track === "quran";
  return false; // OFF | HOLIDAY
}

/**
 * The base day-type for a weekday index (0=Sun … 6=Sat), holidays aside — used to
 * validate a recurring weekly slot (R2.1): Sun–Thu = FULL, Sat = QURAN_ONLY, Fri =
 * OFF. (Holidays are date-specific overrides and don't bear on a weekly slot.)
 */
export function weekdayBaseDayType(dayIndex: number): DayType {
  if (dayIndex >= 0 && dayIndex <= 4) return "FULL";
  return dayIndex === 6 ? "QURAN_ONLY" : "OFF";
}

/** Local-day bounds (midnight..23:59:59.999) for holiday range queries. */
function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return { start, end };
}

/** Resolve the day-type for a date, consulting HolidayException overrides. */
export async function resolveDayType(date: Date): Promise<DayType> {
  const { start, end } = dayBounds(date);
  const holiday = await HolidayException.findOne({
    active: true,
    fromDate: { $lte: end },
    toDate: { $gte: start },
  }).lean();
  return dayTypeFor(date, holiday !== null);
}

/** Answers "what kind of day is this?" with no further I/O. */
export type DayTypeResolver = (date: Date) => DayType;

/**
 * Build a day-type resolver for a whole DATE RANGE in ONE query.
 *
 * `resolveDayType` is per-date and hits the DB every call, which is fine for one
 * lookup and catastrophic in a loop: the class-test dashboard was spending 224 of
 * its 265 database round trips re-reading a holiday table holding a single row,
 * because every exam rebuilt a ~70-day calendar one `findOne` per day (measured
 * 2026-08-16: `reportsStatus` took 75s on FIVE exams). Callers that need more than
 * one day should build one of these and reuse it.
 *
 * The range is inclusive and the resolver is safe outside it — a date beyond the
 * loaded window simply sees no holiday and falls back to the weekday rule, which is
 * the same answer `resolveDayType` gives when no exception covers the day.
 */
export async function buildDayTypeResolver(from: Date, to: Date): Promise<DayTypeResolver> {
  const { start } = dayBounds(from);
  const { end } = dayBounds(to);
  const holidays = (await HolidayException.find({
    active: true,
    fromDate: { $lte: end },
    toDate: { $gte: start },
  })
    .select("fromDate toDate")
    .lean()) as unknown as Array<{ fromDate: Date; toDate: Date }>;

  // Pre-expand to a set of covered local-day timestamps: holiday rows are few and
  // short, so this is far cheaper than an interval scan per lookup.
  const covered = new Set<number>();
  for (const h of holidays) {
    const first = dayBounds(new Date(h.fromDate)).start;
    const last = dayBounds(new Date(h.toDate)).start;
    for (let t = first.getTime(); t <= last.getTime(); ) {
      covered.add(t);
      const next = new Date(t);
      next.setDate(next.getDate() + 1);
      t = next.getTime();
    }
  }
  return (date: Date) => dayTypeFor(date, covered.has(dayBounds(date).start.getTime()));
}
