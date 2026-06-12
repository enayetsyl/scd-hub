import { Schema, model, Document, Types } from "mongoose";

/**
 * StoredFile — metadata for an uploaded file (GP-A, D-#70): the app's FIRST
 * file capability. The bytes live in the school's Google Drive (the LIVE
 * store, D-#70 ruling); this row is the server-side handle.
 *
 * SECURITY (prd-guardian-portal §5): `driveFileId` is SERVER-INTERNAL. It is
 * never exposed in any GraphQL type or HTTP response — clients only ever see
 * this document's Mongo `_id` and stream bytes through `GET /files/:id`
 * (server-in-the-middle; no Drive URL or redirect ever reaches a client).
 *
 * Identity plane (an answer file is child PII, ADR-005): no corpus path, no
 * public URL, default-deny access via HomeworkFileService.assertFileReadAccess.
 */
export type StoredFileKind = "hw_question" | "hw_answer";

export const STORED_FILE_KINDS: readonly StoredFileKind[] = ["hw_question", "hw_answer"];

export interface IStoredFile extends Document {
  _id: Types.ObjectId;
  kind: StoredFileKind;
  mime: string;
  sizeBytes: number;
  originalName: string;
  /** Google Drive file id — SERVER-INTERNAL, never serialized to a client. */
  driveFileId: string;
  uploadedBy: Types.ObjectId;
  uploadedAt: Date;
}

const StoredFileSchema = new Schema<IStoredFile>(
  {
    kind: { type: String, enum: STORED_FILE_KINDS, required: true },
    mime: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    originalName: { type: String, required: true, trim: true },
    driveFileId: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false },
);

export const StoredFile = model<IStoredFile>("StoredFile", StoredFileSchema);
