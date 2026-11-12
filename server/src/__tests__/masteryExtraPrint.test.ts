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
import { renderExtraHomeworkPdf } from "../modules/mastery/services/MasteryExtraPdf";

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


const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page(?!s)/g) ?? []).length;
const q = (qid: string) => ({ artifactId: gold.get(qid)!, loCode: A });

describe("the printed extra-homework sheet and unmarked sheets counting as seen", () => {
  it("acceptance 1: one page per child on the sheet, none for a child not on it", async () => {
    const [s1, s2] = sids;
    const paper = await createExtraHomework({
      sectionId, subject: "MATH", date: "2027-03-11",
      sheets: [
        { studentId: s1, items: [q("QP-MATH-C3-U07-Q93002"), q("QP-MATH-C3-U07-Q93003")] },
        { studentId: s2, items: [q("QP-MATH-C3-U07-Q93004")] },
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

  it("acceptance 2: day two never repeats a question from day one's unmarked extra sheet", async () => {
    const [s1, s2] = sids;
    // Day one's sheet (still OPEN) holds Q93002–Q93004 for s1 and Q93004 for s2 (previous test).
    const day2 = await extraHomeworkPreview(sectionId, "MATH", TEACHER);
    const mine = day2.find((x) => x.studentId === s1)!;
    for (const qid of ["QP-MATH-C3-U07-Q93002", "QP-MATH-C3-U07-Q93003"]) expect(mine.items.map((i) => i.qid)).not.toContain(qid);
    expect(day2.find((x) => x.studentId === s2)!.items.map((i) => i.qid)).not.toContain("QP-MATH-C3-U07-Q93004");
    // Day one gave s1 Q93002–03 and s2 Q93004: s1 is left with Q93004 and Q93005 (Q93001 was marked long ago).
    expect(mine.items.map((i) => i.qid).sort()).toEqual(["QP-MATH-C3-U07-Q93004", "QP-MATH-C3-U07-Q93005"]);
    // The create-time re-check refuses the repeat on a tampered request.
    await expect(createExtraHomework({ sectionId, subject: "MATH", date: "2027-03-13", sheets: [{ studentId: s1, items: [q("QP-MATH-C3-U07-Q93002")] }] }, TEACHER))
      .rejects.toThrow(/আগেই দেখেছে/);
    // The class homework draft skips them too.
    await lesson("2027-03-13", [A]);
    const d = await homeworkDraft(sectionId, "MATH", "2027-03-13", TEACHER);
    expect(d.items.map((i) => i.qid)).toEqual(["QP-MATH-C3-U07-Q93005"]);
  });
});
