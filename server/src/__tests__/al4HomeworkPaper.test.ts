/**
 * AL-4 — homework paper with per-question marks, server side (docs/prd-academic-loop-2027.md §3.1, §3.6, §4.7, §7).
 * ACs: AC-B2..B5, B7..B17, AC-S1, AC-R1.
 *
 *   OFF       the release switch off → every 2026 flow is unchanged: no paper at declare, no free lines, the AL-3
 *             HOMEWORK_ITEM rows at issue, a hand paper confirms with GIVEN records and writes no cache, manual checks
 *             work, the substitute has no reach, MASTERY_PAPER cannot be printed (AC-B7, AC-R1)
 *   index     the extra:false backfill + duplicate check + the partial unique index (script logic, dry run first)
 *   declare   AC-B2 one paper per item (+ the unique index), AC-B13 marks-only, AC-B14 free lines, AC-B17 1.8 min/mark
 *   print     AC-B3 PrintRequest source MASTERY_PAPER, items lock, rows at send, cancel unlocks + withdraws
 *   confirm   AC-B8 GIVEN/DUE refused, AC-B9 no record → off the paper, AC-B4 evidence + CHECKED + totals,
 *             AC-B12 thresholds and no auto-spawn, AC-B10 manual-check guard, AC-B5 correction (one child, one note)
 *   void      AC-B11 delete with a live print refused; delete withdraws; a confirmed paper's void excludes evidence
 *   AC-S1     today's substitute reaches the absent teacher's শাখা × subject; another teacher is refused
 *
 * In-memory MongoDB, real services; only the routine lookup is stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a),
}));

// AL-5 added a save-time pick guard (window / share, see al5Screens.test.ts). These AL-4 cases reuse the same few
// questions on many dates to test other rules, so the guard is stubbed here.
jest.mock("../modules/mastery/services/HomeworkPickRules", () => ({
  assertPicksAllowed: async () => undefined,
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { RoutineSubstitution } from "../modules/routine/models/RoutineSubstitution";
import { PrintRequest } from "../modules/printing/models/PrintRequest";
import { QuestionUse } from "../modules/assessment/models/QuestionUse";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { MasteryExclusion } from "../modules/mastery/models/MasteryExclusion";
import { StaffMistakeNote } from "../modules/staff-mistakes/models/StaffMistakeNote";
import { importCatalogue, savePolicy, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import {
  confirmPaper, createPaper, deletePaper, paperDetail, saveResults, MasteryWorkError,
} from "../modules/mastery/services/MasteryWorkService";
import {
  declareHomeworkItem, deleteHomeworkItem, issueHomeworkItem, transitionRecord, updateHomeworkItem,
} from "../modules/trackers/services/HomeworkService";
import { checkAssignmentRecord } from "../modules/trackers/services/AssignmentCheckingService";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import { revertHomeworkRecord } from "../modules/trackers/services/HomeworkRevertService";
import { applyTrim } from "../modules/trackers/services/HomeworkReconciliationService";
import { callerHasPermission } from "@scd/shared";
import { checkRecord } from "../modules/trackers/services/HomeworkResubmissionService";
import { tallyDay } from "../modules/trackers/services/HomeworkReconciliationService";
import { freeLineGrid, saveFreeLineTicks } from "../modules/trackers/services/HomeworkFreeLineService";
import { createPrintRequest, cancelPrintRequest } from "../modules/printing/services/PrintRequestService";
import { backfillPaperExtraFalse, PAPER_LINK_INDEX_NAME } from "../modules/mastery/services/PaperLinkIndex";
import { renderHomeworkPaperPdf } from "../modules/mastery/services/MasteryHomeworkPdf";
import {
  homeworkMinutes, isTodaySubstituteFor, liveEvidenceCount, voidConfirmedPaper, PAPER_LOCKED_MESSAGE,
} from "../modules/mastery/services/HomeworkPaperService";
import { childTotals, resultFromPct, SHEET_GUARD_MESSAGE } from "../modules/mastery/paperLink";
import { restoreForClassTest, withdrawForClassTest, usesOfPaper } from "../modules/assessment/services/QuestionUseService";

jest.setTimeout(240_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
const OTHER = { userId: new Types.ObjectId().toString(), role: "TEACHER" as const };
let yearId = new Types.ObjectId();
let classId = new Types.ObjectId();
let sectionId = "";
let sectionG = "";
const sids: string[] = []; // 6 students of B, school ids 1..6 (created out of order on purpose)
const gold = new Map<string, string>();

const A = "LO-C3-MATH-07-01";
const MQ = (n: number) => `QP-MATH-C3-U07-Q95${String(n).padStart(3, "0")}`;
const EQ = (n: number) => `QP-ENG-C3-U01-Q95${String(n).padStart(3, "0")}`;
const CATALOGUE = JSON.stringify({
  classToken: "C3", subject: "MATH", status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [{ code: A, labelBn: "ভাগের ধারণা", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] }],
  questionTypes: [{ code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 2 }],
});

const setLoop = (on: boolean) => savePolicy(null, null, { academicLoop2027On: on }, PRINCIPAL);
const declare = (over: Record<string, unknown> = {}) =>
  declareHomeworkItem({
    academicYearId: String(yearId), classId: String(classId), classLevel: 3, sectionId, subject: "MATH",
    dateGiven: "2027-03-07", topTags: ["TOP-MATH-C3-GEN"], qCount: 1, description: "বাড়ির কাজ", actorId: TEACHER_ID,
    ...over,
  } as never);
const roster = (ids: string[], absent: string[] = []) => ids.map((studentId) => ({ studentId, present: !absent.includes(studentId) }));
/** The student created with school id AL4-<n> (they were created out of order on purpose). */
const kid = (n: number): string => sids[[4, 2, 6, 1, 5, 3].indexOf(n)]!;
const records = (hwItemId: string) => HomeworkStudentRecord.find({ hwItemId: new Types.ObjectId(hwItemId), resubOf: null }).lean();
async function handIn(hwItemId: string, studentIds: string[], chase: string[] = []) {
  for (const r of await records(hwItemId)) {
    if (r.state !== "GIVEN") continue;
    await transitionRecord({ recordId: String(r._id), toState: "DUE", actorId: TEACHER_ID });
    await transitionRecord({ recordId: String(r._id), toState: chase.includes(String(r.studentId)) ? "CHASE" : "SUBMITTED", actorId: TEACHER_ID });
  }
  void studentIds;
}
const itemOf = (id: string) => HomeworkItem.findById(id);
const paperOf = async (itemId: string) => MasteryPaper.findById((await itemOf(itemId))!.paperId);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = year._id;
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  classId = cls._id;
  const [b, g] = await Section.create([
    { classId: cls._id, code: "B", nameBn: "বালক" },
    { classId: cls._id, code: "G", nameBn: "বালিকা" },
  ]);
  sectionId = String(b._id);
  sectionG = String(g._id);
  // School ids created out of order: the grid must still list them 1..6.
  for (const n of [4, 2, 6, 1, 5, 3]) {
    const [s] = await Student.create([{ schoolId: `AL4-${n}`, name: `Student ${n}`, rollNumber: String(10 - n), classId: cls._id, sectionId: b._id, active: true }]);
    sids.push(String(s._id));
  }
  const r = await importCatalogue(CATALOGUE, true, PRINCIPAL);
  if (!r.ok) throw new Error(r.errors.join("; "));
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL); // MATH: mastery ON; ENG: no locked tree
  const base = {
    docType: "question", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 },
    curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold",
  };
  for (let n = 1; n <= 16; n++) {
    const [a] = await ContentArtifact.create([{ ...base, subject: "MATH", envelopeJson: { tags: { topic_tag: A }, payload: { qid: MQ(n), topic_tag: A, marks: 2, question_text: `${MQ(n)} লেখা` } } }]);
    gold.set(MQ(n), String(a._id));
  }
  for (let n = 1; n <= 6; n++) {
    const [a] = await ContentArtifact.create([{ ...base, subject: "ENG", envelopeJson: { tags: {}, payload: { qid: EQ(n), marks: 2, question_text: `${EQ(n)} text` } } }]);
    gold.set(EQ(n), String(a._id));
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
describe("pure rules", () => {
  it("R26: 10 marks at 1.8 min/mark are 18 minutes; free lines add their own estimate; non-integers round", () => {
    expect(homeworkMinutes([2, 2, 2, 2, 2], [], 1.8)).toBe(18);
    expect(homeworkMinutes([2, 2], [{ estMinutes: 10 }], 1.8)).toBe(17);
    expect(homeworkMinutes([7], [], 1.8)).toBe(13);
  });
  it("childTotals: no row = full marks, ½ marks, the child's own items only", () => {
    const items = [{ itemNo: 1, marks: 2 }, { itemNo: 2, marks: 2 }, { itemNo: 3, marks: 2 }];
    expect(childTotals(items, new Map())).toEqual({ earned: 6, available: 6 });
    expect(childTotals(items, new Map([[3, 1.5]]))).toEqual({ earned: 5.5, available: 6 });
    expect(childTotals(items, new Map([[1, 0]]), new Set([1, 2]))).toEqual({ earned: 2, available: 4 });
  });
  it("AC-B12: 7/10 CORRECT, 5/10 PARTIAL, 4½/10 WRONG (policy 70 / 50)", () => {
    expect(resultFromPct(7, 10, 70, 50)).toBe("CORRECT");
    expect(resultFromPct(5, 10, 70, 50)).toBe("PARTIAL");
    expect(resultFromPct(4.5, 10, 70, 50)).toBe("WRONG");
    expect(resultFromPct(0, 0, 70, 50)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("switch OFF: every 2026 flow is unchanged (AC-B7, AC-R1)", () => {
  beforeAll(async () => {
    await setLoop(false);
  });

  it("declare with picked qids makes no paper, ignores free lines, keeps the typed time; issue writes the AL-3 item rows", async () => {
    const it = await declare({ dateGiven: "2027-03-07", selectedQids: [MQ(1), MQ(2)], qCount: 2, timeDecl: 20, freeLines: [{ kind: "HANDWRITING", textBn: "লেখা", estMinutes: 10 }] });
    expect(it.paperId).toBeNull();
    expect(it.freeLines).toEqual([]);
    expect(it.timeDecl).toBe(20);
    expect(await MasteryPaper.countDocuments({})).toBe(0);
    await issueHomeworkItem(it.itemId, roster(sids), TEACHER_ID);
    const rows = await QuestionUse.find({ sourceType: "HOMEWORK_ITEM", sourceId: new Types.ObjectId(it.itemId), withdrawnAt: null });
    expect(rows.map((r) => r.qid).sort()).toEqual([MQ(1), MQ(2)]);
  });

  it("the manual check still works (no guard) and a derived-free record keeps no cache", async () => {
    const it = await declare({ dateGiven: "2027-03-08", selectedQids: [MQ(3)], qCount: 1 });
    await issueHomeworkItem(it.itemId, roster(sids), TEACHER_ID);
    await handIn(it.itemId, sids);
    const rec = (await records(it.itemId))[0]!;
    const out = await checkRecord({ recordId: String(rec._id), result: "CORRECT", actorId: TEACHER_ID });
    expect(out.result).toBe("CORRECT");
  });

  it("a hand-made HW sheet linked to its item writes its rows at create (AL-3) and confirms with GIVEN records; no cache, no paperId", async () => {
    const it = await declare({ dateGiven: "2027-03-09", qCount: 1 });
    await issueHomeworkItem(it.itemId, roster(sids), TEACHER_ID); // every record GIVEN
    const p = await createPaper({ sectionId, subject: "MATH", source: "HW", date: "2027-03-09", hwItemId: it.itemId, items: [{ origin: "BANK", artifactId: gold.get(MQ(4)), loCode: A, questionTypeCode: "QT-SHORT" }] }, TEACHER);
    expect(await QuestionUse.countDocuments({ sourceType: "MASTERY_PAPER", qid: MQ(4), withdrawnAt: null })).toBe(1);
    expect((await itemOf(it.itemId))!.paperId).toBeUndefined();
    await confirmPaper(p.paperId, TEACHER); // 2026: no guard, GIVEN counts as PRESENT
    const rec = (await records(it.itemId))[0]!;
    expect(rec.state).toBe("GIVEN");
    expect(rec.earnedMarks).toBeUndefined();
    expect(await MasteryEvidence.countDocuments({ paperId: (await MasteryPaper.findOne({ paperId: p.paperId }))!._id })).toBe(sids.length);
  });

  it("MASTERY_PAPER cannot be sent to print; today's substitute has no reach", async () => {
    const paper = (await MasteryPaper.findOne({ source: "HW" }))!;
    await expect(
      createPrintRequest({ title: "x", purpose: "HOMEWORK", sourceType: "MASTERY_PAPER", masteryPaperId: String(paper._id), colour: "BW", sides: "SINGLE", copies: 1, requestedBy: TEACHER_ID }),
    ).rejects.toThrow(/চালু হয়নি/);
    expect(await isTodaySubstituteFor(OTHER.userId, sectionId, "MATH")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("the unique-link index script (dry run first)", () => {
  it("counts papers without extra, finds duplicates, builds the index only when clean", async () => {
    const hw = new Types.ObjectId();
    const raw = (n: number, extra?: boolean) => ({
      paperId: `RAW-${n}`, source: "HW", sectionId: new Types.ObjectId(sectionId), classId, academicYearId: yearId, classToken: "C3",
      subject: "MATH", date: new Date("2027-02-01"), links: { hwItemId: hw }, items: [], entryState: "OPEN", ...(extra === undefined ? {} : { extra }),
    });
    await MasteryPaper.collection.insertMany([raw(1), raw(2)]); // no extra field, same item
    const dry = await backfillPaperExtraFalse();
    expect(dry.missingExtra).toBe(2);
    expect(dry.duplicates).toHaveLength(1);
    expect(dry.indexPresent).toBe(false);
    expect(await MasteryPaper.countDocuments({ extra: { $exists: false } })).toBe(2); // the dry run wrote nothing
    await setLoop(true);
    const blocked = await backfillPaperExtraFalse({ apply: true });
    expect(blocked.indexBuilt).toBe(false); // duplicates: refuse
    await MasteryPaper.deleteOne({ paperId: "RAW-2" });
    await setLoop(false);
    const off = await backfillPaperExtraFalse({ apply: true }); // the extra:false backfill runs; the index waits for the switch
    expect(off.indexBuilt).toBe(false);
    expect(off.indexBlockedBySwitch).toBe(true);
    expect(await MasteryPaper.countDocuments({ extra: { $exists: false } })).toBe(0);
    await setLoop(true);
    const done = await backfillPaperExtraFalse({ apply: true });
    expect(done.duplicates).toHaveLength(0);
    expect(done.indexBuilt).toBe(true);
    expect(await MasteryPaper.countDocuments({ extra: { $exists: false } })).toBe(0);
    expect((await MasteryPaper.collection.indexes()).some((i) => i.name === PAPER_LINK_INDEX_NAME)).toBe(true);
    expect((await backfillPaperExtraFalse({ apply: true })).indexBuilt).toBe(false); // idempotent
    await MasteryPaper.deleteOne({ paperId: "RAW-1" });
  });
});

// ---------------------------------------------------------------------------
describe("switch ON: declare → the HW paper", () => {
  beforeAll(async () => {
    await setLoop(true);
  });

  it("AC-B2 + AC-B17: one HW paper (extra:false) linked both ways; 5 × 2 marks = 18 minutes in the day tally; a second class paper is refused by the index", async () => {
    const it = await declare({ dateGiven: "2027-03-14", selectedQids: [MQ(1), MQ(2), MQ(3), MQ(4), MQ(5)], qCount: 5, timeDecl: 40 });
    const item = (await itemOf(it.itemId))!;
    const paper = (await MasteryPaper.findById(item.paperId))!;
    expect(paper.source).toBe("HW");
    expect(paper.extra).toBe(false);
    expect(paper.marksOnly).toBeFalsy();
    expect(String(paper.links.hwItemId)).toBe(it.itemId);
    expect(paper.items.map((i) => i.qid)).toEqual([MQ(1), MQ(2), MQ(3), MQ(4), MQ(5)]);
    expect(paper.items[0]!.loCodes).toEqual([A]);
    expect(paper.items.reduce((s, i) => s + i.marks, 0)).toBe(10);
    expect(it.timeDecl).toBe(18); // not the typed 40, not grid × 2
    expect(item.qCount).toBe(5);
    const tally = await tallyDay(String(classId), new Date("2027-03-14T00:00:00Z"), sectionId);
    expect(tally.dayTotal).toBe(18);
    // Nothing is written to the ledger by a draft.
    expect(await QuestionUse.countDocuments({ sourceId: paper._id })).toBe(0);
    await expect(
      createPaper({ sectionId, subject: "MATH", source: "HW", date: "2027-03-14", hwItemId: it.itemId, items: [{ origin: "TEACHER", textBn: "x", loCode: A, questionTypeCode: "QT-SHORT" }] }, TEACHER),
    ).rejects.toThrow(/আগেই তৈরি হয়েছে/);
    expect(await MasteryPaper.countDocuments({ "links.hwItemId": new Types.ObjectId(it.itemId), extra: false })).toBe(1);
  });

  it("AC-B13 (R20): ENG has no locked tree → a marks-only paper; confirming writes tracker totals and ledger rows but NO evidence", async () => {
    const it = await declare({ dateGiven: "2027-03-14", subject: "ENG", topTags: ["TOP-ENG-C3-GEN"], selectedQids: [EQ(1), EQ(2)], qCount: 2 });
    const paper = (await paperOf(it.itemId))!;
    expect(paper.marksOnly).toBe(true);
    expect(paper.items.every((i) => i.loCodes.length === 0 && i.marks === 2)).toBe(true);
    await issueHomeworkItem(it.itemId, roster(sids), TEACHER_ID);
    expect(await QuestionUse.countDocuments({ sourceType: "MASTERY_PAPER", sourceId: paper._id, withdrawnAt: null })).toBe(2);
    expect(await QuestionUse.countDocuments({ sourceType: "HOMEWORK_ITEM", sourceId: new Types.ObjectId(it.itemId) })).toBe(0); // no double counting
    await handIn(it.itemId, sids);
    mockTeacher.mockResolvedValue(TEACHER_ID);
    await saveResults(paper.paperId, [{ studentId: sids[0]!, items: [{ itemNo: 1, marks: 1 }] }], TEACHER);
    const sum = await confirmPaper(paper.paperId, TEACHER);
    expect(sum.evidenceRows).toBe(0);
    expect(await MasteryEvidence.countDocuments({ paperId: paper._id })).toBe(0);
    const recs = await records(it.itemId);
    expect(recs.every((r) => r.state === "CHECKED" && r.availableMarks === 4)).toBe(true);
    expect(recs.find((r) => String(r.studentId) === sids[0])!.earnedMarks).toBe(3);
  });

  it("AC-B14 (R22): free lines only → no paper, no evidence; a child's 'not done' tick is stored; the tally uses the lines' minutes", async () => {
    const it = await declare({ dateGiven: "2027-03-15", qCount: 2, freeLines: [{ kind: "TEXTBOOK", textBn: "পাঠ ৩ পড়ে আসবে", estMinutes: 15 }, { kind: "HANDWRITING", textBn: "হাতের লেখা ১ পৃষ্ঠা", estMinutes: 10 }] });
    expect(it.paperId).toBeNull();
    expect(it.freeLines).toHaveLength(2);
    expect(it.timeDecl).toBe(25);
    expect((await tallyDay(String(classId), new Date("2027-03-15T00:00:00Z"), sectionId)).dayTotal).toBe(25);
    await issueHomeworkItem(it.itemId, roster(sids), TEACHER_ID);
    await handIn(it.itemId, sids);
    await saveFreeLineTicks(it.itemId, [{ studentId: sids[1]!, notDone: [1] }]);
    const grid = await freeLineGrid(it.itemId);
    expect(grid.rows.map((r) => r.schoolId)).toEqual(["AL4-1", "AL4-2", "AL4-3", "AL4-4", "AL4-5", "AL4-6"]); // ID order, not roll number
    expect(grid.rows.find((r) => r.studentId === sids[1])!.notDone).toEqual([1]);
    await expect(saveFreeLineTicks(it.itemId, [{ studentId: sids[1]!, notDone: [5] }])).rejects.toThrow(/ঠিক নয়/);
    expect(await MasteryEvidence.countDocuments({})).toBe(await MasteryEvidence.countDocuments({ paperId: { $exists: true } }));
  });

  it("AC-B14: a bank question + a free line + a teacher item on one homework: 10 + 2 marks and the line's minutes", async () => {
    const it = await declare({ dateGiven: "2027-03-16", selectedQids: [MQ(6)], qCount: 1, teacherItems: [{ textBn: "একটি বাক্য লেখো", marks: 3 }], freeLines: [{ kind: "READING", textBn: "পড়া", estMinutes: 5 }] });
    const paper = (await paperOf(it.itemId))!;
    expect(paper.items.map((i) => i.marks)).toEqual([2, 3]);
    expect(it.timeDecl).toBe(Math.round(5 * 1.8 + 5)); // 14
  });
});

// ---------------------------------------------------------------------------
describe("print: items lock, rows at send, cancel unlocks", () => {
  beforeAll(async () => {
    await setLoop(true);
  });

  it("AC-B3: প্রিন্টে পাঠান makes one MASTERY_PAPER request, writes a row per question, locks; an item edit is refused until it is cancelled", async () => {
    const it = await declare({ dateGiven: "2027-03-21", selectedQids: [MQ(7), MQ(8)], qCount: 2 });
    const paper = (await paperOf(it.itemId))!;
    await expect(
      createPrintRequest({ title: "x", purpose: "CLASSWORK", sourceType: "MASTERY_PAPER", masteryPaperId: String(paper._id), colour: "BW", sides: "SINGLE", copies: 1, requestedBy: TEACHER_ID }),
    ).rejects.toThrow(/HOMEWORK/);
    expect(await PrintRequest.countDocuments({})).toBe(0); // no request without the tap
    const pr = await createPrintRequest({
      title: "বাড়ির কাজ", purpose: "HOMEWORK", sourceType: "MASTERY_PAPER", masteryPaperId: String(paper._id),
      colour: "BW", sides: "SINGLE", copies: 1, copiesMode: "CLASS_PRESENT", neededByKey: "2027-03-22", requestedBy: TEACHER_ID,
    });
    expect(pr.sourceType).toBe("MASTERY_PAPER");
    expect(pr.copiesMode).toBe("CLASS_PRESENT");
    expect(String(pr.sectionId)).toBe(sectionId);
    const locked = (await MasteryPaper.findById(paper._id))!;
    expect(locked.lockedAt).toBeTruthy();
    expect(await QuestionUse.countDocuments({ sourceType: "MASTERY_PAPER", sourceId: paper._id, kind: "HW", withdrawnAt: null })).toBe(2);
    await expect(updateHomeworkItem({ itemId: it.itemId, selectedQids: [MQ(9)], actorId: TEACHER_ID })).rejects.toThrow(PAPER_LOCKED_MESSAGE);
    // cancel before printing → unlocked, rows withdrawn, the question is offered again, the edit goes through
    await cancelPrintRequest(String(pr._id), TEACHER_ID, { isOffice: false });
    expect((await MasteryPaper.findById(paper._id))!.lockedAt).toBeUndefined();
    expect(await QuestionUse.countDocuments({ sourceType: "MASTERY_PAPER", sourceId: paper._id, withdrawnAt: null })).toBe(0);
    await updateHomeworkItem({ itemId: it.itemId, selectedQids: [MQ(9)], actorId: TEACHER_ID });
    expect((await paperOf(it.itemId))!.items.map((i) => i.qid)).toEqual([MQ(9)]);
  });

  it("issue locks the paper and the PAPER writes the rows; a cancel after issue keeps them", async () => {
    const it = await declare({ dateGiven: "2027-03-22", selectedQids: [MQ(10)], qCount: 1 });
    const paper = (await paperOf(it.itemId))!;
    const pr = await createPrintRequest({ title: "x", purpose: "HOMEWORK", sourceType: "MASTERY_PAPER", masteryPaperId: String(paper._id), colour: "BW", sides: "SINGLE", copies: 1, copiesMode: "CLASS_PRESENT", neededByKey: "2027-03-23", requestedBy: TEACHER_ID });
    await issueHomeworkItem(it.itemId, roster(sids), TEACHER_ID);
    await cancelPrintRequest(String(pr._id), TEACHER_ID, { isOffice: false });
    expect(await QuestionUse.countDocuments({ sourceType: "MASTERY_PAPER", sourceId: paper._id, withdrawnAt: null })).toBe(1);
    expect((await MasteryPaper.findById(paper._id))!.lockedAt).toBeTruthy();
    await expect(updateHomeworkItem({ itemId: it.itemId, selectedQids: [MQ(11)], actorId: TEACHER_ID })).rejects.toThrow(/frozen|প্রিন্ট/);
  });

  it("the class-homework PDF renders for the subject teacher", async () => {
    const it = await declare({ dateGiven: "2027-03-23", selectedQids: [MQ(11)], qCount: 1, freeLines: [{ kind: "OTHER", textBn: "বই পড়া", estMinutes: 5 }] });
    const paper = (await paperOf(it.itemId))!;
    const out = await renderHomeworkPaperPdf(paper.paperId, TEACHER);
    expect(out.pdf.subarray(0, 4).toString()).toBe("%PDF");
    mockTeacher.mockResolvedValue(new Types.ObjectId().toString());
    await expect(renderHomeworkPaperPdf(paper.paperId, OTHER)).rejects.toThrow(MasteryWorkError);
  });
});

// ---------------------------------------------------------------------------
describe("confirm guards, write-back, correction", () => {
  let itemId = "";
  let paperId = "";
  let lateKid = "";
  beforeAll(async () => {
    await setLoop(true);
    const [s] = await Student.create([{ schoolId: "AL4-9", name: "Joined late", classId, sectionId: new Types.ObjectId(sectionId), active: false }]);
    lateKid = String(s._id);
    const it = await declare({ dateGiven: "2027-03-28", selectedQids: [MQ(1), MQ(2), MQ(3), MQ(4), MQ(5)], qCount: 5 });
    itemId = it.itemId;
    paperId = (await paperOf(itemId))!.paperId;
    await issueHomeworkItem(itemId, roster(sids, [kid(6)]), TEACHER_ID); // AL4-6 absent → ABSENT_REDELIVER
    await Student.updateOne({ _id: lateKid }, { $set: { active: true } }); // joined after the homework was given
  });

  it("AC-B8: records still GIVEN → confirm is refused, naming the children; no evidence", async () => {
    await expect(confirmPaper(paperId, TEACHER)).rejects.toThrow(/আগে জমা নেওয়ার হিসাব শেষ করুন.*Student/);
    const paper = (await paperOf(itemId))!;
    expect(await MasteryEvidence.countDocuments({ paperId: paper._id })).toBe(0);
  });

  it("AC-B10: a hand-typed result on a linked record is refused; an unlinked item still checks", async () => {
    await handIn(itemId, sids, [kid(5)]); // AL4-5 → CHASE, AL4-1..4 SUBMITTED, AL4-6 stays ABSENT_REDELIVER
    const rec = (await records(itemId)).find((r) => r.state === "SUBMITTED")!;
    await expect(checkRecord({ recordId: String(rec._id), result: "CORRECT", actorId: TEACHER_ID })).rejects.toThrow(SHEET_GUARD_MESSAGE);
    await expect(transitionRecord({ recordId: String(rec._id), toState: "CHECKED", result: "CORRECT", actorId: TEACHER_ID })).rejects.toThrow(SHEET_GUARD_MESSAGE);
    const plain = await declare({ dateGiven: "2027-03-29", qCount: 1 }); // no qids → no paper
    await issueHomeworkItem(plain.itemId, roster(sids), TEACHER_ID);
    await handIn(plain.itemId, sids);
    const r2 = (await records(plain.itemId))[0]!;
    expect((await checkRecord({ recordId: String(r2._id), result: "CORRECT", actorId: TEACHER_ID })).result).toBe("CORRECT");
  });

  it("AC-B9 + AC-B4 + AC-B12: the late joiner is off the paper; evidence only for submitted children; totals, CHECKED, thresholds; no auto-spawn", async () => {
    const detail = await paperDetail(paperId, TEACHER);
    expect(detail.roster.map((r) => r.schoolId)).toEqual(["AL4-1", "AL4-2", "AL4-3", "AL4-4", "AL4-5", "AL4-6"]); // no AL4-9, ID order
    expect(detail.roster.find((r) => r.schoolId === "AL4-5")!.defaultStatus).toBe("NOT_SUBMITTED"); // CHASE
    expect(detail.roster.find((r) => r.schoolId === "AL4-6")!.defaultStatus).toBe("ABSENT");
    const sidOf = new Map<string, string>();
    for (const r of detail.roster) sidOf.set(r.schoolId!, r.studentId);
    await saveResults(paperId, [
      { studentId: sidOf.get("AL4-1")!, items: [{ itemNo: 1, marks: 0.5 }, { itemNo: 2, marks: 0.5 }] }, // 7/10
      { studentId: sidOf.get("AL4-2")!, items: [{ itemNo: 1, marks: 0 }, { itemNo: 2, marks: 0 }, { itemNo: 3, marks: 1 }] }, // 5/10
      { studentId: sidOf.get("AL4-3")!, items: [{ itemNo: 1, marks: 0 }, { itemNo: 2, marks: 0 }, { itemNo: 3, marks: 0.5 }] }, // 4.5/10
    ], TEACHER);
    const sum = await confirmPaper(paperId, TEACHER);
    expect(sum.students).toBe(6);
    const paper = (await paperOf(itemId))!;
    const evidenceKids = new Set((await MasteryEvidence.find({ paperId: paper._id, supersededAt: null }).lean()).map((e) => String(e.studentId)));
    expect(evidenceKids.has(lateKid)).toBe(false);
    expect(evidenceKids.has(sidOf.get("AL4-5")!)).toBe(false); // CHASE
    expect(evidenceKids.has(sidOf.get("AL4-6")!)).toBe(false); // ABSENT
    expect(evidenceKids.size).toBe(4); // AL4-1..4
    const rec = async (n: string) => (await HomeworkStudentRecord.findOne({ hwItemId: new Types.ObjectId(itemId), studentId: new Types.ObjectId(sidOf.get(n)!), resubOf: null }).lean())!;
    expect(await rec("AL4-1")).toMatchObject({ state: "CHECKED", earnedMarks: 7, availableMarks: 10, result: "CORRECT" });
    expect(await rec("AL4-2")).toMatchObject({ state: "CHECKED", earnedMarks: 5, result: "PARTIAL" });
    expect(await rec("AL4-3")).toMatchObject({ state: "CHECKED", earnedMarks: 4.5, result: "WRONG" });
    expect(await rec("AL4-4")).toMatchObject({ state: "CHECKED", earnedMarks: 10, result: "CORRECT" });
    expect((await rec("AL4-5")).state).toBe("CHASE");
    expect((await rec("AL4-5")).earnedMarks).toBeUndefined();
    expect((await rec("AL4-6")).state).toBe("ABSENT_REDELIVER");
    expect(await HomeworkStudentRecord.countDocuments({ hwItemId: new Types.ObjectId(itemId), resubOf: { $ne: null } })).toBe(0); // derived WRONG spawns nothing
    expect(await HomeworkStudentRecord.countDocuments({ hwItemId: new Types.ObjectId(itemId), state: "RESUBMIT" })).toBe(0);
    expect(await HomeworkStudentRecord.exists({ studentId: new Types.ObjectId(lateKid) })).toBeNull();
  });

  it("AC-B5: a correction supersedes only that child's evidence, rewrites only that child's totals, writes one note", async () => {
    const paper = (await paperOf(itemId))!;
    const kid = (await paperDetail(paperId, TEACHER)).roster.find((r) => r.schoolId === "AL4-4")!.studentId; // was full marks
    const before = await MasteryEvidence.find({ paperId: paper._id, supersededAt: null, studentId: { $ne: new Types.ObjectId(kid) } }).lean();
    const others = await HomeworkStudentRecord.find({ hwItemId: new Types.ObjectId(itemId), studentId: { $ne: new Types.ObjectId(kid) } }).lean();
    const notes = await StaffMistakeNote.countDocuments({ kind: "MASTERY_CORRECTION" });
    await saveResults(paperId, [{ studentId: kid, items: [{ itemNo: 5, marks: 0 }] }], TEACHER);
    const after = await MasteryEvidence.find({ paperId: paper._id, supersededAt: null, studentId: { $ne: new Types.ObjectId(kid) } }).lean();
    expect(after.map((e) => String(e._id)).sort()).toEqual(before.map((e) => String(e._id)).sort()); // others untouched
    const rec = (await HomeworkStudentRecord.findOne({ hwItemId: new Types.ObjectId(itemId), studentId: new Types.ObjectId(kid) }).lean())!;
    expect(rec).toMatchObject({ earnedMarks: 8, availableMarks: 10 });
    const others2 = await HomeworkStudentRecord.find({ hwItemId: new Types.ObjectId(itemId), studentId: { $ne: new Types.ObjectId(kid) } }).lean();
    expect(others2.map((r) => [r.earnedMarks, r.result, r.state])).toEqual(others.map((r) => [r.earnedMarks, r.result, r.state]));
    expect(await StaffMistakeNote.countDocuments({ kind: "MASTERY_CORRECTION" })).toBe(notes + 1);
  });

  it("void a CONFIRMED paper: the evidence is excluded (বাতিল), the rows withdrawn, the totals cleared", async () => {
    const paper = (await paperOf(itemId))!;
    await QuestionUse.updateMany({ sourceId: paper._id }, { $set: { withdrawnAt: null } });
    expect(await QuestionUse.countDocuments({ sourceId: paper._id, withdrawnAt: null })).toBeGreaterThan(0);
    const out = await voidConfirmedPaper(paperId, PRINCIPAL);
    expect(out.excluded).toBe(5);
    expect(await MasteryExclusion.countDocuments({ paperId: paper._id, reason: "বাতিল" })).toBe(5);
    expect(await MasteryEvidence.countDocuments({ paperId: paper._id, supersededAt: null, excludedAt: null })).toBe(0);
    expect(await QuestionUse.countDocuments({ sourceId: paper._id, withdrawnAt: null })).toBe(0);
    expect(await HomeworkStudentRecord.countDocuments({ hwItemId: new Types.ObjectId(itemId), earnedMarks: { $exists: true } })).toBe(0);
    expect(await liveEvidenceCount(paper._id)).toBeGreaterThan(0); // kept, only excluded
  });
});

// ---------------------------------------------------------------------------
describe("void / undo before results (AC-B11)", () => {
  beforeAll(async () => {
    await setLoop(true);
  });

  it("deleting a declared item removes its paper; a live print request blocks it until cancelled", async () => {
    const it = await declare({ dateGiven: "2027-03-30", selectedQids: [MQ(12), MQ(13)], qCount: 2 });
    const paper = (await paperOf(it.itemId))!;
    const pr = await createPrintRequest({ title: "x", purpose: "HOMEWORK", sourceType: "MASTERY_PAPER", masteryPaperId: String(paper._id), colour: "BW", sides: "SINGLE", copies: 1, copiesMode: "CLASS_PRESENT", neededByKey: "2027-03-31", requestedBy: TEACHER_ID });
    await expect(deleteHomeworkItem(it.itemId)).rejects.toThrow(/বাতিল করুন/);
    await cancelPrintRequest(String(pr._id), TEACHER_ID, { isOffice: false });
    await deleteHomeworkItem(it.itemId);
    expect(await MasteryPaper.findById(paper._id)).toBeNull();
    expect(await HomeworkItem.findById(it.itemId)).toBeNull();
    expect(await QuestionUse.countDocuments({ sourceId: paper._id, withdrawnAt: null })).toBe(0);
  });

  it("deleting an OPEN paper with no results withdraws its rows and un-links the item", async () => {
    const it = await declare({ dateGiven: "2027-03-31", selectedQids: [MQ(14)], qCount: 1 });
    const paper = (await paperOf(it.itemId))!;
    await issueHomeworkItem(it.itemId, roster(sids), TEACHER_ID); // rows written at issue
    expect(await QuestionUse.countDocuments({ sourceId: paper._id, withdrawnAt: null })).toBe(1);
    await deletePaper(paper.paperId, TEACHER);
    expect(await QuestionUse.countDocuments({ sourceId: paper._id, withdrawnAt: null })).toBe(0);
    expect((await itemOf(it.itemId))!.paperId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("AC-S1: today's substitute", () => {
  const SUB = new Types.ObjectId().toString();
  it("the cover on a slot of that শাখা whose absent teacher is the subject teacher reaches the paper; another teacher does not", async () => {
    await setLoop(true);
    const it = await declare({ dateGiven: "2027-04-01", selectedQids: [MQ(1)], qCount: 1 });
    const paper = (await paperOf(it.itemId))!;
    await expect(paperDetail(paper.paperId, { userId: SUB, role: "TEACHER" as const })).rejects.toThrow(MasteryWorkError); // no substitution yet
    const [slot] = await RoutineSlot.create([{
      groupType: "section", groupId: new Types.ObjectId(sectionId), dayOfWeek: "SUN", periodNumber: 1, subject: "MATH", track: "general",
      teacherId: new Types.ObjectId(TEACHER_ID), effectiveFrom: new Date("2026-01-01"), active: true, createdBy: new Types.ObjectId(PRINCIPAL.userId),
    }]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await RoutineSubstitution.create({ slotId: slot!._id, date: today, coverTeacherId: new Types.ObjectId(SUB), absentTeacherId: new Types.ObjectId(TEACHER_ID), active: true, createdBy: new Types.ObjectId(PRINCIPAL.userId) });
    mockTeacher.mockResolvedValue(TEACHER_ID); // the subject teacher is the absent one
    const substitute = { userId: SUB, role: "TEACHER" as const };
    // a PAST paper (dated 2027-04-01) is out of reach even with an active cover today (item 6)
    await expect(paperDetail(paper.paperId, substitute)).rejects.toThrow(MasteryWorkError);
    await MasteryPaper.updateOne({ _id: paper._id }, { $set: { date: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) } });
    expect((await paperDetail(paper.paperId, substitute)).paper.paperId).toBe(paper.paperId); // reach: the paper of today
    await expect(paperDetail(paper.paperId, OTHER)).rejects.toThrow(MasteryWorkError); // another teacher: refused
    // an inactive substitution gives nothing; with the switch off the cover has no reach
    await RoutineSubstitution.updateMany({}, { $set: { active: false } });
    await expect(paperDetail(paper.paperId, substitute)).rejects.toThrow(MasteryWorkError);
    await RoutineSubstitution.updateMany({}, { $set: { active: true } });
    await setLoop(false);
    await expect(paperDetail(paper.paperId, substitute)).rejects.toThrow(MasteryWorkError);
    await setLoop(true);
  });
});

// ---------------------------------------------------------------------------
describe("the AL-3 gap: restoring a retired class test writes its rows again", () => {
  it("withdraw on retire, re-write on restore (the CT sheet's rows, on the exam date)", async () => {
    const exam = new Date("2027-04-10T00:00:00Z");
    const ct = await ClassTest.create({
      ctId: "CT-C3-MATH-9001", academicYearId: yearId, sectionId: new Types.ObjectId(sectionId), subject: "MATH", testNumber: 1, examDate: exam,
      totalMarks: 4, passMark: 2, source: "UPLOADED_PAPER", status: "PRINTED", requestedBy: new Types.ObjectId(TEACHER_ID), teacherId: new Types.ObjectId(TEACHER_ID),
    });
    const sheet = await createPaper({
      sectionId, subject: "MATH", source: "CT", date: "2027-04-10", classTestId: String(ct._id),
      items: [{ origin: "TEACHER", textBn: "ক", loCode: A, questionTypeCode: "QT-SHORT" }, { origin: "BANK", artifactId: gold.get(MQ(16)), loCode: A, questionTypeCode: "QT-SHORT" }],
    }, TEACHER);
    const p = (await MasteryPaper.findOne({ paperId: sheet.paperId }))!;
    expect(usesOfPaper(p, "CT").length).toBe(1);
    expect(await QuestionUse.countDocuments({ sourceId: p._id, kind: "CT", withdrawnAt: null })).toBe(1);
    await withdrawForClassTest(ct._id);
    expect(await QuestionUse.countDocuments({ sourceId: p._id, withdrawnAt: null })).toBe(0);
    await restoreForClassTest(ct._id);
    expect(await QuestionUse.countDocuments({ sourceId: p._id, kind: "CT", withdrawnAt: null })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("an AS paper writes back the child's OWN items (half marks) and guards the manual check", () => {
  it("marks / availableMarks per child, a child with no list is off the paper, the manual check is refused", async () => {
    await setLoop(true);
    const asItemId = new Types.ObjectId();
    const [x, y, z] = [kid(1), kid(2), kid(3)];
    const mk = (n: number) => ({ itemNo: n, origin: "TEACHER" as const, textBn: `প্রশ্ন ${n}`, loCodes: [A], chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: 2 });
    const paper = await MasteryPaper.create({
      paperId: "MP-C3-MATH-AS-T1", source: "AS", extra: false, sectionId: new Types.ObjectId(sectionId), classId, academicYearId: yearId, classToken: "C3",
      subject: "MATH", date: new Date("2027-04-04T00:00:00Z"), links: { asItemId }, entryState: "OPEN", trackerLinked: true,
      items: [mk(1), mk(2), mk(3), mk(4)],
      perStudentItems: [{ studentId: new Types.ObjectId(x), itemNos: [1, 2, 3] }, { studentId: new Types.ObjectId(y), itemNos: [1, 4] }],
    });
    for (const sid of [x, y, z]) {
      await AssignmentStudentRecord.create({
        asItemId, asId: "AS-C3-MATH-9001", studentId: new Types.ObjectId(sid), sectionId: new Types.ObjectId(sectionId), classId, state: "SUBMITTED",
        stateDates: [{ state: "SUBMITTED", at: new Date() }], chaseCount: 0, issuedBy: new Types.ObjectId(TEACHER_ID),
      });
    }
    const rec = (await AssignmentStudentRecord.findOne({ asItemId, studentId: new Types.ObjectId(x) }))!;
    await expect(checkAssignmentRecord({ recordId: String(rec._id), result: "CORRECT", actorId: TEACHER_ID })).rejects.toThrow(SHEET_GUARD_MESSAGE);
    await saveResults(paper.paperId, [{ studentId: x, items: [{ itemNo: 2, marks: 1.5 }] }], TEACHER);
    await confirmPaper(paper.paperId, TEACHER);
    const get = async (sid: string) => (await AssignmentStudentRecord.findOne({ asItemId, studentId: new Types.ObjectId(sid) }).lean())!;
    expect(await get(x)).toMatchObject({ marks: 5.5, availableMarks: 6, state: "CHECKED", result: "CORRECT" });
    expect(await get(y)).toMatchObject({ marks: 4, availableMarks: 4, state: "CHECKED" });
    expect(await get(z)).toMatchObject({ state: "SUBMITTED" }); // no questions of their own: off the paper
    expect((await get(z)).marks).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("review fixes", () => {
  it("2: a 2026-style hand-made paper with links.hwItemId (no flag) behaves exactly as before, switch OFF and ON", async () => {
    for (const on of [false, true]) {
      await setLoop(on);
      const day = on ? "2027-04-06" : "2027-04-05";
      const it = await declare({ dateGiven: day, qCount: 1 });
      await issueHomeworkItem(it.itemId, roster(sids), TEACHER_ID);
      await handIn(it.itemId, sids);
      const p = await createPaper({ sectionId, subject: "MATH", source: "HW", date: day, hwItemId: it.itemId, items: [{ origin: "TEACHER", textBn: "ক", loCode: A, questionTypeCode: "QT-SHORT" }] }, TEACHER);
      const paper = (await MasteryPaper.findOne({ paperId: p.paperId }))!;
      expect(paper.trackerLinked).toBeUndefined();
      expect((await itemOf(it.itemId))!.paperId).toBeUndefined();
      const rec = (await records(it.itemId))[0]!;
      const out = await checkRecord({ recordId: String(rec._id), result: "CORRECT", actorId: TEACHER_ID }); // manual check allowed
      expect(out.result).toBe("CORRECT");
      await revertHomeworkRecord({ recordId: String(rec._id), actorId: TEACHER_ID, admin: true }); // the undo allowed
      expect((await HomeworkStudentRecord.findById(rec._id))!.state).toBe("SUBMITTED");
      await saveResults(p.paperId, [{ studentId: kid(1), items: [{ itemNo: 1, marks: 0 }] }], TEACHER);
      await confirmPaper(p.paperId, TEACHER);
      await saveResults(p.paperId, [{ studentId: kid(2), items: [{ itemNo: 1, marks: 0 }] }], TEACHER); // correction: no write-back
      expect(await HomeworkStudentRecord.countDocuments({ hwItemId: new Types.ObjectId(it.itemId), earnedMarks: { $exists: true } })).toBe(0);
      expect(await QuestionUse.countDocuments({ sourceType: "MASTERY_PAPER", sourceId: paper._id, withdrawnAt: null })).toBe(0); // no bank qid on it
    }
  });

  it("1: the void is refused with the switch OFF and for a 2026 paper; a teacher's own AS marks are never cleared", async () => {
    const asItemId = new Types.ObjectId();
    const x = kid(4);
    const paper = await MasteryPaper.create({
      paperId: "MP-C3-MATH-AS-OLD", source: "AS", extra: false, sectionId: new Types.ObjectId(sectionId), classId, academicYearId: yearId, classToken: "C3",
      subject: "MATH", date: new Date("2027-04-07T00:00:00Z"), links: { asItemId }, entryState: "CONFIRMED",
      items: [{ itemNo: 1, origin: "TEACHER", textBn: "ক", loCodes: [A], chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: 2 }],
      perStudentItems: [{ studentId: new Types.ObjectId(x), itemNos: [1] }],
    });
    await AssignmentStudentRecord.create({
      asItemId, asId: "AS-C3-MATH-9100", studentId: new Types.ObjectId(x), sectionId: new Types.ObjectId(sectionId), classId, state: "CHECKED",
      stateDates: [{ state: "CHECKED", at: new Date() }], chaseCount: 0, issuedBy: new Types.ObjectId(TEACHER_ID), marks: 7, result: "CORRECT",
    });
    for (const on of [false, true]) {
      await setLoop(on);
      await expect(voidConfirmedPaper(paper.paperId, PRINCIPAL)).rejects.toThrow(MasteryWorkError);
      expect((await AssignmentStudentRecord.findOne({ asItemId }).lean())!.marks).toBe(7);
    }
    // a RETEST paper is refused too
    await MasteryPaper.updateOne({ _id: paper._id }, { $set: { source: "RETEST", trackerLinked: true } });
    await expect(voidConfirmedPaper(paper.paperId, PRINCIPAL)).rejects.toThrow(MasteryWorkError);
    // an AL-4 paper: a record whose marks were typed by hand (no provenance) keeps them
    await MasteryPaper.updateOne({ _id: paper._id }, { $set: { source: "AS" } });
    await voidConfirmedPaper(paper.paperId, PRINCIPAL);
    expect((await AssignmentStudentRecord.findOne({ asItemId }).lean())!.marks).toBe(7);
  });

  it("3: the Office opens the sheet from its print request by the Mongo id; another office-less user cannot", async () => {
    await setLoop(true);
    const it = await declare({ dateGiven: "2027-04-07", selectedQids: [MQ(2)], qCount: 1 });
    const paper = (await paperOf(it.itemId))!;
    expect(paper.trackerLinked).toBe(true);
    const pr = await createPrintRequest({ title: "x", purpose: "HOMEWORK", sourceType: "MASTERY_PAPER", masteryPaperId: String(paper._id), colour: "BW", sides: "SINGLE", copies: 1, copiesMode: "CLASS_PRESENT", neededByKey: "2027-04-08", requestedBy: TEACHER_ID });
    const office = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const };
    expect(callerHasPermission(office as never, "printing:view_all")).toBe(true);
    mockTeacher.mockResolvedValue(TEACHER_ID); // the office is not the subject teacher
    const out = await renderHomeworkPaperPdf(String(pr.masteryPaperId), office as never);
    expect(out.pdf.subarray(0, 4).toString()).toBe("%PDF");
    await cancelPrintRequest(String(pr._id), TEACHER_ID, { isOffice: false });
    await expect(renderHomeworkPaperPdf(String(paper._id), office as never)).rejects.toThrow(MasteryWorkError); // cancelled → withdrawn
  });

  it("4: trim and a direct time / count edit of a paper-linked declared item are refused (switch ON)", async () => {
    await setLoop(true);
    const it = await declare({ dateGiven: "2027-04-08", selectedQids: [MQ(3), MQ(4)], qCount: 2 });
    await expect(
      applyTrim({ classId: String(classId), sectionId, date: new Date("2027-04-08T00:00:00Z"), itemId: it.itemId, newQCount: 1, rank: "b", actorId: TEACHER_ID } as never),
    ).rejects.toThrow(/প্রশ্ন বদলে কমান/);
    await expect(updateHomeworkItem({ itemId: it.itemId, timeDecl: 5, actorId: TEACHER_ID })).rejects.toThrow(/প্রশ্ন বদলে কমান/);
    await updateHomeworkItem({ itemId: it.itemId, qCount: 2, actorId: TEACHER_ID }); // unchanged value: fine
  });

  it("8: issue writes the item's own row for a selectedQid that is not on its paper", async () => {
    await setLoop(true);
    const it = await declare({ dateGiven: "2027-04-11", selectedQids: [MQ(5)], qCount: 1 });
    await HomeworkItem.updateOne({ _id: it.itemId }, { $set: { selectedQids: [MQ(5), MQ(6)] } });
    await issueHomeworkItem(it.itemId, roster(sids), TEACHER_ID);
    const paper = (await paperOf(it.itemId))!;
    expect(await QuestionUse.countDocuments({ sourceId: paper._id, qid: MQ(5), withdrawnAt: null })).toBe(1);
    expect(await QuestionUse.countDocuments({ sourceType: "HOMEWORK_ITEM", sourceId: new Types.ObjectId(it.itemId), qid: MQ(6) })).toBe(1);
    expect(await QuestionUse.countDocuments({ sourceType: "HOMEWORK_ITEM", sourceId: new Types.ObjectId(it.itemId), qid: MQ(5) })).toBe(0);
  });
});
