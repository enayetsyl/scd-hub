import { Schema, model, Document, Types } from "mongoose";
import { ACTIVITY_LEVELS, type ActivityLevel } from "@scd/shared";

/**
 * One activity sheet (AS-1) — one A4 page, id `SD-E-001`. The page is `page` of `sourceFileId`
 * (the bank PDF, or a later "add sheets" PDF); the answer, when the bank has a key, is
 * `answerPage` of the bank's answer PDF (found by reading the sheet ids printed on it).
 * Retired sheets keep their history but are never picked or printed again.
 */
export interface IActivitySheet extends Document {
  _id: Types.ObjectId;
  itemId: string;
  bankId: Types.ObjectId;
  level: ActivityLevel;
  /** Running number inside the level (the 001 in SD-E-001). */
  seq: number;
  classLevels: number[];
  details?: string;
  sourceFileId?: Types.ObjectId;
  page?: number;
  answerPage?: number;
  /** The answer page rendered once (StoredFile activity_page), shared by the sheets on that page (AS-4). */
  answerImageId?: Types.ObjectId;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ActivitySheetSchema = new Schema<IActivitySheet>(
  {
    itemId: { type: String, required: true, trim: true, uppercase: true },
    bankId: { type: Schema.Types.ObjectId, ref: "ActivityBank", required: true },
    level: { type: String, enum: ACTIVITY_LEVELS, required: true },
    seq: { type: Number, required: true, min: 1 },
    classLevels: { type: [Number], default: [] },
    details: { type: String, trim: true },
    sourceFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    page: { type: Number, min: 1 },
    answerPage: { type: Number, min: 1 },
    answerImageId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

ActivitySheetSchema.index({ itemId: 1 }, { unique: true });
ActivitySheetSchema.index({ bankId: 1, level: 1, seq: 1 });

export const ActivitySheet = model<IActivitySheet>("ActivitySheet", ActivitySheetSchema);
