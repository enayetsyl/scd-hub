/**
 * HomeworkOutcomeService — one-tap outcome recording (HWG-1, D-#267).
 *
 * A pure orchestrator over the existing `transitionRecord` (HomeworkService) and
 * `checkRecord` (HomeworkResubmissionService): it fast-forwards a record through the
 * legal lifecycle edges it's already several taps behind on, then hands off to the
 * existing check logic verbatim. No edge/spawn/topup logic is duplicated here — every
 * mutation still goes through `assertTransition` inside those two services.
 *
 * Not wrapped in a Mongo transaction (`mongoose.startSession` is not used anywhere in
 * this server's request-serving code — confirmed by scan; the only hit is an offline
 * migration script). This matches the existing convention: `checkRecord` itself already
 * performs multiple non-transactional writes (the original record's save + the spawned
 * resubmission's create) and ships in production. A mid-chain failure here leaves the
 * record at a legal intermediate state (e.g. fast-forwarded to SUBMITTED but not yet
 * CHECKED) rather than a corrupt one — the teacher's retry is a no-op fast-forward
 * followed by the check call running again.
 */
import { HW_RESULTS } from "@scd/shared";
import type { LifecycleState } from "@scd/shared";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { transitionRecord, type TransitionRecordResult } from "./HomeworkService";
import { checkRecord, type CheckRecordResult, type TopupInput } from "./HomeworkResubmissionService";

export const HW_OUTCOMES = [...HW_RESULTS, "NOT_SUBMITTED"] as const;
export type HwOutcome = (typeof HW_OUTCOMES)[number];

/** States a teacher may no longer act on from this grid — the Records screen owns them. */
const NON_ACTIONABLE_STATES: readonly LifecycleState[] = [
  "ABSENT_REDELIVER",
  "CHECKED",
  "RESUBMIT",
  "RETURNED",
];

export interface RecordHomeworkOutcomeInput {
  recordId: string;
  outcome: string;
  resubmit?: boolean;
  topup?: TopupInput;
  actorId: string;
  at?: Date;
}

export type RecordHomeworkOutcomeResult =
  | { kind: "checked"; result: CheckRecordResult }
  | { kind: "chased"; result: TransitionRecordResult };

export async function recordHomeworkOutcome(
  input: RecordHomeworkOutcomeInput,
): Promise<RecordHomeworkOutcomeResult> {
  if (!(HW_OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw new Error("outcome must be one of CORRECT / PARTIAL / WRONG / NOT_SUBMITTED");
  }
  const outcome = input.outcome as HwOutcome;

  const record = await HomeworkStudentRecord.findById(input.recordId).select("state").lean();
  if (!record) throw new Error("HomeworkStudentRecord not found");

  const state = record.state as LifecycleState;
  if (NON_ACTIONABLE_STATES.includes(state)) {
    throw new Error(`Cannot record an outcome while the record is ${state} — use Records`);
  }

  const at = input.at ?? new Date();

  if (outcome === "NOT_SUBMITTED") {
    if (state === "SUBMITTED") {
      throw new Error("Cannot mark a submitted record as not-submitted — use Records");
    }
    // First-cross-only (PRD §3.1, D-#355): an already-CHASE record is a no-op —
    // re-marking not-submitted must not inflate chaseCount or re-notify the
    // guardian. Escalation is the explicit CHASE→CHASE transition (তাগাদা).
    if (state === "CHASE") {
      const rec = await HomeworkStudentRecord.findById(input.recordId)
        .select("hwId state chaseCount result dueDate")
        .lean();
      if (!rec) throw new Error("HomeworkStudentRecord not found");
      return {
        kind: "chased",
        result: {
          recordId: input.recordId,
          hwId: rec.hwId,
          state: rec.state as LifecycleState,
          chaseCount: rec.chaseCount,
          result: rec.result ?? null,
          dueDate: rec.dueDate ? new Date(rec.dueDate).toISOString() : null,
        },
      };
    }
    if (state === "GIVEN") {
      await transitionRecord({ recordId: input.recordId, toState: "DUE", actorId: input.actorId, at });
    }
    // DUE→CHASE (first cross): increments 0→1 and emits the guardian reminder.
    const result = await transitionRecord({
      recordId: input.recordId,
      toState: "CHASE",
      actorId: input.actorId,
      at,
    });
    return { kind: "chased", result };
  }

  // CORRECT / PARTIAL / WRONG — fast-forward to SUBMITTED, then apply the check verbatim.
  if (state === "GIVEN") {
    await transitionRecord({ recordId: input.recordId, toState: "DUE", actorId: input.actorId, at });
    await transitionRecord({ recordId: input.recordId, toState: "SUBMITTED", actorId: input.actorId, at });
  } else if (state === "DUE" || state === "CHASE") {
    await transitionRecord({ recordId: input.recordId, toState: "SUBMITTED", actorId: input.actorId, at });
  } else if (state !== "SUBMITTED") {
    // Unreachable given the NON_ACTIONABLE_STATES reject above — defensive only.
    throw new Error(`Cannot record an outcome while the record is ${state}`);
  }

  const result = await checkRecord({
    recordId: input.recordId,
    result: outcome,
    resubmit: input.resubmit,
    topup: input.topup,
    actorId: input.actorId,
    at,
  });
  return { kind: "checked", result };
}
