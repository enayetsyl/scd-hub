import { Schema, model, Document, Types } from "mongoose";
import { BOOK_LANGUAGES, type BookLanguage } from "@scd/shared";

/**
 * A catalog TITLE — the bibliographic record (prd-library §5, D-#82). Physical
 * copies live in `BookCopy` (one row per accession number); availability is
 * always computed from the copies, never stored here. Identity-plane module
 * (a child's reading record is identity data, ADR-005) — no corpus path.
 */
export interface IBookTitle extends Document {
  _id: Types.ObjectId;
  titleBn: string;
  titleEn?: string;
  author?: string;
  language: BookLanguage;
  /** Free text, e.g. ইসলাম শিক্ষা / গল্প / বিজ্ঞান (no fixed taxonomy in v1). */
  category?: string;
  isbn?: string;
  /** Shelf/location hint for the desk. */
  shelf?: string;
  active: boolean;
  // --- Storybook shelf (SB-1, D-#980/#986) — all optional; a plain library title has none. ---
  seriesId?: Types.ObjectId;
  /** 1-based number inside the series (the large number on the copy sticker). */
  seriesNo?: number;
  tagIds?: Types.ObjectId[];
  /** "এই বইয়ে শিশু শিখবে" — from the book's own back page. */
  learnedPointsBn?: string[];
  parentTipBn?: string;
  /** `storybook_page` StoredFiles: the cover and up to 3 preview pages. The full book is never kept. */
  coverFileId?: Types.ObjectId;
  previewFileIds?: Types.ObjectId[];
  /** A just-uploaded book stays hidden from guardians until Office publishes it. */
  draft?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BookTitleSchema = new Schema<IBookTitle>(
  {
    titleBn: { type: String, required: true, trim: true },
    titleEn: { type: String, trim: true },
    author: { type: String, trim: true },
    language: { type: String, enum: BOOK_LANGUAGES, required: true },
    category: { type: String, trim: true },
    isbn: { type: String, trim: true },
    shelf: { type: String, trim: true },
    active: { type: Boolean, default: true },
    seriesId: { type: Schema.Types.ObjectId, ref: "StorySeries" },
    seriesNo: { type: Number, min: 1 },
    tagIds: { type: [Schema.Types.ObjectId], ref: "StoryTag", default: undefined },
    learnedPointsBn: { type: [String], default: undefined },
    parentTipBn: { type: String, trim: true },
    coverFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    previewFileIds: { type: [Schema.Types.ObjectId], ref: "StoredFile", default: undefined },
    draft: { type: Boolean, default: false },
  },
  { timestamps: true },
);

BookTitleSchema.index({ language: 1, category: 1 });
BookTitleSchema.index({ seriesId: 1, seriesNo: 1 }, { sparse: true });

export const BookTitle = model<IBookTitle>("BookTitle", BookTitleSchema);
