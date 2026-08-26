/**
 * The IMPORTANT mark (QR-9, D-#550).
 *
 * Normal is the usual state and `null` is how it is stored, so "important" is always a
 * positive claim somebody made. What these pin:
 *
 *   • the mark and its removal are both audited, with `viaReviewQueue` separating a
 *     reviewer working her own queue from a desk mark — the two arrive by different gates;
 *   • setting the state it already holds writes NOTHING, so a double-tap cannot produce a
 *     second audit row claiming a change that never happened;
 *   • a REVIEWER is confined to questions she currently holds an open round for. She is a
 *     TEACHER holding `content:review`, a base permission, so without this check every
 *     teacher would get a write on all 6,900 bank documents.
 *
 * The reviewer scope is asserted against the real `ReviewAssignment.countDocuments` filter
 * the service builds, not a copy of it, and the refusal is checked to happen BEFORE any
 * save so a rejected call leaves nothing half-done.
 */
import mongoose from "mongoose";

const mockFindById = jest.fn();
jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: { findById: (id: unknown) => mockFindById(id) },
}));

const mockRoundFind = jest.fn().mockReturnValue({ lean: async () => [] });
const mockRoundUpdateOne = jest.fn().mockResolvedValue({});
const mockRoundCount = jest.fn().mockResolvedValue(0);
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    find: (f: unknown) => mockRoundFind(f),
    updateOne: (f: unknown, u: unknown) => mockRoundUpdateOne(f, u),
    countDocuments: (f: unknown) => mockRoundCount(f),
  },
}));

const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
  writeAuditMany: jest.fn().mockResolvedValue(undefined),
}));

import { setQuestionImportant } from "../modules/questions/services/QuestionEditService";
import { ReviewError } from "../modules/content/services/ReviewService";

const ARTIFACT_ID = new mongoose.Types.ObjectId();
const DESK = new mongoose.Types.ObjectId().toString();
const REVIEWER = new mongoose.Types.ObjectId().toString();

const QID = "QP-BAN-C5-U23-Q05075";

function questionDoc(over: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    _id: ARTIFACT_ID,
    docType: "question",
    subject: "BAN",
    classLevel: 5,
    reviewStatus: "gold",
    retiredAt: null,
    importantAt: null,
    envelopeJson: { payload: { qid: QID, question_text: "'ছানা' শব্দের অর্থ কোনটি?" } },
    ...over,
  };
  const doc = {
    ...state,
    set: (k: string, v: unknown) => {
      state[k] = v;
    },
    markModified: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    toObject: () => ({ ...state }),
    _state: state,
  };
  return doc;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRoundCount.mockResolvedValue(0);
});

describe("the desk mark (question:manage)", () => {
  test("marking stamps importantAt + importantBy and logs it", async () => {
    const doc = questionDoc();
    mockFindById.mockResolvedValue(doc);

    const res = await setQuestionImportant({
      artifactId: ARTIFACT_ID.toString(),
      important: true,
      actorId: DESK,
      actorRole: "PRINCIPAL",
      mayManage: true,
    });

    expect(res.important).toBe(true);
    expect(res.changedFields).toEqual(["importantAt"]);
    expect(doc._state.importantAt).toBeInstanceOf(Date);
    expect(String(doc._state.importantBy)).toBe(DESK);
    expect(doc.save).toHaveBeenCalledTimes(1);

    const audit = mockWriteAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(audit.eventKind).toBe("QUESTION_MARKED_IMPORTANT");
    const meta = audit.meta as Record<string, unknown>;
    expect(meta.qid).toBe(QID);
    // A desk mark, not one raised from a review queue.
    expect(meta.viaReviewQueue).toBe(false);
  });

  test("un-marking clears BOTH fields, so no stale author is left behind", async () => {
    const doc = questionDoc({ importantAt: new Date(), importantBy: new mongoose.Types.ObjectId() });
    mockFindById.mockResolvedValue(doc);

    const res = await setQuestionImportant({
      artifactId: ARTIFACT_ID.toString(),
      important: false,
      actorId: DESK,
      actorRole: "OFFICE",
      mayManage: true,
    });

    expect(res.important).toBe(false);
    expect(doc._state.importantAt).toBeNull();
    expect(doc._state.importantBy).toBeUndefined();
    expect((mockWriteAudit.mock.calls[0][0] as Record<string, unknown>).eventKind).toBe(
      "QUESTION_UNMARKED_IMPORTANT",
    );
  });

  test("the desk is never asked for a review round — it does not need one", async () => {
    mockFindById.mockResolvedValue(questionDoc());
    await setQuestionImportant({
      artifactId: ARTIFACT_ID.toString(),
      important: true,
      actorId: DESK,
      mayManage: true,
    });
    expect(mockRoundCount).not.toHaveBeenCalled();
  });
});

