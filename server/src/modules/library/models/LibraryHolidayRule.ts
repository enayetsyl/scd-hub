import { Schema, model, Document, Types } from "mongoose";

/**
 * A dated holiday rule for student loans (SB-2, D-#982): between `fromDay` and `toDay`
 * (Dhaka calendar days, inclusive) a child may hold up to `maxConcurrent` books and every
 * book issued in that window falls due on `dueDay`. Outside the window the ordinary
 * STUDENT LibraryPolicy applies. Admin data (`library:settings`); retired, never deleted.
 */
export interface ILibraryHolidayRule extends Document {
  _id: Types.ObjectId;
  nameBn: string;
  /** YYYY-MM-DD, Dhaka. */
  fromDay: string;
  toDay: string;
  dueDay: string;
  maxConcurrent: number;
  active: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const LibraryHolidayRuleSchema = new Schema<ILibraryHolidayRule>(
  {
    nameBn: { type: String, required: true, trim: true },
    fromDay: { type: String, required: true, match: DAY },
    toDay: { type: String, required: true, match: DAY },
    dueDay: { type: String, required: true, match: DAY },
    maxConcurrent: { type: Number, required: true, min: 1, max: 20 },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

LibraryHolidayRuleSchema.index({ active: 1, fromDay: 1, toDay: 1 });

export const LibraryHolidayRule = model<ILibraryHolidayRule>("LibraryHolidayRule", LibraryHolidayRuleSchema);
