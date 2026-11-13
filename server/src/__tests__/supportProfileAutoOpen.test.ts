/** CSP-1 — the profile opens with the first saved report (owner Q-4, D-#1546). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { Audit } from "../modules/platform/models/Audit";
import { authOf, DRAFT, reportInput, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";

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

it("a draft alone creates no profile", async () => {
  const r = await run(DRAFT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.child) });
  expect(r.errors).toBeUndefined();
  expect(await SupportProfile.countDocuments({})).toBe(0);
});

it("the first submitted report creates the profile (FIRST_REPORT) and writes SUPPORT_PROFILE_OPENED; the second reuses it", async () => {
  const a = await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.child) });
  expect(a.data?.submitSupportReport.outcome).toBe("SAVED");
  const profiles = await SupportProfile.find({}).lean();
  expect(profiles).toHaveLength(1);
  expect(profiles[0].openedVia).toBe("FIRST_REPORT");
  expect(await Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_OPENED" })).toBe(1);
  await run(SUBMIT, authOf(fx.routineTeacher, "TEACHER"), { input: reportInput(fx.child) });
  expect(await SupportProfile.countDocuments({})).toBe(1);
  expect(await Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_OPENED" })).toBe(1);
});

it("any enrolled child is accepted — no 'flagged' precondition", async () => {
  const r = await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.classmate, { behaviour: "সে প্রশ্নের উত্তর দিয়েছে" }) });
  expect(r.data?.submitSupportReport.outcome).toBe("SAVED");
  expect(await SupportProfile.countDocuments({ studentId: fx.classmate })).toBe(1);
});
