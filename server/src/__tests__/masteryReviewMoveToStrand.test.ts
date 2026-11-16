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
import { assignReviewers, reviewDecide, submitReview, type ReviewCaller, type ReviewDecisionInput } from "../modules/mastery/services/MasteryReviewWriteService";

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

describe("practisedChapters", () => {
  it("derives the sorted unique chapters from exercise refs, ranges and unnumbered markers included", () => {
    expect(practisedChapters(["7/হাতে রাখি/2–4", "3/ক/1", "7/খ/9", "12/খেলা/—"])).toEqual([3, 7, 12]);
    expect(practisedChapters(["SK-VOC/—"])).toEqual([]);
    expect(practisedChapters(null)).toEqual([]);
  });
});
