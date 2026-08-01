import { Schema, model, Document } from "mongoose";

/**
 * NetSnapshot (SH-2, D-#414) — one row per day holding the VM's CUMULATIVE network
 * counters as read from `/proc/net/dev`.
 *
 * Why a snapshot at all: the free-tier allowance the school can actually blow through is
 * monthly egress, but Linux only exposes counters since LAST BOOT. A reboot resets them
 * to zero, so a single reading can never answer "how much this month". Storing the daily
 * reading turns the counter into deltas, and a reading LOWER than the previous one is the
 * unambiguous signature of a reboot — that day's delta is then the raw counter itself.
 *
 * Deliberately tiny and non-identity: two integers and a date key, no path to a person.
 * One row per day (`dateKey` unique), so the whole history is ~365 rows a year.
 */
export interface INetSnapshot extends Document {
  /** Local date `YYYY-MM-DD` — the key the ticker de-duplicates on. */
  dateKey: string;
  /** Cumulative bytes transmitted since boot, summed over non-loopback interfaces. */
  txBytes: number;
  rxBytes: number;
  /** Seconds of uptime at capture — a drop confirms the reboot a counter reset implies. */
  uptimeSec: number;
  capturedAt: Date;
}

const NetSnapshotSchema = new Schema<INetSnapshot>(
  {
    dateKey: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    txBytes: { type: Number, required: true, min: 0 },
    rxBytes: { type: Number, required: true, min: 0 },
    uptimeSec: { type: Number, required: true, min: 0 },
    capturedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "netsnapshots" },
);

export const NetSnapshot = model<INetSnapshot>("NetSnapshot", NetSnapshotSchema);
