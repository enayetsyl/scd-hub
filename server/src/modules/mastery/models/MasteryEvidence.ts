/**
 * MasteryEvidence — the append-only log every diagnosis is computed from (M-2, D-#778/#787).
 *
 * One row per (paper, student, item, LO) at confirmation; a work-level row for a WORK
 * routing tag; one row per rubric LO. A correction never edits a row: the old rows get
 * `supersededAt` and new rows are written, so the record of what was believed when stays.
 *
 * `signal` carries what the TEACHER said beyond the mark: WEAK (re-work / a WEAK tag),
 * LIGHT (a LIGHT tag, or whole-work re-work), GOOD / WEAK on routed strand rows, NONE
 * otherwise — the engine (M-3) reads earned/available plus this.
 */
import { Schema, model, Document, Types } from "mongoose";
import { MASTERY_CLASS_TOKENS, MASTERY_SUBJECTS } from "@scd/shared";
import type { MasteryClassToken, MasterySubject } from "@scd/shared";

export const MASTERY_EVIDENCE_SIGNALS = ["NONE", "WEAK", "LIGHT", "GOOD"] as const;
export type MasteryEvidenceSignal = (typeof MASTERY_EVIDENCE_SIGNALS)[number];

export interface IMasteryEvidence extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  academicYearId: Types.ObjectId;
  classToken: MasteryClassToken;
  subject: MasterySubject;
  loCode: string;
  chapterNumber: number | null;
  source: string;
  paperId: Types.ObjectId;
  itemNo: number | null;
  qid?: string;
  earned: number;
  available: number;
  rubricStep?: number;
  rework: boolean;
  workRework: boolean;
  tags: string[];
  signal: MasteryEvidenceSignal;
  /** True on a row written to a skill strand by a routing tag (D-#787). */
  routed: boolean;
  /** The paper's date and its ISO week key ("2027-W14") — mastery needs separate weeks. */
  at: Date;
  week: string;
  supersededAt?: Date;
  excludedAt?: Date;
  excludedBy?: Types.ObjectId;
  excludeReason?: string;
  createdAt: Date;
}

const MasteryEvidenceSchema = new Schema<IMasteryEvidence>(
  {
    studentId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    classToken: { type: String, enum: MASTERY_CLASS_TOKENS, required: true },
    subject: { type: String, enum: MASTERY_SUBJECTS, required: true },
    loCode: { type: String, required: true },
    chapterNumber: { type: Number, default: null },
    source: { type: String, required: true },
    paperId: { type: Schema.Types.ObjectId, required: true },
    itemNo: { type: Number, default: null },
    qid: { type: String },
    earned: { type: Number, required: true, min: 0 },
    available: { type: Number, required: true, min: 0 },
    rubricStep: { type: Number, min: 1, max: 4 },
    rework: { type: Boolean, default: false },
    workRework: { type: Boolean, default: false },
    tags: { type: [String], default: [] },
    signal: { type: String, enum: ["NONE", "WEAK", "LIGHT", "GOOD"], required: true, default: "NONE" },
    routed: { type: Boolean, default: false },
    at: { type: Date, required: true },
    week: { type: String, required: true },
    supersededAt: { type: Date },
    excludedAt: { type: Date },
    excludedBy: { type: Schema.Types.ObjectId },
    excludeReason: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The engine's read: one student's live rows for one LO, oldest first.
MasteryEvidenceSchema.index({ studentId: 1, loCode: 1, supersededAt: 1, at: 1 });
// A paper's rows (corrections, the quality report).
MasteryEvidenceSchema.index({ paperId: 1, studentId: 1, supersededAt: 1 });
// The section heat-map.
MasteryEvidenceSchema.index({ sectionId: 1, subject: 1, supersededAt: 1 });

export const MasteryEvidence = model<IMasteryEvidence>("MasteryEvidence", MasteryEvidenceSchema);
