/**
 * Objective tree OT-4 — the question bank (docs/prd-objective-tree.md §8.2, §10 item 10;
 * D-#926 one code per question + ক/খ parts, D-#928 refuse untagged once locked).
 *
 * Parts (pure)  — a stem's parts sit together in authored order, print under one number as
 *                 4(ক), 4(খ); a lone part prints as a plain number under its stem.
 * Before lock   — the D-#785 warning is unchanged (unknown / DRAFT / grouping code imports).
 * After lock    — the REAL harness + importEnvelope: two codes, none, an unknown code, a grouping
 *                 (untagged) row or a retired code is refused with the reason; a tagged code
 *                 imports clean.
 * Flat list     — a flat locked catalogue with no review round (the dev C3 MATH seed shape)
 *                 keeps the warning: nothing is refused.
 * ক/খ pair      — a stimulus + two single-code questions built by build_question_envelopes.py
 *                 import cleanly after lock; a work sheet stores them as ক/খ under one stem; the
 *                 assignment PDF prints them ২(ক), ২(খ); the sent paper records the labels.
 * Coverage      — gold questions per tagged row, zero rows counted, untagged rows left out, the
 *                 gaps written as a brief; the read is gated on reports:bank_coverage (or the
 *                 module doors).
 *
 * In-memory MongoDB, real services, real Python harness and bank builder.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import PDFDocument from "pdfkit";
import { graphql, type ExecutionResult } from "graphql";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryCatalogueReview } from "../modules/mastery/models/MasteryCatalogueReview";
import { MasteryAssignment } from "../modules/mastery/models/MasteryAssignment";
import { MasteryAssignmentSheet } from "../modules/mastery/models/MasteryAssignmentSheet";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { importCatalogue, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { createPaper } from "../modules/mastery/services/MasteryWorkService";
import { renderAssignmentPdf, sendAssignment } from "../modules/mastery/services/MasteryAssignmentService";
import { bankCoverage } from "../modules/mastery/services/MasteryBankCoverageService";
import { importEnvelope, importQuestionBatch } from "../modules/content/services/ContentService";
import { masteryImportCheck } from "../modules/mastery/bank";
import { groupStimulusParts, partLabelsByItem, printLabel, printPlan } from "../modules/mastery/parts";
import { builder } from "../schema";
// The schema needs a Mutation type to build; the catalogue resolvers bring one.
import "../modules/mastery/resolvers/masteryCatalogue";
import "../modules/mastery/resolvers/masteryBankCoverage";

jest.setTimeout(180_000);

const REPO = path.resolve(__dirname, "../../..");
const PYTHON = process.env.PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3");
const DOCS = path.join(REPO, "docs/mastery/objective-tree");
const TREE_TEXT = fs.readFileSync(path.join(DOCS, "C1_MATH.tree.json"), "utf8");
const DOMAINS_TEXT = fs.readFileSync(path.join(DOCS, "domains/MATH.json"), "utf8");
const CASE = JSON.parse(fs.readFileSync(path.join(REPO, "server/import/cases/lo-codes/pass_lo_sub_code.json"), "utf8")) as Record<string, any>;

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };

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
  jest.restoreAllMocks();
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
});

const importTree = () => importCatalogue(TREE_TEXT, true, PRINCIPAL, DOMAINS_TEXT);

/** Stand-in for the OT-2 lock: round LOCKED, every non-rejected DRAFT row LOCKED. */
async function simulateLock(classToken = "C1", subject = "MATH"): Promise<void> {
  await MasteryCatalogueReview.updateMany({ classToken, subject, state: "OPEN" }, { $set: { state: "LOCKED", lockedAt: new Date() } });
  await MasteryOutcome.updateMany(
    { classToken, subject, status: "DRAFT", reviewState: { $ne: "REJECTED" } },
    { $set: { status: "LOCKED", lockedAt: new Date() } },
  );
}

