/**
 * The question publish gate (QR-3; D-#508) — ONE definition, used by every read path.
 *
 * A question reaches the teachers' shelf only when the Principal publishes it
 * (`reviewStatus === "gold"`). Before QR-3 the field was decoration: `questions()`,
 * `questionTopicTags`, `contentArtifacts` and `contentTree` all ignored it, so every teacher
 * saw every imported question.
 *
 * Two rules this module exists to keep honest:
 *
 *  1. **Filter, never post-filter.** `questions()` is cursor-paginated; dropping rows after
 *     the query would silently short every page. So the gate is always a Mongo predicate.
 *  2. **Questions only.** Plans keep their own draft→reviewed→gold lifecycle (D-#38), and
 *     stimuli are deliberately NEVER gated: a question payload carries a `stimulus_ref` that
 *     must resolve, so gating shared passages would render a PUBLISHED question without its
 *     text — a silent failure on a paper in a child's hand (§5a of docs/prd-question-review.md).
 *
 * Principal/Office are unrestricted — they run the loop and must see drafts to assign them.
 */
import { isAdminStaff } from "../foundation/services/RoleScope";
import type { AuthPayload } from "../../context";

/** The one published state. */
export const PUBLISHED_REVIEW_STATUS = "gold";

/** True when this caller may see only PUBLISHED questions. */
export function seesPublishedOnly(auth: AuthPayload | null | undefined): boolean {
  return !isAdminStaff(auth);
}

/**
 * Gate a QUESTION-ONLY query (`questions`, `questionTopicTags`): pin reviewStatus to `gold`.
 * Set LAST in the caller so an explicit `reviewStatus` argument can never widen it back open.
 */
export function applyQuestionOnlyGate(
  filter: Record<string, unknown>,
  auth: AuthPayload | null | undefined,
): void {
  if (seesPublishedOnly(auth)) filter.reviewStatus = PUBLISHED_REVIEW_STATUS;
}

/**
 * Gate a MIXED-docType query (`contentArtifacts`, `contentTree`), which carries plans and
 * stimuli alongside questions. Only the question rows are constrained. ANDed so it can never
 * be clobbered by another `$or` on the same filter.
 */
export function applyMixedDocTypeGate(
  filter: Record<string, unknown>,
  auth: AuthPayload | null | undefined,
): void {
  if (!seesPublishedOnly(auth)) return;
  const ands = (filter.$and as Record<string, unknown>[] | undefined) ?? [];
  ands.push({
    $or: [{ docType: { $ne: "question" } }, { reviewStatus: PUBLISHED_REVIEW_STATUS }],
  });
  filter.$and = ands;
}
