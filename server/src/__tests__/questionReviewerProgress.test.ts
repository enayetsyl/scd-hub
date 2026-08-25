/**
 * Reviewer progress (QR-5, D-#537) — "I gave Kaynat class 5; what has she done with it?"
 *
 * The single behaviour worth protecting here is that the counts are bucketed by VERDICT and
 * not by round status. `publishQuestion` supersedes the round it publishes, so a tally built
 * on `status: "submitted"` — which is exactly what the existing publish inbox is built on —
 * would drain a reviewer's "approved" column as the Principal worked through it. The most
 * productive reviewer would end up looking like the idlest one.
 *
 * The assertions are about the QUERY and the arithmetic, in the style of
 * questionReviewPaging.test.ts, because that is where this class of bug lives.
 */
import mongoose from "mongoose";

const chain = { sort: jest.fn(), skip: jest.fn(), limit: jest.fn(), lean: jest.fn() };
chain.sort.mockReturnValue(chain);
chain.skip.mockReturnValue(chain);
chain.limit.mockReturnValue(chain);
chain.lean.mockResolvedValue([]);

const mockFind = jest.fn((_q: unknown) => chain);
const mockCount = jest.fn((_q: unknown) => Promise.resolve(0));
const mockAggregate = jest.fn((_p: unknown) => Promise.resolve([] as unknown[]));
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    find: (q: unknown) => mockFind(q),
    countDocuments: (q: unknown) => mockCount(q),
    aggregate: (p: unknown) => mockAggregate(p),
  },
}));

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: { find: () => ({ lean: async () => [] }) },
}));

const KAYNAT = new mongoose.Types.ObjectId();
const AFIZA = new mongoose.Types.ObjectId();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: () => ({
      select: () => ({
        lean: async () => [
          { _id: KAYNAT, name: "Kaynat" },
          { _id: AFIZA, name: "Afiza" },
        ],
      }),
    }),
  },
}));

import {
  questionReviewerProgress,
  listQuestionReviewerRounds,
  countQuestionReviewerRounds,
  REVIEWER_ROUNDS_PAGE,
} from "../modules/questions/services/QuestionReviewService";
import { ReviewError } from "../modules/content/services/ReviewService";

/** Shape one $group emits, so a test can say what the DB "found" without a DB. */
function groupRow(
  id: mongoose.Types.ObjectId,
  counts: Partial<{
    assigned: number;
    pending: number;
    approved: number;
    approvedWithCondition: number;
    rejected: number;
  }>,
) {
  return {
    _id: id,
    assigned: 0,
    pending: 0,
    approved: 0,
    approvedWithCondition: 0,
    rejected: 0,
    ...counts,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockResolvedValue([]);
  mockAggregate.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
});

describe("questionReviewerProgress — the rollup", () => {
  test("counts a decision by its VERDICT, with no status condition attached", async () => {
    // The regression this whole slice exists to prevent. Each verdict counter must be a
    // bare $eq on `verdict`; the moment one of them also tests `status`, every published
    // question stops counting for the reviewer who approved it.
    await questionReviewerProgress({});
    const pipeline = mockAggregate.mock.calls[0][0] as Record<string, never>[];
    const group = pipeline.find((s) => "$group" in s) as unknown as {
      $group: Record<string, unknown>;
    };
    for (const key of ["approved", "approvedWithCondition", "rejected"]) {
      expect(JSON.stringify(group.$group[key])).not.toMatch(/status/);
    }
    expect(group.$group.approved).toEqual({
      $sum: { $cond: [{ $eq: ["$verdict", "APPROVE"] }, 1, 0] },
    });
    expect(group.$group.approvedWithCondition).toEqual({
      $sum: { $cond: [{ $eq: ["$verdict", "APPROVE_WITH_CONDITION"] }, 1, 0] },
    });
    expect(group.$group.rejected).toEqual({
      $sum: { $cond: [{ $eq: ["$verdict", "CHANGES_REQUESTED"] }, 1, 0] },
    });
  });

  test("only ever counts question rounds, and narrows to the class/subject asked for", async () => {
    await questionReviewerProgress({ classLevel: 5, subject: "english" });
    const pipeline = mockAggregate.mock.calls[0][0] as { $match?: unknown }[];
    const match = pipeline.find((s) => "$match" in s) as { $match: Record<string, unknown> };
    expect(match.$match).toEqual({ docType: "question", classLevel: 5, subject: "english" });
  });

  test("an unfiltered call does NOT pin classLevel or subject to a falsy value", async () => {
    // `classLevel: 0` and `subject: ""` would both be legal Mongo and would both match
    // nothing, turning "all classes" into an empty screen.
    await questionReviewerProgress({ classLevel: null, subject: null });
    const pipeline = mockAggregate.mock.calls[0][0] as { $match?: unknown }[];
    const match = pipeline.find((s) => "$match" in s) as { $match: Record<string, unknown> };
    expect(match.$match).toEqual({ docType: "question" });
  });

  test("the four sub-buckets always add back up to `assigned`", async () => {
    mockAggregate.mockResolvedValue([
      groupRow(KAYNAT, {
        assigned: 42,
        pending: 11,
        approved: 23,
        approvedWithCondition: 5,
        rejected: 2,
      }),
    ]);
    const [k] = await questionReviewerProgress({ classLevel: 5 });
    expect(k.decided).toBe(30);
    expect(k.cancelled).toBe(1); // 42 − 11 pending − 30 decided
    expect(k.pending + k.decided + k.cancelled).toBe(k.assigned);
  });

  test("a reviewer whose whole batch was published still shows every approval", async () => {
    // All 18 rounds superseded by publication: none is `submitted` any more, but the
    // verdicts are untouched, so nothing may drop out of the tally.
    mockAggregate.mockResolvedValue([
      groupRow(AFIZA, { assigned: 18, pending: 0, approved: 18 }),
    ]);
    const [a] = await questionReviewerProgress({});
    expect(a.approved).toBe(18);
    expect(a.decided).toBe(18);
    expect(a.cancelled).toBe(0);
  });

  test("never reports a negative cancelled count", async () => {
    // Defensive: re-assignment can in principle make the parts outrun the whole. A
    // negative badge on the Principal's screen is worse than a zero.
    mockAggregate.mockResolvedValue([groupRow(KAYNAT, { assigned: 2, pending: 1, approved: 5 })]);
    const [k] = await questionReviewerProgress({});
    expect(k.cancelled).toBe(0);
  });

  test("resolves reviewer names and puts whoever still owes work first", async () => {
    mockAggregate.mockResolvedValue([
      groupRow(AFIZA, { assigned: 18, approved: 18 }),
      groupRow(KAYNAT, { assigned: 42, pending: 11, approved: 31 }),
    ]);
    const rows = await questionReviewerProgress({});
    expect(rows.map((r) => r.reviewerName)).toEqual(["Kaynat", "Afiza"]);
    expect(rows[0].reviewerId).toBe(KAYNAT.toString());
  });

  test("skips the name lookup entirely when nobody has been assigned anything", async () => {
    expect(await questionReviewerProgress({ classLevel: 9 })).toEqual([]);
  });
});

