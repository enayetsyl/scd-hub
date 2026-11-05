/**
 * Staff mistake record (D-#936–#939, docs/prd-staff-mistakes.md) on a real in-memory Mongo:
 * the reason picked on the submit pass, the guardian message it chooses, the explanation
 * deadline, and the reviewer's decisions.
 *
 * Times are explicit Dhaka instants on Sun 2026-11-08 (the next school day is Mon 11-09).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { staffMistakeReasonError } from "@scd/shared";
import { User } from "../modules/foundation/models/User";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { Notification } from "../modules/notifications/models/Notification";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import { MarkCorrectionNote } from "../modules/trackers/models/MarkCorrectionNote";
import { StaffMistake } from "../modules/staff-mistakes/models/StaffMistake";
import { submitPass as asSubmitPass } from "../modules/trackers/services/AssignmentRosterPassService";
import { transitionAssignmentRecord } from "../modules/trackers/services/AssignmentService";
import { runWithCorrectionReason } from "../modules/staff-mistakes/services/correctionReasonContext";
import {
  decideMistake,
  explainDeadline,
  explainMistake,
  listMoveTargets,
  listStaffMistakes,
} from "../modules/staff-mistakes/services/StaffMistakeService";
import { hiddenOwnersFor, warningAudience } from "../modules/staff-mistakes/services/principalPrivacy";

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
    [User, Class, Section, Student, Guardian, GuardianLink, Notification, AssignmentItem, AssignmentStudentRecord, MarkCorrectionNote, StaffMistake].map(
      (m) => (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

const at = (hhmm: string, day = "2026-11-08") => new Date(`${day}T${hhmm}:00+06:00`);

async function user(name: string, role = "TEACHER"): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801711000${seq}`, passwordHash: "x",
    grantedPermissions: [], revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

/** One class, one child with a login-enabled guardian, one assignment record (GIVEN). */
async function fixture(teacher: string): Promise<{ item: string; rec: string }> {
  seq += 1;
  const c = await Class.collection.insertOne({ level: 4, nameBn: "চতুর্থ শ্রেণি", academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, code: `S${seq}`, nameBn: "বালক", active: true });
  const where = { classId: c.insertedId, sectionId: s.insertedId };
  const st = await Student.collection.insertOne({ schoolId: `S-${seq}`, name: "Ayaan Rahman", ...where, active: true });
  const g = await Guardian.collection.insertOne({
    identifierKind: "phone", identifier: `0191100${seq}`, name: `G${seq}`, phone: `8801911000${seq}`, loginEnabled: true, active: true,
  });
  await GuardianLink.collection.insertOne({ guardianId: g.insertedId, studentId: st.insertedId, relation: "mother", active: true });
  const it = await AssignmentItem.create({
    asId: `AS-C4-ENG-${String(seq).padStart(4, "0")}`,
    academicYearId: new Types.ObjectId(),
    scheduleEntryId: new Types.ObjectId(),
    weekNumber: seq,
    cycleWeek: 1,
    classId: where.classId,
    classLevel: 4,
    sectionId: where.sectionId,
    subject: "ENG",
    teacherId: new Types.ObjectId(teacher),
    deliveryDate: new Date(2026, 10, 5),
    dueDate: new Date(2026, 10, 8),
    estMinutes: 20,
    status: "ISSUED",
    deliveredBy: new Types.ObjectId(teacher),
    deliveredAt: at("10:00", "2026-11-05"),
  });
  const r = await AssignmentStudentRecord.create({
    asItemId: it._id, asId: it.asId, studentId: st.insertedId, sectionId: where.sectionId, classId: where.classId,
    state: "GIVEN", stateDates: [{ state: "GIVEN", at: at("10:00", "2026-11-05"), by: new Types.ObjectId(teacher) }],
    chaseCount: 0, dueDate: it.dueDate, issuedBy: new Types.ObjectId(teacher),
  });
  return { item: it._id.toString(), rec: r._id.toString() };
}

/** Chase at 08:10, then flip at 10:00 — optionally with a reason on the pass. */
async function chaseThenFlip(teacher: string, reason?: { code: string; text: string }, fixer = teacher) {
  const { item, rec } = await fixture(teacher);
  await asSubmitPass(item, [{ recordId: rec, submitted: false }], teacher, at("08:10"));
  await runWithCorrectionReason(reason, () => asSubmitPass(item, [{ recordId: rec, submitted: true }], fixer, at("10:00")));
  return { item, rec };
}

