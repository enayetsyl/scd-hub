/**
 * Which print request satisfies an assignment cell (D-#459 → D-#705 → D-#707).
 *
 * D-#705 (2026-10-01) matched by CLASS: in the first week after the C4/C5 boys/girls
 * split the Boys teacher printed one sheet and the Girls section handed out the same
 * copy. The owner then ruled (2026-10-02) that from now on each Boys/Girls section's
 * own teacher creates — and so prints — that section's assignment, so a class match
 * would hide a missing Girls print. Deliveries up to the cutover keep the class match
 * (the week that was printed that way stays cleared); later deliveries match by
 * SECTION again.
 */
export const PER_SECTION_PRINT_FROM = "2026-10-02";

/** The key a cell and its print request must share for a delivery date. */
export function printMatchKey(
  deliveryKey: string,
  cell: { classId: string; sectionId?: string | null; subject: string },
): string {
  return deliveryKey >= PER_SECTION_PRINT_FROM
    ? `s|${cell.sectionId ?? ""}|${cell.subject}`
    : `c|${cell.classId}|${cell.subject}`;
}
