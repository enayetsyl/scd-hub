/**
 * GH-4 session home guides (docs/prd-guardian-help.md §5; D-#1523/#1527) — the loader.
 *
 *  - the file check refuses an unknown subject / class token, steps not 5–7, empty text and missing
 *    classworkItems, and a repeated address
 *  - a dry run (the default) writes nothing; a bad file writes nothing either way
 *  - an import upserts by (classToken, subject, chapter, sessionIndex): re-running an identical file
 *    changes nothing, a changed guide bumps its version
 *  - the permission gate: only the Principal holds home_guide:import
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { roleHasPermission, type Permission } from "@scd/shared";
import { SessionHomeGuide } from "../modules/lesson-progress/models/SessionHomeGuide";
import { checkSessionHomeGuides, guidesForSessions, importSessionHomeGuides } from "../modules/lesson-progress/services/HomeGuideService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const ACTOR = String(new Types.ObjectId());

const guide = (over: Record<string, unknown> = {}) => ({
  classToken: "C1",
  subject: "BAN",
  chapter: 13,
  sessionIndex: 1,
  steps: ["এক", "দুই", "তিন", "চার", "পাঁচ"],
  classworkItems: [{ label: "অনুশীলনী ক", textBn: "১ থেকে ৩" }],
  homeTimeMin: 15,
  ...over,
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await SessionHomeGuide.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await SessionHomeGuide.deleteMany({});
});

describe("home guide file check", () => {
  it("accepts a well-formed pack (object or JSON text)", () => {
    expect(checkSessionHomeGuides({ guides: [guide()] }).errors).toEqual([]);
    expect(checkSessionHomeGuides(JSON.stringify({ guides: [guide(), guide({ sessionIndex: 2 })] })).guides).toHaveLength(2);
    expect(checkSessionHomeGuides({ guides: [guide({ steps: ["১", "২", "৩", "৪", "৫", "৬", "৭"] })] }).errors).toEqual([]);
  });

  it("refuses an unknown subject or class token", () => {
    expect(checkSessionHomeGuides({ guides: [guide({ subject: "QURAN" })] }).errors.join()).toMatch(/unknown subject/);
    expect(checkSessionHomeGuides({ guides: [guide({ subject: "XYZ" })] }).errors.join()).toMatch(/unknown subject/);
    expect(checkSessionHomeGuides({ guides: [guide({ classToken: "C9" })] }).errors.join()).toMatch(/unknown classToken/);
  });

  it("refuses steps outside 5–7, an empty step, and missing classworkItems", () => {
    expect(checkSessionHomeGuides({ guides: [guide({ steps: ["১", "২", "৩", "৪"] })] }).errors.join()).toMatch(/steps must be 5–7/);
    expect(checkSessionHomeGuides({ guides: [guide({ steps: Array(8).fill("ক") })] }).errors.join()).toMatch(/steps must be 5–7/);
    expect(checkSessionHomeGuides({ guides: [guide({ steps: ["১", "২", "  ", "৪", "৫"] })] }).errors.join()).toMatch(/a step is empty/);
    expect(checkSessionHomeGuides({ guides: [guide({ classworkItems: undefined })] }).errors.join()).toMatch(/classworkItems is missing/);
    expect(checkSessionHomeGuides({ guides: [guide({ classworkItems: [{ label: "ক", textBn: "" }] })] }).errors.join()).toMatch(/label and a text/);
  });

  it("refuses bad numbers, a repeated address, an empty file and bad JSON", () => {
    expect(checkSessionHomeGuides({ guides: [guide({ chapter: 0 })] }).errors.join()).toMatch(/chapter/);
    expect(checkSessionHomeGuides({ guides: [guide({ homeTimeMin: 90 })] }).errors.join()).toMatch(/homeTimeMin/);
    expect(checkSessionHomeGuides({ guides: [guide(), guide()] }).errors.join()).toMatch(/appears twice/);
    expect(checkSessionHomeGuides({ guides: [] }).errors).toHaveLength(1);
    expect(checkSessionHomeGuides("{nope").errors).toEqual(["the file is not valid JSON"]);
  });
});

describe("home guide import (DB)", () => {
  it("a dry run (the default) reports the counts and writes nothing", async () => {
    const r = await importSessionHomeGuides({ guides: [guide(), guide({ sessionIndex: 2 })] }, ACTOR);
    expect(r).toMatchObject({ dryRun: true, total: 2, created: 2, updated: 0, unchanged: 0, errors: [] });
    expect(await SessionHomeGuide.countDocuments()).toBe(0);
  });

  it("a bad file writes nothing, even with dryRun off, and nothing from the good guides in it", async () => {
    const r = await importSessionHomeGuides({ guides: [guide(), guide({ sessionIndex: 2, steps: ["x"] })] }, ACTOR, { dryRun: false });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(await SessionHomeGuide.countDocuments()).toBe(0);
  });

  it("upserts by address: a re-run changes nothing, an edit bumps the version", async () => {
    const pack = { guides: [guide(), guide({ sessionIndex: 2 })] };
    expect(await importSessionHomeGuides(pack, ACTOR, { dryRun: false })).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    expect(await importSessionHomeGuides(pack, ACTOR, { dryRun: false })).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(await SessionHomeGuide.countDocuments()).toBe(2);

    const edited = { guides: [guide({ steps: ["এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়"], homeTimeMin: 10 }), guide({ sessionIndex: 2 })] };
    const dry = await importSessionHomeGuides(edited, ACTOR);
    expect(dry).toMatchObject({ dryRun: true, updated: 1, unchanged: 1 });
    expect((await SessionHomeGuide.findOne({ sessionIndex: 1 }))!.version).toBe(1); // the dry run did not write
    expect(await importSessionHomeGuides(edited, ACTOR, { dryRun: false })).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    const row = await SessionHomeGuide.findOne({ sessionIndex: 1 }).lean();
    expect(row).toMatchObject({ version: 2, homeTimeMin: 10 });
    expect(row!.steps).toHaveLength(6);
    expect((await SessionHomeGuide.findOne({ sessionIndex: 2 }).lean())!.version).toBe(1);
  });

  it("the guardian read finds a guide by class level x subject x chapter:session", async () => {
    await importSessionHomeGuides({ guides: [guide()] }, ACTOR, { dryRun: false });
    const hit = await guidesForSessions(1, "BAN", [{ chapter: "13", sessionIndex: 1 }, { chapter: "13", sessionIndex: 2 }]);
    expect([...hit.keys()]).toEqual(["13:1"]);
    expect(hit.get("13:1")).toMatchObject({ homeTimeMin: 15, steps: ["এক", "দুই", "তিন", "চার", "পাঁচ"] });
    expect((await guidesForSessions(2, "BAN", [{ chapter: "13", sessionIndex: 1 }])).size).toBe(0); // another class level
    expect((await guidesForSessions(1, "MATH", [{ chapter: "13", sessionIndex: 1 }])).size).toBe(0); // another subject
  });
});

describe("home_guide:import permission", () => {
  it("is held by the Principal only", () => {
    const perm = "home_guide:import" as Permission;
    expect(roleHasPermission("PRINCIPAL", perm)).toBe(true);
    expect(roleHasPermission("OFFICE", perm)).toBe(false);
    expect(roleHasPermission("TEACHER", perm)).toBe(false);
    expect(roleHasPermission("GUARDIAN", perm)).toBe(false);
  });
});
