/**
 * AcademicPauseService (D-#1655) — the window store: validation, inclusive boundaries on
 * Asia/Dhaka day keys, kind independence, delete. In-memory MongoDB, real service.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  createPause,
  updatePause,
  deletePause,
  listPauses,
  isPausedOn,
  isPausedNow,
  isPausedOnDate,
  loadPausePredicate,
} from "../modules/academic-pause/services/AcademicPauseService";
import { AcademicPause } from "../modules/academic-pause/models/AcademicPause";

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await AcademicPause.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await AcademicPause.deleteMany({});
});

const exam = {
  fromKey: "2026-12-01",
  toKey: "2026-12-10",
  label: "Annual exam",
  pauses: ["CLASS_NOTE_CHASE", "HOMEWORK_REQUIRED"],
};

describe("window store", () => {
  it("rejects bad dates, reversed ranges, blank labels, empty and unknown kinds", async () => {
    await expect(createPause({ ...exam, fromKey: "2026-13-01" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(createPause({ ...exam, fromKey: "2026-12-11" })).rejects.toThrow(/on or before/);
    await expect(createPause({ ...exam, label: "  " })).rejects.toThrow(/label/);
    await expect(createPause({ ...exam, pauses: [] })).rejects.toThrow(/at least one/);
    await expect(createPause({ ...exam, pauses: ["NOPE"] })).rejects.toThrow(/Unknown pause kind/);
  });

  it("an empty toKey means a one-day window", async () => {
    const p = await createPause({ ...exam, fromKey: "2026-12-03", toKey: "" });
    expect(p.toKey).toBe("2026-12-03");
  });

  it("update edits in place; delete removes the window", async () => {
    const p = await createPause(exam);
    const u = await updatePause(p._id.toString(), { ...exam, toKey: "2026-12-12", pauses: ["ASSIGNMENT_CHASE"] });
    expect(u.toKey).toBe("2026-12-12");
    expect(await isPausedOn("ASSIGNMENT_CHASE", "2026-12-12")).toBe(true);
    expect(await isPausedOn("CLASS_NOTE_CHASE", "2026-12-05")).toBe(false);
    expect(await deletePause(p._id.toString())).toBe(true);
    expect(await listPauses()).toHaveLength(0);
    expect(await isPausedOn("ASSIGNMENT_CHASE", "2026-12-05")).toBe(false);
  });
});

describe("boundaries (inclusive, Asia/Dhaka day keys)", () => {
  beforeEach(async () => {
    await createPause(exam);
  });

  it("first and last day are inside; the day before and after are outside", async () => {
    expect(await isPausedOn("CLASS_NOTE_CHASE", "2026-11-30")).toBe(false);
    expect(await isPausedOn("CLASS_NOTE_CHASE", "2026-12-01")).toBe(true);
    expect(await isPausedOn("CLASS_NOTE_CHASE", "2026-12-10")).toBe(true);
    expect(await isPausedOn("CLASS_NOTE_CHASE", "2026-12-11")).toBe(false);
  });

  it("only the chosen kinds are paused", async () => {
    expect(await isPausedOn("HOMEWORK_REQUIRED", "2026-12-05")).toBe(true);
    expect(await isPausedOn("ASSIGNMENT_GENERATION", "2026-12-05")).toBe(false);
    expect(await isPausedOn("ASSIGNMENT_CHASE", "2026-12-05")).toBe(false);
  });

  it("an instant is judged on its DHAKA day, not UTC", async () => {
    // 2026-11-30 18:00Z = 2026-12-01 00:00 Dhaka -> inside; one second earlier -> outside.
    expect(await isPausedNow("CLASS_NOTE_CHASE", new Date("2026-11-30T18:00:00Z"))).toBe(true);
    expect(await isPausedNow("CLASS_NOTE_CHASE", new Date("2026-11-30T17:59:59Z"))).toBe(false);
    // 2026-12-10 17:59:59Z = 23:59:59 Dhaka on the last day -> inside; 18:00Z = 11 Dec -> outside.
    expect(await isPausedNow("CLASS_NOTE_CHASE", new Date("2026-12-10T17:59:59Z"))).toBe(true);
    expect(await isPausedNow("CLASS_NOTE_CHASE", new Date("2026-12-10T18:00:00Z"))).toBe(false);
  });

  it("a school-local midnight date resolves by its own calendar day", async () => {
    expect(await isPausedOnDate("CLASS_NOTE_CHASE", new Date(2026, 11, 1))).toBe(true);
    expect(await isPausedOnDate("CLASS_NOTE_CHASE", new Date(2026, 10, 30))).toBe(false);
  });

  it("the range predicate agrees with the single-day check", async () => {
    const p = await loadPausePredicate("2026-11-28", "2026-12-12");
    expect(p("CLASS_NOTE_CHASE", "2026-11-30")).toBe(false);
    expect(p("CLASS_NOTE_CHASE", "2026-12-01")).toBe(true);
    expect(p("CLASS_NOTE_CHASE", "2026-12-10")).toBe(true);
    expect(p("CLASS_NOTE_CHASE", "2026-12-11")).toBe(false);
    expect(p("ASSIGNMENT_CHASE", "2026-12-05")).toBe(false);
  });
});

describe("the school's two windows", () => {
  it("26-30 Nov: assignments + homework; 1-10 Dec adds class-note chasers", async () => {
    await createPause({
      fromKey: "2026-11-26",
      toKey: "2026-11-30",
      label: "A",
      pauses: ["ASSIGNMENT_GENERATION", "ASSIGNMENT_CHASE", "HOMEWORK_REQUIRED"],
    });
    await createPause({
      fromKey: "2026-12-01",
      toKey: "2026-12-10",
      label: "B",
      pauses: ["ASSIGNMENT_GENERATION", "ASSIGNMENT_CHASE", "HOMEWORK_REQUIRED", "CLASS_NOTE_CHASE"],
    });
    expect(await isPausedOn("ASSIGNMENT_GENERATION", "2026-11-25")).toBe(false);
    expect(await isPausedOn("ASSIGNMENT_GENERATION", "2026-11-26")).toBe(true);
    expect(await isPausedOn("CLASS_NOTE_CHASE", "2026-11-30")).toBe(false);
    expect(await isPausedOn("CLASS_NOTE_CHASE", "2026-12-01")).toBe(true);
    expect(await isPausedOn("HOMEWORK_REQUIRED", "2026-12-10")).toBe(true);
    expect(await isPausedOn("HOMEWORK_REQUIRED", "2026-12-11")).toBe(false);
  });
});
