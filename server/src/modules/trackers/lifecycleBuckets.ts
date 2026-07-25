/**
 * lifecycleBuckets — ONE vocabulary for READING where a tracker record sits
 * (D-#359). `lifecycle.ts` next door owns the *write* side (legal transitions);
 * this module owns the *read* side: which state sets mean what, whether a record
 * ever reached a state, when it entered its current one, and how a date-key range
 * becomes day bounds.
 *
 * WHY it exists: the homework lifecycle report (D-#350) and the student profile
 * (SP-1) answer the same questions about the same records for different audiences.
 * When those two disagree about "checking pending", the discrepancy is
 * unfalsifiable from the outside — exactly the D-#354 class of bug. One definition,
 * many readers.
 *
 * THREE PARTITIONS COEXIST ON PURPOSE — do not "unify" them:
 *
 *   Teacher workflow  PRE_SUBMIT | AWAITING_CHECK | AWAITING_RETURN | RETURNED
 *                     — whose desk is it on? (the lifecycle report's pending pills)
 *   Student duty      OPEN_TO_STUDENT | DONE_TO_STUDENT
 *                     — does the child still owe something? (the whole picture)
 *   Sheet outcome     result ∈ CORRECT | PARTIAL | WRONG once CHECKED is reached
 *                     — how did it go? (the profile's quality tally)
 *
 * CHECKED is deliberately BOTH "awaiting return" (teacher: hand it back) and "done
 * to the student" (child: nothing more to do). RESUBMIT is "awaiting return" for
 * the original record AND "open to the student", because a fresh record now carries
 * the redo. Both readings are correct for their audience.
 */
import type { LifecycleState } from "@scd/shared";
import { dateKeyOf, parseDateKey } from "../attendance/dates";

/** The stamp shape both trackers persist per transition (`by` added in D-#338). */
export interface BucketStamp {
  state: string;
  at: Date;
}

// ---------------------------------------------------------------------------
// State sets — teacher workflow
// ---------------------------------------------------------------------------

/** Not yet submitted: the record is with the STUDENT. */
export const PRE_SUBMIT_STATES: readonly LifecycleState[] = ["GIVEN", "ABSENT_REDELIVER", "DUE", "CHASE"];
/** Submitted, awaiting the teacher's check. */
export const AWAITING_CHECK_STATES: readonly LifecycleState[] = ["SUBMITTED"];
/** Checked, awaiting hand-back to the student. */
export const AWAITING_RETURN_STATES: readonly LifecycleState[] = ["CHECKED", "RESUBMIT"];

/** PRE_SUBMIT minus the absence state — the states a delivered sheet can be
 *  late in. `ABSENT_REDELIVER` is NOT lateness (the child never got the sheet),
 *  so it is bucketed separately by every reader. */
export const OWED_BY_STUDENT_STATES: readonly LifecycleState[] = ["GIVEN", "DUE", "CHASE"];

// ---------------------------------------------------------------------------
// State sets — student duty (the whole-picture split; membership unchanged)
// ---------------------------------------------------------------------------

export const OPEN_TO_STUDENT_STATES: readonly LifecycleState[] = [
  "GIVEN",
  "ABSENT_REDELIVER",
  "DUE",
  "CHASE",
  "RESUBMIT",
];
export const DONE_TO_STUDENT_STATES: readonly LifecycleState[] = ["CHECKED", "RETURNED"];

/** Membership test that keeps callers from re-listing states inline. */
export function inStates(state: string, states: readonly LifecycleState[]): boolean {
  return (states as readonly string[]).includes(state);
}

// ---------------------------------------------------------------------------
// Trail readers
// ---------------------------------------------------------------------------

/** True iff a record's audit trail ever reached `state` — `stateDates` is a full
 *  timestamped trail, so "was it ever submitted?" is answerable without a flag.
 *  NOTE a D-#338 revert POPS stamps, so a reverted record reads as never having
 *  reached the popped state (by design — the revert is an undo, and the audit log
 *  carries `*_RECORD_REVERTED` for the forensic question). */
export function everReached(stamps: readonly BucketStamp[], state: LifecycleState): boolean {
  return stamps.some((s) => s.state === state);
}

/** When the record entered its CURRENT state (last matching stamp), or null. */
export function currentStateSince(stamps: readonly BucketStamp[], state: string): Date | null {
  for (let i = stamps.length - 1; i >= 0; i--) {
    if (stamps[i].state === state) return new Date(stamps[i].at);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------

/**
 * `YYYY-MM-DD` range → local-midnight start + end-of-day end, so an item stamped
 * at 17:08 on `toKey` is inside the window. Shared so the report and the profile
 * window IDENTICALLY — a half-open vs closed disagreement here is the D-#354
 * failure mode (a full instant compared against a bare date key).
 */
export function dayRangeBounds(fromKey: string, toKey: string): { start: Date; end: Date } {
  const start = parseDateKey(fromKey);
  const last = parseDateKey(toKey);
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999);
  if (start.getTime() > end.getTime()) throw new Error("from must not be after to");
  return { start, end };
}

/**
 * Is `dueDate` in the PAST relative to `now`, at DAY granularity? Something due
 * TODAY is not late (D-#354's ratified semantics: the delivery/due day counts as
 * still open). A missing due date is never late.
 *
 * Compares local date keys, never instants — the mistake D-#354 fixed was
 * comparing a full ISO instant against a bare key.
 */
export function isOverdue(dueDate: Date | null | undefined, now: Date): boolean {
  if (!dueDate) return false;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  return dateKeyOf(due) < dateKeyOf(now);
}
