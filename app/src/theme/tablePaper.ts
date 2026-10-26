/**
 * Directory tables (the student list, the staff list) in the APP's colours — green header,
 * theme surfaces for the zebra rows — instead of REPORT_PAPER's fixed blue "printed report"
 * look (owner ask 2026-10-26: "theme color needs to change"). Every colour, text included,
 * resolves from the active scheme, so the dark-mode wash-out REPORT_PAPER guards against
 * (light text on pinned light rows) cannot happen here: rows and text flip together.
 * Same keys as REPORT_PAPER, so a table can switch by swapping its source.
 */
import { useColors } from "./index";

export function useTablePaper() {
  const c = useColors();
  return {
    headerBg: c.primary,
    headerText: c.onPrimary,
    headerDivider: "rgba(255,255,255,0.18)",
    rowEven: c.surfaceAlt,
    rowOdd: c.surface,
    rowBorder: c.border,
    text: c.textPrimary,
    textMuted: c.textSecondary,
    link: c.primary,
    toneOk: c.primary,
    toneWarn: c.warning,
    toneDanger: c.error,
  } as const;
}
