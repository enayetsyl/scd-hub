/**
 * Mastery M-4 — the weekly tailored assignment (docs/prd-mastery.md §5.4 / §6.1 / §10 journeys
 * 4–5; D-#780 / #809).
 *
 * Builder (pure): bands by state and mix, never a seen question, NO_UNSEEN_QUESTION, one question
 * for INSUFFICIENT, MASTERED skipped, layout types honoured, Part A avoids what the section saw.
 * Service (in-memory Mongo, routine lookup mocked): build from a layout, row rule + switch, edit
 * (swap / remove / add own), approve, send → one AS sheet with each student's items; entry refuses
 * an item not on the student's sheet; evidence only for given items; a rebuild keeps edited sheets;
 * the remembered layout; the PDF renders.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { buildPartA, buildPartB, type BuilderContext, type StudentOutcomeState } from "../modules/mastery/assignmentBuilder";

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
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { importCatalogue, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, paperDetail, saveResults } from "../modules/mastery/services/MasteryWorkService";
import {
  approveAllSheets,
  assignmentFor,
  buildAssignment,
  editSheet,
  renderAssignmentPdf,
  sendAssignment,
  sheetDetail,
} from "../modules/mastery/services/MasteryAssignmentService";

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

const LAYOUT = {
  partAOn: false, partAMarks: 0, partALoCodes: [], partBMarks: 6,
  mixWeak: 60, mixImproving: 40, mixRevision: 0, questionTypeCodes: [] as string[],
};
const bank = (lo: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ artifactId: `${lo}-a${i}`, qid: `${lo}-Q${i + 1}`, loCodes: [lo], textBn: `${lo} প্রশ্ন ${i + 1}` }));
const ctxOf = (over: Partial<BuilderContext> = {}): BuilderContext => ({
  outcomes: new Map([
    ["A", { code: "A", chapterNumber: 1, questionTypeCodes: ["QT-SOLVE"] }],
    ["B", { code: "B", chapterNumber: 1, questionTypeCodes: ["QT-SHORT"] }],
    ["C", { code: "C", chapterNumber: 2, questionTypeCodes: ["QT-SOLVE"] }],
    ["D", { code: "D", chapterNumber: 2, questionTypeCodes: ["QT-WORD"] }],
  ]),
  taught: new Set(["A", "B", "C", "D"]),
  bank: [...bank("A", 4), ...bank("B", 3), ...bank("C", 1), ...bank("D", 2)],
  marksOf: new Map([["QT-SOLVE", 2], ["QT-SHORT", 1], ["QT-WORD", 5]]),
  exposure: new Map(),
  layout: LAYOUT,
  ...over,
});
const st = (state: string, seen: string[] = [], at = "2027-03-01"): StudentOutcomeState => ({ state, seenQids: seen, lastEvidenceAt: new Date(at) });

describe("assignment builder (pure)", () => {
  it("weak first, then improving; never a seen question; mastered skipped", () => {
    const states = new Map([
      ["A", st("WEAK", ["A-Q1", "A-Q2"])],
      ["B", st("IMPROVING", ["B-Q1"])],
      ["C", st("MASTERED")],
    ]);
    const { items, warnings } = buildPartB(states, ctxOf());
    expect(items.map((i) => [i.loCode, i.qid, i.band])).toEqual([
      ["A", "A-Q3", "WEAK"],
      ["A", "A-Q4", "WEAK"],
      ["B", "B-Q2", "IMPROVING"],
      ["B", "B-Q3", "IMPROVING"],
    ]);
    expect(items.reduce((s, i) => s + i.marks, 0)).toBe(6);
    expect(warnings).toEqual([]);
  });

  it("no unseen question left ⇒ NO_UNSEEN_QUESTION for that outcome (journey 4)", () => {
    const states = new Map([["C", st("WEAK", ["C-Q1"])]]);
    const out = buildPartB(states, ctxOf());
    expect(out.items).toEqual([]);
    expect(out.warnings).toEqual([{ code: "NO_UNSEEN_QUESTION", loCode: "C" }]);
  });

  it("INSUFFICIENT gets one question; nothing to practise is said plainly", () => {
    const out = buildPartB(new Map([["A", st("INSUFFICIENT")], ["B", st("INSUFFICIENT")]]), ctxOf());
    expect(out.items.map((i) => [i.loCode, i.band])).toEqual([["A", "INSUFFICIENT"], ["B", "INSUFFICIENT"]]);
    expect(buildPartB(new Map([["A", st("MASTERED")]]), ctxOf()).warnings).toEqual([{ code: "NOTHING_TO_PRACTISE" }]);
  });

  it("the layout's types are honoured (journey 5): SOLVE only leaves a SHORT-only outcome out", () => {
    const layout = { ...LAYOUT, mixWeak: 100, mixImproving: 0, questionTypeCodes: ["QT-SOLVE"] };
    const out = buildPartB(new Map([["A", st("WEAK")], ["B", st("WEAK")]]), ctxOf({ layout }));
    expect(new Set(out.items.map((i) => i.loCode))).toEqual(new Set(["A"]));
    expect(out.items.every((i) => i.questionTypeCode === "QT-SOLVE")).toBe(true);
  });

  it("an outcome not yet taught in the section is not practised", () => {
    const out = buildPartB(new Map([["A", st("WEAK")]]), ctxOf({ taught: new Set(["B"]) }));
    expect(out.items).toEqual([]);
  });

  it("Part A: the section's weakest outcome, questions nobody has seen first", () => {
    const layout = { ...LAYOUT, partAOn: true, partAMarks: 4 };
    const items = buildPartA([{ loCode: "A", weakPct: 60 }, { loCode: "B", weakPct: 20 }], 50, new Set(["A-Q1"]), ctxOf({ layout }));
    expect(items.map((i) => [i.loCode, i.qid, i.band])).toEqual([["A", "A-Q2", "SECTION"], ["A", "A-Q3", "SECTION"]]);
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
const sids: string[] = [];
const goldIds = new Map<string, string>(); // qid → artifact id

const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [
    { code: "LO-C3-MATH-07-02", labelBn: "ভাগফল ও ভাগশেষ", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] },
    { code: "LO-C3-MATH-07-03", labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: ["QT-SOLVE", "QT-WORD"] },
  ],
  questionTypes: [
    { code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 1 },
    { code: "QT-SOLVE", labelBn: "সমাধান করো", marks: 2 },
    { code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: 5 },
  ],
});

const LAYOUT_IN = {
  totalMarks: 6, minutes: 30, partAOn: true, partAMarks: 2, partALoCodes: [], partBMarks: 4,
  mixWeak: 60, mixImproving: 25, mixRevision: 15, questionTypeCodes: [] as string[],
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(sec._id);
  for (let i = 1; i <= 3; i++) {
    const [s] = await Student.create([{ schoolId: `M4-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }
  await importCatalogue(CATALOGUE, true, PRINCIPAL);
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  const base = {
    docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
    curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
  };
  const golds: [string, string][] = [
    ["LO-C3-MATH-07-03", "QP-MATH-C3-U07-Q91001"], ["LO-C3-MATH-07-03", "QP-MATH-C3-U07-Q91002"],
    ["LO-C3-MATH-07-03", "QP-MATH-C3-U07-Q91003"], ["LO-C3-MATH-07-03", "QP-MATH-C3-U07-Q91004"],
    ["LO-C3-MATH-07-03", "QP-MATH-C3-U07-Q91005"], ["LO-C3-MATH-07-03", "QP-MATH-C3-U07-Q91006"],
    ["LO-C3-MATH-07-02", "QP-MATH-C3-U07-Q92001"], ["LO-C3-MATH-07-02", "QP-MATH-C3-U07-Q92002"],
  ];
  for (const [lo, qid] of golds) {
    const [a] = await ContentArtifact.create([{ ...base, envelopeJson: { tags: { topic_tag: lo }, payload: { qid, topic_tag: lo, question_text: `${qid} লেখা` } } }]);
    goldIds.set(qid, String(a._id));
  }
  mockTeacher.mockResolvedValue(TEACHER_ID);
  // One confirmed homework: Q91001 (bank) + one teacher item on long division, one on 07-02.
  // Students 1–2 get 0 on long division (WEAK); student 3 is full.
  const hw = await createPaper({
    sectionId, subject: "MATH", source: "HW", date: "2027-03-08",
    items: [
      { origin: "BANK", artifactId: goldIds.get("QP-MATH-C3-U07-Q91001"), loCode: "LO-C3-MATH-07-03", questionTypeCode: "QT-SOLVE" },
      { origin: "TEACHER", textBn: "৮৪৬ ÷ ৬", loCode: "LO-C3-MATH-07-03", questionTypeCode: "QT-WORD" },
      { origin: "TEACHER", textBn: "৪৫ ÷ ৯", loCode: "LO-C3-MATH-07-02", questionTypeCode: "QT-SHORT" },
    ],
  }, TEACHER);
  await saveResults(hw.paperId, [0, 1].map((i) => ({ studentId: sids[i], items: [{ itemNo: 1, marks: 0 }, { itemNo: 2, marks: 0 }] })), TEACHER);
  await confirmPaper(hw.paperId, TEACHER);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

describe("weekly assignment (DB)", () => {
  let assignmentId = "";

  it("starts from the policy layout; a teacher off the routine is refused", async () => {
    const w = await assignmentFor(sectionId, "MATH", "2027-03-18", TEACHER);
    expect(w.assignment).toBeNull();
    expect(w.startingLayout).toMatchObject({ totalMarks: 15, partAOn: true, partAMarks: 5, partBMarks: 10 });
    mockTeacher.mockResolvedValue(null);
    await expect(buildAssignment({ sectionId, subject: "MATH", dueDate: "2027-03-18", layout: LAYOUT_IN, rememberLayout: true }, OTHER_TEACHER)).rejects.toThrow(/রুটিন/);
  });

  it("refuses a layout whose parts do not add up", async () => {
    await expect(buildAssignment({ sectionId, subject: "MATH", dueDate: "2027-03-18", layout: { ...LAYOUT_IN, partBMarks: 5 }, rememberLayout: true }, TEACHER)).rejects.toThrow(/মোট/);
  });

  it("builds: Part A on the section's weak outcome; Part B never repeats a seen question", async () => {
    const a = await buildAssignment({ sectionId, subject: "MATH", dueDate: "2027-03-18", layout: LAYOUT_IN, rememberLayout: true }, TEACHER);
    assignmentId = a.id;
    expect(a.status).toBe("DRAFT");
    expect(a.partA.map((q) => [q.loCode, q.band])).toEqual([["LO-C3-MATH-07-03", "SECTION"]]);
    expect(a.partA[0].qid).not.toBe("QP-MATH-C3-U07-Q91001"); // everyone saw Q91001
    expect(a.sheets).toHaveLength(3);
    const s1 = await sheetDetail(a.id, sids[0], TEACHER);
    expect(s1.items.some((q) => q.loCode === "LO-C3-MATH-07-03" && q.band === "WEAK")).toBe(true);
    const onSheet = [...a.partA, ...s1.items].map((q) => q.qid);
    expect(onSheet).not.toContain("QP-MATH-C3-U07-Q91001");
    expect(new Set(onSheet).size).toBe(onSheet.length);
  });

  it("edit: swap gives a different unseen question; add own; remove; edited sheets survive a rebuild", async () => {
    const before = await sheetDetail(assignmentId, sids[0], TEACHER);
    const i = before.items.findIndex((q) => q.origin === "BANK" && q.loCode === "LO-C3-MATH-07-03");
    const swapped = await editSheet(assignmentId, sids[0], { op: "SWAP", index: i }, TEACHER);
    expect(swapped.items[i].qid).not.toBe(before.items[i].qid);
    expect(swapped.items[i].qid).not.toBe("QP-MATH-C3-U07-Q91001");
    await expect(editSheet(assignmentId, sids[0], { op: "ADD_OWN", loCode: "LO-C3-MATH-07-02", questionTypeCode: "QT-WORD", textBn: "x" }, TEACHER)).rejects.toThrow(/ধরন নয়/);
    const added = await editSheet(assignmentId, sids[0], { op: "ADD_OWN", loCode: "LO-C3-MATH-07-02", questionTypeCode: "QT-SHORT", textBn: "৬৩ ÷ ৯ = ?" }, TEACHER);
    expect(added.items[added.items.length - 1]).toMatchObject({ origin: "TEACHER", marks: 1, band: "TEACHER" });
    const removed = await editSheet(assignmentId, sids[0], { op: "REMOVE", index: 0 }, TEACHER);
    expect(removed.items).toHaveLength(added.items.length - 1);
    await buildAssignment({ sectionId, subject: "MATH", dueDate: "2027-03-18", layout: LAYOUT_IN, rememberLayout: true }, TEACHER);
    expect((await sheetDetail(assignmentId, sids[0], TEACHER)).items).toEqual(removed.items);
  });

  it("send needs every sheet approved; then one AS sheet with each student's items", async () => {
    await expect(sendAssignment(assignmentId, TEACHER)).rejects.toThrow(/অনুমোদন/);
    const v = await approveAllSheets(assignmentId, TEACHER);
    for (const s of v.sheets.filter((x) => x.status !== "APPROVED")) {
      await editSheet(assignmentId, s.studentId, { op: "APPROVE" }, TEACHER);
    }
    const sent = await sendAssignment(assignmentId, TEACHER);
    expect(sent.status).toBe("SENT");
    expect(sent.paperId).toMatch(/^MP-C3-MATH-/);
    await expect(editSheet(assignmentId, sids[0], { op: "REMOVE", index: 0 }, TEACHER)).rejects.toThrow(/পাঠানো/);

    const paper = await MasteryPaper.findOne({ paperId: sent.paperId! }).lean();
    expect(paper!.source).toBe("AS");
    expect(paper!.perStudentItems).toHaveLength(3);
    const d = await paperDetail(sent.paperId!, TEACHER);
    const mine = d.roster.find((r) => r.studentId === sids[0])!.itemNos!;
    const theirs = d.roster.find((r) => r.studentId === sids[2])!.itemNos!;
    expect(mine[0]).toBe(1); // Part A is item 1 for everyone
    expect(theirs[0]).toBe(1);
    const notMine = paper!.items.map((i) => i.itemNo).find((n) => !mine.includes(n));
    if (notMine) {
      await expect(saveResults(sent.paperId!, [{ studentId: sids[0], items: [{ itemNo: notMine, marks: 0 }] }], TEACHER)).rejects.toThrow(/শিটে নেই/);
    }
    await confirmPaper(sent.paperId!, TEACHER);
    const rows = await MasteryEvidence.find({ paperId: paper!._id, studentId: new Types.ObjectId(sids[0]), supersededAt: null }).lean();
    expect(new Set(rows.map((r) => r.itemNo))).toEqual(new Set(mine));
  });

  it("the next week starts from the remembered layout; the PDF renders", async () => {
    const w = await assignmentFor(sectionId, "MATH", "2027-03-25", TEACHER);
    expect(w.startingLayout).toMatchObject({ totalMarks: 6, partAMarks: 2, partBMarks: 4 });
    const one = await renderAssignmentPdf(assignmentId, sids[0], TEACHER);
    expect(one.pdf.subarray(0, 4).toString()).toBe("%PDF");
    const all = await renderAssignmentPdf(assignmentId, null, TEACHER);
    expect(all.pdf.byteLength).toBeGreaterThan(one.pdf.byteLength);
  });
});
