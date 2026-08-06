/**
 * MonthlyMetricsService (MR-1, docs/prd-monthly-report.md §5) — the month's NUMBERS
 * for one child, and the cohort comparators they are read against.
 *
 * It computes NOTHING that already exists: the per-subject homework/assignment
 * tallies, the attendance derivations and the class-test roll-up are the SP-1..SP-2
 * student-profile reads (D-#357–#360) called with a calendar-month window. What this
 * module adds is the month framing (§5.1), coverage (D-#394), the cohort comparators
 * (D-#396), and the four planes the profile never reported (Hifz, library, guardian
 * participation, fees paid).
 *
 * THREE RULES CARRIED FROM THE DECISIONS, because they are easy to lose in a refactor:
 *
 *   1. `expectedWhilePresent` is the submission denominator (D-#394). It is
 *      `TrackerCounters.received` — sheets whose trail ever reached GIVEN — so a child
 *      absent on hand-out day is not scored against work they never got. The raw
 *      `issued` count travels beside it, never instead of it.
 *   2. Coverage is `settled ÷ sheets`, and a report below the gate is PROVISIONAL
 *      (D-#394). Unchecked work must read as "not known yet", never as a decline.
 *   3. Cohort figures are NUMBERS ONLY, and `classBest` is withheld in a section
 *      below `minSectionSize` — in a section of six, "the best" is a person (D-#396).
 *
 * Everything is DERIVED at read time (D-#85); nothing here writes. Identity plane —
 * the corpus module imports none of it (ADR-005).
 */
import { Types } from "mongoose";
import { BookLoan } from "../../library/models/BookLoan";
import { FeeSupportAllocation } from "../../finance/models/FeeSupportAllocation";
import { FinancePosting } from "../../finance/models/FinancePosting";
import { GuardianNotice } from "../../chat/models/GuardianNotice";
import { RevisionEntry } from "../../saturday-revision/models/RevisionEntry";
import { Student } from "../../foundation/models/Student";
import { StudentAttendanceDay } from "../../attendance/models/StudentAttendanceDay";
import { dateKeyOf } from "../../attendance/dates";
import {
  studentProfileAttendance,
  studentProfileComments,
  defaultProfileWindow,
  type StudentProfileAttendance,
} from "../../trackers/services/StudentProfileContextService";
import {
  studentHomeworkPanel,
  studentAssignmentPanel,
  type StudentTrackerPanel,
  type TrackerCounters,
} from "../../trackers/services/StudentProfileService";
import {
  studentProfile as classTestProfile,
  type StudentProfileResult,
} from "../../trackers/services/ClassTestSummaryService";

// ---------------------------------------------------------------------------
// §5.1 The month window
// ---------------------------------------------------------------------------

const PERIOD_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidPeriodKey(periodKey: string): boolean {
  return PERIOD_KEY.test(periodKey);
}

/** `YYYY-MM` → the calendar month's inclusive date-key bounds. */
export function monthWindowOf(periodKey: string): { fromKey: string; toKey: string } {
  if (!isValidPeriodKey(periodKey)) throw new Error(`Invalid period key: ${periodKey}`);
  const [y, m] = periodKey.split("-").map(Number);
  // Day 0 of the NEXT month is the last day of this one — no month-length table,
  // and February/leap years fall out for free.
  const last = new Date(y, m, 0);
  return { fromKey: `${periodKey}-01`, toKey: dateKeyOf(last) };
}

