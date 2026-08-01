import { Schema, model, Document } from "mongoose";

/**
 * HealthSnapshot (SH-4, D-#416) — one row per day of point-in-time GAUGES, so the health
 * panel can show a trend and a projection instead of a single number with no direction.
 *
 * Deliberately separate from `NetSnapshot` (SH-2), which holds cumulative COUNTERS. The
 * two need opposite arithmetic: a counter must be differenced and is reboot-sensitive, a
 * gauge is read as-is. Folding them into one row would invite reading a gauge as a delta.
 *
 * `estimated` marks a BACKFILLED row. Mongo keeps no history of collection sizes, so rows
 * for days before this shipped are reconstructed from document timestamps: the counts are
 * exact (every document carries `_id`/`createdAt`), the BYTES are count x today's
 * bytes-per-document. That is a real approximation and the panel says so rather than
 * drawing a confident line through invented data.
 */
export interface ICollectionPoint {
  name: string;
  docCount: number;
  /** Null on a backfilled row — historical byte sizes are unrecoverable. */
  storageBytes: number | null;
}

export interface IHealthSnapshot extends Document {
  /** Local date `YYYY-MM-DD`; one row per day. */
  dateKey: string;
  /** Sum of storage+index across every database seen. Null when backfilled. */
  dbStorageBytes: number | null;
  /** Per-database storage, for the stacked view. Empty on a backfilled row. */
  databases: { name: string; storageBytes: number }[];
  /** Tracked collections of the CURRENT database. */
  collections: ICollectionPoint[];
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  driveUsageBytes: number | null;
  /** The Node process's own resident memory — a leak here hides inside the VM total. */
  processRssBytes: number | null;
  /** True when reconstructed from timestamps rather than measured. */
  estimated: boolean;
  capturedAt: Date;
}

const HealthSnapshotSchema = new Schema<IHealthSnapshot>(
  {
    dateKey: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    dbStorageBytes: { type: Number, default: null },
    databases: [
      {
        _id: false,
        name: { type: String, required: true },
        storageBytes: { type: Number, required: true },
      },
    ],
    collections: [
      {
        _id: false,
        name: { type: String, required: true },
        docCount: { type: Number, required: true },
        storageBytes: { type: Number, default: null },
      },
    ],
    diskUsedBytes: { type: Number, default: null },
    diskTotalBytes: { type: Number, default: null },
    driveUsageBytes: { type: Number, default: null },
    processRssBytes: { type: Number, default: null },
    estimated: { type: Boolean, required: true, default: false },
    capturedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "healthsnapshots" },
);

export const HealthSnapshot = model<IHealthSnapshot>("HealthSnapshot", HealthSnapshotSchema);
