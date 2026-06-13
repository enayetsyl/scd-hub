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
 * Week N covers [termStart + (N−1)·7d, +7d) — the window starts on whatever
 * weekday the term anchor falls on. Week N maps to cycleWeek ((N−1) mod 4)+1.
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

/** 1-based week number of `date` relative to the term anchor; 0 when `date`
 *  precedes the term. */
export function weekNumberFor(termStartDate: Date, date: Date): number {
  const start = atMidnight(termStartDate).getTime();
  const day = atMidnight(date).getTime();
  if (day < start) return 0;
  return Math.floor(Math.round((day - start) / 86_400_000) / 7) + 1;
}

/** Week N of the year maps to cycleWeek ((N−1) mod 4)+1 (PRD §3). */
export function cycleWeekOf(weekNumber: number): number {
  return ((weekNumber - 1) % CYCLE_WEEKS) + 1;
}

/** The first day of week N's window: termStart + (N−1)·7d. */
export function weekStartOf(termStartDate: Date, weekNumber: number): Date {
  return addDays(atMidnight(termStartDate), (weekNumber - 1) * 7);
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
  const base = {
    weekNumber,
    cycleWeek: cycleWeekOf(weekNumber),
    weekStart,
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
