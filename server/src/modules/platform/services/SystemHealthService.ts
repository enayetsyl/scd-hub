/**
 * SystemHealthService (SH-1..SH-3, D-#414) — "are we still inside the free tiers?"
 *
 * The school runs on free/cheap infrastructure and the Principal is the person who has to
 * act before a ceiling is hit (prune, archive, or pay). Three ceilings matter, and they
 * are NOT equally scary — measuring them was the point:
 *
 *   1. MongoDB Atlas M0 — 512 MB, and the cap is CLUSTER-wide, not per database. This is
 *      the real constraint: the cluster carries the live school AND the dev/test copies,
 *      so a test database eats production's headroom.
 *   2. The VM — disk, memory, and the monthly egress allowance.
 *   3. Google Drive — where every uploaded byte actually lives (StoredFile is only a
 *      handle). Measured at ~1% of a pooled Workspace quota, so it is reported for
 *      completeness rather than because it is close to anything.
 *
 * DEGRADES INSTEAD OF FAILING. Every source can be unavailable for a legitimate reason —
 * the DB user may lack `listDatabases`, `/proc` does not exist off Linux, Drive may be
 * unreachable or unconfigured. Each section therefore returns its own `error` string and
 * the query still answers. A health panel that 500s when one probe fails is worse than
 * useless: it hides the two numbers that were fine.
 *
 * NO IDENTITY. Counters only — no student, guardian, or user is read here, so this adds
 * no path across the ADR-005 firewall.
 */
import mongoose from "mongoose";
import { readFile } from "fs/promises";
import { statfs } from "fs/promises";
import * as os from "os";
import { NetSnapshot } from "../models/NetSnapshot";
import { driveQuota, type DriveQuota } from "./DriveStore";
import { dateKeyOf } from "../../attendance/dates";
import { getTickerHealth } from "../../notifications/services/tickerHeartbeat";
import {
  captureHealthSnapshot,
  backfillHistory,
  historySeries,
  projectToLimit,
  prunableEstimates,
  HISTORY_DAYS,
  type HistoryPoint,
  type Projection,
  type PrunableEstimate,
} from "./HealthHistoryService";
import { backupStatus, BACKUP_FOLDER, type BackupStatus } from "./BackupService";

/**
 * The Atlas M0 storage ceiling. It is a CONSTANT because the driver cannot ask: no
 * command reports the cluster's plan limit, so a wrong-looking number here means the
 * plan changed and this needs editing (or `ATLAS_STORAGE_LIMIT_MB` set), rather than a
 * silently drifting bar.
 */
export const ATLAS_M0_LIMIT_BYTES = 512 * 1024 * 1024;

/** The VM's monthly egress allowance, likewise a documented constant. */
export const VM_EGRESS_LIMIT_BYTES = 10 * 1024 ** 4; // 10 TB

export function atlasLimitBytes(): number {
  const override = Number(process.env.ATLAS_STORAGE_LIMIT_MB);
  return Number.isFinite(override) && override > 0 ? override * 1024 * 1024 : ATLAS_M0_LIMIT_BYTES;
}

export function egressLimitBytes(): number {
  const override = Number(process.env.VM_EGRESS_LIMIT_GB);
  return Number.isFinite(override) && override > 0 ? override * 1024 ** 3 : VM_EGRESS_LIMIT_BYTES;
}

/** Amber at 70%, red at 85% — early enough that pruning is a choice, not an emergency. */
export const WARN_RATIO = 0.7;
export const CRITICAL_RATIO = 0.85;
export type HealthBand = "ok" | "warn" | "critical" | "unknown";

export function bandFor(used: number, limit: number | null): HealthBand {
  if (!limit || limit <= 0) return "unknown";
  const r = used / limit;
  if (r >= CRITICAL_RATIO) return "critical";
  if (r >= WARN_RATIO) return "warn";
  return "ok";
}

export interface CollectionUsage {
  name: string;
  /** Uncompressed size — what the documents actually weigh. */
  dataSizeBytes: number;
  /** On-disk size after compression; this is what counts against the cap. */
  storageSizeBytes: number;
  indexSizeBytes: number;
  docCount: number;
}

export interface DatabaseUsage {
  name: string;
  /** Compressed storage + indexes — the figure Atlas bills against the 512 MB. */
  storageBytes: number;
  dataSizeBytes: number;
  objects: number;
  /** True for the database this server is actually connected to. */
  isCurrent: boolean;
}

