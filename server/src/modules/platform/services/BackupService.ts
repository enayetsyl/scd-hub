/**
 * BackupService (SH-7, D-#425 superseding D-#416's version) — WATCHES the school's
 * existing backups rather than taking its own.
 *
 * The first version of this file dumped the database to Drive on a weekly schedule,
 * written on the belief that no restore point existed because Atlas M0 has no automated
 * backups. True of Atlas, false of this school: `scripts/backup.sh` has run nightly from
 * cron since 2026-06-30 (ADR-011/016), writing `mongodump --archive --gzip` to a
 * top-level `SCD-Hub-Backups` folder. Running a second, competing job into a different
 * folder on a different schedule would have been strictly worse than watching the real
 * one — and the script was in this repo the whole time.
 *
 * The folder LOOKS sparse before the last week (30 Jun, 12 Jul, 19 Jul, then daily) but
 * nothing is missing: `scripts/drive-backup.mjs` rotates grandfather-father-son — every
 * archive for 7 days, the newest of each of 4 weeks, the newest of each of 3 months. A
 * monitor must not mistake that thinning for a failure, which is why the band is computed
 * from the NEWEST archive's age alone and never from the spacing between files.
 *
 * Age is the point: a nightly job that starts failing is silent, and a backup nobody
 * checks is one you find out about on the day you need it.
 *
 * READ-ONLY. It lists a folder and reports. It never writes, uploads, or deletes — the
 * backups belong to the cron that makes them, and a monitor that could delete its subject
 * is not a monitor.
 */
import { listFolderByName, type DriveFileRef } from "./DriveStore";

/** The folder the school's cron writes to; overridable if that ever moves. */
export const BACKUP_FOLDER = process.env.BACKUP_FOLDER_NAME ?? "SCD-Hub-Backups";

/** The cron is daily, so one missed night is a warning and three days is a real failure —
 *  tight enough to catch a broken job while the previous archives are still current. */
export const BACKUP_WARN_DAYS = 2;
export const BACKUP_CRITICAL_DAYS = 3;

/** The hourly pool (D-#818): `backup.sh hourly` keeps the newest 48 here. */
export const HOURLY_BACKUP_FOLDER = process.env.HOURLY_BACKUP_FOLDER_NAME ?? "SCD-Hub-Backups-Hourly";

/** Hourly thresholds depend on WHERE prod lives, mirroring backup.sh: on the VM's own mongod
 *  the job runs every hour (warn after 2 h, critical after 6 h); while prod is still on Atlas
 *  the M0 egress cap limits it to one midday run, so a day-old copy is normal there. */
export const HOURLY_WARN_HOURS_LOCAL = 2;
export const HOURLY_CRITICAL_HOURS_LOCAL = 6;
export const HOURLY_WARN_HOURS_REMOTE = 25;
export const HOURLY_CRITICAL_HOURS_REMOTE = 49;

export type BackupBand = "ok" | "warn" | "critical" | "unknown";

export interface BackupArchive {
  name: string;
  createdAt: string;
  sizeBytes: number | null;
}

/** How many archives the panel lists. The rotation keeps ~14, so this shows all of them
 *  with room to spare; the cap only stops a misconfigured folder from flooding the card. */
export const BACKUP_LIST_LIMIT = 40;

export interface BackupStatus {
  folder: string;
  /** False when no such folder exists — reported as a finding, never auto-created. */
  found: boolean;
  count: number;
  /** Every archive, newest first — the owner asked to see the names and dates, and the
   *  list is also what makes the 7/4/3 rotation legible instead of looking like gaps. */
  archives: BackupArchive[];
  newestName: string | null;
  newestAt: string | null;
  newestSizeBytes: number | null;
  /** Whole days since the newest archive. */
  ageDays: number | null;
  /** Whole hours since the newest archive — the unit the hourly card reads. */
  ageHours: number | null;
  /** Total size of everything kept, so unbounded growth is visible. */
  totalSizeBytes: number;
  band: BackupBand;
  error: string | null;
}

export function backupBand(found: boolean, ageDays: number | null): BackupBand {
  if (!found) return "critical"; // no folder = no restore point, which is the worst case
  if (ageDays === null) return "critical"; // folder exists but is empty
  if (ageDays >= BACKUP_CRITICAL_DAYS) return "critical";
  if (ageDays >= BACKUP_WARN_DAYS) return "warn";
  return "ok";
}

