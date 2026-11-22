/**
 * AL-5 — the server side of the 2027 homework screens (docs/prd-academic-loop-2027.md §5 B).
 *
 *   ids       item → tally → paper CODE → masteryPaper load (the Mongo id is not the code); the day item carries
 *             paperId / paperCode / freeLines; the guardian record, the student profile and the open record carry
 *             earned / available marks after a confirm
 *   print     a second live request for the same paper is refused in Bangla
 *   edit      removing a 2-mark question from a saved sheet saves, without the app sending timeDecl / qCount
 *   picks     a hand pick obeys the draft's exclusions (window, share R21) and may repeat an older question (R23);
 *             the candidate read ranks unused first, repeats last, and leaves the blocked out
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
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { importCatalogue, savePolicy, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, paperDetail } from "../modules/mastery/services/MasteryWorkService";
import { declareHomeworkItem, issueHomeworkItem, listOpenRecords, transitionRecord, updateHomeworkItem } from "../modules/trackers/services/HomeworkService";
import { tallyDay } from "../modules/trackers/services/HomeworkReconciliationService";
import { homeworkItemTallies } from "../modules/trackers/services/HomeworkSummaryService";
import { studentHomeworkPanel } from "../modules/trackers/services/StudentProfileService";
import { childHomework } from "../modules/guardian/services/GuardianPortalService";
import { createPrintRequest, cancelPrintRequest } from "../modules/printing/services/PrintRequestService";
import { recordUses } from "../modules/assessment/services/QuestionUseService";
import { homeworkCandidatesFor } from "../modules/mastery/services/HomeworkPickRules";

jest.setTimeout(240_000);

let mongo: MongoMemoryServer;
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
let yearId = new Types.ObjectId();
let classId = new Types.ObjectId();
let sectionId = "";
const sids: string[] = [];

const A = "LO-C3-MATH-07-01";
const MQ = (n: number) => `QP-MATH-C3-U07-Q96${String(n).padStart(3, "0")}`;
const CATALOGUE = JSON.stringify({
  classToken: "C3", subject: "MATH", status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [{ code: A, labelBn: "ভাগের ধারণা", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] }],
  questionTypes: [{ code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 2 }],
});

const declare = (over: Record<string, unknown> = {}) =>
  declareHomeworkItem({
    academicYearId: String(yearId), classId: String(classId), classLevel: 3, sectionId, subject: "MATH",
    dateGiven: "2027-05-02", topTags: ["TOP-MATH-C3-GEN"], qCount: 1, description: "বাড়ির কাজ", actorId: TEACHER_ID,
    ...over,
  } as never);
const roster = (ids: string[]) => ids.map((studentId) => ({ studentId, present: true }));
const itemOf = (id: string) => HomeworkItem.findById(id);
const use = (qid: string, givenOn: string) =>
  recordUses([{ qid, kind: "HW", sourceType: "MASTERY_PAPER", sourceId: new Types.ObjectId(), academicYearId: yearId, sectionId, classToken: "C3", subject: "MATH", givenOn }]);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = year._id;
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  classId = cls._id;
  const [b] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(b._id);
  for (const n of [1, 2, 3]) {
    const [s] = await Student.create([{ schoolId: `AL5-${n}`, name: `Student ${n}`, classId: cls._id, sectionId: b._id, active: true }]);
    sids.push(String(s._id));
  }
  const r = await importCatalogue(CATALOGUE, true, PRINCIPAL);
  if (!r.ok) throw new Error(r.errors.join("; "));
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  const base = { docType: "question", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 7 }, curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold" };
  for (let n = 1; n <= 16; n++) {
    await ContentArtifact.create([{ ...base, subject: "MATH", envelopeJson: { tags: { topic_tag: A }, payload: { qid: MQ(n), topic_tag: A, marks: 2, question_text: `${MQ(n)} লেখা` } } }]);
  }
  await savePolicy(null, null, { academicLoop2027On: true }, PRINCIPAL);
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

describe("ids: the paper CODE is what the mastery calls take", () => {
  it("item → tally → paperCode → masteryPaper loads; confirmed marks reach the guardian, the profile and the open record", async () => {
    const it = await declare({ dateGiven: "2027-05-02", selectedQids: [MQ(1), MQ(2)], qCount: 2 });
    const item = (await itemOf(it.itemId))!;
    const paper = (await MasteryPaper.findById(item.paperId))!;
    expect(String(item.paperId)).not.toBe(paper.paperId); // the Mongo id is not the code

    const day = await tallyDay(String(classId), new Date("2027-05-02T00:00:00Z"), sectionId);
    const dayItem = day.items.find((i) => i.itemId === it.itemId)!;
    expect(dayItem.paperId).toBe(String(paper._id));
    expect(dayItem.paperCode).toBe(paper.paperId);
    expect(dayItem.freeLines).toEqual([]);

    await issueHomeworkItem(it.itemId, roster(sids), TEACHER_ID);
    const tally = (await homeworkItemTallies(sectionId)).find((t) => t.hwItemId === it.itemId)!;
    expect(tally.paperId).toBe(String(paper._id));
    expect(tally.paperCode).toBe(paper.paperId);
    // The code the tally gives is the one the mastery read takes — no mocked id.
    const detail = await paperDetail(tally.paperCode!, TEACHER);
    expect(detail.paper.paperId).toBe(paper.paperId);
    expect(detail.roster).toHaveLength(3);
    await expect(paperDetail(tally.paperId!, TEACHER)).rejects.toThrow(/পাওয়া যায়নি/); // the Mongo id does not load it

    // hand in everyone, confirm by the code, read the marks back everywhere
    for (const r of await HomeworkStudentRecord.find({ hwItemId: new Types.ObjectId(it.itemId), resubOf: null }).lean()) {
      await transitionRecord({ recordId: String(r._id), toState: "DUE", actorId: TEACHER_ID });
      await transitionRecord({ recordId: String(r._id), toState: "SUBMITTED", actorId: TEACHER_ID });
    }
    await confirmPaper(tally.paperCode!, TEACHER);
    const kid = sids[0]!;
    const g = (await childHomework(kid, new Date("2020-01-01T00:00:00Z"), new Date("2099-01-01T00:00:00Z"))).find((r) => r.hwId === item.hwId)!;
    expect(g.earnedMarks).toBe(4);
    expect(g.availableMarks).toBe(4);
    const panel = await studentHomeworkPanel(kid, { fromKey: "2027-05-01", toKey: "2027-05-03" } as never);
    const row = panel.items.find((i) => i.refId === item.hwId)!;
    expect(row.earnedMarks).toBe(4);
    expect(row.availableMarks).toBe(4);
    const open = (await listOpenRecords(sectionId, ["CHECKED"])).find((r) => r.hwItemId === it.itemId && r.studentId === kid)!;
    expect(open.earnedMarks).toBe(4);
    expect(open.availableMarks).toBe(4);
  });

  it("a free-lines-only item has no paper but the tally knows its lines (the grid opens by hwItemId)", async () => {
    const it = await declare({ dateGiven: "2027-05-03", freeLines: [{ kind: "HANDWRITING", textBn: "হাতের লেখা ১ পৃষ্ঠা", estMinutes: 10 }], qCount: 1 });
    await issueHomeworkItem(it.itemId, roster(sids), TEACHER_ID);
    const t = (await homeworkItemTallies(sectionId)).find((x) => x.hwItemId === it.itemId)!;
    expect(t.paperId ?? null).toBeNull();
    expect(t.paperCode ?? null).toBeNull();
    expect(t.freeLineCount).toBe(1);
    const day = await tallyDay(String(classId), new Date("2027-05-03T00:00:00Z"), sectionId);
    expect(day.items.find((i) => i.itemId === it.itemId)!.freeLines).toEqual([{ kind: "HANDWRITING", textBn: "হাতের লেখা ১ পৃষ্ঠা", estMinutes: 10 }]);
  });
});

describe("edit and print", () => {
  it("removing a 2-mark question from a saved sheet saves without timeDecl / qCount; paper and time follow", async () => {
    const it = await declare({ dateGiven: "2027-05-09", selectedQids: [MQ(3), MQ(4), MQ(5)], qCount: 3 });
    expect((await itemOf(it.itemId))!.timeDecl).toBe(11); // 6 marks x 1.8
    await updateHomeworkItem({ itemId: it.itemId, selectedQids: [MQ(3), MQ(4)], actorId: TEACHER_ID }); // the app sends no timeDecl / qCount
    const after = (await itemOf(it.itemId))!;
    expect((await MasteryPaper.findById(after.paperId))!.items.map((i) => i.qid)).toEqual([MQ(3), MQ(4)]);
    expect(after.timeDecl).toBe(7); // 4 marks x 1.8
    expect(after.qCount).toBe(2);
  });

  it("a second live print request for the same paper is refused in Bangla; after a cancel it goes through", async () => {
    const it = await declare({ dateGiven: "2027-05-16", selectedQids: [MQ(6), MQ(7)], qCount: 2 });
    const paperId = String((await itemOf(it.itemId))!.paperId);
    const file = () =>
      createPrintRequest({ title: "বাড়ির কাজ", purpose: "HOMEWORK", sourceType: "MASTERY_PAPER", masteryPaperId: paperId, colour: "BW", sides: "SINGLE", copies: 1, copiesMode: "CLASS_PRESENT", neededByKey: "2027-05-17", requestedBy: TEACHER_ID });
    const first = await file();
    await expect(file()).rejects.toThrow(/আগেই পাঠানো হয়েছে/);
    await cancelPrintRequest(String(first._id), TEACHER_ID, { isOffice: false });
    await expect(file()).resolves.toBeTruthy();
  });
});

describe("picks obey the draft's exclusions (§4.3, §4.7, R21, R23)", () => {
  const DAY = "2027-06-08";

  it("a question the section had inside the window is refused, naming it", async () => {
    await use(MQ(8), "2027-06-06");
    await expect(declare({ dateGiven: DAY, selectedQids: [MQ(8)], qCount: 1 })).rejects.toThrow(new RegExp(`${MQ(8)}.*সপ্তাহের মধ্যে`));
  });

  it("an older use is a repeat (R23): allowed, ranked after the unused ones in the candidate list; blocked ones are left out", async () => {
    await use(MQ(9), "2027-01-05");
    const c = await homeworkCandidatesFor(sectionId, "MATH", DAY, [A], TEACHER);
    expect(c.map((x) => x.qid)).not.toContain(MQ(8)); // inside the window
    expect(c.find((x) => x.qid === MQ(9))!.repeat).toBe(true);
    expect(c.findIndex((x) => x.qid === MQ(9))).toBeGreaterThan(c.findIndex((x) => !x.repeat)); // repeats last
    expect(c.slice(c.findIndex((x) => x.repeat)).every((x) => x.repeat)).toBe(true);
    const ok = await declare({ dateGiven: DAY, selectedQids: [MQ(9)], qCount: 1 });
    expect((await MasteryPaper.findById((await itemOf(ok.itemId))!.paperId))!.items.map((i) => i.qid)).toEqual([MQ(9)]);
  });

  it("the homework share (R21) of an objective: once used up, an unused question is refused and no longer offered", async () => {
    // 16 gold questions x 50% = 8. MQ1, MQ2 (issued), MQ8, MQ9 are already homework this year; four more make eight.
    for (const n of [10, 11, 12, 13]) await use(MQ(n), "2027-01-10");
    await expect(declare({ dateGiven: "2027-06-09", selectedQids: [MQ(14)], qCount: 1 })).rejects.toThrow(/নির্ধারিত ভাগ/);
    const c = await homeworkCandidatesFor(sectionId, "MATH", "2027-06-09", [A], TEACHER);
    expect(c.some((x) => !x.repeat)).toBe(false); // only older repeats are left
    expect(c.map((x) => x.qid)).toContain(MQ(10));
  });
});
