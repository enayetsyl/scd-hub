/**
 * MasteryQuestionType — what one question type is worth in one class × subject
 * (M-0, D-#777).
 *
 * Seeded from the book's mark distribution, editable by the Principal, and the SAME in
 * homework, assignment, class test and re-test: a teacher never types an item's mark.
 * Every work-sheet item COPIES `marks` when it is created, so editing this row never
 * rewrites a past result; `history` keeps every value with who set it and when.
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_CLASS_TOKENS, MASTERY_SUBJECTS } from "@scd/shared";
import type { MasteryClassToken, MasterySubject } from "@scd/shared";

export interface IMarksHistory {
  marks: number;
  from: Date;
  by?: Types.ObjectId;
}

export interface IMasteryQuestionType extends Document {
  _id: Types.ObjectId;
  classToken: MasteryClassToken;
  subject: MasterySubject;
  code: string;
  labelBn: string;
  /** Marks for one item of this type; 0.5 steps. Null when the book gives none (classwork-only types). */
  marks: number | null;
  answerForm?: string;
  notes?: string;
  active: boolean;
  history: IMarksHistory[];
  createdAt: Date;
  updatedAt: Date;
}

const MarksHistorySchema = new Schema<IMarksHistory>(
  {
    marks: { type: Number, required: true, min: 0 },
    from: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId },
  },
  { _id: false },
);

const MasteryQuestionTypeSchema = new Schema<IMasteryQuestionType>(
  {
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS, required: true },
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
    code: { type: String, required: true, trim: true },
    labelBn: { type: String, required: true, trim: true },
    marks: { type: Number, default: null, min: 0 },
    answerForm: { type: String, trim: true },
    notes: { type: String, trim: true },
    active: { type: Boolean, required: true, default: true },
    history: { type: [MarksHistorySchema], default: [] },
  },
  { timestamps: true },
);

MasteryQuestionTypeSchema.index({ classToken: 1, subject: 1, code: 1 }, { unique: true });

export const MasteryQuestionType = model<IMasteryQuestionType>("MasteryQuestionType", MasteryQuestionTypeSchema);
