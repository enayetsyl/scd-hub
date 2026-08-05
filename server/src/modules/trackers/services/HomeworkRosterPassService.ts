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
import { Types } from "mongoose";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { transitionRecord } from "./HomeworkService";
import { dateKeyOf } from "../../attendance/dates";

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
  /** Siblings the pass's payload MISSED that the due-day sweep auto-chased
   *  (owner ruling 2026-08-04 — normally 0: the app sends every open row). */
  autoChasedCount: number;
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
  const result: SubmitPassResult = {
    submittedCount: 0,
    chasedCount: 0,
    unchangedCount: 0,
    autoChasedCount: 0,
  };

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

  // Owner ruling (2026-08-04): on/after the due day, committing the pass
  // auto-chases every sibling still owed — even one the payload missed.
  // Attributed to the committing teacher: the chase is part of their commit.
  result.autoChasedCount = await chaseUnsubmittedSiblings(itemId, {
    excludeRecordIds: entries.map((e) => e.recordId),
    actorId,
    at,
  });

  return result;
}

/**
 * Chase every sibling record of `itemId` still GIVEN | DUE whose due DAY has
 * arrived (day-granular — a pass run a day early chases only the explicitly
 * crossed) and whose chaseCount is 0, excluding ids the pass already handled.
 * ABSENT_REDELIVER is never touched (the child never received the sheet — it
 * carries no dueDate). Runs through `transitionRecord` so the chaseCount bump,
 * the D-#260 guardian reminder and the D-#338 stamps stay one truth. Both
 * filters (state + chaseCount 0) preserve D-#355 first-cross-only.
 */
export async function chaseUnsubmittedSiblings(
  itemId: string,
  opts: { excludeRecordIds?: string[]; actorId?: string; at?: Date } = {},
): Promise<number> {
  const at = opts.at ?? new Date();
  const todayKey = dateKeyOf(at);
  const exclude = (opts.excludeRecordIds ?? []).map((id) => new Types.ObjectId(id));

  const siblings = await HomeworkStudentRecord.find({
    hwItemId: itemId,
    state: { $in: ["GIVEN", "DUE"] },
    chaseCount: 0,
    dueDate: { $exists: true, $ne: null },
    ...(exclude.length > 0 ? { _id: { $nin: exclude } } : {}),
  })
    .select("state dueDate")
    .lean();

  let chased = 0;
  for (const sib of siblings) {
    if (!sib.dueDate || dateKeyOf(new Date(sib.dueDate)) > todayKey) continue; // not due yet
    if (sib.state === "GIVEN") {
      await transitionRecord({ recordId: sib._id.toString(), toState: "DUE", actorId: opts.actorId, at });
    }
    await transitionRecord({ recordId: sib._id.toString(), toState: "CHASE", actorId: opts.actorId, at });
    chased += 1;
  }
  return chased;
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
