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

export const ENGLISH_DRIVE_KINDS = ["BLOCK", "TN", "CW", "HW", "PT", "AS", "CLUE"] as const;
export type EnglishDriveKind = (typeof ENGLISH_DRIVE_KINDS)[number];

/** Upload cap for one markdown document (PRD §3). */
export const ENGLISH_DRIVE_MD_MAX_BYTES = 1024 * 1024;

export interface IEnglishDriveDoc extends Document {
  _id: Types.ObjectId;
  /** Content axis C1..C5 stored as the integer 1..5 (English Drive covers no Nursery/KG). */
  classLevel: number;
  blockNumber: number;
  kind: EnglishDriveKind;
  /** Sequence within (block × kind) — HW **4**, CW **1**. 1 for single-doc kinds.
   *  Pre-seq rows have no field; reads treat missing as 1. */
  seq: number;
  title: string;
  version: number;
  /** The full markdown source (≤ 1 MB). */
  contentMd: string;
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
    blockNumber: { type: Number, required: true, min: 1 },
    kind: { type: String, required: true, enum: ENGLISH_DRIVE_KINDS },
    seq: { type: Number, required: true, min: 1, default: 1 },
    title: { type: String, required: true, trim: true },
    version: { type: Number, required: true, min: 1 },
    contentMd: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    replacedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The library list ("latest of every (class, block, kind, seq)") is the hot read.
EnglishDriveDocSchema.index({ classLevel: 1, blockNumber: 1, kind: 1, seq: 1, replacedAt: 1 });

export const EnglishDriveDoc = model<IEnglishDriveDoc>("EnglishDriveDoc", EnglishDriveDocSchema);
