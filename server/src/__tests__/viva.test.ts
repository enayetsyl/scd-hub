/**
 * D-#1080–#1084 — Nursery & KG oral exam (docs/prd-viva.md), real services on in-memory Mongo.
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
 *   sets       (D-#1275–#1277) sets add up equally; letter questions mark each letter; a set
 *              is drawn at the tap, final, evenly (22 → 6·6·5·5 with two examiners at once),
 *              absent children left out; one-set papers need no draw
 */
import mongoose, { Types } from "mongoose";
import { graphql } from "graphql";
import { MongoMemoryServer } from "mongodb-memory-server";
import { builder } from "../schema";
import "../modules/viva/resolvers/viva";
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
  drawVivaSet,
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
    await expect(saveVivaPaper(t.office, id, [{ label: "x", marks: 50 }])).rejects.toThrow(/নম্বর দেওয়া বা সেট আনা শুরু হয়েছে/);
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

describe("viva: question sets + draw at the tap (D-#1275–#1277)", () => {
  // Bangla-style: a 4-letter question (½ per letter = 2) + 4 two-mark questions = 10.
  const banSet = (label: string, letters: string[], rest: string[]) => ({
    label,
    items: [
      { label: "নিচের বর্ণ দিয়ে ১টি করে শব্দ বল", marks: 0, parts: letters, partMarks: 0.5 },
      ...rest.map((r) => ({ label: r, marks: 2 })),
    ],
  });
  const FOUR_SETS = [
    banSet("সেট ১", ["য", "ধ", "ড়", "ঐ"], ["৪ দিকের নাম", "৪টি ফুলের নাম", "৪টি মাছের নাম", "৭ দিনের নাম"]),
    banSet("সেট ২", ["ট", "ষ", "ঈ", "ব"], ["৬ ঋতুর নাম", "৪টি ফলের নাম", "৪টি পশুর নাম", "৪টি রংয়ের নাম"]),
    banSet("সেট ৩", ["ক", "ম", "প", "শ"], ["৪টি সবজির নাম", "৭ দিনের নাম", "৪টি পাখির নাম", "৪ দিকের নাম"]),
    { label: "সেট ৪", items: [{ label: "বর্ণ দিয়ে শব্দ", marks: 0, parts: ["ণ", "ভ", "ল", "য"], partMarks: 0.5 }, { label: "১২ মাসের নাম", marks: 4 }, { label: "৪টি মাছের নাম", marks: 2 }, { label: "৪টি পশুর নাম", marks: 2 }] },
  ];

  async function moreKids(classId: Types.ObjectId, n: number): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      seq += 1;
      const r = await Student.collection.insertOne({ schoolId: `N-${seq}`, name: `Kid ${i}`, rollNumber: String(10 + i), classId, active: true });
      out.push(r.insertedId.toString());
    }
    return out;
  }

  it("sets: letter marks = letters × per-letter; keys unique across sets; unequal totals refused", async () => {
    const t = await setup();
    const id = await t.paper("BAN");
    const p = await saveVivaPaper(t.office, id, null, FOUR_SETS);
    expect(p.fullMarks).toBe(10);
    expect(p.sets.map((s) => s.label)).toEqual(["সেট ১", "সেট ২", "সেট ৩", "সেট ৪"]);
    // A one-list paper turned into sets numbers them from s1.
    expect(p.sets.map((s) => s.key)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(p.sets[0]!.items[0]).toMatchObject({ marks: 2, parts: ["য", "ধ", "ড়", "ঐ"], partMarks: 0.5 });
    const keys = p.sets.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(p.items.map((i) => i.key)).toEqual(p.sets[0]!.items.map((i) => i.key));
    // English-style letter question: 5 letters × 2 words × ½ = 1 per letter = 5.
    const eng = await saveVivaPaper(t.office, await t.paper("ENG"), null, [
      { label: "Set 1", items: [{ label: "2 words with each letter", marks: 0, parts: ["E", "O", "W", "Q", "J"], partMarks: 1 }, { label: "7 days", marks: 10 }] },
      { label: "Set 2", items: [{ label: "2 words with each letter", marks: 0, parts: ["B", "G", "K", "T", "Z"], partMarks: 1 }, { label: "12 months", marks: 10 }] },
    ]);
    expect(eng.fullMarks).toBe(15);
    await expect(
      saveVivaPaper(t.office, id, null, [FOUR_SETS[0]!, { label: "সেট ২", items: [{ label: "x", marks: 9 }] }]),
    ).rejects.toThrow(/সমান/);
    // One set given as `sets` is stored as a plain one-set paper.
    const one = await saveVivaPaper(t.office, id, null, [FOUR_SETS[0]!]);
    expect(one.sets).toHaveLength(1);
    expect((await VivaPaper.findById(id).lean())!.sets).toHaveLength(0);
  });

  it("no marks before the draw; the draw is final; marks only on the child's own set", async () => {
    const t = await setup();
    const id = await t.paper("BAN");
    const p = await saveVivaPaper(t.office, id, null, FOUR_SETS);
    const me = t.teacher(t.bangla);
    const kid = t.kids[0]!;
    let row = (await vivaSheet(me, id)).rows.find((r) => r.studentId === kid)!;
    expect(row).toMatchObject({ setKey: null, needsDraw: true });
    await expect(setVivaMark(me, id, kid, p.sets[0]!.items[1]!.key, 2)).rejects.toThrow(/সেট আনুন/);
    row = await drawVivaSet(me, id, kid);
    expect(row.needsDraw).toBe(false);
    const set = p.sets.find((s) => s.key === row.setKey)!;
    expect(set).toBeDefined();
    // Final: tapping again (or the office) returns the same set.
    expect((await drawVivaSet(me, id, kid)).setKey).toBe(row.setKey);
    expect((await drawVivaSet(t.office, id, kid)).setKey).toBe(row.setKey);
    // A question from another set is refused.
    const otherSet = p.sets.find((s) => s.key !== row.setKey)!;
    await expect(setVivaMark(me, id, kid, otherSet.items[1]!.key, 1)).rejects.toThrow(/প্রশ্নপত্রে নেই/);
    // Letter question: each letter on its own (✓ = ½, ✗ = 0); whole-key tap refused.
    const letters = set.items[0]!;
    await expect(setVivaMark(me, id, kid, letters.key, 2)).rejects.toThrow(/প্রতিটি বর্ণে/);
    await expect(setVivaMark(me, id, kid, `${letters.key}:9`, 0.5)).rejects.toThrow(/বর্ণটি/);
    await expect(setVivaMark(me, id, kid, `${letters.key}:0`, 1)).rejects.toThrow(/০ থেকে/);
    for (const [i, v] of [0.5, 0.5, 0, 0.5].entries()) row = await setVivaMark(me, id, kid, `${letters.key}:${i}`, v);
    for (const it of set.items.slice(1)) row = await setVivaMark(me, id, kid, it.key, it.marks);
    expect(row).toMatchObject({ done: true, total: 9.5 });
    // A paper with a drawn set can no longer change.
    await expect(saveVivaPaper(t.office, id, null, FOUR_SETS)).rejects.toThrow(/সেট আনা শুরু/);
  });

  it("the split stays even: 22 children → 6·6·5·5, two examiners tapping at once", async () => {
    const t = await setup();
    const extra = await moreKids(t.classId as unknown as Types.ObjectId, 18);
    const all = [...t.kids, ...extra];
    const id = await t.paper("BAN");
    await saveVivaPaper(t.office, id, null, FOUR_SETS);
    await saveVivaExaminers(t.office, id, [
      { userId: t.bangla, studentIds: all.slice(0, 11) },
      { userId: t.other, studentIds: all.slice(11) },
    ]);
    // Both examiners draw their children concurrently, pair by pair.
    for (let i = 0; i < 11; i++) {
      await Promise.all([drawVivaSet(t.teacher(t.bangla), id, all[i]!), drawVivaSet(t.teacher(t.other), id, all[11 + i]!)]);
    }
    const sheet = await vivaSheet(t.office, id);
    expect(sheet.rows.every((r) => r.setKey)).toBe(true);
    expect(sheet.paper.sets.map((s) => s.drawn).sort()).toEqual([5, 5, 6, 6]);
  });

  it("graphql: the app's save-sets, sheet, draw and per-letter mark operations round-trip", async () => {
    const t = await setup();
    const id = await t.paper("BAN");
    const schema = builder.toSchema();
    const run = async (source: string, variableValues: Record<string, unknown>, ctx: AppContext) => {
      const res = await graphql({ schema, source, variableValues, contextValue: ctx });
      expect(res.errors).toBeUndefined();
      return res.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    // Same selections as app/src/graphql/viva.ts (PAPER / ROW).
    const PAPER = `id fullMarks frozen items { key label marks ref parts partMarks }
      sets { key label drawn items { key label marks ref parts partMarks } }`;
    const ROW = `studentId absent setKey needsDraw marks { key value } total done canEdit`;
    const saved = await run(
      `mutation SaveVivaPaper($paperId: String!, $sets: [VivaSetInput!]!) { saveVivaPaper(paperId: $paperId, sets: $sets) { ${PAPER} } }`,
      { paperId: id, sets: FOUR_SETS.map((s) => ({ key: null, ...s, items: s.items.map((i) => ({ key: null, ref: null, ...i })) })) },
      t.office,
    );
    expect(saved.saveVivaPaper.sets).toHaveLength(4);
    expect(saved.saveVivaPaper.fullMarks).toBe(10);
    const me = t.teacher(t.bangla);
    const sheet = await run(`query VivaSheet($paperId: String!) { vivaSheet(paperId: $paperId) { paper { ${PAPER} } rows { ${ROW} } seesAll } }`, { paperId: id }, me);
    expect(sheet.vivaSheet.rows[0]).toMatchObject({ needsDraw: true, setKey: null });
    const drawn = await run(
      `mutation DrawVivaSet($paperId: String!, $studentId: String!) { drawVivaSet(paperId: $paperId, studentId: $studentId) { ${ROW} } }`,
      { paperId: id, studentId: t.kids[0] },
      me,
    );
    const setKey = drawn.drawVivaSet.setKey as string;
    const letters = saved.saveVivaPaper.sets.find((s: { key: string }) => s.key === setKey).items[0];
    const marked = await run(
      `mutation SetVivaMark($paperId: String!, $studentId: String!, $key: String!, $value: Float) { setVivaMark(paperId: $paperId, studentId: $studentId, key: $key, value: $value) { ${ROW} } }`,
      { paperId: id, studentId: t.kids[0], key: `${letters.key}:0`, value: 0.5 },
      me,
    );
    expect(marked.setVivaMark.marks).toEqual([{ key: `${letters.key}:0`, value: 0.5 }]);
    // The VV-1 single-list save still works for an app that predates sets.
    const old = await run(
      `mutation SaveVivaPaper($paperId: String!, $items: [VivaItemInput!]!) { saveVivaPaper(paperId: $paperId, items: $items) { ${PAPER} } }`,
      { paperId: await t.paper("ENG"), items: [{ label: "Oral", marks: 15 }] },
      t.office,
    );
    expect(old.saveVivaPaper.sets).toHaveLength(1);
  });

  it("an absent child is left out of the split; a one-set paper needs no draw", async () => {
    const t = await setup();
    const id = await t.paper("BAN");
    await saveVivaPaper(t.office, id, null, [FOUR_SETS[0]!, FOUR_SETS[1]!]);
    const me = t.teacher(t.bangla);
    const first = await drawVivaSet(me, id, t.kids[0]!);
    await setVivaAbsent(me, id, t.kids[0]!, true);
    await expect(drawVivaSet(me, id, t.kids[1]!).then(() => drawVivaSet(me, id, t.kids[2]!))).resolves.toBeDefined();
    const p = (await vivaSheet(t.office, id)).paper;
    // kids[0] (absent) doesn't count, so kids[1] and kids[2] took one set each.
    expect(p.sets.map((s) => s.drawn).sort()).toEqual([1, 1]);
    expect(first.setKey).not.toBeNull();
    await expect(drawVivaSet(me, id, t.kids[0]!)).resolves.toMatchObject({ setKey: first.setKey });
    // One-set paper (Quran): every child already "has" the only set; marks need no draw.
    const qid = await t.paper("QURAN");
    const row = (await vivaSheet(t.office, qid)).rows[0]!;
    expect(row).toMatchObject({ setKey: "s1", needsDraw: false });
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
