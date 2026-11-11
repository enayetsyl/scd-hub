/**
 * Read-side defaults for the ONE exam row (EX-1 on top of SY-1, docs/prd-exams.md).
 *
 * An exam written before EX-1 has no status, no grade scale and no CT rule. Hydrated
 * documents get the schema defaults (models/Exam.ts); a `.lean()` reader — or anything
 * that never went through mongoose — gets the SAME defaults from these helpers. Pure on
 * purpose (no mongoose import), so a test that mocks the model still exercises them.
 */
import { CT_AGGREGATION_DEFAULT_BEST_N, DEFAULT_GRADE_SCALE } from "@scd/shared";
import type { CtAggregationMode, ExamStatus, GradeLetter } from "@scd/shared";

export interface GradeBand {
  letter: GradeLetter;
  point: number;
  minPercent: number;
  maxPercent: number;
}

export interface CtAggregation {
  mode: CtAggregationMode;
  bestN?: number;
}

/** A fresh copy of the printed 2026 scale — never hand out the frozen shared constant. */
export const defaultGradeScale = (): GradeBand[] => DEFAULT_GRADE_SCALE.map((b) => ({ ...b }));

/** MEAN of every class test, best-N kept at the shared default for when a paper switches. */
export const defaultCtAggregation = (): CtAggregation => ({ mode: "MEAN", bestN: CT_AGGREGATION_DEFAULT_BEST_N });

/** The EX fields an exam-shaped object MAY carry. The helpers take any object — a hydrated
 *  doc, a lean row, a fixture — and read only these. */
interface ExamFields {
  status?: ExamStatus | string | null;
  gradeScale?: GradeBand[] | null;
  ctAggregation?: CtAggregation | null;
}

/** The exam's status; a row with none is PLANNED. */
export const examStatus = (e: object): ExamStatus => ((e as ExamFields).status as ExamStatus | null | undefined) ?? "PLANNED";

/** The exam's grade scale; a row with none grades on the printed 2026 scale. */
export const examGradeScale = (e: object): GradeBand[] => {
  const scale = (e as ExamFields).gradeScale;
  return scale && scale.length ? scale : defaultGradeScale();
};

/** The exam's CT rule; a row with none averages every test (MEAN). */
export const examCtAggregation = (e: object): CtAggregation => (e as ExamFields).ctAggregation ?? defaultCtAggregation();
