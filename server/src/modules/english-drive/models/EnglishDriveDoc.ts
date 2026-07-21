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
 * Replace semantics (owner #5): uploading an existing (classLevel, blockNumber,
 * kind) stamps the old row `replacedAt` and inserts the new one; reads always
 * take the unreplaced row. History stays in the collection (audit), no UI in v1.
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
    title: { type: String, required: true, trim: true },
    version: { type: Number, required: true, min: 1 },
    contentMd: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    replacedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The library list ("latest of every (class, block, kind)") is the hot read.
EnglishDriveDocSchema.index({ classLevel: 1, blockNumber: 1, kind: 1, replacedAt: 1 });

export const EnglishDriveDoc = model<IEnglishDriveDoc>("EnglishDriveDoc", EnglishDriveDocSchema);