export interface MongoHealth {
  /** Sum of `storageBytes` across every database visible on the cluster. */
  totalStorageBytes: number;
  limitBytes: number;
  band: HealthBand;
  databases: DatabaseUsage[];
  /** Largest collections in the CURRENT database — where the growth actually is. */
  topCollections: CollectionUsage[];
  /**
   * False when the DB user cannot `listDatabases`: the totals then cover only this
   * database, so the panel must say "at least this much" rather than imply a full read.
   */
  clusterWide: boolean;
  error: string | null;
}

export interface HostHealth {
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  diskBand: HealthBand;
  memTotalBytes: number;
  memFreeBytes: number;
  load1: number;
  cpuCount: number;
  uptimeSec: number;
  /** Month-to-date egress, summed from daily snapshot deltas (SH-2). Null until two
   *  snapshots exist — one reading cannot be a delta. */
  egressMonthBytes: number | null;
  egressLimitBytes: number;
  egressBand: HealthBand;
  /** True when the month's figure spans a reboot, so it is a floor, not an exact total. */
  egressPartial: boolean;
  error: string | null;
}

export interface DriveHealth {
  /** What the Drive page shows as "used" — files in Drive, NOT the all-services total. */
  usageBytes: number | null;
  /** The all-services figure Google also returns, kept for reference only. */
  usageAllServicesBytes: number | null;
  usageTrashBytes: number | null;
  limitBytes: number | null;
  band: HealthBand;
  error: string | null;
}

/**
 * The Drive ceiling, in bytes.
 *
 * NOT the API's `storageQuota.limit`. On this account that field returns 100 TiB — the
 * sentinel Google reports for a pooled Workspace allowance — while the account's own
 * Drive page shows **100 GB**, and it is the page a person believes. Reading the API
 * value put the card at 1.3% "Healthy" when the real position is ~52%: the exact failure
 * a headroom panel exists to prevent, so the limit is configuration, not a guess.
 */
export const DRIVE_DEFAULT_LIMIT_BYTES = 100 * 1024 ** 3;

export function driveLimitBytes(): number {
  const override = Number(process.env.DRIVE_LIMIT_GB);
  return Number.isFinite(override) && override > 0
    ? override * 1024 ** 3
    : DRIVE_DEFAULT_LIMIT_BYTES;
}

/** The notification ticker's heartbeat (SH-5). If it stalls, homework auto-DUE and
 *  auto-ISSUE, attendance reminders, class-note prompts, library sweeps and every
 *  escalation stop SILENTLY — nothing else in the app would say so. */
export interface TickerHealth {
  lastTickAt: string | null;
  ageSeconds: number | null;
  band: HealthBand;
}

/** Warn at 2.5x the 60s interval, critical at 10x: one skipped pass is noise, ten
 *  minutes of silence is a stopped scheduler. */
export const TICKER_WARN_SECONDS = 150;
export const TICKER_CRITICAL_SECONDS = 600;

export function tickerBand(ageSeconds: number | null): HealthBand {
  if (ageSeconds === null) return "unknown";
  if (ageSeconds >= TICKER_CRITICAL_SECONDS) return "critical";
  if (ageSeconds >= TICKER_WARN_SECONDS) return "warn";
  return "ok";
}

export interface SystemHealth {
  mongo: MongoHealth;
  host: HostHealth;
  drive: DriveHealth;
  ticker: TickerHealth;
  history: HistoryPoint[];
  projection: Projection;
  prunable: PrunableEstimate[];
  backup: BackupStatus;
  checkedAt: Date;
}

// ---------------------------------------------------------------------------
// Mongo
// ---------------------------------------------------------------------------

interface DbStatsShape {
  dataSize?: number;
  storageSize?: number;
  indexSize?: number;
  objects?: number;
}

/** Storage as the cap counts it: compressed collection storage PLUS indexes. */
function billedBytes(s: DbStatsShape): number {
  return (s.storageSize ?? 0) + (s.indexSize ?? 0);
}

