/**
 * The sequences a Nursery/KG paper walks (D-#744): the Bangla alphabet in book
 * order, A–Z, and counting numbers in either script.
 *
 * Book order matters — "আগের বর্ণ লেখ" for ক is ঔ only if the paper treats the
 * alphabet as ONE line (স্বর then ব্যঞ্জন), which is how the Nursery Bangla book
 * prints its "পরের অক্ষর লিখি" page. The 39 consonants include ড় ঢ় য় ৎ ং ঃ ঁ, the
 * set the book's "অ থেকে ঁ পর্যন্ত" exercise and the 2026 syllabus count (১১ + ৩৯).
 */
import type { WorksheetAxis } from "@scd/shared";

export const BAN_VOWELS = ["অ", "আ", "ই", "ঈ", "উ", "ঊ", "ঋ", "এ", "ঐ", "ও", "ঔ"] as const;
export const BAN_CONSONANTS = [
  "ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ", "ঝ", "ঞ",
  "ট", "ঠ", "ড", "ঢ", "ণ", "ত", "থ", "দ", "ধ", "ন",
  "প", "ফ", "ব", "ভ", "ম", "য", "র", "ল", "শ", "ষ",
  "স", "হ", "ড়", "ঢ়", "য়", "ৎ", "ং", "ঃ", "ঁ",
] as const;
export const ENG_UPPER = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
export const ENG_LOWER = ENG_UPPER.map((c) => c.toLowerCase());

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const bnNumber = (n: number | string): string =>
  String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

/** The default book scope when nothing narrower is picked: the whole alphabet, 1–50
 *  (the Nursery maths book ends at ৫০). */
export const DEFAULT_NUMBER_UP_TO = 50;
export const MAX_NUMBER_UP_TO = 100;

/** "Taught up to" — a consonant/letter INDEX for alphabets, a number for maths. */
export interface Scope {
  /** Bangla: index into BAN_CONSONANTS (vowels are always in scope). English: index into A–Z. */
  letterUpTo?: number | null;
  numberUpTo?: number | null;
  /** The letters actually taught — one checkbox each (owner 2026-10-16). When given it
   *  replaces letterUpTo; a letter not ticked never appears and its pictures are not used. */
  letters?: string[] | null;
}

function clampIndex(v: number | null | undefined, max: number): number {
  if (v == null || !Number.isFinite(v)) return max;
  return Math.max(0, Math.min(max, Math.floor(v)));
}

/** The taught-letter set (owner 2026-10-16: a checkbox per letter), or null = no set given.
 *  English letters compare case-insensitively (stored upper-case). */
function taughtSet(scope: Scope): Set<string> | null {
  if (!scope.letters || scope.letters.length === 0) return null;
  return new Set(scope.letters.map((l) => (/^[a-z]$/i.test(l) ? l.toUpperCase() : l.trim())));
}

export function vowelsInScope(scope: Scope): readonly string[] {
  const set = taughtSet(scope);
  return set ? BAN_VOWELS.filter((v) => set.has(v)) : BAN_VOWELS;
}

export function consonantsInScope(scope: Scope): readonly string[] {
  const set = taughtSet(scope);
  if (set) return BAN_CONSONANTS.filter((c) => set.has(c));
  return BAN_CONSONANTS.slice(0, clampIndex(scope.letterUpTo, BAN_CONSONANTS.length - 1) + 1);
}

/** In-scope English capitals, in A–Z order. */
export function engUpperInScope(scope: Scope): string[] {
  const set = taughtSet(scope);
  if (set) return ENG_UPPER.filter((c) => set.has(c));
  return ENG_UPPER.slice(0, clampIndex(scope.letterUpTo, 25) + 1);
}

export function numberUpTo(scope: Scope): number {
  const n = scope.numberUpTo ?? DEFAULT_NUMBER_UP_TO;
  return Math.max(10, Math.min(MAX_NUMBER_UP_TO, Math.floor(n)));
}

/** The in-scope sequence an axis walks, in display form. With a taught-letter set the
 *  sequence is those letters in book order (gaps where a letter was not ticked). */
export function axisSequence(axis: WorksheetAxis, scope: Scope): string[] {
  switch (axis) {
    case "BAN_VOWEL":
      return [...vowelsInScope(scope)];
    case "BAN_CONSONANT":
      return [...consonantsInScope(scope)];
    case "BAN_ALL":
      return [...vowelsInScope(scope), ...consonantsInScope(scope)];
    case "ENG_UPPER":
      return engUpperInScope(scope);
    case "ENG_LOWER":
      return engUpperInScope(scope).map((c) => c.toLowerCase());
    case "NUM_BN":
      return Array.from({ length: numberUpTo(scope) }, (_, i) => bnNumber(i + 1));
    case "NUM_EN":
      return Array.from({ length: numberUpTo(scope) }, (_, i) => String(i + 1));
  }
}

export const isNumberAxis = (axis: WorksheetAxis): boolean => axis === "NUM_BN" || axis === "NUM_EN";

/** Is a picture's tagged first letter inside the taught scope? Unknown letters are out. */
export function letterInScope(letter: string, subject: string, scope: Scope): boolean {
  if (subject === "ENG") return engUpperInScope(scope).includes(letter.toUpperCase());
  return vowelsInScope(scope).includes(letter) || consonantsInScope(scope).includes(letter);
}
