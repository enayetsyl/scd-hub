/**
 * D-#761 — the vocab lists page on the server: per-student test history, per-section test
 * rows, the tests list, the teacher's weekly duty and the append-only assignment history.
 *
 * DB-free: the models are mocked chains, so the assertions are about the QUERY each page
 * builds (filter, stable sort, skip/limit) and that derived results are built for the
 * page's rows only.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

type Calls = { find?: unknown; sort?: unknown; skip?: number; limit?: number; count?: unknown };
function chainFor(calls: Calls, docs: () => unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.sort = (s: unknown) => { calls.sort = s; return chain; };
  chain.skip = (n: number) => { calls.skip = n; return chain; };
  chain.limit = (n: number) => { calls.limit = n; return chain; };
  chain.lean = async () => docs();
  return chain;
}

const testCalls: Calls = {};
let testDocs: unknown[] = [];
let testCount = 0;
jest.mock("../modules/vocab/models/VocabTest", () => ({
  VocabTest: {
    find: (q: unknown) => { testCalls.find = q; return chainFor(testCalls, () => testDocs); },
    countDocuments: async (q: unknown) => { testCalls.count = q; return testCount; },
  },
}));

let anchors: unknown[] = [];
jest.mock("../modules/vocab/models/VocabStudentTest", () => ({
  VocabStudentTest: { find: () => chainFor({}, () => anchors) },
}));

const asgCalls: Calls = {};
let asgCount = 0;
jest.mock("../modules/vocab/models/VocabTestAssignment", () => ({
  VocabTestAssignment: {
    find: (q: unknown) => { asgCalls.find = q; return chainFor(asgCalls, () => []); },
    countDocuments: async (q: unknown) => { asgCalls.count = q; return asgCount; },
  },
}));

const mockStudentResult = jest.fn();
const mockTestResults = jest.fn();
jest.mock("../modules/vocab/services/VocabResultService", () => ({
  studentResult: (testId: string, studentId: string) => mockStudentResult(testId, studentId),
  testResults: (testId: string) => mockTestResults(testId),
}));

import { vocabStudentTestsPage, vocabClassTestsPage } from "../modules/vocab/services/VocabSummaryService";
import { listVocabTestsPage } from "../modules/vocab/services/VocabTestService";
import { assignmentsForTeacherPage, assignmentHistoryPage } from "../modules/vocab/services/VocabAssignmentService";
import { weekStartFor } from "../modules/vocab/services/vocabCalendar";

const testDoc = (label: string, day: number) => ({
  _id: oid(),
  program: "ENGLISH",
  sectionId: oid(),
  classLevel: 3,
  label,
  testDate: new Date(2026, 8, day),
  totalMarks: 20,
  status: "marked",
});

const result = (testId: string, studentId: string, score: number) => ({
  testId,
  studentId,
  status: "PRESENT",
  score,
  totalMarks: 20,
  marksLost: 20 - score,
  wrongCount: 0,
  wrongWords: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const c of [testCalls, asgCalls]) for (const k of Object.keys(c)) delete (c as Record<string, unknown>)[k];
});

describe("vocabStudentTestsPage", () => {
  test("derives results for THIS page's tests only; total counts every test", async () => {
    const studentId = oid().toString();
    const tests = [testDoc("Set 3", 20), testDoc("Set 2", 13), testDoc("Set 1", 6)];
    anchors = tests.map((t) => ({ testId: t._id }));
    testDocs = tests; // the student's tests, newest first (the DB sort)
    mockStudentResult.mockImplementation(async (testId: string, sid: string) => result(testId, sid, 15));

    const page = await vocabStudentTestsPage(studentId, { program: "ENGLISH" }, { page: 2, pageSize: 2 });

    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].test.label).toBe("Set 1");
    expect(mockStudentResult).toHaveBeenCalledTimes(1);
    expect(mockStudentResult).toHaveBeenCalledWith(tests[2]._id.toString(), studentId);
    expect(testCalls.sort).toEqual({ testDate: -1, _id: -1 });
    expect((testCalls.find as Record<string, unknown>).program).toBe("ENGLISH");
  });

  test("a student with no tests → an empty page, no result reads", async () => {
    anchors = [];
    const page = await vocabStudentTestsPage(oid().toString(), {}, {});
    expect(page).toMatchObject({ rows: [], total: 0, page: 1 });
    expect(mockStudentResult).not.toHaveBeenCalled();
  });
});

describe("vocabClassTestsPage", () => {
  test("skip/limit run in the database; each page test gets its own roll-up", async () => {
    const sectionId = oid().toString();
    const t = testDoc("Set 9", 27);
    testDocs = [t];
    testCount = 51;
    mockTestResults.mockResolvedValue([result(t._id.toString(), "s1", 10), result(t._id.toString(), "s2", 20)]);

    const page = await vocabClassTestsPage(sectionId, { program: "ENGLISH" }, { page: 2, pageSize: 50 });

    expect(testCalls).toMatchObject({ sort: { testDate: -1, _id: -1 }, skip: 50, limit: 50 });
    expect(testCalls.count).toEqual(testCalls.find);
    expect((testCalls.find as Record<string, unknown>).sectionId).toEqual(new mongoose.Types.ObjectId(sectionId));
    expect(page.total).toBe(51);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].rollup.presentCount).toBe(2);
    expect(page.rows[0].rollup.averageScore).toBe(15);
    expect(mockTestResults).toHaveBeenCalledTimes(1);
  });
});

describe("listVocabTestsPage", () => {
  test("filters section/program/week, newest first with an _id tie-break", async () => {
    testDocs = [];
    testCount = 0;
    const sectionId = oid().toString();
    const weekOf = new Date(2026, 9, 14);
    await listVocabTestsPage({ sectionId, program: "BANGLA", weekOf }, { page: 3, pageSize: 10 });
    expect(testCalls.find).toEqual({
      sectionId: new mongoose.Types.ObjectId(sectionId),
      program: "BANGLA",
      weekOf: weekStartFor(weekOf),
    });
    expect(testCalls).toMatchObject({ sort: { testDate: -1, _id: -1 }, skip: 20, limit: 10 });
  });
});

describe("vocab assignment pages", () => {
  test("assignmentsForTeacherPage: own rows, from a week onward, newest week first", async () => {
    const teacherId = oid().toString();
    const from = new Date(2026, 9, 1);
    asgCount = 3;
    const page = await assignmentsForTeacherPage(teacherId, from, {});
    expect(asgCalls.find).toEqual({
      assignedTeacherId: new mongoose.Types.ObjectId(teacherId),
      weekOf: { $gte: weekStartFor(from) },
    });
    expect(asgCalls).toMatchObject({ sort: { weekOf: -1, createdAt: -1, _id: -1 }, skip: 0, limit: 50 });
    expect(page.total).toBe(3);
  });

  test("assignmentHistoryPage: one (section × program), newest first, page size capped", async () => {
    const sectionId = oid().toString();
    await assignmentHistoryPage(sectionId, "ARABIC", { page: 1, pageSize: 10_000 });
    expect(asgCalls.find).toEqual({ sectionId: new mongoose.Types.ObjectId(sectionId), program: "ARABIC" });
    expect(asgCalls).toMatchObject({ sort: { createdAt: -1, _id: -1 }, limit: 200 });
  });
});
