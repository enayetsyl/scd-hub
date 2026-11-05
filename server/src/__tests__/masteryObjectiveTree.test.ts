/**
 * Objective tree OT-1 (docs/prd-objective-tree.md §5, §6, §9, §10 items 1, 2, 7-partial, 12).
 *
 * Invariants — checkTreeInvariants (shared/objectiveTree.ts), the ONE function the verifier, the
 *              import and (OT-2) review writes share: the real C1 Math draft passes; each broken
 *              rule is named; REVIEW mode tolerates numbering gaps, FILE mode does not.
 * Import     — the real C1_MATH.tree.json: preview writes nothing; apply creates DRAFT/PROPOSED rows,
 *              the domains and ONE OPEN round with the file's coverage; an unchanged re-import is a
 *              no-op; one changed label returns only that row to PROPOSED; a dropped row is REJECTED
 *              "removed in redraft"; a broken file is refused with the rule named; over a LOCKED
 *              catalogue only label-level edits apply, new rows open round 2, a gone code RETIRES.
 * Guards     — the old one-tap lock, a DRAFT tree-row delete and a flat file over a tree are refused.
 * Switch     — a pair with review rounds cannot switch on until one round is LOCKED; a flat locked
 *              catalogue (no round, the dev C3 seed shape) still can.
 * Labels     — level names default ক্ষেত্র / শিখনফল / উপ-শিখনফল, edit on the SCHOOL row, read by the
 *              one server helper; a policy save keeps them.
 * Permission — mastery:review (per-person grant) reads the round; it does not import; teacher/office
 *              without it are refused.
 *
 * In-memory MongoDB, real services.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { graphql, type ExecutionResult } from "graphql";
import { checkTreeInvariants, expandExerciseRef, marksFromBn, readDomainsFile, readTreeFile, type TreeFile } from "@scd/shared";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryDomain } from "../modules/mastery/models/MasteryDomain";
import { MasteryCatalogueReview } from "../modules/mastery/models/MasteryCatalogueReview";
import { MasteryReviewEvent } from "../modules/mastery/models/MasteryReviewEvent";
import { MasteryQuestionType } from "../modules/mastery/models/MasteryQuestionType";
import {
  getCatalogue,
  getLevelLabels,
  importCatalogue,
  lockCatalogue,
  retireOutcome,
  saveLevelLabels,
  savePolicy,
  setEnablement,
} from "../modules/mastery/services/MasteryCatalogueService";
import { getReviewRound, masteryLevelLabels } from "../modules/mastery/services/MasteryReviewService";
import { masteryImportWarnings } from "../modules/mastery/bank";
import { builder } from "../schema";
import "../modules/mastery/resolvers/masteryCatalogue";

jest.setTimeout(180_000);

const DOCS = path.resolve(__dirname, "../../../docs/mastery/objective-tree");
const TREE_TEXT = fs.readFileSync(path.join(DOCS, "C1_MATH.tree.json"), "utf8");
const DOMAINS_TEXT = fs.readFileSync(path.join(DOCS, "domains/MATH.json"), "utf8");
const freshTree = (): Record<string, any> => JSON.parse(TREE_TEXT);

let mongo: MongoMemoryServer;
const actor = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };

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

const readTree = (raw: unknown): TreeFile => {
  const r = readTreeFile(raw);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.tree;
};
const domainCodes = (): string[] => {
  const d = readDomainsFile(JSON.parse(DOMAINS_TEXT));
  if (!d.ok) throw new Error(d.errors.join("; "));
  return d.domains.domains.map((x) => x.code);
};
const fileCheck = (raw: unknown) => {
  const t = readTree(raw);
  return checkTreeInvariants({
    classToken: t.classToken,
    subject: t.subject,
    nodes: t.nodes,
    domainCodes: domainCodes(),
    mode: "FILE",
    questionTypeCodes: t.questionTypes.map((q) => q.code),
    coverage: t.coverage,
  });
};
const rules = (vs: { rule: string }[]) => [...new Set(vs.map((v) => v.rule))].sort();

/** Keep coverage honest after a test edits nodes: refs nobody cites any more become unmapped. */
function recomputeCoverage(t: Record<string, any>): void {
  const all = new Set<string>();
  for (const n of freshTree().nodes) for (const r of n.bookRef.exercises) for (const x of expandExerciseRef(r)) all.add(x);
  const cited = new Set<string>();
  for (const n of t.nodes) for (const r of n.bookRef.exercises) for (const x of expandExerciseRef(r)) cited.add(x);
  const dropped = [...all].filter((x) => !cited.has(x));
  t.coverage.mapped = cited.size;
  t.coverage.unmapped = [...t.coverage.unmapped, ...dropped.map((ref) => ({ ref, text: "", reason: "test: row dropped" }))];
  t.coverage.exercisesTotal = t.coverage.mapped + t.coverage.unmapped.length;
}

