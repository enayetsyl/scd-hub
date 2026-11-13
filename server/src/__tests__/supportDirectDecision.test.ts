/** CSP-1 — the Principal decides a waiting report directly, with no AI (§6.7, O-5). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { authOf, DECIDE, reportInput, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";

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
const P = () => authOf(fx.principal, "PRINCIPAL");
const newReport = async (over: Record<string, unknown> = {}, sg?: string): Promise<string> => {
  const r = await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.child, over), sg });
  return r.data?.submitSupportReport.report.id;
};

it("approve / edit / return / not used a TO_PROCESS report → checkSkipped DECIDED_DIRECTLY", async () => {
  const a = await run(DECIDE, P(), { id: await newReport(), d: "APPROVED" });
  expect(a.data?.decideSupportReport).toMatchObject({ status: "APPROVED", checkSkipped: "DECIDED_DIRECTLY" });
  const e = await run(DECIDE, P(), { id: await newReport(), d: "APPROVED_EDITED", edited: { behaviour: "সে দুটি অঙ্ক বুঝিয়ে দিয়েছে" } });
  expect(e.data?.decideSupportReport).toMatchObject({ status: "APPROVED", principalEdited: true, checkSkipped: "DECIDED_DIRECTLY" });
  const ret = await run(DECIDE, P(), { id: await newReport(), d: "RETURNED", reason: "কোন পিরিয়ডে ঘটেছে লিখুন" });
  expect(ret.data?.decideSupportReport.status).toBe("RETURNED");
  const nu = await run(DECIDE, P(), { id: await newReport(), d: "NOT_USED", reason: "পুনরাবৃত্তি" });
  expect(nu.data?.decideSupportReport.status).toBe("NOT_USED");
  expect((await run(DECIDE, P(), { id: await newReport(), d: "RETURNED" })).errors?.[0].message).toMatch(/কারণ/);
});

it("a teacher and Office are refused", async () => {
  const id = await newReport();
  expect((await run(DECIDE, authOf(fx.classTeacher, "TEACHER"), { id, d: "APPROVED" })).errors).toBeDefined();
  expect((await run(DECIDE, authOf(fx.office, "OFFICE", { grantedPermissions: ["support_profile:approve"] }), { id, d: "APPROVED" })).errors).toBeDefined();
  expect((await SupportReport.findById(id).lean())?.status).toBe("TO_PROCESS");
});

it("a report with an open safeguarding question cannot be approved until it is cleared", async () => {
  const id = await newReport({ behaviour: "সে বলেছে, 'বাসায় মারে'" }, "NO");
  expect((await SupportReport.findById(id).lean())?.safeguardingHold).toBe("OPEN");
  expect((await run(DECIDE, P(), { id, d: "APPROVED" })).errors?.[0].message).toMatch(/সুরক্ষা/);
  const clear = await run(`mutation($id: String!) { resolveSupportSafeguardingHold(reportId: $id, answer: "NO") { safeguardingHold } }`, P(), { id });
  expect(clear.data?.resolveSupportSafeguardingHold.safeguardingHold).toBe("CLEARED");
  expect((await run(DECIDE, P(), { id, d: "APPROVED" })).data?.decideSupportReport.status).toBe("APPROVED");
});

it("RETURN is refused when the author is no longer a reader", async () => {
  const id = await newReport();
  await mongoose.connection.db!.collection("sections").updateOne({ _id: fx.sec1 }, { $set: { classTeacherId: fx.stranger } });
  expect((await run(DECIDE, P(), { id, d: "RETURNED", reason: "আরও লিখুন" })).errors?.[0].message).toMatch(/লেখক/);
  await mongoose.connection.db!.collection("sections").updateOne({ _id: fx.sec1 }, { $set: { classTeacherId: fx.classTeacher } });
});
