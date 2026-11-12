/**
 * PR-G — the typed bank question through every picker that reads the DB (D-#1400 follow-up).
 *
 * One section, one objective that allows QT-SOLVE (2) and QT-WORD (5), and a gold bank of four:
 *   Q01 typed QT-WORD · Q02 typed QT-SOLVE · Q03, Q04 untyped (a QCAT-/legacy question).
 * Each picker must give Q01 only as QT-WORD (5), Q02 only as QT-SOLVE (2), and the untyped ones the
 * objective's first allowed type (QT-SOLVE), exactly as before:
 *   - the homework draft (`homeworkDraft`)
 *   - the weekly assignment's swap edit (`editSheet`): a swap-in must be untyped or of the item's type
 *   - the extra homework (`extraHomeworkPreview`, `createExtraHomework`)
 *   - the re-test (`buildRetest`)
 * and the two Mongo filters the type code adds: `questions(qtCode:)` and `myQuestionReviews(qtCode:)`.
 *
 * In-memory MongoDB, real services; only the routine lookup is stubbed.
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
import { ReviewAssignment } from "../modules/content/models/ReviewAssignment";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { MasteryAction } from "../modules/mastery/models/MasteryAction";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { importCatalogue, savePolicy, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, saveResults } from "../modules/mastery/services/MasteryWorkService";
import { createExtraHomework, extraHomeworkPreview, homeworkDraft } from "../modules/mastery/services/MasteryHomeworkService";
import { buildRetest, decideAction, recordHeld } from "../modules/mastery/services/MasteryActionService";
import { buildAssignment, deleteAssignment, editSheet, sheetDetail } from "../modules/mastery/services/MasteryAssignmentService";
import { listMyQuestionReviews, countMyQuestionReviews } from "../modules/questions/services/QuestionReviewService";
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
const Q02 = "QP-QT-Q02";
const Q03 = "QP-QT-Q03";
const Q04 = "QP-QT-Q04";
/** qid → the type and marks every picker must give it. */
const EXPECT: Record<string, [string, number]> = {
  [Q01]: ["QT-WORD", 5], [Q02]: ["QT-SOLVE", 2], [Q03]: ["QT-SOLVE", 2], [Q04]: ["QT-SOLVE", 2],
};
const typeAndMarks = (i: { qid?: string | null; questionTypeCode: string; marks: number }) => [i.questionTypeCode, i.marks];

