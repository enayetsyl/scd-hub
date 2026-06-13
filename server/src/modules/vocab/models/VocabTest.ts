import { Schema, model, Document, Types } from "mongoose";
import {
  VOCAB_PROGRAMS,
  VOCAB_TEST_STATUSES,
  ROSTER_CLASS_LEVELS,
  type VocabProgram,
  type VocabTestStatus,
  type RosterClassLevel,
} from "@scd/shared";

/**
 * VocabTest (VC-2; prd-vocabulary-tracker §3.3, D-#106/#127) — one program's test
 * for a section on a date. Three programs ⇒ up to three tests for one section on one
 * day (shared or separate periods); the test is **period-agnostic, keyed by date**.
 *
 * `totalMarks` is teacher-set (replaces the legacy fixed 30/60 setup cell).
 * `dictationHalfMissCounts` is configurable PER TEST (D-#105): off ⇒ a dictation
 * position is wrong if any field is wrong (max 1 lost); on ⇒ 1 lost per wrong field
 * (VC-3 scoring). `sectionId` is a general Section; SubjectGroup polymorphism is
 * reserved for a future Arabic-group program (D-#48), not built here.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path). No
 * schoolId (single-school live-repo convention).
 */
export interface IVocabTest extends Document {
  _id: Types.ObjectId;
  program: VocabProgram;
  sectionId: Types.ObjectId;
  classLevel: RosterClassLevel;
  /** The test date (default Thursday of its week, holiday-rolled — D-#50). Local midnight. */
  testDate: Date;
  /** Normalised week start (the Sunday of testDate's week) — the assignment key. */
  weekOf: Date;
  label: string;
  totalMarks: number;
  dictationHalfMissCounts: boolean;
  status: VocabTestStatus;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VocabTestSchema = new Schema<IVocabTest>(
  {
    program: { type: String, enum: VOCAB_PROGRAMS, required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    classLevel: { type: Number, enum: ROSTER_CLASS_LEVELS, required: true },
    testDate: { type: Date, required: true },
    weekOf: { type: Date, required: true },
    label: { type: String, required: true, trim: true },
    totalMarks: { type: Number, required: true, min: 0 },
    dictationHalfMissCounts: { type: Boolean, required: true, default: false },
    status: { type: String, enum: VOCAB_TEST_STATUSES, required: true, default: "draft" },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// Browse a section's tests by program + date; resolve the week's assignment.
VocabTestSchema.index({ sectionId: 1, program: 1, testDate: -1 });
VocabTestSchema.index({ sectionId: 1, weekOf: 1, program: 1 });

export const VocabTest = model<IVocabTest>("VocabTest", VocabTestSchema);
