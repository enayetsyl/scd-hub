/**
 * D-#920 — own sidebar arrangement.
 *
 *   read     defaults before anything is saved
 *   save     mode / order / favourites round-trip; duplicates dropped; a bad key or mode
 *            refused with a sentence; too many keys refused
 *   owner    a staff User and a Guardian with the SAME ObjectId keep separate rows
 *   view-as  a borrowed session reads the borrowed arrangement but cannot save, reset,
 *            or count taps
 *   usage    taps count per key; a bad key is ignored; past the ceiling every count halves
 *   reset    forgets order, favourites and counts
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { NavPreference } from "../modules/platform/models/NavPreference";
import {
  NavPreferenceError,
  getNavPreference,
  recordNavUse,
  resetNavPreference,
  saveNavPreference,
} from "../modules/platform/services/NavPreferenceService";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await NavPreference.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await NavPreference.deleteMany({});
});

const ctxOf = (userId: string, role: string, extra: Record<string, unknown> = {}): AppContext =>
  ({ auth: { userId, role, ...extra } } as unknown as AppContext);

const counts = (v: { usage: Array<{ key: string; count: number }> }): Record<string, number> =>
  Object.fromEntries(v.usage.map((u) => [u.key, u.count]));

describe("NavPreference (D-#920)", () => {
  const id = new Types.ObjectId().toString();
  const teacher = ctxOf(id, "TEACHER");

  it("reads the defaults before anything is saved", async () => {
    expect(await getNavPreference(teacher)).toEqual({ mode: "manual", order: [], pinned: [], usage: [] });
  });

  it("saves mode, order and favourites, dropping duplicates", async () => {
    const saved = await saveNavPreference(teacher, {
      mode: "auto",
      order: ["g:drawerGroupReports", "HomeTab:", "HomeTab:"],
      pinned: ["ReportsTab:ClassTestDashboard", "AttendanceTab:"],
    });
    expect(saved.mode).toBe("auto");
    expect(saved.order).toEqual(["g:drawerGroupReports", "HomeTab:"]);
    expect(saved.pinned).toEqual(["ReportsTab:ClassTestDashboard", "AttendanceTab:"]);
    expect(await getNavPreference(teacher)).toMatchObject({ mode: "auto", order: saved.order, pinned: saved.pinned });
  });

  it("refuses a bad key, an unknown mode, and too many keys with a sentence", async () => {
    await expect(saveNavPreference(teacher, { mode: "manual", order: ["usage.$x"], pinned: [] })).rejects.toBeInstanceOf(
      NavPreferenceError,
    );
    await expect(saveNavPreference(teacher, { mode: "sideways", order: [], pinned: [] })).rejects.toThrow(
      "Unknown sidebar mode",
    );
    const many = Array.from({ length: 121 }, (_, i) => `Tab${i}:`);
    await expect(saveNavPreference(teacher, { mode: "manual", order: many, pinned: [] })).rejects.toThrow(/Too many/);
  });

  it("keeps a staff account and a guardian with the same id apart", async () => {
    const guardian = ctxOf(id, "GUARDIAN");
    await saveNavPreference(teacher, { mode: "manual", order: ["HomeTab:"], pinned: [] });
    await saveNavPreference(guardian, { mode: "auto", order: ["GuardianHomeTab:"], pinned: [] });
    expect((await getNavPreference(teacher)).order).toEqual(["HomeTab:"]);
    expect((await getNavPreference(guardian)).order).toEqual(["GuardianHomeTab:"]);
    expect(await NavPreference.countDocuments({})).toBe(2);
  });

  it("lets a View-as session read but never write the borrowed sidebar", async () => {
    await saveNavPreference(teacher, { mode: "manual", order: ["HomeTab:"], pinned: ["AttendanceTab:"] });
    const borrowed = ctxOf(id, "TEACHER", { impersonatorId: new Types.ObjectId().toString() });
    expect((await getNavPreference(borrowed)).pinned).toEqual(["AttendanceTab:"]);
    await expect(saveNavPreference(borrowed, { mode: "auto", order: [], pinned: [] })).rejects.toBeInstanceOf(
      NavPreferenceError,
    );
    await expect(resetNavPreference(borrowed)).rejects.toBeInstanceOf(NavPreferenceError);
    expect(await recordNavUse(borrowed, "HomeTab:")).toBe(false);
    expect(await getNavPreference(teacher)).toMatchObject({ mode: "manual", order: ["HomeTab:"], usage: [] });
  });

  it("counts taps per key, ignores a bad key, and keeps the saved arrangement", async () => {
    await saveNavPreference(teacher, { mode: "auto", order: ["HomeTab:"], pinned: [] });
    await recordNavUse(teacher, "AttendanceTab:");
    await recordNavUse(teacher, "AttendanceTab:");
    await recordNavUse(teacher, "ReportsTab:ClassTestDashboard");
    expect(await recordNavUse(teacher, "$where:1")).toBe(false);
    const v = await getNavPreference(teacher);
    expect(counts(v)).toEqual({ "AttendanceTab:": 2, "ReportsTab:ClassTestDashboard": 1 });
    expect(v).toMatchObject({ mode: "auto", order: ["HomeTab:"] });
  });

  it("starts a row on the first tap with manual mode", async () => {
    await recordNavUse(teacher, "HomeTab:");
    expect(await getNavPreference(teacher)).toMatchObject({ mode: "manual", order: [], pinned: [], usage: [{ key: "HomeTab:", count: 1 }] });
  });

  it("halves every count once one passes the ceiling, so recent use wins", async () => {
    await NavPreference.create({
      ownerKind: "USER",
      ownerId: new Types.ObjectId(id),
      usage: { "HomeTab:": 500, "AttendanceTab:": 40, "LibraryTab:": 1 },
    });
    await recordNavUse(teacher, "HomeTab:");
    expect(counts(await getNavPreference(teacher))).toEqual({ "HomeTab:": 250, "AttendanceTab:": 20 });
  });

  it("reset forgets the order, favourites and counts", async () => {
    await saveNavPreference(teacher, { mode: "auto", order: ["HomeTab:"], pinned: ["AttendanceTab:"] });
    await recordNavUse(teacher, "AttendanceTab:");
    expect(await resetNavPreference(teacher)).toEqual({ mode: "manual", order: [], pinned: [], usage: [] });
    expect(await getNavPreference(teacher)).toEqual({ mode: "manual", order: [], pinned: [], usage: [] });
  });
});
