/**
 * Bangla numerals for SERVER-RENDERED Bangla text — the PDF sheet and the outgoing
 * WhatsApp/notification bodies. Mirrors the app's `bnNum` so a message reads like the
 * screen it came from: a teacher-facing Bangla sentence with ASCII digits ("2টি ক্লাস
 * টেস্ট", "টেস্ট 1") reads as half-translated.
 *
 * Extracted from StudentProfileSheetService (which still re-exports it as `bn` for its
 * existing callers) so the chase-message renderers can share one definition.
 */
const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

export function bnNum(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return String(n).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}
