/**
 * Script guard — SCHEMA check 8, ported from
 * `studybook-pipeline/src/validate-studybook.js` (SB-1, D-#432; widened D-#442).
 *
 * The allowlist is SHARED with the render pipeline's own guard: a string that passes
 * one must pass the other. Both files change together or neither does.
 *
 * **WHAT THIS ACTUALLY PROTECTS — corrected D-#442.** An earlier version of this
 * comment claimed the four embedded Noto faces cannot render anything outside the
 * allowlist, and that an em-dash therefore becomes a .notdef box in a printed book.
 * That was checked and is FALSE: all four faces carry U+2013 and U+2014. The claim was
 * invented when porting, and it mattered, because a rule defended on grounds that do
 * not exist is a rule nobody can reason about.
 *
 * The real risk is narrower and still serious: a character the fonts genuinely lack
 * renders as .notdef and the build SUCCEEDS anyway, so the box reaches print silently.
 * Arabic script is the live case — this content is drafted in chats where honorifics
 * are natural, and D-011 requires them transliterated or written in Bangla. Devanagari
 * digits, CJK, arrows and emoji are the same class.
 *
 * So the allowlist carries two jobs, and it is worth knowing which is which:
 *   - a FONT-COVERAGE floor (Arabic, CJK, emoji…) — a real, silent, unrecoverable bug;
 *   - a HOUSE-TYPOGRAPHY layer (which dashes and quotes a Bangla primer uses) — a
 *     style choice, and the owner's to make.
 *
 * Adding a codepoint is therefore allowed but never casual: verify the four faces in
 * `book-pipeline/fonts/` actually carry it (read the cmap; do not assume), change BOTH
 * guards, and record the decision. `scriptGuard.test.ts` pins what is in and what is
 * deliberately out.
 */

/** Allowed: tab/LF/CR, Basic Latin, Latin-1 Supplement, en/em dash, danda + double
 *  danda, the whole Bengali block, and ZWNJ/ZWJ. Nothing else. */
export function isAllowedCodepoint(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return true; // tab / newline / CR
  if (cp >= 0x20 && cp <= 0x7e) return true;                  // Basic Latin
  if (cp >= 0xa0 && cp <= 0xff) return true;                  // Latin-1 Supplement
  // D-#442: en dash + em dash. Verified present in all four embedded faces. Admitted
  // because the exclusion was style dressed as capability, and the em-dash is ordinary
  // punctuation in the English prompt text that travels beside the Bangla.
  if (cp === 0x2013 || cp === 0x2014) return true;            // – —
  if (cp === 0x0964 || cp === 0x0965) return true;            // danda / double danda
  if (cp >= 0x0980 && cp <= 0x09ff) return true;              // Bengali block
  if (cp === 0x200c || cp === 0x200d) return true;            // ZWNJ / ZWJ
  return false;
}

/** Every distinct disallowed character in `s`, in first-seen order. */
export function scanString(s: string): string[] {
  const bad = new Set<string>();
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && !isAllowedCodepoint(cp)) bad.add(ch);
  }
  return [...bad];
}

/** Walk any JSON value and report every string that carries a disallowed glyph.
 *  `path` mirrors the CLI's dotted form so a report reads the same either side. */
export function scanTree(
  value: unknown,
  path: string,
  onBad: (path: string, bad: string[], sample: string) => void,
): void {
  if (typeof value === "string") {
    const bad = scanString(value);
    if (bad.length) onBad(path, bad, value.slice(0, 48));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanTree(v, `${path}[${i}]`, onBad));
    return;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      scanTree((value as Record<string, unknown>)[k], `${path}.${k}`, onBad);
    }
  }
}
