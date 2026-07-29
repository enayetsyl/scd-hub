/**
 * ExamReportComment — the "Comment from School" line on a report card (EX-5).
 *
 * One row per (exam × student). Kept out of `ExamMark` because it is a whole-card
 * judgement, not a per-subject one, and out of `Student` because it is per exam.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IExamReportComment extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  studentId: Types.ObjectId;
  comment: string;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ExamReportCommentSchema = new Schema<IExamReportComment>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    comment: { type: String, required: true, trim: true },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

ExamReportCommentSchema.index({ examId: 1, studentId: 1 }, { unique: true });

export const ExamReportComment = model<IExamReportComment>("ExamReportComment", ExamReportCommentSchema);

/** The phrasings already in use on the 2026 cards — offered as suggestions, never forced. */
export const COMMENT_SUGGESTIONS: readonly string[] = [
  "Excellent! Keep it up.",
  "Excellent! Effort should be continued.",
  "Outstanding! Keep up the excellent work.",
  "Very good. Keep up the effort.",
  "Good work. Continue the effort.",
  "Good. Keep up the effort.",
];
