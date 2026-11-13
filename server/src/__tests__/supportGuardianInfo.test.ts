/** CSP-3 — guardian information (docs/prd-child-support-profile.md §7.5; owner Q-11; D-#1560). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { isQuickApprovable } from "../modules/support-profile/services/supportQueueExtras";
import { validateSupportResult, type ValidationCtx } from "../modules/support-profile/services/supportResultValidator";
import { authOf, runner, seedSupport, SUBMIT, todayKey, type SupportFx } from "./supportFixtures";

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
const gi = () => ({ studentId: String(fx.child), source: "GUARDIAN_INFO", occurredOn: todayKey(), situation: "ঘুমের আগে", whatWorked: "মা বলেছেন, গল্প শোনালে শান্ত হয়", tone: "POSITIVE" });

it("only the Principal and the class teacher may create GUARDIAN_INFO", async () => {
  expect((await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: gi() })).data?.submitSupportReport.outcome).toBe("SAVED");
  expect((await run(SUBMIT, authOf(fx.principal, "PRINCIPAL"), { input: gi() })).data?.submitSupportReport.outcome).toBe("SAVED");
  for (const t of [fx.routineTeacher, fx.quranTeacher, fx.coverTeacher]) expect((await run(SUBMIT, authOf(t, "TEACHER"), { input: gi() })).errors?.[0].message).toMatch(/অভিভাবকের তথ্য/);
});

it("the chip shows (source GUARDIAN_INFO) and it is never quick-approvable", async () => {
  const r = await SupportReport.findOne({ source: "GUARDIAN_INFO" });
  const q = await run(`query($id: String!) { supportReport(reportId: $id) { source } }`, authOf(fx.principal, "PRINCIPAL"), { id: String(r!._id) });
  expect(q.data?.supportReport.source).toBe("GUARDIAN_INFO");
  r!.status = "PROCESSED";
  expect(isQuickApprovable(r!)).toBe(false);
  r!.source = "TEACHER";
  expect(isQuickApprovable(r!)).toBe(true); // the same report from a teacher would be
});

it("MISSING_PART is not raised on guardian information", () => {
  const ctx: ValidationCtx = {
    batchCode: "B-0001", nonce: "N", methodVersion: "v1", open: true, todayKey: "2000-01-02",
    reports: new Map([["R-001", { code: "R-001", childCode: "C-001", isNew: true, status: "IN_BATCH", source: "GUARDIAN_INFO", authorCode: "T-01", occurredOn: "2000-01-01", slot: "OTHER", setting: "HOME", result: null, tone: "POSITIVE", goodThingCounts: false, gotOrAvoided: [], texts: { situation: "ঘুমের আগে", settingNote: "", behaviour: "", tried: "", resultNote: "", exception: "", whatWorked: "গল্প শোনালে শান্ত হয়", goodThing: "" } }]]),
    children: new Set(["C-001"]), strategies: new Set(), items: new Set(), rosterNames: [],
  };
  const res = validateSupportResult(JSON.stringify({
    schema: "support-result/v1", batch: "B-0001", nonce: "N", methodVersion: "v1", complete: true,
    reports: [{ report: "R-001", check: { verdict: "NEEDS_REWRITE", flags: [{ id: "f1", category: "MISSING_PART", severity: "ASK", field: "situation", quote: "ঘুমের আগে", whyBn: "কী চলছিল নেই।", askBn: "আর কী?", suggestionBn: "" }], toneCheck: { teacherTone: "POSITIVE", textReads: "POSITIVE" }, strategyCandidate: { present: false, titleBn: "", starterKey: null, punitive: false }, safeguarding: { present: false, signs: [], confidence: "LOW", quote: "" } }, compare: null }],
    children: [], selfCheck: { reportsDone: 1, childrenDone: 0, everySentenceCited: true, noNamesOrCodesInSentences: true, noNewFacts: true, safeguardingMarked: true },
  }), ctx);
  expect(res.reports[0].flags).toEqual([]);
});
