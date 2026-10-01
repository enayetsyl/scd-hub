/**
 * Plan-review board (D-#704) — DB-free.
 *
 *   1. Session threads — every session of a chapter shares the chapter's address, so the
 *      thread key carries `sessionIndex`: assigning, signing off or reading one session must
 *      never touch a sibling session's rounds.
 *   2. movePlanReviews — untouched rounds change hands in place (round number kept, audited,
 *      the new reviewer told under a key of their own); a reviewed round is skipped.
 *   3. cancelPlanReviews — bulk unassign, plan rounds only.
 *   4. listAssignablePlans — each session shows its own reviewer; chapters sort numerically.
 */
import mongoose from "mongoose";

const mockArtifactFindById = jest.fn();
const mockArtifactFind = jest.fn();
const mockReviewCreate = jest.fn();
const mockReviewFind = jest.fn();
const mockReviewFindById = jest.fn();
const mockReviewUpdateOne = jest.fn();
const mockUserFindById = jest.fn();
const mockUserFind = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
const mockEmitReviewAssigned = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    findById: (id: unknown) => mockArtifactFindById(id),
    find: (f: unknown) => mockArtifactFind(f),
  },
}));
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    create: (a: unknown) => mockReviewCreate(a),
    find: (f: unknown) => mockReviewFind(f),
    findById: (id: unknown) => mockReviewFindById(id),
    updateOne: (f: unknown, u: unknown) => mockReviewUpdateOne(f, u),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findById: (id: unknown) => mockUserFindById(id),
    find: (f: unknown) => mockUserFind(f),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitReviewAssigned: (...args: unknown[]) => mockEmitReviewAssigned(...args),
}));

import {
  planThreadKeyOf,
  assignPlanReview,
  approvePlan,
  planReviewThread,
  movePlanReviews,
  cancelPlanReviews,
  listAssignablePlans,
} from "../modules/content/services/ReviewService";

const oid = () => new mongoose.Types.ObjectId();
const ADMIN = oid().toString();
const ALICE = oid();
const BOB = oid();

/** A chainable query stub whose terminal .lean() resolves to `result`; also awaitable. */
function query(result: unknown) {
  const c: Record<string, unknown> = {};
  c.sort = () => c;
  c.limit = () => c;
  c.select = () => c;
  c.lean = () => Promise.resolve(result);
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return c;
}

function sessionArtifact(periodIndex: number | null, over: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    docType: "session_plan",
    subject: "MATH",
    classLevel: 5,
    address: { anchorWord: "অধ্যায়", number: 3, title: "ভগ্নাংশ" },
    reviewStatus: "draft",
    envelopeJson: { payload: periodIndex == null ? {} : { session_plan: { period_index: periodIndex } } },
    ...over,
  };
}

/** A mongoose-document-like round: awaitable from findById, with save(). */
function roundDoc(over: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    _id: oid(),
    docType: "session_plan",
    subject: "MATH",
    classLevel: 5,
    anchorWord: "অধ্যায়",
    addressNumber: "3",
    sessionIndex: 2,
    artifactId: oid(),
    reviewerId: ALICE,
    assignedBy: oid(),
    assignedAt: new Date("2026-09-20T04:00:00Z"),
    roundNumber: 1,
    status: "assigned",
    ...over,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  return doc;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockEmitReviewAssigned.mockResolvedValue(undefined);
});

