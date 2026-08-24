/**
 * Exam — one term exam in one academic year (SY-1, docs/prd-exam-syllabus.md §6).
 *
 * DELIBERATELY MINIMAL. `docs/prd-exams.md` EX-1 specifies a much larger row —
 * `status`, `gradeScale`, `failRule`, `ctAggregation` — and those fields belong to
 * that slice, not this one. The syllabus ships first and needs only an identity to
 * hang itself on, so this file creates that identity and nothing else. EX-1 EXTENDS
 * this model; it must never declare a second, competing exam record.
 *
 * Identity/operational plane. No envelope, no ContentArtifact, no corpus path
 * (ADR-005) — a syllabus names a class and a subject, never a student.
 */
import { Schema, model, Document, Types } from "mongoose";
import { EXAM_TERMS } from "@scd/shared";
import type { ExamTerm } from "@scd/shared";

export interface IExam extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  term: ExamTerm;
  /** The school's own name for it — "বার্ষিক পরীক্ষা ২০২৬", "Half Yearly-Sylhet". */
  name: string;
  /** Optional window, `YYYY-MM-DD`. The per-subject date lives on the syllabus row. */
  startDateKey?: string | null;
  endDateKey?: string | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ExamSchema = new Schema<IExam>(
  {
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    term: { type: String, enum: EXAM_TERMS, required: true },
    name: { type: String, required: true, trim: true },
    startDateKey: { type: String, default: null },
    endDateKey: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

/**
 * One exam per (year, term). Two "Annual 2026" rows would silently split the
 * syllabus across them — half the subjects on one, half on the other — and every
 * coverage count would read as complete on both.
 */
ExamSchema.index({ academicYearId: 1, term: 1 }, { unique: true });

export const Exam = model<IExam>("Exam", ExamSchema);
