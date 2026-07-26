/**
 * HR leave date helpers (pure; unit-tested directly). Leave is recorded in
 * inclusive `YYYY-MM-DD` day keys (the same key shape attendance uses), so the math
 * lives here independent of any module.
 */
export class LeaveError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "LeaveError";
  }
}

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a YYYY-MM-DD key and return its UTC-midnight Date. */
export function parseDateKey(key: string): Date {
  if (!KEY_RE.test(key)) throw new LeaveError(`Invalid date key: ${key}`);
  const d = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new LeaveError(`Invalid date key: ${key}`);
  return d;
}

/** Inclusive calendar-day span between two keys (fromKey ≤ toKey). v1 counts every
 *  calendar day in the window (working-days exclusion is a parked refinement, §3a.4). */
export function countLeaveDays(fromKey: string, toKey: string): number {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (from > to) throw new LeaveError("fromDate must not be after toDate");
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Round a day count to 2dp for display/serialization (D-#361). Partial days are held
 *  as the exact fraction 1/3 so three of them sum back to 1.0 — but 1/3 + 1/3 + 1/3 is
 *  0.9999999999999999 in IEEE-754, so every number that LEAVES the service (a balance,
 *  an application's `days`, a paid/unpaid split) rounds here, never at the source. */
export function roundLeaveDays(days: number): number {
  return Math.round(days * 100) / 100;
}

/** The period numbers a partial-day leave is absent for (D-#361), given the last
 *  period of that staff member's teaching day. `late_entry` misses the FIRST n periods
 *  (1..n — the teacher joins at n+1); `early_leave` misses the LAST n (…lastPeriod).
 *  Pure so the window is unit-testable without a routine; `full` has no window.
 *  `count` is clamped into [1, lastPeriod] — a teacher asking for more periods than the
 *  day holds is simply out for the whole teaching day, which is what they meant. */
export function partialPeriodWindow(
  dayPart: "full" | "late_entry" | "early_leave",
  count: number,
  lastPeriod: number,
): number[] {
  if (dayPart === "full") return [];
  if (!Number.isInteger(count) || count < 1) throw new LeaveError("Choose at least 1 period for a partial-day leave");
  if (lastPeriod < 1) return [];
  const n = Math.min(count, lastPeriod);
  return dayPart === "late_entry"
    ? Array.from({ length: n }, (_, i) => i + 1)
    : Array.from({ length: n }, (_, i) => lastPeriod - n + 1 + i);
}

/** Does [fromKey, toKey] cover dateKey? (string compare is valid for ISO keys). */
export function rangeCovers(fromKey: string, toKey: string, dateKey: string): boolean {
  return fromKey <= dateKey && dateKey <= toKey;
}

/** Every calendar day in [fromKey, toKey] inclusive — UTC-midnight Date + its own
 *  YYYY-MM-DD key (PXG-1 — the per-meeting cover fan-out walks each day of a leave
 *  to find that day's actual routine slots). Not a school-day filter itself — the
 *  caller checks each date. */
export function datesInRange(fromKey: string, toKey: string): Array<{ date: Date; dateKey: string }> {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  const out: Array<{ date: Date; dateKey: string }> = [];
  for (let d = from; d <= to; d = new Date(d.getTime() + 86_400_000)) {
    out.push({ date: d, dateKey: d.toISOString().slice(0, 10) });
  }
  return out;
}
