/**
 * AL-11 — term target dates (docs/prd-academic-loop-2027.md §3.3, journey A, ACs AC-A1..A6; D-#1675, D-#1655).
 *
 *  - pace maths (pure): expected = start + (end − start) × (teaching days elapsed ÷ total); whole sessions; AC-A1
 *  - teaching days: holidays, the class's exam days and an assignment pause are out; a winter-timings week counts (AC-A5)
 *  - annual start: the day after the class's last half-yearly exam day, else after the half-yearly target date (AC-A6)
 *  - the row read: "N behind" against a target, ON_TRACK, NO_TARGET for a class × subject without one (AC-A3)
 *  - LPBEHIND: the Principal, 2+ weeks behind, one notice per week × শাখা × subject × recipient; none with no target (AC-A2/A3)
 *  - set_targets is the only gate on saving (AC-A4); the 2027 release switch is OFF throughout (it runs regardless, §3.6)
 * In-memory MongoDB, real services. The pause stub of jest's global setup is switched off here (real windows).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { graphql, type ExecutionResult } from "graphql";

jest.unmock("../modules/academic-pause/services/AcademicPauseService");

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { User } from "../modules/foundation/models/User";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { HolidayException } from "../modules/routine/models/HolidayException";
import { ScheduleWindow } from "../modules/routine/models/ScheduleWindow";
import { AcademicPause } from "../modules/academic-pause/models/AcademicPause";
import { Exam } from "../modules/exams/models/Exam";
import { ExamRoutine } from "../modules/exams/models/ExamRoutine";
import { LessonProgressConfig } from "../modules/lesson-progress/models/LessonProgressConfig";
import { SyllabusTarget } from "../modules/lesson-progress/models/SyllabusTarget";
import { Notification } from "../modules/notifications/models/Notification";
import { Audit } from "../modules/platform/models/Audit";
import { publishClassNote } from "../modules/routine/services/RoutineTriggerService";
import { recordDelivery } from "../modules/lesson-progress/services/LessonDeliveryService";
import { progressOverview } from "../modules/lesson-progress/services/LessonProgressService";
import {
  annualStartKey,
  loadPaceEnv,
  paceRead,
  resolveTermRead,
  runLessonBehind,
  setSyllabusTargets,
  syllabusTargetBoard,
  targetYears,
  teachingDays,
} from "../modules/lesson-progress/services/SyllabusTargetService";
import { savePolicy } from "../modules/mastery/services/MasteryCatalogueService";
import { isLoop2027On } from "../modules/assessment/services/QuestionUseService";
import { builder } from "../schema";
import "../modules/lesson-progress/resolvers/syllabusTargets";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
const T1 = new Types.ObjectId().toString();
const T2 = new Types.ObjectId().toString();
const PRINCIPAL_ID = new Types.ObjectId().toString();
const OFFICE = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const };
let yearId = new Types.ObjectId();
let class3 = new Types.ObjectId();
let class4 = new Types.ObjectId();
let boys = "";
let girls = "";
let c4sec = "";
/** Tue 26 Jan 2027: 8 of the term's 16 teaching days are done (see the calendar below). */
const TODAY = new Date(2027, 0, 26, 10, 0);