export function previousPeriodKey(periodKey: string): string {
  if (!isValidPeriodKey(periodKey)) throw new Error(`Invalid period key: ${periodKey}`);
  const [y, m] = periodKey.split("-").map(Number);
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

/** The period a date falls in. */
export function periodKeyOf(d: Date): string {
  return dateKeyOf(d).slice(0, 7);
}

// ---------------------------------------------------------------------------
// Coverage (D-#394)
// ---------------------------------------------------------------------------

export interface Coverage {
  settled: number;
  total: number;
  /** 0–100, or null when there was nothing to settle (vacuously complete). */
  pct: number | null;
}

const pct = (num: number, den: number): number | null =>
  den === 0 ? null : Math.round((num / den) * 1000) / 10;

/**
 * A sheet is SETTLED once its outcome is knowable: returned, checked, not submitted,
 * or never received. It is UNSETTLED while the teacher owes a check (`pendingChecking`)
 * or the child still has time (`awaiting`) — those are the two states that make a
 * month-end number a lie if reported as final.
 */
export function trackerCoverageOf(c: TrackerCounters): Coverage {
  const unsettled = c.pendingChecking + c.awaiting;
  const settled = Math.max(0, c.sheets - unsettled);
  return { settled, total: c.sheets, pct: pct(settled, c.sheets) };
}

// ---------------------------------------------------------------------------
// §5.6 Class test — the month's slice of the (window-less) profile read
// ---------------------------------------------------------------------------

export interface ClassTestSubjectMonth {
  subject: string;
  testsHeld: number;
  attended: number;
  absent: number;
  marksObtained: number;
  marksFull: number;
  /** Percent of the full marks of the tests they SAT (absences are not zeroes). */
  rate: number | null;
  unmarked: number;
}

export interface ClassTestMonth {
  testsHeld: number;
  attended: number;
  absent: number;
  marksObtained: number;
  marksFull: number;
  rate: number | null;
  unmarked: number;
  coverage: Coverage;
  bySubject: ClassTestSubjectMonth[];
}

/**
 * PURE. `ClassTestSummaryService.studentProfile` has no window (it answers "this
 * child, all year"), so the month is sliced here on `examDate`.
 *
 * An ABSENT result contributes to `absent` and to NOTHING else — it is not a zero
 * (the D-#377 posture: absence is recorded, never scored). A PRESENT result with no
 * marks yet is `unmarked`: counted in `testsHeld`, excluded from the rate, and it is
 * what drops class-test coverage below the gate at month end.
 */
export function classTestMonthOf(
  results: readonly StudentProfileResult[],
  fromKey: string,
  toKey: string,
): ClassTestMonth {
  const inWindow = results.filter((r) => {
    const key = r.examDate.slice(0, 10);
    return key >= fromKey && key <= toKey;
  });

  const bySubjectAcc = new Map<string, ClassTestSubjectMonth>();
  const blank = (subject: string): ClassTestSubjectMonth => ({
    subject, testsHeld: 0, attended: 0, absent: 0, marksObtained: 0, marksFull: 0, rate: null, unmarked: 0,
  });

  let testsHeld = 0;
  let attended = 0;
  let absent = 0;
  let marksObtained = 0;
  let marksFull = 0;
  let unmarked = 0;

  for (const r of inWindow) {
    const row = bySubjectAcc.get(r.subject) ?? bySubjectAcc.set(r.subject, blank(r.subject)).get(r.subject)!;
    testsHeld += 1;
    row.testsHeld += 1;
    if (r.status === "ABSENT") {
      absent += 1;
      row.absent += 1;
      continue;
    }
    attended += 1;
    row.attended += 1;
    if (r.marks == null) {
      unmarked += 1;
      row.unmarked += 1;
      continue;
    }
    marksObtained += r.marks;
    marksFull += r.totalMarks;
    row.marksObtained += r.marks;
    row.marksFull += r.totalMarks;
  }

  const bySubject = [...bySubjectAcc.values()]
    .map((row) => ({ ...row, rate: pct(row.marksObtained, row.marksFull) }))
    .sort((a, b) => a.subject.localeCompare(b.subject));

  return {
    testsHeld, attended, absent, marksObtained, marksFull,
    rate: pct(marksObtained, marksFull),
    unmarked,
    // A test is settled once its marks are in; an absence is settled by definition.
    coverage: { settled: testsHeld - unmarked, total: testsHeld, pct: pct(testsHeld - unmarked, testsHeld) },
    bySubject,
  };
}

// ---------------------------------------------------------------------------
// §5.7 Saturday revision (Hifz)
// ---------------------------------------------------------------------------

export interface HifzMonth {
  sessions: number;
  present: number;
  absent: number;
  /** Juz heard across the month (the `amountJuz` sum — 1.5 juz over two records = 1.5). */
  juzHeard: number;
  tanbih: number;
  fath: number;
  mistakes: number;
  latestNote: string | null;
}

/** The slice of `RevisionEntry` this report reads. */
export interface HifzEntryShape {
  date: Date;
  present: boolean;
  juzRecords?: Array<{
    amountJuz: number;
    tanbih: number;
    fath: number;
    mistakes: { harf: number; ghunnah: number; madd: number; other: number };
  }>;
  teacherComment?: string | null;
}

/** PURE. `RevisionEntry` carries no grade — effort (`amountJuz`), prompts
 *  (tanbih/fath) and structured tajweed mistakes are what it actually records, so
 *  those are what the report states. No evaluation band is invented. */
export function hifzMonthOf(entries: readonly HifzEntryShape[]): HifzMonth {
  const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());
  let present = 0;
  let juzHeard = 0;
  let tanbih = 0;
  let fath = 0;
  let mistakes = 0;
  let latestNote: string | null = null;

  for (const e of sorted) {
    if (e.present) present += 1;
    for (const j of e.juzRecords ?? []) {
      juzHeard += j.amountJuz;
      tanbih += j.tanbih;
      fath += j.fath;
      mistakes += j.mistakes.harf + j.mistakes.ghunnah + j.mistakes.madd + j.mistakes.other;
    }
    const note = (e.teacherComment ?? "").trim();
    if (note) latestNote = note;
  }

  return {
    sessions: sorted.length,
    present,
    absent: sorted.length - present,
    juzHeard: Math.round(juzHeard * 100) / 100,
    tanbih,
    fath,
    mistakes,
    latestNote,
  };
}

