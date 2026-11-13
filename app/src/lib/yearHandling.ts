/**
 * yearHandling (YC-5, docs/prd-year-change.md section 5) - the pure rules for living through the
 * year change on a phone that still holds the old year.
 *
 * PURE module (no React / React Native import) so the server suite can unit-test it, the
 * `sectionPicks.ts` / `giftGrouping.ts` posture - the app workspace has no test runner.
 *
 *   - `healSelection`  - SectionContext: what to do with a saved year/class/section pick
 *   - `yearOptionLabel` - AcademicYearSelect: a past year reads "2026 (গত বছর)"
 *   - `pastYearSuffix`  - a section id of a past year reads "... (2026)"
 */

export interface PickedSelection {
  academicYearId: string | null;
}

/**
 * The reset for a saved pick, or null when it stays.
 *
 * - No year / a year that no longer exists -> the current year, class and section cleared (D-#304).
 * - The current year CHANGED since this phone last saw it (the cut-over flipped it, or this is an
 *   install from before the rule) and the pick is not on the new current year -> the current
 *   year, class and section cleared: a teacher with a 2026 pick opens on 2027.
 * - A past year picked on purpose AFTER the flip stays: `seenCurrentYearId` is already the new year.
 */
export function healSelection(
  sel: PickedSelection,
  years: ReadonlyArray<{ id: string; current: boolean }>,
  seenCurrentYearId: string | null,
): { academicYearId: string; classId: null; sectionId: null } | null {
  if (years.length === 0) return null;
  const current = years.find((y) => y.current) ?? years[0];
  const reset = { academicYearId: current.id, classId: null, sectionId: null } as const;
  if (!sel.academicYearId || !years.some((y) => y.id === sel.academicYearId)) return { ...reset };
  if (seenCurrentYearId !== current.id && sel.academicYearId !== current.id) return { ...reset };
  return null;
}

/** "2027 ✓" for the current year, "2026 (গত বছর)" for an earlier one, the bare label otherwise. */
export function yearOptionLabel(y: { label: string; current: boolean }, currentLabel: string | null): string {
  if (y.current) return `${y.label} ✓`;
  if (currentLabel && y.label < currentLabel) return `${y.label} (গত বছর)`;
  return y.label;
}

/** " (2026)" when the year is earlier than the current one, else "". */
export function pastYearSuffix(yearLabel: string | null | undefined, currentLabel: string | null, digits: (s: string) => string = (s) => s): string {
  if (!yearLabel || !currentLabel || yearLabel >= currentLabel) return "";
  return ` (${digits(yearLabel)})`;
}

/** The typed confirmation of the cut-over: the new year's label, in English or Bangla digits. */
export function confirmMatchesYear(typed: string, yearLabel: string): boolean {
  const toLatin = (s: string): string => s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)).trim();
  return typed.trim() !== "" && toLatin(typed) === toLatin(yearLabel);
}
