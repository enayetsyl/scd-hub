/** CSP-4 — the card (docs/prd-child-support-profile.md §16.7, NORMATIVE; E-8, E-9; D-#1557, D-#1563). */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import "../registerResolvers";
import { builder } from "../schema";
import { buildCard } from "../modules/support-profile/services/supportVersions";
import { SupportProfile } from "../modules/support-profile/models/SupportProfile";
import { SupportProfileVersion, type SupportItem } from "../modules/support-profile/models/SupportProfileVersion";
import { SUPPORT_SECTIONS, type SupportSection } from "@scd/shared";
import { authOf, daysAgoKey, runner, seedSupport, VIEW, type SupportFx } from "./supportFixtures";

const OK = { verbFirst: true, observable: true, specific: true, doable: true };
const it_ = (id: string, over: Partial<SupportItem> = {}): SupportItem => ({
  itemId: id, textBn: "কাজ শুরুর আগে আলাদা করে এক লাইনে বুঝিয়ে দিন", evidence: [], provisionalEvidence: [], counterEvidence: [], sourceKind: "AI",
  level: "ESTABLISHED", obsCount: 3, teachersCount: 2, settings: ["MATH"], firstEvidenceKey: null, lastEvidenceKey: daysAgoKey(5), hasGuardianInfo: false, mixed: false,
  kind: "PREVENT", actionable: OK, ...over,
});
const sections = (over: Partial<Record<SupportSection, SupportItem[]>>) => Object.fromEntries(SUPPORT_SECTIONS.map((s) => [s, over[s] ?? []])) as Record<SupportSection, SupportItem[]>;

describe("card building (§16.7.2)", () => {
  it("a do failing any actionable check or longer than 90 characters stays off the card", () => {
    const works = [it_("a"), it_("b", { actionable: { ...OK, doable: false } }), it_("c", { textBn: "ক".repeat(91) })];
    expect(buildCard(sections({ works }), { doItemIds: ["a", "b", "c"], avoidItemIds: [], strengthItemIds: [], goalItemId: null }).doItemIds).toEqual(["a"]);
  });
  it("do's are ordered PREVENT → TEACH → RESPOND → STRENGTHEN, established before leads; at most 2 leads, only when < 3 established", () => {
    const works = [it_("s", { kind: "STRENGTHEN" }), it_("r", { kind: "RESPOND" }), it_("p", { kind: "PREVENT" }), it_("l1", { level: "SINGLE", kind: "PREVENT" }), it_("l2", { level: "EMERGING", kind: "TEACH" }), it_("l3", { level: "SINGLE", kind: "RESPOND" })];
    const twoEst = buildCard(sections({ works: works.filter((w) => w.itemId !== "s") }), { doItemIds: ["r", "p", "l1", "l2", "l3"], avoidItemIds: [], strengthItemIds: [], goalItemId: null });
    // leads chosen EMERGING before SINGLE (l2, then l1 by proposal order), then shown in kind order
    expect(twoEst.doItemIds).toEqual(["p", "r", "l1", "l2"]);
    const threeEst = buildCard(sections({ works }), { doItemIds: ["s", "r", "p", "l1", "l2"], avoidItemIds: [], strengthItemIds: [], goalItemId: null });
    expect(threeEst.doItemIds).toEqual(["p", "r", "s"]);
  });
  it("every card avoid has its 'বরং' (insteadOfItem); a mixed item never reaches the card", () => {
    const works = [it_("do1")];
    const avoid = [it_("av1", { insteadItemId: "do1", kind: null, actionable: null }), it_("av2", { insteadItemId: null, kind: null, actionable: null })];
    const c = buildCard(sections({ works, avoid }), { doItemIds: ["do1"], avoidItemIds: ["av1", "av2"], strengthItemIds: [], goalItemId: null });
    expect(c.avoidItemIds).toEqual(["av1"]);
    expect(buildCard(sections({ works: [it_("m", { mixed: true })] }), { doItemIds: ["m"], avoidItemIds: [], strengthItemIds: [], goalItemId: null }).doItemIds).toEqual([]);
  });
});

describe("read-time rules", () => {
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
  const card = async () => (await run(`query($s: String!) { supportProfileView(studentId: $s, surface: "FULL", via: "ROUTINE") { card { dos { itemId } avoids { itemId insteadText } strengths { itemId } } sections { section items { itemId stale dormant } } } }`, authOf(fx.classTeacher, "TEACHER"), { s: String(fx.child) })).data?.supportProfileView;

  it("a concern item with no evidence in 120 days and a positive item with none in 180 days are absent from the card, still in the profile — no new version", async () => {
    const p = await SupportProfile.create({ studentId: fx.child, openedVia: "PRINCIPAL", openedBy: fx.principal, openedAt: new Date() });
    const v = await SupportProfileVersion.create({
      profileId: p._id, versionNo: 1, status: "PUBLISHED", createdBy: fx.principal,
      sections: {
        strengths: [it_("st", { kind: null, lastEvidenceKey: daysAgoKey(10) }), it_("old", { kind: null, lastEvidenceKey: daysAgoKey(190) })],
        works: [it_("do1", { lastEvidenceKey: daysAgoKey(10) })],
        avoid: [it_("av1", { insteadItemId: "do1", lastEvidenceKey: daysAgoKey(130), kind: null }), it_("av2", { insteadItemId: "do1", lastEvidenceKey: daysAgoKey(20), kind: null })],
      },
      card: { doItemIds: ["do1"], avoidItemIds: ["av1", "av2"], strengthItemIds: ["st", "old"], goalItemId: null },
    });
    p.currentVersionId = v._id;
    await p.save();
    const view = await card();
    expect(view.card.strengths.map((x: { itemId: string }) => x.itemId)).toEqual(["st"]);
    expect(view.card.avoids.map((x: { itemId: string; insteadText: string }) => [x.itemId, x.insteadText])).toEqual([["av2", it_("do1").textBn]]);
    const avoidSec = view.sections.find((s: { section: string }) => s.section === "avoid").items;
    expect(avoidSec.find((i: { itemId: string }) => i.itemId === "av1").stale).toBe(true);
  });

  it("after a year cut-over a concern item with only last-year evidence is dormant (off the card); one new approved observation restores it", async () => {
    // the fixture year started 60 days ago
    const v = await SupportProfileVersion.findOne({ status: "PUBLISHED" });
    v!.sections.avoid = [it_("av2", { insteadItemId: "do1", lastEvidenceKey: daysAgoKey(70), kind: null })];
    v!.markModified("sections");
    await v!.save();
    let view = await card();
    expect(view.card.avoids).toEqual([]);
    expect(view.sections.find((s: { section: string }) => s.section === "avoid").items[0].dormant).toBe(true);
    v!.sections.avoid = [it_("av2", { insteadItemId: "do1", lastEvidenceKey: daysAgoKey(3), kind: null })];
    v!.markModified("sections");
    await v!.save();
    view = await card();
    expect(view.card.avoids.map((x: { itemId: string }) => x.itemId)).toEqual(["av2"]);
  });
});
