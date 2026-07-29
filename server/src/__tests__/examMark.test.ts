/**
 * Exams EX-3 tests — mark entry, paper-scale conversion, the CT pull, the Adab gate
 * (docs/prd-exams.md §6, D-#377/#378, §9.1/9.2/9.6).
 *
 * The two rules worth pinning hardest:
 *   · the FINAL component is ENTERED on the script's scale and CONVERTED on read;
 *   · missing is NOT zero — no class-test history pulls blank, and a component the paper
 *     does not have is absent rather than 0. Both would silently cost a grade band.
 */
interface Row { _id: { toString(): string }; [k: string]: unknown }
const mockExams: Row[] = [];
const mockPapers: Row[] = [];
const mockMarks: Row[] = [];
const mockStudents: Row[] = [];
const mockSections: Row[] = [];
const mockTests: Row[] = [];
const mockResults: Row[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];
let mockSubjectTeacher: string | null = null;

const idOf = (rv: unknown) =>
  rv && typeof rv === "object" && !Array.isArray(rv) && !(rv instanceof Date)
    ? (rv as { toString(): string }).toString()
    : rv;

function matchVal(rv: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && "$in" in (cond as object)) {
    return (cond as { $in: unknown[] }).$in.map(idOf).includes(idOf(rv));
  }
  return idOf(rv) === idOf(cond);
}
const matches = (r: Row, q: Record<string, unknown>) =>
  Object.entries(q).every(([k, v]) => matchVal(r[k], v));

function makeModel(store: Row[], prefix: string) {
  return {
    create: (doc: Record<string, unknown>) => {
      const seq = ++mockSeq;
      const row: Row = { ...doc, _id: { toString: () => `${prefix}-${seq}` }, save: () => Promise.resolve(row) };
      store.push(row);
      return Promise.resolve(row);
    },
    find: (q: Record<string, unknown> = {}) => {
      const hits = store.filter((r) => matches(r, q));
      const p = Promise.resolve(hits) as Promise<Row[]> & { sort: () => Promise<Row[]> };
      p.sort = () => Promise.resolve(hits);
      return p;
    },
    findOne: (q: Record<string, unknown> = {}) => Promise.resolve(store.find((r) => matches(r, q)) ?? null),
    // Mongoose accepts an ObjectId here, not just a string — normalise both sides.
    findById: (id: unknown) => Promise.resolve(store.find((r) => r._id.toString() === idOf(id)) ?? null),
    findByIdAndUpdate: (id: unknown, upd: { $set: Record<string, unknown> }) => {
      const row = store.find((r) => r._id.toString() === idOf(id));
      if (row) Object.assign(row, upd.$set);
      return Promise.resolve(row ?? null);
    },
  };
}

jest.mock("../modules/exams/models/Exam", () => ({ Exam: makeModel(mockExams, "ex") }));
jest.mock("../modules/exams/models/ExamPaper", () => ({ ExamPaper: makeModel(mockPapers, "pp") }));
jest.mock("../modules/exams/models/ExamMark", () => ({
  ExamMark: makeModel(mockMarks, "mk"),
  MARK_SOURCES: ["MANUAL", "CT_PULL"],
}));
jest.mock("../modules/foundation/models/Student", () => ({ Student: makeModel(mockStudents, "st") }));
jest.mock("../modules/foundation/models/Section", () => ({ Section: makeModel(mockSections, "sc") }));
jest.mock("../modules/trackers/models/ClassTest", () => ({ ClassTest: makeModel(mockTests, "ct") }));
jest.mock("../modules/trackers/models/ClassTestResult", () => ({ ClassTestResult: makeModel(mockResults, "cr") }));
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: () => Promise.resolve(mockSubjectTeacher),
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: Record<string, unknown>) => { mockAudits.push(p); return Promise.resolve(); },
}));

import * as MS from "../modules/exams/services/ExamMarkService";
import { ExamError } from "../modules/exams/services/ExamService";
import type { IExamPaper } from "../modules/exams/models/ExamPaper";

const ACTOR = "0000000000000000000000a1";
const TEACHER = "0000000000000000000000b1";
const OTHER = "0000000000000000000000b2";
const PAPER = "0000000000000000000000c1";
const EXAM = "0000000000000000000000d1";
const YEAR = "0000000000000000000000e1";
const CLASS = "0000000000000000000000f1";
const S1 = "00000000000000000000a001";
const S2 = "00000000000000000000a002";