const SESSIONS = ["1:1", "1:2", "2:1", "2:2", "3:1", "3:2", "4:1", "4:2", "5:1", "5:2", "6:1", "6:2"];
async function plan(level: number, subject: string, keys: string[]): Promise<void> {
  for (const k of keys) {
    const [ch, i] = k.split(":").map(Number);
    await ContentArtifact.create([
      {
        docType: "session_plan", subject, classLevel: level, address: { anchorWord: "অধ্যায়", number: ch, title: `ch ${ch}` },
        curationTag: "KEEP_AS_IS", reviewStatus: "reviewed", current: true, importedBy: new Types.ObjectId(),
        envelopeJson: { payload: { session_plan: { session_form: "multi_period", period_index: i, period_of: 2, session_title: k } } },
      },
    ]);
  }
}
async function slot(sectionId: string, classId: Types.ObjectId, subject: string, teacher: string, day: string, period = 1) {
  const [s] = await RoutineSlot.create([
    {
      groupType: "section", groupId: new Types.ObjectId(sectionId), classId, dayOfWeek: day, periodNumber: period, subject, track: "general",
      teacherId: new Types.ObjectId(teacher), effectiveFrom: new Date("2027-01-01"), createdBy: new Types.ObjectId(),
    },
  ]);
  return s;
}
async function teach(slotId: Types.ObjectId, teacher: string, date: string, sessions: Array<[string, boolean]>): Promise<void> {
  const note = await publishClassNote({ slotId: String(slotId), date: new Date(date), taughtSummaryBn: "x", actorId: teacher, canManage: false });
  await recordDelivery(note, { sessions: sessions.map(([key, finished]) => ({ key, finished })) }, teacher);
}
const setHalf = (level: number, subject: string, date: string, key: string) =>
  setSyllabusTargets([{ classLevel: level, subject, term: "HALF_YEARLY", targetDate: date, endChapter: key.split(":")[0], endSessionIndex: Number(key.split(":")[1]) }], OFFICE.userId);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await LessonProgressConfig.create({ classNoteQuestionOn: true });
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date(2027, 0, 1), endDate: new Date(2027, 11, 31), current: true }]);
  yearId = year!._id as Types.ObjectId;
  const [c3, c4] = await Class.create([
    { level: 3, nameBn: "তৃতীয়", academicYearId: yearId },
    { level: 4, nameBn: "চতুর্থ", academicYearId: yearId },
  ]);
  class3 = c3!._id as Types.ObjectId;
  class4 = c4!._id as Types.ObjectId;
  const [b, g] = await Section.create([
    { classId: class3, code: "B", nameBn: "বালক" },
    { classId: class3, code: "G", nameBn: "বালিকা" },
  ]);
  const [f] = await Section.create([{ classId: class4, code: "A", nameBn: "সম্মিলিত" }]);
  boys = String(b!._id);
  girls = String(g!._id);
  c4sec = String(f!._id);
  for (const sec of [b!, g!, f!]) await Student.create([{ schoolId: `AL11-${sec.code}-${sec._id}`, name: "s", rollNumber: "1", classId: sec.classId, sectionId: sec._id, active: true }]);
  await plan(3, "MATH", SESSIONS);
  await plan(4, "MATH", SESSIONS);
  // two periods a week (Sun + Tue) in every শাখা
  const slots: Record<string, Types.ObjectId[]> = {};
  for (const [id, cls, teacher] of [[boys, class3, T1], [girls, class3, T2], [c4sec, class4, T2]] as const) {
    slots[id] = [(await slot(id, cls, "MATH", teacher, "SUN"))!._id as Types.ObjectId, (await slot(id, cls, "MATH", teacher, "TUE"))!._id as Types.ObjectId];
  }
  // Boys finish 3 sessions, Girls 1, Class 4 one — all taught before today.
  await teach(slots[boys]![0]!, T1, "2027-01-03", [["1:1", true], ["1:2", true]]);
  await teach(slots[boys]![1]!, T1, "2027-01-05", [["2:1", true]]);
  await teach(slots[girls]![0]!, T2, "2027-01-03", [["1:1", true]]);
  await teach(slots[c4sec]![0]!, T2, "2027-01-03", [["1:1", true]]);

  // The calendar of 3 Jan – 4 Feb 2027 (Sun–Thu school; 25 school days): 3-day holiday 10–12 Jan, the class's 5 exam days
  // 17–21 Jan (Class 3 only), an assignment pause on 24 Jan, a winter-timings week 31 Jan – 4 Feb (counts as teaching).
  await HolidayException.create([{ fromDate: new Date(2027, 0, 10), toDate: new Date(2027, 0, 12, 23, 59), type: "special", nameBn: "ছুটি" }]);
  await AcademicPause.create([{ fromKey: "2027-01-24", toKey: "2027-01-24", label: "বিরতি", pauses: ["ASSIGNMENT_GENERATION"] }]);
  await ScheduleWindow.create([{ academicYearId: yearId, fromDate: new Date(2027, 0, 31), toDate: new Date(2027, 1, 4), season: "winter", dayStartMinutes: 480, label: "শীত" }]);
  const [half] = await Exam.create([{ academicYearId: yearId, term: "HALF_YEARLY", name: "অর্ধবার্ষিক", createdBy: new Types.ObjectId() }]);
  await ExamRoutine.create([
    {
      examId: half!._id,
      updatedBy: new Types.ObjectId(),
      slots: ["2027-01-17", "2027-01-18", "2027-01-19", "2027-01-20", "2027-01-21"].map((dateKey) => ({ classId: class3, dateKey, subject: "MATH", kind: "WRITTEN" })),
    },
  ]);
  await User.create({ _id: PRINCIPAL_ID, role: "PRINCIPAL", name: "Head Teacher", phone: "01700000011", passwordHash: "x" });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("pace maths (pure)", () => {
  it("AC-A1: target 40, half the teaching days gone, 15 finished -> expected 20, 5 behind", () => {
    const r = paceRead({ startOffset: 0, endCount: 40, daysTotal: 100, daysElapsed: 50, pastTarget: false, finished: 15, periodsPerWeek: 2 });
    expect(r).toEqual({ expectedByToday: 20, behindBy: 5, weeksBehind: 2.5 });
  });
  it("never negative, whole sessions only, 1 after the target date, and an ANNUAL start offset", () => {
    expect(paceRead({ startOffset: 0, endCount: 40, daysTotal: 100, daysElapsed: 50, pastTarget: false, finished: 30, periodsPerWeek: 2 }).behindBy).toBe(0);
    expect(paceRead({ startOffset: 0, endCount: 10, daysTotal: 3, daysElapsed: 1, pastTarget: false, finished: 3, periodsPerWeek: 5 }).expectedByToday).toBe(3);
    expect(paceRead({ startOffset: 0, endCount: 40, daysTotal: 100, daysElapsed: 10, pastTarget: true, finished: 30, periodsPerWeek: 4 })).toMatchObject({ expectedByToday: 40, behindBy: 10, weeksBehind: 2.5 });
    // annual: 20 done by the half-yearly end, 40 by the year's end; a quarter of the term gone -> 25 expected
    expect(paceRead({ startOffset: 20, endCount: 40, daysTotal: 80, daysElapsed: 20, pastTarget: false, finished: 22, periodsPerWeek: 2 }).expectedByToday).toBe(25);
    expect(paceRead({ startOffset: 0, endCount: 40, daysTotal: 0, daysElapsed: 0, pastTarget: false, finished: 0, periodsPerWeek: 0 }).behindBy).toBe(0);
    // no routine period for the subject -> no weeks figure (null), never sessions counted as weeks
    expect(paceRead({ startOffset: 0, endCount: 40, daysTotal: 100, daysElapsed: 50, pastTarget: false, finished: 15, periodsPerWeek: 0 })).toMatchObject({ behindBy: 5, weeksBehind: null });
  });
});

