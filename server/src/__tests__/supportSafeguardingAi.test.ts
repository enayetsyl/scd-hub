/** CSP-2 — a safeguarding sign found in a batch (docs/prd-child-support-profile.md §16.5 SG-9; D-#1564). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { scanSafeguarding } from "@scd/shared";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SafeguardingReferral } from "../modules/platform/safeguarding/SafeguardingReferral";
import { Notification } from "../modules/notifications/models/Notification";
import { DECIDE, runner, seedSupport, type SupportFx } from "./supportFixtures";
import { APPLY, codesOf, P, result, setupBatch, UPLOAD } from "./supportBatchFixtures";
import { SAFEGUARDING_EVAL } from "../modules/support-profile/eval/supportEvalFixtures";

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
async function applyFile(file: string, first = false) {
  const s = await setupBatch(run, fx, { skipEval: !first });
  const c = await codesOf(s.batchId, { R1: s.r1, R2: s.r2, A1: s.a1 });
  const up = await run(UPLOAD, P(fx), { b: s.batchId, t: result(file, c), c: "claude.ai" });
  if (up.errors) throw new Error(up.errors[0].message);
  expect(up.data?.uploadSupportResult.safeguarding.length + up.data?.uploadSupportResult.ok.length).toBeGreaterThan(0);
  await run(APPLY, P(fx), { i: up.data?.uploadSupportResult.importId });
  return s;
}

it("LOW confidence on an idiom → an open safeguarding question for the PRINCIPAL; not returned to the teacher; no same-day notice; cannot be approved until cleared", async () => {
  const before = await Notification.countDocuments({ recipientUserId: fx.principal });
  const s = await applyFile("I-19-safeguarding-low.json", true);
  const r = await SupportReport.findById(s.r2).lean();
  expect([r?.status, r?.safeguardingHold, r?.safeguardingHoldSource]).toEqual(["PROCESSED", "OPEN", "BATCH_LOW"]);
  expect(r?.returnQuestions).toEqual([]);
  expect(await Notification.countDocuments({ recipientUserId: fx.principal })).toBe(before);
  expect((await run(DECIDE, P(fx), { id: s.r2, d: "APPROVED" })).errors?.[0].message).toMatch(/সুরক্ষা/);
  const clear = await run(`mutation($id: String!) { resolveSupportSafeguardingHold(reportId: $id, answer: "NO") { safeguardingHold } }`, P(fx), { id: s.r2 });
  expect(clear.data?.resolveSupportSafeguardingHold.safeguardingHold).toBe("CLEARED");
});

it("HIGH → the same, and the same-day notice is sent; 'yes' → a SUPPORT_BATCH referral and the report routed", async () => {
  const s = await applyFile("I-20-safeguarding-high.json");
  expect(await Notification.countDocuments({ recipientUserId: fx.principal, bodyBn: /সুরক্ষা-প্রশ্ন উঠেছে/ })).toBe(1);
  const y = await run(`mutation($id: String!) { resolveSupportSafeguardingHold(reportId: $id, answer: "YES") { status } }`, P(fx), { id: s.r2 });
  expect(y.data?.resolveSupportSafeguardingHold.status).toBe("SAFEGUARDING_ROUTED");
  expect(await SafeguardingReferral.countDocuments({ source: "SUPPORT_BATCH" })).toBe(1);
  expect((await SupportReport.findById(s.r2).lean())?.behaviour).toBe("");
});

it("a safeguarding term in a profile sentence raises the banner on that child", async () => {
  await applyFile("I-11-safeguarding-term.json");
  expect((await SupportProfile.findOne({ studentId: fx.child }).lean())?.safeguardingBanner).toBe(true);
});

it("when a result misses F-30 … F-35, the deterministic list had already opened the question at intake", () => {
  for (const f of SAFEGUARDING_EVAL.filter((x) => x.termHit)) expect([f.id, scanSafeguarding({ [f.field]: f.bn }).length > 0]).toEqual([f.id, true]);
});
