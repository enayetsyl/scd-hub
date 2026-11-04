/**
 * OT-3 — roll-up, the earlier step and guardians at the objective grain
 * (docs/prd-objective-tree.md §8.1, §10 items 7–9; D-#925 / #927 / #923).
 *
 * Pure      — the roll-up truth table; summarise; a flat catalogue reads `isTree: false` (every
 *             flat view renders as before); the PDF code line (level word, guardian copy folds
 *             sub-objectives into their objective).
 * DB        — a locked C2 Math tree (domain › objective › sub-objectives) with evidence:
 *               student view: tagged rows, objective roll-up, domain counts;
 *               earlier step on a WEAK `07-03.2`: same-class `07-02.1` MASTERED, earlier-class
 *               `LO-C1-…-07-03.2` read from last year's evidence, `LO-C1-…-07-04` "no data";
 *               evidence trail carries the same steps + the objective / domain names;
 *               section heat-map: objective + domain columns, the trigger stays on tagged rows;
 *               the proposal names the parent objective and lists the weak children;
 *               guardian payloads: objective labels only — no sub-objective code or label;
 *               a rename of the objective word in পলিসি reaches the guardian payload, the
 *               notice naming and the PDF code line;
 *               the leader dashboard's school roll-up.
 *
 * In-memory MongoDB, real services.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { MasteryState } from "@scd/shared";

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryDomain } from "../modules/mastery/models/MasteryDomain";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { saveLevelLabels, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { outcomeTrail, sectionHeatmap, studentDiagnosis } from "../modules/mastery/services/MasteryDiagnosisService";
import { childMasteryProgress, objectiveGrain } from "../modules/mastery/services/MasteryGuardianService";
import { actionDetail, evaluateSectionTriggers } from "../modules/mastery/services/MasteryActionService";
import { schoolRollup } from "../modules/mastery/services/MasteryRollupService";
import { masteryLevelLabels } from "../modules/mastery/services/MasteryReviewService";
import { pdfCodeLine } from "../modules/mastery/services/MasteryAssignmentService";
import { outcomeNaming } from "../modules/mastery/notify";
import { buildCatalogueTree, rollUpObjective, summarise } from "../modules/mastery/rollup";

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

describe("roll-up truth table (§8.1, §10 item 8)", () => {
  const cases: [MasteryState[], MasteryState][] = [
    [[], "NOT_ASSESSED"],
    [["NOT_ASSESSED", "NOT_ASSESSED"], "NOT_ASSESSED"],
    [["WEAK", "MASTERED"], "WEAK"],
    [["WEAK", "NOT_ASSESSED"], "WEAK"],
    [["WEAK", "IMPROVING", "INSUFFICIENT"], "WEAK"],
    [["MASTERED", "MASTERED"], "MASTERED"],
    [["MASTERED", "NOT_ASSESSED"], "MASTERED"],
    [["MASTERED", "REVISION_DUE"], "REVISION_DUE"],
    [["REVISION_DUE"], "REVISION_DUE"],
    [["IMPROVING", "INSUFFICIENT"], "IMPROVING"],
    [["MASTERED", "INSUFFICIENT"], "IMPROVING"],
    [["IMPROVING", "MASTERED"], "IMPROVING"],
    [["INSUFFICIENT", "INSUFFICIENT"], "INSUFFICIENT"],
    [["INSUFFICIENT", "NOT_ASSESSED"], "INSUFFICIENT"],
  ];
  it.each(cases)("%j ⇒ %s", (children, parent) => {
    expect(rollUpObjective(children)).toBe(parent);
  });

  it("summarise: counts per state, share mastered over all, share weak over assessed", () => {
    const s = summarise(["WEAK", "MASTERED", "REVISION_DUE", "NOT_ASSESSED"]);
    expect(s.total).toBe(4);
    expect(s.assessed).toBe(3);
    expect(s.masteredPct).toBe(50);
    expect(s.weakPct).toBe(33);
    expect(s.counts.find((c) => c.state === "WEAK")!.count).toBe(1);
    expect(summarise([]).masteredPct).toBeNull();
  });

  it("a flat catalogue reads as tagged objectives with no tree (views unchanged)", () => {
    const t = buildCatalogueTree([
      { code: "LO-C3-MATH-07-02", labelBn: "ক" },
      { code: "LO-C3-MATH-07-03", labelBn: "খ" },
    ]);
    expect(t.isTree).toBe(false);
    expect(t.tagged.map((r) => r.code)).toEqual(["LO-C3-MATH-07-02", "LO-C3-MATH-07-03"]);
    expect(t.objectives.every((o) => o.tagged && o.childCodes.length === 0)).toBe(true);
    expect(t.domains).toHaveLength(1);
    expect(t.domains[0].code).toBeNull();
  });

  it("PDF code line: level word from the labels; the guardian copy folds subs into their objective", () => {
    const words = { objectiveBn: "লক্ষ্য", subBn: "ধাপ" };
    const codes = ["LO-C2-MATH-07-03.2", "LO-C2-MATH-07-03.1", "LO-C2-MATH-07-05"];
    const staff = pdfCodeLine(codes, words, "STAFF", () => null);
    expect(staff).toBe("লক্ষ্য / ধাপ: 07-03.2 · 07-03.1 · 07-05");
    const parent = (c: string) => c.replace(/\.\d+$/, "");
    const guardian = pdfCodeLine(codes, words, "GUARDIAN", parent);
    expect(guardian).toBe("লক্ষ্য: 07-03 · 07-05");
    expect(guardian).not.toMatch(/\.\d/);
  });
});

describe("no mastery surface hard-codes the level word (D-#923 source scan, extended by OT-3)", () => {
  // The defaults live ONLY in shared/vocab.ts MASTERY_LEVEL_LABEL_DEFAULTS. App screens read
  // useMasteryLevelLabels ({domain}/{objective}/{sub} placeholders in labels.ts), the server's
  // PDFs / notifications / guardian payloads read masteryLevelLabels().
  const WORD = "শিখনফল";
  const app = path.resolve(__dirname, "../../../app/src");
  const srv = path.resolve(__dirname, "../modules/mastery");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  };

  it("mastery screens, guardian mastery screens and the server's PDF / notice / guardian files", () => {
    const files = [
      ...walk(path.join(app, "screens/mastery")),
      ...fs.readdirSync(path.join(app, "screens/guardian")).filter((f) => f.startsWith("ChildMastery")).map((f) => path.join(app, "screens/guardian", f)),
      path.join(srv, "notify.ts"),
      path.join(srv, "rollup.ts"),
      path.join(srv, "services/MasteryAssignmentService.ts"),
      path.join(srv, "services/MasteryGuardianService.ts"),
      path.join(srv, "services/MasteryRollupService.ts"),
      path.join(srv, "resolvers/masteryGuardian.ts"),
    ];
    expect(files.filter((f) => fs.readFileSync(f, "utf8").includes(WORD))).toEqual([]);
  });

  it("no mastery string (ms* / gpMs*) in labels.ts carries the word", () => {
    const lines = fs.readFileSync(path.join(app, "lib/labels.ts"), "utf8").split(/\r?\n/);
    expect(lines.filter((l) => /^\s+(ms|gpMs)[A-Za-z0-9]*:\s*"/.test(l) && l.includes(WORD))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
let yearId = "";
let prevYearId = "";
let sectionId = "";
let oldSectionId = "";
const sids: string[] = [];

const SUB_LABELS = ["কাঠির বান্ডিলে হাতে রাখা", "খাড়ায় হাতে রেখে যোগ", "দশক-একক আলাদা করা", "হাতে না রেখে খাড়া যোগ"];
const SUB_CODES = ["LO-C2-MATH-07-03.1", "LO-C2-MATH-07-03.2", "LO-C2-MATH-07-02.1", "LO-C2-MATH-07-02.2"];

function row(code: string, extra: Record<string, unknown>) {
  return {
    code, classToken: code.split("-")[1], subject: "MATH", chapterNumber: 7, strand: null, labelBn: code, sourceText: "",
    assess: "QUESTION", questionTypeCodes: ["QT-SOLVE"], status: "LOCKED", order: 0, ...extra,
  };
}

let paperSeq = 0;
/** One assessment: the given students' marks on one code, on one date. */
async function assess(code: string, ymd: string, marks: Record<number, number>, section = sectionId, year = yearId) {
  const paperId = new Types.ObjectId();
  paperSeq++;
  const at = new Date(`${ymd}T00:00:00Z`);
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((d.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
  await MasteryEvidence.insertMany(
    Object.entries(marks).map(([i, earned]) => ({
      studentId: new Types.ObjectId(sids[Number(i)]), sectionId: new Types.ObjectId(section), academicYearId: new Types.ObjectId(year),
      classToken: code.split("-")[1], subject: "MATH", loCode: code, chapterNumber: 7, source: "HW", paperId, itemNo: 1,
      qid: `Q-${paperSeq}`, earned, available: 2, signal: "NONE", at, week: `${d.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`,
    })),
  );
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [prev, year] = await AcademicYear.create([
    { label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") },
    { label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: true },
  ]);
  yearId = String(year._id);
  prevYearId = String(prev._id);
  const [c2] = await Class.create([{ level: 2, nameBn: "দ্বিতীয়", academicYearId: year._id }]);
  const [c1] = await Class.create([{ level: 1, nameBn: "প্রথম", academicYearId: prev._id }]);
  const [sec] = await Section.create([{ classId: c2._id, code: "A", nameBn: "ক" }]);
  const [old] = await Section.create([{ classId: c1._id, code: "A", nameBn: "ক" }]);
  sectionId = String(sec._id);
  oldSectionId = String(old._id);
  for (let i = 1; i <= 2; i++) {
    const [s] = await Student.create([{ schoolId: `OT3-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: c2._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }

  await MasteryDomain.create([{ subject: "MATH", code: "DOM-MATH-ADD", labelBn: "যোগ", order: 2, status: "LOCKED" }]);
  await MasteryOutcome.create([
    // Class 2 — the tree under test.
    row("LO-C2-MATH-07-02", { labelBn: "দুই অঙ্কের যোগ", level: "OBJECTIVE", tagged: false, domainCode: "DOM-MATH-ADD", order: 1, homeTipBn: "দশটি করে কাঠি বেঁধে গুনতে দিন।" }),
    row("LO-C2-MATH-07-02.1", { labelBn: SUB_LABELS[2], level: "SUB", parentCode: "LO-C2-MATH-07-02", tagged: true, domainCode: "DOM-MATH-ADD", order: 2 }),
    row("LO-C2-MATH-07-02.2", { labelBn: SUB_LABELS[3], level: "SUB", parentCode: "LO-C2-MATH-07-02", tagged: true, domainCode: "DOM-MATH-ADD", order: 3 }),
    row("LO-C2-MATH-07-03", { labelBn: "হাতে রেখে যোগ", level: "OBJECTIVE", tagged: false, domainCode: "DOM-MATH-ADD", order: 4, homeTipBn: "খেজুর দশটি করে বেঁধে হাতে রাখা দেখান।" }),
    row("LO-C2-MATH-07-03.1", { labelBn: SUB_LABELS[0], level: "SUB", parentCode: "LO-C2-MATH-07-03", tagged: true, domainCode: "DOM-MATH-ADD", order: 5 }),
    row("LO-C2-MATH-07-03.2", {
      labelBn: SUB_LABELS[1], level: "SUB", parentCode: "LO-C2-MATH-07-03", tagged: true, domainCode: "DOM-MATH-ADD", order: 6,
      prereqCodes: ["LO-C2-MATH-07-02.1", "LO-C1-MATH-07-03.2", "LO-C1-MATH-07-04"],
    }),
    row("LO-C2-MATH-07-05", { labelBn: "গল্পে যোগ", level: "OBJECTIVE", tagged: true, domainCode: "DOM-MATH-ADD", order: 7, homeTipBn: "বাজারের হিসাব মুখে করতে দিন।" }),
    // Class 1 — last year's rungs of the ladder.
    row("LO-C1-MATH-07-03", { labelBn: "হাতে রেখে যোগ (১ম)", level: "OBJECTIVE", tagged: false, domainCode: "DOM-MATH-ADD", order: 1 }),
    row("LO-C1-MATH-07-03.1", { labelBn: "বান্ডিল বোঝা (১ম)", level: "SUB", parentCode: "LO-C1-MATH-07-03", tagged: true, domainCode: "DOM-MATH-ADD", order: 2 }),
    row("LO-C1-MATH-07-03.2", { labelBn: "৯৯ পর্যন্ত হাতে রেখে যোগ", level: "SUB", parentCode: "LO-C1-MATH-07-03", tagged: true, domainCode: "DOM-MATH-ADD", order: 3 }),
    row("LO-C1-MATH-07-04", { labelBn: "গল্প শুনে যোগ", level: "OBJECTIVE", tagged: true, domainCode: "DOM-MATH-ADD", order: 4 }),
  ]);
  await setEnablement(yearId, "C2", "MATH", true, PRINCIPAL);

  // Student 1 (index 0): 07-03.2 WEAK, 07-03.1 MASTERED, 07-02.1 MASTERED, 07-02.2 none, 07-05 MASTERED.
  // Student 2 (index 1): 07-03.2 MASTERED, 07-03.1 MASTERED.
  await assess("LO-C2-MATH-07-03.2", "2035-03-05", { 0: 0, 1: 2 });
  await assess("LO-C2-MATH-07-03.2", "2035-03-13", { 0: 0, 1: 2 });
  await assess("LO-C2-MATH-07-03.1", "2035-03-05", { 0: 2, 1: 2 });
  await assess("LO-C2-MATH-07-03.1", "2035-03-13", { 0: 2, 1: 2 });
  await assess("LO-C2-MATH-07-02.1", "2035-02-19", { 0: 2 });
  await assess("LO-C2-MATH-07-02.1", "2035-02-27", { 0: 2 });
  await assess("LO-C2-MATH-07-05", "2035-03-05", { 0: 2 });
  await assess("LO-C2-MATH-07-05", "2035-03-13", { 0: 2 });
  // Last year, in Class 1: Student 1 secured the carrying step.
  await assess("LO-C1-MATH-07-03.2", "2034-05-04", { 0: 2 }, oldSectionId, prevYearId);
  await assess("LO-C1-MATH-07-03.2", "2034-05-12", { 0: 2 }, oldSectionId, prevYearId);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

describe("student view (DB)", () => {
  it("tagged rows only; objectives roll up; the domain counts its tagged rows", async () => {
    const d = await studentDiagnosis(sids[0], "MATH", TEACHER);
    expect(d.isTree).toBe(true);
    expect(d.outcomes.map((o) => o.loCode).sort()).toEqual([...SUB_CODES, "LO-C2-MATH-07-05"].sort());
    const state = (c: string) => d.outcomes.find((o) => o.loCode === c)!.state;
    expect(state("LO-C2-MATH-07-03.2")).toBe("WEAK");
    expect(state("LO-C2-MATH-07-03.1")).toBe("MASTERED");
    const obj = (c: string) => d.objectives.find((o) => o.code === c)!;
    // Children WEAK + MASTERED ⇒ WEAK; MASTERED + not assessed ⇒ MASTERED (§10 item 8).
    expect(obj("LO-C2-MATH-07-03").state).toBe("WEAK");
    expect(obj("LO-C2-MATH-07-03").weakChildCodes).toEqual(["LO-C2-MATH-07-03.2"]);
    expect(obj("LO-C2-MATH-07-02").state).toBe("MASTERED");
    expect(obj("LO-C2-MATH-07-05")).toMatchObject({ tagged: true, state: "MASTERED", childCodes: [] });
    expect(d.domains).toHaveLength(1);
    expect(d.domains[0]).toMatchObject({ code: "DOM-MATH-ADD", labelBn: "যোগ", state: "WEAK" });
    expect(d.domains[0].summary).toMatchObject({ total: 5, assessed: 4, weak: 1, mastered: 3, masteredPct: 60 });
  });

  it("earlier step on the WEAK sub-objective: same class MASTERED, last year's class read, missing ⇒ no data (§10 item 9)", async () => {
    const d = await studentDiagnosis(sids[0], "MATH", TEACHER);
    const weak = d.outcomes.find((o) => o.loCode === "LO-C2-MATH-07-03.2")!;
    expect(weak.earlierSteps).toEqual([
      { code: "LO-C2-MATH-07-02.1", labelBn: SUB_LABELS[2], classToken: "C2", crossClass: false, state: "MASTERED", noData: false },
      { code: "LO-C1-MATH-07-03.2", labelBn: "৯৯ পর্যন্ত হাতে রেখে যোগ", classToken: "C1", crossClass: true, state: "MASTERED", noData: false },
      { code: "LO-C1-MATH-07-04", labelBn: "গল্প শুনে যোগ", classToken: "C1", crossClass: true, state: null, noData: true },
    ]);
    // Only a WEAK row carries the hint.
    expect(d.outcomes.find((o) => o.loCode === "LO-C2-MATH-07-03.1")!.earlierSteps).toEqual([]);
    // Student 2 is MASTERED on it: no hint.
    const d2 = await studentDiagnosis(sids[1], "MATH", TEACHER);
    expect(d2.outcomes.find((o) => o.loCode === "LO-C2-MATH-07-03.2")!.earlierSteps).toEqual([]);
  });

  it("evidence trail: the same earlier steps, the objective and domain names, the objective's home tip", async () => {
    const t = await outcomeTrail(sids[0], "LO-C2-MATH-07-03.2", TEACHER);
    expect(t.outcome.state).toBe("WEAK");
    expect(t.outcome.earlierSteps.map((s) => [s.code, s.state, s.noData])).toEqual([
      ["LO-C2-MATH-07-02.1", "MASTERED", false],
      ["LO-C1-MATH-07-03.2", "MASTERED", false],
      ["LO-C1-MATH-07-04", null, true],
    ]);
    expect(t.parentLabelBn).toBe("হাতে রেখে যোগ");
    expect(t.domainLabelBn).toBe("যোগ");
    expect(t.outcome.homeTipBn).toBe("খেজুর দশটি করে বেঁধে হাতে রাখা দেখান।");
  });
});

describe("section heat-map and the proposal (DB)", () => {
  it("objective and domain columns roll up; tagged columns name their objective", async () => {
    const h = await sectionHeatmap(sectionId, "MATH", TEACHER);
    expect(h.isTree).toBe(true);
    expect(h.outcomes.every((o) => o.level === "TAGGED")).toBe(true);
    const sub = h.outcomes.find((o) => o.loCode === "LO-C2-MATH-07-03.2")!;
    expect(sub).toMatchObject({ parentCode: "LO-C2-MATH-07-03", parentLabelBn: "হাতে রেখে যোগ", weak: 1, verdicts: 2, weakPct: 50, triggered: true });
    expect(h.notYetAssessed).toBe(1); // 07-02.2
    const obj = h.objectiveColumns.find((o) => o.loCode === "LO-C2-MATH-07-03")!;
    expect(obj.cells.map((c) => c.state)).toEqual(["WEAK", "MASTERED"]);
    expect(obj).toMatchObject({ level: "OBJECTIVE", weak: 1, verdicts: 2, triggered: true, weakChildCodes: ["LO-C2-MATH-07-03.2"] });
    expect(h.objectiveColumns.find((o) => o.loCode === "LO-C2-MATH-07-02")!.cells.map((c) => c.state)).toEqual(["MASTERED", "NOT_ASSESSED"]);
    expect(h.domainColumns).toHaveLength(1);
    expect(h.domainColumns[0]).toMatchObject({ level: "DOMAIN", loCode: "DOM-MATH-ADD", labelBn: "যোগ" });
    expect(h.domainColumns[0].cells.map((c) => c.state)).toEqual(["WEAK", "MASTERED"]);
  });

  it("the trigger stays on the tagged row; the proposal names the parent objective and lists the weak children", async () => {
    expect(await evaluateSectionTriggers(new Types.ObjectId(sectionId), "MATH")).toBe(1);
    const { MasteryAction } = await import("../modules/mastery/models/MasteryAction");
    const a = await MasteryAction.findOne({ sectionId: new Types.ObjectId(sectionId) }).lean();
    expect(a!.loCode).toBe("LO-C2-MATH-07-03.2");
    const detail = await actionDetail(String(a!._id), PRINCIPAL);
    expect(detail).toMatchObject({ isSub: true, objectiveCode: "LO-C2-MATH-07-03", objectiveLabelBn: "হাতে রেখে যোগ", labelBn: SUB_LABELS[1] });
    expect(detail.weakChildren.map((c) => c.code)).toEqual(["LO-C2-MATH-07-03.2"]);
  });
});

describe("guardians see the objective grain only (D-#925, §10 item 8)", () => {
  const assertNoSub = (payload: unknown) => {
    const json = JSON.stringify(payload);
    for (const c of SUB_CODES) expect(json).not.toContain(c);
    expect(json).not.toMatch(/LO-C\d-[A-Z]+-\d{2}-\d{2}\.\d/);
    for (const l of SUB_LABELS) expect(json).not.toContain(l);
  };

  it("progress payload: objective labels + home tips, rolled up; no sub-objective code or label", async () => {
    const [math] = await childMasteryProgress(sids[0]);
    expect(math.subject).toBe("MATH");
    expect(math.attention).toEqual([{ labelBn: "হাতে রেখে যোগ", homeTipBn: "খেজুর দশটি করে বেঁধে হাতে রাখা দেখান।" }]);
    // 07-02 (rolled up MASTERED) and 07-05 count as "good"; 07-03 as attention.
    expect(math.counts).toEqual({ attention: 1, improving: 0, good: 2, unknown: 0 });
    expect(math.levelWordBn).toBe("শিখনফল");
    assertNoSub(math);
  });

  it("objectiveGrain folds a sub-objective into its objective; a guardian notice never names the sub", async () => {
    const g = await objectiveGrain(["LO-C2-MATH-07-03.2", "LO-C2-MATH-07-05"]);
    expect(g.get("LO-C2-MATH-07-03.2")).toEqual({ code: "LO-C2-MATH-07-03", labelBn: "হাতে রেখে যোগ", homeTipBn: "খেজুর দশটি করে বেঁধে হাতে রাখা দেখান।" });
    expect(g.get("LO-C2-MATH-07-05")!.code).toBe("LO-C2-MATH-07-05");
    const n = await outcomeNaming("LO-C2-MATH-07-03.2");
    expect(n.staffBn).toBe(`শিখনফল: হাতে রেখে যোগ › উপ-শিখনফল: ${SUB_LABELS[1]}`);
    expect(n.guardianBn).toBe("শিখনফল: হাতে রেখে যোগ");
    assertNoSub({ guardian: n.guardianBn });
  });

  it("renaming the objective word in পলিসি reaches the guardian payload, the notices and the PDF code line (§10 item 7)", async () => {
    await saveLevelLabels({ objectiveBn: "লক্ষ্য", subBn: "ধাপ" }, PRINCIPAL);
    try {
      const [math] = await childMasteryProgress(sids[0]);
      expect(math.levelWordBn).toBe("লক্ষ্য");
      const n = await outcomeNaming("LO-C2-MATH-07-03.2");
      expect(n.guardianBn).toBe("লক্ষ্য: হাতে রেখে যোগ");
      expect(n.staffBn).not.toContain("শিখনফল");
      const line = pdfCodeLine(["LO-C2-MATH-07-03.2"], await masteryLevelLabels(), "STAFF", () => null);
      expect(line).toBe("লক্ষ্য / ধাপ: 07-03.2");
    } finally {
      await saveLevelLabels({ objectiveBn: "", subBn: "" }, PRINCIPAL);
    }
  });
});

describe("leader dashboard — school roll-up (DB)", () => {
  it("per switched-on tree class: domain cells, objective students, tagged rows; approvers only", async () => {
    const r = await schoolRollup("MATH", PRINCIPAL);
    expect(r.subjects).toEqual(["MATH"]);
    expect(r.classes).toHaveLength(1);
    const c = r.classes[0];
    expect(c).toMatchObject({ classToken: "C2", sections: 1, students: 2 });
    // 5 tagged rows × 2 students = 10 cells; WEAK 1 (S1 07-03.2); MASTERED 5 (S1 ×3, S2 ×2).
    expect(c.domains[0].summary).toMatchObject({ total: 10, assessed: 6, weak: 1, mastered: 5 });
    const obj = c.objectives.find((o) => o.code === "LO-C2-MATH-07-03")!;
    expect(obj.summary).toMatchObject({ total: 2, weak: 1, mastered: 1 });
    expect(c.rows.find((x) => x.code === "LO-C2-MATH-07-03.2")!.parentCode).toBe("LO-C2-MATH-07-03");
    await expect(schoolRollup("MATH", TEACHER)).rejects.toThrow(/অনুমতি/);
  });
});