describe("teaching days + annual start (AC-A5, AC-A6)", () => {
  // A year with no target loads no calendar (one query), so these calendar reads need one target present - removed after.
  beforeAll(async () => {
    await setHalf(4, "MATH", "2027-06-30", "5:2");
  });
  afterAll(async () => {
    await setSyllabusTargets([{ classLevel: 4, subject: "MATH", term: "HALF_YEARLY", targetDate: "" }], OFFICE.userId);
    await Audit.deleteMany({});
  });

  it("holidays, the class's exam days and an assignment pause are out; winter timings count; another class keeps its exam week", async () => {
    const env = (await loadPaceEnv())!;
    expect(env).toBeTruthy();
    // 25 school days 3 Jan – 4 Feb − 3 holiday − 1 pause = 21 (Class 4 has no exam days); Class 3 loses the 5 exam days too
    expect(teachingDays(env, String(class4), "2027-01-03", "2027-02-04")).toBe(21);
    expect(teachingDays(env, String(class3), "2027-01-03", "2027-02-04")).toBe(16);
    // the winter week (31 Jan – 4 Feb) is five ordinary teaching days
    expect(teachingDays(env, String(class3), "2027-01-31", "2027-02-04")).toBe(5);
    expect(teachingDays(env, String(class3), "2027-02-04", "2027-02-03")).toBe(0); // empty range
  });

  it("ANNUAL starts the day after the class's last half-yearly exam day, else after the half-yearly target date", async () => {
    const env = (await loadPaceEnv())!;
    expect(annualStartKey(env, String(class3), "2027-06-30")).toBe("2027-01-22");
    expect(annualStartKey(env, String(class4), "2027-06-30")).toBe("2027-07-01");
  });
});

