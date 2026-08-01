/**
 * HealthHistoryService (SH-4..SH-6, D-#416) — turning the point-in-time panel into a
 * trend, a projection, and a prune list.
 *
 * "14.9% of 512 MB" does not tell the Principal whether that is two years of headroom or
 * two months. The decision needs a DIRECTION, so this records a daily gauge, fits a line
 * to it, and answers "at this rate, when is the cap reached".
 *
 * THE HISTORY IS PARTLY RECONSTRUCTED, and the distinction is load-bearing:
 *   - document COUNTS are exact for every past day, because every document carries a
 *     creation time (`_id` at minimum), so the curve can be walked backwards;
 *   - BYTES are not recoverable — Mongo keeps no history of collection sizes — so a
 *     backfilled day's bytes are `count x today's bytes-per-document`.
 * Backfilled rows are flagged `estimated` and the panel labels them. Drawing one
 * confident line through measured and invented points is precisely the lie a projection
 * must not tell.
 */
import mongoose from "mongoose";
import { HealthSnapshot, type IHealthSnapshot } from "../models/HealthSnapshot";
import { dateKeyOf } from "../../attendance/dates";

/** How many collections of the current database are tracked day to day. Ten covers the
 *  ones that matter (the tail is < 100 KB each) and keeps the row small — the history
 *  must not become a meaningful consumer of the very cap it watches. */
export const TRACKED_COLLECTIONS = 10;

/** Days of history the panel charts by default. */
export const HISTORY_DAYS = 90;

/**
 * Collections a person may reasonably prune, with the age beyond which a row is very
 * unlikely to be wanted. This is an ALLOWLIST, never "everything old":
 *   - `audits` is absent BY RULE — ADR-008 makes it append-only, and a "reclaim 300 KB"
 *     suggestion against it would be an invitation to break that;
 *   - school records (homework, assignments, attendance) are absent because they are the
 *     product, not exhaust;
 *   - what remains is genuinely regenerable or purely historical noise.
 */
export const PRUNABLE: { collection: string; olderThanDays: number; reason: string }[] = [
  { collection: "notifications", olderThanDays: 90, reason: "delivered app notifications" },
  { collection: "corpusevents", olderThanDays: 180, reason: "analytics-plane events" },
  {
    collection: "attendancereminderdispatches",
    olderThanDays: 90,
    reason: "reminder dispatch ledger",
  },
];

export interface HistoryPoint {
  dateKey: string;
  dbStorageBytes: number | null;
  diskUsedBytes: number | null;
  driveUsageBytes: number | null;
  totalDocs: number;
  estimated: boolean;
}

export interface Projection {
  /** Bytes/day from a least-squares fit over the window. Null when it cannot be fitted. */
  bytesPerDay: number | null;
  /** Days until `limitBytes` at that rate; null when flat, shrinking, or unfittable. */
  daysToLimit: number | null;
  /** `YYYY-MM-DD` the cap is reached, or null. */
  limitDateKey: string | null;
  /** Points used — a fit over three days is not a trend, and the panel should say so. */
  points: number;
  /** True when any point in the window was reconstructed rather than measured. */
  usesEstimates: boolean;
}

