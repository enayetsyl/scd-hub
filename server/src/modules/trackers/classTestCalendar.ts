/**
 * Class-test deadline + overdue derivation (CT-2, prd-tracker-class-test §5.1/§9,
 * D-#50/#120). The report deadline is anchored on the EXAM date (not the print
 * date) and counts SCHOOL days only — Fri/Sat and holidays are skipped, via the
 * ONE D-#50 calendar source (routine `resolveDayType`); no second calendar truth.
 *
 * Pure date math takes an injected `isOpenDay` predicate (no DB, no clock — the §5
 * deterministic posture); the async `resolveClassTestDeadline` is the thin resolver
 * over `resolveDayType` (open == FULL, matching vocabCalendar). Overdue is DERIVED
 * from a passed-in `now`, never a stored status; the cross-exam Reports-Status /
 * overdue-by-teacher aggregates are CT-4.
 */
import { resolveDayType } from "../routine/calendar";

const DAY_MS = 86_400_000;

/** Local-midnight copy (exam dates are date-only). */
export function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

export type IsOpenDay = (date: Date) => boolean;

/**
 * The deadline: advance `deadlineDays` OPEN school-days strictly after `examDate`
 * (each Fri/Sat/holiday is skipped, not counted). `deadlineDays === 0` ⇒ the exam
 * date itself is the deadline. Pure (injected `isOpenDay`).
 */
export function deadlineFrom(examDate: Date, deadlineDays: number, isOpenDay: IsOpenDay): Date {
  let d = atMidnight(examDate);
  let counted = 0;
  // Hard ceiling so a fully-closed calendar can never spin forever.
  let guard = 0;
  while (counted < deadlineDays && guard < 3650) {
    d = addDays(d, 1);
    guard += 1;
    if (isOpenDay(d)) counted += 1;
  }
  return d;
}

/**
 * School-days strictly after `from` up to and including `to` (the count of OPEN
 * days in the half-open window). Used for "school-days late". 0 when `to ≤ from`.
 */
export function schoolDaysBetween(from: Date, to: Date, isOpenDay: IsOpenDay): number {
  const start = atMidnight(from);
  const end = atMidnight(to);
  if (end.getTime() <= start.getTime()) return 0;
  let count = 0;
  let d = start;
  let guard = 0;
  while (d.getTime() < end.getTime() && guard < 3650) {
    d = addDays(d, 1);
    guard += 1;
    if (isOpenDay(d)) count += 1;
  }
  return count;
}

export interface OverdueState {
  deadline: Date;
  /** True iff `now` is strictly past the deadline (D-#120: the clock is idle until
   *  the exam date passes — a deadline ≥ examDate guarantees that naturally). */
  overdue: boolean;
  /** OPEN school-days between the deadline and `now` (0 until overdue). */
  schoolDaysLate: number;
}

/** Pure overdue derivation from a passed-in `now` (§9 — time inputs injected). */
export function deriveOverdue(
  examDate: Date,
  deadlineDays: number,
  now: Date,
  isOpenDay: IsOpenDay,
): OverdueState {
  const deadline = deadlineFrom(examDate, deadlineDays, isOpenDay);
  const overdue = atMidnight(now).getTime() > deadline.getTime();
  return {
    deadline,
    overdue,
    schoolDaysLate: overdue ? schoolDaysBetween(deadline, now, isOpenDay) : 0,
  };
}

// ---------------------------------------------------------------------------
// Async resolvers over the ONE D-#50 calendar source (open == FULL day-type)
// ---------------------------------------------------------------------------

/**
 * Build an `isOpenDay` predicate for the [examDate .. examDate + span] window by
 * resolving each day's type ONCE (open == "FULL"; Fri OFF, Sat QURAN_ONLY and any
 * HolidayException are NOT open for a class-test report). Defaults to a generous
 * span so deadline + lateness math never runs off the cached window.
 */
export async function buildIsOpenDay(examDate: Date, spanDays = 90): Promise<IsOpenDay> {
  const start = atMidnight(examDate);
  const open = new Set<number>();
  for (let i = 0; i <= spanDays; i++) {
    const day = new Date(start.getTime() + i * DAY_MS);
    if ((await resolveDayType(day)) === "FULL") open.add(atMidnight(day).getTime());
  }
  return (d: Date) => open.has(atMidnight(d).getTime());
}

/** The school-day-aware deadline for a class test (async resolver over D-#50). */
export async function resolveClassTestDeadline(examDate: Date, deadlineDays: number): Promise<Date> {
  const isOpenDay = await buildIsOpenDay(examDate, Math.max(deadlineDays + 7, 30));
  return deadlineFrom(examDate, deadlineDays, isOpenDay);
}

/** The full overdue state for a class test as of `now` (async resolver over D-#50). */
export async function resolveClassTestOverdue(
  examDate: Date,
  deadlineDays: number,
  now: Date,
): Promise<OverdueState> {
  // Span must cover examDate → now plus the deadline tail.
  const spanToNow = Math.ceil((atMidnight(now).getTime() - atMidnight(examDate).getTime()) / DAY_MS);
  const isOpenDay = await buildIsOpenDay(examDate, Math.max(spanToNow + 7, deadlineDays + 7, 30));
  return deriveOverdue(examDate, deadlineDays, now, isOpenDay);
}
