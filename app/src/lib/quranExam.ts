/**
 * Quran oral exam display helpers (D-#873–#877). The move preview mirrors the server's
 * rule (D-#875, quranExamMath.placeForMove) so Office sees the new time before tapping.
 */
import { STR, bnNum } from "./labels";

const LEVEL_KEYS: Record<string, "qxLvHifz3" | "qxLvHifz1" | "qxLvAmmapara" | "qxLvNajera" | "qxLvQaida"> = {
  "Hifz 3": "qxLvHifz3",
  "Hifz 1": "qxLvHifz1",
  Ammapara: "qxLvAmmapara",
  Najera: "qxLvNajera",
  Qaida: "qxLvQaida",
};

export function qxLevelLabel(level: string): string {
  const k = LEVEL_KEYS[level];
  return k ? STR[k] : level;
}

/** "07:30" → "৭:৩০" (no leading zero, Bangla digits in BN). */
export function qxTime(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return bnNum(hhmm);
  return bnNum(`${Number(m[1])}:${m[2]}`);
}

export function qxRange(start: string, end: string): string {
  return `${qxTime(start)}–${qxTime(end)}`;
}

export function qxReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "SICK":
      return STR.qxReasonSick;
    case "GUARDIAN_INFORMED":
      return STR.qxReasonInformed;
    case "OTHER":
      return STR.qxReasonOther;
    default:
      return STR.qxReasonUnknown;
  }
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** Where a moved sitting lands with an examiner whose other sittings are `busy`. */
export function qxPlaceForMove(
  current: { start: string; end: string },
  busy: { start: string; end: string }[],
): { start: string; end: string; kept: boolean } {
  const clash = busy.some((b) => toMin(b.start) < toMin(current.end) && toMin(current.start) < toMin(b.end));
  if (!clash) return { ...current, kept: true };
  const len = toMin(current.end) - toMin(current.start);
  const last = Math.max(...busy.map((b) => toMin(b.end)));
  return { start: fromMin(last), end: fromMin(last + len), kept: false };
}

export function qxLaterThan(a: string, b: string): boolean {
  return toMin(a) > toMin(b);
}

/** Hifz mark preview: full − floor(T / per) − cost × F, never below 0 (D-#874). */
export function qxHifzMark(full: number, per: number, cost: number, tanbih: number, fath: number) {
  const tanbihCut = Math.floor(tanbih / Math.max(1, per));
  const fathCut = fath * cost;
  return { tanbihCut, fathCut, mark: Math.max(0, full - tanbihCut - fathCut) };
}
