/**
 * Class Test Tracker CT-4 tests (prd-tracker-class-test §6/§9, J5/J6, D-#44/#85).
 *
 * Pure       — reportStateOf (complete>overdue>in_progress>not_started partition) +
 *              trendOf (↑/↓/→ = up/down/flat, one data point ⇒ flat, §9).
 * Reports    — reportsStatus decorates each exam with state (reuses examReportStatus,
 *              which is MOCKED here so the deadline/overdue machinery isn't re-tested).
 * Dashboard  — principalDashboard tallies the 4-way KPI partition + completion rate +
 *              overdue-by-teacher (grouped, names joined, sorted desc).
 * Analysis   — classSubjectAnalysis builds per-student PRESENT-percent series + trend;
 *              ABSENT excluded (§4); derived percent (deriveScore, real).
 * Profile    — studentProfile lists results (newest first) + per-subject avg/trend.
 * Chase      — overdueChaseList groups overdue exams by teacher, renders the wa.me
 *              nudge from the MT registry (byte-check), wa.me link / unreachable.
 *
 * DB-free: models + examReportStatus are mocked; deriveScore + the MT renderer run for
 * real (code-default registry, no DB).
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

// examReportStatus is the reused CT-2 dependency — mock it so CT-4 logic is isolated.
const mockExamReportStatus = jest.fn();
jest.mock("../modules/trackers/services/ClassTestResultService", () => ({
  examReportStatus: (testId: string, now: Date) => mockExamReportStatus(testId, now),
}));

const mockCtFind = jest.fn();
jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: { find: (q: unknown) => mockCtFind(q) },
}));

const mockResFind = jest.fn();
// D-#339: reportsStatus batches newest result submittedAt per exam.
const mockResAggregate = jest.fn();
jest.mock("../modules/trackers/models/ClassTestResult", () => ({
  ClassTestResult: {
    find: (q: unknown) => mockResFind(q),
    aggregate: (p: unknown) => mockResAggregate(p),
  },
}));

const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => mockStudentFind(q) },
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => mockUserFind(q) },
}));

// D-#373: the chase message names class + SECTION per overdue exam, so the section
// names are batch-loaded. Mocked here like every other model in this DB-free suite.
const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (q: unknown) => mockSectionFind(q) },
}));

// Import AFTER mocks
import {
  reportStateOf,
  trendOf,
  reportsStatus,
  principalDashboard,
  classSubjectAnalysis,
  studentProfile,
  overdueChaseList,
} from "../modules/trackers/services/ClassTestSummaryService";
import { interpolate } from "../modules/templates/services/MessageTemplateService";
import { MESSAGE_TEMPLATE_REGISTRY } from "@scd/shared";

const NOW = new Date(2026, 6, 20);

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentFind.mockReturnValue(leanChain([]));
  mockUserFind.mockReturnValue(leanChain([]));
  mockResAggregate.mockResolvedValue([]);
  // D-#373: one section on file for the chase lines (the fixture's SECTION).
  mockSectionFind.mockReturnValue(leanChain([{ _id: SECTION, nameBn: "মূল", code: "A" }]));
});

// ===========================================================================
// Pure helpers
// ===========================================================================

describe("reportStateOf (4-way partition)", () => {
  test("complete > overdue > in_progress > not_started", () => {
    expect(reportStateOf({ complete: true, overdue: true, enteredCount: 5 })).toBe("complete");
    expect(reportStateOf({ complete: false, overdue: true, enteredCount: 0 })).toBe("overdue");
    expect(reportStateOf({ complete: false, overdue: true, enteredCount: 3 })).toBe("overdue");
    expect(reportStateOf({ complete: false, overdue: false, enteredCount: 3 })).toBe("in_progress");
    expect(reportStateOf({ complete: false, overdue: false, enteredCount: 0 })).toBe("not_started");
  });
});

describe("trendOf (§9)", () => {
  test("up / down / flat; one data point (previous null) is flat", () => {
    expect(trendOf(80, 60)).toBe("up");
    expect(trendOf(50, 75)).toBe("down");
    expect(trendOf(70, 70)).toBe("flat");
    expect(trendOf(90, null)).toBe("flat");
    expect(trendOf(null, null)).toBe("flat");
  });
});

// ===========================================================================
// Fixtures for the aggregate tests
// ===========================================================================

const SECTION = oid();
const T_A = oid(); // teacher A
const T_B = oid(); // teacher B

const exam = (over: Record<string, unknown> = {}) => ({
  _id: oid(),
  ctId: "CT-C3-MATH-0001",
  sectionId: SECTION,
  subject: "MATH",
  testNumber: 1,
  classLevel: 3,
  examDate: new Date(2026, 6, 10),
  totalMarks: 20,
  passMark: 8,
  deadlineDays: 2,
  status: "PRINTED",
  requestedBy: T_A,
  ...over,
});

/** A stub ExamReportStatus (only the fields CT-4 reads). */
const status = (testId: string, over: Record<string, unknown> = {}) => ({
  testId,
  ctId: "CT-C3-MATH-0001",
  examDate: new Date(2026, 6, 10).toISOString(),
  deadline: new Date(2026, 6, 13).toISOString(),
  deadlineDays: 2,
  rosterCount: 10,
  enteredCount: 0,
  presentCount: 0,
  absentCount: 0,
  pendingCount: 10,
  complete: false,
  overdue: false,
  schoolDaysLate: 0,
  ...over,
});

