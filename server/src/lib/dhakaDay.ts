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
