import { Schema, model, Document, Types } from "mongoose";
import { EXAM_TERMS, ROSTER_CLASS_LEVEL_MAX, ROSTER_CLASS_LEVEL_MIN } from "@scd/shared";
import type { ExamTerm } from "@scd/shared";

/**
 * ExamPaperDraft — one draft question paper (exam × class × subject) that a reviewer
 * checks item by item before it is printed (D-#1031–#1033, docs/prd-exam-paper-bank.md §5).
 *
 * The paper is imported whole from a `scd.exam-paper-draft/v1` file (generated against the
 * published syllabus, reusing Mohammadpur questions where the syllabus matches). Each
 * SECTION is one row of the published মানবন্টন; each ITEM is one question the reviewer can
 * confirm ("matches the syllabus") or attach a suggestion to (ExamPaperSuggestion).
 *
 * Items are never hard-deleted: an accepted delete suggestion sets `removed`, an accepted
 * edit pushes the old wording onto `history`, so what the reviewer saw stays answerable.
 *
 * Staff-only, operational plane; no student data; no corpus path (ADR-005).
 */
export const EXAM_PAPER_STATUSES = ["DRAFT", "IN_REVIEW", "REVIEWED", "FINAL"] as const;
export type ExamPaperStatus = (typeof EXAM_PAPER_STATUSES)[number];

/** Where an item came from — the reviewer sees it as a badge. */
export const EXAM_ITEM_SOURCES = ["MP2026", "MP2026_ADAPTED", "MP_OTHER", "MP_OTHER_ADAPTED", "NEW", "REVIEWER"] as const;
export type ExamItemSource = (typeof EXAM_ITEM_SOURCES)[number];

export const EXAM_SECTION_KINDS = ["WRITTEN", "ORAL"] as const;
export type ExamSectionKind = (typeof EXAM_SECTION_KINDS)[number];

export interface IExamItemHistory {
  text: string;
  answer?: string | null;
  options: string[];
  at: Date;
  by: Types.ObjectId;
  suggestionId?: Types.ObjectId | null;
}

export interface IExamPaperItem {
  key: string;
  text: string;
  options: string[];
  answer?: string | null;
  marks?: number | null;
  source: ExamItemSource;
  sourceRef?: string | null;
  bookRef?: string | null;
  needsPicture: boolean;
  note?: string | null;
  removed: boolean;
  syllabusConfirmedBy?: Types.ObjectId | null;
  syllabusConfirmedAt?: Date | null;
  history: IExamItemHistory[];
}

export interface IExamPaperSection {
  seq: number;
  syllabusRowSeq: number[];
  kind: ExamSectionKind;
  instructionBn: string;
  count?: number | null;
  marksEach?: number | null;
  total: number;
  choiceNoteBn?: string | null;
  splitMarks: boolean;
  stimulusMd?: string | null;
  matchRight: string[];
  items: IExamPaperItem[];
}

export interface IExamSyllabusRowCopy {
  seq: number;
  label: string;
  itemType?: string | null;
  component?: string | null;
  count?: number | null;
  marksEach?: number | null;
  total: number;
}

export interface IExamPaperDraft extends Document {
  _id: Types.ObjectId;
  /** Stable import key, e.g. `annual-2026-L3-BAN`. Re-importing the same key is refused. */
  key: string;
  term: ExamTerm;
  year: number;
  examNameBn: string;
  classLevel: number;
  subject: string;
  titleBn: string;
  fullMarks: number;
  durationBn?: string | null;
  syllabusRows: IExamSyllabusRowCopy[];
  sections: IExamPaperSection[];
  authorNotes?: string | null;
  status: ExamPaperStatus;
  reviewerUserId?: Types.ObjectId | null;
  reviewerAssignedAt?: Date | null;
  reviewSubmittedAt?: Date | null;
  reviewSummary?: string | null;
  finalizedBy?: Types.ObjectId | null;
  finalizedAt?: Date | null;
  importedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const HistorySchema = new Schema<IExamItemHistory>(
  {
    text: { type: String, required: true },
    answer: { type: String, default: null },
    options: { type: [String], default: [] },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    suggestionId: { type: Schema.Types.ObjectId, ref: "ExamPaperSuggestion", default: null },
  },
  { _id: false },
);

const ItemSchema = new Schema<IExamPaperItem>(
  {
    key: { type: String, required: true },
    text: { type: String, required: true },
    options: { type: [String], default: [] },
    answer: { type: String, default: null },
    marks: { type: Number, default: null },
    source: { type: String, enum: EXAM_ITEM_SOURCES, required: true },
    sourceRef: { type: String, default: null },
    bookRef: { type: String, default: null },
    needsPicture: { type: Boolean, default: false },
    note: { type: String, default: null },
    removed: { type: Boolean, default: false },
    syllabusConfirmedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    syllabusConfirmedAt: { type: Date, default: null },
    history: { type: [HistorySchema], default: [] },
  },
  { _id: false },
);

const SectionSchema = new Schema<IExamPaperSection>(
  {
    seq: { type: Number, required: true },
    syllabusRowSeq: { type: [Number], default: [] },
    kind: { type: String, enum: EXAM_SECTION_KINDS, required: true },
    instructionBn: { type: String, required: true },
    count: { type: Number, default: null },
    marksEach: { type: Number, default: null },
    total: { type: Number, required: true },
    choiceNoteBn: { type: String, default: null },
    splitMarks: { type: Boolean, default: false },
    stimulusMd: { type: String, default: null },
    matchRight: { type: [String], default: [] },
    items: { type: [ItemSchema], default: [] },
  },
  { _id: false },
);

const RowCopySchema = new Schema<IExamSyllabusRowCopy>(
  {
    seq: { type: Number, required: true },
    label: { type: String, required: true },
    itemType: { type: String, default: null },
    component: { type: String, default: null },
    count: { type: Number, default: null },
    marksEach: { type: Number, default: null },
    total: { type: Number, required: true },
  },
  { _id: false },
);

const ExamPaperDraftSchema = new Schema<IExamPaperDraft>(
  {
    key: { type: String, required: true, trim: true },
    term: { type: String, enum: EXAM_TERMS, required: true },
    year: { type: Number, required: true },
    examNameBn: { type: String, required: true },
    classLevel: { type: Number, min: ROSTER_CLASS_LEVEL_MIN, max: ROSTER_CLASS_LEVEL_MAX, required: true },
    subject: { type: String, required: true },
    titleBn: { type: String, required: true },
    fullMarks: { type: Number, required: true },
    durationBn: { type: String, default: null },
    syllabusRows: { type: [RowCopySchema], default: [] },
    sections: { type: [SectionSchema], default: [] },
    authorNotes: { type: String, default: null },
    status: { type: String, enum: EXAM_PAPER_STATUSES, required: true, default: "DRAFT" },
    reviewerUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewerAssignedAt: { type: Date, default: null },
    reviewSubmittedAt: { type: Date, default: null },
    reviewSummary: { type: String, default: null },
    finalizedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    finalizedAt: { type: Date, default: null },
    importedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ExamPaperDraftSchema.index({ key: 1 }, { unique: true });
ExamPaperDraftSchema.index({ year: -1, term: 1, classLevel: 1, subject: 1 });
ExamPaperDraftSchema.index({ reviewerUserId: 1, status: 1 });

export const ExamPaperDraft = model<IExamPaperDraft>("ExamPaperDraft", ExamPaperDraftSchema);
