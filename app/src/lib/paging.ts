/**
 * Paging hooks (D-#761). See docs/pagination.md for when to use which.
 *
 *  - `usePagedRows(rows, { pageSize, resetKey })`: CLIENT-side paging of a list the
 *    server already bounds (a date window, one section, one month). Render `shown`, put
 *    `<Pager {...pager} />` under it.
 *  - `usePageState(resetKey)`: the page number for a SERVER-paged `<name>Page` query.
 *    Pass `page` + `PAGE_SIZE` as query variables and render `<Pager>` with the returned
 *    `total`.
 *
 * Both jump back to page 1 whenever `resetKey` changes. Build it from the filters
 * (e.g. `${classLevel}|${subject}`), so a new filter never opens on an empty page 7.
 */
import React from "react";

export const PAGE_SIZE = 50;

export function usePageState(resetKey?: unknown): [number, (page: number) => void] {
  const [page, setPage] = React.useState(1);
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setPage(1);
  }, [resetKey]);
  return [page, setPage];
}

export function usePagedRows<T>(
  rows: readonly T[],
  opts: { pageSize?: number; resetKey?: unknown } = {},
): { shown: T[]; pager: { page: number; pageSize: number; total: number; onPage: (page: number) => void } } {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const [page, setPage] = usePageState(opts.resetKey);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  // Rows can shrink under the current page (an item resolved, a refetch); never strand
  // the reader on a page past the end.
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  return {
    shown: rows.slice(start, start + pageSize),
    pager: { page: current, pageSize, total: rows.length, onPage: setPage },
  };
}
