/**
 * MR-1 — the monthly report's metric core (docs/prd-monthly-report.md §5).
 *
 * Pure tests only: every counting rule the report depends on is a plain function
 * over plain objects, so the rules that matter (coverage, the fairness denominator,
 * absence-is-not-a-zero, the small-section suppression) are pinned without a DB.
 */
import {
  attendanceMonthOf,
  classTestMonthOf,
  cohortOf,
  cohortOfRows,
  concernsMonthOf,
  feesMonthOf,
  hifzMonthOf,
  isValidPeriodKey,
  libraryMonthOf,
  monthWindowOf,
  periodKeyOf,
  previousPeriodKey,
  trackerCoverageOf,
  trackerMonthOf,
  weekdayPatternOf,
  type StudentMonthMetrics,
} from "../modules/reports/services/MonthlyMetricsService";
import type { TrackerCounters, StudentTrackerPanel } from "../modules/trackers/services/StudentProfileService";
import type { StudentProfileResult } from "../modules/trackers/services/ClassTestSummaryService";
import type { StudentProfileAttendance } from "../modules/trackers/services/StudentProfileContextService";
import { Types } from "mongoose";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ZERO: TrackerCounters = {
  sheets: 0, records: 0, received: 0, absentAtIssue: 0, notReceivedStill: 0,
  submitted: 0, notSubmitted: 0, awaiting: 0, pendingChecking: 0, pendingReturn: 0,
  chased: 0, chaseTotal: 0, checked: 0, returned: 0, resubmissions: 0,
  correct: 0, partial: 0, wrong: 0, qualityPct: null, submissionPct: null,
  graded: 0, avgMarksPct: null,
};
const counters = (p: Partial<TrackerCounters>): TrackerCounters => ({ ...ZERO, ...p });

const panelOf = (totals: TrackerCounters, bySubject: Array<TrackerCounters & { subject: string }> = []): StudentTrackerPanel => ({
  studentId: "s1", fromKey: "2026-07-01", toKey: "2026-07-31",
  fullView: true, subjectFilter: [], totals, bySubject, items: [],
});

const ctResult = (p: Partial<StudentProfileResult>): StudentProfileResult => ({
  testId: "t", ctId: "CT-1", subject: "BANGLA", testNumber: 1,
  examDate: "2026-07-10T00:00:00.000Z", status: "PRESENT",
  marks: 8, totalMarks: 10, percent: 80, pass: true,
  weakness: null, teacherAction: null, guardianAction: null,
  ...p,
});

const oid = (): Types.ObjectId => new Types.ObjectId();

// ---------------------------------------------------------------------------

describe("MR-1 §5.1 — the month window", () => {
  test("a 31-day month, a 30-day month and a leap February all end on their own last day", () => {
    expect(monthWindowOf("2026-07")).toEqual({ fromKey: "2026-07-01", toKey: "2026-07-31" });
    expect(monthWindowOf("2026-06")).toEqual({ fromKey: "2026-06-01", toKey: "2026-06-30" });
    expect(monthWindowOf("2024-02").toKey).toBe("2024-02-29");
    expect(monthWindowOf("2026-02").toKey).toBe("2026-02-28");
  });

  test("previousPeriodKey crosses the year boundary", () => {
    expect(previousPeriodKey("2026-07")).toBe("2026-06");
    expect(previousPeriodKey("2026-01")).toBe("2025-12");
  });

  test("a malformed period key is refused, not silently coerced", () => {
    expect(isValidPeriodKey("2026-13")).toBe(false);
    expect(isValidPeriodKey("2026-7")).toBe(false);
    expect(isValidPeriodKey("2026-07-01")).toBe(false);
    expect(() => monthWindowOf("2026-13")).toThrow();
    expect(() => previousPeriodKey("nope")).toThrow();
  });

  test("periodKeyOf reads a date's own month", () => {
    expect(periodKeyOf(new Date(2026, 6, 31))).toBe("2026-07");
  });
});

