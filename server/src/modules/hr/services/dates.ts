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
