/**
 * Objective tree - MOVE_TO_STRAND (owner rule: a skill every lesson practises is a skill-strand row,
 * SK-<NAME>-NN, not a chapter row). The objective and its steps are re-coded together; every field is
 * copied; the old rows read "moved to"; prerequisites follow; a LOCKED citer refuses the move; the
 * Principal may also act on a SUBMITTED round. In-memory MongoDB, real services.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { practisedChapters } from "@scd/shared";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryCatalogueReview } from "../modules/mastery/models/MasteryCatalogueReview";
import { MasteryReviewEvent } from "../modules/mastery/models/MasteryReviewEvent";
import { User } from "../modules/foundation/models/User";
import { importCatalogue } from "../modules/mastery/services/MasteryCatalogueService";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { bankCoverage } from "../modules/mastery/services/MasteryBankCoverageService";
import { loCodeMongoFilterAliased, movedAliases } from "../modules/mastery/bank";
import { planTreeImport } from "../modules/mastery/tree";
import { assignReviewers, reviewDecide, submitReview, type MoveToStrandPlan, type ReviewCaller, type ReviewDecisionInput } from "../modules/mastery/services/MasteryReviewWriteService";

jest.setTimeout(180_000);

const DOCS = path.resolve(__dirname, "../../../docs/mastery/objective-tree");
const TREE_TEXT = fs.readFileSync(path.join(DOCS, "C1_MATH.tree.json"), "utf8");
const DOMAINS_TEXT = fs.readFileSync(path.join(DOCS, "domains/MATH.json"), "utf8");

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
});

interface Who {
  id: string;
  caller: ReviewCaller;
}
let n = 0;
async function makeUser(role: string, name: string, grantedPermissions: string[] = []): Promise<Who> {
  n += 1;
  const u = await User.create({ email: `u${n}@mts.test`, passwordHash: "x", role, name, active: true, grantedPermissions });
  const id = String(u._id);
  return { id, caller: { userId: id, role, canSettings: role === "PRINCIPAL" } };
}

let principal: Who;
let reviewer: Who;
let reviewId: string;

async function setup(): Promise<void> {
  principal = await makeUser("PRINCIPAL", "অধ্যক্ষ");
  reviewer = await makeUser("OFFICE", "পর্যালোচক", ["mastery:review"]);
  const rep = await importCatalogue(TREE_TEXT, true, principal.caller, DOMAINS_TEXT);
  if (!rep.applied) throw new Error(rep.errors.join("; "));
  const round = await MasteryCatalogueReview.findOne({ classToken: "C1", subject: "MATH" }).lean();
  reviewId = String(round!._id);
  await assignReviewers(reviewId, [reviewer.id], principal.caller);
}

const row = (code: string) => MasteryOutcome.findOne({ code }).lean();
const events = () => MasteryReviewEvent.countDocuments({ reviewId: new Types.ObjectId(reviewId) });
const decide = (input: ReviewDecisionInput, who: Who = reviewer) => reviewDecide(reviewId, input, who.caller);

describe("MOVE_TO_STRAND", () => {
  it("a leaf moves: every field copied, legacy code pushed, state kept, old row marked, prereqs re-pointed", async () => {
    await setup();
    await decide({ action: "ACCEPT", code: "LO-C1-MATH-01-01" });
    const old = (await row("LO-C1-MATH-01-01"))!;
    const e0 = await events();
    await decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK-COMP-02" });
    expect((await events()) - e0).toBe(1);
    const mv = (await row("LO-C1-MATH-SK-COMP-02"))!;
    expect(mv).not.toBeNull();
    expect([mv.strand, mv.chapterNumber, mv.level, mv.parentCode, mv.status, mv.reviewState]).toEqual(["COMP", null, "OBJECTIVE", null, "DRAFT", "ACCEPTED"]);
    expect([mv.labelBn, mv.sourceText, mv.assess, mv.homeTipBn, mv.claudeNote, mv.domainCode, mv.tagged]).toEqual([
      old.labelBn, old.sourceText, old.assess, old.homeTipBn, old.claudeNote, old.domainCode, old.tagged,
    ]);
    expect(mv.questionTypeCodes).toEqual(old.questionTypeCodes);
    expect((mv.bookRef as any).exercises).toEqual((old.bookRef as any).exercises);
    expect(mv.legacyCodes).toEqual(expect.arrayContaining([...(old.legacyCodes ?? []), "LO-C1-MATH-01-01"]));
    const gone = (await row("LO-C1-MATH-01-01"))!;
    expect([gone.reviewState, gone.mergedInto, gone.rejectReason]).toEqual(["REJECTED", "LO-C1-MATH-SK-COMP-02", "moved to LO-C1-MATH-SK-COMP-02"]);
    // 01-02 named 01-01 as its earlier step - it now names the strand row.
    const p = (await row("LO-C1-MATH-01-02"))!.prereqCodes ?? [];
    expect(p).toContain("LO-C1-MATH-SK-COMP-02");
    expect(p).not.toContain("LO-C1-MATH-01-01");
  });

  it("a bare strand name takes the next free number; the steps move with their objective", async () => {
    await setup();
    await decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "COMP" });
    expect(await row("LO-C1-MATH-SK-COMP-01")).not.toBeNull();
    const e0 = await events();
    await decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-07-03", strand: "COMP" });
    expect((await events()) - e0).toBe(3); // objective + two steps
    const parent = (await row("LO-C1-MATH-SK-COMP-02"))!;
    const k1 = (await row("LO-C1-MATH-SK-COMP-02.1"))!;
    const k2 = (await row("LO-C1-MATH-SK-COMP-02.2"))!;
    expect([parent.tagged, k1.level, k1.parentCode, k1.strand, k1.chapterNumber, k2.parentCode]).toEqual([false, "SUB", "LO-C1-MATH-SK-COMP-02", "COMP", null, "LO-C1-MATH-SK-COMP-02"]);
    expect((await row("LO-C1-MATH-07-03.1"))!.mergedInto).toBe("LO-C1-MATH-SK-COMP-02.1");
    expect(k1.legacyCodes ?? []).toContain("LO-C1-MATH-07-03.1");
    // a bad name, a row already in a strand, a taken code: refused
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-02", strand: "x" })).rejects.toThrow(/দক্ষতা-ধারার নাম/);
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-SK-COMP-02", strand: "VOC" })).rejects.toThrow(/আগেই দক্ষতা-ধারায়/);
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-02", strand: "SK-COMP-01" })).rejects.toThrow(/আগেই ব্যবহৃত/);
    // a step alone is not movable
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-SK-COMP-02.1", strand: "VOC" })).rejects.toThrow(/নিজে সরে যাবে/);
  });

  it("a LOCKED row citing the code refuses the move; a DRAFT row of a later class is re-pointed", async () => {
    await setup();
    const base = { subject: "MATH", assess: "QUESTION", order: 1, questionTypeCodes: [], level: "OBJECTIVE", tagged: true };
    await MasteryOutcome.create({ ...base, code: "LO-C2-MATH-01-01", classToken: "C2", chapterNumber: 1, labelBn: "ডি", status: "DRAFT", prereqCodes: ["LO-C1-MATH-01-01"] });
    await decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK-COMP-01" });
    expect((await row("LO-C2-MATH-01-01"))!.prereqCodes).toEqual(["LO-C1-MATH-SK-COMP-01"]);
    await MasteryOutcome.create({ ...base, code: "LO-C2-MATH-01-02", classToken: "C2", chapterNumber: 1, labelBn: "এল", status: "LOCKED", prereqCodes: ["LO-C1-MATH-01-02"] });
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-02", strand: "SK-COMP-02" })).rejects.toThrow(/লক করা সারি/);
    expect(await row("LO-C1-MATH-SK-COMP-02")).toBeNull();
  });

  it("OPEN: assigned reviewer or Principal; SUBMITTED: only the Principal; LOCKED: refused", async () => {
    await setup();
    await submitReview(reviewId, reviewer.caller);
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK-COMP-01" }, reviewer)).rejects.toThrow(/জমা হয়ে গেছে/);
    await decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK-COMP-01" }, principal);
    expect(await row("LO-C1-MATH-SK-COMP-01")).not.toBeNull();
    // other actions still need OPEN, even for the Principal
    await expect(decide({ action: "ACCEPT", code: "LO-C1-MATH-01-02" }, principal)).rejects.toThrow(/জমা হয়ে গেছে/);
    await MasteryCatalogueReview.updateOne({ _id: reviewId }, { $set: { state: "LOCKED" } });
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-02", strand: "SK-COMP-02" }, principal)).rejects.toThrow(/চূড়ান্ত/);
  });
});

describe("MOVE_TO_STRAND - safety", () => {
  const base = { subject: "MATH", assess: "QUESTION", order: 1, questionTypeCodes: [], level: "OBJECTIVE", tagged: true };

  it("the same move twice says it was already moved; steps copy their own fields; a superseded round is refused", async () => {
    await setup();
    await decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-07-03", strand: "SK-COMP-01" }, principal);
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-07-03", strand: "SK-COMP-02" }, principal)).rejects.toThrow(/আগেই .* সরানো হয়েছে/);
    for (const k of [1, 2]) {
      const old = (await row(`LO-C1-MATH-07-03.${k}`))!;
      const mv = (await row(`LO-C1-MATH-SK-COMP-01.${k}`))!;
      expect([mv.labelBn, mv.assess, mv.tagged, mv.domainCode, mv.reviewState, mv.status]).toEqual([old.labelBn, old.assess, old.tagged, old.domainCode, "PROPOSED", "DRAFT"]);
      expect(mv.questionTypeCodes).toEqual(old.questionTypeCodes);
      expect((mv.bookRef as any).exercises).toEqual((old.bookRef as any).exercises);
      expect(mv.legacyCodes).toContain(old.code);
    }
    await MasteryCatalogueReview.updateOne({ _id: reviewId }, { $set: { state: "SUPERSEDED" } });
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK-COMP-02" }, principal)).rejects.toThrow(/আর চালু নেই/);
  });

  it("strand name: SK alone and number 00 are refused", async () => {
    await setup();
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK" })).rejects.toThrow(/দক্ষতা-ধারার নাম/);
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK-COMP-00" })).rejects.toThrow(/০১ বা তার বেশি/);
  });

  it("a LOCKED citer in BAN2 refuses the move", async () => {
    await setup();
    await MasteryOutcome.create({ ...base, subject: "BAN2", code: "LO-C1-BAN2-01-01", classToken: "C1", chapterNumber: 1, labelBn: "বা", status: "LOCKED", prereqCodes: ["LO-C1-MATH-01-01"] });
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK-COMP-01" })).rejects.toThrow(/LO-C1-BAN2-01-01/);
  });

  it("dryRun reports the plan and writes nothing (locked citers are reported, not thrown)", async () => {
    await setup();
    await MasteryOutcome.create({ ...base, code: "LO-C2-MATH-01-01", classToken: "C2", chapterNumber: 1, labelBn: "ডি", status: "DRAFT", prereqCodes: ["LO-C1-MATH-01-01"] });
    await MasteryOutcome.create({ ...base, code: "LO-C2-MATH-01-02", classToken: "C2", chapterNumber: 1, labelBn: "এল", status: "LOCKED", prereqCodes: ["LO-C1-MATH-01-01"] });
    await ContentArtifact.create({
      docType: "question", subject: "MATH", classLevel: 1, address: { anchorWord: "অধ্যায়", number: 1 }, curationTag: "KEEP_AS_IS", current: true,
      importedBy: new Types.ObjectId(), reviewStatus: "gold",
      envelopeJson: { tags: { topic_tag: "LO-C1-MATH-01-01", lo_codes: ["LO-C1-MATH-01-01"] }, payload: { qid: "Q1" } },
    });
    const rowsBefore = await MasteryOutcome.countDocuments({});
    const e0 = await events();
    const plan = (await reviewDecide(reviewId, { action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK-COMP-01", dryRun: true }, reviewer.caller)) as MoveToStrandPlan;
    expect(plan.dryRun).toBe(true);
    expect(plan.pairs).toEqual([{ from: "LO-C1-MATH-01-01", to: "LO-C1-MATH-SK-COMP-01" }]);
    expect(plan.lockedCiters).toEqual(["LO-C2-MATH-01-02"]);
    expect(plan.outsidePrereqRewritten).toEqual([{ code: "LO-C2-MATH-01-01", from: ["LO-C1-MATH-01-01"], to: ["LO-C1-MATH-SK-COMP-01"] }]);
    expect(plan.prereqRewritten).toContain("LO-C1-MATH-01-02");
    expect(plan.outsideReferences.questions).toBe(1);
    expect(await MasteryOutcome.countDocuments({})).toBe(rowsBefore);
    expect(await events()).toBe(e0);
    expect((await row("LO-C1-MATH-01-01"))!.mergedInto).toBeUndefined();
    expect((await row("LO-C2-MATH-01-01"))!.prereqCodes).toEqual(["LO-C1-MATH-01-01"]);
  });

  it("the MOVE event records the outside prerequisite rewrites and reference counts", async () => {
    await setup();
    await MasteryOutcome.create({ ...base, code: "LO-C2-MATH-01-01", classToken: "C2", chapterNumber: 1, labelBn: "ডি", status: "DRAFT", prereqCodes: ["LO-C1-MATH-01-01"] });
    await decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK-COMP-01" });
    const ev = await MasteryReviewEvent.findOne({ code: "LO-C1-MATH-01-01", action: "MOVE" }).lean();
    expect((ev!.after as any).outsidePrereqRewritten).toEqual([{ code: "LO-C2-MATH-01-01", from: ["LO-C1-MATH-01-01"], to: ["LO-C1-MATH-SK-COMP-01"] }]);
    expect((ev!.after as any).outsideReferences).toEqual({ questions: 0, sessionPlans: 0, lessonDeliveries: 0, evidence: 0 });
  });

  it("a failure after the write puts everything back (rows, old state, outside prerequisites)", async () => {
    await setup();
    await MasteryOutcome.create({ ...base, code: "LO-C2-MATH-01-01", classToken: "C2", chapterNumber: 1, labelBn: "ডি", status: "DRAFT", prereqCodes: ["LO-C1-MATH-07-03"] });
    const orig = MasteryOutcome.updateOne.bind(MasteryOutcome);
    const spy = jest.spyOn(MasteryOutcome, "updateOne").mockImplementation(((...args: any[]) => {
      if (args[0]?.code === "LO-C2-MATH-01-01" && args[0]?.prereqCodes) throw new Error("injected failure");
      return (orig as any)(...args);
    }) as any);
    await expect(decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-07-03", strand: "SK-COMP-01" })).rejects.toThrow(/injected failure/);
    spy.mockRestore();
    expect(await MasteryOutcome.countDocuments({ code: /^LO-C1-MATH-SK-COMP-/ })).toBe(0);
    for (const c of ["LO-C1-MATH-07-03", "LO-C1-MATH-07-03.1", "LO-C1-MATH-07-03.2"]) {
      const o = (await row(c))!;
      expect([o.mergedInto, o.rejectReason, o.reviewState]).toEqual([undefined, undefined, "PROPOSED"]);
    }
    expect((await row("LO-C2-MATH-01-01"))!.prereqCodes).toEqual(["LO-C1-MATH-07-03"]);
  });

  it("the read side aliases the old code: a question tagged with it counts for the new row, in coverage and in the loCodes filter", async () => {
    await setup();
    await ContentArtifact.create({
      docType: "question", subject: "MATH", classLevel: 1, address: { anchorWord: "অধ্যায়", number: 7 }, curationTag: "KEEP_AS_IS", current: true,
      importedBy: new Types.ObjectId(), reviewStatus: "gold",
      envelopeJson: { tags: { topic_tag: "LO-C1-MATH-07-02", lo_codes: ["LO-C1-MATH-07-02"] }, payload: { qid: "QP-MATH-C1-U07-Q03" } },
    });
    await decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-07-02", strand: "SK-COMP-01" });
    const al = await movedAliases(["LO-C1-MATH-SK-COMP-01"]);
    expect([...al.all].sort()).toEqual(["LO-C1-MATH-07-02", "LO-C1-MATH-SK-COMP-01"]);
    expect(al.canon("LO-C1-MATH-07-02")).toBe("LO-C1-MATH-SK-COMP-01");
    const found = await ContentArtifact.find({ docType: "question", ...(await loCodeMongoFilterAliased(["LO-C1-MATH-SK-COMP-01"])) }).lean();
    expect(found).toHaveLength(1);
    const v = await bankCoverage("C1", "MATH");
    expect(v.rows.find((r) => r.code === "LO-C1-MATH-SK-COMP-01")).toMatchObject({ goldCount: 1 });
    expect(v.rows.find((r) => r.code === "LO-C1-MATH-07-02")).toBeUndefined();
  });

  it("a tree import refuses a file node whose row was moved to a strand", async () => {
    await setup();
    await decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK-COMP-01" });
    const tree = JSON.parse(TREE_TEXT);
    const existing = (await MasteryOutcome.find({ classToken: "C1", subject: "MATH" }).lean()) as any[];
    const plan = planTreeImport(tree, existing, null);
    expect(plan.errors.join("\n")).toMatch(/LO-C1-MATH-01-01: .*LO-C1-MATH-SK-COMP-01/);
  });

  it("the unmapped resolution that named a moved code follows it", async () => {
    await setup();
    await MasteryCatalogueReview.updateOne(
      { _id: reviewId },
      { $push: { "coverage.unmapped": { ref: "1/ক/9", text: "বাড়তি", reason: "t", resolution: "MAPPED", resolvedCode: "LO-C1-MATH-01-01" } } },
    );
    await decide({ action: "MOVE_TO_STRAND", code: "LO-C1-MATH-01-01", strand: "SK-COMP-01" });
    const r = await MasteryCatalogueReview.findById(reviewId).lean();
    expect(r!.coverage.unmapped.find((u: any) => u.ref === "1/ক/9")!.resolvedCode).toBe("LO-C1-MATH-SK-COMP-01");
  });
});

describe("practisedChapters", () => {
  it("derives the sorted unique chapters from exercise refs, ranges and unnumbered markers included", () => {
    expect(practisedChapters(["7/হাতে রাখি/2–4", "3/ক/1", "7/খ/9", "12/খেলা/—"])).toEqual([3, 7, 12]);
    expect(practisedChapters(["SK-VOC/—"])).toEqual([]);
    expect(practisedChapters(null)).toEqual([]);
  });
});
