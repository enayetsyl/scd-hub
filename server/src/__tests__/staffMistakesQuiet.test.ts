/**
 * Quiet record (D-#1020, docs/prd-staff-mistakes.md §18) on a real in-memory Mongo: a person
 * without staff_mistakes:view_own is never told — the entry counts at once, no explain or
 * decision notice, no warning step — and holders of staff_mistakes:view_all get one 18:00
 * report naming who made which mistake that day.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { Notification } from "../modules/notifications/models/Notification";
import { StaffMistake } from "../modules/staff-mistakes/models/StaffMistake";
import { StaffMistakeNote } from "../modules/staff-mistakes/models/StaffMistakeNote";
import { StaffWarning } from "../modules/staff-mistakes/models/StaffWarning";
import { recordPlaceMistake } from "../modules/staff-mistakes/services/StaffMistakeNoteService";
import { decideMistake, listStaffMistakes } from "../modules/staff-mistakes/services/StaffMistakeService";
import { dispatchStaffMistakeDaily } from "../modules/staff-mistakes/services/StaffMistakeDailyService";
import { isToldAboutMistakes } from "../modules/staff-mistakes/services/toldAboutMistakes";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let seq = 0;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all(
    [User, Notification, StaffMistake, StaffMistakeNote, StaffWarning].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})),
  );
});

const at = (hhmm: string, day = "2026-11-08") => new Date(`${day}T${hhmm}:00+06:00`);

async function user(name: string, role = "TEACHER", granted: string[] = []): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801744000${seq}`, passwordHash: "x",
    grantedPermissions: granted, revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

/** A tier-1 place entry for `owner`, caught by `by`. */
const record = (owner: string, by: string, ref: string, when = at("10:00")) =>
  recordPlaceMistake({ kind: "QURAN_EXAM_UNLOCK_CHANGE", refKey: ref, ownerId: owner, correctedBy: by, at: when, line: `ফল বদলানো — ${ref}` });

const kinds = async (kind: string) => Notification.find({ kind }).lean();

describe("D-#1020 — nobody is told unless they hold staff_mistakes:view_own", () => {
  it("is off by default for teachers and the Office; the Principal holds it", async () => {
    expect(await isToldAboutMistakes(await user("Rahima"))).toBe(false);
    expect(await isToldAboutMistakes(await user("Akmol", "OFFICE"))).toBe(false);
    expect(await isToldAboutMistakes(await user("Nasrin", "TEACHER", ["staff_mistakes:view_own"]))).toBe(true);
  });

  it("a quiet entry counts at once: no explain notice, and no warning step however many", async () => {
    const teacher = await user("Rahima");
    const office = await user("Akmol", "OFFICE");
    for (const ref of ["s1", "s2", "s3", "s4", "s5"]) await record(teacher, office, ref);
    const rows = await StaffMistake.find({}).lean();
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.status === "COUNTED" && r.autoCounted)).toBe(true);
    // The list marks them quiet (never asked), not "no explanation in time".
    expect((await listStaffMistakes({ now: at("11:00") })).every((r) => r.quiet)).toBe(true);
    expect(await kinds("STAFF_MISTAKE_EXPLAIN")).toHaveLength(0);
    expect(await StaffWarning.countDocuments()).toBe(0);
    expect(await Notification.countDocuments({ kind: { $in: ["STAFF_MISTAKE_WARNING", "STAFF_MISTAKE_STEP"] } })).toBe(0);
  });

  it("someone switched on is still asked to explain (the told flow)", async () => {
    const teacher = await user("Nasrin", "TEACHER", ["staff_mistakes:view_own"]);
    await record(teacher, await user("Akmol", "OFFICE"), "s1");
    expect((await StaffMistake.findOne({}).lean())!.status).toBe("EXPLANATION_DUE");
    expect(await kinds("STAFF_MISTAKE_EXPLAIN")).toHaveLength(1);
    // Left to run past its deadline it counts on its own — that is not quiet.
    expect((await listStaffMistakes({ now: at("18:00", "2026-11-09") })).map((r) => [r.status, r.quiet])).toEqual([["COUNTED", false]]);
  });

  it("a move onto a quiet person is the decision: counted, and neither side is told", async () => {
    const a = await user("Rahima");
    const b = await user("Karim");
    const principal = await user("Principal", "PRINCIPAL");
    await record(a, principal, "s1");
    const row = (await StaffMistake.findOne({}).lean())!;
    await decideMistake({ mistakeId: String(row._id), actorId: principal, mayHandlePrincipal: true, decision: "MOVE", moveToUserId: b, now: at("12:00") });
    const moved = (await StaffMistake.findOne({ staffUserId: new Types.ObjectId(b) }).lean())!;
    expect([moved.status, String(moved.decidedBy)]).toEqual(["COUNTED", principal]);
    expect(await Notification.countDocuments({ kind: { $in: ["STAFF_MISTAKE_EXPLAIN", "STAFF_MISTAKE_DECIDED"] } })).toBe(0);
  });

  it("the day's list filters by date", async () => {
    const t = await user("Rahima");
    const o = await user("Akmol", "OFFICE");
    await record(t, o, "s1", at("10:00", "2026-11-08"));
    await record(t, o, "s2", at("10:00", "2026-11-09"));
    expect((await listStaffMistakes({ dateKey: "2026-11-09", now: at("12:00", "2026-11-09") })).map((r) => r.dateKey)).toEqual(["2026-11-09"]);
  });
});

