import { Schema, model, Document, Types } from "mongoose";

/**
 * WorkRevertNote (D-#951, docs/prd-staff-mistakes.md §12) — a homework / assignment mark
 * undone after it was given: a RESUBMIT (the guardian had already been told to resubmit) or a
 * CHECKED result. The revert pops the stamps off the record, so this note keeps who made the
 * undone mark, which marks, and who undid them. ONE note per revert per owner; the
 * StaffMistake row (kind WORK_REVERT) points here.
 */
export interface IWorkRevertNote extends Document {
  _id: Types.ObjectId;
  tracker: "HOMEWORK" | "ASSIGNMENT";
  recordId: Types.ObjectId;
  itemCode: string;
  studentId: Types.ObjectId;
  /** Who made the undone marks. */
  staffUserId: Types.ObjectId;
  /** The undone marks, oldest first (CHECKED / RESUBMIT). */
  states: { state: string; at: Date }[];
  revertedBy: Types.ObjectId;
  at: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WorkRevertNoteSchema = new Schema<IWorkRevertNote>(
  {
    tracker: { type: String, enum: ["HOMEWORK", "ASSIGNMENT"], required: true },
    recordId: { type: Schema.Types.ObjectId, required: true },
    itemCode: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    staffUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    states: {
      type: [new Schema({ state: { type: String, required: true }, at: { type: Date, required: true } }, { _id: false })],
      default: [],
    },
    revertedBy: { type: Schema.Types.ObjectId, required: true },
    at: { type: Date, required: true },
  },
  { timestamps: true },
);

WorkRevertNoteSchema.index({ staffUserId: 1, createdAt: -1 });

export const WorkRevertNote = model<IWorkRevertNote>("WorkRevertNote", WorkRevertNoteSchema);
