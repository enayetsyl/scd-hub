/**
 * VR-10 character rule (docs/prd-book-lifecycle.md §12.3), run on CHANGED text only.
 *
 * Reuses the render pipeline's script allow-list (`scriptGuard`, P15 — imported, not copied) and
 * widens it by exactly what a school book carries that the old lesson renderer did not: Arabic
 * script (governed separately by the sacred-text guard VR-12) and typographic quotes, ellipsis and
 * bullet (D-#1618). Control and zero-width characters are refused except ZWJ/ZWNJ inside Bangla;
 * no HTML except `bl:` comments; no URL or link may be added.
 */
import { isAllowedCodepoint } from "../../support-book/services/validator/scriptGuard";
import { ARABIC_RE } from "./markdown";

const EXTRA = new Set([0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x2022, 0x00a0]);

function allowed(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return isAllowedCodepoint(cp) || EXTRA.has(cp) || ARABIC_RE.test(ch);
}

const URL_RE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.|\]\((?!media\/)[^)]*\)/gi;
const HTML_RE = /<\/?[a-zA-Z][^>]*>|<!--(?! bl:)[\s\S]*?-->/g;

function count(re: RegExp, s: string): number {
  return (s.match(re) ?? []).length;
}

/** Null when fine, else one Bangla line naming what was found. `before` = the base text. */
export function checkCharacters(before: string, after: string): string | null {
  const beforeChars = new Set([...before]);
  const bad = new Set<string>();
  for (const ch of after) if (!beforeChars.has(ch) && !allowed(ch)) bad.add(ch);
  // ZWJ/ZWNJ only inside Bangla words.
  const zw = /[‌‍]/g;
  for (const m of after.matchAll(zw)) {
    const prev = after[m.index! - 1] ?? "";
    const next = after[m.index! + 1] ?? "";
    if (!/[ঀ-৿]/.test(prev) || !/[ঀ-৿]/.test(next)) {
      if (!before.includes(after.slice(Math.max(0, m.index! - 2), m.index! + 2))) bad.add(m[0]);
    }
  }
  if (bad.size) {
    const list = [...bad].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(", ");
    return `অনুমোদিত নয় এমন অক্ষর: ${list} (VR-10)`;
  }
  if (count(HTML_RE, after) > count(HTML_RE, before)) return "HTML যোগ করা যাবে না (VR-10)";
  if (count(URL_RE, after) > count(URL_RE, before)) return "লিংক/URL যোগ করা যাবে না (VR-10)";
  return null;
}
