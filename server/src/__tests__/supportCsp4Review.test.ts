/** CSP-4 review fixes — publish gate (counter citations), E-2/E-5/E-12, atomic publish, text checks, history guards. */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SupportProfileVersion, type SupportItem } from "../modules/support-profile/models/SupportProfileVersion";
import { Notification } from "../modules/notifications/models/Notification";
import { buildCard, reconcileDrafts } from "../modules/support-profile/services/supportVersions";
import { authOf, daysAgoKey, DECIDE, reportInput, runner, seedSupport, SUBMIT, type SupportFx } from "./supportFixtures";

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
const PUBLISH = `mutation($v: String!) { publishSupportVersion(versionId: $v) { id status versionNo } }`;
const HAND = `mutation($s: String!, $items: [SupportHandItemInput!]!) { createHandSupportVersion(studentId: $s, items: $items) { id status versionNo } }`;
const oid = (s: string) => new Types.ObjectId(s);

let slot = 1;
/** An APPROVED (or left waiting) report on its own period so reports never merge. */
const report = async (over: Record<string, unknown> = {}, approve = true, who = fx.classTeacher) => {
  const input = reportInput(fx.child, { periodNo: Math.floor(++slot / 7) % 8 + 1, occurredOn: daysAgoKey(slot % 7), ...over });
  const res = await run(SUBMIT, authOf(who, "TEACHER"), { input });
  if (!res.data?.submitSupportReport) throw new Error(`submit failed: ${res.errors?.[0].message} ${JSON.stringify(input.periodNo)} ${input.occurredOn}`);
  const id = res.data.submitSupportReport.report.id as string;
  if (approve) await run(DECIDE, P(), { id, d: "APPROVED" });
  return id;
};
const item = (itemId: string, textBn: string, over: Partial<SupportItem> = {}): SupportItem => ({
  itemId, textBn, evidence: [], provisionalEvidence: [], counterEvidence: [], sourceKind: "AI", level: "SINGLE", obsCount: 1, teachersCount: 1, settings: [],
  firstEvidenceKey: null, lastEvidenceKey: daysAgoKey(2), hasGuardianInfo: false, mixed: false, ...over,
});
let profileId: Types.ObjectId;
let versionNo = 100;
const draft = async (sections: Record<string, SupportItem[]>, card: Record<string, unknown> = {}) =>
  SupportProfileVersion.create({ profileId, versionNo: ++versionNo, status: "DRAFT", createdBy: fx.principal, sections, card });

beforeAll(async () => {
  // the child's profile exists already? create it lazily
  const p = (await SupportProfile.findOne({ studentId: fx.child })) ?? (await SupportProfile.create({ studentId: fx.child, openedVia: "PRINCIPAL", openedBy: fx.principal, openedAt: new Date() }));
  profileId = p._id;
});

