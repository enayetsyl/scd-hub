/**
 * The guardian-visible shape of a work claim (GC-3, D-#551/#553).
 *
 * Lives in one module because BOTH guardian reads project it — the homework
 * screen through `GuardianPortalService` and the assignment screen through
 * `AssignmentSummaryService`. Two copies of `canClaim` would be two chances for
 * the two screens to disagree about whether a parent may speak.
 */
import {
  WORK_CLAIM_ELIGIBLE_STATES,
  WORK_CLAIM_MAX_ATTEMPTS,
  WORK_CLAIM_WINDOW_SCHOOL_DAYS,
  WORK_CLAIM_SAME_DAY_MIN,
  WORK_CLAIM_STATUS_LABELS_BN,
  WORK_CLAIM_REJECT_REASON_LABELS_BN,
} from "@scd/shared";
import type { LifecycleState, WorkClaimStatus, WorkClaimRejectReason } from "@scd/shared";
import { resolveDayType } from "../../routine/calendar";

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
  /** False once the family has used its one re-claim (D-#553). */
  canReclaim: boolean;
}

/** Days the app treats as closed — the same gate the notification ticker uses. */
// QURAN_ONLY (Saturday, D-#50) is CLOSED for the claim ladder: only Quran runs,
// and Quran is excluded from the homework tracker entirely (D-#36), so no claim
// can ever be actionable on one. Deliberately narrower than the notification
// ticker, which legitimately fires on Saturday for Quran bells. (BUG-WC-1)
const CLOSED_DAY_TYPES = new Set(["OFF", "HOLIDAY", "QURAN_ONLY"]);

/**
 * The earliest due date still inside the claim window (D-#553): walk back
 * WORK_CLAIM_WINDOW_SCHOOL_DAYS OPEN days from `at`.
 *
 * Computed ONCE per read and handed to every row rather than per row — the
 * guardian homework screen renders dozens of records, and a per-row calendar
 * walk would be the exact fan-out D-#476 removed from these screens.
 */
export async function earliestClaimableDueDate(at: Date): Promise<Date> {
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  let open = 0;
  for (let i = 0; i < 60; i++) {
    if (!CLOSED_DAY_TYPES.has(await resolveDayType(d))) {
      open += 1;
      if (open >= WORK_CLAIM_WINDOW_SCHOOL_DAYS) return d;
    }
    d.setDate(d.getDate() - 1);
  }
  return d;
}

/**
 * The same-day floor (D-#683): work due TODAY cannot be claimed before 14:00.
 *
 * A record flips GIVEN → DUE on the first scheduler tick of its due day, so
 * without this the button is live at 00:01 — before the child has carried the
 * work to school and before any teacher could have collected it. Parents were
 * filing at dawn and burning both escalation rungs by lunchtime.
 *
 * Only TODAY's work is held. Yesterday's DUE/CHASE row is exactly what the
 * ladder is for and stays claimable around the clock.
 *
 * Local wall-clock on both sides, matching `dateKeyOf` and the ticker (D-#73).
 */
export function workClaimSameDayHold(
  dueDate: Date | string | null | undefined,
  at: Date,
): boolean {
  if (!dueDate) return false;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const sameDay =
    due.getFullYear() === at.getFullYear() &&
    due.getMonth() === at.getMonth() &&
    due.getDate() === at.getDate();
  if (!sameDay) return false;
  return at.getHours() * 60 + at.getMinutes() < WORK_CLAIM_SAME_DAY_MIN;
}

/** The parent-facing reason the button is absent, or null when it is not held.
 *  Server-rendered like every other *Bn field so the two screens cannot word
 *  the same rule differently. */
export function workClaimHoldNoteBn(
  dueDate: Date | string | null | undefined,
  at: Date,
): string | null {
  return workClaimSameDayHold(dueDate, at)
    ? "আজকের কাজের জন্য দুপুর ২টার পর জানানো যাবে — এখনও ক্লাসে জমা নেওয়ার সময় বাকি আছে"
    : null;
}

/**
 * The D-#553 rule, computed SERVER-SIDE so no screen re-implements it: an
 * eligible state, no claim currently open, and at least one attempt left.
 */
export function workClaimEligible(
  state: LifecycleState,
  latest: Record<string, unknown> | undefined,
  attempts: number,
  dueDate?: Date | string | null,
  earliestDue?: Date,
  at: Date = new Date(),
): boolean {
  if (!WORK_CLAIM_ELIGIBLE_STATES.includes(state)) return false;
  if (latest && latest.status === "PENDING") return false;
  if (attempts >= WORK_CLAIM_MAX_ATTEMPTS) return false;
  // The window is checked HERE as well as in fileWorkClaim. Offering a button
  // the server will refuse is worse than offering none, and the whole point of
  // computing canClaim on the server is that the two cannot disagree.
  if (earliestDue && dueDate) {
    const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
    if (due.getTime() < earliestDue.getTime()) return false;
  }
  // Same reasoning as the window above: the read path must refuse exactly what
  // fileWorkClaim refuses, or the parent taps a button into an error (D-#683).
  if (workClaimSameDayHold(dueDate, at)) return false;
  return true;
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