export interface PrunableEstimate {
  collection: string;
  olderThanDays: number;
  reason: string;
  docCount: number;
  /** count x bytes-per-document; an estimate, since per-document size is not uniform. */
  reclaimableBytes: number;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

interface CaptureInput {
  dbStorageBytes: number;
  databases: { name: string; storageBytes: number }[];
  collections: { name: string; docCount: number; storageBytes: number }[];
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  driveUsageBytes: number | null;
}

/**
 * Write (or overwrite) today's gauge row. Idempotent on `dateKey` so the ticker's repeated
 * passes keep one row per day; the LAST write of the day wins, which is what a gauge
 * means. Returns false when there is no live connection — the ticker runs before the DB
 * is up, and buffering a telemetry write would stall it (the SH-2 lesson).
 */
export async function captureHealthSnapshot(
  input: CaptureInput,
  now = new Date(),
): Promise<boolean> {
  if (mongoose.connection.readyState !== 1) return false;
  await HealthSnapshot.updateOne(
    { dateKey: dateKeyOf(now) },
    {
      $set: {
        dbStorageBytes: input.dbStorageBytes,
        databases: input.databases,
        collections: input.collections.slice(0, TRACKED_COLLECTIONS),
        diskUsedBytes: input.diskUsedBytes,
        diskTotalBytes: input.diskTotalBytes,
        driveUsageBytes: input.driveUsageBytes,
        processRssBytes: process.memoryUsage().rss,
        estimated: false,
        capturedAt: now,
      },
    },
    { upsert: true },
  );
  return true;
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

/** Midnight-of-day as an ObjectId bound — `_id` embeds the creation time, so a count of
 *  documents with `_id < bound` is "how many existed at that moment", with no schema
 *  requirement beyond having an `_id`. */
function objectIdAt(date: Date): mongoose.Types.ObjectId {
  return mongoose.Types.ObjectId.createFromTime(Math.floor(date.getTime() / 1000));
}

/**
 * Reconstruct daily rows for days that have none, from document creation times.
 *
 * Exact for counts, estimated for bytes (count x today's bytes-per-document). Only fills
 * GAPS: a real measured row is never overwritten by an estimate. Idempotent, so it can be
 * run repeatedly and at startup without duplicating anything.
 */
export async function backfillHistory(
  opts: {
    /** Collections to reconstruct, with today's measured bytes for the per-doc ratio. */
    collections: { name: string; docCount: number; storageBytes: number }[];
    /**
     * Everything the reconstruction CANNOT see, held at today's value: the other
     * databases on the cluster and this database's untracked tail.
     *
     * Without it the series changes units mid-chart. Backfilled days can only sum the
     * tracked collections of the current database (~9 MB on the live data) while a
     * measured day reports the whole cluster (~76 MB) — which is what the cap counts. The
     * chart would show an eight-fold cliff on the day the feature shipped and the
     * projection would be fitted across two different quantities. Adding the constant
     * offset puts every point in the same unit as the limit; the assumption it encodes
     * (the unseen part was flat) is exactly why the rows stay flagged `estimated`.
     */
    baselineBytes?: number;
    /** How far back to walk. */
    days?: number;
    now?: Date;
  },
): Promise<{ written: number; skipped: number }> {
  if (mongoose.connection.readyState !== 1) return { written: 0, skipped: 0 };
  const conn = mongoose.connection;
  if (!conn.db) return { written: 0, skipped: 0 };

  const now = opts.now ?? new Date();
  const days = opts.days ?? HISTORY_DAYS;
  const tracked = opts.collections.slice(0, TRACKED_COLLECTIONS);

  // Bytes per document TODAY, used to price historical counts. A collection with no
  // documents yields 0 rather than a divide-by-zero.
  const bytesPerDoc = new Map<string, number>();
  for (const c of tracked) bytesPerDoc.set(c.name, c.docCount > 0 ? c.storageBytes / c.docCount : 0);

  const existing = new Set(
    (await HealthSnapshot.find({}).select("dateKey").lean()).map((r) => r.dateKey),
  );

  let written = 0;
  let skipped = 0;
  for (let back = days; back >= 1; back--) {
    const day = new Date(now);
    day.setDate(day.getDate() - back);
    const dateKey = dateKeyOf(day);
    if (existing.has(dateKey)) {
      skipped++;
      continue;
    }
    // End of that day: what existed once the day was over.
    const bound = new Date(day);
    bound.setHours(23, 59, 59, 999);
    const boundId = objectIdAt(bound);

    const points: { name: string; docCount: number; storageBytes: number | null }[] = [];
    let anyDocs = false;
    for (const c of tracked) {
      let docCount = 0;
      try {
        docCount = await conn.db.collection(c.name).countDocuments({ _id: { $lt: boundId } });
      } catch {
        continue; // a collection that has since been dropped simply has no history
      }
      if (docCount > 0) anyDocs = true;
      points.push({
        name: c.name,
        docCount,
        storageBytes: Math.round(docCount * (bytesPerDoc.get(c.name) ?? 0)),
      });
    }
    // A day before the school had any data at all is not a data point worth drawing.
    if (!anyDocs) {
      skipped++;
      continue;
    }

    await HealthSnapshot.updateOne(
      { dateKey },
      {
        $set: {
          // Reconstructed tracked bytes PLUS the constant baseline, so the point is in
          // the same unit as the cap and the measured rows that follow it.
          dbStorageBytes:
            points.reduce((n, p) => n + (p.storageBytes ?? 0), 0) + (opts.baselineBytes ?? 0),
          databases: [],
          collections: points,
          diskUsedBytes: null,
          diskTotalBytes: null,
          driveUsageBytes: null,
          processRssBytes: null,
          estimated: true,
          capturedAt: bound,
        },
      },
      { upsert: true },
    );
    written++;
  }
  return { written, skipped };
}

// ---------------------------------------------------------------------------
// Read + projection
// ---------------------------------------------------------------------------

export async function historySeries(days = HISTORY_DAYS, now = new Date()): Promise<HistoryPoint[]> {
  if (mongoose.connection.readyState !== 1) return [];
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  const rows = (await HealthSnapshot.find({ dateKey: { $gte: dateKeyOf(from) } })
    .sort({ dateKey: 1 })
    .lean()) as unknown as IHealthSnapshot[];
  return rows.map((r) => ({
    dateKey: r.dateKey,
    dbStorageBytes: r.dbStorageBytes ?? null,
    diskUsedBytes: r.diskUsedBytes ?? null,
    driveUsageBytes: r.driveUsageBytes ?? null,
    totalDocs: (r.collections ?? []).reduce((n, c) => n + (c.docCount ?? 0), 0),
    estimated: !!r.estimated,
  }));
}

/**
 * Least-squares fit of storage against day index → bytes/day and the date the limit is
 * reached.
 *
 * Returns nulls rather than a guess when the answer would be meaningless: fewer than
 * three points is not a trend, and a flat or shrinking series has no crossing date (an
 * infinite or negative "days remaining" rendered as a number would read as a real
 * forecast).
 */
export function projectToLimit(
  series: { dateKey: string; value: number | null; estimated?: boolean }[],
  limitBytes: number,
  now = new Date(),
): Projection {
  const pts = series
    .map((p, i) => ({ i, y: p.value, estimated: !!p.estimated }))
    .filter((p): p is { i: number; y: number; estimated: boolean } => typeof p.y === "number");

  const empty: Projection = {
    bytesPerDay: null,
    daysToLimit: null,
    limitDateKey: null,
    points: pts.length,
    usesEstimates: pts.some((p) => p.estimated),
  };
  if (pts.length < 3) return empty;

  const n = pts.length;
  const meanX = pts.reduce((s, p) => s + p.i, 0) / n;
  const meanY = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.i - meanX) * (p.y - meanY);
    den += (p.i - meanX) ** 2;
  }
  if (den === 0) return empty;
  const slope = num / den; // bytes per point; points are daily
  const latest = pts[pts.length - 1].y;

