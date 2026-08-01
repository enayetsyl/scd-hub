/**
 * BackupService (SH-7, D-#416) — a restore point for a database that has none.
 *
 * Atlas M0 provides **no automated backups**. Until now a dropped collection or a bad
 * migration had no way back, and nothing in the app said so — which is the worst shape a
 * risk can take: invisible. This dumps the live database to the school's own Drive and
 * records the run so the panel can show its AGE.
 *
 * Deliberate choices:
 *   - **No `mongodump`.** It may not exist on the VM and would add a provisioning step to
 *     something whose whole point is reliability. This reads through the existing driver
 *     and writes NDJSON — restorable with a short script, and inspectable by a human.
 *   - **Gzip streamed, not buffered.** The dump is written into a gzip stream collection
 *     by collection; only the compressed result is held whole (a few MB), not the ~100 MB
 *     of JSON. Node's default heap would not thank us for the alternative.
 *   - **OFF unless `BACKUP_ENABLED=1`.** A job that writes to Drive on a schedule should
 *     start when a person decides it starts, not the moment a deploy lands. The panel
 *     reports "not enabled" rather than pretending a restore point exists.
 *   - **A failed run is recorded.** A history of successes only is how a broken backup
 *     goes unnoticed.
 */
import { createGzip } from "zlib";
import mongoose from "mongoose";
import { BackupRun, type IBackupRun } from "../models/BackupRun";
import { uploadToDrive, listDriveFolder, deleteFromDrive } from "./DriveStore";

/** Backups older than this many runs are dropped from Drive. Four weekly runs ≈ a month
 *  of restore points, which is proportionate for a school's data at this size. */
export const BACKUP_KEEP = 4;

/** Refuse to dump more than this uncompressed. A runaway collection should surface as a
 *  loud skip, not as a VM quietly filling its memory. */
export const BACKUP_MAX_RAW_BYTES = 512 * 1024 * 1024;

/** Documents read per batch — small enough to stay off the heap, large enough to be fast. */
const BATCH = 500;

export function backupEnabled(): boolean {
  return process.env.BACKUP_ENABLED === "1";
}

export interface BackupStatus {
  enabled: boolean;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastSizeBytes: number | null;
  lastError: string | null;
  /** Whole days since the last SUCCESSFUL run; null when there has never been one. */
  ageDays: number | null;
}

export async function backupStatus(now = new Date()): Promise<BackupStatus> {
  const base: BackupStatus = {
    enabled: backupEnabled(),
    lastRunAt: null,
    lastOk: null,
    lastSizeBytes: null,
    lastError: null,
    ageDays: null,
  };
  if (mongoose.connection.readyState !== 1) return base;

  const last = (await BackupRun.findOne({}).sort({ startedAt: -1 }).lean()) as IBackupRun | null;
  if (!last) return base;
  // Age is measured from the last SUCCESS, not the last attempt: a job failing nightly
  // must not look fresh.
  const lastOkRun = last.ok
    ? last
    : ((await BackupRun.findOne({ ok: true }).sort({ startedAt: -1 }).lean()) as IBackupRun | null);
  return {
    enabled: backupEnabled(),
    lastRunAt: last.startedAt.toISOString(),
    lastOk: last.ok,
    lastSizeBytes: last.sizeBytes ?? null,
    lastError: last.error ?? null,
    ageDays: lastOkRun
      ? Math.floor((now.getTime() - lastOkRun.startedAt.getTime()) / 86_400_000)
      : null,
  };
}

/** Collect a gzip stream's output without ever holding the uncompressed text whole. */
function gzipCollector(): { gz: ReturnType<typeof createGzip>; done: Promise<Buffer> } {
  const gz = createGzip();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    gz.on("data", (c: Buffer) => chunks.push(c));
    gz.on("end", () => resolve(Buffer.concat(chunks)));
    gz.on("error", reject);
  });
  return { gz, done };
}

/** Backpressure-aware write: without awaiting `drain`, a fast reader outruns the
 *  compressor and the "streaming" dump quietly buffers in memory after all. */
function write(gz: ReturnType<typeof createGzip>, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (gz.write(text)) return resolve();
    gz.once("drain", resolve);
    gz.once("error", reject);
  });
}

/**
 * Dump every collection of the current database to Drive as one gzipped NDJSON file.
 * Each line is `{"__collection":"name"}` followed by that collection's documents, so a
 * restore is a single pass with no index file to keep in sync.
 */
export async function runBackup(now = new Date()): Promise<IBackupRun> {
  const run = await BackupRun.create({ startedAt: now, ok: false });

  try {
    if (!backupEnabled()) throw new Error("Backups are not enabled (set BACKUP_ENABLED=1)");
    if (mongoose.connection.readyState !== 1) throw new Error("No database connection");
    const conn = mongoose.connection;
    if (!conn.db) throw new Error("No database handle");

    const dbName = conn.db.databaseName;
    const { gz, done } = gzipCollector();
    let rawBytes = 0;
    let docCount = 0;

    const collections = await conn.db.listCollections().toArray();
    for (const c of collections) {
      if (c.type === "view") continue;
      await write(gz, JSON.stringify({ __collection: c.name }) + "\n");
      const cursor = conn.db.collection(c.name).find({}).batchSize(BATCH);
      for await (const doc of cursor) {
        const line = JSON.stringify(doc) + "\n";
        rawBytes += Buffer.byteLength(line);
        if (rawBytes > BACKUP_MAX_RAW_BYTES) {
          gz.destroy();
          throw new Error(
            `Backup aborted: raw size passed ${Math.round(BACKUP_MAX_RAW_BYTES / 1024 ** 2)} MB`,
          );
        }
        await write(gz, line);
        docCount++;
      }
    }
    gz.end();
    const gzipped = await done;

    const dateKey = now.toISOString().slice(0, 10);
    const fileName = `scdhub-${dbName}-${dateKey}.ndjson.gz`;
    const driveFileId = await uploadToDrive({
      name: fileName,
      mime: "application/gzip",
      data: gzipped,
      year: String(now.getFullYear()),
      subfolder: "backups",
    });

    run.finishedAt = new Date();
    run.ok = true;
    run.sizeBytes = gzipped.length;
    run.rawBytes = rawBytes;
    run.collectionCount = collections.length;
    run.docCount = docCount;
    run.driveFileId = driveFileId;
    run.fileName = fileName;
    await run.save();

    // Retention runs AFTER a successful upload, so a failure never costs an old backup:
    // the worst case is one extra file, and the worst case of the alternative is none.
    await pruneOldBackups(String(now.getFullYear()));
    return run;
  } catch (e) {
    run.finishedAt = new Date();
    run.ok = false;
    run.error = (e as Error).message;
    await run.save();
    return run;
  }
}

/** Keep the newest `BACKUP_KEEP` files in the backups folder; drop the rest. */
export async function pruneOldBackups(year: string): Promise<number> {
  const files = await listDriveFolder(year, "backups");
  const stale = files
    .filter((f) => f.name.endsWith(".ndjson.gz"))
    .sort((a, b) => b.createdTime.localeCompare(a.createdTime))
    .slice(BACKUP_KEEP);
  for (const f of stale) await deleteFromDrive(f.id);
  return stale.length;
}
