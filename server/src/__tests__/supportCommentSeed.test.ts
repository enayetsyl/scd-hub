/**
 * CSP-3 — comment → report (docs/prd-child-support-profile.md §7.4; owner Q-8, Q-14; D-#1561).
 * C-01 … C-06, and the wall: no comment / guardian surface carries a support field.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { printSchema } from "graphql";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportSeedPrompt } from "../modules/support-profile/models/SupportSeedPrompt";
import { SupportReport } from "../modules/support-profile/models/SupportReport";
import { Notification } from "../modules/notifications/models/Notification";
import { sweepSeedPrompts } from "../modules/support-profile/services/supportSeed";
import { authOf, daysAgoKey, reportInput, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";

let mongo: MongoMemoryServer;
const schema = builder.toSchema();
const run = runner(schema);
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

const OFFER = `mutation($c: String!) { offerSupportSeed(commentId: $c) { offered safeguardingFirst praise state } }`;
const ANSWER = `mutation($c: String!, $choice: String!) { answerSupportSeed(commentId: $c, choice: $choice) { state draft { id status source behaviour tone situation tried } } }`;
async function comment(author: Types.ObjectId, sentiment: "CONCERN" | "POSITIVE", type = "BEHAVIOUR", text = "আজ সে খাতা ছুড়ে ফেলেছে, পরে তুলে নিয়েছে") {
  const r = await mongoose.connection.db!.collection("studentcomments").insertOne({ studentId: fx.child, sectionId: fx.sec1, authorUserId: author, type, sentiment, text, attachmentIds: [], deliveryChannels: [], createdAt: new Date(), updatedAt: new Date() });
  return String(r.insertedId);
}
const T = () => authOf(fx.classTeacher, "TEACHER");

it("C-01 / C-02: a CONCERN and a POSITIVE comment by a current reader each create one prompt (OFFERED); praise gets the helper line", async () => {
  const c1 = await comment(fx.classTeacher, "CONCERN");
  const c2 = await comment(fx.classTeacher, "POSITIVE", "GENERAL", "আজ সে সবাইকে সালাম দিয়েছে");
  expect((await run(OFFER, T(), { c: c1 })).data?.offerSupportSeed).toMatchObject({ offered: true, praise: false, state: "OFFERED" });
  expect((await run(OFFER, T(), { c: c2 })).data?.offerSupportSeed).toMatchObject({ offered: true, praise: true });
  expect(await SupportSeedPrompt.countDocuments({})).toBe(2);
  expect(JSON.stringify(await SupportSeedPrompt.find({}).lean())).not.toMatch(/খাতা|সালাম/); // no text
});

it("C-03: a comment by a non-reader, or by a user without `report`, creates none", async () => {
  const c = await comment(fx.stranger, "CONCERN");
  expect((await run(OFFER, authOf(fx.stranger, "TEACHER"), { c })).data?.offerSupportSeed.offered).toBe(false);
  const c2 = await comment(fx.routineTeacher, "CONCERN");
  const noPerm = await run(OFFER, authOf(fx.routineTeacher, "TEACHER", { revokedPermissions: ["support_profile:report"] }), { c: c2 });
  expect(noPerm.errors !== undefined || noPerm.data?.offerSupportSeed.offered === false).toBe(true);
  expect(await SupportSeedPrompt.countDocuments({ commentId: { $in: [new Types.ObjectId(c), new Types.ObjectId(c2)] } })).toBe(0);
});

it("'এখন লিখুন' creates a COMMENT_SEED draft with the comment text in behaviour, tone from sentiment, other fields empty; a second tap returns the same draft", async () => {
  const c = await comment(fx.classTeacher, "CONCERN");
  await run(OFFER, T(), { c });
  const a = await run(ANSWER, T(), { c, choice: "NOW" });
  expect(a.errors).toBeUndefined();
  expect(a.data?.answerSupportSeed.draft).toMatchObject({ status: "DRAFT", source: "COMMENT_SEED", behaviour: "আজ সে খাতা ছুড়ে ফেলেছে, পরে তুলে নিয়েছে", tone: "CONCERN", situation: "", tried: "" });
  const b = await run(ANSWER, T(), { c, choice: "NOW" });
  expect(b.data?.answerSupportSeed.draft.id).toBe(a.data?.answerSupportSeed.draft.id);
  expect(await SupportReport.countDocuments({ seedCommentId: new Types.ObjectId(c) })).toBe(1);
});

it("C-04: 'পরে' keeps it until the comment day + 7, then the sweep removes it and nothing is notified", async () => {
  const c = await comment(fx.classTeacher, "POSITIVE", "GENERAL", "আজ সে বোর্ড মুছে দিয়েছে");
  await run(OFFER, T(), { c });
  await run(ANSWER, T(), { c, choice: "LATER" });
  const before = await Notification.countDocuments({});
  expect(await sweepSeedPrompts(new Date(Date.now() + 7 * 86_400_000))).toBe(0);
  expect(await sweepSeedPrompts(new Date(Date.now() + 9 * 86_400_000))).toBeGreaterThanOrEqual(1);
  expect(await SupportSeedPrompt.countDocuments({ commentId: new Types.ObjectId(c) })).toBe(0);
  expect(await Notification.countDocuments({})).toBe(before);
});

it("the seeded report is saved as TO_PROCESS like any report (with the good thing) and reaches a profile only through approval", async () => {
  const c = await comment(fx.classTeacher, "CONCERN", "BEHAVIOUR", "আজ সে দুইবার বেঞ্চ থেকে উঠে গেছে");
  await run(OFFER, T(), { c });
  const draftId = (await run(ANSWER, T(), { c, choice: "NOW" })).data?.answerSupportSeed.draft.id;
  const noGood = await run(SUBMIT, T(), { input: reportInput(fx.child, { source: "COMMENT_SEED", seedCommentId: c, goodThingText: "" }), reportId: draftId });
  expect(noGood.errors?.[0].message).toMatch(/ভালো দিক/);
  const ok = await run(SUBMIT, T(), { input: reportInput(fx.child, { source: "COMMENT_SEED", seedCommentId: c, behaviour: "আজ সে দুইবার বেঞ্চ থেকে উঠে গেছে", tone: "CONCERN" }), reportId: draftId });
  expect(ok.data?.submitSupportReport.report.status).toBe("TO_PROCESS");
  expect((await SupportReport.findById(draftId).lean())?.approvedText).toBeNull();
});

it("C-05: a SERIOUS_MATTER comment → the safeguarding question comes first", async () => {
  const c = await comment(fx.classTeacher, "CONCERN", "SERIOUS_MATTER", "আজ সে অনেক কেঁদেছে");
  expect((await run(OFFER, T(), { c })).data?.offerSupportSeed.safeguardingFirst).toBe(true);
});

it("C-06: editing or discarding the comment leaves the report unchanged", async () => {
  const c = await comment(fx.classTeacher, "CONCERN", "BEHAVIOUR", "মূল মন্তব্য");
  await run(OFFER, T(), { c });
  const id = (await run(ANSWER, T(), { c, choice: "NOW" })).data?.answerSupportSeed.draft.id;
  await mongoose.connection.db!.collection("studentcomments").updateOne({ _id: new Types.ObjectId(c) }, { $set: { text: "বদলানো মন্তব্য", discardedAt: new Date() } });
  expect((await SupportReport.findById(id).lean())?.behaviour).toBe("মূল মন্তব্য");
});

it("no comment / guardian-feed / meeting-brief type carries any support field (and each type really exists)", () => {
  const sdl = printSchema(schema);
  const typeBlock = (name: string) => new RegExp(`type ${name} \\{([^}]*)\\}`).exec(sdl)?.[1] ?? "";
  for (const t of ["AuthoredComment", "GuardianStudentComment", "GuardianUnreadComment", "MeetingBrief"]) {
    expect([t, typeBlock(t).length > 0]).toEqual([t, true]);
    expect([t, /support|safeguard/i.test(typeBlock(t))]).toEqual([t, false]);
  }
  void daysAgoKey;
});