describe("MR-1 D-#394 — coverage is what stops an unchecked pile reading as a decline", () => {
  test("work the teacher still owes a check on is NOT settled", () => {
    expect(trackerCoverageOf(counters({ sheets: 10, pendingChecking: 3 }))).toEqual({
      settled: 7, total: 10, pct: 70,
    });
  });

  test("work the child still has time for is NOT settled", () => {
    expect(trackerCoverageOf(counters({ sheets: 8, awaiting: 4 }))).toEqual({ settled: 4, total: 8, pct: 50 });
  });

  test("checked-but-not-handed-back IS settled — the outcome is known", () => {
    expect(trackerCoverageOf(counters({ sheets: 5, pendingReturn: 5 })).pct).toBe(100);
  });

  test("a month with no work is vacuously complete, not 0 %", () => {
    expect(trackerCoverageOf(ZERO)).toEqual({ settled: 0, total: 0, pct: null });
  });
});

describe("MR-1 D-#394 — the fairness denominator", () => {
  test("submission is measured against what the child was PRESENT to receive", () => {
    // 10 issued, but 2 handed out while absent → 8 expected, 6 submitted = 75 %.
    const m = trackerMonthOf(panelOf(counters({ sheets: 10, received: 8, absentAtIssue: 2, submitted: 6 })));
    expect(m.issued).toBe(10);
    expect(m.expectedWhilePresent).toBe(8);
    expect(m.submissionRate).toBe(75);
    expect(m.notSubmittedDueToAbsence).toBe(2);
  });

  test("quality is correct ÷ settled outcomes, and PARTIAL is not half a pass here", () => {
    const m = trackerMonthOf(panelOf(counters({ sheets: 6, received: 6, submitted: 6, correct: 3, partial: 2, wrong: 1 })));
    expect(m.checked).toBe(6);
    expect(m.qualityRate).toBe(50);
  });

  test("per-subject rows carry the same denominators as the totals", () => {
    const m = trackerMonthOf(
      panelOf(counters({ sheets: 4, received: 3, submitted: 3, correct: 2, wrong: 1 }), [
        { ...counters({ sheets: 4, received: 3, submitted: 3, correct: 2, wrong: 1 }), subject: "MATH" },
      ]),
    );
    expect(m.bySubject[0]).toMatchObject({ subject: "MATH", issued: 4, expectedWhilePresent: 3, submissionRate: 100, qualityRate: 66.7 });
  });

  test("the fairness field reaches the SUBJECT row too, not just the total — owner ask, 2026-08-06", () => {
    // A guardian comment can name a subject's own absence-caused count; before this
    // it only ever saw the aggregate, so "ইংরেজিতে ২টি অনুপস্থিতির কারণে দেওয়া হয়নি"
    // had no field to cite even though the total already carried the number.
    const m = trackerMonthOf(
      panelOf(counters({ sheets: 5, received: 3, absentAtIssue: 2, submitted: 3 }), [
        { ...counters({ sheets: 5, received: 3, absentAtIssue: 2, submitted: 3 }), subject: "ENGLISH" },
      ]),
    );
    expect(m.bySubject[0]).toMatchObject({ subject: "ENGLISH", notSubmittedDueToAbsence: 2 });
  });

  test("nothing received yields a null rate, never a zero", () => {
    expect(trackerMonthOf(panelOf(counters({ sheets: 2, received: 0 }))).submissionRate).toBeNull();
  });
});