/** True when the app's own database is the VM's local mongod — then `backup.sh hourly`
 *  runs every hour; otherwise (Atlas) once a day. Same test the script applies. */
export function prodDbIsLocal(uri = process.env.MONGODB_URI ?? ""): boolean {
  return /^mongodb:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)([:/?]|$)/.test(uri);
}

export function hourlyBackupBand(found: boolean, ageHours: number | null, local = prodDbIsLocal()): BackupBand {
  if (!found || ageHours === null) return "critical";
  const warn = local ? HOURLY_WARN_HOURS_LOCAL : HOURLY_WARN_HOURS_REMOTE;
  const critical = local ? HOURLY_CRITICAL_HOURS_LOCAL : HOURLY_CRITICAL_HOURS_REMOTE;
  if (ageHours >= critical) return "critical";
  if (ageHours >= warn) return "warn";
  return "ok";
}

/** Whole days between two instants, floored — "yesterday's backup" reads as 1, not 0.9. */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** Whole hours between two instants, floored. */
function hoursBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 3_600_000);
}

/** Drive is a network hop; the panel may be refreshed freely without re-listing.
 *  One cache entry per folder (daily + hourly pools). */
const cache = new Map<string, { at: number; value: BackupStatus }>();
const TTL_MS = 5 * 60_000;

export function resetBackupCache(): void {
  cache.clear();
}

/** The empty shape for a folder — also what SystemHealthService reports when a probe throws. */
export function emptyBackupStatus(folder: string, band: BackupBand, error: string | null = null): BackupStatus {
  return {
    folder,
    found: false,
    count: 0,
    archives: [],
    newestName: null,
    newestAt: null,
    newestSizeBytes: null,
    ageDays: null,
    ageHours: null,
    totalSizeBytes: 0,
    band,
    error,
  };
}

type BandRule = (found: boolean, ageDays: number | null, ageHours: number | null) => BackupBand;

async function folderStatus(folder: string, bandOf: BandRule, now: Date): Promise<BackupStatus> {
  const cached = cache.get(folder);
  if (cached && Date.now() - cached.at < TTL_MS) {
    // Age is recomputed from the cached listing rather than served stale: the folder
    // changes once a day (or hour), but "how old is it" changes continuously.
    const v = cached.value;
    const ageDays = v.newestAt ? daysBetween(new Date(v.newestAt), now) : null;
    const ageHours = v.newestAt ? hoursBetween(new Date(v.newestAt), now) : null;
    return { ...v, ageDays, ageHours, band: bandOf(v.found, ageDays, ageHours) };
  }

  let files: DriveFileRef[] | null;
  try {
    files = await listFolderByName(folder);
  } catch (e) {
    // Unknown, NOT "missing": an unreachable Drive must not be reported as "no backups".
    return emptyBackupStatus(folder, "unknown", (e as Error).message);
  }

  if (files === null) return emptyBackupStatus(folder, "critical");

  const sorted = [...files].sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  const newest = sorted[0] ?? null;
  const ageDays = newest ? daysBetween(new Date(newest.createdTime), now) : null;
  const ageHours = newest ? hoursBetween(new Date(newest.createdTime), now) : null;
  const value: BackupStatus = {
    folder,
    found: true,
    count: sorted.length,
    archives: sorted.slice(0, BACKUP_LIST_LIMIT).map((f) => ({
      name: f.name,
      createdAt: f.createdTime,
      sizeBytes: f.sizeBytes,
    })),
    newestName: newest?.name ?? null,
    newestAt: newest?.createdTime ?? null,
    newestSizeBytes: newest?.sizeBytes ?? null,
    ageDays,
    ageHours,
    totalSizeBytes: sorted.reduce((n, f) => n + (f.sizeBytes ?? 0), 0),
    band: bandOf(true, ageDays, ageHours),
    error: null,
  };
  cache.set(folder, { at: Date.now(), value });
  return value;
}

/** The nightly pool (SH-7): banded in days. */
export function backupStatus(now = new Date()): Promise<BackupStatus> {
  return folderStatus(BACKUP_FOLDER, (found, ageDays) => backupBand(found, ageDays), now);
}

/** The hourly pool (D-#818): banded in hours, thresholds by where prod lives. */
export function hourlyBackupStatus(now = new Date()): Promise<BackupStatus> {
  return folderStatus(HOURLY_BACKUP_FOLDER, (found, _d, ageHours) => hourlyBackupBand(found, ageHours), now);
}
