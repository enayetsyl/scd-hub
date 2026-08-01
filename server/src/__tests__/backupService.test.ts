/**
 * BackupService (SH-7, D-#416).
 *
 * This is the one part of the health slice that WRITES outside the app — it uploads the
 * whole database to Drive and deletes old files. So the tests are mostly about refusals:
 * it must not run unasked, must not delete more than it should, and must record a failure
 * as loudly as a success (a backup page showing only successes is how a broken job goes
 * unnoticed for months).
 */
const mockCreate = jest.fn();
const mockFindOne = jest.fn();
const mockUpload = jest.fn();
const mockList = jest.fn();
const mockDelete = jest.fn();

jest.mock("../modules/platform/models/BackupRun", () => ({
  BackupRun: {
    create: (d: unknown) => mockCreate(d),
    findOne: (q: unknown) => ({ sort: () => ({ lean: () => mockFindOne(q) }) }),
  },
}));
jest.mock("../modules/platform/services/DriveStore", () => ({
  uploadToDrive: (i: unknown) => mockUpload(i),
  listDriveFolder: (y: unknown, s: unknown) => mockList(y, s),
  deleteFromDrive: (id: unknown) => mockDelete(id),
}));

import {
  runBackup,
  backupStatus,
  backupEnabled,
  pruneOldBackups,
  BACKUP_KEEP,
} from "../modules/platform/services/BackupService";

/** A saveable BackupRun stub. */
const runStub = () => ({ save: jest.fn().mockResolvedValue(undefined) }) as any;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BACKUP_ENABLED;
  mockCreate.mockImplementation(() => Promise.resolve(runStub()));
  mockFindOne.mockResolvedValue(null);
  mockList.mockResolvedValue([]);
});

describe("the enable gate", () => {
  test("off unless explicitly switched on", () => {
    expect(backupEnabled()).toBe(false);
    process.env.BACKUP_ENABLED = "true"; // only "1" counts — no truthy-string surprises
    expect(backupEnabled()).toBe(false);
    process.env.BACKUP_ENABLED = "1";
    expect(backupEnabled()).toBe(true);
  });

  test("a disabled run uploads NOTHING and records why", async () => {
    const run = runStub();
    mockCreate.mockResolvedValue(run);
    const out = await runBackup(new Date(2026, 7, 1));
    expect(mockUpload).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not enabled/);
    // Recorded, not swallowed: the panel must be able to say a run was attempted.
    expect(run.save).toHaveBeenCalled();
  });

  test("enabled but with no database connection still refuses, and says so", async () => {
    process.env.BACKUP_ENABLED = "1";
    const run = runStub();
    mockCreate.mockResolvedValue(run);
    const out = await runBackup(new Date(2026, 7, 1));
    expect(mockUpload).not.toHaveBeenCalled();
    expect(out.error).toMatch(/connection/i);
  });
});

describe("backupStatus — freshness the panel can trust", () => {
  test("reports 'never' when nothing has run", async () => {
    const s = await backupStatus();
    expect(s).toMatchObject({ enabled: false, lastRunAt: null, ageDays: null });
  });
});

describe("pruneOldBackups — retention must not eat the restore points", () => {
  test(`keeps the newest ${BACKUP_KEEP} and deletes only beyond them`, async () => {
    const files = Array.from({ length: 7 }, (_, i) => ({
      id: `f${i}`,
      name: `scdhub-prod-2026-07-${String(i + 1).padStart(2, "0")}.ndjson.gz`,
      createdTime: `2026-07-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      sizeBytes: 100,
    }));
    mockList.mockResolvedValue(files);
    const removed = await pruneOldBackups("2026");
    expect(removed).toBe(3);
    // The three OLDEST go; the four newest survive.
    expect(mockDelete.mock.calls.map((c) => c[0]).sort()).toEqual(["f0", "f1", "f2"]);
  });

  test("touches nothing that is not a backup file", async () => {
    // The folder is ours, but a stray file must never be collateral: only the exact
    // artefact this job creates is eligible for deletion.
    mockList.mockResolvedValue([
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `b${i}`,
        name: `scdhub-prod-2026-07-0${i + 1}.ndjson.gz`,
        createdTime: `2026-07-0${i + 1}T00:00:00Z`,
        sizeBytes: 1,
      })),
      { id: "keep-me", name: "notes.txt", createdTime: "2020-01-01T00:00:00Z", sizeBytes: 1 },
    ]);
    await pruneOldBackups("2026");
    expect(mockDelete.mock.calls.map((c) => c[0])).not.toContain("keep-me");
  });

  test("does nothing when there are fewer files than the retention count", async () => {
    mockList.mockResolvedValue([
      { id: "a", name: "scdhub-prod-2026-07-01.ndjson.gz", createdTime: "2026-07-01T00:00:00Z", sizeBytes: 1 },
    ]);
    expect(await pruneOldBackups("2026")).toBe(0);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
