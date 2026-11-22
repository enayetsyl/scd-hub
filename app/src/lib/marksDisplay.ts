/**
 * marksDisplay — how confirmed homework marks read on every screen (AL-5, AC-B12, AC-B18, R32, R35).
 *
 * PURE module (no React / React Native / `labels` import) so the server suite can unit-test it, the posture
 * `giftGrouping.ts` takes — the app workspace has no test runner.
 *
 * Marked work shows numbers only: "৭/১০ · ৭০%". The guardian also gets a level word ("৮/১০ — ভালো"). The words
 * CORRECT / PARTIAL / WRONG (and their Bangla labels) are an internal `result` and never appear next to marks (R35).
 * The thresholds are the shared vocab's `MARKS_LEVEL_WORDS`, never typed here.
 */
import { MARKS_LEVEL_WORDS, marksLevelWord } from "@scd/shared";

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/** Western digits → Bangla digits (the default number formatter; components pass the language-aware `bnNum`). */
export const toBnDigits = (n: number | string): string => String(n).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]!);

/** A marks figure: whole numbers stay whole, half marks print with a ".5" (never "½"). */
export function fmtMarks(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 2) / 2);
}

/** Whole-number percentage of `earned` out of `available`; null when nothing was available (no division by 0). */
export function marksPercent(earned: number | null | undefined, available: number | null | undefined): number | null {
  if (typeof earned !== "number" || typeof available !== "number" || !Number.isFinite(earned) || !Number.isFinite(available) || available <= 0) return null;
  return Math.round((earned / available) * 100);
}

/** "৭/১০ · ৭০%" — null when there is no total yet (the caller shows nothing / a dash). */
export function marksLine(
  earned: number | null | undefined,
  available: number | null | undefined,
  num: (n: number | string) => string = toBnDigits,
): string | null {
  const pct = marksPercent(earned, available);
  if (pct === null) return null;
  return `${num(fmtMarks(earned as number))}/${num(fmtMarks(available as number))} · ${num(pct)}%`;
}

/** The guardian's level word for a marks percentage (R32): ≥90 খুব ভালো · ≥70 ভালো · ≥50 মোটামুটি · else আরও অনুশীলন দরকার. */
export function marksLevelLabel(pct: number, lang: "bn" | "en" = "bn"): string {
  return marksLevelWord(pct)[lang];
}

/** The guardian's card line: "৮/১০ — ভালো". Marks and a level word only — never the answer, never a result word. */
export function guardianMarksLine(
  earned: number | null | undefined,
  available: number | null | undefined,
  num: (n: number | string) => string = toBnDigits,
  lang: "bn" | "en" = "bn",
): string | null {
  const pct = marksPercent(earned, available);
  if (pct === null) return null;
  return `${num(fmtMarks(earned as number))}/${num(fmtMarks(available as number))} — ${marksLevelLabel(pct, lang)}`;
}

/** The badge tone for a marks percentage: green from the second level word up (ভালো and above), amber below — the vocab's thresholds. */
export const marksLevelTone = (pct: number): "ok" | "warn" => (pct >= MARKS_LEVEL_WORDS[1].minPct ? "ok" : "warn");
