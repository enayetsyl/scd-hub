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
// `deriveReportOwnership` (D-#603) is a PURE helper from the same module and is kept
// REAL: stubbing it would let the ownership split drift between the two call sites,
// which is the exact divergence extracting it was meant to prevent.
const mockExamReportStatus = jest.fn();
jest.mock("../modules/trackers/services/ClassTestResultService", () => ({
  ...jest.requireActual("../modules/trackers/services/ClassTestResultService"),
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
const mockStudentAggregate = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: {
    find: (q: unknown) => mockStudentFind(q),
    // Roster counts are batched per section now (perf fix 2026-08-16).
    aggregate: (p: unknown) => mockStudentAggregate(p),
  },
}));

// The calendar is built ONCE per request from the holiday table (perf fix
// 2026-08-16) instead of `examReportStatus` doing one query per day per exam.
// Empty here ⇒ the pure Sun–Thu week rule, which is what these fixtures assume.
jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
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
  overdueCounts,
} from "../modules/trackers/services/ClassTestSummaryService";
import { deriveReportOwnership } from "../modules/trackers/services/ClassTestResultService";
import { interpolate } from "../modules/templates/services/MessageTemplateService";
import { MESSAGE_TEMPLATE_REGISTRY } from "@scd/shared";

const NOW = new Date(2026, 6, 20);

/**
 * `reportsStatus` no longer calls `examReportStatus` per exam — it batches the same
 * three inputs (roster count, entered/present counts, one shared calendar). These
 * helpers express a test's intent in those terms: "this exam has a roster of 10 and
 * 4 results entered", which is what the mocked collaborator used to stand in for.
 */
type ExamCounts = {
  id: { toString(): string };
  sectionId: unknown;
  roster: number;
  entered: number;
  present?: number;
  /** D-#603 handoff state. Default 0 = the teacher has not proposed release yet. */
  submitted?: number;
  published?: number;
};

function withCounts(exams: ExamCounts[], submitted: Array<{ _id: unknown; latest: Date }> = []): void {
  const bySection = new Map<string, number>();
  for (const e of exams) bySection.set(String(e.sectionId), e.roster);
  mockStudentAggregate.mockResolvedValue(
    [...bySection.entries()].map(([id, n]) => ({ _id: { toString: () => id }, n })),
  );
  const latestOf = (id: { toString(): string }) =>
    submitted.find((s) => String(s._id) === String(id))?.latest ?? null;
  // TWO aggregates now run against results: the D-#603 handoff pass (stamps +
  // counts) and the status counts. Both $match on testId alone, so they are told
  // apart by their $group shape, not their filter.
  mockResAggregate.mockImplementation((pipeline: unknown) => {
    const group = (pipeline as Array<{ $group?: Record<string, unknown> }>).find((s) => s.$group)?.$group ?? {};
    if ("submittedLatest" in group) {
      return Promise.resolve(
        exams.map((e) => ({
          _id: e.id,
          submittedLatest: latestOf(e.id),
          publishedLatest: (e.published ?? 0) > 0 ? latestOf(e.id) ?? new Date(2026, 6, 13) : null,
          // A published row counts as handed off (publishExam stamps every row).
          submittedCount: Math.max(e.submitted ?? 0, e.published ?? 0),
          publishedCount: e.published ?? 0,
        })),
      );
    }
    return Promise.resolve(
      exams.flatMap((e) => {
        const present = e.present ?? e.entered;
        const rows: Array<{ _id: { testId: unknown; status: string }; n: number }> = [];
        if (present > 0) rows.push({ _id: { testId: e.id, status: "PRESENT" }, n: present });
        if (e.entered - present > 0)
          rows.push({ _id: { testId: e.id, status: "ABSENT" }, n: e.entered - present });
        return rows;
      }),
    );
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentFind.mockReturnValue(leanChain([]));
  mockStudentAggregate.mockResolvedValue([]);
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
    expect(reportStateOf({ publishComplete: true, overdue: true, enteredCount: 5 })).toBe("complete");
    expect(reportStateOf({ publishComplete: false, overdue: true, enteredCount: 0 })).toBe("overdue");
    expect(reportStateOf({ publishComplete: false, overdue: true, enteredCount: 3 })).toBe("overdue");
    expect(reportStateOf({ publishComplete: false, overdue: false, enteredCount: 3 })).toBe("in_progress");
    expect(reportStateOf({ publishComplete: false, overdue: false, enteredCount: 0 })).toBe("not_started");
  });

  // D-#603: the regression that motivated the change — every mark entered, nothing
  // released. This used to return "complete" and the card went green while guardians
  // had seen nothing.
  test("entry-complete but UNPUBLISHED past the deadline stays overdue", () => {
    expect(reportStateOf({ publishComplete: false, overdue: true, enteredCount: 17 })).toBe("overdue");
  });
});

