/**
 * ExamClassNote — the source sheet's per-CLASS footer, one row per
 * (exam × class). SY-2, docs/prd-exam-syllabus.md §5.5.
 *
 * The 2026 sheet ends each class's table with a single line naming the question
 * types that class will face:
 *
 *   "পরীক্ষায় ক্লাস অনুযায়ী বহুনির্বাচনী প্রশ্ন-উত্তর, শূন্যস্থান পূরণ, সত্য-মিথ্যা
 *    নির্ণয়, মিলকরন, ছোট প্রশ্ন, বড় প্রশ্ন ইত্যাদি থাকবে, ইন শা আল্লাহ।"
 *
 * It is a CLASS fact, not a subject fact — Class 3's version adds সৃজনশীল, and it
 * applies to all eight of that class's subjects at once. Storing it on each
 * subject row would be the same sentence copied eight times, and the read screen
 * renders it ONCE at the top rather than repeating it on every subject.
 */
import { Schema, model, Document, Types } from "mongoose";
import { SYLLABUS_ITEM_TYPES } from "@scd/shared";
import type { SyllabusItemType } from "@scd/shared";

export interface IExamClassNote extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  classId: Types.ObjectId;
  /** The class's question-type set, as codes. Rendered as chips. */
  questionTypes: SyllabusItemType[];
  /** The footer sentence itself, verbatim. */
  noteMd: string;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ExamClassNoteSchema = new Schema<IExamClassNote>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    questionTypes: { type: [String], enum: SYLLABUS_ITEM_TYPES, default: [] },
    noteMd: { type: String, default: "" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ExamClassNoteSchema.index({ examId: 1, classId: 1 }, { unique: true });

export const ExamClassNote = model<IExamClassNote>("ExamClassNote", ExamClassNoteSchema);
