/**
 * Class Test Tracker CT-2 tests (prd-tracker-class-test §3.3/§4/§5, D-#121/#158).
 *
 * Scoring   — deriveScore / derivePercent / derivePass: percent + pass-fail derived
 *             (never stored, D-#85); ABSENT carries null marks/percent/pass and is
 *             excluded from denominators (§4).
 * Calendar  — deadlineFrom (school-day-aware, exam-date-anchored, skips Fri/Sat/
 *             holiday via the injected isOpenDay), schoolDaysBetween, deriveOverdue
 *             (idle until the deadline passes, D-#120/§9 — pure, clock injected).
 * Service   — enterResult: marks 0..totalMarks + required only when PRESENT, ABSENT
 *             clears marks, PRINTED-only, on/after the exam date (J3), one row per
 *             student per exam, audited; studentResult/testResults derive; the
 *             per-exam examReportStatus completion + deadline/overdue read.
 * RBAC      — the results-entry write gate (assertCanWrite) denies OFFICE (prints,
 *             never scores) + GUARDIAN; the read gate (assertCanRead) denies GUARDIAN.
 *
 * DB-free (the repo convention): models + audit + the D-#50 calendar are mocked; the
 * pure engines are exercised directly.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

const mockCtFindById = jest.fn();
jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: { findById: (id: unknown) => mockCtFindById(id) },
}));

const mockResUpsert = jest.fn();
const mockResFindOne = jest.fn();
const mockResFind = jest.fn();
jest.mock("../modules/trackers/models/ClassTestResult", () => ({
  ClassTestResult: {
    findOneAndUpdate: (...a: unknown[]) => mockResUpsert(...a),
    findOne: (q: unknown) => mockResFindOne(q),
    find: (q: unknown) => mockResFind(q),
  },
}));

const mockStudentCount = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { countDocuments: (q: unknown) => mockStudentCount(q) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// The ONE D-#50 calendar source: FULL on Sun–Thu, OFF Fri, QURAN_ONLY Sat (no
// HolidayException DB needed for these tests — overrides ride the same predicate).
const mockResolveDayType = jest.fn();
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: Date) => mockResolveDayType(d),
  // The calendar is now built for a whole RANGE in one query (perf fix 2026-08-16).
  // Drive it from the same per-date mock so every existing expectation still holds:
  // pre-resolve each day once, then answer synchronously.
  buildDayTypeResolver: async (from: Date, to: Date) => {
    const types = new Map<number, string>();
    const key = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    for (let t = new Date(from); t <= to; t.setDate(t.getDate() + 1)) {
      types.set(key(t), await mockResolveDayType(new Date(t)));
    }
    return (d: Date) => types.get(key(d)) ?? "FULL";
  },
}));

// Import AFTER mocks
import { deriveScore, derivePercent, derivePass } from "../modules/trackers/classTestScoring";
import {
  deadlineFrom,
  schoolDaysBetween,
  deriveOverdue,
  atMidnight,
} from "../modules/trackers/classTestCalendar";
import {
  enterResult,
  studentResult,
  testResults,
  examReportStatus,
  ClassTestResultError,
} from "../modules/trackers/services/ClassTestResultService";
import { assertCanWrite, assertCanRead, ForbiddenError } from "../middleware/authz";
import type { AppContext } from "../context";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECTION_OID = oid();
const TEST_OID = oid();
const TEACHER_ID = oid().toString();

const printedTest = (over: Record<string, unknown> = {}) => ({
  _id: TEST_OID,
  ctId: "CT-C3-MATH-0001",
  sectionId: SECTION_OID,
  examDate: new Date("2026-07-10"), // a Friday is irrelevant here; entry uses date-only
  totalMarks: 20,
  passMark: 8,
  deadlineDays: 2,
  status: "PRINTED",
  ...over,
});

/** FULL on Sun(0)–Thu(4); OFF Fri(5); QURAN_ONLY Sat(6) — open == FULL. */
const dayOfWeekCalendar = (d: Date) => {
  const g = d.getDay();
  if (g === 5) return "OFF";
  if (g === 6) return "QURAN_ONLY";
  return "FULL";
};

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveDayType.mockImplementation(async (d: Date) => dayOfWeekCalendar(d));
  mockWriteAudit.mockResolvedValue(undefined);
});

