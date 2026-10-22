/**
 * Mastery M-2 — work sheets, exceptions-only entry, evidence (docs/prd-mastery.md §5.2 + §10,
 * D-#778/#787).
 *
 * computeEvidence (pure):
 *   - no result row = present, full marks; ABSENT / NOT_SUBMITTED (incl. the homework default)
 *     give NO rows; VOID / a VOID_BEHAVIOUR tag give no rows + a behaviour note
 *   - re-work / a WEAK tag ⇒ WEAK; a LIGHT tag or whole-work re-work ⇒ LIGHT
 *   - routing (D-#787): a tagged eligible item ⇒ WEAK strand row and the deduction added back
 *     to its own LO; an untagged eligible item ⇒ GOOD strand row; ineligible type / off scope /
 *     missing strand ⇒ nothing; a WORK routing tag judges the whole work once
 *   - rubric: step − 1 of 3, default 4
 * Service (in-memory Mongo, routine lookup mocked):
 *   - the switch must be on; a teacher off the routine is refused; edit_all passes
 *   - only LOCKED outcomes of THIS class × subject; marks come from the table (snapshot)
 *   - a bank item must be gold and tagged with that outcome
 *   - entry validation; confirm writes evidence; a correction supersedes and rewrites
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { computeEvidence, isoWeekKey, type PaperLike, type TagLike } from "../modules/mastery/evidence";

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { importCatalogue, lockCatalogue, saveTag, setEnablement, saveQuestionType } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, deletePaper, paperDetail, saveResults } from "../modules/mastery/services/MasteryWorkService";

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

const PAPER: PaperLike = {
  source: "HW",
  classToken: "C3",
  subject: "MATH",
  date: new Date("2027-03-10T00:00:00Z"),
  items: [
    { itemNo: 1, loCodes: ["LO-C3-MATH-07-02"], chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: 1 },
    { itemNo: 2, loCodes: ["LO-C3-MATH-07-03"], chapterNumber: 7, questionTypeCode: "QT-SOLVE", marks: 2 },
    { itemNo: 3, loCodes: ["LO-C3-MATH-07-03"], chapterNumber: 7, questionTypeCode: "QT-WORD", marks: 5 },
  ],
  rubricLoCodes: [],
};

const tag = (over: Partial<TagLike> & Pick<TagLike, "code" | "effect">): TagLike => ({
  questionTypeCodes: [], allScopes: true, scopes: [], active: true, ...over,
});
const TAGS: TagLike[] = [
  tag({ code: "CONCEPT_GAP", effect: "WEAK" }),
  tag({ code: "CARELESS", effect: "LIGHT" }),
  tag({ code: "ABSENT", effect: "NO_EVIDENCE" }),
  tag({ code: "COPIED", effect: "VOID_BEHAVIOUR" }),
  tag({
    code: "NO_ANSWER_SENTENCE", effect: "ROUTE_STRAND", routeStrand: "ANS", routeSeq: 1, level: "ITEM",
    questionTypeCodes: ["QT-WORD"], deductionMarks: 0.5, allScopes: false, scopes: [{ classToken: "C3", subject: "MATH" }],
  }),
  tag({ code: "HANDWRITING_UNCLEAR", effect: "ROUTE_STRAND", routeStrand: "HW", routeSeq: 1, level: "WORK", allScopes: false, scopes: [{ classToken: "C3", subject: "MATH" }] }),
];
const LIVE = new Set(["LO-C3-MATH-07-02", "LO-C3-MATH-07-03", "LO-C3-MATH-SK-ANS-01", "LO-C3-MATH-SK-HW-01"]);
const POLICY = { reworkIsWeak: true, workReworkIsLight: true };

const run = (results: Record<string, unknown>, defaults: Record<string, "PRESENT" | "ABSENT" | "NOT_SUBMITTED"> = {}, paper = PAPER, tags = TAGS) =>
  computeEvidence({
    paper,
    studentIds: ["a", "b", "c", "d"],
    results: new Map(Object.entries(results)) as never,
    statusDefaults: new Map(Object.entries(defaults)),
    tags,
    policy: POLICY,
    liveCodes: LIVE,
  });
const rowsOf = (out: ReturnType<typeof run>, s: string, lo?: string) => out.rows.filter((r) => r.studentId === s && (!lo || r.loCode === lo));

describe("computeEvidence (pure)", () => {
  it("no row = full marks; absent / not-submitted (incl. the homework default) give no rows", () => {
    const out = run({ b: { status: "ABSENT", items: [], workTags: [], rubric: [] } }, { c: "NOT_SUBMITTED" });
    const a = rowsOf(out, "a").filter((r) => !r.routed);
    expect(a.map((r) => [r.itemNo, r.earned, r.available, r.signal])).toEqual([
      [1, 1, 1, "NONE"], [2, 2, 2, "NONE"], [3, 5, 5, "NONE"],
    ]);
    expect(rowsOf(out, "b")).toEqual([]);
    expect(rowsOf(out, "c")).toEqual([]);
    expect(out.skipped.map((s) => [s.studentId, s.reason]).sort()).toEqual([["b", "ABSENT"], ["c", "NOT_SUBMITTED"]]);
  });

  it("re-work or a WEAK tag ⇒ WEAK even at full marks; a LIGHT tag or whole-work re-work ⇒ LIGHT", () => {
    const out = run({
      a: { items: [{ itemNo: 3, marks: 5, rework: true, tags: [] }], workTags: [], rubric: [] },
      b: { items: [{ itemNo: 2, marks: 1, tags: ["CONCEPT_GAP"] }], workTags: [], rubric: [] },
      c: { items: [{ itemNo: 1, marks: 0, tags: ["CARELESS"] }], workTags: [], rubric: [] },
      d: { items: [], workRework: true, workTags: [], rubric: [] },
    });
    expect(rowsOf(out, "a", "LO-C3-MATH-07-03").find((r) => r.itemNo === 3)).toMatchObject({ earned: 5, signal: "WEAK", rework: true });
    expect(rowsOf(out, "b", "LO-C3-MATH-07-03").find((r) => r.itemNo === 2)).toMatchObject({ earned: 1, signal: "WEAK" });
    expect(rowsOf(out, "c", "LO-C3-MATH-07-02")[0]).toMatchObject({ earned: 0, signal: "LIGHT" });
    expect(rowsOf(out, "d").filter((r) => !r.routed).every((r) => r.signal === "LIGHT" && r.workRework)).toBe(true);
  });

  it("routing tag on an eligible item: WEAK strand row + deduction added back; untagged ⇒ GOOD (D-#787)", () => {
    const out = run({ a: { items: [{ itemNo: 3, marks: 4.5, tags: ["NO_ANSWER_SENTENCE"] }], workTags: [], rubric: [] } });
    expect(rowsOf(out, "a", "LO-C3-MATH-07-03").find((r) => r.itemNo === 3)).toMatchObject({ earned: 5, available: 5, signal: "NONE" });
    expect(rowsOf(out, "a", "LO-C3-MATH-SK-ANS-01")).toEqual([
      expect.objectContaining({ itemNo: 3, earned: 0, available: 1, signal: "WEAK", routed: true, chapterNumber: 7 }),
    ]);
    // b: untagged → one GOOD row, only for the eligible QT-WORD item (not QT-SHORT / QT-SOLVE).
    expect(rowsOf(out, "b", "LO-C3-MATH-SK-ANS-01")).toEqual([expect.objectContaining({ itemNo: 3, earned: 1, signal: "GOOD", routed: true })]);
  });

  it("a routing tag writes nothing off its scope or when the strand LO is missing", () => {
    const offScope = run({}, {}, { ...PAPER, classToken: "C2" });
    expect(offScope.rows.some((r) => r.routed)).toBe(false);
    const noStrand = computeEvidence({
      paper: PAPER, studentIds: ["a"], results: new Map(), statusDefaults: new Map(), tags: TAGS, policy: POLICY,
      liveCodes: new Set(["LO-C3-MATH-07-02", "LO-C3-MATH-07-03"]),
    });
    expect(noStrand.rows.some((r) => r.routed)).toBe(false);
  });

  it("a WORK routing tag judges the whole work once", () => {
    const out = run({ a: { items: [], workTags: ["HANDWRITING_UNCLEAR"], rubric: [] } });
    expect(rowsOf(out, "a", "LO-C3-MATH-SK-HW-01")).toEqual([expect.objectContaining({ itemNo: null, earned: 0, signal: "WEAK" })]);
    expect(rowsOf(out, "b", "LO-C3-MATH-SK-HW-01")).toEqual([expect.objectContaining({ itemNo: null, earned: 1, signal: "GOOD" })]);
  });

  it("VOID and a copied tag give no rows and a behaviour note; a NO_EVIDENCE work tag gives none", () => {
    const out = run({
      a: { status: "VOID", items: [], workTags: [], rubric: [] },
      b: { items: [], workTags: ["COPIED"], rubric: [] },
      c: { items: [], workTags: ["ABSENT"], rubric: [] },
    });
    expect(rowsOf(out, "a").concat(rowsOf(out, "b"), rowsOf(out, "c"))).toEqual([]);
    expect(out.behaviourNotes.map((n) => n.studentId).sort()).toEqual(["a", "b"]);
  });

  it("rubric: step − 1 of 3, default 4", () => {
    const paper = { ...PAPER, source: "RUBRIC", items: [], rubricLoCodes: ["LO-C3-MATH-SK-MENT-01"] };
    const out = run({ a: { items: [], workTags: [], rubric: [{ loCode: "LO-C3-MATH-SK-MENT-01", step: 2 }] } }, {}, paper);
    expect(rowsOf(out, "a")[0]).toMatchObject({ earned: 1, available: 3, rubricStep: 2 });
    expect(rowsOf(out, "b")[0]).toMatchObject({ earned: 3, available: 3, rubricStep: 4 });
  });

  it("ISO week keys separate weeks across a year boundary", () => {
    expect(isoWeekKey(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2027-03-10T00:00:00Z"))).toBe("2027-W10");
  });
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
const OTHER_TEACHER = { userId: new Types.ObjectId().toString(), role: "TEACHER" as const };
let sectionId = "";
let yearId = "";
const studentIds: string[] = [];

const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [
    { code: "LO-C3-MATH-07-02", labelBn: "ভাগফল ও ভাগশেষ", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] },
    { code: "LO-C3-MATH-07-03", labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: ["QT-SOLVE", "QT-WORD"] },
    { code: "LO-C3-MATH-SK-ANS-01", labelBn: "উত্তর-বাক্য", assess: "QUESTION", questionTypeCodes: [] },
    { code: "LO-C3-MATH-SK-MENT-01", labelBn: "মুখে হিসাব", assess: "RUBRIC", questionTypeCodes: [] },
  ],
  questionTypes: [
    { code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 1 },
    { code: "QT-SOLVE", labelBn: "সমাধান করো", marks: 2 },
    { code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: 5 },
  ],
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = String(year._id);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(sec._id);
  for (let i = 1; i <= 3; i++) {
    const [s] = await Student.create([{ schoolId: `M2-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    studentIds.push(String(s._id));
  }
  await importCatalogue(CATALOGUE, true, PRINCIPAL);
  await saveTag({
    code: "NO_ANSWER_SENTENCE", labelBn: "উত্তর-বাক্য নেই", appliesTo: "ITEM", effect: "ROUTE_STRAND", routeStrand: "ANS", routeSeq: 1,
    level: "ITEM", questionTypeCodes: ["QT-WORD"], deductionMarks: 0.5, allScopes: false, scopes: [{ classToken: "C3", subject: "MATH" }], active: true,
  }, PRINCIPAL);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

const sheet = (over: Record<string, unknown> = {}) => ({
  sectionId,
  subject: "MATH" as const,
  source: "HW" as const,
  date: "2027-03-10",
  items: [
    { origin: "TEACHER" as const, textBn: "৪৫ ÷ ৯ = ?", loCode: "LO-C3-MATH-07-02", questionTypeCode: "QT-SHORT" },
    { origin: "TEACHER" as const, textBn: "৭৩৫টি বই ৭টি তাকে…", loCode: "LO-C3-MATH-07-03", questionTypeCode: "QT-WORD" },
  ],
  ...over,
});

describe("work sheets (DB)", () => {
  it("refuses while the add-on is off; then a teacher OFF the routine is refused, ON it allowed", async () => {
    await expect(createPaper(sheet(), TEACHER)).rejects.toThrow(/চালু নেই/);
    await setEnablement(yearId, "C3", "MATH", true, PRINCIPAL);
    await expect(createPaper(sheet(), OTHER_TEACHER)).rejects.toThrow(/রুটিন/);
    const p = await createPaper(sheet(), TEACHER);
    expect(p.paperId).toBe("MP-C3-MATH-0001");
    expect(p.items.map((i) => i.marks)).toEqual([1, 5]);
    expect(p.totalMarks).toBe(6);
    // edit_all (Principal) passes without the routine.
    mockTeacher.mockResolvedValue(null);
    expect((await createPaper(sheet(), PRINCIPAL)).paperId).toBe("MP-C3-MATH-0002");
  });

  it("marks are a snapshot: changing the table does not change an existing sheet", async () => {
    const p = await createPaper(sheet(), TEACHER);
    await saveQuestionType({ classToken: "C3", subject: "MATH", code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: 4 }, PRINCIPAL);
    const d = await paperDetail(p.paperId, TEACHER);
    expect(d.paper.items[1].marks).toBe(5);
    expect((await createPaper(sheet(), TEACHER)).items[1].marks).toBe(4);
    await saveQuestionType({ classToken: "C3", subject: "MATH", code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: 5 }, PRINCIPAL);
  });

  it("refuses an unknown / other-class outcome, a rubric LO on a question, a type with no marks", async () => {
    await expect(createPaper(sheet({ items: [{ origin: "TEACHER", textBn: "x", loCode: "LO-C3-BAN-01-01", questionTypeCode: "QT-SHORT" }] }), TEACHER)).rejects.toThrow(/তালিকায় নেই/);
    await expect(createPaper(sheet({ items: [{ origin: "TEACHER", textBn: "x", loCode: "LO-C3-MATH-SK-MENT-01", questionTypeCode: "QT-SHORT" }] }), TEACHER)).rejects.toThrow(/রুব্রিক/);
    await expect(createPaper(sheet({ items: [{ origin: "TEACHER", textBn: "x", loCode: "LO-C3-MATH-07-02", questionTypeCode: "QT-NOPE" }] }), TEACHER)).rejects.toThrow(/QT-NOPE/);
    await expect(createPaper(sheet({ items: [{ origin: "TEACHER", textBn: " ", loCode: "LO-C3-MATH-07-02", questionTypeCode: "QT-SHORT" }] }), TEACHER)).rejects.toThrow(/লেখা/);
  });

  it("a bank item must be gold, current and tagged with that outcome", async () => {
    const base = {
      docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
      curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(),
    };
    const env = (topic: string) => ({ tags: { topic_tag: topic }, payload: { qid: `QP-MATH-C3-U07-Q${Math.floor(Math.random() * 9e4) + 1e4}`, topic_tag: topic } });
    const [gold] = await ContentArtifact.create([{ ...base, reviewStatus: "gold", envelopeJson: env("LO-C3-MATH-07-03") }]);
    const [draft] = await ContentArtifact.create([{ ...base, reviewStatus: "draft", envelopeJson: env("LO-C3-MATH-07-03") }]);
    const bankItem = (id: string, lo = "LO-C3-MATH-07-03") => sheet({ items: [{ origin: "BANK", artifactId: id, loCode: lo, questionTypeCode: "QT-SOLVE" }] });
    const ok = await createPaper(bankItem(String(gold._id)), TEACHER);
    expect(ok.items[0]).toMatchObject({ origin: "BANK", marks: 2, chapterNumber: 7 });
    expect(ok.items[0].qid).toMatch(/^QP-MATH-C3/);
    await expect(createPaper(bankItem(String(draft._id)), TEACHER)).rejects.toThrow(/গোল্ড/);
    await expect(createPaper(bankItem(String(gold._id), "LO-C3-MATH-07-02"), TEACHER)).rejects.toThrow(/ট্যাগ করা নয়/);
  });

  it("entry validation: marks above the item, a routing tag on the wrong type, a stranger", async () => {
    const p = await createPaper(sheet(), TEACHER);
    await expect(saveResults(p.paperId, [{ studentId: studentIds[0], items: [{ itemNo: 2, marks: 6 }] }], TEACHER)).rejects.toThrow(/নম্বর/);
    await expect(saveResults(p.paperId, [{ studentId: studentIds[0], items: [{ itemNo: 1, tags: ["NO_ANSWER_SENTENCE"] }] }], TEACHER)).rejects.toThrow(/QT-SHORT/);
    await expect(saveResults(p.paperId, [{ studentId: new Types.ObjectId().toString(), items: [] }], TEACHER)).rejects.toThrow(/তালিকায়/);
    await expect(saveResults(p.paperId, [{ studentId: studentIds[0], items: [{ itemNo: 2, marks: 3 }] }], OTHER_TEACHER)).rejects.toThrow(/রুটিন/);
  });

  it("confirm: exceptions + defaults → evidence; a correction supersedes and rewrites; deleting is refused after", async () => {
    const p = await createPaper(sheet(), TEACHER);
    await saveResults(p.paperId, [
      { studentId: studentIds[0], items: [{ itemNo: 2, marks: 4.5, tags: ["NO_ANSWER_SENTENCE"] }] },
      { studentId: studentIds[1], status: "ABSENT" },
    ], TEACHER);
    const sum = await confirmPaper(p.paperId, TEACHER);
    expect(sum).toMatchObject({ students: 3, skipped: 1 });
    const rowsFor = async (sid: string) =>
      MasteryEvidence.find({ studentId: new Types.ObjectId(sid), supersededAt: null }).sort({ loCode: 1, itemNo: 1 }).lean();
    const s0 = await rowsFor(studentIds[0]);
    expect(s0.find((r) => r.loCode === "LO-C3-MATH-07-03")).toMatchObject({ earned: 5, available: 5 });
    expect(s0.find((r) => r.loCode === "LO-C3-MATH-SK-ANS-01")).toMatchObject({ earned: 0, signal: "WEAK", routed: true });
    expect(await rowsFor(studentIds[1])).toEqual([]);
    expect((await rowsFor(studentIds[2])).find((r) => r.loCode === "LO-C3-MATH-SK-ANS-01")).toMatchObject({ signal: "GOOD" });
    expect(s0[0].week).toBe("2027-W10");

    await expect(confirmPaper(p.paperId, TEACHER)).rejects.toThrow(/আগেই/);
    const fix = await saveResults(p.paperId, [{ studentId: studentIds[0], items: [{ itemNo: 2, marks: 2, rework: true }] }], TEACHER);
    expect(fix.evidenceRows).toBeGreaterThan(0);
    const after = await rowsFor(studentIds[0]);
    expect(after.find((r) => r.loCode === "LO-C3-MATH-07-03")).toMatchObject({ earned: 2, signal: "WEAK", rework: true });
    expect(after.find((r) => r.loCode === "LO-C3-MATH-SK-ANS-01")).toMatchObject({ signal: "GOOD" });
    expect(await MasteryEvidence.countDocuments({ studentId: new Types.ObjectId(studentIds[0]), supersededAt: { $ne: null } })).toBeGreaterThan(0);
    await expect(deletePaper(p.paperId, TEACHER)).rejects.toThrow(/নিশ্চিত/);
  });

  it("a rubric sheet takes rubric LOs only; an empty exception row is not stored", async () => {
    await expect(createPaper(sheet({ source: "RUBRIC", items: [], rubricLoCodes: ["LO-C3-MATH-07-02"] }), TEACHER)).rejects.toThrow(/রুব্রিকে/);
    const r = await createPaper(sheet({ source: "RUBRIC", items: [], rubricLoCodes: ["LO-C3-MATH-SK-MENT-01"] }), TEACHER);
    await saveResults(r.paperId, [
      { studentId: studentIds[0], rubric: [{ loCode: "LO-C3-MATH-SK-MENT-01", step: 2 }] },
      { studentId: studentIds[1], rubric: [{ loCode: "LO-C3-MATH-SK-MENT-01", step: 4 }] },
    ], TEACHER);
    const d = await paperDetail(r.paperId, TEACHER);
    expect(d.roster.filter((x) => x.result).map((x) => x.studentId)).toEqual([studentIds[0]]);
    await confirmPaper(r.paperId, TEACHER);
    const rows = await MasteryEvidence.find({ paperId: { $exists: true }, loCode: "LO-C3-MATH-SK-MENT-01", supersededAt: null }).lean();
    expect(rows.map((x) => x.rubricStep).sort()).toEqual([2, 4, 4]);
  });
});
