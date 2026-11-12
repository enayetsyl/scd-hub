/**
 * PR-I — questions held for the exam papers (D-#1408).
 *
 * One section, one objective, a gold bank of four (Q01..Q04). Q01 and Q02 are put on hold with a pasted
 * id list; then every picker must leave them out and every by-id path must refuse them with the reason:
 *   - set / clear one at a time, bulk by id list (marked / not found / unchanged, a few hundred ids in
 *     one call), bulk by filter (count first, refused when the count moved), audited, idempotent
 *   - the homework draft, the weekly assignment, the extra homework, the re-test, `goldBank`
 *   - `createPaper` refuses a held question for HW and for CT
 *   - the `examPool` lens on `questions`, the badge field, and the coverage's usable / held counts
 *   - a teacher without question:manage cannot set or clear it
 * (Re-import keeping the mark is asserted in questions.test.ts beside the IMPORTANT mark's.)
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
import { Audit } from "../modules/platform/models/Audit";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { MasteryAction } from "../modules/mastery/models/MasteryAction";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { importCatalogue, savePolicy, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, saveResults } from "../modules/mastery/services/MasteryWorkService";
import { createExtraHomework, extraHomeworkPreview, homeworkDraft } from "../modules/mastery/services/MasteryHomeworkService";
import { buildRetest, decideAction, recordHeld } from "../modules/mastery/services/MasteryActionService";
import { buildAssignment, deleteAssignment, goldBank, sheetDetail } from "../modules/mastery/services/MasteryAssignmentService";
import { AssessmentSet } from "../modules/assessment/models/AssessmentSet";
import { addQuestionToSet, createSetWithQuestions } from "../modules/assessment/services/AssessmentService";
import { bankCoverage } from "../modules/mastery/services/MasteryBankCoverageService";
import { markExamPool, markExamPoolByFilter, setQuestionExamPool } from "../modules/questions/services/QuestionEditService";
import { builder } from "../schema";
import "../modules/mastery/resolvers/masteryCatalogue";
import "../modules/questions/resolvers/questions";
import "../modules/questions/resolvers/questionEdit";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
const APPROVER = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const, grantedPermissions: ["mastery:approve"] as never };
let sectionId = "";
const sids: string[] = [];
const art = new Map<string, string>(); // qid -> artifact id

const LO = "LO-C3-MATH-07-03";
const [Q01, Q02, Q03, Q04] = ["QP-EX-Q01", "QP-EX-Q02", "QP-EX-Q03", "QP-EX-Q04"];
const HELD = [Q01, Q02];
const USABLE = [Q03, Q04];
const ACTOR = new Types.ObjectId().toString();

const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [{ code: LO, labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: ["QT-SOLVE"] }],
  questionTypes: [{ code: "QT-SOLVE", labelBn: "সমাধান করো", marks: 2 }],
});

const base = {
  docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
  curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
};
const envelope = (qid: string) => ({ tags: { topic_tag: LO, lo_codes: [LO] }, payload: { qid, topic_tag: LO, lo_codes: [LO], question_text: `${qid} লেখা` } });

async function hw(date: string) {
  const p = await createPaper({
    sectionId, subject: "MATH", source: "HW", date,
    items: [{ origin: "TEACHER", textBn: "৮৪৬ ÷ ৬", loCode: LO, questionTypeCode: "QT-SOLVE" }, { origin: "TEACHER", textBn: "৯৫২ ÷ ৭", loCode: LO, questionTypeCode: "QT-SOLVE" }],
  }, TEACHER);
  await saveResults(p.paperId, [0, 1, 2].map((i) => ({ studentId: sids[i], items: [{ itemNo: 1, marks: 0 }, { itemNo: 2, marks: 0 }] })), TEACHER);
  await confirmPaper(p.paperId, TEACHER);
}

const gql = (source: string, role: "PRINCIPAL" | "TEACHER", variableValues?: Record<string, unknown>, granted: string[] = []) =>
  graphql({
    schema: builder.toSchema(), source, variableValues,
    contextValue: { auth: { role, userId: role === "PRINCIPAL" ? PRINCIPAL.userId : TEACHER_ID, grantedPermissions: granted, revokedPermissions: [] } },
  }) as Promise<ExecutionResult>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(sec._id);
  for (let i = 1; i <= 4; i++) {
    const [s] = await Student.create([{ schoolId: `EX-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }
  const r = await importCatalogue(CATALOGUE, true, PRINCIPAL);
  if (!r.ok) throw new Error(r.errors.join("; "));
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  for (const qid of [Q01, Q02, Q03, Q04]) {
    const [a] = await ContentArtifact.create([{ ...base, envelopeJson: envelope(qid) }]);
    art.set(qid, String(a._id));
  }
  mockTeacher.mockResolvedValue(TEACHER_ID);
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

describe("holding questions", () => {
  it("one at a time: set, idempotent, clear - each real change audited", async () => {
    const id = art.get(Q04)!;
    const on = await setQuestionExamPool({ artifactId: id, on: true, actorId: ACTOR, actorRole: "PRINCIPAL" });
    expect(on).toMatchObject({ qid: Q04, examPool: true, changed: true });
    const doc = await ContentArtifact.findById(id).lean();
    expect(doc!.examPoolAt).toBeInstanceOf(Date);
    expect(String(doc!.examPoolBy)).toBe(ACTOR);
    const again = await setQuestionExamPool({ artifactId: id, on: true, actorId: ACTOR });
    expect(again.changed).toBe(false);
    expect(await Audit.countDocuments({ eventKind: "QUESTION_EXAM_HELD", targetId: id })).toBe(1);
    const off = await setQuestionExamPool({ artifactId: id, on: false, actorId: ACTOR, actorRole: "PRINCIPAL" });
    expect(off).toMatchObject({ examPool: false, changed: true });
    expect((await ContentArtifact.findById(id).lean())!.examPoolAt).toBeNull();
    expect(await Audit.countDocuments({ eventKind: "QUESTION_EXAM_RELEASED", targetId: id })).toBe(1);
  });

  it("by id list: marked / not found / unchanged, and a repeat changes nothing", async () => {
    const first = await markExamPool({ qids: [Q01, " " + Q02 + " ", "QP-NOPE-1", Q01, ""], on: true, actorId: ACTOR });
    expect(first).toEqual({ marked: 2, notFound: ["QP-NOPE-1"], unchanged: [] });
    const second = await markExamPool({ qids: [Q01, Q02, Q03], on: true, actorId: ACTOR });
    expect(second.marked).toBe(1); // Q03
    expect(second.unchanged.sort()).toEqual([Q01, Q02]);
    const rel = await markExamPool({ qids: [Q03, "QP-NOPE-2"], on: false, actorId: ACTOR });
    expect(rel).toEqual({ marked: 1, notFound: ["QP-NOPE-2"], unchanged: [] });
    const held = await ContentArtifact.find({ examPoolAt: { $ne: null } }).lean();
    expect(held.map((d) => (d.envelopeJson as any).payload.qid).sort()).toEqual(HELD);
    expect(await Audit.countDocuments({ eventKind: "QUESTION_EXAM_HELD", "meta.how": "id-list" })).toBe(3);
  });

  it("takes a few hundred ids in one call", async () => {
    const extra = Array.from({ length: 300 }, (_, i) => `QP-BULK-${String(i).padStart(4, "0")}`);
    await ContentArtifact.insertMany(extra.map((qid) => ({ ...base, subject: "ENG", envelopeJson: { tags: { topic_tag: "TOP-OTHER" }, payload: { qid, question_text: qid } } })));
    const res = await markExamPool({ qids: [...extra, ...Array.from({ length: 40 }, (_, i) => `QP-GONE-${i}`)], on: true, actorId: ACTOR });
    expect(res.marked).toBe(300);
    expect(res.notFound).toHaveLength(40);
    expect(await ContentArtifact.countDocuments({ subject: "ENG", examPoolAt: { $ne: null } })).toBe(300);
    const back = await markExamPool({ qids: extra, on: false, actorId: ACTOR });
    expect(back.marked).toBe(300);
  });

  it("by filter: refused when the count moved, applied when it matches", async () => {
    const filter = { docType: "question", current: true, subject: "MATH", "envelopeJson.payload.qid": { $in: [Q03, Q04] } };
    await expect(markExamPoolByFilter({ filter, expectedCount: 5, on: true, actorId: ACTOR })).rejects.toThrow(/matches 2 questions, not 5/);
    expect(await ContentArtifact.countDocuments({ "envelopeJson.payload.qid": { $in: [Q03, Q04] }, examPoolAt: { $ne: null } })).toBe(0);
    const ok = await markExamPoolByFilter({ filter, expectedCount: 2, on: true, actorId: ACTOR });
    expect(ok.marked).toBe(2);
    const rel = await markExamPoolByFilter({ filter, expectedCount: 2, on: false, actorId: ACTOR });
    expect(rel.marked).toBe(2);
  });

  it("only question:manage holders can set or clear it; the teacher is refused and nothing moves", async () => {
    const m = `mutation($id: String!, $on: Boolean!) { setQuestionExamPool(artifactId: $id, on: $on) { examPool changed } }`;
    const denied = await gql(m, "TEACHER", { id: art.get(Q03)!, on: true });
    expect(denied.errors).toBeDefined();
    const bulk = await gql(`mutation { markExamPool(qids: ["${Q03}"], on: true) { marked } }`, "TEACHER");
    expect(bulk.errors).toBeDefined();
    const byFilter = await gql(`mutation { markExamPoolByFilter(filter: {subject: "MATH"}, expectedCount: 4, on: true) { marked } }`, "TEACHER");
    expect(byFilter.errors).toBeDefined();
    expect((await ContentArtifact.findById(art.get(Q03)!).lean())!.examPoolAt ?? null).toBeNull();
    const ok = await gql(m, "PRINCIPAL", { id: art.get(Q03)!, on: true });
    expect(ok.errors).toBeUndefined();
    expect((ok.data as any).setQuestionExamPool).toEqual({ examPool: true, changed: true });
    await gql(m, "PRINCIPAL", { id: art.get(Q03)!, on: false });
  });
});

describe("the bank list lens and badge", () => {
  const list = async (role: "PRINCIPAL" | "TEACHER", arg: string) => {
    // A teacher reads the bank by grant; give the test teacher the whole-bank read so the badge is what is tested.
    const r = await gql(`query { questions(subject: "MATH", classLevel: 3, ${arg} limit: 50) { qid examPool } }`, role, undefined, role === "TEACHER" ? ["question_bank:view_all"] : []);
    expect(r.errors).toBeUndefined();
    return (r.data as any).questions as { qid: string; examPool: boolean }[];
  };
  it("default is any; only / exclude narrow; a teacher sees the badge and may filter", async () => {
    const all = await list("PRINCIPAL", "");
    expect(all.map((q) => [q.qid, q.examPool]).sort()).toEqual([[Q01, true], [Q02, true], [Q03, false], [Q04, false]]);
    expect((await list("PRINCIPAL", 'examPool: "only"')).map((q) => q.qid).sort()).toEqual(HELD);
    expect((await list("PRINCIPAL", 'examPool: "exclude"')).map((q) => q.qid).sort()).toEqual(USABLE);
    expect((await list("PRINCIPAL", 'examPool: "any"')).length).toBe(4);
    const t = await list("TEACHER", 'examPool: "only"');
    expect(t.map((q) => [q.qid, q.examPool]).sort()).toEqual([[Q01, true], [Q02, true]]);
  });

  it("questionsCount matches the same filter", async () => {
    const c = await gql(`query { questionsCount(filter: { subject: "MATH", classLevel: 3, examPool: "only" }) }`, "PRINCIPAL");
    expect((c.data as any).questionsCount).toBe(2);
  });
});

describe("every picker leaves held questions out", () => {
  it("goldBank: exclude by default, only / any on request", async () => {
    expect((await goldBank([LO])).map((q) => q.qid).sort()).toEqual(USABLE);
    expect((await goldBank([LO], "only")).map((q) => q.qid).sort()).toEqual(HELD);
    expect((await goldBank([LO], "any")).length).toBe(4);
  });

  it("homework draft", async () => {
    await LessonDelivery.create({
      noteId: new Types.ObjectId(), slotId: new Types.ObjectId(), sectionId: new Types.ObjectId(sectionId), classLevel: 3, subject: "MATH",
      dateKey: "2027-03-10", teacherId: new Types.ObjectId(TEACHER_ID), updatedBy: new Types.ObjectId(TEACHER_ID),
      rosterStudentIds: sids.map((s) => new Types.ObjectId(s)),
      sessions: [{ chapter: "7", anchorWord: "অধ্যায়", sessionIndex: 1, sessionOf: 1, titleBn: "ভাগ", finished: true, loCodes: [LO] }],
    });
    await savePolicy(null, null, { homeworkDraftQuestionsPerObjective: 4 }, PRINCIPAL);
    const d = await homeworkDraft(sectionId, "MATH", "2027-03-10", TEACHER);
    const bankQids = d.items.filter((i) => i.origin === "BANK").map((i) => i.qid);
    expect([...bankQids].sort()).toEqual(USABLE);
    await savePolicy(null, null, {}, PRINCIPAL);
  });

  it("weekly assignment", async () => {
    const a = await buildAssignment({
      sectionId, subject: "MATH", dueDate: "2027-03-18", rememberLayout: false,
      layout: { totalMarks: 2, minutes: 20, partAOn: false, partAMarks: 0, partALoCodes: [], partBMarks: 2, mixWeak: 100, mixImproving: 0, mixRevision: 0, questionTypeCodes: [] },
    }, TEACHER);
    const sheet = await sheetDetail(a.id, sids[0], TEACHER);
    expect(sheet.items.length).toBe(1);
    expect(USABLE).toContain(sheet.items[0].qid);
    await deleteAssignment(a.id, TEACHER);
  });

  it("extra homework: not proposed, and a held id is refused with the reason", async () => {
    await savePolicy(null, null, { extraHomeworkMaxQuestions: 4 }, PRINCIPAL);
    const p = await extraHomeworkPreview(sectionId, "MATH", TEACHER);
    const kid = p.find((s) => s.items.length > 0)!;
    expect(kid.items.map((i) => i.qid).sort()).toEqual(USABLE);
    await expect(
      createExtraHomework({ sectionId, subject: "MATH", date: "2027-03-12", sheets: [{ studentId: kid.studentId, items: [{ artifactId: art.get(Q01)!, loCode: LO }] }] }, TEACHER),
    ).rejects.toThrow(/পরীক্ষার জন্য রাখা/);
    await savePolicy(null, null, {}, PRINCIPAL);
  });

  it("re-test", async () => {
    const open = await MasteryAction.find({ status: "PROPOSED" }).lean();
    expect(open).toHaveLength(1);
    const id = String(open[0]._id);
    await decideAction(id, { decision: "EXTRA_CLASS" as const, date: "2027-03-20", slotKind: "PERIOD" as const, periodNumber: 7, attendees: "WEAK" as const }, APPROVER);
    await recordHeld(id, [{ studentId: sids[0], present: true }, { studentId: sids[1], present: true }], TEACHER);
    const rt = await buildRetest(id, TEACHER);
    const paper = await MasteryPaper.findOne({ paperId: rt.retestPaperId! }).lean();
    expect(paper!.items.length).toBeGreaterThanOrEqual(1);
    for (const it of paper!.items) expect(USABLE).toContain(it.qid);
  });
});

describe("createPaper refuses a held question, for every source", () => {
  for (const source of ["HW", "CT"] as const) {
    it(`${source}: names the reason`, async () => {
      await expect(
        createPaper({
          sectionId, subject: "MATH", source, date: "2027-03-25",
          items: [{ origin: "BANK", artifactId: art.get(Q01)!, loCode: LO, questionTypeCode: "QT-SOLVE" }],
        }, TEACHER),
      ).rejects.toThrow(/QP-EX-Q01.*পরীক্ষার জন্য রাখা/);
    });
  }

  it("a usable bank question still goes on a sheet", async () => {
    const p = await createPaper({
      sectionId, subject: "MATH", source: "HW", date: "2027-03-26",
      items: [{ origin: "BANK", artifactId: art.get(Q03)!, loCode: LO, questionTypeCode: "QT-SOLVE" }],
    }, TEACHER);
    expect(p.items[0].qid).toBe(Q03);
  });

  it("releasing the hold lets it through again", async () => {
    await markExamPool({ qids: [Q01], on: false, actorId: ACTOR });
    const p = await createPaper({
      sectionId, subject: "MATH", source: "HW", date: "2027-03-27",
      items: [{ origin: "BANK", artifactId: art.get(Q01)!, loCode: LO, questionTypeCode: "QT-SOLVE" }],
    }, TEACHER);
    expect(p.items[0].qid).toBe(Q01);
    await markExamPool({ qids: [Q01], on: true, actorId: ACTOR });
  });
});

describe("coverage shows usable and held", () => {
  it("goldCount is usable, heldCount is held, per row and per cell", async () => {
    const v = await bankCoverage("C3", "MATH");
    const row = v.rows.find((r) => r.code === LO)!;
    expect(row.goldCount).toBe(2);
    expect(row.heldCount).toBe(2);
    const cell = row.cells.find((c) => c.typeCode === null)!;
    expect([cell.goldCount, cell.heldCount]).toEqual([2, 2]);
    expect(v.totals).toMatchObject({ gold: 2, held: 2 });
  });
});

describe("question-bank sets (HW / AS / CT) refuse a held question", () => {
  it("addQuestionToSet and createSetWithQuestions name the reason; a usable one still goes in", async () => {
    const setId = new Types.ObjectId();
    await AssessmentSet.create({
      _id: setId, setType: "HW", sectionId: new Types.ObjectId(sectionId), classId: new Types.ObjectId(), subjectId: new Types.ObjectId(),
      status: "draft", basketItems: [], createdBy: new Types.ObjectId(),
    } as never);
    await expect(addQuestionToSet(String(setId), art.get(Q01)!, ACTOR)).rejects.toThrow(/QP-EX-Q01.*পরীক্ষার জন্য রাখা/);
    expect((await AssessmentSet.findById(setId).lean())!.basketItems).toHaveLength(0);
    await expect(
      createSetWithQuestions({ setType: "CT", sectionId, classId: String(new Types.ObjectId()), subjectId: String(new Types.ObjectId()), artifactIds: [art.get(Q03)!, art.get(Q02)!], actorId: ACTOR } as never),
    ).rejects.toThrow(/পরীক্ষার জন্য রাখা/);
    const ok = await addQuestionToSet(String(setId), art.get(Q03)!, ACTOR);
    expect(ok.itemCount).toBe(1);
  });
});

describe("coverage CSV carries the held column", () => {
  it("header and a cell line", async () => {
    const v = await bankCoverage("C3", "MATH");
    const lines = v.typeCsv.split(/\r?\n/);
    expect(lines[0]).toBe("objective,type,gold,pending,held");
    expect(lines).toContain(`${LO},-,2,0,2`);
  });
});
