/**
 * CSP-4 — "no evidence → no sentence" and the publish gate (docs/prd-child-support-profile.md §6.6
 * rules 1–16, §16.4; D-#1556, D-#1562, D-#1555). Part 1 is pure (the validator), part 2 uses the DB.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { validateSupportResult, type CtxReport, type ValidationCtx } from "../modules/support-profile/services/supportResultValidator";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SupportProfileVersion } from "../modules/support-profile/models/SupportProfileVersion";
import { authOf, DECIDE, runner, seedSupport, type SupportFx } from "./supportFixtures";
import { APPLY, codesOf, P, result, setupBatch, UPLOAD } from "./supportBatchFixtures";

// ---------------------------------------------------------------------------------------------
// Part 1 — the validator (pure)
// ---------------------------------------------------------------------------------------------
const TODAY = "2026-11-13";
const R = (code: string, over: Partial<CtxReport> = {}): CtxReport => ({
  code, childCode: "C-001", isNew: false, status: "APPROVED", source: "TEACHER", authorCode: "T-01", occurredOn: "2026-11-01", slot: "P2", setting: "MATH",
  result: "WORKED", tone: "POSITIVE", goodThingCounts: false, gotOrAvoided: [], texts: {}, ...over,
});
const ctx = (reports: CtxReport[]): ValidationCtx => ({
  batchCode: "B-0001", nonce: "N", methodVersion: "v1", open: true, todayKey: TODAY,
  reports: new Map(reports.map((r) => [r.code, r])), children: new Set(["C-001", "C-002"]), strategies: new Set(), items: new Set(), rosterNames: ["Rafi"],
});
const item = (over: Record<string, unknown> = {}) => ({
  ref: "n1", textBn: "{{DATE:R-001}} অঙ্কের ক্লাসে [S] সাহায্য করেছে।", evidence: ["R-001"], counterEvidence: [], claimedLevel: "SINGLE", settings: ["MATH"],
  strategyId: null, kind: null, insteadOfItem: null, needTag: null, functionTag: null, skillKey: null, actionable: null, replacesItemId: null, baselineBn: null, expectedBn: null, ...over,
});
const answer = (section: string, it: object, child = "C-001") => JSON.stringify({
  schema: "support-result/v1", batch: "B-0001", nonce: "N", methodVersion: "v1", complete: true, reports: [],
  children: [{ child, profileDraft: { sections: { [section]: [it] }, card: { doItems: [], avoidItems: [], strengthItems: [], goalItem: null }, changeNoteBn: "" } }],
  selfCheck: { reportsDone: 0, childrenDone: 1, everySentenceCited: true, noNamesOrCodesInSentences: true, noNewFacts: true, safeguardingMarked: true },
});
const run1 = (section: string, it: object, reps: CtxReport[]) => validateSupportResult(answer(section, it), ctx(reps));
const reasons = (o: ReturnType<typeof run1>) => o.rejected.map((r) => r.reasonCode);

describe("no evidence → no sentence (rules 1–14)", () => {
  it("evidence: [] → dropped", () => expect(reasons(run1("strengths", item({ evidence: [] }), [R("R-001")]))).toEqual(["NO_EVIDENCE"]));
  it.each([["a waiting (TO_PROCESS)", { status: "TO_PROCESS" as const }], ["a NOT_USED", { status: "NOT_USED" as const }], ["a SAFEGUARDING_ROUTED", { status: "SAFEGUARDING_ROUTED" as const }], ["another child's", { childCode: "C-002" }]])(
    "an item citing %s report is dropped",
    (_l, over) => expect(reasons(run1("strengths", item({ textBn: "অঙ্কের ক্লাসে [S] সাহায্য করেছে।" }), [R("R-001", over as Partial<CtxReport>)]))).toEqual(["NO_EVIDENCE"]),
  );
  it("a {{DATE:…}} token naming another child's report is itself rejected", () =>
    expect(reasons(run1("strengths", item(), [R("R-001", { childCode: "C-002" })]))).toEqual(["TOKEN_OR_NAME"]));
  it("an item citing only out-of-window reports is dropped (concern 12 months)", () =>
    expect(reasons(run1("triggers", item({ evidence: ["R-001", "R-002"], claimedLevel: "EMERGING" }), [R("R-001", { occurredOn: "2025-10-01", tone: "CONCERN" }), R("R-002", { occurredOn: "2025-10-05", tone: "CONCERN" })]))).toEqual(["NO_EVIDENCE"]));
  it("a works item citing only DID_NOT_WORK reports is dropped", () => expect(reasons(run1("works", item(), [R("R-001", { result: "DID_NOT_WORK" })]))).toEqual(["NO_WORKED"]));
  it("an item with [S1] / [T1] or a blocked term is dropped", () => {
    expect(reasons(run1("strengths", item({ textBn: "[S1]-কে সাহায্য করেছে" }), [R("R-001")]))).toEqual(["TOKEN_OR_NAME"]);
    expect(reasons(run1("strengths", item({ textBn: "[T1] বলেছেন ভালো" }), [R("R-001")]))).toEqual(["TOKEN_OR_NAME"]);
    expect(reasons(run1("strengths", item({ textBn: "অলস হলেও অঙ্কে ভালো" }), [R("R-001")]))).toEqual(["LABEL_TERM"]);
  });
  it("claimedLevel above the computed level is dropped; a concern-side item at SINGLE is dropped", () => {
    expect(reasons(run1("strengths", item({ claimedLevel: "ESTABLISHED" }), [R("R-001")]))).toEqual(["OVERCLAIM"]);
    expect(reasons(run1("triggers", item({ claimedLevel: "SINGLE" }), [R("R-001", { tone: "CONCERN" })]))).toEqual(["BELOW_MIN"]);
  });
  it("a concern-side item below STRONG with empty settings is dropped", () =>
    expect(reasons(run1("triggers", item({ evidence: ["R-001", "R-002"], claimedLevel: "EMERGING", settings: [] }), [R("R-001", { tone: "CONCERN" }), R("R-002", { tone: "CONCERN", occurredOn: "2026-11-05" })]))).toEqual(["NO_SETTING"]));
  it.each(["সবসময়", "প্রায়ই", "always"])("an item holding %s is dropped", (w) => expect(reasons(run1("strengths", item({ textBn: `[S] ${w} সাহায্য করে` }), [R("R-001")]))).toEqual(["FREQUENCY_WORD"]));
  it("a functionTag with fewer than 3 observations or one teacher is removed and the item kept", () => {
    const reps = [R("R-001", { gotOrAvoided: ["ESCAPE_TASK"] }), R("R-002", { gotOrAvoided: ["ESCAPE_TASK"], occurredOn: "2026-11-03" }), R("R-003", { gotOrAvoided: ["ESCAPE_TASK"], occurredOn: "2026-11-05" })];
    const one = run1("strengths", item({ evidence: ["R-001", "R-002", "R-003"], claimedLevel: "EMERGING", functionTag: "ESCAPE_TASK" }), reps);
    expect(one.children[0].draft!.items[0].functionTag).toBeNull();
    const two = run1("strengths", item({ evidence: ["R-001", "R-002", "R-003"], claimedLevel: "EMERGING", functionTag: "ESCAPE_TASK" }), reps.map((r, i) => ({ ...r, authorCode: i ? "T-02" : "T-01" })));
    expect(two.children[0].draft!.items[0].functionTag).toBe("ESCAPE_TASK");
  });
  it("guardian information alone makes at most a SINGLE positive item and never a concern item", () => {
    const g = R("R-001", { source: "GUARDIAN_INFO", result: null });
    expect(run1("motivators", item({ textBn: "অভিভাবক জানিয়েছেন: গল্প শুনলে শান্ত হয়।" }), [g]).children[0].draft!.items[0].computed.level).toBe("SINGLE");
    expect(reasons(run1("feelings", item({ claimedLevel: "SINGLE" }), [g]))).toEqual(["BELOW_MIN"]);
  });
  it("teachersCount, obsCount and level are the server's (the result cannot lie)", () => {
    const o = run1("strengths", item({ evidence: ["R-001", "R-002"], claimedLevel: "SINGLE" }), [R("R-001"), R("R-002", { authorCode: "T-02", occurredOn: "2026-11-04" })]);
    expect(o.children[0].draft!.items[0].computed).toMatchObject({ level: "ESTABLISHED", obsCount: 2, teachersCount: 2 });
  });
  it("the good thing: a concrete line on a CONCERN report counts as one positive observation; '—' or a bare label counts for nothing", () => {
    expect(run1("strengths", item(), [R("R-001", { tone: "CONCERN", goodThingCounts: true })]).children[0].draft!.items).toHaveLength(1);
    expect(reasons(run1("strengths", item(), [R("R-001", { tone: "CONCERN", goodThingCounts: false })]))).toEqual(["NO_EVIDENCE"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Part 2 — provisional evidence and the publish gate (DB)
// ---------------------------------------------------------------------------------------------
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
const PUBLISH = `mutation($v: String!) { publishSupportVersion(versionId: $v) { id status versionNo } }`;

describe("provisional evidence and publishing (rules 15–16)", () => {
  let draftId = "";
  let r1 = "";
  it("a draft item citing a READY report of the same batch is kept and marked provisional; the version cannot be published while any citation is provisional", async () => {
    const s = await setupBatch(run, fx);
    r1 = s.r1;
    const up = await run(UPLOAD, P(fx), { b: s.batchId, t: result("I-01-correct.json", await codesOf(s.batchId, { R1: s.r1, R2: s.r2, A1: s.a1 })), c: "claude.ai" });
    await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId });
    const d = await SupportProfileVersion.findOne({ status: "DRAFT" }).lean();
    draftId = String(d!._id);
    expect(d!.sections.strengths[1].provisionalEvidence.map(String)).toEqual([s.r1]);
    expect((await run(PUBLISH, P(fx), { v: draftId })).errors?.[0].message).toMatch(/অনুমোদন-বাকি/);
  });

  it("approving the report makes the citation firm; then the version publishes, the previous one is no longer current, and levels come from APPROVED reports only", async () => {
    await run(DECIDE, P(fx), { id: r1, d: "APPROVED" });
    const d = await SupportProfileVersion.findById(draftId).lean();
    expect(d!.sections.strengths[1].provisionalEvidence).toEqual([]);
    expect(d!.sections.strengths[1].evidence.map(String)).toEqual([r1]);
    const p = await run(PUBLISH, P(fx), { v: draftId });
    expect(p.data?.publishSupportVersion.status).toBe("PUBLISHED");
    const prof = await SupportProfile.findOne({ studentId: fx.child }).lean();
    expect(String(prof!.currentVersionId)).toBe(draftId);
    // §7.3: strengths only → the next review in a year (a concern item or a goal → 90 days)
    const due = new Date(Date.now() + 365 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
    expect([due, new Date(Date.now() + 364 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" })]).toContain(prof!.nextReviewDueKey);
    const v = await SupportProfileVersion.findById(draftId).lean();
    expect(v!.sections.strengths.every((i) => i.level === "SINGLE" || i.level === "EMERGING" || i.level === "ESTABLISHED")).toBe(true);
  });

  it("marking a cited report not used removes the citation, recomputes and drops the item below its minimum", async () => {
    const s = await setupBatch(run, fx, { skipEval: true });
    const up = await run(UPLOAD, P(fx), { b: s.batchId, t: result("I-01-correct.json", await codesOf(s.batchId, { R1: s.r1, R2: s.r2, A1: s.a1 })), c: "claude.ai" });
    await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId });
    const d = await SupportProfileVersion.findOne({ status: "DRAFT" }).sort({ versionNo: -1 }).lean();
    expect(d!.sections.strengths).toHaveLength(2);
    await run(DECIDE, P(fx), { id: s.r1, d: "NOT_USED", reason: "একই ঘটনা" });
    const after = await SupportProfileVersion.findById(d!._id).lean();
    expect(after!.sections.strengths).toHaveLength(1);
    expect(after!.droppedItems).toBeGreaterThanOrEqual(1);
  });

  it("a profile-only batch (B-6) takes no report, only the chosen children", async () => {
    await SupportReport.updateMany({ status: "TO_PROCESS" }, { $set: { status: "WITHDRAWN" } });
    const { SupportBatch } = await import("../modules/support-profile/models/SupportBatch");
    await SupportBatch.updateMany({ status: { $in: ["OPEN", "RESULT_PENDING"] } }, { $set: { status: "CANCELLED", closedAt: new Date() } });
    const b = await run(`mutation($c: [String!]) { createSupportBatch(stages: ["SYNTHESIS"], childIds: $c) { id reportCount childCount stages } }`, P(fx), { c: [String(fx.child)] });
    expect(b.data?.createSupportBatch).toMatchObject({ reportCount: 0, childCount: 1, stages: ["SYNTHESIS"] });
    const doc = await SupportBatch.findById(b.data?.createSupportBatch.id).lean();
    expect(doc!.codeMap!.reports.every((r) => !r.isNew)).toBe(true); // approved context only
  });

  it("a version with zero strengths cannot publish; publishing needs `approve`; a PUBLISHED version cannot be edited", async () => {
    const prof = await SupportProfile.findOne({ studentId: fx.child }).lean();
    const empty = await SupportProfileVersion.create({ profileId: prof!._id, versionNo: 99, status: "DRAFT", createdBy: fx.principal, sections: {} });
    expect((await run(PUBLISH, P(fx), { v: String(empty._id) })).errors?.[0].message).toMatch(/শক্তির দিক/);
    expect((await run(PUBLISH, authOf(fx.classTeacher, "TEACHER"), { v: String(empty._id) })).errors).toBeDefined();
    const edit = await run(`mutation($v: String!, $i: String!) { editSupportDraftItem(versionId: $v, itemId: $i, textBn: "নতুন") { id } }`, P(fx), { v: draftId, i: "x" });
    expect(edit.errors?.[0].message).toMatch(/প্রকাশিত সংস্করণ বদলানো যায় না/);
    void Types;
    void SupportReport;
  });
});
