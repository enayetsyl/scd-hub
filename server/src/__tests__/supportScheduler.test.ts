/** CSP-5 — the notices (docs/prd-child-support-profile.md §7.3, §7.6, §9.7). */
import mongoose from "mongoose";

import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SupportProfileVersion } from "../modules/support-profile/models/SupportProfileVersion";
import { SupportSetting } from "../modules/support-profile/models/SupportSetting";
import { Notification } from "../modules/notifications/models/Notification";
import { monthlyNudge, newClassAndCoverNotices, reviewNotices } from "../modules/support-profile/services/supportLifecycle";
import { authOf, daysAgoKey, reportInput, runner, seedSupport, SUBMIT, todayKey, type SupportFx } from "./supportFixtures";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
  const p = await SupportProfile.create({ studentId: fx.child, openedVia: "PRINCIPAL", openedBy: fx.principal, openedAt: new Date() });
  const v = await SupportProfileVersion.create({ profileId: p._id, versionNo: 1, status: "PUBLISHED", createdBy: fx.principal, sections: { strengths: [{ itemId: "i1", textBn: "ছবি আঁকায় মন দিয়ে কাজ করে", sourceKind: "PRINCIPAL", level: "SINGLE", lastEvidenceKey: daysAgoKey(2) }] }, card: { strengthItemIds: ["i1"] } });
  p.currentVersionId = v._id;
  await p.save();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
const notes = (uid: unknown, re: RegExp) => Notification.countDocuments({ recipientUserId: uid, bodyBn: re });

it("the new-class notice fires once per teacher per class on the first grant day; the cover-day notice once on the cover morning", async () => {
  await newClassAndCoverNotices(new Date());
  await newClassAndCoverNotices(new Date());
  expect(await notes(fx.routineTeacher, /নতুন ক্লাসে/)).toBe(1); // the fixture's routine slot starts today
  expect(await notes(fx.quranTeacher, /নতুন ক্লাসে/)).toBe(0); // their slot started 30 days ago
  expect(await notes(fx.coverTeacher, /কভার ক্লাসের/)).toBe(1);
  const n = await Notification.findOne({ recipientUserId: fx.routineTeacher, bodyBn: /নতুন ক্লাসে/ }).lean();
  expect(`${n?.titleBn} ${n?.bodyBn}`).not.toMatch(/রাফি|Rafi/);
});

it("the monthly nudge (on the 25th) skips a teacher who reported on any child this month", async () => {
  await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.child) });
  const month = todayKey().slice(0, 7);
  const the25th = new Date(`${month}-25T10:00:00+06:00`);
  const notThe25th = new Date(`${month}-24T10:00:00+06:00`);
  expect(await monthlyNudge(notThe25th)).toBe(0);
  await monthlyNudge(the25th);
  expect(await notes(fx.classTeacher, /এ মাসে/)).toBe(0);
  expect(await notes(fx.routineTeacher, /এ মাসে/)).toBe(1);
});

it("review due: 90 days when the profile has a concern item or a goal, else a year — fires when due, once", async () => {
  const p = await SupportProfile.findOne({ studentId: fx.child });
  p!.nextReviewDueKey = daysAgoKey(0);
  await p!.save();
  await reviewNotices();
  await reviewNotices();
  expect(await notes(fx.principal, /পর্যালোচনা বাকি/)).toBe(1);
  // the publish rule itself (90 vs 365) is asserted in supportSynthesis
});

it("review due is ONE notice with a count, and reminders for a 90-day or yearly cut-over come from nextReviewDueKey", async () => {
  const p = await SupportProfile.findOne({ studentId: fx.child });
  p!.nextReviewDueKey = daysAgoKey(1);
  await p!.save();
  const before = await notes(fx.principal, /টি প্রোফাইলের পর্যালোচনা বাকি/);
  await reviewNotices(new Date(Date.now() + 86_400_000));
  await reviewNotices(new Date(Date.now() + 86_400_000));
  expect(await notes(fx.principal, /টি প্রোফাইলের পর্যালোচনা বাকি/)).toBe(before + 1);
  p!.nextReviewDueKey = daysAgoKey(-90); // not due yet
  await p!.save();
  const n = await notes(fx.principal, /টি প্রোফাইলের পর্যালোচনা বাকি/);
  await reviewNotices(new Date(Date.now() + 2 * 86_400_000));
  expect(await notes(fx.principal, /টি প্রোফাইলের পর্যালোচনা বাকি/)).toBe(n);
});

describe("CSP-5 blocker: nothing reaches a teacher while the switch is OFF", () => {
  afterAll(async () => {
    await SupportSetting.updateOne({ key: "main" }, { $set: { switchedOnKey: daysAgoKey(1) } });
  });
  it("no new-class, cover, monthly or review notice is written", async () => {
    await SupportSetting.updateOne({ key: "main" }, { $set: { switchedOnKey: null } });
    await Notification.deleteMany({});
    const month = todayKey().slice(0, 7);
    const p = await SupportProfile.findOne({ studentId: fx.child });
    p!.nextReviewDueKey = daysAgoKey(1);
    await p!.save();
    expect(await newClassAndCoverNotices(new Date())).toBe(0);
    expect(await monthlyNudge(new Date(`${month}-25T10:00:00+06:00`))).toBe(0);
    expect(await reviewNotices(new Date())).toBe(0);
    expect(await Notification.countDocuments({ kind: "SUPPORT_PROFILE" })).toBe(0);
  });
});