describe("session thread key (D-#704)", () => {
  test("a session plan's key carries its session; a chapter plan's does not", () => {
    expect(planThreadKeyOf(sessionArtifact(2))).toEqual({
      docType: "session_plan",
      subject: "MATH",
      classLevel: 5,
      anchorWord: "অধ্যায়",
      addressNumber: "3",
      sessionIndex: 2,
    });
    const chapter = { ...sessionArtifact(null), docType: "chapter_plan" };
    expect(planThreadKeyOf(chapter)).not.toHaveProperty("sessionIndex");
  });

  test("a session plan with no period index keys on null (the old address-wide behaviour)", () => {
    expect(planThreadKeyOf(sessionArtifact(null)).sessionIndex).toBeNull();
  });

  test("assigning session 2 supersedes and numbers within session 2 only, and stores the session", async () => {
    const art = sessionArtifact(2);
    mockArtifactFindById.mockReturnValue(query(art));
    mockReviewFind.mockReturnValueOnce(query([])).mockReturnValueOnce(query([]));
    mockReviewCreate.mockImplementation((d: Record<string, unknown>) =>
      Promise.resolve({ _id: oid(), assignedAt: new Date(), ...d }),
    );

    const dto = await assignPlanReview({ artifactId: art._id.toString(), reviewerId: BOB.toString(), assignedBy: ADMIN });

    // Both the open-round lookup (supersede) and the round-number lookup are session-scoped.
    expect(mockReviewFind).toHaveBeenNthCalledWith(1, expect.objectContaining({ sessionIndex: 2, status: { $in: ["assigned", "submitted"] } }));
    expect(mockReviewFind).toHaveBeenNthCalledWith(2, expect.objectContaining({ sessionIndex: 2 }));
    expect(mockReviewCreate).toHaveBeenCalledWith(expect.objectContaining({ sessionIndex: 2, roundNumber: 1 }));
    expect(dto.sessionIndex).toBe(2);
  });

  test("signing off one session closes only that session's open round", async () => {
    const art = sessionArtifact(4, { reviewStatus: "reviewed", save: jest.fn().mockResolvedValue(undefined) });
    mockArtifactFindById.mockReturnValue(art);
    mockReviewFind.mockReturnValueOnce(query([]));

    await approvePlan({ artifactId: art._id.toString(), actorId: ADMIN });

    expect(mockReviewFind).toHaveBeenCalledWith(expect.objectContaining({ sessionIndex: 4 }));
  });

  test("a session's thread lists that session's rounds only", async () => {
    const art = sessionArtifact(3);
    mockArtifactFindById.mockReturnValue(query(art));
    mockReviewFind.mockReturnValueOnce(query([]));

    await planReviewThread(art._id.toString());

    expect(mockReviewFind).toHaveBeenCalledWith(expect.objectContaining({ sessionIndex: 3 }));
  });
});

describe("movePlanReviews", () => {
  beforeEach(() => {
    mockUserFindById.mockReturnValue(query({ _id: BOB, active: true, role: "TEACHER" }));
  });

  test("an untouched round changes hands in place: same round number, audited, the new reviewer told", async () => {
    const round = roundDoc();
    mockReviewFindById.mockReturnValue(query(round));

    const res = await movePlanReviews({ assignmentIds: [String(round._id)], toReviewerId: BOB.toString(), actorId: ADMIN });

    expect(res).toEqual({ moved: 1, skipped: [] });
    expect(round.save).toHaveBeenCalledTimes(1);
    expect(String(round.reviewerId)).toBe(BOB.toString());
    expect(round.roundNumber).toBe(1);
    expect(mockReviewCreate).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "REVIEW_REASSIGNED",
        meta: expect.objectContaining({ fromReviewerId: ALICE.toString(), toReviewerId: BOB.toString() }),
      }),
    );
    // Told under a MOVE stamp — the round's own REV:<id> row already exists.
    expect(mockEmitReviewAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ reviewerId: round.reviewerId }),
      expect.objectContaining({ moveStamp: expect.any(String) }),
    );
  });

  test("a reviewed round, a round already theirs and a question round are skipped, each with a reason", async () => {
    const reviewed = roundDoc({ status: "submitted", verdict: "APPROVE" });
    const theirs = roundDoc({ reviewerId: BOB });
    const question = roundDoc({ docType: "question" });
    const byId = new Map([reviewed, theirs, question].map((r) => [String(r._id), r]));
    mockReviewFindById.mockImplementation((id: unknown) => query(byId.get(String(id)) ?? null));

    const res = await movePlanReviews({
      assignmentIds: [String(reviewed._id), String(theirs._id), String(question._id)],
      toReviewerId: BOB.toString(),
      actorId: ADMIN,
    });

    expect(res.moved).toBe(0);
    expect(res.skipped.map((s) => s.reason)).toEqual(["already reviewed", "already theirs", "not found"]);
    expect(mockWriteAudit).not.toHaveBeenCalled();
    expect(mockEmitReviewAssigned).not.toHaveBeenCalled();
  });

  test("refuses a reviewer who is inactive or a guardian", async () => {
    mockUserFindById.mockReturnValue(query({ _id: BOB, active: false, role: "TEACHER" }));
    await expect(movePlanReviews({ assignmentIds: [], toReviewerId: BOB.toString(), actorId: ADMIN })).rejects.toThrow(/cannot review/);
    mockUserFindById.mockReturnValue(query({ _id: BOB, active: true, role: "GUARDIAN" }));
    await expect(movePlanReviews({ assignmentIds: [], toReviewerId: BOB.toString(), actorId: ADMIN })).rejects.toThrow(/cannot review/);
  });
});