describe("D-#1020 — the 18:00 daily report", () => {
  it("one notification per view_all holder naming who and where; the Principal's own entries stay private", async () => {
    const rahima = await user("Rahima");
    const karim = await user("Karim");
    const principal = await user("Principal", "PRINCIPAL");
    const office = await user("Akmol", "OFFICE");
    const grantedOffice = await user("Sajeda", "OFFICE", ["staff_mistakes:view_all"]);
    await record(rahima, office, "s1");
    await record(rahima, office, "s2");
    await record(karim, office, "s3");
    await record(principal, office, "s4");

    expect(await dispatchStaffMistakeDaily(at("18:00"))).toBe(2);
    const rows = await kinds("STAFF_MISTAKE_DAILY");
    const toPrincipal = rows.find((n) => String(n.recipientUserId) === principal)!;
    const toSajeda = rows.find((n) => String(n.recipientUserId) === grantedOffice)!;
    expect(rows.some((n) => String(n.recipientUserId) === office)).toBe(false);
    expect(toPrincipal.titleBn).toContain("৪টি (৩ জন)");
    expect(toPrincipal.bodyBn.split("\n")[0]).toContain("Rahima (২)");
    expect(toPrincipal.refs?.date).toBe("2026-11-08");
    expect(toSajeda.titleBn).toContain("৩টি (২ জন)");
    expect(toSajeda.bodyBn).not.toContain("Principal");

    // Same day again: nothing new (dedupe); the people named were never told.
    await dispatchStaffMistakeDaily(at("18:20"));
    expect(await kinds("STAFF_MISTAKE_DAILY")).toHaveLength(2);
    expect(await Notification.countDocuments({ recipientUserId: { $in: [rahima, karim].map((id) => new Types.ObjectId(id)) } })).toBe(0);
  });

  it("a day with nothing (or only accepted entries) sends nothing", async () => {
    await user("Principal", "PRINCIPAL");
    const t = await user("Rahima");
    expect(await dispatchStaffMistakeDaily(at("18:00"))).toBe(0);
    await record(t, await user("Akmol", "OFFICE"), "s1");
    await StaffMistake.updateMany({}, { $set: { status: "EXCUSED" } });
    expect(await dispatchStaffMistakeDaily(at("18:00"))).toBe(0);
  });
});
