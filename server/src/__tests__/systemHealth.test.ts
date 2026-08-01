/**
 * SystemHealthService (SH-1..SH-3, D-#414).
 *
 * The interesting logic is NOT "read a number" — it is the egress arithmetic, where the
 * counters are cumulative since boot and a reboot silently resets them. A naive sum would
 * either double-count or go negative, so those paths are pinned here alongside the bands
 * and the fail-soft posture every probe promises.
 */
import mongoose from "mongoose";
import { NetSnapshot } from "../modules/platform/models/NetSnapshot";

jest.mock("../modules/platform/models/NetSnapshot", () => ({
  NetSnapshot: {
    find: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock("../modules/platform/services/DriveStore", () => ({
  driveQuota: jest.fn(),
  DriveUnavailableError: class extends Error {},
}));

import {
  bandFor,
  egressForMonth,
  atlasLimitBytes,
  egressLimitBytes,
  driveHealth,
  resetDriveCache,
  hostHealth,
  captureNetSnapshot,
  ATLAS_M0_LIMIT_BYTES,
  DRIVE_DEFAULT_LIMIT_BYTES,
  WARN_RATIO,
  CRITICAL_RATIO,
} from "../modules/platform/services/SystemHealthService";
import { driveQuota } from "../modules/platform/services/DriveStore";

const mockDriveQuota = driveQuota as jest.MockedFunction<typeof driveQuota>;
const mockFind = NetSnapshot.find as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  resetDriveCache();
  delete process.env.ATLAS_STORAGE_LIMIT_MB;
  delete process.env.VM_EGRESS_LIMIT_GB;
  delete process.env.DRIVE_LIMIT_GB;
  mockFind.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
});

describe("bandFor — when the Principal should be told", () => {
  test("bands at 70% and 85%", () => {
    expect(bandFor(10, 100)).toBe("ok");
    expect(bandFor(WARN_RATIO * 100, 100)).toBe("warn");
    expect(bandFor(CRITICAL_RATIO * 100, 100)).toBe("critical");
    expect(bandFor(200, 100)).toBe("critical"); // over the limit is not "ok" again
  });

  test("no limit means UNKNOWN, never a false all-clear", () => {
    // A Workspace account can report no quota at all; showing "healthy" off a missing
    // denominator would be a lie, and 0 would divide into Infinity.
    expect(bandFor(500, null)).toBe("unknown");
    expect(bandFor(500, 0)).toBe("unknown");
  });
});

describe("limits", () => {
  test("Atlas M0 is 512 MB by default and overridable when the plan changes", () => {
    expect(atlasLimitBytes()).toBe(ATLAS_M0_LIMIT_BYTES);
    expect(ATLAS_M0_LIMIT_BYTES).toBe(536870912);
    process.env.ATLAS_STORAGE_LIMIT_MB = "2048";
    expect(atlasLimitBytes()).toBe(2048 * 1024 * 1024);
  });

  test("a nonsense override falls back rather than producing a divide-by-zero bar", () => {
    process.env.ATLAS_STORAGE_LIMIT_MB = "0";
    expect(atlasLimitBytes()).toBe(ATLAS_M0_LIMIT_BYTES);
    process.env.VM_EGRESS_LIMIT_GB = "not-a-number";
    expect(egressLimitBytes()).toBe(10 * 1024 ** 4);
  });
});

describe("egressForMonth — cumulative counters into a monthly figure", () => {
  test("sums day-to-day deltas, not the raw counters", () => {
    const snaps = [
      { dateKey: "2026-08-01", txBytes: 1000 },
      { dateKey: "2026-08-02", txBytes: 1500 },
      { dateKey: "2026-08-03", txBytes: 2200 },
    ];
    // 500 + 700 — NOT 1500 + 2200, which is the bug this test exists to prevent.
    expect(egressForMonth(snaps, "2026-08")).toEqual({ bytes: 1200, partial: false });
  });

  test("a single snapshot yields null — one reading cannot be a delta", () => {
    expect(egressForMonth([{ dateKey: "2026-08-01", txBytes: 1000 }], "2026-08")).toEqual({
      bytes: null,
      partial: false,
    });
    expect(egressForMonth([], "2026-08")).toEqual({ bytes: null, partial: false });
  });

  test("a REBOOT (counter goes backwards) counts the raw figure and flags partial", () => {
    const snaps = [
      { dateKey: "2026-08-01", txBytes: 5000 },
      { dateKey: "2026-08-02", txBytes: 300 }, // rebooted: counters restarted from zero
      { dateKey: "2026-08-03", txBytes: 900 },
    ];
    // 300 (everything since the reboot) + 600. Never negative, and the caller is told the
    // traffic between the last snapshot and the reboot is unrecoverable.
    expect(egressForMonth(snaps, "2026-08")).toEqual({ bytes: 900, partial: true });
  });

  test("the month boundary uses the PREVIOUS day as the baseline", () => {
    const snaps = [
      { dateKey: "2026-07-31", txBytes: 1000 },
      { dateKey: "2026-08-01", txBytes: 1400 },
      { dateKey: "2026-08-02", txBytes: 1500 },
    ];
    // 400 falls on Aug 1 even though its baseline is a July row — otherwise the first day
    // of every month would be invisible.
    expect(egressForMonth(snaps, "2026-08")).toEqual({ bytes: 500, partial: false });
    // ...and July's own figure does not absorb August.
    expect(egressForMonth(snaps, "2026-07")).toEqual({ bytes: null, partial: false });
  });

  test("out-of-order rows are sorted before differencing", () => {
    const snaps = [
      { dateKey: "2026-08-03", txBytes: 2200 },
      { dateKey: "2026-08-01", txBytes: 1000 },
      { dateKey: "2026-08-02", txBytes: 1500 },
    ];
    expect(egressForMonth(snaps, "2026-08")).toEqual({ bytes: 1200, partial: false });
  });
});

describe("driveHealth — a network probe that must never take the panel down", () => {
  test("reports FILES-IN-DRIVE against the configured limit, not Google's two other numbers", async () => {
    // The live account is exactly this shape: `usage` spans all Google services (~1.3 TB)
    // and `limit` is the 100 TiB pooled sentinel, while the Drive page a person actually
    // looks at shows usageInDrive against 100 GB. Reading the API pair put the card at
    // 1.3% "Healthy" when the truth was ~52% — so the card must take usageInDrive.
    mockDriveQuota.mockResolvedValue({
      usageBytes: 1_431_033_212_452,
      usageInDriveBytes: 55_376_267_326,
      usageInDriveTrashBytes: 12_465_802_130,
      limitBytes: 109_951_162_777_600,
    });
    const d = await driveHealth();
    expect(d.usageBytes).toBe(55_376_267_326);
    expect(d.limitBytes).toBe(DRIVE_DEFAULT_LIMIT_BYTES);
    expect(d.usageAllServicesBytes).toBe(1_431_033_212_452);
    expect(d.usageTrashBytes).toBe(12_465_802_130); // reclaimable, so shown separately
    // 51.6 GiB of 100 GiB — past the 70% warn line? No: this is the real position.
    expect(d.band).toBe("ok");
    expect(d.error).toBeNull();
  });

  test("the limit is configurable, because Google's cannot be trusted here", async () => {
    process.env.DRIVE_LIMIT_GB = "200";
    mockDriveQuota.mockResolvedValue({
      usageBytes: 10,
      usageInDriveBytes: 10,
      usageInDriveTrashBytes: 0,
      limitBytes: 109_951_162_777_600,
    });
    expect((await driveHealth()).limitBytes).toBe(200 * 1024 ** 3);
    delete process.env.DRIVE_LIMIT_GB;
  });

  test("an unreachable Drive degrades to an error string, not a thrown query", async () => {
    mockDriveQuota.mockRejectedValue(new Error("Drive token refresh failed: HTTP 401"));
    const d = await driveHealth();
    expect(d.error).toMatch(/401/);
    expect(d.band).toBe("unknown");
    expect(d.usageBytes).toBeNull();
  });

  test("the answer is cached — the panel may be refreshed without hammering Google", async () => {
    mockDriveQuota.mockResolvedValue({ usageBytes: 1, usageInDriveBytes: 1, usageInDriveTrashBytes: 0, limitBytes: 10 });
    await driveHealth();
    await driveHealth();
    expect(mockDriveQuota).toHaveBeenCalledTimes(1);
  });
});

describe("captureNetSnapshot — must never stall the ticker", () => {
  test("writes nothing when the DB is not connected", async () => {
    // The regression CI caught: /proc/net/dev EXISTS on Linux, so without this guard the
    // capture reached mongoose, buffered for 10s and threw — 10s of dead time on every
    // scheduler pass, and six timed-out tests in the scheduler suite. readyState is 0 in
    // this suite (nothing is connected), which is exactly the production startup case.
    expect(mongoose.connection.readyState).not.toBe(1);
    await expect(captureNetSnapshot(new Date(2026, 7, 15))).resolves.toBe(false);
    expect(NetSnapshot.updateOne).not.toHaveBeenCalled();
  });
});

describe("hostHealth — always answers, even where the probes do not exist", () => {
  test("returns memory/load/cpu and leaves egress unknown with no snapshots", async () => {
    const h = await hostHealth(new Date(2026, 7, 15));
    expect(h.memTotalBytes).toBeGreaterThan(0);
    expect(h.cpuCount).toBeGreaterThan(0);
    expect(h.egressMonthBytes).toBeNull();
    expect(h.egressBand).toBe("unknown");
  });

  test("a failing snapshot read does not lose the disk and memory numbers", async () => {
    mockFind.mockReturnValue({ sort: () => ({ lean: () => Promise.reject(new Error("no perms")) }) });
    const h = await hostHealth(new Date(2026, 7, 15));
    expect(h.memTotalBytes).toBeGreaterThan(0);
    expect(h.error).toMatch(/no perms/);
  });

  test("month-to-date egress comes from the snapshots for THIS month", async () => {
    mockFind.mockReturnValue({
      sort: () => ({
        lean: () =>
          Promise.resolve([
            { dateKey: "2026-08-14", txBytes: 1_000_000 },
            { dateKey: "2026-08-15", txBytes: 3_000_000 },
          ]),
      }),
    });
    const h = await hostHealth(new Date(2026, 7, 15));
    expect(h.egressMonthBytes).toBe(2_000_000);
    expect(h.egressBand).toBe("ok");
  });
});
