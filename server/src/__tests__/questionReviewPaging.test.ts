/**
 * The reviewer queue is PAGINATED (prod incident, 2026-08-24).
 *
 * `listMyQuestionReviews` was an unbounded find. One reviewer-only teacher held
 * **2,742 assigned rounds**, so the query joined 2,743 rounds to 2,743 content
 * artifacts and serialised every question's full payload — 1.77 MB in one
 * response, then 2,742 cards rendered at once. The screen froze rather than
 * erroring, which is why it was reported as "the app hangs" and why no test and
 * no typecheck saw it: the code was correct, it just had no ceiling.
 *
 * These tests pin the ceiling. The assertions are about the QUERY the service
 * builds, because that is where the bug lived.
 */
import mongoose from "mongoose";

const chain = { sort: jest.fn(), skip: jest.fn(), limit: jest.fn(), lean: jest.fn() };
chain.sort.mockReturnValue(chain);
chain.skip.mockReturnValue(chain);
chain.limit.mockReturnValue(chain);
chain.lean.mockResolvedValue([]);

const mockFind = jest.fn((_q: unknown) => chain);
const mockCount = jest.fn((_q: unknown) => Promise.resolve(2742));
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    find: (q: unknown) => mockFind(q),
    countDocuments: (q: unknown) => mockCount(q),
  },
}));

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: { find: () => ({ lean: async () => [] }) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));

import {
  listMyQuestionReviews,
  countMyQuestionReviews,
  MY_QUESTION_REVIEWS_PAGE,
} from "../modules/questions/services/QuestionReviewService";

const REVIEWER = new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  jest.clearAllMocks();
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockResolvedValue([]);
});

describe("listMyQuestionReviews paging", () => {
  test("a caller that asks for nothing gets ONE PAGE, never the whole queue", async () => {
    await listMyQuestionReviews(REVIEWER);
    expect(chain.limit).toHaveBeenCalledWith(MY_QUESTION_REVIEWS_PAGE);
    expect(chain.skip).toHaveBeenCalledWith(0);
  });

  test("an old client sending no args still cannot trigger the unbounded read", async () => {
    // The installed APK predates this change and sends neither argument. It must
    // degrade to "the first 50", not to the 1.77 MB response that froze it.
    await listMyQuestionReviews(REVIEWER, {});
    expect(chain.limit).toHaveBeenCalledWith(MY_QUESTION_REVIEWS_PAGE);
  });

  test("honours an explicit page", async () => {
    await listMyQuestionReviews(REVIEWER, { limit: 20, offset: 40 });
    expect(chain.limit).toHaveBeenCalledWith(20);
    expect(chain.skip).toHaveBeenCalledWith(40);
  });

  test("caps the page so a client cannot ask for everything back", async () => {
    await listMyQuestionReviews(REVIEWER, { limit: 100000 });
    expect(chain.limit).toHaveBeenCalledWith(200);
  });

  test("refuses a nonsensical page rather than passing it to mongo", async () => {
    await listMyQuestionReviews(REVIEWER, { limit: 0, offset: -5 });
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(chain.skip).toHaveBeenCalledWith(0);
  });

  test("sorts assigned before submitted, with a STABLE tiebreak", async () => {
    // Without a unique final key the page boundary can repeat or skip a row when
    // several rounds share assignedAt — which bulk assignment guarantees.
    await listMyQuestionReviews(REVIEWER);
    expect(chain.sort).toHaveBeenCalledWith({ status: 1, assignedAt: -1, _id: 1 });
  });

  test("still asks only for the caller's own question rounds", async () => {
    await listMyQuestionReviews(REVIEWER);
    const q = mockFind.mock.calls[0][0] as Record<string, unknown>;
    expect(q.reviewerId).toBe(REVIEWER);
    expect(q.docType).toBe("question");
    expect(q.status).toEqual({ $in: ["assigned", "submitted"] });
  });
});

