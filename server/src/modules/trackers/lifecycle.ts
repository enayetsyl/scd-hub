/**
 * Tracker lifecycle engine — the ratified 6-stage lifecycle (handoff §3, FIRM).
 *
 * Built ONCE here and SHARED by the homework tracker (HW-T1) and the future
 * assignment tracker (handoff §1/§3 — "built once, shared by both"). Pure logic:
 * the legal transition graph + guards + the stage grouping. It holds no DB
 * access — services stamp `stateDates` and persist; this module only answers
 * "is this move legal?" and "what stage is this state?".
 *
 * The 6 stages map to 8 ATOMIC states (two stages are compound — D-#37):
 *   1 Given            → GIVEN
 *   2 Absent/Redeliver → ABSENT_REDELIVER
 *   3 Due              → DUE
 *   4 Submitted/Chase  → SUBMITTED, CHASE
 *   5 Checked/Resubmit → CHECKED, RESUBMIT
 *   6 Returned         → RETURNED  (terminal)
 *
 * Invariants (handoff §3): no state skipping except GIVEN→DUE (the normal
 * overnight path) and the absence handling (ABSENT_REDELIVER→GIVEN). Every
 * transition is timestamped by the caller. A resubmission is a NEW record on the
 * same HW_ID (spawned in HW-T3), not a back-edge here.
 */
import { LIFECYCLE_STATES } from "@scd/shared";
import type { LifecycleState } from "@scd/shared";

/** The 6 stages, by number (handoff §3). */
export type LifecycleStage = 1 | 2 | 3 | 4 | 5 | 6;

/** State → stage (handoff §3 — stages 4 and 5 are compound). */
export const STAGE_OF: Record<LifecycleState, LifecycleStage> = {
  GIVEN: 1,
  ABSENT_REDELIVER: 2,
  DUE: 3,
  SUBMITTED: 4,
  CHASE: 4,
  CHECKED: 5,
  RESUBMIT: 5,
  RETURNED: 6,
};

/** A record may be CREATED (issued) only in these states (handoff §3 step 1/2):
 *  present at issue → GIVEN; absent at issue → ABSENT_REDELIVER. */
export const ENTRY_STATES: readonly LifecycleState[] = ["GIVEN", "ABSENT_REDELIVER"];

/** Terminal states — no outgoing transition (handoff §3 stage 6). */
export const TERMINAL_STATES: readonly LifecycleState[] = ["RETURNED"];

/**
 * Legal directed edges (handoff §3). Anything not listed is rejected.
 *   GIVEN            → DUE                    (normal overnight path)
 *   ABSENT_REDELIVER → GIVEN                  (re-deliver on next attendance)
 *   DUE              → SUBMITTED | CHASE      (submitted on time | not submitted)
 *   CHASE            → SUBMITTED | CHASE      (submitted later | chased again)
 *   SUBMITTED        → CHECKED                (teacher checks)
 *   CHECKED          → RETURNED | RESUBMIT    (correct | wrong→resubmission, HW-T3)
 *   RESUBMIT         → RETURNED               (original handed back; the new record runs its own pass)
 *   RETURNED         → ∅                      (terminal)
 */
export const LIFECYCLE_EDGES: Record<LifecycleState, readonly LifecycleState[]> = {
  GIVEN: ["DUE"],
  ABSENT_REDELIVER: ["GIVEN"],
  DUE: ["SUBMITTED", "CHASE"],
  SUBMITTED: ["CHECKED"],
  CHASE: ["SUBMITTED", "CHASE"],
  CHECKED: ["RETURNED", "RESUBMIT"],
  RESUBMIT: ["RETURNED"],
  RETURNED: [],
};

export function isLifecycleState(s: string): s is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(s);
}

export function isEntryState(s: LifecycleState): boolean {
  return ENTRY_STATES.includes(s);
}

export function isTerminalState(s: LifecycleState): boolean {
  return TERMINAL_STATES.includes(s);
}

/** True iff `from → to` is a legal single transition. */
export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return LIFECYCLE_EDGES[from].includes(to);
}

/** Throw a descriptive error if `from → to` is illegal (the guard services call). */
export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!isLifecycleState(to)) {
    throw new Error(`Unknown lifecycle state: ${to}`);
  }
  if (!canTransition(from, to)) {
    const legal = LIFECYCLE_EDGES[from];
    throw new Error(
      `Illegal lifecycle transition ${from} → ${to}` +
        (legal.length ? ` (legal: ${legal.join(", ")})` : ` (${from} is terminal)`),
    );
  }
}

// ---------------------------------------------------------------------------
// Revert (D-#338) — pop the last ACTION off a record's stateDates.
// ---------------------------------------------------------------------------

/** The stamp shape both trackers persist per transition. `by` was added with the
 *  revert capability (D-#338); older stamps lack it. */
export interface StateStampLike {
  state: LifecycleState;
  at: Date;
  by?: unknown;
}

/**
 * Determine the record's last ACTION as the trailing run of stamps sharing the
 * final stamp's exact `at` — multi-hop mutations (one-tap outcome, collect,
 * WRONG check) push their stamps with ONE timestamp, so this run is precisely
 * "what the teacher did last". Pure; throws on invariant breach:
 *  - the entry stamp (index 0 — issuance) is never popped;
 *  - the final stamp must match the record's current state (audit consistency).
 * Returns the popped stamps (oldest→newest) and the stamp whose state is restored.
 */
export function popActionGroup<T extends StateStampLike>(
  stateDates: readonly T[],
  currentState: LifecycleState,
): { popped: T[]; restored: T } {
  if (stateDates.length < 2) {
    throw new Error("প্রথম ধাপ (ইস্যু) ফেরানো যায় না");
  }
  const last = stateDates[stateDates.length - 1];
  if (last.state !== currentState) {
    throw new Error("রেকর্ডের অবস্থা অসঙ্গত — ফেরানো সম্ভব নয়");
  }
  const t = new Date(last.at).getTime();
  let start = stateDates.length - 1;
  // Extend the group backwards over identical timestamps, but never swallow
  // the entry stamp at index 0.
  while (start > 1 && new Date(stateDates[start - 1].at).getTime() === t) start -= 1;
  return {
    popped: stateDates.slice(start) as T[],
    restored: stateDates[start - 1],
  };
}