/** A C1 MATH question envelope (the harness case, re-addressed). `codes` null ⇒ no lo_codes. */
function question(qid: string, topic: string, codes: string[] | null = [topic], classLevel = 1): Record<string, any> {
  const env = JSON.parse(JSON.stringify(CASE)) as Record<string, any>;
  env.class_level = classLevel;
  env.address = { anchor_word: "অধ্যায়", number: 7, title: "যোগ" };
  env.payload.qid = qid;
  env.payload.topic_tag = topic;
  env.tags.topic_tag = topic;
  if (codes) {
    env.payload.lo_codes = codes;
    env.tags.lo_codes = codes;
  } else {
    delete env.payload.lo_codes;
    delete env.tags.lo_codes;
  }
  return env;
}

const fails = (r: { failChecks: string[] }) => r.failChecks.join("\n");
const loWarnings = (r: { warnings: string[] }) => r.warnings.filter((w) => w.includes("MASTERY-LO"));

// ---------------------------------------------------------------------------

describe("ক/খ parts (pure, D-#926)", () => {
  const it3 = (qid: string | null, stimulusRef: string | null) => ({ qid, stimulusRef });

  it("a stem's parts move up beside its first part, in authored (qid) order", () => {
    const items = [it3("Q-A", null), it3("Q-S2", "STIM-1"), it3("Q-B", null), it3("Q-S1", "STIM-1")];
    expect(groupStimulusParts(items).map((i) => i.qid)).toEqual(["Q-A", "Q-S1", "Q-S2", "Q-B"]);
  });

  it("parts of one stem share a number and print 4(ক), 4(খ); a lone part is a plain number", () => {
    const plan = printPlan([it3("a", null), it3("b", null), it3("c", null), it3("s1", "STIM-1"), it3("s2", "STIM-1"), it3("x", "STIM-2")]);
    expect(plan.map((l) => printLabel(l.no, l.partLabel))).toEqual(["1", "2", "3", "4(ক)", "4(খ)", "5"]);
    expect(plan.map((l) => l.startsGroup)).toEqual([true, true, true, true, false, true]);
    expect(plan[5]).toMatchObject({ stimulusRef: "STIM-2", partLabel: null });
    // Part B continues Part A's numbers.
    expect(printPlan([it3("p", "STIM-1"), it3("q", "STIM-1")], 2).map((l) => printLabel(l.no, l.partLabel))).toEqual(["3(ক)", "3(খ)"]);
  });

  it("paper labels: only a stem with two or more parts on the paper is lettered", () => {
    expect(partLabelsByItem([it3("a", "S1"), it3("b", null), it3("c", "S1"), it3("d", "S2")])).toEqual(["ক", null, "খ", null]);
  });
});

describe("before the list is locked: the D-#785 warning is unchanged", () => {
  it("a grouping code, an unknown code and a legacy topic all import (warnings only)", async () => {
    await importTree();
    const grouping = await importEnvelope(question("QP-MATH-C1-U07-Q90101", "LO-C1-MATH-07-03"), PRINCIPAL.userId);
    expect(grouping.verdict).toBe("PASS");
    expect(loWarnings(grouping).join("\n")).toMatch(/LO-C1-MATH-07-03 is still DRAFT/);

    const unknown = await importEnvelope(question("QP-MATH-C1-U07-Q90102", "LO-C1-MATH-07-09"), PRINCIPAL.userId);
    expect(unknown.verdict).toBe("PASS");
    expect(loWarnings(unknown).join("\n")).toMatch(/LO-C1-MATH-07-09 is not in the mastery catalogue/);

    const legacy = await importEnvelope(question("QP-MATH-C1-U07-Q90103", "TOP-MATH-C1-05", null), PRINCIPAL.userId);
    expect(legacy.verdict).toBe("PASS");
    expect(loWarnings(legacy)).toEqual([]);
  });
});

