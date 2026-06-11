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
