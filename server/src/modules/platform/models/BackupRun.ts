import { Schema, model, Document } from "mongoose";

/**
 * BackupRun (SH-7, D-#416) — the record that a backup happened, so its AGE can be shown.
 *
 * The row exists because the risk being managed is silence: Atlas M0 has **no automated
 * backups at all**, so the failure mode is believing a restore point exists when none
 * does. A failed run is therefore recorded too (`ok: false` with the error) — a backup
 * page that only ever shows successes is how a broken job goes unnoticed for months.
 */
export interface IBackupRun extends Document {
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean;
  /** Compressed size actually uploaded. */
  sizeBytes: number | null;
  /** Uncompressed bytes read out of Mongo, for the size guard. */
  rawBytes: number | null;
  collectionCount: number | null;
  docCount: number | null;
  driveFileId: string | null;
  fileName: string | null;
  error: string | null;
}

const BackupRunSchema = new Schema<IBackupRun>(
  {
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    ok: { type: Boolean, required: true, default: false },
    sizeBytes: { type: Number, default: null },
    rawBytes: { type: Number, default: null },
    collectionCount: { type: Number, default: null },
    docCount: { type: Number, default: null },
    driveFileId: { type: String, default: null },
    fileName: { type: String, default: null },
    error: { type: String, default: null },
  },
  { collection: "backupruns" },
);

BackupRunSchema.index({ startedAt: -1 });

export const BackupRun = model<IBackupRun>("BackupRun", BackupRunSchema);
