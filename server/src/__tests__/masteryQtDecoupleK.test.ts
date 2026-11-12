/**
 * PR-K - a typed bank question outside the objective's suggested types, through the DB pickers.
 * The objective suggests only QT-SOLVE; the gold bank holds one question typed QT-SHORT (an active
 * type of the table, not suggested). The homework draft and the re-test must still offer it, as QT-SHORT.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { graphql, type ExecutionResult } from "graphql";

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { MasteryAction } from "../modules/mastery/models/MasteryAction";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { importCatalogue, savePolicy, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, saveResults } from "../modules/mastery/services/MasteryWorkService";
import { homeworkDraft } from "../modules/mastery/services/MasteryHomeworkService";
import { buildRetest, decideAction, recordHeld } from "../modules/mastery/services/MasteryActionService";
import { builder } from "../schema";
// The schema needs a Mutation type to build; the catalogue resolvers bring one.
import "../modules/mastery/resolvers/masteryCatalogue";
import "../modules/questions/resolvers/questions";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
const APPROVER = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const, grantedPermissions: ["mastery:approve"] as never };
let sectionId = "";
const sids: string[] = [];
const art = new Map<string, string>(); // qid → artifact id

const LO = "LO-C3-MATH-07-03";
const Q01 = "QP-QT-Q01";
/** qid → the type and marks every picker must give it. */

const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [{ code: LO, labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: ["QT-SOLVE"] }],
  questionTypes: [
    { code: "QT-SOLVE", labelBn: "সমাধান করো", marks: 2 },
    { code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 1 },
  ],
});

async function hw(date: string) {
  const p = await createPaper({
    sectionId, subject: "MATH", source: "HW", date,
    items: [{ origin: "TEACHER", textBn: "৮৪৬ ÷ ৬", loCode: LO, questionTypeCode: "QT-SOLVE" }, { origin: "TEACHER", textBn: "৯৫২ ÷ ৭", loCode: LO, questionTypeCode: "QT-SOLVE" }],
  }, TEACHER);
  await saveResults(p.paperId, [0, 1, 2].map((i) => ({ studentId: sids[i], items: [{ itemNo: 1, marks: 0 }, { itemNo: 2, marks: 0 }] })), TEACHER);
  await confirmPaper(p.paperId, TEACHER);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(sec._id);
  for (let i = 1; i <= 4; i++) {
    const [s] = await Student.create([{ schoolId: `QT-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }
  const r = await importCatalogue(CATALOGUE, true, PRINCIPAL);
  if (!r.ok) throw new Error(r.errors.join("; "));
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  const base = {
    docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
    curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
  };
  const bank: [string, string | null][] = [[Q01, "QT-SHORT"]];
  for (const [qid, lessonRef] of bank) {
    const [a] = await ContentArtifact.create([{
      ...base,
      envelopeJson: {
        tags: { topic_tag: LO, lo_codes: [LO] },
        payload: { qid, topic_tag: LO, lo_codes: [LO], question_text: `${qid} লেখা`, ...(lessonRef ? { lesson_ref: lessonRef } : {}) },
      },
    }]);
    art.set(qid, String(a._id));
  }
  mockTeacher.mockResolvedValue(TEACHER_ID);
  // Two homeworks, three of four zero → every one of them WEAK on LO, and one PROPOSED action.
  await hw("2027-03-01");
  await hw("2027-03-08");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

describe("PR-K typed question outside the objective's suggestion", () => {
  it("homework draft offers it as QT-SHORT (marks 1)", async () => {
    await LessonDelivery.create({
      noteId: new Types.ObjectId(), slotId: new Types.ObjectId(), sectionId: new Types.ObjectId(sectionId), classLevel: 3, subject: "MATH",
      dateKey: "2027-03-10", teacherId: new Types.ObjectId(TEACHER_ID), updatedBy: new Types.ObjectId(TEACHER_ID),
      rosterStudentIds: sids.map((s) => new Types.ObjectId(s)),
      sessions: [{ chapter: "7", anchorWord: "x", sessionIndex: 1, sessionOf: 1, titleBn: "ভাগ", finished: true, loCodes: [LO] }],
    });
    const d = await homeworkDraft(sectionId, "MATH", "2027-03-10", TEACHER);
    expect(d.reason).toBeNull();
    expect(d.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([[Q01, "QT-SHORT", 1]]);
  });

  it("re-test offers it as QT-SHORT", async () => {
    const open = await MasteryAction.find({ status: "PROPOSED" }).lean();
    expect(open).toHaveLength(1);
    const id = String(open[0]._id);
    await decideAction(id, { decision: "EXTRA_CLASS" as const, date: "2027-03-20", slotKind: "PERIOD" as const, periodNumber: 7, attendees: "WEAK" as const }, APPROVER);
    await recordHeld(id, [{ studentId: sids[0], present: true }, { studentId: sids[1], present: true }], TEACHER);
    const rt = await buildRetest(id, TEACHER);
    const paper = await MasteryPaper.findOne({ paperId: rt.retestPaperId! }).lean();
    expect(paper!.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([[Q01, "QT-SHORT", 1]]);
  });

  it("the exam-paper pick by type (questions(qtCode:)) never returns an untyped question", async () => {
    await ContentArtifact.create([{
      docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "x", number: 7 },
      curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
      envelopeJson: { tags: { topic_tag: LO, lo_codes: [LO] }, payload: { qid: "QP-QT-UNTYPED", topic_tag: LO, lo_codes: [LO], question_text: "t" } },
    }]);
    const schema = builder.toSchema();
    const run = (qtCode: string) =>
      graphql({
        schema,
        source: `query($t: String) { questions(subject: "MATH", classLevel: 3, qtCode: $t, limit: 50) { qid qtCode } }`,
        variableValues: { t: qtCode },
        contextValue: { auth: { role: "PRINCIPAL", userId: PRINCIPAL.userId, grantedPermissions: [], revokedPermissions: [] } },
      }) as Promise<ExecutionResult>;
    for (const t of ["QT-SHORT", "QT-SOLVE"]) {
      const r = await run(t);
      expect(r.errors).toBeUndefined();
      expect(((r.data as any).questions as { qid: string }[]).map((x) => x.qid)).not.toContain("QP-QT-UNTYPED");
    }
    expect(((await run("QT-SHORT")).data as any).questions).toEqual([{ qid: Q01, qtCode: "QT-SHORT" }]);
  });
});
