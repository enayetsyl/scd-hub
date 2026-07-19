/**
 * WholePictureService — the cross-tracker view of ONE student (the CT-10 follow-up
 * deferred in D-#277).
 *
 * Four core trackers, one read:
 *   class test  — the only tracker that already computes a trajectory. Reused whole
 *                 (`studentProfile().analytics`), not recomputed.
 *   homework    — completion and chase behaviour from `HomeworkStudentRecord`.
 *   assignment  — lateness and marks from `childAssignments`.
 *   attendance  — present % from `studentAttendanceHistory`, plus a recent-vs-earlier
 *                 split so a slide shows up before the term average moves.
 *
 * WHY THESE FOUR: homework and assignment *behaviour* is the earliest warning signal —
 * a child stops submitting long before their marks fall. Reading marks alone would spot
 * the problem a term late.
 *
 * `overall` is deliberately conservative: one bad signal is noise, so it only reads
 * "declining" when the academic trajectory is down OR two independent signals are weak.
 *
 * DERIVED AT READ TIME, never stored (D-#85). Identity plane; imports no corpus model,
 * so the ADR-005 firewall is untouched.
 */
import { HW_SUBJECT_LABELS_BN, HW_SUBJECT_LABELS_EN } from "@scd/shared";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { studentProfile, regressionSlope, type StudentProfileAnalytics } from "./ClassTestSummaryService";
import { childAssignments } from "./AssignmentSummaryService";
import { studentAttendanceHistory } from "../../attendance/services/AttendanceReportService";
import { dateKeyOf } from "../../attendance/dates";

/** Homework states that are still open — the child owes work. */
const OPEN_HW_STATES = new Set(["GIVEN", "DUE", "CHASE", "RESUBMIT", "ABSENT_REDELIVER"]);
/** Homework states that closed cleanly. */
const DONE_HW_STATES = new Set(["CHECKED", "RETURNED"]);

/** Below this, presence is a concern worth naming. */
export const ATTENDANCE_CONCERN_PCT = 90;
/** Below this, homework completion is a concern. */
export const HOMEWORK_CONCERN_PCT = 80;

export interface HomeworkPicture {
  total: number;
  open: number;
  done: number;
  /** Records that needed at least one chase. */
  chased: number;
  /** done / total, 0–100; null when nothing was ever set. */
  completionPct: number | null;
}

export interface AssignmentPicture {
  total: number;
  pending: number;
  late: number;
  /** Mean of marks/totalMarks over graded entries, 0–100; null when none graded. */
  avgMarksPct: number | null;
}

export interface AttendancePicture {
  markedDays: number;
  absentDays: number;
  presentPct: number;
  /** Present % over the most recent half of the window, vs the earlier half. */
  recentPresentPct: number | null;
  earlierPresentPct: number | null;
  /** "up" | "steady" | "down" | "na" — recent vs earlier. */
  trajectory: string;
}

export type Signal = "ACADEMIC_DECLINING" | "AT_RISK" | "ATTENDANCE_LOW" | "HOMEWORK_LOW" | "ASSIGNMENT_LATE";

export interface WholePicture {
  studentId: string;
  studentName: string;
  fromKey: string;
  toKey: string;
  classTest: StudentProfileAnalytics;
  homework: HomeworkPicture;
  assignment: AssignmentPicture;
  attendance: AttendancePicture;
  /** Machine-readable concerns; the app renders them, the guardian summary phrases them. */
  signals: Signal[];
  /** "improving" | "steady" | "declining" | "na" — the conservative roll-up. */
  overall: string;
}

const pct = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 100));

/** A slope over the attendance halves, expressed like the class-test trajectory. */
function trajectoryOf(slope: number | null, deadband = 0.5): string {
  if (slope === null) return "na";
  if (slope > deadband) return "up";
  if (slope < -deadband) return "down";
  return "steady";
}

// ---------------------------------------------------------------------------
// Per-tracker panels
// ---------------------------------------------------------------------------

async function homeworkPicture(studentId: string, from: Date, to: Date): Promise<HomeworkPicture> {
  const records = await HomeworkStudentRecord.find({ studentId })
    .select("state chaseCount dueDate createdAt")
    .lean();
  // The record has no single "given" date field, so window on dueDate when present and
  // fall back to createdAt — both are within the same school day in practice.
  const inWindow = records.filter((r) => {
    const at = new Date((r.dueDate ?? r.createdAt) as Date).getTime();
    return at >= from.getTime() && at <= to.getTime();
  });
  const open = inWindow.filter((r) => OPEN_HW_STATES.has(r.state)).length;
  const done = inWindow.filter((r) => DONE_HW_STATES.has(r.state)).length;
  const chased = inWindow.filter((r) => (r.chaseCount ?? 0) > 0).length;
  return { total: inWindow.length, open, done, chased, completionPct: pct(done, inWindow.length) };
}

