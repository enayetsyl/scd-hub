/**
 * Pure helpers for the question-bank free-text search (ux-audit F4).
 * Kept dependency-free so tests can import them without loading the schema.
 */

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Map Bangla digits to Latin so a "৪২" search can match qid "HW-0042". */
export function normalizeBanglaDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** Escape a user-supplied search term for use inside a RegExp. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
