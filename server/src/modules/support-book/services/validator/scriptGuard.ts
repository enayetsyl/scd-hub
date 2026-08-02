/**
 * Script guard — SCHEMA check 8, ported byte-for-byte from
 * `studybook-pipeline/src/validate-studybook.js` (SB-1, D-#432).
 *
 * The allowlist is SHARED with the render pipeline's own guard: a string that
 * passes one must pass the other, because the reason it exists is that the four
 * embedded Noto faces cannot render anything outside it — a stray Arabic honorific
 * or an em-dash becomes .notdef boxes in a printed book, silently.
 *
 * **The rule is: fix the text, never widen the allowlist.** Arabic script (a live
 * temptation, since this content is drafted in chats where honorifics are natural),
 * Devanagari digits, CJK, arrows, emoji and the em-dash all FAIL by design. D-011
 * requires honorifics transliterated or written in Bangla.
 *
 * Do not "improve" this by adding a codepoint. If a build hits a stray glyph, the
 * JSON is wrong.
 */

/** Allowed: tab/LF/CR, Basic Latin, Latin-1 Supplement, danda + double danda,
 *  the whole Bengali block, and ZWNJ/ZWJ. Nothing else. */
export function isAllowedCodepoint(cp: number): boolean {
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return true; // tab / newline / CR
  if (cp >= 0x20 && cp <= 0x7e) return true;                  // Basic Latin
  if (cp >= 0xa0 && cp <= 0xff) return true;                  // Latin-1 Supplement
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
