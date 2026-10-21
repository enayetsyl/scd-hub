/**
 * MasteryOutcome — one learning outcome (LO) of one class × subject (M-0, D-#776).
 *
 * The spine of the mastery tracker: every question, rubric grade and piece of evidence
 * names an LO by `code`. Two shapes share the row:
 *   chapter outcome — `chapterNumber` set, `strand` null: LO-C3-MATH-07-03
 *   skill strand    — `strand` set, `chapterNumber` null: LO-C3-MATH-SK-ANS-01. A strand
 *                     spans chapters (handwriting, answer statement…); each evidence row
 *                     still records the chapter of its question, so strand weakness can be
 *                     read by chapter without the code carrying one.
 *
 * Lifecycle: DRAFT rows come from an imported draft catalogue and may still change or
 * disappear. LOCK makes a code PERMANENT — from then on it may only be RETIRED, never
 * deleted or re-coded, because evidence written against it must keep resolving across
 * book revisions (the ScholarshipTopic / D-#548 posture).
 *
 * Curriculum plane: no identity, sits on neither side of the ADR-005 firewall.
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_ASSESS, MASTERY_CLASS_TOKENS, MASTERY_OUTCOME_STATUSES, MASTERY_SUBJECTS } from "@scd/shared";
import type { MasteryAssess, MasteryClassToken, MasteryOutcomeStatus, MasterySubject } from "@scd/shared";

export interface IMasteryOutcome extends Document {
  _id: Types.ObjectId;
  code: string;
  classToken: MasteryClassToken;
  subject: MasterySubject;
  chapterNumber: number | null;
  strand: string | null;
  /** What the app shows — short, plain words (English for the English subject). */
  labelBn: string;
  labelEn?: string;
  /** The book's own wording, verbatim — kept for traceability, never shown to guardians. */
  sourceText: string;
  nctbCode?: string;
  assess: MasteryAssess;
  /** QT- codes that can assess this LO (D-#777). */
  questionTypeCodes: string[];
  /** One sentence for the guardian when the LO is weak (D-#783). */
  homeTipBn?: string;
  order: number;
  status: MasteryOutcomeStatus;
  lockedAt?: Date;
  lockedBy?: Types.ObjectId;
  retiredAt?: Date;
  retiredBy?: Types.ObjectId;
  /** Which book file the row came from (e.g. "Class 3 Math/C3_MATH_Book_v2.1_Writer-Reviewer.docx"). */
  bookRef?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MasteryOutcomeSchema = new Schema<IMasteryOutcome>(
  {
    code: { type: String, required: true, trim: true },
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS, required: true },
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
    chapterNumber: { type: Number, default: null, min: 0 },
    strand: { type: String, default: null },
    labelBn: { type: String, required: true, trim: true },
    labelEn: { type: String, trim: true },
    sourceText: { type: String, default: "", trim: true },
    nctbCode: { type: String, trim: true },
    assess: { type: String, enum: MASTERY_ASSESS, required: true },
    questionTypeCodes: { type: [String], default: [] },
    homeTipBn: { type: String, trim: true },
    order: { type: Number, required: true, default: 0 },
    status: { type: String, enum: MASTERY_OUTCOME_STATUSES, required: true, default: "DRAFT" },
    lockedAt: { type: Date },
    lockedBy: { type: Schema.Types.ObjectId },
    retiredAt: { type: Date },
    retiredBy: { type: Schema.Types.ObjectId },
    bookRef: { type: String, trim: true },
  },
  { timestamps: true },
);

// The code IS the identity — globally unique (it embeds class and subject).
MasteryOutcomeSchema.index({ code: 1 }, { unique: true });
// The catalogue screen: one class × subject, in book order.
MasteryOutcomeSchema.index({ classToken: 1, subject: 1, status: 1, order: 1 });

export const MasteryOutcome = model<IMasteryOutcome>("MasteryOutcome", MasteryOutcomeSchema);
