/**
 * HomeworkRevertService (D-#338) — undo a mistaken lifecycle action on ONE
 * homework student record: pop the last ACTION (the trailing run of stateDates
 * stamps sharing the final stamp's timestamp — multi-hop mutations write one
 * timestamp per action) and restore the previous state, cleaning up the
 * popped stamps' side effects.
 *
 * Policy (owner, 2026-07-19): the ACTING teacher may revert their own last
 * action until end of that Dhaka day; Principal/Office (`admin`) anytime.
 * Blocked for everyone when downstream work exists (a spawned resubmission
 * that has progressed / carries an answer file).
 *
 * Accepted, deliberately NOT blocked (documented):
 *  - guardian notifications already sent (chase / results) cannot be unsent;
 *    the emitters' per-day dedupe prevents double-notifying on a redo;
 *  - a reconciled day does NOT block record reverts — reconciliation freezes
 *    the Layer-A declare/trim ledger; these Layer-B pops never touch
 *    dayTotal/trimLog, and issuance itself is never undone (the entry stamp
 *    is never popped);
 *  - the answer file stays attached (an attachment is not a lifecycle side
 *    effect).
 */
import type { LifecycleState, HwResult } from "@scd/shared";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { popActionGroup } from "../lifecycle";
import { isSameDhakaDay } from "../../../lib/dhakaDay";
import { writeAudit } from "../../platform/services/AuditService";

export interface HwRevertInput {
  recordId: string;
  actorId: string;
  /** Resolver passes role === PRINCIPAL || OFFICE. */
  admin: boolean;
  /** Test seam. */
  now?: Date;
}

export interface HwRevertResult {
  recordId: string;
  hwId: string;
  state: string;
  poppedStates: string[];
  chaseCount: number;
  result: string | null;
  deletedResubmissionId: string | null;
}

export async function revertHomeworkRecord(input: HwRevertInput): Promise<HwRevertResult> {
  const rec = await HomeworkStudentRecord.findById(input.recordId);
  if (!rec) throw new Error("HomeworkStudentRecord not found");

  const { popped, restored } = popActionGroup(rec.stateDates, rec.state);

  if (!input.admin) {
    // Own-action gate: a stamped foreign actor blocks; unstamped (pre-D-#338 /
    // system) stamps fall back to write-scope-only (the resolver already
    // enforced section+subject write scope).
    const foreign = popped.some((s) => s.by && s.by.toString() !== input.actorId);
    if (foreign) {
      throw new Error("এই ধাপটি অন্য শিক্ষক করেছেন — তিনি অথবা অফিস/অধ্যক্ষ ফেরাতে পারবেন");
    }
    const now = input.now ?? new Date();
    if (!isSameDhakaDay(new Date(popped[popped.length - 1].at), now)) {
      throw new Error("শুধু সেই দিনের কাজ সেদিনই ফেরানো যায় — অফিস/অধ্যক্ষের সাহায্য নিন");
    }
  }

  // Downstream guard + side-effect cleanup, newest popped stamp first.
  let deletedResubmissionId: string | null = null;
  for (const stamp of [...popped].reverse()) {
    switch (stamp.state as LifecycleState) {
      case "RESUBMIT": {
        const spawn = await HomeworkStudentRecord.findOne({ resubOf: rec._id });
        if (spawn) {
          const untouched =
            spawn.state === "GIVEN" && spawn.stateDates.length === 1 && !spawn.answerFileId;
          if (!untouched) {
            throw new Error("পুনঃজমার কাজ শুরু হয়ে গেছে — আগে সেটি ফেরাতে হবে");
          }
          deletedResubmissionId = spawn._id.toString();
          await HomeworkStudentRecord.deleteOne({ _id: spawn._id });
        }
        break;
      }
      case "CHECKED":
        rec.result = undefined;
        break;
      case "CHASE":
        rec.chaseCount = Math.max(0, rec.chaseCount - 1);
        break;
      case "GIVEN":
        // Undo a redeliver: absent records carry no due date pre-redelivery.
        if (restored.state === "ABSENT_REDELIVER") rec.dueDate = undefined;
        break;
      default:
        break; // SUBMITTED / DUE / RETURNED — state restore only
    }
  }

  const revertedFrom = rec.state;
  rec.state = restored.state as LifecycleState;
  rec.stateDates.splice(rec.stateDates.length - popped.length, popped.length);
  await rec.save();

  // The ONLY trace this revert ever happened: the popped stamps are now gone from
  // the record, so without this row a submitted+checked record silently reads as
  // never-submitted (D-#354). Keep the full popped detail — who did the undone
  // work and when — since that is exactly what an "it went back to pending"
  // investigation needs.
  await writeAudit({
    eventKind: "HW_RECORD_REVERTED",
    actorId: input.actorId,
    targetId: rec._id,
    targetKind: "HomeworkStudentRecord",
    meta: {
      hwId: rec.hwId,
      hwItemId: rec.hwItemId.toString(),
      studentId: rec.studentId.toString(),
      revertedFrom,
      restoredTo: rec.state,
      admin: input.admin,
      popped: popped.map((s) => ({
        state: s.state,
        at: new Date(s.at).toISOString(),
        by: s.by ? s.by.toString() : null,
      })),
      ...(deletedResubmissionId ? { deletedResubmissionId } : {}),
    },
  });

  return {
    recordId: rec._id.toString(),
    hwId: rec.hwId,
    state: rec.state,
    poppedStates: popped.map((s) => s.state),
    chaseCount: rec.chaseCount,
    result: (rec.result as HwResult | undefined) ?? null,
    deletedResubmissionId,
  };
}
