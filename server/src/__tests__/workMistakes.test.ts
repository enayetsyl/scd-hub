/**
 * Staff mistake record MR-5 (D-#951) on a real in-memory Mongo: an accepted "done at home"
 * claim against an earlier day's chase, and an undone RESUBMIT / CHECKED mark.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Notification } from "../modules/notifications/models/Notification";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import { GuardianWorkClaim } from "../modules/trackers/models/GuardianWorkClaim";
import { MarkCorrectionNote } from "../modules/trackers/models/MarkCorrectionNote";
import { WorkRevertNote } from "../modules/trackers/models/WorkRevertNote";
import { StaffMistake } from "../modules/staff-mistakes/models/StaffMistake";
import { transitionAssignmentRecord } from "../modules/trackers/services/AssignmentService";
import { revertAssignmentRecord } from "../modules/trackers/services/AssignmentRevertService";
import { claimDetailsByIds, revertDetailsByIds } from "../modules/trackers/services/WorkMistakeService";

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
    [User, Class, Section, Student, Notification, AssignmentItem, AssignmentStudentRecord, GuardianWorkClaim, MarkCorrectionNote, WorkRevertNote, StaffMistake].map(
      (m) => (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

const at = (hhmm: string, day = "2026-11-09") => new Date(`${day}T${hhmm}:00+06:00`);

async function user(name: string, role = "TEACHER"): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801755000${seq}`, passwordHash: "x",
    // D-#1016: these suites test the told flow (explain notice, decisions, warnings).
    grantedPermissions: ["staff_mistakes:view_own"], revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

/** An assignment record GIVEN on 11-05 by `teacher`. */
async function record(teacher: string): Promise<{ rec: string; itemId: string; studentId: string; sectionId: Types.ObjectId; classId: Types.ObjectId }> {
  seq += 1;
  const c = await Class.collection.insertOne({ level: 3, nameBn: "তৃতীয় শ্রেণি", academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, code: `S${seq}`, nameBn: "বালক", active: true });
  const st = await Student.collection.insertOne({ schoolId: `W-${seq}`, name: "Ayaan Rahman", classId: c.insertedId, sectionId: s.insertedId, active: true });
  const it = await AssignmentItem.create({
    asId: `AS-C3-MATH-${String(seq).padStart(4, "0")}`, academicYearId: new Types.ObjectId(), scheduleEntryId: new Types.ObjectId(),
    weekNumber: seq, cycleWeek: 1, classId: c.insertedId, classLevel: 3, sectionId: s.insertedId, subject: "MATH",
    teacherId: new Types.ObjectId(teacher), deliveryDate: new Date(2026, 10, 5), dueDate: new Date(2026, 10, 8), estMinutes: 20,
    status: "ISSUED", deliveredBy: new Types.ObjectId(teacher), deliveredAt: at("10:00", "2026-11-05"),
  });
  const r = await AssignmentStudentRecord.create({
    asItemId: it._id, asId: it.asId, studentId: st.insertedId, sectionId: s.insertedId, classId: c.insertedId,
    state: "GIVEN", stateDates: [{ state: "GIVEN", at: at("10:00", "2026-11-05"), by: new Types.ObjectId(teacher) }],
    chaseCount: 0, dueDate: it.dueDate, issuedBy: new Types.ObjectId(teacher),
  });
  return { rec: r._id.toString(), itemId: it._id.toString(), studentId: st.insertedId.toString(), sectionId: s.insertedId, classId: c.insertedId };
}

async function claimOn(r: Awaited<ReturnType<typeof record>>, teacher: string, asId: string): Promise<void> {
  await GuardianWorkClaim.collection.insertOne({
    tracker: "ASSIGNMENT", recordId: new Types.ObjectId(r.rec), workId: asId, studentId: new Types.ObjectId(r.studentId),
    sectionId: r.sectionId, classId: r.classId, subject: "MATH", teacherId: new Types.ObjectId(teacher),
    claimedByGuardianId: new Types.ObjectId(), claimedByUserId: new Types.ObjectId(), claimedAt: at("19:00", "2026-11-08"),
    actionDateKey: "2026-11-09", note: "বাসায় করেছে", status: "PENDING", attemptNumber: 1, nudgeCount: 0,
  });
}

