/**
 * AL-14 - the dev-site clock on the client. The server's `devClock` query says whether the dev clock is on; when it is
 * the app shifts its own `Date` by the same offset (so "today", deadlines and Today cards read as the dev day) and a
 * thin banner says so. On prod the query answers `active: false` and NOTHING is patched (no banner, no Proxy).
 *
 * `makeOffsetDate` is a byte-for-byte twin of `server/src/lib/devClockOffset.ts` (a server test keeps them in step).
 * No imports: pure, importable from the node test runner.
 */
export function makeOffsetDate(Base: DateConstructor, getOffsetMs: () => number): DateConstructor {
  return new Proxy(Base, {
    construct(target, args, newTarget) {
      if (args.length === 0) return Reflect.construct(target, [target.now() + getOffsetMs()], newTarget);
      return Reflect.construct(target, args, newTarget);
    },
    apply(target) {
      return new target(target.now() + getOffsetMs()).toString();
    },
    get(target, prop) {
      if (prop === "now") return () => target.now() + getOffsetMs();
      return Reflect.get(target, prop);
    },
  });
}

export interface DevClockInfo {
  active: boolean;
  todayKey: string | null;
  offsetMs: number | null;
}

let current: DevClockInfo = { active: false, todayKey: null, offsetMs: null };
let offsetMs = 0;
let patched = false;
let realDate: DateConstructor | null = null;
const listeners = new Set<() => void>();

/** Apply the server's answer: patch Date on first activation, then only move the offset; inactive -> offset 0. */
export function applyDevClock(info: DevClockInfo | null | undefined, target: { Date: DateConstructor } = globalThis as unknown as { Date: DateConstructor }): void {
  const next: DevClockInfo =
    info && info.active === true && typeof info.offsetMs === "number" && Number.isFinite(info.offsetMs) && info.offsetMs !== 0
      ? { active: true, todayKey: info.todayKey ?? null, offsetMs: info.offsetMs }
      : { active: false, todayKey: null, offsetMs: null };
  if (next.active) {
    offsetMs = next.offsetMs as number;
    if (!patched) {
      realDate = target.Date;
      target.Date = makeOffsetDate(realDate, () => offsetMs);
      patched = true;
    }
  } else {
    offsetMs = 0; // never patched on prod; if it was on and the lead switched it off, the shift just reads 0
  }
  const changed = next.active !== current.active || next.todayKey !== current.todayKey;
  current = next;
  if (changed) listeners.forEach((l) => l());
}

export function getDevClockInfo(): DevClockInfo {
  return current;
}
export function subscribeDevClock(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
/** Test helper. */
export function resetDevClockForTests(target: { Date: DateConstructor } = globalThis as unknown as { Date: DateConstructor }): void {
  if (patched && realDate) target.Date = realDate;
  patched = false;
  realDate = null;
  offsetMs = 0;
  current = { active: false, todayKey: null, offsetMs: null };
}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
const MONTHS_BN = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The banner line for a `YYYY-MM-DD` key; null when the key is unusable. */
export function devClockBannerText(todayKey: string | null | undefined, lang: "bn" | "en"): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayKey ?? "");
  if (!m) return null;
  const mi = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (mi < 0 || mi > 11) return null;
  if (lang === "en") return `Dev clock: ${day} ${MONTHS_EN[mi]} ${m[1]} - test site`;
  const bn = (s: string) => s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)] as string);
  return `ডেভ ঘড়ি: ${bn(String(day))} ${MONTHS_BN[mi]} ${bn(m[1] as string)} — পরীক্ষার সাইট`;
}
