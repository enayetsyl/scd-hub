/**
 * VC-3 — vocab result scoring engine + mistake capture (prd-vocabulary-tracker §3.6/§4,
 * D-#142). Pure scoring exercised directly; the service runs against mocked models.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// --- mocks -----------------------------------------------------------------
const mockTestFindById = jest.fn();
const mockTestFindByIdAndUpdate = jest.fn().mockResolvedValue(undefined);
const mockPosFind = jest.fn();
const mockWordFind = jest.fn();
const mockStudentTestFindOne = jest.fn();
const mockStudentTestFindOneAndUpdate = jest.fn();
const mockStudentTestFind = jest.fn();
const mockResultDeleteMany = jest.fn().mockResolvedValue(undefined);
const mockResultInsertMany = jest.fn().mockResolvedValue(undefined);
const mockResultFind = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

/** chain stub: .select()/.sort() return self, .lean() resolves the value; awaiting the
 *  chain directly (no .lean()) also resolves it. */
const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

jest.mock("../modules/vocab/models/VocabTest", () => ({
  VocabTest: {
    findById: (id: unknown) => mockTestFindById(id),
    findByIdAndUpdate: (id: unknown, p: unknown) => mockTestFindByIdAndUpdate(id, p),
  },
}));
jest.mock("../modules/vocab/models/VocabTestPosition", () => ({
  VocabTestPosition: { find: (q: unknown) => mockPosFind(q) },
}));
jest.mock("../modules/vocab/models/VocabWord", () => ({
  VocabWord: { find: (q: unknown) => mockWordFind(q) },
}));
jest.mock("../modules/vocab/models/VocabStudentTest", () => ({
  VocabStudentTest: {
    findOne: (q: unknown) => mockStudentTestFindOne(q),
    findOneAndUpdate: (q: unknown, u: unknown, o: unknown) => mockStudentTestFindOneAndUpdate(q, u, o),
    find: (q: unknown) => mockStudentTestFind(q),
  },
}));
jest.mock("../modules/vocab/models/VocabStudentResult", () => ({
  VocabStudentResult: {
    deleteMany: (q: unknown) => mockResultDeleteMany(q),
    insertMany: (d: unknown) => mockResultInsertMany(d),
    find: (q: unknown) => mockResultFind(q),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: (p: unknown) => mockWriteAudit(p) }));

import {
  fieldCountForPosition,
  marksLostForPosition,
  wrongFieldsValid,
  scoreStudent,
} from "../modules/vocab/services/vocabScoring";
import { submitStudentResult, studentResult } from "../modules/vocab/services/VocabResultService";
import { VocabError } from "../modules/vocab/services/VocabWordService";

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Pure scoring (§4)
// ---------------------------------------------------------------------------

describe("vocabScoring", () => {
  test("field count: DICTATION uses the program count, others = 1", () => {
    expect(fieldCountForPosition("DICTATION", "ENGLISH")).toBe(2);
    expect(fieldCountForPosition("DICTATION", "BANGLA")).toBe(1);
    expect(fieldCountForPosition("HEADWORD_TO_BANGLA", "ENGLISH")).toBe(1);
  });

  test("single-field position: wrong = 1 lost", () => {
    expect(marksLostForPosition("HEADWORD_TO_BANGLA", "ENGLISH", false, [1])).toBe(1);
    expect(marksLostForPosition("HEADWORD_TO_BANGLA", "ENGLISH", true, [1])).toBe(1);
    expect(marksLostForPosition("HEADWORD_TO_BANGLA", "ENGLISH", false, [])).toBe(0);
  });

  test("2-field DICTATION, half-miss OFF: any field wrong = 1 lost (max 1)", () => {
    expect(marksLostForPosition("DICTATION", "ENGLISH", false, [1])).toBe(1);
    expect(marksLostForPosition("DICTATION", "ENGLISH", false, [1, 2])).toBe(1);
  });

  test("2-field DICTATION, half-miss ON: 1 lost per wrong field (max 2)", () => {
    expect(marksLostForPosition("DICTATION", "ENGLISH", true, [1])).toBe(1);
    expect(marksLostForPosition("DICTATION", "ENGLISH", true, [1, 2])).toBe(2);
  });

  test("BANGLA 1-field DICTATION behaves single-field even with half-miss on", () => {
    expect(marksLostForPosition("DICTATION", "BANGLA", true, [1])).toBe(1);
  });

  test("wrongFieldsValid: 1-based, within field count, non-empty, no dups", () => {
    expect(wrongFieldsValid("DICTATION", "ENGLISH", [1, 2])).toBe(true);
    expect(wrongFieldsValid("DICTATION", "ENGLISH", [3])).toBe(false); // out of range
    expect(wrongFieldsValid("DICTATION", "ENGLISH", [1, 1])).toBe(false); // dup
    expect(wrongFieldsValid("HEADWORD_TO_BANGLA", "ENGLISH", [2])).toBe(false); // single-field max 1
    expect(wrongFieldsValid("HEADWORD_TO_BANGLA", "ENGLISH", [])).toBe(false); // empty
  });

  test("scoreStudent sums marks lost, floors at 0, counts wrong positions", () => {
    const pA = oid().toString(), pB = oid().toString(), pC = oid().toString();
    const positions = [
      { positionId: pA, direction: "DICTATION" as const },
      { positionId: pB, direction: "HEADWORD_TO_BANGLA" as const },
      { positionId: pC, direction: "BANGLA_TO_HEADWORD" as const },
    ];
    const mistakes = new Map<string, number[]>([
      [pA, [1, 2]], // dictation, half-miss on → 2
      [pB, [1]],    // single → 1
    ]);
    const s = scoreStudent({ positions, mistakesByPositionId: mistakes, totalMarks: 30, program: "ENGLISH", dictationHalfMissCounts: true });
    expect(s.marksLost).toBe(3);
    expect(s.score).toBe(27);
    expect(s.wrongCount).toBe(2);
    expect(s.wrongPositionIds.sort()).toEqual([pA, pB].sort());
  });

  test("scoreStudent floors at 0 when marks lost exceed totalMarks", () => {
    const p = oid().toString();
    const s = scoreStudent({
      positions: [{ positionId: p, direction: "HEADWORD_TO_BANGLA" }],
      mistakesByPositionId: new Map([[p, [1]]]),
      totalMarks: 0, program: "ENGLISH", dictationHalfMissCounts: false,
    });
    expect(s.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// submitStudentResult
// ---------------------------------------------------------------------------

describe("submitStudentResult", () => {
  const posA = oid(), posB = oid();
  const setupTest = (status = "ready") => {
    mockTestFindById.mockReturnValue(leanChain({ _id: oid(), program: "ENGLISH", status }));
    mockPosFind.mockReturnValue(leanChain([
      { _id: posA, direction: "DICTATION", wordId: oid() },
      { _id: posB, direction: "HEADWORD_TO_BANGLA", wordId: oid() },
    ]));
    mockStudentTestFindOneAndUpdate.mockResolvedValue({ _id: oid(), status: "PRESENT" });
  };

  test("PRESENT replaces mistakes, flips test to marked, audits", async () => {
    setupTest("ready");
    await submitStudentResult({
      testId: oid().toString(),
      studentId: oid().toString(),
      status: "PRESENT",
      mistakes: [{ positionId: posA.toString(), wrongFields: [1, 2] }],
      actorId: oid().toString(),
    });
    expect(mockResultDeleteMany).toHaveBeenCalled();
    expect(mockResultInsertMany).toHaveBeenCalled();
    expect(mockTestFindByIdAndUpdate).toHaveBeenCalledWith(expect.anything(), { status: "marked" });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "VOCAB_RESULT_RECORDED" }));
  });

  test("ABSENT clears mistakes (no insert) + records the flag", async () => {
    setupTest("ready");
    await submitStudentResult({ testId: oid().toString(), studentId: oid().toString(), status: "ABSENT", actorId: oid().toString() });
    expect(mockResultDeleteMany).toHaveBeenCalled();
    expect(mockResultInsertMany).not.toHaveBeenCalled();
    expect(mockStudentTestFindOneAndUpdate).toHaveBeenCalled();
  });

  test("rejects a mistake on a position not in the test", async () => {
    setupTest();
    await expect(
      submitStudentResult({ testId: oid().toString(), studentId: oid().toString(), status: "PRESENT", mistakes: [{ positionId: oid().toString(), wrongFields: [1] }], actorId: oid().toString() }),
    ).rejects.toThrow(/does not belong/);
    expect(mockResultInsertMany).not.toHaveBeenCalled();
  });

  test("rejects invalid wrongFields (out of range for the position)", async () => {
    setupTest();
    await expect(
      submitStudentResult({ testId: oid().toString(), studentId: oid().toString(), status: "PRESENT", mistakes: [{ positionId: posB.toString(), wrongFields: [2] }], actorId: oid().toString() }),
    ).rejects.toThrow(/Invalid wrongFields/);
  });

  test("rejects an unknown status", async () => {
    setupTest();
    await expect(
      submitStudentResult({ testId: oid().toString(), studentId: oid().toString(), status: "MAYBE", actorId: oid().toString() }),
    ).rejects.toThrow(VocabError);
  });
});

// ---------------------------------------------------------------------------
// studentResult (derived)
// ---------------------------------------------------------------------------

describe("studentResult", () => {
  test("PRESENT student: derives score + wrong-words join", async () => {
    const posA = oid(), wordA = oid();
    mockStudentTestFindOne.mockReturnValue(leanChain({ status: "PRESENT" }));
    mockTestFindById.mockReturnValue(leanChain({ program: "ENGLISH", totalMarks: 30, dictationHalfMissCounts: false }));
    mockPosFind.mockReturnValue(leanChain([{ _id: posA, direction: "DICTATION", wordId: wordA }]));
    mockResultFind.mockReturnValue(leanChain([{ positionId: posA, wrongFields: [1, 2] }]));
    mockWordFind.mockReturnValue(leanChain([{ _id: wordA, headword: "cat", banglaMeaning: "বিড়াল" }]));

    const r = await studentResult(oid().toString(), oid().toString());
    expect(r?.status).toBe("PRESENT");
    expect(r?.score).toBe(29); // half-miss off → 1 lost
    expect(r?.wrongCount).toBe(1);
    expect(r?.wrongWords).toHaveLength(1);
    expect(r?.wrongWords[0].headword).toBe("cat");
    expect(r?.wrongWords[0].direction).toBe("DICTATION");
  });

  test("ABSENT student: null score, no wrong-words, excluded from scoring", async () => {
    mockStudentTestFindOne.mockReturnValue(leanChain({ status: "ABSENT" }));
    mockTestFindById.mockReturnValue(leanChain({ program: "ENGLISH", totalMarks: 30, dictationHalfMissCounts: false }));
    const r = await studentResult(oid().toString(), oid().toString());
    expect(r?.status).toBe("ABSENT");
    expect(r?.score).toBeNull();
    expect(r?.marksLost).toBeNull();
    expect(r?.wrongWords).toEqual([]);
  });

  test("never-recorded student: null", async () => {
    mockStudentTestFindOne.mockReturnValue(leanChain(null));
    const r = await studentResult(oid().toString(), oid().toString());
    expect(r).toBeNull();
  });
});
