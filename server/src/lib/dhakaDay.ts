/**
 * Asia/Dhaka calendar-day helpers (D-#338). The school day is the Dhaka local
 * date regardless of server TZ — the same convention ScopeGrantService's proxy
 * window has always used (its dhakaDateStart now delegates here).
 */
const DHAKA_TZ = "Asia/Dhaka";

/** The Dhaka local date of an instant as a "YYYY-MM-DD" key. */
export function dhakaDayKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: DHAKA_TZ }); // en-CA = ISO order
}

/** Day-start of an instant's Dhaka date, as a UTC Date. */
export function dhakaDayStart(d: Date): Date {
  return new Date(`${dhakaDayKey(d)}T00:00:00+06:00`);
}

/** True when both instants fall on the same Dhaka calendar day. */
export function isSameDhakaDay(a: Date, b: Date): boolean {
  return dhakaDayKey(a) === dhakaDayKey(b);
}

/**
 * Whole Dhaka calendar days from `a`'s day to `b`'s day — 0 when they share a
 * day, 1 for "yesterday → today", negative when `b` precedes `a`. Counts DAYS,
 * not 24h spans, so a 23:30 action is one day old at 00:10, exactly as the
 * same-day gate always read it (D-#650 widens that gate to a day count).
 */
export function dhakaDaysApart(a: Date, b: Date): number {
  const ms = dhakaDayStart(b).getTime() - dhakaDayStart(a).getTime();
  return Math.round(ms / 86_400_000);
}