/** A tagged objective with no children that no other row names as a prerequisite. */
function droppableLeaf(t: Record<string, any>): string {
  const prereqd = new Set(t.nodes.flatMap((n: any) => n.prereqCodes));
  const parents = new Set(t.nodes.map((n: any) => n.parentCode).filter(Boolean));
  const leaf = t.nodes.find((n: any) => n.level === "OBJECTIVE" && n.tagged && !n.strand && !parents.has(n.code) && !prereqd.has(n.code));
  return leaf.code;
}

const importTree = (tree: unknown, apply: boolean, withDomains = true) =>
  importCatalogue(typeof tree === "string" ? tree : JSON.stringify(tree), apply, actor, withDomains ? DOMAINS_TEXT : null);

/** Stand-in for the OT-2 lock: round LOCKED, every non-rejected DRAFT row LOCKED. */
async function simulateLock(classToken = "C1", subject = "MATH"): Promise<void> {
  await MasteryCatalogueReview.updateMany({ classToken, subject, state: "OPEN" }, { $set: { state: "LOCKED", lockedAt: new Date() } });
  await MasteryOutcome.updateMany(
    { classToken, subject, status: "DRAFT", reviewState: { $ne: "REJECTED" } },
    { $set: { status: "LOCKED", lockedAt: new Date() } },
  );
}

// ---------------------------------------------------------------------------

