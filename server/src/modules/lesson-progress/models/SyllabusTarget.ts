import { Schema, model, Document, Types } from "mongoose";
import { EXAM_TERMS, type ExamTerm } from "@scd/shared";

/**
 * SyllabusTarget (AL-11, D-#1675, docs/prd-academic-loop-2027.md §3.3) — the Office's term target for one
 * class × subject: where in the book the term must end (`endChapter` + `endSessionIndex`, a session plan's
 * stable key) and the date it must be there. Two terms per class × subject: HALF_YEARLY and ANNUAL.
 *
 * Unique per (year, class, subject, term). Saved only with `lesson_progress:set_targets`. A class without
 * targets reads "লক্ষ্য দেওয়া নেই" and nothing else changes for it — so this runs regardless of the 2027
 * release switch (§3.6). Identity/operational plane; no corpus path (ADR-005).
 */
export interface ISyllabusTarget extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  /** `classToken(level)`, e.g. "C3". */
  classToken: string;
  subject: string;
  term: ExamTerm;
  /** `YYYY-MM-DD` — the day the end session must be finished. */
  targetDate: string;
  endChapter: string;
  endSessionIndex: number;
  setBy: Types.ObjectId;
  setAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SyllabusTargetSchema = new Schema<ISyllabusTarget>(
  {
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    classToken: { type: String, required: true },
    subject: { type: String, required: true },
    term: { type: String, enum: EXAM_TERMS, required: true },
    targetDate: { type: String, required: true },
    endChapter: { type: String, required: true },
    endSessionIndex: { type: Number, required: true },
    setBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    setAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

SyllabusTargetSchema.index({ academicYearId: 1, classToken: 1, subject: 1, term: 1 }, { unique: true });

export const SyllabusTarget = model<ISyllabusTarget>("SyllabusTarget", SyllabusTargetSchema);