// ===========================================================================
// reportsStatus + principalDashboard
// ===========================================================================

describe("reportsStatus / principalDashboard", () => {
  test("reportsStatus decorates each exam with its derived state", async () => {
    const e1 = exam({ _id: oid(), testNumber: 1 });
    const e2 = exam({ _id: oid(), testNumber: 2 });
    mockCtFind.mockReturnValue(leanChain([e1, e2]));
    mockExamReportStatus
      .mockResolvedValueOnce(status(e1._id.toString(), { complete: true, enteredCount: 10 }))
      .mockResolvedValueOnce(status(e2._id.toString(), { overdue: true, enteredCount: 4, schoolDaysLate: 2 }));
    // D-#339: row enrichment — author name + newest result submittedAt.
    mockUserFind.mockReturnValue(leanChain([{ _id: T_A, name: "Teacher A" }]));
    mockResAggregate.mockResolvedValue([{ _id: e1._id, latest: new Date(2026, 6, 12) }]);

    const rows = await reportsStatus({ asOf: NOW });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ testNumber: 1, state: "complete", subject: "MATH", teacherId: T_A.toString() });
    expect(rows[1]).toMatchObject({ testNumber: 2, state: "overdue", schoolDaysLate: 2 });
    expect(rows[0].teacherName).toBe("Teacher A");
    expect(rows[0].submittedAt).toBe(new Date(2026, 6, 12).toISOString());
    expect(rows[1].submittedAt).toBeNull();
    // examReportStatus reused with the injected now (deterministic)
    expect(mockExamReportStatus).toHaveBeenCalledWith(e1._id.toString(), NOW);
  });

  test("principalDashboard tallies the KPI partition + completion rate + overdue-by-teacher", async () => {
    const eDone = exam({ _id: oid(), requestedBy: T_A });
    const eOverA = exam({ _id: oid(), requestedBy: T_A });
    const eOverB = exam({ _id: oid(), requestedBy: T_B });
    const eProg = exam({ _id: oid(), requestedBy: T_B });
    const eNot = exam({ _id: oid(), requestedBy: T_B });
    mockCtFind.mockReturnValue(leanChain([eDone, eOverA, eOverB, eProg, eNot]));
    mockExamReportStatus
      .mockResolvedValueOnce(status(eDone._id.toString(), { complete: true, enteredCount: 10 }))
      .mockResolvedValueOnce(status(eOverA._id.toString(), { overdue: true, enteredCount: 1 }))
      .mockResolvedValueOnce(status(eOverB._id.toString(), { overdue: true, enteredCount: 0 }))
      .mockResolvedValueOnce(status(eProg._id.toString(), { enteredCount: 5 }))
      .mockResolvedValueOnce(status(eNot._id.toString(), { enteredCount: 0 }));
    mockUserFind.mockReturnValue(leanChain([
      { _id: T_A, name: "Ustadh A" },
      { _id: T_B, name: "Ustadh B" },
    ]));

    const d = await principalDashboard({ asOf: NOW });
    expect(d).toMatchObject({ logged: 5, complete: 1, overdue: 2, inProgress: 1, notStarted: 1, completionRatePct: 20 });
    // overdue-by-teacher: B has 1, A has 1 → sorted desc (tie keeps both)
    expect(d.overdueByTeacher).toHaveLength(2);
    expect(d.overdueByTeacher.map((r) => r.overdueCount)).toEqual([1, 1]);
    expect(d.overdueByTeacher.map((r) => r.teacherName).sort()).toEqual(["Ustadh A", "Ustadh B"]);
  });

  test("completionRatePct is null when nothing is logged", async () => {
    mockCtFind.mockReturnValue(leanChain([]));
    const d = await principalDashboard({ asOf: NOW });
    expect(d).toMatchObject({ logged: 0, completionRatePct: null, overdueByTeacher: [] });
  });
});