// ---------------------------------------------------------------------------
// §5.9 Library
// ---------------------------------------------------------------------------

export interface LibraryMonth {
  taken: number;
  returned: number;
  returnedOnTime: number;
  returnedLate: number;
  /** Still out at the end of the month AND past its due date. */
  overdue: number;
  stillHeld: number;
}

/** PURE. OVERDUE is derived from `dueDate`, never stored (the LB-5 rule). */
export function libraryMonthOf(
  loans: readonly { issuedAt: Date; dueDate: Date; returnedAt?: Date | null }[],
  fromKey: string,
  toKey: string,
): LibraryMonth {
  let taken = 0;
  let returned = 0;
  let returnedOnTime = 0;
  let overdue = 0;
  let stillHeld = 0;

  for (const l of loans) {
    const issuedKey = dateKeyOf(l.issuedAt);
    const returnedKey = l.returnedAt ? dateKeyOf(l.returnedAt) : null;
    if (issuedKey >= fromKey && issuedKey <= toKey) taken += 1;
    if (returnedKey && returnedKey >= fromKey && returnedKey <= toKey) {
      returned += 1;
      if (returnedKey <= dateKeyOf(l.dueDate)) returnedOnTime += 1;
    }
    // Open at the month's end (returned later, or not at all).
    if (issuedKey <= toKey && (!returnedKey || returnedKey > toKey)) {
      stillHeld += 1;
      if (dateKeyOf(l.dueDate) < toKey) overdue += 1;
    }
  }

  return { taken, returned, returnedOnTime, returnedLate: returned - returnedOnTime, overdue, stillHeld };
}

// ---------------------------------------------------------------------------
// §5.8 Concerns (D-#400)
// ---------------------------------------------------------------------------

export interface ConcernsMonth {
  concern: number;
  positive: number;
  byType: Array<{ type: string; count: number }>;
  seriousMatters: number;
}

/** PURE. A complaint is a CONCERN comment — nothing else (D-#400). The POSITIVE
 *  tally travels with it so the section cannot read as a charge sheet. */
export function concernsMonthOf(
  comments: readonly { type: string; sentiment: string }[],
): ConcernsMonth {
  const byTypeAcc = new Map<string, number>();
  let concern = 0;
  let positive = 0;
  let seriousMatters = 0;

  for (const c of comments) {
    if (c.sentiment === "POSITIVE") {
      positive += 1;
      continue;
    }
    if (c.sentiment !== "CONCERN") continue;
    concern += 1;
    byTypeAcc.set(c.type, (byTypeAcc.get(c.type) ?? 0) + 1);
    if (c.type === "SERIOUS_MATTER") seriousMatters += 1;
  }

  return {
    concern,
    positive,
    byType: [...byTypeAcc.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    seriousMatters,
  };
}

// ---------------------------------------------------------------------------
// §5.2 Cohort comparators (D-#396)
// ---------------------------------------------------------------------------

export interface CohortStat {
  avg: number | null;
  /** Withheld (null) when the cohort is too small to hide a person. */
  best: number | null;
  /** How many students actually contributed a value. */
  n: number;
  /** True when `best` was withheld by the small-section rule, not by absent data. */
  bestWithheld: boolean;
}

export const DEFAULT_MIN_SECTION_FOR_BEST = 5;

/** PURE. Numbers only — no student is named, and none is identifiable in a section
 *  smaller than `minSize` (D-#396). */
export function cohortOf(
  values: readonly (number | null)[],
  minSize: number = DEFAULT_MIN_SECTION_FOR_BEST,
): CohortStat {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return { avg: null, best: null, n: 0, bestWithheld: false };
  const avg = Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 10) / 10;
  // The roster size is what identifies a child, not how many happened to have data.
  const withheld = values.length < minSize;
  return {
    avg,
    best: withheld ? null : Math.max(...present),
    n: present.length,
    bestWithheld: withheld,
  };
}