describe("the row read against a target", () => {
  it("AC-A3: no target -> NO_TARGET for every row, and the overview is otherwise unchanged", async () => {
    const rows = await progressOverview({}, TODAY);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.targetState === "NO_TARGET" && r.behindBy === 0 && r.targetDate === null)).toBe(true);
    // a year with no target at all: the screens hide the on-track line (yearHasTargets false), and nothing else was read
    expect(rows.every((r) => r.yearHasTargets === false)).toBe(true);
    expect((await loadPaceEnv())!.targets.size).toBe(0);
    expect((await runLessonBehind(TODAY)).behind).toBe(0);
    expect(await Notification.countDocuments({ kind: "LESSON_BEHIND" })).toBe(0);
  });

  it("AC-A1/A5: half-yearly target of 10 sessions by 4 Feb -> 8 of 16 teaching days gone -> 5 expected; Boys 3 -> 2 behind, Girls 1 -> 4 behind", async () => {
    await setHalf(3, "MATH", "2027-02-04", "5:2");
    const rows = await progressOverview({}, TODAY);
    const by = (n: string) => rows.find((r) => r.classLevel === 3 && r.sectionNameBn === n)!;
    expect(by("বালক")).toMatchObject({ targetState: "BEHIND", targetTerm: "HALF_YEARLY", targetDate: "2027-02-04", targetSessions: 10, expectedByToday: 5, behindBy: 2, weeksBehind: 1 });
    expect(by("বালিকা")).toMatchObject({ targetState: "BEHIND", expectedByToday: 5, behindBy: 4, weeksBehind: 2 });
    // Class 4 has no target: untouched
    expect(rows.find((r) => r.classLevel === 4)).toMatchObject({ targetState: "NO_TARGET", behindBy: 0, yearHasTargets: true }); // "লক্ষ্য দেওয়া নেই" now shows
  });

  it("ON_TRACK when the sessions done reach the expected number", async () => {
    // before any teaching day has finished nothing is expected: 3 Jan is day 1, so "today" = 3 Jan -> 0 elapsed
    const env = (await loadPaceEnv())!;
    const p = (await sessionPlansFor3())!;
    const r = resolveTermRead(env, { classId: String(class3), classLevel: 3, subject: "MATH", plan: p, finished: 5, periodsPerWeek: 2, todayKey: "2027-01-26" });
    expect(r).toMatchObject({ state: "ON_TRACK", behindBy: 0, expectedByToday: 5 });
    expect(resolveTermRead(env, { classId: String(class3), classLevel: 3, subject: "MATH", plan: p, finished: 0, periodsPerWeek: 2, todayKey: "2027-01-03" }).expectedByToday).toBe(0);
    // the target date has passed -> the whole book is expected
    expect(resolveTermRead(env, { classId: String(class3), classLevel: 3, subject: "MATH", plan: p, finished: 4, periodsPerWeek: 2, todayKey: "2027-02-20" })).toMatchObject({ expectedByToday: 10, behindBy: 6 });
  });
});

async function sessionPlansFor3() {
  const { sessionPlansFor } = await import("../modules/lesson-progress/services/LessonDeliveryService");
  return sessionPlansFor(3, "MATH");
}

describe("LPBEHIND (AC-A2, AC-A3) — runs with the release switch OFF", () => {
  it("the switch is off", async () => {
    expect(await isLoop2027On()).toBe(false);
  });

  it("2 periods a week and 4 sessions behind -> the Principal gets ONE notice; 2 behind (1 week) and no-target rows get none; a second run that week sends nothing", async () => {
    const res = await runLessonBehind(TODAY);
    expect(res).toEqual({ behind: 1, notified: 1 });
    const rows = await Notification.find({ kind: "LESSON_BEHIND" }).lean();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.recipientUserId)).toBe(PRINCIPAL_ID);
    expect(rows[0]!.refs).toMatchObject({ sectionId: girls, subject: "MATH", date: "2027-01-24" });
    expect(rows[0]!.dedupeKey).toBe(`LPB:2027-01-24:${girls}:MATH:${PRINCIPAL_ID}`);
    expect(rows[0]!.bodyBn).toContain("৪ সেশন পিছিয়ে");

    expect(await runLessonBehind(new Date(2027, 0, 27, 9, 0))).toMatchObject({ behind: 1, notified: 0 }); // same school week
    expect(await Notification.countDocuments({ kind: "LESSON_BEHIND" })).toBe(1);
    // next week the key is new, so the Principal hears again
    const next = await runLessonBehind(new Date(2027, 1, 2, 9, 0)); // more days gone: Boys is 2+ weeks behind by now too
    expect(next.notified).toBeGreaterThanOrEqual(1);
    expect(next.notified).toBe(next.behind);
    expect(await Notification.countDocuments({ kind: "LESSON_BEHIND" })).toBe(1 + next.notified);
  });

  it("a lower threshold (policy) lists the 1-week-behind শাখা too", async () => {
    await savePolicy(null, null, { termBehindAlertWeeks: 1 }, { userId: PRINCIPAL_ID, role: "PRINCIPAL" } as never);
    expect((await runLessonBehind(new Date(2027, 1, 9, 9, 0))).behind).toBeGreaterThanOrEqual(2);
    await savePolicy(null, null, { termBehindAlertWeeks: 2 }, { userId: PRINCIPAL_ID, role: "PRINCIPAL" } as never);
  });
});

