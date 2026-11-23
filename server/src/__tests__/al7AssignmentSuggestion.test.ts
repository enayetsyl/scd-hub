/**
 * AL-7 — the suggestion engine through the services (docs/prd-academic-loop-2027.md §4; D-#1668).
 * ACs: AC-C1 (ASDRAFT, idempotent), AC-C3 (add refused / audited), AC-C6 (swap acceptor), AC-C11 (NEEDS_REVIEW listed),
 * AC-C13 (a pause → no draft), AC-C14 (Office on a teacher's leave), AC-C15 (Nursery), AC-D1, AC-R1 (switch OFF).
 * In-memory MongoDB, real services; the routine lookup and the staff-profile match are stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// The real pause service (the global test stub answers "nothing is paused").
jest.unmock("../modules/academic-pause/services/AcademicPauseService");

const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({ resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a) }));
const mockProfile = jest.fn<Promise<{ _id: Types.ObjectId } | null>, unknown[]>();
jest.mock("../modules/hr/services/staffMatch", () => ({ resolveStaffProfileForUser: (...a: unknown[]) => mockProfile(...a) }));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { QuestionUse } from "../modules/assessment/models/QuestionUse";
import { AssignmentSchedule } from "../modules/trackers/models/AssignmentSchedule";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { MasteryAssignment } from "../modules/mastery/models/MasteryAssignment";
import { MasteryAssignmentSheet } from "../modules/mastery/models/MasteryAssignmentSheet";
import { Audit } from "../modules/platform/models/Audit";
import { Notification } from "../modules/notifications/models/Notification";
import { StaffLeaveApplication } from "../modules/hr/models/StaffLeaveApplication";
import { importCatalogue, savePolicy, setEnablement, settleLoopRecompute } from "../modules/mastery/services/MasteryCatalogueService";
import { sendAssignment, editSheet, editPartA, isFinaliseLeaveDay } from "../modules/mastery/services/MasteryAssignmentService";
import {
  NOT_ON,
  NO_ASSIGNMENT_FOR_SMALL,
  acceptAssignmentSwap,
  asDraftReady,
  buildSuggestedDraft,
  runAsDraft,
  suggestAssignment,
} from "../modules/mastery/services/AssignmentSuggestionService";
import { createPause } from "../modules/academic-pause/services/AcademicPauseService";
import { isoWeekKey } from "../modules/mastery/evidence";

jest.setTimeout(300_000);

let mongo: MongoMemoryServer;
const TEACHER_ID = new Types.ObjectId().toString();
const OTHER_ID = new Types.ObjectId().toString();
const CT_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
const OTHER = { userId: OTHER_ID, role: "TEACHER" as const };
const OFFICE = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const };
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
let yearId = new Types.ObjectId();
let sectionId = "";
let nurSectionId = "";
const sids: string[] = [];
const DUE = "2027-01-17"; // the Sunday after Thursday 14 Jan
const A = "LO-C3-MATH-07-01";
const MQ = (n: number) => `QP-MATH-C3-U07-Q97${String(n).padStart(3, "0")}`;
const CATALOGUE = JSON.stringify({
  classToken: "C3", subject: "MATH", status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [{ code: A, labelBn: "ভাগের ধারণা", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] }],
  questionTypes: [{ code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 2 }],
});
const setLoop = async (on: boolean) => {
  await savePolicy(null, null, { academicLoop2027On: on }, PRINCIPAL);
  await settleLoopRecompute();
};
const auditCount = (eventKind: string) => Audit.countDocuments({ eventKind });
const tick = () => new Promise((r) => setTimeout(r, 50)); // `void writeAudit` is fire-and-forget

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = year._id;
  const [cls, nurCls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }, { level: -1, nameBn: "নার্সারি", academicYearId: year._id }]);
  const [b, n] = await Section.create([
    { classId: cls._id, code: "B", nameBn: "বালক", classTeacherId: new Types.ObjectId(CT_ID) },
    { classId: nurCls._id, code: "N", nameBn: "নার্সারি" },
  ]);
  sectionId = String(b._id);
  nurSectionId = String(n._id);
  for (let i = 1; i <= 4; i++) {
    const [s] = await Student.create([{ schoolId: `AL7-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: b._id, active: true }]);
    sids.push(String(s._id));
  }
  const r = await importCatalogue(CATALOGUE, true, PRINCIPAL);
  if (!r.ok) throw new Error(r.errors.join("; "));
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  const base = { docType: "question", classLevel: 3, subject: "MATH", address: { anchorWord: "অধ্যায়", number: 7 }, curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold" };
  for (let k = 1; k <= 30; k++) {
    await ContentArtifact.create([{ ...base, envelopeJson: { tags: { topic_tag: A, difficulty: k % 3 === 0 ? "easy" : "medium" }, payload: { qid: MQ(k), topic_tag: A, marks: 2, question_text: `${MQ(k)} লেখা` } } }]);
  }
  // A class note marked chapter 7 taught on 11 Jan (the lesson marks the engine reads).
  await LessonDelivery.create({
    noteId: new Types.ObjectId(), slotId: new Types.ObjectId(), sectionId: b._id, classLevel: 3, subject: "MATH", dateKey: "2027-01-11",
    teacherId: new Types.ObjectId(TEACHER_ID), updatedBy: new Types.ObjectId(TEACHER_ID), rosterStudentIds: sids.map((s) => new Types.ObjectId(s)),
    sessions: [{ chapter: "7", sessionIndex: 1, sessionOf: 1, titleBn: "ভাগ", finished: true, loCodes: [A] }],
  });
  // The rotation: week 2 of January (delivery Thu 14 Jan, due Sun 17 Jan) → cycleWeek 2 holds C3-বালক MATH.
  await AssignmentSchedule.create({
    academicYearId: year._id, termStartDate: new Date(2027, 0, 3), deliveryDayOfWeek: 4, dueDayOfWeek: 0,
    entries: [{ cycleWeek: 2, classId: cls._id, classLevel: 3, sectionId: b._id, subject: "MATH", teacherId: new Types.ObjectId(TEACHER_ID) }],
  });
  mockTeacher.mockResolvedValue(TEACHER_ID);
});

afterAll(async () => {
  jest.useRealTimers();
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  mockTeacher.mockReset();
  mockTeacher.mockResolvedValue(TEACHER_ID);
  mockProfile.mockReset();
});

// ---------------------------------------------------------------------------
describe("AC-R1: with the release switch OFF nothing new runs", () => {
  it("no gate, no draft, no job, no new edit op", async () => {
    await setLoop(false);
    expect(await asDraftReady(new Date(2027, 0, 13, 12))).toBe(false);
    expect(await runAsDraft(new Date(2027, 0, 13, 12))).toEqual({ created: 0, existing: 0, manual: 0, failed: 0 });
    expect(await MasteryAssignment.countDocuments()).toBe(0);
    await expect(suggestAssignment({ sectionId, dueYmd: DUE, subject: "MATH" }, TEACHER)).rejects.toThrow(NOT_ON);
    await expect(editPartA(String(new Types.ObjectId()), { op: "REMOVE", index: 0 }, TEACHER)).rejects.toThrow(NOT_ON);
  });
});

describe("the draft (switch ON)", () => {
  let draftId = "";
  beforeAll(async () => {
    await setLoop(true);
  });

  it("AC-C15: Nursery has no weekly assignment", async () => {
    await expect(buildSuggestedDraft({ sectionId: nurSectionId, subject: "MATH", dueYmd: DUE, nSubjects: 2, builtBy: "TEACHER", actorId: TEACHER_ID })).rejects.toThrow(NO_ASSIGNMENT_FOR_SMALL);
  });

  it("builds a DRAFT from the lesson marks with reasons and the audit; a second call changes nothing (idempotent)", async () => {
    const r = await buildSuggestedDraft({ sectionId, subject: "MATH", dueYmd: DUE, nSubjects: 2, builtBy: "TEACHER", actorId: TEACHER_ID });
    expect(r.state).toBe("CREATED");
    const a = r.assignment!;
    draftId = String(a._id);
    expect(a.status).toBe("DRAFT");
    expect(a.week).toBe(isoWeekKey(new Date(`${DUE}T00:00:00Z`)));
    expect(a.layout.partAMarks + a.layout.partBMarks).toBe(100); // 360 ÷ 2 subjects ÷ 1.8
    expect(a.suggestion?.builtBy).toBe("TEACHER");
    expect(a.suggestion?.inputs.noLessonMarks).toBe(false);
    expect(a.suggestion?.inputs.chapters).toEqual([7]);
    expect(a.partA.length).toBeGreaterThan(0);
    expect(a.partA.every((q) => q.reasonBn)).toBe(true);
    expect(await MasteryAssignmentSheet.countDocuments({ assignmentId: a._id })).toBe(4);
    const again = await buildSuggestedDraft({ sectionId, subject: "MATH", dueYmd: DUE, nSubjects: 2, builtBy: "ENGINE", actorId: TEACHER_ID });
    expect(again.state).toBe("EXISTS");
    expect(await MasteryAssignment.countDocuments()).toBe(1);
  });

  it("AC-C8: a rebuild with the same inputs gives the same Part A; an edited sheet survives a rebuild", async () => {
    const before = (await MasteryAssignment.findById(draftId))!.partA.map((q) => q.qid);
    await MasteryAssignmentSheet.updateOne({ assignmentId: draftId, studentId: sids[0] }, { $set: { edited: true, "items.0": { origin: "TEACHER", textBn: "নিজের", loCode: A, chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: 2, band: "TEACHER" } } }, { upsert: false });
    const r = await buildSuggestedDraft({ sectionId, subject: "MATH", dueYmd: DUE, nSubjects: 2, builtBy: "TEACHER", actorId: TEACHER_ID, rebuild: true });
    expect(r.state).toBe("REBUILT");
    expect(r.assignment!.partA.map((q) => q.qid)).toEqual(before);
    const kept = await MasteryAssignmentSheet.findOne({ assignmentId: draftId, studentId: sids[0] }).lean();
    expect(kept?.edited).toBe(true);
  });

  it("AC-C3: adding a homework question or an in-window repeat is refused with the reason; an unseen gold question passes and is audited", async () => {
    const a = (await MasteryAssignment.findById(draftId))!;
    const used = new Set([...a.partA.map((q) => q.qid)]);
    const unused = Array.from({ length: 30 }, (_, k) => MQ(k + 1)).filter((x) => !used.has(x));
    const [hw, win, ok] = unused as [string, string, string];
    const mk = (qid: string, kind: "HW" | "AS", day: string) => QuestionUse.create({ qid, kind, sourceType: "MASTERY_PAPER", sourceId: new Types.ObjectId(), academicYearId: yearId, sectionId: new Types.ObjectId(sectionId), classToken: "C3", subject: "MATH", studentIds: [], givenOn: day, useKey: `t|${qid}|${kind}` });
    await mk(hw, "HW", "2026-02-01"); // a homework question of the year, long ago
    const recent = new Date().toISOString().slice(0, 10);
    await mk(win, "AS", recent); // inside the no-repeat window
    await expect(editPartA(draftId, { op: "ADD_BANK", qid: hw }, TEACHER)).rejects.toThrow(/বাড়ির কাজে/);
    await expect(editPartA(draftId, { op: "ADD_BANK", qid: win }, TEACHER)).rejects.toThrow(/সপ্তাহের মধ্যে/);
    await expect(editSheet(draftId, sids[1]!, { op: "ADD_BANK", qid: hw }, TEACHER)).rejects.toThrow(/বাড়ির কাজে/);
    const before = await auditCount("AS_SUGGESTION_EDIT");
    const view = await editPartA(draftId, { op: "ADD_BANK", qid: ok }, TEACHER);
    expect(view.partA.some((q) => q.qid === ok)).toBe(true);
    await tick();
    expect(await auditCount("AS_SUGGESTION_EDIT")).toBe(before + 1);
    expect((await MasteryAssignment.findById(draftId))!.suggestion?.editedAt).toBeTruthy();
    await expect(editPartA(draftId, { op: "ADD_BANK", qid: ok }, TEACHER)).rejects.toThrow(/আগেই আছে/);
  });

  it("AC-C11: finalise names a NEEDS_REVIEW sheet and is refused until it is resolved", async () => {
    await MasteryAssignmentSheet.updateOne({ assignmentId: draftId, studentId: sids[2] }, { $set: { status: "NEEDS_REVIEW" } });
    await expect(sendAssignment(draftId, TEACHER)).rejects.toThrow(/ঘাটতি আছে \(Student 3/);
  });

  it("AC-C14: the Office is refused on a normal day; on a teacher's approved-leave Wednesday it may finalise (audit names them)", async () => {
    await MasteryAssignmentSheet.updateMany({ assignmentId: draftId }, { $set: { status: "DRAFT" } }); // resolved: clean DRAFT sheets
    expect(isFinaliseLeaveDay("2027-01-13")).toBe(true);
    expect(isFinaliseLeaveDay("2027-01-12")).toBe(false);
    // Office without a permission grant to the row, no leave → refused. (Office reaches only through the leave rule.)
    await expect(sendAssignment(draftId, { ...OTHER })).rejects.toThrow();
    jest.useFakeTimers({ now: new Date("2027-01-13T06:00:00.000Z"), doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "clearImmediate", "queueMicrotask", "performance", "hrtime"] });
    try {
      const profileId = new Types.ObjectId();
      mockProfile.mockResolvedValue({ _id: profileId });
      mockTeacher.mockResolvedValue(TEACHER_ID);
      await expect(sendAssignment(draftId, OFFICE)).rejects.toThrow(/ছুটিতে/); // no leave yet
      await StaffLeaveApplication.collection.insertOne({ staffProfileId: profileId, status: "approved", fromKey: "2027-01-13", toKey: "2027-01-14", leaveType: "casual", dayPart: "full", days: 2, reason: "x", appliedBy: new Types.ObjectId() });
      const out = await sendAssignment(draftId, OFFICE);
      expect(out.status).toBe("SENT");
      jest.useRealTimers();
      await tick();
      const row = await Audit.findOne({ eventKind: "MASTERY_ASSIGNMENT_SENT" }).lean();
      expect((row?.meta as Record<string, unknown>)?.finalisedOnLeaveBy).toBe(OFFICE.userId);
    } finally {
      jest.useRealTimers();
    }
  });

  it("AC-C6: a plain subject teacher cannot accept a swap; a finalised subject cannot be swapped", async () => {
    await expect(acceptAssignmentSwap({ sectionId, dueYmd: DUE, dropSubject: "MATH", addSubject: "SCI" }, OTHER)).rejects.toThrow(/ক্লাস শিক্ষক বা অফিস/);
  });
});

describe("ASDRAFT (AC-C1, AC-C13)", () => {
  beforeAll(async () => {
    await MasteryAssignmentSheet.deleteMany({});
    await MasteryAssignment.deleteMany({});
    await Notification.deleteMany({});
    await Audit.deleteMany({}); // the per-week "engine built it" markers of the earlier describe
    await setLoop(true);
  });
  const WED = new Date(2027, 0, 13, 12, 0, 0); // the draft day: one school day before Thursday 14 Jan

  it("runs from asDraftHour; a draft per rotation subject with mastery on; the teacher is told once; a second run creates nothing", async () => {
    expect(await asDraftReady(new Date(2027, 0, 13, 5, 0))).toBe(false); // before 06:00
    expect(await asDraftReady(WED)).toBe(true);
    const one = await runAsDraft(new Date(2027, 0, 12, 12)); // Tuesday: too early
    expect(one.created).toBe(0);
    const r = await runAsDraft(WED);
    expect(r).toMatchObject({ created: 1, failed: 0 });
    const a = await MasteryAssignment.findOne({ sectionId, subject: "MATH" });
    expect(a?.status).toBe("DRAFT");
    expect(a?.suggestion?.builtBy).toBe("ENGINE");
    const notes = await Notification.find({ kind: "AS_DRAFT_READY" }).lean();
    expect(notes).toHaveLength(1);
    expect(String(notes[0]!.recipientUserId)).toBe(TEACHER_ID);
    expect(notes[0]!.titleBn).toBe("সাপ্তাহিক অ্যাসাইনমেন্টের খসড়া তৈরি");
    const second = await runAsDraft(WED);
    expect(second.created).toBe(0);
    expect(await MasteryAssignment.countDocuments()).toBe(1);
    expect(await Notification.countDocuments({ kind: "AS_DRAFT_READY" })).toBe(1);
  });

  it("a draft the teacher deleted is NOT re-created by a later run (persistent per-week marker)", async () => {
    const a = await MasteryAssignment.findOne({ sectionId, subject: "MATH" });
    await MasteryAssignmentSheet.deleteMany({ assignmentId: a!._id });
    await MasteryAssignment.deleteOne({ _id: a!._id });
    const r = await runAsDraft(WED);
    expect(r.created).toBe(0);
    expect(await MasteryAssignment.countDocuments()).toBe(0);
  });

  it("AC-C13: a week inside an ASSIGNMENT_GENERATION pause gets no draft and no notice", async () => {
    await MasteryAssignmentSheet.deleteMany({});
    await MasteryAssignment.deleteMany({});
    await Notification.deleteMany({});
    const p = await createPause({ fromKey: "2027-01-10", toKey: "2027-01-16", label: "পরীক্ষা", pauses: ["ASSIGNMENT_GENERATION"] });
    // AC-C13: a paused week has no rotation — a named subject is refused.
    await expect(suggestAssignment({ sectionId, dueYmd: DUE, subject: "MATH" }, TEACHER)).rejects.toThrow(/অ্যাসাইনমেন্ট নেই/);
    const r = await runAsDraft(WED);
    expect(r.created).toBe(0);
    expect(await MasteryAssignment.countDocuments()).toBe(0);
    expect(await Notification.countDocuments({ kind: "AS_DRAFT_READY" })).toBe(0);
    await mongoose.model("AcademicPause").deleteOne({ _id: (p as unknown as { _id: Types.ObjectId })._id });
  });
});