describe("MR-1 §5.6 — class test", () => {
  const results: StudentProfileResult[] = [
    ctResult({ subject: "BANGLA", examDate: "2026-07-05T00:00:00.000Z", marks: 8, totalMarks: 10 }),
    ctResult({ subject: "MATH", examDate: "2026-07-20T00:00:00.000Z", marks: 18, totalMarks: 20 }),
    ctResult({ subject: "MATH", examDate: "2026-07-25T00:00:00.000Z", status: "ABSENT", marks: null }),
    ctResult({ subject: "ENGLISH", examDate: "2026-07-28T00:00:00.000Z", marks: null }), // sat it, not marked yet
    ctResult({ subject: "BANGLA", examDate: "2026-06-30T00:00:00.000Z", marks: 2, totalMarks: 10 }), // last month
  ];
  const m = classTestMonthOf(results, "2026-07-01", "2026-07-31");

  test("only the month's exams are counted", () => {
    expect(m.testsHeld).toBe(4);
  });

  test("an ABSENT result is recorded as absence and scored as NOTHING", () => {
    expect(m.absent).toBe(1);
    expect(m.attended).toBe(3);
    // 8+18 of 10+20 — the absence adds no zero to either side.
    expect(m.marksObtained).toBe(26);
    expect(m.marksFull).toBe(30);
    expect(m.rate).toBe(86.7);
  });

  test("an unmarked exam is held out of the rate and drops coverage", () => {
    expect(m.unmarked).toBe(1);
    expect(m.coverage).toEqual({ settled: 3, total: 4, pct: 75 });
  });

  test("subjects are broken out and sorted", () => {
    expect(m.bySubject.map((r) => r.subject)).toEqual(["BANGLA", "ENGLISH", "MATH"]);
    expect(m.bySubject.find((r) => r.subject === "MATH")).toMatchObject({ testsHeld: 2, attended: 1, absent: 1, rate: 90 });
    expect(m.bySubject.find((r) => r.subject === "ENGLISH")).toMatchObject({ unmarked: 1, rate: null });
  });
});

describe("MR-1 §5.7 — Hifz reports what RevisionEntry actually stores", () => {
  const juz = (amountJuz: number, tanbih = 0, fath = 0, mistakes = { harf: 0, ghunnah: 0, madd: 0, other: 0 }) => ({
    amountJuz, tanbih, fath, mistakes,
  });

  test("sessions, presence, juz heard, prompts and mistakes are summed", () => {
    const h = hifzMonthOf([
      { date: new Date(2026, 6, 4), present: true, juzRecords: [juz(0.5, 1, 0, { harf: 2, ghunnah: 1, madd: 0, other: 0 })], teacherComment: "ভালো" },
      { date: new Date(2026, 6, 11), present: true, juzRecords: [juz(1, 0, 2)], teacherComment: "  " },
      { date: new Date(2026, 6, 18), present: false, juzRecords: [] },
    ]);
    expect(h).toMatchObject({ sessions: 3, present: 2, absent: 1, juzHeard: 1.5, tanbih: 1, fath: 2, mistakes: 3 });
  });

  test("the latest NON-EMPTY teacher note wins, whatever order the rows arrive in", () => {
    const h = hifzMonthOf([
      { date: new Date(2026, 6, 18), present: true, juzRecords: [], teacherComment: "   " },
      { date: new Date(2026, 6, 4), present: true, juzRecords: [], teacherComment: "প্রথম" },
      { date: new Date(2026, 6, 11), present: true, juzRecords: [], teacherComment: "দ্বিতীয়" },
    ]);
    expect(h.latestNote).toBe("দ্বিতীয়");
  });

  test("an empty month is zeroes, not nulls", () => {
    expect(hifzMonthOf([])).toMatchObject({ sessions: 0, present: 0, absent: 0, juzHeard: 0, latestNote: null });
  });
});

describe("MR-1 §5.9 — library", () => {
  const d = (s: string): Date => new Date(`${s}T09:00:00.000Z`);

  test("on-time vs late returns, and books still out at month end", () => {
    const lib = libraryMonthOf(
      [
        { issuedAt: d("2026-07-02"), dueDate: d("2026-07-16"), returnedAt: d("2026-07-15") }, // on time
        { issuedAt: d("2026-07-05"), dueDate: d("2026-07-19"), returnedAt: d("2026-07-24") }, // late
        { issuedAt: d("2026-07-20"), dueDate: d("2026-08-03"), returnedAt: null },            // still out, not due
        { issuedAt: d("2026-06-01"), dueDate: d("2026-06-15"), returnedAt: null },            // still out, overdue
      ],
      "2026-07-01",
      "2026-07-31",
    );
    expect(lib).toEqual({ taken: 3, returned: 2, returnedOnTime: 1, returnedLate: 1, overdue: 1, stillHeld: 2 });
  });

  test("a return AFTER the month does not count as returned in it", () => {
    const lib = libraryMonthOf([{ issuedAt: d("2026-07-10"), dueDate: d("2026-07-24"), returnedAt: d("2026-08-02") }], "2026-07-01", "2026-07-31");
    expect(lib).toMatchObject({ taken: 1, returned: 0, stillHeld: 1, overdue: 1 });
  });
});

