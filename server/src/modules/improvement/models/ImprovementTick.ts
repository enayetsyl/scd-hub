import { Schema, model, Document, Types } from "mongoose";
import {
  IMPROVEMENT_PARTS,
  IMPROVEMENT_TICK_STATUSES,
  IMPROVEMENT_REASONS,
  type ImprovementPart,
  type ImprovementTickStatus,
  type ImprovementReason,
} from "@scd/shared";

/**
 * ImprovementTick (SP-2/SP-3, D-#735/#737) — one person's answer for one scheduled day:
 * DONE, or COULDNT with a reason. ONE row per (action, part, day, student):
 *   - TEACHER part: `studentId` null — the teacher's task is one per day, also for a
 *     CLASS action.
 *   - GUARDIAN part: `studentId` = the child — a CLASS action has one guardian tick per
 *     student; any linked guardian of that child may give it.
 *
 * A scheduled day with no row is "not marked" once it has passed — derived, never a row.
 *
 * `markedBy*` is who pressed the button. For a teacher day that is the teacher, the
 * cover teacher on a leave day (`asCover`), or Office/Principal (`onBehalf`, with a
 * D-#737 reason). Exactly one of `markedByUserId` / `markedByGuardianId` is set.
 * Undo DELETES the row (same day only) and writes an audit row (ADR-008).
 */
export interface IImprovementTick extends Document {
  _id: Types.ObjectId;
  actionId: Types.ObjectId;
  part: ImprovementPart;
  dayKey: string;
  studentId?: Types.ObjectId | null;
  status: ImprovementTickStatus;
  reason?: ImprovementReason | null;
  markedByUserId?: Types.ObjectId | null;
  markedByGuardianId?: Types.ObjectId | null;
  onBehalf: boolean;
  asCover: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ImprovementTickSchema = new Schema<IImprovementTick>(
  {
    actionId: { type: Schema.Types.ObjectId, ref: "ImprovementAction", required: true },
    part: { type: String, enum: IMPROVEMENT_PARTS, required: true },
    dayKey: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", default: null },
    status: { type: String, enum: IMPROVEMENT_TICK_STATUSES, required: true },
    reason: { type: String, enum: [...IMPROVEMENT_REASONS, null], default: null },
    markedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    markedByGuardianId: { type: Schema.Types.ObjectId, ref: "Guardian", default: null },
    onBehalf: { type: Boolean, default: false },
    asCover: { type: Boolean, default: false },
  },
  { timestamps: true },
);

ImprovementTickSchema.index({ actionId: 1, part: 1, dayKey: 1, studentId: 1 }, { unique: true });
ImprovementTickSchema.index({ dayKey: 1, part: 1 });

export const ImprovementTick = model<IImprovementTick>("ImprovementTick", ImprovementTickSchema);