describe("checkTreeInvariants (pure, shared)", () => {
  it("the real C1 Math draft passes every FILE rule", () => {
    expect(fileCheck(freshTree())).toEqual([]);
  });

  it("names each broken rule", () => {
    const t = freshTree();
    // One child only: drop every child of the first split objective but .1.
    const split = t.nodes.find((n: any) => n.level === "SUB").parentCode;
    t.nodes = t.nodes.filter((n: any) => n.parentCode !== split || n.code === `${split}.1`);
    for (const n of t.nodes) n.prereqCodes = n.prereqCodes.filter((p: string) => t.nodes.some((m: any) => m.code === p));
    // Tagged parent of another split; unknown domain; a cycle; a banned word; a sub with a home tip.
    const other = t.nodes.find((n: any) => n.level === "SUB" && n.parentCode !== split).parentCode;
    t.nodes.find((n: any) => n.code === other).tagged = true;
    t.nodes[0].domainCode = "DOM-MATH-NOPE";
    const [a, b] = t.nodes.filter((n: any) => n.level === "OBJECTIVE" && n.tagged && !n.strand);
    a.prereqCodes = [b.code];
    b.prereqCodes = [a.code];
    a.labelBn = `${a.labelBn} গাণিতিক বাক্য`;
    t.nodes.find((n: any) => n.level === "SUB").homeTipBn = "x";
    const got = rules(fileCheck(t));
    for (const r of ["SINGLE_CHILD", "TAGGED_IFF_LEAF", "SUB_PARENT", "DOMAIN_RESOLVES", "PREREQ_CYCLE", "BANNED_TERM", "HOME_TIP", "COVERAGE"]) {
      expect(got).toContain(r);
    }
  });

  it("codes must carry the tree's class and subject; a SUB needs .N; a tagged row cites an exercise", () => {
    const t = freshTree();
    const obj = t.nodes.find((n: any) => n.level === "OBJECTIVE" && n.tagged && !n.strand);
    obj.code = obj.code.replace("LO-C1-", "LO-C2-");
    const sub = t.nodes.find((n: any) => n.level === "SUB");
    sub.bookRef.exercises = [];
    expect(rules(fileCheck(t))).toEqual(expect.arrayContaining(["CODE_PATTERN", "TAGGED_CITES_EXERCISE"]));
  });

  it("REVIEW mode tolerates a gap in child numbering (a rejected .2); FILE mode does not", () => {
    const t = readTree(freshTree());
    // A split with 3+ children, so dropping .2 leaves two (no single-child violation).
    const parent = t.nodes.find((p) => p.level === "OBJECTIVE" && t.nodes.filter((n) => n.parentCode === p.code).length >= 3)!.code;
    const nodes = t.nodes.filter((n) => n.code !== `${parent}.2`).map((n) => ({ ...n, prereqCodes: n.prereqCodes.filter((p) => p !== `${parent}.2`) }));
    const base = { classToken: "C1", subject: "MATH", nodes, domainCodes: domainCodes() };
    expect(rules(checkTreeInvariants({ ...base, mode: "REVIEW" }))).toEqual([]);
    expect(rules(checkTreeInvariants({ ...base, mode: "FILE", questionTypeCodes: t.questionTypes.map((q) => q.code), coverage: null }))).toContain("CHILD_NUMBERING");
  });

  it("a prerequisite may name an earlier class's live code, never a later class's", () => {
    const t = readTree(freshTree());
    const n = t.nodes.find((x) => x.tagged)!;
    const run = (pre: string, external: string[]) =>
      rules(checkTreeInvariants({ classToken: "C1", subject: "MATH", nodes: t.nodes.map((x) => (x === n ? { ...x, prereqCodes: [pre] } : x)), domainCodes: domainCodes(), mode: "REVIEW", externalCodes: external }));
    expect(run("LO-KG-MATH-01-01", ["LO-KG-MATH-01-01"])).toEqual([]);
    expect(run("LO-C2-MATH-01-01", ["LO-C2-MATH-01-01"])).toEqual(["PREREQ_RESOLVES"]);
    expect(run("LO-KG-MATH-01-01", [])).toEqual(["PREREQ_RESOLVES"]);
  });

  it("'গাণিতিক বাক্য' is banned in labels up to Class 3 and allowed from Class 4 (D-#974)", () => {
    const withTerm = (file: string) => {
      const t = JSON.parse(fs.readFileSync(path.join(DOCS, file), "utf8"));
      const n = t.nodes.find((x: any) => x.level === "OBJECTIVE");
      n.labelBn = `${n.labelBn} — গাণিতিক বাক্য`;
      return rules(fileCheck(t));
    };
    expect(withTerm("C1_MATH.tree.json")).toContain("BANNED_TERM");
    expect(withTerm("C3_MATH.tree.json")).toContain("BANNED_TERM");
    expect(withTerm("C4_MATH.tree.json")).not.toContain("BANNED_TERM");
  });

  it("marksFromBn reads the book's mark column", () => {
    expect(marksFromBn("১")).toBe(1);
    expect(marksFromBn("২ (প্রতি সারি)")).toBe(2);
    expect(marksFromBn("১½")).toBe(1.5);
    expect(marksFromBn("অর্ধবার্ষিক ৫; বার্ষিক ৩")).toBeNull();
    expect(marksFromBn("— (লিখিত নম্বর নেই)")).toBeNull();
  });
});

