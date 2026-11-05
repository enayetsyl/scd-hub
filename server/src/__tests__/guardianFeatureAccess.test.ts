/**
 * Guardian release switch (D-#1011).
 *
 *   default   no row → the storybook shelf / activity sheets are OFF for every guardian;
 *             a GUARDIAN caller is refused, staff pass untouched
 *   one       switched on for one guardian → only that login sees it (and is notified)
 *   all       switched on for everyone → every guardian; switching "all" off keeps the chosen list
 *   search    a family is found by guardian name, phone, child's name or school ID (103 = 0103)
 *   card      the all-rounder drops an off feature's area and re-works the overall
 *   who       the switch is PRINCIPAL_DEFAULT: Principal holds it, Office / Teacher do not
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../context";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { Audit } from "../modules/platform/models/Audit";
import { GuardianFeatureAccess } from "../modules/guardian-access/models/GuardianFeatureAccess";
import {
  FEATURE_OFF_BN,
  assertGuardianFeature,
  guardianFeatureAccess,
  guardianFeatureOn,
  guardianFeaturesFor,
  guardiansWithFeature,
  searchGuardians,
  setGuardianFeatureFor,
  setGuardianFeatureForAll,
} from "../modules/guardian-access/services/GuardianFeatureService";
import { resolveShelfViewer } from "../modules/library/services/StorybookService";
import { overallOf, withoutAreas, type AreaScore } from "../modules/trackers/services/AllRounderService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const MODELS = [Class, Section, Student, Guardian, GuardianLink, Audit, GuardianFeatureAccess];
beforeEach(async () => {
  await Promise.all(MODELS.map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
});

const ctxOf = (userId: string, role: string): AppContext => ({ auth: { userId, role } } as unknown as AppContext);
const principalId = new Types.ObjectId().toString();
let seq = 0;

async function family(name: string, schoolId: string) {
  seq += 1;
  const c = await Class.collection.insertOne({ level: 0, nameBn: "কেজি", academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, nameBn: "ক", code: "A", active: true });
  const kid = await Student.collection.insertOne({ schoolId, name, nameBn: `${name} বাংলা`, classId: c.insertedId, sectionId: s.insertedId, active: true });
  const g = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: `0171000000${seq}`, name: `Parent ${name}`, phone: `0171000000${seq}`, loginEnabled: true, active: true });
  await GuardianLink.collection.insertOne({ guardianId: g.insertedId, studentId: kid.insertedId, relation: "mother", active: true });
  return { phone: `0171000000${seq}`, id: g.insertedId.toString(), ctx: ctxOf(g.insertedId.toString(), "GUARDIAN"), kid: kid.insertedId.toString() };
}

describe("default off", () => {
  it("refuses every guardian and lets staff through when no switch row exists", async () => {
    const a = await family("Aisha", "0103");
    expect(await guardianFeatureOn("STORYBOOKS", a.id)).toBe(false);
    expect(await guardianFeaturesFor(a.id)).toEqual([]);
    await expect(assertGuardianFeature(a.ctx, "ACTIVITY_SHEETS")).rejects.toThrow(FEATURE_OFF_BN);
    // The shelf's guardian door is shut too (the link check passes first).
    await expect(resolveShelfViewer(a.ctx, a.kid)).rejects.toThrow(FEATURE_OFF_BN);
    await expect(assertGuardianFeature(ctxOf(principalId, "OFFICE"), "STORYBOOKS")).resolves.toBeUndefined();
    expect(await guardiansWithFeature("STORYBOOKS", [{ _id: new Types.ObjectId(a.id) }])).toEqual([]);
  });
});

describe("chosen guardians and everyone", () => {
  it("switches one guardian on, then everyone, and keeps the chosen list when everyone goes off", async () => {
    const a = await family("Aisha", "0103");
    const b = await family("Bilal", "0104");

    const v = await setGuardianFeatureFor("STORYBOOKS", a.id, true, principalId);
    expect(v.onForAll).toBe(false);
    expect(v.guardians.map((g) => g.guardianId)).toEqual([a.id]);
    expect(v.guardians[0].childrenText).toBe("Aisha বাংলা (কেজি ক)");
    expect(await guardianFeaturesFor(a.id)).toEqual(["STORYBOOKS"]);
    expect(await guardianFeaturesFor(b.id)).toEqual([]);
    await expect(assertGuardianFeature(a.ctx, "STORYBOOKS")).resolves.toBeUndefined();
    await expect(assertGuardianFeature(b.ctx, "STORYBOOKS")).rejects.toThrow(FEATURE_OFF_BN);
    await expect(assertGuardianFeature(a.ctx, "ACTIVITY_SHEETS")).rejects.toThrow(FEATURE_OFF_BN);
    const both = [{ _id: new Types.ObjectId(a.id) }, { _id: new Types.ObjectId(b.id) }];
    expect((await guardiansWithFeature("STORYBOOKS", both)).map((g) => g._id.toString())).toEqual([a.id]);
    await expect(resolveShelfViewer(a.ctx, a.kid)).resolves.toMatchObject({ studentId: a.kid });

    await setGuardianFeatureForAll("STORYBOOKS", true, principalId);
    expect(await guardianFeatureOn("STORYBOOKS", b.id)).toBe(true);
    expect(await guardiansWithFeature("STORYBOOKS", both)).toHaveLength(2);

    const off = await setGuardianFeatureForAll("STORYBOOKS", false, principalId);
    expect(off.onForAll).toBe(false);
    expect(off.guardians.map((g) => g.guardianId)).toEqual([a.id]);
    expect(await guardianFeatureOn("STORYBOOKS", b.id)).toBe(false);

    await setGuardianFeatureFor("STORYBOOKS", a.id, false, principalId);
    expect((await guardianFeatureAccess("STORYBOOKS")).guardians).toEqual([]);
    expect(await Audit.countDocuments({ eventKind: "GUARDIAN_FEATURE_SET" })).toBe(4);
  });

  it("refuses an unknown feature and an unknown guardian", async () => {
    await expect(guardianFeatureAccess("HOMEWORK")).rejects.toThrow(/Unknown guardian feature/);
    await expect(setGuardianFeatureFor("STORYBOOKS", new Types.ObjectId().toString(), true, principalId)).rejects.toThrow("অভিভাবক পাওয়া যায়নি");
  });
});

describe("search", () => {
  it("finds a family by guardian name, phone, child's name and school ID", async () => {
    const a = await family("Aisha", "0103");
    await family("Bilal", "0204");
    expect((await searchGuardians("Parent Ais")).map((g) => g.guardianId)).toEqual([a.id]);
    expect((await searchGuardians("aisha")).map((g) => g.guardianId)).toEqual([a.id]);
    expect((await searchGuardians("103")).map((g) => g.guardianId)).toEqual([a.id]);
    expect((await searchGuardians(a.phone)).map((g) => g.guardianId)).toContain(a.id);
    expect(await searchGuardians("a")).toEqual([]);
  });
});

describe("all-rounder card", () => {
  it("drops an off feature's area and re-works the overall", () => {
    const areas: AreaScore[] = [
      { area: "ATTENDANCE", score: 90, band: "STRONG", value: 90 },
      { area: "HOMEWORK", score: 70, band: "STEADY", value: 70 },
      { area: "READING", score: 20, band: "LOW", value: 1 },
      { area: "ACTIVITY", score: null, band: "NONE", value: null },
    ] as AreaScore[];
    const card = { studentId: "s", areas, ...overallOf(areas) };
    const out = withoutAreas(card, ["READING", "ACTIVITY"]);
    expect(out.areas.map((a) => a.area)).toEqual(["ATTENDANCE", "HOMEWORK"]);
    expect(out.score).toBe(80);
    expect(card.score).toBe(60);
    expect(withoutAreas(card, [])).toBe(card);
  });
});

describe("who may switch", () => {
  it("is the Principal's by default, not Office's or a teacher's", () => {
    for (const perm of ["library:guardian_access", "activity_sheets:guardian_access"] as const) {
      expect(callerHasPermission({ role: "PRINCIPAL" } as never, perm)).toBe(true);
      expect(callerHasPermission({ role: "OFFICE" } as never, perm)).toBe(false);
      expect(callerHasPermission({ role: "TEACHER" } as never, perm)).toBe(false);
      expect(callerHasPermission({ role: "GUARDIAN" } as never, perm)).toBe(false);
    }
  });
});
