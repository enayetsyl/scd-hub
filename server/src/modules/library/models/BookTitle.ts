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
  },
  { timestamps: true },
);

BookTitleSchema.index({ language: 1, category: 1 });

export const BookTitle = model<IBookTitle>("BookTitle", BookTitleSchema);
