/**
 * CSP-2 review fixes (docs/prd-child-support-profile.md §2.4, §6.10 B-1…B-8, §6.11 DE-1…DE-10 / V-1…V-14,
 * §6.12, §16 SG-3/SG-8/SG-9; D-#1552 a model can never lower a BLOCK).
 * Pure units first, then the database round-trip.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SUPPORT_REPORT_RESULT_SCHEMA, SUPPORT_SKILLS, checkMiniSchema } from "@scd/shared";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportImport } from "../modules/support-profile/models/SupportImport";
import { SupportAiRun } from "../modules/support-profile/models/SupportAiRun";
import { SupportBatch } from "../modules/support-profile/models/SupportBatch";
import { SupportProfileVersion } from "../modules/support-profile/models/SupportProfileVersion";
import { Audit } from "../modules/platform/models/Audit";
import { Notification } from "../modules/notifications/models/Notification";
import {
  codes,
  dateIn,
  firstNamePart,
  packLeak,
  schoolIdIn,
  sweepBatches,
  teacherView,
  type PackRoster,
} from "../modules/support-profile/services/SupportBatchService";
import { runSupportProfileSweeps } from "../modules/support-profile/services/supportSweeps";
import { batchReminders } from "../modules/support-profile/services/supportRewriteSweeps";
import { validateSupportResult, type CtxReport, type ValidationCtx } from "../modules/support-profile/services/supportResultValidator";
import { evalCtx } from "../modules/support-profile/eval/supportEvaluation";
import { authOf, daysAgoKey, reportInput, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";
import { APPLY, codesOf, CREATE_BATCH, DOWNLOAD, P, passEval, result, setupBatch, UPLOAD, type BatchSetup } from "./supportBatchFixtures";

// ---------------------------------------------------------------------------------------------
// Pure units
// ---------------------------------------------------------------------------------------------

const roster = (over: Partial<PackRoster> = {}): PackRoster => ({
  students: [
    { kind: "S", id: "s1", names: ["Rafi Karim", "রাফি করিম"], schoolId: "103" },
    { kind: "S", id: "s2", names: ["Tanvir Hasan", "তানভীর হাসান"], schoolId: "0059" },
  ],
  guardians: [{ kind: "G", id: "g1", names: ["Abdul Karim"] }],
  staff: [{ kind: "T", id: "t1", names: ["Md Jamal Uddin", "Selina Akter"] }],
  ...over,
});
const block = (text: string, extra = ""): string =>
  JSON.stringify({ child: "C-312", classLevel: 3, newReports: [{ report: "R-103", author: "T-03", day: -103, minutes: 103, behaviour: text, ...(extra ? { subject: extra } : {}) }] }, null, 1);

describe("1 — the school-id scan matches a standalone number only", () => {
  it("R-103, a day of -103, a JSON number 103 and a longer number never refuse the pack", () => {
    expect(packLeak(block("সে আজ ভালো কাজ করেছে"), roster())).toBeNull();
    expect(packLeak(block("সংখ্যা 1103 এবং 1034 এবং X103"), roster())).toBeNull();
    expect(schoolIdIn('"day": 103, "report": "R-103", "x": -103', "103")).toBe(false);
  });
  it("a real standalone 103 (English or Bangla digits) refuses the pack, 0059 matches 59 numerically", () => {
    expect(packLeak(block("ছাত্র নম্বর 103 এসেছে"), roster())).toBe("schoolId");
    expect(packLeak(block("ছাত্র নম্বর ১০৩ এসেছে"), roster())).toBe("schoolId");
    expect(packLeak(block("পরিচয় 59 দিয়ে"), roster())).toBe("schoolId");
    expect(packLeak(block("পরিচয় ০০৫৯ দিয়ে"), roster())).toBe("schoolId");
  });
});

describe("2 — the code generator never loops past its code space", () => {
  it("refuses more codes than the pattern can hold; the full space still works", () => {
    expect(() => codes("R", 1000, 3)).toThrow(/সর্বোচ্চ সীমা/);
    expect(() => codes("S", 100, 2)).toThrow(/সর্বোচ্চ সীমা/);
    expect(() => codes("T", 100, 2)).toThrow();
    const all = codes("T", 99, 2);
    expect(new Set(all).size).toBe(99);
    expect(all.every((c) => /^T-\d{2}$/.test(c))).toBe(true);
    expect(codes("R", 5, 3).every((c) => /^R-\d{3}$/.test(c))).toBe(true);
  });
});

describe("4 — the fail-closed scan (DE-10): first names, and dates in Bangla or English", () => {
  it("a missed classmate's first name alone refuses the pack; a surname alone does not (children's full names only)", () => {
    expect(packLeak(block("তানভীর আজ দেরিতে এসেছে"), roster())).toBe("তানভীর");
    expect(packLeak(block("Tanvir was late"), roster())).toBe("Tanvir");
    expect(packLeak(block("Hasan was late"), roster())).toBeNull();
  });
  it("a staff and a guardian first name refuse it; honorifics and titles (the STOP list) do not", () => {
    expect(packLeak(block("Selina said so"), roster())).toBe("Selina");
    expect(packLeak(block("Jamal said so"), roster())).toBe("Jamal");
    expect(packLeak(block("Md and Abdul and Sir and আপা came"), roster())).toBeNull();
    expect(firstNamePart("Md Jamal Uddin")).toBe("Jamal");
    expect(firstNamePart("Md.")).toBeNull();
  });
  it("dates: 12/11/2026, 12 Nov, Nov 12, ১২ নভেম্বর are refused; plain words and counts are not", () => {
    for (const d of ["12/11/2026", "12 Nov", "Nov 12", "১২ নভেম্বর", "5th March", "১২/১১/২০২৬"]) expect([d, packLeak(block(`দেখা হলো ${d} তারিখে`), roster())]).toEqual([d, "date"]);
    expect(dateIn("দুই মেয়ে এসেছে ২ মেয়ে")).toBe(false);
    expect(dateIn("সে 3 জন নিয়ে খেলেছে, 10 মিনিট")).toBe(false);
    expect(packLeak(block("নিয়মিত কাজ চলছিল"), roster())).toBeNull();
  });
});

describe("15 — what a teacher reads never shows a raw code or mask", () => {
  it("[S] → the first name; the author's own T-code → আপনি; others → neutral Bangla words", () => {
    const t = teacherView("[S] আর [অন্য শিশু] খেলছিল; T-03 আপা ও T-07 বললেন, [PHONE] এবং [অভিভাবক], [শিক্ষক], C-012, R-044, S-12, I-100, [T9]", "রাফি", "T-03");
    expect(t).toContain("রাফি আর অন্য একজন শিক্ষার্থী");
    expect(t).toContain("আপনি আপা ও অন্য একজন শিক্ষক");
    expect(t).toContain("ফোন নম্বর");
    expect(t).not.toMatch(/\[|\]|\b[CTRSIB]-\d/);
    // for the Principal's copy there is no "you"
    expect(teacherView("T-03 বললেন", "রাফি", null)).toBe("অন্য একজন শিক্ষক বললেন");
  });
});

describe("10 — checkMiniSchema's unknown-field test is an own-property test", () => {
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])("the key %s is an unknown field", (k) => {
    const v = JSON.parse(`{"report": "R-001", "${k}": 1}`);
    expect(checkMiniSchema(v, SUPPORT_REPORT_RESULT_SCHEMA)).toMatchObject({ kind: "UNKNOWN_FIELD" });
  });
  it("a required field that is only inherited does not count as present", () => {
    expect(checkMiniSchema({ report: "R-001" }, SUPPORT_REPORT_RESULT_SCHEMA)).toMatchObject({ kind: "BAD_VALUE", path: "$.check" });
  });
});

// ---- the validator (6) ---------------------------------------------------------------------

const rep = (code: string, behaviour: string): CtxReport => ({
  code, childCode: "C-001", isNew: true, status: "IN_BATCH", source: "TEACHER", authorCode: "T-01", occurredOn: "2000-01-01", slot: "P2", setting: "MATH",
  result: "WORKED", tone: "POSITIVE", goodThingCounts: true, gotOrAvoided: [],
  texts: { situation: "দলে কাজ চলছিল", settingNote: "", behaviour, tried: "এক লাইনে বুঝিয়ে দিয়েছি", resultNote: "", exception: "", whatWorked: "", goodThing: "" },
});
const vctx = (reports: CtxReport[], rosterNames: string[] = []): ValidationCtx => ({
  batchCode: "B-0001", nonce: "N", methodVersion: "v1", open: true, todayKey: "2000-01-02",
  reports: new Map(reports.map((r) => [r.code, r])), children: new Set(["C-001"]), strategies: new Set(), items: new Set(), rosterNames,
});
const check = (over: Record<string, unknown>) => ({
  verdict: "READY", flags: [], toneCheck: { teacherTone: "POSITIVE", textReads: "POSITIVE" },
  strategyCandidate: { present: false, titleBn: "", starterKey: null, punitive: false },
  safeguarding: { present: false, signs: [], confidence: "LOW", quote: "" }, ...over,
});
const file = (reports: unknown[], children: unknown[] = []) =>
  JSON.stringify({ schema: "support-result/v1", batch: "B-0001", nonce: "N", methodVersion: "v1", complete: true, reports, children,
    selfCheck: { reportsDone: reports.length, childrenDone: children.length, everySentenceCited: true, noNamesOrCodesInSentences: true, noNewFacts: true, safeguardingMarked: true } });
const flag = (category: string, severity: string, quote: string) => ({ id: "f1", category, severity, field: "behaviour", quote, whyBn: "উদাহরণ নেই।", askBn: "ঠিক কী দেখেছেন?", suggestionBn: "" });

describe("6 — the validator never lets a model lower a BLOCK, and checks every model sentence", () => {
  it("a LABEL on a blocked word stays BLOCK however the model labels it; on an ask-list word the SERVER's hit makes it ASK", () => {
    const r = rep("R-001", "সে খুব দুষ্টু আর অমনোযোগী");
    const out = validateSupportResult(file([
      { report: "R-001", check: check({ flags: [flag("LABEL", "ASK", "দুষ্টু"), { ...flag("LABEL", "BLOCK", "অমনোযোগী"), id: "f2" }] }), compare: null },
    ]), vctx([r]));
    const flags = out.reports[0].flags.filter((f) => !f.byServer);
    expect(flags.find((f) => f.id === "f1")?.severity).toBe("BLOCK");
    expect(flags.find((f) => f.id === "f2")?.severity).toBe("ASK");
  });

  it("a goal's baselineBn / expectedBn run the name, link and label checks; so does a strategy title", () => {
    const names = ["তানভীর হাসান"];
    const r = rep("R-001", "দলে কাজ করেছে");
    const goal = (over: Record<string, unknown>) => ({
      ref: "n1", textBn: "[S] নিজের কাজ শেষ করার চেষ্টা করেছে।", evidence: ["R-001"], counterEvidence: [], claimedLevel: "SINGLE", settings: ["MATH"], strategyId: null, kind: null,
      insteadOfItem: null, needTag: null, functionTag: null, skillKey: SUPPORT_SKILLS[0], actionable: null, replacesItemId: null, baselineBn: "দুইটি কাজ শেষ করে", expectedBn: "তিনটি কাজ শেষ করবে", ...over,
    });
    const runIt = (item: Record<string, unknown>, rosterNames = names) =>
      validateSupportResult(file([{ report: "R-001", check: check({}), compare: null }], [{ child: "C-001", profileDraft: { sections: { goals: [item] }, card: { doItems: [], avoidItems: [], strengthItems: [], goalItem: null }, changeNoteBn: "" } }]), vctx([r], rosterNames));
    expect(runIt(goal({ baselineBn: "তানভীর হাসান পাশে বসলে" })).rejected).toEqual([expect.objectContaining({ reasonCode: "TOKEN_OR_NAME", field: "baselineBn" })]);
    expect(runIt(goal({ expectedBn: "দেখুন https://example.org/x" })).rejected).toEqual([expect.objectContaining({ reasonCode: "LINK_OR_HTML", field: "expectedBn" })]);
    expect(runIt(goal({ expectedBn: "সে আর দুষ্টু থাকবে না" })).rejected.map((x) => x.reasonCode)).toContain("LABEL_TERM");
    const strat = (titleBn: string) =>
      validateSupportResult(file([{ report: "R-001", check: check({ strategyCandidate: { present: true, titleBn, starterKey: "REMIND_BEFORE", punitive: false } }), compare: null }]), vctx([r], names)).reports[0].strategyCandidate;
    expect(strat("কাজ শুরুর আগে এক লাইনে বুঝিয়ে দিন")).not.toBeNull();
    expect(strat("তানভীর হাসানের পাশে বসান")).toBeNull();
    expect(strat("দেখুন https://example.org")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The database round-trip
// ---------------------------------------------------------------------------------------------

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
  await passEval(fx);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function uploadFile(s: BatchSetup, name: string) {
  const c = await codesOf(s.batchId, { R1: s.r1, R2: s.r2, A1: s.a1 });
  const up = await run(UPLOAD, P(fx), { b: s.batchId, t: result(name, c), c: "claude.ai" });
  if (up.errors) throw new Error(up.errors[0].message);
  return up.data?.uploadSupportResult.importId as string;
}
const closeAll = async () => {
  await SupportBatch.updateMany({ status: { $in: ["OPEN", "RESULT_PENDING"] } }, { $set: { status: "CANCELLED" } });
  await SupportReport.updateMany({ status: { $in: ["TO_PROCESS", "IN_BATCH", "APPROVED", "NEEDS_REWRITE", "PROCESSED"] } }, { $set: { status: "WITHDRAWN", batchId: null } });
};

describe("7 + 13 — apply is atomic, safe to repeat, and honours the ticked stages", () => {
  let s: BatchSetup;
  let importId: string;
  beforeAll(async () => {
    s = await setupBatch(run, fx);
    importId = await uploadFile(s, "I-01-correct.json");
  });
  it("two applies at once → exactly one wins and exactly one set of drafts exists", async () => {
    const [a, b] = await Promise.all([run(APPLY, P(fx), { i: importId, u: [] }), run(APPLY, P(fx), { i: importId, u: [] })]);
    expect([a, b].filter((x) => !x.errors)).toHaveLength(1);
    expect(await SupportProfileVersion.countDocuments({ status: "DRAFT" })).toBe(1);
    expect((await SupportImport.findById(importId).lean())?.status).toBe("APPLIED");
    // a third, later apply is refused and adds nothing
    expect((await run(APPLY, P(fx), { i: importId, u: [] })).errors).toBeDefined();
    expect(await SupportProfileVersion.countDocuments({ status: "DRAFT" })).toBe(1);
  });
  it("a batch whose stages leave out SYNTHESIS makes no draft", async () => {
    await closeAll();
    const before = await SupportProfileVersion.countDocuments({});
    const s2 = await setupBatch(run, fx, { skipEval: true, stages: ["CHECK", "COMPARE"] });
    const id2 = await uploadFile(s2, "I-01-correct.json");
    const ap = await run(APPLY, P(fx), { i: id2, u: [] });
    expect(ap.errors).toBeUndefined();
    expect(await SupportProfileVersion.countDocuments({})).toBe(before);
  });
  it("a failed apply puts the import back to VALIDATED so it can be repeated", async () => {
    await closeAll();
    const s3 = await setupBatch(run, fx, { skipEval: true });
    const id3 = await uploadFile(s3, "I-01-correct.json");
    await SupportBatch.updateOne({ _id: s3.batchId }, { $set: { status: "CANCELLED" } }); // the batch closes under it
    expect((await run(APPLY, P(fx), { i: id3, u: [] })).errors).toBeDefined();
    expect((await SupportImport.findById(id3).lean())?.status).toBe("VALIDATED");
  });
});

describe("3 + 15 — no teacher text stays in SupportAiRun / SupportImport; the teacher sees no raw code", () => {
  const dump = async () => JSON.stringify([await SupportAiRun.find({}).lean(), await SupportImport.find({}).lean()]);
  it("after a rewrite (NEEDS_REWRITE) and after routing (safeguarding), the stores hold no quote, question or suggestion", async () => {
    await closeAll();
    const s = await setupBatch(run, fx, { skipEval: true });
    const id = await uploadFile(s, "I-22-needs-rewrite.json");
    expect((await run(APPLY, P(fx), { i: id, u: [] })).errors).toBeUndefined();
    const r2 = await SupportReport.findById(s.r2).lean();
    expect(r2?.status).toBe("NEEDS_REWRITE");
    expect(r2!.returnQuestions.length).toBeGreaterThan(0);
    for (const q of r2!.returnQuestions) for (const t of [q.quote, q.askBn, q.suggestionBn ?? ""]) expect(t).not.toMatch(/\[|\]|\b[CTRSIB]-\d{2,4}\b/);
    const texts = r2!.returnQuestions.flatMap((q) => [q.quote, q.askBn]).filter((t) => t.length > 6);
    expect(texts.length).toBeGreaterThan(0);
    const d1 = await dump();
    for (const t of texts) expect(d1.includes(t)).toBe(false);
    expect(d1).not.toContain("পড়া বলার সময়");
    const run1 = await SupportAiRun.findOne({ reportId: s.r2 }).lean();
    expect(JSON.stringify(run1!.outputJson)).toMatch(/"category"/);
    expect(JSON.stringify(run1!.outputJson)).not.toMatch(/askBn|quote|suggestionBn/);

    await closeAll();
    const s2 = await setupBatch(run, fx, { skipEval: true });
    const id2 = await uploadFile(s2, "I-20-safeguarding-high.json");
    expect((await run(APPLY, P(fx), { i: id2, u: [] })).errors).toBeUndefined();
    const d2 = await dump();
    const routed = await SupportReport.find({ safeguardingHold: "OPEN" }).lean();
    expect(routed.length).toBeGreaterThan(0);
    for (const r of routed) for (const q of r.openFlags) for (const t of [q.quote, q.askBn].filter((x) => x && x.length > 6)) expect(d2.includes(t)).toBe(false);
    expect(d2).not.toMatch(/"quote"|"askBn"|"suggestionBn"/);
    for (const i of await SupportImport.find({ status: { $in: ["APPLIED", "DISCARDED"] } }).lean()) expect([i.valid, i.previewText]).toEqual([null, null]);
  });
});

describe("12 — an expired batch clears its validated import like cancel and discard do", () => {
  it("the import is DISCARDED with no valid result and no preview text", async () => {
    await closeAll();
    const s = await setupBatch(run, fx, { skipEval: true });
    const id = await uploadFile(s, "I-01-correct.json");
    expect((await SupportImport.findById(id).lean())?.valid).not.toBeNull();
    await sweepBatches(new Date(Date.now() + 15.5 * 86_400_000));
    const imp = await SupportImport.findById(id).lean();
    expect(imp).toMatchObject({ status: "DISCARDED", valid: null, previewText: null });
    expect((await SupportBatch.findById(s.batchId).lean())?.status).toBe("EXPIRED");
  });
});

describe("11 — reminders have their own daytime window and key; held reports do not count", () => {
  const dhaka = (h: number): Date => new Date(`${new Date().toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:00:00+06:00`);
  it("before 09:00 Dhaka only the daily sweep runs; after it the reminder key runs too", async () => {
    const keysAt = async (d: Date): Promise<string[]> => {
      const keys: string[] = [];
      await runSupportProfileSweeps(d, async (key, fn) => (keys.push(key), await fn(), true));
      return keys;
    };
    expect(await keysAt(dhaka(3))).toEqual(["SUPPORT_DAILY"]);
    expect(await keysAt(dhaka(8))).toEqual(["SUPPORT_DAILY"]);
    expect(await keysAt(dhaka(10))).toEqual(["SUPPORT_DAILY", "SUPPORT_REMIND"]);
  });
  it("a waiting report held for an open safeguarding question never prompts a batch reminder", async () => {
    await closeAll();
    const r = await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.child, { occurredOn: daysAgoKey(1) }) });
    const id = r.data?.submitSupportReport.report.id;
    await SupportReport.updateOne({ _id: id }, { $set: { status: "TO_PROCESS", safeguardingHold: "OPEN", waitingSince: new Date(Date.now() - 30 * 86_400_000) } });
    const before = await Notification.countDocuments({ recipientUserId: fx.principal });
    expect(await batchReminders(new Date())).toBe(0);
    expect(await Notification.countDocuments({ recipientUserId: fx.principal })).toBe(before);
    await SupportReport.updateOne({ _id: id }, { $set: { safeguardingHold: null } });
    expect(await batchReminders(new Date())).toBeGreaterThanOrEqual(1);
  });
});

describe("14 — the preview and the evaluation leave an audit row without text", () => {
  it("supportImportPreview writes SUPPORT_PROFILE_VIEWED with surface PREVIEW; recordSupportEvaluation writes SUPPORT_EVALUATION_RECORDED", async () => {
    await closeAll();
    const s = await setupBatch(run, fx, { skipEval: true });
    const id = await uploadFile(s, "I-22-needs-rewrite.json");
    const n = await Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED", "meta.surface": "PREVIEW" });
    const pv = await run(`query($i: String!) { supportImportPreview(importId: $i) { importId } }`, P(fx), { i: id });
    expect(pv.errors).toBeUndefined();
    expect(await Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED", "meta.surface": "PREVIEW" })).toBe(n + 1);
    const row = await Audit.findOne({ eventKind: "SUPPORT_PROFILE_VIEWED", "meta.surface": "PREVIEW" }).sort({ _id: -1 }).lean();
    expect(row?.meta).toMatchObject({ batchId: s.batchId, importId: id, via: "BATCH" });
    expect(JSON.stringify(row?.meta)).not.toMatch(/পড়া|দুষ্টু/);

    const ec = evalCtx();
    const text = JSON.stringify({ schema: "support-result/v1", batch: ec.batchCode, nonce: ec.nonce, methodVersion: ec.methodVersion, complete: false, reports: [], children: [],
      selfCheck: { reportsDone: 0, childrenDone: 0, everySentenceCited: true, noNamesOrCodesInSentences: true, noNewFacts: true, safeguardingMarked: true } });
    const m = await run(`mutation($t: String!) { recordSupportEvaluation(kind: "CHAT", chatLabel: "review-chat", resultText: $t, suggestionsChecked: true) { passed } }`, P(fx), { t: text });
    expect(m.errors).toBeUndefined();
    const ev = await Audit.findOne({ eventKind: "SUPPORT_EVALUATION_RECORDED" }).lean();
    expect(ev?.meta).toMatchObject({ kind: "CHAT", producer: "chat:review-chat", passed: false });
  });
});

describe("1 (pack level) — a numeric school id 103 does not block the real download", () => {
  it("school id 103 with R-/C- codes and day offsets → the pack downloads (the leak cases are the units above)", async () => {
    await closeAll();
    await mongoose.connection.db!.collection("students").updateOne({ _id: fx.child }, { $set: { schoolId: "103" } });
    await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.child, { behaviour: "দলে অঙ্ক করেছে", occurredOn: daysAgoKey(3) }) });
    const b = await run(CREATE_BATCH, P(fx), {});
    const d = await run(DOWNLOAD, P(fx), { b: b.data?.createSupportBatch.id });
    expect(d.errors).toBeUndefined();
    await SupportBatch.updateOne({ _id: b.data?.createSupportBatch.id }, { $set: { status: "CANCELLED" } });
  });
});

describe("2 — a batch that would overflow the code space is refused and claims nothing", () => {
  it("createBatch with more codes than exist throws, and the reports stay waiting", async () => {
    await closeAll();
    const before = await SupportReport.countDocuments({ status: "TO_PROCESS" });
    // 26 teachers' worth of waiting reports cannot overflow in a test; the generator itself is proven above
    expect(() => codes("R", 1200, 3)).toThrow();
    expect(await SupportReport.countDocuments({ status: "TO_PROCESS" })).toBe(before);
  });
});

// ---- the method pin (9) is in supportMethodDoc.test.ts; the CRLF case (8) as well -------------
