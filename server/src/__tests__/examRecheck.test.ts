/**
 * Exams EX-4 tests — independent recheck, divergence resolution, tabulation lock
 * (docs/prd-exams.md §6).
 *
 * The scans show what happens without this: two side-by-side columns, mostly identical
 * (the second copied from the first), and where they differ, one struck out with no record
 * of who decided. Every test here is one of those failure modes made impossible.
 */
interface Row { _id: { toString(): string }; [k: string]: unknown }
const mockPapers: Row[] = [];
const mockMarks: Row[] = [];
const mockStudents: Row[] = [];
const mockCustody: Row[] = [];
const mockExams: Row[] = [];
const mockUsers: Row[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];

const idOf = (rv: unknown) =>
  rv && typeof rv === "object" && !Array.isArray(rv) && !(rv instanceof Date)
    ? (rv as { toString(): string }).toString()
    : rv;
const matches = (r: Row, q: Record<string, unknown>) =>
  Object.entries(q).every(([k, v]) => idOf(r[k]) === idOf(v));

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
    findById: (id: unknown) => Promise.resolve(store.find((r) => r._id.toString() === idOf(id)) ?? null),
    findByIdAndUpdate: (id: unknown, upd: { $set: Record<string, unknown> }) => {
      const row = store.find((r) => r._id.toString() === idOf(id));
      if (row) Object.assign(row, upd.$set);
      return Promise.resolve(row ?? null);
    },
  };
}

jest.mock("../modules/exams/models/ExamPaper", () => ({ ExamPaper: makeModel(mockPapers, "pp") }));
// EX-7 wired the custody chain into tabulationReadiness, so these three are now on the
// path even though this file tests the recheck. Empty stores ⇒ a trivially balanced chain,
// which isolates EX-4's own gates; the custody gate itself is proven in examCustody.test.ts
// and in the EX-7 integration test below.
jest.mock("../modules/exams/models/ExamCustodyEvent", () => ({ ExamCustodyEvent: makeModel(mockCustody, "cu") }));
jest.mock("../modules/exams/models/Exam", () => ({ Exam: makeModel(mockExams, "ex") }));
jest.mock("../modules/foundation/models/User", () => ({ User: makeModel(mockUsers, "us") }));
jest.mock("../modules/exams/models/ExamMark", () => ({
  ExamMark: makeModel(mockMarks, "mk"),
  MARK_SOURCES: ["MANUAL", "CT_PULL"],
}));
jest.mock("../modules/foundation/models/Student", () => ({ Student: makeModel(mockStudents, "st") }));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: Record<string, unknown>) => { mockAudits.push(p); return Promise.resolve(); },
}));

import * as RS from "../modules/exams/services/ExamRecheckService";
import { ExamError } from "../modules/exams/services/ExamService";

const ACTOR = "0000000000000000000000a1";
const PAPER = "0000000000000000000000c1";
const EXAM = "0000000000000000000000d1";
const CLASS = "0000000000000000000000f1";
const S1 = "00000000000000000000a001";

/** A one-component paper keeps the roster×component arithmetic obvious. */
const paperRow = (over: Record<string, unknown> = {}) => ({
  _id: { toString: () => PAPER },
  examId: { toString: () => EXAM },
  classId: { toString: () => CLASS },
  subject: "MATH",
  components: [{ component: "FINAL", maxMarks: 80 }],
  paperFullMarks: 100,
  save() { return Promise.resolve(this); },
  ...over,
});

const seedMark = (over: Record<string, unknown> = {}) => {
  const row: Row = {
    _id: { toString: () => `mk-${mockMarks.length + 1}` },
    paperId: { toString: () => PAPER },
    examId: { toString: () => EXAM },
    studentId: { toString: () => S1 },
    component: "FINAL",
    status: "PRESENT",
    rawMark: 70,
    source: "MANUAL",
    ...over,
  };
  mockMarks.push(row);
  return row;
};

beforeEach(() => {
  [mockPapers, mockMarks, mockStudents, mockCustody, mockExams, mockUsers].forEach((s) => (s.length = 0));
  mockAudits.length = 0;
  mockSeq = 0;
  mockPapers.push(paperRow());
  mockStudents.push({ _id: { toString: () => S1 }, classId: { toString: () => CLASS }, active: true });
});

// ===========================================================================
// A. Divergence detection
// ===========================================================================

describe("A. isDivergent", () => {
  test("a row with no recheck yet is NOT divergent — it is simply unanswered", () => {
    expect(RS.isDivergent({ status: "PRESENT", rawMark: 70 })).toBe(false);
  });

  test("equal marks agree", () => {
    expect(RS.isDivergent({ status: "PRESENT", rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 70 })).toBe(false);
  });

  test("different marks diverge", () => {
    expect(RS.isDivergent({ status: "PRESENT", rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 72 })).toBe(true);
  });

  test("PRESENT vs ABSENT diverges — a disagreement about attendance is a disagreement", () => {
    expect(RS.isDivergent({ status: "PRESENT", rawMark: 70, recheckStatus: "ABSENT" })).toBe(true);
  });

  test("both ABSENT agree", () => {
    expect(RS.isDivergent({ status: "ABSENT", recheckStatus: "ABSENT" })).toBe(false);
  });
});