// ===========================================================================
// Pure scoring (§4, D-#85)
// ===========================================================================

describe("classTestScoring", () => {
  test("derivePercent = marks/total ×100 (1 dp); derivePass = marks ≥ passMark", () => {
    expect(derivePercent(15, 20)).toBe(75);
    expect(derivePercent(13, 30)).toBe(43.3); // 43.333 → 43.3
    expect(derivePass(8, 8)).toBe(true); // exactly the pass mark passes
    expect(derivePass(7, 8)).toBe(false);
  });

  test("PRESENT derives marks/percent/pass from the test", () => {
    const s = deriveScore({ status: "PRESENT", marks: 15, totalMarks: 20, passMark: 8 });
    expect(s).toMatchObject({ status: "PRESENT", marks: 15, percent: 75, pass: true });
  });

  test("a below-passMark PRESENT student is pass:false (never null)", () => {
    const s = deriveScore({ status: "PRESENT", marks: 5, totalMarks: 20, passMark: 8 });
    expect(s.percent).toBe(25);
    expect(s.pass).toBe(false);
  });

  test("ABSENT carries null marks/percent/pass (excluded from denominators, §4)", () => {
    const s = deriveScore({ status: "ABSENT", marks: null, totalMarks: 20, passMark: 8 });
    expect(s).toMatchObject({ status: "ABSENT", marks: null, percent: null, pass: null, totalMarks: 20 });
  });
});

// ===========================================================================
// Pure deadline / overdue math (school-day-aware, D-#50/#120, §9)
// ===========================================================================

describe("classTestCalendar (pure)", () => {
  const isOpen = (d: Date) => dayOfWeekCalendar(d) === "FULL";
  // Local-component dates (month is 0-based) so getDay()/getTime() are TZ-stable.
  const D = (m: number, d: number) => new Date(2026, m - 1, d);

  test("deadlineFrom advances N school-days, skipping Fri/Sat", () => {
    // Exam Thu 07-09 + 2 school-days → skip Fri/Sat → Sun, Mon → Mon 07-13.
    const dl = deadlineFrom(D(7, 9), 2, isOpen);
    expect(atMidnight(dl).getTime()).toBe(D(7, 13).getTime()); // Monday
  });

  test("deadlineDays = 0 ⇒ the exam date itself is the deadline", () => {
    const exam = D(7, 8); // Wednesday
    expect(atMidnight(deadlineFrom(exam, 0, isOpen)).getTime()).toBe(atMidnight(exam).getTime());
  });

  test("schoolDaysBetween counts only open days in the half-open window; 0 when to ≤ from", () => {
    // Thu→next Thu spans Fri/Sat (skipped) + Sun..Thu = 5 open days.
    expect(schoolDaysBetween(D(7, 9), D(7, 16), isOpen)).toBe(5);
    expect(schoolDaysBetween(D(7, 16), D(7, 9), isOpen)).toBe(0);
  });

  // D-#606 moved this boundary: overdue is now `>=` the deadline, so the deadline
  // DAY counts. The old `>` gave a silent extra day — with Fri/Sat closed, a
  // Thursday exam's two school days land Sun+Mon and the row stayed green all of
  // Monday, the day it was actually due, stretching "two days" to five calendar days.
  test("deriveOverdue: overdue ON the deadline day (D-#606), and counts late days after", () => {
    const exam = D(7, 9); // Thu; deadline = Mon 07-13
    const before = deriveOverdue(exam, 2, D(7, 12), isOpen); // Sun — one day short
    expect(before.overdue).toBe(false);
    expect(before.schoolDaysLate).toBe(0);

    const dueDay = deriveOverdue(exam, 2, D(7, 13), isOpen); // Mon — the deadline itself
    expect(dueDay.overdue).toBe(true);
    expect(dueDay.schoolDaysLate).toBe(0); // due, not yet late by any school day

    const late = deriveOverdue(exam, 2, D(7, 15), isOpen); // Wed
    expect(late.overdue).toBe(true);
    expect(late.schoolDaysLate).toBe(2); // Tue, Wed
  });

  // The D-#120 property survives the `>=`: the clock stays idle until the exam
  // date has passed. Only reachable with deadlineDays 0 (the model permits it and
  // it is per-exam editable) — without the guard the report would be "late" at
  // 00:00 on the exam's own day, before it has been sat.
  test("deriveOverdue: deadlineDays 0 is never overdue ON the exam day (D-#120 kept)", () => {
    const exam = D(7, 9); // Thu
    const sameDay = deriveOverdue(exam, 0, D(7, 9), isOpen);
    expect(sameDay.overdue).toBe(false);

    const nextOpen = deriveOverdue(exam, 0, D(7, 10), isOpen); // Fri (closed) still counts as past
    expect(nextOpen.overdue).toBe(true);
  });
});

