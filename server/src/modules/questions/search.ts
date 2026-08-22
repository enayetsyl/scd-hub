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

/**
 * Apply one filter axis that accepts either a multi-select list or a single value (D-#524).
 *
 * A NON-EMPTY list wins and becomes `$in`. An EMPTY list is no constraint at all, NOT
 * "match nothing" — the client sends `[]` the moment the teacher clears the last chip, and
 * a `$in: []` there would blank the bank instead of widening it. With no list at all the
 * single-value arg still applies, so an installed app that has not taken the OTA keeps
 * working against the new server unchanged.
 */
export function applyMultiFilter(
  filter: Record<string, unknown>,
  path: string,
  many: readonly (string | null | undefined)[] | null | undefined,
  one: string | null | undefined,
): void {
  const values = (many ?? []).filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (values.length > 0) {
    filter[path] = { $in: values };
    return;
  }
  if (one) filter[path] = one;
}

/**
 * The chapter numbers a slice actually contains, ascending (D-#524).
 *
 * `address.number` is Mixed on the model: the question builder writes an integer, older
 * plan imports wrote a string. Both are coerced and de-duplicated so "4" and 4 are one
 * chapter, and the sort is NUMERIC — a string sort would file chapter 10 before 9.
 * Anything that is not a positive whole number is dropped rather than rendered as a chip.
 */
export function orderQuestionChapters(raw: readonly unknown[]): number[] {
  const nums = new Set<number>();
  for (const v of raw) {
    if (typeof v === "boolean") continue;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    if (Number.isInteger(n) && n > 0) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

/** Both forms a chapter number can take in `address.number`, for a Mongo `$in`. */
export function chapterMatchValues(chapters: readonly number[]): (number | string)[] {
  return chapters.filter((c) => Number.isInteger(c)).flatMap((c) => [c, String(c)]);
}