describe("tree import (DB, the real C1 Math file)", () => {
  it("preview writes nothing and shows counts per level, coverage, flags and the round it would open", async () => {
    const r = await importTree(TREE_TEXT, false);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.tree!.counts).toEqual({ domains: 16, objectives: 28, subs: 42, strands: 3, tagged: 57, grouping: 16 });
    expect(r.tree!.coverage.exercisesTotal).toBe(164);
    expect(r.tree!.coverage.mapped).toBe(164);
    expect(r.tree!.flags.length).toBe(freshTree().flags.length);
    expect(r.tree!.round).toEqual({ action: "OPEN_NEW", round: 1 });
    expect(r.tree!.domains.added.length).toBe(16);
    expect(r.diff!.added.length).toBe(73);
    expect(await MasteryOutcome.countDocuments({})).toBe(0);
    expect(await MasteryCatalogueReview.countDocuments({})).toBe(0);
    expect(await MasteryDomain.countDocuments({})).toBe(0);
  });

  it("apply: DRAFT rows PROPOSED with the tree fields, the domains, ONE OPEN round with the file's coverage", async () => {
    const r = await importTree(TREE_TEXT, true);
    expect(r.applied).toBe(true);
    expect(await MasteryOutcome.countDocuments({ classToken: "C1", subject: "MATH", status: "DRAFT", reviewState: "PROPOSED" })).toBe(73);
    expect(await MasteryDomain.countDocuments({ subject: "MATH", status: "DRAFT" })).toBe(16);
    const rounds = await MasteryCatalogueReview.find({}).lean();
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ classToken: "C1", subject: "MATH", round: 1, state: "OPEN" });
    expect(rounds[0].coverage.exercisesTotal).toBe(164);
    expect(rounds[0].flags.length).toBe(freshTree().flags.length);
    expect(await MasteryReviewEvent.countDocuments({ reviewId: rounds[0]._id, action: "IMPORT" })).toBe(1);

    const sub = await MasteryOutcome.findOne({ level: "SUB" }).lean();
    expect(sub!.parentCode).toBeTruthy();
    expect(sub!.tagged).toBe(true);
    expect(sub!.draftHash).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof sub!.bookRef).toBe("object");
    const cat = await getCatalogue("C1", "MATH");
    const parent = cat.outcomes.find((o) => o.code === sub!.parentCode)!;
    expect(parent).toMatchObject({ level: "OBJECTIVE", tagged: false, reviewState: "PROPOSED" });
    expect(parent.bookRef.version).toBe("C1_MATH_Student_Print_v1_5");
    expect((await MasteryQuestionType.findOne({ classToken: "C1", subject: "MATH", code: "QT-ORDER" }).lean())!.marks).toBe(2);
    expect((await MasteryQuestionType.findOne({ classToken: "C1", subject: "MATH", code: "QT-WORD" }).lean())!.marks).toBeNull();

    const view = await getReviewRound("C1", "MATH");
    expect(view!.stateCounts.find((s) => s.state === "PROPOSED")!.count).toBe(73);
  });

  it("re-importing an unchanged file is a no-op", async () => {
    await importTree(TREE_TEXT, true);
    const before = await MasteryOutcome.find({}).select("code updatedAt").lean();
    const events = await MasteryReviewEvent.countDocuments({});
    const preview = await importTree(TREE_TEXT, false, false); // the domains already held are used
    expect(preview.ok).toBe(true);
    expect(preview.tree!.noop).toBe(true);
    const again = await importTree(TREE_TEXT, true);
    expect(again.applied).toBe(true);
    expect(again.tree!.noop).toBe(true);
    const after = await MasteryOutcome.find({}).select("code updatedAt").lean();
    expect(after.map((o) => [o.code, o.updatedAt.getTime()]).sort()).toEqual(before.map((o) => [o.code, o.updatedAt.getTime()]).sort());
    expect(await MasteryReviewEvent.countDocuments({})).toBe(events);
    expect(await MasteryCatalogueReview.countDocuments({})).toBe(1);
  });

  it("one changed label returns only that row to PROPOSED; every other decision stays", async () => {
    await importTree(TREE_TEXT, true);
    await MasteryOutcome.updateMany({}, { $set: { reviewState: "ACCEPTED" } }); // stand-in for OT-2 decisions
    const t = freshTree();
    const target = t.nodes[5];
    target.labelBn = `${target.labelBn} (নতুন খসড়া)`;
    const r = await importTree(t, true);
    expect(r.tree!.round).toEqual({ action: "REDRAFT", round: 1 });
    expect(r.tree!.review.backToProposed).toEqual([target.code]);
    expect(await MasteryOutcome.countDocuments({ reviewState: "PROPOSED" })).toBe(1);
    expect((await MasteryOutcome.findOne({ code: target.code }).lean())!.labelBn).toBe(target.labelBn);
    expect(await MasteryOutcome.countDocuments({ reviewState: "ACCEPTED" })).toBe(72);
    const ev = await MasteryReviewEvent.find({ code: target.code }).lean();
    expect(ev).toHaveLength(1);
    expect(ev[0].after).toMatchObject({ reviewState: "PROPOSED" });
    expect((ev[0].before as any).reviewState).toBe("ACCEPTED");
  });

  it("a row gone from the redraft is REJECTED 'removed in redraft', never deleted", async () => {
    await importTree(TREE_TEXT, true);
    const t = freshTree();
    const gone = droppableLeaf(t);
    t.nodes = t.nodes.filter((n: any) => n.code !== gone);
    recomputeCoverage(t);
    const r = await importTree(t, true);
    expect(r.errors).toEqual([]);
    expect(r.tree!.review.removedInRedraft).toEqual([gone]);
    const row = await MasteryOutcome.findOne({ code: gone }).lean();
    expect(row).toMatchObject({ status: "DRAFT", reviewState: "REJECTED", rejectReason: "removed in redraft" });
    // It coming back restores it to PROPOSED.
    const back = await importTree(TREE_TEXT, true);
    expect(back.tree!.review.backToProposed).toEqual([gone]);
    expect((await MasteryOutcome.findOne({ code: gone }).lean())!.reviewState).toBe("PROPOSED");
  });

  it("a file failing a structural rule is refused with the rule and code named; nothing written", async () => {
    const t = freshTree();
    const split = t.nodes.find((n: any) => n.level === "SUB").parentCode;
    t.nodes = t.nodes.filter((n: any) => n.parentCode !== split || n.code === `${split}.1`);
    for (const n of t.nodes) n.prereqCodes = n.prereqCodes.filter((p: string) => t.nodes.some((m: any) => m.code === p));
    recomputeCoverage(t);
    const r = await importTree(t, true);
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
    expect(r.errors.join("\n")).toContain(`[SINGLE_CHILD] ${split}`);
    expect(r.tree!.violations.length).toBeGreaterThan(0);
    expect(await MasteryOutcome.countDocuments({})).toBe(0);
  });

  it("the first tree of a subject needs its domains file", async () => {
    const r = await importTree(TREE_TEXT, false, false);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/domains\/MATH\.json/);
  });

  it("over a LOCKED catalogue: a label edit applies in place, a new row opens round 2, a gone code RETIRES, structure cannot move", async () => {
    await importTree(TREE_TEXT, true);
    await simulateLock();
    const t = freshTree();
    // label edit on a locked row
    t.nodes[0].labelBn = `${t.nodes[0].labelBn} ।`;
    // a gone code
    const gone = droppableLeaf(t);
    t.nodes = t.nodes.filter((n: any) => n.code !== gone);
    // a new tagged objective (book revision) in an existing chapter
    const tmpl = t.nodes.find((n: any) => n.level === "OBJECTIVE" && n.tagged && !n.strand && n.chapterNumber === 1);
    t.nodes.push({ ...tmpl, code: "LO-C1-MATH-01-09", prereqCodes: [], legacyCodes: [], labelBn: "নতুন শিখনফল" });
    recomputeCoverage(t);
    const r = await importTree(t, true);
    expect(r.errors).toEqual([]);
    expect(r.tree!.round).toEqual({ action: "OPEN_NEW", round: 2 });
    expect(r.tree!.review.lockedChanged).toContain(t.nodes[0].code);
    expect((await MasteryOutcome.findOne({ code: t.nodes[0].code }).lean())).toMatchObject({ status: "LOCKED", labelBn: t.nodes[0].labelBn });
    expect((await MasteryOutcome.findOne({ code: gone }).lean())!.status).toBe("RETIRED");
    expect((await MasteryOutcome.findOne({ code: "LO-C1-MATH-01-09" }).lean())).toMatchObject({ status: "DRAFT", reviewState: "PROPOSED" });
    expect((await MasteryCatalogueReview.find({}).sort({ round: 1 }).lean()).map((x) => x.state)).toEqual(["LOCKED", "OPEN"]);

    // A locked objective may not become a grouping parent / change level.
    const moved = freshTree();
    const locked = moved.nodes.find((n: any) => n.level === "OBJECTIVE" && n.tagged && !n.strand && n.code !== gone);
    locked.assess = locked.assess === "RUBRIC" ? "QUESTION" : "RUBRIC";
    const refused = await importTree(moved, false);
    expect(refused.ok).toBe(false);
    expect(refused.errors.join("\n")).toMatch(new RegExp(`${locked.code}.*assess`));
  });

  it("the flat M-0 format still imports, but a flat file over a tree pair is refused", async () => {
    const flat = {
      classToken: "C3",
      subject: "MATH",
      status: "DRAFT",
      chapters: [{ number: 7, titleBn: "ভাগ" }],
      outcomes: [{ code: "LO-C3-MATH-07-03", labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: [] }],
      questionTypes: [],
    };
    const ok = await importCatalogue(JSON.stringify(flat), true, actor);
    expect(ok.applied).toBe(true);
    expect(ok.tree).toBeNull();
    await importTree(TREE_TEXT, true);
    const refused = await importCatalogue(JSON.stringify({ ...flat, classToken: "C1", outcomes: [{ ...flat.outcomes[0], code: "LO-C1-MATH-07-03" }] }), false, actor);
    expect(refused.ok).toBe(false);
    expect(refused.errors.join(" ")).toMatch(/শিখনফল-বৃক্ষ/);
  });

  it("while a round is open the one-tap lock and a DRAFT-row delete are refused", async () => {
    await importTree(TREE_TEXT, true);
    await expect(lockCatalogue("C1", "MATH", actor)).rejects.toThrow(/পর্যালোচনায়/);
    const any = await MasteryOutcome.findOne({}).lean();
    await expect(retireOutcome(any!.code, actor)).rejects.toThrow(/পর্যালোচনায়/);
    expect(await MasteryOutcome.countDocuments({ status: "LOCKED" })).toBe(0);
  });

  it("the review log is append-only at the model", async () => {
    await importTree(TREE_TEXT, true);
    await expect(MasteryReviewEvent.updateOne({}, { $set: { comment: "x" } })).rejects.toThrow(/append-only/);
    await expect(MasteryReviewEvent.deleteOne({})).rejects.toThrow(/append-only/);
  });
});

