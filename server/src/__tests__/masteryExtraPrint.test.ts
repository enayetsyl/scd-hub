/**
 * PR-J (docs/prd-mastery-homework-from-lesson.md, D-#1420) — the printed extra-homework sheet, and
 * unmarked (OPEN) extra sheets counting as seen.
 *
 * 1. The PDF has one page per child on the sheet and none for a child not on it; a paper that is not
 *    an extra sheet is refused.
 * 2. A second day's preview never repeats a question from yesterday's unmarked extra sheet, the
 *    create-time re-check refuses it, and the class-homework draft skips it. Once the sheet is
 *    confirmed it is seen through the evidence rows as before.
 * (The weekly assignment PDF renderer is untouched: masteryAssignment.test.ts runs unchanged.)
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
import { confirmPaper, createPaper, saveResults } from "../modules/mastery/services/MasteryWorkService";
import { createExtraHomework, extraHomeworkPreview, homeworkDraft } from "../modules/mastery/services/MasteryHomeworkService";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { MasteryResult } from "../modules/mastery/models/MasteryResult";
import { MasteryAssignment } from "../modules/mastery/models/MasteryAssignment";
import { MasteryAssignmentSheet } from "../modules/mastery/models/MasteryAssignmentSheet";
import { buildAssignment, editSheet, sheetDetail } from "../modules/mastery/services/MasteryAssignmentService";
import { renderExtraHomeworkPdf } from "../modules/mastery/services/MasteryExtraPdf";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
let sectionId = "";
const sids: string[] = [];
const gold = new Map<string, string>();
let fixturePaperId = "";

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
  fixturePaperId = hw.paperId;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});


const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page(?!s)/g) ?? []).length;
const QID = (n: number) => `QP-MATH-C3-U07-Q9300${n}`;
const q = (qid: string) => ({ artifactId: gold.get(qid)!, loCode: A });
const LAYOUT = {
  totalMarks: 6, minutes: 30, partAOn: true, partAMarks: 2, partALoCodes: [A], partBMarks: 4,
  mixWeak: 100, mixImproving: 0, mixRevision: 0, questionTypeCodes: [] as string[],
};
const build = () => buildAssignment({ sectionId, subject: "MATH", dueDate: "2027-03-18", layout: LAYOUT, rememberLayout: false }, TEACHER);

// Every test makes its own sheets; whatever it created is removed afterwards (the fixture homework stays).
afterEach(async () => {
  const papers = await MasteryPaper.find({ paperId: { $ne: fixturePaperId } }).select("_id").lean();
  const ids = papers.map((p) => p._id);
  await MasteryEvidence.deleteMany({ paperId: { $in: ids } });
  await MasteryResult.deleteMany({ paperId: { $in: ids } });
  await MasteryPaper.deleteMany({ _id: { $in: ids } });
  await MasteryAction.deleteMany({ kind: "EXTRA_HOMEWORK" });
  await MasteryAssignment.deleteMany({});
  await MasteryAssignmentSheet.deleteMany({});
  await LessonDelivery.deleteMany({});
});

describe("the printed extra-homework sheet", () => {
  it("acceptance 1: one page per child on the sheet, none for a child not on it", async () => {
    const [s1, s2] = sids;
    const paper = await createExtraHomework({
      sectionId, subject: "MATH", date: "2027-03-11",
      sheets: [
        { studentId: s1, items: [q(QID(2)), q(QID(3))] },
        { studentId: s2, items: [q(QID(4))] },
      ],
    }, TEACHER);
    const out = await renderExtraHomeworkPdf(paper.paperId, TEACHER);
    expect(out.pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pageCount(out.pdf)).toBe(2);
    expect(out.filename).toBe(`extra_homework_${paper.paperId}`);
    // A class homework sheet is not an extra sheet.
    const hw = await createPaper({ sectionId, subject: "MATH", source: "HW", date: "2027-03-12", items: [{ origin: "TEACHER", textBn: "১২ ÷ ৩", loCode: A, questionTypeCode: "QT-SHORT" }] }, TEACHER);
    await expect(renderExtraHomeworkPdf(hw.paperId, TEACHER)).rejects.toThrow(/বাড়তি/);
    // The routine row rule still applies.
    mockTeacher.mockResolvedValue(new Types.ObjectId().toString());
    await expect(renderExtraHomeworkPdf(paper.paperId, TEACHER)).rejects.toThrow(/দায়িত্ব/);
  });
});

describe("unmarked (OPEN) extra sheets count as seen", () => {
  it("acceptance 2: day two never repeats a question from day one's unmarked sheet; re-check and class draft too", async () => {
    const [s1, s2] = sids;
    await createExtraHomework({
      sectionId, subject: "MATH", date: "2027-03-11",
      sheets: [{ studentId: s1, items: [q(QID(2)), q(QID(3))] }, { studentId: s2, items: [q(QID(4))] }],
    }, TEACHER);
    const day2 = await extraHomeworkPreview(sectionId, "MATH", TEACHER);
    const mine = day2.find((x) => x.studentId === s1)!;
    // Q93001 was marked long ago; s1 is left with Q93004 and Q93005.
    expect(mine.items.map((i) => i.qid).sort()).toEqual([QID(4), QID(5)]);
    expect(day2.find((x) => x.studentId === s2)!.items.map((i) => i.qid)).not.toContain(QID(4));
    await expect(createExtraHomework({ sectionId, subject: "MATH", date: "2027-03-13", sheets: [{ studentId: s1, items: [q(QID(2))] }] }, TEACHER))
      .rejects.toThrow(/আগেই দেখেছে/);
    await lesson("2027-03-13", [A]);
    const d = await homeworkDraft(sectionId, "MATH", "2027-03-13", TEACHER);
    expect(d.items.map((i) => i.qid)).toEqual([QID(5)]);
  });

  it("the weekly builder: neither Part A nor a child's Part B uses a question on that child's open extra sheet", async () => {
    const [s1, s2] = sids;
    await createExtraHomework({
      sectionId, subject: "MATH", date: "2027-03-11",
      sheets: [{ studentId: s1, items: [q(QID(2))] }, { studentId: s2, items: [q(QID(3))] }],
    }, TEACHER);
    const a = await build();
    expect(a.partA).toHaveLength(1);
    expect([QID(2), QID(3)]).not.toContain(a.partA[0].qid); // class-wide: nobody's open-sheet question
    const one = await sheetDetail(a.id, s1, TEACHER);
    const two = await sheetDetail(a.id, s2, TEACHER);
    expect(one.items.map((i) => i.qid)).not.toContain(QID(2));
    expect(two.items.map((i) => i.qid)).not.toContain(QID(3));
  });

  it("the sheet SWAP never picks a question on that child's open extra sheet", async () => {
    const [s1] = sids;
    const a = await build();
    const mine = await sheetDetail(a.id, s1, TEACHER);
    const used = new Set([...a.partA, ...mine.items].map((x) => x.qid));
    const left = [2, 3, 4, 5].map(QID).filter((x) => !used.has(x));
    expect(left).toHaveLength(1); // 4 unseen questions − Part A (1) − the child's two
    // Give the child the one remaining question on an open extra sheet, then swap: nothing is left.
    await createExtraHomework({ sectionId, subject: "MATH", date: "2027-03-11", sheets: [{ studentId: s1, items: [q(left[0])] }] }, TEACHER);
    const i = mine.items.findIndex((x) => x.origin === "BANK");
    await expect(editSheet(a.id, s1, { op: "SWAP", index: i }, TEACHER)).rejects.toThrow(/নতুন গোল্ড প্রশ্ন নেই/);
  });

  it("a confirmed extra sheet is seen through its evidence rows, as before", async () => {
    const [s1] = sids;
    const paper = await createExtraHomework({ sectionId, subject: "MATH", date: "2027-03-11", sheets: [{ studentId: s1, items: [q(QID(2))] }] }, TEACHER);
    await saveResults(paper.paperId, [{ studentId: s1, items: [{ itemNo: 1, marks: 0 }] }], TEACHER);
    await confirmPaper(paper.paperId, TEACHER);
    expect(await MasteryPaper.exists({ paperId: paper.paperId, entryState: "CONFIRMED" })).toBeTruthy();
    const mine = (await extraHomeworkPreview(sectionId, "MATH", TEACHER)).find((x) => x.studentId === s1)!;
    expect(mine.items.map((i) => i.qid)).not.toContain(QID(2));
    await expect(createExtraHomework({ sectionId, subject: "MATH", date: "2027-03-13", sheets: [{ studentId: s1, items: [q(QID(2))] }] }, TEACHER))
      .rejects.toThrow(/আগেই দেখেছে/);
  });
});