describe("MR-1 D-#400 — a complaint is a CONCERN comment, nothing else", () => {
  const cs = [
    { type: "ATTENDANCE", sentiment: "CONCERN" },
    { type: "BEHAVIOUR", sentiment: "CONCERN" },
    { type: "BEHAVIOUR", sentiment: "CONCERN" },
    { type: "SERIOUS_MATTER", sentiment: "CONCERN" },
    { type: "GENERAL", sentiment: "POSITIVE" },
    { type: "STUDY_HOMEWORK", sentiment: "POSITIVE" },
  ];

  test("POSITIVE comments are never counted as complaints", () => {
    const c = concernsMonthOf(cs);
    expect(c.concern).toBe(4);
    expect(c.positive).toBe(2);
  });

  test("concerns break out by type, most frequent first", () => {
    expect(concernsMonthOf(cs).byType[0]).toEqual({ type: "BEHAVIOUR", count: 2 });
  });

  test("a serious matter is surfaced on its own", () => {
    expect(concernsMonthOf(cs).seriousMatters).toBe(1);
    expect(concernsMonthOf([{ type: "BEHAVIOUR", sentiment: "CONCERN" }]).seriousMatters).toBe(0);
  });
});

describe("MR-1 D-#396 — the cohort names nobody, and hides the best in a small section", () => {
  test("average and best over the values present", () => {
    expect(cohortOf([80, 90, 100, 70, 60])).toMatchObject({ avg: 80, best: 100, n: 5, bestWithheld: false });
  });

  test("a section below the minimum gets an average and NO best", () => {
    const c = cohortOf([80, 90, 100, 70]);
    expect(c.avg).toBe(85);
    expect(c.best).toBeNull();
    expect(c.bestWithheld).toBe(true);
  });

  test("nulls (children with no data) do not drag the average down", () => {
    expect(cohortOf([100, null, null, 50, null, null])).toMatchObject({ avg: 75, best: 100, n: 2 });
  });

  test("an empty cohort is null, never zero", () => {
    expect(cohortOf([null, null])).toEqual({ avg: null, best: null, n: 0, bestWithheld: false });
  });

  test("the ROSTER decides suppression, not how many children happen to have data", () => {
    // 6 on the roster, only 2 with numbers: the best is still safe to show.
    const row = (rate: number): StudentMonthMetrics =>
      ({
        attendance: { rate, present: 0 },
        homework: { submissionRate: null, qualityRate: null },
        assignment: { submissionRate: null, qualityRate: null },
        classTest: { rate: null },
      }) as unknown as StudentMonthMetrics;
    const rows = [row(90), row(70)];
    const cohort = cohortOfRows("sec", "2026-07", rows, 6);
    expect(cohort.attendanceRate).toMatchObject({ avg: 80, best: 90, bestWithheld: false });
    // Same two children in a section of 4 → withheld.
    expect(cohortOfRows("sec", "2026-07", rows, 4).attendanceRate.best).toBeNull();
  });
});

