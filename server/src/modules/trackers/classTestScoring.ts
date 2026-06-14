/**
 * Class-test scoring — PURE (no DB, no clock). NO auto-grading: the teacher enters
 * the raw marks, this only derives the percentage + pass/fail (D-#85, never stored).
 *
 * §4 rules:
 *   - percent = marks ÷ totalMarks (expressed 0–100; rounded to 1 dp for display).
 *   - pass    = marks ≥ passMark   (passMark is configurable per test, §3.2).
 *   - ABSENT carries no marks, is excluded from class denominators, and has a null
 *     percent / pass (it feeds the Absent guardian template, not the score, §4).
 *
 * All inputs are passed in for deterministic, testable math.
 */
import type { ClassTestAttendanceStatus } from "@scd/shared";

/** Round to 1 decimal place (display percent). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** percent = marks ÷ totalMarks, as 0–100 (1 dp). Caller guarantees totalMarks ≥ 1. */
export function derivePercent(marks: number, totalMarks: number): number {
  return round1((marks / totalMarks) * 100);
}

/** pass = marks ≥ passMark (§4). */
export function derivePass(marks: number, passMark: number): boolean {
  return marks >= passMark;
}

export interface DerivedScore {
  status: ClassTestAttendanceStatus;
  /** The raw marks (null when ABSENT). */
  marks: number | null;
  totalMarks: number;
  /** marks ÷ totalMarks × 100, 1 dp (null when ABSENT — excluded from denominators). */
  percent: number | null;
  /** marks ≥ passMark (null when ABSENT). */
  pass: boolean | null;
}

/**
 * Derive a single student's score from their stored row. ABSENT ⇒ no marks, null
 * percent/pass (§4). PRESENT ⇒ percent + pass from the test's totalMarks / passMark.
 */
export function deriveScore(params: {
  status: ClassTestAttendanceStatus;
  marks: number | null | undefined;
  totalMarks: number;
  passMark: number;
}): DerivedScore {
  if (params.status === "ABSENT") {
    return { status: "ABSENT", marks: null, totalMarks: params.totalMarks, percent: null, pass: null };
  }
  const marks = params.marks ?? 0;
  return {
    status: "PRESENT",
    marks,
    totalMarks: params.totalMarks,
    percent: derivePercent(marks, params.totalMarks),
    pass: derivePass(marks, params.passMark),
  };
}
