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
