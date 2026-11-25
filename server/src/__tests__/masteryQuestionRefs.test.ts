/**
 * Question-level exercise refs (D-#1685) — an objective may cite ONE question of an exercise,
 * "<chapter>/<lesson>/<n>#<q>", not only the whole exercise.
 *
 * Shared   — parsing old + new refs; QUESTION_REF / QUESTION_ONE_CODE; coverage gaps (partial,
 *            mixed whole + question, no count); FILE-mode COVERAGE counts a question ref as its
 *            exercise and reads coverage.questionCounts.
 * Review   — set an exercise's question count; ADD / EDIT with question refs (one event each,
 *            refs normalised); the same question on two tagged rows refused; a question beyond the
 *            count refused; the lock gate refuses a partial or mixed exercise and accepts one fully
 *            covered question by question; the export round-trips the refs and the counts.
 *
 * Fixture: the real C1_MATH.tree.json through the OT-1 import. "7/যোগ ১১ থেকে ২০/1" is cited whole
 * by LO-C1-MATH-07-01.5 and LO-C1-MATH-07-04 — the same shape as C4 Maths Ex 7 / Ex 8.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  checkTreeInvariants,
  exerciseOfRef,
  expandExerciseRef,
  groupExerciseRefs,
  isSplittableExerciseRef,
  normaliseExerciseRef,
  parseExerciseRef,
  questionCoverageGaps,
  readTreeFile,
  type TreeNodeInput,
} from "@scd/shared";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryCatalogueReview } from "../modules/mastery/models/MasteryCatalogueReview";
import { MasteryReviewEvent } from "../modules/mastery/models/MasteryReviewEvent";
import { User } from "../modules/foundation/models/User";
import { importCatalogue } from "../modules/mastery/services/MasteryCatalogueService";
import {
  assignReviewers,
  exportReview,
  getReviewQueue,
  lockGateRefusals,
  lockReview,
  reviewDecide,
  setQuestionCount,
  submitReview,
  type ReviewCaller,
  type ReviewDecisionInput,
} from "../modules/mastery/services/MasteryReviewWriteService";

jest.setTimeout(180_000);

const DOCS = path.resolve(__dirname, "../../../docs/mastery/objective-tree");
const TREE_TEXT = fs.readFileSync(path.join(DOCS, "C1_MATH.tree.json"), "utf8");
const DOMAINS_TEXT = fs.readFileSync(path.join(DOCS, "domains/MATH.json"), "utf8");

const EX = "7/যোগ ১১ থেকে ২০/1";

// ---------------------------------------------------------------------------
// Shared (pure)
// ---------------------------------------------------------------------------

const node = (code: string, exercises: string[], tagged = true): TreeNodeInput => ({
  code,
  level: "OBJECTIVE",
  parentCode: null,
  domainCode: "DOM-MATH-ADD",
  chapterNumber: 3,
  strand: null,
  tagged,
  prereqCodes: [],
  exercises,
  labelBn: code,
});
const rules = (nodes: TreeNodeInput[]) =>
  checkTreeInvariants({ classToken: "C4", subject: "MATH", nodes, domainCodes: ["DOM-MATH-ADD"], mode: "REVIEW" })
    .filter((v) => v.rule.startsWith("QUESTION"))
    .map((v) => `${v.rule} ${v.code}`);

describe("parsing refs", () => {
  it("old whole-exercise refs are unchanged", () => {
    for (const r of ["3/L2/B", "2/নিজে করি/1", "4/কার যোগ করি/3", "12/জোড়া, হালি, ডজন/1", "7/হাতে রাখি/2–4", "1/কম – বেশি/—", "4/English book: Number এর সাথে মিল করে সংখ্যা লিখি/49"]) {
      expect(parseExerciseRef(r)).toEqual({ exercise: r, question: null });
      expect(exerciseOfRef(r)).toBe(r);
      expect(normaliseExerciseRef(r)).toBe(r);
    }
    expect(expandExerciseRef("7/হাতে রাখি/2–4")).toEqual(["7/হাতে রাখি/2", "7/হাতে রাখি/3", "7/হাতে রাখি/4"]);
  });

  it("a question ref names one question of one numbered exercise; Bangla digits are read", () => {
    expect(parseExerciseRef("3/অনুশীলনী/8#3")).toEqual({ exercise: "3/অনুশীলনী/8", question: 3 });
    expect(normaliseExerciseRef(" 3/অনুশীলনী/8#৩ ")).toBe("3/অনুশীলনী/8#3");
    expect(exerciseOfRef("3/অনুশীলনী/8#3")).toBe("3/অনুশীলনী/8");
    expect(expandExerciseRef("3/অনুশীলনী/8#3")).toEqual(["3/অনুশীলনী/8"]);
    for (const bad of ["3/অনুশীলনী/2–4#1", "3/অনুশীলনী/—#1", "3/অনুশীলনী/8#0", "3/অনুশীলনী/8#100", "3/অনুশীলনী/8#", "3/অনুশীলনী/B#1"]) {
      expect(parseExerciseRef(bad)).toBeNull();
    }
    expect([isSplittableExerciseRef("3/অনুশীলনী/8"), isSplittableExerciseRef("3/অনুশীলনী/8#1"), isSplittableExerciseRef("3/L2/B"), isSplittableExerciseRef("1/x/—")]).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(groupExerciseRefs(["3/অ/8#4", "3/অ/7", "3/অ/8#1"])).toEqual([
      { exercise: "3/অ/8", whole: false, questions: [1, 4] },
      { exercise: "3/অ/7", whole: true, questions: [] },
    ]);
  });
});

describe("invariants + coverage gaps", () => {
  it("QUESTION_REF on a malformed question; QUESTION_ONE_CODE when two tagged rows cite one question", () => {
    expect(rules([node("LO-C4-MATH-03-01", ["3/অনুশীলনী/2–4#1"])])).toEqual(["QUESTION_REF LO-C4-MATH-03-01"]);
    expect(rules([node("LO-C4-MATH-03-01", ["3/অনুশীলনী/8#1"]), node("LO-C4-MATH-03-02", ["3/অনুশীলনী/8#1"])])).toEqual(["QUESTION_ONE_CODE LO-C4-MATH-03-02"]);
    // Different questions, an untagged parent, or whole citations by two rows (today's shape) are fine.
    expect(rules([node("LO-C4-MATH-03-01", ["3/অনুশীলনী/8#1"]), node("LO-C4-MATH-03-02", ["3/অনুশীলনী/8#2"])])).toEqual([]);
    expect(rules([node("LO-C4-MATH-03-01", ["3/অনুশীলনী/8"]), node("LO-C4-MATH-03-02", ["3/অনুশীলনী/8"])])).toEqual([]);
  });

  it("an exercise is mapped whole, or every question cited — never partly, never both ways", () => {
    const counts = [{ ref: "3/অনুশীলনী/8", count: 4 }];
    const full = [node("LO-C4-MATH-03-01", ["3/অনুশীলনী/8#2", "3/অনুশীলনী/8#4"]), node("LO-C4-MATH-03-02", ["3/অনুশীলনী/8#1", "3/অনুশীলনী/8#3"])];
    expect(questionCoverageGaps(full, counts)).toEqual([]);
    expect(questionCoverageGaps(full.slice(1), counts).map((g) => g.detail)).toEqual(["questions 2, 4 of 4 not cited"]);
    expect(questionCoverageGaps(full, []).map((g) => g.detail)).toEqual(["cited by question but its question count is not set"]);
    const mixed = [...full, node("LO-C4-MATH-03-03", ["3/অনুশীলনী/8"])];
    expect(questionCoverageGaps(mixed, counts).map((g) => g.detail)).toEqual([
      "cited whole by LO-C4-MATH-03-03 and by question by LO-C4-MATH-03-01, LO-C4-MATH-03-02 — cite it one way",
    ]);
    expect(questionCoverageGaps([node("LO-C4-MATH-03-01", ["3/অনুশীলনী/8#5"]), ...full], counts).map((g) => g.detail)).toEqual(["question 5 beyond its 4"]);
    // A skill strand citing it whole only says the skill is practised there — not a mixed citation.
    const strand = { ...node("LO-C4-MATH-SK-COL-01", ["3/অনুশীলনী/8"]), strand: "COL", chapterNumber: null };
    expect(questionCoverageGaps([...full, strand], counts)).toEqual([]);
  });

  it("FILE mode: a question ref counts as its exercise; coverage.questionCounts is read and checked", () => {
    const raw = JSON.parse(TREE_TEXT);
    const n04 = raw.nodes.find((x: { code: string }) => x.code === "LO-C1-MATH-07-04");
    const n15 = raw.nodes.find((x: { code: string }) => x.code === "LO-C1-MATH-07-01.5");
    n04.bookRef.exercises = n04.bookRef.exercises.map((x: string) => (x === EX ? `${EX}#2` : x));
    n15.bookRef.exercises = n15.bookRef.exercises.map((x: string) => (x === EX ? `${EX}#1` : x));
    const fileRules = (cov: unknown) => {
      const t = readTreeFile({ ...raw, coverage: { ...raw.coverage, ...(cov as object) } });
      if (!t.ok) return t.errors;
      return checkTreeInvariants({
        classToken: t.tree.classToken,
        subject: t.tree.subject,
        nodes: t.tree.nodes,
        domainCodes: JSON.parse(DOMAINS_TEXT).domains.map((d: { code: string }) => d.code),
        mode: "FILE",
        questionTypeCodes: t.tree.questionTypes.map((q) => q.code),
        coverage: t.tree.coverage,
      })
        .filter((v) => v.rule === "COVERAGE" || v.rule.startsWith("QUESTION"))
        .map((v) => v.detail);
    };
    expect(fileRules({ questionCounts: [{ ref: EX, count: 2 }] })).toEqual([]);
    expect(fileRules({ questionCounts: [{ ref: EX, count: 3 }] })).toEqual([`${EX}: question 3 of 3 not cited`]);
    expect(fileRules({})).toEqual([`${EX}: cited by question but its question count is not set`]);
    expect(fileRules({ questionCounts: [{ ref: `${EX}#1`, count: 2 }] })).toEqual([`coverage.questionCounts: "${EX}#1" is not one numbered exercise`]);
  });
});

// ---------------------------------------------------------------------------
// Review (in-memory MongoDB, real services)
// ---------------------------------------------------------------------------

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

let n = 0;
async function makeUser(role: string, name: string, grantedPermissions: string[] = []): Promise<ReviewCaller & { id: string }> {
  n += 1;
  const u = await User.create({ email: `u${n}@qref.test`, passwordHash: "x", role, name, active: true, grantedPermissions });
  return { id: String(u._id), userId: String(u._id), role, canSettings: role === "PRINCIPAL" };
}

let principal: ReviewCaller & { id: string };
let reviewer: ReviewCaller & { id: string };
let reviewId: string;

async function setup(): Promise<void> {
  principal = await makeUser("PRINCIPAL", "অধ্যক্ষ");
  reviewer = await makeUser("OFFICE", "পর্যালোচক", ["mastery:review"]);
  const rep = await importCatalogue(TREE_TEXT, true, principal, DOMAINS_TEXT);
  if (!rep.applied) throw new Error(rep.errors.join("; "));
  const round = await MasteryCatalogueReview.findOne({ classToken: "C1", subject: "MATH" }).lean();
  reviewId = String(round!._id);
  await assignReviewers(reviewId, [reviewer.id], principal);
}

const decide = (input: ReviewDecisionInput) => reviewDecide(reviewId, input, reviewer);
const exercisesOf = async (code: string) => ((await MasteryOutcome.findOne({ code }).lean())!.bookRef as { exercises: string[] }).exercises;
const events = () => MasteryReviewEvent.countDocuments({ reviewId: new Types.ObjectId(reviewId) });

describe("review writes with question refs", () => {
  it("question count: set / change / clear, refused on a range, below a cited question, or when cited", async () => {
    await setup();
    const before = await events();
    await setQuestionCount(reviewId, { ref: EX, count: 4 }, reviewer);
    expect(await events()).toBe(before + 1);
    expect((await getReviewQueue(reviewId, reviewer)).questionCounts).toEqual([{ ref: EX, count: 4 }]);
    await expect(setQuestionCount(reviewId, { ref: "7/হাতে রাখি/2–4", count: 3 }, reviewer)).rejects.toThrow(/একটি নম্বরের অনুশীলনী/);
    await expect(setQuestionCount(reviewId, { ref: EX, count: 0 }, reviewer)).rejects.toThrow(/১ থেকে ৯৯/);
    await decide({ action: "EDIT", code: "LO-C1-MATH-07-04", exercises: ["7/যোগ ৯৯ পর্যন্ত/4", "7/হাতে রাখি/3", `${EX}#3`] });
    await expect(setQuestionCount(reviewId, { ref: EX, count: 2 }, reviewer)).rejects.toThrow(/অন্তত ৩/);
    await expect(setQuestionCount(reviewId, { ref: EX, count: null }, reviewer)).rejects.toThrow(/মোছা যায় না/);
    await setQuestionCount(reviewId, { ref: EX, count: 3 }, reviewer);
    expect((await getReviewQueue(reviewId, reviewer)).questionCounts).toEqual([{ ref: EX, count: 3 }]);
  });

  it("EDIT + ADD with question refs: normalised, one event each; a repeated question or one beyond the count refused", async () => {
    await setup();
    await setQuestionCount(reviewId, { ref: EX, count: 4 }, reviewer);
    const e0 = await events();
    // Bangla digit in the question part is stored ASCII.
    await decide({ action: "EDIT", code: "LO-C1-MATH-07-04", exercises: ["7/যোগ ৯৯ পর্যন্ত/4", "7/হাতে রাখি/3", `${EX}#৩`] });
    expect(await exercisesOf("LO-C1-MATH-07-04")).toEqual(["7/যোগ ৯৯ পর্যন্ত/4", "7/হাতে রাখি/3", `${EX}#3`]);
    await decide({ action: "EDIT", code: "LO-C1-MATH-07-01.5", exercises: [`${EX}#1`, "7/যোগ ১১ থেকে ২০/2", "7/দ্রুত-শিট ২ — যোগ ২০-এর মধ্যে/—"] });
    // The new objective, citing the questions nobody else cites (Mahzabin's case).
    await decide({ action: "ADD", level: "OBJECTIVE", chapterNumber: 7, domainCode: "DOM-MATH-ADD", labelBn: "যোগের সম্পর্ক ব্যবহার", exercises: [`${EX}#2`, `${EX}#4`] });
    expect((await events()) - e0).toBe(3);
    const added = await MasteryOutcome.findOne({ classToken: "C1", subject: "MATH", reviewState: "ADDED", labelBn: "যোগের সম্পর্ক ব্যবহার" }).lean();
    expect((added!.bookRef as { exercises: string[] }).exercises).toEqual([`${EX}#2`, `${EX}#4`]);

    // Same question on two tagged rows → [QUESTION_ONE_CODE]; beyond the count, malformed → refused.
    await expect(decide({ action: "ADD", level: "SUB", parentCode: "LO-C1-MATH-07-01", labelBn: "আবার", exercises: [`${EX}#2`] })).rejects.toThrow(/\[QUESTION_ONE_CODE\]/);
    await expect(decide({ action: "EDIT", code: added!.code, exercises: [`${EX}#2`, `${EX}#5`] })).rejects.toThrow(/প্রশ্ন ৫ নেই/);
    await expect(decide({ action: "EDIT", code: added!.code, exercises: ["7/হাতে রাখি/2–4#1"] })).rejects.toThrow(/অধ্যায়\/পাঠ\/নম্বর#প্রশ্ন/);
    const q = await getReviewQueue(reviewId, reviewer);
    expect([q.questionGaps, q.violations.filter((v) => v.includes("QUESTION"))]).toEqual([[], []]);
  });

  it("SPLIT: each part may take single questions of the parent's exercise (a strand citing it whole is fine)", async () => {
    await setup();
    await setQuestionCount(reviewId, { ref: "7/যোগ ৯৯ পর্যন্ত/1", count: 2 }, reviewer);
    await decide({
      action: "SPLIT",
      code: "LO-C1-MATH-07-02",
      children: [
        { labelBn: "প্রথম ভাগ", exercises: ["7/যোগ ৯৯ পর্যন্ত/1#1", "7/যোগ ৯৯ পর্যন্ত/2"] },
        { labelBn: "দ্বিতীয় ভাগ", exercises: ["7/যোগ ৯৯ পর্যন্ত/1#2", "7/যোগ ৯৯ পর্যন্ত/3"] },
      ],
    });
    expect(await exercisesOf("LO-C1-MATH-07-02.1")).toEqual(["7/যোগ ৯৯ পর্যন্ত/1#1", "7/যোগ ৯৯ পর্যন্ত/2"]);
    expect((await getReviewQueue(reviewId, reviewer)).questionGaps).toEqual([]);
  });
});

describe("lock gate", () => {
  it("lockGateRefusals names the gaps", () => {
    expect(lockGateRefusals(0, 0, [], [])).toEqual([]);
    expect(lockGateRefusals(0, 0, [], [`${EX}: question 2 of 4 not cited`])[0]).toMatch(/সব প্রশ্ন মেলেনি[\s\S]*question 2 of 4/);
  });

  it("refuses an exercise cited partly or both ways; accepts it once every question is cited", async () => {
    await setup();
    await setQuestionCount(reviewId, { ref: EX, count: 3 }, reviewer);
    // Step 1: one row moves to questions while the other still cites it whole — allowed as a write,
    // but the gate refuses it (mixed).
    await decide({ action: "EDIT", code: "LO-C1-MATH-07-04", exercises: ["7/যোগ ৯৯ পর্যন্ত/4", "7/হাতে রাখি/3", `${EX}#3`] });
    let q = await getReviewQueue(reviewId, principal);
    expect(q.questionGaps.join("\n")).toMatch(/cited whole by LO-C1-MATH-07-01\.5 and by question by LO-C1-MATH-07-04/);
    // Step 2: the other row takes Q1 only — partial (Q2 not cited).
    await decide({ action: "EDIT", code: "LO-C1-MATH-07-01.5", exercises: [`${EX}#1`, "7/যোগ ১১ থেকে ২০/2", "7/দ্রুত-শিট ২ — যোগ ২০-এর মধ্যে/—"] });
    q = await getReviewQueue(reviewId, principal);
    expect(q.questionGaps).toEqual([`${EX}: question 2 of 3 not cited`]);
    await submitReview(reviewId, reviewer);
    expect((await getReviewQueue(reviewId, principal)).canLock).toBe(false);
    await expect(lockReview(reviewId, principal)).rejects.toThrow(/সব প্রশ্ন মেলেনি[\s\S]*question 2 of 3 not cited/);

    // Step 3 (reopened): Q2 goes to 07-01.5 as well — every question cited, the gate opens.
    await MasteryCatalogueReview.updateOne({ _id: reviewId }, { $set: { state: "OPEN" } });
    await decide({ action: "EDIT", code: "LO-C1-MATH-07-01.5", exercises: [`${EX}#1`, `${EX}#2`, "7/যোগ ১১ থেকে ২০/2", "7/দ্রুত-শিট ২ — যোগ ২০-এর মধ্যে/—"] });
    await submitReview(reviewId, reviewer);
    q = await getReviewQueue(reviewId, principal);
    expect([q.questionGaps, q.violations, q.canLock]).toEqual([[], [], true]);
    expect((await lockReview(reviewId, principal)).locked).toBeGreaterThan(0);
  });
});

describe("export", () => {
  it("round-trips the question refs and the counts", async () => {
    await setup();
    await setQuestionCount(reviewId, { ref: EX, count: 3 }, reviewer);
    await decide({ action: "EDIT", code: "LO-C1-MATH-07-04", exercises: ["7/যোগ ৯৯ পর্যন্ত/4", "7/হাতে রাখি/3", `${EX}#3`] });
    const out = JSON.parse(await exportReview("C1", "MATH", 1));
    expect(out.questionCounts).toEqual([{ ref: EX, count: 3 }]);
    const edit = out.events.find((e: { action: string; code: string | null }) => e.action === "EDIT" && e.code === "LO-C1-MATH-07-04");
    expect(edit.after.exercises).toContain(`${EX}#3`);
    expect(parseExerciseRef(edit.after.exercises[2])).toEqual({ exercise: EX, question: 3 });
    const count = out.events.find((e: { action: string; code: string | null }) => e.action === "EDIT" && e.code === null);
    expect([count.before, count.after]).toEqual([
      { exerciseRef: EX, questionCount: null },
      { exerciseRef: EX, questionCount: 3 },
    ]);
  });
});