describe("publish gate and reconcile (items 1, 2, 4)", () => {
  it("a counter citation to an unapproved report blocks publishing; once approved it stays a counter citation", async () => {
    const a = await report();
    const waiting = await report({ tone: "CONCERN" }, false);
    const d = await draft({ strengths: [item("s1", "অঙ্কের কাজে সহপাঠীকে সাহায্য করে", { evidence: [oid(a)], counterEvidence: [oid(waiting)] })] });
    expect((await run(PUBLISH, P(), { v: String(d._id) })).errors?.[0].message).toMatch(/অনুমোদন-বাকি/);
    await run(DECIDE, P(), { id: waiting, d: "APPROVED" });
    const after = await SupportProfileVersion.findById(d._id).lean();
    expect(after!.sections.strengths[0].evidence.map(String)).toEqual([a]);
    expect(after!.sections.strengths[0].counterEvidence.map(String)).toEqual([waiting]);
  });

  it("withdrawing or not-using a report removes it from provisional AND counter citations", async () => {
    const a = await report();
    const c = await report({}, false);
    const d = await draft({ strengths: [item("s2", "দলে কাজ শেষ করে", { evidence: [oid(a)], counterEvidence: [oid(c)] })] });
    await run(`mutation($id: String!) { decideSupportReport(reportId: $id, decision: "NOT_USED", reasonBn: "একই ঘটনা") { id } }`, P(), { id: c });
    const after = await SupportProfileVersion.findById(d._id).lean();
    expect(after!.sections.strengths[0].counterEvidence).toEqual([]);
    expect(after!.sections.strengths[0].evidence.map(String)).toEqual([a]);
  });

  it("a lost APPROVED event does not block forever: a provisional id whose report is APPROVED is firm at publish", async () => {
    const a = await report();
    const b = await report();
    const d = await draft({ strengths: [item("s3", "কাজ গুছিয়ে রাখে", { evidence: [oid(a)], provisionalEvidence: [oid(b)] })] });
    const r = await run(PUBLISH, P(), { v: String(d._id) });
    expect(r.errors).toBeUndefined();
    const v = await SupportProfileVersion.findById(d._id).lean();
    expect(v!.sections.strengths[0].evidence.map(String).sort()).toEqual([a, b].sort());
    expect(v!.sections.strengths[0].provisionalEvidence).toEqual([]);
  });

  it("droppedItems counts per draft (no carry-over between drafts)", async () => {
    const a = await report();
    const b = await report();
    const mk = (id: string) => draft({ strengths: [item(`k${id}`, "একটি", { evidence: [], provisionalEvidence: [oid(a)] }), item(`l${id}`, "আরেকটি", { evidence: [oid(b)], provisionalEvidence: [oid(a)] })] });
    const d1 = await mk("1");
    const d2 = await mk("2");
    await run(`mutation($id: String!) { decideSupportReport(reportId: $id, decision: "NOT_USED", reasonBn: "একই") { id } }`, P(), { id: a });
    await reconcileDrafts(oid(a), "REMOVED");
    const [x, y] = await Promise.all([SupportProfileVersion.findById(d1._id).lean(), SupportProfileVersion.findById(d2._id).lean()]);
    expect(x!.droppedItems).toBe(y!.droppedItems);
    expect(x!.droppedItems).toBeLessThanOrEqual(2);
  });
});

describe("E-2, E-5, E-12 and the card (items 3, 7, 10)", () => {
  it("a CONCERN report with no good thing never counts toward a strength at publish (E-2)", async () => {
    const good = await report();
    const concern = await report({ tone: "CONCERN", goodThingText: null, goodThingNone: true, goodThingReasonKey: "SAW_BRIEFLY", behaviour: "কাজ শুরু করতে দেরি করেছে" });
    const d = await draft({ strengths: [item("e2", "কাজে এগিয়ে আসে", { evidence: [oid(concern)] }), item("e2b", "বোর্ড মুছে দেয়", { evidence: [oid(good)] })] });
    expect((await run(PUBLISH, P(), { v: String(d._id) })).errors).toBeUndefined();
    const v = await SupportProfileVersion.findById(d._id).lean();
    expect(v!.sections.strengths.map((i) => i.itemId)).toEqual(["e2b"]);
    expect(v!.droppedItems).toBe(1);
  });

  it("the card keeps strengths only from EMERGING up, and an avoid needs a works item for its 'বরং'", () => {
    const mk = (id: string, level: SupportItem["level"], over: Partial<SupportItem> = {}) => item(id, `বাক্য ${id}`, { level, ...over });
    const sections = {
      strengths: [mk("sa", "SINGLE"), mk("sb", "EMERGING")],
      motivators: [], learning: [], triggers: [], feelings: [], goals: [],
      works: [mk("w1", "ESTABLISHED", { kind: "PREVENT", actionable: { verbFirst: true, observable: true, specific: true, doable: true } })],
      avoid: [mk("a1", "ESTABLISHED", { insteadItemId: "sb" }), mk("a2", "ESTABLISHED", { insteadItemId: "w1" })],
    } as unknown as Parameters<typeof buildCard>[0];
    const c = buildCard(sections, { doItemIds: ["w1"], avoidItemIds: ["a1", "a2"], strengthItemIds: ["sa", "sb"], goalItemId: null });
    expect(c.strengthItemIds).toEqual(["sb"]);
    expect(c.avoidItemIds).toEqual(["a2"]);
  });

  it("a possible reason (functionTag) is dropped at publish unless 3 observations from 2 teachers share it (E-12)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await report({ gotOrAvoided: ["ESCAPE_TASK"] }, true, fx.classTeacher));
    const d = await draft({ strengths: [item("f1", "দলে কাজ শেষ করে", { evidence: ids.map(oid), functionTag: "ESCAPE_TASK" })] });
    await run(PUBLISH, P(), { v: String(d._id) });
    const v = await SupportProfileVersion.findById(d._id).lean();
    expect(v!.sections.strengths[0].functionTag ?? null).toBeNull(); // one teacher only
  });
});