// ===========================================================================
// enterResult (J3)
// ===========================================================================

describe("enterResult", () => {
  const onExamDay = new Date("2026-07-10");

  beforeEach(() => {
    mockCtFindById.mockReturnValue(leanChain(printedTest()));
    mockResFindOne.mockReturnValue(leanChain(null)); // default: no existing (unpublished) row
    mockResUpsert.mockImplementation(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const set = (update.$set ?? {}) as Record<string, unknown>;
      return {
        _id: oid(),
        testId: filter.testId,
        studentId: filter.studentId,
        status: set.status,
        marks: "marks" in set ? set.marks : undefined,
        weakness: set.weakness,
        teacherAction: set.teacherAction,
        guardianAction: set.guardianAction,
        publishedVersion: 0,
        enteredBy: set.enteredBy,
      };
    });
  });

  test("PRESENT: stores marks, derives percent/pass, audits CLASS_TEST_RESULT_ENTERED", async () => {
    const studentId = oid().toString();
    const res = await enterResult({
      testId: TEST_OID.toString(),
      studentId,
      status: "PRESENT",
      marks: 15,
      weakness: "fractions",
      teacherAction: "re-teach",
      guardianAction: "practice at home",
      actorId: TEACHER_ID,
      now: onExamDay,
    });
    expect(res).toMatchObject({ status: "PRESENT", marks: 15, percent: 75, pass: true, totalMarks: 20 });
    expect(res.teacherAction).toBe("re-teach");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASS_TEST_RESULT_ENTERED", targetKind: "ClassTestResult" }),
    );
    // upsert keyed on (testId, studentId) — one row per student per exam
    expect(mockResUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ testId: expect.anything(), studentId: expect.anything() }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "PRESENT", marks: 15 }) }),
      expect.objectContaining({ upsert: true }),
    );
  });

  test("ABSENT: $unset marks, derives null percent/pass", async () => {
    const res = await enterResult({
      testId: TEST_OID.toString(),
      studentId: oid().toString(),
      status: "ABSENT",
      actorId: TEACHER_ID,
      now: onExamDay,
    });
    expect(res).toMatchObject({ status: "ABSENT", marks: null, percent: null, pass: null });
    expect(mockResUpsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $unset: { marks: "" } }),
      expect.anything(),
    );
  });

  test("rejects marks > totalMarks and negative marks", async () => {
    const base = { testId: TEST_OID.toString(), studentId: oid().toString(), status: "PRESENT", actorId: TEACHER_ID, now: onExamDay };
    await expect(enterResult({ ...base, marks: 21 })).rejects.toThrow(/between 0 and totalMarks/);
    await expect(enterResult({ ...base, marks: -1 })).rejects.toThrow(/between 0 and totalMarks/);
    expect(mockResUpsert).not.toHaveBeenCalled();
  });

  test("PRESENT requires marks; ABSENT rejects stray marks", async () => {
    const base = { testId: TEST_OID.toString(), studentId: oid().toString(), actorId: TEACHER_ID, now: onExamDay };
    await expect(enterResult({ ...base, status: "PRESENT" })).rejects.toThrow(/marks are required/);
    await expect(enterResult({ ...base, status: "ABSENT", marks: 5 })).rejects.toThrow(/carries no marks/);
  });

  test("rejects an unknown status", async () => {
    await expect(
      enterResult({ testId: TEST_OID.toString(), studentId: oid().toString(), status: "MAYBE", actorId: TEACHER_ID, now: onExamDay }),
    ).rejects.toThrow(/PRESENT or ABSENT/);
  });

  test("rejects results on a non-PRINTED (still REQUESTED) record", async () => {
    mockCtFindById.mockReturnValue(leanChain(printedTest({ status: "REQUESTED" })));
    await expect(
      enterResult({ testId: TEST_OID.toString(), studentId: oid().toString(), status: "ABSENT", actorId: TEACHER_ID, now: onExamDay }),
    ).rejects.toThrow(/printed \(official\) exam/);
  });

  test("rejects results BEFORE the exam date (J3)", async () => {
    await expect(
      enterResult({
        testId: TEST_OID.toString(),
        studentId: oid().toString(),
        status: "PRESENT",
        marks: 10,
        actorId: TEACHER_ID,
        now: new Date("2026-07-09"), // the day before
      }),
    ).rejects.toThrow(/on or after the exam date/);
  });

  test("allows entry ON the exam date (boundary)", async () => {
    const res = await enterResult({
      testId: TEST_OID.toString(),
      studentId: oid().toString(),
      status: "PRESENT",
      marks: 10,
      actorId: TEACHER_ID,
      now: onExamDay,
    });
    expect(res.status).toBe("PRESENT");
  });

  test("a missing test throws", async () => {
    mockCtFindById.mockReturnValue(leanChain(null));
    await expect(
      enterResult({ testId: TEST_OID.toString(), studentId: oid().toString(), status: "ABSENT", actorId: TEACHER_ID, now: onExamDay }),
    ).rejects.toBeInstanceOf(ClassTestResultError);
  });

  test("rejects editing a PUBLISHED result — must unpublish first (owner ruling)", async () => {
    mockResFindOne.mockReturnValue(leanChain({ publishedAt: new Date("2026-07-11") }));
    await expect(
      enterResult({ testId: TEST_OID.toString(), studentId: oid().toString(), status: "PRESENT", marks: 12, actorId: TEACHER_ID, now: onExamDay }),
    ).rejects.toThrow(/unpublish/i);
    expect(mockResUpsert).not.toHaveBeenCalled();
  });

  test("allows editing an entered-but-UNPUBLISHED result (publishedAt null)", async () => {
    mockResFindOne.mockReturnValue(leanChain({ publishedAt: null }));
    const res = await enterResult({
      testId: TEST_OID.toString(), studentId: oid().toString(), status: "PRESENT", marks: 14, actorId: TEACHER_ID, now: onExamDay,
    });
    expect(res.status).toBe("PRESENT");
    expect(mockResUpsert).toHaveBeenCalled();
  });
});

