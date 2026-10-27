import { Schema, model, Document, Types } from "mongoose";
import type { RosterClassLevel } from "@scd/shared";
import { ROSTER_CLASS_LEVEL_MIN, ROSTER_CLASS_LEVEL_MAX } from "@scd/shared";

/**
 * ClassBook — a book kept in the classroom that families may READ in the app (D-#870,
 * docs/prd-class-books.md). The Office uploads the PDF once; the server renders every
 * page to a JPEG (StoredFile kind `class_book_page`, Drive-backed) and drops the PDF.
 * Readers only ever receive one page image at a time — there is no file to download.
 *
 * Keyed by the roster class LEVEL (−1 Nursery … 5), not a year's Class row: the same
 * printed book serves the level, and a new session's book replaces it by upload.
 */
export const CLASS_BOOK_STATUSES = ["PROCESSING", "READY", "FAILED"] as const;
export type ClassBookStatus = (typeof CLASS_BOOK_STATUSES)[number];

export interface IClassBook extends Document {
  _id: Types.ObjectId;
  classLevel: RosterClassLevel;
  title: string;
  /** Lower first inside a class; ties by title. */
  sortOrder: number;
  status: ClassBookStatus;
  /** Bangla reason when status = FAILED. */
  error?: string;
  /** Page images in reading order (StoredFile ids). Empty until READY. */
  pageFileIds: Types.ObjectId[];
  pageCount: number;
  /** Page height ÷ width of the rendered images, so the reader can size a page before it loads. */
  pageAspect: number;
  /** Hidden books stay for staff but disappear for guardians. */
  active: boolean;
  /** The uploaded file's name — a label for the Office, the PDF itself is not kept. */
  sourceName: string;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ClassBookSchema = new Schema<IClassBook>(
  {
    classLevel: { type: Number, min: ROSTER_CLASS_LEVEL_MIN, max: ROSTER_CLASS_LEVEL_MAX, required: true },
    title: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: CLASS_BOOK_STATUSES, required: true, default: "PROCESSING" },
    error: { type: String },
    pageFileIds: [{ type: Schema.Types.ObjectId, ref: "StoredFile" }],
    pageCount: { type: Number, default: 0 },
    pageAspect: { type: Number, default: 1.357 },
    active: { type: Boolean, default: true },
    sourceName: { type: String, default: "" },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ClassBookSchema.index({ classLevel: 1, sortOrder: 1 });
// The /files gate reverse-resolves a page to its book.
ClassBookSchema.index({ pageFileIds: 1 });

export const ClassBook = model<IClassBook>("ClassBook", ClassBookSchema);