// ---------------------------------------------------------------------------
// The per-student metric block
// ---------------------------------------------------------------------------

export interface AttendanceMonth {
  schoolDays: number;
  present: number;
  absent: number;
  absentLeaveCovered: number;
  absentUncovered: number;
  absentStreakMax: number;
  rate: number | null;
  /** The weekday carrying most absences, when it accounts for >= half of them. */
  weekdayPattern: { weekday: number; absences: number } | null;
}

export interface TrackerMonth {
  issued: number;
  expectedWhilePresent: number;
  submitted: number;
  submissionRate: number | null;
  checked: number;
  correct: number;
  partial: number;
  wrong: number;
  qualityRate: number | null;
  resubmissions: number;
  notSubmittedDueToAbsence: number;
  remindersSent: number;
  coverage: Coverage;
  bySubject: Array<{
    subject: string;
    issued: number;
    expectedWhilePresent: number;
    submitted: number;
    submissionRate: number | null;
    checked: number;
    correct: number;
    partial: number;
    wrong: number;
    qualityRate: number | null;
    /** Sheets issued to this subject while the child was absent, never yet
     *  re-delivered — the same fairness field the total already carried
     *  (D-#399), now visible per subject too (owner ask, 2026-08-06). */
    notSubmittedDueToAbsence: number;
  }>;
}

export interface ParticipationMonth {
  /** Reminders the school sent the family about this child's work. */
  remindersSent: number;
  /** Notices addressed to the child's section or the whole school. */
  noticesSent: number;
  phoneOnFile: boolean;
}

export interface FeesMonth {
  paidTotal: number;
  byHead: Array<{ head: string; amount: number }>;
  paidYearToDate: number;
  latestPaymentKey: string | null;
  /** An ACTIVE support/waiver allocation covering the month, by head. */
  supportHeads: string[];
}

export interface StudentMonthMetrics {
  studentId: string;
  periodKey: string;
  fromKey: string;
  toKey: string;
  attendance: AttendanceMonth;
  homework: TrackerMonth;
  assignment: TrackerMonth;
  classTest: ClassTestMonth;
  hifz: HifzMonth;
  concerns: ConcernsMonth;
  library: LibraryMonth;
  participation: ParticipationMonth;
  fees: FeesMonth;
  /** True when the caller was narrowed to their own subjects (§4). */
  fullView: boolean;
  subjectFilter: string[];
}

/** PURE. The absence weekday pattern — reported only when one weekday carries at
 *  least half of the month's absences, so a 2-and-2 split says nothing. */
export function weekdayPatternOf(
  days: readonly { dateKey: string; absent: boolean }[],
): { weekday: number; absences: number } | null {
  const counts = new Map<number, number>();
  let total = 0;
  for (const d of days) {
    if (!d.absent) continue;
    total += 1;
    const [y, m, dd] = d.dateKey.split("-").map(Number);
    const wd = new Date(y, m - 1, dd).getDay();
    counts.set(wd, (counts.get(wd) ?? 0) + 1);
  }
  if (total === 0) return null;
  let bestDay = -1;
  let bestCount = 0;
  for (const [wd, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      bestDay = wd;
    }
  }
  return bestCount * 2 >= total ? { weekday: bestDay, absences: bestCount } : null;
}