async function assignmentPicture(studentId: string, to: Date): Promise<AssignmentPicture> {
  const entries = await childAssignments(studentId, to);
  const graded = entries.filter((e) => e.marks !== null && e.totalMarks !== null && e.totalMarks > 0);
  const avgMarksPct =
    graded.length === 0
      ? null
      : Math.round(graded.reduce((a, e) => a + (e.marks! / e.totalMarks!) * 100, 0) / graded.length);
  return {
    total: entries.length,
    pending: entries.filter((e) => e.pending).length,
    late: entries.filter((e) => e.daysLate > 0).length,
    avgMarksPct,
  };
}

async function attendancePicture(studentId: string, fromKey: string, toKey: string): Promise<AttendancePicture> {
  const history = await studentAttendanceHistory(studentId, fromKey, toKey);
  const days = history.days; // already sorted oldest → newest
  const half = Math.floor(days.length / 2);
  const presentPctOf = (slice: typeof days): number | null =>
    slice.length === 0 ? null : pct(slice.filter((d) => !d.absent).length, slice.length);

  const earlier = half > 0 ? presentPctOf(days.slice(0, half)) : null;
  const recent = half > 0 ? presentPctOf(days.slice(half)) : null;
  // Two points → the slope IS the difference; reuse the one primitive rather than a
  // second definition of "improving".
  const slope = earlier !== null && recent !== null ? regressionSlope([earlier, recent]) : null;

  return {
    markedDays: history.markedDays,
    absentDays: history.absentDays,
    presentPct: history.presentPct,
    recentPresentPct: recent,
    earlierPresentPct: earlier,
    trajectory: trajectoryOf(slope, 2), // ±2 percentage points is noise
  };
}

// ---------------------------------------------------------------------------
// The roll-up
// ---------------------------------------------------------------------------

/** Pure: the concerns raised by the four panels. Unit-tested directly. */
export function signalsOf(p: {
  classTest: Pick<StudentProfileAnalytics, "trajectory" | "atRisk">;
  homework: Pick<HomeworkPicture, "completionPct">;
  assignment: Pick<AssignmentPicture, "late" | "total">;
  attendance: Pick<AttendancePicture, "presentPct" | "markedDays">;
}): Signal[] {
  const out: Signal[] = [];
  if (p.classTest.atRisk) out.push("AT_RISK");
  if (p.classTest.trajectory === "down") out.push("ACADEMIC_DECLINING");
  if (p.attendance.markedDays > 0 && p.attendance.presentPct < ATTENDANCE_CONCERN_PCT) {
    out.push("ATTENDANCE_LOW");
  }
  if (p.homework.completionPct !== null && p.homework.completionPct < HOMEWORK_CONCERN_PCT) {
    out.push("HOMEWORK_LOW");
  }
  // Late on more than a third of assignments, and enough of them to mean something.
  if (p.assignment.total >= 3 && p.assignment.late * 3 > p.assignment.total) {
    out.push("ASSIGNMENT_LATE");
  }
  return out;
}

/**
 * Pure: the conservative roll-up. A single weak signal is noise — a child has an off
 * fortnight. It reads "declining" only when the academic trajectory itself is down, or
 * when TWO independent behaviour signals fire together.
 */
export function overallOf(classTestTrajectory: string, signals: Signal[]): string {
  if (signals.includes("AT_RISK") || classTestTrajectory === "down") return "declining";
  const behaviour = signals.filter((s) => s !== "AT_RISK" && s !== "ACADEMIC_DECLINING").length;
  if (behaviour >= 2) return "declining";
  if (classTestTrajectory === "up") return "improving";
  if (classTestTrajectory === "na") return signals.length > 0 ? "steady" : "na";
  return "steady";
}

/** Default look-back: one term-ish window. */
export const WHOLE_PICTURE_DAYS = 90;

export async function wholePicture(studentId: string, now: Date = new Date()): Promise<WholePicture> {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - WHOLE_PICTURE_DAYS);
  const fromKey = dateKeyOf(from);
  const toKey = dateKeyOf(now);

  const [profile, homework, assignment, attendance] = await Promise.all([
    studentProfile(studentId),
    homeworkPicture(studentId, from, now),
    assignmentPicture(studentId, now),
    attendancePicture(studentId, fromKey, toKey),
  ]);

  const signals = signalsOf({
    classTest: profile.analytics,
    homework,
    assignment,
    attendance,
  });

  return {
    studentId,
    studentName: profile.studentName,
    fromKey,
    toKey,
    classTest: profile.analytics,
    homework,
    assignment,
    attendance,
    signals,
    overall: overallOf(profile.analytics.trajectory, signals),
  };
}

