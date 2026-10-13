/**
 * Student progress + improvement actions — small app-side helpers (D-#734..#738).
 * The rules themselves are the server's; this only names periods, states and colours.
 */
import { STR } from "./labels";
import { dateKey, addDaysKey } from "./dates";
import type { ThemeColors } from "../theme";

export type PeriodKey = "YEAR" | "TERM" | "D30";

/** [fromKey, toKey] for a board period, in the school calendar year. */
export function periodRange(p: PeriodKey, today: string = dateKey()): { fromKey: string; toKey: string } {
  const y = today.slice(0, 4);
  if (p === "D30") return { fromKey: addDaysKey(today, -30), toKey: today };
  if (p === "TERM") return { fromKey: `${y}-07-01`, toKey: `${y}-12-31` };
  return { fromKey: `${y}-01-01`, toKey: `${y}-12-31` };
}

export const periodLabel = (p: PeriodKey): string =>
  p === "D30" ? STR.impPeriod30 : p === "TERM" ? STR.impPeriodTerm : STR.impPeriodYear;

export const actionStateLabel = (s: string): string =>
  s === "UPCOMING" ? STR.impStUpcoming : s === "RUNNING" ? STR.impStRunning : s === "STOPPED" ? STR.impStStopped : STR.impStEnded;

export const actionStateTone = (s: string): "info" | "brand" | "muted" | "warn" =>
  s === "RUNNING" ? "info" : s === "UPCOMING" ? "warn" : s === "ENDED" ? "brand" : "muted";

export const rowStateLabel = (s: string): string =>
  s === "RUNNING" ? STR.impStateRunning : s === "BEHIND" ? STR.impStateBehind : s === "DONE" ? STR.impStateDone : STR.impStateNone;

export const rowStateTone = (s: string): "danger" | "info" | "warn" | "ok" =>
  s === "NONE" ? "danger" : s === "BEHIND" ? "warn" : s === "DONE" ? "ok" : "info";

export const trajectoryLabel = (t: string): string =>
  t === "up" ? STR.impTrajUp : t === "down" ? STR.impTrajDown : t === "steady" ? STR.impTrajSteady : STR.impTrajNa;

/** Percent band → background + text colour (number always shown too — never colour alone). */
export function bandColors(p: number, c: ThemeColors): { bg: string; fg: string; bold: boolean } {
  if (p >= 80) return { bg: c.primaryContainer, fg: c.onPrimaryContainer, bold: false };
  if (p >= 60) return { bg: c.surfaceAlt, fg: c.textPrimary, bold: false };
  if (p >= 40) return { bg: c.warningContainer, fg: c.warning, bold: true };
  return { bg: c.errorContainer, fg: c.onErrorContainer, bold: true };
}

export const trendArrow = (t: string): string => (t === "UP" ? " ▲" : t === "DOWN" ? " ▼" : "");

/** One day square on a strip: colour + the mark printed in it. */
export function dayLook(
  d: { status: string | null; by: string | null; future: boolean },
  c: ThemeColors,
): { bg: string; border: string; fg: string; mark: string; label: string } {
  if (d.future) return { bg: c.surface, border: c.border, fg: c.textSecondary, mark: "", label: STR.impLegendFuture };
  if (d.status === "DONE") {
    if (d.by === "COVER") return { bg: c.info, border: c.info, fg: c.onPrimary, mark: "C", label: STR.impLegendCover };
    if (d.by === "OFFICE") return { bg: c.textSecondary, border: c.textSecondary, fg: c.onPrimary, mark: "O", label: STR.impLegendOffice };
    return { bg: c.primary, border: c.primary, fg: c.onPrimary, mark: "✓", label: STR.impLegendDone };
  }
  if (d.status === "COULDNT") return { bg: c.warningContainer, border: c.warning, fg: c.warning, mark: "–", label: STR.impLegendCouldnt };
  return { bg: c.errorContainer, border: c.error, fg: c.onErrorContainer, mark: "?", label: STR.impLegendNotMarked };
}

/** "MM-DD" → "DD/MM" short label for a day square. */
export const shortDay = (k: string): string => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
