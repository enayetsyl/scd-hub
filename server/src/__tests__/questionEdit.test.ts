/**
 * Question corrections (QR-8, D-#548) — edit in place, retire softly, log who did what.
 *
 * The bank had no write path at all, so a reviewer's condition ("the answer should be
 * বের হওয়া") had nobody who could act on it. These pin the three things that make the new
 * write path safe: the payload stays VALID, a retire is SOFT, and every real change is
 * logged with its before and after.
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

import {
  updateQuestionContent,
  retireQuestion,
  restoreQuestion,
} from "../modules/questions/services/QuestionEditService";
import { ReviewError } from "../modules/content/services/ReviewService";

const ARTIFACT_ID = new mongoose.Types.ObjectId();
const ACTOR = new mongoose.Types.ObjectId().toString();

/** A mongoose-ish document: `.set()` mutates, `.toObject()` reads back, `.save()` records. */
function questionDoc(payload: Record<string, unknown>, over: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    _id: ARTIFACT_ID,
    docType: "question",
    subject: "BAN",
    classLevel: 5,
    reviewStatus: "gold",
    retiredAt: null,
    envelopeJson: { payload },
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

const MCQ = {
  qid: "QP-BAN-C5-U23-Q05075",
  question_text: "'ছানা' শব্দের অর্থ কোনটি?",
  question_type: "mcq",
  marks: 1,
  options: [
    { option_id: "ক", text: "পাখির ডিম", is_correct: false },
    { option_id: "খ", text: "পাখির বাসা", is_correct: false },
    { option_id: "গ", text: "পাখির বাচ্চা", is_correct: true },
  ],
};

const SHORT = {
  qid: "QP-BAN-C5-U23-Q61015",
  question_text: "'ঢোকা' শব্দের বিপরীত শব্দ লেখো।",
  question_type: "short_answer",
  marks: 1,
  answer_key: { accepted: ["বেরোনো"] },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRoundFind.mockReturnValue({ lean: async () => [] });
});

