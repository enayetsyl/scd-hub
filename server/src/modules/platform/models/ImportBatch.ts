/**
 * ImportBatch — one row per import run (ADR-007 / J1.1).
 * Written whether the import passes or fails (verdict records the outcome).
 * Append-only; never edited (ADR-008) — except the two stamps written when a PASS
 * creates its artifact: `artifactId`, and the snapshot strip below.
 *
 * SNAPSHOT RETENTION (D-#816): the raw envelope is kept only while it is the sole copy.
 * Once a PASS has created its ContentArtifact, the artifact's `envelopeJson` holds the
 * same envelope (later in-place question edits are audited field-by-field as
 * QUESTION_EDITED before/after), so the row drops `envelopeSnapshot` and keeps
 * `snapshotSha256` as proof of what arrived. FAIL rows keep the snapshot — it is the
 * only way to see why an upload was refused. Nothing in the app reads the snapshot.
 */
import { createHash } from "crypto";
import { Schema, model, Document, Types } from "mongoose";

export interface IImportBatch extends Document {
  _id: Types.ObjectId;
  /** The raw envelope JSON exactly as received at the boundary. Unset once a PASS has
   *  created its artifact (D-#816) — see the header. */
  envelopeSnapshot?: Record<string, unknown>;
  /** sha256 (hex) of JSON.stringify(envelope as received) — survives the strip. */
  snapshotSha256?: string;
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
  /** question_batch (contract v1.1): on the per-ITEM row, the _id of the batch row this
   *  item arrived under. Unset on the batch row itself and on single-envelope imports. */
  parentBatchId?: Types.ObjectId;
  /** question_batch (contract v1.1), batch row only: the wrapper's self-description. */
  bankId?: string;
  bankVersion?: string;
  itemCount?: number;
  digest?: string;
  importedBy: Types.ObjectId;
  importedAt: Date;
}

const ImportBatchSchema = new Schema<IImportBatch>(
  {
    envelopeSnapshot: { type: Schema.Types.Mixed },
    snapshotSha256: { type: String },
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
    parentBatchId: { type: Schema.Types.ObjectId },
    bankId: { type: String },
    bankVersion: { type: String },
    itemCount: { type: Number },
    digest: { type: String },
    importedBy: { type: Schema.Types.ObjectId, required: true },
    importedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false },
);

ImportBatchSchema.index({ importedBy: 1, importedAt: -1 });
ImportBatchSchema.index({ verdict: 1, importedAt: -1 });
// Batch traceability: the per-item rows of one question_batch upload (contract v1.1).
ImportBatchSchema.index({ parentBatchId: 1 }, { sparse: true });

export const ImportBatch = model<IImportBatch>("ImportBatch", ImportBatchSchema);

/** The fingerprint kept after the snapshot is stripped (D-#816). The prod backfill
 *  (server/scripts/strip-import-snapshots.cjs) computes the same value. */
export function envelopeSha256(envelope: unknown): string {
  return createHash("sha256").update(JSON.stringify(envelope)).digest("hex");
}
