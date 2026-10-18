/**
 * D-#761 — the support-book lists that grew without a way past their cap:
 *
 *   1. buildJobsPage — a book's render history, newest first (the old list stopped at 25)
 *   2. escalationsPage — the senior inbox, still OLDEST FIRST, same filters as the old
 *      query, and "open only" still the default
 *
 * DB-free: the book-plane models are mocked; each find() chain is recorded.
 */
const mockPlans: Array<{ model: string; q: unknown; sort?: unknown; skip?: unknown; limit?: unknown }> = [];
const mockCounts: Array<{ model: string; q: unknown }> = [];

function mockModel(name: string, rows: () => unknown[], total: () => number) {
  return {
    find: (q: unknown) => {
      const plan: (typeof mockPlans)[number] = { model: name, q };
      mockPlans.push(plan);
      const c: Record<string, unknown> = {};
      for (const m of ["sort", "skip", "limit"] as const) c[m] = (v: unknown) => { plan[m] = v; return c; };
      c.lean = async () => rows();
      return c;
    },
    countDocuments: async (q: unknown) => {
      mockCounts.push({ model: name, q });
      return total();
    },
  };
}

jest.mock("../modules/support-book/models/BookBuildJob", () => ({
  BookBuildJob: mockModel("BookBuildJob", () => [{ _id: "j1" }], () => 61),
}));
jest.mock("../modules/support-book/models/BookEscalation", () => ({
  BookEscalation: mockModel("BookEscalation", () => [{ _id: "e1" }], () => 7),
}));
// Loaded by the two services but not on these paths.
jest.mock("../modules/support-book/models/SupportBook", () => ({ SupportBook: {} }));
jest.mock("../modules/support-book/models/SupportBookLesson", () => ({ SupportBookLesson: {} }));
jest.mock("../modules/support-book/models/BookReviewRound", () => ({ BookReviewRound: {} }));
jest.mock("../modules/support-book/models/LessonPatch", () => ({ LessonPatch: {} }));
jest.mock("../modules/support-book/models/BookEvent", () => ({ writeBookEvent: jest.fn() }));
jest.mock("../modules/support-book/services/BookImageService", () => ({ bookStaleness: jest.fn() }));
jest.mock("../modules/support-book/services/BookCommentService", () => ({ openComments: jest.fn() }));

import { buildJobsPage } from "../modules/support-book/services/BookBuildService";
import { escalationsPage } from "../modules/support-book/services/BookReviewService";

beforeEach(() => {
  mockPlans.length = 0;
  mockCounts.length = 0;
});

describe("buildJobsPage", () => {
  it("pages one book's render history newest first, total = every job", async () => {
    const page = await buildJobsPage("BOOK-1", { page: 2, pageSize: 50 });
    expect(page).toEqual({ rows: [{ _id: "j1" }], total: 61, page: 2, pageSize: 50 });
    expect(mockPlans[0]).toMatchObject({
      q: { bookId: "BOOK-1" },
      sort: { queuedAt: -1, _id: -1 },
      skip: 50,
      limit: 50,
    });
    expect(mockCounts[0].q).toEqual({ bookId: "BOOK-1" });
  });
});

describe("escalationsPage", () => {
  it("defaults to open threads, oldest first", async () => {
    const page = await escalationsPage({}, {});
    expect(page.total).toBe(7);
    expect(mockPlans[0]).toMatchObject({
      q: { state: { $in: ["OPEN", "ANSWERED"] } },
      sort: { createdAt: 1, _id: 1 },
      skip: 0,
      limit: 50,
    });
  });

  it("'all' drops the state filter; book and lesson narrow", async () => {
    await escalationsPage({ bookId: "BOOK-1", lessonNo: 3, openOnly: false }, { page: 3, pageSize: 20 });
    expect(mockPlans[0]).toMatchObject({ q: { bookId: "BOOK-1", lessonNo: 3 }, skip: 40, limit: 20 });
    expect((mockPlans[0].q as Record<string, unknown>).state).toBeUndefined();
    expect(mockCounts[0].q).toEqual(mockPlans[0].q);
  });
});
