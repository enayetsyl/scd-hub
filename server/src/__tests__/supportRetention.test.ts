/** CSP-5 — leavers and closed profiles (docs/prd-child-support-profile.md §2.4, §7.2; owner Q-2, Q-3; D-#1558). */
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SupportProfileVersion } from "../modules/support-profile/models/SupportProfileVersion";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { leaverSweep } from "../modules/support-profile/services/supportLifecycle";
import { authOf, daysAgoKey, reportInput, runner, seedSupport, SUBMIT, VIEW, type SupportFx } from "./supportFixtures";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
  await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.child) });
  const p = await SupportProfile.findOne({ studentId: fx.child });
  const v = await SupportProfileVersion.create({ profileId: p!._id, versionNo: 1, status: "PUBLISHED", createdBy: fx.principal, sections: { strengths: [{ itemId: "i1", textBn: "ছবি আঁকায় মন দিয়ে কাজ করে", sourceKind: "PRINCIPAL", level: "SINGLE", lastEvidenceKey: daysAgoKey(2) }] }, card: { strengthItemIds: ["i1"] } });
  p!.currentVersionId = v._id;
  await p!.save();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
const view = (a: Record<string, unknown>) => run(VIEW, a, { s: String(fx.child), surface: "FULL", via: "STUDENT_PAGE" });

it("enrolment LEFT → status LEFT, teachers refused on the next request, nothing deleted, purgeAfterKey null", async () => {
  expect((await view(authOf(fx.classTeacher, "TEACHER"))).errors).toBeUndefined();
  await mongoose.connection.db!.collection("enrolments").updateOne({ studentId: fx.child }, { $set: { status: "CLOSED", endKey: daysAgoKey(1), outcome: "LEFT" } });
  expect(await leaverSweep()).toBe(1);
  const p = await SupportProfile.findOne({ studentId: fx.child }).lean();
  expect([p?.status, p?.purgeAfterKey]).toEqual(["LEFT", null]);
  expect((await view(authOf(fx.classTeacher, "TEACHER"))).errors).toBeDefined();
  expect((await view(authOf(fx.principal, "PRINCIPAL"))).errors).toBeUndefined();
  expect(await SupportReport.countDocuments({ studentId: fx.child })).toBe(1);
  expect(await SupportProfileVersion.countDocuments({})).toBe(1);
});

it("re-admission → the Principal may reopen; CLOSED → teachers refused, the Principal still reads", async () => {
  await mongoose.connection.db!.collection("enrolments").updateOne({ studentId: fx.child }, { $set: { status: "ACTIVE" }, $unset: { endKey: "", outcome: "" } });
  expect((await run(`mutation($s: String!) { reopenSupportProfile(studentId: $s) }`, authOf(fx.principal, "PRINCIPAL"), { s: String(fx.child) })).data?.reopenSupportProfile).toBe(true);
  expect((await view(authOf(fx.classTeacher, "TEACHER"))).errors).toBeUndefined();
  await run(`mutation($s: String!) { closeSupportProfile(studentId: $s, reasonBn: "অভিভাবকের অনুরোধ") }`, authOf(fx.principal, "PRINCIPAL"), { s: String(fx.child) });
  expect((await view(authOf(fx.classTeacher, "TEACHER"))).errors).toBeDefined();
  expect((await view(authOf(fx.principal, "PRINCIPAL"))).errors).toBeUndefined();
});

it("no scheduler family or support-profile file deletes this feature's AiExchange rows (Q-3, D-#1179)", () => {
  const files = [path.join(__dirname, "../modules/notifications/services/SchedulerService.ts"), ...fs.readdirSync(path.join(__dirname, "../modules/support-profile/services")).map((f) => path.join(__dirname, "../modules/support-profile/services", f))];
  for (const f of files) {
    const code = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect([f, /AiExchange\.(deleteMany|deleteOne|findOneAndDelete|findByIdAndDelete)/.test(code), /from\s+["'][^"']*models\/AiExchange["']/.test(code) && f.includes("support-profile")]).toEqual([f, false, false]);
  }
});