/** PURE. `TrackerCounters` → the month block, with the D-#394 denominators. */
export function trackerMonthOf(panel: StudentTrackerPanel): TrackerMonth {
  const t = panel.totals;
  const settledOutcomes = t.correct + t.partial + t.wrong;
  return {
    issued: t.sheets,
    expectedWhilePresent: t.received,
    submitted: t.submitted,
    submissionRate: pct(t.submitted, t.received),
    checked: settledOutcomes,
    correct: t.correct,
    partial: t.partial,
    wrong: t.wrong,
    qualityRate: pct(t.correct, settledOutcomes),
    resubmissions: t.resubmissions,
    notSubmittedDueToAbsence: t.absentAtIssue,
    remindersSent: t.chaseTotal,
    coverage: trackerCoverageOf(t),
    bySubject: panel.bySubject.map((r) => ({
      subject: r.subject,
      issued: r.sheets,
      expectedWhilePresent: r.received,
      submitted: r.submitted,
      submissionRate: pct(r.submitted, r.received),
      checked: r.correct + r.partial + r.wrong,
      correct: r.correct,
      partial: r.partial,
      wrong: r.wrong,
      qualityRate: pct(r.correct, r.correct + r.partial + r.wrong),
      notSubmittedDueToAbsence: r.absentAtIssue,
    })),
  };
}

