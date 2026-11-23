/**
 * AL-8 — the Office / Principal view of the weekly assignments, the comment, the week readers' read-only reach, the
 * `mayEdit` / `mayFinalise` flags (incl. the Office on a teacher's leave day) and the bank candidates for an add
 * (docs/prd-academic-loop-2027.md §4.3, §4.6, C6; D-#1668). `assignment:comment` notifies the subject teacher (AS_COMMENT);
 * the list is paged; with the release switch OFF nothing reads or writes (AC-R1).
 * In-memory MongoDB, real services; the routine lookup, the staff-profile match and the switch are stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({ resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a) }));
const mockProfile = jest.fn<Promise<{ _id: Types.ObjectId } | null>, unknown[]>();
jest.mock("../modules/hr/services/staffMatch", () => ({ resolveStaffProfileForUser: (...a: unknown[]) => mockProfile(...a) }));
let loopOn = true;
jest.mock("../modules/assessment/services/QuestionUseService", () => ({
  ...jest.requireActual("../modules/assessment/services/QuestionUseService"),
  isLoop2027On: async () => loopOn,
}));

import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { QuestionUse } from "../modules/assessment/models/QuestionUse";
import { AssignmentSchedule } from "../modules/trackers/models/AssignmentSchedule";
import { StaffLeaveApplication } from "../modules/hr/models/StaffLeaveApplication";
import { MasteryAssignment } from "../modules/mastery/models/MasteryAssignment";
import { AssignmentComment } from "../modules/mastery/models/AssignmentComment";
import { Notification } from "../modules/notifications/models/Notification";
import { importCatalogue, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { addAssignmentComment, assignmentComments, assignmentForReview, assignmentOfficeWeeksPage } from "../modules/mastery/services/AssignmentCommentService";
import { addCandidates, approveAllSheets, sheetDetail } from "../modules/mastery/services/MasteryAssignmentService";
import { MasteryAssignmentSheet } from "../modules/mastery/models/MasteryAssignmentSheet";
import { Student } from "../modules/foundation/models/Student";
import { isoWeekKey } from "../modules/mastery/evidence";
import { dayOf } from "../modules/mastery/services/MasteryWorkService";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const TEACHER_ID = new Types.ObjectId().toString();
const ROT_ID = new Types.ObjectId().toString();
const CT_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
const ROT = { userId: ROT_ID, role: "TEACHER" as const }; // the rotation cell's teacher
const CT = { userId: CT_ID, role: "TEACHER" as const }; // the শাখা's class teacher
const OTHER = { userId: new Types.ObjectId().toString(), role: "TEACHER" as const }; // a teacher of another শাখা
const OFFICE = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const };
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
const DUE = "2027-01-17"; // the Sunday after Thursday 14 Jan (rotation week 2)
const A = "LO-C3-MATH-07-01";
const MQ = (n: number) => `QP-MATH-C3-U07-Q96${String(n).padStart(3, "0")}`;
const CATALOGUE = JSON.stringify({
  classToken: "C3", subject: "MATH", status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [{ code: A, labelBn: "ভাগের ধারণা", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] }],
  questionTypes: [{ code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 2 }],
});
let assignmentId = "";
let sectionId = new Types.ObjectId();
let yearId = new Types.ObjectId();
const FAKE: { doNotFake: ("nextTick" | "setImmediate" | "setTimeout" | "setInterval" | "clearTimeout" | "clearInterval" | "clearImmediate" | "queueMicrotask" | "performance" | "hrtime")[] } = { doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "clearImmediate", "queueMicrotask", "performance", "hrtime"] };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = year._id;
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক", classTeacherId: new Types.ObjectId(CT_ID) }]);
  sectionId = sec._id;
  await AssignmentSchedule.create({
    academicYearId: year._id, termStartDate: new Date(2027, 0, 3), deliveryDayOfWeek: 4, dueDayOfWeek: 0,
    entries: [{ cycleWeek: 2, classId: cls._id, classLevel: 3, sectionId: sec._id, subject: "MATH", teacherId: new Types.ObjectId(ROT_ID) }],
  });
  const layout = { totalMarks: 15, minutes: 30, partAOn: true, partAMarks: 5, partALoCodes: [], partBMarks: 10, mixWeak: 50, mixImproving: 30, mixRevision: 20, questionTypeCodes: [] };
  const base = { sectionId: sec._id, classId: cls._id, academicYearId: year._id, classToken: "C3", dueDate: dayOf(DUE), week: isoWeekKey(dayOf(DUE)), layout, status: "DRAFT", builtAt: new Date(), builtBy: new Types.ObjectId() };
  const engine = { builtBy: "ENGINE", at: new Date(), inputs: { chapters: [7], weakCounts: [], excluded: { hw: 0, window: 0, seen: 0 }, noLessonMarks: false }, reasons: [] };
  const a = await MasteryAssignment.create({ ...base, subject: "MATH", suggestion: engine, partA: [{ origin: "BANK", qid: MQ(1), loCode: A, chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: 2, band: "SECTION" }] });
  assignmentId = String(a._id);
  // Three more subjects of the same week, for the paging test.
  for (const subject of ["BAN", "ENG", "SCI"]) await MasteryAssignment.create({ ...base, subject, partA: [] });
  const [st] = await Student.create([{ schoolId: "AL8-1", name: "Student 1", rollNumber: "1", classId: cls._id, sectionId: sec._id, active: true }]);
  await MasteryAssignmentSheet.create({ assignmentId: a._id, studentId: st._id, status: "DRAFT", items: [], warnings: [] });
  // The bank: five gold questions on one objective.
  const r = await importCatalogue(CATALOGUE, true, PRINCIPAL);
  if (!r.ok) throw new Error(r.errors.join("; "));
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  const abase = { docType: "question", classLevel: 3, subject: "MATH", address: { anchorWord: "অধ্যায়", number: 7 }, curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold" };
  for (let k = 1; k <= 5; k++) {
    await ContentArtifact.create([{ ...abase, envelopeJson: { tags: { topic_tag: A, difficulty: "medium" }, payload: { qid: MQ(k), topic_tag: A, marks: 2, question_text: `${MQ(k)} লেখা${k === 5 ? " বিশেষ" : ""}` } } }]);
  }
  const mk = (qid: string, kind: "HW" | "AS", day: string) => QuestionUse.create({ qid, kind, sourceType: "MASTERY_PAPER", sourceId: new Types.ObjectId(), academicYearId: year._id, sectionId: sec._id, classToken: "C3", subject: "MATH", studentIds: [], givenOn: day, useKey: `t|${qid}|${kind}` });
  await mk(MQ(2), "HW", "2026-02-01"); // a homework question of the year
  await mk(MQ(3), "AS", new Date().toISOString().slice(0, 10)); // inside the no-repeat window
});

afterAll(async () => {
  jest.useRealTimers();
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  loopOn = true;
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
  mockProfile.mockReset();
});

describe("AC-R1: with the release switch OFF nothing new runs", () => {
  it("the list is empty, the thread is empty, a comment, a review read and the candidates are refused", async () => {
    loopOn = false;
    expect((await assignmentOfficeWeeksPage(DUE, {})).rows).toEqual([]);
    expect(await assignmentComments(assignmentId, OFFICE)).toEqual([]);
    await expect(addAssignmentComment(assignmentId, "ভালো", OFFICE)).rejects.toThrow();
    await expect(assignmentForReview(assignmentId, OFFICE)).rejects.toThrow();
    await expect(addCandidates(assignmentId, null, null, TEACHER)).rejects.toThrow();
    expect(await AssignmentComment.countDocuments()).toBe(0);
    expect(await Notification.countDocuments({ kind: "AS_COMMENT" })).toBe(0);
  });
});

describe("C6: the Office / Principal view and comment", () => {
  it("lists every শাখা's drafts for the week with the section label and the engine audit", async () => {
    const page = await assignmentOfficeWeeksPage(DUE, { page: 1, pageSize: 10 });
    expect(page.total).toBe(4);
    const math = page.rows.find((r) => r.assignmentId === assignmentId);
    expect(math).toMatchObject({ subject: "MATH", status: "DRAFT", builtBy: "ENGINE", edited: false, commentCount: 0 });
    expect(math?.sectionLabelBn).toContain("বালক");
    expect((await assignmentOfficeWeeksPage("2027-03-04", {})).rows).toEqual([]); // another week
  });

  it("pages: page 2 of a page size of 3 holds the remaining row, the total stays", async () => {
    const p1 = await assignmentOfficeWeeksPage(DUE, { page: 1, pageSize: 3 });
    const p2 = await assignmentOfficeWeeksPage(DUE, { page: 2, pageSize: 3 });
    expect([p1.rows.length, p2.rows.length, p1.total, p2.total, p2.page]).toEqual([3, 1, 4, 4, 2]);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.assignmentId)).size).toBe(4);
  });

  it("an empty or over-long comment is refused", async () => {
    await expect(addAssignmentComment(assignmentId, "   ", OFFICE)).rejects.toThrow();
    await expect(addAssignmentComment(assignmentId, "ক".repeat(1001), OFFICE)).rejects.toThrow();
  });

  it("a comment is stored, notifies the subject teacher (AS_COMMENT) once, and shows in the list", async () => {
    const c = await addAssignmentComment(assignmentId, "অংশ খ-এ আরও সহজ প্রশ্ন রাখুন।", OFFICE);
    expect(c.textBn).toContain("সহজ");
    const notes = await Notification.find({ kind: "AS_COMMENT" }).lean();
    expect(notes.map((n) => String(n.recipientUserId))).toEqual([TEACHER_ID]);
    expect(String(notes[0].refs?.masteryAssignmentId)).toBe(assignmentId);
    expect(String(notes[0].refs?.sectionId)).toBe(String(sectionId));
    expect((await assignmentOfficeWeeksPage(DUE, {})).rows.find((r) => r.assignmentId === assignmentId)?.commentCount).toBe(1);
    await addAssignmentComment(assignmentId, "ধন্যবাদ।", OFFICE); // its own notice (the key carries the comment + the recipient)
    expect(await Notification.countDocuments({ kind: "AS_COMMENT" })).toBe(2);
  });
});

describe("§4.4 reach: everyone the week screen admits reads; nobody else does", () => {
  it("the subject teacher, the rotation cell's teacher, the class teacher and the Office read the draft and the thread", async () => {
    for (const who of [TEACHER, ROT, CT, OFFICE, PRINCIPAL]) {
      expect((await assignmentForReview(assignmentId, who)).id).toBe(assignmentId);
      expect((await assignmentComments(assignmentId, who)).length).toBe(2);
    }
  });

  it("a teacher of another শাখা is refused on both", async () => {
    await expect(assignmentForReview(assignmentId, OTHER)).rejects.toThrow();
    await expect(assignmentComments(assignmentId, OTHER)).rejects.toThrow();
  });

  it("a reader who may not change the draft gets mayEdit / mayFinalise = false; the subject teacher gets true", async () => {
    expect(await assignmentForReview(assignmentId, CT)).toMatchObject({ mayEdit: false, mayFinalise: false });
    expect(await assignmentForReview(assignmentId, ROT)).toMatchObject({ mayEdit: false, mayFinalise: false });
    expect(await assignmentForReview(assignmentId, OFFICE)).toMatchObject({ mayEdit: false, mayFinalise: false });
    expect(await assignmentForReview(assignmentId, TEACHER)).toMatchObject({ mayEdit: true, mayFinalise: true });
  });

  it("a child's sheet: the week's readers read it read-only; another শাখা's teacher is refused; the subject teacher edits", async () => {
    const sid = String((await Student.findOne({ schoolId: "AL8-1" }))?._id);
    expect(await sheetDetail(assignmentId, sid, CT)).toMatchObject({ mayEdit: false });
    expect(await sheetDetail(assignmentId, sid, OFFICE)).toMatchObject({ mayEdit: false });
    expect(await sheetDetail(assignmentId, sid, ROT)).toMatchObject({ mayEdit: false });
    expect(await sheetDetail(assignmentId, sid, TEACHER)).toMatchObject({ mayEdit: true });
    await expect(sheetDetail(assignmentId, sid, OTHER)).rejects.toThrow();
  });
});

describe("R28: the Office on a teacher's approved-leave Wednesday / Thursday", () => {
  it("mayEdit / mayFinalise are false on a normal day and on a leave day that is not Wed/Thu, true on a leave Wednesday; approve-all follows", async () => {
    const profileId = new Types.ObjectId();
    mockProfile.mockResolvedValue({ _id: profileId });
    await StaffLeaveApplication.collection.insertOne({ staffProfileId: profileId, status: "approved", fromKey: "2027-01-12", toKey: "2027-01-13", leaveType: "casual", dayPart: "full", days: 2, reason: "x", appliedBy: new Types.ObjectId() });
    try {
      jest.useFakeTimers({ now: new Date("2027-01-12T06:00:00.000Z"), ...FAKE }); // Tuesday — on leave, but not a finalise day
      expect(await assignmentForReview(assignmentId, OFFICE)).toMatchObject({ mayEdit: false, mayFinalise: false });
      await expect(approveAllSheets(assignmentId, OFFICE)).rejects.toThrow();
      jest.setSystemTime(new Date("2027-01-13T06:00:00.000Z")); // Wednesday — the teacher is on leave
      expect(await assignmentForReview(assignmentId, OFFICE)).toMatchObject({ mayEdit: true, mayFinalise: true });
      expect((await approveAllSheets(assignmentId, OFFICE)).id).toBe(assignmentId);
      jest.setSystemTime(new Date("2027-01-14T06:00:00.000Z")); // Thursday — the leave has ended
      expect(await assignmentForReview(assignmentId, OFFICE)).toMatchObject({ mayEdit: false, mayFinalise: false });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("§4.3: the bank candidates for an add", () => {
  it("leaves out a question already on the draft, a homework question of the year and an in-window use; the filter narrows", async () => {
    const all = (await addCandidates(assignmentId, null, null, TEACHER)).map((c) => c.qid);
    expect(all).toEqual([MQ(4), MQ(5)]);
    const hit = await addCandidates(assignmentId, null, "বিশেষ", TEACHER);
    expect(hit.map((c) => c.qid)).toEqual([MQ(5)]);
    expect(hit[0]).toMatchObject({ loCode: A, questionTypeCode: "QT-SHORT", marks: 2, repeat: false });
    expect(await addCandidates(assignmentId, null, "no-such-text", TEACHER)).toEqual([]);
  });

  it("the same reach as the edit mutations: a read-only reader is refused", async () => {
    await expect(addCandidates(assignmentId, null, null, CT)).rejects.toThrow();
    await expect(addCandidates(assignmentId, null, null, OTHER)).rejects.toThrow();
  });
});