describe("ANNUAL term", () => {
  it("is read from the day after the exam, starting at the half-yearly end point; the half-yearly end may not exceed the annual one", async () => {
    await setSyllabusTargets([{ classLevel: 3, subject: "MATH", term: "ANNUAL", targetDate: "2027-12-01" }], OFFICE.userId); // defaults to the last session
    const board = (await syllabusTargetBoard(3)).find((r) => r.subject === "MATH")!;
    expect(board.annual).toMatchObject({ endKey: "6:2", targetDate: "2027-12-01" });
    expect(board.halfYearly).toMatchObject({ endKey: "5:2" });
    expect(board.sessions).toHaveLength(12);
    const env = (await loadPaceEnv())!;
    const p = (await sessionPlansFor3())!;
    const r = resolveTermRead(env, { classId: String(class3), classLevel: 3, subject: "MATH", plan: p, finished: 4, periodsPerWeek: 2, todayKey: "2027-03-01" });
    expect(r).toMatchObject({ term: "ANNUAL", startKey: "2027-01-22", targetSessions: 12, targetDate: "2027-12-01" });
    expect(r.expectedByToday).toBeGreaterThanOrEqual(10); // the 10 half-yearly sessions are all expected by then
    // inside the exam week the half-yearly read still applies (the annual term has not started)
    expect(resolveTermRead(env, { classId: String(class3), classLevel: 3, subject: "MATH", plan: p, finished: 4, periodsPerWeek: 2, todayKey: "2027-01-21" }).term).toBe("HALF_YEARLY");
    // refused: a half-yearly end after the annual end / a date after the annual date
    await expect(setHalf(3, "MATH", "2027-12-31", "5:2")).rejects.toThrow(/অর্ধবার্ষিক/);
  });
});

describe("saving targets (AC-A4)", () => {
  it("validates everything first: an unknown session, a date outside the year, no end for a half-yearly, a bad class", async () => {
    await expect(setHalf(3, "MATH", "2027-02-04", "9:9")).rejects.toThrow(/পরিকল্পনায় নেই/);
    await expect(setHalf(3, "MATH", "2028-02-04", "5:2")).rejects.toThrow(/শিক্ষাবর্ষের ভেতরে/);
    await expect(setSyllabusTargets([{ classLevel: 3, subject: "MATH", term: "HALF_YEARLY", targetDate: "2027-02-04" }], OFFICE.userId)).rejects.toThrow(/শেষ সেশন/);
    await expect(setSyllabusTargets([{ classLevel: 6, subject: "MATH", term: "ANNUAL", targetDate: "2027-12-01" }], OFFICE.userId)).rejects.toThrow(/ক্লাস ১–৫/);
    await expect(setSyllabusTargets([{ classLevel: 3, subject: "BAN", term: "ANNUAL", targetDate: "2027-12-01" }], OFFICE.userId)).rejects.toThrow(/সেশন পরিকল্পনা নেই/);
    // one bad row saves nothing (all-or-nothing)
    const before = await SyllabusTarget.countDocuments({});
    await expect(
      setSyllabusTargets(
        [
          { classLevel: 4, subject: "MATH", term: "ANNUAL", targetDate: "2027-12-01" },
          { classLevel: 4, subject: "MATH", term: "HALF_YEARLY", targetDate: "2027-12-01", endChapter: "1", endSessionIndex: 99 },
        ],
        OFFICE.userId,
      ),
    ).rejects.toThrow();
    expect(await SyllabusTarget.countDocuments({})).toBe(before);
  });

  it("clearing a term removes the row and the row reads NO_TARGET again; the save is audited", async () => {
    await setHalf(4, "MATH", "2027-02-04", "2:2");
    expect((await progressOverview({ classLevel: 4 }, TODAY))[0]!.targetState).not.toBe("NO_TARGET");
    const r = await setSyllabusTargets([{ classLevel: 4, subject: "MATH", term: "HALF_YEARLY", targetDate: "" }], OFFICE.userId);
    expect(r).toEqual({ saved: 0, cleared: 1 });
    expect((await progressOverview({ classLevel: 4 }, TODAY))[0]!.targetState).toBe("NO_TARGET");
    expect(await Audit.countDocuments({ eventKind: "SYLLABUS_TARGETS_SET" })).toBeGreaterThan(0);
  });

  it("the gate is lesson_progress:set_targets: a teacher's call is refused, the Office's goes through", async () => {
    const schema = builder.toSchema();
    const M = `mutation($i: [SyllabusTargetInput!]!) { setSyllabusTargets(inputs: $i) { saved cleared } }`;
    const vars = { i: [{ classLevel: 4, subject: "MATH", term: "ANNUAL", targetDate: "2027-12-01" }] };
    const run = (auth: { userId: string; role: string }): Promise<ExecutionResult> =>
      graphql({ schema, source: M, contextValue: { auth }, variableValues: vars }) as Promise<ExecutionResult>;
    const teacher = await run({ userId: T1, role: "TEACHER" });
    expect(teacher.errors?.length).toBeGreaterThan(0);
    expect(teacher.data?.setSyllabusTargets ?? null).toBeNull();
    expect(await SyllabusTarget.countDocuments({ classToken: "C4", term: "ANNUAL" })).toBe(0);
    const office = await run(OFFICE);
    expect(office.errors).toBeUndefined();
    expect(office.data?.setSyllabusTargets).toEqual({ saved: 1, cleared: 0 });
    // and the read board too
    const Q = `query { syllabusTargetBoard(classLevel: 4) { subject annual { endKey targetDate } } }`;
    const t = (await graphql({ schema, source: Q, contextValue: { auth: { userId: T1, role: "TEACHER" } } })) as ExecutionResult;
    expect(t.errors?.length).toBeGreaterThan(0);
  });
});

