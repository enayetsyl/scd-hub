/**
 * Assignment-tracker cadence calendar (prd-tracker-assignment §4, D-#86).
 *
 * Pure helpers — no DB access. The week grid is COMPUTED from the schedule's
 * term anchor (never stored as ~1,300 rows); holiday awareness is injected as
 * an `isOpenDay` predicate the service builds from the ONE calendar source
 * (routine `dayTypeFor` + `HolidayException`, D-#50) — no second calendar truth.
 *
 * Rules (D-#86):
 *   1. Delivery anchor = `deliveryDayOfWeek` (default THU). Not open → roll to
 *      the PREVIOUS open day, bounded by the week's start.
 *   2. Due anchor = the first `dueDayOfWeek` strictly AFTER the delivery anchor
 *      (THU deliver → the following SUN). Not open → roll to the NEXT open day.
 *   3. A week whose window contains no open day (vacation week) is SUSPENDED —
 *      excluded from delivery-rate denominators (AS-T5).
 *   4. "Open" means a FULL school day: Sun–Thu and not a holiday. Saturday is
 *      Quran-only and Quran is excluded here (D-#36), so Saturday never hosts
 *      an assignment anchor.
 *
 * Weeks are CALENDAR weeks (Sun–Sat), continuously indexed from the term's first
 * week for storage/navigation. The user-facing label + the rotation slot use the
 * calendar WEEK-OF-MONTH (week containing the 1st = week 1, resetting each month;
 * a 5th week wraps to cycleWeek 1) — D-#275.
 */

/** True iff `date` is a FULL school day (Sun–Thu, no holiday override). */
export type IsOpenDay = (date: Date) => boolean;

export const CYCLE_WEEKS = 4;

/** Local-midnight copy of a date (anchors are date-only). */
export function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/** Sunday (getDay 0) that starts the calendar week containing `date` (D-#275 —
 *  weeks are calendar Sun–Sat weeks, the Sun–Thu school week). */
export function weekStartSunday(date: Date): Date {
  const d = atMidnight(date);
  return addDays(d, -d.getDay());
}

/** The schedule's first calendar-week Sunday — the Sunday of the week containing
 *  the term anchor. Week N's window = firstWeekSunday + (N−1)·7d. */
export function firstWeekSunday(termStartDate: Date): Date {
  return weekStartSunday(termStartDate);
}

/** 1-based CONTINUOUS calendar-week index of `date` (for storage + navigation);
 *  0 when `date`'s week precedes the term's first week. The month-week LABEL is
 *  derived separately (monthWeekOf) — D-#275. */
export function weekNumberFor(termStartDate: Date, date: Date): number {
  const first = firstWeekSunday(termStartDate).getTime();
  const wk = weekStartSunday(date).getTime();
  if (wk < first) return 0;
  return Math.round((wk - first) / (7 * 86_400_000)) + 1;
}

/** The Sunday that starts continuous week N's window. */
export function weekStartOf(termStartDate: Date, weekNumber: number): Date {
  return addDays(firstWeekSunday(termStartDate), (weekNumber - 1) * 7);
}

/** Calendar month + 1-based week-OF-MONTH of a week (D-#275): the Sun–Sat week
 *  containing the 1st = week 1, resetting each month. Assigned by the week's
 *  Saturday (end of week), so a week straddling a month boundary belongs to the
 *  month whose 1st it contains. */
export function monthWeekOf(weekStart: Date): { year: number; month: number; weekOfMonth: number } {
  const sat = addDays(weekStart, 6);
  const year = sat.getFullYear();
  const month = sat.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const weekOfMonth = Math.floor((sat.getDate() - 1 + firstDow) / 7) + 1;
  return { year, month, weekOfMonth };
}

/** Rotation slot for a week-of-month: ((weekOfMonth−1) mod 4)+1 — a month's 5th
 *  week wraps back to cycleWeek 1 (D-#275). */
export function cycleWeekOf(weekOfMonth: number): number {
  return ((weekOfMonth - 1) % CYCLE_WEEKS) + 1;
}

