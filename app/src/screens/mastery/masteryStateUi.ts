/**
 * Mastery M-3 — one colour language for a state everywhere (badges, heat-map cells, chapter
 * grid). Colour always travels with text or a legend (mock I1/I3), never alone.
 */
import type { ThemeColors } from "../../theme";

export type StateTone = "danger" | "warn" | "ok" | "info" | "muted";

export function stateTone(state: string): StateTone {
  if (state === "WEAK") return "danger";
  if (state === "IMPROVING") return "warn";
  if (state === "MASTERED") return "ok";
  if (state === "REVISION_DUE") return "info";
  return "muted";
}

/** Solid fill for a grid cell + its text colour. NOT_ASSESSED is an outline (no evidence). */
export function stateCell(c: ThemeColors, state: string): { bg: string; fg: string; outline: boolean } {
  switch (state) {
    case "WEAK":
      return { bg: c.error, fg: "#FFFFFF", outline: false };
    case "IMPROVING":
      return { bg: c.warningContainer, fg: c.warning, outline: false };
    case "MASTERED":
      return { bg: c.primaryContainer, fg: c.onPrimaryContainer, outline: false };
    case "REVISION_DUE":
      return { bg: c.infoContainer, fg: c.info, outline: false };
    case "INSUFFICIENT":
      return { bg: c.surfaceAlt, fg: c.textSecondary, outline: false };
    default:
      return { bg: c.surface, fg: c.textSecondary, outline: true };
  }
}

/** The order states are listed in summaries. */
export const STATE_ORDER = ["WEAK", "IMPROVING", "REVISION_DUE", "MASTERED", "INSUFFICIENT", "NOT_ASSESSED"] as const;

/** "LO-C3-MATH-07-03" → "07-03"; "LO-C3-MATH-SK-ANS-01" → "ANS-01". */
export const shortLo = (code: string): string => code.replace(/^LO-[A-Z0-9]+-[A-Z]+-(SK-)?/, "");

export const fill = (tpl: string, vars: Record<string, string | number>): string =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), tpl);
