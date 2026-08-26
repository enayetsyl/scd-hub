/**
 * The guardian-visible shape of a work claim (GC-3, D-#548/#550).
 *
 * Lives in one module because BOTH guardian reads project it — the homework
 * screen through `GuardianPortalService` and the assignment screen through
 * `AssignmentSummaryService`. Two copies of `canClaim` would be two chances for
 * the two screens to disagree about whether a parent may speak.
 */
import {
  WORK_CLAIM_ELIGIBLE_STATES,
  WORK_CLAIM_MAX_ATTEMPTS,
  WORK_CLAIM_STATUS_LABELS_BN,
  WORK_CLAIM_REJECT_REASON_LABELS_BN,
} from "@scd/shared";
import type { LifecycleState, WorkClaimStatus, WorkClaimRejectReason } from "@scd/shared";

export interface GuardianWorkClaimView {
  claimId: string;
  status: WorkClaimStatus;
  statusLabelBn: string;
  claimedAt: string;
  resolvedAt: string | null;
  /** The teacher's picker reason, already in Bangla. Null unless REJECTED. */
  rejectReasonLabelBn: string | null;
  rejectNote: string | null;
  attemptNumber: number;
  /** False once the family has used its one re-claim (D-#550). */
  canReclaim: boolean;
}

/**
 * The D-#550 rule, computed SERVER-SIDE so no screen re-implements it: an
 * eligible state, no claim currently open, and at least one attempt left.
 */
export function workClaimEligible(
  state: LifecycleState,
  latest: Record<string, unknown> | undefined,
  attempts: number,
): boolean {
  if (!WORK_CLAIM_ELIGIBLE_STATES.includes(state)) return false;
  if (latest && latest.status === "PENDING") return false;
  return attempts < WORK_CLAIM_MAX_ATTEMPTS;
}

export function workClaimViewOf2(
  c: Record<string, any> | undefined,
  attempts: number,
): GuardianWorkClaimView | null {
  if (!c) return null;
  const status = c.status as WorkClaimStatus;
  return {
    claimId: c._id.toString(),
    status,
    statusLabelBn: WORK_CLAIM_STATUS_LABELS_BN[status] ?? status,
    claimedAt: new Date(c.claimedAt).toISOString(),
    resolvedAt: c.resolvedAt ? new Date(c.resolvedAt).toISOString() : null,
    rejectReasonLabelBn: c.rejectReason
      ? WORK_CLAIM_REJECT_REASON_LABELS_BN[c.rejectReason as WorkClaimRejectReason] ?? null
      : null,
    rejectNote: c.rejectNote ?? null,
    attemptNumber: c.attemptNumber ?? 1,
    canReclaim: status === "REJECTED" && attempts < WORK_CLAIM_MAX_ATTEMPTS,
  };
}

/** The mutation returns the same shape the read does — one builder, so the card a
 *  parent sees after tapping cannot disagree with the card they reload. */
export function workClaimViewOf(c: Record<string, any>): GuardianWorkClaimView {
  return workClaimViewOf2(c, c.attemptNumber ?? 1)!;
}
