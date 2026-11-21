/**
 * AL-2 - the dev-copy mask script (docs/prd-academic-loop-2027.md section 9.2, D-#1677).
 *
 *   guard    refuses a non-`_dev` DB name, an open outgoing guard, a prod-equal URI, a missing password
 *   mask     after --apply no real phone / email / address / NID / bank / pay value survives (residue 0), names
 *            are kept, unique indexes hold, every passwordHash is replaced, a shared phone stays shared
 *   wipe     operational rows + @mastery.test users are removed; dry run writes nothing
 *   lists    every copy / wipe model name resolves to a registered model (future ones tolerated)
 * In-memory Mongo only; never a real database.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { Guardian } from "../modules/foundation/models/Guardian";
import { StaffProfile } from "../modules/foundation/models/StaffProfile";
import { Student } from "../modules/foundation/models/Student";
import { ClassNote } from "../modules/routine/models/ClassNote";
import { Notification } from "../modules/notifications/models/Notification";
import { assertDevTarget, DevGuardError, uriIdentity } from "../lib/devData/guards";
import { COPY_MODELS, FAKE_BASE_MODELS, WIPE_MODELS, loadAllModels, nsIncludeFlags, resolveCollections } from "../lib/devData/collections";
import { FAKE_EMAIL_RE, FAKE_PHONE_RE, runMask } from "../lib/devData/devMask";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const OLD_HASH = "$2a$10$abcdefghijklmnopqrstuvabcdefghijklmnopqrstuvabcdefghi";
const PW = "shared-test-password";
const cid = () => new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  mongoose.set("autoIndex", false);
  await mongoose.connect(mongo.getUri("scdtest_dev"));
  loadAllModels();
  // Unique indexes matter here (User.phone / email sparse-unique): build them for the models under test.
  await Promise.all(([User, Guardian, StaffProfile, Student] as unknown as mongoose.Model<unknown>[]).map((m) => m.createIndexes()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function seed(): Promise<void> {
  await Promise.all(([User, Guardian, StaffProfile, Student, ClassNote, Notification] as unknown as mongoose.Model<unknown>[]).map((m) => m.deleteMany({})));
  await User.collection.insertMany([
    { role: "TEACHER", name: "Teacher One", phone: "01711111111", email: "t1@school.example", passwordHash: OLD_HASH, active: true },
    { role: "TEACHER", name: "Teacher Two", phone: "01722222222", passwordHash: OLD_HASH, active: true },
    { role: "OFFICE", name: "Office", email: "office@school.example", passwordHash: OLD_HASH, active: true },
    { role: "TEACHER", name: "Mastery Seed", email: "seed@mastery.test", passwordHash: OLD_HASH, active: true },
  ]);
  await StaffProfile.collection.insertMany([
    {
      schoolId: "ST-1", name: "Teacher One", category: "teacher", employmentType: "full_time", employmentStatus: "confirmed",
      phone: "01711111111", whatsapp: "01733333333", email: "t1@school.example", presentAddress: "House 1, Road 2",
      permanentAddress: "Village X", nid: "1234567890", bankAccount: "000111222", bankAccountName: "T One", bankName: "Some Bank",
      bankBranch: "Main", routingNo: "123456789", monthlySalary: 20000, paymentMethod: "bank", active: true,
    },
    { schoolId: "ST-2", name: "Teacher Two", category: "teacher", phone: "01722222222", active: true },
  ]);
  const gId = cid();
  await Guardian.collection.insertMany([
    { _id: gId, identifierKind: "phone", identifier: "01811111111", phone: "01811111111", name: "Guardian A", loginEnabled: true, passwordHash: OLD_HASH, active: true },
    { identifierKind: "email", identifier: "g2@home.example", email: "g2@home.example", name: "Guardian B", loginEnabled: true, passwordHash: OLD_HASH, active: true },
    { identifierKind: "school_id", identifier: "S-100", name: "Guardian C", loginEnabled: false, active: true },
  ]);
  await Student.collection.insertMany([
    { schoolId: "S-100", name: "Child One", classId: cid(), sectionId: cid(), phone: "01811111111", address: "House 9, Road 4", active: true },
    { schoolId: "S-101", name: "Child Two", classId: cid(), sectionId: cid(), address: "Somewhere", active: true },
  ]);
  await ClassNote.collection.insertOne({ slotId: cid(), groupType: "section", groupId: cid(), date: new Date(), subject: "MATH", taughtSummaryBn: "x", publishedBy: cid(), publishedAt: new Date() });
  await Notification.collection.insertOne({ recipientUserId: cid(), kind: "X", titleBn: "t", bodyBn: "b", dedupeKey: "k1" });
}

describe("guards", () => {
  const ok = { dbName: "scdhub_dev", outgoingOff: true, env: {} as NodeJS.ProcessEnv };

  it("passes a closed-outgoing dev database", () => {
    expect(() => assertDevTarget(ok)).not.toThrow();
  });
  it("refuses a database whose name does not end in _dev", () => {
    expect(() => assertDevTarget({ ...ok, dbName: "scdhub" })).toThrow(DevGuardError);
    expect(() => assertDevTarget({ ...ok, dbName: null })).toThrow(/_dev/);
  });
  it("refuses when outgoing is open", () => {
    expect(() => assertDevTarget({ ...ok, outgoingOff: false })).toThrow(/outgoing/);
  });
  it("refuses a URI equal to PROD_MONGODB_URI (host + db), whatever the credentials", () => {
    const env = {
      MONGODB_URI: "mongodb://dev:pw1@db.example:27017/scdhub_dev?authSource=admin",
      PROD_MONGODB_URI: "mongodb://other:pw2@DB.example:27017/scdhub_dev",
    } as NodeJS.ProcessEnv;
    expect(() => assertDevTarget({ ...ok, env })).toThrow(/PROD_MONGODB_URI/);
    expect(() => assertDevTarget({ ...ok, env: { ...env, PROD_MONGODB_URI: "mongodb://x@db.example:27017/scdhub" } })).not.toThrow();
  });
  it("uriIdentity drops credentials and options", () => {
    expect(uriIdentity("mongodb+srv://u:p@Host.Example/db1?retryWrites=true")).toBe("host.example/db1");
    expect(uriIdentity("")).toBeNull();
  });
});

describe("collection lists", () => {
  it("every copy / wipe / fake-base model resolves to a registered model (future ones are tolerated)", () => {
    for (const list of [COPY_MODELS, WIPE_MODELS, FAKE_BASE_MODELS]) {
      const r = resolveCollections(list);
      expect(r.found.length + r.skipped.length).toBe(new Set(list.map((x) => x.model)).size);
      for (const s of r.skipped) expect(list.find((x) => x.model === s)?.future).toBe(true);
    }
    const copy = resolveCollections(COPY_MODELS).found.map((f) => f.collection);
    expect(copy).toEqual(expect.arrayContaining(["users", "staffprofiles", "guardians", "students", "routineslots", "contentartifacts"]));
    // never copied
    expect(copy).not.toEqual(expect.arrayContaining(["notifications"]));
    expect(nsIncludeFlags("scdhub_dev", COPY_MODELS)[0]).toMatch(/^--nsInclude=scdhub_dev\.[a-z]+$/);
  });
});

describe("runMask", () => {
  const guard = { dbName: "scdtest_dev", outgoingOff: true, env: {} as NodeJS.ProcessEnv };

  it("refuses a non-_dev name, an open guard, and a missing password (before touching anything)", async () => {
    await seed();
    await expect(runMask({ apply: true, password: PW, guard: { ...guard, dbName: "scdhub" } })).rejects.toThrow(DevGuardError);
    await expect(runMask({ apply: true, password: PW, guard: { ...guard, outgoingOff: false } })).rejects.toThrow(/outgoing/);
    const prev = process.env.DEV_TEST_PASSWORD;
    delete process.env.DEV_TEST_PASSWORD;
    await expect(runMask({ apply: true, guard })).rejects.toThrow(/DEV_TEST_PASSWORD/);
    if (prev !== undefined) process.env.DEV_TEST_PASSWORD = prev;
    expect(await ClassNote.countDocuments({})).toBe(1);
    expect(await User.countDocuments({ email: "t1@school.example" })).toBe(1);
  });

  it("dry run counts and writes nothing", async () => {
    await seed();
    const r = await runMask({ apply: false, guard });
    expect(r.applied).toBe(false);
    expect(r.wiped.classnotes).toBe(1);
    expect(r.wiped.notifications).toBe(1);
    expect(r.masteryTestUsersRemoved).toBe(1);
    expect(await ClassNote.countDocuments({})).toBe(1);
    expect(await User.countDocuments({ phone: "01711111111" })).toBe(1);
  });

  it("--apply: residue 0, names kept, unique indexes hold, passwords replaced, wipes done", async () => {
    await seed();
    const r = await runMask({ apply: true, password: PW, guard, bcryptRounds: 4 });
    expect(r.residueTotal).toBe(0);
    expect(Object.values(r.residue).every((n) => n === 0)).toBe(true);
    expect(await ClassNote.countDocuments({})).toBe(0);
    expect(await Notification.countDocuments({})).toBe(0);
    expect(await User.countDocuments({ email: /@mastery\.test$/i })).toBe(0);

    const users = await User.collection.find({}).toArray();
    expect(users.map((u) => u.name).sort()).toEqual(["Office", "Teacher One", "Teacher Two"]);
    for (const u of users) {
      if (u.phone) expect(u.phone).toMatch(FAKE_PHONE_RE);
      if (u.email) expect(u.email).toMatch(FAKE_EMAIL_RE);
      expect(u.passwordHash).not.toBe(OLD_HASH);
    }
    // unique: 01000 + 6 digits, all distinct
    const phones = users.map((u) => u.phone).filter(Boolean);
    expect(new Set(phones).size).toBe(phones.length);
    // a hash that verifies the shared password, same for every account
    const bcrypt = await import("bcryptjs");
    expect(await bcrypt.compare(PW, users[0].passwordHash as string)).toBe(true);
    expect(new Set(users.map((u) => u.passwordHash)).size).toBe(1);

    // StaffProfile: join phone stays equal to the User's; sensitive fields gone; name kept
    const staff = (await StaffProfile.collection.findOne({ schoolId: "ST-1" })) as Record<string, unknown>;
    const teacher = users.find((u) => u.name === "Teacher One") as Record<string, unknown>;
    expect(staff.phone).toBe(teacher.phone);
    expect(staff.name).toBe("Teacher One");
    for (const f of ["nid", "presentAddress", "permanentAddress", "bankAccount", "bankAccountName", "bankName", "bankBranch", "routingNo", "monthlySalary", "paymentMethod"]) {
      expect(staff[f]).toBeUndefined();
    }
    expect(staff.whatsapp).toMatch(FAKE_PHONE_RE);

    // Guardians: identifier follows phone / email; school_id identifier + no-password row untouched
    const gs = await Guardian.collection.find({}).toArray();
    const ga = gs.find((g) => g.name === "Guardian A") as Record<string, unknown>;
    const gb = gs.find((g) => g.name === "Guardian B") as Record<string, unknown>;
    const gc = gs.find((g) => g.name === "Guardian C") as Record<string, unknown>;
    expect(ga.identifier).toBe(ga.phone);
    expect(ga.phone).toMatch(FAKE_PHONE_RE);
    expect(gb.identifier).toBe(gb.email);
    expect(gb.email).toMatch(FAKE_EMAIL_RE);
    expect(gc.identifier).toBe("S-100");
    expect(gc.passwordHash).toBeUndefined();

    // Students: same real phone as Guardian A maps to the same fake; address cleared; names kept
    const s1 = (await Student.collection.findOne({ schoolId: "S-100" })) as Record<string, unknown>;
    expect(s1.phone).toBe(ga.phone);
    expect(s1.address).toBeUndefined();
    expect(s1.name).toBe("Child One");
    expect(((await Student.collection.findOne({ schoolId: "S-101" })) as Record<string, unknown>).address).toBeUndefined();

    // the unique indexes are still enforced after the rewrite
    await expect(User.collection.insertOne({ role: "TEACHER", name: "dup", phone: phones[0], passwordHash: "x" })).rejects.toThrow();
  });

  it("is re-runnable: a second --apply keeps the same fake values and still ends at residue 0", async () => {
    await seed();
    await runMask({ apply: true, password: PW, guard, bcryptRounds: 4 });
    const before = (await User.collection.find({}).sort({ _id: 1 }).toArray()).map((u) => `${u.phone}|${u.email}`);
    const r = await runMask({ apply: true, password: PW, guard, bcryptRounds: 4 });
    const after = (await User.collection.find({}).sort({ _id: 1 }).toArray()).map((u) => `${u.phone}|${u.email}`);
    expect(r.residueTotal).toBe(0);
    expect(after).toEqual(before);
  });

  it("RAW gate: a real phone / email in a legacy field the schema does not know (any depth) is masked; dob / biometricId cleared", async () => {
    await seed();
    await Student.collection.updateOne(
      { schoolId: "S-101" },
      { $set: { oldFatherPhone: "01955555555", dob: new Date("2015-01-01"), biometricId: "B1", legacy: { notes: ["call +8801966666666 or mom@home.example"], deep: { x: { y: "01977777777" } } } } },
    );
    await StaffProfile.collection.updateOne({ schoolId: "ST-2" }, { $set: { dob: new Date("1990-01-01"), biometricId: "B2", oldEmail: "T2@Old.Example" } });
    await User.collection.updateOne({ name: "Office" }, { $set: { biometricId: "B3" } });
    const r = await runMask({ apply: true, password: PW, guard, bcryptRounds: 4 });
    expect(r.residueTotal).toBe(0);
    expect(r.rawMasked.Student).toBeGreaterThan(0);
    const s2 = (await Student.collection.findOne({ schoolId: "S-101" })) as Record<string, unknown>;
    const dump = JSON.stringify(s2);
    expect(dump).not.toMatch(/01955555555|01966666666|01977777777|mom@home\.example/);
    expect(s2.oldFatherPhone).toMatch(FAKE_PHONE_RE);
    expect(s2.dob).toBeUndefined();
    expect(s2.biometricId).toBeUndefined();
    const st2 = (await StaffProfile.collection.findOne({ schoolId: "ST-2" })) as Record<string, unknown>;
    expect(st2.dob).toBeUndefined();
    expect(st2.biometricId).toBeUndefined();
    expect(st2.oldEmail).toMatch(FAKE_EMAIL_RE);
    expect(((await User.collection.findOne({ name: "Office" })) as Record<string, unknown>).biometricId).toBeUndefined();
  });

  it("a half-failed first run does not break the staff login join: User.phone === StaffProfile.phone / email after a second run", async () => {
    await seed();
    await runMask({ apply: true, password: PW, guard, bcryptRounds: 4 });
    // simulate a first run that died after the Users were written: the staff rows are real again
    await StaffProfile.collection.updateOne({ schoolId: "ST-1" }, { $set: { phone: "01711111111", email: "t1@school.example", whatsapp: "01733333333" } });
    await StaffProfile.collection.updateOne({ schoolId: "ST-2" }, { $set: { phone: "01722222222" } });
    const r = await runMask({ apply: true, password: PW, guard, bcryptRounds: 4 });
    expect(r.residueTotal).toBe(0);
    const users = await User.collection.find({}).toArray();
    const staff = await StaffProfile.collection.find({}).toArray();
    for (const sp of staff) {
      const u = users.find((x) => x.name === sp.name) as Record<string, unknown>;
      expect(sp.phone).toBe(u.phone);
      if (sp.email) expect(sp.email).toBe(u.email);
    }
  });
});