/** The standard 3-component paper, script marked out of 200 (a real scan scale). */
const paperRow = (over: Record<string, unknown> = {}) => ({
  _id: { toString: () => PAPER },
  examId: { toString: () => EXAM },
  classId: { toString: () => CLASS },
  subject: "MATH",
  components: [
    { component: "CT", maxMarks: 10 },
    { component: "ADAB", maxMarks: 10 },
    { component: "FINAL", maxMarks: 80 },
  ],
  paperFullMarks: 200,
  ...over,
});

beforeEach(() => {
  [mockExams, mockPapers, mockMarks, mockStudents, mockSections, mockTests, mockResults].forEach((s) => (s.length = 0));
  mockAudits.length = 0;
  mockSeq = 0;
  mockSubjectTeacher = null;
  mockExams.push({
    _id: { toString: () => EXAM },
    academicYearId: { toString: () => YEAR },
    ctAggregation: { mode: "MEAN", bestN: 3 },
  });
  mockPapers.push(paperRow());
  mockStudents.push({ _id: { toString: () => S1 }, classId: { toString: () => CLASS }, active: true });
  mockStudents.push({ _id: { toString: () => S2 }, classId: { toString: () => CLASS }, active: true });
});

// ===========================================================================
// A. Entry scale vs component scale
// ===========================================================================

describe("A. entryScaleFor", () => {
  const p = paperRow() as unknown as IExamPaper;

  test("FINAL is entered on the SCRIPT's scale, not the component's", () => {
    expect(MS.entryScaleFor(p, "FINAL")).toBe(200);
  });

  test("CT and ADAB are entered on the component scale", () => {
    expect(MS.entryScaleFor(p, "CT")).toBe(10);
    expect(MS.entryScaleFor(p, "ADAB")).toBe(10);
  });

  test("a component the paper does not have is NULL, not 0 (C3 Maths / Nursery)", () => {
    const noCt = paperRow({
      components: [{ component: "ADAB", maxMarks: 10 }, { component: "FINAL", maxMarks: 90 }],
    }) as unknown as IExamPaper;
    expect(MS.entryScaleFor(noCt, "CT")).toBeNull();
  });
});

describe("A2. componentValueOf — derived, never stored", () => {
  const p = paperRow() as unknown as IExamPaper;

  test("FINAL converts from the script scale onto the component, nearest 0.5", () => {
    // 150/200 → 75% of 80 = 60
    expect(MS.componentValueOf({ component: "FINAL", status: "PRESENT", rawMark: 150 }, p)).toBe(60);
    // 149/200 → 59.6 → 59.5
    expect(MS.componentValueOf({ component: "FINAL", status: "PRESENT", rawMark: 149 }, p)).toBe(59.5);
  });

  test("CT / ADAB pass through untouched — they are already on the component scale", () => {
    expect(MS.componentValueOf({ component: "CT", status: "PRESENT", rawMark: 9 }, p)).toBe(9);
    expect(MS.componentValueOf({ component: "ADAB", status: "PRESENT", rawMark: 8 }, p)).toBe(8);
  });

  test("ABSENT contributes 0 (it prints \"Ab\" but still totals as nothing)", () => {
    expect(MS.componentValueOf({ component: "FINAL", status: "ABSENT" }, p)).toBe(0);
  });

  test("a RESOLVED divergence beats the checker's original figure (EX-4)", () => {
    expect(
      MS.componentValueOf(
        { component: "FINAL", status: "PRESENT", rawMark: 100, resolvedRawMark: 150, resolvedStatus: "PRESENT" },
        p,
      ),
    ).toBe(60);
  });
});

// ===========================================================================
// B. enterMarks validation
// ===========================================================================

