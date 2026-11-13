/** CSP-5 — the chip on teacher surfaces (docs/prd-child-support-profile.md §9.1; D-#1557). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SupportProfileVersion } from "../modules/support-profile/models/SupportProfileVersion";
import { authOf, daysAgoKey, runner, seedSupport, VIEW, type SupportFx } from "./supportFixtures";

let mongo: MongoMemoryServer;
const run = runner(builder.toSchema());
let fx: SupportFx;
const CHIPS = `query($ids: [String!]!) { supportProfileChips(studentIds: $ids) }`;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  fx = await seedSupport();
  // child: published; classmate: a profile with only a draft
  const p = await SupportProfile.create({ studentId: fx.child, openedVia: "PRINCIPAL", openedBy: fx.principal, openedAt: new Date() });
  const v = await SupportProfileVersion.create({ profileId: p._id, versionNo: 1, status: "PUBLISHED", createdBy: fx.principal, sections: { strengths: [{ itemId: "i1", textBn: "ছবি আঁকায় মন দিয়ে কাজ করে", sourceKind: "PRINCIPAL", level: "SINGLE", lastEvidenceKey: daysAgoKey(2) }] }, card: { strengthItemIds: ["i1"] } });
  p.currentVersionId = v._id;
  await p.save();
  const q = await SupportProfile.create({ studentId: fx.classmate, openedVia: "PRINCIPAL", openedBy: fx.principal, openedAt: new Date() });
  await SupportProfileVersion.create({ profileId: q._id, versionNo: 1, status: "DRAFT", createdBy: fx.principal, sections: {} });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
const ids = () => ({ ids: [String(fx.child), String(fx.classmate), String(fx.otherChild)] });

it("the chip returns only children with a PUBLISHED version, and only to current readers", async () => {
  expect((await run(CHIPS, authOf(fx.routineTeacher, "TEACHER"), ids())).data?.supportProfileChips).toEqual([String(fx.child)]);
  expect((await run(CHIPS, authOf(fx.stranger, "TEACHER"), ids())).data?.supportProfileChips).toEqual([]);
  expect((await run(CHIPS, authOf(fx.office, "OFFICE", { grantedPermissions: ["support_profile:view"] }), ids())).errors).toBeDefined();
});

it("a cover teacher gets the chip, the card and the full profile on the cover day only", async () => {
  const c = authOf(fx.coverTeacher, "TEACHER");
  expect((await run(CHIPS, c, ids())).data?.supportProfileChips).toEqual([String(fx.child)]);
  expect((await run(VIEW, c, { s: String(fx.child), surface: "CARD", via: "ROUTINE" })).errors).toBeUndefined();
  expect((await run(VIEW, c, { s: String(fx.child), surface: "FULL", via: "ROUTINE" })).errors).toBeUndefined();
  await mongoose.connection.db!.collection("scopegrants").updateOne({ kind: "proxy" }, { $set: { startDate: new Date(Date.now() - 1.5 * 86_400_000) } });
  expect((await run(CHIPS, c, ids())).data?.supportProfileChips).toEqual([]);
  expect((await run(VIEW, c, { s: String(fx.child), surface: "CARD", via: "ROUTINE" })).errors).toBeDefined();
});
