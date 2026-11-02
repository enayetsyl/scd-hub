/**
 * Mark-submission guard (D-#889–#893, docs/prd-mark-submission-guard.md) on a real
 * in-memory Mongo: the same-day correction record (both trackers, flip + undo), the
 * assignment first-chase guardian notice, and the Sunday ladder (MORNING / NINE / 09:30).
 *
 * Times are explicit Dhaka instants on Sun 2026-11-08; date-only anchors are LOCAL midnight
 * (the assignment calendar's convention), which lands on the same calendar day in UTC (CI)
 * and in Asia/Dhaka.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { Notification } from "../modules/notifications/models/Notification";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { MarkCorrectionNote } from "../modules/trackers/models/MarkCorrectionNote";
import { MarkEscalation, MarkReminderAck } from "../modules/trackers/models/MarkReminder";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { RoutineSubstitution } from "../modules/routine/models/RoutineSubstitution";
import { submitPass as asSubmitPass } from "../modules/trackers/services/AssignmentRosterPassService";
import { transitionRecord } from "../modules/trackers/services/HomeworkService";
import { revertHomeworkRecord } from "../modules/trackers/services/HomeworkRevertService";
import { listMarkCorrectionNotes } from "../modules/trackers/services/MarkCorrectionService";
import {
  acknowledgeMarkEscalation,
  acknowledgeMarkReminder,
  myMarkEscalation,
  myMarkReminder,
  runMarkEscalation,
} from "../modules/trackers/services/MarkReminderService";

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
    [
      User, Class, Section, Student, Guardian, GuardianLink, Notification, AssignmentItem, AssignmentStudentRecord,
      HomeworkItem, HomeworkStudentRecord, MarkCorrectionNote, MarkEscalation, MarkReminderAck, RoutineSlot,
      RoutineSubstitution,
    ].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})),
  );
});

const at = (hhmm: string, day = "2026-11-08") => new Date(`${day}T${hhmm}:00+06:00`);
const SUNDAY = new Date(2026, 10, 8); // local midnight — the date-only anchor convention
const MONDAY = new Date(2026, 10, 9);

async function user(name: string, role = "TEACHER"): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801700000${seq}`, passwordHash: "x",
    grantedPermissions: [], revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

async function section(): Promise<{ classId: Types.ObjectId; sectionId: Types.ObjectId }> {
  seq += 1;
  const c = await Class.collection.insertOne({ level: 3, nameBn: "তৃতীয় শ্রেণি", academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, code: `S${seq}`, nameBn: "বালক", active: true });
  return { classId: c.insertedId, sectionId: s.insertedId };
}

async function student(name: string, where: { classId: Types.ObjectId; sectionId: Types.ObjectId }): Promise<string> {
  seq += 1;
  const r = await Student.collection.insertOne({ schoolId: `S-${seq}`, name, ...where, active: true });
  return r.insertedId.toString();
}

async function guardianOf(studentId: string): Promise<string> {
  seq += 1;
  const r = await Guardian.collection.insertOne({
    identifierKind: "phone", identifier: `0190000${seq}`, name: `G${seq}`, phone: `8801900000${seq}`, loginEnabled: true, active: true,
  });
  await GuardianLink.collection.insertOne({ guardianId: r.insertedId, studentId: new Types.ObjectId(studentId), relation: "mother", active: true });
  return r.insertedId.toString();
}

async function asItem(opts: {
  where: { classId: Types.ObjectId; sectionId: Types.ObjectId };
  teacher: string;
  dueDate?: Date;
  subject?: string;
}): Promise<string> {
  seq += 1;
  const it = await AssignmentItem.create({
    asId: `AS-C3-MATH-${String(seq).padStart(4, "0")}`,
    academicYearId: new Types.ObjectId(),
    scheduleEntryId: new Types.ObjectId(),
    weekNumber: seq,
    cycleWeek: 1,
    classId: opts.where.classId,
    classLevel: 3,
    sectionId: opts.where.sectionId,
    subject: opts.subject ?? "MATH",
    teacherId: new Types.ObjectId(opts.teacher),
    deliveryDate: new Date(2026, 10, 5),
    dueDate: opts.dueDate ?? SUNDAY,
    estMinutes: 20,
    status: "ISSUED",
    deliveredBy: new Types.ObjectId(opts.teacher),
    deliveredAt: at("10:00", "2026-11-05"),
  });
  return it._id.toString();
}

async function asRecord(itemId: string, studentId: string, where: { classId: Types.ObjectId; sectionId: Types.ObjectId }, teacher: string) {
  const it = await AssignmentItem.findById(itemId).lean();
  const r = await AssignmentStudentRecord.create({
    asItemId: it!._id,
    asId: it!.asId,
    studentId: new Types.ObjectId(studentId),
    sectionId: where.sectionId,
    classId: where.classId,
    state: "GIVEN",
    stateDates: [{ state: "GIVEN", at: at("10:00", "2026-11-05"), by: new Types.ObjectId(teacher) }],
    chaseCount: 0,
    dueDate: it!.dueDate,
    issuedBy: new Types.ObjectId(teacher),
  });
  return r._id.toString();
}

async function hwRecord(opts: {
  where: { classId: Types.ObjectId; sectionId: Types.ObjectId };
  studentId: string;
  teacher: string;
  state: "DUE" | "CHASE";
  stamps: Array<{ state: string; at: Date; by?: Types.ObjectId }>;
}): Promise<{ itemId: string; recordId: string }> {
  seq += 1;
  const it = await HomeworkItem.create({
    hwId: `HW-C3-MATH-${String(seq).padStart(4, "0")}`,
    academicYearId: new Types.ObjectId(),
    classId: opts.where.classId,
    classLevel: 3,
    sectionId: opts.where.sectionId,
    subject: "MATH",
    dateGiven: new Date(2026, 10, 5),
    topTags: ["PRACTICE"],
    qCount: 3,
    declaredBy: new Types.ObjectId(opts.teacher),
  });
  const itemId = it._id;
  const hwId = it.hwId;
  const rec = await HomeworkStudentRecord.collection.insertOne({
    hwItemId: itemId, hwId, studentId: new Types.ObjectId(opts.studentId), sectionId: opts.where.sectionId,
    classId: opts.where.classId, state: opts.state, stateDates: opts.stamps, chaseCount: opts.state === "CHASE" ? 1 : 0,
    topupFlag: false, topupQids: [], issuedBy: new Types.ObjectId(opts.teacher),
  });
  return { itemId: String(itemId), recordId: String(rec.insertedId) };
}

const kinds = async (kind: string) => Notification.find({ kind }).lean();

describe("D-#891 — an assignment's first chase tells the family, with the gift warning", () => {
  it("first cross notifies once; a re-cross does not", async () => {
    const teacher = await user("Rahima");
    const where = await section();
    const a = await student("Ayaan", where);
    await guardianOf(a);
    const item = await asItem({ where, teacher });
    const rec = await asRecord(item, a, where, teacher);

    await asSubmitPass(item, [{ recordId: rec, submitted: false }], teacher, at("08:10"));
    const sent = await kinds("ASSIGNMENT_CHASE");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyBn).toContain("Ayaan");
    expect(sent[0]!.bodyBn).toContain("উপহার পাবে না");

    await asSubmitPass(item, [{ recordId: rec, submitted: false }], teacher, at("08:20"));
    expect(await kinds("ASSIGNMENT_CHASE")).toHaveLength(1);
  });
});

describe("D-#892/#893 — a same-day flip of a person-made chase is a recorded mistake", () => {
  it("assignment: chase at 08:10, flip at 10:00 → note, Office notified, guardian corrected", async () => {
    const teacher = await user("Rahima");
    const office = await user("Office", "OFFICE");
    const where = await section();
    const a = await student("Ayaan", where);
    const b = await student("Bushra", where);
    await guardianOf(a);
    await guardianOf(b);
    const item = await asItem({ where, teacher });
    const ra = await asRecord(item, a, where, teacher);
    const rb = await asRecord(item, b, where, teacher);

    await asSubmitPass(item, [{ recordId: ra, submitted: false }, { recordId: rb, submitted: false }], teacher, at("08:10"));
    const res = await asSubmitPass(item, [{ recordId: ra, submitted: true }, { recordId: rb, submitted: true }], teacher, at("10:00"));
    expect(res.correctedCount).toBe(2);

    const notes = await MarkCorrectionNote.find({}).lean();
    expect(notes).toHaveLength(1); // one wrong pass = one note
    expect(String(notes[0]!.staffUserId)).toBe(teacher);
    expect(notes[0]!.tracker).toBe("ASSIGNMENT");
    expect(notes[0]!.students.map((s) => s.via)).toEqual(["FLIP", "FLIP"]);

    const toOffice = await kinds("MARK_CORRECTION");
    expect(toOffice).toHaveLength(1); // once per note, not per child
    expect(String(toOffice[0]!.recipientUserId)).toBe(office);
    expect(await kinds("WORK_MARK_CORRECTED")).toHaveLength(2);
  });

  it("a chase from an earlier day flipped today is a late submission — no note", async () => {
    const teacher = await user("Rahima");
    await user("Office", "OFFICE");
    const where = await section();
    const a = await student("Ayaan", where);
    await guardianOf(a);
    const item = await asItem({ where, teacher });
    const ra = await asRecord(item, a, where, teacher);

    await asSubmitPass(item, [{ recordId: ra, submitted: false }], teacher, at("12:00", "2026-11-07"));
    const res = await asSubmitPass(item, [{ recordId: ra, submitted: true }], teacher, at("08:00"));
    expect(res.correctedCount).toBe(0);
    expect(await MarkCorrectionNote.countDocuments()).toBe(0);
    expect(await kinds("WORK_MARK_CORRECTED")).toHaveLength(0);
  });

  it("homework: a SYSTEM chase (no `by`) flipped the same day is not the teacher's mistake", async () => {
    const teacher = await user("Rahima");
    await user("Office", "OFFICE");
    const where = await section();
    const a = await student("Ayaan", where);
    const { recordId } = await hwRecord({
      where, studentId: a, teacher, state: "CHASE",
      stamps: [{ state: "GIVEN", at: at("09:00", "2026-11-05"), by: new Types.ObjectId(teacher) }, { state: "DUE", at: at("06:00") }, { state: "CHASE", at: at("07:00") }],
    });
    const moved = await transitionRecord({ recordId, toState: "SUBMITTED", actorId: teacher, at: at("10:00") });
    expect(moved.markCorrected).toBe(false);
    expect(await MarkCorrectionNote.countDocuments()).toBe(0);
  });

  it("homework: the note belongs to whoever made the chase, even when someone else corrects it", async () => {
    const chaser = await user("Proxy");
    const fixer = await user("Rahima");
    await user("Office", "OFFICE");
    const where = await section();
    const a = await student("Ayaan", where);
    await guardianOf(a);
    const { recordId } = await hwRecord({
      where, studentId: a, teacher: fixer, state: "CHASE",
      stamps: [{ state: "DUE", at: at("06:00") }, { state: "CHASE", at: at("08:00"), by: new Types.ObjectId(chaser) }],
    });
    await transitionRecord({ recordId, toState: "SUBMITTED", actorId: fixer, at: at("11:00") });
    const note = await MarkCorrectionNote.findOne({}).lean();
    expect(String(note!.staffUserId)).toBe(chaser);
    expect(String(note!.students[0]!.correctedBy)).toBe(fixer);
    expect((await kinds("WORK_MARK_CORRECTED"))[0]!.bodyBn).toContain("বাড়ির কাজ");
  });

  it("homework: undoing a same-day chase is the same mistake (via UNDO)", async () => {
    const teacher = await user("Rahima");
    await user("Office", "OFFICE");
    const where = await section();
    const a = await student("Ayaan", where);
    await guardianOf(a);
    const { recordId } = await hwRecord({
      where, studentId: a, teacher, state: "CHASE",
      stamps: [{ state: "DUE", at: at("06:00") }, { state: "CHASE", at: at("08:00"), by: new Types.ObjectId(teacher) }],
    });
    await revertHomeworkRecord({ recordId, actorId: teacher, admin: false, now: at("09:00") });
    const note = await MarkCorrectionNote.findOne({}).lean();
    expect(note!.students[0]!.via).toBe("UNDO");
    expect(await kinds("MARK_CORRECTION")).toHaveLength(1);

    const rows = await listMarkCorrectionNotes({ staffUserId: teacher });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.students[0]!.studentName).toBe("Ayaan");
    expect(rows[0]!.sectionLabel).toBe("তৃতীয় শ্রেণি · বালক");
  });
});

describe("D-#889/#890 — the Sunday ladder", () => {
  async function dueDay() {
    const teacher = await user("Rahima");
    const proxy = await user("Proxy");
    const office = await user("Office", "OFFICE");
    const where = await section();
    const a = await student("Ayaan", where);
    const item = await asItem({ where, teacher });
    const rec = await asRecord(item, a, where, teacher);
    // Rahima is away on Sunday; Proxy covers a section slot of the same section.
    const slot = await RoutineSlot.collection.insertOne({
      groupType: "section", groupId: where.sectionId, classId: where.classId, dayOfWeek: "SUN", periodNumber: 1,
      subject: "MATH", track: "general", isBreak: false, teacherId: new Types.ObjectId(teacher),
      effectiveFrom: new Date(2026, 0, 1), active: true, createdBy: new Types.ObjectId(office),
    });
    await RoutineSubstitution.collection.insertOne({
      slotId: slot.insertedId, date: SUNDAY, coverTeacherId: new Types.ObjectId(proxy),
      absentTeacherId: new Types.ObjectId(teacher), active: true, createdBy: new Types.ObjectId(office),
    });
    return { teacher, proxy, office, where, item, rec };
  }

  it("first open: MORNING for the deliverer and the due-day proxy, once", async () => {
    const t = await dueDay();
    for (const who of [t.teacher, t.proxy]) {
      const r = await myMarkReminder(who, at("07:30"));
      expect(r?.stage).toBe("MORNING");
      expect(r?.items.map((i) => i.marked)).toEqual([false]);
      await acknowledgeMarkReminder(who, "MORNING", at("07:31"));
      expect(await myMarkReminder(who, at("08:00"))).toBeNull();
    }
    expect(await myMarkReminder(t.office, at("07:30"))).toBeNull(); // not their assignment
  });

  it("09:00: NINE while unmarked; closing it ends the day's pop-ups; marked = never shown", async () => {
    const t = await dueDay();
    await acknowledgeMarkReminder(t.teacher, "MORNING", at("07:31"));
    const nine = await myMarkReminder(t.teacher, at("09:05"));
    expect(nine?.stage).toBe("NINE");
    await acknowledgeMarkReminder(t.teacher, "NINE", at("09:06"));
    expect(await myMarkReminder(t.teacher, at("09:10"))).toBeNull();

    // The proxy marks before 09:00 → no NINE for anyone on this item.
    await asSubmitPass(t.item, [{ recordId: t.rec, submitted: true }], t.proxy, at("08:50"));
    await acknowledgeMarkReminder(t.proxy, "MORNING", at("08:51"));
    expect(await myMarkReminder(t.proxy, at("09:05"))).toBeNull();
  });

  it("09:30: one snapshot + one push per alert holder; the pop-up shows marked-since; nothing unmarked = nothing", async () => {
    const t = await dueDay();
    expect(await runMarkEscalation(at("09:30"))).toBe(1);
    expect(await runMarkEscalation(at("09:31"))).toBe(0); // idempotent per day
    const pushed = await kinds("MARK_SUBMISSION_ESCALATION");
    expect(pushed.map((n) => String(n.recipientUserId))).toEqual([t.office]);

    let list = await myMarkEscalation(t.office, at("09:40"));
    expect(list?.rows).toHaveLength(1);
    expect(list!.rows[0]!.teacherNames.sort()).toEqual(["Proxy", "Rahima"]);
    expect(list!.rows[0]!.markedNow).toBe(false);

    await asSubmitPass(t.item, [{ recordId: t.rec, submitted: true }], t.teacher, at("09:45"));
    list = await myMarkEscalation(t.office, at("09:50"));
    expect(list!.rows[0]!.markedNow).toBe(true);
    await acknowledgeMarkEscalation(t.office, at("09:51"));
    expect(await myMarkEscalation(t.office, at("10:00"))).toBeNull();
  });

  it("a holiday-rolled due date rings on the rolled day, not on Sunday; all marked = no escalation", async () => {
    const teacher = await user("Rahima");
    await user("Office", "OFFICE");
    const where = await section();
    const a = await student("Ayaan", where);
    const item = await asItem({ where, teacher, dueDate: MONDAY });
    const rec = await asRecord(item, a, where, teacher);
    expect(await myMarkReminder(teacher, at("07:30"))).toBeNull();
    expect((await myMarkReminder(teacher, at("07:30", "2026-11-09")))?.stage).toBe("MORNING");

    await asSubmitPass(item, [{ recordId: rec, submitted: true }], teacher, at("08:00", "2026-11-09"));
    expect(await runMarkEscalation(at("09:30", "2026-11-09"))).toBe(0);
    expect(await MarkEscalation.countDocuments()).toBe(0);
  });
});