describe("MR-1 §5.3 — attendance", () => {
  const attendance = (days: Array<{ dateKey: string; absent: boolean; leaveCovered: boolean }>): StudentProfileAttendance => ({
    studentId: "s1", fromKey: "2026-07-01", toKey: "2026-07-31",
    markedDays: days.length,
    absentDays: days.filter((d) => d.absent).length,
    presentPct: 0,
    absentUncoveredDays: days.filter((d) => d.absent && !d.leaveCovered).length,
    absentStreakMax: 2,
    recentPresentPct: null, earlierPresentPct: null, trajectory: "na",
    monthly: [], days, leaves: [],
  });

  test("the leave-covered / uncovered split is carried, not collapsed", () => {
    const m = attendanceMonthOf(
      attendance([
        { dateKey: "2026-07-01", absent: false, leaveCovered: false },
        { dateKey: "2026-07-02", absent: true, leaveCovered: true },
        { dateKey: "2026-07-03", absent: true, leaveCovered: false },
        { dateKey: "2026-07-04", absent: false, leaveCovered: false },
      ]),
    );
    expect(m).toMatchObject({ schoolDays: 4, present: 2, absent: 2, absentLeaveCovered: 1, absentUncovered: 1, rate: 50 });
  });

  test("a weekday pattern is reported only when one day carries half the absences", () => {
    // Three of four absences on a Saturday (2026-07-04/11/18 are Saturdays).
    expect(
      weekdayPatternOf([
        { dateKey: "2026-07-04", absent: true },
        { dateKey: "2026-07-11", absent: true },
        { dateKey: "2026-07-18", absent: true },
        { dateKey: "2026-07-07", absent: true },
      ]),
    ).toEqual({ weekday: 6, absences: 3 });

    // One each on four different days — no pattern to report.
    expect(
      weekdayPatternOf([
        { dateKey: "2026-07-06", absent: true },
        { dateKey: "2026-07-07", absent: true },
        { dateKey: "2026-07-08", absent: true },
        { dateKey: "2026-07-09", absent: true },
      ]),
    ).toBeNull();

    expect(weekdayPatternOf([{ dateKey: "2026-07-06", absent: false }])).toBeNull();
  });
});

describe("MR-1 D-#401 — fees are payments only, and a reversed payment is not one", () => {
  test("a reversal drops BOTH itself and the posting it reverses", () => {
    const original = oid();
    const fees = feesMonthOf(
      [
        { _id: original, date: new Date(2026, 6, 8), amount: 1000, feeLines: [{ head: "TUITION", amount: 1000 }] },
        { _id: oid(), date: new Date(2026, 6, 9), amount: 1000, reversesPostingId: original },
        { _id: oid(), date: new Date(2026, 6, 12), amount: 500, feeLines: [{ head: "TUITION", amount: 300 }, { head: "EXAM", amount: 200 }] },
      ],
      [],
      [],
      new Date(2026, 6, 31),
    );
    expect(fees.paidTotal).toBe(500);
    expect(fees.byHead).toEqual([{ head: "EXAM", amount: 200 }, { head: "TUITION", amount: 300 }]);
    expect(fees.latestPaymentKey).toBe("2026-07-12");
  });

  test("year-to-date is summed over live postings too", () => {
    const original = oid();
    const fees = feesMonthOf(
      [],
      [
        { _id: original, amount: 800 },
        { _id: oid(), amount: 800, reversesPostingId: original },
        { _id: oid(), amount: 1200 },
      ],
      [],
      new Date(2026, 6, 31),
    );
    expect(fees.paidYearToDate).toBe(1200);
  });

  test("support is reported as the heads it covers, never as an invented taka figure", () => {
    const fees = feesMonthOf([], [], [{ coverage: [{ head: "TUITION" }, { head: "EXAM" }], endDate: null }], new Date(2026, 6, 31));
    expect(fees.supportHeads).toEqual(["EXAM", "TUITION"]);
  });

  test("an allocation that ended before the month does not count", () => {
    const fees = feesMonthOf([], [], [{ coverage: [{ head: "TUITION" }], endDate: new Date(2026, 5, 30) }], new Date(2026, 6, 31));
    expect(fees.supportHeads).toEqual([]);
  });

  test("no payments is zero with no latest date — never a fabricated due", () => {
    expect(feesMonthOf([], [], [], new Date(2026, 6, 31))).toEqual({
      paidTotal: 0, byHead: [], paidYearToDate: 0, latestPaymentKey: null, supportHeads: [],
    });
  });
});