/** The unique date inside [weekStart, +7d) whose getDay() == dayOfWeek. */
export function anchorInWeek(weekStart: Date, dayOfWeek: number): Date {
  const offset = (dayOfWeek - weekStart.getDay() + 7) % 7;
  return addDays(weekStart, offset);
}

/** True iff the week's 7-day window contains at least one open day (rule 3). */
export function weekHasOpenDay(weekStart: Date, isOpenDay: IsOpenDay): boolean {
  for (let i = 0; i < 7; i++) {
    if (isOpenDay(addDays(weekStart, i))) return true;
  }
  return false;
}

/**
 * Delivery date for a week: the anchor, rolled to the PREVIOUS open day when
 * closed (rule 1), bounded by the week's start. Returns null when no open day
 * exists in [weekStart, anchor] — the service treats that week as suspended.
 * (A window whose only open days fall after the anchor can occur only with a
 * non-Sunday term anchor; delivering after the due anchor makes no sense, so
 * it suspends rather than guesses — anchor terms on a week boundary.)
 */
export function rollDeliveryDate(
  anchor: Date,
  weekStart: Date,
  isOpenDay: IsOpenDay,
): Date | null {
  for (let d = atMidnight(anchor); d.getTime() >= weekStart.getTime(); d = addDays(d, -1)) {
    if (isOpenDay(d)) return d;
  }
  return null;
}

/** Hard stop for the forward due-roll — a holiday run longer than this means
 *  the calendar data is wrong, not that the due date is 2 months out. */
const MAX_DUE_ROLL_DAYS = 60;

/**
 * Due date: the first `dueDayOfWeek` strictly AFTER the (unrolled) delivery
 * anchor, then rolled FORWARD to the next open day when closed (rule 2).
 * Returns null only if no open day exists within MAX_DUE_ROLL_DAYS.
 */
export function rollDueDate(
  deliveryAnchor: Date,
  dueDayOfWeek: number,
  isOpenDay: IsOpenDay,
): Date | null {
  const anchor = atMidnight(deliveryAnchor);
  const offset = ((dueDayOfWeek - anchor.getDay() + 7) % 7) || 7; // strictly after
  let d = addDays(anchor, offset);
  for (let i = 0; i <= MAX_DUE_ROLL_DAYS; i++) {
    if (isOpenDay(d)) return d;
    d = addDays(d, 1);
  }
  return null;
}

export interface ResolvedWeekDates {
  weekNumber: number;
  cycleWeek: number;
  weekStart: Date;
  /** Calendar-month label parts for the week (D-#275). */
  year: number;
  month: number;
  weekOfMonth: number;
  /** Vacation week — no open day in the window; expected items suspended (rule 3). */
  suspended: boolean;
  deliveryDate: Date | null;
  dueDate: Date | null;
}

/** Resolve one week's delivery/due dates per the §4 rules. */
export function resolveWeekDates(
  termStartDate: Date,
  weekNumber: number,
  deliveryDayOfWeek: number,
  dueDayOfWeek: number,
  isOpenDay: IsOpenDay,
): ResolvedWeekDates {
  const weekStart = weekStartOf(termStartDate, weekNumber);
  const mw = monthWeekOf(weekStart);
  const base = {
    weekNumber,
    cycleWeek: cycleWeekOf(mw.weekOfMonth),
    weekStart,
    year: mw.year,
    month: mw.month,
    weekOfMonth: mw.weekOfMonth,
  };
  if (!weekHasOpenDay(weekStart, isOpenDay)) {
    return { ...base, suspended: true, deliveryDate: null, dueDate: null };
  }
  const anchor = anchorInWeek(weekStart, deliveryDayOfWeek);
  const deliveryDate = rollDeliveryDate(anchor, weekStart, isOpenDay);
  if (!deliveryDate) {
    return { ...base, suspended: true, deliveryDate: null, dueDate: null };
  }
  const dueDate = rollDueDate(anchor, dueDayOfWeek, isOpenDay);
  if (!dueDate) {
    return { ...base, suspended: true, deliveryDate: null, dueDate: null };
  }
  return { ...base, suspended: false, deliveryDate, dueDate };
}
