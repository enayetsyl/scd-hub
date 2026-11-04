/**
 * OT-5 — lesson plans carry objective codes (docs/prd-objective-tree.md §8.3 + §10 item 11, D-#949–#951).
 *
 *  - codeCovers / deliveredCodes / objectiveStatusOf (pure)
 *  - marking a session plan with `tags.lo_codes` snapshots the codes on the LessonDelivery (§10.11)
 *  - a WEAK student absent the day it was taught → objectiveLesson MISSED ("missed that class");
 *    a WEAK student who was there → TAUGHT ("taught, not yet learnt"); a code never taught → NOT_TAUGHT
 *  - the শাখা view: per objective row — taught on, absent that day, not yet taught
 *  - the class-note card exposes each session's codes and the lazy `objectives`
 *  - plans without codes, and older marks without a snapshot, keep working (the latter reads the
 *    current plan's codes, D-#949)
 *  - ContentArtifact.loCodes on the content read path
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { graphql, type ExecutionResult } from "graphql";

jest.mock("../modules/notifications/services/emitters", () => ({
  emitClassNotePublished: jest.fn(async () => undefined),
}));
const mockTeacher = jest.fn<Promise<string | null>, unknown[]>();
jest.mock("../modules/trackers/subjectTeacher", () => ({
  ...jest.requireActual("../modules/trackers/subjectTeacher"),
  resolveSubjectTeacher: (...a: unknown[]) => mockTeacher(...a),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { StudentAttendanceDay } from "../modules/attendance/models/StudentAttendanceDay";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { publishClassNote } from "../modules/routine/services/RoutineTriggerService";
import { deliveryView, lessonPlanForSlot, recordDelivery } from "../modules/lesson-progress/services/LessonDeliveryService";
import {
  codeCovers,
  deliveredCodes,
  objectiveStatusOf,
  sectionObjectiveRows,
  studentObjectiveLessons,
} from "../modules/lesson-progress/services/ObjectiveLessonService";
import { importCatalogue, setEnablement } from "../modules/mastery/services/MasteryCatalogueService";
import { confirmPaper, createPaper, saveResults } from "../modules/mastery/services/MasteryWorkService";
import "../registerResolvers";
import { builder } from "../schema";

jest.setTimeout(180_000);

describe("pure helpers", () => {
  it("codeCovers: the code itself or one of its .N children — never a sibling prefix", () => {
    expect(codeCovers("LO-C1-MATH-07-03", "LO-C1-MATH-07-03")).toBe(true);
    expect(codeCovers("LO-C1-MATH-07-03", "LO-C1-MATH-07-03.2")).toBe(true);
    expect(codeCovers("LO-C1-MATH-07-03.2", "LO-C1-MATH-07-03")).toBe(false);
    expect(codeCovers("LO-C1-MATH-07-0", "LO-C1-MATH-07-03")).toBe(false);
  });

  it("deliveredCodes: the marking snapshot wins; without one, the current plan's codes for the stable key", () => {
    const plan = new Map([["7:1", ["LO-C3-MATH-07-03"]]]);
    expect(deliveredCodes({ chapter: "7", sessionIndex: 1, loCodes: ["LO-C3-MATH-07-02"] }, plan)).toEqual(["LO-C3-MATH-07-02"]);
    expect(deliveredCodes({ chapter: "7", sessionIndex: 1 }, plan)).toEqual(["LO-C3-MATH-07-03"]);
    expect(deliveredCodes({ chapter: "7", sessionIndex: 2 }, plan)).toEqual([]);
  });

  it("objectiveStatusOf: absent on a taught day → MISSED; present → TAUGHT; no attendance → UNKNOWN; none → NOT_TAUGHT", () => {
    expect(objectiveStatusOf({ presence: "PARTIAL", absentOn: ["d1"] }, ["d1", "d2"])).toBe("MISSED");
    expect(objectiveStatusOf({ presence: "ABSENT", absentOn: ["d1"] }, ["d1"])).toBe("MISSED");
    expect(objectiveStatusOf({ presence: "PRESENT", absentOn: [] }, ["d1"])).toBe("TAUGHT");
    expect(objectiveStatusOf({ presence: "PARTIAL", absentOn: [] }, ["d1", "d2"])).toBe("TAUGHT");
    expect(objectiveStatusOf({ presence: "UNKNOWN", absentOn: [] }, ["d1"])).toBe("UNKNOWN");
    expect(objectiveStatusOf({ presence: "UNKNOWN", absentOn: [] }, [])).toBe("NOT_TAUGHT");
  });
});

let mongo: MongoMemoryServer;
const TEACHER_ID = new Types.ObjectId().toString();
const TEACHER = { userId: TEACHER_ID, role: "TEACHER" as const };
const PRINCIPAL = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" as const };
let sectionId = "";
let mathSlotId = "";
let banSlotId = "";
const sids: string[] = [];

const CATALOGUE = JSON.stringify({
  classToken: "C3",
  subject: "MATH",
  status: "LOCKED",
  chapters: [{ number: 7, titleBn: "ভাগ" }],
  outcomes: [
    { code: "LO-C3-MATH-07-02", labelBn: "ভাগফল ও ভাগশেষ", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] },
    { code: "LO-C3-MATH-07-03", labelBn: "খাতায় লম্বা ভাগ", assess: "QUESTION", questionTypeCodes: ["QT-WORD"] },
    { code: "LO-C3-MATH-07-04", labelBn: "ভাগের কথার অঙ্ক", assess: "QUESTION", questionTypeCodes: ["QT-WORD"] },
  ],
  questionTypes: [
    { code: "QT-SHORT", labelBn: "সংক্ষিপ্ত", marks: 1 },
    { code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: 5 },
  ],
});

async function plan(subject: string, chapter: number, index: number, of: number, loCodes?: string[]) {
  await ContentArtifact.create([{
    docType: "session_plan", subject, classLevel: 3, address: { anchorWord: "অধ্যায়", number: chapter, title: `ch ${chapter}` },
    curationTag: "KEEP_AS_IS", reviewStatus: "reviewed", current: true, importedBy: new Types.ObjectId(),
    ...(loCodes ? { tags: { lo_codes: loCodes } } : {}),
    envelopeJson: {
      ...(loCodes ? { tags: { lo_codes: loCodes } } : {}),
      payload: { session_plan: { session_form: "multi_period", period_index: index, period_of: of, session_title: `${subject} ${chapter}:${index}` } },
    },
  }]);
}

const teach = async (slotId: string, date: string, sessions: Array<[string, boolean]>) => {
  const note = await publishClassNote({ slotId, date: new Date(date), taughtSummaryBn: "x", actorId: TEACHER_ID, canManage: false });
  return recordDelivery(note, { sessions: sessions.map(([key, finished]) => ({ key, finished })) }, TEACHER_ID);
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // registerResolvers loads every model; one partial index is not supported by the in-memory server — irrelevant here.
  await Promise.allSettled(Object.values(mongoose.models).map((m) => m.init()));
  mockTeacher.mockResolvedValue(TEACHER_ID);
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: true }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [sec] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  sectionId = String(sec._id);
  for (let i = 1; i <= 4; i++) {
    const [s] = await Student.create([{ schoolId: `OT5-${i}`, name: `Student ${i}`, rollNumber: String(i), classId: cls._id, sectionId: sec._id, active: true }]);
    sids.push(String(s._id));
  }
  // MATH chapter 7: session 1 teaches long division (07-03), session 2 the word problems (07-04). BAN carries no codes.
  await plan("MATH", 7, 1, 2, ["LO-C3-MATH-07-03"]);
  await plan("MATH", 7, 2, 2, ["LO-C3-MATH-07-04"]);
  await plan("BAN", 1, 1, 1);
  const slot = async (subject: string) =>
    String((await RoutineSlot.create([{
      groupType: "section", groupId: sec._id, classId: cls._id, dayOfWeek: "SUN", periodNumber: subject === "MATH" ? 1 : 2, subject, track: "general",
      teacherId: new Types.ObjectId(TEACHER_ID), effectiveFrom: new Date("2027-01-01"), createdBy: new Types.ObjectId(),
    }]))[0]._id);
  mathSlotId = await slot("MATH");
  banSlotId = await slot("BAN");

  // 1 March: 7:1 taught; Student 1 absent. Student 2 is there.
  await StudentAttendanceDay.create([{ sectionId: sec._id, dateKey: "2027-03-01", absentStudentIds: [new Types.ObjectId(sids[0])], markedBy: new Types.ObjectId(), markedAt: new Date() }]);
  await teach(mathSlotId, "2027-03-01", [["7:1", true]]);

  // Mastery: locked catalogue, switched on; two homework sheets after the lesson — Students 1–2 weak on 07-03.
  await importCatalogue(CATALOGUE, true, PRINCIPAL);
  await setEnablement(String(year._id), "C3", "MATH", true, PRINCIPAL);
  for (const [date, marks] of [["2027-03-04", [1, 0, 5, 5]], ["2027-03-11", [0, 1, 5, 5]]] as const) {
    const p = await createPaper({
      sectionId, subject: "MATH", source: "HW", date,
      items: [{ origin: "TEACHER", textBn: "৭৩৫ ÷ ৭", loCode: "LO-C3-MATH-07-03", questionTypeCode: "QT-WORD" }],
    }, TEACHER);
    await saveResults(p.paperId, marks.map((m, i) => ({ studentId: sids[i], items: [{ itemNo: 1, marks: m }] })), TEACHER);
    await confirmPaper(p.paperId, TEACHER);
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const schema = builder.toSchema();
const run = (source: string, auth: Record<string, unknown> | null, variableValues?: Record<string, unknown>): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: { auth }, variableValues }) as Promise<ExecutionResult>;

describe("§10 item 11 — marking a plan with codes; WEAK split by presence", () => {
  it("the LessonDelivery snapshots the plan's codes at marking", async () => {
    const d = await LessonDelivery.findOne({ sectionId, subject: "MATH" }).lean();
    expect(d!.sessions.map((s) => [s.chapter, s.sessionIndex, s.loCodes])).toEqual([["7", 1, ["LO-C3-MATH-07-03"]]]);
    expect(deliveryView(d!).sessions[0].loCodes).toEqual(["LO-C3-MATH-07-03"]);
  });

  it("a WEAK student absent that day is MISSED; a WEAK student who was there is TAUGHT (taught, not yet learnt)", async () => {
    const Q = `query($s: String!) { masteryOutcomeTrail(studentId: $s, loCode: "LO-C3-MATH-07-03") {
      outcome { state } objectiveLesson { loCode status taughtOn absentOn onLeave } } }`;
    const absent = await run(Q, PRINCIPAL, { s: sids[0] });
    expect(absent.errors).toBeUndefined();
    expect((absent.data as any).masteryOutcomeTrail).toEqual({
      outcome: { state: "WEAK" },
      objectiveLesson: { loCode: "LO-C3-MATH-07-03", status: "MISSED", taughtOn: ["2027-03-01"], absentOn: ["2027-03-01"], onLeave: false },
    });
    const present = await run(Q, PRINCIPAL, { s: sids[1] });
    expect((present.data as any).masteryOutcomeTrail.outcome.state).toBe("WEAK");
    expect((present.data as any).masteryOutcomeTrail.objectiveLesson.status).toBe("TAUGHT");
  });

  it("the student view carries the status per outcome — a code never taught is NOT_TAUGHT", async () => {
    const r = await run(
      `query($s: String!) { masteryStudentDiagnosis(studentId: $s, subject: "MATH") { outcomes { loCode state } objectiveLessons { loCode status } } }`,
      PRINCIPAL,
      { s: sids[0] },
    );
    expect(r.errors).toBeUndefined();
    const d = (r.data as any).masteryStudentDiagnosis;
    expect(Object.fromEntries(d.objectiveLessons.map((x: any) => [x.loCode, x.status]))).toEqual({
      "LO-C3-MATH-07-02": "NOT_TAUGHT",
      "LO-C3-MATH-07-03": "MISSED",
      "LO-C3-MATH-07-04": "NOT_TAUGHT",
    });
  });
});

describe("the শাখা view and the class-note card", () => {
  it("per objective row: taught on + absent that day; not yet taught; catalogue order", async () => {
    const rows = await sectionObjectiveRows(sectionId, "MATH");
    expect(rows.map((r) => [r.code, r.labelBn, r.taught.map((t) => t.dateKey), r.sessions.map((s) => s.key), r.absentCount])).toEqual([
      ["LO-C3-MATH-07-02", "ভাগফল ও ভাগশেষ", [], [], 0],
      ["LO-C3-MATH-07-03", "খাতায় লম্বা ভাগ", ["2027-03-01"], ["7:1"], 1],
      ["LO-C3-MATH-07-04", "ভাগের কথার অঙ্ক", [], ["7:2"], 0],
    ]);
    expect(rows[1].taught[0]).toEqual({ dateKey: "2027-03-01", attendanceTaken: true, absent: [{ studentId: sids[0], name: "Student 1" }] });
  });

  it("lessonObjectiveStatus: the tracker's row rule — view_all passes, a teacher off the routine is refused", async () => {
    const Q = `query($id: String!) { lessonObjectiveStatus(sectionId: $id, subject: "MATH") { code taught { dateKey absent { name } } } }`;
    const ok = await run(Q, PRINCIPAL, { id: sectionId });
    expect(ok.errors).toBeUndefined();
    expect((ok.data as any).lessonObjectiveStatus[1]).toEqual({ code: "LO-C3-MATH-07-03", taught: [{ dateKey: "2027-03-01", absent: [{ name: "Student 1" }] }] });
    const off = await run(Q, { userId: new Types.ObjectId().toString(), role: "TEACHER" }, { id: sectionId });
    expect(off.errors?.[0]?.message).toMatch(/অনুমতি/);
  });

  it("the card exposes each session's codes; `objectives` lists the plan's codes only", async () => {
    const r = await run(
      `query($slot: String!) { lessonPlanForSlot(slotId: $slot, date: "2027-03-08") { applies sessions { key loCodes } objectives { code taught { dateKey } } } }`,
      { userId: TEACHER_ID, role: "TEACHER" },
      { slot: mathSlotId },
    );
    expect(r.errors).toBeUndefined();
    expect((r.data as any).lessonPlanForSlot).toEqual({
      applies: true,
      sessions: [
        { key: "7:1", loCodes: ["LO-C3-MATH-07-03"] },
        { key: "7:2", loCodes: ["LO-C3-MATH-07-04"] },
      ],
      objectives: [
        { code: "LO-C3-MATH-07-03", taught: [{ dateKey: "2027-03-01" }] },
        { code: "LO-C3-MATH-07-04", taught: [] },
      ],
    });
  });

  it("ContentArtifact.loCodes on the content read path ([] for a plan without codes)", async () => {
    const r = await run(`query { contentArtifacts(docType: "session_plan") { subject sessionIndex loCodes } }`, PRINCIPAL);
    expect(r.errors).toBeUndefined();
    const by = Object.fromEntries((r.data as any).contentArtifacts.map((a: any) => [`${a.subject}:${a.sessionIndex}`, a.loCodes]));
    expect(by).toEqual({ "MATH:1": ["LO-C3-MATH-07-03"], "MATH:2": ["LO-C3-MATH-07-04"], "BAN:1": [] });
  });
});

describe("plans without codes and older marks keep working", () => {
  it("a plan without codes marks as before: no snapshot, empty codes on the card and the view", async () => {
    const d = await teach(banSlotId, "2027-03-02", [["1:1", true]]);
    expect(d!.sessions[0].loCodes).toBeUndefined();
    expect(deliveryView(d!).sessions[0].loCodes).toEqual([]);
    const slot = (await RoutineSlot.findById(banSlotId).lean())!;
    const card = await lessonPlanForSlot(slot as never, new Date("2027-03-02"));
    expect(card.sessions.map((s) => s.loCodes)).toEqual([[]]);
    expect(await sectionObjectiveRows(sectionId, "BAN")).toEqual([]);
  });

  it("a mark written before codes existed (no snapshot) reads the current plan's codes (D-#949)", async () => {
    const note = await publishClassNote({ slotId: mathSlotId, date: new Date("2027-03-03"), taughtSummaryBn: "x", actorId: TEACHER_ID, canManage: false });
    await recordDelivery(note, { sessions: [{ key: "7:2", finished: true }] }, TEACHER_ID);
    // Simulate an LP-1 row from before OT-5: strip the snapshot.
    await LessonDelivery.updateOne({ noteId: note._id }, { $unset: { "sessions.0.loCodes": 1 } });
    expect((await LessonDelivery.findOne({ noteId: note._id }).lean())!.sessions[0].loCodes).toBeUndefined();
    const [row] = await studentObjectiveLessons(sids[0], "MATH", ["LO-C3-MATH-07-04"]);
    // No attendance was taken on 3 March, so it is taught with presence unknown — never assumed present.
    expect(row).toMatchObject({ status: "UNKNOWN", taughtOn: ["2027-03-03"] });
    const rows = await sectionObjectiveRows(sectionId, "MATH", { codes: ["LO-C3-MATH-07-04"] });
    expect(rows.map((r) => [r.code, r.taught.map((t) => [t.dateKey, t.attendanceTaken])])).toEqual([["LO-C3-MATH-07-04", [["2027-03-03", false]]]]);
  });
});
