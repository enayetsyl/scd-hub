/**
 * Exams EX-1 tests (docs/prd-exams.md §6, D-#375–#380).
 *   A. Pure validation — the composition guard (D-#376) and the grade-scale guard (D-#377).
 *   B. Conversion — nearest-0.5 rounding, checked against the real marks in the scans.
 *   C. The service — DB-free (Exam/ExamPaper/AcademicYear/Class + writeAudit mocked).
 *
 * The composition cases are the load-bearing ones: a per-class-band lookup would have
 * silently zeroed Class-3 Maths CT for sixteen students, so "1 and 2-component papers are
 * VALID" is asserted directly rather than left implied.
 */
interface Row { _id: { toString(): string }; [k: string]: unknown }
const mockExams: Row[] = [];
const mockPapers: Row[] = [];
const mockYears: Row[] = [];
const mockClasses: Row[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];

const idOf = (rv: unknown) =>
  rv && typeof rv === "object" ? (rv as { toString(): string }).toString() : rv;
const matches = (r: Row, q: Record<string, unknown>) =>
  Object.entries(q).every(([k, v]) => idOf(r[k]) === idOf(v));

function makeModel(store: Row[], prefix: string) {
  return {
    create: (doc: Record<string, unknown>) => {
      const seq = ++mockSeq;
      const row: Row = {
        ...doc,
        _id: { toString: () => `${prefix}-${seq}` },
        createdAt: new Date(Date.now() + seq),
        save: () => Promise.resolve(row),
      };
      store.push(row);
      return Promise.resolve(row);
    },
    find: (q: Record<string, unknown> = {}) => ({
      sort: () => Promise.resolve(store.filter((r) => matches(r, q))),
    }),
    findOne: (q: Record<string, unknown> = {}) =>
      Promise.resolve(store.find((r) => matches(r, q)) ?? null),
    findById: (id: string) => Promise.resolve(store.find((r) => r._id.toString() === id) ?? null),
    findByIdAndUpdate: (id: string, upd: { $set: Record<string, unknown> }) => {
      const row = store.find((r) => r._id.toString() === id);
      if (row) Object.assign(row, upd.$set);
      return Promise.resolve(row ?? null);
    },
  };
}

jest.mock("../modules/exams/models/Exam", () => ({ Exam: makeModel(mockExams, "ex") }));
jest.mock("../modules/exams/models/ExamPaper", () => ({ ExamPaper: makeModel(mockPapers, "pp") }));
jest.mock("../modules/foundation/models/AcademicYear", () => ({ AcademicYear: makeModel(mockYears, "ay") }));
jest.mock("../modules/foundation/models/Class", () => ({ Class: makeModel(mockClasses, "cl") }));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: Record<string, unknown>) => { mockAudits.push(p); return Promise.resolve(); },
}));

import * as ES from "../modules/exams/services/ExamService";
import { ExamError } from "../modules/exams/services/ExamService";
import { roundToHalf, convertMark, DEFAULT_GRADE_SCALE } from "@scd/shared";
import type { IGradeBand } from "../modules/exams/models/Exam";

/** A real 24-hex id — the service constructs an ObjectId from it, as production does. */
const ACTOR = "0000000000000000000000a1";
const scale = [...DEFAULT_GRADE_SCALE] as unknown as IGradeBand[];

// The three real shapes from the source documents (§5.2).
const NURSERY = [{ component: "FINAL" as const, maxMarks: 100 }];
const KG = [{ component: "ADAB" as const, maxMarks: 10 }, { component: "FINAL" as const, maxMarks: 90 }];
const STANDARD = [
  { component: "CT" as const, maxMarks: 10 },
  { component: "ADAB" as const, maxMarks: 10 },
  { component: "FINAL" as const, maxMarks: 80 },
];

beforeEach(() => {
  [mockExams, mockPapers, mockYears, mockClasses].forEach((s) => (s.length = 0));
  mockAudits.length = 0;
  mockSeq = 0;
  mockYears.push({ _id: { toString: () => "ay-1" }, label: "2026" });
  mockClasses.push({ _id: { toString: () => "cl-1" }, level: 3 });
});

// ===========================================================================
// A. Composition + grade scale
// ===========================================================================

