/**
 * Exam — one term's exam for one academic year (EX-1, docs/prd-exams.md §6, D-#375).
 *
 * TERMS STAND ALONE (D-#380): the annual carries NOTHING forward from the half-yearly —
 * no weighting, no carry-forward component, no cumulative across-term GPA. Two Exam rows
 * in one AcademicYear are simply independent. That is a deliberate non-feature; a combined
 * transcript needs its own decision.
 *
 * The GRADE SCALE is stored HERE, not hardcoded (D-#377), so a future year can re-band
 * without a code change. It is seeded from DEFAULT_GRADE_SCALE (the scale printed on every
 * 2026 card) and editable per exam thereafter.
 *
 * `failRule: ANY_SUBJECT_F` is the rule the source cards prove: one subject at F forces the
 * whole card to 0.00 / F regardless of total — Rehana Bint Mustafa prints 0.00 F at 552/800
 * on a Maths F, which no total-based rule reproduces. Stored as a named rule rather than an
 * `if` in the service so the card can say WHY it failed.
 *
 * Build ruling D-#145: NO `schoolId` (single-school live repo — the CT-1 / MT-1 precedent).
 * Operational/identity plane behind the ADR-005 firewall — no corpus path.
 */
import { Schema, model, Document, Types } from "mongoose";
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
  /** Display name as printed on the card, e.g. "Half Yearly-Sylhet". */
  name: string;
  status: ExamStatus;
  startDateKey?: string;
  endDateKey?: string;
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
  /** Set by a backfill import; blocks the normal marking UI. Unused by EX-1..EX-9. */
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
    status: { type: String, enum: EXAM_STATUSES, required: true, default: "PLANNED" },
    startDateKey: { type: String, trim: true },
    endDateKey: { type: String, trim: true },
    gradeScale: { type: [GradeBandSchema], required: true },
    failRule: { type: String, enum: ["ANY_SUBJECT_F"], required: true, default: "ANY_SUBJECT_F" },
    ctAggregation: { type: CtAggregationSchema, required: true, default: () => ({ mode: "MEAN", bestN: CT_AGGREGATION_DEFAULT_BEST_N }) },
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
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// One exam per (year × term × name) — re-running a create is a conflict, not a duplicate.
ExamSchema.index({ academicYearId: 1, term: 1, name: 1 }, { unique: true });
ExamSchema.index({ academicYearId: 1, status: 1 });

export const Exam = model<IExam>("Exam", ExamSchema);
