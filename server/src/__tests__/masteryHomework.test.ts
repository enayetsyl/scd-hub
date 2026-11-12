/**
 * PR-D — homework from the lesson taught, and extra homework for weak children
 * (docs/prd-mastery-homework-from-lesson.md, D-#1321–#1326).
 *
 * 1. A lesson marked whose plan names three codes — one with bank questions, one with only book
 *    exercises, one with neither — drafts a BANK item, a `fromBook` item and one gap.
 * 2. No lesson marked → NO_LESSON_MARKED (and a session with no codes → NO_CODES_ON_PLAN).
 * 3. The draft never offers a question any student of the section has seen.
 * 4. The preview gives a weak child at most `maxQuestions` items, none seen before; a child with no
 *    weak row is listed NOT_WEAK.
 * 5. A tampered `createMasteryExtraHomework` (seen question, or a row that is not weak) is refused.
 * 6. On the extra sheet a child's evidence covers only their own items; no HomeworkItem is created;
 *    the record rows exist and stay off the leader dashboard.
 *
 * In-memory MongoDB, real services; only the routine lookup is stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryAction } from "../modules/mastery/models/MasteryAction";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { importCatalogue, savePolicy, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, paperDetail, saveResults } from "../modules/mastery/services/MasteryWorkService";
import { createExtraHomework, extraHomeworkPreview, homeworkDraft } from "../modules/mastery/services/MasteryHomeworkService";
import { actionsPage } from "../modules/mastery/services/MasteryActionService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
let sectionId = "";
const sids: string[] = [];
const gold = new Map<string, string>();

const A = "LO-C3-MATH-07-01"; // bank questions
const B = "LO-C3-MATH-07-02"; // only book exercises
const C = "LO-C3-MATH-07-03"; // neither
const R = "LO-C3-MATH-SK-MENT-01"; // rubric
const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [
    { code: A, labelBn: "ভাগের ধারণা", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] },
    { code: B, labelBn: "ভাগফল ও ভাগশেষ", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] },
    { code: C, labelBn: "লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] },
    { code: R, labelBn: "মুখে হিসাব", assess: "RUBRIC", questionTypeCodes: [] },
  ],
  questionTypes: [{ code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 2 }],
});

async function lesson(dateKey: string, loCodes: string[]): Promise<void> {
  await LessonDelivery.create({
    noteId: new Types.ObjectId(), slotId: new Types.ObjectId(), sectionId: new Types.ObjectId(sectionId), classLevel: 3, subject: "MATH",
    dateKey, teacherId: new Types.ObjectId(TEACHER_ID), updatedBy: new Types.ObjectId(TEACHER_ID),
    rosterStudentIds: sids.map((s) => new Types.ObjectId(s)),
    sessions: [{ chapter: "7", anchorWord: "অধ্যায়", sessionIndex: 1, sessionOf: 1, titleBn: "ভাগ", finished: true, loCodes }],
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(sec._id);
  for (let i = 1; i <= 3; i++) {
    const [s] = await Student.create([{ schoolId: `HD-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }
  const r = await importCatalogue(CATALOGUE, true, PRINCIPAL);
  if (!r.ok) throw new Error(r.errors.join("; "));
  await MasteryOutcome.updateOne({ code: B }, { $set: { bookRef: { version: null, chapter: 7, lesson: null, exercises: ["7/অনুশীলনী/3", "7/অনুশীলনী/4"] } } });
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  const base = {
    docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
    curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
  };
  for (const qid of ["QP-MATH-C3-U07-Q93001", "QP-MATH-C3-U07-Q93002", "QP-MATH-C3-U07-Q93003", "QP-MATH-C3-U07-Q93004", "QP-MATH-C3-U07-Q93005"]) {
    const [a] = await ContentArtifact.create([{ ...base, envelopeJson: { tags: { topic_tag: A }, payload: { qid, topic_tag: A, question_text: `${qid} লেখা` } } }]);
    gold.set(qid, String(a._id));
  }
  mockTeacher.mockResolvedValue(TEACHER_ID);
  // A confirmed homework: Q93001 (bank) + a teacher item, both on A. Students 1–2 get 0 (WEAK); 3 is full.
  const hw = await createPaper({
    sectionId, subject: "MATH", source: "HW", date: "2027-03-01",
    items: [
      { origin: "BANK", artifactId: gold.get("QP-MATH-C3-U07-Q93001"), loCode: A, questionTypeCode: "QT-SHORT" },
      { origin: "TEACHER", textBn: "১২ ÷ ৩", loCode: A, questionTypeCode: "QT-SHORT" },
    ],
  }, TEACHER);
  await saveResults(hw.paperId, [0, 1].map((i) => ({ studentId: sids[i], items: [{ itemNo: 1, marks: 0 }, { itemNo: 2, marks: 0 }] })), TEACHER);
  await confirmPaper(hw.paperId, TEACHER);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

describe("the class homework drafted from the lesson", () => {
  it("acceptance 2: no lesson marked → NO_LESSON_MARKED; a session with no codes → NO_CODES_ON_PLAN", async () => {
    expect((await homeworkDraft(sectionId, "MATH", "2027-03-02", TEACHER)).reason).toBe("NO_LESSON_MARKED");
    await lesson("2027-03-03", []);
    expect((await homeworkDraft(sectionId, "MATH", "2027-03-03", TEACHER)).reason).toBe("NO_CODES_ON_PLAN");
  });

  it("acceptance 1 + 3: a BANK item (never one the section has seen), a fromBook item, a gap; rubric codes apart", async () => {
    await lesson("2027-03-10", [A, B, C, R]);
    const d = await homeworkDraft(sectionId, "MATH", "2027-03-10", TEACHER);
    expect(d.reason).toBeNull();
    expect(d.items.map((i) => [i.origin, i.loCode, i.fromBook])).toEqual([["BANK", A, false], ["TEACHER", B, true]]);
    // Q93001 was on the confirmed homework — seen by the section — so it is never offered.
    expect(d.items[0].qid).toBe("QP-MATH-C3-U07-Q93002");
    expect(d.items[0]).toMatchObject({ questionTypeCode: "QT-SHORT", marks: 2 });
    expect(d.items[1].textBn).toContain("7/অনুশীলনী/3");
    expect(d.gaps).toEqual([C]);
    expect(d.rubricCodes).toEqual([R]);
    expect(d.leftOut).toEqual([]);
    expect(d.hwItemId).toBeNull();
  });

  it("stops at maxItems: the rest are left out; two questions per objective when the policy says so", async () => {
    await savePolicy(null, null, { homeworkDraftMaxItems: 1 }, PRINCIPAL);
    let d = await homeworkDraft(sectionId, "MATH", "2027-03-10", TEACHER);
    expect(d.items.map((i) => i.loCode)).toEqual([A]);
    expect(d.leftOut).toEqual([B, C]);
    await savePolicy(null, null, { homeworkDraftQuestionsPerObjective: 2 }, PRINCIPAL);
    d = await homeworkDraft(sectionId, "MATH", "2027-03-10", TEACHER);
    expect(d.items.filter((i) => i.loCode === A).map((i) => i.qid)).toEqual(["QP-MATH-C3-U07-Q93002", "QP-MATH-C3-U07-Q93003"]);
    await savePolicy(null, null, {}, PRINCIPAL);
  });
});

describe("extra homework for weak children", () => {
  it("acceptance 4: at most maxQuestions unseen items per weak child; a child with no weak row is NOT_WEAK", async () => {
    const p = await extraHomeworkPreview(sectionId, "MATH", TEACHER);
    const [s1, s2, s3] = sids.map((id) => p.find((x) => x.studentId === id)!);
    for (const s of [s1, s2]) {
      expect(s.cause).toBeNull();
      expect(s.items.length).toBe(3);
      expect(s.items.map((i) => i.qid)).not.toContain("QP-MATH-C3-U07-Q93001");
      expect(s.items.every((i) => i.loCode === A && i.reasonBn.startsWith("দুর্বল"))).toBe(true);
    }
    expect(s3).toMatchObject({ items: [], cause: "NOT_WEAK" });
  });

  it("acceptance 5 + 6: tampering is refused; the sheet gives each child only their items; tracker untouched", async () => {
    const [s1, s2, s3] = sids;
    const q = (qid: string) => ({ artifactId: gold.get(qid)!, loCode: A });
    const date = "2027-03-11";
    await expect(createExtraHomework({ sectionId, subject: "MATH", date, sheets: [{ studentId: s1, items: [q("QP-MATH-C3-U07-Q93001")] }] }, TEACHER))
      .rejects.toThrow(/আগেই দেখেছে/);
    await expect(createExtraHomework({ sectionId, subject: "MATH", date, sheets: [{ studentId: s3, items: [q("QP-MATH-C3-U07-Q93002")] }] }, TEACHER))
      .rejects.toThrow(/দুর্বল/);
    await expect(createExtraHomework({
      sectionId, subject: "MATH", date,
      sheets: [{ studentId: s1, items: ["Q93002", "Q93003", "Q93004", "Q93005"].map((n) => q(`QP-MATH-C3-U07-${n}`)) }],
    }, TEACHER)).rejects.toThrow(/সর্বোচ্চ/);

    const paper = await createExtraHomework({
      sectionId, subject: "MATH", date,
      sheets: [
        { studentId: s1, items: [q("QP-MATH-C3-U07-Q93002"), q("QP-MATH-C3-U07-Q93003")] },
        { studentId: s2, items: [q("QP-MATH-C3-U07-Q93002")] },
      ],
    }, TEACHER);
    expect(paper).toMatchObject({ source: "HW", extra: true, title: "বাড়তি বাড়ির কাজ", date });
    expect(paper.items.map((i) => i.qid)).toEqual(["QP-MATH-C3-U07-Q93002", "QP-MATH-C3-U07-Q93003"]);
    await expect(createExtraHomework({ sectionId, subject: "MATH", date, sheets: [{ studentId: s2, items: [q("QP-MATH-C3-U07-Q93004")] }] }, TEACHER))
      .rejects.toThrow(/আগেই তৈরি/);

    // Each child sees only their own items; an item not given is refused, never wrong.
    const detail = await paperDetail(paper.paperId, TEACHER);
    expect(detail.roster.map((r) => [r.studentId, r.itemNos])).toEqual([[s1, [1, 2]], [s2, [1]]]);
    await expect(saveResults(paper.paperId, [{ studentId: s2, items: [{ itemNo: 2, marks: 0 }] }], TEACHER)).rejects.toThrow(/শিটে নেই/);
    await saveResults(paper.paperId, [{ studentId: s1, items: [{ itemNo: 2, marks: 1 }] }], TEACHER);
    await confirmPaper(paper.paperId, TEACHER);
    const ev = await MasteryEvidence.find({ paperId: new Types.ObjectId(await idOf(paper.paperId)), supersededAt: null }).lean();
    expect(ev.filter((e) => String(e.studentId) === s1).map((e) => e.itemNo).sort()).toEqual([1, 2]);
    expect(ev.filter((e) => String(e.studentId) === s2).map((e) => e.itemNo)).toEqual([1]);
    expect(ev.filter((e) => String(e.studentId) === s3)).toEqual([]);

    // The homework tracker is not touched; the record rows exist, off the leader dashboard.
    expect(await HomeworkItem.countDocuments({})).toBe(0);
    const rows = await MasteryAction.find({ kind: "EXTRA_HOMEWORK" }).lean();
    expect(rows.map((r) => String(r.plan?.studentIds?.[0])).sort()).toEqual([s1, s2].sort());
    expect(rows.every((r) => r.status === "CLOSED")).toBe(true);
    expect((await actionsPage("CLOSED", {}, {}, PRINCIPAL)).total).toBe(0);
  });
});

async function idOf(paperId: string): Promise<string> {
  const { MasteryPaper } = await import("../modules/mastery/models/MasteryPaper");
  return String((await MasteryPaper.findOne({ paperId }).select("_id").lean())!._id);
}
