/** CSP-2 — batches (docs/prd-child-support-profile.md §6.10, D-#1582/#1585). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportBatch } from "../modules/support-profile/models/SupportBatch";
import { SupportSetting } from "../modules/support-profile/models/SupportSetting";
import { sweepBatches } from "../modules/support-profile/services/SupportBatchService";
import { authOf, reportInput, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";
import { CANCEL_BATCH, CREATE_BATCH, P, passEval } from "./supportBatchFixtures";
import { SAFEGUARDING_FIXTURES } from "./fixtures/support/safeguarding";

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
const submit = async (who: SupportFx[keyof SupportFx], child: SupportFx[keyof SupportFx], over: Record<string, unknown> = {}, sg?: string) =>
  (await run(SUBMIT, authOf(who, "TEACHER"), { input: reportInput(child, over), sg })).data?.submitSupportReport.report?.id as string;
const batch = (auth = P(fx), vars: Record<string, unknown> = {}) => run(CREATE_BATCH, auth, vars);

describe("batches", () => {
  it("only a holder of `process` makes a batch: a teacher, Office and any 'view as' session are refused", async () => {
    await submit(fx.classTeacher, fx.child);
    expect((await batch(authOf(fx.classTeacher, "TEACHER"))).errors).toBeDefined();
    expect((await batch(authOf(fx.office, "OFFICE", { grantedPermissions: ["support_profile:process"] }))).errors).toBeDefined();
    expect((await batch(authOf(fx.principal, "PRINCIPAL", { impersonatorId: String(fx.principal) }))).errors).toBeDefined();
    expect(await SupportBatch.countDocuments({})).toBe(0);
  });

  it("takes TO_PROCESS reports oldest first, a child's reports together, up to the pack budget, and leaves the rest; never a held, routed or withdrawn report", async () => {
    await SupportReport.deleteMany({});
    // budget = 3 reports
    await SupportSetting.updateOne({ key: "main" }, { $set: { packBudgetTokens: 3 * 2400 } });
    const c1 = await submit(fx.classTeacher, fx.child);
    const m1 = await submit(fx.classTeacher, fx.classmate, { behaviour: "সে আজ বোর্ডে এসে অঙ্ক করেছে" });
    const c2 = await submit(fx.routineTeacher, fx.child);
    const m2 = await submit(fx.classTeacher, fx.classmate, { behaviour: "সে বই গুছিয়ে রেখেছে" });
    await SupportReport.updateOne({ _id: c1 }, { $set: { waitingSince: new Date(Date.now() - 5 * 86_400_000) } });
    await SupportReport.updateOne({ _id: m1 }, { $set: { waitingSince: new Date(Date.now() - 4 * 86_400_000) } });
    const held = await submit(fx.classTeacher, fx.child, { behaviour: SAFEGUARDING_FIXTURES[0].bn, tone: "CONCERN" }, "NO");
    const routed = await submit(fx.classTeacher, fx.child, { behaviour: SAFEGUARDING_FIXTURES[2].bn, tone: "CONCERN" }, "YES");
    const withdrawn = await submit(fx.classTeacher, fx.child);
    await run(`mutation($id: String!) { withdrawSupportReport(reportId: $id) { status } }`, authOf(fx.classTeacher, "TEACHER"), { id: withdrawn });
    const b = await batch();
    expect(b.errors).toBeUndefined();
    const doc = await SupportBatch.findById(b.data?.createSupportBatch.id).lean();
    const taken = doc!.reportIds.map(String).sort();
    // the child's group (c1, c2) first (oldest), then the classmate's group would exceed 3 → left
    expect(taken).toEqual([c1, c2].sort());
    for (const id of [held, routed, withdrawn, m1, m2]) expect(taken).not.toContain(id);
    expect((await SupportReport.findById(c1).lean())?.status).toBe("IN_BATCH");
    expect((await SupportReport.findById(m1).lean())?.status).toBe("TO_PROCESS");
  });

  it("taken reports cannot be edited; a report is never in two open batches", async () => {
    const r = await SupportReport.findOne({ status: "IN_BATCH" }).lean();
    const e = await run(SUBMIT, authOf(r!.authorId, "TEACHER"), { input: reportInput(fx.child), reportId: String(r!._id) });
    expect(e.errors?.[0].message).toMatch(/প্রক্রিয়া চলছে/);
    expect((await batch()).errors?.[0].message).toMatch(/খোলা/);
  });

  it("cancel returns every report to TO_PROCESS", async () => {
    const open = await SupportBatch.findOne({ status: "OPEN" }).lean();
    expect((await run(CANCEL_BATCH, P(fx), { b: String(open!._id) })).data?.cancelSupportBatch.status).toBe("CANCELLED");
    expect(await SupportReport.countDocuments({ status: "IN_BATCH" })).toBe(0);
  });

  it("expiry after 14 days returns every report to TO_PROCESS", async () => {
    await SupportSetting.updateOne({ key: "main" }, { $set: { packBudgetTokens: 60000 } });
    const b = await batch();
    const id = b.data?.createSupportBatch.id;
    expect(await sweepBatches(new Date(Date.now() + 14 * 86_400_000))).toBe(0);
    expect(await sweepBatches(new Date(Date.now() + 15.5 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect((await SupportBatch.findById(id).lean())?.status).toBe("EXPIRED");
    expect(await SupportReport.countDocuments({ status: "IN_BATCH" })).toBe(0);
  });

  it("a rewritten report joins the next batch with round 2", async () => {
    const r = await SupportReport.findOne({ status: "TO_PROCESS", studentId: fx.child, authorId: fx.classTeacher });
    r!.status = "NEEDS_REWRITE";
    r!.returnQuestions = [{ flagId: "f1", category: "NO_EVIDENCE", field: "behaviour", severity: "ASK", quote: "দুটি অঙ্ক", askBn: "কোন দিন?", suggestionBn: null }];
    await r!.save();
    await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.child), reportId: String(r!._id) });
    const b = await batch();
    const doc = await SupportBatch.findById(b.data?.createSupportBatch.id).lean();
    expect(doc!.reportIds.map(String)).toContain(String(r!._id));
    expect((await SupportReport.findById(r!._id).lean())?.round).toBe(2);
  });
});