// ===========================================================================
// classSubjectAnalysis (trend, ABSENT excluded)
// ===========================================================================

describe("classSubjectAnalysis", () => {
  test("builds per-student PRESENT-percent series + trend; ABSENT excluded (§4)", async () => {
    const e1 = exam({ _id: oid(), testNumber: 1, examDate: new Date(2026, 6, 1), totalMarks: 20, passMark: 8 });
    const e2 = exam({ _id: oid(), testNumber: 2, examDate: new Date(2026, 6, 8), totalMarks: 20, passMark: 8 });
    const sX = oid();
    const sY = oid();
    mockCtFind.mockReturnValue(leanChain([e1, e2])); // sorted asc by date
    mockResFind.mockReturnValue(leanChain([
      { testId: e1._id, studentId: sX, status: "PRESENT", marks: 10 }, // 50%
      { testId: e2._id, studentId: sX, status: "PRESENT", marks: 16 }, // 80% → up
      { testId: e1._id, studentId: sY, status: "PRESENT", marks: 18 }, // 90%
      { testId: e2._id, studentId: sY, status: "ABSENT" },             // excluded
    ]));
    mockStudentFind.mockReturnValue(leanChain([
      { _id: sX, nameBn: "করিম" },
      { _id: sY, nameBn: "রহিম" },
    ]));

    const a = await classSubjectAnalysis(SECTION.toString(), "MATH");
    expect(a.examCount).toBe(2);
    const x = a.students.find((s) => s.studentId === sX.toString())!;
    expect(x.percents).toEqual([50, 80]);
    expect(x).toMatchObject({ latestPercent: 80, previousPercent: 50, trend: "up", examsTaken: 2 });
    const y = a.students.find((s) => s.studentId === sY.toString())!;
    expect(y.percents).toEqual([90]); // ABSENT not counted
    expect(y).toMatchObject({ latestPercent: 90, previousPercent: null, trend: "flat", examsTaken: 1 });
  });

  test("empty when the section×subject has no printed exams", async () => {
    mockCtFind.mockReturnValue(leanChain([]));
    const a = await classSubjectAnalysis(SECTION.toString(), "ENG");
    expect(a).toMatchObject({ examCount: 0, students: [] });
  });
});

// ===========================================================================
// studentProfile
// ===========================================================================

describe("studentProfile", () => {
  test("lists results newest-first + per-subject avg/latest/trend", async () => {
    const sId = oid();
    const mathE1 = exam({ _id: oid(), subject: "MATH", testNumber: 1, examDate: new Date(2026, 6, 1), totalMarks: 20, passMark: 8 });
    const mathE2 = exam({ _id: oid(), subject: "MATH", testNumber: 2, examDate: new Date(2026, 6, 8), totalMarks: 20, passMark: 8 });
    const engE1 = exam({ _id: oid(), subject: "ENG", testNumber: 1, examDate: new Date(2026, 6, 5), totalMarks: 50, passMark: 20 });
    mockResFind.mockReturnValue(leanChain([
      { testId: mathE1._id, studentId: sId, status: "PRESENT", marks: 10 }, // 50%
      { testId: mathE2._id, studentId: sId, status: "PRESENT", marks: 18 }, // 90%
      { testId: engE1._id, studentId: sId, status: "PRESENT", marks: 25 },  // 50%
    ]));
    mockCtFind.mockReturnValue(leanChain([mathE1, mathE2, engE1]));
    mockStudentFind.mockReturnValue(leanChain([{ _id: sId, nameBn: "করিম" }]));

    const p = await studentProfile(sId.toString());
    expect(p.studentName).toBe("করিম");
    expect(p.results).toHaveLength(3);
    expect(p.results[0].examDate >= p.results[1].examDate).toBe(true); // newest first
    const math = p.bySubject.find((s) => s.subject === "MATH")!;
    expect(math).toMatchObject({ examsTaken: 2, avgPercent: 70, latestPercent: 90, previousPercent: 50, trend: "up" });
    const eng = p.bySubject.find((s) => s.subject === "ENG")!;
    expect(eng).toMatchObject({ examsTaken: 1, avgPercent: 50, trend: "flat" });
  });

  test("empty profile when the student has no results", async () => {
    mockResFind.mockReturnValue(leanChain([]));
    mockStudentFind.mockReturnValue(leanChain([{ _id: oid(), nameBn: "করিম" }]));
    const p = await studentProfile(oid().toString());
    expect(p).toMatchObject({ results: [], bySubject: [] });
  });
});

