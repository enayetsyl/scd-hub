/**
 * Exam — one term exam in one academic year. THE single exam record.
 *
 * Two slices hang off this one row:
 *   - SY-1 (docs/prd-exam-syllabus.md §6) created it with the identity only — year, term,
 *     name, date window. The syllabus, the exam routine, the oral exam (viva), the Quran
 *     exam and the exam-paper bank all read those fields and nothing else.
 *   - EX-1..EX-9 (docs/prd-exams.md, D-#375–#382) EXTEND it with the marking cycle:
 *     status, the per-exam grade scale, the fail rule, CT aggregation and the EX-9
 *     submit → approve → publish stamps. It never declares a second, competing exam.
 *
 * Every EX field has a SAFE DEFAULT, so a row written by SY-1 (no status, no grade scale)
 * stays valid with no data migration: a hydrated document gets the defaults from the
 * schema, and a `.lean()` reader goes through `examGradeScale` / `examCtAggregation` /
 * `examStatus` (../examDefaults.ts), which apply the same defaults on read.
 *
 * TERMS STAND ALONE (D-#380): the annual carries NOTHING forward from the half-yearly.
 *
 * The GRADE SCALE is stored HERE, not hardcoded (D-#377), seeded from DEFAULT_GRADE_SCALE
 * (the scale printed on every 2026 card). `failRule: ANY_SUBJECT_F` is the rule the source
 * cards prove: one subject at F forces the whole card to 0.00 / F regardless of total.
 *
 * Identity/operational plane. No envelope, no ContentArtifact, no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";
import { defaultGradeScale, defaultCtAggregation } from "../examDefaults";
import {
  EXAM_TERMS,
  EXAM_STATUSES,
  GRADE_LETTERS,
  CT_AGGREGATION_MODES,
  CT_AGGREGATION_DEFAULT_BEST_N,
} from "@scd/shared";
import type { ExamTerm, ExamStatus, GradeLetter, CtAggregationMode } from "@scd/shared";

/** One band of the grade scale. `maxPercent` is INCLUSIVE. */
export interface IGradeBand {
  letter: GradeLetter;
  point: number;
  minPercent: number;
  maxPercent: number;
}

/** How the CT component is pulled from the class-test tracker (D-#378). BOTH modes ship;
 *  `bestN` is only read when mode === "BEST_N". Overridable per paper. */
export interface ICtAggregation {
  mode: CtAggregationMode;
  bestN?: number;
}

export interface IExam extends Document {
  _id: Types.ObjectId;
  academicYearId: Types.ObjectId;
  term: ExamTerm;
  /** The school's own name for it — "বার্ষিক পরীক্ষা ২০২৬", "Half Yearly-Sylhet". */
  name: string;
  /** Optional window, `YYYY-MM-DD`. The per-subject date lives on the syllabus row. */
  startDateKey?: string | null;
  endDateKey?: string | null;
  // ---- EX-1..EX-9 (every one defaulted: an SY-1 row stays valid) ----
  status: ExamStatus;
  gradeScale: IGradeBand[];
  /** Only rule implemented; named so the card can explain the 0.00/F. */
  failRule: "ANY_SUBJECT_F";
  ctAggregation: ICtAggregation;
  /** EX-9 publish gate (the CT-8 / CO-8 shape): guardian-visible iff publishedAt != null. */
  submittedAt?: Date;
  submittedBy?: Types.ObjectId;
  approvedAt?: Date;
  approvedBy?: Types.ObjectId;
  sendBackReason?: string;
  sendBackAt?: Date;
  sendBackBy?: Types.ObjectId;
  publishedAt?: Date;
  /** Bumped on each (re)publish so a corrected card re-notifies the guardian. */
  publishedVersion: number;
  /** Set by a backfill import (EX-10, NOT built); unused by EX-1..EX-9. */
  source?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const GradeBandSchema = new Schema<IGradeBand>(
  {
    letter: { type: String, enum: GRADE_LETTERS, required: true },
    point: { type: Number, required: true, min: 0 },
    minPercent: { type: Number, required: true, min: 0, max: 100 },
    maxPercent: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false },
);

const CtAggregationSchema = new Schema<ICtAggregation>(
  {
    mode: { type: String, enum: CT_AGGREGATION_MODES, required: true, default: "MEAN" },
    bestN: { type: Number, min: 1, default: CT_AGGREGATION_DEFAULT_BEST_N },
  },
  { _id: false },
);

const ExamSchema = new Schema<IExam>(
  {
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    term: { type: String, enum: EXAM_TERMS, required: true },
    name: { type: String, required: true, trim: true },
    startDateKey: { type: String, default: null },
    endDateKey: { type: String, default: null },
    status: { type: String, enum: EXAM_STATUSES, required: true, default: "PLANNED" },
    gradeScale: { type: [GradeBandSchema], default: defaultGradeScale },
    failRule: { type: String, enum: ["ANY_SUBJECT_F"], required: true, default: "ANY_SUBJECT_F" },
    ctAggregation: { type: CtAggregationSchema, default: defaultCtAggregation },
    submittedAt: { type: Date },
    submittedBy: { type: Schema.Types.ObjectId },
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId },
    sendBackReason: { type: String, trim: true },
    sendBackAt: { type: Date },
    sendBackBy: { type: Schema.Types.ObjectId },
    publishedAt: { type: Date },
    publishedVersion: { type: Number, required: true, default: 0, min: 0 },
    source: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

/**
 * One exam per (year, term) — the SY-1 rule, kept. Two "Annual 2026" rows would silently
 * split the syllabus across them — half the subjects on one, half on the other — and every
 * coverage count would read as complete on both. (The July EX-1 draft keyed this on
 * year × term × name; the stricter live index wins.)
 */
ExamSchema.index({ academicYearId: 1, term: 1 }, { unique: true });
ExamSchema.index({ academicYearId: 1, status: 1 });

export const Exam = model<IExam>("Exam", ExamSchema);

// Read-side defaults live in ../examDefaults.ts (pure — no mongoose) and are re-exported
// here for convenience; a test that mocks this model still gets the real helpers there.
export { defaultGradeScale, examGradeScale, examCtAggregation, examStatus } from "../examDefaults";
