/**
 * HintView — one hint step a guardian opened for one child (GH-1, D-#1521). Written at most once per
 * guardian × child × question × step × Dhaka day. Per-child operational data (identity plane): the
 * corpus plane has no path to it (ADR-005). Never holds the hint text — only that it was opened.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IHintView extends Document {
  _id: Types.ObjectId;
  guardianUserId: Types.ObjectId;
  studentId: Types.ObjectId;
  qid: string;
  step: 1 | 2 | 3;
  /** Dhaka calendar day, "YYYY-MM-DD". */
  day: string;
  at: Date;
}

const HintViewSchema = new Schema<IHintView>({
  guardianUserId: { type: Schema.Types.ObjectId, required: true },
  studentId: { type: Schema.Types.ObjectId, required: true },
  qid: { type: String, required: true },
  step: { type: Number, enum: [1, 2, 3], required: true },
  day: { type: String, required: true },
  at: { type: Date, required: true, default: () => new Date() },
});

HintViewSchema.index({ guardianUserId: 1, studentId: 1, qid: 1, step: 1, day: 1 }, { unique: true });
// The teacher / Office read: how many steps of an item a child's family opened.
HintViewSchema.index({ studentId: 1, qid: 1 });

export const HintView = model<IHintView>("HintView", HintViewSchema);
