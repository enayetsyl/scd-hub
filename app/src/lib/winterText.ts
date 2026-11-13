/**
 * Winter booklet text helpers (D-#1620) — the booklet source keeps the build's small markup
 * ({box} {tick} {blank} **bold**); the review screen shows it as plain text, the stored text
 * keeps the tokens so the rebuilt PDF is unchanged.
 */
export function plainWinterText(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/\{wbox\}/g, "▢▢")
    .replace(/\{box\}/g, "▢")
    .replace(/\{tick\}/g, "☐")
    .replace(/\{sblank\}/g, "____")
    .replace(/\{blank\}/g, "________");
}

