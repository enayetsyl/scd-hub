/**
 * SchoolBook — one school book in the lifecycle (docs/prd-book-lifecycle.md §5.1, D-#1592).
 *
 * Book plane (D-#404): registered on `bookConnection`; user ids are bare ObjectIds resolved
 * on the main connection in the resolver — no `ref`, no populate. Counters (F-n, D-n, E-n,
 * I-n, memo numbers, chapter keys) are taken with an atomic `$inc` here (`takeCounter`).
 */
import { Schema, Types, type Document } from "mongoose";
import { BOOK_EDITIONS, BOOK_CODE_RE, type BookEdition } from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface ISchoolBook extends Document {
  _id: Types.ObjectId;
  code: string;
  classLevel: number;
  subject: string;
  titleBn: string;
  titleEn?: string;
  editions: BookEdition[];
  chapterHeadingLevel: number;
  reviewerName?: string;
  ruleSetKeys: string[];
  latestVersionId?: Types.ObjectId;
  finalVersionId?: Types.ObjectId;
  currentReleaseId?: Types.ObjectId;
  nextMemoNo: number;
  nextFeedbackNo: number;
  nextDecisionNo: number;
  nextErratumNo: number;
  nextInstructionNo: number;
  nextReleaseNo: number;
  /** Highest chapter key number ever issued (keys are permanent, §6.2). */
  maxChapterNo: number;
  publishStudentToClassBooks: boolean;
  legacySupportBookId?: string;
  historyFiles: { storedFileId: Types.ObjectId; label: string }[];
  archived: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SchoolBookSchema = new Schema<ISchoolBook>(
  {
    code: { type: String, required: true, unique: true, match: BOOK_CODE_RE },
    classLevel: { type: Number, required: true },
    subject: { type: String, required: true },
    titleBn: { type: String, required: true, maxlength: 200 },
    titleEn: { type: String, maxlength: 200 },
    editions: { type: [String], enum: BOOK_EDITIONS, default: ["TEACHER", "STUDENT"] },
    chapterHeadingLevel: { type: Number, min: 1, max: 3, default: 2 },
    reviewerName: { type: String, maxlength: 120 },
    ruleSetKeys: { type: [String], default: [] },
    latestVersionId: { type: Schema.Types.ObjectId },
    finalVersionId: { type: Schema.Types.ObjectId },
    currentReleaseId: { type: Schema.Types.ObjectId },
    nextMemoNo: { type: Number, default: 1 },
    nextFeedbackNo: { type: Number, default: 1 },
    nextDecisionNo: { type: Number, default: 1 },
    nextErratumNo: { type: Number, default: 1 },
    nextInstructionNo: { type: Number, default: 1 },
    nextReleaseNo: { type: Number, default: 1 },
    maxChapterNo: { type: Number, default: 0 },
    publishStudentToClassBooks: { type: Boolean, default: false },
    legacySupportBookId: { type: String },
    historyFiles: { type: [{ storedFileId: { type: Schema.Types.ObjectId, required: true }, label: { type: String, maxlength: 200 } }], default: [] },
    archived: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
SchoolBookSchema.index({ classLevel: 1, subject: 1 });

export const SchoolBook = bookConnection.model<ISchoolBook>("SchoolBook", SchoolBookSchema);

export type BookCounter = "nextMemoNo" | "nextFeedbackNo" | "nextDecisionNo" | "nextErratumNo" | "nextInstructionNo" | "nextReleaseNo";

/** Atomically take the next number of a per-book counter; returns the number taken. */
export async function takeCounter(bookId: Types.ObjectId, counter: BookCounter, n = 1): Promise<number> {
  const row = await SchoolBook.findOneAndUpdate({ _id: bookId }, { $inc: { [counter]: n } }, { new: false, projection: { [counter]: 1 } }).lean();
  if (!row) throw new Error("বই পাওয়া যায়নি");
  return (row as unknown as Record<string, number>)[counter];
}
