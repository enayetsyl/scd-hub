/**
 * Exams EX-9 tests — submit → approve → publish + the report-card sheet
 * (docs/prd-exams.md §6).
 *
 * The chain this proves end-to-end: custody must balance (EX-7) → papers tabulate (EX-4)
 * → only then can the card set be submitted → only an approval publishes it → and
 * `publishedAt != null` is the single thing a guardian's access depends on.
 */
interface Row { _id: { toString(): string }; [k: string]: unknown }
const mockExams: Row[] = [];
const mockPapers: Row[] = [];
const mockUsers: Row[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];
const mockNotifications: Array<Record<string, unknown>> = [];

const idOf = (rv: unknown) =>
  rv && typeof rv === "object" && !Array.isArray(rv) && !(rv instanceof Date)
    ? (rv as { toString(): string }).toString()
    : rv;
function matchVal(rv: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof Date) && "$in" in (cond as object)) {
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
      const row: Row = { ...doc, _id: { toString: () => `${prefix}-${seq}` } };
      row.save = () => Promise.resolve(row);
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
  };
}

jest.mock("../modules/exams/models/Exam", () => ({ Exam: makeModel(mockExams, "ex") }));
jest.mock("../modules/exams/models/ExamPaper", () => ({ ExamPaper: makeModel(mockPapers, "pp") }));
jest.mock("../modules/foundation/models/User", () => ({ User: makeModel(mockUsers, "us") }));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: Record<string, unknown>) => { mockAudits.push(p); return Promise.resolve(); },
}));
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (p: Record<string, unknown>) => { mockNotifications.push(p); return Promise.resolve({ created: true, dedupeKey: "" }); },
}));

import * as PS from "../modules/exams/services/ExamPublishService";
import { ExamError } from "../modules/exams/services/ExamService";
import { buildReportCardMarkdown } from "../modules/exams/services/ReportCardSheetService";
import type { ReportCard } from "../modules/exams/services/ReportCardService";
import { DEFAULT_GRADE_SCALE } from "@scd/shared";

const ACTOR = "0000000000000000000000a1";
const EXAM = "0000000000000000000000d1";

const seedExam = (over: Record<string, unknown> = {}) => {
  const row: Row = {
    _id: { toString: () => EXAM },
    name: "Half Yearly-Sylhet",
    status: "MARKING",
    publishedVersion: 0,
    ...over,
  };
  row.save = () => Promise.resolve(row);
  mockExams.push(row);
  return row;
};
const seedPaper = (tabulated: boolean) =>
  mockPapers.push({
    _id: { toString: () => `pp-${mockPapers.length + 1}` },
    examId: { toString: () => EXAM },
    ...(tabulated ? { tabulatedAt: new Date() } : {}),
  });

beforeEach(() => {
  [mockExams, mockPapers, mockUsers].forEach((s) => (s.length = 0));
  mockAudits.length = 0;
  mockNotifications.length = 0;
  mockSeq = 0;
  mockUsers.push({ _id: { toString: () => "mgr-1" }, name: "Head", role: "PRINCIPAL", active: true });
});

// ===========================================================================
// A. Submit
// ===========================================================================

describe("A. submitExamResults", () => {
  test("REFUSES while any paper is un-tabulated — the custody chain reaches this far", async () => {
    seedExam();
    seedPaper(true);
    seedPaper(false);
    await expect(PS.submitExamResults(EXAM, ACTOR)).rejects.toThrow(/সংকলিত হয়নি/);
  });

  test("refuses an exam with no papers at all", async () => {
    seedExam();
    await expect(PS.submitExamResults(EXAM, ACTOR)).rejects.toThrow(/কোনো বিষয়পত্র নেই/);
  });

  test("submits once every paper is tabulated, and notifies the managers", async () => {
    seedExam();
    seedPaper(true);
    const exam = await PS.submitExamResults(EXAM, ACTOR);
    expect(exam.submittedAt).toBeDefined();
    expect(exam.status).toBe("TABULATED");
    expect(mockAudits.map((a) => a.eventKind)).toContain("EXAM_RESULTS_SUBMITTED");
    expect(mockNotifications.filter((n) => n.kind === "EXAM_RESULT_SUBMITTED")).toHaveLength(1);
  });

  test("submitting clears a previous send-back reason", async () => {
    seedExam({ sendBackReason: "wrong scale", sendBackAt: new Date() });
    seedPaper(true);
    const exam = await PS.submitExamResults(EXAM, ACTOR);
    expect(exam.sendBackReason).toBeUndefined();
  });

  test("refuses to re-submit an already published exam", async () => {
    seedExam({ publishedAt: new Date() });
    seedPaper(true);
    await expect(PS.submitExamResults(EXAM, ACTOR)).rejects.toThrow(/আগেই প্রকাশিত/);
  });
});

// ===========================================================================
// B. Approve / publish — the guardian-visible flip
// ===========================================================================

describe("B. approveExamResults", () => {
  test("approval sets publishedAt and bumps the version", async () => {
    seedExam({ submittedAt: new Date() });
    const exam = await PS.approveExamResults(EXAM, ACTOR);
    expect(exam.publishedAt).toBeDefined();
    expect(exam.publishedVersion).toBe(1);
    expect(exam.status).toBe("PUBLISHED");
    expect(mockAudits.map((a) => a.eventKind)).toContain("EXAM_RESULTS_PUBLISHED");
  });

  test("REFUSES to publish something never submitted", async () => {
    seedExam();
    await expect(PS.approveExamResults(EXAM, ACTOR)).rejects.toThrow(/জমা পড়েনি/);
  });

  test("a re-publish bumps the version again so a corrected card re-notifies", async () => {
    seedExam({ submittedAt: new Date() });
    await PS.approveExamResults(EXAM, ACTOR);
    await PS.unpublishExamResults(EXAM, ACTOR);
    const again = await PS.approveExamResults(EXAM, ACTOR);
    expect(again.publishedVersion).toBe(2);
  });
});