describe("updateQuestionContent", () => {
  test("acts on the reviewer's condition: the accepted answer is corrected and logged", async () => {
    // The live case. Tasmiah approved with the condition "বের হওয়া বা বাহির হওয়া" against a
    // key that said only "বেরোনো"; until now nobody could change it.
    const doc = questionDoc({ ...SHORT });
    mockFindById.mockResolvedValue(doc);

    const res = await updateQuestionContent({
      artifactId: ARTIFACT_ID.toString(),
      patch: { answerAccepted: ["বের হওয়া", "বাহির হওয়া"] },
      actorId: ACTOR,
      actorRole: "PRINCIPAL",
    });

    expect(res.changedFields).toEqual(["answer_key"]);
    const saved = (doc._state.envelopeJson as { payload: Record<string, unknown> }).payload;
    expect(saved.answer_key).toEqual({ accepted: ["বের হওয়া", "বাহির হওয়া"] });
    // Untouched fields survive the round trip — a patch is not a replace.
    expect(saved.question_text).toBe(SHORT.question_text);
    expect(saved.qid).toBe(SHORT.qid);

    const audit = mockWriteAudit.mock.calls[0][0];
    expect(audit.eventKind).toBe("QUESTION_EDITED");
    expect(audit.actorId).toBe(ACTOR);
    expect(audit.meta.changed).toEqual(["answer_key"]);
    expect(audit.meta.before.answer_key).toEqual({ accepted: ["বেরোনো"] });
    expect(audit.meta.after.answer_key).toEqual({ accepted: ["বের হওয়া", "বাহির হওয়া"] });
    // The question was already on the shelf, so this edit may have changed a printed paper.
    expect(audit.meta.wasPublished).toBe(true);
  });

  test("a no-op save writes NOTHING — no document, no audit row", async () => {
    // A log that fires on a save that changed nothing teaches people to stop reading it.
    const doc = questionDoc({ ...SHORT });
    mockFindById.mockResolvedValue(doc);

    const res = await updateQuestionContent({
      artifactId: ARTIFACT_ID.toString(),
      patch: { questionText: SHORT.question_text, marks: 1 },
      actorId: ACTOR,
    });

    expect(res.changedFields).toEqual([]);
    expect(doc.save).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("an MCQ must end with exactly one correct option", async () => {
    const doc = questionDoc({ ...MCQ });
    mockFindById.mockResolvedValue(doc);
    const opts = (correct: boolean[]) =>
      correct.map((c, i) => ({ text: `option ${i}`, isCorrect: c }));

    await expect(
      updateQuestionContent({
        artifactId: ARTIFACT_ID.toString(),
        patch: { options: opts([false, false, false]) },
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/exactly one option correct/i);

    await expect(
      updateQuestionContent({
        artifactId: ARTIFACT_ID.toString(),
        patch: { options: opts([true, true, false]) },
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/exactly one option correct/i);

    expect(doc.save).not.toHaveBeenCalled();
  });

  test("options are refused on a question that has none", async () => {
    // The payload is a LOCKED closed schema — a correction must leave it valid, not just
    // different, so an mcq-shaped edit cannot be applied to a short answer.
    mockFindById.mockResolvedValue(questionDoc({ ...SHORT }));
    await expect(
      updateQuestionContent({
        artifactId: ARTIFACT_ID.toString(),
        patch: { options: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: false }] },
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/belong to an mcq/i);
  });

  test("empty text, empty options and non-positive marks are all refused", async () => {
    mockFindById.mockResolvedValue(questionDoc({ ...MCQ }));
    for (const patch of [
      { questionText: "   " },
      { marks: 0 },
      { marks: -2 },
      { options: [{ text: "only one", isCorrect: true }] },
      { options: [{ text: " ", isCorrect: true }, { text: "b", isCorrect: false }] },
    ]) {
      await expect(
        updateQuestionContent({ artifactId: ARTIFACT_ID.toString(), patch, actorId: ACTOR }),
      ).rejects.toBeInstanceOf(ReviewError);
    }
  });

  test("editing an MCQ keeps each option's existing letter", async () => {
    const doc = questionDoc({ ...MCQ });
    mockFindById.mockResolvedValue(doc);
    await updateQuestionContent({
      artifactId: ARTIFACT_ID.toString(),
      patch: {
        options: [
          { optionId: "ক", text: "পাখির ডিম", isCorrect: false },
          { optionId: "খ", text: "পাখির বাসা", isCorrect: true },
          { optionId: "গ", text: "পাখির বাচ্চা", isCorrect: false },
        ],
      },
      actorId: ACTOR,
    });
    const saved = (doc._state.envelopeJson as { payload: { options: { option_id: string }[] } })
      .payload.options;
    expect(saved.map((o) => o.option_id)).toEqual(["ক", "খ", "গ"]);
  });

  test("a non-question artifact is refused", async () => {
    mockFindById.mockResolvedValue(questionDoc({ ...SHORT }, { docType: "session_plan" }));
    await expect(
      updateQuestionContent({
        artifactId: ARTIFACT_ID.toString(),
        patch: { questionText: "x" },
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/Only questions can be edited/i);
  });
});

describe("retireQuestion", () => {
  test("is SOFT — the document survives so assembled sets keep resolving", async () => {
    const doc = questionDoc({ ...MCQ });
    mockFindById.mockResolvedValue(doc);

    const res = await retireQuestion({
      artifactId: ARTIFACT_ID.toString(),
      reason: "duplicate of Q05074",
      actorId: ACTOR,
      actorRole: "OFFICE",
    });

    expect(res.retiredAt).not.toBeNull();
    expect(doc._state.retiredAt).toBeInstanceOf(Date);
    expect(doc._state.retireReason).toBe("duplicate of Q05074");
    // NOT the version flag — `current` means "a newer version superseded me" and the two
    // must not be confused, or a retired question looks like an old version.
    expect(doc._state.current).toBeUndefined();

    const audit = mockWriteAudit.mock.calls.find(
      (c) => c[0].eventKind === "QUESTION_RETIRED",
    )?.[0];
    expect(audit.meta.qid).toBe(MCQ.qid);
    expect(audit.meta.reason).toBe("duplicate of Q05074");
    expect(audit.meta.wasPublished).toBe(true);
  });

  test("closes any open review round, so nobody is left holding a ghost", async () => {
    const ROUND = new mongoose.Types.ObjectId();
    mockFindById.mockResolvedValue(questionDoc({ ...MCQ }));
    mockRoundFind.mockReturnValue({ lean: async () => [{ _id: ROUND }] });

    await retireQuestion({ artifactId: ARTIFACT_ID.toString(), actorId: ACTOR });

    expect(mockRoundUpdateOne).toHaveBeenCalledWith(
      { _id: ROUND },
      { $set: { status: "superseded" } },
    );
  });

  test("retiring twice is refused", async () => {
    mockFindById.mockResolvedValue(questionDoc({ ...MCQ }, { retiredAt: new Date() }));
    await expect(
      retireQuestion({ artifactId: ARTIFACT_ID.toString(), actorId: ACTOR }),
    ).rejects.toThrow(/already retired/i);
  });
});

describe("restoreQuestion", () => {
  test("clears the retirement and logs it", async () => {
    const doc = questionDoc({ ...MCQ }, { retiredAt: new Date(), retireReason: "oops" });
    mockFindById.mockResolvedValue(doc);

    const res = await restoreQuestion({ artifactId: ARTIFACT_ID.toString(), actorId: ACTOR });

    expect(res.retiredAt).toBeNull();
    expect(doc._state.retiredAt).toBeNull();
    expect(doc._state.retireReason).toBeUndefined();
    expect(mockWriteAudit.mock.calls[0][0].eventKind).toBe("QUESTION_RESTORED");
  });

  test("restoring a live question is refused", async () => {
    mockFindById.mockResolvedValue(questionDoc({ ...MCQ }));
    await expect(
      restoreQuestion({ artifactId: ARTIFACT_ID.toString(), actorId: ACTOR }),
    ).rejects.toThrow(/not retired/i);
  });
});
