/**
 * reportCardMath — the pure arithmetic of a report card (EX-5, D-#377).
 *
 * Every rule here was read off the generated 2026 cards and is asserted against them in
 * `reportCard.test.ts`. Nothing in this file touches the database, so the acceptance test
 * is a direct comparison with the paper the school actually issued.
 *
 * The rule that surprises people: ONE subject at F forces the whole card to 0.00 / F,
 * regardless of total. Rehana Bint Mustafa prints 0.00 F at 552/800 on a single Maths F —
 * no total-based rule reproduces that, so it cannot be inferred later from the numbers.
 */
import type { GradeLetter } from "@scd/shared";

export interface GradeBandLike {
  letter: GradeLetter;
  point: number;
  minPercent: number;
  maxPercent: number;
}

export interface SubjectRowInput {
  subject: string;
  /** Σ of the component values already converted onto their component scales. */
  obtained: number;
  /** Σ of the paper's component maxima — 100 for a well-formed paper. */
  fullMarks: number;
}

export interface SubjectRow extends SubjectRowInput {
  percent: number;
  point: number;
  letter: GradeLetter;
  /** Cohort maximum for this subject — derived, never stored (D-#377e). */
  highest: number | null;
}

export interface CardTotals {
  totalObtained: number;
  totalFullMarks: number;
  /** Mean of the SUBJECT points, 2 dp — NOT a percentage of the total. */
  gpa: number;
  letter: GradeLetter;
  /** True when the any-F rule fired; lets the card explain the 0.00 rather than just show it. */
  failedBySubject: boolean;
  failedSubjects: string[];
}

/** Band a percentage onto a scale. The scale is validated elsewhere to cover 0..100. */
export function bandFor(scale: readonly GradeBandLike[], percent: number): GradeBandLike {
  const sorted = [...scale].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((b) => percent >= b.minPercent) ?? sorted[sorted.length - 1];
}

/** Round to 2 dp the way the printed GPA column does (4.80, 4.67, 3.81). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** One subject row. `percent` is obtained/fullMarks — for a well-formed paper fullMarks is
 *  100, so the percentage and the obtained mark coincide, exactly as on the card. */
export function computeSubjectRow(
  input: SubjectRowInput,
  scale: readonly GradeBandLike[],
  highest: number | null = null,
): SubjectRow {
  const percent = input.fullMarks > 0 ? (input.obtained / input.fullMarks) * 100 : 0;
  const band = bandFor(scale, percent);
  return {
    ...input,
    percent: round2(percent),
    point: band.point,
    letter: band.letter,
    highest,
  };
}

/**
 * Totals + GPA.
 *
 * GPA = arithmetic mean of the subject points, 2 dp. Verified against the cards:
 *   Musa   (5+5+5+4+5)/5   = 4.80
 *   Barakah(4+5+5+3.5+5)/5 = 4.50
 *   Afra   (4+4+5+3+3.5)/5 = 3.90
 *
 * ANY subject at F ⇒ gpa 0.00 and letter F, whatever the total.
 */
export function computeTotals(
  rows: readonly SubjectRow[],
  scale: readonly GradeBandLike[],
  failRule: "ANY_SUBJECT_F" = "ANY_SUBJECT_F",
): CardTotals {
  const totalObtained = rows.reduce((s, r) => s + r.obtained, 0);
  const totalFullMarks = rows.reduce((s, r) => s + r.fullMarks, 0);

  const failedSubjects = rows.filter((r) => r.letter === "F").map((r) => r.subject);
  const failedBySubject = failRule === "ANY_SUBJECT_F" && failedSubjects.length > 0;

  if (!rows.length) {
    return { totalObtained: 0, totalFullMarks: 0, gpa: 0, letter: "F", failedBySubject: false, failedSubjects: [] };
  }

  if (failedBySubject) {
    return { totalObtained, totalFullMarks, gpa: 0, letter: "F", failedBySubject: true, failedSubjects };
  }

  const gpa = round2(rows.reduce((s, r) => s + r.point, 0) / rows.length);
  // The overall letter bands the ROUNDED GPA on the same table (4.80→A, 3.90→A-, 3.17→B).
  const letter = letterForGpa(scale, gpa);
  return { totalObtained, totalFullMarks, gpa, letter, failedBySubject: false, failedSubjects: [] };
}

/** Map a GPA onto a letter by POINT, not percent — the printed cards band 4.80→A, 3.90→A-. */
export function letterForGpa(scale: readonly GradeBandLike[], gpa: number): GradeLetter {
  const sorted = [...scale].sort((a, b) => b.point - a.point);
  return (sorted.find((b) => gpa >= b.point) ?? sorted[sorted.length - 1]).letter;
}

/** Cohort maximum per subject — derived at render, never stored, because it moves the
 *  moment any single mark is corrected (D-#377e). */
export function highestBySubject(all: readonly { subject: string; obtained: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of all) {
    const cur = out.get(r.subject);
    if (cur === undefined || r.obtained > cur) out.set(r.subject, r.obtained);
  }
  return out;
}