describe("merged শাখা (PRD §3.7)", () => {
  it("a combined শাখা counts the sessions its source শাখা finished: on track, no LPBEHIND; split again -> behind + alert", async () => {
    const { SectionMerge } = await import("../modules/foundation/models/SectionMerge");
    const { sectionTracker } = await import("../modules/lesson-progress/services/LessonProgressService");
    const [c5] = await Class.create([{ level: 5, nameBn: "পঞ্চম", academicYearId: yearId }]);
    const [src1, src2] = await Section.create([
      { classId: c5!._id, code: "B", nameBn: "পঞ্চম বালক", active: false },
      { classId: c5!._id, code: "G", nameBn: "পঞ্চম বালিকা", active: false },
    ]);
    const [combined] = await Section.create([{ classId: c5!._id, code: "C", nameBn: "পঞ্চম সম্মিলিত" }]);
    await Student.create([{ schoolId: `AL11-C5-${combined!._id}`, name: "s", rollNumber: "1", classId: c5!._id, sectionId: combined!._id, active: true }]);
    await plan(5, "MATH", SESSIONS);
    await slot(String(combined!._id), c5!._id as Types.ObjectId, "MATH", T1, "SUN");
    await slot(String(combined!._id), c5!._id as Types.ObjectId, "MATH", T1, "TUE");
    const s1 = await slot(String(src1!._id), c5!._id as Types.ObjectId, "MATH", T1, "SUN");
    const s2 = await slot(String(src2!._id), c5!._id as Types.ObjectId, "MATH", T1, "TUE");
    await teach(s1!._id, T1, "2027-01-03", [["1:1", true], ["1:2", true], ["2:1", true], ["2:2", true]]);
    await teach(s2!._id, T1, "2027-01-05", [["3:1", true], ["3:2", true], ["4:1", true]]);
    await setHalf(5, "MATH", "2027-02-04", "5:2");
    const merge = await SectionMerge.create({
      classId: c5!._id, combinedSectionId: combined!._id, sourceSectionIds: [src1!._id, src2!._id], moves: [], status: "active", mergedBy: new Types.ObjectId(),
    });
    const row = async () => (await progressOverview({ classLevel: 5 }, TODAY)).find((r) => r.sectionId === String(combined!._id))!;
    // 7 finished by its sources; 13 of 21 teaching days gone -> 6 expected -> on track
    expect(await row()).toMatchObject({ finished: 7, targetState: "ON_TRACK", behindBy: 0 });
    await runLessonBehind(TODAY);
    expect(await Notification.countDocuments({ kind: "LESSON_BEHIND", "refs.sectionId": String(combined!._id) })).toBe(0);
    // the tracker lists the sources' sessions too
    const t = await sectionTracker(String(combined!._id), "MATH", OFFICE, TODAY);
    expect(t.sessions.filter((s) => s.status === "FINISHED")).toHaveLength(7);
    // split again: nothing finished by the শাখা itself -> behind, and the Principal is told
    await SectionMerge.updateOne({ _id: merge._id }, { $set: { status: "split" } });
    expect(await row()).toMatchObject({ finished: 0, targetState: "BEHIND" });
    await runLessonBehind(new Date(2027, 0, 27, 9, 0));
    expect(await Notification.countDocuments({ kind: "LESSON_BEHIND", "refs.sectionId": String(combined!._id) })).toBe(1);
  });
});

