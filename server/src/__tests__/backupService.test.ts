/**
 * BackupService (SH-7, D-#425) — WATCHING the school's nightly backup, not taking one.
 *
 * The trap this module has to avoid is misreading a healthy folder as a broken job. The
 * cron rotates grandfather-father-son (7 daily / 4 weekly / 3 monthly), so the archive
 * dates legitimately thin out into the past — an "are they evenly spaced?" check would
 * cry wolf every week. Only the NEWEST archive's age can say whether last night ran.
 */
const mockList = jest.fn();

jest.mock("../modules/platform/services/DriveStore", () => ({
  listFolderByName: (name: string) => mockList(name),
}));

import {
  backupStatus,
  backupBand,
  resetBackupCache,
  BACKUP_FOLDER,
  BACKUP_WARN_DAYS,
  BACKUP_CRITICAL_DAYS,
  BACKUP_LIST_LIMIT,
  hourlyBackupStatus,
  hourlyBackupBand,
  prodDbIsLocal,
  HOURLY_BACKUP_FOLDER,
  HOURLY_WARN_HOURS_LOCAL,
  HOURLY_CRITICAL_HOURS_LOCAL,
  HOURLY_WARN_HOURS_REMOTE,
  HOURLY_CRITICAL_HOURS_REMOTE,
} from "../modules/platform/services/BackupService";

const NOW = new Date("2026-08-01T12:00:00Z");
/** An archive created `daysAgo` before NOW, named the way the cron names them. */
const archive = (daysAgo: number, id = `f${daysAgo}`) => ({
  id,
  name: `scdhub_prod-2026-07-${String(31 - daysAgo).padStart(2, "0")}_023001.archive.gz`,
  createdTime: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  sizeBytes: 9_700_000,
});

beforeEach(() => {
  jest.clearAllMocks();
  resetBackupCache();
});

describe("backupBand", () => {
  test("fresh is ok, a missed night warns, three days is critical", () => {
    expect(backupBand(true, 0)).toBe("ok");
    expect(backupBand(true, 1)).toBe("ok");
    expect(backupBand(true, BACKUP_WARN_DAYS)).toBe("warn");
    expect(backupBand(true, BACKUP_CRITICAL_DAYS)).toBe("critical");
  });

  test("no folder and an empty folder are BOTH critical", () => {
    // Either way there is no restore point, which is the state worth shouting about.
    expect(backupBand(false, null)).toBe("critical");
    expect(backupBand(true, null)).toBe("critical");
  });
});

describe("backupStatus", () => {
  test("reads the newest archive and reports its age", async () => {
    mockList.mockResolvedValue([archive(3), archive(0), archive(1)]);
    const s = await backupStatus(NOW);
    expect(mockList).toHaveBeenCalledWith(BACKUP_FOLDER);
    expect(s.found).toBe(true);
    expect(s.count).toBe(3);
    expect(s.ageDays).toBe(0);
    expect(s.band).toBe("ok");
    // Newest wins regardless of the order Drive returned them in.
    expect(s.newestAt).toBe(archive(0).createdTime);
  });

  test("ROTATION IS NOT A FAILURE — sparse older archives stay 'ok'", async () => {
    // Exactly the live shape: a run of dailies, then weekly and monthly keepers. The
    // gaps are the rotation policy doing its job, and must not read as missed nights.
    mockList.mockResolvedValue([
      archive(0), archive(1), archive(2), archive(3), archive(4), archive(5), archive(6),
      archive(13, "w1"), archive(20, "w2"), archive(32, "m1"),
    ]);
    const s = await backupStatus(NOW);
    expect(s.band).toBe("ok");
    expect(s.count).toBe(10);
  });

  test("a stale newest archive is what raises the alarm", async () => {
    mockList.mockResolvedValue([archive(4), archive(11), archive(18)]);
    const s = await backupStatus(NOW);
    expect(s.ageDays).toBe(4);
    expect(s.band).toBe("critical");
  });

  test("a missing folder is 'no backups', and is critical", async () => {
    mockList.mockResolvedValue(null);
    const s = await backupStatus(NOW);
    expect(s.found).toBe(false);
    expect(s.band).toBe("critical");
    expect(s.count).toBe(0);
  });

  test("an empty folder is critical too — the folder existing proves nothing", async () => {
    mockList.mockResolvedValue([]);
    const s = await backupStatus(NOW);
    expect(s.found).toBe(true);
    expect(s.ageDays).toBeNull();
    expect(s.band).toBe("critical");
  });

  test("an unreachable Drive is UNKNOWN, never 'no backups'", async () => {
    // Reporting "no restore point" because a network call failed would send someone
    // hunting a disaster that is not happening.
    mockList.mockRejectedValue(new Error("Drive unreachable: ETIMEDOUT"));
    const s = await backupStatus(NOW);
    expect(s.band).toBe("unknown");
    expect(s.error).toMatch(/ETIMEDOUT/);
  });

  test("lists every archive newest-first, with name, date and size", async () => {
    // The owner asked to see the file names and dates. The list is also what makes the
    // rotation legible — without it the thinning older dates just look like gaps.
    mockList.mockResolvedValue([archive(2), archive(0), archive(1)]);
    const s = await backupStatus(NOW);
    expect(s.archives).toHaveLength(3);
    expect(s.archives.map((a) => a.createdAt)).toEqual([
      archive(0).createdTime,
      archive(1).createdTime,
      archive(2).createdTime,
    ]);
    expect(s.archives[0]).toMatchObject({ name: archive(0).name, sizeBytes: 9_700_000 });
  });

  test("the list is capped, but the COUNT still reports the truth", async () => {
    // A misconfigured folder must not flood the card — while still telling the reader how
    // many are really there.
    mockList.mockResolvedValue(Array.from({ length: 60 }, (_, i) => archive(i, `x${i}`)));
    const s = await backupStatus(NOW);
    expect(s.archives.length).toBe(BACKUP_LIST_LIMIT);
    expect(s.count).toBe(60);
  });

  test("totals the pool so unbounded growth is visible", async () => {
    mockList.mockResolvedValue([archive(0), archive(1)]);
    const s = await backupStatus(NOW);
    expect(s.totalSizeBytes).toBe(19_400_000);
  });

  test("the listing is cached, but the AGE is recomputed", async () => {
    mockList.mockResolvedValue([archive(0)]);
    const first = await backupStatus(NOW);
    expect(first.ageDays).toBe(0);
    // Two days later, without re-listing: the folder has not changed, but its freshness
    // has — a cached "0 days" would keep claiming last night's backup forever.
    const later = await backupStatus(new Date(NOW.getTime() + 2 * 86_400_000));
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(later.ageDays).toBe(2);
    expect(later.band).toBe("warn");
  });
});

