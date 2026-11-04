import { Schema, model, Document, Types } from "mongoose";
import { STAFF_MISTAKE_KINDS, type StaffMistakeKind } from "@scd/shared";

/**
 * StaffMistakeNote (D-#952, docs/prd-staff-mistakes.md §13) — the generic source detail for
 * places that need no model of their own: a line of Bangla written at the moment the
 * correction happened ("\"পরীক্ষার নোটিশ\" — লেখা বদলানো হয়েছে, ৬২ জন আগেই দেখেছিলেন"),
 * who made it and when.
 *
 * ONE note per (kind × refKey × owner × episode). `refKey` names the thing (a notice id, a
 * release batch, a payroll run…); a new episode starts once the entry behind the previous
 * one has been explained or decided (as D-#944).
 */
export interface IStaffMistakeNote extends Document {
  _id: Types.ObjectId;
  kind: StaffMistakeKind;
  refKey: string;
  staffUserId: Types.ObjectId;
  episode: number;
  lines: { text: string; at: Date; by: Types.ObjectId }[];
  createdAt: Date;
  updatedAt: Date;
}

const StaffMistakeNoteSchema = new Schema<IStaffMistakeNote>(
  {
    kind: { type: String, enum: STAFF_MISTAKE_KINDS, required: true },
    refKey: { type: String, required: true },
    staffUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    episode: { type: Number, default: 1 },
    lines: {
      type: [
        new Schema(
          { text: { type: String, required: true }, at: { type: Date, required: true }, by: { type: Schema.Types.ObjectId, required: true } },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

StaffMistakeNoteSchema.index({ kind: 1, refKey: 1, staffUserId: 1, episode: 1 }, { unique: true });

export const StaffMistakeNote = model<IStaffMistakeNote>("StaffMistakeNote", StaffMistakeNoteSchema);
