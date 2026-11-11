/**
 * CT-RC — unusual-mark recheck: the PURE flag derivation (no DB). The service feeds it
 * the student's history and the rules; it never stores a flag (D-#85: derived on read).
 *
 * Owner rulings 2026-11-10 (docs/prd-ct-mark-recheck.md):
 *   - everything in percent of the test's total; a 20-mark test makes 1 mark = 5%;
 *   - the student's average is CUMULATIVE for the subject this academic year;
 *   - R1 far above / R2 far below / R3 full marks under a ceiling / R4 the whole class.
 *
 * Every threshold is a difference in PERCENTAGE POINTS (60% → 80% is "20% higher").
 */
import { createHash } from "crypto";

export interface RecheckRules {
  enabled: boolean;
  highPct: number;
  lowPct: number;
  fullMarksBelowPct: number;
  classHighPct: number;
  minPriorTests: number;
}

export type MarkFlagKind = "HIGH" | "LOW" | "FULL";
export type AverageBasis = "SUBJECT" | "ALL" | "NONE";

/** The student's earlier PUBLISHED, PRESENT results this academic year, as percents. */
export interface StudentHistory {
  /** Same subject only. */
  subjectPcts: number[];
  /** Every subject (includes the same-subject ones). */
  allPcts: number[];
}

export interface RowFlag {
  studentId: string;
  percent: number;
  /** The average the mark was compared with; null when there is too little history. */
  averagePct: number | null;
  basis: AverageBasis;
  /** How many earlier tests the average is built from. */
  priorCount: number;
  kinds: MarkFlagKind[];
}

export interface ClassFlag {
  classPct: number;
  usualPct: number;
  /** Earlier tests of this class in this subject the usual average is built from. */
  usualTests: number;
}

/** Tolerance so 79.99999 (float noise on 16/20 vs 12/20) still counts as a 20-point gap. */
const EPS = 1e-9;

export const round1 = (n: number): number => Math.round(n * 10) / 10;

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function percentOf(marks: number, totalMarks: number): number {
  return totalMarks > 0 ? (marks / totalMarks) * 100 : 0;
}

/** Which average a student's mark is compared with (subject first, then all subjects). */
export function averageFor(history: StudentHistory, rules: RecheckRules): { averagePct: number | null; basis: AverageBasis; priorCount: number } {
  if (history.subjectPcts.length >= rules.minPriorTests) {
    return { averagePct: mean(history.subjectPcts), basis: "SUBJECT", priorCount: history.subjectPcts.length };
  }
  if (history.allPcts.length >= rules.minPriorTests) {
    return { averagePct: mean(history.allPcts), basis: "ALL", priorCount: history.allPcts.length };
  }
  return { averagePct: null, basis: "NONE", priorCount: history.allPcts.length };
}

/**
 * One student's flag, or null when the mark is not unusual (or the student was absent).
 *   R1 HIGH: percent − average ≥ highPct
 *   R2 LOW : average − percent ≥ lowPct
 *   R3 FULL: 100% while the average is under fullMarksBelowPct — or there is no
 *            history to compare with (a full mark with nothing to vouch for it).
 */
export function deriveRowFlag(
  row: { studentId: string; status: string; marks?: number | null },
  totalMarks: number,
  history: StudentHistory,
  rules: RecheckRules,
): RowFlag | null {
  if (!rules.enabled || row.status !== "PRESENT" || row.marks === null || row.marks === undefined) return null;
  const percent = percentOf(row.marks, totalMarks);
  const { averagePct, basis, priorCount } = averageFor(history, rules);
  const kinds: MarkFlagKind[] = [];
  if (averagePct !== null) {
    if (percent - averagePct >= rules.highPct - EPS) kinds.push("HIGH");
    if (averagePct - percent >= rules.lowPct - EPS) kinds.push("LOW");
  }
  const full = totalMarks > 0 && row.marks >= totalMarks;
  if (full && (averagePct === null || averagePct < rules.fullMarksBelowPct - EPS)) kinds.push("FULL");
  if (kinds.length === 0) return null;
  return {
    studentId: row.studentId,
    percent: round1(percent),
    averagePct: averagePct === null ? null : round1(averagePct),
    basis,
    priorCount,
    kinds,
  };
}

/**
 * R4 — the whole class scored unusually high: the mean percent of this test's PRESENT
 * rows is at least `classHighPct` above the class's usual mean in the subject. Needs
 * ≥ 3 present students (a 2-child test says nothing about checking) and at least
 * `minPriorTests` earlier tests to know what "usual" is.
 */
export function deriveClassFlag(
  rows: Array<{ status: string; marks?: number | null }>,
  totalMarks: number,
  usual: { pcts: number[]; tests: number },
  rules: RecheckRules,
): ClassFlag | null {
  if (!rules.enabled) return null;
  const present = rows.filter((r) => r.status === "PRESENT" && r.marks !== null && r.marks !== undefined);
  if (present.length < 3 || usual.tests < rules.minPriorTests || usual.pcts.length === 0) return null;
  const classPct = mean(present.map((r) => percentOf(r.marks as number, totalMarks)));
  const usualPct = mean(usual.pcts);
  if (classPct - usualPct < rules.classHighPct - EPS) return null;
  return { classPct: round1(classPct), usualPct: round1(usualPct), usualTests: usual.tests };
}

/** A fingerprint of every row's status + marks — the whole-class tick is valid only
 *  while this stays the same. Order-independent. */
export function marksKeyOf(rows: Array<{ studentId: string; status: string; marks?: number | null }>): string {
  const parts = rows
    .map((r) => `${r.studentId}:${r.status}:${r.status === "PRESENT" ? r.marks ?? "" : ""}`)
    .sort();
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

/** A row tick counts only for the mark it was given for. */
export function rowTickValid(
  row: { status: string; marks?: number | null; recheck?: { marks: number } | null },
): boolean {
  return !!row.recheck && row.status === "PRESENT" && row.marks === row.recheck.marks;
}
