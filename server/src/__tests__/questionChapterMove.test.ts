/**
 * Moving whole chapters of question review from one reviewer to another (QR-15, D-#650).
 *
 * The two existing guards mean a chapter could not change hands at all: assign-by-chapter
 * SKIPS anything with an open round (D-#525) and the per-question path REFUSES one outright
 * (D-#569). Both are right — they stop a stray tap discarding work in progress. This is the
 * deliberate act they deliberately do not cover.
 *
 * What these tests pin is the line between "not started" and "work":
 *   • an UNTOUCHED round (`status: "assigned"`, no verdict) moves;
 *   • a round its reviewer already ruled on NEVER moves, whatever its chapter, and comes
 *     back counted as `skippedDecided` rather than silently left behind;
 *   • the move is scoped to the LOSING reviewer, so a chapter two people share does not
 *     empty out somebody who was not named.
 *
 * DB-free: every model is mocked, the same way questionAssignGuard.test.ts does it.
 */
import mongoose from "mongoose";

const mockRoundCount = jest.fn().mockResolvedValue(0);
const mockRoundUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });
const mockRoundFindOne = jest.fn();
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    countDocuments: (f: unknown) => mockRoundCount(f),
    updateMany: (f: unknown, u: unknown) => mockRoundUpdateMany(f, u),
    findOne: (f: unknown) => ({ select: () => ({ lean: async () => mockRoundFindOne(f) }) }),
    find: () => ({ lean: async () => [], select: () => ({ lean: async () => [] }) }),
    create: jest.fn(),
    aggregate: async () => [],
    collection: { name: "reviewassignments" },
  },
}));

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    findById: () => ({ lean: async () => null }),
    find: () => ({ lean: async () => [] }),
    collection: { name: "contentartifacts" },
  },
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => ({ select: () => ({ lean: async () => mockUserFind(f) }) }) },
}));

const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (r: unknown) => mockWriteAudit(r),
  writeAuditMany: jest.fn().mockResolvedValue(undefined),
}));

const mockEmit = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/notifications/services/emitters", () => ({
  emitQuestionReviewAssigned: (e: unknown) => mockEmit(e),
}));

import { moveQuestionReviewChapter } from "../modules/questions/services/QuestionReviewService";
import { ReviewError } from "../modules/content/services/ReviewService";

const FROM = new mongoose.Types.ObjectId().toString();
const TO = new mongoose.Types.ObjectId().toString();
const ACTOR = new mongoose.Types.ObjectId().toString();
const A_ROUND = new mongoose.Types.ObjectId();

const call = (over: Record<string, unknown> = {}) =>
  moveQuestionReviewChapter({
    subject: "BAN",
    classLevel: 5,
    chapters: [10, 11],
    fromReviewerId: FROM,
    toReviewerId: TO,
    actorId: ACTOR,
    actorRole: "PRINCIPAL",
    ...over,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFind.mockResolvedValue([
    { _id: new mongoose.Types.ObjectId(FROM), name: "Sajeda" },
    { _id: new mongoose.Types.ObjectId(TO), name: "Kaynat" },
  ]);
  mockRoundCount.mockResolvedValue(0);
  mockRoundUpdateMany.mockResolvedValue({ modifiedCount: 0 });
  mockRoundFindOne.mockResolvedValue({ _id: A_ROUND });
});

describe("an untouched chapter changes hands", () => {
  test("every round still owed moves to the new reviewer", async () => {
    mockRoundCount.mockResolvedValue(360);
    mockRoundUpdateMany.mockResolvedValue({ modifiedCount: 360 });

    const res = await call({ chapters: [10] });

    expect(res).toMatchObject({ moved: 360, skippedDecided: 0, held: 360, chapters: [10] });

    const [filter, update] = mockRoundUpdateMany.mock.calls[0];
    expect(update.$set.reviewerId.toString()).toBe(TO);
    // The clock restarts with the new reviewer — she is not shown a five-week-old due date.
    expect(update.$set.assignedBy.toString()).toBe(ACTOR);
    expect(update.$set.assignedAt).toBeInstanceOf(Date);
    // Scoped to the LOSING reviewer, so a chapter two people share does not empty out
    // somebody who was never named.
    expect(filter.reviewerId.toString()).toBe(FROM);
  });

  test("only UNTOUCHED rounds are updated — status assigned AND no verdict", async () => {
    mockRoundCount.mockResolvedValue(5);
    mockRoundUpdateMany.mockResolvedValue({ modifiedCount: 5 });

    await call();

    const [filter] = mockRoundUpdateMany.mock.calls[0];
    expect(filter.status).toBe("assigned");
    expect(filter.verdict).toBeNull();
  });

  test("a plan round is never in scope — docType is pinned to question", async () => {
    mockRoundCount.mockResolvedValue(1);
    mockRoundUpdateMany.mockResolvedValue({ modifiedCount: 1 });

    await call();

    expect(mockRoundCount.mock.calls[0][0].docType).toBe("question");
    expect(mockRoundUpdateMany.mock.calls[0][0].docType).toBe("question");
  });

  test("chapters match addressNumber as STRINGS, the form the round stores (QR-6/QR-13)", async () => {
    mockRoundCount.mockResolvedValue(1);
    mockRoundUpdateMany.mockResolvedValue({ modifiedCount: 1 });

    await call({ chapters: [13, 10, 10] });

    // De-duplicated and sorted, and every value a string — a numeric $in matches nothing.
    expect(mockRoundCount.mock.calls[0][0].addressNumber).toEqual({ $in: ["10", "13"] });
  });
});