describe("countMyQuestionReviews", () => {
  test("counts the same set the list pages over", async () => {
    const n = await countMyQuestionReviews(REVIEWER);
    expect(n).toBe(2742);
    const q = mockCount.mock.calls[0][0] as Record<string, unknown>;
    expect(q.reviewerId).toBe(REVIEWER);
    expect(q.docType).toBe("question");
    expect(q.status).toEqual({ $in: ["assigned", "submitted"] });
  });
});

/**
 * The pager must not depend on the COUNT query.
 *
 * A static read of the screen, for the same reason the syllabus gate test is one:
 * the app workspace has no runner, and this was a well-typed boolean that was
 * simply wrong. The first cut computed `hasMore = rows.length < total`, so a
 * count that is slow, refused or errored made `total` fall back to 0, `hasMore`
 * go false, and the control render its EXHAUSTED state — 50 rows out of 2,742
 * with no way to reach the rest, and no way to tell that apart from having
 * genuinely reached the end. That is exactly how it was reported: "can't see any
 * pagination button".
 */
describe("the queue pager is self-contained", () => {
  const SRC = require("fs").readFileSync(
    require("path").resolve(__dirname, "../../../app/src/screens/review/QuestionReviewQueueScreen.tsx"),
    "utf8",
  ) as string;

  test("hasMore is decided by the last page's SIZE, not by the total", () => {
    const m = /const hasMore = ([^;]+);/.exec(SRC);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/lastPageSize/);
    expect(m![1]).not.toMatch(/total/);
  });

  test("the page size the screen requests matches the server's own default", () => {
    const m = /const PAGE_SIZE = (\d+);/.exec(SRC);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(MY_QUESTION_REVIEWS_PAGE);
  });

  test("a reload forgets the page-size evidence, so the pager re-arms", () => {
    const i = SRC.indexOf("const reload =");
    const body = SRC.slice(i, SRC.indexOf("}, [", i));
    expect(body).toMatch(/setLastPageSize\(null\)/);
  });

  test("a verdict does NOT re-pull the whole queue", () => {
    // Every verdict used to end in refetch(network-only), which re-downloaded the
    // entire list — the reason approving felt slower the more work was left.
    const single = SRC.slice(SRC.indexOf("async function decide("));
    expect(single).toMatch(/dropRows\(\[round\.id\]\)/);
    expect(single).not.toMatch(/refetch\(\{ requestPolicy: "network-only" \}\)/);
  });
});

/**
 * Paging must not move the reader.
 *
 * RefreshControl was wired to `fetching`, which is true for a "load more" as well
 * as for a pull-to-refresh — and a RefreshControl turning on drags a list back to
 * the top. Tapping আরও দেখুন therefore threw the reader to the first card, with
 * nothing to indicate whether rows had been appended.
 */
describe("paging does not yank the reader to the top", () => {
  const SRC = require("fs").readFileSync(
    require("path").resolve(__dirname, "../../../app/src/screens/review/QuestionReviewQueueScreen.tsx"),
    "utf8",
  ) as string;

  test("RefreshControl reflects a pull-to-refresh, NOT any in-flight query", () => {
    expect(SRC).toMatch(/refreshing=\{refreshing\}/);
    expect(SRC).not.toMatch(/refreshing=\{fetching\}/);
  });

  test("only reload() raises the refreshing flag", () => {
    const i = SRC.indexOf("const reload = useCallback");
    const body = SRC.slice(i, SRC.indexOf("}, [", i));
    expect(body).toMatch(/setRefreshing\(true\)/);
  });

  test("the flag is cleared when a page lands, so it cannot stick on", () => {
    expect(SRC).toMatch(/setRefreshing\(false\)/);
  });

  test("the load-more control carries the progress, since the caption is off-screen", () => {
    // A reader who has just paged is at the BOTTOM; the N / M line at the top is
    // invisible to them, so the count rides on the button itself.
    const i = SRC.indexOf("<LoadOlder");
    const block = SRC.slice(i, i + 600);
    expect(block).toMatch(/bnNum\(rounds\.length\)/);
  });
});
