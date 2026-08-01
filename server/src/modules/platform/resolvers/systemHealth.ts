/**
 * System-health resolver (SH-1..SH-3, D-#414) — the Principal's "are we still inside the
 * free tiers?" read.
 *
 * READ-ONLY by construction: no mutation is exposed here. Gated on `audit:read`, which in
 * the role map is Principal-only — the same lever the audit viewer uses, and no new
 * permission (so no two-place contract sync, per the D-#281 precedent).
 *
 * The payload is pure infrastructure telemetry: byte counts, a load average, a disk
 * figure. It reads no student, guardian, or user document, so it opens no path across the
 * ADR-005 identity firewall. Nor does it expose a connection string, a credential, or the
 * storing Google account — the numbers are the whole point, not the plumbing.
 */
import { builder } from "../../../schema";
import {
  systemHealth,
  type SystemHealth,
  type MongoHealth,
  type HostHealth,
  type DriveHealth,
  type DatabaseUsage,
  type CollectionUsage,
  type TickerHealth,
} from "../services/SystemHealthService";
import type { HistoryPoint, Projection, PrunableEstimate } from "../services/HealthHistoryService";
import type { BackupStatus, BackupArchive } from "../services/BackupService";

const DatabaseUsageRef = builder.objectRef<DatabaseUsage>("DatabaseUsage");
DatabaseUsageRef.implement({
  description: "One database on the cluster. The Atlas cap is cluster-wide, so a test copy counts too.",
  fields: (t) => ({
    name: t.exposeString("name"),
    /** Compressed storage + indexes — what the cap actually counts. */
    storageBytes: t.float({ resolve: (d) => d.storageBytes }),
    dataSizeBytes: t.float({ resolve: (d) => d.dataSizeBytes }),
    objects: t.int({ resolve: (d) => d.objects }),
    isCurrent: t.boolean({ resolve: (d) => d.isCurrent }),
  }),
});

const CollectionUsageRef = builder.objectRef<CollectionUsage>("CollectionUsage");
CollectionUsageRef.implement({
  description: "A collection in the CURRENT database, largest first — where growth actually is.",
  fields: (t) => ({
    name: t.exposeString("name"),
    dataSizeBytes: t.float({ resolve: (c) => c.dataSizeBytes }),
    storageSizeBytes: t.float({ resolve: (c) => c.storageSizeBytes }),
    indexSizeBytes: t.float({ resolve: (c) => c.indexSizeBytes }),
    docCount: t.int({ resolve: (c) => c.docCount }),
  }),
});

const MongoHealthRef = builder.objectRef<MongoHealth>("MongoHealth");
MongoHealthRef.implement({
  description: "Atlas storage against the plan ceiling (a documented constant — no command reports it).",
  fields: (t) => ({
    totalStorageBytes: t.float({ resolve: (m) => m.totalStorageBytes }),
    limitBytes: t.float({ resolve: (m) => m.limitBytes }),
    band: t.string({ resolve: (m) => m.band }),
    databases: t.field({ type: [DatabaseUsageRef], resolve: (m) => m.databases }),
    topCollections: t.field({ type: [CollectionUsageRef], resolve: (m) => m.topCollections }),
    /** False = the total covers only this database; the panel must not imply a full read. */
    clusterWide: t.boolean({ resolve: (m) => m.clusterWide }),
    error: t.string({ nullable: true, resolve: (m) => m.error }),
  }),
});

