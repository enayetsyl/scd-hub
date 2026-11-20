import { Schema, model, Document, Types } from "mongoose";

/**
 * BookPdf — the REAL printed pages of a school book (PB-1, D-#1657; nov-ops F4).
 * The book PDF is rendered to JPEG pages by the class-books pipeline (StoredFile kind
 * `bookpdf_page`); the PDF itself is not kept. One row per book, keyed by the SAME identity the
 * plan Book tab uses: SchoolBook.code (the book plane's book), and `chapters[].key` are that book's
 * chapter keys (versionChapters). A re-upload replaces the pages and keeps the chapter mapping.
 *
 * Teachers read (lesson_plans:read_book / class_books:view); Office/Principal manage
 * (class_books:manage). Guardians never — they follow the class-books release switch (D-#1011).
 */
export const BOOK_PDF_STATUSES = ["PROCESSING", "READY", "FAILED"] as const;
export type BookPdfStatus = (typeof BOOK_PDF_STATUSES)[number];

export interface IBookPdfChapter {
  key: string;
  title: string;
  /** 1-based, inclusive. */
  fromPage: number;
  toPage: number;
}

export interface IBookPdf extends Document {
  _id: Types.ObjectId;
  bookCode: string;
  classLevel: number;
  subject: string;
  titleBn: string;
  versionLabel: string;
  sourceName: string;
  status: BookPdfStatus;
  error?: string;
  /** A re-upload is rendering; the old pages keep serving until the swap. */
  replacing: boolean;
  /** Identifies the render that may finish this row; a deleted or superseded row refuses a stale finish. */
  renderToken?: string;
  pageFileIds: Types.ObjectId[];
  pageCount: number;
  pageAspect: number;
  chapters: IBookPdfChapter[];
  active: boolean;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ChapterSchema = new Schema<IBookPdfChapter>(
  {
    key: { type: String, required: true, trim: true },
    title: { type: String, default: "", trim: true },
    fromPage: { type: Number, required: true, min: 1 },
    toPage: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const BookPdfSchema = new Schema<IBookPdf>(
  {
    bookCode: { type: String, required: true, unique: true, trim: true },
    classLevel: { type: Number, required: true },
    subject: { type: String, required: true },
    titleBn: { type: String, required: true, trim: true },
    versionLabel: { type: String, default: "" },
    sourceName: { type: String, default: "" },
    status: { type: String, enum: BOOK_PDF_STATUSES, required: true, default: "PROCESSING" },
    error: { type: String },
    replacing: { type: Boolean, default: false },
    renderToken: { type: String },
    pageFileIds: [{ type: Schema.Types.ObjectId, ref: "StoredFile" }],
    pageCount: { type: Number, default: 0 },
    pageAspect: { type: Number, default: 1.357 },
    chapters: { type: [ChapterSchema], default: [] },
    active: { type: Boolean, default: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// The /files gate reverse-resolves a page to its book.
BookPdfSchema.index({ pageFileIds: 1 });
BookPdfSchema.index({ classLevel: 1, subject: 1 });

export const BookPdf = model<IBookPdf>("BookPdf", BookPdfSchema);

/** The chapter's page range clamped to the book's pages; null when the chapter has no valid range. */
export function chapterPageRange(
  pdf: Pick<IBookPdf, "pageCount" | "chapters">,
  chapterKey: string,
): { fromPage: number; toPage: number } | null {
  const c = (pdf.chapters ?? []).find((x) => x.key === chapterKey);
  if (!c || !pdf.pageCount) return null;
  const fromPage = Math.max(1, c.fromPage);
  const toPage = Math.min(pdf.pageCount, c.toPage);
  return fromPage <= toPage ? { fromPage, toPage } : null;
}
