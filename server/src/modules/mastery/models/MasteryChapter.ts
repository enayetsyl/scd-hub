/**
 * MasteryChapter — the chapter / unit list of one class × subject (M-0, D-#776).
 *
 * `number` is the book's top-level unit (অধ্যায়, পাঠ or Unit) and is what the CC part of
 * an LO code means. `termNote` copies what the book says about half-yearly / annual —
 * INFORMATIONAL only: the mastery tracker does not follow exam terms (owner, 2026-10-19:
 * "it will be dynamic based on syllabus coverage").
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_CLASS_TOKENS, MASTERY_SUBJECTS } from "@scd/shared";
import type { MasteryClassToken, MasterySubject } from "@scd/shared";

export interface IMasteryChapter extends Document {
  _id: Types.ObjectId;
  classToken: MasteryClassToken;
  subject: MasterySubject;
  number: number;
  titleBn: string;
  termNote?: string;
  order: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MasteryChapterSchema = new Schema<IMasteryChapter>(
  {
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS, required: true },
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
    number: { type: Number, required: true, min: 0 },
    titleBn: { type: String, required: true, trim: true },
    termNote: { type: String, trim: true },
    order: { type: Number, required: true, default: 0 },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

MasteryChapterSchema.index({ classToken: 1, subject: 1, number: 1 }, { unique: true });

export const MasteryChapter = model<IMasteryChapter>("MasteryChapter", MasteryChapterSchema);
