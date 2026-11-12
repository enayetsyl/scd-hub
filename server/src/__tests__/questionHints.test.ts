/**
 * GH-1 question hints (docs/prd-guardian-help.md §2, D-#1520/#1521) - in-memory Mongo.
 *
 *  - the loader refuses a leaking hint and a qid with no question; upsert replaces; dry run writes nothing
 *  - a guardian sees only the questions assigned to HER OWN linked child; no answer field on any type
 *  - step 2 is refused before step 1; one HintView per step per day
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { GraphQLObjectType, type GraphQLSchema } from "graphql";

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { QuestionHint } from "../modules/guardian-help/models/QuestionHint";
import { HintView } from "../modules/guardian-help/models/HintView";
import { assertGuardianOfStudent } from "../middleware/authz";
import { checkHintSteps, importQuestionHints, leakedAnswer, normHint } from "../modules/guardian-help/services/QuestionHintService";
import { childAssignedQuestions, openQuestionHint } from "../modules/guardian-help/services/GuardianHintService";
import { builder } from "../schema";
import "../modules/guardian-help/resolvers/questionHints";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
let sectionId: Types.ObjectId;
let classId: Types.ObjectId;
let yearId: Types.ObjectId;
let sidA = "";
let sidB = "";
let guardianA = "";
let guardianB = "";

const S = (a: string, b: string, c: string) => [a, b, c];
const guardianCtx = (id: string) => ({ auth: { userId: id, role: "GUARDIAN" } }) as never;

async function bankQuestion(qid: string, payload: Record<string, unknown>) {
  await ContentArtifact.create([
    {
      docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
      curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
      envelopeJson: { payload: { qid, ...payload } },
    },
  ]);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = year._id as Types.ObjectId;
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  classId = cls._id as Types.ObjectId;
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = sec._id as Types.ObjectId;
  const mk = async (n: number) =>
    String((await Student.create([{ schoolId: `GH1-${n}`, name: `Student ${n}`, rollNumber: String(n), classId: cls._id, sectionId: sec._id, active: true }]))[0]._id);
  sidA = await mk(1);
  sidB = await mk(2);
  const [gA] = await Guardian.create([{ identifierKind: "phone", identifier: "01700000011", phone: "01700000011", name: "A-র অভিভাবক", loginEnabled: true, active: true }]);
  const [gB] = await Guardian.create([{ identifierKind: "phone", identifier: "01700000012", phone: "01700000012", name: "B-র অভিভাবক", loginEnabled: true, active: true }]);
  guardianA = String(gA._id);
  guardianB = String(gB._id);
  await GuardianLink.create([
    { guardianId: gA._id, studentId: new Types.ObjectId(sidA), relation: "FATHER" },
    { guardianId: gB._id, studentId: new Types.ObjectId(sidB), relation: "MOTHER" },
  ]);

  // The bank: Q1 MCQ (answer "পাঁচ"), Q2 no hint yet, Q3 B's, Q4 extra homework, Q5 on the paper but NOT on A's list.
  const mcq = (qid: string) => ({
    question_text: `প্রশ্ন ${qid}`,
    options: [{ text: "তিন", is_correct: false }, { text: "পাঁচ", is_correct: true }, { text: "সাত", is_correct: false }],
  });
  for (const q of ["Q-GH1-0001", "Q-GH1-0002", "Q-GH1-0003", "Q-GH1-0004", "Q-GH1-0005"]) await bankQuestion(q, mcq(q));
  await bankQuestion("Q-GH1-FIB", { question_text: "বাংলাদেশের রাজধানী ____", blanks: [{ accepted: ["ঢাকা", "Dhaka"] }] });
  await bankQuestion("Q-GH1-TF", { question_text: "সত্য না মিথ্যা?", tf_answer: true });
  await bankQuestion("Q-GH1-GR", { question_text: "an or a?", answer_key: { accepted: ["an"] } });

  // A: homework Q1 + Q2; B: homework Q3 (a different child must never see it).
  const item = async (hwId: string, qids: string[], day: string) =>
    (await HomeworkItem.create([{
      hwId, academicYearId: yearId, classId, classLevel: 3, sectionId, subject: "MATH", dateGiven: new Date(`${day}T00:00:00.000Z`),
      topTags: ["t"], timeDecl: 10, qCount: qids.length, selectedQids: qids, declaredBy: new Types.ObjectId(), status: "issued",
    }]))[0];
  const rec = async (it: { _id: unknown; hwId: string }, sid: string) =>
    HomeworkStudentRecord.create([{
      hwItemId: it._id, hwId: it.hwId, studentId: new Types.ObjectId(sid), sectionId, classId, state: "GIVEN", issuedBy: new Types.ObjectId(),
    }]);
  const hwA = await item("HW-GH1-A", ["Q-GH1-0001", "Q-GH1-0002"], "2027-03-01");
  await rec(hwA, sidA);
  const hwB = await item("HW-GH1-B", ["Q-GH1-0003"], "2027-03-02");
  await rec(hwB, sidB);

  // A: extra homework item 1 = Q4 (hers), item 2 = Q5 (another child's, NOT on A's list).
  await MasteryPaper.create([{
    paperId: "P-GH1-EXTRA", source: "HW", sectionId, classId, academicYearId: yearId, classToken: "C3", subject: "MATH",
    date: new Date("2027-03-03T00:00:00.000Z"), extra: true,
    perStudentItems: [{ studentId: new Types.ObjectId(sidA), itemNos: [1] }, { studentId: new Types.ObjectId(sidB), itemNos: [2] }],
    items: [
      { itemNo: 1, origin: "BANK", qid: "Q-GH1-0004", loCodes: ["LO-X"], chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: 1 },
      { itemNo: 2, origin: "BANK", qid: "Q-GH1-0005", loCodes: ["LO-X"], chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: 1 },
    ],
  }]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const GOOD = {
  hints: [
    { qid: "Q-GH1-0001", steps: S("প্রশ্নটি আবার পড়ো।", "কোনটি কখনোই হতে পারে না?", "যেমন: ২ + ২ — চার; এবার তোমার অঙ্ক করো।") },
    { qid: "Q-GH1-0003", steps: S("সংখ্যাগুলো দেখো।", "কোন সংখ্যাটি বড়?", "যেমন: ৯ আর ৪ — ৯ বড়।") },
    { qid: "Q-GH1-0004", steps: S("প্রথম লাইন পড়ো।", "কী করতে বলা হয়েছে?", "যেমন: ১ + ১ — দুই।") },
  ],
};

describe("the leak rule (port of check_hints.py)", () => {
  it("matches whole words only: 'an' inside 'and' and 'মা' inside 'তোমার' are fine", () => {
    expect(leakedAnswer("cats and dogs", ["an"])).toBeNull();
    expect(leakedAnswer("এটা তোমার বই", ["মা"])).toBeNull();
    expect(leakedAnswer("answer is an apple", ["an"])).toBe("an");
    expect(leakedAnswer("উত্তর হলো ঢাকা।", [normHint("ঢাকা")])).toBe("ঢাকা");
  });
  it("checkHintSteps: option text, blanks, grammar words warn only, tf word warns only", () => {
    const mcq = { options: [{ text: "পাঁচ", is_correct: true }, { text: "সাত", is_correct: false }] };
    expect(checkHintSteps(S("ক", "সংখ্যা পাঁচ হতে পারে", "গ"), mcq).problems[0]).toMatch(/step 2 contains the answer 'পাঁচ'/);
    // a WRONG option's text is not the answer
    expect(checkHintSteps(S("ক", "সাত নয় তো?", "গ"), mcq).problems).toEqual([]);
    const gr = checkHintSteps(S("an comes before a vowel sound", "খ", "গ"), { answer_key: { accepted: ["an"] } });
    expect(gr.problems).toEqual([]);
    expect(gr.warnings[0]).toMatch(/grammar word 'an'/);
    const tf = checkHintSteps(S("ক", "খ", "যেমন: বাক্যটি সত্য।"), { tf_answer: true });
    expect(tf.problems).toEqual([]);
    expect(tf.warnings.length).toBe(1);
    expect(checkHintSteps(["ক", "খ"], mcq).problems[0]).toMatch(/৩টি/);
    expect(checkHintSteps(S("ক", "", "গ"), mcq).problems).toContain("step 2 empty");
    expect(checkHintSteps(S("ক".repeat(221), "খ", "গ"), mcq).problems[0]).toMatch(/too long/);
  });
});

describe("importQuestionHints (the loader)", () => {
  it("dry run writes nothing but reports the same counts", async () => {
    const r = await importQuestionHints(JSON.stringify(GOOD), PRINCIPAL, { dryRun: true });
    expect(r).toMatchObject({ ok: true, dryRun: true, total: 3, created: 3, updated: 0, refused: 0 });
    expect(await QuestionHint.countDocuments()).toBe(0);
  });

  it("refuses a leaking hint, a qid with no question, bad step counts and a repeat; loads the rest", async () => {
    const file = {
      hints: [
        ...GOOD.hints,
        { qid: "Q-GH1-0002", steps: S("ক", "এটি পাঁচ।", "গ") }, // leaks the correct option
        { qid: "Q-GH1-FIB", steps: S("ক", "খ", "উত্তর ঢাকা — মনে রেখো।") }, // leaks a blank
        { qid: "Q-GH1-NOPE", steps: S("ক", "খ", "গ") }, // no such question
        { qid: "Q-GH1-0005", steps: ["ক", "খ"] }, // two steps
        { qid: "Q-GH1-0003", steps: S("ক", "খ", "গ") }, // duplicate of an entry above
      ],
    };
    const r = await importQuestionHints(file, PRINCIPAL, { dryRun: false });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ total: 8, created: 3, refused: 5 });
    const msg = (qid: string) => r.problems.filter((p) => p.qid === qid).map((p) => p.message).join(" | ");
    expect(msg("Q-GH1-0002")).toMatch(/contains the answer 'পাঁচ'/);
    expect(msg("Q-GH1-FIB")).toMatch(/contains the answer 'ঢাকা'/);
    expect(msg("Q-GH1-NOPE")).toMatch(/কোনো বর্তমান প্রশ্ন নেই/);
    expect(msg("Q-GH1-0005")).toMatch(/2 ধাপ/);
    expect(msg("Q-GH1-0003")).toMatch(/duplicate/);
    expect(await QuestionHint.countDocuments()).toBe(3);
    expect(await QuestionHint.findOne({ qid: "Q-GH1-0002" })).toBeNull();
    const h = await QuestionHint.findOne({ qid: "Q-GH1-0001" }).lean();
    expect(h).toMatchObject({ classToken: "C3", subject: "MATH", language: "bn", source: "agent", version: 1 });
    expect(h!.steps.map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it("upsert replaces (version +1); an identical entry is left alone", async () => {
    const again = await importQuestionHints(GOOD, PRINCIPAL, { dryRun: false });
    expect(again).toMatchObject({ ok: true, created: 0, updated: 0, unchanged: 3 });
    const changed = { hints: [{ qid: "Q-GH1-0001", steps: S("নতুন ধাপ ১", "নতুন ধাপ ২", "যেমন: ১ + ২ — তিন।") }] };
    const r = await importQuestionHints(changed, PRINCIPAL, { dryRun: false });
    expect(r).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
    const h = await QuestionHint.findOne({ qid: "Q-GH1-0001" }).lean();
    expect(h!.version).toBe(2);
    expect(h!.steps[0].textBn).toBe("নতুন ধাপ ১");
    expect(await QuestionHint.countDocuments({ qid: "Q-GH1-0001" })).toBe(1);
  });

  it("an unreadable file or one without a hints list is reported, not thrown", async () => {
    expect((await importQuestionHints("{nope", PRINCIPAL, { dryRun: true })).fileError).toMatch(/JSON/);
    expect((await importQuestionHints({ x: 1 }, PRINCIPAL, { dryRun: true })).fileError).toMatch(/hints/);
  });
});

describe("what a guardian sees", () => {
  it("only the questions assigned to her own child, text only, with the hint count", async () => {
    const a = await childAssignedQuestions(guardianA, sidA);
    expect(a.map((q) => q.qid).sort()).toEqual(["Q-GH1-0001", "Q-GH1-0002", "Q-GH1-0004"]);
    // not B's homework question, and not the extra-homework item that is on B's list only
    expect(a.find((q) => q.qid === "Q-GH1-0003")).toBeUndefined();
    expect(a.find((q) => q.qid === "Q-GH1-0005")).toBeUndefined();
    const q1 = a.find((q) => q.qid === "Q-GH1-0001")!;
    expect(q1).toMatchObject({ source: "HOMEWORK", subject: "MATH", hintCount: 3, opened: [] });
    expect(a.find((q) => q.qid === "Q-GH1-0004")!.source).toBe("EXTRA_HOMEWORK");
    expect(a.find((q) => q.qid === "Q-GH1-0002")!.hintCount).toBe(0); // no hints for it yet
    // Nothing in the payload carries the answer or the options.
    const blob = JSON.stringify(a);
    expect(blob).not.toContain("is_correct");
    expect(Object.keys(q1).sort()).toEqual(["date", "hintCount", "opened", "qid", "source", "subject", "textBn"]);

    const b = await childAssignedQuestions(guardianB, sidB);
    expect(b.map((q) => q.qid).sort()).toEqual(["Q-GH1-0003", "Q-GH1-0005"]);
  });

  it("the guardian link gate refuses a guardian asking about another family's child", async () => {
    await expect(assertGuardianOfStudent(guardianCtx(guardianA), sidB)).rejects.toThrow();
    await expect(assertGuardianOfStudent(guardianCtx(guardianA), sidA)).resolves.toBeUndefined();
  });

  it("no guardian GraphQL type has an answer / options / correctness field", () => {
    const schema: GraphQLSchema = builder.toSchema();
    const names = ["ChildAssignedQuestion", "ChildHintStep", "OpenedQuestionHint"];
    for (const n of names) {
      const t = schema.getType(n) as GraphQLObjectType;
      expect(t).toBeDefined();
      for (const f of Object.keys(t.getFields())) expect(f).not.toMatch(/answer|correct|option|accepted|blank|pair|key|tf/i);
    }
  });

  it("step 2 is refused before step 1; step 3 before step 2; a step without hints is refused", async () => {
    await expect(openQuestionHint(guardianA, sidA, "Q-GH1-0001", 2)).rejects.toThrow(/আগের ইঙ্গিত/);
    await expect(openQuestionHint(guardianA, sidA, "Q-GH1-0001", 3)).rejects.toThrow(/আগের ইঙ্গিত/);
    await expect(openQuestionHint(guardianA, sidA, "Q-GH1-0002", 1)).rejects.toThrow(/ইঙ্গিত নেই/);
    await expect(openQuestionHint(guardianA, sidA, "Q-GH1-0001", 4)).rejects.toThrow(/১ থেকে ৩/);
    expect(await HintView.countDocuments()).toBe(0);
    const s1 = await openQuestionHint(guardianA, sidA, "Q-GH1-0001", 1);
    expect(s1).toMatchObject({ step: 1, textBn: "নতুন ধাপ ১", hasNext: true });
    await expect(openQuestionHint(guardianA, sidA, "Q-GH1-0001", 3)).rejects.toThrow(/আগের ইঙ্গিত/);
    const s2 = await openQuestionHint(guardianA, sidA, "Q-GH1-0001", 2);
    expect(s2.step).toBe(2);
    const s3 = await openQuestionHint(guardianA, sidA, "Q-GH1-0001", 3);
    expect(s3).toMatchObject({ step: 3, hasNext: false });
  });

  it("a question that is not assigned to this child is refused (a link does not open the whole bank)", async () => {
    await expect(openQuestionHint(guardianA, sidA, "Q-GH1-0003", 1)).rejects.toThrow(/দেওয়া হয়নি/);
    await expect(openQuestionHint(guardianB, sidB, "Q-GH1-0001", 1)).rejects.toThrow(/দেওয়া হয়নি/);
  });

  it("steps are gated per guardian: a second guardian of the same child starts at step 1", async () => {
    const [g2] = await Guardian.create([{ identifierKind: "phone", identifier: "01700000013", phone: "01700000013", name: "দ্বিতীয়", loginEnabled: true, active: true }]);
    await GuardianLink.create([{ guardianId: g2._id, studentId: new Types.ObjectId(sidA), relation: "MOTHER" }]);
    await expect(openQuestionHint(String(g2._id), sidA, "Q-GH1-0001", 2)).rejects.toThrow(/আগের ইঙ্গিত/);
  });

  it("HintView is written once per step per day", async () => {
    const before = await HintView.countDocuments({ qid: "Q-GH1-0001" });
    expect(before).toBe(3);
    await openQuestionHint(guardianA, sidA, "Q-GH1-0001", 1);
    await openQuestionHint(guardianA, sidA, "Q-GH1-0001", 1);
    await openQuestionHint(guardianA, sidA, "Q-GH1-0001", 3);
    expect(await HintView.countDocuments({ qid: "Q-GH1-0001" })).toBe(3);
    // A different day writes a new row for the same step.
    await HintView.create({ guardianUserId: new Types.ObjectId(guardianA), studentId: new Types.ObjectId(sidA), qid: "Q-GH1-0001", step: 1, day: "2000-01-01" });
    expect(await HintView.countDocuments({ qid: "Q-GH1-0001", step: 1 })).toBe(2);
  });

  it("the list shows the steps this guardian already opened, and none for another guardian", async () => {
    const mine = (await childAssignedQuestions(guardianA, sidA)).find((q) => q.qid === "Q-GH1-0001")!;
    expect(mine.opened.map((s) => s.step)).toEqual([1, 2, 3]);
    expect(mine.opened[0].textBn).toBe("নতুন ধাপ ১");
    const other = await Guardian.findOne({ identifier: "01700000013" }).lean();
    const theirs = (await childAssignedQuestions(String(other!._id), sidA)).find((q) => q.qid === "Q-GH1-0001")!;
    expect(theirs.opened).toEqual([]);
  });
});
