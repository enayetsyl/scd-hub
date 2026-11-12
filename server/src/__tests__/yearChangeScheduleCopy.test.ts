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
 *   undo       0 rows with the run id, the 2026 ends and expiries put back
 *   readers    every today-reader unchanged before the cut-over
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
import { slotsForDate, slotsForTeacherOnDate } from "../modules/routine/services/RoutineSlotService";
import { handoutBoard } from "../modules/trackers/services/AssignmentHandoutService";
import {
  YearChangeRefusal,
  YearChangeRun,
  applyCutover,
  applyPrepare,
  planYearChange,
  planUndoPrepare,
  printPlan,
  printUndo,
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
  it("2027 teachers hold their grants from 3 Jan; the 2026 routine grant lapses then", async () => {
    const r = await prepare();
    expect(r.writes.grants).toBeGreaterThan(0);
    const c4b27 = await sec2027(4, "Boys");
    const jan3 = new Date("2027-01-03T00:30:00+06:00");
    const dec = new Date("2026-12-06T10:00:00+06:00");
    const teaching = (scopes: Awaited<ReturnType<typeof composeTeacherScope>>["scopes"]) => scopes.filter((s) => s.kind === "teaching").map((s) => (s as { sectionId: string }).sectionId);
    const atJan3 = (await composeTeacherScope(w.tMath.toString(), jan3)).scopes;
    expect(teaching(atJan3)).toContain(c4b27.toString());
    expect(teaching(atJan3)).not.toContain(w.c4Boys.sectionId.toString());
    const old = (await ScopeGrant.findById(w.grants.routine).lean())!;
    expect(new Date((old as unknown as { expiresAt: Date }).expiresAt).toISOString()).toBe("2027-01-02T18:00:00.000Z");
    // before 3 Jan the 2026 grant still works
    expect(teaching((await composeTeacherScope(w.tMath.toString(), dec)).scopes)).toContain(w.c4Boys.sectionId.toString());
    // the 2027 grants carry the run id and the routine source
    const made = await ScopeGrant.find({ runId: RUN, kind: "teaching" }).lean();
    expect(made.every((g) => g.source === "routine" && g.active)).toBe(true);
    expect(made).toHaveLength(6);
  });

  it("supervisory and delegation grants on a 2026 class are re-pointed to the same-level 2027 class", async () => {
    await prepare();
    const c4_27 = (await Class.findOne({ level: 4, academicYearId: w.years.y2027 }))!._id;
    const c5_27 = (await Class.findOne({ level: 5, academicYearId: w.years.y2027 }))!._id;
    const jan3 = new Date("2027-01-03T00:30:00+06:00");
    const dec = new Date("2026-12-06T10:00:00+06:00");
    const scopes = (await composeTeacherScope(w.teacherOther.toString(), jan3)).scopes;
    const sup = scopes.filter((s) => s.kind === "supervisory").map((s) => (s as { classId?: string }).classId);
    expect(sup).toEqual([c4_27.toString()]); // no 2026 read any more
    const del = scopes.filter((s) => s.kind === "delegation").flatMap((s) => (s as { explicitSet?: Array<{ classId: string }> }).explicitSet?.map((e) => e.classId) ?? []);
    expect(del).toEqual([c5_27.toString()]);
    // in December the 2026 grants still read
    const decSup = (await composeTeacherScope(w.teacherOther.toString(), dec)).scopes.filter((s) => s.kind === "supervisory").map((s) => (s as { classId?: string }).classId);
    expect(decSup).toContain(w.c4Boys.classId.toString());
    // the clones are tagged and linked
    const clones = await ScopeGrant.find({ runId: RUN, repointedFrom: { $exists: true } }).lean();
    expect(clones).toHaveLength(2);
    expect(clones.map((g) => String(g.repointedFrom)).sort()).toEqual([w.grants.supervisory.toString(), w.grants.delegation.toString()].sort());
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
    expect(Object.values(await runRows()).every((n) => n > 0)).toBe(true);

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

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