// ---------------------------------------------------------------------------
// D-#818 — the hourly pool, banded in hours by where prod lives
// ---------------------------------------------------------------------------

describe("prodDbIsLocal", () => {
  test("the VM's own mongod is local, with or without credentials", () => {
    expect(prodDbIsLocal("mongodb://127.0.0.1:27017/scdhub_prod")).toBe(true);
    expect(prodDbIsLocal("mongodb://scdhub_prod:pw@127.0.0.1:27017/scdhub_prod?authSource=admin&replicaSet=rs0")).toBe(true);
    expect(prodDbIsLocal("mongodb://localhost/scdhub_prod")).toBe(true);
  });

  test("Atlas (and a host that merely CONTAINS 127.0.0.1) is not", () => {
    expect(prodDbIsLocal("mongodb+srv://u:p@cluster0.twe5xqs.mongodb.net/scdhub_prod")).toBe(false);
    expect(prodDbIsLocal("mongodb://u:p@127.0.0.1.evil.example/x")).toBe(false);
    expect(prodDbIsLocal("")).toBe(false);
  });
});

describe("hourlyBackupBand", () => {
  test("on the VM: warn after 2 h, critical after 6 h", () => {
    expect(hourlyBackupBand(true, 1, true)).toBe("ok");
    expect(hourlyBackupBand(true, HOURLY_WARN_HOURS_LOCAL, true)).toBe("warn");
    expect(hourlyBackupBand(true, HOURLY_CRITICAL_HOURS_LOCAL, true)).toBe("critical");
  });

  test("on Atlas the job runs once a day, so a day-old copy is still ok", () => {
    expect(hourlyBackupBand(true, 20, false)).toBe("ok");
    expect(hourlyBackupBand(true, HOURLY_WARN_HOURS_REMOTE, false)).toBe("warn");
    expect(hourlyBackupBand(true, HOURLY_CRITICAL_HOURS_REMOTE, false)).toBe("critical");
  });

  test("no folder / empty folder is critical either way", () => {
    expect(hourlyBackupBand(false, null, true)).toBe("critical");
    expect(hourlyBackupBand(true, null, false)).toBe("critical");
  });
});

describe("hourlyBackupStatus", () => {
  test("lists the hourly folder, reports age in hours, and caches apart from the daily pool", async () => {
    const hourAgo = (h: number, id: string) => ({
      id,
      name: `scdhub_prod-2026-08-01_${String(12 - h).padStart(2, "0")}0501.archive.gz`,
      createdTime: new Date(NOW.getTime() - h * 3_600_000).toISOString(),
      sizeBytes: 50_000_000,
    });
    mockList.mockImplementation(async (name: string) =>
      name === HOURLY_BACKUP_FOLDER ? [hourAgo(3, "h3"), hourAgo(1, "h1")] : [archive(0)],
    );
    const hourly = await hourlyBackupStatus(NOW);
    const daily = await backupStatus(NOW);
    expect(mockList).toHaveBeenCalledWith(HOURLY_BACKUP_FOLDER);
    expect(hourly.folder).toBe(HOURLY_BACKUP_FOLDER);
    expect(hourly.count).toBe(2);
    expect(hourly.ageHours).toBe(1);
    expect(hourly.newestName).toContain("_110501");
    // One folder's cache never answers for the other.
    expect(daily.folder).toBe(BACKUP_FOLDER);
    expect(daily.count).toBe(1);
  });
});