// ---------------------------------------------------------------------------
// Guardian trajectory summary (D-#277 follow-up)
// ---------------------------------------------------------------------------

export interface GuardianTrajectory {
  studentId: string;
  /** "improving" | "steady" | "declining" | "na". */
  overall: string;
  /** Plain-language Bangla lines. NO rank, NO class comparison (owner ruling). */
  linesBn: string[];
  /** The same lines in English — the app picks by the active UI language. */
  linesEn: string[];
  presentPct: number;
  /** The child's own average, never a peer comparison. */
  avgPercent: number | null;
}

const OVERALL_BN: Record<string, string> = {
  improving: "সার্বিকভাবে উন্নতি করছে",
  steady: "সার্বিকভাবে স্থিতিশীল",
  declining: "সার্বিকভাবে পিছিয়ে পড়ছে",
  na: "মূল্যায়নের জন্য যথেষ্ট তথ্য নেই",
};
const OVERALL_EN: Record<string, string> = {
  improving: "Improving overall",
  steady: "Steady overall",
  declining: "Falling behind overall",
  na: "Not enough information yet",
};

/**
 * The guardian-facing view: direction of travel and their OWN child's numbers.
 * Deliberately omits `latestRank`, `latestRankOf` and every peer comparison — a
 * guardian is told how their child is doing, not who they beat (owner ruling, D-#281
 * planning). Built from the same `wholePicture`, so the two can never disagree.
 *
 * Every flagged line carries its number AND the benchmark it fell short of, so a
 * guardian can see WHY the roll-up reads the way it does (owner ask 2026-07-19).
 */
export async function guardianTrajectory(studentId: string, now: Date = new Date()): Promise<GuardianTrajectory> {
  const wp = await wholePicture(studentId, now);
  const bn: string[] = [OVERALL_BN[wp.overall] ?? OVERALL_BN.na];
  const en: string[] = [OVERALL_EN[wp.overall] ?? OVERALL_EN.na];

  if (wp.classTest.avgPercent !== null) {
    bn.push(`ক্লাস টেস্টে গড় ${wp.classTest.avgPercent}%।`);
    en.push(`Class-test average ${wp.classTest.avgPercent}%.`);
  }
  if (wp.classTest.trajectory === "down") {
    bn.push("ক্লাস টেস্টের ফলাফল নিচের দিকে যাচ্ছে।");
    en.push("Class-test results are trending down.");
  }
  if (wp.classTest.weakestSubject) {
    const subj = wp.classTest.weakestSubject;
    bn.push(`বেশি মনোযোগ দরকার: ${HW_SUBJECT_LABELS_BN[subj as never] ?? subj}।`);
    en.push(`Needs more attention: ${HW_SUBJECT_LABELS_EN[subj as never] ?? subj}.`);
  }
  if (wp.attendance.markedDays > 0) {
    if (wp.signals.includes("ATTENDANCE_LOW")) {
      bn.push(`উপস্থিতি ${wp.attendance.presentPct}% (কাম্য অন্তত ${ATTENDANCE_CONCERN_PCT}%)।`);
      en.push(`Attendance ${wp.attendance.presentPct}% (expected at least ${ATTENDANCE_CONCERN_PCT}%).`);
    } else {
      bn.push(`উপস্থিতি ${wp.attendance.presentPct}%।`);
      en.push(`Attendance ${wp.attendance.presentPct}%.`);
    }
  }
  if (wp.signals.includes("HOMEWORK_LOW")) {
    const { total, done, completionPct } = wp.homework;
    bn.push(
      `বাড়ির কাজ: ${total}টির মধ্যে ${done}টি সম্পন্ন — ${completionPct}% (কাম্য অন্তত ${HOMEWORK_CONCERN_PCT}%)।`,
    );
    en.push(
      `Homework: ${done} of ${total} completed — ${completionPct}% (expected at least ${HOMEWORK_CONCERN_PCT}%).`,
    );
  }
  if (wp.signals.includes("ASSIGNMENT_LATE")) {
    bn.push(`অ্যাসাইনমেন্ট: ${wp.assignment.total}টির মধ্যে ${wp.assignment.late}টি দেরিতে জমা।`);
    en.push(`Assignments: ${wp.assignment.late} of ${wp.assignment.total} submitted late.`);
  }

  return {
    studentId,
    overall: wp.overall,
    linesBn: bn,
    linesEn: en,
    presentPct: wp.attendance.presentPct,
    avgPercent: wp.classTest.avgPercent,
  };
}
