/**
 * Staff mistake record MR-3 (D-#944) on a real in-memory Mongo: a changed absent list
 * records which children flipped, on the day's marker's note, and becomes their mistake.
 *
 * Uses a pre-cutover day (2026-07-01, D-#292) so a section's roster is simply its students;
 * the day type is stubbed FULL.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Notification } from "../modules/notifications/models/Notification";
import { StudentAttendanceDay } from "../modules/attendance/models/StudentAttendanceDay";
import { AttendanceCorrectionNote } from "../modules/attendance/models/AttendanceCorrectionNote";
import { StaffMistake } from "../modules/staff-mistakes/models/StaffMistake";
import { amendAttendanceUnit } from "../modules/attendance/services/StudentAttendanceService";
import { attendanceCorrectionNotesByIds, attendanceDiff } from "../modules/attendance/services/AttendanceCorrectionService";
import { runWithCorrectionReason } from "../modules/staff-mistakes/services/correctionReasonContext";

jest.mock("../modules/routine/calendar", () => ({
  ...jest.requireActual("../modules/routine/calendar"),
  resolveDayType: async () => "FULL",
}));

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
    [User, Class, Section, Student, Notification, StudentAttendanceDay, AttendanceCorrectionNote, StaffMistake].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

const DAY = "2026-07-01";
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+06:00`);

async function user(name: string, role = "TEACHER"): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801733000${seq}`, passwordHash: "x",
    grantedPermissions: [], revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

async function section(): Promise<{ unit: { unitType: "section"; unitId: string }; kids: string[] }> {
  seq += 1;
  const c = await Class.collection.insertOne({ level: 4, nameBn: "চতুর্থ শ্রেণি", academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, code: `S${seq}`, nameBn: "বালক", active: true });
  const kids: string[] = [];
  for (const name of ["Rafi Islam", "Sadia Akter", "Tamim Hasan"]) {
    seq += 1;
    const k = await Student.collection.insertOne({ schoolId: `A-${seq}`, name, classId: c.insertedId, sectionId: s.insertedId, active: true });
    kids.push(k.insertedId.toString());
  }
  return { unit: { unitType: "section", unitId: s.insertedId.toString() }, kids };
}

describe("D-#944 — a changed absent list is recorded child by child", () => {
  it("the first save records nothing; Office's change becomes the marker's mistake to explain", async () => {
    const marker = await user("Nasrin");
    const office = await user("Kamrul", "OFFICE");
    const { unit, kids } = await section();
    await amendAttendanceUnit(unit, DAY, [kids[0]!, kids[1]!], marker, at("08:10"));
    expect(await AttendanceCorrectionNote.countDocuments()).toBe(0);

    await amendAttendanceUnit(unit, DAY, [kids[1]!, kids[2]!], office, at("11:40"));
    const note = await AttendanceCorrectionNote.findOne({}).lean();
    expect(String(note!.staffUserId)).toBe(marker); // the marker owns it, not Office
    expect(note!.changes.map((c) => [String(c.studentId), c.from, c.to])).toEqual([
      [kids[0], "ABSENT", "PRESENT"],
      [kids[2], "PRESENT", "ABSENT"],
    ]);
    expect(note!.changes.every((c) => String(c.by) === office)).toBe(true);

    const m = await StaffMistake.findOne({}).lean();
    expect(m!.kind).toBe("ATTENDANCE_CORRECTION");
    expect(String(m!.staffUserId)).toBe(marker);
    expect(m!.status).toBe("EXPLANATION_DUE");
    expect((await Notification.find({ kind: "STAFF_MISTAKE_EXPLAIN" }).lean()).map((n) => String(n.recipientUserId))).toEqual([marker]);

    const detail = (await attendanceCorrectionNotesByIds([String(note!._id)])).get(String(note!._id))!;
    expect(detail.unitLabel).toBe("চতুর্থ শ্রেণি · বালক");
    expect(detail.changes.map((c) => [c.studentName, c.from, c.byName])).toEqual([
      ["Rafi Islam", "ABSENT", "Kamrul"],
      ["Tamim Hasan", "PRESENT", "Kamrul"],
    ]);
  });

  it("the marker's own re-submit with 'came late' is accepted at once; 'my mistake' counts", async () => {
    const marker = await user("Nasrin");
    const a = await section();
    await amendAttendanceUnit(a.unit, DAY, [a.kids[0]!], marker, at("08:10"));
    await runWithCorrectionReason({ code: "LATE_ARRIVAL", text: "" }, () => amendAttendanceUnit(a.unit, DAY, [], marker, at("09:05")));
    expect((await StaffMistake.findOne({}).lean())!.status).toBe("EXCUSED");

    const b = await section();
    await amendAttendanceUnit(b.unit, DAY, [b.kids[0]!], marker, at("08:10"));
    await runWithCorrectionReason({ code: "MINE", text: "" }, () => amendAttendanceUnit(b.unit, DAY, [b.kids[1]!], marker, at("08:20")));
    const counted = await StaffMistake.findOne({ status: "COUNTED" }).lean();
    expect(counted!.reasonCode).toBe("MINE");
    expect(await Notification.countDocuments({ kind: "STAFF_MISTAKE_EXPLAIN" })).toBe(0);
  });

  it("a change after the entry was explained starts a new entry with its own reason", async () => {
    const marker = await user("Nasrin");
    const office = await user("Kamrul", "OFFICE");
    const { unit, kids } = await section();
    await amendAttendanceUnit(unit, DAY, [kids[0]!], marker, at("08:10"));
    await amendAttendanceUnit(unit, DAY, [kids[1]!], office, at("11:00")); // explanation due
    await amendAttendanceUnit(unit, DAY, [kids[1]!, kids[2]!], office, at("11:10")); // same open episode
    expect(await AttendanceCorrectionNote.countDocuments()).toBe(1);
    const first = await StaffMistake.findOne({}).lean();
    await StaffMistake.updateOne({ _id: first!._id }, { $set: { status: "EXCUSED" } });
    await runWithCorrectionReason({ code: "MINE", text: "" }, () => amendAttendanceUnit(unit, DAY, [kids[2]!], marker, at("12:00")));
    const notes = await AttendanceCorrectionNote.find({}).sort({ episode: 1 }).lean();
    expect(notes.map((n) => [n.episode, n.changes.length])).toEqual([[1, 3], [2, 1]]);
    const rows = await StaffMistake.find({}).lean();
    expect(rows.map((r) => r.status).sort()).toEqual(["COUNTED", "EXCUSED"]);
  });

  it("a re-submit with the same list is not a correction", async () => {
    const marker = await user("Nasrin");
    const { unit, kids } = await section();
    await amendAttendanceUnit(unit, DAY, [kids[0]!], marker, at("08:10"));
    await amendAttendanceUnit(unit, DAY, [kids[0]!], marker, at("08:30"));
    expect(await AttendanceCorrectionNote.countDocuments()).toBe(0);
    expect(await StaffMistake.countDocuments()).toBe(0);
  });

  it("diff names both directions", () => {
    expect(attendanceDiff(["a", "b"], ["b", "c"])).toEqual([
      { studentId: "a", from: "ABSENT", to: "PRESENT" },
      { studentId: "c", from: "PRESENT", to: "ABSENT" },
    ]);
  });
});
