/**
 * BookImageAsset — one uploaded file at one stage of one slot's chain (SB-2, D-#409/#419).
 *
 * The chain is APPROVED → CROPPED → UPSCALED → COMPLIANT, and `book.json` names the
 * COMPLIANT filename. Bytes ride the existing Drive store (`StoredFile` +
 * `DriveStore`); this row is the index, and `driveFileId` never leaves the server.
 *
 * **A re-upload SUPERSEDES rather than overwrites.** An image a reviewer rejected is
 * evidence — the timeline has to be able to show what was replaced and when, which a
 * mutating write would destroy.
 *
 * `source` records whether the file arrived by external upload or the in-app API
 * (D-#419). Both paths are permanent and everything downstream of this row is
 * identical between them; the field exists for the timeline, not for branching.
 *
 * `inputFingerprint` is what makes staleness computable (D-#417): each stage records
 * a fingerprint of the artifact it was DERIVED FROM, so re-approving an image makes
 * every downstream row's recorded input disagree with reality, and the disagreement
 * IS the staleness. Nothing has to remember to invalidate anything.
 */
import { Schema, Types, type Document } from "mongoose";
import { ARTIFACT_STAGES, IMAGE_SOURCES, type ArtifactStage, type ImageSource } from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface IBookImageAsset extends Document {
  _id: Types.ObjectId;
  bookId: string;
  lessonNo: number;
  slotId: string;
  stage: ArtifactStage;
  /** StoredFile id — the Drive-backed handle. Bytes stream via GET /files/:id. */
  storedFileId: Types.ObjectId;
  /** Only meaningful on an APPROVED row: how the artwork was produced. */
  source?: ImageSource;
  /** e.g. "ChatGPT", "Gemini 2.5 Flash Image" — free text, for the timeline. */
  generatorTool?: string;
  generatorNote?: string;
  /** sha256 of the prompt the artwork was generated from — ties a picture back to
   *  the exact words that produced it, across later prompt edits. */
  promptSha256?: string;
  /** Fingerprint of THIS artifact (size + Drive id is enough to detect replacement). */
  fingerprint: string;
  /** Fingerprint of the artifact this one was derived from. Null on APPROVED, which
   *  is the head of the chain. A mismatch against the current upstream row = STALE. */
  inputFingerprint?: string | null;
  /** False once a newer row for the same (slot, stage) arrives. */
  current: boolean;
  supersedes?: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BookImageAssetSchema = new Schema<IBookImageAsset>(
  {
    bookId: { type: String, required: true },
    lessonNo: { type: Number, required: true },
    slotId: { type: String, required: true },
    stage: { type: String, enum: ARTIFACT_STAGES, required: true },
    storedFileId: { type: Schema.Types.ObjectId, required: true },
    source: { type: String, enum: IMAGE_SOURCES },
    generatorTool: { type: String },
    generatorNote: { type: String },
    promptSha256: { type: String },
    fingerprint: { type: String, required: true },
    inputFingerprint: { type: String, default: null },
    current: { type: Boolean, required: true, default: true },
    supersedes: { type: Schema.Types.ObjectId },
    // Identity is on the other connection (D-#404) — a bare id, never a ref.
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    uploadedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

// The staleness read: the current artifact at each stage of a slot.
BookImageAssetSchema.index({ bookId: 1, slotId: 1, stage: 1, current: 1 });
// A lesson's whole image chain, and the book-wide sweep the build gate runs.
BookImageAssetSchema.index({ bookId: 1, lessonNo: 1, current: 1 });
// History for one slot, newest first — the timeline's read.
BookImageAssetSchema.index({ bookId: 1, slotId: 1, uploadedAt: -1 });

export const BookImageAsset = bookConnection.model<IBookImageAsset>(
  "BookImageAsset",
  BookImageAssetSchema,
);
