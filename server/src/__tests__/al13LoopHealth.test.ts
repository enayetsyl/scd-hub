/**
 * AL-13 - loop health + January readiness + bank weeks of stock (docs/prd-academic-loop-2027.md journey L, AC-L1..L3, R21).
 *
 *   pure     stockRead (R21 share split, the layout default before data, weeks) + readinessChecks + the period + the rate
 *   AC-L1    health rows per teacher and per section x subject: periods marked, papers confirmed by the deadline, ticks
 *            (a 0 % tick rate over 4 weeks is shown, not judged), class tests with a linked sheet, re-teach before / after
 *   AC-L2/3  the readiness list: tree, switch, weeks of stock (homework share + AS/CT share apart), plans with tags,
 *            rotation, targets, hints - for the PREPARED NEXT year too; under 4 weeks = red and listed
 *   gate     reports:loop_health only (a teacher is refused); reads only (no notification, no write); the 2027 switch is OFF
 *            throughout and the page still reads (it is how the Principal watches the loop before turning it on)
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { graphql, type ExecutionResult } from "graphql";

// Pauses are real here (the global "never paused" stub is switched off) and the owner's staff profile is a stub.
jest.unmock("../modules/academic-pause/services/AcademicPauseService");
const mockProfile = jest.fn<Promise<unknown>, unknown[]>();
jest.mock("../modules/hr/services/staffMatch", () => ({ resolveStaffProfileForUser: (...a: unknown[]) => mockProfile(...a) }));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { User } from "../modules/foundation/models/User";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { LessonProgressConfig } from "../modules/lesson-progress/models/LessonProgressConfig";
import { AcademicPause } from "../modules/academic-pause/models/AcademicPause";
import { Exam } from "../modules/exams/models/Exam";
import { ExamRoutine } from "../modules/exams/models/ExamRoutine";
import { StaffLeaveApplication } from "../modules/hr/models/StaffLeaveApplication";
import { SyllabusTarget } from "../modules/lesson-progress/models/SyllabusTarget";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../modules/trackers/models/HomeworkStudentRecord";
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { AssignmentSchedule } from "../modules/trackers/models/AssignmentSchedule";
import { MasteryPaper } from "../modules/mastery/models/MasteryPaper";
import { MasteryResult } from "../modules/mastery/models/MasteryResult";
import { MasteryAction } from "../modules/mastery/models/MasteryAction";
import { MasteryEvidence } from "../modules/mastery/models/MasteryEvidence";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryEnablement } from "../modules/mastery/models/MasteryEnablement";
import { QuestionUse } from "../modules/assessment/models/QuestionUse";
import { QuestionHint } from "../modules/guardian-help/models/QuestionHint";
import { Notification } from "../modules/notifications/models/Notification";
import { LOW_STOCK_WEEKS, recentWeeks, stockRead } from "../modules/mastery/services/MasteryBankCoverageService";
import { loopHealthPage, loopHealthRows, rate, resetLoopHealthCache, resolvePeriod } from "../modules/mastery/services/LoopHealthService";
import { HINT_GREEN_PCT, loopReadiness, readinessChecks, resetLoopReadinessCache, type ReadinessFacts } from "../modules/mastery/services/LoopReadinessService";
import { isLoop2027On } from "../modules/assessment/services/QuestionUseService";
import { builder } from "../schema";
// The schema needs a Mutation type to build; the catalogue resolvers bring one.
import "../modules/mastery/resolvers/masteryCatalogue";
import "../modules/mastery/resolvers/loopHealth";

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

const qids = (p: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
const base = { sharePct: 50, sinceDay: "2027-01-03", windowWeeks: 4, defaultHwPerWeek: 5, defaultAsctPerWeek: 5 };

describe("stockRead (R21, AC-L3)", () => {
  it("splits the pool by the homework share: 10 gold, 5 given as homework -> homework 0 left, AS/CT 5 left", () => {
    const pool = new Map([["LO-C3-MATH-01-01", qids("q", 10)]]);
    const uses = qids("q", 5).map((qid) => ({ qid, kind: "HW", givenOn: "2027-01-10" }));
    const r = stockRead({ ...base, pool, uses });
    expect(r).toMatchObject({ gold: 10, hwLeft: 0, asctLeft: 5 });
    // 5 distinct homework questions in the 4-week window -> 1.25 a week; nothing left of the homework share = 0 weeks
    expect(r.hwWeeks).toBe(0);
    expect(r.hwDefault).toBe(false);
    // no AS/CT use yet -> the layout default (5 a week): 5 left / 5 = 1 week
    expect(r.asctDefault).toBe(true);
    expect(r.asctWeeks).toBe(1);
  });

  it("shows the two shares apart and uses the average of the last 4 weeks, not older use", () => {
    const pool = new Map([["a", qids("a", 40)]]);
    const uses = [
      ...qids("a", 8).map((qid) => ({ qid, kind: "AS", givenOn: "2027-01-20" })), // in the window
      ...["a9", "a10", "a11"].map((qid) => ({ qid, kind: "AS", givenOn: "2026-06-01" })), // long ago: still seen, not recent
    ];
    const r = stockRead({ ...base, pool, uses });
    expect(r.hwLeft).toBe(20);
    expect(r.asctPerWeek).toBe(2); // 8 questions over 4 weeks
    expect(r.asctLeft).toBe(20 - 11); // cap 20, 11 used in all
    expect(r.asctWeeks).toBe(4.5); // 9 left at 2 a week
    expect(r.hwWeeks).toBe(4); // 20 left at the default 5 a week
  });

  it("a question already seen leaves BOTH shares (the unseen cap), and an empty pool is 0 gold", () => {
    const pool = new Map([["a", qids("a", 4)]]);
    const uses = [{ qid: "a1", kind: "CT", givenOn: "2026-02-01" }, { qid: "a2", kind: "CT", givenOn: "2026-02-01" }, { qid: "a3", kind: "CT", givenOn: "2026-02-01" }];
    const r = stockRead({ ...base, pool, uses });
    expect(r.hwLeft).toBe(1); // cap 2, none used as homework, but only 1 unseen
    expect(r.asctLeft).toBe(0); // cap 2, 3 used
    expect(stockRead({ ...base, pool: new Map(), uses: [] }).gold).toBe(0);
  });
});

const ok: ReadinessFacts = {
  applicable: true, locked: true, switchOn: true, gold: 100, hwWeeks: 6, asctWeeks: 6, usingDefault: false,
  plansTotal: 10, plansTagged: 10, rotationCells: 4, targetsSet: 2, hintCount: 100,
};
const stateOf = (f: ReadinessFacts) => Object.fromEntries(readinessChecks(f).map((c) => [c.key, c.state]));

describe("stockRead - per objective, the pool counts a question once, Nursery / KG, early in the year", () => {
  it("a question that names two objectives counts ONCE in the pool", () => {
    const pool = new Map([["a", ["q1", "q2"]], ["b", ["q2", "q3"]]]);
    const r = stockRead({ ...base, pool, uses: [] });
    expect(r.gold).toBe(3);
    expect(r.hwLeft).toBe(1); // a: [q1,q2] cap 1; b: [q3] cap 0 (q2 sits under its first objective) - not 2
  });
  it("an objective with nothing unseen, or a share with nothing left, is listed; a pool of one gives nothing to the homework share but is not flagged for it", () => {
    const pool = new Map([["a", qids("a", 4)], ["b", ["b1"]], ["c", qids("c", 4)]]);
    const uses = [
      ...qids("a", 4).map((qid) => ({ qid, kind: "AS", givenOn: "2027-01-10" })), // a: all four seen
      ...qids("c", 2).map((qid) => ({ qid, kind: "HW", givenOn: "2027-01-10" })), // c: homework cap 2 used up
    ];
    const r = stockRead({ ...base, pool, uses });
    expect(r.empty).toEqual(expect.arrayContaining([{ code: "a", share: "HW" }, { code: "a", share: "ASCT" }, { code: "c", share: "HW" }]));
    expect(r.empty.some((e) => e.code === "b")).toBe(false); // hwCap 0 is rounding, the AS/CT share still has the one question
    expect(r.empty.some((e) => e.code === "c" && e.share === "ASCT")).toBe(false);
  });
  it("Nursery / KG: the AS / CT share is the class test only and no assignment default is assumed; null weeks is unlimited", () => {
    const pool = new Map([["a", qids("a", 40)]]);
    const uses = qids("a", 6).map((qid) => ({ qid, kind: "AS", givenOn: "2027-01-10" })); // an assignment use does not count for KG
    const r = stockRead({ ...base, pool, uses, defaultAsctPerWeek: 0, asctKinds: ["CT"] });
    expect(r.asctDefault).toBe(true);
    expect(r.asctWeeks).toBeNull();
    expect(stateOf({ ...ok, asctWeeks: null, hwWeeks: null }).STOCK).toBe("OK");
  });
  it("recentWeeks: the 4-week window, but early in the year only the school weeks there have been (10 January = 1 week)", () => {
    expect(recentWeeks("2027-01-10", "2027-01-03")).toBe(1);
    expect(recentWeeks("2027-01-20", "2027-01-03")).toBe(3);
    expect(recentWeeks("2027-03-01", "2027-01-03")).toBe(4);
    expect(recentWeeks("2027-01-03", "2027-01-03")).toBe(1);
    expect(recentWeeks("2027-01-03", "2027-02-01")).toBe(1); // the prepared next year: not started
    expect(recentWeeks("2027-03-01", null)).toBe(4);
  });
  it("the 10-January case: 5 questions used in the first week read 5 a week, not 1.25", () => {
    const pool = new Map([["a", qids("a", 40)]]);
    const uses = qids("a", 5).map((qid) => ({ qid, kind: "HW", givenOn: "2027-01-05" }));
    const r = stockRead({ ...base, pool, uses, sinceDay: "2027-01-03", windowWeeks: recentWeeks("2027-01-10", "2027-01-03") });
    expect(r.hwPerWeek).toBe(5);
  });
});

describe("readinessChecks (AC-L2)", () => {
  it("everything in place is green", () => {
    expect(Object.values(stateOf(ok)).every((s) => s === "OK")).toBe(true);
  });
  it("each missing piece turns its own check red", () => {
    expect(stateOf({ ...ok, locked: false }).TREE).toBe("RED");
    expect(stateOf({ ...ok, switchOn: false }).SWITCH).toBe("RED");
    expect(stateOf({ ...ok, plansTagged: 9 }).PLANS).toBe("RED");
    expect(stateOf({ ...ok, plansTotal: 0, plansTagged: 0 }).PLANS).toBe("RED");
    expect(stateOf({ ...ok, rotationCells: 0 }).ROTATION).toBe("RED");
    expect(stateOf({ ...ok, targetsSet: 1 }).TARGETS).toBe("RED");
    expect(stateOf({ ...ok, hintCount: Math.floor((100 * HINT_GREEN_PCT) / 100) - 1 }).HINTS).toBe("RED");
  });
  it("AC-L3: under 4 weeks on EITHER share is red; no gold at all is red", () => {
    expect(stateOf({ ...ok, hwWeeks: LOW_STOCK_WEEKS - 0.1 }).STOCK).toBe("RED");
    expect(stateOf({ ...ok, asctWeeks: LOW_STOCK_WEEKS - 0.1 }).STOCK).toBe("RED");
    expect(stateOf({ ...ok, hwWeeks: LOW_STOCK_WEEKS, asctWeeks: LOW_STOCK_WEEKS }).STOCK).toBe("OK");
    expect(stateOf({ ...ok, gold: 0, hwWeeks: null, asctWeeks: null, hintCount: 0 }).STOCK).toBe("RED");
  });
  it("the rotation and the term targets do not apply outside Class 1-5; session plans still do (Nursery / KG have them)", () => {
    const s = stateOf({ ...ok, applicable: false, plansTotal: 0, plansTagged: 0, rotationCells: 0, targetsSet: 0 });
    expect([s.ROTATION, s.TARGETS]).toEqual(["NA", "NA"]);
    expect(s.PLANS).toBe("RED");
    expect(stateOf({ ...ok, applicable: false }).PLANS).toBe("OK");
  });
  it("AC-L3 per objective: any objective with an empty share is red even when the pooled weeks are fine", () => {
    const e = [{ code: "LO-C3-MATH-01-01", labelBn: "যোগ", share: "HW" as const }];
    const c = readinessChecks({ ...ok, emptyObjectives: e, hwEmptyCount: 1 }).find((x) => x.key === "STOCK")!;
    expect(c.state).toBe("RED");
    expect(c.emptyObjectives).toEqual(e);
    expect(c.hwEmptyCount).toBe(1);
  });
});

describe("period + rate", () => {
  it("rate: nothing to count is null, never 0 %", () => {
    expect(rate(0, 0).pct).toBeNull();
    expect(rate(1, 3).pct).toBe(33);
    expect(rate(0, 4).pct).toBe(0);
  });
  it("defaults to the last 4 weeks, never ends after today, and never inverts", () => {
    const now = new Date("2027-02-10T06:00:00+06:00");
    expect(resolvePeriod(null, null, now)).toEqual({ from: "2027-01-14", to: "2027-02-10" });
    expect(resolvePeriod("2027-01-01", "2027-03-01", now).to).toBe("2027-02-10");
    expect(resolvePeriod("2027-03-01", "2027-02-01", now)).toEqual({ from: "2027-02-01", to: "2027-02-01" });
    expect(resolvePeriod("garbage", "also", now)).toEqual({ from: "2027-01-14", to: "2027-02-10" });
  });
});

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

let mongo: MongoMemoryServer;
const T1 = new Types.ObjectId().toString();
const T2 = new Types.ObjectId().toString();
const OFFICE = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const };
let year2027 = new Types.ObjectId();
let year2028 = new Types.ObjectId();
let class3 = new Types.ObjectId();
let boys = "";
let girls = "";
let slotSun: Types.ObjectId;
const NOW = new Date("2027-01-20T10:00:00+06:00");
const FROM = "2027-01-03";
const TO = "2027-01-07"; // Sun - Thu
let seq = 0;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await LessonProgressConfig.create({ classNoteQuestionOn: true });
  const [y27, y28] = await AcademicYear.create([
    { label: "2027", startDate: new Date(2027, 0, 1), endDate: new Date(2027, 11, 31), current: true },
    { label: "2028", startDate: new Date(2028, 0, 1), endDate: new Date(2028, 11, 31) },
  ]);
  year2027 = y27!._id as Types.ObjectId;
  year2028 = y28!._id as Types.ObjectId;
  const [c3] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year2027 }]);
  class3 = c3!._id as Types.ObjectId;
  const [b, g] = await Section.create([
    { classId: class3, code: "B", nameBn: "বালক" },
    { classId: class3, code: "G", nameBn: "বালিকা" },
  ]);
  boys = String(b!._id);
  girls = String(g!._id);
  await User.create([
    { _id: T1, role: "TEACHER", name: "Teacher One", phone: "01700000021", passwordHash: "x" },
    { _id: T2, role: "TEACHER", name: "Teacher Two", phone: "01700000022", passwordHash: "x" },
  ]);
  // Class 3 MATH has session plans: 2 tagged, and the page only expects marking where plans exist.
  for (const [i, codes] of [[1, ["LO-C3-MATH-01-01"]], [2, ["LO-C3-MATH-01-02"]]] as const) {
    await ContentArtifact.create([
      {
        docType: "session_plan", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 1, title: "ch" },
        curationTag: "KEEP_AS_IS", reviewStatus: "reviewed", current: true, importedBy: new Types.ObjectId(),
        tags: { lo_codes: codes },
        envelopeJson: { payload: { session_plan: { session_form: "multi_period", period_index: i, period_of: 2, session_title: `s${i}` } } },
      },
    ]);
  }
  // Boys MATH: Sunday + Monday periods (T1); Girls MATH: Sunday (T2).
  const mk = (sectionId: string, teacher: string, day: string, period: number) =>
    RoutineSlot.create([
      {
        groupType: "section", groupId: new Types.ObjectId(sectionId), classId: class3, dayOfWeek: day, periodNumber: period, subject: "MATH", track: "general",
        teacherId: new Types.ObjectId(teacher), effectiveFrom: new Date("2027-01-01"), createdBy: new Types.ObjectId(),
      },
    ]);
  const [sun] = await mk(boys, T1, "SUN", 1);
  await mk(boys, T1, "MON", 1);
  await mk(girls, T2, "SUN", 1);
  slotSun = sun!._id as Types.ObjectId;
  // The girls' Sunday period has a delivery with only a reason (no session taught): NOT a session marked.
  await LessonDelivery.collection.insertOne({
    noteId: new Types.ObjectId(), slotId: (await RoutineSlot.findOne({ groupId: new Types.ObjectId(girls) }))!._id, sectionId: new Types.ObjectId(girls), classLevel: 3,
    subject: "MATH", dateKey: "2027-01-03", teacherId: new Types.ObjectId(T2), sessions: [], noneReason: "OTHER", rosterStudentIds: [], updatedBy: new Types.ObjectId(),
    createdAt: new Date(), updatedAt: new Date(),
  });
  // Only the Sunday period of the boys was marked.
  await LessonDelivery.collection.insertOne({
    noteId: new Types.ObjectId(), slotId: slotSun, sectionId: new Types.ObjectId(boys), classLevel: 3, subject: "MATH", dateKey: "2027-01-03",
    teacherId: new Types.ObjectId(T1), sessions: [{ chapter: "1", sessionIndex: 1, sessionOf: 2, titleBn: "x", finished: true }], rosterStudentIds: [], updatedBy: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date(),
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(() => {
  resetLoopHealthCache();
  resetLoopReadinessCache();
  mockProfile.mockReset();
  mockProfile.mockResolvedValue(null);
});

/** A homework paper (issued item, due `dueKey`) for the boys, owned by T1. */
async function hwPaper(dueKey: string, confirmedAt: Date | null): Promise<Types.ObjectId> {
  seq += 1;
  const item = await HomeworkItem.create({
    hwId: `HW-C3-MATH-${String(seq).padStart(4, "0")}`, academicYearId: year2027, classId: class3, classLevel: 3, sectionId: new Types.ObjectId(boys),
    subject: "MATH", dateGiven: new Date(`${dueKey}T00:00:00`), topTags: ["PRACTICE"], qCount: 1, status: "issued", declaredBy: new Types.ObjectId(T1),
  });
  await HomeworkStudentRecord.collection.insertOne({
    hwItemId: item._id, hwId: item.hwId, studentId: new Types.ObjectId(), sectionId: new Types.ObjectId(boys), classId: class3, state: "GIVEN",
    stateDates: [], dueDate: new Date(`${dueKey}T00:00:00`), chaseCount: 0, topupFlag: false, topupQids: [], issuedBy: new Types.ObjectId(T1),
  });
  const paper = await MasteryPaper.create({
    paperId: `MP-HW-${seq}`, source: "HW", sectionId: new Types.ObjectId(boys), classId: class3, academicYearId: year2027, classToken: "C3", subject: "MATH",
    date: new Date(`${dueKey}T00:00:00Z`), links: { hwItemId: item._id }, trackerLinked: true, items: [{ itemNo: 1, origin: "BANK", marks: 2 }],
    entryState: confirmedAt ? "CONFIRMED" : "OPEN", ...(confirmedAt ? { confirmedAt } : {}),
  });
  return paper._id as Types.ObjectId;
}