export async function mongoHealth(): Promise<MongoHealth> {
  const limitBytes = atlasLimitBytes();
  const empty: MongoHealth = {
    totalStorageBytes: 0,
    limitBytes,
    band: "unknown",
    databases: [],
    topCollections: [],
    clusterWide: false,
    error: null,
  };

  const conn = mongoose.connection;
  if (!conn?.db) return { ...empty, error: "No database connection" };
  const currentName = conn.db.databaseName;

  const databases: DatabaseUsage[] = [];
  let clusterWide = true;
  let error: string | null = null;

  // The whole cluster shares the cap, so a per-database reading would understate it.
  // `listDatabases` is an admin command the app's user may not hold — degrade to the
  // current database and SAY SO rather than report a total that silently excludes the
  // test copies sitting beside production.
  let names: string[] = [];
  try {
    const listed = (await conn.db.admin().listDatabases()) as { databases: { name: string }[] };
    names = listed.databases
      .map((d) => d.name)
      .filter((n) => !["admin", "local", "config"].includes(n));
  } catch (e) {
    clusterWide = false;
    names = [currentName];
    error = `Cluster-wide read unavailable (${(e as Error).message}); showing this database only`;
  }

  for (const name of names) {
    try {
      // `useDb` reuses this connection's socket rather than opening a second client —
      // an M0 cluster has a small connection cap and the health panel must not spend it.
      const sibling = conn.useDb(name, { useCache: true }).db;
      if (!sibling) throw new Error("sibling handle unavailable");
      const stats = (await sibling.stats()) as DbStatsShape;
      databases.push({
        name,
        storageBytes: billedBytes(stats),
        dataSizeBytes: stats.dataSize ?? 0,
        objects: stats.objects ?? 0,
        isCurrent: name === currentName,
      });
    } catch {
      // One unreadable database must not lose the others.
      if (!error) error = `Some databases could not be read`;
      clusterWide = false;
    }
  }

  // Top collections of the CURRENT database only: that is the one the Principal can act
  // on, and running collStats across every database would be a lot of round trips.
  const topCollections: CollectionUsage[] = [];
  try {
    const colls = await conn.db.listCollections().toArray();
    for (const c of colls) {
      try {
        const s = (await conn.db.command({ collStats: c.name })) as DbStatsShape & {
          size?: number;
          count?: number;
        };
        topCollections.push({
          name: c.name,
          dataSizeBytes: s.size ?? 0,
          storageSizeBytes: s.storageSize ?? 0,
          indexSizeBytes: s.indexSize ?? 0,
          docCount: s.count ?? 0,
        });
      } catch {
        /* skip a collection that refuses stats (a view, a dropped race) */
      }
    }
    topCollections.sort((a, b) => b.storageSizeBytes - a.storageSizeBytes);
  } catch (e) {
    if (!error) error = `Collection sizes unavailable (${(e as Error).message})`;
  }

  const totalStorageBytes = databases.reduce((n, d) => n + d.storageBytes, 0);
  return {
    totalStorageBytes,
    limitBytes,
    band: bandFor(totalStorageBytes, limitBytes),
    databases: databases.sort((a, b) => b.storageBytes - a.storageBytes),
    topCollections: topCollections.slice(0, 10),
    clusterWide,
    error,
  };
}

// ---------------------------------------------------------------------------
// Host (the VM)
// ---------------------------------------------------------------------------

export interface NetCounters {
  txBytes: number;
  rxBytes: number;
}

/**
 * Cumulative non-loopback byte counters from `/proc/net/dev`. Linux-only by nature —
 * absent on a developer's Windows/macOS machine, which is a normal state, not a fault.
 */
export async function readNetCounters(): Promise<NetCounters | null> {
  let raw: string;
  try {
    raw = await readFile("/proc/net/dev", "utf8");
  } catch {
    return null;
  }
  let txBytes = 0;
  let rxBytes = 0;
  for (const line of raw.split("\n").slice(2)) {
    const [iface, rest] = line.split(":");
    if (!rest || iface.trim() === "lo") continue;
    const f = rest.trim().split(/\s+/).map(Number);
    // Column order is fixed by the kernel: rx bytes first, tx bytes at index 8.
    if (Number.isFinite(f[0])) rxBytes += f[0];
    if (Number.isFinite(f[8])) txBytes += f[8];
  }
  return { txBytes, rxBytes };
}