describe("the switch needs a LOCKED round (§7, §10 item 12)", () => {
  it("refuses ON while the round is open; allows it once locked; a flat locked catalogue (no round) still switches on", async () => {
    const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
    const yearId = String(year._id);
    await importTree(TREE_TEXT, true);
    await expect(setEnablement(yearId, "C1", "MATH", true, actor)).rejects.toThrow(/লক/);
    // Even with some LOCKED rows (e.g. a tree imported over a locked flat list), an OPEN round blocks.
    await MasteryOutcome.updateOne({ code: "LO-C1-MATH-01-01" }, { $set: { status: "LOCKED" } });
    await expect(setEnablement(yearId, "C1", "MATH", true, actor)).rejects.toThrow(/পর্যালোচনায়/);
    await simulateLock();
    expect((await setEnablement(yearId, "C1", "MATH", true, actor)).enabled).toBe(true);

    // The dev C3 seed shape: a flat catalogue locked through M-0, no review round.
    await importCatalogue(
      JSON.stringify({
        classToken: "C3",
        subject: "MATH",
        status: "LOCKED",
        chapters: [{ number: 7, titleBn: "ভাগ" }],
        outcomes: [{ code: "LO-C3-MATH-07-03", labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: [] }],
        questionTypes: [],
      }),
      true,
      actor,
    );
    expect((await setEnablement(yearId, "C3", "MATH", true, actor)).enabled).toBe(true);
  });
});

