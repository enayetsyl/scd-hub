/**
 * Class-test dashboard drill-down ORDER + PAGING (owner ask 2026-08-02).
 *
 * The list used to arrive in resolver order and render whole, so a Principal looking
 * for the release backlog read past every finished, published test to find it. Order
 * is by what still needs DOING:
 *
 *   0  complete, not yet visible to guardians — the release backlog
 *   1  incomplete AND overdue                 — the chase list
 *   2  incomplete                             — still in hand
 *   3  complete AND published                 — done; nothing to act on
 *
 * `state` is already a mutually-exclusive 4-way partition in which `overdue` MEANS
 * incomplete-and-past-deadline (ClassTestSummaryService.reportStateOf), so the four
 * buckets cover every row exactly once — no row can go unclassified as the data grows.
 *
 * Pure and dependency-free, like `lib/ctPublishStatus`, so the rule can be checked
 * without a running app and can be reused if a second screen ever shows this list.
 */

/** The only fields the ordering needs — any reports-status row satisfies this. */
export interface CtOrderableRow {
  state: string;
  publishedAt: string | null;
  examDate: string;
  schoolDaysLate: number;
}

/** Rows per page in the drill-down. */
export const CT_PAGE_SIZE = 50;

/**
 * Bucket 0 deliberately takes `!publishedAt` rather than the stricter "Unpublished"
 * badge (submitted-but-not-published), so a complete test whose marks were never
 * submitted lands with the work still to do instead of beside the finished ones.
 */
export function ctActionBucket(r: CtOrderableRow): number {
  if (r.state === "complete") return r.publishedAt ? 3 : 0;
  return r.state === "overdue" ? 1 : 2;
}

/** Bucket first; then newest exam first — except the overdue bucket, which leads with
 *  the most days late, the one worth chasing first. */
export function ctCompareRows(a: CtOrderableRow, b: CtOrderableRow): number {
  const ba = ctActionBucket(a);
  const bb = ctActionBucket(b);
  if (ba !== bb) return ba - bb;
  if (ba === 1) return b.schoolDaysLate - a.schoolDaysLate;
  return a.examDate < b.examDate ? 1 : a.examDate > b.examDate ? -1 : 0;
}

export function ctOrderRows<T extends CtOrderableRow>(rows: readonly T[]): T[] {
  return [...rows].sort(ctCompareRows);
}

/**
 * One page of an already-ordered list. `pageAt` is CLAMPED rather than reset by an
 * effect, so a filter that shrinks the list can never strand the view on an empty page.
 * `from` is 0-based; `page` is 0-based (add one to display).
 */
export function ctPageOf<T>(
  rows: readonly T[],
  pageAt: number,
  size: number = CT_PAGE_SIZE,
): { page: number; pageCount: number; from: number; rows: T[] } {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(Math.max(0, pageAt), pageCount - 1);
  const from = page * size;
  return { page, pageCount, from, rows: rows.slice(from, from + size) };
}
