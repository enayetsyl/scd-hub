/**
 * D-#1070–#1074 — Nursery & KG oral exam (docs/prd-viva.md), real services on in-memory Mongo.
 *
 *   sync       one paper per ORAL routine slot, seeded from the syllabus oral rows
 *              (count × marksEach → questions; a blank-type "Oral" row counts); the default
 *              examiner is the routine's subject teacher; re-sync is idempotent; a removed
 *              slot hides its paper; a date change follows the routine
 *   paper      full marks = sum of questions (halves allowed); keys survive a reorder;
 *              refused once any mark exists
 *   examiners  a child in one list only; an unlisted child falls to the first examiner
 *   marks      examiner taps own child only; edit_all any; halves within [0, max]; null clears;
 *              absent blocks marks and counts 0; DONE when every question has a mark
 *   sheet      an examiner sees only their children; office sees all, with progress
 *   lock       a locked paper refuses marks, papers and examiners; unlock reopens
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { Exam } from "../modules/exams/models/Exam";
import { ExamRoutine } from "../modules/exams/models/ExamRoutine";
import { ExamSyllabus } from "../modules/exams/models/ExamSyllabus";
import { User } from "../modules/foundation/models/User";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { VivaPaper } from "../modules/viva/models/VivaPaper";
import { VivaMark } from "../modules/viva/models/VivaMark";
import {
  isValidMark,
  lockVivaPaper,
  myVivaPapers,
  oralRows,
  saveVivaExaminers,
  saveVivaPaper,
  seedItems,
  setVivaAbsent,
  setVivaMark,
  syncVivaPapers,
  vivaOverview,
  vivaSheet,
} from "../modules/viva/services/VivaService";

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
    [Exam, ExamRoutine, ExamSyllabus, User, Class, Section, Student, RoutineSlot, VivaPaper, VivaMark].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

const ctxOf = (userId: string, role: string): AppContext =>
  ({ auth: { userId, role, grantedPermissions: [], revokedPermissions: [], additionalTemplates: [] } } as unknown as AppContext);

async function user(name: string, role = "TEACHER"): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({ name, role, active: true, phone: `8801700001${seq}`, passwordHash: "x", grantedPermissions: [], revokedPermissions: [], additionalTemplates: [] });
  return r.insertedId.toString();
}

const NURSERY_ROWS = [
  { seq: 1, label: "সম্পূর্ণ বর্ণমালা ক্রমে লেখ", itemType: "other", count: 1, marksEach: 15, total: 15 },
  { seq: 10, label: "মৌখিক", itemType: "oral", count: 1, marksEach: 10, total: 10 },
];
const ENG_ROWS = [
  { seq: 1, label: "Write the capital letters A–Z", itemType: "other", count: 1, marksEach: 15, total: 15 },
  { seq: 9, label: "Oral", itemType: null, count: 15, marksEach: 1, total: 15 },
];
const QURAN_ROWS = [
  { seq: 1, label: "মুখস্ত সূরা", itemType: "oral", count: 3, marksEach: 10, total: 30 },
  { seq: 2, label: "দোয়া", itemType: "oral", count: 4, marksEach: 5, total: 20 },
];

async function setup() {
  const year = new Types.ObjectId();
  const exam = await Exam.collection.insertOne({ academicYearId: year, term: "ANNUAL", name: "Annual 2026", createdBy: new Types.ObjectId() });
  const examId = exam.insertedId;
  const officeId = await user("Office", "OFFICE");
  const office = ctxOf(officeId, "OFFICE");
  const bangla = await user("Bangla Teacher");
  const ct = await user("Class Teacher");
  const other = await user("Other Teacher");
  const cls = await Class.collection.insertOne({ level: -1, nameBn: "নার্সারি", academicYearId: year, active: true });
  const classId = cls.insertedId;
  const sec = await Section.collection.insertOne({ classId, code: "N", nameBn: "নার্সারি", active: true, classTeacherId: new Types.ObjectId(ct) });
  const kids: string[] = [];
  for (const [i, name] of ["Ayaan", "Inaya", "Hamza", "Khadija"].entries()) {
    seq += 1;
    const r = await Student.collection.insertOne({ schoolId: `N-${seq}`, name, rollNumber: String(i + 1), classId, sectionId: sec.insertedId, active: true });
    kids.push(r.insertedId.toString());
  }
  // Bangla is taught by `bangla` (2 periods) — the default examiner; no routine teacher for Quran.
  for (const p of [1, 2]) {
    await RoutineSlot.collection.insertOne({
      groupType: "section", groupId: sec.insertedId, classId, dayOfWeek: p === 1 ? "SUN" : "MON", periodNumber: p, subject: "BAN",
      track: "general", isBreak: false, teacherId: new Types.ObjectId(bangla), effectiveFrom: new Date("2026-01-01"), active: true, createdBy: new Types.ObjectId(),
    });
  }
  for (const [subject, marks] of [["BAN", NURSERY_ROWS], ["ENG", ENG_ROWS], ["QURAN", QURAN_ROWS]] as const) {
    await ExamSyllabus.collection.insertOne({ examId, classId, subject, fullMarks: 100, bodyMd: "", marks, questionTypes: [], status: "PUBLISHED", teacherBypass: false, createdBy: new Types.ObjectId(), updatedBy: new Types.ObjectId() });
  }
  const slot = (dateKey: string, subject: string, kind: string) => ({ classId, dateKey, subject, kind, start: "", end: "", note: "" });
  await ExamRoutine.collection.insertOne({
    examId,
    slots: [slot("2026-11-26", "BAN", "ORAL"), slot("2026-11-29", "ENG", "ORAL"), slot("2026-12-02", "QURAN", "ORAL"), { ...slot("2026-12-06", "BAN", "WRITTEN"), start: "07:30", end: "10:30" }],
    noteBn: "",
    publishedAt: new Date(),
    updatedBy: new Types.ObjectId(),
  });
  await syncVivaPapers(officeId);
  const paper = async (subject: string) => String((await VivaPaper.findOne({ subject }).lean())!._id);
  return { examId, classId, officeId, office, bangla, ct, other, kids, paper, teacher: (id: string) => ctxOf(id, "TEACHER") };
}

describe("viva: pure rules", () => {
  it("oral rows: itemType oral, or a blank-type row labelled Oral/মৌখিক", () => {
    expect(oralRows(NURSERY_ROWS).map((r) => r.seq)).toEqual([10]);
    expect(oralRows(ENG_ROWS).map((r) => r.seq)).toEqual([9]);
    expect(oralRows([{ label: "Oral reading", itemType: "short_answer", total: 5 }])).toEqual([]);
  });
  it("seed: count × marksEach becomes count questions", () => {
    const items = seedItems(QURAN_ROWS);
    expect(items).toHaveLength(7);
    expect(items[0]).toEqual({ label: "মুখস্ত সূরা — ১", marks: 10, ref: "" });
    expect(items.reduce((a, x) => a + x.marks, 0)).toBe(50);
  });
  it("marks: whole or half, within [0, max]", () => {
    expect(isValidMark(0, 2)).toBe(true);
    expect(isValidMark(1.5, 2)).toBe(true);
    expect(isValidMark(2.5, 2)).toBe(false);
    expect(isValidMark(1.25, 2)).toBe(false);
    expect(isValidMark(-0.5, 2)).toBe(false);
  });
});

describe("viva: sync with the routine", () => {
  it("one paper per ORAL slot, seeded from the syllabus, default examiner from the routine", async () => {
    const t = await setup();
    const papers = await VivaPaper.find({}).lean();
    expect(papers.map((p) => p.subject).sort()).toEqual(["BAN", "ENG", "QURAN"]);
    const ban = papers.find((p) => p.subject === "BAN")!;
    expect(ban.fullMarks).toBe(10);
    expect(ban.items.map((i) => i.label)).toEqual(["মৌখিক"]);
    expect(String(ban.examiners[0]!.userId)).toBe(t.bangla);
    expect(ban.examiners[0]!.studentIds).toHaveLength(4);
    const eng = papers.find((p) => p.subject === "ENG")!;
    expect(eng.items).toHaveLength(15);
    expect(eng.fullMarks).toBe(15);
    // No routine teacher for Quran → the class teacher.
    expect(String(papers.find((p) => p.subject === "QURAN")!.examiners[0]!.userId)).toBe(t.ct);
  });

  it("re-sync is idempotent; a moved date follows; a removed slot hides the paper", async () => {
    const t = await setup();
    await syncVivaPapers(t.officeId);
    expect(await VivaPaper.countDocuments({})).toBe(3);
    await ExamRoutine.updateOne({ examId: t.examId }, { $pull: { slots: { subject: "ENG", kind: "ORAL" } } });
    await ExamRoutine.updateOne({ examId: t.examId, "slots.subject": "QURAN" }, { $set: { "slots.$.dateKey": "2026-12-01" } });
    const ov = await vivaOverview(t.office);
    expect(ov).toHaveLength(1);
    expect(ov[0]!.papers.map((p) => `${p.subject} ${p.dateKey}`)).toEqual(["BAN 2026-11-26", "QURAN 2026-12-01"]);
    expect(await VivaPaper.countDocuments({ inRoutine: false })).toBe(1);
  });
});

describe("viva: paper", () => {
  it("full marks follow the questions; halves allowed; keys survive a reorder", async () => {
    const t = await setup();
    const id = await t.paper("BAN");
    const saved = await saveVivaPaper(t.office, id, [
      { label: "অ থেকে ঁ পর্যন্ত বর্ণ বলো", marks: 2 },
      { label: "বর্ণ দিয়ে শব্দ", marks: 2.5, ref: "পৃ. ৭৬" },
      { label: "৪ দিকের নাম", marks: 1 },
    ]);
    expect(saved.fullMarks).toBe(5.5);
    expect(saved.syllabusMarks).toBe(10);
    const [a, b, c] = saved.items;
    const again = await saveVivaPaper(t.office, id, [c!, a!, b!].map((x) => ({ key: x.key, label: x.label, marks: x.marks, ref: x.ref })));
    expect(again.items.map((i) => i.key)).toEqual([c!.key, a!.key, b!.key]);
    await expect(saveVivaPaper(t.office, id, [{ label: "x", marks: 1.25 }])).rejects.toThrow(/পূর্ণ বা আধা/);
  });

  it("refused once any mark exists", async () => {
    const t = await setup();
    const id = await t.paper("QURAN");
    const sheet = await vivaSheet(t.office, id);
    await setVivaMark(t.office, id, t.kids[0]!, sheet.paper.items[0]!.key, 10);
    await expect(saveVivaPaper(t.office, id, [{ label: "x", marks: 50 }])).rejects.toThrow(/নম্বর দেওয়া শুরু হয়েছে/);
  });
});

describe("viva: examiners + marks", () => {
  it("split by child; unlisted child → first examiner; duplicates refused", async () => {
    const t = await setup();
    const id = await t.paper("BAN");
    await expect(
      saveVivaExaminers(t.office, id, [
        { userId: t.bangla, studentIds: [t.kids[0]!] },
        { userId: t.other, studentIds: [t.kids[0]!] },
      ]),
    ).rejects.toThrow(/দুজন পরীক্ষকের/);
    const p = await saveVivaExaminers(t.office, id, [
      { userId: t.bangla, studentIds: [t.kids[0]!, t.kids[1]!] },
      { userId: t.other, studentIds: [t.kids[2]!] },
    ]);
    // Khadija (kids[3]) is in no list → the first examiner.
    expect(p.examiners.map((e) => e.children)).toEqual([3, 1]);
    const mine = await vivaSheet(t.teacher(t.other), id);
    expect(mine.seesAll).toBe(false);
    expect(mine.rows.map((r) => r.name)).toEqual(["Hamza"]);
    await expect(vivaSheet(t.teacher(t.ct), id)).rejects.toThrow(/আপনার ভাগে কোনো শিশু নেই/);
    expect((await myVivaPapers(t.teacher(t.other))).map((x) => x.subject)).toEqual(["BAN"]);
  });

  it("examiner taps own child; not another's; office any; null clears; done when all marked", async () => {
    const t = await setup();
    const id = await t.paper("BAN");
    const p = await saveVivaPaper(t.office, id, [
      { label: "বর্ণ বলো", marks: 2 },
      { label: "দিনের নাম", marks: 1 },
    ]).catch(async () => (await vivaSheet(t.office, id)).paper);
    await saveVivaExaminers(t.office, id, [
      { userId: t.bangla, studentIds: [t.kids[0]!, t.kids[1]!] },
      { userId: t.other, studentIds: [t.kids[2]!, t.kids[3]!] },
    ]);
    const [q1, q2] = p.items;
    let row = await setVivaMark(t.teacher(t.bangla), id, t.kids[0]!, q1!.key, 1.5);
    expect(row).toMatchObject({ total: 1.5, done: false });
    row = await setVivaMark(t.teacher(t.bangla), id, t.kids[0]!, q1!.key, 2);
    row = await setVivaMark(t.teacher(t.bangla), id, t.kids[0]!, q2!.key, 1);
    expect(row).toMatchObject({ total: 3, done: true });
    await expect(setVivaMark(t.teacher(t.bangla), id, t.kids[2]!, q1!.key, 1)).rejects.toThrow(/দায়িত্ব আপনার নয়/);
    await expect(setVivaMark(t.teacher(t.bangla), id, t.kids[0]!, q1!.key, 2.5)).rejects.toThrow(/০ থেকে/);
    row = await setVivaMark(t.office, id, t.kids[2]!, q2!.key, 0.5);
    expect(row.total).toBe(0.5);
    row = await setVivaMark(t.teacher(t.bangla), id, t.kids[0]!, q2!.key, null);
    expect(row).toMatchObject({ total: 2, done: false });
    const sheet = await vivaSheet(t.office, id);
    expect(sheet.paper.progress).toMatchObject({ children: 4, done: 0, started: 2, absent: 0 });
  });

  it("absent: no marks while absent, counts 0, marks kept for a mistaken tap", async () => {
    const t = await setup();
    const id = await t.paper("QURAN");
    const key = (await vivaSheet(t.office, id)).paper.items[0]!.key;
    await setVivaMark(t.teacher(t.ct), id, t.kids[1]!, key, 8);
    let row = await setVivaAbsent(t.teacher(t.ct), id, t.kids[1]!, true);
    expect(row).toMatchObject({ absent: true, total: 0, done: false });
    await expect(setVivaMark(t.teacher(t.ct), id, t.kids[1]!, key, 9)).rejects.toThrow(/অনুপস্থিত/);
    row = await setVivaAbsent(t.teacher(t.ct), id, t.kids[1]!, false);
    expect(row.total).toBe(8);
    await setVivaAbsent(t.office, id, t.kids[2]!, true);
    expect((await vivaSheet(t.office, id)).paper.progress.absent).toBe(1);
  });
});

describe("viva: lock", () => {
  it("a locked paper refuses marks, questions and examiners; unlock reopens", async () => {
    const t = await setup();
    const id = await t.paper("QURAN");
    const key = (await vivaSheet(t.office, id)).paper.items[0]!.key;
    const locked = await lockVivaPaper(t.office, id, true);
    expect(locked.lockedAt).not.toBeNull();
    await expect(setVivaMark(t.office, id, t.kids[0]!, key, 5)).rejects.toThrow(/লক/);
    await expect(saveVivaExaminers(t.office, id, [])).rejects.toThrow(/লক/);
    const sheet = await vivaSheet(t.office, id);
    expect(sheet.rows.every((r) => !r.canEdit)).toBe(true);
    await lockVivaPaper(t.office, id, false);
    expect((await setVivaMark(t.office, id, t.kids[0]!, key, 5)).total).toBe(5);
  });
});
