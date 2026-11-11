import { Schema, model, Document, Types } from "mongoose";

/**
 * VivaMark — one child's oral marks on one VivaPaper (VV-1, D-#1080). Written tap by tap
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
  /** The question set this child was given (D-#1276) — drawn when the examiner taps the name,
   *  then final. Null on a one-set paper (the only set applies) or before the draw. */
  setKey?: string | null;
  drawnAt?: Date | null;
  drawnBy?: Types.ObjectId | null;
  /** Per question key; a letter question's letters are stored as `<key>:<index>` (D-#1277). */
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
    setKey: { type: String, default: null },
    drawnAt: { type: Date, default: null },
    drawnBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    marks: { type: [ItemMarkSchema], default: [] },
    enteredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    enteredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

VivaMarkSchema.index({ paperId: 1, studentId: 1 }, { unique: true });

export const VivaMark = model<IVivaMark>("VivaMark", VivaMarkSchema);
