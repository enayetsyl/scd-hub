/**
 * PR-G — a bank question carries its school question type (docs/prd-bank-question-types.md).
 *
 * Pure   — `questionTypeCodeOf` reads a QT- code from `lesson_ref` and nothing else; the builder
 *          offers a typed question only as its own type (acceptance 1) and never to a layout that
 *          does not allow it (acceptance 3); an untyped / QCAT- question behaves as before; the
 *          open-extra-sheet `hardAvoid` still holds.
 * Import — before lock a QT- finding is a warning; after lock a type the objective does not
 *          allow, an inactive type, an unknown type or marks that differ from the table are
 *          refused with the reason (acceptance 2); QCAT-/no type imports as today.
 * Real   — items copied from a produced bank (C1_MATH_U07_bank_v1.json) import through the real
 *          harness after lock, `goldBank` reports their `qtCode`, and the builder picks them only
 *          as their QT type; `createPaper` refuses a different type.
 * Coverage — gold per objective × type, a "no type" cell, zero cells flagged, the CSV export
 *          (acceptance 4). The reviewer-queue and bank-list filters pin the QT code.
 *
 * In-memory MongoDB, real services, the real Python harness.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryCatalogueReview } from "../modules/mastery/models/MasteryCatalogueReview";
import { MasteryQuestionType } from "../modules/mastery/models/MasteryQuestionType";
import { importCatalogue, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { createPaper } from "../modules/mastery/services/MasteryWorkService";
import { goldBank } from "../modules/mastery/services/MasteryAssignmentService";
import { bankCoverage } from "../modules/mastery/services/MasteryBankCoverageService";
import { importEnvelope } from "../modules/content/services/ContentService";
import { masteryImportCheck, questionTypeCodeOf } from "../modules/mastery/bank";
import {
  buildPartA,
  buildPartB,
  pickTyped,
  typeOfQuestion,
  type BankQuestion,
  type BuilderContext,
  type BuilderLayout,
  type OutcomeInfo,
} from "../modules/mastery/assignmentBuilder";
import { noReviewerFilter } from "../modules/questions/services/QuestionReviewService";

jest.setTimeout(180_000);

const REPO = path.resolve(__dirname, "../../..");
const TREE_TEXT = fs.readFileSync(path.join(REPO, "docs/mastery/objective-tree/C1_MATH.tree.json"), "utf8");
const DOMAINS_TEXT = fs.readFileSync(path.join(REPO, "docs/mastery/objective-tree/domains/MATH.json"), "utf8");
const CASE = JSON.parse(fs.readFileSync(path.join(REPO, "server/import/cases/lo-codes/pass_lo_sub_code.json"), "utf8")) as Record<string, any>;
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/c1math_u07_qt_items.json"), "utf8")) as { items: Record<string, any>[] };
const [REAL_SOLVE_A, REAL_SOLVE_B, REAL_WORD] = REAL.items;

const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

describe("questionTypeCodeOf (pure)", () => {
  it("reads a QT- code from lesson_ref and nothing else", () => {
    expect(questionTypeCodeOf({ lesson_ref: "QT-LONG5" })).toBe("QT-LONG5");
    expect(questionTypeCodeOf({ lesson_ref: "QT-WRITE-NUM" })).toBe("QT-WRITE-NUM");
    expect(questionTypeCodeOf({ lesson_ref: "QCAT-BAN-FILL" })).toBeNull();
    expect(questionTypeCodeOf({ lesson_ref: "অধ্যায় ৭" })).toBeNull();
    expect(questionTypeCodeOf({ lesson_ref: "qt-fill" })).toBeNull();
    expect(questionTypeCodeOf({ lesson_ref: "QT-" })).toBeNull();
    expect(questionTypeCodeOf({})).toBeNull();
    expect(questionTypeCodeOf(null)).toBeNull();
  });
});

const LO: OutcomeInfo = { code: "LO-1", chapterNumber: 1, questionTypeCodes: ["QT-FILL", "QT-LONG5"] };
const MARKS = new Map([["QT-FILL", 1], ["QT-LONG5", 5]]);
function layout(over: Partial<BuilderLayout> = {}): BuilderLayout {
  return {
    partAOn: false, partAMarks: 0, partALoCodes: [], partBMarks: 5, mixWeak: 100, mixImproving: 0, mixRevision: 0,
    questionTypeCodes: [], ...over,
  };
}
const q = (qid: string, qtCode: string | null): BankQuestion => ({ artifactId: `a-${qid}`, qid, loCodes: ["LO-1"], textBn: qid, qtCode });
function ctx(bank: BankQuestion[], l: BuilderLayout): BuilderContext {
  return {
    outcomes: new Map([["LO-1", LO]]), taught: new Set(["LO-1"]), bank, marksOf: MARKS, exposure: new Map(), layout: l,
  };
}
const weak = new Map([["LO-1", { state: "WEAK", lastEvidenceAt: null, seenQids: [] as string[] }]]);

describe("typed pickers (pure)", () => {
  it("1. a QT-LONG5 question is picked only as QT-LONG5, with that type's marks; a QCAT- question behaves as before", () => {
    const typed = buildPartB(weak, ctx([q("Q-LONG", "QT-LONG5")], layout()));
    expect(typed.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([["Q-LONG", "QT-LONG5", 5]]);

    // QCAT- (qtCode null) → the largest allowed type that fits the room, exactly as before (5 marks left → QT-LONG5).
    const legacy = buildPartB(weak, ctx([q("Q-OLD", null)], layout({ partBMarks: 1 })));
    expect(legacy.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([["Q-OLD", "QT-FILL", 1]]);
    const legacyBig = buildPartB(weak, ctx([q("Q-OLD", null)], layout()));
    expect(legacyBig.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([["Q-OLD", "QT-LONG5", 5]]);
  });

  it("a typed 5-mark question is not squeezed into a 1-mark room (Part B)", () => {
    const r = buildPartB(weak, ctx([q("Q-LONG", "QT-LONG5"), q("Q-FILL", "QT-FILL")], layout({ partBMarks: 1 })));
    expect(r.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([["Q-FILL", "QT-FILL", 1]]);
  });

  it("3. a layout that allows only QT-FILL never receives a QT-LONG5 question", () => {
    const only = layout({ questionTypeCodes: ["QT-FILL"], partBMarks: 5, partAOn: true, partAMarks: 5, partALoCodes: ["LO-1"] });
    const c = ctx([q("Q-LONG", "QT-LONG5")], only);
    expect(buildPartB(weak, c).items).toEqual([]);
    expect(buildPartA([], 30, new Set(), c)).toEqual([]);
    // With a QT-FILL question beside it, only that one is used.
    const c2 = ctx([q("Q-LONG", "QT-LONG5"), q("Q-FILL", "QT-FILL")], only);
    expect(buildPartB(weak, c2).items.map((i) => i.qid)).toEqual(["Q-FILL"]);
    expect(buildPartA([], 30, new Set(), c2).every((i) => i.questionTypeCode === "QT-FILL")).toBe(true);
  });

  it("an objective that does not allow the carried type never offers the question", () => {
    expect(typeOfQuestion({ qtCode: "QT-MCQ" }, LO, { marksOf: new Map([["QT-MCQ", 1]]), layout: layout() })).toBeNull();
  });

  it("Part A: the type travels with the question, and hardAvoid (open extra sheet) still wins", () => {
    const l = layout({ partAOn: true, partAMarks: 5, partALoCodes: ["LO-1"], partBMarks: 0 });
    const c = ctx([q("Q-LONG", "QT-LONG5"), q("Q-FILL", "QT-FILL")], l);
    const a = buildPartA([], 30, new Set(), c);
    expect(a.map((i) => [i.qid, i.questionTypeCode])).toContainEqual(["Q-LONG", "QT-LONG5"]);
    const avoided = buildPartA([], 30, new Set(), c, new Set(["Q-LONG"]));
    expect(avoided.map((i) => i.qid)).not.toContain("Q-LONG");
  });

  it("pickTyped skips a candidate that cannot be offered and takes the next", () => {
    const c = ctx([q("A-LONG", "QT-LONG5"), q("B-FILL", "QT-FILL")], layout({ questionTypeCodes: ["QT-FILL"] }));
    const p = pickTyped(LO, new Set(), c);
    expect(p && [p.q.qid, p.qt]).toEqual(["B-FILL", "QT-FILL"]);
  });
});

describe("reviewer queue filter (pure)", () => {
  it("a QT code is a filter — the unfiltered path stays the plain find", () => {
    expect(noReviewerFilter({})).toBe(true);
    expect(noReviewerFilter({ qtCode: "QT-FILL" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB-backed
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
  jest.restoreAllMocks();
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
});

const importTree = () => importCatalogue(TREE_TEXT, true, PRINCIPAL, DOMAINS_TEXT);

async function simulateLock(classToken = "C1", subject = "MATH"): Promise<void> {
  await MasteryCatalogueReview.updateMany({ classToken, subject, state: "OPEN" }, { $set: { state: "LOCKED", lockedAt: new Date() } });
  await MasteryOutcome.updateMany(
    { classToken, subject, status: "DRAFT", reviewState: { $ne: "REJECTED" } },
    { $set: { status: "LOCKED", lockedAt: new Date() } },
  );
}

/** A C1 MATH envelope around a payload (the harness case, re-addressed). */
function envelopeOf(payload: Record<string, any>): Record<string, any> {
  const env = JSON.parse(JSON.stringify(CASE)) as Record<string, any>;
  env.class_level = 1;
  env.address = { anchor_word: "অধ্যায়", number: 7, title: "যোগ" };
  env.payload = JSON.parse(JSON.stringify(payload));
  env.tags = {
    topic_tag: payload.topic_tag,
    difficulty: payload.difficulty,
    bloom_level: payload.bloom_level,
    paper_role: payload.paper_role,
    lo_codes: payload.lo_codes,
  };
  return env;
}

