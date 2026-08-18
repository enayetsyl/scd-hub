/**
 * QR-1 tests — the question review thread anchor (D-#508).
 *
 * The whole slice exists to stop ONE bug: a question's review thread must anchor on its
 * `qid`, not on its address. persistEnvelope supersedes questions on
 * `envelopeJson.payload.qid` precisely because a whole unit of questions SHARES one
 * address — so anchoring rounds on the address would put every question in the unit on a
 * single thread and let one supersede cancel dozens of unrelated rounds.
 *
 * Journeys: Q1.1 (independent threads for questions sharing an address), Q1.2 (supersede
 * by qid). Q1.3 (the import clamp) lives in questions.test.ts, where the persistEnvelope
 * harness already is.
 *
 * DB-free: mocked Mongoose models, mirroring review.test.ts.
 */
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Mocks (declared before importing the service under test)
// ---------------------------------------------------------------------------

const mockReviewFind = jest.fn();
const mockReviewUpdateOne = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: { findById: jest.fn() },
}));

jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    find: (f: unknown) => mockReviewFind(f),
    updateOne: (f: unknown, u: unknown) => mockReviewUpdateOne(f, u),
  },
}));

jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

jest.mock("../modules/notifications/services/emitters", () => ({
  emitReviewAssigned: jest.fn().mockResolvedValue(undefined),
}));

// Import AFTER mocks
import {
  qidOf,
  threadKeyOf,
  addressKeyOf,
  supersedeOpenRounds,
  supersedeOpenRoundsForQid,
  supersedeOpenRoundsForAddress,
  ReviewError,
} from "../modules/content/services/ReviewService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_ID = new mongoose.Types.ObjectId();

/** Two questions from ONE unit: same subject/class/address, different qid.
 *  This is the exact shape the address-keyed bug collapses. */
function questionArtifact(qid: string, over: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    docType: "question",
    subject: "ENG",
    classLevel: 5,
    address: { anchorWord: "Unit", number: 9, title: "Unit 9" },
    reviewStatus: "draft",
    envelopeJson: { payload: { qid } },
    ...over,
  };
}

function planArtifact(over: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    docType: "chapter_plan",
    subject: "BAN",
    classLevel: 3,
    address: { anchorWord: "পাঠ", number: 5, title: "Ch 5" },
    reviewStatus: "draft",
    ...over,
  };
}

