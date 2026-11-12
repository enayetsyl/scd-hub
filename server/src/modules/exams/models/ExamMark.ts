/**
 * ExamMark — one student's mark for ONE component of one paper (EX-3/EX-4, D-#377/#378).
 *
 * The row is per (paper × student × COMPONENT), not per student, because absence is
 * per-component (D-#377f): the source cards show `Ab` in a lone Semester-Final cell while
 * the same row still carries CT and Adab marks (Azraf Bin Iman, Arabic: Perf 6 · Final Ab ·
 * Obtained 6 · F). A per-student row could not express that.
 *
 * `rawMark` is stored on its ENTRY scale, which differs by component:
 *   FINAL     → out of the paper's own `paperFullMarks` (the scans show 80, 100, 200)
 *   CT / ADAB → already on the component's /10 scale
 * The converted value is DERIVED on read via `convertMark` and NEVER stored (D-#85). The
 * hand arithmetic in the source margins is precisely what this separation deletes.
 *
 * NO ROW means "not entered". That is deliberate and load-bearing: a student with no
 * class-test results pulls BLANK, never 0 (D-#378) — the same lesson D-#376 learned at
 * paper level, applied to individuals. Writing a 0 would silently drop a grade band.
 */
import { Schema, model, Document, Types } from "mongoose";
import { EXAM_COMPONENTS, MARK_ENTRY_STATUSES } from "@scd/shared";
import type { ExamComponent, MarkEntryStatus } from "@scd/shared";

/** Where the value came from — so a pulled CT can be told apart from a typed one. */
export const MARK_SOURCES = ["MANUAL", "CT_PULL"] as const;
export type MarkSource = (typeof MARK_SOURCES)[number];

export interface IExamMark extends Document {
  _id: Types.ObjectId;
  examId: Types.ObjectId;
  paperId: Types.ObjectId;
  studentId: Types.ObjectId;
  component: ExamComponent;
  status: MarkEntryStatus;
  /** Only when PRESENT. Undefined when ABSENT — an absent component contributes 0 and
   *  prints "Ab", but the student stays in the cohort denominators. */
  rawMark?: number;
  source: MarkSource;
  /** Set when a human overrides a pulled CT value (D-#378). */
  overrideReason?: string;
  enteredBy: Types.ObjectId;
  enteredAt: Date;

  // --- EX-4: the rechecker's INDEPENDENT pass -------------------------------
  /** The rechecker's own figure, entered without sight of `rawMark` (EX-4). */
  recheckRawMark?: number;
  recheckStatus?: MarkEntryStatus;
  recheckBy?: Types.ObjectId;
  recheckAt?: Date;
  /** Set only when checker and rechecker DIVERGED and a human resolved it. The agreed
   *  figure wins over both; who resolved it is stamped, never inferred. */
  resolvedRawMark?: number;
  resolvedStatus?: MarkEntryStatus;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const ExamMarkSchema = new Schema<IExamMark>(
  {
    examId: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    paperId: { type: Schema.Types.ObjectId, ref: "ExamPaper", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    component: { type: String, enum: EXAM_COMPONENTS, required: true },
    status: { type: String, enum: MARK_ENTRY_STATUSES, required: true },
    rawMark: { type: Number, min: 0 },
    source: { type: String, enum: MARK_SOURCES, required: true, default: "MANUAL" },
    overrideReason: { type: String, trim: true },
    enteredBy: { type: Schema.Types.ObjectId, required: true },
    enteredAt: { type: Date, required: true, default: () => new Date() },

    recheckRawMark: { type: Number, min: 0 },
    recheckStatus: { type: String, enum: MARK_ENTRY_STATUSES },
    recheckBy: { type: Schema.Types.ObjectId },
    recheckAt: { type: Date },
    resolvedRawMark: { type: Number, min: 0 },
    resolvedStatus: { type: String, enum: MARK_ENTRY_STATUSES },
    resolvedBy: { type: Schema.Types.ObjectId },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

// One mark per student per component per paper — the upsert key.
ExamMarkSchema.index({ paperId: 1, studentId: 1, component: 1 }, { unique: true });
ExamMarkSchema.index({ examId: 1, studentId: 1 });

export const ExamMark = model<IExamMark>("ExamMark", ExamMarkSchema);
