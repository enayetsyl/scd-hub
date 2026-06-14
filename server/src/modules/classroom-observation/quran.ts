/**
 * quran — the PURE Quran (ClassEcho) form validator (CO-5, prd-classroom-observation
 * §CO-5, D-#56). The Quran-track sibling of `ref11.ts`: no DB, no clock, no I/O —
 * every input is passed in, so the §CO-5 acceptance rules are deterministic +
 * unit-testable (the same posture as the REF-11 validator).
 *
 * The acceptance contract (§CO-5):
 *   - EXACTLY 8 rating items, one per QURAN_REVIEW_CRITERION (no dup), each scored
 *     1–5 (QURAN_REVIEW_SCORE_MIN..MAX). The note per item is OPTIONAL.
 *   - EXACTLY 7 compliance items, one per QURAN_COMPLIANCE_ITEM (no dup), each a
 *     yes/no boolean.
 *   - strengths / improvements / suggestions are all required + non-empty (the
 *     REF-11 narrative posture: oneStrength/growthFocus are required there).
 *   - NO total/average is ever computed or stored — there is no sum here, by design
 *     (the REF-11 §4/D-#194 posture carries to the Quran form).
 *
 * `validateQuranPayload` THROWS a QuranValidationError (Bangla-friendly) on the first
 * violation and otherwise returns the normalised payload (trimmed notes/strings,
 * canonical criterion/item order). Rejects unknown/duplicate/missing criteria + items.
 */
import {
  QURAN_REVIEW_CRITERIA,
  QURAN_COMPLIANCE_ITEMS,
  QURAN_REVIEW_SCORE_MIN,
  QURAN_REVIEW_SCORE_MAX,
} from "@scd/shared";
import type { QuranReviewCriterion, QuranComplianceItem } from "@scd/shared";

export class QuranValidationError extends Error {}

export interface QuranRatingInput {
  criterion: string;
  score: number;
  note?: string | null;
}
export interface QuranComplianceInput {
  item: string;
  yesNo: boolean;
}
export interface QuranPayloadInput {
  ratings: QuranRatingInput[];
  compliance: QuranComplianceInput[];
  strengths: string;
  improvements: string;
  suggestions: string;
}

export interface QuranRating {
  criterion: QuranReviewCriterion;
  score: number;
  note: string | null;
}
export interface QuranCompliance {
  item: QuranComplianceItem;
  yesNo: boolean;
}
export interface QuranPayload {
  ratings: QuranRating[];
  compliance: QuranCompliance[];
  strengths: string;
  improvements: string;
  suggestions: string;
}

function nonEmpty(s: string | null | undefined): string {
  return (s ?? "").trim();
}

/**
 * Validate + normalise a Quran-form review payload. Returns the canonical payload
 * (ratings in QURAN_REVIEW_CRITERIA order, compliance in QURAN_COMPLIANCE_ITEMS
 * order, trimmed text). Throws on any §CO-5 violation. NEVER returns or stores a
 * total/average.
 */
export function validateQuranPayload(input: QuranPayloadInput): QuranPayload {
  // --- ratings: exactly 8, one per criterion (no dup), score 1–5, note optional ---
  if (!Array.isArray(input.ratings) || input.ratings.length !== QURAN_REVIEW_CRITERIA.length) {
    throw new QuranValidationError(
      `Exactly ${QURAN_REVIEW_CRITERIA.length} rating items are required (one per Quran review criterion)`,
    );
  }
  const byCriterion = new Map<string, QuranRating>();
  for (const r of input.ratings) {
    if (!(QURAN_REVIEW_CRITERIA as readonly string[]).includes(r.criterion)) {
      throw new QuranValidationError(`Unknown criterion: ${r.criterion}`);
    }
    if (byCriterion.has(r.criterion)) {
      throw new QuranValidationError(`Duplicate rating criterion: ${r.criterion}`);
    }
    if (
      typeof r.score !== "number" ||
      !Number.isInteger(r.score) ||
      r.score < QURAN_REVIEW_SCORE_MIN ||
      r.score > QURAN_REVIEW_SCORE_MAX
    ) {
      throw new QuranValidationError(
        `Criterion ${r.criterion} score must be an integer ${QURAN_REVIEW_SCORE_MIN}–${QURAN_REVIEW_SCORE_MAX}`,
      );
    }
    byCriterion.set(r.criterion, {
      criterion: r.criterion as QuranReviewCriterion,
      score: r.score,
      note: nonEmpty(r.note) || null,
    });
  }
  // Canonical order; every criterion present (length + no-dup + membership ⇒ total).
  const ratings = QURAN_REVIEW_CRITERIA.map((c) => byCriterion.get(c)!);

  // --- compliance: exactly 7, one per item (no dup), yes/no boolean -----------------
  if (!Array.isArray(input.compliance) || input.compliance.length !== QURAN_COMPLIANCE_ITEMS.length) {
    throw new QuranValidationError(
      `Exactly ${QURAN_COMPLIANCE_ITEMS.length} compliance items are required (one per Quran compliance item)`,
    );
  }
  const byItem = new Map<string, QuranCompliance>();
  for (const c of input.compliance) {
    if (!(QURAN_COMPLIANCE_ITEMS as readonly string[]).includes(c.item)) {
      throw new QuranValidationError(`Unknown compliance item: ${c.item}`);
    }
    if (byItem.has(c.item)) {
      throw new QuranValidationError(`Duplicate compliance item: ${c.item}`);
    }
    if (typeof c.yesNo !== "boolean") {
      throw new QuranValidationError(`Compliance item ${c.item} requires a yes/no answer`);
    }
    byItem.set(c.item, { item: c.item as QuranComplianceItem, yesNo: c.yesNo });
  }
  const compliance = QURAN_COMPLIANCE_ITEMS.map((item) => byItem.get(item)!);

  // --- narrative: strengths + improvements + suggestions all required ---------------
  const strengths = nonEmpty(input.strengths);
  if (!strengths) throw new QuranValidationError("Strengths are required");
  const improvements = nonEmpty(input.improvements);
  if (!improvements) throw new QuranValidationError("Improvements are required");
  const suggestions = nonEmpty(input.suggestions);
  if (!suggestions) throw new QuranValidationError("Suggestions are required");

  return { ratings, compliance, strengths, improvements, suggestions };
}
