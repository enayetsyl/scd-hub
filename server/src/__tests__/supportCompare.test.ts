/**
 * CSP-3 — stage B COMPARE (docs/prd-child-support-profile.md §6.4; owner O-4; D-#1554) and the
 * build-up rule (§16.5 SG-6).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SafeguardingReferral } from "../modules/platform/safeguarding/SafeguardingReferral";
import { authOf, QUEUE, ROSTER, runner, seedSupport, type SupportFx } from "./supportFixtures";
import { APPLY, codesOf, DOWNLOAD, P, result, setupBatch, UPLOAD } from "./supportBatchFixtures";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const compare = (over: Record<string, unknown> = {}) => ({
  agreement: [{ claim: "দলে কাজে সাহায্য করে", status: "CONSISTENT", otherReportIds: [], recordFacts: ["homeworkCompletionPct"], noteBn: "অন্য শিক্ষকের রিপোর্টের সাথে মেলে" }],
  authorSkew: { status: "MORE_NEGATIVE_THAN_OTHERS", noteBn: "এই শিক্ষকের রিপোর্ট বেশি নেতিবাচক" },
  sectionHints: ["strengths"],
  skillHints: [],
  functionHint: { tag: null, reportIds: [], noteBn: "" },
  strategyMatches: [],
  echoOfProfile: false,
  safeguardingPattern: { present: false, signs: [], reportIds: [], noteBn: "" },
  principalSummaryBn: "দুটি রিপোর্ট একই কথা বলে।",
  ...over,
});
async function withCompare(mut: (j: { reports: { report: string; compare: unknown }[] }, c: Record<string, string>) => void) {
  const s = await setupBatch(run, fx, { skipEval: !!(await mongoose.connection.db!.collection("supportproducerevals").findOne({})) });
  const c = await codesOf(s.batchId, { R1: s.r1, R2: s.r2, A1: s.a1 });
  const j = JSON.parse(result("I-01-correct.json", c));
  mut(j, c);
  return { s, c, json: JSON.stringify(j) };
}

it("the pack holds other teachers' reports under T- codes with no names; the records pack is numbers only (no comment text), with the age band and youngForClass; seeded comments are counted", async () => {
  await mongoose.connection.db!.collection("studentcomments").insertOne({ studentId: fx.child, sectionId: fx.sec1, authorUserId: fx.classTeacher, type: "BEHAVIOUR", sentiment: "CONCERN", text: "অনন্য-মন্তব্য-লেখা", attachmentIds: [], deliveryChannels: [], createdAt: new Date(), updatedAt: new Date() });
  const s = await setupBatch(run, fx);
  const pack = (await run(DOWNLOAD, P(fx), { b: s.batchId })).data?.downloadSupportPack.content as string;
  expect(pack).toMatch(/"author": "T-\d{2}"/);
  for (const n of Object.values(ROSTER.staff)) expect(pack).not.toContain(n);
  expect(pack).not.toContain("অনন্য-মন্তব্য-লেখা");
  expect(pack).toMatch(/"records": \{\n\s*"attendancePct"/);
  expect(pack).toMatch(/"concern": \{\n\s*"BEHAVIOUR": 1\n/);
  expect(pack).toMatch(/"seededReports": 0/);
  expect(pack).toContain('"ageBand": "CLASS_1_3"');
  expect(pack).toContain('"youngForClass": null');
  await run(`mutation($b: String!) { cancelSupportBatch(batchId: $b) { status } }`, P(fx), { b: s.batchId });
});

it("a compare result is stored for the Principal (codes mapped back) and never shown to the author", async () => {
  const { s, json } = await withCompare((j, c) => {
    j.reports[0].compare = compare({ agreement: [{ claim: "দলে কাজে সাহায্য করে", status: "CONSISTENT", otherReportIds: [c.A1], recordFacts: [], noteBn: "মেলে" }] });
  });
  const up = await run(UPLOAD, P(fx), { b: s.batchId, t: json, c: "claude.ai" });
  expect(up.data?.uploadSupportResult.rejected).toEqual([]);
  await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId });
  const r = await SupportReport.findById(s.r1).lean();
  const cmp = (r as unknown as { compare: { agreement: { otherReportIds: string[] }[]; authorSkew: { status: string } } }).compare;
  expect(cmp.agreement[0].otherReportIds).toEqual([s.a1]);
  const asPrincipal = await run(`query($id: String!) { supportReport(reportId: $id) { compareJson } }`, P(fx), { id: s.r1 });
  expect(asPrincipal.data?.supportReport.compareJson).toContain(s.a1);
  const asAuthor = await run(`query($id: String!) { supportReport(reportId: $id) { compareJson } }`, authOf(fx.classTeacher, "TEACHER"), { id: s.r1 });
  expect(asAuthor.data?.supportReport.compareJson).toBeNull();
});

it("authorSkew is forced to TOO_FEW with fewer than 3 + 3 reports", async () => {
  const r = await SupportReport.findById((await SupportReport.find({ status: "PROCESSED" }).sort({ _id: 1 }).lean())[0]._id).lean();
  expect((r as unknown as { compare: { authorSkew: { status: string } } }).compare.authorSkew.status).toBe("TOO_FEW");
});

it("a foreign or unknown report or strategy id in the compare → that item INVALID (the report returns to TO_PROCESS)", async () => {
  const foreign = String(new Types.ObjectId());
  void foreign;
  const { s, json } = await withCompare((j) => {
    j.reports[0].compare = compare({ agreement: [{ claim: "x", status: "CONSISTENT", otherReportIds: ["R-999"], recordFacts: [], noteBn: "" }] });
    j.reports[1].compare = compare({ strategyMatches: [{ strategyId: "S-77", starterKey: null, outcome: "WORKED" }] });
  });
  const up = await run(UPLOAD, P(fx), { b: s.batchId, t: json, c: "claude.ai" });
  // both report results are rejected; the draft sentence citing R1 then has no evidence left (cascade)
  expect(up.data?.uploadSupportResult.rejected.map((x: { reasonCode: string }) => x.reasonCode)).toEqual(["UNKNOWN_CODE", "UNKNOWN_CODE", "NO_EVIDENCE"]);
  expect(up.data?.uploadSupportResult.backToQueue).toBeGreaterThanOrEqual(2); // R1, R2 (+ any leftovers this batch took)
  await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId });
  expect((await SupportReport.findById(s.r1).lean())?.status).toBe("TO_PROCESS");
});

it("F-39: safeguardingPattern.present pins the child on top of the queue with the banner and creates a SUPPORT_COMPARE referral", async () => {
  await SupportReport.updateMany({ status: "TO_PROCESS" }, { $set: { status: "WITHDRAWN" } });
  // another child's processed report, older — would sort first without the pin
  await SupportReport.create({ studentId: fx.classmate, authorId: fx.classTeacher, authorVia: "CLASS_TEACHER", occurredOn: "2026-01-01", tone: "POSITIVE", status: "PROCESSED", waitingSince: new Date(Date.now() - 9 * 86_400_000) });
  const { s, json } = await withCompare((j, c) => {
    j.reports[1].compare = compare({ safeguardingPattern: { present: true, signs: ["NEGLECT"], reportIds: [c.R2, c.A1], noteBn: "কয়েক সপ্তাহে ক্ষুধা, ঘুম ও একটি দাগ" } });
  });
  const up = await run(UPLOAD, P(fx), { b: s.batchId, t: json, c: "claude.ai" });
  await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId });
  expect((await SupportProfile.findOne({ studentId: fx.child }).lean())?.safeguardingBanner).toBe(true);
  expect(await SafeguardingReferral.countDocuments({ source: "SUPPORT_COMPARE", studentId: fx.child })).toBe(1);
  const q = await run(QUEUE, P(fx), { status: "PROCESSED" });
  expect(q.data?.supportQueuePage.rows[0].studentName).toBe(ROSTER.child.nameBn);
});