describe("one publish at a time (item 8)", () => {
  it("two concurrent publishes of the same draft: one wins; the profile points at it", async () => {
    const a = await report();
    const d = await draft({ strengths: [item("c1", "দলে সহযোগিতা করে", { evidence: [oid(a)] })] });
    const [x, y] = await Promise.all([run(PUBLISH, P(), { v: String(d._id) }), run(PUBLISH, P(), { v: String(d._id) })]);
    expect([x, y].filter((r) => !r.errors)).toHaveLength(1);
    expect(String((await SupportProfile.findById(profileId).lean())!.currentVersionId)).toBe(String(d._id));
  });

  it("a newer publish makes the previous version non-current, and an OLDER draft can no longer publish", async () => {
    const a = await report();
    const old = await draft({ strengths: [item("o1", "পুরোনো খসড়া", { evidence: [oid(a)] })] });
    const fresh = await draft({ strengths: [item("o2", "নতুন খসড়া", { evidence: [oid(a)] })] });
    const prev = (await SupportProfile.findById(profileId).lean())!.currentVersionId;
    expect((await run(PUBLISH, P(), { v: String(fresh._id) })).errors).toBeUndefined();
    const now = (await SupportProfile.findById(profileId).lean())!.currentVersionId;
    expect(String(now)).toBe(String(fresh._id));
    expect(String(now)).not.toBe(String(prev));
    expect((await run(PUBLISH, P(), { v: String(old._id) })).errors?.[0].message).toMatch(/পুরোনো/);
    expect((await SupportProfileVersion.findById(old._id).lean())!.status).toBe("DRAFT");
  });

  it("the 'profile updated' notice goes out only when the profile is OPEN", async () => {
    await SupportProfile.updateOne({ _id: profileId }, { $set: { status: "CLOSED" } });
    const a = await report();
    const d = await draft({ strengths: [item("n1", "দলে সহযোগিতা করে", { evidence: [oid(a)] })] });
    expect((await run(PUBLISH, P(), { v: String(d._id) })).errors).toBeUndefined();
    expect(await Notification.countDocuments({ dedupeKey: new RegExp(`support-published:${d._id}`) })).toBe(0);
    await SupportProfile.updateOne({ _id: profileId }, { $set: { status: "OPEN" } });
  });
});

describe("Principal-written text (item 6) and hand versions (item 11)", () => {
  it("a roster name, a code or a link in an edit, a hand item, a goal baseline or the change note is refused", async () => {
    const a = await report();
    const d = await draft({ strengths: [item("t1", "দলে সহযোগিতা করে", { evidence: [oid(a)] })] });
    const EDIT = `mutation($v: String!, $i: String!, $t: String) { editSupportDraftItem(versionId: $v, itemId: $i, textBn: $t) { id } }`;
    for (const bad of ["Tanvir Hasan কে সাহায্য করে", "রাফি করিম ভালো করে", "R-004 রিপোর্ট দেখুন", "Selina Akter বলেছেন", "https://x.example"]) {
      expect((await run(EDIT, P(), { v: String(d._id), i: "t1", t: bad })).errors).toBeDefined();
    }
    expect((await run(EDIT, P(), { v: String(d._id), i: "t1", t: "দলে সবাইকে সাহায্য করে" })).errors).toBeUndefined();
    expect((await run(HAND, P(), { s: String(fx.child), items: [{ section: "strengths", textBn: "Habib Rahman দেখেছেন", reportIds: [a] }] })).errors).toBeDefined();
    expect((await run(HAND, P(), { s: String(fx.child), items: [{ section: "goals", textBn: "অপেক্ষা করা শেখা", reportIds: [a], skillKey: "WAIT_TURN", baselineBn: "T-02 বলেছে", expectedBn: "লাইনে দাঁড়ায়" }] })).errors).toBeDefined();
    expect((await run(PUBLISH, P(), { v: String(d._id) })).data?.publishSupportVersion).toBeDefined();
    const d2 = await draft({ strengths: [item("t2", "দলে সহযোগিতা করে", { evidence: [oid(a)] })] });
    expect((await run(`mutation($v: String!) { publishSupportVersion(versionId: $v, changeNoteBn: "R-001 অনুযায়ী") { id } }`, P(), { v: String(d2._id) })).errors).toBeDefined();
  });

  it("a hand item with an unknown kind or skill is refused; an invalid goal progress is refused (not silently NOT_YET)", async () => {
    const a = await report();
    expect((await run(HAND, P(), { s: String(fx.child), items: [{ section: "works", textBn: "কাজ শুরুর আগে বুঝিয়ে বলুন", reportIds: [a], kind: "NOPE" }] })).errors?.[0].message).toMatch(/অজানা/);
    expect((await run(HAND, P(), { s: String(fx.child), items: [{ section: "goals", textBn: "অপেক্ষা", reportIds: [a], skillKey: "NOPE", baselineBn: "ক", expectedBn: "খ" }] })).errors?.[0].message).toMatch(/অজানা/);
    const bad = await run(`mutation($s: String!) { markSupportGoalProgress(studentId: $s, itemId: "x", progress: "BOGUS") }`, P(), { s: String(fx.child) });
    expect(bad.errors?.[0].message).toMatch(/অজানা অগ্রগতি/);
    expect((await run(`mutation($s: String!) { markSupportGoalProgress(studentId: $s, itemId: "x", progress: "MORE") }`, authOf(fx.classTeacher, "TEACHER"), { s: String(fx.child) })).errors).toBeDefined();
  });
});

