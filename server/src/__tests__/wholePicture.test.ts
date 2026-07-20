/**
 * Cross-tracker whole picture (the CT-10 follow-up deferred in D-#277).
 *
 *   1. signalsOf — the concerns each panel raises, and the thresholds that stay quiet
 *   2. overallOf — the CONSERVATIVE roll-up: one weak signal is noise (a child has an
 *      off fortnight); it only reads "declining" when the academic trajectory is down,
 *      or when two independent behaviour signals fire together
 *   3. wholePicture — composes the four panels; homework windows on due/created date
 *   4. guardianTrajectory — direction of travel and the child's OWN numbers, with NO
 *      rank and NO peer comparison (owner ruling)
 *
 * DB-free: the delegated per-tracker reads are mocked; the composition is real.
 */
const mockStudentProfile = jest.fn();
const mockChildAssignments = jest.fn();
const mockAttendanceHistory = jest.fn();
const mockHwFind = jest.fn();

jest.mock("../modules/trackers/services/ClassTestSummaryService", () => ({
  studentProfile: (...a: unknown[]) => mockStudentProfile(...a),
  // The ONE trajectory primitive — reused, not re-defined.
  regressionSlope: jest.requireActual("../modules/trackers/services/ClassTestSummaryService").regressionSlope,
}));
jest.mock("../modules/trackers/services/AssignmentSummaryService", () => ({
  childAssignments: (...a: unknown[]) => mockChildAssignments(...a),
}));
jest.mock("../modules/attendance/services/AttendanceReportService", () => ({
  studentAttendanceHistory: (...a: unknown[]) => mockAttendanceHistory(...a),
}));
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { find: (f: unknown) => ({ select: () => ({ lean: () => mockHwFind(f) }) }) },
}));

import {
  signalsOf,
  overallOf,
  wholePicture,
  guardianTrajectory,
  type Signal,
} from "../modules/trackers/services/WholePictureService";

const NOW = new Date(2026, 5, 11);

const analytics = (over: Record<string, unknown> = {}) => ({
  examsPresent: 4,
  avgPercent: 72,
  consistency: 5,
  slope: 1.2,
  trajectory: "up",
  atRisk: false,
  streakKind: "pass",
  streakLength: 3,
  bestSubject: "MATH",
  weakestSubject: "ENG",
  recurringWeaknesses: [],
  latestRank: 2,
  latestRankOf: 20,
  ...over,
});

const noSignals = {
  classTest: { trajectory: "up", atRisk: false },
  homework: { completionPct: 95 },
  assignment: { late: 0, total: 5 },
  attendance: { presentPct: 97, markedDays: 60 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentProfile.mockResolvedValue({ studentId: "kid-1", studentName: "Khadija", analytics: analytics() });
  mockChildAssignments.mockResolvedValue([]);
  mockAttendanceHistory.mockResolvedValue({ days: [], markedDays: 0, absentDays: 0, presentPct: 0 });
  mockHwFind.mockResolvedValue([]);
});

describe("signalsOf — what each panel flags", () => {
  test("a healthy student raises nothing", () => {
    expect(signalsOf(noSignals)).toEqual([]);
  });

  test("at-risk and a declining trajectory both surface", () => {
    const s = signalsOf({ ...noSignals, classTest: { trajectory: "down", atRisk: true } });
    expect(s).toEqual(expect.arrayContaining(["AT_RISK", "ACADEMIC_DECLINING"]));
  });

  test("attendance below 90% flags, but only once days are actually marked", () => {
    expect(signalsOf({ ...noSignals, attendance: { presentPct: 85, markedDays: 40 } })).toContain("ATTENDANCE_LOW");
    // An unmarked term must not read as 0% present.
    expect(signalsOf({ ...noSignals, attendance: { presentPct: 0, markedDays: 0 } })).not.toContain("ATTENDANCE_LOW");
  });

  test("homework below 80% completion flags; an unset tracker (null) stays quiet", () => {
    expect(signalsOf({ ...noSignals, homework: { completionPct: 70 } })).toContain("HOMEWORK_LOW");
    expect(signalsOf({ ...noSignals, homework: { completionPct: null } })).not.toContain("HOMEWORK_LOW");
  });

  test("assignment lateness needs both a rate over a third AND enough assignments", () => {
    // 2 late of 5 → over a third, and 5 ≥ 3 → flags.
    expect(signalsOf({ ...noSignals, assignment: { late: 2, total: 5 } })).toContain("ASSIGNMENT_LATE");
    // 1 late of 2 → half, but only 2 assignments: too little to mean anything.
    expect(signalsOf({ ...noSignals, assignment: { late: 1, total: 2 } })).not.toContain("ASSIGNMENT_LATE");
    // Exactly a third is not over a third.
    expect(signalsOf({ ...noSignals, assignment: { late: 2, total: 6 } })).not.toContain("ASSIGNMENT_LATE");
  });
});

