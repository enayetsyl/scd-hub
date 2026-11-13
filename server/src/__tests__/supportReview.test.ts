/** CSP-3 — the Principal's review (docs/prd-child-support-profile.md §6.5; owner O-5, Q-9, Q-10; D-#1555). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportStrategy } from "../modules/support-profile/models/SupportStrategy";
import { strategyCounts } from "../modules/support-profile/services/supportStrategies";
import { isQuickApprovable } from "../modules/support-profile/services/supportQueueExtras";
import { authOf, DECIDE, reportInput, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";

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
const P = () => authOf(fx.principal, "PRINCIPAL");
const processed = async (over: Record<string, unknown> = {}, who = fx.routineTeacher): Promise<string> => {
  const id = (await run(SUBMIT, authOf(who, "TEACHER"), { input: reportInput(fx.child, over) })).data?.submitSupportReport.report.id;
  await SupportReport.updateOne({ _id: id }, { $set: { status: "PROCESSED" } });
  return id;
};
const DECIDE_LINKS = `mutation($id: String!, $d: String!, $links: [SupportStrategyLinkInput!]) {
  decideSupportReport(reportId: $id, decision: $d, strategyLinks: $links) { id status } }`;
const MINE_EDITS = `query { mySupportReportsPage { rows { id principalEdited edits { field before after } } } }`;

it("only `approve` holders decide: a teacher with `report`, Office and the CLASS TEACHER (no approval step — Q-9) are refused", async () => {
  const id = await processed();
  for (const a of [authOf(fx.routineTeacher, "TEACHER"), authOf(fx.classTeacher, "TEACHER"), authOf(fx.office, "OFFICE", { grantedPermissions: ["support_profile:approve"] })]) {
    expect((await run(DECIDE, a, { id, d: "APPROVED" })).errors).toBeDefined();
  }
  expect((await SupportReport.findById(id).lean())?.status).toBe("PROCESSED");
});

it("RETURNED needs a reason; returned → edit → TO_PROCESS again with a fresh count of 3 checks", async () => {
  const id = await processed();
  await SupportReport.updateOne({ _id: id }, { $set: { rewriteRounds: 2 } });
  expect((await run(DECIDE, P(), { id, d: "RETURNED" })).errors?.[0].message).toMatch(/কারণ/);
  expect((await run(DECIDE, P(), { id, d: "RETURNED", reason: "কোন পিরিয়ডে ঘটেছে লিখুন" })).data?.decideSupportReport.status).toBe("RETURNED");
  const re = await run(SUBMIT, authOf(fx.routineTeacher, "TEACHER"), { input: reportInput(fx.child, { periodNo: 3 }), reportId: id });
  expect(re.data?.submitSupportReport.report.status).toBe("TO_PROCESS");
  expect((await SupportReport.findById(id).lean())?.rewriteRounds).toBe(0);
});

it("RETURN is refused when the author is no longer a reader", async () => {
  const id = await processed({}, fx.manualTeacher);
  await mongoose.connection.db!.collection("scopegrants").updateOne({ teacherId: fx.manualTeacher }, { $set: { active: false } });
  expect((await run(DECIDE, P(), { id, d: "RETURNED", reason: "আরও লিখুন" })).errors?.[0].message).toMatch(/লেখক/);
  await mongoose.connection.db!.collection("scopegrants").updateOne({ teacherId: fx.manualTeacher }, { $set: { active: true } });
});

it("APPROVED_EDITED keeps submittedText and approvedText; the author sees before → after for the changed fields only (Q-10)", async () => {
  const id = await processed();
  const d = await run(DECIDE, P(), { id, d: "APPROVED_EDITED", edited: { behaviour: "সে নিজের অংশ শেষ করে পাশের সহপাঠীকে দুটি অঙ্ক দেখিয়েছে" } });
  expect(d.data?.decideSupportReport.status).toBe("APPROVED");
  const doc = await SupportReport.findById(id).lean();
  expect(doc?.submittedText?.behaviour).toBe(reportInput(fx.child).behaviour);
  expect(doc?.approvedText?.behaviour).toContain("সহপাঠীকে");
  const mine = await run(MINE_EDITS, authOf(fx.routineTeacher, "TEACHER"));
  const row = mine.data?.mySupportReportsPage.rows.find((r: { id: string }) => r.id === id);
  expect(row.principalEdited).toBe(true);
  expect(row.edits.map((e: { field: string }) => e.field)).toEqual(["behaviour"]);
});

it("derived strategy counts change only from APPROVED links", async () => {
  const id = await processed({ starterKeys: ["QUIET_WORD"], result: "WORKED" });
  const links = [{ strategyId: "NEW", starterKey: "QUIET_WORD", outcome: "WORKED" }];
  const id2 = await processed({ starterKeys: ["QUIET_WORD"], result: "PARTLY" }, fx.classTeacher);
  // id2 stays PROCESSED (not approved) — its link must not count
  await run(DECIDE_LINKS, P(), { id, d: "APPROVED", links });
  const s = await SupportStrategy.findOne({ starterKey: "QUIET_WORD" }).lean();
  expect(s).toBeTruthy();
  await SupportReport.updateOne({ _id: id2 }, { $set: { strategyLinks: [{ strategyId: s!._id, outcome: "PARTLY" }] } });
  const c = (await strategyCounts([s!._id])).get(String(s!._id))!;
  expect([c.worked, c.partly, c.teachers]).toEqual([1, 0, 1]);
});

it("quickApprovable is true only under all conditions of §6.5 and never for GUARDIAN_INFO", async () => {
  const base = await SupportReport.findById(await processed({ tone: "POSITIVE", result: "WORKED" }));
  expect(isQuickApprovable(base!)).toBe(true);
  const variants: [string, (r: typeof base) => void][] = [
    ["a flag left", (r) => r!.openFlags.push({ flagId: "f1", category: "NO_EVIDENCE", field: "behaviour", severity: "ASK", quote: "x", askBn: "?", suggestionBn: null })],
    ["a disagreement", (r) => r!.teacherDisagreements.push({ flagId: "f1", category: "HARSH", reasonBn: "না" })],
    ["a contradiction", (r) => ((r as unknown as { compare: unknown }).compare = { agreement: [{ status: "CONTRADICTS_REPORTS" }] })],
    ["a safeguarding question", (r) => (r!.safeguardingAsked = "TEACHER_SAID_NO")],
    ["the check skipped", (r) => (r!.checkSkipped = "DECIDED_DIRECTLY")],
    ["guardian information", (r) => (r!.source = "GUARDIAN_INFO")],
    ["a concern that did not work", (r) => ((r!.tone = "CONCERN"), (r!.result = "DID_NOT_WORK"))],
  ];
  for (const [label, mutate] of variants) {
    const r = await SupportReport.findById(base!._id);
    mutate(r);
    expect([label, isQuickApprovable(r!)]).toEqual([label, false]);
  }
});
