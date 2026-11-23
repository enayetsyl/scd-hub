/**
 * AL-7 (review round) — the system delivery of a finalised tailored assignment, the swap card, the day plan, the load,
 * merged-শাখা reads, substitute finalise, the holiday roll and the OFF shapes
 * (docs/prd-academic-loop-2027.md §4.4–§4.6, §7; AC-C1, C5, C6, C10, C13, C14, C15, AC-S1, AC-U2, AC-R1).
 * In-memory MongoDB, real services; the routine lookup is stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

jest.unmock("../modules/academic-pause/services/AcademicPauseService");
const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({ resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a) }));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { SectionMerge } from "../modules/foundation/models/SectionMerge";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { QuestionUse } from "../modules/assessment/models/QuestionUse";
import { AssignmentSchedule } from "../modules/trackers/models/AssignmentSchedule";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { AssignmentNilDeclaration } from "../modules/trackers/models/AssignmentNilDeclaration";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { MasteryAssignment } from "../modules/mastery/models/MasteryAssignment";
import { MasteryAssignmentSheet } from "../modules/mastery/models/MasteryAssignmentSheet";
import { MasteryEnablement } from "../modules/mastery/models/MasteryEnablement";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { Audit } from "../modules/platform/models/Audit";
import { Notification } from "../modules/notifications/models/Notification";
import { importCatalogue, savePolicy, setEnablement, settleLoopRecompute } from "../modules/mastery/services/MasteryCatalogueService";
import { approveAllSheets, editPartA, editSheet, sendAssignment, sheetDetail } from "../modules/mastery/services/MasteryAssignmentService";
import {
  acceptAssignmentSwap,
  assignmentLoad,
  assignmentSuggestionWeek,
  buildSuggestedDraft,
  deliverTailoredItems,
  runAsDraft,
} from "../modules/mastery/services/AssignmentSuggestionService";
import { sweepAssignmentAutoIssue } from "../modules/trackers/services/AssignmentAutoIssueService";
import * as scheduleService from "../modules/trackers/services/AssignmentScheduleService";
import { createPause } from "../modules/academic-pause/services/AcademicPauseService";
import { isoWeekKey } from "../modules/mastery/evidence";

jest.setTimeout(300_000);

let mongo: MongoMemoryServer;
const T_MATH = new Types.ObjectId().toString();
const T_SCI = new Types.ObjectId().toString();
const CT_ID = new Types.ObjectId().toString();
const STRANGER = new Types.ObjectId().toString();
const COVER = new Types.ObjectId().toString();
const mk = (id: string, role: "TEACHER" | "OFFICE" | "PRINCIPAL" = "TEACHER") => ({ userId: id, role });
const PRINCIPAL = mk(new Types.ObjectId().toString(), "PRINCIPAL");
let yearId = new Types.ObjectId();
let sectionId = "";
let otherSectionId = "";
let nurSectionId = "";
let entryId = "";
const sids: string[] = [];
const DUE = "2027-01-17";
const MQ = (n: number) => `QP-MATH-C3-U07-Q98${String(n).padStart(3, "0")}`;
const SQ = (n: number) => `QP-SCI-C3-U03-Q98${String(n).padStart(3, "0")}`;
const cat = (subject: string, code: string, ch: number) =>
  JSON.stringify({
    classToken: "C3", subject, status: "LOCKED", chapters: [{ number: ch, titleBn: "অধ্যায়" }],
    outcomes: [{ code, labelBn: `${subject} শিখনফল`, assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] }],
    questionTypes: [{ code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 2 }],
  });
const A = "LO-C3-MATH-07-01";
const S = "LO-C3-SCI-03-01";
const setLoop = async (on: boolean) => {
  await savePolicy(null, null, { academicLoop2027On: on }, PRINCIPAL);
  await settleLoopRecompute();
};
const fakeNow = (iso: string) =>
  jest.useFakeTimers({ now: new Date(iso), doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "clearImmediate", "queueMicrotask", "performance", "hrtime"] });
const THU_NOON = "2027-01-14T06:00:00.000Z"; // Thursday 14 Jan, 12:00 Dhaka = the delivery day
const THU = new Date(2027, 0, 14, 12, 0, 0);
const clearWeek = async () => {
  await MasteryAssignmentSheet.deleteMany({});
  await MasteryAssignment.deleteMany({});
  await AssignmentItem.deleteMany({});
  await AssignmentStudentRecord.deleteMany({});
  await AssignmentNilDeclaration.deleteMany({});
  await MasteryPaper.deleteMany({});
  await Notification.deleteMany({});
  await Audit.deleteMany({});
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
  yearId = year._id;
  const [cls, nurCls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }, { level: -1, nameBn: "নার্সারি", academicYearId: year._id }]);
  const [b, x, n] = await Section.create([
    { classId: cls._id, code: "B", nameBn: "বালক", classTeacherId: new Types.ObjectId(CT_ID) },
    { classId: cls._id, code: "X", nameBn: "বালিকা" },
    { classId: nurCls._id, code: "N", nameBn: "নার্সারি" },
  ]);
  sectionId = String(b._id);
  otherSectionId = String(x._id);
  nurSectionId = String(n._id);
  for (let i = 1; i <= 4; i++) {
    const [s] = await Student.create([{ schoolId: `AL7B-${i}`, name: `Child ${i}`, rollNumber: String(i), classId: cls._id, sectionId: b._id, active: true }]);
    sids.push(String(s._id));
  }
  for (const [code, lo, ch] of [["MATH", A, 7], ["SCI", S, 3]] as const) {
    const r = await importCatalogue(cat(code, lo, ch), true, PRINCIPAL);
    if (!r.ok) throw new Error(r.errors.join("; "));
    await setEnablement(String(year._id), "C3", code, true, PRINCIPAL);
  }
  const base = { docType: "question", classLevel: 3, curationTag: "KEEP_AS_IS", current: true, importedBy: new Types.ObjectId(), reviewStatus: "gold" };
  for (let k = 1; k <= 40; k++) {
    await ContentArtifact.create([{ ...base, subject: "MATH", address: { anchorWord: "অধ্যায়", number: 7 }, envelopeJson: { tags: { topic_tag: A, difficulty: "medium" }, payload: { qid: MQ(k), topic_tag: A, marks: 2, question_text: `${MQ(k)} লেখা` } } }]);
    await ContentArtifact.create([{ ...base, subject: "SCI", address: { anchorWord: "অধ্যায়", number: 3 }, envelopeJson: { tags: { topic_tag: S, difficulty: "medium" }, payload: { qid: SQ(k), topic_tag: S, marks: 2, question_text: `${SQ(k)} লেখা` } } }]);
  }
  await LessonDelivery.create({
    noteId: new Types.ObjectId(), slotId: new Types.ObjectId(), sectionId: b._id, classLevel: 3, subject: "MATH", dateKey: "2027-01-11",
    teacherId: new Types.ObjectId(T_MATH), updatedBy: new Types.ObjectId(T_MATH), rosterStudentIds: sids.map((s) => new Types.ObjectId(s)),
    sessions: [{ chapter: "7", sessionIndex: 1, sessionOf: 1, titleBn: "ভাগ", finished: true, loCodes: [A] }],
  });
  const sched = await AssignmentSchedule.create({
    academicYearId: year._id, termStartDate: new Date(2027, 0, 3), deliveryDayOfWeek: 4, dueDayOfWeek: 0,
    entries: [{ cycleWeek: 2, classId: cls._id, classLevel: 3, sectionId: b._id, subject: "MATH", teacherId: new Types.ObjectId(T_MATH) }],
  });
  entryId = String(sched.entries[0]!._id);
  mockTeacher.mockImplementation(async (_s: unknown, subject: unknown) => (subject === "SCI" ? T_SCI : T_MATH));
  await setLoop(true);
});

afterAll(async () => {
  jest.useRealTimers();
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  jest.restoreAllMocks();
  mockTeacher.mockImplementation(async (_s: unknown, subject: unknown) => (subject === "SCI" ? T_SCI : T_MATH));
  await clearWeek();
});

// ---------------------------------------------------------------------------
describe("finalise → delivery day → item delivered → the D-#839 sweep issues the week", () => {
  it("a finalised engine draft is delivered as a DRAFT tracker item; the sweep issues it (present GIVEN, absent ABSENT_REDELIVER)", async () => {
    await mongoose.connection.db!.collection("studentattendancedays").insertOne({ sectionId: new Types.ObjectId(sectionId), dateKey: "2027-01-14", absentStudentIds: [new Types.ObjectId(sids[3])], markedBy: new Types.ObjectId(), markedAt: new Date() });
    const r = await buildSuggestedDraft({ sectionId, subject: "MATH", dueYmd: DUE, nSubjects: 1, builtBy: "ENGINE", actorId: T_MATH });
    const id = String(r.assignment!._id);
    // Before the delivery day nothing is delivered.
    await approveAllSheets(id, mk(T_MATH));
    fakeNow("2027-01-12T06:00:00.000Z");
    try {
      await sendAssignment(id, mk(T_MATH));
      expect(await AssignmentItem.countDocuments()).toBe(0);
      expect(await deliverTailoredItems(new Date(2027, 0, 12, 12))).toBe(0);
    } finally {
      jest.useRealTimers();
    }
    // The delivery day tick (before the sweep): the item is delivered by the system.
    expect(await deliverTailoredItems(THU)).toBe(1);
    const item = (await AssignmentItem.findOne({ subject: "MATH" }))!;
    expect(item.status).toBe("DRAFT");
    expect(String(item.scheduleEntryId)).toBe(entryId);
    expect(item.description).toContain("শিট");
    const a = (await MasteryAssignment.findById(id))!;
    expect(item.estMinutes).toBe(Math.round(a.countedMinutes!));
    expect(item.doOnDay).toBe(a.doOnDay);
    expect(String(a.asItemId)).toBe(String(item._id));
    const paper = (await MasteryPaper.findById(a.paperId))!;
    expect(String(paper.links?.asItemId)).toBe(String(item._id));
    expect(await deliverTailoredItems(THU)).toBe(0); // idempotent
    fakeNow(THU_NOON);
    try {
      const res = await sweepAssignmentAutoIssue(THU);
      expect(res.issued).toBe(1);
    } finally {
      jest.useRealTimers();
    }
    const recs = await AssignmentStudentRecord.find({ asItemId: item._id }).lean();
    expect(recs).toHaveLength(4);
    expect(recs.find((x) => String(x.studentId) === sids[0])?.state).toBe("GIVEN");
    expect(recs.find((x) => String(x.studentId) === sids[3])?.state).toBe("ABSENT_REDELIVER");
  });

  it("finalising ON the delivery day delivers the item right away", async () => {
    const r = await buildSuggestedDraft({ sectionId, subject: "MATH", dueYmd: DUE, nSubjects: 1, builtBy: "ENGINE", actorId: T_MATH });
    const id = String(r.assignment!._id);
    await approveAllSheets(id, mk(T_MATH));
    fakeNow(THU_NOON);
    try {
      await sendAssignment(id, mk(T_MATH));
    } finally {
      jest.useRealTimers();
    }
    expect(await AssignmentItem.countDocuments({ subject: "MATH" })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("the swap card (AC-C6): a successful accept, the swapped-in subject delivered, no second card", () => {
  beforeEach(async () => {
    // SCI: every child WEAK (two papers under 50 %) → 100 % WEAK rows against MATH's none.
    await MasteryEvidence.deleteMany({});
    for (const p of [new Types.ObjectId(), new Types.ObjectId()]) {
      for (const sid of sids) {
        await MasteryEvidence.create({
          studentId: sid, sectionId, academicYearId: yearId, classToken: "C3", subject: "SCI", loCode: S, source: "HW", paperId: p, itemNo: 1,
          qid: SQ(900 + sids.indexOf(sid)), earned: 0, available: 2, signal: "WEAK", at: new Date("2027-01-08T06:00:00Z"), week: "2027-W01",
        });
      }
    }
  });

  it("the card MATH → SCI is offered to the class teacher; a failed nil declaration leaves the week untouched; the accept swaps and notifies both", async () => {
    await runAsDraft(new Date(2027, 0, 13, 12));
    expect(await MasteryAssignment.countDocuments({ subject: "MATH" })).toBe(1);
    const view = await assignmentSuggestionWeek(sectionId, DUE, mk(CT_ID));
    expect(view.swapCard).toMatchObject({ dropSubject: "MATH", addSubject: "SCI" });
    expect(view.canAcceptSwap).toBe(true);
    expect((await Notification.find({ kind: "AS_SWAP_SUGGESTED" }).lean()).map((n) => String(n.recipientUserId))).toContain(CT_ID);
    // A failed nil declaration: nothing changes (the new draft is undone, the dropped one stays).
    jest.spyOn(scheduleService, "declareNoAssignment").mockRejectedValueOnce(new Error("boom"));
    await expect(acceptAssignmentSwap({ sectionId, dueYmd: DUE, dropSubject: "MATH", addSubject: "SCI" }, mk(CT_ID))).rejects.toThrow(/বিষয় বদল সম্পন্ন হয়নি/);
    expect(await MasteryAssignment.countDocuments({ subject: "MATH" })).toBe(1);
    expect(await MasteryAssignment.countDocuments({ subject: "SCI" })).toBe(0);
    expect(await AssignmentNilDeclaration.countDocuments()).toBe(0);
    // The accept.
    const out = await acceptAssignmentSwap({ sectionId, dueYmd: DUE, dropSubject: "MATH", addSubject: "SCI" }, mk(CT_ID));
    expect(out.subject).toBe("SCI");
    expect(await MasteryAssignment.countDocuments({ subject: "MATH" })).toBe(0);
    const sci = (await MasteryAssignment.findOne({ subject: "SCI" }))!;
    expect(sci.suggestion?.swap).toEqual({ drop: "MATH", add: "SCI" });
    expect(await AssignmentNilDeclaration.countDocuments({ subject: "MATH" })).toBe(1);
    const sched = (await AssignmentSchedule.findOne({ academicYearId: yearId }))!;
    expect(sched.entries.map((e) => e.subject)).toEqual(["MATH"]); // the rotation table is unchanged
    const told = (await Notification.find({ kind: "AS_SWAP_SUGGESTED", titleBn: "অ্যাসাইনমেন্টে বিষয় বদল" }).lean()).map((n) => String(n.recipientUserId)).sort();
    expect(told).toEqual([T_MATH, T_SCI].sort());
    // Not re-offered, and ASDRAFT does not re-create the dropped draft.
    expect((await assignmentSuggestionWeek(sectionId, DUE, mk(CT_ID))).swapCard).toBeNull();
    expect((await runAsDraft(new Date(2027, 0, 13, 12))).created).toBe(0);
    expect(await MasteryAssignment.countDocuments({ subject: "MATH" })).toBe(0);
    await expect(acceptAssignmentSwap({ sectionId, dueYmd: DUE, dropSubject: "MATH", addSubject: "SCI" }, mk(CT_ID))).rejects.toThrow();

    // The swapped-in subject is finalised by ITS teacher and delivered with the dropped cell's ids; the sweep issues the week.
    await approveAllSheets(String(sci._id), mk(T_SCI));
    fakeNow(THU_NOON);
    try {
      await sendAssignment(String(sci._id), mk(T_SCI));
      const item = (await AssignmentItem.findOne({ subject: "SCI" }))!;
      expect(item).toBeTruthy();
      expect(String(item.scheduleEntryId)).toBe(entryId);
      expect(String(item.teacherId)).toBe(T_SCI);
      expect((await sweepAssignmentAutoIssue(THU)).issued).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("a build failure leaves the week untouched (the swap builds first)", async () => {
    await runAsDraft(new Date(2027, 0, 13, 12));
    await MasteryEnablement.updateOne({ academicYearId: yearId, classToken: "C3", subject: "SCI" }, { $set: { enabled: false } });
    await expect(acceptAssignmentSwap({ sectionId, dueYmd: DUE, dropSubject: "MATH", addSubject: "SCI" }, mk(CT_ID))).rejects.toThrow();
    await MasteryEnablement.updateOne({ academicYearId: yearId, classToken: "C3", subject: "SCI" }, { $set: { enabled: true } });
    expect(await MasteryAssignment.countDocuments({ subject: "MATH" })).toBe(1);
    expect(await AssignmentNilDeclaration.countDocuments()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("the day plan and the per-child load", () => {
  const sheetFor = async (a: { _id: unknown }, marks: number[]) => {
    for (const [i, sid] of sids.entries()) {
      await MasteryAssignmentSheet.create({ assignmentId: a._id, studentId: sid, status: "APPROVED", edited: false, items: [{ origin: "TEACHER", textBn: `খ ${i}`, loCode: A, chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: marks[i]!, band: "WEAK" }] });
    }
  };
  const draft = (subject: string, status: "DRAFT" | "SENT", extra: Record<string, unknown> = {}) =>
    MasteryAssignment.create({
      sectionId, classId: new Types.ObjectId(), academicYearId: yearId, classToken: "C3", subject, dueDate: new Date(`${DUE}T00:00:00.000Z`), week: isoWeekKey(new Date(`${DUE}T00:00:00.000Z`)),
      layout: { totalMarks: 100, minutes: 180, partAOn: true, partAMarks: 40, partALoCodes: [], partBMarks: 60, mixWeak: 60, mixImproving: 25, mixRevision: 15, questionTypeCodes: [] },
      rememberLayout: false, partA: [{ origin: "TEACHER", textBn: "ক", loCode: A, chapterNumber: 7, questionTypeCode: "QT-SHORT", marks: 40, band: "SECTION" }],
      status, builtAt: new Date(), builtBy: new Types.ObjectId(), ...extra,
    });

  it("a SENT subject on Friday (180) seeds the split: the MATH draft (180) goes to Saturday", async () => {
    await draft("BAN", "SENT", { countedMinutes: 180, doOnDay: "FRI", minutesByDay: { FRI: 180, SAT: 0 } });
    const math = await draft("MATH", "DRAFT");
    await sheetFor(math, [60, 60, 60, 60]); // (40 + 60) × 1.8 = 180
    const v = await assignmentSuggestionWeek(sectionId, DUE, mk(CT_ID));
    expect(v.dayPlan).toMatchObject({ FRI: 180, SAT: 180, overBy: 0 });
  });

  it("the load: Friday-first split per child, a child over 3 h warns, only the week's readers may read it", async () => {
    await draft("BAN", "SENT", { countedMinutes: 180, doOnDay: "FRI", minutesByDay: { FRI: 180, SAT: 0 } });
    const math = await draft("MATH", "DRAFT");
    await sheetFor(math, [60, 60, 60, 100]); // child 4: (40 + 100) × 1.8 = 252 min
    await MasteryAssignmentSheet.create({ assignmentId: (await MasteryAssignment.findOne({ subject: "BAN" }))!._id, studentId: sids[0], status: "APPROVED", edited: false, items: [] });
    const load = await assignmentLoad(sectionId, DUE, mk(CT_ID));
    expect(load.children).toHaveLength(4);
    expect(load.dayCap).toBe(180);
    const c4 = load.children.find((c) => c.studentId === sids[3])!;
    expect(c4.FRI + c4.SAT).toBeGreaterThan(180); // MATH 252 on Saturday beside BAN
    expect(load.children.find((c) => c.studentId === sids[0])!.warn).toBe(false);
    expect(load.thursdayHomework).toEqual([]);
    expect((await assignmentLoad(sectionId, DUE, mk(T_MATH))).children).toHaveLength(4); // the week's subject teacher
    await expect(assignmentLoad(sectionId, DUE, mk(STRANGER))).rejects.toThrow(/শুধু এই সপ্তাহের বিষয়শিক্ষক/);
  });
});

// ---------------------------------------------------------------------------
describe("ASDRAFT calendar and units", () => {
  it("a Thursday holiday rolls delivery to Wednesday and the draft to Tuesday (AC-C13)", async () => {
    await mongoose.connection.db!.collection("holidayexceptions").insertOne({ fromDate: new Date(2027, 0, 14), toDate: new Date(2027, 0, 14, 23, 59), active: true, reason: "x", label: "x" });
    try {
      expect((await runAsDraft(new Date(2027, 0, 11, 12))).created).toBe(0); // Monday: too early
      expect((await runAsDraft(new Date(2027, 0, 12, 12))).created).toBe(1); // Tuesday
    } finally {
      await mongoose.connection.db!.collection("holidayexceptions").deleteMany({});
    }
  });

  it("when only the draft day is paused, the draft runs on the first unpaused school day", async () => {
    const p = await createPause({ fromKey: "2027-01-13", toKey: "2027-01-13", label: "x", pauses: ["ASSIGNMENT_GENERATION"] });
    expect((await runAsDraft(new Date(2027, 0, 13, 12))).created).toBe(0);
    expect((await runAsDraft(new Date(2027, 0, 14, 12))).created).toBe(1);
    await mongoose.model("AcademicPause").deleteOne({ _id: (p as unknown as { _id: Types.ObjectId })._id });
  });

  it("Nursery / KG never get a draft (AC-C15)", async () => {
    await AssignmentSchedule.updateOne({ academicYearId: yearId }, { $push: { entries: { cycleWeek: 2, classId: new Types.ObjectId(), classLevel: -1, sectionId: nurSectionId, subject: "MATH", teacherId: new Types.ObjectId(T_MATH) } } });
    await runAsDraft(new Date(2027, 0, 13, 12));
    expect(await MasteryAssignment.countDocuments({ sectionId: nurSectionId })).toBe(0);
    await AssignmentSchedule.updateOne({ academicYearId: yearId }, { $pull: { entries: { sectionId: new Types.ObjectId(nurSectionId) } } });
  });
});

// ---------------------------------------------------------------------------
describe("merged শাখা (AC-U2) and substitute finalise (AC-S1, AC-C14)", () => {
  it("a question used in a merge SOURCE শাখা in the window is refused for the merged শাখা", async () => {
    const r = await buildSuggestedDraft({ sectionId, subject: "MATH", dueYmd: DUE, nSubjects: 2, builtBy: "ENGINE", actorId: T_MATH });
    await SectionMerge.create({ classId: new Types.ObjectId(), combinedSectionId: new Types.ObjectId(sectionId), sourceSectionIds: [new Types.ObjectId(otherSectionId)], moves: [], status: "active", mergedBy: new Types.ObjectId() });
    const used = new Set(r.assignment!.partA.map((q) => q.qid));
    const target = Array.from({ length: 40 }, (_, k) => MQ(k + 1)).find((q) => !used.has(q))!;
    await QuestionUse.create({ qid: target, kind: "AS", sourceType: "MASTERY_PAPER", sourceId: new Types.ObjectId(), academicYearId: yearId, sectionId: new Types.ObjectId(otherSectionId), classToken: "C3", subject: "MATH", studentIds: [], givenOn: new Date().toISOString().slice(0, 10), useKey: `merge|${target}` });
    await expect(editPartA(String(r.assignment!._id), { op: "ADD_BANK", qid: target }, mk(T_MATH))).rejects.toThrow(/সপ্তাহের মধ্যে/);
    await SectionMerge.deleteMany({});
  });

  it("today's substitute finalises (audit names them); another teacher is refused", async () => {
    const r = await buildSuggestedDraft({ sectionId, subject: "MATH", dueYmd: DUE, nSubjects: 2, builtBy: "ENGINE", actorId: T_MATH });
    const id = String(r.assignment!._id);
    const slot = await mongoose.connection.db!.collection("routineslots").insertOne({ groupType: "section", groupId: new Types.ObjectId(sectionId), dayOfWeek: "WED", periodNumber: 1, subject: "MATH", track: "general", teacherId: new Types.ObjectId(T_MATH), active: true, isBreak: false, effectiveFrom: new Date("2026-01-01"), createdBy: new Types.ObjectId() });
    await mongoose.connection.db!.collection("routinesubstitutions").insertOne({ slotId: slot.insertedId, date: new Date("2027-01-13T00:00:00.000Z"), coverTeacherId: new Types.ObjectId(COVER), absentTeacherId: new Types.ObjectId(T_MATH), active: true, createdBy: new Types.ObjectId() });
    await approveAllSheets(id, mk(T_MATH));
    fakeNow("2027-01-13T06:00:00.000Z");
    try {
      await expect(sendAssignment(id, mk(STRANGER))).rejects.toThrow();
      const out = await sendAssignment(id, mk(COVER));
      expect(out.status).toBe("SENT");
    } finally {
      jest.useRealTimers();
    }
    await new Promise((r2) => setTimeout(r2, 50));
    const row = await Audit.findOne({ eventKind: "MASTERY_ASSIGNMENT_SENT" }).lean();
    expect((row?.meta as Record<string, unknown>)?.finalisedOnLeaveBy).toBe(COVER);
    expect((row?.meta as Record<string, unknown>)?.reason).toBe("SUBSTITUTE_COVER");
    await mongoose.connection.db!.collection("routineslots").deleteMany({});
    await mongoose.connection.db!.collection("routinesubstitutions").deleteMany({});
  });
});

// ---------------------------------------------------------------------------
describe("AC-R1: switch OFF — no wider reach, the empty shapes", () => {
  it("an Office login that merely holds a routine slot cannot edit, approve, read or send a mastery assignment (OFF)", async () => {
    const r = await buildSuggestedDraft({ sectionId, subject: "MATH", dueYmd: DUE, nSubjects: 2, builtBy: "ENGINE", actorId: T_MATH });
    const id = String(r.assignment!._id);
    await setLoop(false);
    try {
      const OFFICE = mk(new Types.ObjectId().toString(), "OFFICE");
      mockTeacher.mockResolvedValue(OFFICE.userId); // the routine names the Office login
      await expect(sheetDetail(id, sids[0]!, OFFICE)).rejects.toThrow(/দায়িত্ব আপনার নয়/);
      await expect(editSheet(id, sids[0]!, { op: "REMOVE", index: 0 }, OFFICE)).rejects.toThrow(/দায়িত্ব আপনার নয়/);
      await expect(approveAllSheets(id, OFFICE)).rejects.toThrow(/দায়িত্ব আপনার নয়/);
      await expect(sendAssignment(id, OFFICE)).rejects.toThrow(/দায়িত্ব আপনার নয়/);
      mockTeacher.mockResolvedValue(T_MATH);
      expect((await sheetDetail(id, sids[0]!, mk(T_MATH))).studentId).toBe(sids[0]); // the subject teacher is unaffected
      // The week + load reads are the plain empty shape.
      const w = await assignmentSuggestionWeek(sectionId, DUE, mk(CT_ID));
      expect(w).toMatchObject({ hasWeek: false, subjects: [], swapCard: null });
      expect((await assignmentLoad(sectionId, DUE, mk(CT_ID))).children).toEqual([]);
    } finally {
      await setLoop(true);
    }
  });
});
