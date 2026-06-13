/**
 * VC-2 — vocab test build (positions engine + test CRUD) + weekly assignment +
 * calendar (prd-vocabulary-tracker §3.3–§3.5/§5, D-#106/#127). Pure helpers exercised
 * directly; services run against mocked models (DB-free, the repo convention).
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// --- mocks -----------------------------------------------------------------
const mockTestCreate = jest.fn();
const mockTestFindById = jest.fn();
const mockTestFind = jest.fn();
const mockPosDeleteMany = jest.fn().mockResolvedValue(undefined);
const mockPosInsertMany = jest.fn().mockResolvedValue(undefined);
const mockPosFind = jest.fn();
const mockWordFind = jest.fn();
const mockAssignCreate = jest.fn();
const mockAssignFindOne = jest.fn();
const mockAssignFind = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

/** find()-chain stub: .select()/.sort() return self, .lean() resolves the value. */
const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

jest.mock("../modules/vocab/models/VocabTest", () => ({
  VocabTest: {
    create: (d: unknown) => mockTestCreate(d),
    findById: (id: unknown) => mockTestFindById(id),
    find: (q: unknown) => mockTestFind(q),
  },
}));
jest.mock("../modules/vocab/models/VocabTestPosition", () => ({
  VocabTestPosition: {
    deleteMany: (q: unknown) => mockPosDeleteMany(q),
    insertMany: (d: unknown) => mockPosInsertMany(d),
    find: (q: unknown) => mockPosFind(q),
  },
}));
jest.mock("../modules/vocab/models/VocabWord", () => ({
  VocabWord: { find: (q: unknown) => mockWordFind(q) },
}));
jest.mock("../modules/vocab/models/VocabTestAssignment", () => ({
  VocabTestAssignment: {
    create: (d: unknown) => mockAssignCreate(d),
    findOne: (q: unknown) => mockAssignFindOne(q),
    find: (q: unknown) => mockAssignFind(q),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import {
  layoutPositions,
  createVocabTest,
  updateVocabTest,
  setVocabTestPositions,
} from "../modules/vocab/services/VocabTestService";
import {
  assignWeeklyTester,
  isVocabOperator,
} from "../modules/vocab/services/VocabAssignmentService";
import { VocabError } from "../modules/vocab/services/VocabWordService";
import {
  weekStartFor,
  thursdayOf,
  rollTestDate,
} from "../modules/vocab/services/vocabCalendar";

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Calendar (pure)
// ---------------------------------------------------------------------------

describe("vocabCalendar", () => {
  test("weekStartFor returns the Sunday of the week", () => {
    // 2026-06-10 is a Wednesday → its week's Sunday is 2026-06-07.
    const ws = weekStartFor(new Date(2026, 5, 10));
    expect(ws.getDay()).toBe(0);
    expect(ws.getDate()).toBe(7);
  });

  test("thursdayOf returns getDay 4", () => {
    const thu = thursdayOf(weekStartFor(new Date(2026, 5, 10)));
    expect(thu.getDay()).toBe(4);
    expect(thu.getDate()).toBe(11); // 2026-06-11 is the Thursday
  });

  test("rollTestDate keeps an open Thursday", () => {
    const thu = thursdayOf(weekStartFor(new Date(2026, 5, 10)));
    const got = rollTestDate(thu, () => true);
    expect(got.getTime()).toBe(thu.getTime());
  });

  test("rollTestDate rolls a holiday Thursday back to the nearest open day", () => {
    const thu = thursdayOf(weekStartFor(new Date(2026, 5, 10))); // 06-11
    // Thursday + Wednesday closed; Tuesday (06-09) open.
    const open = (d: Date) => d.getDate() !== 11 && d.getDate() !== 10;
    const got = rollTestDate(thu, open);
    expect(got.getDate()).toBe(9);
  });

  test("rollTestDate falls back to Thursday when the whole week is closed", () => {
    const thu = thursdayOf(weekStartFor(new Date(2026, 5, 10)));
    const got = rollTestDate(thu, () => false);
    expect(got.getTime()).toBe(thu.getTime());
  });
});

// ---------------------------------------------------------------------------
// Position layout engine (pure, §3.4)
// ---------------------------------------------------------------------------

describe("layoutPositions", () => {
  test("lays 1-based qNumbers per direction in selection order", () => {
    const a = oid().toString();
    const b = oid().toString();
    const c = oid().toString();
    const pos = layoutPositions("ENGLISH", [
      { direction: "DICTATION", wordIds: [a, b] },
      { direction: "HEADWORD_TO_BANGLA", wordIds: [c] },
    ]);
    expect(pos).toEqual([
      { direction: "DICTATION", qNumber: 1, wordId: a },
      { direction: "DICTATION", qNumber: 2, wordId: b },
      { direction: "HEADWORD_TO_BANGLA", qNumber: 1, wordId: c },
    ]);
  });

  test("rejects a direction the program does not use (BANGLA has no reverse meaning)", () => {
    expect(() =>
      layoutPositions("BANGLA", [{ direction: "BANGLA_TO_HEADWORD", wordIds: [oid().toString()] }]),
    ).toThrow(VocabError);
  });

  test("rejects a duplicate direction", () => {
    const w = oid().toString();
    expect(() =>
      layoutPositions("ENGLISH", [
        { direction: "DICTATION", wordIds: [w] },
        { direction: "DICTATION", wordIds: [w] },
      ]),
    ).toThrow(/Duplicate/);
  });

  test("rejects an empty selection", () => {
    expect(() => layoutPositions("ENGLISH", [{ direction: "DICTATION", wordIds: [] }])).toThrow(VocabError);
  });
});

// ---------------------------------------------------------------------------
// Operator predicate (pure, §5) — the gate's deny logic
// ---------------------------------------------------------------------------

describe("isVocabOperator", () => {
  const section = oid().toString();
  const me = oid().toString();

  test("the assigned tester is an operator", () => {
    const assigned = { assignedTeacherId: { toString: () => me } };
    expect(isVocabOperator(me, section, assigned, [])).toBe(true);
  });

  test("a covering teacher with an active proxy on the section is an operator", () => {
    const assigned = { assignedTeacherId: { toString: () => oid().toString() } };
    const scopes = [{ kind: "proxy", sectionId: section }];
    expect(isVocabOperator(me, section, assigned, scopes)).toBe(true);
  });

  test("a teacher who is neither assigned nor proxied is DENIED", () => {
    const assigned = { assignedTeacherId: { toString: () => oid().toString() } };
    const scopes = [{ kind: "teaching", sectionId: section }]; // teaching ≠ operator
    expect(isVocabOperator(me, section, assigned, scopes)).toBe(false);
  });

  test("a proxy on a DIFFERENT section does not qualify", () => {
    const scopes = [{ kind: "proxy", sectionId: oid().toString() }];
    expect(isVocabOperator(me, section, null, scopes)).toBe(false);
  });

  test("no assignment + no proxy is DENIED", () => {
    expect(isVocabOperator(me, section, null, [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VocabTestService
// ---------------------------------------------------------------------------

describe("createVocabTest", () => {
  test("creates a draft test, derives weekOf, audits VOCAB_TEST_CREATED", async () => {
    const id = oid();
    mockTestCreate.mockResolvedValue({ _id: id });
    const sectionId = oid().toString();
    const actorId = oid().toString();

    await createVocabTest({
      program: "ENGLISH",
      sectionId,
      classLevel: 3,
      testDate: new Date(2026, 5, 11), // Thursday
      label: " Set 1 ",
      totalMarks: 30,
      actorId,
    });

    const created = mockTestCreate.mock.calls[0][0];
    expect(created.program).toBe("ENGLISH");
    expect(created.label).toBe("Set 1");
    expect(created.status).toBe("draft");
    expect(new Date(created.weekOf).getDay()).toBe(0); // Sunday
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "VOCAB_TEST_CREATED", actorId }));
  });

  test("rejects an unknown program + a negative totalMarks", async () => {
    await expect(
      createVocabTest({ program: "X", sectionId: oid().toString(), classLevel: 3, testDate: new Date(), label: "a", totalMarks: 10, actorId: oid().toString() }),
    ).rejects.toThrow(VocabError);
    await expect(
      createVocabTest({ program: "ENGLISH", sectionId: oid().toString(), classLevel: 3, testDate: new Date(), label: "a", totalMarks: -1, actorId: oid().toString() }),
    ).rejects.toThrow(/totalMarks/);
  });
});

describe("updateVocabTest", () => {
  const testDoc = (over: Record<string, unknown> = {}) => ({
    _id: oid(), program: "ENGLISH", sectionId: oid(), classLevel: 3,
    label: "old", totalMarks: 30, dictationHalfMissCounts: false, status: "ready",
    weekOf: new Date(2026, 5, 7), testDate: new Date(2026, 5, 11),
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  test("edits metadata + audits", async () => {
    const doc = testDoc();
    mockTestFindById.mockResolvedValue(doc);
    await updateVocabTest({ testId: doc._id.toString(), totalMarks: 40, actorId: oid().toString() });
    expect(doc.totalMarks).toBe(40);
    expect(doc.save).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "VOCAB_TEST_UPDATED" }));
  });

  test("a marked test cannot be edited", async () => {
    mockTestFindById.mockResolvedValue(testDoc({ status: "marked" }));
    await expect(updateVocabTest({ testId: oid().toString(), label: "x", actorId: oid().toString() })).rejects.toThrow(/marked/);
  });
});

describe("setVocabTestPositions", () => {
  const wA = oid();
  const wB = oid();
  const baseTest = (over: Record<string, unknown> = {}) => ({
    _id: oid(), program: "ENGLISH", classLevel: 3, status: "draft",
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  test("validates words, rebuilds positions wholesale, flips to ready, audits", async () => {
    const test = baseTest();
    mockTestFindById.mockResolvedValue(test);
    mockWordFind.mockReturnValue(leanChain([{ _id: wA }, { _id: wB }]));
    mockPosFind.mockReturnValue(leanChain([{ qNumber: 1 }, { qNumber: 2 }]));

    await setVocabTestPositions({
      testId: test._id.toString(),
      selections: [{ direction: "DICTATION", wordIds: [wA.toString(), wB.toString()] }],
      actorId: oid().toString(),
    });

    expect(mockPosDeleteMany).toHaveBeenCalledWith({ testId: test._id });
    expect(mockPosInsertMany).toHaveBeenCalled();
    const inserted = mockPosInsertMany.mock.calls[0][0];
    expect(inserted).toHaveLength(2);
    expect(test.status).toBe("ready");
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "VOCAB_TEST_POSITIONS_SET" }));
  });

  test("rejects a word that is not in the test's (program × class) bank", async () => {
    const test = baseTest();
    mockTestFindById.mockResolvedValue(test);
    mockWordFind.mockReturnValue(leanChain([{ _id: wA }])); // wB not returned → stray
    await expect(
      setVocabTestPositions({
        testId: test._id.toString(),
        selections: [{ direction: "DICTATION", wordIds: [wA.toString(), wB.toString()] }],
        actorId: oid().toString(),
      }),
    ).rejects.toThrow(/not an active word/);
    expect(mockPosInsertMany).not.toHaveBeenCalled();
  });

  test("a marked test cannot be re-laid", async () => {
    mockTestFindById.mockResolvedValue(baseTest({ status: "marked" }));
    await expect(
      setVocabTestPositions({ testId: oid().toString(), selections: [{ direction: "DICTATION", wordIds: [wA.toString()] }], actorId: oid().toString() }),
    ).rejects.toThrow(/marked/);
  });
});

// ---------------------------------------------------------------------------
// VocabAssignmentService
// ---------------------------------------------------------------------------

describe("assignWeeklyTester", () => {
  test("appends a direct assignment, normalises weekOf to Sunday, audits", async () => {
    const id = oid();
    mockAssignCreate.mockResolvedValue({ _id: id });
    await assignWeeklyTester({
      sectionId: oid().toString(),
      program: "BANGLA",
      weekOf: new Date(2026, 5, 10), // Wednesday
      teacherId: oid().toString(),
      actorId: oid().toString(),
    });
    const created = mockAssignCreate.mock.calls[0][0];
    expect(created.source).toBe("direct");
    expect(new Date(created.weekOf).getDay()).toBe(0); // normalised to Sunday
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "VOCAB_TESTER_ASSIGNED" }));
  });

  test("rejects an unknown program", async () => {
    await expect(
      assignWeeklyTester({ sectionId: oid().toString(), program: "X", weekOf: new Date(), teacherId: oid().toString(), actorId: oid().toString() }),
    ).rejects.toThrow(VocabError);
  });
});