/** PURE. The attendance block from the SP-2 read — one definition, shared (D-#359). */
export function attendanceMonthOf(a: StudentProfileAttendance): AttendanceMonth {
  const leaveCovered = a.days.filter((d) => d.absent && d.leaveCovered).length;
  return {
    schoolDays: a.markedDays,
    present: a.markedDays - a.absentDays,
    absent: a.absentDays,
    absentLeaveCovered: leaveCovered,
    absentUncovered: a.absentUncoveredDays,
    absentStreakMax: a.absentStreakMax,
    rate: pct(a.markedDays - a.absentDays, a.markedDays),
    weekdayPattern: weekdayPatternOf(a.days),
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface MetricsOptions {
  /** §4 narrowing, passed straight through to the tracker panels. */
  subjects?: readonly string[] | null;
  now?: Date;
}

/**
 * One child, one month. Every plane is read with the SAME window, so the sheet
 * reconciles with the student profile for the same range.
 */
export async function studentMonthMetrics(
  studentId: string,
  periodKey: string,
  opts: MetricsOptions = {},
): Promise<StudentMonthMetrics> {
  const { fromKey, toKey } = monthWindowOf(periodKey);
  const now = opts.now ?? new Date();
  const oid = new Types.ObjectId(studentId);

  const [attendance, homework, assignment, ct, comments, student, year] = await Promise.all([
    studentProfileAttendance(studentId, fromKey, toKey),
    studentHomeworkPanel(studentId, { fromKey, toKey, subjects: opts.subjects, now }),
    studentAssignmentPanel(studentId, { fromKey, toKey, subjects: opts.subjects, now }),
    classTestProfile(studentId, opts.subjects ?? null),
    studentProfileComments(studentId, fromKey, toKey),
    Student.findById(studentId).select("phone sectionId").lean() as Promise<
      { phone?: string; sectionId: Types.ObjectId } | null
    >,
    defaultProfileWindow(now),
  ]);

  const monthStart = new Date(`${fromKey}T00:00:00.000Z`);
  const monthEnd = new Date(`${toKey}T23:59:59.999Z`);

  const [hifzDocs, loanDocs, feeDocs, ytdFeeDocs, supportDocs, noticeCount] = await Promise.all([
    RevisionEntry.find({ studentId: oid, date: { $gte: monthStart, $lte: monthEnd } })
      .select("date present juzRecords teacherComment")
      .lean() as Promise<HifzEntryShape[]>,
    // Every loan that could still be open at month end, plus the month's activity.
    BookLoan.find({ studentId: oid, issuedAt: { $lte: monthEnd } })
      .select("issuedAt dueDate returnedAt")
      .lean() as Promise<Array<{ issuedAt: Date; dueDate: Date; returnedAt?: Date }>>,
    FinancePosting.find({ studentId: oid, kind: "FEE_COLLECTION", date: { $gte: monthStart, $lte: monthEnd } })
      .select("date amount feeLines reversesPostingId")
      .lean() as Promise<Array<{ _id: Types.ObjectId; date: Date; amount: number; feeLines?: Array<{ head: string; amount: number }>; reversesPostingId?: Types.ObjectId }>>,
    year
      ? (FinancePosting.find({
          studentId: oid,
          kind: "FEE_COLLECTION",
          date: { $gte: new Date(`${year.fromKey}T00:00:00.000Z`), $lte: monthEnd },
        })
          .select("amount reversesPostingId")
          .lean() as Promise<Array<{ _id: Types.ObjectId; amount: number; reversesPostingId?: Types.ObjectId }>>)
      : Promise.resolve([]),
    FeeSupportAllocation.find({ studentId: oid, status: "ACTIVE", effectiveDate: { $lte: monthEnd } })
      .select("coverage endDate")
      .lean() as Promise<Array<{ coverage?: Array<{ head: string }>; endDate?: Date | null }>>,
    student
      ? GuardianNotice.countDocuments({
          createdAt: { $gte: monthStart, $lte: monthEnd },
          $or: [{ sectionId: student.sectionId }, { sectionId: { $exists: false } }, { sectionId: null }],
        })
      : Promise.resolve(0),
  ]);

  return {
    studentId,
    periodKey,
    fromKey,
    toKey,
    attendance: attendanceMonthOf(attendance),
    homework: trackerMonthOf(homework),
    assignment: trackerMonthOf(assignment),
    classTest: classTestMonthOf(ct.results, fromKey, toKey),
    hifz: hifzMonthOf(hifzDocs),
    concerns: concernsMonthOf(comments.comments),
    library: libraryMonthOf(loanDocs, fromKey, toKey),
    participation: {
      remindersSent: homework.totals.chaseTotal + assignment.totals.chaseTotal,
      noticesSent: noticeCount,
      phoneOnFile: !!student?.phone,
    },
    fees: feesMonthOf(feeDocs, ytdFeeDocs, supportDocs, monthEnd),
    fullView: homework.fullView,
    subjectFilter: homework.subjectFilter,
  };
}

/**
 * PURE-ish fee fold. A REVERSAL posting and the posting it reverses both drop out —
 * a refunded collection is not money the family paid (finance stores no balances,
 * D-#222/#225, so every figure here is a sum of live postings).
 */
export function feesMonthOf(
  month: readonly { _id: Types.ObjectId; date: Date; amount: number; feeLines?: Array<{ head: string; amount: number }>; reversesPostingId?: Types.ObjectId }[],
  ytd: readonly { _id: Types.ObjectId; amount: number; reversesPostingId?: Types.ObjectId }[],
  support: readonly { coverage?: Array<{ head: string }>; endDate?: Date | null }[],
  monthEnd: Date,
): FeesMonth {
  const live = <T extends { _id: Types.ObjectId; reversesPostingId?: Types.ObjectId }>(rows: readonly T[]): T[] => {
    const reversed = new Set(rows.filter((r) => r.reversesPostingId).map((r) => r.reversesPostingId!.toString()));
    return rows.filter((r) => !r.reversesPostingId && !reversed.has(r._id.toString()));
  };

  const liveMonth = live(month);
  const byHeadAcc = new Map<string, number>();
  let paidTotal = 0;
  let latestPaymentKey: string | null = null;

  for (const p of liveMonth) {
    paidTotal += p.amount;
    for (const l of p.feeLines ?? []) byHeadAcc.set(l.head, (byHeadAcc.get(l.head) ?? 0) + l.amount);
    const key = dateKeyOf(p.date);
    if (!latestPaymentKey || key > latestPaymentKey) latestPaymentKey = key;
  }

  const supportHeads = [
    ...new Set(
      support
        .filter((s) => !s.endDate || new Date(s.endDate).getTime() >= monthEnd.getTime())
        .flatMap((s) => (s.coverage ?? []).map((c) => c.head)),
    ),
  ].sort();

  return {
    paidTotal,
    byHead: [...byHeadAcc.entries()].map(([head, amount]) => ({ head, amount })).sort((a, b) => a.head.localeCompare(b.head)),
    paidYearToDate: live(ytd).reduce((s, p) => s + p.amount, 0),
    latestPaymentKey,
    supportHeads,
  };
}

// ---------------------------------------------------------------------------
// The section pass — one cohort computation shared by every child in it
// ---------------------------------------------------------------------------

export interface SectionCohort {
  sectionId: string;
  periodKey: string;
  rosterSize: number;
  attendanceRate: CohortStat;
  attendancePresentDays: CohortStat;
  homeworkSubmission: CohortStat;
  homeworkQuality: CohortStat;
  assignmentSubmission: CohortStat;
  assignmentQuality: CohortStat;
  classTestRate: CohortStat;
}

export interface SectionMonthMetrics {
  sectionId: string;
  periodKey: string;
  cohort: SectionCohort;
  rows: StudentMonthMetrics[];
}

/**
 * Every child in one section, plus the cohort derived from THOSE SAME numbers.
 *
 * The cohort is computed once per (section × month) and shared by every report in
 * it — computing it per student would re-derive the whole section N times, which is
 * the N² this shape exists to avoid.
 *
 * Always computed on the FULL view: a comparator narrowed to the caller's subjects
 * would silently mean something different for each reader.
 */
export async function sectionMonthMetrics(
  sectionId: string,
  periodKey: string,
  opts: { now?: Date } = {},
): Promise<SectionMonthMetrics> {
  const students = (await Student.find({ sectionId: new Types.ObjectId(sectionId) })
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;

  const rows: StudentMonthMetrics[] = [];
  for (const s of students) {
    rows.push(await studentMonthMetrics(s._id.toString(), periodKey, { now: opts.now }));
  }

  return {
    sectionId,
    periodKey,
    cohort: cohortOfRows(sectionId, periodKey, rows, students.length),
    rows,
  };
}

/** PURE. The comparators, from the section's own computed rows (D-#396). */
export function cohortOfRows(
  sectionId: string,
  periodKey: string,
  rows: readonly StudentMonthMetrics[],
  rosterSize: number = rows.length,
  minSize: number = DEFAULT_MIN_SECTION_FOR_BEST,
): SectionCohort {
  const pad = <T>(values: T[]): (T | null)[] => {
    // The cohort's SIZE is the roster, so a small section keeps its best withheld
    // even when only a few children have data.
    const out: (T | null)[] = [...values];
    while (out.length < rosterSize) out.push(null);
    return out;
  };
  const col = (pick: (r: StudentMonthMetrics) => number | null): CohortStat =>
    cohortOf(pad(rows.map(pick)), minSize);

  return {
    sectionId,
    periodKey,
    rosterSize,
    attendanceRate: col((r) => r.attendance.rate),
    attendancePresentDays: col((r) => r.attendance.present),
    homeworkSubmission: col((r) => r.homework.submissionRate),
    homeworkQuality: col((r) => r.homework.qualityRate),
    assignmentSubmission: col((r) => r.assignment.submissionRate),
    assignmentQuality: col((r) => r.assignment.qualityRate),
    classTestRate: col((r) => r.classTest.rate),
  };
}

/**
 * §5.2 — the highest present-day count of ANY student in the school this month, as a
 * bare number. Computed from the absent-only attendance days (the same arithmetic the
 * per-student history uses: enrolled minus listed absentees), so one query answers it
 * for the whole school rather than 91 history reads.
 */
export async function schoolBestPresentDays(periodKey: string): Promise<number | null> {
  const { fromKey, toKey } = monthWindowOf(periodKey);

  const [days, students] = await Promise.all([
    StudentAttendanceDay.find({ dateKey: { $gte: fromKey, $lte: toKey }, sectionId: { $exists: true } })
      .select("sectionId dateKey absentStudentIds")
      .lean() as Promise<Array<{ sectionId: Types.ObjectId; dateKey: string; absentStudentIds: Types.ObjectId[] }>>,
    Student.find({}).select("_id sectionId").lean() as Promise<Array<{ _id: Types.ObjectId; sectionId: Types.ObjectId }>>,
  ]);
  if (days.length === 0 || students.length === 0) return null;

  const markedBySection = new Map<string, number>();
  const absencesByStudent = new Map<string, number>();
  for (const d of days) {
    const sec = d.sectionId.toString();
    markedBySection.set(sec, (markedBySection.get(sec) ?? 0) + 1);
    for (const sid of d.absentStudentIds) {
      const k = sid.toString();
      absencesByStudent.set(k, (absencesByStudent.get(k) ?? 0) + 1);
    }
  }

  let best: number | null = null;
  for (const s of students) {
    const marked = markedBySection.get(s.sectionId.toString());
    if (!marked) continue; // no attendance taken for this section this month
    const present = marked - (absencesByStudent.get(s._id.toString()) ?? 0);
    if (best == null || present > best) best = present;
  }
  return best;
}
