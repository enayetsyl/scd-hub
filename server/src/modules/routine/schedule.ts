/**
 * Routine schedule maths — computed clock times + window/grid helpers (D-#55/#57).
 *
 * Period grids hold DURATIONS, not fixed clock times; absolute start/end are
 * computed from the active ScheduleWindow's day-start, so the whole grid slides
 * when the start time shifts (regular 07:00 → winter 07:15 → 07:30). All pure +
 * deterministic — times are passed in, the clock is never read here.
 */
import type { IGridPeriod } from "./models/PeriodGrid";

export interface ComputedPeriod extends IGridPeriod {
  startMinutes: number;
  endMinutes: number;
  startHHMM: string;
  endHHMM: string;
}

/** "HH:MM" from minutes-from-midnight. */
export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Minutes-from-midnight from "HH:MM". */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Compute absolute clock times for a grid from a day-start (D-#55). Periods run
 * back-to-back in `number` order; each period's start = the previous end. Does not
 * mutate the input.
 */
export function computePeriodTimes(dayStartMinutes: number, periods: IGridPeriod[]): ComputedPeriod[] {
  let cursor = dayStartMinutes;
  return [...periods]
    .sort((a, b) => a.number - b.number)
    .map((p) => {
      const startMinutes = cursor;
      const endMinutes = cursor + p.durationMin;
      cursor = endMinutes;
      return {
        ...p,
        startMinutes,
        endMinutes,
        startHHMM: minutesToHHMM(startMinutes),
        endHHMM: minutesToHHMM(endMinutes),
      };
    });
}

/**
 * Validate a grid's periods (R1.5): period numbers distinct, every duration > 0.
 * Overlap is impossible by construction (periods are sequential), so distinctness
 * of numbers is the invariant.
 */
export function periodsValid(periods: IGridPeriod[]): boolean {
  if (periods.length === 0) return false;
  const nums = periods.map((p) => p.number);
  return new Set(nums).size === nums.length && periods.every((p) => p.durationMin > 0);
}

/** Date-only (midnight) epoch for inclusive range comparisons. */
function dayKey(d: Date): number {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
}

/**
 * Pick the ScheduleWindow covering a date (R1.6), date-only inclusive. Windows
 * don't overlap by rule; if several match, the earliest-starting wins.
 */
export function windowFor<T extends { fromDate: Date; toDate: Date }>(date: Date, windows: T[]): T | null {
  const t = dayKey(date);
  const matches = windows.filter((w) => dayKey(w.fromDate) <= t && t <= dayKey(w.toDate));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => dayKey(a.fromDate) - dayKey(b.fromDate))[0];
}

/** Do two date ranges overlap (date-only, inclusive)? Rejects an overlapping window. */
export function dateRangesOverlap(aFrom: Date, aTo: Date, bFrom: Date, bTo: Date): boolean {
  return dayKey(aFrom) <= dayKey(bTo) && dayKey(bFrom) <= dayKey(aTo);
}