const kinds = async (kind: string) => Notification.find({ kind }).lean();
const onlyMistake = async () => {
  const rows = await StaffMistake.find({}).lean();
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

describe("D-#937 — the reason picked on the submit pass", () => {
  it('"MINE" counts at once — no explanation asked, the guardian gets the apology', async () => {
    const teacher = await user("Tanvir");
    await user("Office", "OFFICE");
    await chaseThenFlip(teacher, { code: "MINE", text: "" });

    const m = await onlyMistake();
    expect(String(m.staffUserId)).toBe(teacher);
    expect(m.kind).toBe("MARK_CORRECTION");
    expect(m.status).toBe("COUNTED");
    expect(m.reasonCode).toBe("MINE");
    expect(m.autoCounted).toBe(false);
    expect(await kinds("STAFF_MISTAKE_EXPLAIN")).toHaveLength(0);
    const g = await kinds("WORK_MARK_CORRECTED");
    expect(g).toHaveLength(1);
    expect(g[0]!.titleBn).toContain("দুঃখিত");
    expect(await kinds("MARK_CORRECTION")).toHaveLength(1); // Office + Principal still told (D-#893)
  });

  it('"LATE_DIRECT" waits for review and changes the guardian\'s message (D-#938)', async () => {
    const teacher = await user("Tanvir");
    await chaseThenFlip(teacher, { code: "LATE_DIRECT", text: "ক্যাপ্টেনের কাছে দেয়নি, পরে আমার হাতে দিয়েছে" });

    const m = await onlyMistake();
    expect(m.status).toBe("PENDING_REVIEW");
    expect(m.reasonText).toContain("ক্যাপ্টেন");
    const g = await kinds("WORK_MARK_CORRECTED");
    expect(g[0]!.titleBn).toBe("কাজ পরে জমা হয়েছে");
    expect(g[0]!.bodyBn).toContain("অফিসে জমা দেয়নি");
    expect(g[0]!.bodyBn).not.toContain("দুঃখিত");
  });

  it("no reason (card tap / undo path) → explanation due by 17:00 next school day, person notified", async () => {
    const teacher = await user("Tanvir");
    const { rec } = await fixture(teacher);
    const item = (await AssignmentStudentRecord.findById(rec).lean())!.asItemId.toString();
    await asSubmitPass(item, [{ recordId: rec, submitted: false }], teacher, at("08:10"));
    await transitionAssignmentRecord(rec, "SUBMITTED", teacher, at("10:00"));

    const m = await onlyMistake();
    expect(m.status).toBe("EXPLANATION_DUE");
    expect(m.explainDueAt.toISOString()).toBe(at("17:00", "2026-11-09").toISOString());
    const sent = await kinds("STAFF_MISTAKE_EXPLAIN");
    expect(sent).toHaveLength(1);
    expect(String(sent[0]!.recipientUserId)).toBe(teacher);
    // D-#1012: the notice names the place and the thing, and the deadline in words.
    expect(sent[0]!.titleBn).toBe('ব্যাখ্যা দিন: একই দিনে "জমা দেয়নি" বদলানো');
    expect(sent[0]!.bodyBn).toContain("AS-C4-ENG-");
    expect(sent[0]!.bodyBn).toContain("Ayaan Rahman");
    expect(sent[0]!.bodyBn).toContain("৯ নভেম্বর বিকেল ৫টা");
    expect(sent[0]!.bodyBn).not.toMatch(/PM|AM| এ /);
    expect((await kinds("WORK_MARK_CORRECTED"))[0]!.titleBn).toContain("দুঃখিত");
  });

  it("someone else's correction: their reason does not answer for the chaser", async () => {
    const chaser = await user("Proxy");
    const fixer = await user("Tanvir");
    await chaseThenFlip(chaser, { code: "MINE", text: "" }, fixer);

    const m = await onlyMistake();
    expect(String(m.staffUserId)).toBe(chaser);
    expect(m.status).toBe("EXPLANATION_DUE");
    expect(m.reasonCode).toBeNull();
  });
});

describe("D-#937 — explaining later, and the deadline", () => {
  async function dueRow(): Promise<{ teacher: string; id: string }> {
    const teacher = await user("Tanvir");
    const { rec } = await fixture(teacher);
    const item = (await AssignmentStudentRecord.findById(rec).lean())!.asItemId.toString();
    await asSubmitPass(item, [{ recordId: rec, submitted: false }], teacher, at("08:10"));
    await transitionAssignmentRecord(rec, "SUBMITTED", teacher, at("10:00"));
    return { teacher, id: String((await onlyMistake())._id) };
  }

  it("OTHER needs text; with text it goes to review; a stranger cannot explain it", async () => {
    const { teacher, id } = await dueRow();
    const other = await user("Someone");
    const now = at("12:00");
    await expect(explainMistake({ mistakeId: id, actorId: teacher, reasonCode: "OTHER", reasonText: " ", now })).rejects.toThrow("বিস্তারিত");
    await expect(explainMistake({ mistakeId: id, actorId: other, reasonCode: "MINE", reasonText: "", now })).rejects.toThrow("নিজের");
    const row = await explainMistake({ mistakeId: id, actorId: teacher, reasonCode: "OTHER", reasonText: "খাতা ভুল তাকে ছিল", now });
    expect(row.status).toBe("PENDING_REVIEW");
    // Re-explaining before a decision replaces the reason.
    const again = await explainMistake({ mistakeId: id, actorId: teacher, reasonCode: "MINE", reasonText: "", now });
    expect(again.status).toBe("COUNTED");
  });

  it("past the deadline it counts on its own, and can no longer be explained", async () => {
    const { teacher, id } = await dueRow();
    const late = at("17:01", "2026-11-09");
    const rows = await listStaffMistakes({ staffUserId: teacher, now: late });
    expect(rows[0]!.status).toBe("COUNTED");
    expect(rows[0]!.autoCounted).toBe(true);
    await expect(explainMistake({ mistakeId: id, actorId: teacher, reasonCode: "MINE", reasonText: "", now: late })).rejects.toThrow("সময় পেরিয়ে");
  });

  it("deadline skips the weekend: Thursday → Sunday 17:00", () => {
    expect(explainDeadline(at("15:00", "2026-11-12")).toISOString()).toBe(at("17:00", "2026-11-15").toISOString());
    expect(explainDeadline(at("23:30", "2026-11-08")).toISOString()).toBe(at("17:00", "2026-11-09").toISOString());
  });
});

describe("D-#939 — the reviewer's decision", () => {
  it("excuse: kept, not counted, the person is told; nobody decides their own", async () => {
    const teacher = await user("Tanvir");
    const office = await user("Kamrul", "OFFICE");
    await chaseThenFlip(teacher, { code: "LATE_DIRECT", text: "" });
    const id = String((await onlyMistake())._id);

    await expect(decideMistake({ mistakeId: id, actorId: teacher, decision: "EXCUSE" })).rejects.toThrow("নিজের");
    const row = await decideMistake({ mistakeId: id, actorId: office, decision: "EXCUSE", note: "ঠিক আছে" });
    expect(row.status).toBe("EXCUSED");
    expect(row.decisionNote).toBe("ঠিক আছে");
    const told = await kinds("STAFF_MISTAKE_DECIDED");
    expect(told).toHaveLength(1);
    expect(String(told[0]!.recipientUserId)).toBe(teacher);
    expect(told[0]!.bodyBn).toContain("ঠিক আছে");

    // A reviewer may change their own call; the person hears again.
    const counted = await decideMistake({ mistakeId: id, actorId: office, decision: "COUNT" });
    expect(counted.status).toBe("COUNTED");
    expect(await kinds("STAFF_MISTAKE_DECIDED")).toHaveLength(2);
  });

  it("move: the original is MOVED, the other person must now explain", async () => {
    const teacher = await user("Farhana");
    const office = await user("Kamrul", "OFFICE");
    const principal = await user("Principal", "PRINCIPAL");
    await chaseThenFlip(teacher, { code: "OFFICE_LATE", text: "বান্ডিল তাকে পড়ে ছিল" });
    const id = String((await onlyMistake())._id);

    await expect(decideMistake({ mistakeId: id, actorId: principal, decision: "MOVE" })).rejects.toThrow("বেছে নিন");
    await expect(decideMistake({ mistakeId: id, actorId: principal, decision: "MOVE", moveToUserId: teacher })).rejects.toThrow("একই");
    const row = await decideMistake({ mistakeId: id, actorId: principal, decision: "MOVE", moveToUserId: office });
    expect(row.status).toBe("MOVED");

    const moved = await StaffMistake.findOne({ staffUserId: office }).lean();
    expect(moved!.status).toBe("EXPLANATION_DUE");
    expect(String(moved!.movedFromId)).toBe(id);
    expect(String(row.movedToId)).toBe(String(moved!._id));
    const ask = await kinds("STAFF_MISTAKE_EXPLAIN");
    expect(ask.map((n) => String(n.recipientUserId))).toEqual([office]);

    await expect(decideMistake({ mistakeId: id, actorId: principal, decision: "COUNT" })).rejects.toThrow("সরানো");
    const list = await listStaffMistakes({ staffUserId: teacher });
    expect(list[0]!.movedToName).toBe("Kamrul");
    expect(list[0]!.decidedByName).toBe("Principal");
  });
});

describe("shared reason list", () => {
  it("rejects an unknown code and over-long text", () => {
    expect(staffMistakeReasonError("MARK_CORRECTION", "NOPE", "")).toBe("অজানা কারণ");
    expect(staffMistakeReasonError("MARK_CORRECTION", "MINE", "x".repeat(501))).toContain("500");
    expect(staffMistakeReasonError("MARK_CORRECTION", "LATE_DIRECT", "")).toBeNull();
  });
});

describe("D-#1000 — the Principal's entries are the Principal's alone", () => {
  const entry = (owner: string) =>
    StaffMistake.create({ staffUserId: new Types.ObjectId(owner), kind: "TASK_OVERDUE", tier: 3, sourceId: new Types.ObjectId(), dateKey: "2026-11-08", status: "PENDING_REVIEW", explainDueAt: at("17:00", "2026-11-09") });

  it("Office cannot decide, see or move onto the Principal; the Principal decides their own", async () => {
    const principal = await user("Principal", "PRINCIPAL");
    const office = await user("Office", "OFFICE");
    const teacher = await user("Rahima");
    const mine = await entry(principal);
    const theirs = await entry(teacher);

    await expect(decideMistake({ mistakeId: String(mine._id), actorId: office, mayHandlePrincipal: false, decision: "EXCUSE" })).rejects.toThrow("শুধু প্রধান শিক্ষক");
    await expect(
      decideMistake({ mistakeId: String(theirs._id), actorId: office, mayHandlePrincipal: false, decision: "MOVE", moveToUserId: principal }),
    ).rejects.toThrow("প্রধান শিক্ষকের নামে");
    expect((await listMoveTargets(false)).map((t) => t.userId)).not.toContain(principal);
    expect((await listMoveTargets(true)).map((t) => t.userId)).toContain(principal);

    const officeView = await listStaffMistakes({ hideStaffUserIds: await hiddenOwnersFor(false) });
    expect(officeView.map((r) => r.staffUserId)).toEqual([teacher]);
    expect(await listStaffMistakes({ staffUserId: principal, hideStaffUserIds: await hiddenOwnersFor(false) })).toEqual([]);
    expect((await listStaffMistakes({ hideStaffUserIds: await hiddenOwnersFor(true) })).length).toBe(2);

    // The Principal decides their own entry; nobody else is still refused their own.
    const own = await decideMistake({ mistakeId: String(mine._id), actorId: principal, mayHandlePrincipal: true, decision: "EXCUSE" });
    expect(own.status).toBe("EXCUSED");
    expect(await Notification.countDocuments({ recipientUserId: new Types.ObjectId(principal), kind: "STAFF_MISTAKE_DECIDED" })).toBe(0);
    await expect(decideMistake({ mistakeId: String(theirs._id), actorId: teacher, mayHandlePrincipal: true, decision: "EXCUSE" })).rejects.toThrow("নিজের");
  });

  it("a Principal's warning is told only to other holders of review_principal", async () => {
    const p1 = await user("Principal", "PRINCIPAL");
    const p2 = await user("Vice", "PRINCIPAL");
    const office = await user("Office", "OFFICE");
    const teacher = await user("Rahima");
    expect(await warningAudience([p1, p2, office], p1)).toEqual([p2]);
    expect(await warningAudience([p1, office], teacher)).toEqual([p1, office]);
  });
});
