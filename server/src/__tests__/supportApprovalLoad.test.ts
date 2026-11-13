/** CSP-5 — the approval-load review after one month (docs/prd-child-support-profile.md §7.8; owner OA-4; D-#1589). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { SupportSetting } from "../modules/support-profile/models/SupportSetting";
import { Notification } from "../modules/notifications/models/Notification";
import { computeApprovalLoad, reviewNotices } from "../modules/support-profile/services/supportLifecycle";
import { authOf, runner, seedSupport, type SupportFx } from "./supportFixtures";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport({ switchOn: false });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
const P = () => authOf(fx.principal, "PRINCIPAL");

it("switch-on sets the review date to switch-on + 30 days; its notice fires once", async () => {
  const r = await run(`mutation { setSupportProfileSwitch(on: true) { switchedOnKey approvalLoadReviewDueKey } }`, P());
  const { switchedOnKey, approvalLoadReviewDueKey } = r.data?.setSupportProfileSwitch;
  const [y, m, d] = switchedOnKey.split("-").map(Number);
  expect(approvalLoadReviewDueKey).toBe(new Date(Date.UTC(y, m - 1, d + 30)).toISOString().slice(0, 10));
  await reviewNotices(new Date(Date.now() + 31 * 86_400_000));
  await reviewNotices(new Date(Date.now() + 32 * 86_400_000));
  expect(await Notification.countDocuments({ recipientUserId: fx.principal, bodyBn: /অনুমোদনের চাপ/ })).toBe(1);
});

it("the card returns week-end queue sizes, the largest, medians and the backlog; it names no teacher and no child; 'too heavy' shows above 25 at two week-ends running", async () => {
  const now = new Date();
  const mk = (processedDaysAgo: number, decided: boolean) =>
    SupportReport.create({ studentId: fx.child, authorId: fx.classTeacher, authorVia: "CLASS_TEACHER", occurredOn: "2026-01-01", tone: "POSITIVE", status: decided ? "APPROVED" : "PROCESSED",
      submittedAt: new Date(now.getTime() - (processedDaysAgo + 1) * 86_400_000), processedAt: new Date(now.getTime() - processedDaysAgo * 86_400_000), decidedAt: decided ? now : null });
  for (let i = 0; i < 27; i++) await mk(20, false);
  await mk(3, true);
  const load = await computeApprovalLoad(now);
  expect(load.weeks).toHaveLength(4);
  expect(load.largest).toBeGreaterThanOrEqual(27);
  expect(load.tooHeavy).toBe(true);
  expect(load.medianDaysToDecision).not.toBeNull();
  const viaApi = await run(`query { supportApprovalLoadJson }`, P());
  expect(viaApi.data?.supportApprovalLoadJson).not.toMatch(/studentId|authorId|name/i);
  expect((await run(`query { supportApprovalLoadJson }`, authOf(fx.classTeacher, "TEACHER"))).errors).toBeDefined();
});

it("recording the owner's choice sets the next review date", async () => {
  const r = await run(`mutation { recordSupportApprovalLoadChoice(choice: "KEEP") }`, P());
  const [y, m, d] = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }).split("-").map(Number);
  expect(r.data?.recordSupportApprovalLoadChoice).toBe(new Date(Date.UTC(y, m - 1, d + 90)).toISOString().slice(0, 10));
  expect((await SupportSetting.findOne({ key: "main" }).lean())?.approvalLoadReviewDueKey).toBe(r.data?.recordSupportApprovalLoadChoice);
});
