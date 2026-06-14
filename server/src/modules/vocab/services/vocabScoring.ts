/**
 * Vocab scoring engine (VC-3; prd-vocabulary-tracker §4, D-#142). PURE — no DB, no
 * clock. NO auto-grading: the teacher marks which fields are wrong; this only turns
 * those marks into derived totals (D-#85). All inputs are passed in for deterministic,
 * testable math.
 *
 * Marks lost per position (§4):
 *   - single-field position (HEADWORD_TO_BANGLA / BANGLA_TO_HEADWORD, or a 1-field
 *     BANGLA DICTATION): 1 lost if wrong.
 *   - 2-field DICTATION (ENGLISH / ARABIC): governed by the test's
 *     `dictationHalfMissCounts` — off ⇒ any field wrong = 1 lost (max 1); on ⇒ 1 lost
 *     per wrong field (max 2).
 *
 * score = max(0, totalMarks − Σ marksLost). ABSENT students are scored elsewhere
 * (excluded from denominators, §4).
 */
import { VOCAB_DICTATION_FIELDS, type VocabProgram, type VocabDirection } from "@scd/shared";

/** How many independently-markable fields a position has (1, or the program's dictation
 *  field count for a DICTATION position). */
export function fieldCountForPosition(direction: VocabDirection, program: VocabProgram): number {
  return direction === "DICTATION" ? VOCAB_DICTATION_FIELDS[program] : 1;
}

/** Marks lost on one position given the wrong-field set (§4). */
export function marksLostForPosition(
  direction: VocabDirection,
  program: VocabProgram,
  dictationHalfMissCounts: boolean,
  wrongFields: number[],
): number {
  if (!wrongFields || wrongFields.length === 0) return 0;
  const fields = fieldCountForPosition(direction, program);
  if (fields <= 1) return 1; // single-field: wrong = 1 lost
  // 2-field DICTATION:
  if (!dictationHalfMissCounts) return 1; // any field wrong = the whole position (max 1)
  // half-miss on: 1 per wrong field, capped at the field count
  const distinct = new Set(wrongFields.filter((f) => f >= 1 && f <= fields));
  return Math.min(distinct.size, fields);
}

/** True iff a wrong-field set is valid for a position (1-based, within field count, non-empty). */
export function wrongFieldsValid(
  direction: VocabDirection,
  program: VocabProgram,
  wrongFields: number[],
): boolean {
  if (!Array.isArray(wrongFields) || wrongFields.length === 0) return false;
  const fields = fieldCountForPosition(direction, program);
  const seen = new Set<number>();
  for (const f of wrongFields) {
    if (!Number.isInteger(f) || f < 1 || f > fields || seen.has(f)) return false;
    seen.add(f);
  }
  return true;
}

export interface PositionLite {
  positionId: string;
  direction: VocabDirection;
}

export interface StudentScore {
  marksLost: number;
  score: number;
  totalMarks: number;
  /** Count of positions with at least one wrong field. */
  wrongCount: number;
  /** Position ids the student got wrong (for the wrong-words join). */
  wrongPositionIds: string[];
}

/**
 * Score a PRESENT student: sum marks lost over the test's positions given their
 * mistakes, then `score = max(0, totalMarks − marksLost)`. `mistakesByPositionId`
 * maps a positionId → its wrong-field indices (positions absent from the map are
 * correct).
 */
export function scoreStudent(params: {
  positions: PositionLite[];
  mistakesByPositionId: Map<string, number[]>;
  totalMarks: number;
  program: VocabProgram;
  dictationHalfMissCounts: boolean;
}): StudentScore {
  let marksLost = 0;
  const wrongPositionIds: string[] = [];
  for (const pos of params.positions) {
    const wrong = params.mistakesByPositionId.get(pos.positionId);
    if (!wrong || wrong.length === 0) continue;
    const lost = marksLostForPosition(pos.direction, params.program, params.dictationHalfMissCounts, wrong);
    if (lost > 0) {
      marksLost += lost;
      wrongPositionIds.push(pos.positionId);
    }
  }
  return {
    marksLost,
    score: Math.max(0, params.totalMarks - marksLost),
    totalMarks: params.totalMarks,
    wrongCount: wrongPositionIds.length,
    wrongPositionIds,
  };
}