describe("after the list is locked: refuse untagged (D-#928, §10 item 10)", () => {
  beforeEach(async () => {
    await importTree();
    await simulateLock();
  });

  it("a grouping (untagged) row is refused, naming its tagged rows", async () => {
    const r = await importEnvelope(question("QP-MATH-C1-U07-Q90201", "LO-C1-MATH-07-03"), PRINCIPAL.userId);
    expect(r.verdict).toBe("FAIL");
    expect(fails(r)).toMatch(/\[MASTERY-LO\] LO-C1-MATH-07-03 is a grouping row \(untagged\).*LO-C1-MATH-07-03\.1, LO-C1-MATH-07-03\.2/);
    expect(fails(r)).toMatch(/D-#928: the C1 MATH objective list is locked/);
    expect(await ContentArtifact.countDocuments({ docType: "question" })).toBe(0);
  });

  it("a question with no code (legacy topic only) is refused", async () => {
    const r = await importEnvelope(question("QP-MATH-C1-U07-Q90202", "TOP-MATH-C1-05", null), PRINCIPAL.userId);
    expect(r.verdict).toBe("FAIL");
    expect(fails(r)).toMatch(/carries no objective code/);
  });

  it("an unknown code is refused", async () => {
    const r = await importEnvelope(question("QP-MATH-C1-U07-Q90203", "LO-C1-MATH-07-09"), PRINCIPAL.userId);
    expect(r.verdict).toBe("FAIL");
    expect(fails(r)).toMatch(/LO-C1-MATH-07-09 is not in the C1 MATH objective list/);
  });

  it("two codes are refused (the harness, D-#926 maxItems 1; the app check says why too)", async () => {
    const two = question("QP-MATH-C1-U07-Q90204", "LO-C1-MATH-07-03.1", ["LO-C1-MATH-07-03.1", "LO-C1-MATH-07-03.2"]);
    const r = await importEnvelope(two, PRINCIPAL.userId);
    expect(r.verdict).toBe("FAIL");
    expect(r.failChecks.length).toBeGreaterThan(0);
    expect((await masteryImportCheck(two)).refusals.join("\n")).toMatch(/carries 2 codes .*one code per question \(D-#926\)/);
  });

  it("a retired code is refused; a tagged code imports clean", async () => {
    await MasteryOutcome.updateOne({ code: "LO-C1-MATH-07-04" }, { $set: { status: "RETIRED", retiredAt: new Date() } });
    const retired = await importEnvelope(question("QP-MATH-C1-U07-Q90205", "LO-C1-MATH-07-04"), PRINCIPAL.userId);
    expect(retired.verdict).toBe("FAIL");
    expect(fails(retired)).toMatch(/LO-C1-MATH-07-04 is RETIRED/);

    const ok = await importEnvelope(question("QP-MATH-C1-U07-Q90206", "LO-C1-MATH-07-03.2"), PRINCIPAL.userId);
    expect(ok.verdict).toBe("PASS");
    expect(loWarnings(ok)).toEqual([]);
    // A tagged objective with no children is a tagged row too.
    const leaf = await importEnvelope(question("QP-MATH-C1-U07-Q90207", "LO-C1-MATH-07-02"), PRINCIPAL.userId);
    expect(leaf.verdict).toBe("PASS");
  });

  it("another class × subject is untouched by C1 MATH's lock", async () => {
    const c3 = question("QP-MATH-C3-U07-Q90208", "LO-C3-MATH-07-03", ["LO-C3-MATH-07-03"], 3);
    const r = await importEnvelope(c3, PRINCIPAL.userId);
    expect(r.verdict).toBe("PASS");
    expect(loWarnings(r).join("\n")).toMatch(/not in the mastery catalogue/);
  });
});

describe("a flat locked catalogue with no review round keeps the warning (dev C3 MATH seed)", () => {
  it("nothing is refused", async () => {
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
      PRINCIPAL,
    );
    const legacy = await importEnvelope(question("QP-MATH-C3-U07-Q90301", "TOP-MATH-C3-05", null, 3), PRINCIPAL.userId);
    expect(legacy.verdict).toBe("PASS");
    const unknown = await importEnvelope(question("QP-MATH-C3-U07-Q90302", "LO-C3-MATH-07-09", ["LO-C3-MATH-07-09"], 3), PRINCIPAL.userId);
    expect(unknown.verdict).toBe("PASS");
    expect(loWarnings(unknown).join("\n")).toMatch(/not in the mastery catalogue/);
    const known = await importEnvelope(question("QP-MATH-C3-U07-Q90303", "LO-C3-MATH-07-03", ["LO-C3-MATH-07-03"], 3), PRINCIPAL.userId);
    expect(known.verdict).toBe("PASS");
    expect(loWarnings(known)).toEqual([]);
  });
});

describe("a stimulus + ক/খ pair (D-#926, §10 item 10)", () => {
  const STEM = "STIM-MATH-C1-U07-01";
  const STEM_TEXT = "রিমার কাছে ১৮টি কাঠি আছে। সে আরও ৭টি কাঠি পেল।";

  /** The real producer path: a {stimuli, questions} bank → build_question_envelopes.py --batch. */
  function bankBatch(): Record<string, any> {
    const part = (qid: string, code: string, text: string) => {
      const p = JSON.parse(JSON.stringify(CASE.payload)) as Record<string, any>;
      return { ...p, qid, topic_tag: code, lo_codes: [code], question_text: text, stimulus_ref: STEM };
    };
    const bank = {
      stimuli: [{ stimulus_id: STEM, stimulus_type: "passage", title: "কাঠির হিসাব", content: STEM_TEXT }],
      questions: [
        part("QP-MATH-C1-U07-Q01", "LO-C1-MATH-07-03.1", "দশটি করে বান্ডিল বানালে কয়টি বান্ডিল ও কয়টি খোলা কাঠি থাকবে?"),
        part("QP-MATH-C1-U07-Q02", "LO-C1-MATH-07-03.2", "খাড়ায় হাতে রেখে যোগ করে মোট কাঠি বের করো।"),
      ],
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scd_ot4_"));
    const bankPath = path.join(dir, "C1_MATH_U07_QuestionBank_v1.json");
    fs.writeFileSync(bankPath, JSON.stringify(bank), "utf8");
    const out = execFileSync(
      PYTHON,
      [
        path.join(REPO, "server/import/build_question_envelopes.py"),
        "--json", bankPath,
        "--curation-tag", "KEEP_AS_IS",
        "--envelope-schema", path.join(REPO, "docs/import-contract.schema.json"),
        "--author", "ot4-test",
        "--batch",
      ],
      { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return JSON.parse(out) as Record<string, any>;
  }

  it("imports cleanly after lock, is stored as ক/খ on a work sheet, prints ২(ক)/২(খ) and the sent paper keeps the labels", async () => {
    await importTree();
    await simulateLock();

    const res = await importQuestionBatch(bankBatch(), PRINCIPAL.userId);
    expect(res.verdict).toBe("PASS");
    expect(res.itemsFailed).toBe(0);
    expect(res.itemsPassed).toBe(3);
    expect(res.warnings.some((w) => w.includes("MASTERY-LO"))).toBe(false);

    // Gold them (the QR loop's outcome) and set up a section with the add-on on.
    await ContentArtifact.updateMany({ docType: "question" }, { $set: { reviewStatus: "gold" } });
    const arts = await ContentArtifact.find({ docType: "question" }).lean();
    const idOf = new Map(arts.map((a) => [(a.envelopeJson as any).payload.qid as string, String(a._id)]));
    const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
    const [cls] = await Class.create([{ level: 1, nameBn: "প্রথম", academicYearId: year._id }]);
    const [sec] = await Section.create([{ classId: cls._id, code: "A", nameBn: "ক" }]);
    const [st] = await Student.create([{ schoolId: "OT4-1", name: "Student 1", rollNumber: "1", classId: cls._id, sectionId: sec._id, active: true }]);
    await setEnablement(String(year._id), "C1", "MATH", true, PRINCIPAL);

    // Work sheet: part খ picked first, a teacher item, then part ক — the parts end up together, ক first.
    const paper = await createPaper(
      {
        sectionId: String(sec._id),
        subject: "MATH",
        source: "HW",
        date: "2027-03-08",
        items: [
          { origin: "BANK", artifactId: idOf.get("QP-MATH-C1-U07-Q02"), loCode: "LO-C1-MATH-07-03.2", questionTypeCode: "QT-SOLVE" },
          { origin: "TEACHER", textBn: "৫ + ০ = ?", loCode: "LO-C1-MATH-07-01.2", questionTypeCode: "QT-SOLVE" },
          { origin: "BANK", artifactId: idOf.get("QP-MATH-C1-U07-Q01"), loCode: "LO-C1-MATH-07-03.1", questionTypeCode: "QT-SOLVE" },
        ],
      },
      PRINCIPAL,
    );
    expect(paper.items.map((i) => [i.itemNo, i.qid ?? "teacher", i.partLabel, i.stimulusRef])).toEqual([
      [1, "QP-MATH-C1-U07-Q01", "ক", STEM],
      [2, "QP-MATH-C1-U07-Q02", "খ", STEM],
      [3, "teacher", null, null],
    ]);
    // Never two codes on one item.
    expect(paper.items.every((i) => i.loCodes.length === 1)).toBe(true);

    // The assignment PDF: a plain question, then the stem with its two parts.
    const bankItem = (qid: string, loCode: string) => ({
      origin: "BANK" as const, artifactId: new Types.ObjectId(idOf.get(qid)), qid, loCode, chapterNumber: 7,
      questionTypeCode: "QT-SOLVE", marks: 1, band: "WEAK" as const, stimulusRef: STEM,
    });
    const a = await MasteryAssignment.create({
      sectionId: sec._id, classId: cls._id, academicYearId: year._id, classToken: "C1", subject: "MATH",
      dueDate: new Date("2027-03-18"), week: "2027-W11", status: "DRAFT", builtAt: new Date(), builtBy: new Types.ObjectId(PRINCIPAL.userId),
      layout: { totalMarks: 3, minutes: 30, partAOn: false, partAMarks: 0, partALoCodes: [], partBMarks: 3, mixWeak: 100, mixImproving: 0, mixRevision: 0, questionTypeCodes: [] },
      partA: [],
    });
    await MasteryAssignmentSheet.create({
      assignmentId: a._id, studentId: st._id, status: "APPROVED",
      items: [
        { origin: "TEACHER", textBn: "৫ + ০ = ?", loCode: "LO-C1-MATH-07-01.2", chapterNumber: 7, questionTypeCode: "QT-SOLVE", marks: 1, band: "TEACHER" },
        bankItem("QP-MATH-C1-U07-Q01", "LO-C1-MATH-07-03.1"),
        bankItem("QP-MATH-C1-U07-Q02", "LO-C1-MATH-07-03.2"),
      ],
    });
    const printed: string[] = [];
    const proto = PDFDocument.prototype as unknown as { text: (...args: unknown[]) => unknown };
    const original = proto.text;
    jest.spyOn(proto, "text").mockImplementation(function (this: unknown, ...args: unknown[]) {
      if (typeof args[0] === "string") printed.push(args[0]);
      return original.apply(this, args);
    });
    const pdf = await renderAssignmentPdf(String(a._id), String(st._id), PRINCIPAL);
    expect(pdf.pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(printed).toEqual(expect.arrayContaining(["১.", "২.", "২(ক)", "২(খ)"]));
    expect(printed).not.toContain("৩.");
    expect(printed.join("")).toContain("রিমার কাছে");

    // Sending writes one AS paper; its items record the part labels.
    await sendAssignment(String(a._id), PRINCIPAL);
    const as = await MasteryPaper.findOne({ source: "AS" }).lean();
    expect(as!.items.map((i) => [i.qid ?? "teacher", i.partLabel ?? null, i.stimulusRef ?? null])).toEqual([
      ["teacher", null, null],
      ["QP-MATH-C1-U07-Q01", "ক", STEM],
      ["QP-MATH-C1-U07-Q02", "খ", STEM],
    ]);
  });
});

describe("coverage (mock 5)", () => {
  const gold = (qid: string, code: string, reviewStatus = "gold") =>
    ContentArtifact.create({
      docType: "question", subject: "MATH", classLevel: 1, address: { anchorWord: "অধ্যায়", number: 7 },
      curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus,
      envelopeJson: { tags: { topic_tag: code, lo_codes: [code] }, payload: { qid, topic_tag: code, lo_codes: [code] } },
    });

  it("counts gold per tagged row, leaves grouping rows out, and writes the gaps as a brief", async () => {
    await importTree();
    expect((await bankCoverage("C1", "MATH")).locked).toBe(false);
    await simulateLock();
    await gold("QP-MATH-C1-U07-Q01", "LO-C1-MATH-07-03.2");
    await gold("QP-MATH-C1-U07-Q02", "LO-C1-MATH-07-03.2");
    await gold("QP-MATH-C1-U07-Q03", "LO-C1-MATH-07-02");
    await gold("QP-MATH-C1-U07-Q04", "LO-C1-MATH-07-03.1", "draft");

    const v = await bankCoverage("C1", "MATH");
    expect(v.pairs).toEqual([{ classToken: "C1", subject: "MATH", locked: true }]);
    expect(v.locked).toBe(true);
    const row = (code: string) => v.rows.find((r) => r.code === code);
    expect(row("LO-C1-MATH-07-03")).toBeUndefined(); // grouping row
    expect(row("LO-C1-MATH-07-03.2")).toMatchObject({ goldCount: 2, pendingCount: 0, level: "SUB", parentCode: "LO-C1-MATH-07-03" });
    expect(row("LO-C1-MATH-07-02")).toMatchObject({ goldCount: 1, level: "OBJECTIVE" });
    expect(row("LO-C1-MATH-07-03.1")).toMatchObject({ goldCount: 0, pendingCount: 1 });

    const tagged = await MasteryOutcome.find({ classToken: "C1", subject: "MATH" }).lean();
    const expected = tagged.filter((o) => o.tagged !== false && o.assess === "QUESTION").length;
    expect(v.totals).toMatchObject({ rows: expected, zeroRows: expected - 2, gold: 3 });

    expect(v.brief).toMatch(/^Question brief — C1 MATH, objective list locked/);
    expect(v.brief).toContain(`${expected - 2} of ${expected} tagged rows have no gold question`);
    expect(v.brief).toMatch(/- LO-C1-MATH-07-03\.1 · Sub-objective of LO-C1-MATH-07-03 \(হাতে রেখে যোগ\): .* · 1 already waiting in review/);
    expect(v.brief).not.toMatch(/- LO-C1-MATH-07-03\.2 /);
    expect(v.brief).not.toMatch(/- LO-C1-MATH-07-02 /);
  });

  it("no pair named ⇒ the first pair; no catalogue ⇒ an empty view", async () => {
    expect(await bankCoverage()).toMatchObject({ pairs: [], classToken: null, rows: [], brief: "" });
    await importTree();
    expect((await bankCoverage()).classToken).toBe("C1");
  });

  it("is gated on reports:bank_coverage or the module doors", async () => {
    const schema = builder.toSchema();
    const run = (role: string, grantedPermissions: string[] = []): Promise<ExecutionResult> =>
      graphql({
        schema,
        source: `query { masteryBankCoverage(classToken: "C1", subject: "MATH") { totals { rows } brief } }`,
        contextValue: { auth: { role, userId: new Types.ObjectId().toString(), grantedPermissions } },
      }) as Promise<ExecutionResult>;
    const refused = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;
    const ok = await run("PRINCIPAL");
    expect(ok.errors).toBeUndefined();
    expect(refused(await run("TEACHER"))).toBe(true);
    expect(refused(await run("OFFICE"))).toBe(true);
    expect(refused(await run("TEACHER", ["reports:bank_coverage"]))).toBe(false);
    expect(refused(await run("TEACHER", ["mastery:review"]))).toBe(false);
    expect(refused(await run("PRINCIPAL"))).toBe(false);
  });
});
