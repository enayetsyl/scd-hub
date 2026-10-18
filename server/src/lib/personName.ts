/**
 * The name a PERSON (student, staff member) is shown by — the English `name` first,
 * the Bangla `nameBn` only when there is no English one (D-#764).
 *
 * Owner, 2026-10-18: "all the staff, guardian, teacher, students name in the app
 * primarily should be in English in display" — on screens, inside the WhatsApp and
 * notification texts, and on printed PDFs. Every Student, StaffProfile, Guardian and
 * User on prod carries an English name (checked 2026-10-18), so the fallback is for
 * a malformed row, not a normal one.
 *
 * Only for people. Classes, sections, subjects and groups keep `nameBn` — those are
 * Bangla labels by design, not personal names.
 */
export function personName(
  p: { name?: string | null; nameBn?: string | null } | null | undefined,
  fallback = "",
): string {
  return p?.name?.trim() || p?.nameBn?.trim() || fallback;
}