// ===========================================================================
// B. The independence rule
// ===========================================================================

describe("B. recheckWorksheet hides the checker's figure", () => {
  test("an UNANSWERED row hides the checker's mark from the rechecker", async () => {
    seedMark({ rawMark: 70 });
    const rows = await RS.recheckWorksheet(PAPER, false);
    expect(rows[0].checkerRawMark).toBeNull();
    expect(rows[0].checkerStatus).toBeNull();
  });

  test("once the rechecker has answered, both figures are visible", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 72 });
    const rows = await RS.recheckWorksheet(PAPER, false);
    expect(rows[0].checkerRawMark).toBe(70);
    expect(rows[0].recheckRawMark).toBe(72);
    expect(rows[0].divergent).toBe(true);
  });

  test("revealAll (manager / tabulator) shows everything immediately", async () => {
    seedMark({ rawMark: 70 });
    const rows = await RS.recheckWorksheet(PAPER, true);
    expect(rows[0].checkerRawMark).toBe(70);
  });
});

// ===========================================================================
// C. Entering the recheck
// ===========================================================================

describe("C. enterRecheckMarks", () => {
  test("stores the rechecker's own figure and audits", async () => {
    seedMark({ rawMark: 70 });
    const n = await RS.enterRecheckMarks(
      PAPER, [{ studentId: S1, component: "FINAL", status: "PRESENT", rawMark: 72 }], ACTOR,
    );
    expect(n).toBe(1);
    expect(mockMarks[0].recheckRawMark).toBe(72);
    expect(mockMarks[0].rawMark).toBe(70); // the checker's figure is NOT overwritten
    expect(mockAudits.map((a) => a.eventKind)).toContain("EXAM_RECHECK_ENTERED");
  });

  test("refuses a row the checker never filled — you cannot recheck what was never checked", async () => {
    await expect(
      RS.enterRecheckMarks(PAPER, [{ studentId: S1, component: "FINAL", status: "PRESENT", rawMark: 72 }], ACTOR),
    ).rejects.toThrow(/আগে চেক করতে হবে/);
  });

  test("refuses a figure above the script scale", async () => {
    seedMark();
    await expect(
      RS.enterRecheckMarks(PAPER, [{ studentId: S1, component: "FINAL", status: "PRESENT", rawMark: 101 }], ACTOR),
    ).rejects.toThrow(ExamError);
  });

  test("refuses any recheck on a TABULATED paper", async () => {
    mockPapers[0] = paperRow({ tabulatedAt: new Date() });
    seedMark();
    await expect(
      RS.enterRecheckMarks(PAPER, [{ studentId: S1, component: "FINAL", status: "PRESENT", rawMark: 72 }], ACTOR),
    ).rejects.toThrow(/সংকলিত/);
  });
});

// ===========================================================================
// D. Resolution
// ===========================================================================

describe("D. resolveDivergence", () => {
  test("the AGREED figure wins over both passes and stamps the resolver", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 72 });
    const row = await RS.resolveDivergence(PAPER, S1, "FINAL", "PRESENT", 71, ACTOR);
    expect(row.resolvedRawMark).toBe(71); // neither 70 nor 72
    expect(row.resolvedBy).toBeDefined();
    const audit = mockAudits.find((a) => a.eventKind === "EXAM_DIVERGENCE_RESOLVED");
    expect(audit?.meta).toMatchObject({ checker: 70, recheck: 72, agreed: 71 });
  });

  test("refuses to 'resolve' a row that does not actually diverge", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 70 });
    await expect(
      RS.resolveDivergence(PAPER, S1, "FINAL", "PRESENT", 71, ACTOR),
    ).rejects.toThrow(/অমিল নেই/);
  });

  test("refuses an agreed figure above the scale", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 72 });
    await expect(
      RS.resolveDivergence(PAPER, S1, "FINAL", "PRESENT", 300, ACTOR),
    ).rejects.toThrow(ExamError);
  });

  test("divergenceReport lists the unresolved rows with both figures", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 72 });
    const rows = await RS.divergenceReport(PAPER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ checkerRawMark: 70, recheckRawMark: 72, resolved: false });
  });
});

// ===========================================================================
// E. The tabulation lock
// ===========================================================================

