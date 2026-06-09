/**
 * ImportBatch — one row per import run (ADR-007 / J1.1).
 * Written whether the import passes or fails (verdict records the outcome).
 * Append-only; never edited (ADR-008).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IImportBatch extends Document {
  _id: Types.ObjectId;
  /** The raw envelope JSON exactly as received at the boundary. */
  envelopeSnapshot: Record<string, unknown>;
  docType: string;
  subject?: string;
  classLevel?: number;
  sourceProject?: string;
  author?: string;
  contentVersion?: string;
  reviewStatus?: string;
  /** PASS | FAIL */
  verdict: "PASS" | "FAIL";
  failChecks: string[];
  warnings: string[];
  advisories: string[];
  /** Set to the created artifact's _id on PASS. */
  artifactId?: Types.ObjectId;
  importedBy: Types.ObjectId;
  importedAt: Date;
}

const ImportBatchSchema = new Schema<IImportBatch>(
  {
    envelopeSnapshot: { type: Schema.Types.Mixed, required: true },
    docType: { type: String, required: true },
    subject: { type: String },
    classLevel: { type: Number },
    sourceProject: { type: String },
    author: { type: String },
    contentVersion: { type: String },
    reviewStatus: { type: String },
    verdict: { type: String, enum: ["PASS", "FAIL"], required: true },
    failChecks: [{ type: String }],
    warnings: [{ type: String }],
    advisories: [{ type: String }],
    artifactId: { type: Schema.Types.ObjectId },
    importedBy: { type: Schema.Types.ObjectId, required: true },
    importedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false },
);

ImportBatchSchema.index({ importedBy: 1, importedAt: -1 });
ImportBatchSchema.index({ verdict: 1, importedAt: -1 });

export const ImportBatch = model<IImportBatch>("ImportBatch", ImportBatchSchema);
