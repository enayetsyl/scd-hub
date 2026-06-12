import { Schema, model, Document, Types } from "mongoose";
import { COPY_STATUSES, type CopyStatus } from "@scd/shared";

/**
 * One PHYSICAL copy with its unique school-assigned accession number
 * (prd-library §5, D-#82). WITHDRAWN = removed from circulation but never
 * deleted — loan history keeps pointing at the accession number. ON_LOAN /
 * ON_HOLD are circulation-managed states (set by the loan/reservation
 * services, never directly by a catalog mutation).
 */
export interface IBookCopy extends Document {
  _id: Types.ObjectId;
  titleId: Types.ObjectId;
  /** Unique, school-assigned; typed/searched at the desk (no barcodes in v1). */
  accessionNo: string;
  status: CopyStatus;
  conditionNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BookCopySchema = new Schema<IBookCopy>(
  {
    titleId: { type: Schema.Types.ObjectId, ref: "BookTitle", required: true },
    accessionNo: { type: String, required: true, unique: true, trim: true },
    status: { type: String, enum: COPY_STATUSES, required: true, default: "AVAILABLE" },
    conditionNote: { type: String, trim: true },
  },
  { timestamps: true },
);

BookCopySchema.index({ titleId: 1, status: 1 });

export const BookCopy = model<IBookCopy>("BookCopy", BookCopySchema);