describe("A. validateComponents — composition is PER PAPER (D-#376)", () => {
  test("the standard 3-component shape is valid", () => {
    expect(() => ES.validateComponents(STANDARD)).not.toThrow();
  });

  test("a 2-component KG / Class-3-Maths paper is VALID — no CT is a real shape, not an error", () => {
    expect(() => ES.validateComponents(KG)).not.toThrow();
  });

  test("a 1-component Nursery paper is VALID — components.length===1 is not a validation error (D-#376/§9.4)", () => {
    expect(() => ES.validateComponents(NURSERY)).not.toThrow();
  });

  test("components must sum to 100 — a short paper is refused", () => {
    expect(() => ES.validateComponents([{ component: "FINAL", maxMarks: 90 }])).toThrow(/যোগফল/);
  });

  test("components must sum to 100 — an over-weighted paper is refused", () => {
    expect(() =>
      ES.validateComponents([{ component: "ADAB", maxMarks: 20 }, { component: "FINAL", maxMarks: 90 }]),
    ).toThrow(/যোগফল/);
  });

  test("the same component twice is refused", () => {
    expect(() =>
      ES.validateComponents([{ component: "FINAL", maxMarks: 50 }, { component: "FINAL", maxMarks: 50 }]),
    ).toThrow(/দুইবার/);
  });

  test("an empty component list is refused", () => {
    expect(() => ES.validateComponents([])).toThrow();
  });
});

describe("A2. validateGradeScale (D-#377)", () => {
  test("the printed 2026 scale passes", () => {
    expect(() => ES.validateGradeScale(scale)).not.toThrow();
  });

  test("a gap in the bands is refused — some percentage would be ungradeable", () => {
    const gapped = scale.filter((b) => b.letter !== "B");
    expect(() => ES.validateGradeScale(gapped)).toThrow(/ফাঁক/);
  });

  test("a duplicated letter is refused", () => {
    expect(() => ES.validateGradeScale([...scale, scale[0]])).toThrow(/একাধিকবার/);
  });

  test("bandFor maps the printed boundaries — 80→A+, 79.99→A, 60→A-, 39→F", () => {
    expect(ES.bandFor(scale, 80).letter).toBe("A_PLUS");
    expect(ES.bandFor(scale, 79.99).letter).toBe("A");
    expect(ES.bandFor(scale, 60).letter).toBe("A_MINUS");
    expect(ES.bandFor(scale, 39).letter).toBe("F");
    expect(ES.bandFor(scale, 0).letter).toBe("F");
  });
});

// ===========================================================================
// B. Conversion — nearest 0.5 (D-#377a)
// ===========================================================================

describe("B. paper-scale conversion", () => {
  test("roundToHalf lands on halves and rounds the .25/.75 tie up", () => {
    expect(roundToHalf(43.24)).toBe(43);
    expect(roundToHalf(43.25)).toBe(43.5);
    expect(roundToHalf(43.74)).toBe(43.5);
    expect(roundToHalf(43.75)).toBe(44);
  });

  test("half marks from the scans survive the round trip (87.5 / 57.5 / 29.5)", () => {
    expect(convertMark(87.5, 100, 100)).toBe(87.5);
    expect(convertMark(57.5, 100, 100)).toBe(57.5);
    expect(convertMark(29.5, 100, 100)).toBe(29.5);
  });

  test("a 66/80 Arabic script scales onto a /90 FINAL component", () => {
    expect(convertMark(66, 80, 90)).toBe(74.5);
  });

  test("conversion is identity when the paper already matches the component scale", () => {
    expect(convertMark(57, 80, 80)).toBe(57);
  });

  test("a zero paperFullMarks throws instead of yielding Infinity", () => {
    expect(() => convertMark(10, 0, 80)).toThrow();
  });
});

// ===========================================================================
// C. Service
// ===========================================================================

describe("C. createExam", () => {
  test("seeds the printed grade scale and audits", async () => {
    const exam = await ES.createExam(
      { academicYearId: "ay-1", term: "HALF_YEARLY", name: "Half Yearly-Sylhet" },
      ACTOR,
    );
    expect(exam.gradeScale).toHaveLength(6);
    expect(exam.status).toBe("PLANNED");
    expect(exam.failRule).toBe("ANY_SUBJECT_F");
    expect(mockAudits.map((a) => a.eventKind)).toContain("EXAM_CREATED");
  });

  test("defaults CT aggregation to MEAN, and accepts BEST_N (both modes ship, D-#378)", async () => {
    const a = await ES.createExam({ academicYearId: "ay-1", term: "HALF_YEARLY", name: "A" }, ACTOR);
    expect(a.ctAggregation.mode).toBe("MEAN");
    const b = await ES.createExam(
      { academicYearId: "ay-1", term: "ANNUAL", name: "B", ctAggregationMode: "BEST_N", ctAggregationBestN: 3 },
      ACTOR,
    );
    expect(b.ctAggregation).toEqual({ mode: "BEST_N", bestN: 3 });
  });

  test("a duplicate (year, term, name) is refused", async () => {
    await ES.createExam({ academicYearId: "ay-1", term: "HALF_YEARLY", name: "Dup" }, ACTOR);
    await expect(
      ES.createExam({ academicYearId: "ay-1", term: "HALF_YEARLY", name: "Dup" }, ACTOR),
    ).rejects.toThrow(ExamError);
  });

  test("an ANNUAL exam is created beside a HALF_YEARLY without reading it — terms stand alone (D-#380)", async () => {
    const half = await ES.createExam({ academicYearId: "ay-1", term: "HALF_YEARLY", name: "H" }, ACTOR);
    const annual = await ES.createExam({ academicYearId: "ay-1", term: "ANNUAL", name: "A" }, ACTOR);
    expect(annual._id.toString()).not.toBe(half._id.toString());
    // No carry-forward field exists to populate — the shape itself enforces the ruling.
    expect(Object.keys(annual)).not.toContain("carryForwardFrom");
  });

  test("an unknown academic year is refused", async () => {
    await expect(
      ES.createExam({ academicYearId: "nope", term: "ANNUAL", name: "X" }, ACTOR),
    ).rejects.toThrow(ExamError);
  });
});