describe("a শাখা of another year has no on-track line", () => {
  it("the tracker of a section whose class is not in the year read returns NO_TARGET and hides the line", async () => {
    const { sectionTracker } = await import("../modules/lesson-progress/services/LessonProgressService");
    const [y26] = await AcademicYear.create([{ label: "2026", startDate: new Date(2026, 0, 1), endDate: new Date(2026, 11, 31), current: false }]);
    const [old3] = await Class.create([{ level: 3, nameBn: "তৃতীয় (২০২৬)", academicYearId: y26!._id }]);
    const [oldSec] = await Section.create([{ classId: old3!._id, code: "X", nameBn: "পুরনো" }]);
    const t = await sectionTracker(String(oldSec!._id), "MATH", OFFICE, TODAY);
    expect(t.row).toMatchObject({ targetState: "NO_TARGET", behindBy: 0, targetDate: null, yearHasTargets: false });
    // a current-year section of the same class level + subject still reads its target
    const cur = (await progressOverview({ classLevel: 3 }, TODAY)).find((r) => r.sectionNameBn === "বালক")!;
    expect(cur).toMatchObject({ targetState: "BEHIND", yearHasTargets: true });
    // the pure guard
    const env = (await loadPaceEnv())!;
    const p = (await sessionPlansFor3())!;
    expect(resolveTermRead(env, { classId: String(old3!._id), classLevel: 3, subject: "MATH", plan: p, finished: 0, periodsPerWeek: 2, todayKey: "2027-01-26", academicYearId: String(y26!._id) }).state).toBe("NO_TARGET");
  });
});

describe("the prepared next year", () => {
  it("targets can be set for the current OR the next year; dates must lie inside the chosen year; other years are refused", async () => {
    const [y28] = await AcademicYear.create([{ label: "2028", startDate: new Date(2028, 0, 1), endDate: new Date(2028, 11, 31), current: false }]);
    const years = await targetYears();
    expect(years.map((y) => `${y.label}:${y.current}`)).toEqual(["2027:true", "2028:false"]);
    const nextId = String(y28!._id);
    const inp = (date: string) => [{ classLevel: 3, subject: "MATH", term: "HALF_YEARLY" as const, targetDate: date, endChapter: "5", endSessionIndex: 2 }];
    await expect(setSyllabusTargets(inp("2027-06-30"), OFFICE.userId, nextId)).rejects.toThrow(/নির্বাচিত শিক্ষাবর্ষের ভেতরে/);
    await expect(setSyllabusTargets(inp("2028-06-30"), OFFICE.userId, String(new Types.ObjectId()))).rejects.toThrow(/চলতি বা পরের/);
    const y26 = await AcademicYear.findOne({ label: "2026" }).lean();
    await expect(setSyllabusTargets(inp("2026-06-30"), OFFICE.userId, String(y26!._id))).rejects.toThrow(/চলতি বা পরের/);
    expect(await setSyllabusTargets(inp("2028-06-30"), OFFICE.userId, nextId)).toEqual({ saved: 1, cleared: 0 });
    expect(await SyllabusTarget.countDocuments({ academicYearId: y28!._id, classToken: "C3", subject: "MATH" })).toBe(1);
    // the boards are per year; the current year's read is untouched by the next year's rows
    const next = (await syllabusTargetBoard(3, nextId)).find((r) => r.subject === "MATH")!;
    expect(next.halfYearly).toMatchObject({ targetDate: "2028-06-30", endKey: "5:2" });
    const cur = (await syllabusTargetBoard(3)).find((r) => r.subject === "MATH")!;
    expect(cur.halfYearly).toMatchObject({ targetDate: "2027-02-04" });
    expect((await loadPaceEnv())!.yearId).toBe(String(yearId));
  });
});