  if (slope <= 0) {
    // Flat or shrinking: report the rate honestly, but no crossing date exists.
    return { ...empty, bytesPerDay: slope, points: n };
  }
  const remaining = limitBytes - latest;
  if (remaining <= 0) {
    return { bytesPerDay: slope, daysToLimit: 0, limitDateKey: dateKeyOf(now), points: n, usesEstimates: empty.usesEstimates };
  }
  const daysToLimit = Math.round(remaining / slope);
  const limitDate = new Date(now);
  limitDate.setDate(limitDate.getDate() + daysToLimit);
  return {
    bytesPerDay: slope,
    daysToLimit,
    limitDateKey: dateKeyOf(limitDate),
    points: n,
    usesEstimates: empty.usesEstimates,
  };
}

// ---------------------------------------------------------------------------
// Prunable
// ---------------------------------------------------------------------------

/**
 * How much could be reclaimed by deleting rows older than the allowlisted age.
 *
 * REPORTS ONLY — nothing here deletes. The panel's job is to make the case; removing
 * school data is a separate, deliberate decision (and `audits` is excluded by rule).
 */
export async function prunableEstimates(
  measured: { name: string; docCount: number; storageBytes: number }[],
  now = new Date(),
): Promise<PrunableEstimate[]> {
  if (mongoose.connection.readyState !== 1) return [];
  const conn = mongoose.connection;
  if (!conn.db) return [];
  const sizeOf = new Map(measured.map((c) => [c.name, c]));

  const out: PrunableEstimate[] = [];
  for (const rule of PRUNABLE) {
    const stats = sizeOf.get(rule.collection);
    if (!stats || stats.docCount === 0) continue;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - rule.olderThanDays);
    let docCount = 0;
    try {
      docCount = await conn.db
        .collection(rule.collection)
        .countDocuments({ _id: { $lt: objectIdAt(cutoff) } });
    } catch {
      continue;
    }
    if (docCount === 0) continue;
    out.push({
      collection: rule.collection,
      olderThanDays: rule.olderThanDays,
      reason: rule.reason,
      docCount,
      reclaimableBytes: Math.round(docCount * (stats.storageBytes / stats.docCount)),
    });
  }
  return out.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes);
}
