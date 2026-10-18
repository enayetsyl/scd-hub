/**
 * The name a PERSON (student, staff member) is shown by — the English `name` first,
 * the Bangla `nameBn` only when there is no English one (D-#764). Mirrors the
 * server's `lib/personName`.
 *
 * Owner, 2026-10-18: "all the staff, guardian, teacher, students name in the app
 * primarily should be in English in display". Where a Bangla name exists, the staff
 * list, the staff hub header and the student profile show it as a smaller second line
 * (`personNameAlt`); lists, pickers and titles show the primary name only.
 *
 * Only for people — classes, sections, subjects and groups keep `nameBn`.
 * Deliberately a pure module (no React, no labels) like `nameList.ts`.
 */
type Named = { name?: string | null; nameBn?: string | null } | null | undefined;

export function personName(p: Named, fallback = ""): string {
  return p?.name?.trim() || p?.nameBn?.trim() || fallback;
}

/** The Bangla name as a second line — null when it is absent or IS the primary name. */
export function personNameAlt(p: Named): string | null {
  const bn = p?.nameBn?.trim();
  return bn && bn !== personName(p) ? bn : null;
}