/** The first real item, re-id'd, with its lesson_ref / marks / code overridden. */
function realWith(over: Record<string, any>): Record<string, any> {
  return envelopeOf({ ...REAL_SOLVE_A, ...over });
}

const qtLines = (r: { warnings: string[]; refusals: string[] }, kind: "warnings" | "refusals") => r[kind].filter((w) => w.includes("MASTERY-QT"));

describe("import check (acceptance 2)", () => {
  it("before lock the same findings are warnings; the question still imports", async () => {
    await importTree();
    // Not locked: an allowed type with the table's marks is silent.
    const clean = await masteryImportCheck(realWith({ qid: "QP-QT-1", lesson_ref: "QT-SOLVE" }));
    expect(clean.refusals).toEqual([]);
    expect([...qtLines(clean, "warnings"), ...qtLines(clean, "refusals")]).toEqual([]); // (the DRAFT-code LO warning is the old one)

    const notAllowed = await masteryImportCheck(realWith({ qid: "QP-QT-2", lesson_ref: "QT-FILL" }));
    expect(notAllowed.refusals).toEqual([]);
    expect(qtLines(notAllowed, "warnings").join("\n")).toMatch(/QT-FILL is not one of the question types LO-C1-MATH-07-01\.2 allows \(QT-SOLVE\)/);

    const unknown = await masteryImportCheck(realWith({ qid: "QP-QT-3", lesson_ref: "QT-NOPE" }));
    expect(unknown.refusals).toEqual([]);
    expect(qtLines(unknown, "warnings").join("\n")).toMatch(/QT-NOPE is not a question type of C1 MATH/);

    const marks = await masteryImportCheck(realWith({ qid: "QP-QT-4", lesson_ref: "QT-SOLVE", marks: 4 }));
    expect(marks.refusals).toEqual([]);
    expect(qtLines(marks, "warnings").join("\n")).toMatch(/marks \(4\) differ from QT-SOLVE's marks in the table \(1\)/);
  });

  it("after lock a type the objective does not allow, an inactive type, an unknown type or different marks are refused", async () => {
    await importTree();
    await simulateLock();

    const ok = await masteryImportCheck(realWith({ qid: "QP-QT-10", lesson_ref: "QT-SOLVE" }));
    expect(ok).toEqual({ warnings: [], refusals: [] });

    const notAllowed = await masteryImportCheck(realWith({ qid: "QP-QT-11", lesson_ref: "QT-FILL" }));
    expect(notAllowed.refusals.join("\n")).toMatch(/\[MASTERY-QT\] QT-FILL is not one of the question types LO-C1-MATH-07-01\.2 allows/);

    const unknown = await masteryImportCheck(realWith({ qid: "QP-QT-12", lesson_ref: "QT-NOPE" }));
    expect(unknown.refusals.join("\n")).toMatch(/QT-NOPE is not a question type of C1 MATH/);

    const marks = await masteryImportCheck(realWith({ qid: "QP-QT-13", lesson_ref: "QT-SOLVE", marks: 3 }));
    expect(marks.refusals.join("\n")).toMatch(/marks \(3\) differ from QT-SOLVE's marks in the table \(1\)/);

    await MasteryQuestionType.updateOne({ classToken: "C1", subject: "MATH", code: "QT-SOLVE" }, { $set: { active: false } });
    const inactive = await masteryImportCheck(realWith({ qid: "QP-QT-14", lesson_ref: "QT-SOLVE" }));
    expect(inactive.refusals.join("\n")).toMatch(/QT-SOLVE is an inactive question type of C1 MATH/);
  });

  it("a QCAT- value or no type at all is accepted exactly as today, before and after lock", async () => {
    await importTree();
    for (const lock of [false, true]) {
      if (lock) await simulateLock();
      for (const lesson_ref of ["QCAT-BAN-FILL", "অধ্যায় ৭", undefined]) {
        const p: Record<string, any> = { ...REAL_SOLVE_A, qid: `QP-QT-${lock}-${String(lesson_ref).length}` };
        if (lesson_ref === undefined) delete p.lesson_ref;
        else p.lesson_ref = lesson_ref;
        const r = await masteryImportCheck(envelopeOf(p));
        expect(r.refusals).toEqual([]);
        expect(qtLines(r, "warnings")).toEqual([]);
        if (lock) expect(r.warnings).toEqual([]);
      }
    }
  });
});

describe("real items from a produced bank", () => {
  async function importReal(payload: Record<string, any>) {
    return importEnvelope(envelopeOf(payload), PRINCIPAL.userId);
  }

  it("import through the harness after lock, carry qtCode, and are picked only as their QT type", async () => {
    await importTree();
    await simulateLock();

    for (const item of [REAL_SOLVE_A, REAL_SOLVE_B, REAL_WORD]) {
      const r = await importReal(item);
      expect({ qid: item.qid, failed: r.failChecks }).toEqual({ qid: item.qid, failed: [] });
    }
    await ContentArtifact.updateMany({ docType: "question" }, { $set: { reviewStatus: "gold" } });

    const bank = await goldBank([REAL_SOLVE_A.topic_tag, REAL_SOLVE_B.topic_tag, REAL_WORD.topic_tag]);
    expect(Object.fromEntries(bank.map((b) => [b.qid, b.qtCode]))).toEqual({
      [REAL_SOLVE_A.qid]: "QT-SOLVE",
      [REAL_SOLVE_B.qid]: "QT-SOLVE",
      [REAL_WORD.qid]: "QT-WORD",
    });

    // The builder: a layout that allows QT-SOLVE gets the SOLVE item as QT-SOLVE with the table's marks.
    const solveLo: OutcomeInfo = { code: REAL_SOLVE_A.topic_tag, chapterNumber: 7, questionTypeCodes: ["QT-SOLVE"] };
    const bctx: BuilderContext = {
      outcomes: new Map([[solveLo.code, solveLo]]), taught: new Set([solveLo.code]), bank,
      marksOf: new Map([["QT-SOLVE", 1]]), exposure: new Map(), layout: layout({ partBMarks: 1 }),
    };
    const built = buildPartB(new Map([[solveLo.code, { state: "WEAK", lastEvidenceAt: null, seenQids: [] }]]), bctx);
    expect(built.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([[REAL_SOLVE_A.qid, "QT-SOLVE", 1]]);

    // The QT-WORD item belongs to its own objective only: the SOLVE objective never receives it.
    expect(bank.find((b) => b.qid === REAL_WORD.qid)!.loCodes).toEqual([REAL_WORD.topic_tag]);
    expect(pickTyped(solveLo, new Set([REAL_SOLVE_A.qid]), bctx)).toBeNull();
  });

  it("createPaper uses a typed bank question as its own type only", async () => {
    await importTree();
    await simulateLock();
    await importReal(REAL_SOLVE_A);
    await ContentArtifact.updateMany({ docType: "question" }, { $set: { reviewStatus: "gold" } });
    const art = await ContentArtifact.findOne({ docType: "question" }).lean();

    const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
    const [cls] = await Class.create([{ level: 1, nameBn: "প্রথম", academicYearId: year._id }]);
    const [sec] = await Section.create([{ classId: cls._id, code: "A", nameBn: "ক" }]);
    await setEnablement(String(year._id), "C1", "MATH", true, PRINCIPAL);

    const input = (questionTypeCode: string) => ({
      sectionId: String(sec._id), subject: "MATH" as const, source: "HW" as const, date: "2027-03-08",
      items: [{ origin: "BANK" as const, artifactId: String(art!._id), loCode: REAL_SOLVE_A.topic_tag, questionTypeCode }],
    });
    await expect(createPaper(input("QT-FILL"), PRINCIPAL)).rejects.toThrow(/QT-SOLVE/);
    const paper = await createPaper(input("QT-SOLVE"), PRINCIPAL);
    expect(paper.items.map((i) => [i.qid, i.questionTypeCode, i.marks])).toEqual([[REAL_SOLVE_A.qid, "QT-SOLVE", 1]]);
  });
});

describe("coverage by objective × type (acceptance 4)", () => {
  const gold = (qid: string, code: string, lessonRef: string | null, reviewStatus = "gold") =>
    ContentArtifact.create({
      docType: "question", subject: "MATH", classLevel: 1, address: { anchorWord: "অধ্যায়", number: 7 },
      curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus,
      envelopeJson: {
        tags: { topic_tag: code, lo_codes: [code] },
        payload: { qid, topic_tag: code, lo_codes: [code], ...(lessonRef ? { lesson_ref: lessonRef } : {}) },
      },
    });

  it("counts gold per tagged objective × type, with a no-type cell, zero cells flagged, and a CSV export", async () => {
    await importTree();
    await simulateLock();
    // LO-C1-MATH-07-01.2 allows QT-SOLVE only. Two typed, one QCAT-, one still in review.
    await gold("Q1", "LO-C1-MATH-07-01.2", "QT-SOLVE");
    await gold("Q2", "LO-C1-MATH-07-01.2", "QT-SOLVE");
    await gold("Q3", "LO-C1-MATH-07-01.2", "QCAT-X");
    await gold("Q4", "LO-C1-MATH-07-01.2", "QT-SOLVE", "draft");
    // LO-C1-MATH-07-04 allows QT-WORD: only an untyped question.
    await gold("Q5", "LO-C1-MATH-07-04", null);

    const v = await bankCoverage("C1", "MATH");
    const row = (code: string) => v.rows.find((r) => r.code === code)!;
    expect(row("LO-C1-MATH-07-01.2").goldCount).toBe(3); // unchanged total
    expect(row("LO-C1-MATH-07-01.2").cells).toEqual([
      { typeCode: "QT-SOLVE", goldCount: 2, pendingCount: 1, zero: false },
      { typeCode: null, goldCount: 1, pendingCount: 0, zero: false },
    ]);
    expect(row("LO-C1-MATH-07-04").cells).toEqual([
      { typeCode: "QT-WORD", goldCount: 0, pendingCount: 0, zero: true },
      { typeCode: null, goldCount: 1, pendingCount: 0, zero: false },
    ]);
    // An allowed type nobody has written yet is a zero cell on a row with no questions at all.
    expect(row("LO-C1-MATH-07-02").cells[0]).toMatchObject({ typeCode: expect.any(String), goldCount: 0, zero: true });

    const lines = v.typeCsv.split("\n");
    expect(lines[0]).toBe("objective,type,gold,pending");
    expect(lines).toEqual(expect.arrayContaining([
      "LO-C1-MATH-07-01.2,QT-SOLVE,2,1",
      "LO-C1-MATH-07-01.2,-,1,0",
      "LO-C1-MATH-07-04,QT-WORD,0,0",
      "LO-C1-MATH-07-04,-,1,0",
    ]));
  });
});