describe("B. enterMarks", () => {
  test("stores the RAW mark on the entry scale and audits", async () => {
    const rows = await MS.enterMarks(
      PAPER,
      [{ studentId: S1, component: "FINAL", status: "PRESENT", rawMark: 150 }],
      ACTOR,
    );
    expect(rows[0].rawMark).toBe(150); // raw, not the converted 60
    expect(mockAudits.map((a) => a.eventKind)).toContain("EXAM_MARKS_ENTERED");
  });

  test("refuses a mark above the script's full marks", async () => {
    await expect(
      MS.enterMarks(PAPER, [{ studentId: S1, component: "FINAL", status: "PRESENT", rawMark: 201 }], ACTOR),
    ).rejects.toThrow(/বেশি হতে পারে না/);
  });

  test("refuses a CT above the component max even though the script scale is larger", async () => {
    await expect(
      MS.enterMarks(PAPER, [{ studentId: S1, component: "CT", status: "PRESENT", rawMark: 11 }], ACTOR),
    ).rejects.toThrow(/বেশি হতে পারে না/);
  });

  test("refuses a mark on an ABSENT entry, and a missing mark on a PRESENT one", async () => {
    await expect(
      MS.enterMarks(PAPER, [{ studentId: S1, component: "FINAL", status: "ABSENT", rawMark: 10 }], ACTOR),
    ).rejects.toThrow(/অনুপস্থিত/);
    await expect(
      MS.enterMarks(PAPER, [{ studentId: S1, component: "FINAL", status: "PRESENT" }], ACTOR),
    ).rejects.toThrow(/নম্বর দিতে হবে/);
  });

  test("refuses a component the paper does not have", async () => {
    mockPapers[0] = paperRow({ components: [{ component: "FINAL", maxMarks: 100 }] });
    await expect(
      MS.enterMarks(PAPER, [{ studentId: S1, component: "CT", status: "PRESENT", rawMark: 5 }], ACTOR),
    ).rejects.toThrow(/অংশ নেই/);
  });

  test("refuses a student who is not on this class's roster", async () => {
    await expect(
      MS.enterMarks(PAPER, [{ studentId: "ghost", component: "CT", status: "PRESENT", rawMark: 5 }], ACTOR),
    ).rejects.toThrow(/তালিকায় নেই/);
  });

  test("refuses any entry on a TABULATED paper", async () => {
    mockPapers[0] = paperRow({ tabulatedAt: new Date() });
    await expect(
      MS.enterMarks(PAPER, [{ studentId: S1, component: "CT", status: "PRESENT", rawMark: 5 }], ACTOR),
    ).rejects.toThrow(/সংকলিত/);
  });

  test("re-entering the same student × component UPDATES rather than duplicating", async () => {
    await MS.enterMarks(PAPER, [{ studentId: S1, component: "CT", status: "PRESENT", rawMark: 5 }], ACTOR);
    await MS.enterMarks(PAPER, [{ studentId: S1, component: "CT", status: "PRESENT", rawMark: 7 }], ACTOR);
    expect(mockMarks).toHaveLength(1);
    expect(mockMarks[0].rawMark).toBe(7);
  });
});

// ===========================================================================
// C. CT aggregation (D-#378)
// ===========================================================================

describe("C. aggregateCt — both modes ship", () => {
  test("MEAN averages every test", () => {
    expect(MS.aggregateCt([80, 60, 40], "MEAN", 3, 10)).toBe(6);
  });

  test("BEST_N averages only the best N", () => {
    // best 2 of [80,60,40] = 70% of 10 = 7
    expect(MS.aggregateCt([80, 60, 40], "BEST_N", 2, 10)).toBe(7);
  });

  test("BEST_N with fewer tests than N uses what exists — not a penalty", () => {
    expect(MS.aggregateCt([80, 60], "BEST_N", 5, 10)).toBe(7);
  });

  test("NO history yields NULL — blank, never 0 (D-#378)", () => {
    expect(MS.aggregateCt([], "MEAN", 3, 10)).toBeNull();
    expect(MS.aggregateCt([], "BEST_N", 3, 10)).toBeNull();
  });

  test("the result rounds to nearest 0.5 like every other converted mark", () => {
    // mean 63.333% of 10 = 6.333 → 6.5
    expect(MS.aggregateCt([70, 60, 60], "MEAN", 3, 10)).toBe(6.5);
  });
});