describe("AC-L1 - loop-health rows", () => {
  let tickedPaper: Types.ObjectId;
  beforeAll(async () => {
    // Confirmed ON its deadline day (hwMarkDeadlineDays 0 = the day it comes in), with a lost mark -> a tick.
    tickedPaper = await hwPaper("2027-01-03", new Date("2027-01-03T20:00:00+06:00"));
    await MasteryResult.collection.insertOne({
      paperId: tickedPaper, studentId: new Types.ObjectId(), items: [{ itemNo: 1, marks: 0, tags: [] }], workRework: false, workTags: [], rubric: [], createdAt: new Date(), updatedAt: new Date(),
    });
    // Still OPEN, its deadline (4 Jan) is long past by NOW -> counts as not confirmed by the deadline.
    await hwPaper("2027-01-04", null);
    // Two class tests in the period: one with a linked CT sheet, one without.
    const mkTest = async (day: string, n: number): Promise<Types.ObjectId> => {
      const r = await ClassTest.collection.insertOne({
        ctId: `CT-C3-MATH-000${n}`, academicYearId: year2027, classLevel: 3, classId: class3, sectionId: new Types.ObjectId(boys), subject: "MATH", testNumber: n,
        examDate: new Date(`${day}T00:00:00Z`), totalMarks: 20, passMark: 8, source: "UPLOADED_PAPER", status: "PRINTED", deadlineDays: 2,
        teacherId: new Types.ObjectId(T1), requestedBy: new Types.ObjectId(T1), requestedAt: new Date(),
      });
      return r.insertedId;
    };
    const linkedTest = await mkTest("2027-01-04", 1);
    await mkTest("2027-01-05", 2);
    await MasteryPaper.create({
      paperId: "MP-CT-1", source: "CT", sectionId: new Types.ObjectId(boys), classId: class3, academicYearId: year2027, classToken: "C3", subject: "MATH",
      date: new Date("2027-01-04T00:00:00Z"), links: { classTestId: linkedTest }, items: [{ itemNo: 1, origin: "BANK", marks: 2 }],
    });
    // A re-teach opened on the 4th, closed on the 6th: the section's weak share went 60 % -> 20 %.
    await MasteryAction.collection.insertOne({
      scope: "SECTION", sectionId: new Types.ObjectId(boys), classId: class3, academicYearId: year2027, classToken: "C3", subject: "MATH",
      loCode: "LO-C3-MATH-01-01", kind: "RETEACH", status: "CLOSED",
      trigger: { at: new Date("2027-01-04T10:00:00Z"), weakPct: 60, weak: 6, verdicts: 10, assessments: 2, weakStudentIds: [] },
      closedAt: new Date("2027-01-06T10:00:00Z"), before: { weakPct: 60, meanPct: 40 }, after: { weakPct: 20, meanPct: 70 }, attendance: [], events: [],
      createdAt: new Date("2027-01-04T10:00:00Z"), updatedAt: new Date("2027-01-06T10:00:00Z"),
    });
  });

  it("per section x subject: periods, papers by the deadline, ticks, class tests with a sheet, re-teach before/after", async () => {
    expect(await isLoop2027On()).toBe(false); // the page does not need the switch
    const rows = await loopHealthRows("SECTION", FROM, TO, NOW);
    const b = rows.find((r) => r.sectionId === boys && r.subject === "MATH")!;
    expect(b.periods).toEqual({ done: 1, total: 2, pct: 50 }); // Sunday marked, Monday not
    expect(b.papers).toEqual({ done: 1, total: 2, pct: 50 });
    expect(b.ticks).toEqual({ done: 1, total: 1, pct: 100 });
    expect(b.zeroNotJudged).toBe(false);
    expect(b.classTests).toEqual({ done: 1, total: 2, pct: 50 });
    expect(b).toMatchObject({ reteachOpened: 1, reteachClosed: 1, reteachBeforePct: 60, reteachAfterPct: 20 });
    const g = rows.find((r) => r.sectionId === girls && r.subject === "MATH")!;
    expect(g.periods).toEqual({ done: 0, total: 1, pct: 0 });
    expect(g.papers.pct).toBeNull(); // nothing to count is "no data", never 0 %
  });

  it("per teacher: the same numbers on the teacher who owns them, with the name", async () => {
    const rows = await loopHealthRows("TEACHER", FROM, TO, NOW);
    const t1 = rows.find((r) => r.teacherId === T1)!;
    expect(t1.teacherName).toBe("Teacher One");
    expect(t1.periods).toEqual({ done: 1, total: 2, pct: 50 });
    expect(t1.papers.pct).toBe(50);
    expect(t1.classTests.pct).toBe(50);
    expect(t1).toMatchObject({ reteachOpened: 1, reteachClosed: 1 });
    const t2 = rows.find((r) => r.teacherId === T2)!;
    expect(t2.periods).toEqual({ done: 0, total: 1, pct: 0 });
    expect(t2.reteachOpened).toBe(0);
  });

  it("WEAK -> IMPROVING moves: a child weak before the period and clean inside it counts for the section and its teacher", async () => {
    const kid = new Types.ObjectId();
    const ev = (paperId: Types.ObjectId, itemNo: number, earned: number, at: string, week: string) => ({
      studentId: kid, sectionId: new Types.ObjectId(boys), academicYearId: year2027, classToken: "C3", subject: "MATH", loCode: "LO-C3-MATH-01-01",
      chapterNumber: 1, source: "HW", paperId, itemNo, qid: `EV${itemNo}${week}`, earned, available: 2, rework: false, workRework: false, tags: [], signal: "NONE",
      routed: false, at: new Date(at), week, createdAt: new Date(),
    });
    const p1 = new Types.ObjectId();
    const p2 = new Types.ObjectId();
    await MasteryEvidence.collection.insertMany([
      ev(p1, 1, 0, "2026-12-20T06:00:00Z", "2026-W51"), ev(p1, 2, 0, "2026-12-20T06:00:00Z", "2026-W51"), // before: 0 of 4 -> WEAK
      ev(p2, 1, 2, "2027-01-05T06:00:00Z", "2027-W01"), ev(p2, 2, 2, "2027-01-05T06:00:00Z", "2027-W01"), // inside: clean
    ]);
    const rows = await loopHealthRows("SECTION", FROM, TO, NOW);
    const b = rows.find((r) => r.sectionId === boys && r.subject === "MATH")!;
    expect(b.weakToImproving + b.weakToMastered).toBe(1);
    const t1 = (await loopHealthRows("TEACHER", FROM, TO, NOW)).find((r) => r.teacherId === T1)!;
    expect(t1.weakToImproving + t1.weakToMastered).toBe(1);
    await MasteryEvidence.deleteMany({});
  });

  it("a period still short of its deadline is not counted, and an unissued paper has no deadline", async () => {
    // Evaluated on the 3rd itself: nothing is due yet except what was confirmed on time.
    const rows = await loopHealthRows("SECTION", FROM, TO, new Date("2027-01-03T12:00:00+06:00"));
    const b = rows.find((r) => r.sectionId === boys)!;
    expect(b.papers).toEqual({ done: 1, total: 1, pct: 100 });
  });

  it("a 0 % tick rate over 4 weeks is shown, not judged (and not flagged over a short period)", async () => {
    await MasteryResult.deleteMany({});
    const short = (await loopHealthRows("SECTION", FROM, TO, NOW)).find((r) => r.sectionId === boys)!;
    expect(short.ticks).toEqual({ done: 0, total: 1, pct: 0 });
    expect(short.zeroNotJudged).toBe(false);
    const long = (await loopHealthRows("SECTION", "2026-12-10", TO, NOW)).find((r) => r.sectionId === boys)!;
    expect(long.ticks.pct).toBe(0);
    expect(long.zeroNotJudged).toBe(true);
  });

  it("Nursery / KG sections are read too (class 1-5 helper unchanged)", async () => {
    const [nur] = await Class.create([{ level: -1, nameBn: "নার্সারি", academicYearId: year2027 }]);
    const [nsec] = await Section.create([{ classId: nur!._id, code: "N", nameBn: "নার্সারি" }]);
    await ClassTest.collection.insertOne({
      ctId: "CT-NUR-MATH-0001", academicYearId: year2027, classLevel: -1, classId: nur!._id, sectionId: nsec!._id, subject: "MATH", testNumber: 1,
      examDate: new Date("2027-01-04T00:00:00Z"), totalMarks: 10, passMark: 4, source: "UPLOADED_PAPER", status: "PRINTED", deadlineDays: 2,
      teacherId: new Types.ObjectId(T2), requestedBy: new Types.ObjectId(T2), requestedAt: new Date(),
    });
    const rows = await loopHealthRows("SECTION", FROM, TO, NOW);
    const r = rows.find((x) => x.sectionId === String(nsec!._id))!;
    expect(r.classTests).toEqual({ done: 0, total: 1, pct: 0 });
    await ClassTest.collection.deleteOne({ ctId: "CT-NUR-MATH-0001" });
    await Section.deleteOne({ _id: nsec!._id });
    await Class.deleteOne({ _id: nur!._id });
  });

  it("a delivery with only a reason is not a session marked; the session question off = no data, never 0 %", async () => {
    const g = (await loopHealthRows("SECTION", FROM, TO, NOW)).find((r) => r.sectionId === girls && r.subject === "MATH")!;
    expect(g.periods).toEqual({ done: 0, total: 1, pct: 0 }); // the reason-only row did not count
    await LessonProgressConfig.updateMany({}, { $set: { classNoteQuestionOn: false } });
    resetLoopHealthCache();
    const off = (await loopHealthRows("SECTION", FROM, TO, NOW)).find((r) => r.sectionId === boys && r.subject === "MATH")!;
    expect(off.periods).toEqual({ done: 0, total: 0, pct: null });
    expect(off.papers.total).toBe(2); // the other measures are unaffected
    await LessonProgressConfig.updateMany({}, { $set: { classNoteQuestionOn: true } });
  });

  it("periods expected are TEACHING days: not the class's exam day, not a paused day, not a day the teacher was on leave uncovered", async () => {
    const boysPeriods = async (from: string, to: string, now: Date) =>
      (await loopHealthRows("SECTION", from, to, now)).find((r) => r.sectionId === boys && r.subject === "MATH")!.periods;
    // exam day: Sunday 10 Jan is an exam day of Class 3 -> only Monday 11 counts
    const [half] = await Exam.create([{ academicYearId: year2027, term: "HALF_YEARLY", name: "অর্ধবার্ষিক", createdBy: new Types.ObjectId() }]);
    await ExamRoutine.create([{ examId: half!._id, updatedBy: new Types.ObjectId(), slots: [{ classId: class3, dateKey: "2027-01-10", subject: "MATH", kind: "WRITTEN" }] }]);
    expect(await boysPeriods("2027-01-10", "2027-01-14", NOW)).toEqual({ done: 0, total: 1, pct: 0 });
    // pause: Monday 18 Jan is paused -> Sunday 17 only
    await AcademicPause.create([{ fromKey: "2027-01-18", toKey: "2027-01-20", label: "বিরতি", pauses: ["HOMEWORK_REQUIRED"] }]);
    resetLoopHealthCache();
    expect(await boysPeriods("2027-01-17", "2027-01-21", new Date("2027-01-22T10:00:00+06:00"))).toEqual({ done: 0, total: 1, pct: 0 });
    // leave: T1 is on approved leave on Monday 25 Jan and nobody covered -> Sunday 24 only
    const profile = new Types.ObjectId();
    mockProfile.mockImplementation(async (uid) => (String(uid) === T1 ? { _id: profile } : null));
    await StaffLeaveApplication.collection.insertOne({ staffProfileId: profile, status: "approved", fromKey: "2027-01-25", toKey: "2027-01-25", leaveType: "casual", dayPart: "full", days: 1, reason: "x", appliedBy: new Types.ObjectId() });
    resetLoopHealthCache();
    expect(await boysPeriods("2027-01-24", "2027-01-28", new Date("2027-01-29T10:00:00+06:00"))).toEqual({ done: 0, total: 1, pct: 0 });
    // ... but a covered period (someone marked it) still counts
    const monSlot = (await RoutineSlot.findOne({ groupId: new Types.ObjectId(boys), dayOfWeek: "MON" }))!._id;
    await LessonDelivery.collection.insertOne({
      noteId: new Types.ObjectId(), slotId: monSlot, sectionId: new Types.ObjectId(boys), classLevel: 3, subject: "MATH", dateKey: "2027-01-25",
      teacherId: new Types.ObjectId(T2), sessions: [{ chapter: "1", sessionIndex: 1, sessionOf: 2, titleBn: "x", finished: true }], rosterStudentIds: [], updatedBy: new Types.ObjectId(),
      createdAt: new Date(), updatedAt: new Date(),
    });
    resetLoopHealthCache();
    expect(await boysPeriods("2027-01-24", "2027-01-28", new Date("2027-01-29T10:00:00+06:00"))).toEqual({ done: 1, total: 2, pct: 50 });
  });

  it("AL-9 deadline: an owner on leave who confirms on the first day back is on time; a paper due inside a pause is not late until the pause ends", async () => {
    const profile = new Types.ObjectId();
    mockProfile.mockImplementation(async (uid) => (String(uid) === T1 ? { _id: profile } : null));
    const papersOf = async (from: string, to: string, now: Date) =>
      (await loopHealthRows("SECTION", from, to, now)).find((r) => r.sectionId === boys && r.subject === "MATH")!.papers;
    // due Mon 11 Jan; T1 on leave 11-12 Jan; confirmed Wed 13 Jan = the first day back -> on time
    await hwPaper("2027-01-11", new Date("2027-01-13T10:00:00+06:00"));
    await StaffLeaveApplication.collection.insertOne({ staffProfileId: profile, status: "approved", fromKey: "2027-01-11", toKey: "2027-01-12", leaveType: "casual", dayPart: "full", days: 2, reason: "x", appliedBy: new Types.ObjectId() });
    expect(await papersOf("2027-01-10", "2027-01-14", new Date("2027-01-20T10:00:00+06:00"))).toEqual({ done: 1, total: 1, pct: 100 });
    // due Mon 18 Jan (HOMEWORK_REQUIRED pause 18-20 Jan), still OPEN: on the 19th it is NOT late (not counted) ...
    await hwPaper("2027-01-18", null);
    resetLoopHealthCache();
    expect(await papersOf("2027-01-17", "2027-01-21", new Date("2027-01-19T12:00:00+06:00"))).toEqual({ done: 0, total: 0, pct: null });
    // ... and once the pause has ended and its first open day (Thu 21) is behind, it is late
    resetLoopHealthCache();
    expect(await papersOf("2027-01-17", "2027-01-21", new Date("2027-01-22T12:00:00+06:00"))).toEqual({ done: 0, total: 1, pct: 0 });
  });

  it("the period never starts before the year and is memoised (a second read does not recompute)", async () => {
    const page = await loopHealthPage({ kind: "SECTION", from: "2026-06-01", to: TO, page: 1, pageSize: 5 }, NOW);
    expect(page.from).toBe("2027-01-01");
    const spy = jest.spyOn(RoutineSlot, "find");
    await loopHealthRows("SECTION", "2027-01-01", TO, NOW);
    const first = spy.mock.calls.length;
    await loopHealthRows("TEACHER", "2027-01-01", TO, NOW); // the other view rides the same pass
    expect(spy.mock.calls.length).toBe(first);
    spy.mockRestore();
  });

  it("is paged and period-stamped, and reading it writes nothing and notifies no one", async () => {
    const before = { n: await Notification.countDocuments({}), p: await MasteryPaper.countDocuments({}), a: await MasteryAction.countDocuments({}) };
    const page = await loopHealthPage({ kind: "SECTION", from: FROM, to: TO, page: 1, pageSize: 1 }, NOW);
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(2);
    expect(page).toMatchObject({ from: FROM, to: TO, page: 1, pageSize: 1 });
    expect({ n: await Notification.countDocuments({}), p: await MasteryPaper.countDocuments({}), a: await MasteryAction.countDocuments({}) }).toEqual(before);
  });
});

