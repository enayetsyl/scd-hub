/**
 * Exams EX-2 tests — duty assignment (docs/prd-exams.md §6, D-#375).
 *
 * The headline guard: one teacher cannot be both CHECKER and RECHECKER of the same paper.
 * A recheck by the original checker is not a recheck, and the source mark sheets already
 * name two distinct teachers per subject ("খাতা চেককারী" / "খাতা রিচেককারী").
 */
interface Row { _id: { toString(): string }; [k: string]: unknown }
const mockExams: Row[] = [];
const mockPapers: Row[] = [];
const mockAssignments: Row[] = [];
const mockUsers: Row[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];

const idOf = (rv: unknown) =>
  rv && typeof rv === "object" && !Array.isArray(rv)
    ? (rv as { toString(): string }).toString()
    : rv;

function matchVal(rv: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && "$in" in (cond as object)) {
    const list = (cond as { $in: unknown[] }).$in.map(idOf);
    return list.includes(idOf(rv));
  }
  return idOf(rv) === idOf(cond);
}
const matches = (r: Row, q: Record<string, unknown>) =>
  Object.entries(q).every(([k, v]) => matchVal(r[k], v));

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
    find: (q: Record<string, unknown> = {}) => {
      const hits = store.filter((r) => matches(r, q));
      const p = Promise.resolve(hits) as Promise<Row[]> & { sort: () => Promise<Row[]> };
      p.sort = () => Promise.resolve(hits);
      return p;
    },
    findOne: (q: Record<string, unknown> = {}) =>
      Promise.resolve(store.find((r) => matches(r, q)) ?? null),
    findById: (id: string) => Promise.resolve(store.find((r) => r._id.toString() === id) ?? null),
    deleteOne: (q: Record<string, unknown>) => {
      const i = store.findIndex((r) => matches(r, q));
      if (i >= 0) store.splice(i, 1);
      return Promise.resolve({ deletedCount: i >= 0 ? 1 : 0 });
    },
  };
}

jest.mock("../modules/exams/models/Exam", () => ({ Exam: makeModel(mockExams, "ex") }));
jest.mock("../modules/exams/models/ExamPaper", () => ({ ExamPaper: makeModel(mockPapers, "pp") }));
jest.mock("../modules/exams/models/ExamAssignment", () => ({ ExamAssignment: makeModel(mockAssignments, "as") }));
jest.mock("../modules/foundation/models/User", () => ({ User: makeModel(mockUsers, "us") }));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: Record<string, unknown>) => { mockAudits.push(p); return Promise.resolve(); },
}));

import * as AS from "../modules/exams/services/ExamAssignmentService";
import { ExamError } from "../modules/exams/services/ExamService";

const ACTOR = "0000000000000000000000a1";
const TEACHER_A = "0000000000000000000000b1";
const TEACHER_B = "0000000000000000000000b2";
const PAPER = "0000000000000000000000c1";
const PAPER_2 = "0000000000000000000000c2";
const EXAM = "0000000000000000000000d1";

beforeEach(() => {
  [mockExams, mockPapers, mockAssignments, mockUsers].forEach((s) => (s.length = 0));
  mockAudits.length = 0;
  mockSeq = 0;
  mockExams.push({ _id: { toString: () => EXAM } });
  mockPapers.push({ _id: { toString: () => PAPER }, examId: { toString: () => EXAM }, subject: "MATH" });
  mockPapers.push({ _id: { toString: () => PAPER_2 }, examId: { toString: () => EXAM }, subject: "ENG" });
  mockUsers.push({ _id: { toString: () => TEACHER_A }, name: "Teacher A" });
  mockUsers.push({ _id: { toString: () => TEACHER_B }, name: "Teacher B" });
});

