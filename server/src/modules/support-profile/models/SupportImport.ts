import { Schema, model, Document, Types } from "mongoose";

/** SupportImport (§5.11) — an uploaded result before "apply". The raw file is NOT kept, only its hash.
 *  `previewText` (the rejected items' text) is for the preview screen only: deleted on apply or
 *  discard, and after 24 hours at the latest. Rejected items keep a reason code and no text. */
export interface ISupportImport extends Document {
  _id: Types.ObjectId;
  batchId: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  uploadedAt: Date;
  fileHash: string;
  sizeBytes: number;
  status: "VALIDATED" | "APPLYING" | "APPLIED" | "DISCARDED";
  producer: { kind: "API" | "CHAT"; provider?: string | null; model?: string | null; chatLabel?: string | null };
  valid: unknown;
  rejected: { itemRef: string; reasonCode: string; field?: string | null }[];
  warnings: string[];
  previewText: unknown;
  previewExpiresAt: Date | null;
}

const SupportImportSchema = new Schema<ISupportImport>(
  {
    batchId: { type: Schema.Types.ObjectId, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    uploadedAt: { type: Date, required: true },
    fileHash: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    status: { type: String, enum: ["VALIDATED", "APPLYING", "APPLIED", "DISCARDED"], default: "VALIDATED" },
    producer: { type: Schema.Types.Mixed, required: true },
    valid: { type: Schema.Types.Mixed, default: null },
    rejected: { type: [new Schema({ itemRef: String, reasonCode: String, field: { type: String, default: null } }, { _id: false })], default: [] },
    warnings: { type: [String], default: [] },
    previewText: { type: Schema.Types.Mixed, default: null },
    previewExpiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);
SupportImportSchema.index({ batchId: 1, status: 1 });

export const SupportImport = model<ISupportImport>("SupportImport", SupportImportSchema);