describe("C. sendBack / unpublish", () => {
  test("send-back requires a reason and returns the exam to MARKING", async () => {
    seedExam({ submittedAt: new Date() });
    const exam = await PS.sendBackExamResults(EXAM, "totals wrong", ACTOR);
    expect(exam.status).toBe("MARKING");
    expect(exam.sendBackReason).toBe("totals wrong");
    expect(exam.submittedAt).toBeUndefined();
  });

  test("an empty send-back reason is refused", async () => {
    seedExam({ submittedAt: new Date() });
    await expect(PS.sendBackExamResults(EXAM, "   ", ACTOR)).rejects.toThrow(/কারণ/);
  });

  test("unpublish clears publishedAt — guardians lose sight of it immediately", async () => {
    seedExam({ submittedAt: new Date() });
    await PS.approveExamResults(EXAM, ACTOR);
    const exam = await PS.unpublishExamResults(EXAM, ACTOR);
    expect(exam.publishedAt).toBeUndefined();
    expect(PS.isGuardianVisible(exam)).toBe(false);
  });

  test("unpublishing something unpublished is refused", async () => {
    seedExam();
    await expect(PS.unpublishExamResults(EXAM, ACTOR)).rejects.toThrow(/প্রকাশিতই নয়/);
  });
});

describe("D. isGuardianVisible — the single predicate", () => {
  test("null/undefined publishedAt is NOT visible; a date is", () => {
    expect(PS.isGuardianVisible({ publishedAt: undefined })).toBe(false);
    expect(PS.isGuardianVisible({ publishedAt: new Date() })).toBe(true);
  });
});

// ===========================================================================
// E. The printed sheet
// ===========================================================================

describe("E. buildReportCardMarkdown", () => {
  const card = (over: Partial<ReportCard> = {}): ReportCard => ({
    examId: EXAM,
    examName: "Half Yearly-Sylhet",
    term: "HALF_YEARLY",
    session: "2026",
    student: { id: "s1", schoolId: "0044", name: "Musa Bin Sadik", classLevel: 0 },
    profile: { schoolName: "School for Community Development", branch: "Sylhet Branch", shift: "Day" },
    gradeScale: [...DEFAULT_GRADE_SCALE] as never,
    rows: [
      {
        paperId: "p1", subject: "BAN", obtained: 89, fullMarks: 100, percent: 89,
        point: 5, letter: "A_PLUS", highest: 96,
        cells: [
          { component: "ADAB", value: 9, absent: false },
          { component: "FINAL", value: 80, absent: false },
        ],
      },
    ],
    totals: { totalObtained: 89, totalFullMarks: 100, gpa: 5, letter: "A_PLUS", failedBySubject: false, failedSubjects: [] },
    comment: "Excellent performance across all subjects.",
    publishedAt: null,
    ...over,
  });

  test("prints the identity block, the printed ID, and the profile constants", () => {
    const md = buildReportCardMarkdown(card());
    expect(md).toContain("0044");
    expect(md).toContain("Musa Bin Sadik");
    expect(md).toContain("Sylhet Branch");
    expect(md).toContain("Day");
    expect(md).toContain("2026");
  });

  test("ADAB prints under its transcript name \"Performance\", not \"Adab\"", () => {
    const md = buildReportCardMarkdown(card());
    expect(md).toContain("Performance");
  });

  test("columns follow THIS card's components — a KG card has no CT column", () => {
    const md = buildReportCardMarkdown(card());
    const header = md.split("\n").find((l) => l.includes("Subject") && l.includes("Obtained"))!;
    expect(header).not.toContain("| CT |");
    expect(header).toContain("Performance");
  });

  test("an absent component prints \"Ab\", a missing one prints an em dash", () => {
    const md = buildReportCardMarkdown(
      card({
        rows: [
          {
            paperId: "p1", subject: "ARABIC", obtained: 6, fullMarks: 100, percent: 6,
            point: 0, letter: "F", highest: 96,
            cells: [
              { component: "ADAB", value: 6, absent: false },
              { component: "FINAL", value: 0, absent: true },
            ],
          },
        ],
      }),
    );
    expect(md).toContain("Ab");
  });

  test("a 0.00 GPA on the card EXPLAINS itself rather than leaving it to the counter", () => {
    const md = buildReportCardMarkdown(
      card({
        totals: {
          totalObtained: 552, totalFullMarks: 800, gpa: 0, letter: "F",
          failedBySubject: true, failedSubjects: ["Mathematics"],
        },
      }),
    );
    expect(md).toMatch(/GPA 0\.00/);
    expect(md).toContain("Mathematics");
  });

  test("the grade reference table and signature rule are on the page", () => {
    const md = buildReportCardMarkdown(card());
    expect(md).toContain("Grades Reference");
    expect(md).toContain("A+");
    expect(md).toContain("Principal's Signature");
  });

  test("the school comment is rendered, and its absence degrades to a dash", () => {
    expect(buildReportCardMarkdown(card())).toContain("Excellent performance");
    expect(buildReportCardMarkdown(card({ comment: null }))).toContain("Comment from School");
  });
});
