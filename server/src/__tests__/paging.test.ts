/**
 * D-#761 — the shared paging helpers every `<name>Page` query is built on.
 */
import { normalizePage, pageOf, queryPage, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../lib/paging";

describe("normalizePage", () => {
  it("defaults to page 1 of DEFAULT_PAGE_SIZE", () => {
    expect(normalizePage()).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, skip: 0 });
  });

  it("clamps junk: page < 1, pageSize < 1, pageSize over the max, fractions", () => {
    expect(normalizePage({ page: 0, pageSize: 0 })).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, skip: 0 });
    expect(normalizePage({ page: -3, pageSize: 10 })).toEqual({ page: 1, pageSize: 10, skip: 0 });
    expect(normalizePage({ page: 2, pageSize: 10_000 }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(normalizePage({ page: 2.9, pageSize: 20.5 })).toEqual({ page: 2, pageSize: 20, skip: 20 });
  });

  it("honours a per-list default size", () => {
    expect(normalizePage({}, 25).pageSize).toBe(25);
  });
});

describe("pageOf", () => {
  const all = Array.from({ length: 123 }, (_, i) => i + 1);

  it("slices the requested page and reports the full total", () => {
    const p = pageOf(all, { page: 3, pageSize: 50 });
    expect(p.rows).toEqual(all.slice(100, 123));
    expect(p).toMatchObject({ total: 123, page: 3, pageSize: 50 });
  });

  it("returns an empty page past the end, total intact", () => {
    expect(pageOf(all, { page: 9, pageSize: 50 })).toMatchObject({ rows: [], total: 123 });
  });
});

describe("queryPage", () => {
  it("runs skip/limit + countDocuments on the same filter and maps only this page", async () => {
    const calls: Record<string, unknown> = {};
    const chain = {
      sort(s: unknown) { calls.sort = s; return chain; },
      skip(n: number) { calls.skip = n; return chain; },
      limit(n: number) { calls.limit = n; return chain; },
      lean: async () => [{ n: 51 }, { n: 52 }],
    };
    const model = {
      find(f: unknown) { calls.find = f; return chain; },
      countDocuments: async (f: unknown) => { calls.count = f; return 52; },
    };
    const page = await queryPage(
      model as never,
      { sectionId: "s1" },
      { createdAt: -1 },
      { page: 2, pageSize: 50 },
      (docs: { n: number }[]) => docs.map((d) => `row ${d.n}`),
    );
    expect(calls).toEqual({ find: { sectionId: "s1" }, sort: { createdAt: -1 }, skip: 50, limit: 50, count: { sectionId: "s1" } });
    expect(page).toEqual({ rows: ["row 51", "row 52"], total: 52, page: 2, pageSize: 50 });
  });
});
