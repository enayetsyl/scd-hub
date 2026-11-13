/** CSP-3 — notices (docs/prd-child-support-profile.md §9.7). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { Notification } from "../modules/notifications/models/Notification";
import { dailyDigest } from "../modules/support-profile/services/supportQueueExtras";
import { batchReminders } from "../modules/support-profile/services/supportRewriteSweeps";
import { authOf, DECIDE, reportInput, ROSTER, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";

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
const submit = async (who = fx.routineTeacher) => (await run(SUBMIT, authOf(who, "TEACHER"), { input: reportInput(fx.child) })).data?.submitSupportReport.report.id as string;

it("the digest is one per day per recipient and counts only PROCESSED reports", async () => {
  await submit();
  expect(await dailyDigest(new Date())).toBe(0); // only TO_PROCESS → nothing
  const id = await submit();
  await SupportReport.updateOne({ _id: id }, { $set: { status: "PROCESSED" } });
  expect(await dailyDigest(new Date())).toBe(1);
  expect(await dailyDigest(new Date())).toBe(0);
  const n = await Notification.findOne({ recipientUserId: fx.principal, bodyBn: /অনুমোদনের অপেক্ষায়/ }).lean();
  expect(n?.bodyBn).toContain("১");
});

it("the batch reminder fires once a day at most, when 25 are waiting", async () => {
  const day = new Date();
  await SupportReport.updateMany({}, { $set: { waitingSince: new Date() } });
  const isThursday = new Date(`${day.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" })}T12:00:00+06:00`).getUTCDay() === 4;
  if (!isThursday) expect(await batchReminders(day)).toBe(0);
  for (let i = 0; i < 25; i++) await SupportReport.create({ studentId: fx.child, authorId: fx.classTeacher, authorVia: "CLASS_TEACHER", occurredOn: "2026-01-01", tone: "POSITIVE", status: "TO_PROCESS", waitingSince: new Date() });
  const first = await batchReminders(day);
  expect(first).toBe(isThursday ? 0 : 1); // on a Thursday the first call above already sent today's
  expect(await batchReminders(day)).toBe(0);
});

it("returned / approved notices go to the author only; the push preview carries no child name and no question text", async () => {
  const id = await submit(fx.manualTeacher);
  await run(DECIDE, authOf(fx.principal, "PRINCIPAL"), { id, d: "RETURNED", reason: "কোন পিরিয়ডে লিখুন" });
  const mine = await Notification.find({ bodyBn: /ফেরত এসেছে/ }).lean();
  expect(mine.map((n) => String(n.recipientUserId))).toEqual([String(fx.manualTeacher)]);
  for (const n of await Notification.find({ kind: { $in: ["SUPPORT_PROFILE", "SAFEGUARDING"] } }).lean()) {
    const t = `${n.titleBn} ${n.bodyBn}`;
    for (const x of [ROSTER.child.nameBn, ROSTER.child.nameBn.split(" ")[0], ROSTER.child.name, "কোন পিরিয়ডে লিখুন"]) expect(t).not.toContain(x);
  }
});
