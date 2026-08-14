/**
 * Local-calendar date keys (D-#304). `toISOString()` is UTC — in Bangladesh
 * (UTC+6) it returns YESTERDAY between midnight and 06:00 local, so any
 * "today" default built from it dated early-morning work a day back
 * (owner-reported on the Homework screen). Every client-side "today" /
 * date-key must go through this local formatter — the server-side mirror is
 * `modules/attendance/dates.dateKeyOf`.
 */
export const dateKey = (d: Date = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** `YYYY-MM-DD` + n days → `YYYY-MM-DD`, in the same local calendar as `dateKey`.
 *  Negative n walks backwards — which is the only direction the guardian history
 *  lists page (D-#476). Built through the Date constructor so month/year and DST
 *  roll over correctly rather than by string arithmetic. */
export const addDaysKey = (key: string, days: number): string => {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
};

/** Inclusive day count between two keys (`a` ≤ `b`): "2026-08-01".."2026-08-07" = 7.
 *  Compared at local midnight so a DST shift can't produce a fractional day. */
export const daysBetweenKeys = (a: string, b: string): number => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const start = new Date(ay ?? 1970, (am ?? 1) - 1, ad ?? 1).getTime();
  const end = new Date(by ?? 1970, (bm ?? 1) - 1, bd ?? 1).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
};

/** The widest window the CLASS-NOTES range query may ask for — mirrors the
 *  server's `GUARDIAN_RANGE_MAX_DAYS` (GuardianPortalService). Kept in sync by
 *  hand; the server rejects anything wider, so this is where that screen's
 *  paging has to stop. It applies to nothing else: the homework / attendance /
 *  leave queries are uncapped server-side and were left that way, since capping
 *  them would newly reject ranges a guardian can pick today. */
export const GUARDIAN_RANGE_MAX_DAYS = 92;

/** How far back the uncapped guardian histories will page. Not a server limit —
 *  a floor past which there is no school year left to show, so the list can
 *  honestly say "nothing older" instead of offering an endless button. */
export const GUARDIAN_MAX_LOOKBACK_DAYS = 400;
