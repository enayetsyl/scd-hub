/** CSP-1 — every content read is audited; meta never holds text (§8.4, D-#1549). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SupportProfileVersion } from "../modules/support-profile/models/SupportProfileVersion";
import { Audit } from "../modules/platform/models/Audit";
import { authOf, daysAgoKey, reportInput, runner, seedSupport, SUBMIT, VIEW, type SupportFx } from "./supportFixtures";
import { SAFEGUARDING_FIXTURES } from "./fixtures/support/safeguarding";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
const ITEM = "ছবি আঁকার কাজে পুরো সময় মন দিয়ে কাজ করেছে";
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
  const p = await SupportProfile.create({ studentId: fx.child, openedVia: "PRINCIPAL", openedBy: fx.principal, openedAt: new Date() });
  const v = await SupportProfileVersion.create({
    profileId: p._id,
    versionNo: 1,
    status: "PUBLISHED",
    createdBy: fx.principal,
    sections: { strengths: [{ itemId: "i1", textBn: ITEM, sourceKind: "PRINCIPAL", level: "SINGLE", lastEvidenceKey: daysAgoKey(3) }] },
    card: { doItemIds: [], avoidItemIds: [], strengthItemIds: ["i1"], goalItemId: null },
  });
  p.currentVersionId = v._id;
  await p.save();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
const viewed = () => Audit.countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED" });

it("each content read writes exactly one SUPPORT_PROFILE_VIEWED with surface + via + readerVia", async () => {
  const t = authOf(fx.routineTeacher, "TEACHER");
  for (const [surface, via] of [["CARD", "ROUTINE"], ["FULL", "STUDENT_PAGE"], ["CARD", "ATTENDANCE"]]) {
    const n = await viewed();
    await run(VIEW, t, { s: String(fx.child), surface, via });
    expect(await viewed()).toBe(n + 1);
    const row = await Audit.findOne({ eventKind: "SUPPORT_PROFILE_VIEWED" }).sort({ _id: -1 }).lean();
    expect(row?.meta).toMatchObject({ studentId: String(fx.child), versionNo: 1, surface, via, readerVia: "TEACHING" });
  }
  // a report read
  const s = await run(SUBMIT, t, { input: reportInput(fx.child) });
  const n = await viewed();
  await run(`query($id: String!) { supportReport(reportId: $id, via: "QUEUE") { id } }`, authOf(fx.principal, "PRINCIPAL"), { id: s.data?.submitSupportReport.report.id });
  expect(await viewed()).toBe(n + 1);
});

it("the chip query writes none", async () => {
  const n = await viewed();
  const r = await run(`query($ids: [String!]!) { supportProfileChips(studentIds: $ids) }`, authOf(fx.classTeacher, "TEACHER"), { ids: [String(fx.child), String(fx.classmate)] });
  expect(r.data?.supportProfileChips).toEqual([String(fx.child)]);
  expect(await viewed()).toBe(n);
  // a non-reader learns nothing from the chip
  const s = await run(`query($ids: [String!]!) { supportProfileChips(studentIds: $ids) }`, authOf(fx.stranger, "TEACHER"), { ids: [String(fx.child)] });
  expect(s.data?.supportProfileChips).toEqual([]);
});

it("no audit meta contains report, profile or referral text", async () => {
  await run(SUBMIT, authOf(fx.classTeacher, "TEACHER"), { input: reportInput(fx.child, { behaviour: SAFEGUARDING_FIXTURES[0].bn }), sg: "YES" });
  const texts = [ITEM, reportInput(fx.child).behaviour as string, reportInput(fx.child).situation as string, SAFEGUARDING_FIXTURES[0].bn];
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const a of await Audit.find({ eventKind: { $regex: /^(SUPPORT_|SAFEGUARDING_)/ } }).lean()) walk(a.meta);
  expect(strings.length).toBeGreaterThan(0);
  for (const s of strings) for (const t of texts) expect(s.includes(t.slice(0, 10))).toBe(false);
});
