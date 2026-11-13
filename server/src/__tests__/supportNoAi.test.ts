/** CSP-2 — with no key and no batch the feature works (docs/prd-child-support-profile.md §6.7). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import * as aiRouter from "../modules/platform/ai/aiRouter";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { Notification } from "../modules/notifications/models/Notification";
import { batchReminders } from "../modules/support-profile/services/supportRewriteSweeps";
import { authOf, reportInput, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";
import { SAFEGUARDING_FIXTURES } from "./fixtures/support/safeguarding";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
const aiSpy = jest.spyOn(aiRouter, "aiSend");
const savedKeys = { a: process.env.ANTHROPIC_API_KEY, d: process.env.DEEPSEEK_API_KEY };
beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
});
afterAll(async () => {
  process.env.ANTHROPIC_API_KEY = savedKeys.a;
  process.env.DEEPSEEK_API_KEY = savedKeys.d;
  await mongoose.disconnect();
  await mongo.stop();
});
/** A day that is not a Thursday (the batch day, Q-18), at noon Dhaka. */
function nonThursday(offsetDays: number): Date {
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + (offsetDays + i) * 86_400_000);
    const key = d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
    const noon = new Date(`${key}T12:00:00+06:00`);
    if (noon.getUTCDay() !== 4) return noon;
  }
  throw new Error("unreachable");
}

it("intake works, the word lists and the sign list run, nothing is sent anywhere", async () => {
  const t = authOf(fx.classTeacher, "TEACHER");
  expect((await run(SUBMIT, t, { input: reportInput(fx.child) })).data?.submitSupportReport.outcome).toBe("SAVED");
  expect((await run(SUBMIT, t, { input: reportInput(fx.child, { behaviour: "সে খুব বেয়াদব" }) })).data?.submitSupportReport.outcome).toBe("BLOCKED");
  expect((await run(SUBMIT, t, { input: reportInput(fx.child, { behaviour: SAFEGUARDING_FIXTURES[0].bn }) })).data?.submitSupportReport.outcome).toBe("SAFEGUARDING_QUESTION");
  expect(aiSpy).not.toHaveBeenCalled();
});

it("the batch reminder fires when the oldest waiting report is 7 days old (not at 6), once a day", async () => {
  const day = nonThursday(0);
  await SupportReport.updateMany({ status: "TO_PROCESS" }, { $set: { waitingSince: new Date(day.getTime() - 6 * 86_400_000) } });
  expect(await batchReminders(day)).toBe(0);
  await SupportReport.updateMany({ status: "TO_PROCESS" }, { $set: { waitingSince: new Date(day.getTime() - 7 * 86_400_000) } });
  expect(await batchReminders(day)).toBe(1);
  expect(await batchReminders(day)).toBe(0); // once a day
  const n = await Notification.findOne({ recipientUserId: fx.principal, bodyBn: /ব্যাচ চালান/ }).lean();
  expect(n?.titleBn).toBe("শিক্ষার্থী সহায়তা: নতুন বার্তা");
});
