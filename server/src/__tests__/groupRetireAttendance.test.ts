/**
 * D-#865 — retiring a split Quran group carries its attendance days to the groups its
 * children moved to, so studentAttendanceHistory (which reads only the CURRENT group)
 * keeps every recorded day.
 *
 *   recordGroupDeparture        notes the leaver (and is a no-op for a non-member)
 *   copyRetiredGroupAttendance  copies into pure successors; keeps the successor's own
 *                               dates; filters absentees to the successor; skips a
 *                               mixed-origin successor; idempotent; audited
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { SubjectGroup } from "../modules/routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../modules/routine/models/SubjectGroupMembership";
import { SubjectGroupDeparture } from "../modules/routine/models/SubjectGroupDeparture";
import { StudentAttendanceDay } from "../modules/attendance/models/StudentAttendanceDay";
import { Audit } from "../modules/platform/models/Audit";
import { copyRetiredGroupAttendance, recordGroupDeparture } from "../modules/routine/services/GroupRetireAttendanceService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const marker = new Types.ObjectId();
const ACTOR = new Types.ObjectId().toString();
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
  await Promise.all([
    SubjectGroup.deleteMany({}),
    SubjectGroupMembership.deleteMany({}),
    SubjectGroupDeparture.deleteMany({}),
    StudentAttendanceDay.deleteMany({}),
    Audit.deleteMany({}),
  ]);
});

async function group(code: string, gender: "boys" | "girls" | "mixed"): Promise<string> {
  seq += 1;
  const g = await SubjectGroup.collection.insertOne({
    track: "quran", level: "najera", gender, code, nameBn: code, active: true,
  });
  return g.insertedId.toString();
}
async function join(groupId: string, studentId: Types.ObjectId): Promise<void> {
  await SubjectGroupMembership.collection.insertOne({ groupId: new Types.ObjectId(groupId), studentId, track: "quran" });
}
async function day(groupId: string, dateKey: string, absent: Types.ObjectId[] = []): Promise<void> {
  await StudentAttendanceDay.collection.insertOne({
    subjectGroupId: new Types.ObjectId(groupId), dateKey, absentStudentIds: absent, markedBy: marker, markedAt: new Date(),
  });
}
/** removeGroupMember's two steps, in its order. */
async function move(from: string, to: string, studentId: Types.ObjectId): Promise<void> {
  await recordGroupDeparture(from, studentId.toString());
  await SubjectGroupMembership.deleteOne({ groupId: from, studentId });
  await join(to, studentId);
}
const daysOf = async (g: string) =>
  (await StudentAttendanceDay.find({ subjectGroupId: g }).sort({ dateKey: 1 }).lean()).map((d) => ({
    dateKey: d.dateKey,
    absent: d.absentStudentIds.map(String),
  }));

/** A mixed group of 2 boys + 2 girls with 3 recorded days, split into boys/girls. */
async function split() {
  const mixed = await group("QURAN_NAJERA_MIXED", "mixed");
  const boys = await group("QURAN_NAJERA_BOYS", "boys");
  const girls = await group("QURAN_NAJERA_GIRLS", "girls");
  const [b1, b2, g1, g2] = [1, 2, 3, 4].map(() => new Types.ObjectId());
  for (const s of [b1, b2, g1, g2]) await join(mixed, s);
  await day(mixed, "2026-08-02", [b1, g1]);
  await day(mixed, "2026-08-03", []);
  await day(mixed, "2026-08-04", [g2]);
  for (const s of [b1, b2]) await move(mixed, boys, s);
  for (const s of [g1, g2]) await move(mixed, girls, s);
  return { mixed, boys, girls, b1, b2, g1, g2 };
}

describe("recordGroupDeparture", () => {
  it("notes a member leaving, and nothing for a non-member", async () => {
    const g = await group("G", "mixed");
    const s = new Types.ObjectId();
    await recordGroupDeparture(g, s.toString());
    expect(await SubjectGroupDeparture.countDocuments()).toBe(0);
    await join(g, s);
    await recordGroupDeparture(g, s.toString());
    const d = await SubjectGroupDeparture.findOne().lean();
    expect([d?.groupId.toString(), d?.studentId.toString(), d?.track]).toEqual([g, s.toString(), "quran"]);
  });
});

describe("copyRetiredGroupAttendance", () => {
  it("copies every day into each successor, with only that successor's absentees", async () => {
    const { mixed, boys, girls, b1, g1, g2 } = await split();
    const r = await copyRetiredGroupAttendance(mixed, ACTOR);
    expect(r.copied.map((c) => [c.code, c.days]).sort()).toEqual([["QURAN_NAJERA_BOYS", 3], ["QURAN_NAJERA_GIRLS", 3]]);
    expect(await daysOf(boys)).toEqual([
      { dateKey: "2026-08-02", absent: [b1.toString()] },
      { dateKey: "2026-08-03", absent: [] },
      { dateKey: "2026-08-04", absent: [] },
    ]);
    expect(await daysOf(girls)).toEqual([
      { dateKey: "2026-08-02", absent: [g1.toString()] },
      { dateKey: "2026-08-03", absent: [] },
      { dateKey: "2026-08-04", absent: [g2.toString()] },
    ]);
    const audit = await Audit.findOne({ eventKind: "ATTENDANCE_DAYS_COPIED" }).lean();
    expect(audit?.targetId?.toString()).toBe(mixed);
  });

  it("keeps a date the successor recorded itself", async () => {
    const { mixed, girls } = await split();
    await day(girls, "2026-08-04", []); // the girls group marked this day on its own
    await copyRetiredGroupAttendance(mixed, ACTOR);
    const aug4 = (await daysOf(girls)).find((d) => d.dateKey === "2026-08-04");
    expect(aug4?.absent).toEqual([]); // not overwritten with the mixed row's g2 absence
  });

  it("skips a successor that also holds children from elsewhere", async () => {
    const { mixed, boys } = await split();
    await join(boys, new Types.ObjectId()); // a boy who was never in the mixed group
    const r = await copyRetiredGroupAttendance(mixed, ACTOR);
    expect(r.skipped).toEqual([{ groupId: boys, code: "QURAN_NAJERA_BOYS", reason: "MIXED_ORIGIN" }]);
    expect(await daysOf(boys)).toEqual([]);
  });

  it("is idempotent", async () => {
    const { mixed, boys } = await split();
    await copyRetiredGroupAttendance(mixed, ACTOR);
    const again = await copyRetiredGroupAttendance(mixed, ACTOR);
    expect(again.copied).toEqual([]);
    expect((await daysOf(boys)).length).toBe(3);
  });

  it("does nothing for a group with no recorded days or no departures", async () => {
    const empty = await group("ARABIC_X", "mixed");
    expect(await copyRetiredGroupAttendance(empty, ACTOR)).toEqual({ copied: [], skipped: [] });
    const quiet = await group("Q", "mixed");
    await day(quiet, "2026-08-02");
    expect(await copyRetiredGroupAttendance(quiet, ACTOR)).toEqual({ copied: [], skipped: [] });
    expect(await Audit.countDocuments()).toBe(0);
  });
});
