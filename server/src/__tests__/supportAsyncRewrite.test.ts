/** CSP-2 — the asynchronous rewrite loop (docs/prd-child-support-profile.md §6.12; D-#1588, D-#1553). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { printSchema } from "graphql";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportBatch } from "../modules/support-profile/models/SupportBatch";
import { Notification } from "../modules/notifications/models/Notification";
import { sweepRewrites } from "../modules/support-profile/services/supportRewriteSweeps";
import { authOf, reportInput, runner, seedSupport, type SupportFx } from "./supportFixtures";
import { APPLY, codesOf, CREATE_BATCH, DOWNLOAD, P, R2_BEHAVIOUR, result, setupBatch, UPLOAD, type BatchSetup } from "./supportBatchFixtures";

let mongo: MongoMemoryServer;
const schema = builder.toSchema();
const run = runner(schema);
let fx: SupportFx;
let s: BatchSetup;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
  s = await setupBatch(run, fx);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
const RT = () => authOf(fx.routineTeacher, "TEACHER");
const REWRITE = `mutation($input: SupportReportInput!, $id: String, $answers: [SupportQuestionAnswerInput!]) {
  submitSupportReport(input: $input, reportId: $id, questionAnswers: $answers) { outcome report { id status round } } }`;
const QUESTIONS = `query($id: String!) { supportReport(reportId: $id) { status questions { flagId field severity askBn suggestionBn } } }`;

async function uploadApply(batchId: string, file: string, ids: Record<string, string>, untick: string[] = []) {
  const c = await codesOf(batchId, ids);
  const up = await run(UPLOAD, P(fx), { b: batchId, t: result(file, c), c: "claude.ai" });
  if (up.errors) throw new Error(up.errors[0].message);
  const ap = await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId, u: untick });
  if (ap.errors) throw new Error(ap.errors[0].message);
  return up.data?.uploadSupportResult;
}

describe("the asynchronous round-trip", () => {
  it("batch 1 says NEEDS_REWRITE with two questions → the preview lists it under 'ফেরত যাবে'; apply → NEEDS_REWRITE, the author is told once, the questions sit under their fields", async () => {
    const p = await uploadApply(s.batchId, "I-22-needs-rewrite.json", { R1: s.r1, R2: s.r2, A1: s.a1 });
    expect(p.returns.map((r: { reportId: string }) => r.reportId)).toEqual([s.r2]);
    const r2 = await SupportReport.findById(s.r2).lean();
    expect(r2?.status).toBe("NEEDS_REWRITE");
    expect(await Notification.countDocuments({ recipientUserId: fx.routineTeacher, bodyBn: /কয়েকটি প্রশ্ন/ })).toBe(1);
    const q = await run(QUESTIONS, RT(), { id: s.r2 });
    expect(q.data?.supportReport.questions.map((x: { field: string; flagId: string }) => [x.flagId, x.field])).toEqual([["f1", "behaviour"], ["f2", "behaviour"]]);
  });

  it("the teacher rewrites one field, answers one question মনে নেই, and saves → intake runs again; old text and questions gone; counts stay; TO_PROCESS round 2", async () => {
    const r = await run(REWRITE, RT(), {
      input: reportInput(fx.child, { behaviour: "বাংলা ক্লাসে পড়া বলার সময় সে দুইবার উঠে দাঁড়িয়েছে", tone: "CONCERN", result: "PARTLY" }),
      id: s.r2,
      answers: [{ flagId: "f1", answer: "REWRITTEN" }, { flagId: "f2", answer: "DONT_REMEMBER" }],
    });
    expect(r.data?.submitSupportReport.report).toMatchObject({ status: "TO_PROCESS", round: 2 });
    const doc = await SupportReport.findById(s.r2).lean();
    expect(doc?.returnQuestions).toEqual([]);
    expect(doc?.behaviour).not.toBe(R2_BEHAVIOUR);
    expect(JSON.stringify(doc)).not.toContain("কোন ক্লাসে দেখেছেন?");
    expect(doc?.aiChecks).toHaveLength(1);
    expect(doc?.dontRememberCount).toBe(1);
    // the intake checks ran again: a blocked word is refused on a rewrite too
    const bad = await run(REWRITE, RT(), { input: reportInput(fx.child, { behaviour: "সে খুব দুষ্টু", tone: "CONCERN" }), id: s.r2 });
    expect(bad.data?.submitSupportReport.outcome).toBe("BLOCKED");
  });

  it("batch 2 takes it and its pack carries the 'মনে নেই' answer; its result says READY → PROCESSED in the Principal's queue", async () => {
    const b = await run(CREATE_BATCH, P(fx), {});
    const id = b.data?.createSupportBatch.id;
    const doc = await SupportBatch.findById(id).lean();
    expect(doc!.reportIds.map(String)).toEqual([s.r2]);
    const pack = (await run(DOWNLOAD, P(fx), { b: id })).data?.downloadSupportPack.content as string;
    expect(pack).toContain('"dontRemember": 1');
    const c = await codesOf(id, { R2: s.r2, A1: s.a1 });
    const ready = JSON.parse(result("I-01-correct.json", { ...c, R1: c.R2 }));
    ready.reports = ready.reports.slice(1);
    ready.children = [];
    const up = await run(UPLOAD, P(fx), { b: id, t: JSON.stringify(ready), c: "claude.ai" });
    await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId });
    expect((await SupportReport.findById(s.r2).lean())?.status).toBe("PROCESSED");
  });

  it("after the third check the report goes to the Principal with what is left; a fourth check is not offered", async () => {
    const s3 = await setupBatch(run, fx, { skipEval: true });
    await SupportReport.updateOne({ _id: s3.r2 }, { $set: { rewriteRounds: 2 } });
    await uploadApply(s3.batchId, "I-22-needs-rewrite.json", { R1: s3.r1, R2: s3.r2, A1: s3.a1 });
    const doc = await SupportReport.findById(s3.r2).lean();
    expect(doc?.rewriteRounds).toBe(3);
    expect(doc?.status).toBe("PROCESSED");
    expect(doc?.openFlags.length).toBe(2);
  });

  it("the Principal unticks a return in the preview → it goes to his queue with its flags", async () => {
    const s4 = await setupBatch(run, fx, { skipEval: true });
    await uploadApply(s4.batchId, "I-22-needs-rewrite.json", { R1: s4.r1, R2: s4.r2, A1: s4.a1 }, [s4.r2]);
    const doc = await SupportReport.findById(s4.r2).lean();
    expect(doc?.status).toBe("PROCESSED");
    expect(doc?.openFlags.map((f) => f.flagId)).toEqual(["f1", "f2"]);
  });

  it("an author who is no longer a reader → the report goes to the Principal instead", async () => {
    const s5 = await setupBatch(run, fx, { skipEval: true });
    await mongoose.connection.db!.collection("scopegrants").updateOne({ teacherId: fx.routineTeacher }, { $set: { active: false } });
    await uploadApply(s5.batchId, "I-22-needs-rewrite.json", { R1: s5.r1, R2: s5.r2, A1: s5.a1 });
    expect((await SupportReport.findById(s5.r2).lean())?.status).toBe("PROCESSED");
    await mongoose.connection.db!.collection("scopegrants").updateOne({ teacherId: fx.routineTeacher }, { $set: { active: true } });
  });

  it("one gentle reminder after 7 days; a NEEDS_REWRITE report untouched for 21 days goes to the Principal", async () => {
    const s6 = await setupBatch(run, fx, { skipEval: true });
    await uploadApply(s6.batchId, "I-22-needs-rewrite.json", { R1: s6.r1, R2: s6.r2, A1: s6.a1 });
    expect((await SupportReport.findById(s6.r2).lean())?.status).toBe("NEEDS_REWRITE");
    const before = await Notification.countDocuments({ recipientUserId: fx.routineTeacher });
    await sweepRewrites(new Date(Date.now() + 8 * 86_400_000));
    await sweepRewrites(new Date(Date.now() + 9 * 86_400_000));
    expect(await Notification.countDocuments({ recipientUserId: fx.routineTeacher })).toBe(before + 1);
    await sweepRewrites(new Date(Date.now() + 22 * 86_400_000));
    expect((await SupportReport.findById(s6.r2).lean())?.status).toBe("PROCESSED");
  });

  it("an ASK question allows 'আমি একমত নই' with a reason; without a reason, or on a BLOCK question, it is refused", async () => {
    const s7 = await setupBatch(run, fx, { skipEval: true });
    await uploadApply(s7.batchId, "I-22-needs-rewrite.json", { R1: s7.r1, R2: s7.r2, A1: s7.a1 });
    const input = reportInput(fx.child, { behaviour: R2_BEHAVIOUR, tone: "CONCERN", result: "PARTLY" });
    const noReason = await run(REWRITE, RT(), { input, id: s7.r2, answers: [{ flagId: "f2", answer: "DISAGREE" }] });
    expect(noReason.errors?.[0].message).toMatch(/কারণ/);
    await SupportReport.updateOne({ _id: s7.r2, "returnQuestions.flagId": "f1" }, { $set: { "returnQuestions.$.severity": "BLOCK" } });
    const onBlock = await run(REWRITE, RT(), { input, id: s7.r2, answers: [{ flagId: "f1", answer: "DISAGREE", reasonBn: "আমি নিজে দেখেছি" }] });
    expect(onBlock.errors?.[0].message).toMatch(/একমত না হওয়ার সুযোগ নেই/);
    const ok = await run(REWRITE, RT(), { input, id: s7.r2, answers: [{ flagId: "f2", answer: "DISAGREE", reasonBn: "শব্দটি রাগের নয়, ঘটনার বর্ণনা" }] });
    expect(ok.data?.submitSupportReport.report.status).toBe("TO_PROCESS");
    expect((await SupportReport.findById(s7.r2).lean())?.teacherDisagreements.map((d) => d.flagId)).toEqual(["f2"]);
  });

  it("no count of returns per teacher is stored or can be queried", () => {
    expect(printSchema(schema)).not.toMatch(/returnCount|returnsPerTeacher|teacherReturn/i);
    expect(Object.keys(SupportReport.schema.paths)).not.toEqual(expect.arrayContaining(["returnCount"]));
  });
});