describe("a no-op writes nothing", () => {
  test("marking an already-important question saves nothing and logs nothing", async () => {
    const doc = questionDoc({ importantAt: new Date() });
    mockFindById.mockResolvedValue(doc);

    const res = await setQuestionImportant({
      artifactId: ARTIFACT_ID.toString(),
      important: true,
      actorId: DESK,
      mayManage: true,
    });

    expect(res.changedFields).toEqual([]);
    expect(res.important).toBe(true);
    expect(doc.save).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("un-marking an already-normal question is equally silent", async () => {
    const doc = questionDoc();
    mockFindById.mockResolvedValue(doc);

    const res = await setQuestionImportant({
      artifactId: ARTIFACT_ID.toString(),
      important: false,
      actorId: DESK,
      mayManage: true,
    });

    expect(res.changedFields).toEqual([]);
    expect(res.important).toBe(false);
    expect(doc.save).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});

describe("a reviewer is confined to her own queue", () => {
  test("she may mark a question she holds an open round for", async () => {
    const doc = questionDoc();
    mockFindById.mockResolvedValue(doc);
    mockRoundCount.mockResolvedValue(1);

    const res = await setQuestionImportant({
      artifactId: ARTIFACT_ID.toString(),
      important: true,
      actorId: REVIEWER,
      actorRole: "TEACHER",
      mayManage: false,
    });

    expect(res.important).toBe(true);
    // The mark is stamped as coming from the review queue, which is how the audit log can
    // later tell a reviewer's flag from the desk's.
    const meta = (mockWriteAudit.mock.calls[0][0] as Record<string, unknown>).meta as Record<
      string,
      unknown
    >;
    expect(meta.viaReviewQueue).toBe(true);
  });

  test("the round is looked up by HER id and the question's qid, open rounds only", async () => {
    mockFindById.mockResolvedValue(questionDoc());
    mockRoundCount.mockResolvedValue(1);

    await setQuestionImportant({
      artifactId: ARTIFACT_ID.toString(),
      important: true,
      actorId: REVIEWER,
      mayManage: false,
    });

    const filter = mockRoundCount.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.qid).toBe(QID);
    expect(String(filter.reviewerId)).toBe(REVIEWER);
    // A closed or superseded round must not keep granting the write.
    expect(filter.status).toEqual({ $in: ["assigned", "submitted"] });
  });

  test("a question NOT in her queue is refused, and nothing is written", async () => {
    const doc = questionDoc();
    mockFindById.mockResolvedValue(doc);
    mockRoundCount.mockResolvedValue(0);

    await expect(
      setQuestionImportant({
        artifactId: ARTIFACT_ID.toString(),
        important: true,
        actorId: REVIEWER,
        mayManage: false,
      }),
    ).rejects.toBeInstanceOf(ReviewError);

    // Refused BEFORE the save — a rejected call leaves the document exactly as it was.
    expect(doc.save).not.toHaveBeenCalled();
    expect(doc._state.importantAt).toBeNull();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("she cannot un-mark a question outside her queue either", async () => {
    const doc = questionDoc({ importantAt: new Date() });
    mockFindById.mockResolvedValue(doc);
    mockRoundCount.mockResolvedValue(0);

    await expect(
      setQuestionImportant({
        artifactId: ARTIFACT_ID.toString(),
        important: false,
        actorId: REVIEWER,
        mayManage: false,
      }),
    ).rejects.toThrow(/not in your review queue/i);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("a question with no qid cannot be marked by a reviewer — there is no round to check", async () => {
    const doc = questionDoc({ envelopeJson: { payload: { question_text: "x" } } });
    mockFindById.mockResolvedValue(doc);

    await expect(
      setQuestionImportant({
        artifactId: ARTIFACT_ID.toString(),
        important: true,
        actorId: REVIEWER,
        mayManage: false,
      }),
    ).rejects.toBeInstanceOf(ReviewError);
    expect(mockRoundCount).not.toHaveBeenCalled();
    expect(doc.save).not.toHaveBeenCalled();
  });
});

describe("the mark is independent of every other state", () => {
  test("a PUBLISHED question can be marked — that is the common case", async () => {
    const doc = questionDoc({ reviewStatus: "gold" });
    mockFindById.mockResolvedValue(doc);

    const res = await setQuestionImportant({
      artifactId: ARTIFACT_ID.toString(),
      important: true,
      actorId: DESK,
      mayManage: true,
    });

    expect(res.important).toBe(true);
    expect(res.wasPublished).toBe(true);
  });

  test("marking does not touch reviewStatus or retiredAt", async () => {
    const doc = questionDoc({ reviewStatus: "draft" });
    mockFindById.mockResolvedValue(doc);

    await setQuestionImportant({
      artifactId: ARTIFACT_ID.toString(),
      important: true,
      actorId: DESK,
      mayManage: true,
    });

    // The mark says "look at this". It is not a verdict and not a delete, so it must not
    // move the status the review loop runs on.
    expect(doc._state.reviewStatus).toBe("draft");
    expect(doc._state.retiredAt).toBeNull();
  });
});