const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [{ code: LO, labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: ["QT-SOLVE", "QT-WORD"] }],
  questionTypes: [
    { code: "QT-SOLVE", labelBn: "সমাধান করো", marks: 2 },
    { code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: 5 },
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
  const bank: [string, string | null][] = [[Q01, "QT-WORD"], [Q02, "QT-SOLVE"], [Q03, null], [Q04, "QCAT-OLD"]];
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

describe("homework draft", () => {
  it("gives each bank question its own type; an untyped / QCAT- one the objective's first type", async () => {
    await LessonDelivery.create({
      noteId: new Types.ObjectId(), slotId: new Types.ObjectId(), sectionId: new Types.ObjectId(sectionId), classLevel: 3, subject: "MATH",
      dateKey: "2027-03-10", teacherId: new Types.ObjectId(TEACHER_ID), updatedBy: new Types.ObjectId(TEACHER_ID),
      rosterStudentIds: sids.map((s) => new Types.ObjectId(s)),
      sessions: [{ chapter: "7", anchorWord: "অধ্যায়", sessionIndex: 1, sessionOf: 1, titleBn: "ভাগ", finished: true, loCodes: [LO] }],
    });
    await savePolicy(null, null, { homeworkDraftQuestionsPerObjective: 4 }, PRINCIPAL);
    const d = await homeworkDraft(sectionId, "MATH", "2027-03-10", TEACHER);
    expect(d.reason).toBeNull();
    expect(d.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([
      [Q01, "QT-WORD", 5], [Q02, "QT-SOLVE", 2], [Q03, "QT-SOLVE", 2], [Q04, "QT-SOLVE", 2],
    ]);
    await savePolicy(null, null, {}, PRINCIPAL);
  });
});

describe("weekly assignment swap edit", () => {
  const LAYOUT = (marks: number) => ({
    totalMarks: marks, minutes: 20, partAOn: false, partAMarks: 0, partALoCodes: [] as string[], partBMarks: marks,
    mixWeak: 100, mixImproving: 0, mixRevision: 0, questionTypeCodes: [] as string[],
  });

  it("a QT-WORD item is swapped only for an untyped or QT-WORD question — never the QT-SOLVE one", async () => {
    const a = await buildAssignment({ sectionId, subject: "MATH", dueDate: "2027-03-18", layout: LAYOUT(5), rememberLayout: false }, TEACHER);
    const before = await sheetDetail(a.id, sids[0], TEACHER);
    expect(before.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([[Q01, "QT-WORD", 5]]);
    const swapped = await editSheet(a.id, sids[0], { op: "SWAP", index: 0 }, TEACHER);
    expect(swapped.items[0].qid).toBe(Q03); // the next unseen untyped; Q02 is typed QT-SOLVE and is not a candidate
    expect(typeAndMarks(swapped.items[0])).toEqual(["QT-WORD", 5]); // the item keeps its type and marks
    await deleteAssignment(a.id, TEACHER);
  });

  it("a QT-SOLVE item is swapped only for an untyped or QT-SOLVE question — never the QT-WORD one", async () => {
    const a = await buildAssignment({ sectionId, subject: "MATH", dueDate: "2027-03-19", layout: LAYOUT(2), rememberLayout: false }, TEACHER);
    const before = await sheetDetail(a.id, sids[0], TEACHER);
    expect(before.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([[Q02, "QT-SOLVE", 2]]);
    const swapped = await editSheet(a.id, sids[0], { op: "SWAP", index: 0 }, TEACHER);
    expect([Q03, Q04]).toContain(swapped.items[0].qid);
    expect(swapped.items[0].qid).not.toBe(Q01);
    await deleteAssignment(a.id, TEACHER);
  });
});

describe("extra homework", () => {
  it("proposes and creates each question as its own type", async () => {
    await savePolicy(null, null, { extraHomeworkMaxQuestions: 4 }, PRINCIPAL);
    const p = await extraHomeworkPreview(sectionId, "MATH", TEACHER);
    const kid = p.find((s) => s.items.length > 0)!;
    expect(kid.items.length).toBe(4);
    for (const it of kid.items) expect([it.questionTypeCode, it.marks]).toEqual(EXPECT[it.qid]);
    expect(kid.items.find((i) => i.qid === Q01)).toMatchObject({ questionTypeCode: "QT-WORD", marks: 5 });

    const paper = await createExtraHomework({
      sectionId, subject: "MATH", date: "2027-03-12",
      sheets: [{ studentId: kid.studentId, items: [{ artifactId: art.get(Q01)!, loCode: LO }, { artifactId: art.get(Q02)!, loCode: LO }] }],
    }, TEACHER);
    expect(paper.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([[Q01, "QT-WORD", 5], [Q02, "QT-SOLVE", 2]]);
    await savePolicy(null, null, {}, PRINCIPAL);
  });
});

describe("re-test", () => {
  it("each re-test question carries its own type and marks", async () => {
    const open = await MasteryAction.find({ status: "PROPOSED" }).lean();
    expect(open).toHaveLength(1);
    const id = String(open[0]._id);
    await decideAction(id, { decision: "EXTRA_CLASS" as const, date: "2027-03-20", slotKind: "PERIOD" as const, periodNumber: 7, attendees: "WEAK" as const }, APPROVER);
    await recordHeld(id, [{ studentId: sids[0], present: true }, { studentId: sids[1], present: true }], TEACHER);
    const rt = await buildRetest(id, TEACHER);
    const paper = await MasteryPaper.findOne({ paperId: rt.retestPaperId! }).lean();
    expect(paper!.items.length).toBeGreaterThanOrEqual(3);
    for (const it of paper!.items) expect([it.questionTypeCode, it.marks]).toEqual(EXPECT[it.qid!]);
    // The typed 5-mark question is among them, as QT-WORD — not squeezed into the first type.
    expect(paper!.items.find((i) => i.qid === Q01)).toMatchObject({ questionTypeCode: "QT-WORD", marks: 5 });
  });
});

describe("the qtCode filters reach Mongo", () => {
  it("questions(qtCode:) returns only the questions carrying that type", async () => {
    const schema = builder.toSchema();
    const run = (qtCode: string) =>
      graphql({
        schema,
        source: `query($t: String) { questions(subject: "MATH", classLevel: 3, qtCode: $t, limit: 50) { qid qtCode } }`,
        variableValues: { t: qtCode },
        contextValue: { auth: { role: "PRINCIPAL", userId: PRINCIPAL.userId, grantedPermissions: [], revokedPermissions: [] } },
      }) as Promise<ExecutionResult>;
    const word = await run("QT-WORD");
    expect(word.errors).toBeUndefined();
    expect((word.data as any).questions).toEqual([{ qid: Q01, qtCode: "QT-WORD" }]);
    const solve = await run("QT-SOLVE");
    expect((solve.data as any).questions).toEqual([{ qid: Q02, qtCode: "QT-SOLVE" }]);
    // A QCAT- value is not a type: it has no qtCode, and QT-FILL matches nothing here.
    expect((await run("QT-FILL")).data).toEqual({ questions: [] });
  });

  it("myQuestionReviews(qtCode:) and its count agree and match only that type", async () => {
    const reviewer = new Types.ObjectId();
    for (const qid of [Q01, Q02, Q03]) {
      await ReviewAssignment.create({
        docType: "question", subject: "MATH", classLevel: 3, anchorWord: "অধ্যায়", addressNumber: "7", qid,
        artifactId: new Types.ObjectId(art.get(qid)!), reviewerId: reviewer, assignedBy: reviewer, roundNumber: 1, status: "assigned",
        threadKey: `t-${qid}`,
      } as never);
    }
    const all = await listMyQuestionReviews(String(reviewer), {}, {});
    expect(all.map((r) => r.qtCode ?? "none").sort()).toEqual(["QT-SOLVE", "QT-WORD", "none"]);
    const word = await listMyQuestionReviews(String(reviewer), {}, { qtCode: "QT-WORD" });
    expect(word.map((r) => [r.qid, r.qtCode])).toEqual([[Q01, "QT-WORD"]]);
    expect(await countMyQuestionReviews(String(reviewer), { qtCode: "QT-WORD" })).toBe(1);
    expect(await countMyQuestionReviews(String(reviewer), {})).toBe(3);
  });
});
