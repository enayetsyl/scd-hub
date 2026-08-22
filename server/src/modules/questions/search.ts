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

/** The namespace that marks a `lesson_ref` value as a question CATEGORY (D-#511). */
export const QUESTION_CATEGORY_PREFIX = "QCAT-";

/**
 * Order the category codes a slice actually contains for the filter chip row (D-#511).
 *
 * NAMESPACE GATE FIRST. The category rides `lesson_ref`, whose contract meaning is a
 * *lesson handle* — and the bank really does hold those: `QP-MATH-C5-U03-L01-Q40`
 * carries `lesson_ref: "L01"`. Without this gate that lesson handle is offered as a
 * category chip, and the whole group appears for a subject that has no categories at
 * all. Only `QCAT-`-prefixed values are categories; everything else in the field is
 * somebody's lesson handle and is none of this filter's business.
 *
 * Known codes then come back in VOCAB order, not alphabetical or insertion order: the
 * row should read the way a paper is built (সংক্ষিপ্ত → MCQ → শূন্যস্থান → …), and Mongo's
 * `distinct` returns whatever order it likes. A `QCAT-` code this build has no entry
 * for — a category a newer import introduced — is kept and appended rather than dropped,
 * so a server behind the data still offers the filter instead of hiding questions.
 *
 * Blank/non-string values are discarded, and duplicates collapse.
 */
export function orderQuestionCategories(
  present: readonly unknown[],
  vocab: readonly string[],
): string[] {
  const seen = new Set(
    present
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim())
      .filter((c) => c.startsWith(QUESTION_CATEGORY_PREFIX) && c !== QUESTION_CATEGORY_PREFIX),
  );
  const known = vocab.filter((c) => seen.has(c));
  const unknown = [...seen]
    .filter((c) => !vocab.includes(c))
    .sort((a, b) => a.localeCompare(b, "bn"));
  return [...known, ...unknown];
}