describe("C2. proposeCtMarks / applyCtPull", () => {
  const seedTest = (totalMarks: number) => {
    const t = { _id: { toString: () => `t${mockTests.length + 1}` }, classId: { toString: () => CLASS }, subject: "MATH", academicYearId: { toString: () => YEAR }, totalMarks };
    mockTests.push(t);
    return t;
  };
  const seedResult = (testId: string, studentId: string, marks: number | null, status = "PRESENT") => {
    mockResults.push({
      _id: { toString: () => `r${mockResults.length + 1}` },
      testId: { toString: () => testId },
      studentId: { toString: () => studentId },
      status,
      ...(marks === null ? {} : { marks }),
    });
  };

  test("a student with history proposes a value; one without proposes NULL", async () => {
    const t = seedTest(20);
    seedResult(t._id.toString(), S1, 16); // 80%
    const props = await MS.proposeCtMarks(PAPER);
    const byStudent = new Map(props.map((p) => [p.studentId, p]));
    expect(byStudent.get(S1)!.value).toBe(8);
    expect(byStudent.get(S2)!.value).toBeNull();
  });

  test("ABSENT class-test rows are excluded from the denominator (the CT-2 rule)", async () => {
    const t1 = seedTest(10);
    const t2 = seedTest(10);
    seedResult(t1._id.toString(), S1, 8);           // 80%
    seedResult(t2._id.toString(), S1, null, "ABSENT"); // ignored, not a 0
    const props = await MS.proposeCtMarks(PAPER);
    expect(props.find((p) => p.studentId === S1)!.value).toBe(8);
  });

  test("applyCtPull SKIPS the no-history student rather than writing a 0", async () => {
    const t = seedTest(20);
    seedResult(t._id.toString(), S1, 16);
    const written = await MS.applyCtPull(PAPER, ACTOR);
    expect(written).toBe(1);
    expect(mockMarks).toHaveLength(1);
    expect(idOf(mockMarks[0].studentId)).toBe(S1);
    expect(mockAudits.map((a) => a.eventKind)).toContain("EXAM_CT_PULLED");
  });

  test("a pull NEVER clobbers a manually typed value", async () => {
    const t = seedTest(20);
    seedResult(t._id.toString(), S1, 16); // would propose 8
    await MS.enterMarks(PAPER, [{ studentId: S1, component: "CT", status: "PRESENT", rawMark: 3 }], ACTOR);
    const written = await MS.applyCtPull(PAPER, ACTOR);
    expect(written).toBe(0);
    expect(mockMarks[0].rawMark).toBe(3);
  });

  test("pulling on a paper with NO CT component is refused, not silently zeroed", async () => {
    mockPapers[0] = paperRow({
      components: [{ component: "ADAB", maxMarks: 10 }, { component: "FINAL", maxMarks: 90 }],
    });
    await expect(MS.proposeCtMarks(PAPER)).rejects.toThrow(/CT অংশ নেই/);
  });
});

// ===========================================================================
// D. The ADAB gate (§9.6)
// ===========================================================================

describe("D. assertCanEnterComponent — ADAB belongs to the SUBJECT teacher", () => {
  const p = paperRow() as unknown as IExamPaper;

  beforeEach(() => {
    mockSections.push({ _id: { toString: () => "sec-1" }, classId: { toString: () => CLASS } });
  });

  test("the routine's subject teacher may write ADAB", async () => {
    mockSubjectTeacher = TEACHER;
    await expect(MS.assertCanEnterComponent(p, "ADAB", TEACHER, false)).resolves.toBeUndefined();
  });

  test("another teacher — including the class teacher — may NOT", async () => {
    mockSubjectTeacher = TEACHER;
    await expect(MS.assertCanEnterComponent(p, "ADAB", OTHER, false)).rejects.toThrow(/বিষয় শিক্ষক/);
  });

  test("when the routine names NOBODY it refuses — it does not fall back to the actor (D-#366)", async () => {
    mockSubjectTeacher = null;
    await expect(MS.assertCanEnterComponent(p, "ADAB", TEACHER, false)).rejects.toThrow(ExamError);
  });

  test("a manager (Office/Principal) may always write ADAB — someone must be able to fix a record", async () => {
    mockSubjectTeacher = null;
    await expect(MS.assertCanEnterComponent(p, "ADAB", OTHER, true)).resolves.toBeUndefined();
  });

  test("CT and FINAL are NOT subject-teacher gated — the assignment gate covers them", async () => {
    mockSubjectTeacher = null;
    await expect(MS.assertCanEnterComponent(p, "CT", OTHER, false)).resolves.toBeUndefined();
    await expect(MS.assertCanEnterComponent(p, "FINAL", OTHER, false)).resolves.toBeUndefined();
  });
});