describe("AC-L2 / AC-L3 - the readiness list", () => {
  const CODE = "LO-C3-MATH-01-01";
  beforeAll(async () => {
    await MasteryOutcome.create([{ code: CODE, classToken: "C3", subject: "MATH", chapterNumber: 1, labelBn: "যোগ", assess: "QUESTION", order: 1, status: "LOCKED" }]);
    // 8 gold questions on the objective; 2 of them carry a hint ladder.
    for (let i = 1; i <= 8; i++) {
      await ContentArtifact.create([
        {
          docType: "question", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: 1, title: "ch" }, curationTag: "KEEP_AS_IS", reviewStatus: "gold",
          current: true, importedBy: new Types.ObjectId(), envelopeJson: { tags: { topic_tag: CODE, lo_codes: [CODE] }, payload: { qid: `RQ${i}`, topic_tag: CODE } },
        },
      ]);
    }
    await QuestionHint.collection.insertMany(
      ["RQ1", "RQ2"].map((qid) => ({ qid, classToken: "C3", subject: "MATH", steps: [{ n: 1, textBn: "ক" }], language: "bn", source: "agent", version: 1, updatedBy: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date() })),
    );
    // The boys were given 4 of them as homework in the last 4 weeks -> the homework share (cap 4) is used up.
    await QuestionUse.collection.insertMany(
      ["RQ1", "RQ2", "RQ3", "RQ4"].map((qid) => ({
        qid, kind: "HW", sourceType: "MASTERY_PAPER", sourceId: new Types.ObjectId(), itemNo: 1, academicYearId: year2027, sectionId: new Types.ObjectId(boys), classToken: "C3",
        subject: "MATH", studentIds: [], givenOn: "2027-01-12", withdrawnAt: null, useKey: `k|${qid}`, createdAt: new Date(), updatedAt: new Date(),
      })),
    );
    await MasteryEnablement.create([{ academicYearId: year2027, classToken: "C3", subject: "MATH", enabled: true }]);
    await SyllabusTarget.create([{ academicYearId: year2027, classToken: "C3", subject: "MATH", term: "HALF_YEARLY", targetDate: "2027-06-30", endChapter: "1", endSessionIndex: 2, setBy: new Types.ObjectId(), setAt: new Date() }]);
    await AssignmentSchedule.create([
      { academicYearId: year2027, termStartDate: new Date(2027, 0, 1), entries: [{ cycleWeek: 1, classId: class3, classLevel: 3, sectionId: new Types.ObjectId(boys), subject: "MATH", teacherId: new Types.ObjectId(T1) }] },
    ]);
  });

  it("current year: the pair reads each check from its own source, the homework share is short and the pair is listed low", async () => {
    const v = await loopReadiness({}, NOW);
    expect(v).toMatchObject({ yearLabel: "2027", yearCurrent: true, switchOn: false, totalPairs: 1, readyPairs: 0 });
    const row = v.rows.rows[0]!;
    const s = Object.fromEntries(row.checks.map((c) => [c.key, c]));
    expect(s.TREE!.state).toBe("OK");
    expect(s.SWITCH!.state).toBe("OK");
    expect(s.PLANS).toMatchObject({ state: "OK", have: 2, need: 2 });
    expect(s.ROTATION).toMatchObject({ state: "OK", have: 1 });
    expect(s.TARGETS).toMatchObject({ state: "RED", have: 1, need: 2 }); // annual is missing
    expect(s.HINTS).toMatchObject({ state: "RED", have: 2, need: 8 });
    // homework: cap 4, 4 used -> nothing left; AS/CT: cap 4, unseen 4 -> 4 left at the layout default 5 a week = 0.8
    expect(s.STOCK).toMatchObject({ state: "RED", have: 8, hwWeeks: 0, asctWeeks: 0.8 });
    expect(v.lowStock).toEqual([{ classToken: "C3", subject: "MATH", hwWeeks: 0, asctWeeks: 0.8, gold: 8 }]);
  });

  it("the prepared NEXT year reads its own year: no switch, no rotation, no targets, no sections yet", async () => {
    const v = await loopReadiness({ academicYearId: String(year2028) }, NOW);
    expect(v).toMatchObject({ yearLabel: "2028", yearCurrent: false });
    const s = Object.fromEntries(v.rows.rows[0]!.checks.map((c) => [c.key, c.state]));
    expect(s).toMatchObject({ TREE: "OK", SWITCH: "RED", PLANS: "OK", ROTATION: "RED", TARGETS: "RED" });
  });

  it("onlyRed + paging, and a year that is neither the current nor the prepared one is refused", async () => {
    const v = await loopReadiness({ onlyRed: true, page: 1, pageSize: 1 }, NOW);
    expect(v.rows.rows).toHaveLength(1);
    await expect(loopReadiness({ academicYearId: String(new Types.ObjectId()) }, NOW)).rejects.toThrow(/প্রস্তুতির/);
  });
});

describe("gate - reports:loop_health", () => {
  const schema = builder.toSchema();
  const Q = `query { loopHealthPage(kind: "SECTION") { from to page { total rows { key subject periods { done total pct } } } } loopReadiness { totalPairs readyPairs lowStock { classToken } rows { rows { classToken checks { key state } } } } loopHealthYears { label current } }`;
  const run = (auth: { userId: string; role: string }): Promise<ExecutionResult> =>
    graphql({ schema, source: Q, contextValue: { auth } }) as Promise<ExecutionResult>;

  it("a teacher is refused every one of the three reads", async () => {
    const r = await run({ userId: T1, role: "TEACHER" });
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(r.data?.loopHealthYears ?? null).toBeNull();
  });
  it("the Office (switch on by default) reads them all", async () => {
    const r = await run(OFFICE);
    expect(r.errors).toBeUndefined();
    expect(r.data?.loopHealthYears).toEqual([{ label: "2027", current: true }, { label: "2028", current: false }]);
    expect((r.data?.loopReadiness as { totalPairs: number }).totalPairs).toBe(1);
  });
});
