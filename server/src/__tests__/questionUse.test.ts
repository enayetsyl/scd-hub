/**
 * AL-3 — the QuestionUse ledger, the class-test block and the homework bank share
 * (docs/prd-academic-loop-2027.md §3.2 / §3.6 / §3.7 / §4.3 / §4.7; D-#1667).
 * ACs: AC-B1, AC-B11, AC-B15, AC-C2, AC-F1, AC-F3, AC-U2, AC-U3.
 *
 *  writers   a draft writes nothing; a hand HW sheet, an extra homework, an issued tracker homework, an AS send
 *            and a linked CT sheet each write rows at the given moment (release switch OFF); deleting an OPEN
 *            sheet withdraws its rows and the question is offered again (AC-B11)
 *  window    by DAYS: 27 and 28 days ago are inside the window, 29 is outside; withdrawn rows never count
 *  scope     a per-child row blocks that child only; a whole-শাখা row blocks everyone; a merged শাখা reads its
 *            source শাখা (AC-U2); a child's earlier-শাখা history follows the child through Enrolment
 *  builders  Part A / Part B never offer a homework question of the year (AC-C2); the draft is unused-first (AC-B1)
 *  CT block  refused only with the release switch ON: extra homework 10 days ago → refused, 30 days → allowed
 *            (AC-F3), at basket add, at finalise and on a CT mastery sheet; the message names the weeks
 *  share     homework takes at most homeworkBankSharePct % of an objective's gold pool; then the least-recently-
 *            used repeat ("আবার", never one in the window), else nothing (AC-B15)
 *  group     a group-anchored CT's set print writes one row per member শাখা (AC-U3)
 *  backfill  idempotent: a second run adds nothing; a row withdrawn on purpose is never revived
 *
 * In-memory MongoDB, real services; only the routine lookup is stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Enrolment } from "../modules/foundation/models/Enrolment";
import { SectionMerge } from "../modules/foundation/models/SectionMerge";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { SubjectGroup } from "../modules/routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../modules/routine/models/SubjectGroupMembership";
import { AssessmentSet } from "../modules/assessment/models/AssessmentSet";
import { QuestionUse } from "../modules/assessment/models/QuestionUse";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { importCatalogue, savePolicy, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, deletePaper, saveResults } from "../modules/mastery/services/MasteryWorkService";
import { createExtraHomework, homeworkDraft, homeworkShareLeft } from "../modules/mastery/services/MasteryHomeworkService";
import { approveAllSheets, buildAssignment, editSheet, sendAssignment, sheetDetail } from "../modules/mastery/services/MasteryAssignmentService";
import { issueHomeworkItem } from "../modules/trackers/services/HomeworkService";
import { addQuestionToSet, assembleSet, createSet } from "../modules/assessment/services/AssessmentService";
import {
  addDaysKey,
  avoidFor,
  ctBlockMessage,
  homeworkUsedThisYear,
  qidsOf,
  recordUses,
  todayKey,
  usedInWindow,
  usesOfPaper,
  windowStartKey,
  withdrawForCancelledPrint,
  withdrawForClassTest,
  assertSetCtAllowed,
  CtBlockError,
  withdrawUses,
  writeSetUses,
  type UseInput,
} from "../modules/assessment/services/QuestionUseService";
import { backfillQuestionUse } from "../modules/assessment/services/QuestionUseBackfill";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
let yearId = new Types.ObjectId();
let classId = new Types.ObjectId();
let secB = ""; // বালক — the main শাখা
let secG = ""; // বালিকা — the share / group / enrolment tests
let secM = ""; // সম্মিলিত — the merged শাখা
const sids: string[] = []; // students of B
let g1 = ""; // a student of G
const gold = new Map<string, string>(); // qid → artifact id

const A = "LO-C3-MATH-07-01";
const Q = (n: number) => `QP-MATH-C3-U07-Q94${String(n).padStart(3, "0")}`;
const day = (ago: number) => addDaysKey(todayKey(), -ago);

const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [{ code: A, labelBn: "ভাগের ধারণা", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] }],
  questionTypes: [{ code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 2 }],
});

const put = (qid: string, kind: UseInput["kind"], daysAgo: number, opts: { studentIds?: string[]; sectionId?: string; sourceId?: Types.ObjectId } = {}) =>
  recordUses([{
    qid, kind, sourceType: "HOMEWORK_ITEM", sourceId: opts.sourceId ?? new Types.ObjectId(),
    academicYearId: yearId, sectionId: opts.sectionId ?? secB, classToken: "C3", subject: "MATH",
    studentIds: opts.studentIds, givenOn: day(daysAgo),
  }]);

async function lesson(section: string, dateKey: string): Promise<void> {
  await LessonDelivery.create({
    noteId: new Types.ObjectId(), slotId: new Types.ObjectId(), sectionId: new Types.ObjectId(section), classLevel: 3, subject: "MATH",
    dateKey, teacherId: new Types.ObjectId(TEACHER_ID), updatedBy: new Types.ObjectId(TEACHER_ID),
    rosterStudentIds: [],
    sessions: [{ chapter: "7", anchorWord: "অধ্যায়", sessionIndex: 1, sessionOf: 1, titleBn: "ভাগ", finished: true, loCodes: [A] }],
  });
}

const setLoop = (on: boolean) => savePolicy(null, null, { academicLoop2027On: on }, PRINCIPAL);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = year._id;
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  classId = cls._id;
  const [b, g, m] = await Section.create([
    { classId: cls._id, code: "B", nameBn: "বালক" },
    { classId: cls._id, code: "G", nameBn: "বালিকা" },
    { classId: cls._id, code: "M", nameBn: "সম্মিলিত" },
  ]);
  secB = String(b._id);
  secG = String(g._id);
  secM = String(m._id);
  for (let i = 1; i <= 3; i++) {
    const [s] = await Student.create([{ schoolId: `QU-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: b._id, active: true }]);
    sids.push(String(s._id));
  }
  const [gs] = await Student.create([{ schoolId: "QU-G1", name: "Girl 1", rollNumber: "1", classId: cls._id, sectionId: g._id, active: true }]);
  g1 = String(gs._id);
  const r = await importCatalogue(CATALOGUE, true, PRINCIPAL);
  if (!r.ok) throw new Error(r.errors.join("; "));
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  const base = {
    docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
    curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
  };
  // Q1..Q12 are the objective A pool; Q13..Q20 are gold questions of another topic (class-test / group fixtures).
  for (let n = 1; n <= 20; n++) {
    const tag = n <= 12 ? A : "LO-C3-MATH-OTHER";
    const [a] = await ContentArtifact.create([{ ...base, envelopeJson: { tags: { topic_tag: tag }, payload: { qid: Q(n), topic_tag: tag, marks: 2, question_text: `${Q(n)} লেখা` } } }]);
    gold.set(Q(n), String(a._id));
  }
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("day arithmetic and pure helpers", () => {
  it("the window starts N days back, inclusive; the message names the weeks", () => {
    expect(windowStartKey("2027-03-29", 28)).toBe("2027-03-01");
    expect(addDaysKey("2027-03-01", -1)).toBe("2027-02-28");
    expect(ctBlockMessage(4, ["QP-1"])).toContain("এই প্রশ্ন গত ৪ সপ্তাহে বাড়ির কাজ / অ্যাসাইনমেন্টে ছিল");
  });

  it("R21: the homework share left = pct of the pool (rounded down) minus the homework already used, capped at what is wanted", () => {
    const pool = Array.from({ length: 10 }, (_, i) => `q${i}`);
    const used = (n: number) => ({ homeworkYear: new Set(pool.slice(0, n)) });
    expect(homeworkShareLeft(pool, used(0), 50, 1)).toBe(1);
    expect(homeworkShareLeft(pool, used(0), 50, 9)).toBe(5);
    expect(homeworkShareLeft(pool, used(5), 50, 1)).toBe(0); // AC-B15: 5 of 10 used → none left
    expect(homeworkShareLeft(pool, used(7), 50, 1)).toBe(0);
    expect(homeworkShareLeft(pool.slice(0, 1), used(0), 50, 1)).toBe(0); // a pool of one never gives homework
  });

  it("usesOfPaper: a plain paper gives every item to the whole শাখা; per-child lists give the item to exactly those children", () => {
    const p = {
      _id: new Types.ObjectId(), academicYearId: yearId, sectionId: new Types.ObjectId(), classToken: "C3", subject: "MATH",
      date: new Date("2027-03-01T00:00:00Z"),
      items: [{ itemNo: 1, qid: "A" }, { itemNo: 2, qid: "B" }, { itemNo: 3, qid: undefined }],
      perStudentItems: [] as { studentId: Types.ObjectId; itemNos: number[] }[],
    };
    expect(usesOfPaper(p, "HW").map((u) => [u.qid, u.studentIds, u.givenOn])).toEqual([["A", [], "2027-03-01"], ["B", [], "2027-03-01"]]);
    const s1 = new Types.ObjectId();
    const s2 = new Types.ObjectId();
    p.perStudentItems = [{ studentId: s1, itemNos: [1, 2] }, { studentId: s2, itemNos: [1] }];
    // AS: item 1 is on every sheet (Part A) → whole শাখা; item 2 only s1 → per child.
    expect(usesOfPaper(p, "AS", { wholeIfAll: true }).map((u) => [u.qid, (u.studentIds ?? []).length])).toEqual([["A", 0], ["B", 1]]);
    // Extra homework: always the named children.
    expect(usesOfPaper(p, "EXTRA_HW").map((u) => [u.qid, (u.studentIds ?? []).length])).toEqual([["A", 2], ["B", 1]]);
  });
});

// ---------------------------------------------------------------------------
// Writers — at the "given" moment, release switch OFF (§3.6)
// ---------------------------------------------------------------------------

describe("writers", () => {
  let hwPaperId = "";

  it("a draft is not a use (two teachers' drafts never block each other)", async () => {
    await lesson(secB, day(0));
    const before = await QuestionUse.countDocuments({});
    const d = await homeworkDraft(secB, "MATH", day(0), TEACHER);
    expect(d.items.length).toBeGreaterThan(0);
    expect(await QuestionUse.countDocuments({})).toBe(before);
  });

  it("a hand-made homework sheet writes HW rows for its bank questions (whole শাখা, its date); teacher items write none", async () => {
    const hw = await createPaper({
      sectionId: secB, subject: "MATH", source: "HW", date: day(90),
      items: [
        { origin: "BANK", artifactId: gold.get(Q(1)), loCode: A, questionTypeCode: "QT-SHORT" },
        { origin: "TEACHER", textBn: "১২ ÷ ৩", loCode: A, questionTypeCode: "QT-SHORT" },
      ],
    }, TEACHER);
    hwPaperId = hw.paperId;
    const rows = await QuestionUse.find({ qid: Q(1), kind: "HW" }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ givenOn: day(90), subject: "MATH", classToken: "C3", withdrawnAt: null });
    expect(rows[0].studentIds).toEqual([]);
    const paperDoc = await MasteryPaper.findOne({ paperId: hwPaperId }).select("_id").lean();
    expect(await QuestionUse.countDocuments({ sourceId: paperDoc!._id })).toBe(1);
    // Students 1–2 get 0 → WEAK, so extra homework has someone to go to.
    await saveResults(hwPaperId, [0, 1].map((i) => ({ studentId: sids[i], items: [{ itemNo: 1, marks: 0 }, { itemNo: 2, marks: 0 }] })), TEACHER);
    await confirmPaper(hwPaperId, TEACHER);
  });

  it("extra homework writes per-child EXTRA_HW rows at create (the items each child was given)", async () => {
    const q = (n: number) => ({ artifactId: gold.get(Q(n))!, loCode: A });
    await createExtraHomework({
      sectionId: secB, subject: "MATH", date: day(10),
      sheets: [{ studentId: sids[0], items: [q(2), q(3)] }, { studentId: sids[1], items: [q(2)] }],
    }, TEACHER);
    const q2 = await QuestionUse.findOne({ qid: Q(2), kind: "EXTRA_HW" }).lean();
    expect(q2!.studentIds.map(String).sort()).toEqual([sids[0], sids[1]].sort());
    expect(q2!.givenOn).toBe(day(10));
    const q3 = await QuestionUse.findOne({ qid: Q(3), kind: "EXTRA_HW" }).lean();
    expect(q3!.studentIds.map(String)).toEqual([sids[0]]);
  });

  it("AC-B11: deleting an OPEN sheet withdraws its rows, and the question is offered again", async () => {
    const hw = await createPaper({
      sectionId: secB, subject: "MATH", source: "HW", date: day(5),
      items: [{ origin: "BANK", artifactId: gold.get(Q(4)), loCode: A, questionTypeCode: "QT-SHORT" }],
    }, TEACHER);
    let led = await avoidFor({ sectionId: secB, academicYearId: yearId, classToken: "C3", subject: "MATH" });
    expect(led.forSection.has(Q(4))).toBe(true);
    await deletePaper(hw.paperId, TEACHER);
    const row = await QuestionUse.findOne({ qid: Q(4) }).lean();
    expect(row!.withdrawnAt).toBeInstanceOf(Date);
    led = await avoidFor({ sectionId: secB, academicYearId: yearId, classToken: "C3", subject: "MATH" });
    expect(led.forSection.has(Q(4))).toBe(false);
    expect((await questionUsageOf(Q(4)))).toBe(0);
  });

  it("issuing a tracker homework writes one HW row per picked question (given on its date); an item with none writes none", async () => {
    const item = await HomeworkItem.create({
      hwId: "HW-QU-1", academicYearId: yearId, classId, classLevel: 3, sectionId: new Types.ObjectId(secB), subject: "MATH",
      dateGiven: new Date(`${day(40)}T00:00:00.000Z`), topTags: ["T"], timeDecl: 20, qCount: 2, selectedQids: [Q(11), Q(11), Q(12)],
      description: "ভাগ", status: "declared", declaredBy: new Types.ObjectId(),
    });
    await issueHomeworkItem(String(item._id), sids.map((studentId) => ({ studentId, present: true })), "000000000000000000000000");
    const rows = await QuestionUse.find({ sourceType: "HOMEWORK_ITEM", sourceId: item._id }).lean();
    expect(rows.map((r) => r.qid).sort()).toEqual([Q(11), Q(12)]);
    expect(rows.every((r) => r.givenOn === day(40) && r.kind === "HW" && r.studentIds.length === 0)).toBe(true);
  });

  it("a linked CT sheet writes CT rows on the EXAM date; an unlinked one writes none", async () => {
    const test = await ClassTest.collection.insertOne({
      _id: new Types.ObjectId(), ctId: "CT-QU-1", sectionId: new Types.ObjectId(secB), subject: "MATH", status: "REQUESTED",
      examDate: new Date(`${day(3)}T00:00:00.000Z`), totalMarks: 2,
      academicYearId: yearId, classId, classLevel: 3, testNumber: 1, requestedBy: new Types.ObjectId(),
    });
    const paper = await createPaper({
      sectionId: secB, subject: "MATH", source: "CT", date: day(3), classTestId: String(test.insertedId),
      items: [{ origin: "BANK", artifactId: gold.get(Q(5)), loCode: A, questionTypeCode: "QT-SHORT" }],
    }, TEACHER);
    // AC-F1: kind CT, givenOn = exam date.
    expect(await QuestionUse.findOne({ qid: Q(5), kind: "CT" })).toMatchObject({ givenOn: day(3) });
    const before = await QuestionUse.countDocuments({});
    await createPaper({
      sectionId: secB, subject: "MATH", source: "CT", date: day(2),
      items: [{ origin: "BANK", artifactId: gold.get(Q(6)), loCode: A, questionTypeCode: "QT-SHORT" }],
    }, TEACHER);
    expect(await QuestionUse.countDocuments({})).toBe(before);
    expect(paper.paperId).toMatch(/^MP-C3-MATH-/);
  });

  it("an AS send writes AS rows: Part A for the whole শাখা, Part B per child — and never a homework question of the year (AC-C2)", async () => {
    const layout = {
      totalMarks: 6, minutes: 30, partAOn: true, partAMarks: 2, partALoCodes: [], partBMarks: 4,
      mixWeak: 60, mixImproving: 25, mixRevision: 15, questionTypeCodes: [] as string[],
    };
    const a = await buildAssignment({ sectionId: secB, subject: "MATH", dueDate: day(-3), layout, rememberLayout: false }, TEACHER);
    const hwYear = new Set((await homeworkUsedThisYear({ sectionIds: [secB], academicYearId: yearId })).map((r) => r.qid));
    expect(hwYear.has(Q(1)) && hwYear.has(Q(2)) && hwYear.has(Q(3))).toBe(true);
    expect(a.partA.length).toBeGreaterThan(0);
    // AC-B11 echo: the withdrawn Q(4) is a legal Part A pick again (first unused in order).
    expect(a.partA[0].qid).toBe(Q(4));
    // Part A (class-wide): no homework row of the শাখা at all. Part B: nothing that reached THAT child as homework.
    for (const q of a.partA) expect(hwYear.has(q.qid ?? "")).toBe(false);
    for (const s of a.sheets) {
      const mine = qidsOf(await homeworkUsedThisYear({ sectionIds: [secB], academicYearId: yearId, studentIds: [s.studentId] }), s.studentId);
      for (const q of (await sheetDetail(a.id, s.studentId, TEACHER)).items) expect(mine.has(q.qid ?? "")).toBe(false);
    }
    // A swap-in is held to the same rule.
    const s1 = await sheetDetail(a.id, sids[0], TEACHER);
    const i = s1.items.findIndex((q) => q.origin === "BANK");
    if (i >= 0) {
      const swapped = await editSheet(a.id, sids[0], { op: "SWAP", index: i }, TEACHER);
      const mine = qidsOf(await homeworkUsedThisYear({ sectionIds: [secB], academicYearId: yearId, studentIds: [sids[0]] }), sids[0]);
      expect(mine.has(swapped.items[i].qid ?? "")).toBe(false);
    }

    await approveAllSheets(a.id, TEACHER);
    const sent = await sendAssignment(a.id, TEACHER);
    expect(sent.status).toBe("SENT");
    const rows = await QuestionUse.find({ kind: "AS", sourceType: "MASTERY_PAPER" }).lean();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.find((r) => r.qid === a.partA[0].qid)!.studentIds).toEqual([]);
    // Whole-শাখা AS rows (Part A) are never a homework question of the শাখা.
    expect(rows.filter((r) => r.studentIds.length === 0).every((r) => !hwYear.has(r.qid))).toBe(true);
    expect(rows.every((r) => r.givenOn === todayKey())).toBe(true);
  });
});

async function questionUsageOf(qid: string): Promise<number> {
  const { questionUsageCounts } = await import("../modules/assessment/services/QuestionUsageService");
  return (await questionUsageCounts([qid])).get(qid) ?? 0;
}

// ---------------------------------------------------------------------------
// Window, scope, merge, enrolment
// ---------------------------------------------------------------------------

describe("the no-repeat window (days, not weeks)", () => {
  it("27 and 28 days ago are inside the 28-day window; 29 days ago is outside; withdrawn rows never count", async () => {
    const src = (n: number) => new Types.ObjectId(`00000000000000000000a${String(n).padStart(3, "0")}`);
    await put("QP-WIN-27", "HW", 27, { sectionId: secG, sourceId: src(1) });
    await put("QP-WIN-28", "AS", 28, { sectionId: secG, sourceId: src(2) });
    await put("QP-WIN-29", "CT", 29, { sectionId: secG, sourceId: src(3) });
    await put("QP-WIN-OFF", "HW", 1, { sectionId: secG, sourceId: src(4) });
    await withdrawUses("HOMEWORK_ITEM", src(4));
    const rows = await usedInWindow({ sectionIds: [secG], sinceDay: windowStartKey(todayKey(), 28) });
    const got = qidsOf(rows);
    expect(got.has("QP-WIN-27")).toBe(true);
    expect(got.has("QP-WIN-28")).toBe(true);
    expect(got.has("QP-WIN-29")).toBe(false);
    expect(got.has("QP-WIN-OFF")).toBe(false);
    // kinds filter
    const onlyAs = await usedInWindow({ sectionIds: [secG], sinceDay: windowStartKey(todayKey(), 28), kinds: ["AS"] });
    expect([...qidsOf(onlyAs)]).toEqual(["QP-WIN-28"]);
  });

  it("the window length is assignmentNoRepeatWeeks × 7 days", async () => {
    await savePolicy(null, null, { assignmentNoRepeatWeeks: 2 }, PRINCIPAL);
    try {
      await put("QP-WK-13", "HW", 13, { sectionId: secG });
      await put("QP-WK-15", "HW", 15, { sectionId: secG });
      const led = await avoidFor({ sectionId: secG, academicYearId: yearId, classToken: "C3", subject: "MATH" });
      expect(led.windowDays).toBe(14);
      expect(led.windowQids.has("QP-WK-13")).toBe(true);
      expect(led.windowQids.has("QP-WK-15")).toBe(false);
    } finally {
      await savePolicy(null, null, { assignmentNoRepeatWeeks: 4 }, PRINCIPAL);
    }
  });
});

describe("per child vs the whole শাখা, merged শাখা, a child's earlier শাখা", () => {
  it("a per-child row blocks that child only; a whole-শাখা row blocks everyone", async () => {
    await put("QP-CHILD", "EXTRA_HW", 3, { studentIds: [sids[0]], sectionId: secG });
    await put("QP-WHOLE", "HW", 3, { sectionId: secG });
    const rows = await usedInWindow({ sectionIds: [secG], sinceDay: day(28) });
    expect(qidsOf(rows, sids[0]).has("QP-CHILD")).toBe(true);
    expect(qidsOf(rows, sids[1]).has("QP-CHILD")).toBe(false);
    expect(qidsOf(rows, sids[1]).has("QP-WHOLE")).toBe(true);
    // The শাখা level (Part A, class homework) sees every row.
    expect(qidsOf(rows).has("QP-CHILD")).toBe(true);
    // A row for a child reaches that child even when asked by a different শাখা.
    const byChild = await usedInWindow({ sectionIds: [secM], studentIds: [sids[0]], sinceDay: day(28) });
    expect(qidsOf(byChild, sids[0]).has("QP-CHILD")).toBe(true);
  });

  it("AC-U2: a merged শাখা also reads its source শাখা — a question used in either in the last 28 days is excluded", async () => {
    await SectionMerge.collection.insertOne({
      classId, combinedSectionId: new Types.ObjectId(secM), sourceSectionIds: [new Types.ObjectId(secB), new Types.ObjectId(secG)],
      moves: [], status: "active", mergedBy: new Types.ObjectId(), mergedAt: new Date(),
    });
    await put("QP-MERGE-B", "AS", 3, { sectionId: secB });
    await put("QP-MERGE-G", "CT", 20, { sectionId: secG });
    const led = await avoidFor({ sectionId: secM, academicYearId: yearId, classToken: "C3", subject: "MATH" });
    expect(led.forSection.has("QP-MERGE-B")).toBe(true);
    expect(led.forSection.has("QP-MERGE-G")).toBe(true);
    // After a split back the merge is no longer active: the merged শাখা reads only its own rows.
    await SectionMerge.updateMany({ combinedSectionId: secM }, { $set: { status: "split" } });
    const after = await avoidFor({ sectionId: secM, academicYearId: yearId, classToken: "C3", subject: "MATH" });
    expect(after.forSection.has("QP-MERGE-B")).toBe(false);
  });

  it("a child's history follows the child: whole-শাখা uses of the earlier শাখা during their enrolment there", async () => {
    const [kid] = await Student.create([{ schoolId: "QU-E1", name: "Mover", rollNumber: "9", classId, sectionId: new Types.ObjectId(secG), active: true }]);
    const k = String(kid._id);
    await Enrolment.create([
      { studentId: kid._id, academicYearId: yearId, classId, classLevel: 3, sectionId: new Types.ObjectId(secB), status: "CLOSED", startKey: "2026-01-01", endKey: day(20) },
      { studentId: kid._id, academicYearId: yearId, classId, classLevel: 3, sectionId: new Types.ObjectId(secG), status: "ACTIVE", startKey: day(19) },
    ]);
    await put("QP-ENR-IN", "HW", 24, { sectionId: secB }); // while the child sat in B
    await put("QP-ENR-AFTER", "HW", 15, { sectionId: secB }); // after they left B
    const rows = await usedInWindow({ sectionIds: [secG], studentIds: [k], sinceDay: day(28) });
    expect(qidsOf(rows, k).has("QP-ENR-IN")).toBe(true);
    expect(qidsOf(rows, k).has("QP-ENR-AFTER")).toBe(false);
    // Without the child's id the earlier শাখা's rows are not read.
    expect(qidsOf(await usedInWindow({ sectionIds: [secG], sinceDay: day(28) })).has("QP-ENR-IN")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Class-test block (R19) — only with the release switch ON
// ---------------------------------------------------------------------------

describe("R19: the class-test block", () => {
  const actor = new Types.ObjectId().toString();
  const newCtSet = async () => (await createSet({ setType: "CT", sectionId: secB, classId: String(classId), actorId: actor })).setId;

  it("switch OFF: a question given as extra homework 10 days ago still goes into a class test (2026 behaviour unchanged)", async () => {
    await setLoop(false);
    const setId = await newCtSet();
    await expect(addQuestionToSet(setId, gold.get(Q(2))!, actor)).resolves.toMatchObject({ itemCount: 1 });
  });

  it("AC-F3, switch ON: extra homework to a roster child 10 days ago → refused with the reason; 30 days ago → allowed", async () => {
    await setLoop(true);
    try {
      await put(Q(13), "HW", 30);
      const setId = await newCtSet();
      // Q(2): EXTRA_HW to two children of the শাখা 10 days ago (written by the earlier test).
      await expect(addQuestionToSet(setId, gold.get(Q(2))!, actor)).rejects.toThrow(/এই প্রশ্ন গত ৪ সপ্তাহে বাড়ির কাজ \/ অ্যাসাইনমেন্টে ছিল/);
      await expect(addQuestionToSet(setId, gold.get(Q(13))!, actor)).resolves.toMatchObject({ itemCount: 1 });
      // The weeks in the message come from the policy.
      await savePolicy(null, null, { academicLoop2027On: true, assignmentNoRepeatWeeks: 6 }, PRINCIPAL);
      await put(Q(14), "AS", 40, { studentIds: [sids[2]] });
      await expect(addQuestionToSet(setId, gold.get(Q(14))!, actor)).rejects.toThrow(/গত ৬ সপ্তাহে/);
    } finally {
      await savePolicy(null, null, { academicLoop2027On: true, assignmentNoRepeatWeeks: 4 }, PRINCIPAL);
    }
  });

  it("is re-checked at finalise: a question given as homework after it was added blocks the assemble", async () => {
    await setLoop(false);
    const setId = await newCtSet();
    await addQuestionToSet(setId, gold.get(Q(15))!, actor); // allowed while the switch is off
    await put(Q(15), "HW", 2);
    await setLoop(true);
    await expect(assembleSet({ setId, actorId: actor })).rejects.toThrow(/গত ৪ সপ্তাহে/);
    await setLoop(false);
    await expect(assembleSet({ setId, actorId: actor })).resolves.toMatchObject({ status: "assembled" });
  });

  it("a CT mastery sheet is held to the same rule", async () => {
    await setLoop(true);
    try {
      await expect(
        createPaper({
          sectionId: secB, subject: "MATH", source: "CT", date: day(0),
          items: [{ origin: "BANK", artifactId: gold.get(Q(3)), loCode: A, questionTypeCode: "QT-SHORT" }],
        }, TEACHER),
      ).rejects.toThrow(/গত ৪ সপ্তাহে/);
    } finally {
      await setLoop(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Homework bank share (R21) + "আবার" (R23) — only with the release switch ON
// ---------------------------------------------------------------------------

describe("R21 / R23: the homework bank share and the repeat", () => {
  // Section G holds the fixture: a 12-question pool on A. Q1..Q6 are homework this year, oldest first.
  beforeAll(async () => {
    await lesson(secG, day(0));
    for (let n = 1; n <= 6; n++) await put(Q(n), "HW", 100 - n * 5, { sectionId: secG }); // 95, 90 … 70 days ago: all outside the window
  });

  it("switch OFF: unused first and never an HW-used question of the year (AC-B1); no share, no repeat", async () => {
    await setLoop(false);
    const d = await homeworkDraft(secG, "MATH", day(0), TEACHER);
    expect(d.items).toHaveLength(1);
    expect(d.items[0].repeat).toBe(false);
    expect([Q(1), Q(2), Q(3), Q(4), Q(5), Q(6)]).not.toContain(d.items[0].qid);
  });

  it("AC-B15, switch ON: pool 12, 6 used as homework (= 50 %) → no further unused question; the least-recently-used repeats, marked আবার", async () => {
    await setLoop(true);
    const d = await homeworkDraft(secG, "MATH", day(0), TEACHER);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ qid: Q(1), repeat: true, origin: "BANK" }); // 95 days ago = least recently used
    // The assignment / class-test pickers still see the other half of the pool.
    const led = await avoidFor({ sectionId: secG, academicYearId: yearId, classToken: "C3", subject: "MATH" });
    for (let n = 7; n <= 12; n++) expect(led.homeworkYear.has(Q(n))).toBe(false);
    expect(led.homeworkYear.size).toBeGreaterThanOrEqual(6);
  });

  it("a repeat is never a question given in the window: with every used one recent, there is nothing (the book line comes in AL-4/5)", async () => {
    for (let n = 1; n <= 6; n++) await put(Q(n), "AS", 2, { sectionId: secG });
    const d = await homeworkDraft(secG, "MATH", day(0), TEACHER);
    expect(d.items).toEqual([]);
    expect(d.gaps).toEqual([A]);
  });

  it("share not yet used up: a fresh question is offered and is not a repeat", async () => {
    await QuestionUse.deleteMany({ sectionId: new Types.ObjectId(secG), qid: { $in: [Q(4), Q(5), Q(6)] } });
    await QuestionUse.updateMany({ sectionId: new Types.ObjectId(secG), qid: { $in: [Q(1), Q(2), Q(3)] }, kind: "AS" }, { $set: { withdrawnAt: new Date() } });
    const d = await homeworkDraft(secG, "MATH", day(0), TEACHER); // 3 of 12 used < 6 → take 1 fresh
    expect(d.items[0].repeat).toBe(false);
    expect([Q(1), Q(2), Q(3)]).not.toContain(d.items[0].qid);
    await setLoop(false);
  });
});

// ---------------------------------------------------------------------------
// AC-U3 — a group-anchored test
// ---------------------------------------------------------------------------

describe("AC-U3: a group-anchored class test", () => {
  it("its AssessmentSet print writes one row per member শাখা, each naming only that শাখা's group members, on the exam date", async () => {
    const [grp] = await SubjectGroup.create([{ track: "arabic", level: "Book 1", gender: "mixed", code: "AR-QU-1", nameBn: "আরবি ১" }]);
    await SubjectGroupMembership.create([
      { groupId: grp._id, studentId: new Types.ObjectId(sids[0]), track: "arabic" },
      { groupId: grp._id, studentId: new Types.ObjectId(g1), track: "arabic" },
    ]);
    const set = await AssessmentSet.create({
      setType: "CT", sectionId: new Types.ObjectId(secB), classId, status: "assembled",
      basketItems: [{ artifactId: new Types.ObjectId(gold.get(Q(16))), qid: Q(16), marks: 2 }, { artifactId: new Types.ObjectId(gold.get(Q(17))), qid: Q(17), marks: 2 }],
      createdBy: new Types.ObjectId(), assembledAt: new Date(),
    });
    const test = await ClassTest.collection.insertOne({
      _id: new Types.ObjectId(), ctId: "CT-QU-G", subjectGroupId: grp._id, subject: "ARABIC", setId: set._id, status: "REQUESTED",
      examDate: new Date(`${day(-7)}T00:00:00.000Z`),
    });
    expect(await writeSetUses(set._id, { classTestId: String(test.insertedId) })).toBe(4);
    const rows = await QuestionUse.find({ sourceType: "ASSESSMENT_SET", sourceId: set._id, qid: Q(16) }).lean();
    expect(rows).toHaveLength(2);
    const bySec = new Map(rows.map((r) => [String(r.sectionId), r.studentIds.map(String)]));
    expect(bySec.get(secB)).toEqual([sids[0]]);
    expect(bySec.get(secG)).toEqual([g1]);
    expect(rows.every((r) => r.kind === "CT" && r.givenOn === day(-7))).toBe(true);
    // Printing again changes nothing.
    await writeSetUses(set._id, { classTestId: String(test.insertedId) });
    expect(await QuestionUse.countDocuments({ sourceType: "ASSESSMENT_SET", sourceId: set._id })).toBe(4);
  });

  it("a plain section CT set writes one whole-শাখা row per question (the print day when no test names it)", async () => {
    const set = await AssessmentSet.create({
      setType: "CT", sectionId: new Types.ObjectId(secB), classId, status: "assembled",
      basketItems: [{ artifactId: new Types.ObjectId(gold.get(Q(18))), qid: Q(18), marks: 2 }],
      createdBy: new Types.ObjectId(), assembledAt: new Date(),
    });
    await writeSetUses(set._id);
    const rows = await QuestionUse.find({ sourceId: set._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "CT", givenOn: todayKey() });
    expect(rows[0].studentIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Review fixes: the switch OFF changes nothing; reprint; member-only group check; withdraw on cancel
// ---------------------------------------------------------------------------

describe("release switch OFF: the builders behave as in 2026", () => {
  let gHw = "";
  beforeAll(async () => {
    await setLoop(false);
    await QuestionUse.deleteMany({ sectionId: new Types.ObjectId(secG), qid: { $regex: "^QP-MATH-C3-U07-Q94" } });
    // Evidence for the শাখা: two zero items on A (teacher-written, so no ledger row) → g1 is WEAK.
    const hw = await createPaper({
      sectionId: secG, subject: "MATH", source: "HW", date: day(200),
      items: [
        { origin: "TEACHER", textBn: "১ + ১", loCode: A, questionTypeCode: "QT-SHORT" },
        { origin: "TEACHER", textBn: "২ + ২", loCode: A, questionTypeCode: "QT-SHORT" },
      ],
    }, TEACHER);
    gHw = hw.paperId;
    await saveResults(gHw, [{ studentId: g1, items: [{ itemNo: 1, marks: 0 }, { itemNo: 2, marks: 0 }] }], TEACHER);
    await confirmPaper(gHw, TEACHER);
    // The WHOLE objective pool is in the ledger for this শাখা (tracker homework, recent).
    for (let n = 1; n <= 12; n++) await put(Q(n), "HW", 3, { sectionId: secG });
  });

  it("Part A still returns an item through its fallback (the ledger only softens the seen set)", async () => {
    const layout = {
      totalMarks: 2, minutes: 10, partAOn: true, partAMarks: 2, partALoCodes: [], partBMarks: 0,
      mixWeak: 60, mixImproving: 25, mixRevision: 15, questionTypeCodes: [] as string[],
    };
    const off = await buildAssignment({ sectionId: secG, subject: "MATH", dueDate: day(-9), layout, rememberLayout: false }, TEACHER);
    expect(off.partA).toHaveLength(1);
    // Switch ON: the hard rule of 4.3 — a homework question of the year is never in an assignment.
    await setLoop(true);
    try {
      const on = await buildAssignment({ sectionId: secG, subject: "MATH", dueDate: day(-9), layout, rememberLayout: false }, TEACHER);
      expect(on.partA).toHaveLength(0);
    } finally {
      await setLoop(false);
    }
  });

  it("the class-homework draft still returns an item (the book line) although every bank question is in the ledger", async () => {
    await MasteryOutcome.updateOne({ code: A }, { $set: { bookRef: { version: null, chapter: 7, lesson: null, exercises: ["7/অনুশীলনী/1"] } } });
    const d = await homeworkDraft(secG, "MATH", day(0), TEACHER);
    expect(d.items.map((i) => [i.origin, i.fromBook])).toEqual([["TEACHER", true]]);
  });

  it("extra homework accepts a manual pick that was only in the শাখা's tracker homework; ON it refuses", async () => {
    const pick = { artifactId: gold.get(Q(5))!, loCode: A };
    await expect(createExtraHomework({ sectionId: secG, subject: "MATH", date: day(1), sheets: [{ studentId: g1, items: [pick] }] }, TEACHER)).resolves.toMatchObject({ extra: true });
    await setLoop(true);
    try {
      await expect(createExtraHomework({ sectionId: secG, subject: "MATH", date: day(2), sheets: [{ studentId: g1, items: [{ artifactId: gold.get(Q(6))!, loCode: A }] }] }, TEACHER))
        .rejects.toThrow(/আগেই দেখেছে/);
    } finally {
      await setLoop(false);
    }
  });

  it("switch ON: the R23 repeat never offers a question on a child's open extra sheet", async () => {
    // Open extra sheet (made while OFF above) holds Q5 for g1. Rebuild the share: six old homework questions, Q5 the oldest.
    await QuestionUse.deleteMany({ sectionId: new Types.ObjectId(secG), qid: { $regex: "^QP-MATH-C3-U07-Q94" }, kind: { $ne: "EXTRA_HW" } });
    for (const [n, ago] of [[5, 90], [2, 80], [1, 70], [3, 70], [4, 70], [6, 70]] as const) await put(Q(n), "HW", ago, { sectionId: secG });
    await setLoop(true);
    try {
      const d = await homeworkDraft(secG, "MATH", day(0), TEACHER);
      expect(d.items).toHaveLength(1);
      expect(d.items[0]).toMatchObject({ repeat: true });
      expect(d.items[0].qid).not.toBe(Q(5)); // the oldest, but it is on g1's open sheet
      expect(d.items[0].qid).toBe(Q(2));
    } finally {
      await setLoop(false);
    }
  });
});

describe("repeat writes and withdraw on cancel", () => {
  it("a reprint changes nothing: the first given day wins; a withdrawn row given again takes the new day", async () => {
    const sourceId = new Types.ObjectId();
    const row = (givenOn: string) => ({
      qid: "QP-REPRINT", kind: "CT" as const, sourceType: "ASSESSMENT_SET" as const, sourceId, itemNo: 1,
      academicYearId: yearId, sectionId: secB, classToken: "C3", subject: "MATH", givenOn,
    });
    await recordUses([row(day(10))]);
    await recordUses([row(day(1))]);
    expect((await QuestionUse.findOne({ qid: "QP-REPRINT" }).lean())!.givenOn).toBe(day(10));
    expect(await QuestionUse.countDocuments({ qid: "QP-REPRINT" })).toBe(1);
    await withdrawUses("ASSESSMENT_SET", sourceId);
    await recordUses([row(day(1))]);
    const again = await QuestionUse.findOne({ qid: "QP-REPRINT" }).lean();
    expect(again!.givenOn).toBe(day(1));
    expect(again!.withdrawnAt).toBeNull();
  });

  it("a cancelled print request withdraws its set's rows — unless another live request still carries the set", async () => {
    const setId = new Types.ObjectId();
    await recordUses([{ qid: "QP-PRINT-C", kind: "HW", sourceType: "ASSESSMENT_SET", sourceId: setId, itemNo: 1, academicYearId: yearId, sectionId: secB, classToken: "C3", subject: "MATH", givenOn: day(1) }]);
    const { PrintRequest } = await import("../modules/printing/models/PrintRequest");
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    await PrintRequest.collection.insertMany([{ _id: a, setId, status: "CANCELLED" }, { _id: b, setId, status: "REQUESTED" }]);
    await withdrawForCancelledPrint(setId, a);
    expect((await QuestionUse.findOne({ qid: "QP-PRINT-C" }).lean())!.withdrawnAt).toBeNull();
    await PrintRequest.collection.updateOne({ _id: b }, { $set: { status: "CANCELLED" } });
    await withdrawForCancelledPrint(setId, b);
    expect((await QuestionUse.findOne({ qid: "QP-PRINT-C" }).lean())!.withdrawnAt).toBeInstanceOf(Date);
  });

  it("a cancelled class test withdraws its set's rows and its CT sheet's rows", async () => {
    const setId = new Types.ObjectId();
    const test = await ClassTest.collection.insertOne({ _id: new Types.ObjectId(), ctId: "CT-QU-X", sectionId: new Types.ObjectId(secB), subject: "MATH", setId, status: "CANCELLED" });
    await recordUses([{ qid: "QP-CT-CANCEL", kind: "CT", sourceType: "ASSESSMENT_SET", sourceId: setId, itemNo: 1, academicYearId: yearId, sectionId: secB, classToken: "C3", subject: "MATH", givenOn: day(1) }]);
    await withdrawForClassTest(test.insertedId);
    expect((await QuestionUse.findOne({ qid: "QP-CT-CANCEL" }).lean())!.withdrawnAt).toBeInstanceOf(Date);
  });

  it("a reverted top-up withdraws only the spawned resubmission's rows, not the child's other top-up rows on the item", async () => {
    const itemId = new Types.ObjectId();
    const base = { kind: "HW" as const, sourceType: "HOMEWORK_ITEM" as const, sourceId: itemId, academicYearId: yearId, sectionId: secB, classToken: "C3", subject: "MATH", studentIds: [sids[0]] };
    await recordUses([{ ...base, qid: "QP-TOP-1", givenOn: day(5) }, { ...base, qid: "QP-TOP-2", givenOn: day(2) }]);
    await withdrawUses("HOMEWORK_ITEM", itemId, { studentIds: [sids[0]], qids: ["QP-TOP-2"], givenOn: day(2) });
    expect((await QuestionUse.findOne({ qid: "QP-TOP-1" }).lean())!.withdrawnAt).toBeNull();
    expect((await QuestionUse.findOne({ qid: "QP-TOP-2" }).lean())!.withdrawnAt).toBeInstanceOf(Date);
  });
});

describe("group-anchored check tests only the group's member children", () => {
  it("a use by a NON-member child of the member শাখা does not block; a member's does", async () => {
    const [grp] = await SubjectGroup.create([{ track: "quran", level: "Najera", gender: "mixed", code: "QU-Q-1", nameBn: "নাজেরা" }]);
    await SubjectGroupMembership.create([{ groupId: grp._id, studentId: new Types.ObjectId(sids[2]), track: "quran" }]);
    await put(Q(19), "EXTRA_HW", 3, { studentIds: [sids[1]] }); // not a member
    await put(Q(20), "EXTRA_HW", 3, { studentIds: [sids[2]] }); // a member
    const mk = async (qid: string, ctId: string) => {
      const set = await AssessmentSet.create({
        setType: "CT", sectionId: new Types.ObjectId(secB), classId, status: "assembled",
        basketItems: [{ artifactId: new Types.ObjectId(gold.get(qid)), qid, marks: 2 }], createdBy: new Types.ObjectId(), assembledAt: new Date(),
      });
      const t = await ClassTest.collection.insertOne({ _id: new Types.ObjectId(), ctId, subjectGroupId: grp._id, subject: "QURAN", setId: set._id, status: "REQUESTED", examDate: new Date(`${day(-7)}T00:00:00.000Z`) });
      return { set, testId: String(t.insertedId) };
    };
    await setLoop(true);
    try {
      const ok = await mk(Q(19), "CT-QU-M1");
      await expect(assertSetCtAllowed(ok.set._id, ok.testId)).resolves.toBeUndefined();
      const bad = await mk(Q(20), "CT-QU-M2");
      await expect(assertSetCtAllowed(bad.set._id, bad.testId)).rejects.toBeInstanceOf(CtBlockError);
    } finally {
      await setLoop(false);
    }
    // Switch OFF: nothing is read, nothing refused.
    const off = await mk(Q(20), "CT-QU-M3");
    await expect(assertSetCtAllowed(off.set._id, off.testId)).resolves.toBeUndefined();
  });
});

describe("backfill", () => {
  it("dry run writes nothing; --apply rebuilds the ledger from the sources; a second run adds nothing; a withdrawn row stays withdrawn", async () => {
    // The rows whose source really exists (the window / scope fixtures wrote rows for sources that are not documents).
    const real = new Set<string>([
      ...(await MasteryPaper.find({}).select("_id").lean()).map((d) => String(d._id)),
      ...(await AssessmentSet.find({}).select("_id").lean()).map((d) => String(d._id)),
      ...(await HomeworkItem.find({}).select("_id").lean()).map((d) => String(d._id)),
    ]);
    const fromSources = (await QuestionUse.find({ withdrawnAt: null }).lean())
      .filter((r) => real.has(String(r.sourceId)))
      .map((r) => r.useKey)
      .sort();
    expect(fromSources.length).toBeGreaterThan(0);
    await QuestionUse.deleteMany({});

    const dry = await backfillQuestionUse({ apply: false });
    expect(await QuestionUse.countDocuments({})).toBe(0);
    expect(Object.values(dry).reduce((n, t) => n + t.added, 0)).toBeGreaterThan(0);

    const first = await backfillQuestionUse({ apply: true });
    const afterFirst = await QuestionUse.countDocuments({});
    expect(afterFirst).toBe(Object.values(first).reduce((n, t) => n + t.added, 0));
    const keys = new Set((await QuestionUse.find({}).select("useKey").lean()).map((r) => r.useKey));
    for (const k of fromSources) expect(keys.has(k)).toBe(true);

    // Run twice = the same count (idempotent), and the report says nothing new was found to add.
    const second = await backfillQuestionUse({ apply: true });
    expect(Object.values(second).reduce((n, t) => n + t.added, 0)).toBe(0);
    expect(await QuestionUse.countDocuments({})).toBe(afterFirst);

    // A row withdrawn on purpose is not revived by a later backfill.
    const one = await QuestionUse.findOne({ sourceType: "MASTERY_PAPER" }).lean();
    await withdrawUses("MASTERY_PAPER", one!.sourceId);
    await backfillQuestionUse({ apply: true });
    expect((await QuestionUse.find({ sourceType: "MASTERY_PAPER", sourceId: one!.sourceId }).lean()).every((r) => r.withdrawnAt)).toBe(true);
    expect(await QuestionUse.countDocuments({})).toBe(afterFirst);
  });

  it("the live writer and the backfill share one key: writing the same use again adds no row", async () => {
    const n = await QuestionUse.countDocuments({});
    const one = await QuestionUse.findOne({ withdrawnAt: null }).lean();
    await recordUses([{
      qid: one!.qid, kind: one!.kind, sourceType: one!.sourceType, sourceId: one!.sourceId, itemNo: one!.itemNo,
      academicYearId: one!.academicYearId, sectionId: one!.sectionId, classToken: one!.classToken, subject: one!.subject,
      studentIds: one!.studentIds, givenOn: one!.givenOn,
    }]);
    expect(await QuestionUse.countDocuments({})).toBe(n);
  });
});

// A MasteryOutcome import guard so a catalogue regression fails loudly here, not in a builder.
it("fixture: the catalogue locked objective A with a QT-SHORT marks of 2", async () => {
  expect((await MasteryOutcome.findOne({ code: A }).lean())!.status).toBe("LOCKED");
});
