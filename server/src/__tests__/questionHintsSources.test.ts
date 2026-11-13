/**
 * GH-1 review fixes - in-memory Mongo.
 *  - the ASSIGNMENT source (Part A + the child's own Part B; DRAFT excluded; mastery-off subject excluded)
 *  - extra homework follows the same mastery switch
 *  - section history: a gender split must not hide the earlier section's questions
 *  - the sources filter (Assignments tab vs Homework tab)
 *  - true/false verdict words: refused in steps 1-2, warned in step 3
 *  - the guardian link checked through the REAL resolver
 *  - the "unchanged" check also compares language / source / classToken
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { graphql, type ExecutionResult } from "graphql";

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Enrolment } from "../modules/foundation/models/Enrolment";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { MasteryAssignment } from "../modules/mastery/models/MasteryAssignment";
import { MasteryAssignmentSheet } from "../modules/mastery/models/MasteryAssignmentSheet";
import { MasteryEnablement } from "../modules/mastery/models/MasteryEnablement";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { QuestionHint } from "../modules/guardian-help/models/QuestionHint";
import { checkHintSteps, importQuestionHints } from "../modules/guardian-help/services/QuestionHintService";
import { childAssignedQuestions } from "../modules/guardian-help/services/GuardianHintService";
import { builder } from "../schema";
import "../modules/guardian-help/resolvers/questionHints";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };
let sid = "";
let guardianLinked = "";
let guardianOther = "";

const LAYOUT = { totalMarks: 6, minutes: 30, partAOn: true, partAMarks: 2, partBMarks: 4, mixWeak: 100, mixImproving: 0, mixRevision: 0 };
const item = (qid: string, textBn: string) => ({ origin: "BANK" as const, qid, textBn, loCode: "LO-X", chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: 1, band: "SECTION" as const });
const paperItem = (qid: string) => ({ itemNo: 1, origin: "BANK" as const, qid, loCodes: ["LO-X"], chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: 1 });

async function bank(qid: string, payload: Record<string, unknown> = {}) {
  await ContentArtifact.create([
    {
      docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
      curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
      envelopeJson: { payload: { qid, question_text: `বইয়ের প্রশ্ন ${qid}`, ...payload } },
    },
  ]);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  // Main was split into B (boys) and G; the child sat in M early in the year, now in B.
  const [secOld, secNew] = await Section.create([
    { classId: cls._id, code: "M", nameBn: "মূল" },
    { classId: cls._id, code: "B", nameBn: "বালক" },
  ]);
  const [st] = await Student.create([{ schoolId: "GH1S-1", name: "S", rollNumber: "1", classId: cls._id, sectionId: secNew._id, active: true }]);
  sid = String(st._id);
  await Enrolment.create([
    { studentId: st._id, academicYearId: year._id, classId: cls._id, classLevel: 3, sectionId: secOld._id, status: "CLOSED", startKey: "2027-01-05", endKey: "2027-03-31" },
    { studentId: st._id, academicYearId: year._id, classId: cls._id, classLevel: 3, sectionId: secNew._id, status: "ACTIVE", startKey: "2027-04-01" },
  ]);
  const [g1] = await Guardian.create([{ identifierKind: "phone", identifier: "01710000001", phone: "01710000001", name: "লিংকড", loginEnabled: true, active: true }]);
  const [g2] = await Guardian.create([{ identifierKind: "phone", identifier: "01710000002", phone: "01710000002", name: "অন্য", loginEnabled: true, active: true }]);
  guardianLinked = String(g1._id);
  guardianOther = String(g2._id);
  await GuardianLink.create([{ guardianId: g1._id, studentId: st._id, relation: "FATHER" }]);

  await MasteryEnablement.create([{ academicYearId: year._id, classToken: "C3", subject: "MATH", enabled: true }]); // BAN stays off
  for (const q of ["A1", "B1", "A2", "B2", "A3", "E1", "E2", "E3", "TF1", "TF2", "L1"]) await bank(`Q-S-${q}`);

  const mkAssignment = async (sectionId: Types.ObjectId, subject: "MATH" | "BAN", week: string, status: "SENT" | "DRAFT", partA: string, own: string) => {
    const [a] = await MasteryAssignment.create([{
      sectionId, classId: cls._id, academicYearId: year._id, classToken: "C3", subject, dueDate: new Date("2027-03-10T00:00:00.000Z"), week,
      layout: LAYOUT, partA: [item(partA, `ক অংশ ${partA}`)], status, builtAt: new Date(), builtBy: new Types.ObjectId(),
    }]);
    await MasteryAssignmentSheet.create([{ assignmentId: a._id, studentId: st._id, items: [item(own, `খ অংশ ${own}`)], status: "APPROVED" }]);
  };
  await mkAssignment(secOld._id as Types.ObjectId, "MATH", "2027-W10", "SENT", "Q-S-A1", "Q-S-B1"); // earlier section, SENT
  await mkAssignment(secNew._id as Types.ObjectId, "MATH", "2027-W11", "DRAFT", "Q-S-A2", "Q-S-B2"); // DRAFT
  await mkAssignment(secNew._id as Types.ObjectId, "BAN", "2027-W12", "SENT", "Q-S-A3", "Q-S-A3"); // mastery off for BAN

  const mkExtra = async (sectionId: Types.ObjectId, subject: "MATH" | "BAN", paperId: string, qid: string, date: string) =>
    MasteryPaper.create([{
      paperId, source: "HW", sectionId, classId: cls._id, academicYearId: year._id, classToken: "C3", subject, date: new Date(`${date}T00:00:00.000Z`), extra: true,
      perStudentItems: [{ studentId: st._id, itemNos: [1] }], items: [paperItem(qid)],
    }]);
  await mkExtra(secOld._id as Types.ObjectId, "MATH", "P-S-E1", "Q-S-E1", "2027-03-12"); // earlier section, switch on
  await mkExtra(secNew._id as Types.ObjectId, "BAN", "P-S-E2", "Q-S-E2", "2027-04-12"); // switch off
  await bank("Q-S-TFX", { question_type: "true_false", tf_answer: true });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("assigned questions by source", () => {
  it("ASSIGNMENT: Part A + the child's own Part B; DRAFT and a mastery-off subject are excluded", async () => {
    const list = await childAssignedQuestions(guardianLinked, sid, ["ASSIGNMENT"]);
    expect(list.map((q) => q.qid).sort()).toEqual(["Q-S-A1", "Q-S-B1"]);
    expect(list.every((q) => q.source === "ASSIGNMENT")).toBe(true);
    expect(list.find((q) => q.qid === "Q-S-B1")!.textBn).toBe("খ অংশ Q-S-B1"); // as printed on the sheet
  });

  it("section history: the early section's SENT assignment and extra homework still show after a split", async () => {
    const all = await childAssignedQuestions(guardianLinked, sid);
    const qids = all.map((q) => q.qid);
    expect(qids).toContain("Q-S-A1"); // assignment from the section the child has left
    expect(qids).toContain("Q-S-E1"); // extra homework from it
  });

  it("extra homework follows the same mastery switch as assignments", async () => {
    const extra = await childAssignedQuestions(guardianLinked, sid, ["EXTRA_HOMEWORK"]);
    expect(extra.map((q) => q.qid)).toEqual(["Q-S-E1"]); // Q-S-E2 is BAN (switch off)
    const all = (await childAssignedQuestions(guardianLinked, sid)).map((q) => q.qid);
    expect(all).not.toContain("Q-S-E2");
    expect(all).not.toContain("Q-S-A3");
    expect(all).not.toContain("Q-S-A2");
    expect(all).not.toContain("Q-S-B2");
  });

  it("the sources filter keeps the tabs apart", async () => {
    const hw = await childAssignedQuestions(guardianLinked, sid, ["HOMEWORK", "EXTRA_HOMEWORK"]);
    expect(hw.map((q) => q.source)).toEqual(["EXTRA_HOMEWORK"]);
    expect((await childAssignedQuestions(guardianLinked, sid, ["ASSIGNMENT"])).some((q) => q.source !== "ASSIGNMENT")).toBe(false);
  });
});

describe("true/false verdict words", () => {
  const tf = { question_type: "true_false", tf_answer: true };
  it("refused in step 1 or 2 (whole word, any case, both verdicts); step 3 only warns", () => {
    expect(checkHintSteps(["বাক্যটি সত্য কিনা ভাবো।", "খ", "গ"], tf).problems[0]).toMatch(/step 1 names a true\/false verdict word 'সত্য'/);
    expect(checkHintSteps(["ক", "এটি মিথ্যা নয় তো?", "গ"], tf).problems[0]).toMatch(/step 2 .*'মিথ্যা'/);
    expect(checkHintSteps(["Is it TRUE?", "খ", "গ"], tf).problems[0]).toMatch(/'true'/);
    expect(checkHintSteps(["ক", "False or not?", "গ"], { question_type: "true_false" }).problems[0]).toMatch(/'false'/);
    const s3 = checkHintSteps(["ক", "খ", "যেমন: আকাশ নীল — সত্য, কারণ সূর্যের আলো ছড়ায়।"], tf);
    expect(s3.problems).toEqual([]);
    expect(s3.warnings.join("|")).toMatch(/step 3 says 'সত্য'/);
    // an ordinary (non true/false) item is not affected; words inside other words are fine
    expect(checkHintSteps(["সত্য কথা বলো", "খ", "গ"], { options: [{ text: "পাঁচ", is_correct: true }] }).problems).toEqual([]);
    expect(checkHintSteps(["সত্যবাদী হও", "খ", "গ"], tf).problems).toEqual([]);
  });

  it("the loader refuses it and prints the step text; step 3 loads with a warning", async () => {
    const r = await importQuestionHints(
      { hints: [{ qid: "Q-S-TFX", steps: ["কথাটি সত্য কিনা দেখো।", "খ", "গ"] }, { qid: "Q-S-TF1", steps: ["ক", "খ", "গ"] }] },
      PRINCIPAL, { dryRun: true },
    );
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].message).toContain("কথাটি সত্য কিনা দেখো।");
    const ok = await importQuestionHints({ hints: [{ qid: "Q-S-TFX", steps: ["ক", "খ", "যেমন: বাক্যটি মিথ্যা।"] }] }, PRINCIPAL, { dryRun: true });
    expect(ok).toMatchObject({ ok: true, created: 1 });
    expect(ok.warnings[0].message).toContain("যেমন: বাক্যটি মিথ্যা।");
  });
});

describe("upsert: unchanged also compares language / source / classToken", () => {
  it("same steps but another language, source or class token is an update", async () => {
    const file = { hints: [{ qid: "Q-S-L1", steps: ["ক", "খ", "গ"] }] };
    expect(await importQuestionHints(file, PRINCIPAL, { dryRun: false })).toMatchObject({ created: 1 });
    expect(await importQuestionHints(file, PRINCIPAL, { dryRun: false })).toMatchObject({ unchanged: 1, updated: 0 });
    expect(await importQuestionHints({ hints: [{ ...file.hints[0], language: "en" }] }, PRINCIPAL, { dryRun: false })).toMatchObject({ updated: 1 });
    expect(await importQuestionHints(file, PRINCIPAL, { dryRun: false, source: "teacher" })).toMatchObject({ updated: 1 });
    expect(await importQuestionHints(file, PRINCIPAL, { dryRun: false, source: "teacher" })).toMatchObject({ unchanged: 1 });
    await QuestionHint.updateOne({ qid: "Q-S-L1" }, { $set: { classToken: "C9" } });
    expect(await importQuestionHints(file, PRINCIPAL, { dryRun: false, source: "teacher" })).toMatchObject({ updated: 1 });
    expect((await QuestionHint.findOne({ qid: "Q-S-L1" }).lean())!.classToken).toBe("C3");
  });
});

describe("the guardian link through the real resolver (nothing mocked)", () => {
  const schema = builder.toSchema();
  const run = (guardianId: string): Promise<ExecutionResult> =>
    graphql({
      schema,
      source: `query { childAssignedQuestions(studentId: "${sid}", sources: ["ASSIGNMENT"]) { qid hintCount } }`,
      contextValue: { auth: { userId: guardianId, role: "GUARDIAN" } },
    }) as Promise<ExecutionResult>;

  it("a linked guardian reads the child's questions; an unlinked guardian is refused", async () => {
    const ok = await run(guardianLinked);
    expect(ok.errors).toBeUndefined();
    expect((ok.data!.childAssignedQuestions as { qid: string }[]).map((q) => q.qid).sort()).toEqual(["Q-S-A1", "Q-S-B1"]);
    const no = await run(guardianOther);
    expect(no.errors?.length).toBeGreaterThan(0);
    expect(no.data?.childAssignedQuestions ?? null).toBeNull();
  });
});
