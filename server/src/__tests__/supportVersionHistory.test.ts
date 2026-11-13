/** CSP-4 — history: the diff and the readers tab (docs/prd-child-support-profile.md §9.5). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SupportProfileVersion, type SupportItem } from "../modules/support-profile/models/SupportProfileVersion";
import { diffVersions } from "../modules/support-profile/services/supportVersions";
import { authOf, daysAgoKey, runner, seedSupport, VIEW, type SupportFx } from "./supportFixtures";

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
const item = (itemId: string, textBn: string): SupportItem => ({ itemId, textBn, evidence: [], provisionalEvidence: [], counterEvidence: [], sourceKind: "AI", level: "SINGLE", obsCount: 1, teachersCount: 1, settings: [], firstEvidenceKey: null, lastEvidenceKey: daysAgoKey(2), hasGuardianInfo: false, mixed: false });

it("the diff lists added, removed and changed items", async () => {
  const p = await SupportProfile.create({ studentId: fx.child, openedVia: "PRINCIPAL", openedBy: fx.principal, openedAt: new Date() });
  const a = await SupportProfileVersion.create({ profileId: p._id, versionNo: 1, status: "PUBLISHED", createdBy: fx.principal, sections: { strengths: [item("i1", "ক"), item("i2", "খ")] }, card: { strengthItemIds: ["i1"] } });
  const b = await SupportProfileVersion.create({ profileId: p._id, versionNo: 2, status: "PUBLISHED", createdBy: fx.principal, sections: { strengths: [item("i1", "ক — নতুন ভাষা"), item("i3", "গ")] }, card: { strengthItemIds: ["i1"] } });
  expect(diffVersions(a, b)).toEqual({ added: ["গ"], removed: ["খ"], changed: [{ before: "ক", after: "ক — নতুন ভাষা" }] });
  p.currentVersionId = b._id;
  await p.save();
  const q = await run(`query($s: String!, $a: String!, $b: String!) { supportVersionDiff(studentId: $s, fromVersionId: $a, toVersionId: $b) { added removed } }`, authOf(fx.principal, "PRINCIPAL"), { s: String(fx.child), a: String(a._id), b: String(b._id) });
  expect(q.data?.supportVersionDiff).toEqual({ added: ["গ"], removed: ["খ"] });
});

it("the readers tab lists SUPPORT_PROFILE_VIEWED rows for that child only; a teacher cannot see it", async () => {
  await run(VIEW, authOf(fx.classTeacher, "TEACHER"), { s: String(fx.child), surface: "CARD", via: "ROUTINE" });
  await run(VIEW, authOf(fx.routineTeacher, "TEACHER"), { s: String(fx.child), surface: "FULL", via: "STUDENT_PAGE" });
  await mongoose.connection.db!.collection("audits").insertOne({ eventKind: "SUPPORT_PROFILE_VIEWED", actorId: fx.classTeacher, targetId: String(fx.classmate), meta: { surface: "CARD" }, createdAt: new Date() });
  const q = await run(`query($s: String!) { supportReadersPage(studentId: $s) { total rows { who surface via } } }`, authOf(fx.principal, "PRINCIPAL"), { s: String(fx.child) });
  expect(q.data?.supportReadersPage.total).toBe(3); // CARD + FULL + the HISTORY row the diff above wrote (it is audited)
  expect(q.data?.supportReadersPage.rows.map((r: { surface: string }) => r.surface).sort()).toEqual(["CARD", "FULL", "HISTORY"]);
  expect((await run(`query($s: String!) { supportReadersPage(studentId: $s) { total } }`, authOf(fx.classTeacher, "TEACHER"), { s: String(fx.child) })).errors).toBeDefined();
});