describe("work already done is never taken away", () => {
  test("a decided round stays with the reviewer who decided it, and is reported", async () => {
    // She holds 534 rounds in the chapter; 280 carry a verdict, so 254 are still owed.
    mockRoundCount.mockResolvedValue(534);
    mockRoundUpdateMany.mockResolvedValue({ modifiedCount: 254 });

    const res = await call({ chapters: [15] });

    expect(res.moved).toBe(254);
    expect(res.skippedDecided).toBe(280);
    // `held` is the denominator: "254 moved" out of a chapter she was half-way through is
    // the correct answer, and alone it is indistinguishable from a bug.
    expect(res.held).toBe(534);
  });

  test("a fully decided chapter moves nothing and writes nothing", async () => {
    mockRoundCount.mockResolvedValue(711);
    mockRoundUpdateMany.mockResolvedValue({ modifiedCount: 0 });

    const res = await call({ chapters: [16] });

    expect(res).toMatchObject({ moved: 0, skippedDecided: 711, held: 711 });
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test("a chapter the reviewer does not hold is a no-op — no update, no audit, no push", async () => {
    mockRoundCount.mockResolvedValue(0);

    const res = await call({ chapters: [99] });

    expect(res).toMatchObject({ moved: 0, skippedDecided: 0, held: 0 });
    expect(mockRoundUpdateMany).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("the move is refused before it can do damage", () => {
  test("moving to the same reviewer", async () => {
    await expect(call({ toReviewerId: FROM })).rejects.toBeInstanceOf(ReviewError);
    await expect(call({ toReviewerId: FROM })).rejects.toThrow(/different reviewer/i);
    expect(mockRoundUpdateMany).not.toHaveBeenCalled();
  });

  test("no chapters picked", async () => {
    await expect(call({ chapters: [] })).rejects.toThrow(/at least one chapter/i);
    expect(mockRoundUpdateMany).not.toHaveBeenCalled();
  });

  test("an id that is not an id is a ReviewError, not a mongoose CastError", async () => {
    await expect(call({ fromReviewerId: "not-an-id" })).rejects.toBeInstanceOf(ReviewError);
    await expect(call({ toReviewerId: "not-an-id" })).rejects.toThrow(/valid to reviewer id/i);
  });

  test("a reviewer id that matches nobody — the chapter is not moved into a void", async () => {
    mockUserFind.mockResolvedValue([{ _id: new mongoose.Types.ObjectId(FROM), name: "Sajeda" }]);

    await expect(call()).rejects.toThrow(/unknown reviewer to move to/i);
    expect(mockRoundUpdateMany).not.toHaveBeenCalled();
  });

  test("nothing is counted or written before the guards have run", async () => {
    await expect(call({ chapters: [] })).rejects.toThrow();
    expect(mockRoundCount).not.toHaveBeenCalled();
  });
});

describe("the move leaves a trail", () => {
  test("one audit row naming BOTH reviewers, the chapters and what stayed behind", async () => {
    mockRoundCount.mockResolvedValue(100);
    mockRoundUpdateMany.mockResolvedValue({ modifiedCount: 90 });

    await call({ chapters: [10, 11] });

    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const row = mockWriteAudit.mock.calls[0][0];
    expect(row.eventKind).toBe("REVIEW_REASSIGNED");
    expect(row.actorId).toBe(ACTOR);
    expect(row.meta).toMatchObject({
      subject: "BAN",
      classLevel: 5,
      chapters: [10, 11],
      fromReviewerId: FROM,
      fromReviewerName: "Sajeda",
      toReviewerId: TO,
      toReviewerName: "Kaynat",
      moved: 90,
      skippedDecided: 10,
      held: 100,
    });
  });

  test("ONE notification, to the reviewer who GAINED the work, counting what she gained", async () => {
    mockRoundCount.mockResolvedValue(100);
    mockRoundUpdateMany.mockResolvedValue({ modifiedCount: 90 });

    await call();

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const ev = mockEmit.mock.calls[0][0];
    expect(ev.reviewerId).toBe(TO);
    expect(ev.count).toBe(90);
    expect(ev.sampleAssignmentId).toBe(A_ROUND.toString());
    // Distinct per move: the dedupe key is recipient + stamp, so a shared stamp would make
    // a second move to the same reviewer vanish silently.
    expect(ev.batchStamp).toMatch(/^move:10,11:\d+$/);
  });

  test("the losing reviewer is not notified — there is no kind for work taken back", async () => {
    mockRoundCount.mockResolvedValue(10);
    mockRoundUpdateMany.mockResolvedValue({ modifiedCount: 10 });

    await call();

    expect(mockEmit.mock.calls.every((c) => c[0].reviewerId !== FROM)).toBe(true);
  });
});
