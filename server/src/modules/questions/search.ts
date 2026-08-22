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

/**
 * Order the category codes a slice actually contains for the filter chip row (D-#511).
 *
 * Known codes come back in VOCAB order, not alphabetical or insertion order: the row
 * should read the way a paper is built (সংক্ষিপ্ত → MCQ → শূন্যস্থান → …), and Mongo's
 * `distinct` returns whatever order it likes. A code this build has no entry for — a
 * category a newer import introduced — is kept and appended rather than dropped, so a
 * server that is behind the data still offers the filter instead of hiding questions.
 *
 * Blank/non-string values are discarded, and duplicates collapse.
 */
export function orderQuestionCategories(
  present: readonly unknown[],
  vocab: readonly string[],
): string[] {
  const seen = new Set(
    present.filter((c): c is string => typeof c === "string" && c.trim() !== "").map((c) => c.trim()),
  );
  const known = vocab.filter((c) => seen.has(c));
  const unknown = [...seen]
    .filter((c) => !vocab.includes(c))
    .sort((a, b) => a.localeCompare(b, "bn"));
  return [...known, ...unknown];
}
