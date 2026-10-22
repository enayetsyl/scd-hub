/**
 * Mastery M-4b — the guardian's view of the weekly tailored assignment (docs/prd-mastery.md §10
 * journey 10; D-#783 / #810).
 *
 *  - the child's sent assignment, questions numbered as printed (Part A, then the child's own)
 *  - no result until the teacher confirms; then per outcome, plain labels, "again" on re-work
 *  - nothing from a DRAFT; nothing once the add-on is switched off
 *  - only a linked guardian (assertGuardianOfStudent); the PDF for the child's page only
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
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { assertGuardianOfStudent } from "../middleware/authz";
import { importCatalogue, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, saveResults } from "../modules/mastery/services/MasteryWorkService";
import { approveAllSheets, buildAssignment, editSheet, renderAssignmentPdfForChild, sendAssignment } from "../modules/mastery/services/MasteryAssignmentService";
import { childMasteryAssignments } from "../modules/mastery/services/MasteryGuardianService";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
let sectionId = "";
let yearId = "";
const sids: string[] = [];
let guardianId = "";

const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [
    { code: "LO-C3-MATH-07-02", labelBn: "ভাগফল ও ভাগশেষ", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] },
    { code: "LO-C3-MATH-07-03", labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: ["QT-SOLVE"] },
  ],
  questionTypes: [
    { code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 1 },
    { code: "QT-SOLVE", labelBn: "সমাধান করো", marks: 2 },
  ],
});
const LAYOUT = {
  totalMarks: 6, minutes: 30, partAOn: true, partAMarks: 2, partALoCodes: [], partBMarks: 4,
  mixWeak: 100, mixImproving: 0, mixRevision: 0, questionTypeCodes: [] as string[],
};
const guardianCtx = (id: string) => ({ auth: { userId: id, role: "GUARDIAN" } }) as never;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = String(year._id);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(sec._id);
  for (let i = 1; i <= 3; i++) {
    const [s] = await Student.create([{ schoolId: `M4B-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }
  const [g] = await Guardian.create([{ identifierKind: "phone", identifier: "01700000001", phone: "01700000001", name: "অভিভাবক", loginEnabled: true, active: true }]);
  guardianId = String(g._id);
  await GuardianLink.create([{ guardianId: g._id, studentId: new Types.ObjectId(sids[0]), relation: "FATHER" }]);
  await importCatalogue(CATALOGUE, true, PRINCIPAL);
  await setEnablement(yearId, "C3", "MATH", true, PRINCIPAL);
  const base = {
    docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
    curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
  };
  for (let i = 1; i <= 6; i++) {
    await ContentArtifact.create([{ ...base, envelopeJson: { tags: { topic_tag: "LO-C3-MATH-07-03" }, payload: { qid: `QP-MATH-C3-U07-Q9500${i}`, topic_tag: "LO-C3-MATH-07-03", question_text: `ভাগ করো ${i}` } } }]);
  }
  mockTeacher.mockResolvedValue(TEACHER_ID);
  for (const date of ["2027-03-01", "2027-03-08"]) {
    const hw = await createPaper({
      sectionId, subject: "MATH", source: "HW", date,
      items: [{ origin: "TEACHER", textBn: "৮৪৬ ÷ ৬", loCode: "LO-C3-MATH-07-03", questionTypeCode: "QT-SOLVE" }],
    }, TEACHER);
    await saveResults(hw.paperId, [{ studentId: sids[0], items: [{ itemNo: 1, marks: 0 }] }], TEACHER);
    await confirmPaper(hw.paperId, TEACHER);
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

describe("guardian view of the weekly assignment (DB)", () => {
  let assignmentId = "";
  let paperId = "";

  it("a DRAFT is invisible to the guardian", async () => {
    const a = await buildAssignment({ sectionId, subject: "MATH", dueDate: "2027-03-18", layout: LAYOUT, rememberLayout: true }, TEACHER);
    assignmentId = a.id;
    expect(await childMasteryAssignments(sids[0], 4)).toEqual([]);
    await expect(renderAssignmentPdfForChild(assignmentId, sids[0])).rejects.toThrow(/পাওয়া যায়নি/);
  });

  it("sent: the child's page as printed — Part A, then their own, numbered on", async () => {
    await editSheet(assignmentId, sids[0], { op: "ADD_OWN", loCode: "LO-C3-MATH-07-02", questionTypeCode: "QT-SHORT", textBn: "৬৩ ÷ ৯ = ?" }, TEACHER);
    const v = await approveAllSheets(assignmentId, TEACHER);
    for (const s of v.sheets.filter((x) => x.status !== "APPROVED")) await editSheet(assignmentId, s.studentId, { op: "APPROVE" }, TEACHER);
    const sent = await sendAssignment(assignmentId, TEACHER);
    paperId = sent.paperId!;
    const [mine] = await childMasteryAssignments(sids[0], 4);
    expect(mine.partA.map((q) => q.n)).toEqual([1]);
    expect(mine.partB[0].n).toBe(2);
    expect(mine.partB[mine.partB.length - 1]).toEqual({ n: mine.partA.length + mine.partB.length, textBn: "৬৩ ÷ ৯ = ?", marks: 1 });
    expect(mine.totalMarks).toBe([...mine.partA, ...mine.partB].reduce((s, q) => s + q.marks, 0));
    expect(mine.result).toBeNull();
    const pdf = await renderAssignmentPdfForChild(assignmentId, sids[0]);
    expect(pdf.pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("after confirm: per outcome in plain words, re-work shown as 'again', the teacher's note", async () => {
    await saveResults(paperId, [{ studentId: sids[0], items: [{ itemNo: 2, marks: 0, rework: true }], note: "ভাগে আরও অনুশীলন দরকার" }], TEACHER);
    await confirmPaper(paperId, TEACHER);
    const [mine] = await childMasteryAssignments(sids[0], 4);
    expect(mine.result).not.toBeNull();
    const div = mine.result!.rows.find((r) => r.labelBn === "খাতায় লম্বা ভাগ")!;
    expect(div.again).toBe(true);
    expect(div.earned).toBeLessThan(div.available);
    expect(mine.result!.note).toBe("ভাগে আরও অনুশীলন দরকার");
    expect(JSON.stringify(mine)).not.toMatch(/LO-C3|দুর্বল|WEAK/);
  });

  it("only a linked guardian; switched off ⇒ nothing", async () => {
    await expect(assertGuardianOfStudent(guardianCtx(guardianId), sids[0])).resolves.toBeUndefined();
    await expect(assertGuardianOfStudent(guardianCtx(guardianId), sids[1])).rejects.toThrow(/অনুমতি নেই/);
    await setEnablement(yearId, "C3", "MATH", false, PRINCIPAL);
    expect(await childMasteryAssignments(sids[0], 4)).toEqual([]);
    await expect(renderAssignmentPdfForChild(assignmentId, sids[0])).rejects.toThrow(/পাওয়া যায়নি/);
    await setEnablement(yearId, "C3", "MATH", true, PRINCIPAL);
  });
});