const HostHealthRef = builder.objectRef<HostHealth>("HostHealth");
HostHealthRef.implement({
  description: "The VM the server runs on: disk, memory, load, and month-to-date egress.",
  fields: (t) => ({
    diskTotalBytes: t.float({ nullable: true, resolve: (h) => h.diskTotalBytes }),
    diskFreeBytes: t.float({ nullable: true, resolve: (h) => h.diskFreeBytes }),
    diskBand: t.string({ resolve: (h) => h.diskBand }),
    memTotalBytes: t.float({ resolve: (h) => h.memTotalBytes }),
    memFreeBytes: t.float({ resolve: (h) => h.memFreeBytes }),
    load1: t.float({ resolve: (h) => h.load1 }),
    cpuCount: t.int({ resolve: (h) => h.cpuCount }),
    uptimeSec: t.float({ resolve: (h) => h.uptimeSec }),
    /** Null until two daily snapshots exist — one reading cannot be a delta. */
    egressMonthBytes: t.float({ nullable: true, resolve: (h) => h.egressMonthBytes }),
    egressLimitBytes: t.float({ resolve: (h) => h.egressLimitBytes }),
    egressBand: t.string({ resolve: (h) => h.egressBand }),
    /** True when a reboot fell inside the month, making the figure a floor. */
    egressPartial: t.boolean({ resolve: (h) => h.egressPartial }),
    error: t.string({ nullable: true, resolve: (h) => h.error }),
  }),
});

const DriveHealthRef = builder.objectRef<DriveHealth>("DriveHealth");
DriveHealthRef.implement({
  description: "Google Drive, where every uploaded byte lives. Limit comes from Google, not from us.",
  fields: (t) => ({
    usageBytes: t.float({ nullable: true, resolve: (d) => d.usageBytes }),
    usageAllServicesBytes: t.float({ nullable: true, resolve: (d) => d.usageAllServicesBytes }),
    usageTrashBytes: t.float({ nullable: true, resolve: (d) => d.usageTrashBytes }),
    limitBytes: t.float({ nullable: true, resolve: (d) => d.limitBytes }),
    band: t.string({ resolve: (d) => d.band }),
    error: t.string({ nullable: true, resolve: (d) => d.error }),
  }),
});

const TickerHealthRef = builder.objectRef<TickerHealth>("TickerHealth");
TickerHealthRef.implement({
  description:
    "The notification ticker's heartbeat (SH-5). A stalled ticker stops homework auto-DUE/auto-ISSUE, " +
    "attendance reminders, class-note prompts, library sweeps and every escalation — silently.",
  fields: (t) => ({
    lastTickAt: t.string({ nullable: true, resolve: (v) => v.lastTickAt }),
    ageSeconds: t.int({ nullable: true, resolve: (v) => v.ageSeconds }),
    band: t.string({ resolve: (v) => v.band }),
  }),
});

const HistoryPointRef = builder.objectRef<HistoryPoint>("HealthHistoryPoint");
HistoryPointRef.implement({
  description:
    "One day of the trend. `estimated` marks a BACKFILLED day: counts are exact (documents carry " +
    "their creation time) but bytes are count x today's bytes-per-document, since Mongo keeps no " +
    "history of collection sizes.",
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    dbStorageBytes: t.float({ nullable: true, resolve: (p) => p.dbStorageBytes }),
    diskUsedBytes: t.float({ nullable: true, resolve: (p) => p.diskUsedBytes }),
    driveUsageBytes: t.float({ nullable: true, resolve: (p) => p.driveUsageBytes }),
    totalDocs: t.int({ resolve: (p) => p.totalDocs }),
    estimated: t.boolean({ resolve: (p) => p.estimated }),
  }),
});

const ProjectionRef = builder.objectRef<Projection>("HealthProjection");
ProjectionRef.implement({
  description:
    "Least-squares growth fit. Nulls rather than a guess when the answer would be meaningless: " +
    "fewer than three points is not a trend, and a flat or shrinking series has no crossing date.",
  fields: (t) => ({
    bytesPerDay: t.float({ nullable: true, resolve: (p) => p.bytesPerDay }),
    daysToLimit: t.int({ nullable: true, resolve: (p) => p.daysToLimit }),
    limitDateKey: t.string({ nullable: true, resolve: (p) => p.limitDateKey }),
    points: t.int({ resolve: (p) => p.points }),
    usesEstimates: t.boolean({ resolve: (p) => p.usesEstimates }),
  }),
});

