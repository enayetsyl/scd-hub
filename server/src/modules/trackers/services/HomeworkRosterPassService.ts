/**
 * HomeworkRosterPassService (RP-1, D-#355) — the two roster-shaped stages of the
 * homework lifecycle, driven attendance-style: the teacher crosses only the
 * exceptions and commits the whole roster once.
 *
 * A pure orchestrator over `transitionRecord` (HomeworkService) — exactly the
 * posture of HomeworkOutcomeService: no edge/notification logic is duplicated
 * here, every mutation still runs through `assertTransition` inside that service,
 * and nothing is wrapped in a Mongo transaction (see HomeworkOutcomeService's
 * doc-comment for the reasoning — a mid-pass failure leaves each record at a
 * legal state and a re-run is an idempotent no-op for those already advanced).
 *
 * THE ONE RULE that differs from a raw transition (PRD §3.1): crossing a student
 * chases them ONLY on the FIRST cross. An already-CHASE record crossed again is a
 * pure no-op — no state stamp, no chaseCount increment, no guardian reminder.
 * Subsequent escalation is the teacher's explicit `transitionHomeworkRecord`
 * (CHASE → CHASE) tap, not a side effect of re-running the pass.
 */
import type { LifecycleState } from "@scd/shared";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { transitionRecord } from "./HomeworkService";

/** States the submit pass acts on (the engine moves GIVEN → DUE itself). */
const SUBMIT_ACTIONABLE: readonly LifecycleState[] = ["GIVEN", "DUE", "CHASE"];
/** States the return pass acts on. */
const RETURN_ACTIONABLE: readonly LifecycleState[] = ["CHECKED", "RESUBMIT"];

export interface SubmitPassEntry {
  recordId: string;
  /** true = handed in (→ SUBMITTED); false = didn't (→ CHASE on first cross). */
  submitted: boolean;
}

export interface SubmitPassResult {
  submittedCount: number;
  /** Records newly moved into CHASE by this pass (first crosses only). */
  chasedCount: number;
  /** Crossed-but-already-CHASE records — no-ops (PRD §3.1). */
  unchangedCount: number;
}

export interface ReturnPassEntry {
  recordId: string;
  returned: boolean;
}

export interface ReturnPassResult {
  returnedCount: number;
  unchangedCount: number;
}

/**
 * The submission pass. Each entry's record must currently be GIVEN | DUE | CHASE
 * (the app never sends otherwise; the server does not trust that). One `at` is
 * shared by every hop of a single record's walk so D-#338's popActionGroup can
 * undo the whole fast-forward as one action.
 */
export async function submitPass(
  itemId: string,
  entries: SubmitPassEntry[],
  actorId: string,
  at: Date = new Date(),
): Promise<SubmitPassResult> {
  const result: SubmitPassResult = { submittedCount: 0, chasedCount: 0, unchangedCount: 0 };

  for (const entry of entries) {
    const record = await HomeworkStudentRecord.findById(entry.recordId).select("state hwItemId").lean();
    if (!record) throw new Error(`HomeworkStudentRecord not found: ${entry.recordId}`);
    if (record.hwItemId.toString() !== itemId) {
      throw new Error(`Record ${entry.recordId} does not belong to this homework item`);
    }
    const state = record.state as LifecycleState;
    if (!SUBMIT_ACTIONABLE.includes(state)) {
      throw new Error(`Cannot run the submission pass on a ${state} record — use the workspace card's exception actions`);
    }

    if (entry.submitted) {
      // Fast-forward to SUBMITTED — GIVEN→DUE→SUBMITTED, or DUE|CHASE→SUBMITTED.
      if (state === "GIVEN") {
        await transitionRecord({ recordId: entry.recordId, toState: "DUE", actorId, at });
      }
      await transitionRecord({ recordId: entry.recordId, toState: "SUBMITTED", actorId, at });
      result.submittedCount += 1;
    } else if (state === "CHASE") {
      // Already chased — crossing again is a no-op (PRD §3.1).
      result.unchangedCount += 1;
    } else {
      // First cross: GIVEN→DUE→CHASE, or DUE→CHASE. transitionRecord increments
      // chaseCount 0→1 and emits the D-#260 guardian reminder.
      if (state === "GIVEN") {
        await transitionRecord({ recordId: entry.recordId, toState: "DUE", actorId, at });
      }
      await transitionRecord({ recordId: entry.recordId, toState: "CHASE", actorId, at });
      result.chasedCount += 1;
    }
  }

  return result;
}

/** The return pass — CHECKED | RESUBMIT → RETURNED for the uncrossed records. */
export async function returnPass(
  itemId: string,
  entries: ReturnPassEntry[],
  actorId: string,
  at: Date = new Date(),
): Promise<ReturnPassResult> {
  const result: ReturnPassResult = { returnedCount: 0, unchangedCount: 0 };

  for (const entry of entries) {
    if (!entry.returned) {
      result.unchangedCount += 1;
      continue;
    }
    const record = await HomeworkStudentRecord.findById(entry.recordId).select("state hwItemId").lean();
    if (!record) throw new Error(`HomeworkStudentRecord not found: ${entry.recordId}`);
    if (record.hwItemId.toString() !== itemId) {
      throw new Error(`Record ${entry.recordId} does not belong to this homework item`);
    }
    const state = record.state as LifecycleState;
    if (!RETURN_ACTIONABLE.includes(state)) {
      throw new Error(`Cannot return a ${state} record — only a checked khata is handed back`);
    }
    await transitionRecord({ recordId: entry.recordId, toState: "RETURNED", actorId, at });
    result.returnedCount += 1;
  }

  return result;
}