/**
 * Month-to-date egress from the daily snapshots.
 *
 * Counters are cumulative SINCE BOOT, so the month's usage is the sum of day-to-day
 * deltas. A reading lower than the day before means the machine rebooted in between;
 * that day contributes its whole raw counter (everything since the reboot) and the
 * traffic between the last snapshot and the reboot is unrecoverable — which is exactly
 * why the result is flagged `partial` rather than presented as exact.
 */
export function egressForMonth(
  snapshots: { dateKey: string; txBytes: number }[],
  monthPrefix: string,
): { bytes: number | null; partial: boolean } {
  const sorted = [...snapshots].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  let total = 0;
  let partial = false;
  let counted = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!cur.dateKey.startsWith(monthPrefix)) continue;
    if (cur.txBytes >= prev.txBytes) {
      total += cur.txBytes - prev.txBytes;
    } else {
      total += cur.txBytes; // rebooted: everything since the reboot is this day's traffic
      partial = true;
    }
    counted++;
  }
  return { bytes: counted === 0 ? null : total, partial };
}

export async function hostHealth(now = new Date()): Promise<HostHealth> {
  const egressLimit = egressLimitBytes();
  const base: HostHealth = {
    diskTotalBytes: null,
    diskFreeBytes: null,
    diskBand: "unknown",
    memTotalBytes: os.totalmem(),
    memFreeBytes: os.freemem(),
    load1: os.loadavg()[0] ?? 0,
    cpuCount: os.cpus().length,
    uptimeSec: os.uptime(),
    egressMonthBytes: null,
    egressLimitBytes: egressLimit,
    egressBand: "unknown",
    egressPartial: false,
    error: null,
  };

  try {
    const s = await statfs(process.platform === "win32" ? "C:\\" : "/");
    const total = Number(s.blocks) * Number(s.bsize);
    // `bavail` (available to an unprivileged user), not `bfree`: the reserved blocks are
    // not space the school can actually use.
    const free = Number(s.bavail) * Number(s.bsize);
    base.diskTotalBytes = total;
    base.diskFreeBytes = free;
    base.diskBand = bandFor(total - free, total);
  } catch (e) {
    base.error = `Disk unavailable (${(e as Error).message})`;
  }

  try {
    const monthPrefix = dateKeyOf(now).slice(0, 7);
    const snaps = await NetSnapshot.find({}).sort({ dateKey: 1 }).lean();
    const { bytes, partial } = egressForMonth(
      snaps.map((s) => ({ dateKey: s.dateKey, txBytes: s.txBytes })),
      monthPrefix,
    );
    base.egressMonthBytes = bytes;
    base.egressPartial = partial;
    base.egressBand = bytes === null ? "unknown" : bandFor(bytes, egressLimit);
  } catch (e) {
    base.error = base.error ?? `Egress history unavailable (${(e as Error).message})`;
  }

  return base;
}

/**
 * Capture today's counters — called once per scheduler tick, idempotent on `dateKey` so
 * a restart (or the ticker's own repeated passes) rewrites the same row instead of
 * inflating the history. Returns false when there is nothing to read (non-Linux).
 */
