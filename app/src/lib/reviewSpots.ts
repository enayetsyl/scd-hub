/**
 * Spot tags for review voice notes (VN-1): the places in a plan a clip can be about. Derived from
 * the plan's own headings (the rendered markdown), so no extra field on the plan is needed — a
 * session plan's lesson-flow steps (Hook, Exit-check, ...) and a chapter plan's sections show up
 * as the headings they already are.
 */

const MAX_SPOTS = 30;
const MAX_LABEL = 60;

/** Heading texts (## .. ####) of a markdown document, cleaned, in order, de-duplicated. */
export function planSpotOptions(markdown: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of (markdown ?? "").split(/\r?\n/)) {
    const m = /^#{2,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    // Drop emphasis / code marks and links' URLs so the tag reads as plain words.
    const label = m[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_LABEL);
    if (label === "" || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= MAX_SPOTS) break;
  }
  return out;
}