const PrunableRef = builder.objectRef<PrunableEstimate>("PrunableEstimate");
PrunableRef.implement({
  description:
    "How much an allowlisted collection could give back. REPORT ONLY — nothing here deletes, and " +
    "`audits` is excluded by rule (ADR-008 append-only).",
  fields: (t) => ({
    collection: t.exposeString("collection"),
    olderThanDays: t.int({ resolve: (p) => p.olderThanDays }),
    reason: t.exposeString("reason"),
    docCount: t.int({ resolve: (p) => p.docCount }),
    reclaimableBytes: t.float({ resolve: (p) => p.reclaimableBytes }),
  }),
});

const BackupArchiveRef = builder.objectRef<BackupArchive>("BackupArchive");
BackupArchiveRef.implement({
  description:
    "One archive in the backup folder. Listing them all makes the 7/4/3 rotation legible — " +
    "otherwise the thinning older dates read as missed nights.",
  fields: (t) => ({
    name: t.exposeString("name"),
    createdAt: t.exposeString("createdAt"),
    sizeBytes: t.float({ nullable: true, resolve: (a) => a.sizeBytes }),
  }),
});

const BackupStatusRef = builder.objectRef<BackupStatus>("BackupStatus");
BackupStatusRef.implement({
  description:
    "Backup freshness (SH-7). Atlas M0 has NO automated backups, so `enabled: false` means no " +
    "restore point exists at all. `ageDays` measures from the last SUCCESS, never the last attempt.",
  fields: (t) => ({
    folder: t.exposeString("folder"),
    found: t.boolean({ resolve: (b) => b.found }),
    count: t.int({ resolve: (b) => b.count }),
    archives: t.field({ type: [BackupArchiveRef], resolve: (b) => b.archives }),
    newestName: t.string({ nullable: true, resolve: (b) => b.newestName }),
    newestAt: t.string({ nullable: true, resolve: (b) => b.newestAt }),
    newestSizeBytes: t.float({ nullable: true, resolve: (b) => b.newestSizeBytes }),
    ageDays: t.int({ nullable: true, resolve: (b) => b.ageDays }),
    totalSizeBytes: t.float({ resolve: (b) => b.totalSizeBytes }),
    band: t.string({ resolve: (b) => b.band }),
    error: t.string({ nullable: true, resolve: (b) => b.error }),
  }),
});

const SystemHealthRef = builder.objectRef<SystemHealth>("SystemHealth");
SystemHealthRef.implement({
  description: "Free-tier headroom across the three ceilings that can actually stop the school (D-#414).",
  fields: (t) => ({
    mongo: t.field({ type: MongoHealthRef, resolve: (s) => s.mongo }),
    host: t.field({ type: HostHealthRef, resolve: (s) => s.host }),
    drive: t.field({ type: DriveHealthRef, resolve: (s) => s.drive }),
    ticker: t.field({ type: TickerHealthRef, resolve: (s) => s.ticker }),
    history: t.field({ type: [HistoryPointRef], resolve: (s) => s.history }),
    projection: t.field({ type: ProjectionRef, resolve: (s) => s.projection }),
    prunable: t.field({ type: [PrunableRef], resolve: (s) => s.prunable }),
    backup: t.field({ type: BackupStatusRef, resolve: (s) => s.backup }),
    checkedAt: t.string({ resolve: (s) => s.checkedAt.toISOString() }),
  }),
});

builder.queryField("systemHealth", (t) =>
  t.field({
    type: SystemHealthRef,
    description:
      "Storage/disk/egress headroom against the free-tier ceilings (D-#414). Requires audit:read " +
      "(Principal). Each section carries its own `error` and the query still answers, so one dead " +
      "probe never hides the numbers that were fine.",
    authScopes: { hasPermission: "audit:read" },
    resolve: async () => systemHealth(),
  }),
);
