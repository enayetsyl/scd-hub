/**
 * The Bangla encoding guard (D-#523).
 *
 * Extracted from `TeachingNoteService` at SY-2, unchanged, because a SECOND
 * module now needs it (the exam syllabus, docs/prd-exam-syllabus.md §5.6 — the
 * owner's 2026 syllabus arrived in exactly this state). A guard used by two
 * modules that lives inside one of them drags that module's whole dependency
 * tree — Drive, the PDF renderer, the print queue — into the other's tests, and
 * the usual escape is a second copy of the regex, which is how two callers start
 * disagreeing about what counts as broken. `TeachingNoteService` re-exports these
 * so every existing import keeps working.
 *
 * Bangla UTF-8 read as Latin-1: `বাংলা` (E0 A6 AC …) surfaces as `à¦¬à¦¾…`.
 * U+00E0 followed by U+00A6/U+00A7 is the Bengali block's lead-byte pair and
 * essentially cannot occur in genuine text — it would need "à" immediately before
 * a broken-bar or section sign. The check is therefore precise, not heuristic.
 */
const MOJIBAKE_RE = /à[¦§]/;

export const MOJIBAKE_ERROR =
  "ফাইলটির বাংলা লেখা ভেঙে গেছে (এনকোডিং ভুল)। ফাইলটি UTF-8 হিসেবে সেভ করে আবার আপলোড করুন।";

/** True when `text` carries the UTF-8-read-as-Latin-1 signature. */
export function looksLikeMojibake(text: string): boolean {
  return MOJIBAKE_RE.test(text);
}

/** Throw the Bangla encoding error when `text` is mojibake. */
export function assertNotMojibake(text: string): void {
  if (looksLikeMojibake(text)) throw new Error(MOJIBAKE_ERROR);
}