describe("assignExamDuty", () => {
  test("assigns a checker to a paper and audits it", async () => {
    const row = await AS.assignExamDuty(
      { examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "CHECKER" },
      ACTOR,
    );
    expect(row.role).toBe("CHECKER");
    expect(mockAudits.map((a) => a.eventKind)).toContain("EXAM_DUTY_ASSIGNED");
  });

  test("REFUSES the same teacher as both CHECKER and RECHECKER of one paper", async () => {
    await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "CHECKER" }, ACTOR);
    await expect(
      AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "RECHECKER" }, ACTOR),
    ).rejects.toThrow(/চেককারী ও রিচেককারী/);
  });

  test("refuses the reverse order too — rechecker first, then checker", async () => {
    await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "RECHECKER" }, ACTOR);
    await expect(
      AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "CHECKER" }, ACTOR),
    ).rejects.toThrow(ExamError);
  });

  test("refuses the same person as both TABULATOR and MARK_RECHECKER", async () => {
    await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "TABULATOR" }, ACTOR);
    await expect(
      AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "MARK_RECHECKER" }, ACTOR),
    ).rejects.toThrow(ExamError);
  });

  test("ALLOWS two DIFFERENT teachers as checker and rechecker — the normal case", async () => {
    await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "CHECKER" }, ACTOR);
    const r = await AS.assignExamDuty(
      { examId: EXAM, paperId: PAPER, userId: TEACHER_B, role: "RECHECKER" },
      ACTOR,
    );
    expect(r.role).toBe("RECHECKER");
  });

  test("ALLOWS one teacher to check paper 1 and recheck a DIFFERENT paper", async () => {
    await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "CHECKER" }, ACTOR);
    const r = await AS.assignExamDuty(
      { examId: EXAM, paperId: PAPER_2, userId: TEACHER_A, role: "RECHECKER" },
      ACTOR,
    );
    expect(r.paperId?.toString()).toBe(PAPER_2);
  });

  test("re-assigning the identical duty is idempotent, not an error", async () => {
    const a = await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "CHECKER" }, ACTOR);
    const b = await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "CHECKER" }, ACTOR);
    expect(b._id.toString()).toBe(a._id.toString());
    expect(mockAssignments).toHaveLength(1);
  });

  test("INVIGILATOR is exam-wide — no paperId required", async () => {
    const row = await AS.assignExamDuty({ examId: EXAM, userId: TEACHER_A, role: "INVIGILATOR" }, ACTOR);
    expect(row.paperId).toBeUndefined();
  });

  test("a paper-scoped role WITHOUT a paperId is refused", async () => {
    await expect(
      AS.assignExamDuty({ examId: EXAM, userId: TEACHER_A, role: "CHECKER" }, ACTOR),
    ).rejects.toThrow(/বিষয়পত্র নির্দিষ্ট/);
  });

  test("a paper belonging to a different exam is refused", async () => {
    mockExams.push({ _id: { toString: () => "other-exam" } });
    await expect(
      AS.assignExamDuty({ examId: "other-exam", paperId: PAPER, userId: TEACHER_A, role: "CHECKER" }, ACTOR),
    ).rejects.toThrow(/এই পরীক্ষার নয়/);
  });

  test("an unknown user is refused", async () => {
    await expect(
      AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: "ghost", role: "CHECKER" }, ACTOR),
    ).rejects.toThrow(ExamError);
  });
});

describe("assertAssignedTo — the gate EX-3/EX-4 rely on", () => {
  test("passes for the assigned role and refuses everyone else", async () => {
    await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "CHECKER" }, ACTOR);

    await expect(AS.assertAssignedTo(PAPER, TEACHER_A, ["CHECKER"])).resolves.toBeUndefined();
    // Assigned, but not in THAT role.
    await expect(AS.assertAssignedTo(PAPER, TEACHER_A, ["RECHECKER"])).rejects.toThrow(/দায়িত্ব নেই/);
    // Not assigned at all — a teacher with exam:mark still gets nothing without a row.
    await expect(AS.assertAssignedTo(PAPER, TEACHER_B, ["CHECKER"])).rejects.toThrow(/দায়িত্ব নেই/);
  });

  test("isAssignedTo is false for a paper the teacher holds no row on", async () => {
    await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "CHECKER" }, ACTOR);
    expect(await AS.isAssignedTo(PAPER_2, TEACHER_A, ["CHECKER"])).toBe(false);
  });
});

describe("revokeExamDuty + reads", () => {
  test("revoking removes the row and audits", async () => {
    const row = await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "CHECKER" }, ACTOR);
    await AS.revokeExamDuty(row._id.toString(), ACTOR);
    expect(mockAssignments).toHaveLength(0);
    expect(mockAudits.map((a) => a.eventKind)).toContain("EXAM_DUTY_REVOKED");
  });

  test("myExamDuties returns only that teacher's rows", async () => {
    await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_A, role: "CHECKER" }, ACTOR);
    await AS.assignExamDuty({ examId: EXAM, paperId: PAPER, userId: TEACHER_B, role: "RECHECKER" }, ACTOR);
    const mine = await AS.myExamDuties(TEACHER_A);
    expect(mine).toHaveLength(1);
    expect(mine[0].userId.toString()).toBe(TEACHER_A);
  });
});
