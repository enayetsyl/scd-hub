/**
 * The class-test PUBLISH axis (owner ask 2026-07-28) — deliberately ORTHOGONAL to the
 * entry state (`complete` / `in_progress` / `not_started` / `overdue`).
 *
 * Entry state answers "are the marks in?"; this answers "can the guardian see them?".
 * The two are independent: a test sits **Complete but Unpublished** for as long as
 * nobody releases it, and that gap is invisible on a screen that only shows entry state.
 *
 * There is no stored publish state to read — both facts are DERIVED from the two stamps
 * the reports-status row already carries (`submittedAt` / `publishedAt`), which is why
 * this needs no server change. Shared by ClassTestReportsScreen and
 * ClassTestDashboardScreen so the two screens can never disagree on what "unpublished"
 * counts as.
 */
import { STR } from "./labels";

export type CtPublishFilter = "submitted" | "published" | "unpublished";

/** Chip order on both screens. */
export const CT_PUBLISH_FILTERS: readonly CtPublishFilter[] = ["submitted", "published", "unpublished"];

/** The only two fields either screen needs — any reports-status row satisfies this. */
export interface CtPublishStamps {
  submittedAt: string | null;
  publishedAt: string | null;
}

/**
 * `unpublished` is the useful one: marks ARE in but the guardian still cannot see them.
 * It is NOT simply "no publishedAt" — a test whose marks were never submitted is not
 * waiting on a publish decision, so it must not inflate the release backlog.
 */
export function matchesCtPublishFilter(r: CtPublishStamps, f: CtPublishFilter): boolean {
  return f === "submitted"
    ? !!r.submittedAt
    : f === "published"
      ? !!r.publishedAt
      : !!r.submittedAt && !r.publishedAt;
}

export function ctPublishFilterLabel(f: CtPublishFilter): string {
  return f === "submitted"
    ? STR.ctFilterSubmitted
    : f === "published"
      ? STR.ctPublishedBadge
      : STR.ctUnpublishedBadge;
}

/** Per-row badge: published wins over submitted (it is the later, more specific fact). */
export function ctPublishBadge(r: CtPublishStamps): { text: string; tone: "ok" | "warn" | "muted" } {
  if (r.publishedAt) return { text: STR.ctPublishedBadge, tone: "ok" };
  if (r.submittedAt) return { text: STR.ctUnpublishedBadge, tone: "warn" };
  return { text: STR.ctNotSubmittedBadge, tone: "muted" };
}
