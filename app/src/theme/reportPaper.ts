/**
 * The report tables' own "paper" palette.
 *
 * A report grid deliberately paints a fixed printed-report look (blue header,
 * blue-tinted zebra rows) instead of the theme surface, because it is the
 * on-screen twin of the print/CSV export. That is a conscious exception to the
 * "screens never hard-code a hex" rule in `theme/tokens.ts` — but it only works
 * if the TEXT colours are pinned here too. They used to come from the theme
 * (`Body` → textPrimary, `Muted` → textSecondary), so on a device set to DARK
 * mode the near-white `#E7ECE9` body text landed on these hard-coded near-white
 * rows and read as washed-out grey, while the same screen looked black-on-white
 * on a light-mode device (owner report 2026-08-02). Paper is paper in both
 * schemes: keep every colour in these tables on this one surface.
 *
 * Shared by ClassNoteReportScreen (the date roll-up) and AllClassNotesScreen
 * (the note archive) so the two tables cannot drift apart.
 */
export const REPORT_PAPER = {
  headerBg: "#4f9cf9",
  headerText: "#fff",
  headerHint: "rgba(255,255,255,0.65)",
  headerDivider: "rgba(255,255,255,0.18)",
  rowEven: "#eef5ff",
  rowOdd: "#fff",
  rowPressed: "#dbeafe",
  rowBorder: "#dde7f5",
  /** Mirrors lightColors.textPrimary / textSecondary — pinned, not theme-resolved. */
  text: "#182420",
  textMuted: "#46554E",
} as const;
