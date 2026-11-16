/**
 * Review supervision helpers (RS-4) - status wording/tones, minute formatting, and the sort that
 * puts the reviewer furthest behind first. Pure, so the screens stay about layout.
 */
import { STR, bnNum } from "./labels";
import type { ReviewerRowT } from "../graphql/reviewSupervision";

export type StatusTone = "ok" | "warn" | "danger" | "muted";

export function statusLabel(status: string): string {
  return status === "ON_TRACK"
    ? STR.rspStatusOn
    : status === "BEHIND"
      ? STR.rspStatusBehind
      : status === "FAR_BEHIND"
        ? STR.rspStatusFar
        : STR.rspStatusNoData;
}

export function statusTone(status: string): StatusTone {
  return status === "ON_TRACK" ? "ok" : status === "BEHIND" ? "warn" : status === "FAR_BEHIND" ? "danger" : "muted";
}

/** Worst first: far behind, behind, no data, on track. */
const SEVERITY: Record<string, number> = { FAR_BEHIND: 0, BEHIND: 1, NO_DATA: 2, ON_TRACK: 3 };

export function sortReviewers(rows: readonly ReviewerRowT[]): ReviewerRowT[] {
  return [...rows].sort(
    (a, b) =>
      (SEVERITY[a.status] ?? 2) - (SEVERITY[b.status] ?? 2) ||
      b.minutesRemaining - a.minutesRemaining ||
      (a.reviewerName ?? "").localeCompare(b.reviewerName ?? ""),
  );
}

/** Weighted minutes as a person reads them: minutes under 90, else hours with one decimal. */
export function minutesLabel(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "-";
  if (min < 90) return `${bnNum(Math.round(min))} ${STR.rspMin}`;
  return `${bnNum((min / 60).toFixed(1))} ${STR.rspHour}`;
}

/** Done / total as a 0..1 fraction (0 when there is nothing to do). */
export function fraction(done: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
}

/** "{a}" placeholders in a label; keeps wording in the label table, not in the screen. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

/** Bangla digits to Latin, so Number() reads what a teacher typed on a Bangla keyboard. */
export function latinDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
}

/** Short number for a narrow chart column: 1200 -> 1.2k style, in the active language. */
export function compactNum(n: number): string {
  if (n < 1000) return bnNum(n);
  return `${bnNum((n / 1000).toFixed(1).replace(/[.]0$/, ""))}${STR.rspThousandShort}`;
}
