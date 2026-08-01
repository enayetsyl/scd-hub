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

/** Whole days between two instants, floored — "yesterday's backup" reads as 1, not 0.9. */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** Drive is a network hop; the panel may be refreshed freely without re-listing. */
let cache: { at: number; value: BackupStatus } | null = null;
const TTL_MS = 5 * 60_000;

export function resetBackupCache(): void {
  cache = null;
}

export async function backupStatus(now = new Date()): Promise<BackupStatus> {
  const base: BackupStatus = {
    folder: BACKUP_FOLDER,
    found: false,
    count: 0,
    archives: [],
    newestName: null,
    newestAt: null,
    newestSizeBytes: null,
    ageDays: null,
    totalSizeBytes: 0,
    band: "critical",
    error: null,
  };

  if (cache && Date.now() - cache.at < TTL_MS) {
    // Age is recomputed from the cached listing rather than served stale: the folder
    // changes once a day, but "how old is it" changes continuously.
    const v = cache.value;
    const ageDays = v.newestAt ? daysBetween(new Date(v.newestAt), now) : null;
    return { ...v, ageDays, band: backupBand(v.found, ageDays) };
  }

  let files: DriveFileRef[] | null;
  try {
    files = await listFolderByName(BACKUP_FOLDER);
  } catch (e) {
    // Unknown, NOT "missing": an unreachable Drive must not be reported as "no backups".
    return { ...base, band: "unknown", error: (e as Error).message };
  }

  if (files === null) return { ...base, found: false, band: "critical" };

  const sorted = [...files].sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  const newest = sorted[0] ?? null;
  const ageDays = newest ? daysBetween(new Date(newest.createdTime), now) : null;
  const value: BackupStatus = {
    folder: BACKUP_FOLDER,
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
    totalSizeBytes: sorted.reduce((n, f) => n + (f.sizeBytes ?? 0), 0),
    band: backupBand(true, ageDays),
    error: null,
  };
  cache = { at: Date.now(), value };
  return value;
}