// ===========================================================================
// Derived reads + per-exam completion
// ===========================================================================

describe("studentResult / testResults", () => {
  test("studentResult derives from the stored row; null when none", async () => {
    mockCtFindById.mockReturnValue(leanChain(printedTest()));
    mockResFindOne.mockReturnValue(leanChain({ _id: oid(), testId: TEST_OID, studentId: oid(), status: "PRESENT", marks: 18, publishedVersion: 0 }));
    const r = await studentResult(TEST_OID.toString(), oid().toString());
    expect(r).toMatchObject({ status: "PRESENT", marks: 18, percent: 90, pass: true });

    mockResFindOne.mockReturnValue(leanChain(null));
    expect(await studentResult(TEST_OID.toString(), oid().toString())).toBeNull();
  });

  test("testResults derives every entered row (PRESENT scored, ABSENT null)", async () => {
    mockCtFindById.mockReturnValue(leanChain(printedTest()));
    mockResFind.mockReturnValue(
      leanChain([
        { _id: oid(), testId: TEST_OID, studentId: oid(), status: "PRESENT", marks: 16, publishedVersion: 0 },
        { _id: oid(), testId: TEST_OID, studentId: oid(), status: "ABSENT", publishedVersion: 0 },
      ]),
    );
    const rows = await testResults(TEST_OID.toString());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "PRESENT", percent: 80, pass: true });
    expect(rows[1]).toMatchObject({ status: "ABSENT", percent: null, pass: null });
  });
});

