/**
 * Arabic word and letter-form helpers for the KG/Nursery আরবি rows (D-#802). Pure strings:
 * the joining itself is done by the font's shaper (pdfkit/fontkit on the server, the
 * browser/OS in the app), which is why a form is written as the letter plus a TATWEEL
 * (U+0640) on the side it joins — ـبـ is ب's middle form in every shaper.
 */
import { ARABIC_LETTERS } from "./sequences";

const TATWEEL = "ـ";
/** Harakat, tanwin, shadda, sukun, superscript alif, and the tatweel itself. */
const MARKS = /[ً-ٰٟـ]/g;

/** Letters that never join the letter AFTER them, so they have no initial or middle form. */
export const ARABIC_NON_JOINERS: ReadonlySet<string> = new Set(["ا", "د", "ذ", "ر", "ز", "و", "ء"]);

/** The letters that have all four forms. */
export const ARABIC_JOINERS: readonly string[] = ARABIC_LETTERS.filter((l) => !ARABIC_NON_JOINERS.has(l));

/** The word as a child writes it: no harakat (بَيْتٌ → بيت). */
export const bareWord = (w: string): string => w.replace(MARKS, "").trim();

/** The letters a word is written with, in order (تِلْمِيذٌ → ت ل م ي ذ). */
export const wordLetters = (w: string): string[] => [...bareWord(w)].filter((ch) => ch.trim() !== "");

export type LetterForm = "initial" | "medial" | "final";

/** A letter's shape inside a word, as a shaper-ready string. A non-joiner only has a final form. */
export function letterForm(l: string, form: LetterForm): string {
  if (ARABIC_NON_JOINERS.has(l) || form === "final") return `${TATWEEL}${l}`;
  return form === "initial" ? `${l}${TATWEEL}` : `${TATWEEL}${l}${TATWEEL}`;
}