describe("overallOf — the conservative roll-up", () => {
  test("a down academic trajectory alone is enough to be declining", () => {
    expect(overallOf("down", [])).toBe("declining");
  });

  test("at-risk is declining whatever the trajectory says", () => {
    expect(overallOf("up", ["AT_RISK"])).toBe("declining");
  });

  test("ONE behaviour signal is noise, not a decline", () => {
    expect(overallOf("steady", ["ATTENDANCE_LOW"])).toBe("steady");
    expect(overallOf("up", ["HOMEWORK_LOW"])).toBe("improving");
  });

  test("TWO independent behaviour signals together read as declining", () => {
    expect(overallOf("steady", ["ATTENDANCE_LOW", "HOMEWORK_LOW"])).toBe("declining");
    expect(overallOf("up", ["HOMEWORK_LOW", "ASSIGNMENT_LATE"])).toBe("declining");
  });

  test("no class-test data: 'na' unless a signal fires, then 'steady'", () => {
    expect(overallOf("na", [])).toBe("na");
    expect(overallOf("na", ["ATTENDANCE_LOW"] as Signal[])).toBe("steady");
  });
});

describe("wholePicture — composing the four panels", () => {
  test("homework counts open/done/chased over the window", async () => {
    mockHwFind.mockResolvedValue([
      { state: "DUE", chaseCount: 0, dueDate: new Date(2026, 5, 1) },
      { state: "CHASE", chaseCount: 2, dueDate: new Date(2026, 5, 2) },
      { state: "CHECKED", chaseCount: 0, dueDate: new Date(2026, 5, 3) },
      { state: "RETURNED", chaseCount: 1, dueDate: new Date(2026, 5, 4) },
      { state: "CHECKED", chaseCount: 0, dueDate: new Date(2024, 0, 1) }, // outside the window
    ]);
    const wp = await wholePicture("kid-1", NOW);
    expect(wp.homework).toEqual({ total: 4, open: 2, done: 2, chased: 2, completionPct: 50 });
  });

  test("assignment averages only GRADED entries and counts lateness", async () => {
    mockChildAssignments.mockResolvedValue([
      { pending: false, daysLate: 0, marks: 8, totalMarks: 10 },
      { pending: false, daysLate: 3, marks: 6, totalMarks: 10 },
      { pending: true, daysLate: 0, marks: null, totalMarks: null }, // ungraded → excluded
    ]);
    const wp = await wholePicture("kid-1", NOW);
    expect(wp.assignment).toEqual({ total: 3, pending: 1, late: 1, avgMarksPct: 70 });
  });

  test("attendance splits recent vs earlier so a slide shows before the average moves", async () => {
    // 4 days: earlier half both present (100%), recent half both absent (0%).
    mockAttendanceHistory.mockResolvedValue({
      days: [{ absent: false }, { absent: false }, { absent: true }, { absent: true }],
      markedDays: 4,
      absentDays: 2,
      presentPct: 50,
    });
    const wp = await wholePicture("kid-1", NOW);
    expect(wp.attendance.earlierPresentPct).toBe(100);
    expect(wp.attendance.recentPresentPct).toBe(0);
    expect(wp.attendance.trajectory).toBe("down");
  });

  test("the class-test analytics are reused whole, not recomputed", async () => {
    const a = analytics({ trajectory: "down", atRisk: true });
    mockStudentProfile.mockResolvedValue({ studentId: "kid-1", studentName: "K", analytics: a });
    const wp = await wholePicture("kid-1", NOW);
    expect(wp.classTest).toBe(a);
    expect(wp.overall).toBe("declining");
    expect(wp.signals).toEqual(expect.arrayContaining(["AT_RISK", "ACADEMIC_DECLINING"]));
  });
});

