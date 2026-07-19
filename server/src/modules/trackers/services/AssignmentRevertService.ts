/**
 * AssignmentRevertService (D-#338) — the assignment mirror of
 * HomeworkRevertService: pop the last ACTION off one assignment student
 * record's stateDates and restore the previous state.
 *
 * Same policy/guards as homework (see HomeworkRevertService header). Module
 * nuances:
 *  - popping CHECKED clears result AND marks AND feedback;
 *  - popping RESUBMIT alone (undo of issueAssignmentResubmission) restores
 *    CHECKED and must KEEP result/marks/feedback — the check was an earlier,
 *    separate action;
 *  - undo of a redeliver leaves dueDate as-is (redeliver sets it to the
 *    item-wide due it already equals).
 */
import type { LifecycleState, HwResult } from "@scd/shared";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { popActionGroup } from "../lifecycle";
import { isSameDhakaDay } from "../../../lib/dhakaDay";

export interface AsRevertInput {
  recordId: string;
  actorId: string;
  admin: boolean;
  now?: Date;
}

export interface AsRevertResult {
  recordId: string;
  asId: string;
  state: string;
  poppedStates: string[];
  chaseCount: number;
  result: string | null;
  marks: number | null;
  feedback: string | null;
  deletedResubmissionId: string | null;
}

export async function revertAssignmentRecord(input: AsRevertInput): Promise<AsRevertResult> {
  const rec = await AssignmentStudentRecord.findById(input.recordId);
  if (!rec) throw new Error("AssignmentStudentRecord not found");

  const { popped, restored } = popActionGroup(rec.stateDates, rec.state);

  if (!input.admin) {
    const foreign = popped.some((s) => s.by && s.by.toString() !== input.actorId);
    if (foreign) {
      throw new Error("এই ধাপটি অন্য শিক্ষক করেছেন — তিনি অথবা অফিস/অধ্যক্ষ ফেরাতে পারবেন");
    }
    const now = input.now ?? new Date();
    if (!isSameDhakaDay(new Date(popped[popped.length - 1].at), now)) {
      throw new Error("শুধু সেই দিনের কাজ সেদিনই ফেরানো যায় — অফিস/অধ্যক্ষের সাহায্য নিন");
    }
  }

  let deletedResubmissionId: string | null = null;
  for (const stamp of [...popped].reverse()) {
    switch (stamp.state as LifecycleState) {
      case "RESUBMIT": {
        const spawn = await AssignmentStudentRecord.findOne({ resubOf: rec._id });
        if (spawn) {
          const untouched = spawn.state === "GIVEN" && spawn.stateDates.length === 1;
          if (!untouched) {
            throw new Error("পুনঃজমার কাজ শুরু হয়ে গেছে — আগে সেটি ফেরাতে হবে");
          }
          deletedResubmissionId = spawn._id.toString();
          await AssignmentStudentRecord.deleteOne({ _id: spawn._id });
        }
        break;
      }
      case "CHECKED":
        rec.result = undefined;
        rec.marks = undefined;
        rec.feedback = undefined;
        break;
      case "CHASE":
        rec.chaseCount = Math.max(0, rec.chaseCount - 1);
        break;
      default:
        break; // SUBMITTED / DUE / RETURNED / GIVEN — state restore only
    }
  }

  rec.state = restored.state as LifecycleState;
  rec.stateDates.splice(rec.stateDates.length - popped.length, popped.length);
  await rec.save();

  return {
    recordId: rec._id.toString(),
    asId: rec.asId,
    state: rec.state,
    poppedStates: popped.map((s) => s.state),
    chaseCount: rec.chaseCount,
    result: (rec.result as HwResult | undefined) ?? null,
    marks: rec.marks ?? null,
    feedback: rec.feedback ?? null,
    deletedResubmissionId,
  };
}
