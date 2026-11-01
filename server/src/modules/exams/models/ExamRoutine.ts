/**
 * ExamRoutine — the date-by-date routine of one exam, every class in one row (D-#883).
 *
 * One row per exam; `slots` holds each class's papers. A slot is a class sitting one
 * subject on one date, WRITTEN or ORAL: Nursery and KG sit the same subject twice (an
 * oral in class time, then a written paper), so (class, subject) alone is not a key.
 *
 * The routine is the source of the syllabus button's date: saving a class writes each
 * subject's date onto that class's `ExamSyllabus.examDateKey` (the written paper's, or
 * the oral's when there is no written one), so the two never disagree.
 *
 * Guardians and teachers see it only once `publishedAt` is set. The Quran oral exam keeps
 * its own schedule (QuranExamPlan); the routine screens show both, side by side.
 *
 * Identity/operational plane; no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export const EXAM_ROUTINE_KINDS = ["WRITTEN", "ORAL"] as const;
export type ExamRoutineKind = (typeof EXAM_ROUTINE_KINDS)[number];

export interface IExamRoutineSlot {
  classId: Types.ObjectId;
  /** `YYYY-MM-DD`. */
  dateKey: string;
  /** A ROUTINE_SUBJECTS code. */
  subject: string;
  kind: ExamRoutineKind;
  /** "HH:mm"; empty on an oral held in class time. */
  start: string;
  end: string;
  /** e.g. "আরবি দল অনুযায়ী". */
  note: string;
}

export interface IExamRoutine extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  slots: IExamRoutineSlot[];
  /** One line under the routine ("ইংরেজি ও গণিতের আগে এক দিন বিরতি …"). */
  noteBn: string;
  publishedAt?: Date | null;
  publishedBy?: Types.ObjectId | null;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SlotSchema = new Schema<IExamRoutineSlot>(
  {
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    dateKey: { type: String, required: true },
    subject: { type: String, required: true },
    kind: { type: String, enum: EXAM_ROUTINE_KINDS, required: true },
    start: { type: String, default: "" },
    end: { type: String, default: "" },
    note: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const ExamRoutineSchema = new Schema<IExamRoutine>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    slots: { type: [SlotSchema], default: [] },
    noteBn: { type: String, default: "", trim: true },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ExamRoutineSchema.index({ examId: 1 }, { unique: true });

export const ExamRoutine = model<IExamRoutine>("ExamRoutine", ExamRoutineSchema);
