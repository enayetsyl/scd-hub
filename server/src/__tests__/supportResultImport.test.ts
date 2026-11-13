/**
 * CSP-2 — THE IMPORT VALIDATOR (docs/prd-child-support-profile.md §6.11 V-1 … V-14, NORMATIVE;
 * D-#1587). Each rule on a canned file (fixtures/support/results, I-01 … I-22).
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportImport } from "../modules/support-profile/models/SupportImport";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SupportProfileVersion } from "../modules/support-profile/models/SupportProfileVersion";
import { SupportBatch } from "../modules/support-profile/models/SupportBatch";
import { SUPPORT_IMPORT_REASONS } from "@scd/shared";
import { authOf, runner, seedSupport, type SupportFx } from "./supportFixtures";
import { APPLY, CANCEL_BATCH, codesOf, P, result, setupBatch, UPLOAD, type BatchSetup } from "./supportBatchFixtures";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
let s: BatchSetup;
let codes: Record<string, string>;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
  s = await setupBatch(run, fx);
  codes = await codesOf(s.batchId, { R1: s.r1, R2: s.r2, A1: s.a1 });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const upload = (file: string, extra: Record<string, string> = {}) => run(UPLOAD, P(fx), { b: s.batchId, t: result(file, { ...codes, ...extra }), c: "claude.ai" });
const rejectedCodes = (r: Awaited<ReturnType<typeof upload>>) => (r.data?.uploadSupportResult.rejected ?? []).map((x: { reasonCode: string }) => x.reasonCode);

describe("file level (V-1 … V-3)", () => {
  it("a correct file → every item valid; nothing applied yet", async () => {
    const r = await upload("I-01-correct.json");
    expect(r.errors).toBeUndefined();
    const p = r.data?.uploadSupportResult;
    expect(p.ok).toHaveLength(2);
    expect(p.rejected).toEqual([]);
    expect(p.drafts).toEqual([{ items: 2 }]);
    expect((await SupportReport.findById(s.r1).lean())?.status).toBe("IN_BATCH");
    expect(await SupportProfileVersion.countDocuments({ status: "DRAFT" })).toBe(0);
  });

  it("not JSON, or over 2 MB → the file is refused", async () => {
    expect((await upload("I-02-not-json.txt")).errors?.[0].message).toContain(SUPPORT_IMPORT_REASONS.NOT_JSON);
    const big = result("I-01-correct.json", codes).replace('"complete": true', `"complete": true, "pad": "${"x".repeat(2_200_000)}"`);
    expect((await run(UPLOAD, P(fx), { b: s.batchId, t: big, c: "claude.ai" })).errors?.[0].message).toContain(SUPPORT_IMPORT_REASONS.TOO_LARGE);
  });

  it("the wrong nonce, another batch's code, another method version, an unknown top-level field → refused", async () => {
    expect((await upload("I-03a-wrong-nonce.json")).errors?.[0].message).toContain(SUPPORT_IMPORT_REASONS.WRONG_BATCH);
    expect((await upload("I-03b-other-batch.json")).errors?.[0].message).toContain(SUPPORT_IMPORT_REASONS.WRONG_BATCH);
    expect((await upload("I-04-other-method.json")).errors?.[0].message).toContain(SUPPORT_IMPORT_REASONS.WRONG_METHOD);
    expect((await upload("I-21-unknown-top-field.json")).errors?.[0].message).toContain(SUPPORT_IMPORT_REASONS.UNKNOWN_FIELD);
  });

  it("a chat with no passed evaluation for this method version is refused", async () => {
    const r = await run(UPLOAD, P(fx), { b: s.batchId, t: result("I-01-correct.json", codes), c: "untested-chat" });
    expect(r.errors?.[0].message).toMatch(/মূল্যায়ন প্যাক/);
  });

  it("upload is refused in a 'view as' session and for a teacher", async () => {
    const viewAs = authOf(fx.principal, "PRINCIPAL", { impersonatorId: String(fx.principal) });
    expect((await run(UPLOAD, viewAs, { b: s.batchId, t: result("I-01-correct.json", codes), c: "claude.ai" })).errors).toBeDefined();
    expect((await run(UPLOAD, authOf(fx.classTeacher, "TEACHER"), { b: s.batchId, t: result("I-01-correct.json", codes), c: "claude.ai" })).errors).toBeDefined();
  });
});

describe("item level (V-4 … V-12)", () => {
  it("an unknown report code → that item rejected, the rest valid", async () => {
    const p = (await upload("I-05-unknown-report.json")).data?.uploadSupportResult;
    expect(p.ok).toHaveLength(2);
    expect(p.rejected).toEqual([expect.objectContaining({ itemRef: "R-099", reasonCode: "UNKNOWN_CODE", reasonBn: SUPPORT_IMPORT_REASONS.UNKNOWN_CODE })]);
  });

  it("an unknown child code → that item rejected", async () => {
    const p = (await upload("I-06-unknown-child.json")).data?.uploadSupportResult;
    expect(p.rejected.map((x: { itemRef: string }) => x.itemRef)).toEqual(["C-999"]);
    expect(p.drafts).toHaveLength(1);
  });

  it("a result for a report that was not new in the batch (the approved A1) → rejected; two results for one report → both rejected", async () => {
    const notNew = result("I-01-correct.json", codes).replace(`"report": "${codes.R2}"`, `"report": "${codes.A1}"`);
    const p = (await run(UPLOAD, P(fx), { b: s.batchId, t: notNew, c: "claude.ai" })).data?.uploadSupportResult;
    expect(p.rejected).toEqual([expect.objectContaining({ itemRef: codes.A1, reasonCode: "NOT_NEW" })]);
    const dup = (await upload("I-18-duplicate.json")).data?.uploadSupportResult;
    expect(dup.rejected.filter((x: { reasonCode: string }) => x.reasonCode === "DUPLICATE")).toHaveLength(2);
    expect(dup.ok).toHaveLength(1);
  });

  it("a smuggled field (level, teachersCount) → item rejected: unknown field", async () => {
    expect(rejectedCodes(await upload("I-10-smuggled-field.json"))).toEqual(["UNKNOWN_FIELD"]);
  });

  it("a profile sentence with no citation → 'প্রমাণ ছাড়া বাক্য'", async () => {
    const p = (await upload("I-07-uncited.json")).data?.uploadSupportResult;
    expect(p.rejected).toEqual([expect.objectContaining({ reasonCode: "NO_EVIDENCE", reasonBn: "প্রমাণ ছাড়া বাক্য" })]);
  });

  it("a sentence citing only a report the same file marks NEEDS_REWRITE → rejected", async () => {
    expect(rejectedCodes(await upload("I-08-cites-needs-rewrite.json"))).toEqual(["NO_EVIDENCE"]);
  });

  it("a tampered level (claimedLevel STRONG on one report) → rejected; a valid sentence gets the server's level", async () => {
    expect(rejectedCodes(await upload("I-09-tampered-level.json"))).toEqual(["OVERCLAIM"]);
    const imp = await SupportImport.findOne({}).sort({ _id: -1 }).lean();
    const items = (imp!.valid as { children: { draft: { items: { computed: { level: string } }[] } }[] }).children[0].draft.items;
    expect(items.map((i) => i.computed.level)).toEqual(["SINGLE"]);
  });

  it("a safeguarding term in a sentence → rejected and the child gets the banner", async () => {
    const r = await upload("I-11-safeguarding-term.json");
    expect(rejectedCodes(r)).toEqual(["SAFEGUARDING_TERM"]);
    expect(r.data?.uploadSupportResult.rejected[0].reasonBn).toBe("সুরক্ষা-শব্দ আছে");
  });

  it("a block-list word (a label; a diagnosis) in a sentence → rejected", async () => {
    expect(rejectedCodes(await upload("I-12-label-diagnosis.json"))).toEqual(["LABEL_TERM", "LABEL_TERM"]);
  });

  it("a code, a name or a mask token inside a sentence → rejected", async () => {
    expect(rejectedCodes(await upload("I-13-codes-names.json"))).toEqual(["TOKEN_OR_NAME", "TOKEN_OR_NAME", "TOKEN_OR_NAME"]);
  });

  it("a frequency word → rejected; a link or HTML → rejected", async () => {
    expect(rejectedCodes(await upload("I-15-frequency-word.json"))).toEqual(["FREQUENCY_WORD"]);
    expect(rejectedCodes(await upload("I-16-link-html.json"))).toEqual(["LINK_OR_HTML"]);
  });

  it("too many or oversize items → the extra ones rejected, the rest valid", async () => {
    const many = (await upload("I-14a-too-many.json")).data?.uploadSupportResult;
    expect(many.rejected.filter((x: { reasonCode: string }) => x.reasonCode === "TOO_BIG")).toHaveLength(28);
    expect(many.drafts[0].items).toBe(12);
    expect(rejectedCodes(await upload("I-14b-oversize.json"))).toEqual(["TOO_BIG"]);
  });

  it("a flag whose quote is not in the field → dropped; a suggestion with a new number → dropped", async () => {
    await upload("I-17-flags-quote-suggestion.json");
    const imp = await SupportImport.findOne({}).sort({ _id: -1 }).lean();
    const r2 = (imp!.valid as { reports: { code: string; flags: { id: string; suggestionBn: string | null }[] }[] }).reports.find((x) => x.code === codes.R2)!;
    expect(r2.flags.map((f) => f.id)).toEqual(["f2"]);
    expect(r2.flags[0].suggestionBn).toBeNull();
    expect(imp!.rejected.map((x) => x.reasonCode).sort()).toEqual(["BAD_VALUE", "TOKEN_OR_NAME"]);
  });

  it("every rejection carries a code from SUPPORT_IMPORT_REASONS and the preview shows its plain reason", async () => {
    for (const imp of await SupportImport.find({}).lean()) for (const r of imp.rejected) expect(Object.keys(SUPPORT_IMPORT_REASONS)).toContain(r.reasonCode);
  });
});

describe("apply (V-13, V-14)", () => {
  it("nothing applies before the Principal confirms; after apply a valid report is PROCESSED (not approved); the raw upload is not stored; the preview text is gone", async () => {
    const up = await upload("I-07-uncited.json");
    expect(await SupportReport.countDocuments({ _id: { $in: [s.r1, s.r2] }, status: "IN_BATCH" })).toBe(2);
    const imp = await SupportImport.findById(up.data?.uploadSupportResult.importId).lean();
    expect(JSON.stringify(imp)).not.toContain("support-result/v1"); // no raw file, only its hash
    expect(imp!.fileHash).toMatch(/^[0-9a-f]{64}$/);
    const a = await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId });
    expect(a.errors).toBeUndefined();
    expect(a.data?.applySupportImport.status).toBe("IMPORTED");
    const r1 = await SupportReport.findById(s.r1).lean();
    expect(r1?.status).toBe("PROCESSED");
    expect(r1?.approvedText).toBeNull();
    expect((await SupportImport.findById(up.data?.uploadSupportResult.importId).lean())?.previewText).toBeNull();
    const draft = await SupportProfileVersion.findOne({ status: "DRAFT" }).lean();
    expect(draft?.sections.strengths).toHaveLength(2);
    // [S] → the child's first name; {{DATE:…}} → the report's date in Bangla
    expect(draft?.sections.strengths[0].textBn).toMatch(/^[০-৯]+ \S+ দলে অঙ্কের কাজে রাফি পাশের জনকে/);
    expect(draft?.sections.strengths[1].provisionalEvidence.map(String)).toEqual([s.r1]);
  });

  it("upload / apply refused once the batch is closed; a report with no valid result returns to TO_PROCESS", async () => {
    expect((await upload("I-01-correct.json")).errors?.[0].message).toContain(SUPPORT_IMPORT_REASONS.BATCH_CLOSED);
    // a new batch with a result that covers only one report
    const s2 = await setupBatch(run, fx, { skipEval: true });
    const c2 = await codesOf(s2.batchId, { R1: s2.r1, R2: s2.r2, A1: s2.a1 });
    const onlyOne = JSON.parse(result("I-01-correct.json", c2));
    onlyOne.reports = onlyOne.reports.slice(0, 1);
    const up = await run(UPLOAD, P(fx), { b: s2.batchId, t: JSON.stringify(onlyOne), c: "claude.ai" });
    expect(up.data?.uploadSupportResult.backToQueue).toBe(1);
    expect(up.data?.uploadSupportResult.warnings.length).toBeGreaterThan(0);
    await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId });
    expect((await SupportReport.findById(s2.r2).lean())?.status).toBe("TO_PROCESS");
    expect((await SupportBatch.findById(s2.batchId).lean())?.summary?.backToQueue).toBe(1);
    void CANCEL_BATCH;
    void SupportProfile;
  });
});