// ===========================================================================
// overdueChaseList (J6) — wa.me nudge rendered from the MT registry
// ===========================================================================

describe("overdueChaseList", () => {
  test("groups overdue exams by teacher, renders the wa.me nudge from the registry default", async () => {
    const e1 = exam({ _id: oid(), testNumber: 1, requestedBy: T_A });
    const e2 = exam({ _id: oid(), testNumber: 2, requestedBy: T_A });
    const e3 = exam({ _id: oid(), testNumber: 1, subject: "ENG", requestedBy: T_B });
    mockCtFind.mockReturnValue(leanChain([e1, e2, e3]));
    mockExamReportStatus
      .mockResolvedValueOnce(status(e1._id.toString(), { overdue: true, enteredCount: 0, pendingCount: 10, schoolDaysLate: 3 }))
      .mockResolvedValueOnce(status(e2._id.toString(), { overdue: true, enteredCount: 2, pendingCount: 8, schoolDaysLate: 1 }))
      .mockResolvedValueOnce(status(e3._id.toString(), { complete: true, enteredCount: 10 })); // not overdue
    mockUserFind.mockReturnValue(leanChain([{ _id: T_A, name: "Ustadh A", phone: "01711000000" }]));

    const list = await overdueChaseList({ asOf: NOW });
    expect(list.entries).toHaveLength(1); // only teacher A has overdue
    const entry = list.entries[0];
    expect(entry).toMatchObject({ teacherId: T_A.toString(), teacherName: "Ustadh A", overdueCount: 2, unreachableByWa: false });
    expect(entry.exams).toHaveLength(2);

    // message is the registry default interpolated (byte-check). D-#373: each exam is
    // its OWN numbered line carrying class+section, subject, test, date, how many
    // students are still missing, how late it is, and the CT id — the old comma-joined
    // "subject টেস্ট n (dd/mm)" named neither of two same-subject same-date exams.
    const examList =
      "১) তৃতীয় শ্রেণি (মূল) · গণিত · টেস্ট ১ · পরীক্ষা ১০/০৭ — ১০/১০ জনের ফলাফল বাকি · ৩ কর্মদিবস দেরি [CT-C3-MATH-0001]\n" +
      "২) তৃতীয় শ্রেণি (মূল) · গণিত · টেস্ট ২ · পরীক্ষা ১০/০৭ — ৮/১০ জনের ফলাফল বাকি · ১ কর্মদিবস দেরি [CT-C3-MATH-0001]";
    const expected = interpolate(MESSAGE_TEMPLATE_REGISTRY["class_test.overdue_chase.wa"].bnDefault, {
      TeacherName: "Ustadh A",
      Count: "২",
      ExamList: examList,
    });
    expect(entry.messageBn).toBe(expected);
    expect(entry.messageBn).toContain("আসসালামু আলাইকুম Ustadh A");
    // The whole point: the two exams are distinguishable on their own lines.
    expect(entry.messageBn).toContain("টেস্ট ১");
    expect(entry.messageBn).toContain("টেস্ট ২");
    expect(entry.messageBn).toContain("তৃতীয় শ্রেণি (মূল)");
    expect(entry.waLink).toMatch(/^https:\/\/wa\.me\/01711000000\?text=/);
    expect(list.unreachableCount).toBe(0);
  });

  test("a teacher with no phone is unreachable-by-wa (link null)", async () => {
    const e1 = exam({ _id: oid(), requestedBy: T_B });
    mockCtFind.mockReturnValue(leanChain([e1]));
    mockExamReportStatus.mockResolvedValueOnce(status(e1._id.toString(), { overdue: true, enteredCount: 1 }));
    mockUserFind.mockReturnValue(leanChain([{ _id: T_B, name: "Ustadh B" }])); // no phone

    const list = await overdueChaseList({ asOf: NOW });
    expect(list.entries[0].waLink).toBeNull();
    expect(list.entries[0].unreachableByWa).toBe(true);
    expect(list.unreachableCount).toBe(1);
  });

  test("empty chase list when nothing is overdue", async () => {
    const e1 = exam({ _id: oid() });
    mockCtFind.mockReturnValue(leanChain([e1]));
    mockExamReportStatus.mockResolvedValueOnce(status(e1._id.toString(), { complete: true, enteredCount: 10 }));
    const list = await overdueChaseList({ asOf: NOW });
    expect(list.entries).toEqual([]);
    expect(list.unreachableCount).toBe(0);
  });
});