describe("history resolvers (item 5)", () => {
  const DIFF = `query($s: String!, $a: String!, $b: String!) { supportVersionDiff(studentId: $s, fromVersionId: $a, toVersionId: $b) { added removed } }`;
  it("Office, a guardian and a teacher viewing-as are refused on the version resolvers; a bad id is a clean refusal", async () => {
    const [a, b] = await Promise.all([draft({ strengths: [item("h1", "ক")] }), draft({ strengths: [item("h2", "খ")] })]);
    await SupportProfileVersion.updateMany({ _id: { $in: [a._id, b._id] } }, { $set: { status: "PUBLISHED" } });
    const v = { s: String(fx.child), a: String(a._id), b: String(b._id) };
    expect((await run(DIFF, P(), v)).errors).toBeUndefined();
    for (const who of [authOf(fx.office, "OFFICE"), authOf(new Types.ObjectId(), "GUARDIAN"), authOf(fx.classTeacher, "TEACHER", { impersonatorId: String(fx.classTeacher) })]) {
      expect((await run(DIFF, who, v)).errors).toBeDefined();
      expect((await run(`query($s: String!) { supportVersionsPage(studentId: $s) { total } }`, who, { s: v.s })).errors).toBeDefined();
    }
    const bad = await run(DIFF, P(), { ...v, a: "not-an-id" });
    expect(bad.errors?.[0].message).toMatch(/ভুল আইডি/);
  });

  it("the diff is audited as HISTORY with both version numbers; a DISCARDED draft cannot be compared", async () => {
    const a = await draft({ strengths: [item("h3", "ক")] });
    const b = await draft({ strengths: [item("h4", "খ")] });
    await SupportProfileVersion.updateOne({ _id: a._id }, { $set: { status: "PUBLISHED" } });
    await SupportProfileVersion.updateOne({ _id: b._id }, { $set: { status: "DISCARDED" } });
    const v = { s: String(fx.child), a: String(a._id), b: String(b._id) };
    expect((await run(DIFF, P(), v)).errors?.[0].message).toMatch(/বাতিল/);
    await SupportProfileVersion.updateOne({ _id: b._id }, { $set: { status: "PUBLISHED" } });
    const before = await mongoose.connection.db!.collection("audits").countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED", "meta.versionNos": [a.versionNo, b.versionNo] });
    expect((await run(DIFF, P(), v)).errors).toBeUndefined();
    const after = await mongoose.connection.db!.collection("audits").countDocuments({ eventKind: "SUPPORT_PROFILE_VIEWED", "meta.versionNos": [a.versionNo, b.versionNo], "meta.surface": "HISTORY" });
    expect(after).toBe(before + 1);
  });
});
