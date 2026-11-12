/**
 * IntegrityCase - the homework-honesty flag (GH-3, docs/prd-guardian-help.md section 4, D-#1522).
 *
 * One case per child x objective when the cumulative homework + assignment percentage on the objective
 * is 20 points or more above the class-test percentage. Office only: no guardian ever sees or is told
 * about a case. Per-child operational data (identity plane): the corpus plane has no path to it (ADR-005).
 *
 * One OPEN case per (studentId, loCode) (partial unique index). A recompute updates the OPEN case's
 * numbers and appends to `history`; a CLOSED case stays as the record and a new OPEN one is written only
 * when the gap is still 20+ after NEW evidence arrived since it was closed.
 */
import { Schema, model, Document, Types } from "mongoose";

export const INTEGRITY_OUTCOMES = ["GUARDIAN_DID", "CHILD_DID", "UNCLEAR"] as const;
export type IntegrityOutcome = (typeof INTEGRITY_OUTCOMES)[number];
export const INTEGRITY_STATUSES = ["OPEN", "CLOSED"] as const;
export type IntegrityStatus = (typeof INTEGRITY_STATUSES)[number];

export interface IntegrityItem {
  paperId: Types.ObjectId;
  qid?: string;
  itemNo: number | null;
  earned: number;
  available: number;
  date: Date;
}

export interface IIntegrityCase extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classToken: string;
  subject: string;
  loCode: string;
  hwPct: number;
  ctPct: number;
  gap: number;
  hwItems: IntegrityItem[];
  ctItems: IntegrityItem[];
  status: IntegrityStatus;
  outcome?: IntegrityOutcome;
  note?: string;
  openedAt: Date;
  updatedAt: Date;
  closedBy?: Types.ObjectId;
  closedAt?: Date;
  history: { at: Date; hwPct: number; ctPct: number }[];
}

const ItemSchema = new Schema<IntegrityItem>(
  {
    paperId: { type: Schema.Types.ObjectId, required: true },
    qid: { type: String },
    itemNo: { type: Number, default: null },
    earned: { type: Number, required: true },
    available: { type: Number, required: true },
    date: { type: Date, required: true },
  },
  { _id: false },
);

const IntegrityCaseSchema = new Schema<IIntegrityCase>({
  studentId: { type: Schema.Types.ObjectId, required: true },
  sectionId: { type: Schema.Types.ObjectId, required: true },
  academicYearId: { type: Schema.Types.ObjectId, required: true },
  classToken: { type: String, required: true },
  subject: { type: String, required: true },
  loCode: { type: String, required: true },
  hwPct: { type: Number, required: true },
  ctPct: { type: Number, required: true },
  gap: { type: Number, required: true },
  hwItems: { type: [ItemSchema], default: [] },
  ctItems: { type: [ItemSchema], default: [] },
  status: { type: String, enum: INTEGRITY_STATUSES, required: true, default: "OPEN" },
  outcome: { type: String, enum: INTEGRITY_OUTCOMES },
  note: { type: String, trim: true, maxlength: 1000 },
  openedAt: { type: Date, required: true, default: () => new Date() },
  updatedAt: { type: Date, required: true, default: () => new Date() },
  closedBy: { type: Schema.Types.ObjectId },
  closedAt: { type: Date },
  history: {
    type: [new Schema({ at: Date, hwPct: Number, ctPct: Number }, { _id: false })],
    default: [],
  },
});

// At most one OPEN case per child x objective.
IntegrityCaseSchema.index({ studentId: 1, loCode: 1 }, { unique: true, partialFilterExpression: { status: "OPEN" } });
// The Office queue.
IntegrityCaseSchema.index({ status: 1, sectionId: 1, subject: 1, gap: -1 });
// Recurring count per child.
IntegrityCaseSchema.index({ studentId: 1, academicYearId: 1, openedAt: 1 });

export const IntegrityCase = model<IIntegrityCase>("IntegrityCase", IntegrityCaseSchema);