describe("examReportStatus (per-exam completion + deadline/overdue)", () => {
  const D = (m: number, d: number) => new Date(2026, m - 1, d);

  test("counts present/absent/pending, deadline is school-day-aware, overdue needs incomplete", async () => {
    // Exam Thu 07-09, deadlineDays 2 → deadline Mon 07-13.
    mockCtFindById.mockReturnValue(leanChain(printedTest({ examDate: D(7, 9) })));
    mockStudentCount.mockResolvedValue(10);
    mockResFind.mockReturnValue(
      leanChain([{ status: "PRESENT" }, { status: "PRESENT" }, { status: "ABSENT" }]),
    );
    const st = await examReportStatus(TEST_OID.toString(), D(7, 15)); // Wed — past the deadline
    expect(st).toMatchObject({
      rosterCount: 10,
      enteredCount: 3,
      presentCount: 2,
      absentCount: 1,
      pendingCount: 7,
      complete: false,
      overdue: true,
    });
    expect(st.deadline).toBe(atMidnight(D(7, 13)).toISOString());
    expect(st.schoolDaysLate).toBe(2); // Tue, Wed
  });

  // D-#603 supersedes the old "complete ⇒ never overdue" rule (D-#120). Entry
  // completeness is no longer the finish line: until the marks are RELEASED the
  // guardian has seen nothing, so the delay keeps running — it just changes owner.
  test("entry-complete but unsubmitted stays overdue, and it is the TEACHER's delay", async () => {
    mockCtFindById.mockReturnValue(leanChain(printedTest({ examDate: D(7, 9) })));
    mockStudentCount.mockResolvedValue(3);
    mockResFind.mockReturnValue(leanChain([{ status: "PRESENT" }, { status: "PRESENT" }, { status: "ABSENT" }]));
    const st = await examReportStatus(TEST_OID.toString(), D(7, 20));
    expect(st).toMatchObject({
      complete: true,
      submitComplete: false,
      publishComplete: false,
      overdue: true,
      teacherOverdue: true,
      publishOverdue: false,
    });
    expect(st.schoolDaysLate).toBeGreaterThan(0);
  });

  test("submitted but unpublished moves the delay to Office/Principal", async () => {
    mockCtFindById.mockReturnValue(leanChain(printedTest({ examDate: D(7, 9) })));
    mockStudentCount.mockResolvedValue(3);
    const submitted = { submittedAt: D(7, 13), publishedAt: null };
    mockResFind.mockReturnValue(
      leanChain([
        { status: "PRESENT", ...submitted },
        { status: "PRESENT", ...submitted },
        { status: "ABSENT", ...submitted },
      ]),
    );
    const st = await examReportStatus(TEST_OID.toString(), D(7, 20));
    expect(st).toMatchObject({
      submitComplete: true,
      publishComplete: false,
      overdue: true,
      teacherOverdue: false,
      publishOverdue: true,
    });
  });

  test("published clears the delay entirely — the real finish line (D-#603)", async () => {
    mockCtFindById.mockReturnValue(leanChain(printedTest({ examDate: D(7, 9) })));
    mockStudentCount.mockResolvedValue(3);
    const released = { submittedAt: D(7, 13), publishedAt: D(7, 14) };
    mockResFind.mockReturnValue(
      leanChain([
        { status: "PRESENT", ...released },
        { status: "PRESENT", ...released },
        { status: "ABSENT", ...released },
      ]),
    );
    const st = await examReportStatus(TEST_OID.toString(), D(7, 20));
    expect(st).toMatchObject({
      publishComplete: true,
      overdue: false,
      teacherOverdue: false,
      publishOverdue: false,
      schoolDaysLate: 0,
    });
  });
});

// ===========================================================================
// RBAC deny-paths — the results-entry gate composes existing perms (D-#94/#17)
// ===========================================================================

describe("RBAC deny-paths (the results-entry / read gates)", () => {
  const ctxOf = (role: string): AppContext => ({ auth: { userId: oid().toString(), role } } as unknown as AppContext);

  test("the write gate (assertCanWrite) denies OFFICE — Office prints, never scores", async () => {
    await expect(assertCanWrite(ctxOf("OFFICE"), SECTION_OID.toString())).rejects.toThrow(ForbiddenError);
  });

  test("the write gate denies GUARDIAN", async () => {
    await expect(assertCanWrite(ctxOf("GUARDIAN"), SECTION_OID.toString())).rejects.toThrow(ForbiddenError);
  });

  test("PRINCIPAL passes the write gate (unscoped admin)", async () => {
    await expect(assertCanWrite(ctxOf("PRINCIPAL"), SECTION_OID.toString())).resolves.toBeUndefined();
  });

  test("the read gate (assertCanRead) denies GUARDIAN", async () => {
    await expect(
      assertCanRead(ctxOf("GUARDIAN"), SECTION_OID.toString(), oid().toString()),
    ).rejects.toThrow(ForbiddenError);
  });
});
