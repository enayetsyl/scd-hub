/**
 * YC-6 - routine + schedule copy into the new year (docs/prd-year-change.md section 3 step 1 items 6-7,
 * brief 12). Real services on in-memory Mongo, on top of the YC-4 engine world.
 *
 *   routine    copies per section equal 2026's; 2026 rows end 2027-01-02, 2027 rows start 2027-01-03;
 *              group (Quran) slots untouched; conflict engine reports 0, and a clash refuses the prepare
 *   windows    bell windows shifted into 2027
 *   schedule   2027 AssignmentSchedule; the handout on 2027-01-03 shows week 1
 *   grants     2027 routine teaching grants, 2026 ones lapse 3 Jan, supervisory/delegation re-pointed
 *   mastery    LOCKED trees only
 *   undo       0 rows with the run id, the 2026 ends and expiries put back (only where still as stamped)
 *   readers    every today-reader unchanged before the cut-over
 *   fixes      (review of the YC-6 slice) December edits survive a re-run and the cut-over; the 2027 grants and
 *              chat groups appear at the cut-over; every 2026 row ends; windows are clipped; no write on a clash
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Enrolment } from "../modules/foundation/models/Enrolment";
import { User } from "../modules/foundation/models/User";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { ClassTeacherAssignment } from "../modules/foundation/models/ClassTeacherAssignment";
import { Subject } from "../modules/foundation/models/Subject";
import { ScopeGrant } from "../modules/foundation/models/ScopeGrant";
import { Audit } from "../modules/platform/models/Audit";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { ImprovementAction } from "../modules/improvement/models/ImprovementAction";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { ScheduleWindow } from "../modules/routine/models/ScheduleWindow";
import { AssignmentSchedule } from "../modules/trackers/models/AssignmentSchedule";
import { MasteryEnablement } from "../modules/mastery/models/MasteryEnablement";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { composeTeacherScope } from "../modules/foundation/services/ScopeGrantService";
import { createRoutineSlot, deleteRoutineSlot, reassignRoutineSubjectTeacher, slotsForDate, slotsForTeacherOnDate, updateRoutineSlot } from "../modules/routine/services/RoutineSlotService";
import { Conversation } from "../modules/chat/models/Conversation";
import { StaffMistakeNote } from "../modules/staff-mistakes/models/StaffMistakeNote";
import { handoutBoard } from "../modules/trackers/services/AssignmentHandoutService";
import {
  YearChangeRefusal,
  YearChangeRun,
  applyCutover,
  applyPrepare,
  planCutover,
  planYearChange,
  planUndoCutover,
  planUndoPrepare,
  printCutover,
  printPlan,
  printUndo,
  undoCutover,
  undoPrepare,
  type PlanInput,
} from "../modules/year-change";
import { clearYearChangeFixtures, seedEngineWorld, type EngineWorld } from "./fixtures/yearChange";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  mongoose.set("autoIndex", false);
  await mongoose.connect(mongo.getUri());
  await Promise.all([AcademicYear, Class, Section, Student, Enrolment, YearChangeRun].map((m) => (m as unknown as mongoose.Model<unknown>).init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

// The test clock sits in December 2026, the window in which the Principal edits the 2027 draft. Only Date is
// faked (and it keeps running), so the in-memory Mongo driver's timers are untouched.
const FAKE_ALL_BUT_DATE = ["hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] as const;
beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-12-06T10:00:00+06:00"), advanceTimers: true, doNotFake: [...FAKE_ALL_BUT_DATE] });
});
afterEach(() => {
  jest.useRealTimers();
});

const RUN = "yc6-test-1";
const D2026_START = new Date("2026-01-04");
const oid = (): Types.ObjectId => new Types.ObjectId();

interface World extends EngineWorld {
  tMath: Types.ObjectId;
  tBan: Types.ObjectId;
  tEng: Types.ObjectId;
  tQuran: Types.ObjectId;
  quranGroup: Types.ObjectId;
  math: Types.ObjectId;
  ban: Types.ObjectId;
  grants: { routine: Types.ObjectId; supervisory: Types.ObjectId; delegation: Types.ObjectId };
}

let w: World;

async function seedRoutineWorld(): Promise<World> {
  const base = await seedEngineWorld();
  const mk = async (n: string, phone: string): Promise<Types.ObjectId> => (await User.create({ name: n, phone, passwordHash: "x", role: "TEACHER" }))._id;
  const tMath = await mk("Math T", "01700000411");
  const tBan = await mk("Ban T", "01700000412");
  const tEng = await mk("Eng T", "01700000413");
  const tQuran = await mk("Quran T", "01700000414");
  const math = (await Subject.findOne({ code: "MATH" })) ?? (await Subject.create({ code: "MATH", nameBn: "গণিত" }));
  const ban = (await Subject.findOne({ code: "BAN" })) ?? (await Subject.create({ code: "BAN", nameBn: "বাংলা" }));
  const quranGroup = oid();
  const slot = (p: { sectionId: Types.ObjectId; classId: Types.ObjectId; day: string; period: number; subject: string; teacher: Types.ObjectId }) =>
    RoutineSlot.create({
      groupType: "section",
      groupId: p.sectionId,
      classId: p.classId,
      dayOfWeek: p.day,
      periodNumber: p.period,
      subject: p.subject,
      track: "general",
      isBreak: false,
      teacherId: p.teacher,
      effectiveFrom: D2026_START,
      createdBy: base.teacher4,
    });
  // C4 Boys: Math twice, Bangla last on Thursday. C5 Boys / Girls / C2 Main one or two each.
  await slot({ ...base.c4Boys, sectionId: base.c4Boys.sectionId, day: "SUN", period: 1, subject: "MATH", teacher: tMath });
  await slot({ ...base.c4Boys, day: "THU", period: 1, subject: "MATH", teacher: tMath });
  await slot({ ...base.c4Boys, day: "THU", period: 2, subject: "BAN", teacher: tBan });
  await slot({ ...base.c5Boys, day: "SUN", period: 1, subject: "BAN", teacher: tBan });
  await slot({ ...base.c5Boys, day: "THU", period: 1, subject: "ENG", teacher: tEng });
  await slot({ ...base.c5Girls, day: "SUN", period: 2, subject: "MATH", teacher: tMath });
  await slot({ ...base.c5Girls, day: "THU", period: 3, subject: "BAN", teacher: tBan });
  await slot({ ...base.c2Main, day: "SUN", period: 1, subject: "MATH", teacher: base.teacherOther });
  // a Quran group slot: kept exactly as it is
  await RoutineSlot.create({ groupType: "subjectgroup", groupId: quranGroup, dayOfWeek: "SUN", periodNumber: 4, subject: "QURAN", track: "quran", isBreak: false, teacherId: tQuran, effectiveFrom: D2026_START, createdBy: base.teacher4 });

  await ScheduleWindow.create({ academicYearId: base.years.y2026, fromDate: new Date("2026-01-04"), toDate: new Date("2026-11-30"), season: "regular", dayStartMinutes: 420, label: "Regular" });
  await ScheduleWindow.create({ academicYearId: base.years.y2026, fromDate: new Date("2026-12-01"), toDate: new Date("2026-12-31"), season: "winter", dayStartMinutes: 435, label: "Winter" });

  await AssignmentSchedule.create({
    academicYearId: base.years.y2026,
    termStartDate: new Date(2026, 0, 4),
    deliveryDayOfWeek: 4,
    dueDayOfWeek: 0,
    entries: [
      { cycleWeek: 1, classId: base.c4Boys.classId, classLevel: 4, sectionId: base.c4Boys.sectionId, subject: "MATH", teacherId: tMath },
      { cycleWeek: 1, classId: base.c5Boys.classId, classLevel: 5, sectionId: base.c5Boys.sectionId, subject: "BAN", teacherId: tBan },
      { cycleWeek: 2, classId: base.c5Girls.classId, classLevel: 5, sectionId: base.c5Girls.sectionId, subject: "MATH", teacherId: tMath },
    ],
  });

  await MasteryOutcome.create({ code: "C4-MATH-T1", classToken: "C4", subject: "MATH", labelBn: "x", assess: "QUESTION", status: "LOCKED", order: 1 });
  await MasteryEnablement.create({ academicYearId: base.years.y2026, classToken: "C4", subject: "MATH", enabled: true });
  await MasteryEnablement.create({ academicYearId: base.years.y2026, classToken: "C5", subject: "BAN", enabled: true }); // no LOCKED tree

  const routine = (
    await ScopeGrant.create({ teacherId: tMath, kind: "teaching", source: "routine", classId: base.c4Boys.classId, sectionId: base.c4Boys.sectionId, subjectId: math._id, createdBy: base.teacher4 })
  )._id;
  const supervisory = (await ScopeGrant.create({ teacherId: base.teacherOther, kind: "supervisory", extent: "grade_class", classId: base.c4Boys.classId, createdBy: base.teacher4 }))._id;
  const delegation = (
    await ScopeGrant.create({
      teacherId: base.teacherOther,
      kind: "delegation",
      extent: "explicit_set",
      explicitSet: [{ classId: base.c5Boys.classId, subjectId: math._id }],
      actions: ["declare_homework"],
      createdBy: base.teacher4,
    })
  )._id;
  return { ...base, tMath, tBan, tEng, tQuran, quranGroup, math: math._id, ban: ban._id, grants: { routine, supervisory, delegation } };
}

beforeEach(async () => {
  await clearYearChangeFixtures();
  await Promise.all(
    [User, Guardian, GuardianLink, ClassTeacherAssignment, HomeworkItem, ImprovementAction, YearChangeRun, Audit, RoutineSlot, ScheduleWindow, AssignmentSchedule, MasteryEnablement, MasteryOutcome, ScopeGrant].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
  w = await seedRoutineWorld();
});

const input = (copy?: PlanInput["copy"]): PlanInput => ({
  fromYearId: w.years.y2026.toString(),
  toYearId: w.years.y2027.toString(),
  promotions: w.promotions,
  admissions: w.admissions,
  ...(copy ? { copy } : {}),
});
const prepare = async (copy?: PlanInput["copy"], runId = RUN) => applyPrepare(await planYearChange(input(copy)), runId, w.principal);
const DAY = (key: string): Date => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

const runRows = async (runId = RUN): Promise<Record<string, number>> => ({
  slots: await RoutineSlot.countDocuments({ runId }),
  windows: await ScheduleWindow.countDocuments({ runId }),
  schedules: await AssignmentSchedule.countDocuments({ runId }),
  enablements: await MasteryEnablement.countDocuments({ runId }),
  grants: await ScopeGrant.countDocuments({ runId }),
  classes: await Class.countDocuments({ runId }),
  sections: await Section.countDocuments({ runId }),
  enrolments: await Enrolment.countDocuments({ runId }),
  runs: await YearChangeRun.countDocuments({ runId }),
});
const slotsOf = async (sectionId: Types.ObjectId) => RoutineSlot.find({ groupId: sectionId, groupType: "section" }).sort({ dayOfWeek: 1, periodNumber: 1 }).lean();
const sec2027 = async (level: number, code: string): Promise<Types.ObjectId> => {
  const cls = await Class.findOne({ level, academicYearId: w.years.y2027 });
  return (await Section.findOne({ classId: cls?._id, code }))!._id;
};

describe("YC-6: the dry run", () => {
  it("lists the copy per section and writes nothing", async () => {
    const before = await Promise.all([RoutineSlot.countDocuments(), ScheduleWindow.countDocuments(), AssignmentSchedule.countDocuments(), MasteryEnablement.countDocuments(), ScopeGrant.countDocuments()]);
    const plan = await planYearChange(input());
    expect(plan.refusals).toEqual([]);
    const sc = plan.scheduleCopy;
    expect(sc.fromKey).toBe("2027-01-03");
    expect(sc.endKey).toBe("2027-01-02");
    expect(sc.routine.sections.map((s) => [s.level, s.code, s.slots])).toEqual([
      [2, "Main", 1],
      [4, "Boys", 3],
      [5, "Boys", 2],
      [5, "Girls", 2],
    ]);
    expect(sc.routine).toMatchObject({ slotsToCreate: 8, slotsExisting: 0, pastToEnd: 8, conflicts: [] });
    expect(sc.bellWindows).toMatchObject({ toCreate: 2, existing: 0 });
    expect(sc.assignment).toMatchObject({ entries: 3, existing: false });
    expect(sc.grants).toMatchObject({ routineTeachingToCreate: 6, pastRoutineToExpire: 1, repointToCreate: 2, pastRepointedToExpire: 2 });
    expect(sc.mastery).toMatchObject({ toCreate: 1, skippedUnlocked: ["C5 BAN"] });
    const text = printPlan(plan);
    expect(text).toContain("রুটিন ও সূচি কপি");
    expect(text).toContain("লক নেই — চালু হবে না: C5 BAN");
    const after = await Promise.all([RoutineSlot.countDocuments(), ScheduleWindow.countDocuments(), AssignmentSchedule.countDocuments(), MasteryEnablement.countDocuments(), ScopeGrant.countDocuments()]);
    expect(after).toEqual(before);
  });

  it("each copy has an opt-out flag", async () => {
    const plan = await planYearChange(input({ routine: false, bellWindows: false, assignmentSchedule: false, grants: false, mastery: false }));
    expect(plan.scheduleCopy.routine.slotsToCreate).toBe(0);
    expect(plan.scheduleCopy.bellWindows.toCreate).toBe(0);
    expect(plan.scheduleCopy.assignment.entries).toBe(0);
    expect(plan.scheduleCopy.grants.routineTeachingToCreate).toBe(0);
    expect(plan.scheduleCopy.mastery.toCreate).toBe(0);
    const r = await prepare({ routine: false, bellWindows: false, assignmentSchedule: false, grants: false, mastery: false });
    expect(r.writes).toMatchObject({ routineSlots: 0, routineEnded: 0, bellWindows: 0, assignmentSchedule: 0, grants: 0, grantsExpired: 0, masteryEnablements: 0 });
  });
});

describe("YC-6: routine slots", () => {
  it("copies each section's slots to the matching 2027 section, dated 3 Jan, and ends the 2026 rows on 2 Jan", async () => {
    const r = await prepare();
    expect(r.writes).toMatchObject({ routineSlots: 8, routineEnded: 8 });
    const pairs: Array<[{ sectionId: Types.ObjectId }, number, string]> = [
      [w.c2Main, 2, "Main"],
      [w.c4Boys, 4, "Boys"],
      [w.c5Boys, 5, "Boys"],
      [w.c5Girls, 5, "Girls"],
    ];
    for (const [old, level, code] of pairs) {
      const from = await slotsOf(old.sectionId);
      const to = await slotsOf(await sec2027(level, code));
      const shape = (x: typeof from) => x.map((s) => [s.dayOfWeek, s.periodNumber, s.subject, s.track, String(s.teacherId ?? "")]);
      expect(shape(to)).toEqual(shape(from));
      for (const s of from) {
        expect(dayKey(s.effectiveTo as Date)).toBe("2027-01-02");
      }
      for (const s of to) {
        expect(dayKey(s.effectiveFrom)).toBe("2027-01-03");
        expect(s.effectiveTo).toBeFalsy();
        expect(s.runId).toBe(RUN);
        expect(String(s.classId)).toBe(String((await Class.findOne({ level, academicYearId: w.years.y2027 }))!._id));
      }
    }
    // Class 6 starts empty
    expect(await slotsOf(await sec2027(6, "Boys"))).toHaveLength(0);
    expect(await slotsOf(await sec2027(6, "Girls"))).toHaveLength(0);
    // the Quran group slot is exactly as it was
    const q = await RoutineSlot.find({ groupType: "subjectgroup" }).lean();
    expect(q).toHaveLength(1);
    expect(q[0].effectiveTo).toBeFalsy();
    expect(q[0].runId).toBeUndefined();
    // no slot of the whole set conflicts (the engine ran in the plan; check again over the stored rows)
    const plan = await planYearChange(input());
    expect(plan.scheduleCopy.routine.conflicts).toEqual([]);
    expect(plan.scheduleCopy.routine).toMatchObject({ slotsToCreate: 0, slotsExisting: 8, pastToEnd: 0 });
  });

  it("every today-reader is unchanged before the cut-over, and the copy answers from 3 Jan", async () => {
    const dec = new Date(2026, 11, 6); // a Sunday in December
    const snap = async () =>
      Promise.all(
        [w.c4Boys, w.c5Boys, w.c5Girls, w.c2Main].map(async (p) =>
          (await slotsForDate("section", p.sectionId.toString(), dec)).map((x) => [String(x._id), x.dayOfWeek, x.periodNumber, x.subject, String(x.teacherId)]),
        ),
      );
    const mine = async () => (await slotsForTeacherOnDate(w.tMath.toString(), dec)).map((x) => [String(x._id), x.dayOfWeek, x.periodNumber, x.subject]);
    const before = await snap();
    const dayBefore = await mine();
    await prepare();
    expect(await snap()).toEqual(before);
    expect(await mine()).toEqual(dayBefore);
    // the last day of 2026, a Thursday: the 2026 slot answers, the draft does not
    const lastDay = new Date(2026, 11, 31);
    expect((await slotsForDate("section", w.c4Boys.sectionId.toString(), lastDay)).length).toBe(2);
    expect(await slotsForDate("section", (await sec2027(4, "Boys")).toString(), lastDay)).toHaveLength(0);
    // 2027-01-03 is a Sunday: the 2027 copy answers, the 2026 row has ended
    const first = DAY("2027-01-03");
    expect(await slotsForDate("section", w.c4Boys.sectionId.toString(), first)).toHaveLength(0);
    expect(await slotsForDate("section", (await sec2027(4, "Boys")).toString(), first)).toHaveLength(1);
  });

  it("refuses the copy (and writes nothing) when the conflict engine finds a clash, and lists it", async () => {
    // a hand-made 2027 slot: Math T is also booked on SUN P1 in 2027
    const cls = await Class.create({ level: 3, nameBn: "x", academicYearId: w.years.y2027 });
    const sec = await Section.create({ classId: cls._id, code: "Boys", nameBn: "বালক", active: true });
    await RoutineSlot.create({ groupType: "section", groupId: sec._id, classId: cls._id, dayOfWeek: "SUN", periodNumber: 1, subject: "MATH", track: "general", isBreak: false, teacherId: w.tMath, effectiveFrom: new Date("2027-01-03"), createdBy: w.teacher4 });
    const plan = await planYearChange(input());
    expect(plan.scheduleCopy.routine.conflicts.length).toBeGreaterThan(0);
    expect(plan.scheduleCopy.routine.conflicts[0]).toContain("Math T");
    expect(plan.refusals.some((x) => x.startsWith("রুটিন কপি"))).toBe(true);
    const before = await RoutineSlot.countDocuments();
    await expect(applyPrepare(plan, RUN, w.principal)).rejects.toBeInstanceOf(YearChangeRefusal);
    expect(await RoutineSlot.countDocuments()).toBe(before);
    expect(await RoutineSlot.countDocuments({ effectiveTo: { $exists: true, $ne: null } })).toBe(0);
    // unticking the routine copy lets the rest through
    const ok = await planYearChange(input({ routine: false }));
    expect(ok.refusals).toEqual([]);
  });

  it("is idempotent: a re-run writes 0, and a 2026 edit is reconciled", async () => {
    await prepare();
    const again = await prepare();
    expect(again.total).toBe(0);
    // December: a 2026 slot is added and one is retired
    await RoutineSlot.create({ groupType: "section", groupId: w.c2Main.sectionId, classId: w.c2Main.classId, dayOfWeek: "MON", periodNumber: 2, subject: "BAN", track: "general", isBreak: false, teacherId: w.tBan, effectiveFrom: D2026_START, createdBy: w.teacher4 });
    await RoutineSlot.deleteOne({ groupId: w.c5Girls.sectionId, dayOfWeek: "THU" });
    const third = await prepare();
    expect(third.writes).toMatchObject({ routineSlots: 2, routineEnded: 1 });
    expect(await slotsOf(await sec2027(2, "Main"))).toHaveLength(2);
    expect(await slotsOf(await sec2027(5, "Girls"))).toHaveLength(1);
    expect((await prepare()).total).toBe(0);
  });
});

describe("YC-6: bell windows, assignment schedule, mastery", () => {
  it("copies the bell windows into 2027 and the schedule with the entries mapped to the 2027 sections", async () => {
    const r = await prepare();
    expect(r.writes).toMatchObject({ bellWindows: 2, assignmentSchedule: 1, masteryEnablements: 1 });
    const wins = await ScheduleWindow.find({ academicYearId: w.years.y2027 }).sort({ fromDate: 1 }).lean();
    expect(wins.map((x) => [dayKey(x.fromDate), dayKey(x.toDate), x.season, x.dayStartMinutes, x.runId])).toEqual([
      ["2027-01-04", "2027-11-30", "regular", 420, RUN],
      ["2027-12-01", "2027-12-31", "winter", 435, RUN],
    ]);
    expect(await ScheduleWindow.countDocuments({ academicYearId: w.years.y2026, runId: { $exists: true } })).toBe(0);

    const sched = (await AssignmentSchedule.findOne({ academicYearId: w.years.y2027 }).lean())!;
    expect(sched.runId).toBe(RUN);
    expect(dayKey(sched.termStartDate)).toBe("2027-01-03");
    expect(sched.entries).toHaveLength(3);
    const c4b27 = await sec2027(4, "Boys");
    const c5g27 = await sec2027(5, "Girls");
    expect(sched.entries.map((e) => [e.cycleWeek, String(e.sectionId), e.subject, e.effectiveFrom])).toEqual(
      expect.arrayContaining([
        [1, String(c4b27), "MATH", "2027-01-03"],
        [2, String(c5g27), "MATH", "2027-01-03"],
      ]),
    );
    // 2026's own schedule is untouched
    expect((await AssignmentSchedule.findOne({ academicYearId: w.years.y2026 }).lean())!.runId).toBeUndefined();
  });

  it("mastery: only LOCKED trees are switched on for 2027", async () => {
    await prepare();
    const rows = await MasteryEnablement.find({ academicYearId: w.years.y2027 }).lean();
    expect(rows.map((x) => [x.classToken, x.subject, x.enabled, x.runId])).toEqual([["C4", "MATH", true, RUN]]);
  });

  it("the assignment handout on 2027-01-03 shows week 1", async () => {
    await prepare();
    await applyCutover(RUN, w.principal, { allowEarly: true });
    const board = await handoutBoard(DAY("2027-01-03"));
    expect(board.weekNumber).toBe(1);
    expect(board.deliveryDateKey).toBe("2027-01-07");
    const c4b27 = String(await sec2027(4, "Boys"));
    const sec = board.sections.find((s) => s.sectionId === c4b27);
    expect(sec).toBeDefined();
    expect(sec!.packets.map((p) => p.subject)).toEqual(["MATH"]);
    // the section's last Thursday period is the copied BAN slot
    expect(sec).toMatchObject({ lastPeriodNumber: 2, lastPeriodSubject: "BAN", handoutTeacherId: w.tBan.toString() });
  });
});

describe("YC-6: grants", () => {
  const teaching = (scopes: Awaited<ReturnType<typeof composeTeacherScope>>["scopes"]) => scopes.filter((s) => s.kind === "teaching").map((s) => (s as { sectionId: string }).sectionId);
  const jan3 = new Date("2027-01-03T00:30:00+06:00");
  const dec = new Date("2026-12-06T10:00:00+06:00");

  it("in December nothing in 2027 grants write; the cut-over creates the 2027 grants and the 2026 routine grant lapses 3 Jan", async () => {
    const r = await prepare();
    expect(r.writes.grants).toBe(0);
    const c4b27 = await sec2027(4, "Boys");
    // December and January 3rd, before the cut-over: no 2027 section in any teacher's scope
    expect(teaching((await composeTeacherScope(w.tMath.toString(), jan3)).scopes)).not.toContain(c4b27.toString());
    expect(teaching((await composeTeacherScope(w.tMath.toString(), dec)).scopes)).not.toContain(c4b27.toString());
    expect(await ScopeGrant.countDocuments({ runId: RUN })).toBe(0);
    const old = (await ScopeGrant.findById(w.grants.routine).lean())!;
    expect(new Date((old as unknown as { expiresAt: Date }).expiresAt).toISOString()).toBe("2027-01-02T18:00:00.000Z");
    // before 3 Jan the 2026 grant still works
    expect(teaching((await composeTeacherScope(w.tMath.toString(), dec)).scopes)).toContain(w.c4Boys.sectionId.toString());

    // the cut-over dry run lists what it will create
    const dry = await planCutover(RUN, undefined, { allowEarly: true });
    expect(dry.copy.grantsToCreate).toBe(8);
    const cut = await applyCutover(RUN, w.principal, { allowEarly: true });
    expect(cut.writes.grants).toBe(8);
    const atJan3 = (await composeTeacherScope(w.tMath.toString(), jan3)).scopes;
    expect(teaching(atJan3)).toContain(c4b27.toString());
    expect(teaching(atJan3)).not.toContain(w.c4Boys.sectionId.toString());
    // the 2027 grants carry the run id and the routine source
    const made = await ScopeGrant.find({ runId: RUN, kind: "teaching" }).lean();
    expect(made.every((g) => g.source === "routine" && g.active)).toBe(true);
    expect(made).toHaveLength(6);
  });

  it("supervisory and delegation grants on a 2026 class are re-pointed to the same-level 2027 class at the cut-over", async () => {
    await prepare();
    const c4_27 = (await Class.findOne({ level: 4, academicYearId: w.years.y2027 }))!._id;
    const c5_27 = (await Class.findOne({ level: 5, academicYearId: w.years.y2027 }))!._id;
    const sup = (at: Date) => composeTeacherScope(w.teacherOther.toString(), at).then((r) => r.scopes.filter((s) => s.kind === "supervisory").map((s) => (s as { classId?: string }).classId));
    expect(await sup(jan3)).toEqual([]); // the 2026 grant lapsed, the 2027 clone is not made yet
    expect(await ScopeGrant.countDocuments({ runId: RUN, repointedFrom: { $exists: true } })).toBe(0);
    await applyCutover(RUN, w.principal, { allowEarly: true });
    expect(await sup(jan3)).toEqual([c4_27.toString()]); // no 2026 read any more
    const del = (await composeTeacherScope(w.teacherOther.toString(), jan3)).scopes.filter((s) => s.kind === "delegation").flatMap((s) => (s as { explicitSet?: Array<{ classId: string }> }).explicitSet?.map((e) => e.classId) ?? []);
    expect(del).toEqual([c5_27.toString()]);
    // in December the 2026 grants still read
    expect(await sup(dec)).toContain(w.c4Boys.classId.toString());
    // the clones are tagged and linked
    const clones = await ScopeGrant.find({ runId: RUN, repointedFrom: { $exists: true } }).lean();
    expect(clones).toHaveLength(2);
    expect(clones.map((g) => String(g.repointedFrom)).sort()).toEqual([w.grants.supervisory.toString(), w.grants.delegation.toString()].sort());
  });

  it("an inactive routine grant for the same teacher + section + subject is switched back on, and undo-cutover returns it", async () => {
    await prepare();
    const c4b27 = await sec2027(4, "Boys");
    const c4cls27 = (await Class.findOne({ level: 4, academicYearId: w.years.y2027 }))!._id;
    const dormant = await ScopeGrant.create({ teacherId: w.tMath, kind: "teaching", source: "routine", classId: c4cls27, sectionId: c4b27, subjectId: w.math, active: false, createdBy: w.teacher4 });
    const plan = await planCutover(RUN, undefined, { allowEarly: true });
    expect(plan.copy.grantsToCreate).toBe(8); // an inactive grant does not count as "already have it"
    await applyCutover(RUN, w.principal, { allowEarly: true });
    const back = (await ScopeGrant.findById(dormant._id).lean())!;
    expect(back.active).toBe(true);
    expect(back.runId).toBe(RUN);
    expect(await ScopeGrant.countDocuments({ teacherId: w.tMath, sectionId: c4b27, subjectId: w.math })).toBe(1);
    await undoCutover(RUN, w.principal);
    const after = (await ScopeGrant.findById(dormant._id).lean())!;
    expect(after.active).toBe(false);
    expect(after.runId).toBeUndefined();
    expect(await ScopeGrant.countDocuments({ runId: RUN })).toBe(0);
  });
});

describe("YC-6: undo-prepare", () => {
  it("leaves 0 rows with the run id and restores the 2026 ends and expiries", async () => {
    // a 2026 slot that already had its own effectiveTo, and a grant with its own expiry
    const own = await RoutineSlot.create({ groupType: "section", groupId: w.c4Boys.sectionId, classId: w.c4Boys.classId, dayOfWeek: "MON", periodNumber: 5, subject: "ENG", track: "general", isBreak: false, teacherId: w.tEng, effectiveFrom: D2026_START, effectiveTo: new Date(2027, 5, 30, 23, 59, 59, 999), createdBy: w.teacher4 });
    const prevExp = new Date("2027-02-15T00:00:00.000Z");
    await ScopeGrant.updateOne({ _id: w.grants.delegation }, { $set: { expiresAt: prevExp } });
    const strip = (g: Record<string, unknown>) => ({ ...g, updatedAt: undefined });
    const slotsBefore = (JSON.parse(JSON.stringify(await RoutineSlot.find({}).sort({ _id: 1 }).lean())) as Array<Record<string, unknown>>).map(strip);
    const grantsBefore = JSON.parse(JSON.stringify(await ScopeGrant.find({}).sort({ _id: 1 }).lean()));

    await prepare();
    expect(dayKey((await RoutineSlot.findById(own._id).lean())!.effectiveTo as Date)).toBe("2027-01-02");
    const { grants: grantRows, ...otherRows } = await runRows();
    expect(Object.values(otherRows).every((n) => n > 0)).toBe(true);
    expect(grantRows).toBe(0); // the 2027 grants wait for the cut-over

    const dry = await planUndoPrepare(RUN);
    expect(dry.counts).toMatchObject({ routineSlots: 9, routineEndsCleared: 9, scheduleWindows: 2, assignmentSchedules: 1, masteryEnablements: 1, grantExpiriesCleared: 3 });
    expect(printUndo(dry)).toContain("মুছবে: কপি করা রুটিন পিরিয়ড: 9");

    await undoPrepare(RUN, w.principal);
    expect(Object.values(await runRows()).every((n) => n === 0)).toBe(true);
    // updatedAt moves on the touched rows; compare every other field
    expect((JSON.parse(JSON.stringify(await RoutineSlot.find({}).sort({ _id: 1 }).lean())) as Array<Record<string, unknown>>).map(strip)).toEqual(slotsBefore);
    expect((JSON.parse(JSON.stringify(await ScopeGrant.find({}).sort({ _id: 1 }).lean())) as Array<Record<string, unknown>>).map(strip)).toEqual((grantsBefore as Array<Record<string, unknown>>).map(strip));
    expect(await ScheduleWindow.countDocuments({ academicYearId: w.years.y2027 })).toBe(0);
    expect(await AssignmentSchedule.countDocuments({ academicYearId: w.years.y2027 })).toBe(0);
    expect(await MasteryEnablement.countDocuments({ academicYearId: w.years.y2027 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The review fixes (decisions A-J): the December workflow between prepare and cut-over
// ---------------------------------------------------------------------------------------------

describe("YC-6 fixes: the December draft", () => {
  const jan3 = new Date("2027-01-03T00:30:00+06:00");
  const teachingOf = async (teacher: Types.ObjectId, at: Date) =>
    (await composeTeacherScope(teacher.toString(), at)).scopes.filter((s) => s.kind === "teaching").map((s) => (s as { sectionId: string }).sectionId);
  const newTeacher = async (n: string, phone: string): Promise<Types.ObjectId> => (await User.create({ name: n, phone, passwordHash: "x", role: "TEACHER" }))._id;
  const cell = async (sectionId: Types.ObjectId, day: string, period: number) => (await RoutineSlot.findOne({ groupId: sectionId, groupType: "section", dayOfWeek: day, periodNumber: period }))!;

  it("a December edit of a 2027 copied cell survives a re-run; after the cut-over the old teacher keeps write where they still teach and the new one gets write (B, C, A)", async () => {
    const tU = await newTeacher("New T", "01700000421");
    await prepare();
    const c4b27 = await sec2027(4, "Boys");
    const sun = await cell(c4b27, "SUN", 1);
    await updateRoutineSlot({ slotId: sun._id.toString(), subject: "MATH", track: "general", teacherId: tU.toString(), roomId: null, actorId: w.teacher4.toString(), effectiveFrom: new Date() });
    // edited in place: still ONE row, still from 3 Jan, no zero-length twin
    expect(await RoutineSlot.countDocuments({ groupId: c4b27, dayOfWeek: "SUN", periodNumber: 1 })).toBe(1);
    const edited = await cell(c4b27, "SUN", 1);
    expect(String(edited.teacherId)).toBe(tU.toString());
    expect(dayKey(edited.effectiveFrom)).toBe("2027-01-03");
    expect(edited.effectiveTo).toBeFalsy();
    // December: still no 2027 grant for anybody
    expect(await ScopeGrant.countDocuments({ sectionId: c4b27 })).toBe(0);

    // the re-run keeps the edit and says so, in the dry run too
    const plan = await planYearChange(input());
    expect(plan.scheduleCopy.routine.notes.some((n) => n.includes("kept your edit"))).toBe(true);
    expect(plan.scheduleCopy.routine.slotsToUpdate).toBe(0);
    expect(printPlan(plan)).toContain("kept your edit");
    expect((await prepare()).total).toBe(0);
    expect(String((await cell(c4b27, "SUN", 1)).teacherId)).toBe(tU.toString());

    await applyCutover(RUN, w.principal, { allowEarly: true });
    expect(await teachingOf(w.tMath, jan3)).toContain(c4b27.toString()); // still has THU P1
    expect(await teachingOf(tU, jan3)).toContain(c4b27.toString());
    const uGrant = await ScopeGrant.findOne({ teacherId: tU, sectionId: c4b27, subjectId: w.math }).lean();
    expect(uGrant?.runId).toBe(RUN);
  });

  it("a deleted copy is not recreated on a re-run and a hand-made 2027 cell is kept (C)", async () => {
    const tEng2 = await newTeacher("Free T", "01700000422");
    await prepare();
    const c5g27 = await sec2027(5, "Girls");
    const c2m27 = await sec2027(2, "Main");
    // the Principal deletes the C5 Girls THU copy, and replaces the C2 Main SUN P1 copy with a cell of their own
    await deleteRoutineSlot((await cell(c5g27, "THU", 3))._id.toString(), w.teacher4.toString());
    expect(await RoutineSlot.countDocuments({ groupId: c5g27, dayOfWeek: "THU" })).toBe(0);
    await deleteRoutineSlot((await cell(c2m27, "SUN", 1))._id.toString(), w.teacher4.toString());
    const own = await createRoutineSlot({ groupType: "section", groupId: c2m27.toString(), dayOfWeek: "SUN", periodNumber: 1, subject: "BAN", track: "general", isBreak: false, teacherId: tEng2.toString(), effectiveFrom: new Date(), createdBy: w.teacher4.toString() });
    expect(dayKey(own.slot.effectiveFrom)).toBe("2027-01-03"); // clamped to the new routine

    const plan = await planYearChange(input());
    expect(plan.refusals).toEqual([]);
    expect(plan.scheduleCopy.routine.notes.some((n) => n.includes("you deleted it"))).toBe(true);
    expect(plan.scheduleCopy.routine.notes.some((n) => n.includes("kept your cell"))).toBe(true);
    expect(plan.scheduleCopy.routine.slotsToCreate).toBe(0);
    const again = await prepare();
    expect(again.writes.routineSlots).toBe(0);
    expect(await RoutineSlot.countDocuments({ groupId: c5g27, dayOfWeek: "THU" })).toBe(0);
    const mine = await cell(c2m27, "SUN", 1);
    expect(mine.subject).toBe("BAN");
    expect(mine.runId).toBeUndefined();
  });

  it("a 2027 AssignmentSchedule edited by hand is kept on a re-run (C)", async () => {
    await prepare();
    const sched = (await AssignmentSchedule.findOne({ academicYearId: w.years.y2027 }))!;
    await AssignmentSchedule.updateOne({ _id: sched._id }, { $pull: { entries: { cycleWeek: 2 } } });
    const plan = await planYearChange(input());
    expect(plan.scheduleCopy.assignment.keptEdit).toBe(true);
    expect(printPlan(plan)).toContain("kept your edit");
    expect((await prepare()).writes.assignmentSchedule).toBe(0);
    expect((await AssignmentSchedule.findOne({ academicYearId: w.years.y2027 }).lean())!.entries).toHaveLength(2);
  });

  it("undo-prepare after a December edit of a 2026 cell does not reopen the edited row and lists it as skipped (D)", async () => {
    const tU = await newTeacher("New T", "01700000423");
    await prepare();
    const old = await cell(w.c4Boys.sectionId, "SUN", 1);
    await updateRoutineSlot({ slotId: old._id.toString(), subject: "MATH", track: "general", teacherId: tU.toString(), roomId: null, actorId: w.teacher4.toString(), effectiveFrom: new Date() });
    expect(dayKey((await RoutineSlot.findById(old._id).lean())!.effectiveTo as Date)).toBe("2026-12-05");

    const dry = await planUndoPrepare(RUN);
    expect(dry.counts.routineEndsSkipped).toBe(1);
    expect(dry.notes.some((n) => n.includes("SUN পিরিয়ড 1") && n.includes("যেমন আছে তেমন"))).toBe(true);
    await undoPrepare(RUN, w.principal);
    // the edited (closed) row stays closed; the replacement - the cell as it is now - is open-ended again
    expect(dayKey((await RoutineSlot.findById(old._id).lean())!.effectiveTo as Date)).toBe("2026-12-05");
    const live = await RoutineSlot.find({ groupId: w.c4Boys.sectionId, dayOfWeek: "SUN", periodNumber: 1, effectiveTo: { $exists: false } }).lean();
    expect(live).toHaveLength(1);
    expect(String(live[0].teacherId)).toBe(tU.toString());
    // a row nobody touched is back to open-ended
    expect((await cell(w.c4Boys.sectionId, "THU", 1)).effectiveTo).toBeFalsy();
  });

  it("the grant lapse survives a December routine edit, and a new 2026 slot ends 2027-01-02 (E)", async () => {
    await prepare();
    const lapse = "2027-01-02T18:00:00.000Z";
    const made = await createRoutineSlot({ groupType: "section", groupId: w.c4Boys.sectionId.toString(), dayOfWeek: "MON", periodNumber: 3, subject: "MATH", track: "general", isBreak: false, teacherId: w.tMath.toString(), effectiveFrom: new Date(), createdBy: w.teacher4.toString() });
    expect(dayKey(made.slot.effectiveTo as Date)).toBe("2027-01-02");
    // the bind ran for the existing grant and left the run's lapse alone
    expect(new Date((await ScopeGrant.findById(w.grants.routine).lean() as unknown as { expiresAt: Date }).expiresAt).toISOString()).toBe(lapse);
    // the undo takes the new row's stamped end back (it recorded it)
    await undoPrepare(RUN, w.principal);
    expect((await RoutineSlot.findById(made.slot._id).lean())!.effectiveTo).toBeFalsy();
  });

  it("the cut-over ends a 2026 row and lapses a grant that a December edit left open (E)", async () => {
    await prepare();
    // a 2026 row somebody re-opened after the prepare, and its grant's lapse removed
    const row = await cell(w.c5Boys.sectionId, "THU", 1);
    await RoutineSlot.updateOne({ _id: row._id }, { $unset: { effectiveTo: 1 } });
    await ScopeGrant.updateOne({ _id: w.grants.routine }, { $unset: { expiresAt: 1 } });
    const dry = await planCutover(RUN, undefined, { allowEarly: true });
    expect(dry.copy.endsToStamp).toBe(1);
    expect(dry.copy.lapsesToStamp).toBeGreaterThan(0);
    expect(printCutover(dry)).toContain("পুরোনো রুটিন সারি শেষ করা হবে: 1");
    const cut = await applyCutover(RUN, w.principal, { allowEarly: true });
    expect(cut.writes.copyEnds).toBe(1);
    expect(dayKey((await RoutineSlot.findById(row._id).lean())!.effectiveTo as Date)).toBe("2027-01-02");
    expect(new Date((await ScopeGrant.findById(w.grants.routine).lean() as unknown as { expiresAt: Date }).expiresAt).toISOString()).toBe("2027-01-02T18:00:00.000Z");
  });

  it("an unmapped 2026 section's slots end 2027-01-02, and the second row of a duplicated cell ends and is listed (G)", async () => {
    // a 2026 class-3 "Main" section (the 2027 shape has no Main for class 3) with a slot
    const c3 = await Class.create({ level: 3, nameBn: "Class 3 (2026)", academicYearId: w.years.y2026 });
    const orphanSec = await Section.create({ classId: c3._id, code: "Main", nameBn: "মূল", active: true });
    const orphan = await RoutineSlot.create({ groupType: "section", groupId: orphanSec._id, classId: c3._id, dayOfWeek: "MON", periodNumber: 1, subject: "ENG", track: "general", isBreak: false, teacherId: w.tEng, effectiveFrom: D2026_START, createdBy: w.teacher4 });
    // a duplicate of C4 Boys SUN P1 with a later start
    const dup = await RoutineSlot.create({ groupType: "section", groupId: w.c4Boys.sectionId, classId: w.c4Boys.classId, dayOfWeek: "SUN", periodNumber: 1, subject: "ENG", track: "general", isBreak: false, teacherId: w.tEng, effectiveFrom: new Date("2026-03-01"), createdBy: w.teacher4 });
    const plan = await planYearChange(input());
    expect(plan.refusals).toEqual([]);
    expect(plan.scheduleCopy.routine.unmapped).toHaveLength(1);
    expect(plan.scheduleCopy.routine.notes.some((n) => n.includes("duplicate, ended"))).toBe(true);
    expect(plan.scheduleCopy.routine.pastToEnd).toBe(10);
    await prepare();
    expect(dayKey((await RoutineSlot.findById(orphan._id).lean())!.effectiveTo as Date)).toBe("2027-01-02");
    expect(dayKey((await RoutineSlot.findById(dup._id).lean())!.effectiveTo as Date)).toBe("2027-01-02");
    // the copy is the OLDEST row (MATH), deterministically
    const c4b27 = await sec2027(4, "Boys");
    expect((await cell(c4b27, "SUN", 1)).subject).toBe("MATH");
    expect(await RoutineSlot.countDocuments({ groupId: { $in: [orphanSec._id, w.c4Boys.sectionId, w.c5Boys.sectionId, w.c5Girls.sectionId, w.c2Main.sectionId] }, effectiveTo: { $exists: false } })).toBe(0);
  });

  it("a bell window that crosses the year boundary is clipped to the new year and warned about (H)", async () => {
    await ScheduleWindow.create({ academicYearId: w.years.y2026, fromDate: new Date("2026-12-25"), toDate: new Date("2027-01-05"), season: "winter", dayStartMinutes: 450, label: "Late winter" });
    const plan = await planYearChange(input());
    expect(plan.scheduleCopy.bellWindows.warnings.some((x) => x.includes("Late winter"))).toBe(true);
    expect(printPlan(plan)).toContain("সতর্কতা");
    await prepare();
    const wins = await ScheduleWindow.find({ academicYearId: w.years.y2027 }).sort({ fromDate: 1 }).lean();
    expect(wins).toHaveLength(3);
    const late = wins.find((x) => x.label === "Late winter")!;
    expect([dayKey(late.fromDate), dayKey(late.toDate)]).toEqual(["2027-12-25", "2027-12-31"]);
    expect(wins.every((x) => dayKey(x.fromDate).startsWith("2027") && dayKey(x.toDate).startsWith("2027"))).toBe(true);
    // a window that is entirely outside the new year after the shift is dropped
    await ScheduleWindow.create({ academicYearId: w.years.y2026, fromDate: new Date("2025-12-20"), toDate: new Date("2025-12-30"), season: "winter", dayStartMinutes: 450, label: "Before" });
    const again = await planYearChange(input());
    expect(again.scheduleCopy.bellWindows.warnings.some((x) => x.includes("Before"))).toBe(true);
  });

  it("a clash found at the apply writes nothing: no classes, sections, enrolments or run rows (I)", async () => {
    const plan = await planYearChange(input());
    expect(plan.refusals).toEqual([]); // the plan was clean
    // after the plan: a hand-made 2027 slot books Math T at SUN P1 too
    const cls = await Class.create({ level: 3, nameBn: "x", academicYearId: w.years.y2027 });
    const sec = await Section.create({ classId: cls._id, code: "Boys", nameBn: "বালক", active: true });
    await RoutineSlot.create({ groupType: "section", groupId: sec._id, classId: cls._id, dayOfWeek: "SUN", periodNumber: 1, subject: "MATH", track: "general", isBreak: false, teacherId: w.tMath, effectiveFrom: new Date("2027-01-03"), createdBy: w.teacher4 });
    const before = { classes: await Class.countDocuments(), sections: await Section.countDocuments(), enrolments: await Enrolment.countDocuments(), students: await Student.countDocuments() };
    await expect(applyPrepare(plan, RUN, w.principal)).rejects.toBeInstanceOf(YearChangeRefusal);
    expect({ classes: await Class.countDocuments(), sections: await Section.countDocuments(), enrolments: await Enrolment.countDocuments(), students: await Student.countDocuments() }).toEqual(before);
    expect(await YearChangeRun.countDocuments({})).toBe(0);
    expect(await Audit.countDocuments({ eventKind: "YEAR_CHANGE_PREPARED" })).toBe(0);
  });

  it("a Class 6 slot added in December with 'today' as its date starts 2027-01-03, and grants nothing until the cut-over (B, A)", async () => {
    await prepare();
    const c6 = await sec2027(6, "Boys");
    const made = await createRoutineSlot({ groupType: "section", groupId: c6.toString(), dayOfWeek: "MON", periodNumber: 2, subject: "MATH", track: "general", isBreak: false, teacherId: w.tEng.toString(), effectiveFrom: new Date(), createdBy: w.teacher4.toString() });
    expect(dayKey(made.slot.effectiveFrom)).toBe("2027-01-03");
    expect(made.slot.effectiveTo).toBeFalsy();
    expect(made.warnings).toEqual([]);
    expect(await ScopeGrant.countDocuments({ sectionId: c6 })).toBe(0);
    // an edit with 'today' stays in place too (no yesterday-close: effectiveTo would sit before effectiveFrom)
    await updateRoutineSlot({ slotId: made.slot._id.toString(), subject: "MATH", track: "general", teacherId: w.tBan.toString(), roomId: null, actorId: w.teacher4.toString(), effectiveFrom: new Date() });
    const row = (await RoutineSlot.find({ groupId: c6 }).lean());
    expect(row).toHaveLength(1);
    expect(row[0].effectiveTo).toBeFalsy();
    await applyCutover(RUN, w.principal, { allowEarly: true });
    expect(await teachingOf(w.tBan, jan3)).toContain(c6.toString());
  });

  it("no chat group is made for a 2027 section in December; the cut-over makes them (F)", async () => {
    await prepare();
    const c4b27 = await sec2027(4, "Boys");
    const tU = await newTeacher("New T", "01700000424");
    const sun = await cell(c4b27, "SUN", 1);
    await updateRoutineSlot({ slotId: sun._id.toString(), subject: "MATH", track: "general", teacherId: tU.toString(), roomId: null, actorId: w.teacher4.toString(), effectiveFrom: new Date() });
    const secGroups = async () => Conversation.countDocuments({ kind: "SECTION", refId: { $in: [c4b27.toString(), (await sec2027(5, "Boys")).toString()] } });
    expect(await secGroups()).toBe(0);
    await applyCutover(RUN, w.principal, { allowEarly: true });
    expect(await secGroups()).toBe(2);
  });

  it("the unbind does not orphan a teacher who has a row starting later in the same section + subject (A)", async () => {
    // tMath has MATH in C4 Boys from 2026 and a copy from 3 Jan; retiring the 2026 SUN row from today keeps the grant
    const future = await RoutineSlot.create({ groupType: "section", groupId: w.c4Boys.sectionId, classId: w.c4Boys.classId, dayOfWeek: "MON", periodNumber: 4, subject: "MATH", track: "general", isBreak: false, teacherId: w.tMath, effectiveFrom: new Date("2026-12-20"), createdBy: w.teacher4 });
    expect(future._id).toBeDefined();
    await deleteRoutineSlot((await cell(w.c4Boys.sectionId, "SUN", 1))._id.toString(), w.teacher4.toString());
    await deleteRoutineSlot((await cell(w.c4Boys.sectionId, "THU", 1))._id.toString(), w.teacher4.toString());
    expect((await ScopeGrant.findById(w.grants.routine).lean())!.active).toBe(true); // the MON row starting 20 Dec still justifies it
  });
});

// ---------------------------------------------------------------------------------------------
// Fix round 2 (nine reviewer gaps)
// ---------------------------------------------------------------------------------------------

describe("YC-6 fix round 2", () => {
  const jan3 = new Date("2027-01-03T00:30:00+06:00");
  const newTeacher = async (n: string, phone: string): Promise<Types.ObjectId> => (await User.create({ name: n, phone, passwordHash: "x", role: "TEACHER" }))._id;
  const cell = async (sectionId: Types.ObjectId, day: string, period: number) => (await RoutineSlot.findOne({ groupId: sectionId, groupType: "section", dayOfWeek: day, periodNumber: period }))!;
  const edit = async (slotId: Types.ObjectId, teacher: Types.ObjectId, from: Date) =>
    updateRoutineSlot({ slotId: slotId.toString(), subject: (await RoutineSlot.findById(slotId))!.subject as "MATH", track: "general", teacherId: teacher.toString(), roomId: null, actorId: w.teacher4.toString(), effectiveFrom: from });

  it("1. a 2026 cell changed on 15 Dec to a teacher who is already booked in the 2027 draft does not block the cut-over (only a real 2027 clash does)", async () => {
    const tU = await newTeacher("New T", "01700000431");
    await prepare();
    // the 2027 draft: U takes C4 Boys SUN P1
    await edit((await cell(await sec2027(4, "Boys"), "SUN", 1))._id, tU, new Date());
    // 15 Dec: the 2026 C5 Boys SUN P1 (BAN, Ban T) goes to U - the copy would clash with U in the draft
    await edit((await cell(w.c5Boys.sectionId, "SUN", 1))._id, tU, new Date("2026-12-15T10:00:00+06:00"));
    const dry = await planCutover(RUN, undefined, { allowEarly: true });
    expect(dry.refusals).toEqual([]);
    expect(dry.copy.lines.some((l) => l.includes("প্রস্তুতি আবার চালালে"))).toBe(true); // drift is a report line
    await expect(applyCutover(RUN, w.principal, { allowEarly: true })).resolves.toBeDefined();
    // ... while a REAL clash among the 2027 rows still refuses: hand-make one on the live DB
    await undoCutover(RUN, w.principal);
    const c2m27 = await sec2027(2, "Main");
    const c5b27 = await sec2027(5, "Boys");
    await RoutineSlot.create({ groupType: "section", groupId: c2m27, classId: (await Section.findById(c2m27))!.classId, dayOfWeek: "SUN", periodNumber: 3, subject: "BAN", track: "general", isBreak: false, teacherId: w.tBan, effectiveFrom: new Date("2027-01-03"), createdBy: w.teacher4 });
    await RoutineSlot.create({ groupType: "section", groupId: c5b27, classId: (await Section.findById(c5b27))!.classId, dayOfWeek: "SUN", periodNumber: 3, subject: "BAN", track: "general", isBreak: false, teacherId: w.tBan, effectiveFrom: new Date("2027-01-03"), createdBy: w.teacher4 });
    await expect(applyCutover(RUN, w.principal, { allowEarly: true })).rejects.toBeInstanceOf(YearChangeRefusal);
  });

  it("2. a re-bind after a future-dated unbind restores the run's 3 Jan lapse", async () => {
    await prepare();
    const lapse = "2027-01-02T18:00:00.000Z";
    // 10 Dec: Math T is taken off C4 Boys from 15 Dec -> the unbind stamps 15 Dec on the grant
    await deleteRoutineSlot((await cell(w.c4Boys.sectionId, "SUN", 1))._id.toString(), w.teacher4.toString(), new Date("2026-12-15T10:00:00+06:00"));
    await deleteRoutineSlot((await cell(w.c4Boys.sectionId, "THU", 1))._id.toString(), w.teacher4.toString(), new Date("2026-12-15T10:00:00+06:00"));
    const moved = new Date((await ScopeGrant.findById(w.grants.routine).lean() as unknown as { expiresAt: Date }).expiresAt);
    expect(moved.toISOString()).not.toBe(lapse);
    // 12 Dec: a new period binds the grant again
    await createRoutineSlot({ groupType: "section", groupId: w.c4Boys.sectionId.toString(), dayOfWeek: "MON", periodNumber: 3, subject: "MATH", track: "general", isBreak: false, teacherId: w.tMath.toString(), effectiveFrom: new Date("2026-12-12T10:00:00+06:00"), createdBy: w.teacher4.toString() });
    expect(new Date((await ScopeGrant.findById(w.grants.routine).lean() as unknown as { expiresAt: Date }).expiresAt).toISOString()).toBe(lapse);
  });

  it("3. undo-prepare deletes every routine row on the sections it deletes (hand-made Class 6 rows, edited copies) and lists them", async () => {
    const tU = await newTeacher("New T", "01700000432");
    await prepare();
    const c6 = await sec2027(6, "Boys");
    for (const [day, p] of [["MON", 2], ["TUE", 2]] as const) {
      await createRoutineSlot({ groupType: "section", groupId: c6.toString(), dayOfWeek: day, periodNumber: p, subject: "MATH", track: "general", isBreak: false, teacherId: w.tEng.toString(), effectiveFrom: new Date(), createdBy: w.teacher4.toString() });
    }
    await edit((await cell(await sec2027(4, "Boys"), "SUN", 1))._id, tU, new Date());
    const dry = await planUndoPrepare(RUN);
    expect(dry.notes.filter((n) => n.includes("will be deleted")).length).toBe(3); // 2 hand-made + 1 edited copy
    await undoPrepare(RUN, w.principal);
    expect(await RoutineSlot.countDocuments({ groupId: c6 })).toBe(0);
    const sectionIds = new Set((await Section.find({}).select("_id").lean()).map((s) => String(s._id)));
    const orphans = (await RoutineSlot.find({ groupType: "section" }).select("groupId").lean()).filter((r) => !sectionIds.has(String(r.groupId)));
    expect(orphans).toHaveLength(0);
  });

  it("4. a Class 6 slot created on 1 Jan with today's date starts 3 Jan and does not clash", async () => {
    await prepare();
    jest.setSystemTime(new Date("2027-01-01T10:00:00+06:00"));
    const c6 = await sec2027(6, "Boys");
    const made = await createRoutineSlot({ groupType: "section", groupId: c6.toString(), dayOfWeek: "MON", periodNumber: 2, subject: "MATH", track: "general", isBreak: false, teacherId: w.tEng.toString(), effectiveFrom: new Date(), createdBy: w.teacher4.toString() });
    expect(dayKey(made.slot.effectiveFrom)).toBe("2027-01-03");
  });

  it("5. a deleted copy stays deleted after its 2026 source is edited", async () => {
    const tU = await newTeacher("New T", "01700000433");
    await prepare();
    const c5g27 = await sec2027(5, "Girls");
    await deleteRoutineSlot((await cell(c5g27, "THU", 3))._id.toString(), w.teacher4.toString());
    // December: the 2026 source is edited (a new row id replaces it)
    await edit((await cell(w.c5Girls.sectionId, "THU", 3))._id, tU, new Date());
    const plan = await planYearChange(input());
    expect(plan.scheduleCopy.routine.notes.some((n) => n.includes("you deleted it"))).toBe(true);
    await prepare();
    expect(await RoutineSlot.countDocuments({ groupId: c5g27, dayOfWeek: "THU" })).toBe(0);
  });

  it("7. a December reassign of a subject's teacher works on a 2027 section", async () => {
    const tU = await newTeacher("New T", "01700000434");
    await prepare();
    const c4b27 = await sec2027(4, "Boys");
    const r = await reassignRoutineSubjectTeacher(c4b27.toString(), "MATH", tU.toString(), w.teacher4.toString());
    expect(r.updatedSlots).toBe(2);
    const rows = await RoutineSlot.find({ groupId: c4b27, subject: "MATH" }).lean();
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => String(x.teacherId) === tU.toString() && !x.effectiveTo && dayKey(x.effectiveFrom) === "2027-01-03")).toBe(true);
    // the draft edit is not a "mistake" note (the row never applied)
    expect(await StaffMistakeNote.countDocuments({ refKey: { $in: rows.map((x) => String(x._id)) } })).toBe(0);
  });

  it("9. undo-cutover leaves no active 2027 routine grant (also ones bound after the cut-over) and archives the 2027 section groups", async () => {
    await prepare();
    await applyCutover(RUN, w.principal, { allowEarly: true });
    const run = (await YearChangeRun.findOne({ runId: RUN }).lean())!;
    expect(run.chatGroupsCreated.length).toBeGreaterThan(0);
    // after the cut-over the 2027 year is current: a new period binds a grant (no run id on it)
    const c6 = await sec2027(6, "Boys");
    await createRoutineSlot({ groupType: "section", groupId: c6.toString(), dayOfWeek: "MON", periodNumber: 2, subject: "MATH", track: "general", isBreak: false, teacherId: w.tEng.toString(), effectiveFrom: new Date("2027-01-04"), createdBy: w.teacher4.toString() });
    const secs2027 = (await Section.find({ classId: { $in: (await Class.find({ academicYearId: w.years.y2027 }).select("_id").lean()).map((x) => x._id) } }).select("_id").lean()).map((x) => x._id);
    expect(await ScopeGrant.countDocuments({ sectionId: { $in: secs2027 }, kind: "teaching", active: true })).toBeGreaterThan(6);
    const dry = await planUndoCutover(RUN);
    expect(dry.counts.grantsBoundAfterCutover).toBe(1);
    await undoCutover(RUN, w.principal);
    expect(await ScopeGrant.countDocuments({ sectionId: { $in: secs2027 }, kind: "teaching", active: true })).toBe(0);
    expect(await Conversation.countDocuments({ _id: { $in: run.chatGroupsCreated.map((x) => new Types.ObjectId(x)) }, active: true })).toBe(0);
  });
});

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
