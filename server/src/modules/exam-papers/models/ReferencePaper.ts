import { Schema, model, Document, Types } from "mongoose";
import { EXAM_TERMS, ROSTER_CLASS_LEVEL_MAX, ROSTER_CLASS_LEVEL_MIN } from "@scd/shared";
import type { ExamTerm } from "@scd/shared";

/**
 * ReferencePaper — another branch's past exam paper, kept so the Office can read it
 * (D-#1030, docs/prd-exam-paper-bank.md §4). Today every row is Mohammadpur's.
 *
 * Like a class book (D-#870), the uploaded PDF is rendered to page JPEGs (StoredFile kind
 * `reference_paper_page`) for the in-app reader. Unlike a class book, the ORIGINAL file
 * (often the .docx the teacher typed) is kept as well (`reference_paper_source`) — the
 * point of this shelf is that a setter can lift a question out of it.
 *
 * Staff-only. Holds no student or guardian data; no corpus path (ADR-005).
 */
export const REFERENCE_PAPER_STATUSES = ["PROCESSING", "READY", "FAILED"] as const;
export type ReferencePaperStatus = (typeof REFERENCE_PAPER_STATUSES)[number];

export const REFERENCE_BRANCHES = ["MOHAMMADPUR"] as const;
export type ReferenceBranch = (typeof REFERENCE_BRANCHES)[number];

export interface IReferencePaper extends Document {
  _id: Types.ObjectId;
  branch: ReferenceBranch;
  term: ExamTerm;
  year: number;
  /** Roster class level, −1 Nursery … 5. Null for a cross-class paper (an Arabic level). */
  classLevel?: number | null;
  /** Subject code as the routine uses it (BAN, ENG, MATH, ISLAM, SCI, BGS, ARABIC…). */
  subject: string;
  /** Free label shown on the card — "Class 3 · Bangla", "Arabic Level 2". */
  title: string;
  status: ReferencePaperStatus;
  error?: string;
  pageFileIds: Types.ObjectId[];
  pageCount: number;
  pageAspect: number;
  /** The original upload (docx or pdf) — downloadable by readers. */
  sourceFileId?: Types.ObjectId | null;
  sourceName: string;
  /** sha1 of the source bytes — the import script skips a file it already loaded. */
  sourceHash?: string | null;
  uploadedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ReferencePaperSchema = new Schema<IReferencePaper>(
  {
    branch: { type: String, enum: REFERENCE_BRANCHES, required: true, default: "MOHAMMADPUR" },
    term: { type: String, enum: EXAM_TERMS, required: true },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    classLevel: { type: Number, min: ROSTER_CLASS_LEVEL_MIN, max: ROSTER_CLASS_LEVEL_MAX, default: null },
    subject: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    status: { type: String, enum: REFERENCE_PAPER_STATUSES, required: true, default: "PROCESSING" },
    error: { type: String },
    pageFileIds: [{ type: Schema.Types.ObjectId, ref: "StoredFile" }],
    pageCount: { type: Number, default: 0 },
    pageAspect: { type: Number, default: 1.414 },
    sourceFileId: { type: Schema.Types.ObjectId, ref: "StoredFile", default: null },
    sourceName: { type: String, default: "" },
    sourceHash: { type: String, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ReferencePaperSchema.index({ branch: 1, year: -1, term: 1, classLevel: 1, subject: 1 });
// The /files gate reverse-resolves a page or a source file to its paper.
ReferencePaperSchema.index({ pageFileIds: 1 });
ReferencePaperSchema.index({ sourceFileId: 1 });
ReferencePaperSchema.index({ sourceHash: 1 });

export const ReferencePaper = model<IReferencePaper>("ReferencePaper", ReferencePaperSchema);