describe("guardianTrajectory — no rank, no peer comparison", () => {
  test("never leaks rank or class size, even though the analytics carry them", async () => {
    mockAttendanceHistory.mockResolvedValue({ days: [], markedDays: 20, absentDays: 1, presentPct: 95 });
    const g = await guardianTrajectory("kid-1", NOW);

    const blob = JSON.stringify(g);
    expect(blob).not.toContain("latestRank");
    expect(blob).not.toContain("rankOf");
    expect(g).not.toHaveProperty("classTest");
    expect(g.avgPercent).toBe(72); // the child's OWN average is fine
    expect(g.presentPct).toBe(95);
  });

  test("names the weakest subject and the behaviour concerns in plain Bangla", async () => {
    mockStudentProfile.mockResolvedValue({
      studentId: "kid-1",
      studentName: "K",
      analytics: analytics({ trajectory: "down", weakestSubject: "ENG" }),
    });
    mockHwFind.mockResolvedValue([
      { state: "DUE", chaseCount: 0, dueDate: new Date(2026, 5, 1) },
      { state: "DUE", chaseCount: 0, dueDate: new Date(2026, 5, 2) },
    ]); // 0% completion → HOMEWORK_LOW
    mockAttendanceHistory.mockResolvedValue({ days: [], markedDays: 20, absentDays: 0, presentPct: 100 });

    const g = await guardianTrajectory("kid-1", NOW);
    expect(g.overall).toBe("declining");
    expect(g.linesBn[0]).toContain("পিছিয়ে");
    expect(g.linesBn.some((l) => l.includes("বাড়ির কাজ"))).toBe(true);
  });

  test("flagged lines carry the number AND the benchmark, in Bangla and English (owner ask 2026-07-19)", async () => {
    mockHwFind.mockResolvedValue([
      { state: "DUE", chaseCount: 0, dueDate: new Date(2026, 5, 1) },
      { state: "CHECKED", chaseCount: 0, dueDate: new Date(2026, 5, 2) },
    ]); // 1 of 2 done → 50% → HOMEWORK_LOW
    mockAttendanceHistory.mockResolvedValue({ days: [], markedDays: 20, absentDays: 6, presentPct: 71 });

    const g = await guardianTrajectory("kid-1", NOW);
    expect(g.linesBn).toContain("উপস্থিতি 71% (কাম্য অন্তত 90%)।");
    expect(g.linesBn).toContain("বাড়ির কাজ: 2টির মধ্যে 1টি সম্পন্ন — 50% (কাম্য অন্তত 80%)।");
    expect(g.linesEn).toContain("Attendance 71% (expected at least 90%).");
    expect(g.linesEn).toContain("Homework: 1 of 2 completed — 50% (expected at least 80%).");
    // The two language tracks always stay line-for-line parallel.
    expect(g.linesEn.length).toBe(g.linesBn.length);
  });

  test("a healthy attendance line carries no benchmark suffix", async () => {
    mockAttendanceHistory.mockResolvedValue({ days: [], markedDays: 20, absentDays: 1, presentPct: 95 });
    const g = await guardianTrajectory("kid-1", NOW);
    expect(g.linesBn).toContain("উপস্থিতি 95%।");
    expect(g.linesEn).toContain("Attendance 95%.");
  });

  test("with no data at all it says so rather than implying zero", async () => {
    mockStudentProfile.mockResolvedValue({
      studentId: "kid-1",
      studentName: "K",
      analytics: analytics({ trajectory: "na", avgPercent: null, weakestSubject: null, atRisk: false }),
    });
    const g = await guardianTrajectory("kid-1", NOW);
    expect(g.overall).toBe("na");
    expect(g.avgPercent).toBeNull();
    expect(g.linesBn[0]).toContain("যথেষ্ট তথ্য নেই");
  });
});
