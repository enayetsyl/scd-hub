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
import { buildDayTypeResolver } from "../routine/calendar";

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
  /** True from the deadline day ITSELF onward (D-#606), not the day after. */
  overdue: boolean;
  /** OPEN school-days between the deadline and `now`. 0 on the deadline day —
   *  the report is due, not yet late by any days (D-#606). */
  schoolDaysLate: number;
}

/**
 * Pure overdue derivation from a passed-in `now` (§9 — time inputs injected).
 *
 * D-#606: the comparison is `>=`, so a report is overdue ON its deadline day.
 * It used to be `>`, which gave a silent extra day: with Fri/Sat closed, a
 * Thursday exam's two school days land on Sun+Mon, and the row stayed green all
 * of Monday — the day it was actually due — turning "two days" into five
 * calendar days. Owner ruling 2026-08-31, from the prod dashboard.
 *
 * The `afterExam` guard preserves the D-#120 property that the clock is idle
 * until the exam date has passed. For `deadlineDays >= 1` the deadline is always
 * after the exam date, so it changes nothing; it matters only for
 * `deadlineDays === 0` (permitted by the model, and per-exam editable), where
 * `>=` alone would mark the report late at 00:00 on the exam's own day — before
 * the exam has even been sat.
 */
export function deriveOverdue(
  examDate: Date,
  deadlineDays: number,
  now: Date,
  isOpenDay: IsOpenDay,
): OverdueState {
  const deadline = deadlineFrom(examDate, deadlineDays, isOpenDay);
  const today = atMidnight(now).getTime();
  const afterExam = today > atMidnight(examDate).getTime();
  const overdue = today >= deadline.getTime() && afterExam;
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
  const end = new Date(start.getTime() + spanDays * DAY_MS);
  // ONE query for the window (was one per day — 224 of the class-test dashboard's
  // 265 round trips were this loop re-reading a single-row holiday table).
  const dayType = await buildDayTypeResolver(start, end);
  const open = new Set<number>();
  for (let i = 0; i <= spanDays; i++) {
    const day = new Date(start.getTime() + i * DAY_MS);
    if (dayType(day) === "FULL") open.add(atMidnight(day).getTime());
  }
  return (d: Date) => open.has(atMidnight(d).getTime());
}

/**
 * The same predicate for an ARBITRARY window, so a caller with many exams builds the
 * calendar ONCE and reuses it, instead of rebuilding a ~70-day window per exam.
 * `deriveOverdue`/`deadlineFrom` are pure, so they can take this directly.
 */
export async function buildIsOpenDayForRange(from: Date, to: Date): Promise<IsOpenDay> {
  const start = atMidnight(from);
  const end = atMidnight(to);
  const dayType = await buildDayTypeResolver(start, end);
  const open = new Set<number>();
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const day = new Date(t);
    if (dayType(day) === "FULL") open.add(atMidnight(day).getTime());
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