describe("questionReviewerRounds — the drill-down", () => {
  test("APPROVE returns decided rounds whatever became of them afterwards", async () => {
    // No `status` key at all: this is the drill-down's half of the same guarantee the
    // rollup makes. Adding one here would empty the list as questions get published.
    await listQuestionReviewerRounds({ reviewerId: KAYNAT.toString(), bucket: "APPROVE" });
    const filter = mockFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter).toEqual({
      docType: "question",
      reviewerId: KAYNAT.toString(),
      verdict: "APPROVE",
    });
    expect(filter.status).toBeUndefined();
  });

  test("PENDING is the still-owed work", async () => {
    await listQuestionReviewerRounds({
      reviewerId: KAYNAT.toString(),
      bucket: "PENDING",
      classLevel: 5,
    });
    expect(mockFind.mock.calls[0][0]).toEqual({
      docType: "question",
      classLevel: 5,
      reviewerId: KAYNAT.toString(),
      status: "assigned",
    });
  });

  test("CANCELLED is closed-but-never-ruled, matched on a null verdict", async () => {
    // `verdict: null` matches an absent field as well as an explicit null, which is what
    // an assigned-then-superseded round actually looks like on disk.
    await listQuestionReviewerRounds({ reviewerId: KAYNAT.toString(), bucket: "CANCELLED" });
    expect(mockFind.mock.calls[0][0]).toEqual({
      docType: "question",
      reviewerId: KAYNAT.toString(),
      status: { $in: ["superseded", "cancelled"] },
      verdict: null,
    });
  });

  test("refuses an unknown bucket instead of quietly listing everything", async () => {
    await expect(
      listQuestionReviewerRounds({ reviewerId: KAYNAT.toString(), bucket: "APPROVED" }),
    ).rejects.toBeInstanceOf(ReviewError);
    expect(mockFind).not.toHaveBeenCalled();
  });

  test("is paginated by default — these rows carry payloadJson", async () => {
    await listQuestionReviewerRounds({ reviewerId: KAYNAT.toString(), bucket: "APPROVE" });
    expect(chain.limit).toHaveBeenCalledWith(REVIEWER_ROUNDS_PAGE);
    expect(chain.skip).toHaveBeenCalledWith(0);
  });

  test("caps the page and refuses a nonsensical one", async () => {
    await listQuestionReviewerRounds({
      reviewerId: KAYNAT.toString(),
      bucket: "APPROVE",
      limit: 100000,
    });
    expect(chain.limit).toHaveBeenCalledWith(200);

    jest.clearAllMocks();
    chain.sort.mockReturnValue(chain);
    chain.skip.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.lean.mockResolvedValue([]);
    await listQuestionReviewerRounds({
      reviewerId: KAYNAT.toString(),
      bucket: "APPROVE",
      limit: 0,
      offset: -5,
    });
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(chain.skip).toHaveBeenCalledWith(0);
  });

  test("sorts with a stable final key, so a bulk-assigned page cannot repeat a row", async () => {
    await listQuestionReviewerRounds({ reviewerId: KAYNAT.toString(), bucket: "PENDING" });
    expect(chain.sort).toHaveBeenCalledWith({ submittedAt: -1, assignedAt: -1, _id: 1 });
  });

  test("the count uses the SAME filter as the list it is the denominator for", async () => {
    const args = { reviewerId: KAYNAT.toString(), bucket: "APPROVE", classLevel: 5 };
    await listQuestionReviewerRounds(args);
    await countQuestionReviewerRounds(args);
    expect(mockCount.mock.calls[0][0]).toEqual(mockFind.mock.calls[0][0]);
  });

  test("the count refuses an unknown bucket too", async () => {
    await expect(
      countQuestionReviewerRounds({ reviewerId: KAYNAT.toString(), bucket: "nonsense" }),
    ).rejects.toBeInstanceOf(ReviewError);
    expect(mockCount).not.toHaveBeenCalled();
  });
});
