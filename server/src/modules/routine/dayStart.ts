import { ScheduleWindow, type IScheduleWindow } from "./models/ScheduleWindow";
import { currentYearFilter } from "../foundation/services/currentYear";
import { windowFor } from "./schedule";

/** Fallback when no window exists at all (07:00 = 420). */
export const DEFAULT_DAY_START_MINUTES = 420;

/**
 * The regular-season ScheduleWindow in force ON `on` (date-only, inclusive), so a mid-year start-time
 * change (e.g. 07:00 → 07:30 from 15 Nov 2026, owner) takes effect on its own date. Falls back to the
 * earliest regular window of the current year when no window covers the day (the old behaviour, which
 * always took the earliest window and therefore never saw a later start time).
 */
export async function regularWindowOn(on: Date = new Date()): Promise<IScheduleWindow | null> {
  const wins = (await ScheduleWindow.find({ season: "regular", active: true, ...(await currentYearFilter()) })
    .sort({ fromDate: 1 })
    .lean()) as unknown as IScheduleWindow[];
  return windowFor(on, wins) ?? wins[0] ?? null;
}

/** Minutes from midnight at which the school day starts on `on`. */
export async function dayStartMinutesOn(on: Date = new Date()): Promise<number> {
  return (await regularWindowOn(on))?.dayStartMinutes ?? DEFAULT_DAY_START_MINUTES;
}
