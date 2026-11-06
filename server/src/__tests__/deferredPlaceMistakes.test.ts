/**
 * Staff mistake record MR-9 — the places deferred from MR-6..8, on a real in-memory Mongo:
 *
 *   D-#1002  a delivered Saturday-revision entry corrected: old version kept, family told
 *            (সংশোধনী), tier 1 for the old author; nothing-changed / undelivered / wrong group refused
 *   D-#1003  class-test marks past the deadline with the teacher: tier 3 once per test
 *   D-#1004  tier 2 — a second salary in one month (reversal does not add a second entry),
 *            a guardian link undone soon after by someone else, a retired question restored by
 *            someone else, a re-uploaded staff sheet that changes rows, absent at delivery
 *            while the register says present
 *
 * (D-#1001, Quran marks after an unlock, is in quranExam.test.ts.)
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
import { Audit } from "../modules/platform/models/Audit";
import { StaffMistake } from "../modules/staff-mistakes/models/StaffMistake";
import { StaffMistakeNote } from "../modules/staff-mistakes/models/StaffMistakeNote";
import { FinancePosting } from "../modules/finance/models/FinancePosting";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { StudentAttendanceDay } from "../modules/attendance/models/StudentAttendanceDay";
import { RevisionEntry } from "../modules/saturday-revision/models/RevisionEntry";
import { recordPosting, reversePosting } from "../modules/finance/services/FinanceSnapshotService";
import { recordGuardianUnlink } from "../modules/foundation/services/guardianLinkMistake";
import { restoreQuestion } from "../modules/questions/services/QuestionEditService";
import { recordReimportChanges } from "../modules/attendance/services/TeacherAttendanceService";
import { recordAbsentAtDelivery } from "../modules/trackers/services/deliveryAttendanceCheck";
import { recordLateClassTestMarks } from "../modules/trackers/services/ClassTestSummaryService";
import { correctDeliveredEntry } from "../modules/saturday-revision/services/RevisionDeliveryService";

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
    [User, Class, Section, Student, Guardian, GuardianLink, Notification, Audit, StaffMistake, StaffMistakeNote, FinancePosting, ContentArtifact, StudentAttendanceDay, RevisionEntry].map(
      (m) => (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

async function user(name: string, role = "OFFICE"): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801755000${seq}`, passwordHash: "x",
    // D-#1016: these suites test the told flow (explain notice, decisions, warnings).
    grantedPermissions: ["staff_mistakes:view_own"], revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

async function section(): Promise<{ classId: Types.ObjectId; sectionId: Types.ObjectId }> {
  seq += 1;
  const c = await Class.collection.insertOne({ level: 3, nameBn: "তৃতীয় শ্রেণি", academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, code: `S${seq}`, nameBn: "ক", active: true });
  return { classId: c.insertedId, sectionId: s.insertedId };
}

async function student(name: string, at: { classId: Types.ObjectId; sectionId: Types.ObjectId }): Promise<string> {
  seq += 1;
  const r = await Student.collection.insertOne({ schoolId: `S-${seq}`, name, classId: at.classId, sectionId: at.sectionId, active: true });
  return r.insertedId.toString();
}

const entries = async () =>
  (await StaffMistake.find({}).sort({ createdAt: 1 }).lean()).map((r) => [r.kind, String(r.staffUserId), r.tier, r.status]);

describe("D-#1004 — a second salary in one month", () => {
  const sal = (date: string, amount: number) => ({ date: new Date(`${date}T00:00:00Z`), kind: "EXPENSE", mode: "BANK", expenseHead: "SALARY", amount });

  it("the second live SALARY posting in a month asks its entrant; another month or a reversed first does not", async () => {
    const a = await user("Akhtar");
    const b = await user("Shirin");
    await recordPosting(sal("2026-10-05", 500000), { userId: a, role: "OFFICE" });
    await recordPosting(sal("2026-11-05", 500000), { userId: a, role: "OFFICE" }); // another month
    expect(await entries()).toEqual([]);
    const second = await recordPosting(sal("2026-10-28", 500000), { userId: b, role: "OFFICE" });
    expect(await entries()).toEqual([["SALARY_ENTERED_TWICE", b, 2, "EXPLANATION_DUE"]]);
    // Reversing the duplicate is the same mistake — no second (FINANCE_REVERSAL) entry.
    await reversePosting(String(second._id), { userId: a, role: "OFFICE" });
    expect((await entries()).map((r) => r[0])).toEqual(["SALARY_ENTERED_TWICE"]);
    // With the duplicate reversed, a later salary that month is again the only live one besides the first.
    await StaffMistake.deleteMany({});
    await StaffMistakeNote.deleteMany({});
    const first = await FinancePosting.findOne({ amount: 500000, reversesPostingId: null, date: new Date("2026-10-05T00:00:00Z") }).lean();
    await reversePosting(String(first!._id), { userId: b, role: "OFFICE" });
    await StaffMistake.deleteMany({});
    await recordPosting(sal("2026-10-30", 480000), { userId: b, role: "OFFICE" });
    expect(await entries()).toEqual([]);
  });
});

describe("D-#1004 — a guardian link undone soon after", () => {
  async function linked(by: string, daysAgo: number): Promise<{ g: string; s: string }> {
    const g = new Types.ObjectId().toString();
    const s = new Types.ObjectId().toString();
    await Audit.collection.insertOne({ eventKind: "GUARDIAN_LINK", actorId: new Types.ObjectId(by), eventAt: new Date(Date.now() - daysAgo * 86_400_000), meta: { guardianId: g, studentId: s, relation: "mother" } });
    return { g, s };
  }

  it("someone else unlinking within 30 days is the linker's; own unlink or an old link is not", async () => {
    const linker = await user("Linker");
    const other = await user("Other");
    const fresh = await linked(linker, 3);
    expect(await recordGuardianUnlink(fresh.g, fresh.s, other)).toBe(true);
    const own = await linked(linker, 2);
    expect(await recordGuardianUnlink(own.g, own.s, linker)).toBe(false);
    const old = await linked(linker, 45);
    expect(await recordGuardianUnlink(old.g, old.s, other)).toBe(false);
    expect(await entries()).toEqual([["GUARDIAN_LINK_UNDONE", linker, 2, "EXPLANATION_DUE"]]);
  });
});

describe("D-#1004 — a retired question restored", () => {
  async function retiredQuestion(retiredBy: string): Promise<string> {
    const r = await ContentArtifact.collection.insertOne({
      docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "q", number: 1 },
      curationTag: "KEEP_AS_IS", reviewStatus: "gold", envelopeJson: { payload: { qid: "QP-MATH-C3-U01-Q001" } },
      current: true, importedBy: new Types.ObjectId(), importedAt: new Date(),
      retiredAt: new Date(), retiredBy: new Types.ObjectId(retiredBy), retireReason: "duplicate",
    });
    return r.insertedId.toString();
  }

  it("restored by someone else → the retirer's tier 2; undoing your own retire → nothing", async () => {
    const retirer = await user("Retirer");
    const restorer = await user("Restorer", "PRINCIPAL");
    await restoreQuestion({ artifactId: await retiredQuestion(retirer), actorId: restorer });
    await restoreQuestion({ artifactId: await retiredQuestion(retirer), actorId: retirer });
    expect(await entries()).toEqual([["QUESTION_RESTORED", retirer, 2, "EXPLANATION_DUE"]]);
    const note = await StaffMistakeNote.findOne({ kind: "QUESTION_RESTORED" }).lean();
    expect(note!.lines[0]!.text).toContain("QP-MATH-C3-U01-Q001");
  });
});

describe("D-#1004 — a staff attendance sheet uploaded again", () => {
  it("rows another person's upload changed → one entry for that uploader; ABSENT → LEAVE and own re-upload do not count", async () => {
    const first = await user("First");
    const second = await user("Second");
    const p = [0, 1, 2, 3].map(() => new Types.ObjectId());
    const row = (i: number, status: string, by: string, extra: Record<string, unknown> = {}) => ({
      staffProfileId: p[i]!, status, punchIn: "07:01 AM", punchOut: "02:00 PM", halfDay: false, importedBy: new Types.ObjectId(by), ...extra,
    });
    const before = [row(0, "PRESENT", first), row(1, "ABSENT", first), row(2, "PRESENT", first), row(3, "PRESENT", first)];
    const after = [row(0, "LATE", second, { punchIn: "07:40 AM" }), row(1, "LEAVE", second), row(2, "PRESENT", second)]; // p3 dropped
    await recordReimportChanges("2026-11-03", before as never, after as never, second);
    await recordReimportChanges("2026-11-04", before as never, after as never, first); // own re-upload
    expect(await entries()).toEqual([["STAFF_ATTENDANCE_REIMPORTED", first, 2, "EXPLANATION_DUE"]]);
    const note = await StaffMistakeNote.findOne({ kind: "STAFF_ATTENDANCE_REIMPORTED" }).lean();
    expect(note!.lines[0]!.text).toMatch(/2026-11-03: নতুন শিটে 2 জনের/);
  });
});

describe("D-#1004 — absent at delivery while the register says present", () => {
  it("names only the children the marked register shows present; an unmarked unit proves nothing", async () => {
    const teacher = await user("Teacher", "TEACHER");
    const marker = await user("Marker", "TEACHER");
    const at = await section();
    const inSchool = await student("Rafi", at);
    const away = await student("Nabil", at);
    const DAY = "2026-07-01"; // before the unit cut-over → the section is the unit
    await StudentAttendanceDay.collection.insertOne({ sectionId: at.sectionId, dateKey: DAY, absentStudentIds: [new Types.ObjectId(away)], markedBy: new Types.ObjectId(marker), markedAt: new Date() });
    const base = { tracker: "as" as const, label: "AS-0001", absentStudentIds: [inSchool, away], ownerId: teacher, at: new Date() };
    expect(await recordAbsentAtDelivery({ ...base, itemId: "item-1", dateKey: DAY })).toBe(true);
    expect(await recordAbsentAtDelivery({ ...base, itemId: "item-2", dateKey: "2026-07-02" })).toBe(false); // register not marked
    expect(await recordAbsentAtDelivery({ ...base, itemId: "item-3", dateKey: DAY, absentStudentIds: [away] })).toBe(false);
    expect(await entries()).toEqual([["ABSENT_AT_DELIVERY", teacher, 2, "EXPLANATION_DUE"]]);
    const note = await StaffMistakeNote.findOne({ kind: "ABSENT_AT_DELIVERY" }).lean();
    expect(note!.lines[0]!.text).toContain("Rafi");
    expect(note!.lines[0]!.text).not.toContain("Nabil");
  });
});

describe("D-#1003 — class-test marks past the deadline", () => {
  it("the teacher's part only, once per test however many mornings", async () => {
    const t = await user("CT Teacher", "TEACHER");
    const row = (testId: string, teacherOverdue: boolean) => ({
      testId, ctId: `CT-${testId}`, deadline: "2026-11-02T18:00:00.000Z", overdue: true, teacherOverdue, teacherId: t,
    });
    const rows = [row("t1", true), row("t2", false)];
    expect(await recordLateClassTestMarks(new Date(), rows)).toBe(1);
    expect(await recordLateClassTestMarks(new Date(), rows)).toBe(0);
    expect(await entries()).toEqual([["CT_MARKS_OVERDUE", t, 3, "EXPLANATION_DUE"]]);
  });
});

describe("D-#1002 — correcting a delivered Saturday-revision entry", () => {
  it("keeps the old version, tells the family once per correction and records the old author's mistake", async () => {
    const author = await user("Hafez", "TEACHER");
    const fixer = await user("Office");
    const at = await section();
    const sid = await student("Ibrahim", at);
    const g = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: "01911111111", name: "Mother", phone: "8801911111111", loginEnabled: true, active: true });
    await GuardianLink.collection.insertOne({ guardianId: g.insertedId, studentId: new Types.ObjectId(sid), relation: "mother", active: true });
    const groupId = new Types.ObjectId();
    const date = new Date("2026-10-31T00:00:00Z");
    const make = async (delivered: boolean) =>
      String((await RevisionEntry.collection.insertOne({
        groupId, studentId: new Types.ObjectId(sid), date: delivered ? date : new Date("2026-11-07T00:00:00Z"), present: true, portions: [],
        teacherComment: "ভালো", teacherUserId: new Types.ObjectId(author), deliveryChannels: ["inbox"], createdAt: new Date(), updatedAt: new Date(), ...(delivered ? { deliveredAt: new Date() } : {}),
      })).insertedId);
    const id = await make(true);
    const input = { entryId: id, groupId: String(groupId), present: false, note: "ভুল করে উপস্থিত দেওয়া হয়েছিল", actorId: fixer };

    await expect(correctDeliveredEntry({ ...input, note: "  " })).rejects.toThrow(/কেন সংশোধন/);
    await expect(correctDeliveredEntry({ ...input, groupId: new Types.ObjectId().toString() })).rejects.toThrow(/not in this group/);
    await expect(correctDeliveredEntry({ ...input, entryId: await make(false) })).rejects.toThrow(/এখনো পাঠানো হয়নি/);

    const out = await correctDeliveredEntry(input);
    expect(out.present).toBe(false);
    const doc = await RevisionEntry.findById(id).lean();
    expect(doc!.corrections).toHaveLength(1);
    expect(doc!.corrections![0]!.before).toMatchObject({ present: true, teacherComment: "ভালো" });
    expect(String(doc!.corrections![0]!.before.teacherUserId)).toBe(author);
    expect(String(doc!.teacherUserId)).toBe(fixer);

    await expect(correctDeliveredEntry(input)).rejects.toThrow(/কিছুই বদলায়নি/);
    await correctDeliveredEntry({ ...input, present: true, note: "আসলে উপস্থিত ছিল" });

    const sent = await Notification.find({ recipientGuardianId: g.insertedId }).lean();
    expect(sent).toHaveLength(2);
    expect(sent.every((n) => n.titleBn.startsWith("সংশোধনী: "))).toBe(true);
    expect((await entries()).map((r) => [r[0], r[1], r[2]])).toEqual([
      ["REVISION_ENTRY_CORRECTED", author, 1],
      ["REVISION_ENTRY_CORRECTED", fixer, 1],
    ]);
  });
});
