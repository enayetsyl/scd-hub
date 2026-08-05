/**
 * EnglishDriveDoc — one English Drive curriculum document (D-#344): the block
 * file or one of its derivatives, authored in Claude Desktop and uploaded as
 * markdown by Principal/Office. The markdown lives IN the document (class-note
 * precedent) — render, PDF and print all derive from `contentMd`; there is no
 * file-storage round trip.
 *
 * Kinds are a module-local enum (HW_NIL_REASONS / VideoReview precedent) — no
 * shared-vocab twin, no verifier change. English only; no subject axis in v1.
 *
 * Replace semantics (owner #5, refined by the 2026-07-21 testing finding): a
 * block can hold SEVERAL documents of one kind (C1B03_HW1..HW4), so the
 * identity is (classLevel, blockNumber, kind, seq) — uploading an existing
 * tuple stamps the old row `replacedAt` and inserts the new one; reads always
 * take the unreplaced rows. History stays in the collection (audit), no UI in v1.
 *
 * Operational plane; no corpus path (ADR-005). Guardians have no resolver path.
 */
import { Schema, model, Document, Types } from "mongoose";

// AK (D-#455) joins the set with the block splitter — the master's consolidated
// answer key is a document of its own, teacher-only, and the delivery sheet names
// it as a sibling. Module-local like the rest: no shared-vocab twin, no verifier.
export const ENGLISH_DRIVE_KINDS = ["BLOCK", "TN", "CW", "HW", "PT", "AK", "AS", "CLUE"] as const;
export type EnglishDriveKind = (typeof ENGLISH_DRIVE_KINDS)[number];

/** How the document body is stored (owner 2026-07-25). MD = markdown in `contentMd`
 *  (the original, editable, pdfkit-rendered path); PDF/DOCX = a binary StoredFile
 *  referenced by `fileId` (opened/downloaded via GET /files/:id, not editable). */
export const ENGLISH_DRIVE_FORMATS = ["MD", "PDF", "DOCX"] as const;
export type EnglishDriveFormat = (typeof ENGLISH_DRIVE_FORMATS)[number];

/** Upload cap for one markdown document (PRD §3). */
export const ENGLISH_DRIVE_MD_MAX_BYTES = 1024 * 1024;

export interface IEnglishDriveDoc extends Document {
  _id: Types.ObjectId;
  /** Content axis C1..C5 stored as the integer 1..5 (English Drive covers no Nursery/KG). */
  classLevel: number;
  /** Null for block-less documents — assignments are week-scoped (D-#346); also null
   *  for PT, which uses `blockNumbers` instead. Required for every other kind (service). */
  blockNumber: number | null;
  /** The blocks a PT COVERS (D-#347) — a practice test may span several blocks; it
   *  surfaces under each. Empty for every other kind (they use scalar blockNumber).
   *  NEVER part of the replace identity — a PT is keyed (class, PT, seq). */
  blockNumbers: number[];
  kind: EnglishDriveKind;
  /** Sequence within (block × kind) — HW **4**, CW **1**. 1 for single-doc kinds.
   *  Pre-seq rows have no field; reads treat missing as 1. */
  seq: number;
  title: string;
  version: number;
  /** How the body is stored — MD (default/legacy) | PDF | DOCX (owner 2026-07-25). */
  format: EnglishDriveFormat;
  /** The full markdown source (≤ 1 MB) — set for MD, empty for PDF/DOCX. */
  contentMd: string;
  /** The binary StoredFile (kind `english_drive`) for a PDF/DOCX doc; null for MD.
   *  This is always the ORIGINAL upload (the .docx for a DOCX doc) — the download. */
  fileId?: Types.ObjectId | null;
  /** For a DOCX doc: the LibreOffice-converted PDF StoredFile (owner 2026-07-25) —
   *  what previews + prints. Null for PDF docs (fileId already IS the pdf) and MD,
   *  and null when a DOCX conversion failed (callers fall back to fileId). */
  pdfFileId?: Types.ObjectId | null;
  /** Original upload filename (PDF/DOCX) — the download name + a nicer library label. */
  fileName?: string | null;
  /** The binary's MIME (application/pdf | …wordprocessingml.document); null for MD. */
  fileMime?: string | null;
  uploadedBy: Types.ObjectId;
  /** Stamped when a newer upload of the same (classLevel, blockNumber, kind) replaced this row. */
  replacedAt?: Date | null;
  /** createdAt doubles as uploadedAt. */
  createdAt: Date;
  updatedAt: Date;
}

const EnglishDriveDocSchema = new Schema<IEnglishDriveDoc>(
  {
    classLevel: { type: Number, required: true, min: 1, max: 5 },
    // Optional at the schema so AS can be block-less; the SERVICE requires it for
    // every other kind (D-#346).
    blockNumber: { type: Number, min: 1, default: null },
    // PT's covered blocks (D-#347); [] for every other kind. Surfacing-only, never keyed.
    blockNumbers: { type: [Number], default: [] },
    kind: { type: String, required: true, enum: ENGLISH_DRIVE_KINDS },
    seq: { type: Number, required: true, min: 1, default: 1 },
    title: { type: String, required: true, trim: true },
    version: { type: Number, required: true, min: 1 },
    // Default MD so every pre-existing row (all markdown) reads back as MD without a migration.
    format: { type: String, enum: ENGLISH_DRIVE_FORMATS, required: true, default: "MD" },
    // Required only for MD (service-enforced) so a PDF/DOCX row can carry no markdown.
    contentMd: { type: String, default: "" },
    fileId: { type: Schema.Types.ObjectId, ref: "StoredFile", default: null },
    pdfFileId: { type: Schema.Types.ObjectId, ref: "StoredFile", default: null },
    fileName: { type: String, default: null },
    fileMime: { type: String, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    replacedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The library list ("latest of every (class, block, kind, seq)") is the hot read.
EnglishDriveDocSchema.index({ classLevel: 1, blockNumber: 1, kind: 1, seq: 1, replacedAt: 1 });

export const EnglishDriveDoc = model<IEnglishDriveDoc>("EnglishDriveDoc", EnglishDriveDocSchema);