describe("level names (D-#923)", () => {
  it("default ক্ষেত্র / শিখনফল / উপ-শিখনফল; an edit on the SCHOOL row reaches the server helper; blank returns the default", async () => {
    expect((await getLevelLabels()).resolved).toMatchObject({ domainBn: "ক্ষেত্র", objectiveBn: "শিখনফল", subBn: "উপ-শিখনফল" });
    expect((await masteryLevelLabels()).objectiveBn).toBe("শিখনফল");
    const saved = await saveLevelLabels({ objectiveBn: "লক্ষ্য", subEn: "Step" }, actor);
    expect(saved.resolved.objectiveBn).toBe("লক্ষ্য");
    expect(saved.ownKeys.sort()).toEqual(["objectiveBn", "subEn"]);
    expect((await masteryLevelLabels()).objectiveBn).toBe("লক্ষ্য");
    // A policy save keeps the level names.
    await savePolicy(null, null, { weakBelowPct: 45 }, actor);
    expect((await masteryLevelLabels()).objectiveBn).toBe("লক্ষ্য");
    await saveLevelLabels({ objectiveBn: "" }, actor);
    expect((await masteryLevelLabels()).objectiveBn).toBe("শিখনফল");
    await expect(saveLevelLabels({ subBn: "ক্ষেত্র" }, actor)).rejects.toThrow(/আলাদা/);
  });
});

