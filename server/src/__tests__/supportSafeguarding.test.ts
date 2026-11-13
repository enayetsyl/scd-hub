/**
 * CSP-1 — THE ESCALATION TEST (docs/prd-child-support-profile.md §16.5, D-#1564). Deterministic
 * part of F-30 … F-35, the controls F-36 … F-38, the always-present button, the receiver's screen.
 * The AI is off throughout: nothing here needs a model.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SafeguardingReferral } from "../modules/platform/safeguarding/SafeguardingReferral";
import { renotifyUnseenReferrals } from "../modules/platform/safeguarding/SafeguardingService";
import { Notification } from "../modules/notifications/models/Notification";
import { Audit } from "../modules/platform/models/Audit";
import * as aiRouter from "../modules/platform/ai/aiRouter";
import { authOf, DECIDE, QUEUE, reportInput, ROSTER, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";
import { SAFEGUARDING_FIXTURES } from "./fixtures/support/safeguarding";

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
const T = () => authOf(fx.classTeacher, "TEACHER");
const P = () => authOf(fx.principal, "PRINCIPAL");
const REFERRALS = `query { safeguardingReferralsPage { total rows { id textBn signs status source } } }`;

describe("safeguarding — sign list at intake", () => {
  const signFixtures = SAFEGUARDING_FIXTURES.filter((f) => f.termHit);

  it.each(signFixtures.map((f) => [f.id, f] as const))("%s opens the question before anything is saved", async (_id, f) => {
    const before = await SupportReport.countDocuments({});
    const r = await run(SUBMIT, T(), { input: reportInput(fx.child, { [f.field]: f.bn }) });
    expect(r.data?.submitSupportReport.outcome).toBe("SAFEGUARDING_QUESTION");
    expect(r.data?.submitSupportReport.signs.length).toBeGreaterThan(0);
    expect(await SupportReport.countDocuments({})).toBe(before);
  });

  it.each(SAFEGUARDING_FIXTURES.filter((f) => !f.termHit).map((f) => [f.id, f] as const))("control %s opens no question", async (_id, f) => {
    const r = await run(SUBMIT, T(), { input: reportInput(fx.child, { [f.field]: f.bn, tone: "CONCERN", goodThingText: "নিজে থেকে বোর্ড মুছে দিয়েছে" }) });
    expect(r.data?.submitSupportReport.outcome).toBe("SAVED");
  });

  let routedId = "";
  it("'yes' → a referral with the teacher's words and signs; the report is SAFEGUARDING_ROUTED with its text emptied; the Principal is notified at once; audited with no text", async () => {
    const f = SAFEGUARDING_FIXTURES.find((x) => x.id === "F-30")!;
    const r = await run(SUBMIT, T(), { input: reportInput(fx.child, { behaviour: f.bn, tone: "CONCERN" }), sg: "YES" });
    expect(r.data?.submitSupportReport.outcome).toBe("ROUTED");
    routedId = r.data?.submitSupportReport.report.id;
    const rep = await SupportReport.findById(routedId).lean();
    expect(rep?.status).toBe("SAFEGUARDING_ROUTED");
    expect([rep?.behaviour, rep?.situation, rep?.tried, rep?.goodThing?.textBn ?? ""]).toEqual(["", "", "", ""]);
    const ref = await SafeguardingReferral.findOne({}).lean();
    expect(ref?.textBn).toContain("বাসায় মারে");
    expect(ref?.signs).toContain("DISCLOSURE");
    expect(ref?.source).toBe("SUPPORT_REPORT");
    const notes = await Notification.find({ recipientUserId: fx.principal, kind: "SAFEGUARDING" }).lean();
    expect(notes.length).toBe(1);
    const audit = await Audit.findOne({ eventKind: "SAFEGUARDING_REFERRAL_RAISED" }).lean();
    expect(JSON.stringify(audit?.meta)).not.toContain("মারে");
  });

  it("a routed report can never be decided (approved / returned / not used)", async () => {
    for (const d of ["APPROVED", "RETURNED", "NOT_USED"]) {
      expect((await run(DECIDE, P(), { id: routedId, d, reason: "x" })).errors).toBeDefined();
    }
  });

  let heldId = "";
  it("'no' → TEACHER_SAID_NO, hold OPEN, pinned on top of the queue at once, same-day notice", async () => {
    // a few ordinary waiting reports first, so pinning is visible
    await run(SUBMIT, T(), { input: reportInput(fx.child) });
    const f = SAFEGUARDING_FIXTURES.find((x) => x.id === "F-31")!;
    const r = await run(SUBMIT, T(), { input: reportInput(fx.child, { settingNote: f.bn, tone: "CONCERN" }), sg: "NO" });
    expect(r.data?.submitSupportReport.outcome).toBe("SAVED");
    heldId = r.data?.submitSupportReport.report.id;
    const rep = await SupportReport.findById(heldId).lean();
    expect(rep?.safeguardingAsked).toBe("TEACHER_SAID_NO");
    expect(rep?.safeguardingHold).toBe("OPEN");
    const q = await run(QUEUE, P(), {});
    expect(q.data?.supportQueuePage.rows[0].id).toBe(heldId);
    expect(q.data?.supportQueuePage.held).toBe(1);
    const n = await Notification.find({ recipientUserId: fx.principal, kind: "SUPPORT_PROFILE" }).lean();
    expect(n.some((x) => x.bodyBn.includes("সুরক্ষা-প্রশ্ন"))).toBe(true);
  });

  it("the always-present button creates a MANUAL referral with no report", async () => {
    const before = await SupportReport.countDocuments({});
    const r = await run(`mutation($s: String!, $t: String!) { raiseSafeguardingConcern(studentId: $s, textBn: $t) }`, T(), { s: String(fx.child), t: "শিশুটি আজ আমাকে কিছু বলতে চেয়েছে, প্রধান শিক্ষকের সাথে কথা বলব" });
    expect(r.data?.raiseSafeguardingConcern).toBe(true);
    expect(await SupportReport.countDocuments({})).toBe(before);
    expect(await SafeguardingReferral.countDocuments({ source: "MANUAL" })).toBe(1);
  });

  it("a teacher, Office and 'view as' cannot read any referral; the receiver can", async () => {
    expect((await run(REFERRALS, T())).errors).toBeDefined();
    expect((await run(REFERRALS, authOf(fx.office, "OFFICE", { grantedPermissions: ["safeguarding:receive"] }))).errors).toBeDefined();
    expect((await run(REFERRALS, authOf(fx.principal, "PRINCIPAL", { impersonatorId: String(fx.principal) }))).errors).toBeDefined();
    const ok = await run(REFERRALS, P());
    expect(ok.data?.safeguardingReferralsPage.total).toBe(2);
  });

  it("the push preview holds no child name and no detail", async () => {
    const all = await Notification.find({ kind: { $in: ["SAFEGUARDING", "SUPPORT_PROFILE"] } }).lean();
    expect(all.length).toBeGreaterThan(0);
    for (const n of all) {
      const text = `${n.titleBn} ${n.bodyBn}`;
      for (const name of [ROSTER.child.nameBn, ROSTER.child.name, ...ROSTER.child.nameBn.split(" ")]) expect(text).not.toContain(name);
      for (const f of SAFEGUARDING_FIXTURES) expect(text).not.toContain(f.bn.slice(0, 12));
    }
  });

  it("an unseen referral is re-notified hourly in school hours; a seen one is not", async () => {
    const inTwoHours = new Date(Date.now() + 2 * 3600_000);
    const atNoon = new Date(`${inTwoHours.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" })}T12:00:00+06:00`);
    const later = atNoon.getTime() < Date.now() + 3600_000 ? new Date(atNoon.getTime() + 86_400_000) : atNoon;
    const n = await renotifyUnseenReferrals(later);
    expect(n).toBe(2); // two RAISED referrals × one receiver
    const id = (await SafeguardingReferral.findOne({ source: "MANUAL" }).lean())!._id.toString();
    await run(`mutation($id: String!) { markSafeguardingReferral(id: $id, action: "SEEN") }`, P(), { id });
    expect(await renotifyUnseenReferrals(new Date(later.getTime() + 3700_000))).toBe(1);
    // night: nothing
    const night = new Date(`${later.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" })}T22:00:00+06:00`);
    expect(await renotifyUnseenReferrals(new Date(night.getTime() + 86_400_000))).toBe(0);
  });

  it("no AI was called", () => expect(aiSpy).not.toHaveBeenCalled());
});
