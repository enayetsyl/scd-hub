/** CSP-3 — guardian information (docs/prd-child-support-profile.md §7.5; owner Q-11; D-#1560). */
import mongoose from "mongoose";
import { evidenceLevel } from "@scd/shared";
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
  (r as unknown as { compare: unknown }).compare = { agreement: [] };
  expect(isQuickApprovable(r!)).toBe(false);
  r!.source = "TEACHER";
  expect(isQuickApprovable(r!)).toBe(true); // the same report from a teacher would be
});

it("D-#1560 / rule 12: guardian information alone is at most one positive item (SINGLE) and never a concern item", () => {
  const today = "2026-06-30";
  const evidence = [1, 2, 3, 4].map((n) => ({ id: `g${n}`, authorId: `u${n}`, occurredOn: `2026-06-0${n}`, slot: "OTHER", setting: "HOME", source: "GUARDIAN_INFO" as const, result: null }));
  const positive = evidenceLevel({ side: "POSITIVE", todayKey: today, isStrategy: false, evidence });
  expect(positive.level).toBe("SINGLE");
  expect(positive.hasGuardianInfo).toBe(true);
  const concern = evidenceLevel({ side: "CONCERN", todayKey: today, isStrategy: false, evidence });
  expect(concern.level).toBeNull();
  // a teacher report beside it still counts only the teacher's own observation
  const withTeacher = evidenceLevel({ side: "POSITIVE", todayKey: today, isStrategy: false, evidence: [...evidence, { id: "t1", authorId: "t", occurredOn: "2026-06-05", slot: "P2", setting: "MATH", source: "TEACHER" as never, result: "WORKED" as never }] });
  expect(withTeacher.obsCount).toBe(1);
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