describe("deriveReportOwnership (D-#603 — one clock, two owners)", () => {
  const base = { rosterCount: 10, submittedCount: 0, publishedCount: 0, pastDeadline: true, schoolDaysLate: 3 };

  test("before the deadline nobody is late", () => {
    const o = deriveReportOwnership({ ...base, pastDeadline: false, schoolDaysLate: 0 });
    expect(o).toMatchObject({ overdue: false, teacherOverdue: false, publishOverdue: false, schoolDaysLate: 0 });
  });

  test("past deadline, nothing submitted → the TEACHER's delay", () => {
    const o = deriveReportOwnership(base);
    expect(o).toMatchObject({ overdue: true, teacherOverdue: true, publishOverdue: false, schoolDaysLate: 3 });
  });

  test("a PARTIAL submit does not stop the teacher's clock", () => {
    const o = deriveReportOwnership({ ...base, submittedCount: 9 });
    expect(o).toMatchObject({ overdue: true, teacherOverdue: true, publishOverdue: false });
  });

  test("fully submitted, unpublished → hands the delay to Office/Principal", () => {
    const o = deriveReportOwnership({ ...base, submittedCount: 10 });
    expect(o).toMatchObject({ overdue: true, teacherOverdue: false, publishOverdue: true, schoolDaysLate: 3 });
  });

  test("a PARTIAL publish is not the finish line", () => {
    const o = deriveReportOwnership({ ...base, submittedCount: 10, publishedCount: 9 });
    expect(o).toMatchObject({ overdue: true, publishOverdue: true, publishComplete: false });
  });

  test("fully published clears everything and freezes the lateness", () => {
    const o = deriveReportOwnership({ ...base, submittedCount: 10, publishedCount: 10 });
    expect(o).toMatchObject({
      overdue: false,
      teacherOverdue: false,
      publishOverdue: false,
      publishComplete: true,
      schoolDaysLate: 0,
    });
  });

  test("a send-back ($unset submittedAt) returns the delay to the teacher", () => {
    const submitted = deriveReportOwnership({ ...base, submittedCount: 10 });
    expect(submitted.teacherOverdue).toBe(false);
    // sendBackExam clears submittedAt on every row → the count falls back to 0.
    const sentBack = deriveReportOwnership({ ...base, submittedCount: 0 });
    expect(sentBack.teacherOverdue).toBe(true);
    expect(sentBack.publishOverdue).toBe(false);
  });

  test("an empty roster is never late (no denominator, D-#120 posture)", () => {
    const o = deriveReportOwnership({ ...base, rosterCount: 0 });
    expect(o.publishComplete).toBe(false);
    expect(o.overdue).toBe(true); // past deadline with nothing to publish is still a gap
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
  submittedCount: 0,
  publishedCount: 0,
  submitComplete: false,
  publishComplete: false,
  overdue: false,
  teacherOverdue: false,
  publishOverdue: false,
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
    // e1 done — entered AND released (D-#603: publication, not entry, is what
    // makes a row complete); e2 incomplete and long past its deadline.
    withCounts(
      [
        { id: e1._id, sectionId: SECTION, roster: 10, entered: 10, submitted: 10, published: 10 },
        { id: e2._id, sectionId: SECTION, roster: 10, entered: 4 },
      ],
      [{ _id: e1._id, latest: new Date(2026, 6, 12) }],
    );
    // D-#339: row enrichment — author name + newest result submittedAt.
    mockUserFind.mockReturnValue(leanChain([{ _id: T_A, name: "Teacher A" }]));

    const rows = await reportsStatus({ asOf: NOW });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ testNumber: 1, state: "complete", subject: "MATH", teacherId: T_A.toString() });
    expect(rows[1]).toMatchObject({ testNumber: 2, state: "overdue" });
    expect(rows[1].schoolDaysLate).toBeGreaterThan(0); // derived from the shared calendar
    expect(rows[0].teacherName).toBe("Teacher A");
    expect(rows[0].submittedAt).toBe(new Date(2026, 6, 12).toISOString());
    expect(rows[1].submittedAt).toBeNull();
  });

  // The perf property (2026-08-16): the roster/result reads and the calendar are
  // batched for the WHOLE exam set. This used to be one calendar rebuild — ~70 DB
  // round trips — per exam, which is what made the dashboard take a minute to load.
  test("issues ONE roster read for the whole exam set, not one per exam", async () => {
    const exams = [1, 2, 3, 4, 5].map((n) => exam({ _id: oid(), testNumber: n }));
    mockCtFind.mockReturnValue(leanChain(exams));
    withCounts(exams.map((e) => ({ id: e._id, sectionId: SECTION, roster: 10, entered: 10 })));

    const rows = await reportsStatus({ asOf: NOW });
    expect(rows).toHaveLength(5);
    expect(mockStudentAggregate).toHaveBeenCalledTimes(1);
  });

  test("principalDashboard tallies the KPI partition + completion rate + overdue-by-teacher", async () => {
    // The four states come from the DATA now: complete = fully PUBLISHED (D-#603);
    // overdue = unpublished and past deadline (the 10 July exams); in_progress /
    // not_started = incomplete but still inside the deadline (a 19 July exam, NOW
    // being the 20th). `eWait` is the D-#603 case: the teacher has submitted
    // everything and it is OUR approval that is late.
    const RECENT = { examDate: new Date(2026, 6, 19) };
    const eDone = exam({ _id: oid(), requestedBy: T_A });
    const eOverA = exam({ _id: oid(), requestedBy: T_A });
    const eOverB = exam({ _id: oid(), requestedBy: T_B });
    const eWait = exam({ _id: oid(), requestedBy: T_A });
    const eProg = exam({ _id: oid(), requestedBy: T_B, ...RECENT });
    const eNot = exam({ _id: oid(), requestedBy: T_B, ...RECENT });
    mockCtFind.mockReturnValue(leanChain([eDone, eOverA, eOverB, eWait, eProg, eNot]));
    withCounts([
      { id: eDone._id, sectionId: SECTION, roster: 10, entered: 10, submitted: 10, published: 10 },
      { id: eOverA._id, sectionId: SECTION, roster: 10, entered: 1 },
      { id: eOverB._id, sectionId: SECTION, roster: 10, entered: 0 },
      { id: eWait._id, sectionId: SECTION, roster: 10, entered: 10, submitted: 10 },
      { id: eProg._id, sectionId: SECTION, roster: 10, entered: 5 },
      { id: eNot._id, sectionId: SECTION, roster: 10, entered: 0 },
    ]);
    mockUserFind.mockReturnValue(leanChain([
      { _id: T_A, name: "Ustadh A" },
      { _id: T_B, name: "Ustadh B" },
    ]));

    const d = await principalDashboard({ asOf: NOW });
    expect(d).toMatchObject({
      logged: 6,
      complete: 1,
      overdue: 3,
      inProgress: 1,
      notStarted: 1,
      // The split is disjoint and sums to `overdue`.
      awaitingSubmit: 2,
      awaitingPublish: 1,
      completionRatePct: 17,
    });
    // overdue-by-teacher counts ONLY teacher-owned delays: A's submitted-but-
    // unpublished exam is our backlog, so A still shows 1, not 2.
    expect(d.overdueByTeacher).toHaveLength(2);
    expect(d.overdueByTeacher.map((r) => r.overdueCount)).toEqual([1, 1]);
    expect(d.overdueByTeacher.map((r) => r.teacherName).sort()).toEqual(["Ustadh A", "Ustadh B"]);
  });

  // D-#614. This one is STRUCTURAL on purpose, and it is worth saying why.
  //
  // The bug was MongoDB semantics, not logic: in an aggregation EXPRESSION a
  // missing field is `missing`, and `{$ne: ["$publishedAt", null]}` is TRUE for
  // it — so every never-published row counted as published, `publishComplete`
  // was true everywhere, and D-#603 silently did nothing on real data. The query
  // language behaves the opposite way, which is why the `$match`-filtered
  // aggregates this replaced were correct.
  //
  // No mock can reproduce that: this suite stubs `aggregate`, so the pipeline is
  // never executed by a real server and a behavioural assertion would pass with
  // the bug present. Pinning the emitted pipeline is the only guard available
  // short of an integration DB — it fails the moment someone "simplifies" the
  // `$ifNull` away, which is exactly how the defect was introduced.
  test("the handoff pipeline coerces MISSING to null before comparing (D-#614)", async () => {
    const e1 = exam({ _id: oid() });
    mockCtFind.mockReturnValue(leanChain([e1]));
    withCounts([{ id: e1._id, sectionId: SECTION, roster: 10, entered: 10 }]);

    await reportsStatus({ asOf: NOW });

    const pipelines = mockResAggregate.mock.calls.map((c) => JSON.stringify(c[0]));
    const handoff = pipelines.find((p) => p.includes("submittedLatest"));
    expect(handoff).toBeDefined();
    // Both stamp comparisons must go through $ifNull ...
    expect(handoff).toContain('{"$ifNull":["$publishedAt",null]}');
    expect(handoff).toContain('{"$ifNull":["$submittedAt",null]}');
    // ... and the bare form must not appear anywhere in it.
    expect(handoff).not.toContain('{"$ne":["$publishedAt",null]}');
    expect(handoff).not.toContain('{"$ne":["$submittedAt",null]}');
  });

  test("overdueCounts mirrors the dashboard split (D-#603 — one number everywhere)", async () => {
    const eOver = exam({ _id: oid(), requestedBy: T_A });
    const eWait = exam({ _id: oid(), requestedBy: T_B });
    mockCtFind.mockReturnValue(leanChain([eOver, eWait]));
    withCounts([
      { id: eOver._id, sectionId: SECTION, roster: 10, entered: 2 },
      { id: eWait._id, sectionId: SECTION, roster: 10, entered: 10, submitted: 10 },
    ]);

    const c = await overdueCounts({ asOf: NOW });
    expect(c).toEqual({ open: 2, overdue: 2, awaitingSubmit: 1, awaitingPublish: 1 });
    // Name-free: the badge poll must not pay for a User lookup.
    expect(mockUserFind).not.toHaveBeenCalled();
  });

  // D-#615: "open" is the owner's definition — exam SAT and results not yet
  // published. It is the superset the Dashboard button shows beside `overdue`.
  test("open counts every sat-but-unpublished exam, late or not (D-#615)", async () => {
    const past = exam({ _id: oid() }); // 10 July — long past its deadline
    const recent = exam({ _id: oid(), examDate: new Date(2026, 6, 19) }); // sat, deadline ahead
    const future = exam({ _id: oid(), examDate: new Date(2026, 6, 30) }); // not sat yet
    const done = exam({ _id: oid() });
    mockCtFind.mockReturnValue(leanChain([past, recent, future, done]));
    withCounts([
      { id: past._id, sectionId: SECTION, roster: 10, entered: 0 },
      { id: recent._id, sectionId: SECTION, roster: 10, entered: 4 },
      { id: future._id, sectionId: SECTION, roster: 10, entered: 0 },
      { id: done._id, sectionId: SECTION, roster: 10, entered: 10, submitted: 10, published: 10 },
    ]);

    const c = await overdueCounts({ asOf: NOW });
    // past + recent are open; `future` is not sat, `done` is published.
    expect(c.open).toBe(2);
    // Only `past` is late — so overdue is a STRICT subset of open.
    expect(c.overdue).toBe(1);
    expect(c.overdue).toBeLessThanOrEqual(c.open);
  });

  test("an exam sat TODAY is already open (D-#615 — the paper has been written)", async () => {
    const today = exam({ _id: oid(), examDate: NOW });
    mockCtFind.mockReturnValue(leanChain([today]));
    withCounts([{ id: today._id, sectionId: SECTION, roster: 10, entered: 0 }]);

    const c = await overdueCounts({ asOf: NOW });
    expect(c.open).toBe(1);
    expect(c.overdue).toBe(0); // its deadline is still days away
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
    // Overdue-ness, pending counts and lateness are all DERIVED now: e1/e2 sat the
    // 10 July exam and are still unsubmitted on the 20th; e3 is fully entered AND
    // released, so it is complete and never reaches the chase list.
    withCounts([
      { id: e1._id, sectionId: SECTION, roster: 10, entered: 0 },
      { id: e2._id, sectionId: SECTION, roster: 10, entered: 2 },
      { id: e3._id, sectionId: SECTION, roster: 10, entered: 10, submitted: 10, published: 10 },
    ]);
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
    // The lateness is the CALENDAR's answer now (10 July exam, 2-school-day deadline,
    // read on 20 July), not an injected number — so if the school calendar ever
    // changes shape, this byte-check fails loudly instead of drifting.
    const examList =
      "১) তৃতীয় শ্রেণি (মূল) · গণিত · টেস্ট ১ · পরীক্ষা ১০/০৭ — ১০/১০ জনের ফলাফল বাকি · ৫ কর্মদিবস দেরি [CT-C3-MATH-0001]\n" +
      "২) তৃতীয় শ্রেণি (মূল) · গণিত · টেস্ট ২ · পরীক্ষা ১০/০৭ — ৮/১০ জনের ফলাফল বাকি · ৫ কর্মদিবস দেরি [CT-C3-MATH-0001]";
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
    // D-#603: published ⇒ never overdue (entry alone no longer clears the clock).
    withCounts([{ id: e1._id, sectionId: SECTION, roster: 10, entered: 10, submitted: 10, published: 10 }]);
    const list = await overdueChaseList({ asOf: NOW });
    expect(list.entries).toEqual([]);
    expect(list.unreachableCount).toBe(0);
  });

  // The misattribution D-#603 had to avoid: the chip stays red until publish, so
  // `state === "overdue"` now also covers exams sitting in OUR approval queue.
  // Chasing the teacher for those nags the wrong person for work they cannot do.
  test("a submitted-but-unpublished exam is NOT chased to the teacher", async () => {
    const e1 = exam({ _id: oid(), requestedBy: T_A });
    mockCtFind.mockReturnValue(leanChain([e1]));
    withCounts([{ id: e1._id, sectionId: SECTION, roster: 10, entered: 10, submitted: 10 }]);
    mockUserFind.mockReturnValue(leanChain([{ _id: T_A, name: "Ustadh A", phone: "01711000000" }]));

    const rows = await reportsStatus({ asOf: NOW });
    expect(rows[0]).toMatchObject({ state: "overdue", teacherOverdue: false, publishOverdue: true });

    const list = await overdueChaseList({ asOf: NOW });
    expect(list.entries).toEqual([]);
  });
});
