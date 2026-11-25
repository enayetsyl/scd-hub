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
  collapseExerciseRefs,
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
import { Audit } from "../modules/platform/models/Audit";
import { importCatalogue } from "../modules/mastery/services/MasteryCatalogueService";
import {
  assignReviewers,
  exportReview,
  getReviewQueue,
  lockGateRefusals,
  lockReview,
  narrowLockedCitation,
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

  it("a question ref names one question of one exercise; Bangla digits are read", () => {
    expect(parseExerciseRef("3/অনুশীলনী/8#3")).toEqual({ exercise: "3/অনুশীলনী/8", question: 3 });
    expect(normaliseExerciseRef(" 3/অনুশীলনী/8#৩ ")).toBe("3/অনুশীলনী/8#3");
    expect(exerciseOfRef("3/অনুশীলনী/8#3")).toBe("3/অনুশীলনী/8");
    expect(expandExerciseRef("3/অনুশীলনী/8#3")).toEqual(["3/অনুশীলনী/8"]);
    for (const bad of ["3/অনুশীলনী/2–4#1", "3/অনুশীলনী/2-4#1", "3/অনুশীলনী/1, 2#1", "3/অনুশীলনী/—#1", "3/অনুশীলনী/8#0", "3/অনুশীলনী/8#100", "3/অনুশীলনী/8#", "8#1"]) {
      expect(parseExerciseRef(bad)).toBeNull();
    }
    expect([isSplittableExerciseRef("3/অনুশীলনী/8"), isSplittableExerciseRef("3/অনুশীলনী/8#1"), isSplittableExerciseRef("3/L2/2–4"), isSplittableExerciseRef("1/x/—")]).toEqual([
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

describe("every subject: lettered exercises take a question (D-#1685 fix 1)", () => {
  it("Latin- and Bangla-lettered single exercises split; ranges / lists / activities never", () => {
    // C1–C4 ENG "1/L2/B", C6 ENG2 "Q1" / "Act1" / "B1", C3 MATH / C4 BAN "4ক" / "12খ".
    for (const [ref, exercise, q] of [
      ["1/L2/B#2", "1/L2/B", 2],
      ["6/Unit 1/Q1#3", "6/Unit 1/Q1", 3],
      ["6/Unit 2/Act1#1", "6/Unit 2/Act1", 1],
      ["6/Unit 2/B1#৪", "6/Unit 2/B1", 4],
      ["3/গুণ/4ক#2", "3/গুণ/4ক", 2],
      ["4/পাঠ/12খ#1", "4/পাঠ/12খ", 1],
    ] as const) {
      expect(parseExerciseRef(ref)).toEqual({ exercise, question: q });
      expect(isSplittableExerciseRef(exercise)).toBe(true);
    }
    expect(rules([node("LO-C4-MATH-03-01", ["1/L2/B#1"]), node("LO-C4-MATH-03-02", ["1/L2/B#2"])])).toEqual([]);
    expect(rules([node("LO-C4-MATH-03-01", ["1/L2/B#1"]), node("LO-C4-MATH-03-02", ["1/L2/B#1"])])).toEqual(["QUESTION_ONE_CODE LO-C4-MATH-03-02"]);
    expect(rules([node("LO-C4-MATH-03-01", ["1/L2/A–C#1"])])).toEqual(["QUESTION_REF LO-C4-MATH-03-01"]);
  });
});

describe("invariants + coverage gaps", () => {
  it("QUESTION_REF on a malformed question; QUESTION_ONE_CODE when two tagged rows cite one question", () => {
    expect(rules([node("LO-C4-MATH-03-01", ["3/অনুশীলনী/2–4#1"])])).toEqual(["QUESTION_REF LO-C4-MATH-03-01"]);
    expect(rules([node("LO-C4-MATH-03-01", ["3/অনুশীলনী/8#1"]), node("LO-C4-MATH-03-02", ["3/অনুশীলনী/8#1"])])).toEqual(["QUESTION_ONE_CODE LO-C4-MATH-03-02"]);
    // Different questions, an untagged parent, or whole citations by two rows (today's shape) are fine.
    expect(rules([node("LO-C4-MATH-03-01", ["3/অনুশীলনী/8#1"]), node("LO-C4-MATH-03-02", ["3/অনুশীলনী/8#2"])])).toEqual([]);
    expect(rules([node("LO-C4-MATH-03-01", ["3/অনুশীলনী/8"]), node("LO-C4-MATH-03-02", ["3/অনুশীলনী/8"])])).toEqual([]);
    // An untagged (grouping) row repeating a tagged row's question is no conflict, and adds no gap.
    expect(rules([node("LO-C4-MATH-03-01", ["3/অনুশীলনী/8#1"]), node("LO-C4-MATH-03-02", ["3/অনুশীলনী/8#1"], false)])).toEqual([]);
    expect(
      questionCoverageGaps([node("LO-C4-MATH-03-01", ["3/অনুশীলনী/8#1", "3/অনুশীলনী/8#2"]), node("LO-C4-MATH-03-02", ["3/অনুশীলনী/8"], false)], [{ ref: "3/অনুশীলনী/8", count: 2 }]),
    ).toEqual([]);
  });

  it("a range cited whole + one of its exercises cited by question is a mixed citation (fix 2)", () => {
    const counts = [{ ref: "7/হাতে রাখি/3", count: 2 }];
    const nodes = [node("LO-C4-MATH-03-01", ["7/হাতে রাখি/2–4"]), node("LO-C4-MATH-03-02", ["7/হাতে রাখি/3#1", "7/হাতে রাখি/3#2"])];
    expect(questionCoverageGaps(nodes, counts).map((g) => `${g.exercise}: ${g.detail}`)).toEqual([
      "7/হাতে রাখি/3: cited whole by LO-C4-MATH-03-01 and by question by LO-C4-MATH-03-02 — cite it one way",
    ]);
  });

  it("collapseExerciseRefs: a row's own whole citation absorbs its questions of that exercise (fix 4)", () => {
    expect(collapseExerciseRefs(["3/অ/8", "3/অ/8#1", "3/অ/7#2", "3/অ/8#2"])).toEqual(["3/অ/8", "3/অ/7#2"]);
    expect(collapseExerciseRefs(["7/হাতে রাখি/2–4", "7/হাতে রাখি/3#1", "7/হাতে রাখি/5#1"])).toEqual(["7/হাতে রাখি/2–4", "7/হাতে রাখি/5#1"]);
    expect(collapseExerciseRefs(["3/অ/8#1", "3/অ/8#1", "3/অ/9"])).toEqual(["3/অ/8#1", "3/অ/9"]);
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
    expect(fileRules({ questionCounts: [{ ref: `${EX}#1`, count: 2 }] })).toEqual([`coverage.questionCounts: "${EX}#1" is not one exercise (a range or "—")`]);
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
    await expect(setQuestionCount(reviewId, { ref: "7/হাতে রাখি/2–4", count: 3 }, reviewer)).rejects.toThrow(/একটি অনুশীলনীতেই/);
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
    // The new objective, citing the questions nobody else cites (the reviewer's case).
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

describe("review writes — fixes 4–6", () => {
  it("rejected and merged-away rows are ignored by QUESTION_ONE_CODE and the gaps", async () => {
    await setup();
    await setQuestionCount(reviewId, { ref: EX, count: 2 }, reviewer);
    await decide({ action: "EDIT", code: "LO-C1-MATH-07-04", exercises: ["7/যোগ ৯৯ পর্যন্ত/4", "7/হাতে রাখি/3", `${EX}#1`] });
    await decide({ action: "REJECT", code: "LO-C1-MATH-07-04", reason: "পুনরাবৃত্তি" });
    // 07-04 is out: the same question on another row is no conflict, and its Q1 no longer counts.
    await decide({ action: "EDIT", code: "LO-C1-MATH-07-01.5", exercises: [`${EX}#1`, "7/যোগ ১১ থেকে ২০/2", "7/দ্রুত-শিট ২ — যোগ ২০-এর মধ্যে/—"] });
    expect((await getReviewQueue(reviewId, reviewer)).questionGaps).toEqual([`${EX}: question 2 of 2 not cited`]);
  });

  it("merge back after a question-level split leaves the parent citing the exercise once, whole", async () => {
    await setup();
    const P = "LO-C1-MATH-07-02";
    await setQuestionCount(reviewId, { ref: "7/যোগ ৯৯ পর্যন্ত/1", count: 2 }, reviewer);
    await decide({
      action: "SPLIT",
      code: P,
      children: [
        { labelBn: "এক", exercises: ["7/যোগ ৯৯ পর্যন্ত/1#1", "7/যোগ ৯৯ পর্যন্ত/2"] },
        { labelBn: "দুই", exercises: ["7/যোগ ৯৯ পর্যন্ত/1#2", "7/যোগ ৯৯ পর্যন্ত/3"] },
      ],
    });
    await decide({ action: "MERGE", code: `${P}.2`, intoCode: P });
    const back = await exercisesOf(P);
    expect(back.filter((x) => x.includes("#"))).toEqual([]);
    expect(new Set(back)).toEqual(new Set(["7/যোগ ৯৯ পর্যন্ত/1", "7/যোগ ৯৯ পর্যন্ত/2", "7/যোগ ৯৯ পর্যন্ত/3"]));
    const q = await getReviewQueue(reviewId, reviewer);
    expect([q.questionGaps, q.violations]).toEqual([[], []]);
  });

  it("EDIT folds a question into the row's own whole citation of the same exercise", async () => {
    await setup();
    await decide({ action: "EDIT", code: "LO-C1-MATH-07-04", exercises: [`${EX}#2`, "7/হাতে রাখি/3", EX, "7/যোগ ৯৯ পর্যন্ত/4"] });
    expect(await exercisesOf("LO-C1-MATH-07-04")).toEqual(["7/হাতে রাখি/3", EX, "7/যোগ ৯৯ পর্যন্ত/4"]);
    // Folded to exactly what it already cites → nothing changed.
    await expect(decide({ action: "EDIT", code: "LO-C1-MATH-07-04", exercises: ["7/হাতে রাখি/3", EX, `${EX}#1`, "7/যোগ ৯৯ পর্যন্ত/4"] })).rejects.toThrow(/কিছুই বদলায়নি/);
  });

  it("question counts: two reviewers at once never leave two entries; a stale change is refused", async () => {
    await setup();
    const other = await makeUser("PRINCIPAL", "অধ্যক্ষ ২");
    const results = await Promise.allSettled([setQuestionCount(reviewId, { ref: EX, count: 4 }, reviewer), setQuestionCount(reviewId, { ref: EX, count: 5 }, other)]);
    const counts = (await MasteryCatalogueReview.findById(reviewId).lean())!.coverage.questionCounts ?? [];
    expect(counts.filter((c) => c.ref === EX)).toHaveLength(1);
    expect(results.some((x) => x.status === "fulfilled")).toBe(true);
    // A change made from a stale read (the count moved underneath) is refused, not overwritten.
    await MasteryCatalogueReview.updateOne({ _id: reviewId }, { $set: { "coverage.questionCounts.$[e].count": 9 } }, { arrayFilters: [{ "e.ref": EX }] });
    const real = MasteryCatalogueReview.findOne.bind(MasteryCatalogueReview);
    // The caller read the count as 7 (stale); the database holds 9.
    const spy = jest.spyOn(MasteryCatalogueReview, "findById").mockImplementationOnce(((id: unknown) => ({
      lean: () => real({ _id: id }).lean().then((d: any) => ({ ...d, coverage: { ...d.coverage, questionCounts: [{ ref: EX, count: 7 }] } })),
    })) as any);
    await expect(setQuestionCount(reviewId, { ref: EX, count: 6 }, reviewer)).rejects.toThrow(/অন্য কেউ বদলেছেন/);
    spy.mockRestore();
    expect((await MasteryCatalogueReview.findById(reviewId).lean())!.coverage.questionCounts).toEqual([{ ref: EX, count: 9 }]);
  });

  it("a redraft import keeps the counts set in the app; the file's own count wins", async () => {
    await setup();
    await setQuestionCount(reviewId, { ref: EX, count: 4 }, reviewer);
    await setQuestionCount(reviewId, { ref: "7/যোগ ৯৯ পর্যন্ত/1", count: 3 }, reviewer);
    const raw = JSON.parse(TREE_TEXT);
    raw.coverage.questionCounts = [{ ref: EX, count: 6 }];
    const rep = await importCatalogue(JSON.stringify(raw), true, principal, DOMAINS_TEXT);
    expect([rep.applied, rep.errors]).toEqual([true, []]);
    const counts = (await MasteryCatalogueReview.findById(reviewId).lean())!.coverage.questionCounts ?? [];
    expect(counts.map((c) => [c.ref, c.count]).sort()).toEqual([
      ["7/যোগ ৯৯ পর্যন্ত/1", 3],
      [EX, 6],
    ].sort());
  });
});

describe("narrow a LOCKED row's citation (fix 9, mastery:settings)", () => {
  async function lockedTree(): Promise<void> {
    await setup();
    await submitReview(reviewId, reviewer);
    await lockReview(reviewId, principal);
  }

  it("narrows a whole ref to some questions, audit-logged; the gaps it leaves are returned (not refused)", async () => {
    await lockedTree();
    const res = await narrowLockedCitation({ code: "LO-C1-MATH-07-04", exercise: EX, questions: [3, 1], questionCount: 4 }, principal);
    expect(res.exercises).toEqual(["7/যোগ ৯৯ পর্যন্ত/4", "7/হাতে রাখি/3", `${EX}#1`, `${EX}#3`]);
    expect(await exercisesOf("LO-C1-MATH-07-04")).toEqual(res.exercises);
    expect((await MasteryOutcome.findOne({ code: "LO-C1-MATH-07-04" }).lean())!.status).toBe("LOCKED");
    // 07-01.5 still cites it whole → mixed; questions 2 and 4 are not cited.
    expect(res.questionGaps.join("\n")).toMatch(/cited whole by LO-C1-MATH-07-01\.5[\s\S]*questions 2, 4 of 4 not cited/);
    expect((await MasteryCatalogueReview.findById(reviewId).lean())!.coverage.questionCounts).toEqual([{ ref: EX, count: 4 }]);
    for (let i = 0; i < 50 && (await Audit.countDocuments({ eventKind: "MASTERY_OUTCOME_CITATION_NARROWED" })) === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await Audit.countDocuments({ eventKind: "MASTERY_OUTCOME_CITATION_NARROWED" })).toBe(1);
    // Narrowing 07-01.5 to the questions 07-04 gave up closes the gap.
    const second = await narrowLockedCitation({ code: "LO-C1-MATH-07-01.5", exercise: EX, questions: [2, 4], questionCount: 4 }, principal);
    expect(second.questionGaps).toEqual([]);
  });

  it("refuses: not the Principal, a DRAFT row, widening (exercise not cited whole), all questions, a wrong count, a repeated question", async () => {
    await lockedTree();
    await expect(narrowLockedCitation({ code: "LO-C1-MATH-07-04", exercise: EX, questions: [1], questionCount: 4 }, reviewer)).rejects.toThrow(/শুধু অধ্যক্ষ/);
    await expect(narrowLockedCitation({ code: "LO-C1-MATH-07-04", exercise: "7/হাতে রাখি/1", questions: [1], questionCount: 2 }, principal)).rejects.toThrow(/পুরোটা উদ্ধৃত করে না/);
    await expect(narrowLockedCitation({ code: "LO-C1-MATH-07-04", exercise: EX, questions: [1, 2], questionCount: 2 }, principal)).rejects.toThrow(/কিছুই সীমিত হয় না/);
    await expect(narrowLockedCitation({ code: "LO-C1-MATH-07-04", exercise: "7/হাতে রাখি/2–4", questions: [1], questionCount: 2 }, principal)).rejects.toThrow(/পরিসর/);
    await narrowLockedCitation({ code: "LO-C1-MATH-07-04", exercise: EX, questions: [1], questionCount: 3 }, principal);
    await expect(narrowLockedCitation({ code: "LO-C1-MATH-07-01.5", exercise: EX, questions: [2], questionCount: 4 }, principal)).rejects.toThrow(/৩টি প্রশ্ন/);
    await expect(narrowLockedCitation({ code: "LO-C1-MATH-07-01.5", exercise: EX, questions: [1], questionCount: 3 }, principal)).rejects.toThrow(/\[QUESTION_ONE_CODE\]/);
    // A narrowed ref cannot be narrowed again as "whole", nor widened back.
    await expect(narrowLockedCitation({ code: "LO-C1-MATH-07-04", exercise: EX, questions: [1], questionCount: 3 }, principal)).rejects.toThrow(/পুরোটা উদ্ধৃত করে না/);
  });

  it("refuses a DRAFT row (review writes handle those)", async () => {
    await setup();
    await expect(narrowLockedCitation({ code: "LO-C1-MATH-07-04", exercise: EX, questions: [1], questionCount: 4 }, principal)).rejects.toThrow(/চূড়ান্ত নয়/);
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

// ---------------------------------------------------------------------------
// App picker helpers (pure; app/src/screens/mastery/exerciseRefPicks.ts)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const picks = require("../../../app/src/screens/mastery/exerciseRefPicks") as {
  exercisesInRefs: (refs: readonly string[], splittableOnly?: boolean) => string[];
  withCite: (refs: readonly string[], exercise: string, cite: { whole: boolean; questions: number[] } | null) => string[];
  splitPartConflicts: (parts: readonly (readonly string[])[]) => { ref: string; parts: number[] }[];
};

describe("app picker helpers", () => {
  it("exercisesInRefs folds questions into their exercise; splittableOnly drops ranges and activities", () => {
    const refs = ["3/অ/8#1", "3/অ/7", "3/অ/8#3", "3/অ/2–4", "3/অ/—", "1/L2/B"];
    expect(picks.exercisesInRefs(refs)).toEqual(["3/অ/8", "3/অ/7", "3/অ/2–4", "3/অ/—", "1/L2/B"]);
    expect(picks.exercisesInRefs(refs, true)).toEqual(["3/অ/8", "3/অ/7", "1/L2/B"]);
  });

  it("withCite rewrites one exercise in place and leaves the rest", () => {
    const refs = ["3/অ/7", "3/অ/8", "3/অ/9"];
    expect(picks.withCite(refs, "3/অ/8", { whole: false, questions: [3, 1] })).toEqual(["3/অ/7", "3/অ/8#1", "3/অ/8#3", "3/অ/9"]);
    expect(picks.withCite(["3/অ/7", "3/অ/8#1", "3/অ/8#3", "3/অ/9"], "3/অ/8", { whole: true, questions: [] })).toEqual(refs);
    expect(picks.withCite(refs, "3/অ/8", null)).toEqual(["3/অ/7", "3/অ/9"]);
    expect(picks.withCite(["3/অ/7"], "1/L2/B", { whole: false, questions: [2] })).toEqual(["3/অ/7", "1/L2/B#2"]);
  });

  it("splitPartConflicts names a question picked in two parts (whole citations are not compared)", () => {
    expect(picks.splitPartConflicts([["3/অ/8#1", "3/অ/8#3"], ["3/অ/8#2"], ["3/অ/8"]])).toEqual([]);
    expect(picks.splitPartConflicts([["3/অ/8#1", "3/অ/8#3"], ["3/অ/8#৩"], ["3/অ/8#1"]])).toEqual([
      { ref: "3/অ/8#1", parts: [1, 3] },
      { ref: "3/অ/8#3", parts: [1, 2] },
    ]);
  });
});
