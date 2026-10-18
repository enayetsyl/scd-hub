/**
 * D-#761 — the two assign pickers page on the server.
 *
 *  - `assignablePlansPage` gained the assign screen's own filters (the plan's
 *    reviewStatus, "unassigned only"); omitting them must keep the board's behaviour.
 *  - `listAssignableQuestionsPage` replaces a picker that asked for 300 rows and let the
 *    rest vanish: it must skip/limit in the database, count every match, sort stably,
 *    and join open rounds for the page's rows only.
 *
 * DB-free (the repo convention): models are mocked.
 */
import mongoose from "mongoose";

const chain = { sort: jest.fn(), skip: jest.fn(), limit: jest.fn(), lean: jest.fn() };
const mockArtFind = jest.fn((_q: unknown) => chain);
const mockArtCount = jest.fn((_q: unknown) => Promise.resolve(0));
jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    find: (q: unknown) => mockArtFind(q),
    countDocuments: (q: unknown) => mockArtCount(q),
  },
}));

const mockRoundFind = jest.fn();
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: { find: (q: unknown) => ({ lean: async () => mockRoundFind(q) }) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: () => ({ select: () => ({ lean: async () => [{ _id: mockReviewer, name: "Rina" }] }) }) },
}));

import { pagePlans, type AssignablePlanDTO } from "../modules/content/services/ReviewService";
import { listAssignableQuestionsPage } from "../modules/questions/services/QuestionReviewService";

const mockReviewer = new mongoose.Types.ObjectId();

beforeEach(() => {
  jest.clearAllMocks();
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockResolvedValue([]);
  mockRoundFind.mockResolvedValue([]);
});

const plan = (over: Partial<AssignablePlanDTO>): AssignablePlanDTO => ({
  artifactId: new mongoose.Types.ObjectId().toString(),
  docType: "chapter_plan",
  subject: "bangla",
  classLevel: 1,
  anchorWord: "পাঠ",
  addressNumber: "1",
  title: null,
  reviewStatus: "draft",
  currentReviewerId: null,
  currentReviewerName: null,
  currentAssignmentId: null,
  roundStatus: null,
  sessionIndex: null,
  roundNumber: null,
  verdict: null,
  assignedAt: null,
  submittedAt: null,
  ...over,
});

describe("pagePlans — the assign screen's filters", () => {
  const all = [
    plan({ reviewStatus: "draft" }),
    plan({ reviewStatus: "reviewed", currentReviewerId: "r1", currentAssignmentId: "a1", roundStatus: "submitted" }),
    plan({ reviewStatus: "draft", currentReviewerId: "r1", currentAssignmentId: "a2", roundStatus: "assigned" }),
    plan({ reviewStatus: "gold" }),
  ];

  test("omitting the new filters keeps every row (the board's behaviour)", () => {
    expect(pagePlans(all, {}, 1, 50).total).toBe(4);
  });

  test("reviewStatus filters on the plan's own status", () => {
    const p = pagePlans(all, { reviewStatus: "draft" }, 1, 50);
    expect(p.total).toBe(2);
    expect(p.rows.every((r) => r.reviewStatus === "draft")).toBe(true);
  });

  test("unassignedOnly drops plans with an open round", () => {
    expect(pagePlans(all, { unassignedOnly: true }, 1, 50).rows.map((r) => r.currentReviewerId)).toEqual([null, null]);
    expect(pagePlans(all, { unassignedOnly: true, reviewStatus: "gold" }, 1, 50).total).toBe(1);
  });

  test("total counts every match while rows hold one page", () => {
    const many = Array.from({ length: 120 }, () => plan({}));
    const p = pagePlans(many, { unassignedOnly: true }, 3, 50);
    expect(p).toMatchObject({ total: 120, page: 3, pageSize: 50 });
    expect(p.rows).toHaveLength(20);
  });
});

describe("listAssignableQuestionsPage", () => {
  test("pages in the database with the picker's filter and a stable sort", async () => {
    mockArtCount.mockResolvedValueOnce(959);
    const p = await listAssignableQuestionsPage({ subject: "math", classLevel: 3, page: 2, pageSize: 50 });

    const q = mockArtFind.mock.calls[0][0] as Record<string, unknown>;
    expect(q).toMatchObject({ docType: "question", current: true, retiredAt: null, subject: "math", classLevel: 3 });
    // Published questions are never assignable.
    expect(q.reviewStatus).toEqual({ $ne: "gold" });
    expect(mockArtCount).toHaveBeenCalledWith(q);
    expect(chain.sort).toHaveBeenCalledWith({ subject: 1, classLevel: 1, importedAt: -1, _id: -1 });
    expect(chain.skip).toHaveBeenCalledWith(50);
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(p).toEqual({ rows: [], total: 959, page: 2, pageSize: 50 });
  });

  test("an old-style call with no page still gets ONE page, never everything", async () => {
    await listAssignableQuestionsPage({});
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(chain.skip).toHaveBeenCalledWith(0);
  });

  test("search escapes regex characters and matches text or qid", async () => {
    await listAssignableQuestionsPage({ search: "a.b" });
    const q = mockArtFind.mock.calls[0][0] as { $or: { [k: string]: RegExp }[] };
    expect(q.$or).toHaveLength(2);
    expect(q.$or[0]["envelopeJson.payload.question_text"].source).toBe("a\\.b");
  });

  test("joins the open round for this page's questions only", async () => {
    const artId = new mongoose.Types.ObjectId();
    chain.lean.mockResolvedValueOnce([
      {
        _id: artId,
        subject: "math",
        classLevel: 3,
        reviewStatus: "draft",
        address: { anchorWord: "অধ্যায়", number: 2 },
        envelopeJson: { payload: { qid: "Q-1", question_text: "২ + ২ = ?" } },
      },
    ]);
    mockArtCount.mockResolvedValueOnce(1);
    const roundId = new mongoose.Types.ObjectId();
    mockRoundFind.mockResolvedValueOnce([{ _id: roundId, qid: "Q-1", reviewerId: mockReviewer, status: "assigned" }]);

    const p = await listAssignableQuestionsPage({ page: 1 });
    expect((mockRoundFind.mock.calls[0][0] as { qid: unknown }).qid).toEqual({ $in: ["Q-1"] });
    expect(p.rows[0]).toMatchObject({
      artifactId: artId.toString(),
      qid: "Q-1",
      addressNumber: "2",
      currentReviewerId: mockReviewer.toString(),
      currentReviewerName: "Rina",
      currentAssignmentId: roundId.toString(),
      roundStatus: "assigned",
    });
  });
});