describe("no surface hard-codes the new level word (D-#923 source scan, partial)", () => {
  // The defaults live ONLY in shared/vocab.ts MASTERY_LEVEL_LABEL_DEFAULTS; screens use
  // useMasteryLevelLabels, the server masteryLevelLabels(). "শিখনফল" predates the tree and is
  // still used as plain prose on M-0..M-6 screens — OT-3 moves the level-naming ones onto the hook.
  it("উপ-শিখনফল appears nowhere in app/server source", () => {
    const roots = [path.resolve(__dirname, ".."), path.resolve(__dirname, "../../../app/src")];
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__" && e.name !== "node_modules") walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && fs.readFileSync(p, "utf8").includes("উপ-শিখনফল")) hits.push(p);
      }
    };
    roots.forEach(walk);
    expect(hits).toEqual([]);
  });
});

describe("session plans carry codes (§8.3): unknown codes warn, never refuse", () => {
  it("warns on a code the catalogue does not hold LOCKED", async () => {
    const env = { doc_type: "session_plan", tags: { lo_codes: ["LO-C1-MATH-07-03.2", "LO-C1-MATH-07-01"] } };
    expect((await masteryImportWarnings(env)).join("\n")).toMatch(/LO-C1-MATH-07-03\.2 is not in the mastery catalogue/);
  });
});

describe("permission: mastery:review (§9)", () => {
  const schema = builder.toSchema();
  type Auth = { role: string; userId: string; grantedPermissions?: string[] };
  const run = (source: string, auth: Auth | null): Promise<ExecutionResult> =>
    graphql({ schema, source, contextValue: { auth } }) as Promise<ExecutionResult>;
  const who = (role: string, grantedPermissions: string[] = []): Auth => ({ role, userId: new Types.ObjectId().toString(), grantedPermissions });
  const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;
  const ROUND = `query { masteryCatalogueReview(classToken: "C1", subject: "MATH") { round state } }`;
  const IMPORT = `mutation { importMasteryCatalogue(catalogueJson: "{}", apply: false) { ok } }`;
  const LABELS = `query { masteryLevelLabels { resolved { objectiveBn } } }`;
  const SAVE_LABELS = `mutation { saveMasteryLevelLabels(objectiveBn: "লক্ষ্য") { ownKeys } }`;

  it("a teacher or office without the grant cannot read the review round; the per-person grant can; it does not import", async () => {
    expect(denied(await run(ROUND, who("TEACHER")))).toBe(true);
    expect(denied(await run(ROUND, who("OFFICE")))).toBe(true);
    expect(denied(await run(ROUND, who("OFFICE", ["mastery:review"])))).toBe(false);
    expect(denied(await run(ROUND, who("PRINCIPAL")))).toBe(false);
    expect(denied(await run(IMPORT, who("OFFICE", ["mastery:review"])))).toBe(true);
  });

  it("everyone with mastery:view reads the level names; only mastery:settings renames them", async () => {
    const t = await run(LABELS, who("TEACHER"));
    expect(t.errors).toBeUndefined();
    expect((t.data as any).masteryLevelLabels.resolved.objectiveBn).toBe("শিখনফল");
    expect(denied(await run(LABELS, who("GUARDIAN")))).toBe(true);
    expect(denied(await run(SAVE_LABELS, who("TEACHER")))).toBe(true);
    expect(denied(await run(SAVE_LABELS, who("OFFICE", ["mastery:review"])))).toBe(true);
    expect(denied(await run(SAVE_LABELS, who("PRINCIPAL")))).toBe(false);
  });
});
