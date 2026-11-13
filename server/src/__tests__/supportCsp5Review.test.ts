/** CSP-5 review fixes — the child picker, the drawer flag, the MY_REPORTS read (docs/prd-child-support-profile.md §9.3). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { Audit } from "../modules/platform/models/Audit";
import { SupportSetting } from "../modules/support-profile/models/SupportSetting";
import { authOf, daysAgoKey, reportInput, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";

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

const PICK = `query($s: String!) { supportReportableStudents(search: $s) { id name } }`;
const ENABLED = `query { supportProfileEnabled }`;
const READ = `query($id: String!, $via: String) { supportReport(reportId: $id, via: $via) { id behaviour } }`;

it("the child picker lists the children the teacher teaches today, with no profile needed, and nobody else's", async () => {
  const r = await run(PICK, authOf(fx.classTeacher, "TEACHER"), { s: "Rafi" }).catch(() => null);
  const rows = (r?.data?.supportReportableStudents ?? (await run(PICK, authOf(fx.classTeacher, "TEACHER"), { s: "রাফি" })).data?.supportReportableStudents) as { id: string }[];
  expect(rows.map((x) => x.id)).toContain(String(fx.child));
  const none = await run(PICK, authOf(fx.stranger, "TEACHER"), { s: "রাফি" });
  expect(none.data?.supportReportableStudents ?? []).toEqual([]);
  expect((await run(PICK, authOf(fx.classTeacher, "TEACHER"), { s: "R" })).data?.supportReportableStudents).toEqual([]);
});

it("the drawer flag is false for a teacher while the switch is OFF, and still true for the Principal", async () => {
  await SupportSetting.updateOne({ key: "main" }, { $set: { switchedOnKey: null } });
  try {
    expect((await run(ENABLED, authOf(fx.classTeacher, "TEACHER"))).data?.supportProfileEnabled).toBe(false);
    expect((await run(ENABLED, authOf(fx.principal, "PRINCIPAL"))).data?.supportProfileEnabled).toBe(true);
    expect((await run(PICK, authOf(fx.classTeacher, "TEACHER"), { s: "রাফি" })).data?.supportReportableStudents).toEqual([]);
  } finally {
    await SupportSetting.updateOne({ key: "main" }, { $set: { switchedOnKey: daysAgoKey(1) } });
  }
  expect((await run(ENABLED, authOf(fx.classTeacher, "TEACHER"))).data?.supportProfileEnabled).toBe(true);
});

it("the author's own read is audited with via MY_REPORTS, not QUEUE", async () => {
  const s = await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.child) });
  const id = s.data?.submitSupportReport.report.id as string;
  const ok = await run(READ, authOf(fx.classTeacher, "TEACHER"), { id, via: "MY_REPORTS" });
  expect(ok.errors).toBeUndefined();
  expect(ok.data?.supportReport.behaviour).toBeTruthy();
  const bad = await run(READ, authOf(fx.classTeacher, "TEACHER"), { id, via: "SOMETHING_ELSE" });
  expect(bad.errors).toBeTruthy();
  const audit = await Audit.find({ eventKind: "SUPPORT_PROFILE_VIEWED", "meta.reportId": id }).lean();
  expect(audit.some((a) => (a.meta as { via?: string } | undefined)?.via === "MY_REPORTS")).toBe(true);
});