/** A chainable query stub whose terminal .lean() resolves to `result`. */
function query(result: unknown) {
  const c: Record<string, unknown> = {};
  c.sort = () => c;
  c.limit = () => c;
  c.select = () => c;
  c.lean = () => Promise.resolve(result);
  return c;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockReviewUpdateOne.mockResolvedValue({ acknowledged: true });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("qidOf", () => {
  test("reads payload.qid", () => {
    expect(qidOf(questionArtifact("QP-ENG-C5-U09-Q01"))).toBe("QP-ENG-C5-U09-Q01");
  });

  test("trims surrounding whitespace", () => {
    expect(qidOf({ envelopeJson: { payload: { qid: "  QP-ENG-C5-U09-Q01  " } } })).toBe("QP-ENG-C5-U09-Q01");
  });

  test("null when absent, blank, or non-string", () => {
    expect(qidOf({ envelopeJson: { payload: {} } })).toBeNull();
    expect(qidOf({ envelopeJson: { payload: { qid: "   " } } })).toBeNull();
    expect(qidOf({ envelopeJson: { payload: { qid: 42 } } })).toBeNull();
    expect(qidOf({ envelopeJson: {} })).toBeNull();
    expect(qidOf({})).toBeNull();
    expect(qidOf({ envelopeJson: null })).toBeNull();
  });
});

describe("threadKeyOf", () => {
  test("Q1.1 — a question anchors on {docType, qid}, NEVER on the address", () => {
    const key = threadKeyOf(questionArtifact("QP-ENG-C5-U09-Q01"));
    expect(key).toEqual({ docType: "question", qid: "QP-ENG-C5-U09-Q01" });
    // The address fields must not leak into the key — that is the collapse bug.
    expect(key).not.toHaveProperty("anchorWord");
    expect(key).not.toHaveProperty("addressNumber");
    expect(key).not.toHaveProperty("subject");
    expect(key).not.toHaveProperty("classLevel");
  });

  test("Q1.1 — two questions sharing ONE address produce DIFFERENT keys", () => {
    const a = questionArtifact("QP-ENG-C5-U09-Q01");
    const b = questionArtifact("QP-ENG-C5-U09-Q02");
    // Same unit address, deliberately.
    expect(a.address).toEqual(b.address);
    expect(a.subject).toBe(b.subject);
    expect(a.classLevel).toBe(b.classLevel);
    // ...but independent threads.
    expect(threadKeyOf(a)).not.toEqual(threadKeyOf(b));
  });

  test("a plan still anchors on the 5-field address key (D-#38 unchanged)", () => {
    const plan = planArtifact();
    expect(threadKeyOf(plan)).toEqual(addressKeyOf(plan));
    expect(threadKeyOf(plan)).toEqual({
      docType: "chapter_plan",
      subject: "BAN",
      classLevel: 3,
      anchorWord: "পাঠ",
      addressNumber: "5",
    });
  });

  test("a question with no qid is REFUSED, not silently address-keyed", () => {
    expect(() => threadKeyOf(questionArtifact("") as never)).toThrow(ReviewError);
    expect(() => threadKeyOf({ ...questionArtifact("x"), envelopeJson: { payload: {} } })).toThrow(
      /no payload\.qid/,
    );
  });

  test("stimulus/question_set fall back to the address key (not question-anchored)", () => {
    const stim = { ...questionArtifact("ignored"), docType: "stimulus" };
    expect(threadKeyOf(stim)).toEqual(addressKeyOf(stim));
  });
});

// ---------------------------------------------------------------------------
// Supersession
// ---------------------------------------------------------------------------

describe("supersedeOpenRoundsForQid (Q1.2)", () => {
  test("queries by qid + open statuses only", async () => {
    mockReviewFind.mockReturnValue(query([]));
    const n = await supersedeOpenRoundsForQid("QP-ENG-C5-U09-Q01", "superseded_by_reimport", ADMIN_ID.toString());

    expect(n).toBe(0);
    expect(mockReviewFind).toHaveBeenCalledWith({
      docType: "question",
      qid: "QP-ENG-C5-U09-Q01",
      status: { $in: ["assigned", "submitted"] },
    });
    expect(mockReviewUpdateOne).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("supersedes each open round and audits it", async () => {
    const r1 = new mongoose.Types.ObjectId();
    const r2 = new mongoose.Types.ObjectId();
    mockReviewFind.mockReturnValue(query([{ _id: r1 }, { _id: r2 }]));

    const n = await supersedeOpenRoundsForQid("QP-ENG-C5-U09-Q01", "superseded_by_reimport", ADMIN_ID.toString(), "PRINCIPAL");

    expect(n).toBe(2);
    expect(mockReviewUpdateOne).toHaveBeenCalledTimes(2);
    expect(mockReviewUpdateOne).toHaveBeenCalledWith({ _id: r1 }, { $set: { status: "superseded" } });
    expect(mockWriteAudit).toHaveBeenCalledTimes(2);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "REVIEW_CANCELLED",
        targetKind: "ReviewAssignment",
        meta: { reason: "superseded_by_reimport" },
      }),
    );
  });

  test("Q1.1 — superseding one question's rounds cannot touch its unit-mate", async () => {
    // The DB is asked ONLY about Q01. Whatever rounds exist for Q02 are unreachable by
    // this filter — which is the whole point of the qid anchor.
    mockReviewFind.mockReturnValue(query([]));
    await supersedeOpenRoundsForQid("QP-ENG-C5-U09-Q01", "superseded_by_reimport");

    const filter = mockReviewFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.qid).toBe("QP-ENG-C5-U09-Q01");
    expect(filter.qid).not.toBe("QP-ENG-C5-U09-Q02");
    // No address field is consulted, so no unit-wide sweep is possible.
    expect(filter).not.toHaveProperty("anchorWord");
    expect(filter).not.toHaveProperty("addressNumber");
  });
});

describe("supersedeOpenRoundsForAddress (plans — behaviour unchanged)", () => {
  test("still queries the 5-field address key", async () => {
    mockReviewFind.mockReturnValue(query([]));
    const key = {
      docType: "chapter_plan",
      subject: "BAN",
      classLevel: 3,
      anchorWord: "পাঠ",
      addressNumber: "5",
    };
    await supersedeOpenRoundsForAddress(key, "superseded_by_new_round", ADMIN_ID.toString());

    expect(mockReviewFind).toHaveBeenCalledWith({ ...key, status: { $in: ["assigned", "submitted"] } });
  });
});

describe("supersedeOpenRounds (shared implementation)", () => {
  test("accepts either thread key shape", async () => {
    mockReviewFind.mockReturnValue(query([]));
    await supersedeOpenRounds({ docType: "question", qid: "Q1" }, "r");
    await supersedeOpenRounds(
      { docType: "session_plan", subject: "ENG", classLevel: 5, anchorWord: "Unit", addressNumber: "9" },
      "r",
    );
    expect(mockReviewFind).toHaveBeenCalledTimes(2);
    expect(mockReviewFind.mock.calls[0][0]).toHaveProperty("qid", "Q1");
    expect(mockReviewFind.mock.calls[1][0]).toHaveProperty("anchorWord", "Unit");
  });
});
