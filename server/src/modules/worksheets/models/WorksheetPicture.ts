/**
 * WorksheetPicture — one picture in the bank (D-#746).
 *
 * Every picture is lifted from the school's own Nursery books 2026 (owner ruling
 * 2026-10-16: "use the pictures in the book exactly"), so the bank is a re-cut of
 * material the children already hold — not stock art.
 *
 * The bytes live HERE (Buffer), not in Drive: a picture is 10–60 KB, the whole bank a
 * few MB, and the PDF renderer reads dozens per paper — a Drive round-trip each would
 * make "send to print" crawl and tie it to Drive's availability. `thumb` (≤240 px JPEG)
 * feeds the app's preview and bank grid; `image` (≤600 px) feeds the print.
 *
 * `sourceKey` (book:page:index) makes the importer idempotent — re-running it on the
 * same book updates rows instead of duplicating them, and never touches tags.
 *
 * Content plane, no identity: a picture names no child or staff member.
 */
import { Schema, model, Document, Types } from "mongoose";
import { WORKSHEET_PICTURE_BOOKS, WORKSHEET_PICTURE_USES } from "@scd/shared";
import type { WorksheetPictureBook, WorksheetPictureUse } from "@scd/shared";

export interface IWorksheetPicture extends Document {
  _id: Types.ObjectId;
  book: WorksheetPictureBook;
  /** PDF page number in the source book file. */
  page: number;
  imageIndex: number;
  sourceKey: string;
  /** The word as the book prints it (আম, apple). Null = not yet tagged. */
  word?: string | null;
  wordEn?: string | null;
  /** First letter the child should write (আ, A). Null = not yet tagged. */
  letter?: string | null;
  /**
   * The letter whose page the picture sits on (ব্যাঙ → ঙ, বাঁশ → ঁ). Picture–letter MATCH
   * pairs a picture with this letter, as the book and the 2025 finals do; null = `letter`.
   */
  pageLetter?: string | null;
  uses: WorksheetPictureUse[];
  /** Kept for the final exam: assignments and class tests never draw it. */
  reserveForFinal: boolean;
  /** False = hidden from every paper (a duplicate, a fragment, a decoration). */
  active: boolean;
  image: Buffer;
  thumb: Buffer;
  mime: string;
  width: number;
  height: number;
  /** Stamped when a paper carrying it is SENT to print (a preview never counts). */
  lastUsedAt?: Date | null;
  useCount: number;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const WorksheetPictureSchema = new Schema<IWorksheetPicture>(
  {
    book: { type: String, enum: WORKSHEET_PICTURE_BOOKS, required: true },
    page: { type: Number, required: true, min: 1 },
    imageIndex: { type: Number, required: true, min: 0 },
    sourceKey: { type: String, required: true },
    word: { type: String, trim: true, default: null },
    wordEn: { type: String, trim: true, default: null },
    letter: { type: String, trim: true, default: null },
    pageLetter: { type: String, trim: true, default: null },
    uses: { type: [String], enum: WORKSHEET_PICTURE_USES, default: [] },
    reserveForFinal: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    image: { type: Buffer, required: true },
    thumb: { type: Buffer, required: true },
    mime: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    lastUsedAt: { type: Date, default: null },
    useCount: { type: Number, default: 0 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

WorksheetPictureSchema.index({ sourceKey: 1 }, { unique: true });
WorksheetPictureSchema.index({ book: 1, active: 1, page: 1 });

/** Every read that is not the image route must leave the bytes behind. */
export const PICTURE_META_FIELDS = "-image -thumb";

export const WorksheetPicture = model<IWorksheetPicture>("WorksheetPicture", WorksheetPictureSchema);
