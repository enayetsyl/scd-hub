/**
 * Attendance date-key helpers (prd-attendance). The module keys every per-day row
 * by a LOCAL-date string `YYYY-MM-DD` ("dateKey") rather than a Date instant:
 * attendance is a school-local calendar concept, and a string key makes the
 * once-daily uniqueness indexes ({sectionId, dateKey}, {staffProfileId, dateKey})
 * and snapshot overwrites unambiguous across timezones.
 *
 * `resolveDayType` (routine/calendar.ts, D-#50) stays the single calendar source —
 * `parseDateKey` bridges a key back to a local-midnight Date for it.
 */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local-date key for a Date (school-local calendar day). */
export function dateKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse a `YYYY-MM-DD` key to a LOCAL-midnight Date. Throws on malformed input. */
export function parseDateKey(key: string): Date {
  if (!DATE_KEY_RE.test(key)) throw new Error(`Invalid date key: ${key}`);
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  // Reject impossible dates (e.g. 2026-02-31 rolls over in the Date ctor)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new Error(`Invalid date key: ${key}`);
  }
  return date;
}

export function isValidDateKey(key: string): boolean {
  try {
    parseDateKey(key);
    return true;
  } catch {
    return false;
  }
}

/** Lexicographic compare works for YYYY-MM-DD keys: a < b ⇔ a is the earlier day. */
export function dateKeyInRange(key: string, fromKey: string, toKey: string): boolean {
  return key >= fromKey && key <= toKey;
}

/** Every date key in [fromKey, toKey] inclusive (guarded against runaway ranges). */
export function dateKeysBetween(fromKey: string, toKey: string, maxDays = 400): string[] {
  const out: string[] = [];
  const end = parseDateKey(toKey);
  const cursor = parseDateKey(fromKey);
  while (cursor <= end) {
    out.push(dateKeyOf(cursor));
    if (out.length > maxDays) throw new Error(`Date range too large (> ${maxDays} days)`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
