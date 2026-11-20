/**
 * D-#1660 — exam duty roster, real services on in-memory Mongo.
 *
 *   assign    puts a teacher on a routine sitting; a sitting not in the routine is refused;
 *             the same teacher cannot hold two seats of one sitting
 *   swap      needs a reason; the old and the new teacher are both told; A -> B -> A tells A again
 *   clear     needs a reason; the teacher is told; audited
 *   roster    per-teacher count, empty sittings, overlap + approved-leave conflicts
 *   mine      a teacher sees only their own upcoming duties; Office-only calls refuse a teacher
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { Exam } from "../modules/exams/models/Exam";
import { ExamRoutine } from "../modules/exams/models/ExamRoutine";
import { ExamSittingDuty } from "../modules/exams/models/ExamSittingDuty";
import { Class } from "../modules/foundation/models/Class";
import { StaffProfile } from "../modules/foundation/models/StaffProfile";
import { User } from "../modules/foundation/models/User";
import { StaffLeaveApplication } from "../modules/hr/models/StaffLeaveApplication";
import { Notification } from "../modules/notifications/models/Notification";
import { Audit } from "../modules/platform/models/Audit";
import { assignExamDuty, clearExamDuty, examDutyRoster, myExamDuties } from "../modules/exams/services/ExamDutyService";

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

beforeEach(async () => {
  await Promise.all(
    [Exam, ExamRoutine, ExamSittingDuty, Class, StaffProfile, User, StaffLeaveApplication, Notification, Audit].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

const ctxOf = (role: string, permissions: string[], userId = new Types.ObjectId().toString()): AppContext =>
  ({ auth: { userId, role, permissions } }) as unknown as AppContext;

// A future-proof date: "my duties" only lists today onward.
const D1 = "2099-12-01";
const D2 = "2099-12-02";

let phoneSeq = 0;
async function teacher(name: string, phone = `0170${String(1000000 + phoneSeq++)}`) {
  const r = await User.collection.insertOne({ name, role: "TEACHER", active: true, phone });
  return r.insertedId.toString();
}

async function setup() {
  const yearId = new Types.ObjectId();
  const exam = await Exam.collection.insertOne({ academicYearId: yearId, term: "ANNUAL", name: "Annual 2099", createdBy: new Types.ObjectId() });
  const c3 = await Class.collection.insertOne({ level: 3, nameBn: "৩য় শ্রেণি", academicYearId: yearId, active: true });
  const c4 = await Class.collection.insertOne({ level: 4, nameBn: "৪র্থ শ্রেণি", academicYearId: yearId, active: true });
  await ExamRoutine.collection.insertOne({
    examId: exam.insertedId,
    noteBn: "",
    updatedBy: new Types.ObjectId(),
    slots: [
      { classId: c3.insertedId, dateKey: D1, subject: "BAN", kind: "WRITTEN", start: "07:30", end: "10:30", note: "" },
      { classId: c4.insertedId, dateKey: D1, subject: "BAN", kind: "WRITTEN", start: "07:30", end: "10:30", note: "" },
      { classId: c3.insertedId, dateKey: D2, subject: "ENG", kind: "WRITTEN", start: "07:30", end: "10:30", note: "" },
    ],
  });
  return {
    examId: exam.insertedId.toString(),
    c3: c3.insertedId.toString(),
    c4: c4.insertedId.toString(),
    office: ctxOf("OFFICE", ["exam_routine:manage", "exam_routine:view"]),
  };
}

const base = (s: { examId: string; c3: string }, teacherId: string, extra: Record<string, unknown> = {}) => ({
  examId: s.examId,
  classId: s.c3,
  dateKey: D1,
  subject: "BAN",
  kind: "WRITTEN",
  teacherId,
  ...extra,
});

describe("exam duty roster (D-#1660)", () => {
  it("assigns a teacher, notifies them, audits it; a sitting outside the routine is refused", async () => {
    const s = await setup();
    const a = await teacher("Amina");
    const duty = await assignExamDuty(s.office, base(s, a, { room: "২০১" }));
    expect(duty.teacherName).toBe("Amina");
    expect(duty.room).toBe("২০১");
    const notes = await Notification.find({ recipientUserId: a });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.titleBn).toContain("ডিউটি");
    expect(notes[0]!.refs?.screenTarget).toBe("SyllabusTab/MyExamDuty");
    expect(await Audit.countDocuments({ eventKind: "EXAM_SITTING_DUTY_ASSIGNED" })).toBe(1);

    await expect(assignExamDuty(s.office, base(s, a, { subject: "MATH" }))).rejects.toThrow("রুটিনে নেই");
  });

  it("the same teacher cannot take two seats of one sitting", async () => {
    const s = await setup();
    const a = await teacher("Amina");
    await assignExamDuty(s.office, base(s, a));
    await expect(assignExamDuty(s.office, base(s, a, { seat: 2 }))).rejects.toThrow("আগেই আছেন");
  });

  it("a swap needs a reason, tells both teachers, and A -> B -> A tells A again", async () => {
    const s = await setup();
    const a = await teacher("Amina");
    const b = await teacher("Bilal");
    await assignExamDuty(s.office, base(s, a));
    await expect(assignExamDuty(s.office, base(s, b))).rejects.toThrow("কারণ");

    await assignExamDuty(s.office, base(s, b, { reason: "অসুস্থ" }));
    expect((await Notification.find({ recipientUserId: b })).map((n) => n.titleBn)).toHaveLength(1);
    const aNotes = await Notification.find({ recipientUserId: a });
    expect(aNotes).toHaveLength(2); // assigned, then taken off
    expect(aNotes.some((n) => n.titleBn.includes("বাদ"))).toBe(true);

    await assignExamDuty(s.office, base(s, a, { reason: "সুস্থ হয়েছেন" }));
    // A again: a third row for A, with a distinct dedupe key.
    const after = await Notification.find({ recipientUserId: a });
    expect(after).toHaveLength(3);
    expect(new Set(after.map((n) => n.dedupeKey)).size).toBe(3);
    expect(await Audit.countDocuments({ eventKind: "EXAM_SITTING_DUTY_CHANGED" })).toBe(2);
    expect(await ExamSittingDuty.countDocuments({})).toBe(1);
  });

  it("clear needs a reason, tells the teacher and audits", async () => {
    const s = await setup();
    const a = await teacher("Amina");
    const duty = await assignExamDuty(s.office, base(s, a));
    await expect(clearExamDuty(s.office, duty.id, "")).rejects.toThrow("কারণ");
    await clearExamDuty(s.office, duty.id, "পরীক্ষা বাতিল");
    expect(await ExamSittingDuty.countDocuments({})).toBe(0);
    expect((await Notification.find({ recipientUserId: a })).some((n) => n.titleBn.includes("বাদ"))).toBe(true);
    expect(await Audit.countDocuments({ eventKind: "EXAM_SITTING_DUTY_CLEARED" })).toBe(1);
  });

  it("roster: counts, empty sittings, overlap and approved-leave conflicts", async () => {
    const s = await setup();
    const a = await teacher("Amina");
    const b = await teacher("Bilal", "01711111111");
    // Amina: class 3 and class 4 at the SAME time on D1 (overlap) + class 3 on D2.
    await assignExamDuty(s.office, base(s, a));
    await assignExamDuty(s.office, { ...base(s, a), classId: s.c4 });
    await assignExamDuty(s.office, { ...base(s, a), dateKey: D2, subject: "ENG" });
    // Bilal on approved leave on D1.
    const profile = await StaffProfile.collection.insertOne({ name: "Bilal", phone: "01711111111", active: true });
    await StaffLeaveApplication.collection.insertOne({
      staffProfileId: profile.insertedId,
      leaveType: "casual",
      fromKey: D1,
      toKey: D1,
      dayPart: "full",
      days: 1,
      reason: "x",
      status: "approved",
      appliedBy: new Types.ObjectId(),
    });
    await assignExamDuty(s.office, { ...base(s, b), seat: 2 });

    const r = await examDutyRoster(s.office, s.examId);
    expect(r.sittings).toHaveLength(3);
    expect(r.counts[0]).toMatchObject({ teacherName: "Amina", count: 3 });
    expect(r.emptyCount).toBe(0);
    const c3d1 = r.sittings.find((x) => x.classId === s.c3 && x.dateKey === D1)!;
    expect(c3d1.duties.find((d) => d.teacherName === "Amina")!.conflicts).toContain("OVERLAP");
    expect(c3d1.duties.find((d) => d.teacherName === "Bilal")!.conflicts).toEqual(["LEAVE"]);
    const d2 = r.sittings.find((x) => x.dateKey === D2)!;
    expect(d2.duties[0]!.conflicts).toEqual([]);
    expect(r.conflictCount).toBe(3);

    // A sitting with nobody on it counts as empty.
    await clearExamDuty(s.office, d2.duties[0]!.id, "বদল");
    expect((await examDutyRoster(s.office, s.examId)).emptyCount).toBe(1);
  });

  it("mine: a teacher sees only their own upcoming duties; Office-only calls refuse them", async () => {
    const s = await setup();
    const a = await teacher("Amina");
    const b = await teacher("Bilal");
    await assignExamDuty(s.office, base(s, a, { room: "১০১" }));
    await assignExamDuty(s.office, { ...base(s, b), classId: s.c4 });

    const mine = await myExamDuties(ctxOf("TEACHER", ["exam_routine:view"], a));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ dateKey: D1, subject: "BAN", classLabelBn: "৩য় শ্রেণি", start: "07:30", end: "10:30", room: "১০১" });

    const teacherCtx = ctxOf("TEACHER", ["exam_routine:view"], a);
    await expect(examDutyRoster(teacherCtx, s.examId)).rejects.toThrow("অনুমতি");
    await expect(assignExamDuty(teacherCtx, base(s, a))).rejects.toThrow("অনুমতি");
    await expect(myExamDuties(ctxOf("GUARDIAN", []))).rejects.toThrow("অনুমতি");
  });
});
