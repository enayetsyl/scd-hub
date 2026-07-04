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