describe("D-#951 — an accepted claim against an earlier day's chase", () => {
  it("is the chaser's entry; the same-day case stays a mark correction only", async () => {
    const teacher = await user("Rahima");
    const r = await record(teacher);
    const asId = (await AssignmentStudentRecord.findById(r.rec).lean())!.asId;
    await transitionAssignmentRecord(r.rec, "DUE", teacher, at("07:00", "2026-11-08"));
    await transitionAssignmentRecord(r.rec, "CHASE", teacher, at("08:10", "2026-11-08"));
    await claimOn(r, teacher, asId);
    await transitionAssignmentRecord(r.rec, "SUBMITTED", teacher, at("09:00"));

    const m = await StaffMistake.findOne({}).lean();
    expect([m!.kind, String(m!.staffUserId), m!.status]).toEqual(["WORK_CLAIM_ACCEPTED", teacher, "EXPLANATION_DUE"]);
    expect(await MarkCorrectionNote.countDocuments()).toBe(0);
    const d = (await claimDetailsByIds([String(m!.sourceId)])).get(String(m!.sourceId))!;
    expect([d.studentName, d.itemCode, d.claimNote, d.byName]).toEqual(["Ayaan Rahman", asId, "বাসায় করেছে", "Rahima"]);

    // Same day: the D-#892 note records it, the claim adds nothing.
    const r2 = await record(teacher);
    const asId2 = (await AssignmentStudentRecord.findById(r2.rec).lean())!.asId;
    await transitionAssignmentRecord(r2.rec, "DUE", teacher, at("07:00"));
    await transitionAssignmentRecord(r2.rec, "CHASE", teacher, at("08:10"));
    await claimOn(r2, teacher, asId2);
    await transitionAssignmentRecord(r2.rec, "SUBMITTED", teacher, at("10:00"));
    const kinds = (await StaffMistake.find({}).lean()).map((x) => x.kind).sort();
    expect(kinds).toEqual(["MARK_CORRECTION", "WORK_CLAIM_ACCEPTED"]);
  });
});

describe("D-#951 — an undone RESUBMIT / CHECKED mark", () => {
  async function checkedThenResubmit(teacher: string): Promise<string> {
    const r = await record(teacher);
    await transitionAssignmentRecord(r.rec, "DUE", teacher, at("07:00"));
    await transitionAssignmentRecord(r.rec, "SUBMITTED", teacher, at("08:00"));
    return r.rec;
  }

  it("someone else undoing a CHECKED mark is the checker's entry", async () => {
    const teacher = await user("Rahima");
    const office = await user("Kamrul", "OFFICE");
    const rec = await checkedThenResubmit(teacher);
    await AssignmentStudentRecord.updateOne(
      { _id: rec },
      { $set: { state: "CHECKED", result: "WRONG" }, $push: { stateDates: { state: "CHECKED", at: at("09:00"), by: new Types.ObjectId(teacher) } } },
    );
    await revertAssignmentRecord({ recordId: rec, actorId: office, admin: true, now: at("11:00") });
    const note = await WorkRevertNote.findOne({}).lean();
    expect([String(note!.staffUserId), note!.states.map((s) => s.state)]).toEqual([teacher, ["CHECKED"]]);
    const m = await StaffMistake.findOne({}).lean();
    expect([m!.kind, String(m!.staffUserId)]).toEqual(["WORK_REVERT", teacher]);
    const d = (await revertDetailsByIds([String(note!._id)])).get(String(note!._id))!;
    expect([d.studentName, d.byName]).toEqual(["Ayaan Rahman", "Kamrul"]);
  });

  it("the teacher undoing their own CHECKED the same day is not recorded", async () => {
    const teacher = await user("Rahima");
    const rec = await checkedThenResubmit(teacher);
    await AssignmentStudentRecord.updateOne(
      { _id: rec },
      { $set: { state: "CHECKED", result: "WRONG" }, $push: { stateDates: { state: "CHECKED", at: at("09:00"), by: new Types.ObjectId(teacher) } } },
    );
    await revertAssignmentRecord({ recordId: rec, actorId: teacher, admin: false, now: at("09:05") });
    expect(await WorkRevertNote.countDocuments()).toBe(0);
    expect(await StaffMistake.countDocuments()).toBe(0);
  });
});