describe("the audit row", () => {
  it("records per changed row: subject, term, class, old -> new date and end session; an unchanged re-save adds no row", async () => {
    await Audit.deleteMany({ eventKind: "SYLLABUS_TARGETS_SET" });
    await setHalf(4, "MATH", "2027-03-01", "3:2");
    await setHalf(4, "MATH", "2027-03-15", "4:1");
    await setHalf(4, "MATH", "2027-03-15", "4:1"); // same values again
    const rows = await Audit.find({ eventKind: "SYLLABUS_TARGETS_SET" }).sort({ _id: 1 }).lean();
    expect(rows).toHaveLength(2);
    expect((rows[0]!.meta as { changes: unknown[] }).changes).toEqual([{ subject: "MATH", term: "HALF_YEARLY", classLevel: 4, from: null, to: { date: "2027-03-01", end: "3:2" } }]);
    expect((rows[1]!.meta as { changes: unknown[] }).changes).toEqual([
      { subject: "MATH", term: "HALF_YEARLY", classLevel: 4, from: { date: "2027-03-01", end: "3:2" }, to: { date: "2027-03-15", end: "4:1" } },
    ]);
  });
});

describe("LPBEHIND text + the app line", () => {
  it("the body names the target date in Bangla digits and a Bangla month", async () => {
    const { dateKeyBn } = await import("../modules/lesson-progress/services/SyllabusTargetService");
    expect(dateKeyBn("2027-02-04")).toBe("৪ ফেব্রুয়ারি ২০২৭");
    const row = await Notification.findOne({ kind: "LESSON_BEHIND", "refs.sectionId": girls }).lean();
    expect(row!.bodyBn).toContain("৪ ফেব্রুয়ারি ২০২৭");
    expect(row!.bodyBn).not.toMatch(/2027/);
  });

  it("no routine period for the subject -> weeksBehind null and no alert", async () => {
    const { sectionTracker } = await import("../modules/lesson-progress/services/LessonProgressService");
    const [c1] = await Class.create([{ level: 1, nameBn: "প্রথম", academicYearId: yearId }]);
    const [sec] = await Section.create([{ classId: c1!._id, code: "Z", nameBn: "প্রথম-ক" }]);
    await plan(1, "MATH", SESSIONS);
    await slot(String(sec!._id), c1!._id as Types.ObjectId, "BAN", T1, "SUN"); // a routine row, but not for MATH
    await setHalf(1, "MATH", "2027-02-04", "5:2");
    const t = await sectionTracker(String(sec!._id), "MATH", OFFICE, TODAY);
    expect(t.row).toMatchObject({ targetState: "BEHIND", weeksBehind: null });
    await runLessonBehind(new Date(2027, 1, 16, 9, 0));
    expect(await Notification.countDocuments({ kind: "LESSON_BEHIND", "refs.sectionId": String(sec!._id) })).toBe(0);
  });

  it("the app line: hidden for a year with no target; no-target text once any exists; the target badge says it is from the target", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { targetLine } = require("../../../app/src/screens/lessonprogress/lessonProgressUi") as {
      targetLine: (r: Record<string, unknown>) => { text: string; tone: string; detail: string } | null;
    };
    const base = { targetTerm: null, targetDate: null, targetSessions: 0, expectedByToday: 0, behindBy: 0, weeksBehind: null };
    expect(targetLine({ ...base, yearHasTargets: false, targetState: "NO_TARGET" })).toBeNull();
    expect(targetLine({ ...base, yearHasTargets: true, targetState: "NO_TARGET" })).toMatchObject({ text: "লক্ষ্য দেওয়া নেই", tone: "muted" });
    expect(targetLine({ ...base, yearHasTargets: true, targetState: "ON_TRACK", targetDate: "2027-02-04" })).toMatchObject({ text: "সময়মতো" });
    const behind = targetLine({ ...base, yearHasTargets: true, targetState: "BEHIND", behindBy: 5, weeksBehind: 2.5, targetDate: "2027-02-04", expectedByToday: 20 })!;
    expect(behind.text).toContain("লক্ষ্য থেকে ৫ সেশন পিছিয়ে");
    expect(targetLine({ ...base, yearHasTargets: true, targetState: "BEHIND", behindBy: 5, weeksBehind: null, targetDate: "2027-02-04" })!.text).toBe("লক্ষ্য থেকে ৫ সেশন পিছিয়ে");
  });
});