describe("cancelPlanReviews", () => {
  test("cancels open plan rounds and reports a question round as a failure", async () => {
    const a = roundDoc();
    const b = roundDoc({ status: "submitted", verdict: "CHANGES_REQUESTED" });
    const q = roundDoc({ docType: "question" });
    const byId = new Map([a, b, q].map((r) => [String(r._id), r]));
    mockReviewFindById.mockImplementation((id: unknown) => query(byId.get(String(id)) ?? null));

    const res = await cancelPlanReviews({ assignmentIds: [String(a._id), String(b._id), String(q._id)], actorId: ADMIN });

    expect(res.cancelled).toBe(2);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0].assignmentId).toBe(String(q._id));
    expect(a.status).toBe("cancelled");
    expect(b.status).toBe("cancelled");
    expect(q.status).toBe("assigned");
  });
});

describe("listAssignablePlans", () => {
  test("each session shows its own open round; chapters sort numerically (2 before 10)", async () => {
    const s1 = sessionArtifact(1);
    const s2 = sessionArtifact(2);
    const ch10 = { ...sessionArtifact(null), docType: "chapter_plan", address: { anchorWord: "অধ্যায়", number: 10 } };
    const ch2 = { ...sessionArtifact(null), docType: "chapter_plan", address: { anchorWord: "অধ্যায়", number: 2 } };
    mockArtifactFind.mockReturnValue(query([ch10, s2, ch2, s1]));
    mockReviewFind.mockReturnValue(
      query([
        roundDoc({ sessionIndex: 1, reviewerId: ALICE, roundNumber: 1 }),
        roundDoc({ sessionIndex: 2, reviewerId: BOB, roundNumber: 3, status: "submitted", verdict: "APPROVE", submittedAt: new Date() }),
      ]),
    );
    mockUserFind.mockReturnValue(query([{ _id: ALICE, name: "Alice" }, { _id: BOB, name: "Bob" }]));

    const rows = await listAssignablePlans();

    expect(rows.map((r) => `${r.docType}:${r.addressNumber}:${r.sessionIndex ?? "-"}`)).toEqual([
      "chapter_plan:2:-",
      "session_plan:3:1",
      "session_plan:3:2",
      "chapter_plan:10:-",
    ]);
    const bySession = new Map(rows.filter((r) => r.docType === "session_plan").map((r) => [r.sessionIndex, r]));
    expect(bySession.get(1)).toMatchObject({ currentReviewerName: "Alice", roundNumber: 1, roundStatus: "assigned", verdict: null });
    expect(bySession.get(2)).toMatchObject({ currentReviewerName: "Bob", roundNumber: 3, roundStatus: "submitted", verdict: "APPROVE" });
    // The chapter plans at the same address are NOT picked up by the session rounds.
    expect(rows.find((r) => r.docType === "chapter_plan")?.currentReviewerId).toBeNull();
  });
});
