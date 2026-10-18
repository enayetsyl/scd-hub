/**
 * Paging (D-#761) — the ONE shape every long list in the app pages through.
 *
 * Wire shape (GraphQL): `{ rows, total, page, pageSize }`, `page` 1-based. It is the
 * shape `assignablePlansPage` (D-#559) already used, so screens built on it keep working.
 * Register a GraphQL page type with `pageRef()` from `../pageRef`.
 *
 * Two ways to fill a page:
 *  - `queryPage()`: a Mongo filter. Skip/limit run in the database plus one countDocuments.
 *    Use this whenever the list is a plain find.
 *  - `pageOf()`: an in-memory array the service had to build anyway (joins, derived rows).
 *    Use it when the rows are computed. The DB still reads everything, but the WIRE
 *    and the screen get one page.
 *
 * BACKWARD COMPATIBILITY: phones run an older bundle for a while after every deploy (OTA
 * lands on the next cold start), and they call the same server. So a paged list is a NEW
 * `<name>Page` query beside the old one, never a change to the old one's shape or default.
 */
import type { FilterQuery, Model, SortOrder } from "mongoose";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface PageArgs {
  page?: number | null;
  pageSize?: number | null;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Clamp untrusted args: page ≥ 1, 1 ≤ pageSize ≤ MAX_PAGE_SIZE (default DEFAULT_PAGE_SIZE). */
export function normalizePage(
  args: PageArgs = {},
  defaultSize: number = DEFAULT_PAGE_SIZE,
): { page: number; pageSize: number; skip: number } {
  const pageSize = Math.min(Math.max(1, Math.floor(args.pageSize ?? defaultSize) || defaultSize), MAX_PAGE_SIZE);
  const page = Math.max(1, Math.floor(args.page ?? 1) || 1);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

/** One page of an already-built array (derived rows). */
export function pageOf<T>(all: readonly T[], args: PageArgs = {}, defaultSize?: number): Page<T> {
  const { page, pageSize, skip } = normalizePage(args, defaultSize);
  return { rows: all.slice(skip, skip + pageSize), total: all.length, page, pageSize };
}

/**
 * One page straight from the database: `find(filter).sort(sort).skip().limit()` plus a
 * `countDocuments(filter)`, run in parallel. `map` turns each lean doc into its DTO and
 * may be async (e.g. to join names for just this page's rows).
 */
export async function queryPage<D, T>(
  model: Model<D>,
  filter: FilterQuery<D>,
  sort: Record<string, SortOrder>,
  args: PageArgs,
  map: (docs: D[]) => T[] | Promise<T[]>,
  defaultSize?: number,
): Promise<Page<T>> {
  const { page, pageSize, skip } = normalizePage(args, defaultSize);
  const [docs, total] = await Promise.all([
    model.find(filter).sort(sort).skip(skip).limit(pageSize).lean<D[]>(),
    model.countDocuments(filter),
  ]);
  return { rows: await map(docs), total, page, pageSize };
}
