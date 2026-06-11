/**
 * School-calendar helpers (handoff §6 cadence).
 *
 * HW-… issues on school nights only: Sun–Thu. Friday and Saturday are blocked
 * for homework (the weekend carries assignments only — handoff §6.1). Thursday
 * is a school night like any other (just a lighter roster — handoff §6.2).
 *
 * HW-T1 uses these for the due-date shift on re-delivery (§3 stage 2) and to
 * reject a declaration dated on a weekend (§6.1). The full issue-time cadence
 * gate (block Fri/Sat issuing) is HW-T2 and reuses the same predicates — the
 * weekly-holiday model + dated overrides (closed Saturdays, holidays) are a
 * later concern (mirrors prd-hr H3.5); this is the base Sun–Thu rule only.
 *
 * Day-of-week uses local time via Date#getDay (0=Sun … 6=Sat).
 */

/** School days: Sunday(0) – Thursday(4). Friday(5)+Saturday(6) are not. */
const SCHOOL_DAYS = new Set([0, 1, 2, 3, 4]);

/** True iff `date` falls on a school day (Sun–Thu). */
export function isSchoolDay(date: Date): boolean {
  return SCHOOL_DAYS.has(date.getDay());
}

/** True iff `date` is a weekend for HW-… purposes (Fri/Sat — issuing blocked). */
export function isWeekend(date: Date): boolean {
  return !isSchoolDay(date);
}

/**
 * The next school day strictly after `date` (skips Fri/Sat). Used as the default
 * due date ("next school morning", §3 stage 3) and the re-delivery shift
 * ("next school night", §3 stage 2). Returns a new Date at the same clock time.
 */
export function nextSchoolDay(date: Date): Date {
  const d = new Date(date.getTime());
  do {
    d.setDate(d.getDate() + 1);
  } while (!isSchoolDay(d));
  return d;
}