describe("C2. upsertExamPaper", () => {
  const mkExam = () => ES.createExam({ academicYearId: "ay-1", term: "HALF_YEARLY", name: "HY" }, ACTOR);

  test("creates a paper and audits the component split", async () => {
    const exam = await mkExam();
    const paper = await ES.upsertExamPaper(
      { examId: exam._id.toString(), classId: "cl-1", subject: "MATH", components: STANDARD, paperFullMarks: 80 },
      ACTOR,
    );
    expect(paper.components).toHaveLength(3);
    const audit = mockAudits.find((a) => a.eventKind === "EXAM_PAPER_UPSERTED");
    expect((audit?.meta as { components: string[] }).components).toEqual(["CT:10", "ADAB:10", "FINAL:80"]);
  });

  test("accepts a Class-3 Maths paper with NO CT component (D-#376, the real 2026 shape)", async () => {
    const exam = await mkExam();
    const paper = await ES.upsertExamPaper(
      { examId: exam._id.toString(), classId: "cl-1", subject: "MATH", components: KG, paperFullMarks: 100 },
      ACTOR,
    );
    expect(paper.components.map((c) => c.component)).toEqual(["ADAB", "FINAL"]);
  });

  test("a paper whose components do not sum to 100 is refused", async () => {
    const exam = await mkExam();
    await expect(
      ES.upsertExamPaper(
        {
          examId: exam._id.toString(), classId: "cl-1", subject: "BAN",
          components: [{ component: "FINAL", maxMarks: 70 }], paperFullMarks: 100,
        },
        ACTOR,
      ),
    ).rejects.toThrow(/যোগফল/);
  });

  test("re-shaping a TABULATED paper is refused — stored marks would be silently invalidated", async () => {
    const exam = await mkExam();
    const paper = await ES.upsertExamPaper(
      { examId: exam._id.toString(), classId: "cl-1", subject: "ENG", components: STANDARD, paperFullMarks: 100 },
      ACTOR,
    );
    (paper as unknown as Row).tabulatedAt = new Date();
    await expect(
      ES.upsertExamPaper(
        { examId: exam._id.toString(), classId: "cl-1", subject: "ENG", components: KG, paperFullMarks: 100 },
        ACTOR,
      ),
    ).rejects.toThrow(/সংকলিত/);
  });

  test("a zero paperFullMarks is refused", async () => {
    const exam = await mkExam();
    await expect(
      ES.upsertExamPaper(
        { examId: exam._id.toString(), classId: "cl-1", subject: "BAN", components: STANDARD, paperFullMarks: 0 },
        ACTOR,
      ),
    ).rejects.toThrow(ExamError);
  });
});

describe("C3. derived helpers", () => {
  test("componentMax returns NULL for an absent component, never 0 (the C3-Maths lesson)", () => {
    expect(ES.componentMax({ components: KG }, "CT")).toBeNull();
    expect(ES.componentMax({ components: KG }, "FINAL")).toBe(90);
    expect(ES.componentMax({ components: NURSERY }, "ADAB")).toBeNull();
  });

  test("effectiveCtAggregation: the paper override beats the exam setting (D-#378)", () => {
    const exam = { ctAggregation: { mode: "MEAN" as const, bestN: 3 } };
    expect(ES.effectiveCtAggregation(exam, {})).toEqual({ mode: "MEAN", bestN: 3 });
    expect(
      ES.effectiveCtAggregation(exam, { ctAggregationOverride: { mode: "BEST_N", bestN: 2 } }),
    ).toEqual({ mode: "BEST_N", bestN: 2 });
  });

  test("effectiveCtAggregation falls back to the default N when an override omits it", () => {
    const exam = { ctAggregation: { mode: "MEAN" as const } };
    expect(ES.effectiveCtAggregation(exam, { ctAggregationOverride: { mode: "BEST_N" } }).bestN).toBe(3);
  });
});
