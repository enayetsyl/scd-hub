/**
 * CSP-3 review fixes (docs/prd-child-support-profile.md §2.4, §6.4/6.5, §7.4, §9.4, §12 CSP-3, §16
 * SG-3/SG-6/SG-8/SG-9, D-#638, D-#1553, D-#1560). Made-up names only (public repo).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SupportStrategy } from "../modules/support-profile/models/SupportStrategy";
import { SupportSeedPrompt } from "../modules/support-profile/models/SupportSeedPrompt";
import { SafeguardingReferral } from "../modules/platform/safeguarding/SafeguardingReferral";
import { markReferral, SAFEGUARDING_NOTICE_BN, SAFEGUARDING_PATTERN_NOTICE_BN } from "../modules/platform/safeguarding/SafeguardingService";
import { Notification } from "../modules/notifications/models/Notification";
import { Audit } from "../modules/platform/models/Audit";
import { canSeeSafeguardingBanner } from "../modules/support-profile/services/supportAccess";
import { sweepNotUsedText } from "../modules/support-profile/services/SupportReportService";
import { isQuickApprovable } from "../modules/support-profile/services/supportQueueExtras";
import { resolveLinks } from "../modules/support-profile/services/supportStrategies";
import { runSupportProfileSweeps } from "../modules/support-profile/services/supportSweeps";
import { validateSupportResult, type CtxReport, type ValidationCtx } from "../modules/support-profile/services/supportResultValidator";
import { authOf, DECIDE, DRAFT, oid, reportInput, runner, seedSupport, SUBMIT, VIEW, type SupportFx } from "./supportFixtures";
import { APPLY, codesOf, P, result, setupBatch, UPLOAD } from "./supportBatchFixtures";

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
const T = () => authOf(fx.classTeacher, "TEACHER");
const R = () => authOf(fx.routineTeacher, "TEACHER");

const compare = (over: Record<string, unknown> = {}) => ({
  agreement: [{ claim: "দলে কাজে সাহায্য করে", status: "CONSISTENT", otherReportIds: [], recordFacts: [], noteBn: "মেলে" }],
  authorSkew: { status: "NONE", noteBn: "" },
  sectionHints: ["strengths"],
  skillHints: [],
  functionHint: { tag: null, reportIds: [], noteBn: "" },
  strategyMatches: [],
  echoOfProfile: false,
  safeguardingPattern: { present: false, signs: [], reportIds: [], noteBn: "" },
  principalSummaryBn: "একই কথা বলে।",
  ...over,
});

let evalPassed = false;
async function batchWith(file: string, tweak: (reports: { report: string; compare: unknown }[], c: Record<string, string>) => void) {
  const s = await setupBatch(run, fx, { skipEval: evalPassed });
  evalPassed = true;
  const c = await codesOf(s.batchId, { R1: s.r1, R2: s.r2, A1: s.a1 });
  const j = JSON.parse(result(file, c));
  tweak(j.reports, c);
  const up = await run(UPLOAD, P(fx), { b: s.batchId, t: JSON.stringify(j), c: "claude.ai" });
  if (up.errors) throw new Error(up.errors[0].message);
  await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId });
  return s;
}

describe("1 — the compare is kept only on a report that stays in the Principal's queue (§2.4)", () => {
  it("a report held for a safeguarding question keeps no compare / links / hints; a clean one keeps its compare", async () => {
    const s = await batchWith("I-20-safeguarding-high.json", (reports) => {
      for (const r of reports) r.compare = compare();
    });
    const held = await SupportReport.findById(s.r2).lean();
    expect(held?.safeguardingHold).toBe("OPEN");
    expect([held?.compare, held?.suggestedLinks, held?.sectionHints, held?.skillHints]).toEqual([null, [], [], []]);
    const clean = await SupportReport.findById(s.r1).lean();
    expect(clean?.compare).not.toBeNull();
    expect(clean?.sectionHints).toEqual(["strengths"]);
    expect(isQuickApprovable(await SupportReport.findById(s.r2).then((d) => d!))).toBe(false);
  });

  it("a report that goes back to the teacher (NEEDS_REWRITE) keeps no compare", async () => {
    const s = await batchWith("I-22-needs-rewrite.json", (reports) => {
      for (const r of reports) r.compare = compare();
    });
    const back = await SupportReport.find({ _id: { $in: [s.r1, s.r2] }, status: "NEEDS_REWRITE" }).lean();
    expect(back.length).toBeGreaterThan(0);
    for (const r of back) expect([r.compare, r.sectionHints]).toEqual([null, []]);
  });

  it("returned by the Principal then rewritten: the old compare is gone", async () => {
    const r = await SupportReport.create({ studentId: fx.child, authorId: fx.classTeacher, authorVia: "CLASS_TEACHER", occurredOn: new Date().toISOString().slice(0, 10), tone: "POSITIVE", status: "PROCESSED", compare: { agreement: [] }, sectionHints: ["strengths"], suggestedLinks: [{ strategyId: "NEW", starterKey: null, outcome: "WORKED" }] });
    expect((await run(DECIDE, P(fx), { id: String(r._id), d: "RETURNED", reason: "আরও পরিষ্কার লিখুন" })).errors).toBeUndefined();
    const after = await SupportReport.findById(r._id).lean();
    expect([after?.status, after?.compare, after?.sectionHints, after?.suggestedLinks]).toEqual(["RETURNED", null, [], []]);
    const sub = await run(SUBMIT, T(), { input: reportInput(fx.child, { occurredOn: after!.occurredOn }), reportId: String(r._id) });
    expect(sub.data?.submitSupportReport.report.status).toBe("TO_PROCESS");
    await SupportReport.updateOne({ _id: r._id }, { $set: { compare: { stale: true } } });
    await run(SUBMIT, T(), { input: reportInput(fx.child, { occurredOn: after!.occurredOn }), reportId: String(r._id) });
    expect((await SupportReport.findById(r._id).lean())?.compare).toBeNull();
  });

  it("the 30-day NOT_USED sweep deletes the compare with the text", async () => {
    const r = await SupportReport.create({ studentId: fx.child, authorId: fx.classTeacher, authorVia: "CLASS_TEACHER", occurredOn: "2026-01-01", tone: "POSITIVE", status: "NOT_USED", decidedAt: new Date(Date.now() - 40 * 86_400_000), behaviour: "কিছু", compare: { agreement: [] }, sectionHints: ["strengths"] });
    expect(await sweepNotUsedText()).toBeGreaterThanOrEqual(1);
    const after = await SupportReport.findById(r._id).lean();
    expect([after?.behaviour, after?.compare, after?.sectionHints]).toEqual(["", null, []]);
  });

  it("'yes, a safeguarding matter' routes the report and leaves no compare behind", async () => {
    const r = await SupportReport.create({ studentId: fx.child, authorId: fx.classTeacher, authorVia: "CLASS_TEACHER", occurredOn: "2026-01-02", tone: "CONCERN", status: "PROCESSED", safeguardingHold: "OPEN", safeguardingHoldSource: "BATCH_HIGH", behaviour: "কিছু একটা", compare: { agreement: [] }, skillHints: [], sectionHints: ["strengths"] });
    const y = await run(`mutation($id: String!) { resolveSupportSafeguardingHold(reportId: $id, answer: "YES") { status } }`, P(fx), { id: String(r._id) });
    expect(y.data?.resolveSupportSafeguardingHold.status).toBe("SAFEGUARDING_ROUTED");
    const after = await SupportReport.findById(r._id).lean();
    expect([after?.compare, after?.sectionHints]).toEqual([null, []]);
  });

  it("quick-approve needs a compare and no safeguarding banner on the child", async () => {
    const doc = (over: Record<string, unknown>) => new SupportReport({ studentId: fx.child, authorId: fx.classTeacher, authorVia: "CLASS_TEACHER", occurredOn: "2026-01-03", tone: "POSITIVE", status: "PROCESSED", ...over });
    expect(isQuickApprovable(doc({ compare: null }))).toBe(false);
    expect(isQuickApprovable(doc({ compare: { agreement: [] } }))).toBe(true);
    expect(isQuickApprovable(doc({ compare: { agreement: [] } }), { banner: true })).toBe(false);
    expect(isQuickApprovable(doc({ compare: { agreement: [], safeguardingPattern: { present: true } } }))).toBe(false);
  });
});

describe("2 + 9 + 7 — the comment seed", () => {
  async function comment(author: Types.ObjectId, over: Record<string, unknown> = {}, studentId: Types.ObjectId = fx.child) {
    const r = await mongoose.connection.db!.collection("studentcomments").insertOne({
      studentId, sectionId: fx.sec1, authorUserId: author, type: "BEHAVIOUR", sentiment: "CONCERN", text: "আজ সে খাতা ফেলে দিয়েছে", attachmentIds: [], deliveryChannels: [], createdAt: new Date(), updatedAt: new Date(), ...over,
    });
    return String(r.insertedId);
  }
  const OFFER = `mutation($c: String!) { offerSupportSeed(commentId: $c) { offered state } }`;
  const ANSWER = `mutation($c: String!, $choice: String!) { answerSupportSeed(commentId: $c, choice: $choice) { state draft { id source } } }`;

  it("another author cannot answer, offer, or smuggle a seed onto their own report", async () => {
    const c = await comment(fx.classTeacher);
    expect((await run(OFFER, T(), { c })).data?.offerSupportSeed.offered).toBe(true);
    expect((await run(ANSWER, R(), { c, choice: "NOW" })).errors).toBeDefined();
    expect((await run(OFFER, R(), { c })).data?.offerSupportSeed.offered).toBe(false);
    const own = await run(SUBMIT, R(), { input: reportInput(fx.child, { source: "COMMENT_SEED", seedCommentId: c }) });
    const stored = await SupportReport.findById(own.data?.submitSupportReport.report.id).lean();
    expect([stored?.source, stored?.seedCommentId]).toEqual(["TEACHER", null]);
    const d = await run(DRAFT, R(), { input: reportInput(fx.child, { source: "COMMENT_SEED", seedCommentId: c }) });
    const draft = await SupportReport.findById(d.data?.saveSupportReportDraft.id).lean();
    expect([draft?.source, draft?.seedCommentId]).toEqual(["TEACHER", null]);
    // the true author can still make the seeded draft; the other author never gets it
    const mine = await run(ANSWER, T(), { c, choice: "NOW" });
    expect(mine.data?.answerSupportSeed.draft.source).toBe("COMMENT_SEED");
    expect((await run(ANSWER, R(), { c, choice: "NOW" })).errors).toBeDefined();
  });

  it("a foreign draft already holding the comment is never handed to the caller", async () => {
    const c = await comment(fx.classTeacher);
    await run(OFFER, T(), { c });
    await SupportReport.create({ studentId: fx.child, authorId: fx.routineTeacher, authorVia: "TEACHING", occurredOn: "2026-01-04", tone: "CONCERN", status: "DRAFT", source: "COMMENT_SEED", seedCommentId: new Types.ObjectId(c) });
    const a = await run(ANSWER, T(), { c, choice: "NOW" });
    expect(a.errors).toBeDefined();
    expect(a.data?.answerSupportSeed ?? null).toBeNull();
  });

  it("the seed prompts refuse 'view as' (D-#638)", async () => {
    const c = await comment(fx.classTeacher);
    const viewAs = authOf(fx.classTeacher, "TEACHER", { impersonatorId: String(fx.principal), impersonatorRole: "PRINCIPAL" });
    expect((await run(OFFER, viewAs, { c })).errors).toBeDefined();
    expect(await SupportSeedPrompt.countDocuments({ commentId: new Types.ObjectId(c) })).toBe(0);
    await run(OFFER, T(), { c });
    expect((await run(ANSWER, viewAs, { c, choice: "NOW" })).errors).toBeDefined();
    expect(await SupportReport.countDocuments({ seedCommentId: new Types.ObjectId(c) })).toBe(0);
  });

  it("NOW needs an open, unexpired prompt; a bad id is a refusal; a discarded or expired comment is not offered", async () => {
    const bad = await run(ANSWER, T(), { c: "not-an-id", choice: "NOW" });
    expect(bad.errors?.[0].message).toBe("ভুল আইডি।");
    const declined = await comment(fx.classTeacher);
    await run(OFFER, T(), { c: declined });
    await run(ANSWER, T(), { c: declined, choice: "NO" });
    expect((await run(ANSWER, T(), { c: declined, choice: "NOW" })).errors).toBeDefined();
    const late = await comment(fx.classTeacher);
    await run(OFFER, T(), { c: late });
    await SupportSeedPrompt.updateOne({ commentId: new Types.ObjectId(late) }, { $set: { expiresKey: "2000-01-01" } });
    expect((await run(ANSWER, T(), { c: late, choice: "NOW" })).errors).toBeDefined();
    expect((await run(OFFER, T(), { c: late })).data?.offerSupportSeed.offered).toBe(false);
    const old = await comment(fx.classTeacher, { createdAt: new Date(Date.now() - 20 * 86_400_000) });
    expect((await run(OFFER, T(), { c: old })).data?.offerSupportSeed.offered).toBe(false);
    expect(await SupportSeedPrompt.countDocuments({ commentId: new Types.ObjectId(old) })).toBe(0);
    const gone = await comment(fx.classTeacher, { discardedAt: new Date() });
    expect((await run(OFFER, T(), { c: gone })).data?.offerSupportSeed.offered).toBe(false);
  });

  it("the 3-drafts-per-child cap applies to a seeded draft too", async () => {
    for (let i = 0; i < 3; i++) await run(DRAFT, T(), { input: reportInput(fx.classmate, { behaviour: `খসড়া ${i}` }) });
    const c = await comment(fx.classTeacher, {}, fx.classmate);
    await run(OFFER, T(), { c });
    const a = await run(ANSWER, T(), { c, choice: "NOW" });
    expect(a.errors?.[0].message).toMatch(/৩টি খসড়া/);
  });
});

describe("3 — queue rows carry no compare, flags, preview or records; one audited read does", () => {
  it("compareJson / openFlags / disagreements / preview / records are empty on a row and the row read is not audited as a REPORT read", async () => {
    const r = await SupportReport.create({ studentId: fx.child, authorId: fx.classTeacher, authorVia: "CLASS_TEACHER", occurredOn: "2026-01-05", tone: "POSITIVE", status: "PROCESSED", result: "WORKED", compare: { agreement: [] }, openFlags: [], teacherDisagreements: [{ flagId: "f1", category: "X", reasonBn: "না" }] });
    const before = await Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED", "meta.surface": "REPORT" });
    const q = await run(`query { supportQueuePage(status: "PROCESSED") { rows { id quickApprovable compareJson suggestedLinksJson openFlags { flagId } disagreements dontRememberCount sectionHints evidencePreviewJson recordsJson } } }`, P(fx));
    expect(q.errors).toBeUndefined();
    const row = q.data?.supportQueuePage.rows.find((x: { id: string }) => x.id === String(r._id));
    expect(row).toMatchObject({ compareJson: null, suggestedLinksJson: null, openFlags: [], disagreements: [], dontRememberCount: 0, sectionHints: [], evidencePreviewJson: null, recordsJson: null });
    expect(typeof row.quickApprovable).toBe("boolean");
    expect(await Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED", "meta.surface": "REPORT" })).toBe(before);
    const one = await run(`query($id: String!) { supportReport(reportId: $id, via: "QUEUE") { compareJson disagreements recordsJson } }`, P(fx), { id: String(r._id) });
    expect(one.errors).toBeUndefined();
    expect(one.data?.supportReport.compareJson).toContain("agreement");
    expect(one.data?.supportReport.disagreements).toEqual(["না"]);
    expect(await Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED", "meta.surface": "REPORT" })).toBe(before + 1);
  });

  it("the queue total is not capped and a page returns only its own rows", async () => {
    await SupportReport.insertMany(Array.from({ length: 30 }, (_v, i) => ({ studentId: fx.classmate, authorId: fx.classTeacher, authorVia: "CLASS_TEACHER", occurredOn: "2026-02-01", tone: "POSITIVE", status: "PROCESSED", waitingSince: new Date(Date.now() - i * 1000) })));
    const q = await run(`query { supportQueuePage(status: "PROCESSED", page: 2, pageSize: 10) { total rows { id } } }`, P(fx));
    expect(q.data?.supportQueuePage.rows).toHaveLength(10);
    expect(q.data?.supportQueuePage.total).toBeGreaterThanOrEqual(31);
  });
});

describe("4 + 8 — the SG-6 banner and referral", () => {
  const BANNER = `query($s: String!) { supportProfileView(studentId: $s, surface: "CARD", via: "STUDENT_PAGE") { safeguardingBanner } }`;
  it("the banner is for the Principal side only, and clears when the referral is seen; the notice says what it is", async () => {
    const s = await batchWith("I-01-correct.json", (reports, c) => {
      reports[1].compare = compare({ safeguardingPattern: { present: true, signs: ["NEGLECT"], reportIds: [c.R2, c.A1], noteBn: "কয়েক সপ্তাহে ক্ষুধা ও ঘুমের কথা এসেছে" } });
    });
    void s;
    const refs = await SafeguardingReferral.find({ source: "SUPPORT_COMPARE", studentId: fx.child }).lean();
    expect(refs).toHaveLength(1);
    expect((await run(BANNER, P(fx), { s: String(fx.child) })).data?.supportProfileView.safeguardingBanner).toBe(true);
    // a teacher never sees it: the gate the field uses
    expect([canSeeSafeguardingBanner(T() as never), canSeeSafeguardingBanner(R() as never), canSeeSafeguardingBanner(P(fx) as never), canSeeSafeguardingBanner(null)]).toEqual([false, false, true, false]);
    const bodies = (await Notification.find({ recipientUserId: fx.principal, kind: "SAFEGUARDING", dedupeKey: new RegExp(`^safeguarding:${refs[0]._id}:`) }).lean()).map((n) => n.bodyBn);
    expect(bodies).toContain(SAFEGUARDING_PATTERN_NOTICE_BN);
    expect(bodies).not.toContain(SAFEGUARDING_NOTICE_BN);
    await markReferral(P(fx) as never, String(refs[0]._id), "SEEN");
    expect((await SupportProfile.findOne({ studentId: fx.child }).lean())?.safeguardingBanner).toBe(false);
    expect((await run(BANNER, P(fx), { s: String(fx.child) })).data?.supportProfileView.safeguardingBanner).toBe(false);
    void VIEW;
  });
});

describe("5 — the compare's notes go through the same text checks as profile sentences", () => {
  const rep = (code: string, author: string, over: Partial<CtxReport> = {}): CtxReport => ({
    code, childCode: "C-001", isNew: code === "R-001", status: "IN_BATCH", source: "TEACHER", authorCode: author, occurredOn: `2026-01-0${Number(code.slice(2))}`, slot: "P2", setting: "MATH", result: "WORKED", tone: "POSITIVE", goodThingCounts: true, gotOrAvoided: [],
    texts: { situation: "দলে কাজ চলছিল", settingNote: "", behaviour: "অঙ্ক দেখিয়ে দিয়েছে", tried: "বুঝিয়ে দিয়েছি", resultNote: "", exception: "", whatWorked: "", goodThing: "বোর্ড মুছেছে" }, ...over,
  });
  const ctxOf = (reports: CtxReport[]): ValidationCtx => ({
    batchCode: "B-0001", nonce: "N", methodVersion: "v1", open: true, todayKey: "2026-02-01",
    reports: new Map(reports.map((r) => [r.code, r])), children: new Set(["C-001"]), strategies: new Set(), items: new Set(), rosterNames: [],
  });
  const text = (cmp: Record<string, unknown>) =>
    JSON.stringify({
      schema: "support-result/v1", batch: "B-0001", nonce: "N", methodVersion: "v1", complete: true,
      reports: [{ report: "R-001", check: { verdict: "READY", flags: [], toneCheck: { teacherTone: "POSITIVE", textReads: "POSITIVE" }, strategyCandidate: { present: false, titleBn: "", starterKey: null, punitive: false }, safeguarding: { present: false, signs: [], confidence: "LOW", quote: "" } }, compare: cmp }],
      children: [], selfCheck: { reportsDone: 1, childrenDone: 0, everySentenceCited: true, noNamesOrCodesInSentences: true, noNewFacts: true, safeguardingMarked: true },
    });
  const cmpOf = (r: ReturnType<typeof validateSupportResult>) => r.reports[0]?.compare as Record<string, any>;

  it("a label in any note drops that note; the report is kept", () => {
    const c = compare({
      agreement: [{ claim: "দলে কাজ করে", status: "CONSISTENT", otherReportIds: [], recordFacts: [], noteBn: "ছেলেটি অলস" }],
      functionHint: { tag: null, reportIds: [], noteBn: "সে বেয়াদব" },
      safeguardingPattern: { present: false, signs: [], reportIds: [], noteBn: "ছেলেটি বোকা" },
      authorSkew: { status: "NONE", noteBn: "ছেলেটি নষ্ট ছেলে" },
      principalSummaryBn: "ঠিক আছে।",
    });
    const out = cmpOf(validateSupportResult(text(c), ctxOf([rep("R-001", "T-01")])));
    expect(out.agreement[0].noteBn).toBe("");
    expect(out.functionHint.noteBn).toBe("");
    expect(out.safeguardingPattern.noteBn).toBe("");
    expect(out.authorSkew.noteBn).toBe("");
    expect(out.principalSummaryBn).toBe("ঠিক আছে।");
  });

  it("another code or a name in a note is dropped too", () => {
    const c = compare({ agreement: [{ claim: "x", status: "CONSISTENT", otherReportIds: [], recordFacts: [], noteBn: "T-02 বলেছেন" }] });
    expect(cmpOf(validateSupportResult(text(c), ctxOf([rep("R-001", "T-01")]))).agreement[0].noteBn).toBe("");
  });

  it("functionHint.tag needs 3 observations from 2 teachers; recordFacts only name the records pack", () => {
    const one = ctxOf([rep("R-001", "T-01", { gotOrAvoided: ["ESCAPE_TASK"] })]);
    const c = compare({ functionHint: { tag: "ESCAPE_TASK", reportIds: [], noteBn: "" }, agreement: [{ claim: "x", status: "CONSISTENT", otherReportIds: [], recordFacts: ["attendancePct", "ctTrend:MATH", "secretField", "রোল"], noteBn: "" }] });
    const out = cmpOf(validateSupportResult(text(c), one));
    expect(out.functionHint.tag).toBeNull();
    expect(out.agreement[0].recordFacts).toEqual(["attendancePct", "ctTrend:MATH"]);
    const many = ctxOf([
      rep("R-001", "T-01", { gotOrAvoided: ["ESCAPE_TASK"] }),
      rep("R-002", "T-02", { gotOrAvoided: ["ESCAPE_TASK"] }),
      rep("R-003", "T-02", { gotOrAvoided: ["ESCAPE_TASK"] }),
    ]);
    const ok = cmpOf(validateSupportResult(text(compare({ functionHint: { tag: "ESCAPE_TASK", reportIds: ["R-002", "R-003"], noteBn: "" } })), many));
    expect(ok.functionHint.tag).toBe("ESCAPE_TASK");
  });

  it("author skew is kept with at least 3 + 3 reports and forced to TOO_FEW with fewer", () => {
    const six = ctxOf([rep("R-001", "T-01"), rep("R-002", "T-01"), rep("R-003", "T-01"), rep("R-004", "T-02"), rep("R-005", "T-02"), rep("R-006", "T-03")]);
    const skew = compare({ authorSkew: { status: "MORE_NEGATIVE_THAN_OTHERS", noteBn: "বেশি নেতিবাচক" } });
    expect(cmpOf(validateSupportResult(text(skew), six)).authorSkew.status).toBe("MORE_NEGATIVE_THAN_OTHERS");
    const five = ctxOf([rep("R-001", "T-01"), rep("R-002", "T-01"), rep("R-003", "T-01"), rep("R-004", "T-02"), rep("R-005", "T-02")]);
    expect(cmpOf(validateSupportResult(text(skew), five)).authorSkew).toEqual({ status: "TOO_FEW", noteBn: "" });
  });
});

describe("6 — a NEW strategy takes its how-to from the approved text and refuses labels; creation is audited", () => {
  it("howBn comes from approvedText, a label title is skipped, a label in the how-to empties it", async () => {
    const s = await run(SUBMIT, T(), { input: reportInput(fx.child, { whatWorked: "আগে থেকে এক লাইনে বলে দিলে কাজে বসে", tried: "ভিন্ন কিছু" }) });
    const id = s.data?.submitSupportReport.report.id;
    const r = (await SupportReport.findById(id))!;
    r.approvedText = { situation: "", settingNote: "", behaviour: "", tried: "টি", resultNote: "", exception: "", whatWorked: "আগে থেকে এক লাইনে বলে দিন", goodThing: "" } as never;
    r.whatWorked = "মূল লেখা — এটি আর নয়";
    const links = await resolveLinks(r, [{ strategyId: "NEW", outcome: "WORKED", titleBn: "আগে থেকে বলে দেওয়া" }, { strategyId: "NEW", outcome: "WORKED", titleBn: "অলস ছেলের জন্য" }], String(fx.principal));
    expect(links).toHaveLength(1);
    const st = await SupportStrategy.findById(links[0].strategyId).lean();
    expect(st?.howBn).toBe("আগে থেকে এক লাইনে বলে দিন");
    expect(await Audit.countDocuments({ eventKind: "SUPPORT_STRATEGY_CREATED", targetId: String(links[0].strategyId) })).toBe(1);
    r.approvedText = { ...(r.approvedText as object), whatWorked: "ছেলেটি বোকা" } as never;
    const again = await resolveLinks(r, [{ strategyId: "NEW", outcome: "PARTLY", titleBn: "অন্য একটি কৌশল" }], String(fx.principal));
    expect((await SupportStrategy.findById(again[0].strategyId).lean())?.howBn).toBe("");
  });
});

describe("12 — a second decision after a rewrite is a new notice", () => {
  it("the decision notice is keyed by round", async () => {
    const s = await run(SUBMIT, T(), { input: reportInput(fx.child, { behaviour: "সে আজ দুইবার হাত তুলেছে" }) });
    const id = s.data?.submitSupportReport.report.id;
    await run(DECIDE, P(fx), { id, d: "RETURNED", reason: "আরও লিখুন" });
    await run(SUBMIT, T(), { input: reportInput(fx.child, { behaviour: "সে আজ তিনবার হাত তুলেছে" }), reportId: id });
    await run(DECIDE, P(fx), { id, d: "RETURNED", reason: "আবার দেখুন" });
    expect(await Notification.countDocuments({ dedupeKey: new RegExp(`^support-decided:${id}:`) })).toBe(2);
  });
});

describe("13 — the sweeps use a 24-hour Dhaka clock", () => {
  it("at Dhaka midnight nothing daytime runs; at 16:30 the digest runs", async () => {
    const keys: string[] = [];
    const runOnce = async (k: string, fn: () => Promise<void>) => {
      keys.push(k);
      await fn();
      return true;
    };
    await runSupportProfileSweeps(new Date("2026-03-01T18:30:00Z"), runOnce); // 00:30 Dhaka
    expect(keys).toEqual(["SUPPORT_DAILY"]);
    keys.length = 0;
    await runSupportProfileSweeps(new Date("2026-03-02T10:30:00Z"), runOnce); // 16:30 Dhaka
    expect(keys).toEqual(["SUPPORT_DAILY", "SUPPORT_REMIND", "SUPPORT_DIGEST"]);
    void oid;
  });
});
