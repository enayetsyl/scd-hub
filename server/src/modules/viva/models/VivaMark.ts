import { Schema, model, Document, Types } from "mongoose";

/**
 * VivaMark — one child's oral marks on one VivaPaper (VV-1, D-#1070). Written tap by tap
 * (live, no save button): each tap sets or clears ONE question's mark by the item's key.
 *
 * `absent` (owner, 2026-11-06): no make-up and no guardian pop-up; the oral counts 0 in the
 * subject total. Marks already tapped are kept while absent (an absent tap by mistake loses
 * nothing) but never counted. The total is computed on read (D-#85), never stored.
 *
 * Identity plane; no corpus path (ADR-005).
 */
export interface IVivaItemMark {
  key: string;
  value: number;
}

export interface IVivaMark extends Document {
  _id: Types.ObjectId;
  paperId: Types.ObjectId;
  studentId: Types.ObjectId;
  absent: boolean;
  marks: IVivaItemMark[];
  enteredBy?: Types.ObjectId | null;
  enteredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ItemMarkSchema = new Schema<IVivaItemMark>(
  {
    key: { type: String, required: true },
    value: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const VivaMarkSchema = new Schema<IVivaMark>(
  {
    paperId: { type: Schema.Types.ObjectId, ref: "VivaPaper", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    absent: { type: Boolean, default: false },
    marks: { type: [ItemMarkSchema], default: [] },
    enteredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    enteredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

VivaMarkSchema.index({ paperId: 1, studentId: 1 }, { unique: true });

export const VivaMark = model<IVivaMark>("VivaMark", VivaMarkSchema);
