/** CSP-1 — continuous intake with no AI (§6.9, D-#1582) and the good thing (OA-2, D-#1583). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import * as aiRouter from "../modules/platform/ai/aiRouter";
import { authOf, MINE, QUEUE, reportInput, runner, seedSupport, SUBMIT, VIEW, type SupportFx } from "./supportFixtures";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
const aiSpy = jest.spyOn(aiRouter, "aiSend");
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
const t = () => authOf(fx.classTeacher, "TEACHER");

describe("continuous intake", () => {
  let id = "";
  it("a saved report is TO_PROCESS and no AI call is made", async () => {
    const r = await run(SUBMIT, t(), { input: reportInput(fx.child) });
    expect(r.data?.submitSupportReport.outcome).toBe("SAVED");
    id = r.data?.submitSupportReport.report.id;
    expect(r.data?.submitSupportReport.report.status).toBe("TO_PROCESS");
    expect(aiSpy).not.toHaveBeenCalled();
  });

  it("its author's list returns it at once as pending; no other teacher, no card, no evidence count includes it", async () => {
    const mine = await run(MINE, t());
    expect(mine.data?.mySupportReportsPage.rows.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([[id, "TO_PROCESS"]]);
    expect((await run(MINE, authOf(fx.routineTeacher, "TEACHER"))).data?.mySupportReportsPage.total).toBe(0);
    const card = await run(VIEW, authOf(fx.routineTeacher, "TEACHER"), { s: String(fx.child), surface: "CARD", via: "ROUTINE" });
    expect(card.data?.supportProfileView).toBeNull(); // no published version → nothing
  });

  it("the author may edit while TO_PROCESS — the edit replaces the text (no earlier text kept)", async () => {
    const e = await run(SUBMIT, t(), { input: reportInput(fx.child, { behaviour: "নতুন লেখা: সে দুটি অঙ্ক দেখিয়ে দিয়েছে" }), reportId: id });
    expect(e.data?.submitSupportReport.report.behaviour).toBe("নতুন লেখা: সে দুটি অঙ্ক দেখিয়ে দিয়েছে");
    const raw = await SupportReport.findById(id).lean();
    expect(JSON.stringify(raw)).not.toContain("পাশের জনকে দুটি অঙ্ক");
  });

  it("not while IN_BATCH; withdraw works while TO_PROCESS", async () => {
    await SupportReport.updateOne({ _id: id }, { $set: { status: "IN_BATCH" } });
    const e = await run(SUBMIT, t(), { input: reportInput(fx.child), reportId: id });
    expect(e.errors?.[0].message).toMatch(/প্রক্রিয়া চলছে/);
    const w1 = await run(`mutation($id: String!) { withdrawSupportReport(reportId: $id) { status } }`, t(), { id });
    expect(w1.errors).toBeDefined();
    await SupportReport.updateOne({ _id: id }, { $set: { status: "TO_PROCESS" } });
    const w2 = await run(`mutation($id: String!) { withdrawSupportReport(reportId: $id) { status } }`, t(), { id });
    expect(w2.data?.withdrawSupportReport.status).toBe("WITHDRAWN");
  });

  it("G-01…G-04: the good thing", async () => {
    // G-03 empty → refused
    expect((await run(SUBMIT, t(), { input: reportInput(fx.child, { goodThingText: "" }) })).errors?.[0].message).toMatch(/ভালো দিক/);
    // "—" without a reason → refused
    expect((await run(SUBMIT, t(), { input: reportInput(fx.child, { goodThingText: null, goodThingNone: true }) })).errors?.[0].message).toMatch(/কারণ/);
    // G-01 a line → saved
    expect((await run(SUBMIT, t(), { input: reportInput(fx.child) })).data?.submitSupportReport.outcome).toBe("SAVED");
    // G-02 "—" with a reason → saved
    const g2 = await run(SUBMIT, t(), { input: reportInput(fx.child, { goodThingText: null, goodThingNone: true, goodThingReasonKey: "SAW_BRIEFLY" }) });
    expect(g2.data?.submitSupportReport.outcome).toBe("SAVED");
    // G-04 a bare label → saved (questioned later in the batch; counts for nothing)
    expect((await run(SUBMIT, t(), { input: reportInput(fx.child, { goodThingText: "ভালো ছেলে" }) })).data?.submitSupportReport.outcome).toBe("SAVED");
    // not asked on GUARDIAN_INFO (the class teacher may enter it)
    const gi = await run(SUBMIT, t(), {
      input: { studentId: String(fx.child), source: "GUARDIAN_INFO", occurredOn: reportInput(fx.child).occurredOn, situation: "ঘুমের আগে", whatWorked: "মা বলেছেন, গল্প শোনালে শান্ত হয়", tone: "POSITIVE" },
    });
    expect(gi.errors).toBeUndefined();
    expect(gi.data?.submitSupportReport.outcome).toBe("SAVED");
  });

  it("guardian information: a teacher who is not the class teacher may not enter it", async () => {
    const gi = await run(SUBMIT, authOf(fx.routineTeacher, "TEACHER"), {
      input: { studentId: String(fx.child), source: "GUARDIAN_INFO", occurredOn: reportInput(fx.child).occurredOn, situation: "বাসায়", whatWorked: "গল্প", tone: "POSITIVE" },
    });
    expect(gi.errors?.[0].message).toMatch(/অভিভাবকের তথ্য/);
  });

  it("the Principal sees the waiting count and list", async () => {
    const q = await run(QUEUE, authOf(fx.principal, "PRINCIPAL"), { status: "TO_PROCESS" });
    expect(q.errors).toBeUndefined();
    expect(q.data?.supportQueuePage.waiting).toBeGreaterThanOrEqual(4);
    expect(q.data?.supportQueuePage.rows.length).toBe(q.data?.supportQueuePage.waiting);
    expect((await run(QUEUE, t(), {})).errors).toBeDefined();
  });

  it("no AI was called by any of it", () => expect(aiSpy).not.toHaveBeenCalled());
});