describe("E. tabulatePaper", () => {
  test("REFUSES while a divergence is unresolved — the gate that makes the recheck mean something", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 72 });
    await expect(RS.tabulatePaper(PAPER, ACTOR)).rejects.toThrow(/অমিল/);
    expect(mockPapers[0].tabulatedAt).toBeUndefined();
  });

  test("REFUSES while a mark is missing", async () => {
    // roster of 1 × 1 component = 1 expected, none entered
    await expect(RS.tabulatePaper(PAPER, ACTOR)).rejects.toThrow(/নম্বর এখনও দেওয়া হয়নি/);
  });

  test("locks once every divergence is settled and every mark is in", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 72 });
    await RS.resolveDivergence(PAPER, S1, "FINAL", "PRESENT", 71, ACTOR);
    const paper = await RS.tabulatePaper(PAPER, ACTOR);
    expect(paper.tabulatedAt).toBeDefined();
    expect(mockAudits.map((a) => a.eventKind)).toContain("EXAM_PAPER_TABULATED");
  });

  test("locks when checker and rechecker simply agreed", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 70 });
    await expect(RS.tabulatePaper(PAPER, ACTOR)).resolves.toBeDefined();
  });

  test("refuses to tabulate twice", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 70 });
    await RS.tabulatePaper(PAPER, ACTOR);
    await expect(RS.tabulatePaper(PAPER, ACTOR)).rejects.toThrow(/আগেই সংকলিত/);
  });

  test("readiness names each blocker rather than just refusing", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 72 });
    const r = await RS.tabulationReadiness(PAPER);
    expect(r).toMatchObject({ ready: false, unresolvedDivergences: 1, missingMarks: 0, notRechecked: 0 });
  });
});

// ===========================================================================
// E2. EX-7 — the custody chain is a GATE on tabulation, not a logbook (D-#382)
// ===========================================================================

describe("E2. custody blocks tabulation", () => {
  /** A settled, fully-marked paper: the ONLY thing that can block it is custody. */
  const readyPaper = async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 70 });
    mockExams.push({ _id: { toString: () => EXAM } });
  };

  test("an unbalanced chain BLOCKS tabulation even when every mark is settled", async () => {
    await readyPaper();
    // 12 scripts issued for checking and acknowledged, none returned.
    mockCustody.push({
      _id: { toString: () => "cu-1" },
      examId: { toString: () => EXAM },
      paperId: { toString: () => PAPER },
      stage: "CHECK_ISSUE",
      itemKind: "ANSWER_SCRIPT",
      status: "ACKNOWLEDGED",
      declaredCount: 12,
      countedCount: 12,
      handedOverAt: new Date(),
    });

    const readiness = await RS.tabulationReadiness(PAPER);
    expect(readiness.ready).toBe(false);
    expect(readiness.unresolvedDivergences).toBe(0); // marks are fine…
    expect(readiness.custodyBlockers.length).toBeGreaterThan(0); // …custody is not

    await expect(RS.tabulatePaper(PAPER, ACTOR)).rejects.toThrow(/চেক/);
    expect(mockPapers[0].tabulatedAt).toBeUndefined();
  });

  test("a DISPUTED handover alone blocks tabulation", async () => {
    await readyPaper();
    mockCustody.push({
      _id: { toString: () => "cu-2" },
      examId: { toString: () => EXAM },
      paperId: { toString: () => PAPER },
      stage: "SCRIPT_RETURN",
      itemKind: "ANSWER_SCRIPT",
      status: "DISPUTED",
      declaredCount: 12,
      countedCount: 11,
      discrepancyNote: "one short",
      handedOverAt: new Date(),
    });

    await expect(RS.tabulatePaper(PAPER, ACTOR)).rejects.toThrow(/গরমিল/);
  });

  test("with a balanced chain the same paper tabulates", async () => {
    await readyPaper();
    const paper = await RS.tabulatePaper(PAPER, ACTOR);
    expect(paper.tabulatedAt).toBeDefined();
  });
});

describe("F. reopenPaper", () => {
  test("re-opening requires a reason and is audited with it", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 70 });
    await RS.tabulatePaper(PAPER, ACTOR);
    await RS.reopenPaper(PAPER, "wrong scale used", ACTOR);
    expect(mockPapers[0].tabulatedAt).toBeUndefined();
    const audit = mockAudits.find((a) => a.eventKind === "EXAM_PAPER_REOPENED");
    expect((audit?.meta as { reason: string }).reason).toBe("wrong scale used");
  });

  test("an empty reason is refused", async () => {
    seedMark({ rawMark: 70, recheckStatus: "PRESENT", recheckRawMark: 70 });
    await RS.tabulatePaper(PAPER, ACTOR);
    await expect(RS.reopenPaper(PAPER, "   ", ACTOR)).rejects.toThrow(/কারণ/);
  });

  test("re-opening a paper that was never tabulated is refused", async () => {
    await expect(RS.reopenPaper(PAPER, "why", ACTOR)).rejects.toThrow(/সংকলিতই নয়/);
  });
});