export async function captureNetSnapshot(now = new Date()): Promise<boolean> {
  // No connection ⇒ do not even try. Mongoose would BUFFER the write for 10s and then
  // throw, which on the ticker's path means a 10s stall per pass — the ticker runs
  // before/independently of the DB being up, and a telemetry row is never worth delaying
  // the notification work behind it. (CI caught this: /proc exists on Linux, so the
  // Windows dev box skipped the write and never saw the stall.)
  if (mongoose.connection.readyState !== 1) return false;
  const counters = await readNetCounters();
  if (!counters) return false;
  const dateKey = dateKeyOf(now);
  await NetSnapshot.updateOne(
    { dateKey },
    {
      $set: {
        txBytes: counters.txBytes,
        rxBytes: counters.rxBytes,
        uptimeSec: Math.round(os.uptime()),
        capturedAt: now,
      },
    },
    { upsert: true },
  );
  return true;
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------

/** Drive is a network hop, so its answer is cached — the panel may be refreshed freely
 *  and a slow or rate-limited Google must not slow the two local probes down. */
let driveCache: { at: number; value: DriveQuota } | null = null;
const DRIVE_TTL_MS = 5 * 60_000;

export function resetDriveCache(): void {
  driveCache = null;
}

export async function driveHealth(): Promise<DriveHealth> {
  try {
    if (!driveCache || Date.now() - driveCache.at > DRIVE_TTL_MS) {
      driveCache = { at: Date.now(), value: await driveQuota() };
    }
    const q = driveCache.value;
    // `usageInDrive` is what the Drive page calls "used"; `usage` spans every Google
    // service and would overstate this ceiling by ~26x on the live account.
    const used = q.usageInDriveBytes ?? q.usageBytes;
    const limit = driveLimitBytes();
    return {
      usageBytes: used,
      usageAllServicesBytes: q.usageBytes,
      usageTrashBytes: q.usageInDriveTrashBytes,
      limitBytes: limit,
      band: bandFor(used, limit),
      error: null,
    };
  } catch (e) {
    return {
      usageBytes: null,
      usageAllServicesBytes: null,
      usageTrashBytes: null,
      limitBytes: null,
      band: "unknown",
      error: (e as Error).message,
    };
  }
}

/** The whole panel in one read. Sections run in parallel and each carries its own error,
 *  so one dead probe never costs the others. */
export async function systemHealth(now = new Date()): Promise<SystemHealth> {
  const [mongo, host, drive, history, backup] = await Promise.all([
    mongoHealth(),
    hostHealth(now),
    driveHealth(),
    historySeries(HISTORY_DAYS, now).catch(() => [] as HistoryPoint[]),
    // A Drive hiccup must leave the backup card "unknown", never "no backups" — the
    // difference between "we could not look" and "there is nothing there" is the whole
    // value of this card.
    backupStatus(now).catch(
      (e): BackupStatus => ({
        folder: BACKUP_FOLDER,
        found: false,
        count: 0,
        newestName: null,
        newestAt: null,
        newestSizeBytes: null,
        ageDays: null,
        totalSizeBytes: 0,
        band: "unknown",
        error: (e as Error).message,
      }),
    ),
  ]);

  // Prunable needs the measured collection sizes, so it runs after mongoHealth rather
  // than beside it. A failure here must not cost the panel its numbers.
  const prunable = await prunableEstimates(
    mongo.topCollections.map((c) => ({
      name: c.name,
      docCount: c.docCount,
      storageBytes: c.storageSizeBytes,
    })),
    now,
  ).catch(() => [] as PrunableEstimate[]);

  const tick = getTickerHealth(now);
  return {
    mongo,
    host,
    drive,
    ticker: { ...tick, band: tickerBand(tick.ageSeconds) },
    history,
    projection: projectToLimit(
      history.map((p) => ({ dateKey: p.dateKey, value: p.dbStorageBytes, estimated: p.estimated })),
      mongo.limitBytes,
      now,
    ),
    prunable,
    backup,
    checkedAt: now,
  };
}

/** Today's gauge row + a gap-filling backfill, called once per scheduler day (SH-4).
 *  Reuses the numbers `mongoHealth`/`hostHealth`/`driveHealth` already gathered rather
 *  than re-reading the cluster. */
export async function captureDailyHealth(now = new Date()): Promise<boolean> {
  if (mongoose.connection.readyState !== 1) return false;
  const [mongo, host, drive] = await Promise.all([mongoHealth(), hostHealth(now), driveHealth()]);
  const collections = mongo.topCollections.map((c) => ({
    name: c.name,
    docCount: c.docCount,
    storageBytes: c.storageSizeBytes,
  }));
  const wrote = await captureHealthSnapshot(
    {
      dbStorageBytes: mongo.totalStorageBytes,
      databases: mongo.databases.map((d) => ({ name: d.name, storageBytes: d.storageBytes })),
      collections,
      diskUsedBytes:
        host.diskTotalBytes !== null && host.diskFreeBytes !== null
          ? host.diskTotalBytes - host.diskFreeBytes
          : null,
      diskTotalBytes: host.diskTotalBytes,
      driveUsageBytes: drive.usageBytes,
    },
    now,
  );
  // Fills only the days that have no row at all, so it is a no-op after the first run.
  // The baseline keeps reconstructed days in the same unit as the measured ones: what the
  // walk cannot see (other databases, the untracked tail) is held at today's value.
  const trackedToday = collections.reduce((n, c) => n + c.storageBytes, 0);
  await backfillHistory({
    collections,
    baselineBytes: Math.max(0, mongo.totalStorageBytes - trackedToday),
    now,
  });
  return wrote;
}
