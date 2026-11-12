/**
 * YC-4 - the year-change engine (docs/prd-year-change.md section 3 + section 5 row "YC-4").
 *
 *   plan      the dry run lists exact counts, refusals and a Bangla printout; it writes nothing
 *   prepare   writes PLANNED rows only (every today-reader unchanged, snapshot), re-run = 0 writes
 *   cut-over  Office refused; refusals write nothing; a promoted child, a repeater, a leaver and two
 *             Class 6 admissions land correctly; current year = 2027; re-run = 0; a broken run is finished
 *   undo      undo-cutover restores the Student rows byte for byte; undo-prepare leaves 0 rows with the
 *             run id and puts a pre-existing section's class teacher back
 *   retire    past-year sections go inactive only on request, idempotently
 *
 * Real services on in-memory Mongo.
 * TODO (YC-6): slot dating - 2026 routine slots end 2027-01-02, 2027 slots start 2027-01-03, 0 conflicts.
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
import { Audit } from "../modules/platform/models/Audit";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { ImprovementAction } from "../modules/improvement/models/ImprovementAction";
import { checkInvariant, sectionRoster } from "../modules/foundation/services/EnrolmentService";
import { currentYearFilter, currentYearSectionFilter } from "../modules/foundation/services/currentYear";
import { ForbiddenError } from "../middleware/authz";
import {
  YearChangeRefusal,
  YearChangeRun,
  applyCutover,
  applyPrepare,
  planCutover,
  planUndoCutover,
  planYearChange,
  printCutover,
  printPlan,
  printUndo,
  retirePastYearSections,
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

let w: EngineWorld;
beforeEach(async () => {
  await clearYearChangeFixtures();
  await Promise.all(
    [User, Guardian, GuardianLink, ClassTeacherAssignment, HomeworkItem, ImprovementAction, YearChangeRun, Audit].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
  w = await seedEngineWorld();
});

const RUN = "yc-test-1";
const input = (): PlanInput => ({
  fromYearId: w.years.y2026.toString(),
  toYearId: w.years.y2027.toString(),
  promotions: w.promotions,
  admissions: w.admissions,
});
const prepare = async (runId = RUN) => applyPrepare(await planYearChange(input()), runId, w.principal);
const rowsWithRun = async (runId = RUN): Promise<Record<string, number>> => ({
  classes: await Class.countDocuments({ runId }),
  sections: await Section.countDocuments({ runId }),
  enrolments: await Enrolment.countDocuments({ runId }),
  students: await Student.countDocuments({ yearChangeRunId: runId }),
  runs: await YearChangeRun.countDocuments({ runId }),
});

/** What every "today" reader looks at. */
async function todaySnapshot(): Promise<unknown> {
  const rosters: Record<string, string[]> = {};
  for (const s of await Section.find(await currentYearSectionFilter()).sort({ _id: 1 }).lean()) {
    rosters[s._id.toString()] = (await sectionRoster(s._id)).map((e) => `${e.studentId}:${e.status}:${e.startKey}:${e.endKey ?? ""}`);
  }
  return JSON.parse(
    JSON.stringify({
      students: await Student.find({ active: true }).sort({ schoolId: 1 }).lean(),
      classes: await Class.find(await currentYearFilter()).sort({ _id: 1 }).lean(),
      sections: await Section.find(await currentYearSectionFilter()).sort({ _id: 1 }).lean(),
      rosters,
      invariant: await checkInvariant(),
    }),
  );
}

describe("YC-4: planYearChange (the dry run)", () => {
  it("lists exact counts per class and writes nothing", async () => {
    const before = await Promise.all([Class.countDocuments(), Section.countDocuments(), Enrolment.countDocuments(), Student.countDocuments()]);
    const plan = await planYearChange(input());
    expect(plan.refusals).toEqual([]);
    expect(plan.startKey).toBe("2027-01-01");
    expect(plan.closeKey).toBe("2026-12-31");
    expect(plan.counts).toEqual({
      classesToCreate: 5, // levels 2,3,4,5,6
      sectionsToCreate: 9, // C2 Main + 2 each for C3..C6
      enrolmentsToCreate: 5, // 4 promoted + 1 repeater
      enrolmentsExisting: 0,
      promoted: 4,
      repeaters: 1,
      left: 2,
      admissionsToCreate: 2,
      admissionsExisting: 0,
      classTeachersToSet: 1, // C4 Boys teacher carried over
    });
    const byLevel = Object.fromEntries(plan.classes.map((c) => [c.level, c]));
    expect(byLevel[2].total).toBe(1); // the repeater
    expect(byLevel[3].total).toBe(1); // C2 boy -> C3 Boys
    expect(byLevel[3].sections.map((s) => [s.code, s.children])).toEqual([["Boys", 1], ["Girls", 0]]);
    expect(byLevel[5].total).toBe(1); // C4 boy -> C5 Boys
    expect(byLevel[6].total).toBe(4); // C5 girl + C5 boy + 2 admissions
    expect(byLevel[6].sections.map((s) => [s.code, s.children])).toEqual([["Boys", 2], ["Girls", 2]]);
    expect(byLevel[6].admissions).toBe(2);
    expect(byLevel[4].left).toBe(1);
    expect(byLevel[5].left).toBe(1);
    expect(plan.classTeachers).toEqual([{ level: 4, sectionCode: "Boys", teacherId: w.teacher4.toString(), source: "PREFILLED", alreadySet: false }]);
    // C5 -> C6 by default, the repeater stays, section by gender
    const row = (id: Types.ObjectId) => plan.enrolments.find((e) => e.studentId === id.toString())!;
    expect(row(w.c5Girl)).toMatchObject({ toLevel: 6, toSectionCode: "Girls", outcome: "PROMOTED" });
    expect(row(w.c2Up)).toMatchObject({ toLevel: 3, toSectionCode: "Boys" });
    expect(row(w.c2Repeat)).toMatchObject({ toLevel: 2, toSectionCode: "Main", outcome: "REPEATED" });
    expect(await Promise.all([Class.countDocuments(), Section.countDocuments(), Enrolment.countDocuments(), Student.countDocuments()])).toEqual(before);
  });

  it("prints Bangla labels with no roll numbers, and refuses what cannot be done", async () => {
    const text = printPlan(await planYearChange(input()));
    expect(text).toContain("শিক্ষাবর্ষ পরিবর্তন");
    expect(text).toContain("বালিকা");
    expect(text).toContain("T-E1");
    expect(text).not.toMatch(/roll|রোল/i);

    const bad = await planYearChange({
      ...input(),
      promotions: [{ studentId: new Types.ObjectId().toString(), decision: "PROMOTE" }],
      admissions: [{ ...w.admissions[0], schoolId: "T-E1" }, { ...w.admissions[1], schoolId: "T-A9" }, { ...w.admissions[1], schoolId: "T-A9" }],
    });
    expect(bad.refusals.some((r) => r.includes("T-E1"))).toBe(true); // school ID already used
    expect(bad.refusals.some((r) => r.includes("দুইবার"))).toBe(true); // duplicate in the list
    expect(bad.refusals.some((r) => r.includes("সক্রিয় নয়"))).toBe(true); // unknown child
    await expect(applyPrepare(bad, "yc-bad", w.principal)).rejects.toBeInstanceOf(YearChangeRefusal);

    // a Class 6 child cannot be promoted to a class that does not exist
    const six = await Student.create({ schoolId: "T-S6", name: "Six", gender: "male", classId: w.c5Boys.classId, sectionId: w.c5Boys.sectionId, active: true });
    const c6 = await Class.create({ level: 6, nameBn: "ষষ্ঠ", academicYearId: w.years.y2026 });
    const c6s = await Section.create({ classId: c6._id, code: "Boys", nameBn: "বালক" });
    await Student.updateOne({ _id: six._id }, { $set: { classId: c6._id, sectionId: c6s._id } });
    const top = await planYearChange(input());
    expect(top.refusals.some((r) => r.includes("T-S6"))).toBe(true);
    // ... until the Principal marks the child as left
    const fine = await planYearChange({ ...input(), promotions: [...w.promotions, { studentId: six._id.toString(), decision: "LEFT" }] });
    expect(fine.refusals).toEqual([]);
  });

  it("honours a changed class shape and a chosen class teacher", async () => {
    const plan = await planYearChange({
      ...input(),
      classPlan: [{ level: 3, sections: ["Main"] }],
      classTeachers: [{ level: 4, sectionCode: "Boys", teacherId: w.teacherOther.toString() }],
    });
    expect(plan.refusals).toEqual([]);
    expect(plan.classes.find((c) => c.level === 3)!.sections.map((s) => s.code)).toEqual(["Main"]);
    expect(plan.classTeachers[0]).toMatchObject({ teacherId: w.teacherOther.toString(), source: "CHOSEN" });
    const odd = await planYearChange({ ...input(), classPlan: [{ level: 3, sections: ["Main", "Boys"] }] });
    expect(odd.refusals.length).toBeGreaterThan(0);
  });
});

describe("YC-4: applyPrepare", () => {
  it("writes PLANNED rows only: every today-reader gives the same output", async () => {
    const before = await todaySnapshot();
    const r = await prepare();
    expect(r.writes).toMatchObject({ run: 1, classes: 5, sections: 9, enrolments: 7, admissions: 2, classTeachers: 1 });
    expect(await todaySnapshot()).toEqual(before);

    const planned = await Enrolment.find({ runId: RUN }).lean();
    expect(planned).toHaveLength(7);
    expect(planned.every((e) => e.status === "PLANNED" && e.startKey === "2027-01-01")).toBe(true);
    expect(await Student.countDocuments({ yearChangeRunId: RUN, active: false })).toBe(2);
    // pointers of the real children untouched
    const up = await Student.findById(w.c2Up).lean();
    expect(up!.sectionId.toString()).toBe(w.c2Main.sectionId.toString());
    const sec = await Section.findOne({ runId: RUN, code: "Boys", classId: (await Class.findOne({ level: 4, runId: RUN }))!._id }).lean();
    expect(sec!.classTeacherId!.toString()).toBe(w.teacher4.toString());
    expect(await Audit.countDocuments({ eventKind: "YEAR_CHANGE_PREPARED" })).toBe(1);
  });

  it("links an admission to a guardian who already has a login", async () => {
    const g = await Guardian.create({ identifierKind: "phone", identifier: "01800000001", name: "Parent", phone: "01800000001", loginEnabled: true, active: true });
    await prepare();
    const adm = await Student.findOne({ schoolId: "T-A1" }).lean();
    expect(await GuardianLink.countDocuments({ guardianId: g._id, studentId: adm!._id })).toBe(1);
    expect(adm!.phone).toBe("01800000001");
  });

  it("is idempotent: a re-run writes 0", async () => {
    await prepare();
    const rows = await rowsWithRun();
    const again = await prepare();
    expect(again.total).toBe(0);
    expect(await rowsWithRun()).toEqual(rows);
    expect(await Audit.countDocuments({ eventKind: "YEAR_CHANGE_PREPARED" })).toBe(1);
    // the plan itself recognises what exists
    const plan = await planYearChange(input());
    expect(plan.counts).toMatchObject({ classesToCreate: 0, sectionsToCreate: 0, enrolmentsToCreate: 0, admissionsToCreate: 0, classTeachersToSet: 0 });
  });

  it("refuses an Office user and writes nothing", async () => {
    const plan = await planYearChange(input());
    await expect(applyPrepare(plan, RUN, w.office)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await Class.countDocuments({ academicYearId: w.years.y2027 })).toBe(0);
    expect(await YearChangeRun.countDocuments()).toBe(0);
  });
});

describe("YC-4: applyCutover", () => {
  it("refuses an Office user", async () => {
    await prepare();
    await expect(applyCutover(RUN, w.office)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await AcademicYear.findById(w.years.y2026))!.current).toBe(true);
  });

  it("refuses (and writes nothing) while homework is unissued, then runs once it is issued", async () => {
    await prepare();
    await HomeworkItem.collection.insertOne({ sectionId: w.c4Boys.sectionId, classId: w.c4Boys.classId, status: "declared", hwId: "HW-X-1" });
    const dry = await planCutover(RUN);
    expect(dry.refusals.some((r) => r.includes("বাড়ির কাজ"))).toBe(true);
    await expect(applyCutover(RUN, w.principal)).rejects.toBeInstanceOf(YearChangeRefusal);
    expect((await AcademicYear.findById(w.years.y2026))!.current).toBe(true);
    expect(await Enrolment.countDocuments({ status: "CLOSED" })).toBe(0);
    expect((await YearChangeRun.findOne({ runId: RUN }))!.status).toBe("PREPARED");
    await HomeworkItem.collection.updateMany({}, { $set: { status: "issued" } });
    expect((await planCutover(RUN)).refusals).toEqual([]);
  });

  it("refuses a child who was admitted after the preparation", async () => {
    await prepare();
    await Student.create({ schoolId: "T-LATE", name: "Late", gender: "male", classId: w.c2Main.classId, sectionId: w.c2Main.sectionId, active: true });
    const dry = await planCutover(RUN);
    expect(dry.refusals.some((r) => r.includes("T-LATE"))).toBe(true);
  });

  it("moves a promoted child, a repeater, a leaver and two Class 6 admissions; flips the year last", async () => {
    await prepare();
    await ImprovementAction.collection.insertMany([
      { scope: "CLASS", sectionId: w.c4Boys.sectionId, classId: w.c4Boys.classId, subject: "BAN", repeat: "NONE", days: 3, startKey: "2026-12-28", dayKeys: ["2026-12-28", "2027-01-03", "2027-01-04"], stoppedAt: null },
      { scope: "CLASS", sectionId: w.c4Boys.sectionId, classId: w.c4Boys.classId, subject: "ENG", repeat: "NONE", days: 1, startKey: "2026-12-10", dayKeys: ["2026-12-10"], stoppedAt: null },
    ]);
    const dry = await planCutover(RUN, w.principal);
    expect(dry).toMatchObject({ promoted: 4, repeated: 1, left: 2, admitted: 2, activating: 7, scholarshipCleared: 3, improvementToEnd: 1, refusals: [] });
    expect(printCutover(dry)).toContain("চলতি বর্ষ");

    const r = await applyCutover(RUN, w.principal);
    expect(r.writes).toMatchObject({ enrolmentsClosed: 7, enrolmentsActivated: 7, improvementEnded: 1, yearFlipped: 1 });
    expect((await AcademicYear.findById(w.years.y2027))!.current).toBe(true);
    expect((await AcademicYear.findById(w.years.y2026))!.current).toBe(false);

    const open = async (id: Types.ObjectId) => (await Student.findById(id).lean())!;
    const levelOf = async (s: { classId: Types.ObjectId }) => (await Class.findById(s.classId).lean())!.level;
    const codeOf = async (s: { sectionId: Types.ObjectId }) => (await Section.findById(s.sectionId).lean())!.code;
    // promoted C2 boy -> C3 Boys
    let s = await open(w.c2Up);
    expect([await levelOf(s), await codeOf(s), s.active]).toEqual([3, "Boys", true]);
    // repeater stays in C2, now the 2027 Main section
    s = await open(w.c2Repeat);
    expect([await levelOf(s), await codeOf(s), s.active]).toEqual([2, "Main", true]);
    expect(s.sectionId.toString()).not.toBe(w.c2Main.sectionId.toString());
    // leaver inactive, pointer still on the old section
    s = await open(w.c4Leaver);
    expect(s.active).toBe(false);
    // Class 5 -> Class 6 by gender; the scholarship flag is cleared for both and for the Class 5 leaver
    s = await open(w.c5Girl);
    expect([await levelOf(s), await codeOf(s), s.scholarshipExcluded]).toEqual([6, "Girls", undefined]);
    s = await open(w.c5Boy);
    expect([await levelOf(s), await codeOf(s), s.scholarshipExcluded]).toEqual([6, "Boys", undefined]);
    expect((await open(w.c5Leaver)).scholarshipExcluded).toBeUndefined();
    // admissions are active in Class 6
    for (const [sid, code] of [["T-A1", "Boys"], ["T-A2", "Girls"]] as const) {
      const a = (await Student.findOne({ schoolId: sid }).lean())!;
      expect([await levelOf(a), await codeOf(a), a.active]).toEqual([6, code, true]);
    }
    // enrolments
    const old = await Enrolment.find({ academicYearId: w.years.y2026 }).lean();
    expect(old.every((e) => e.status === "CLOSED" && e.endKey === "2026-12-31")).toBe(true);
    expect(Object.fromEntries(old.map((e) => [e.studentId.toString(), e.outcome]))).toMatchObject({
      [w.c2Up.toString()]: "PROMOTED",
      [w.c2Repeat.toString()]: "REPEATED",
      [w.c4Leaver.toString()]: "LEFT",
      [w.c5Leaver.toString()]: "LEFT",
    });
    const fresh = await Enrolment.find({ academicYearId: w.years.y2027 }).lean();
    expect(fresh).toHaveLength(7);
    expect(fresh.every((e) => e.status === "ACTIVE" && e.startKey === "2027-01-01")).toBe(true);
    expect(await checkInvariant()).toEqual([]);
    // improvement action that ran into 2027 stopped, the finished one left alone; 2026 sections stay active
    expect(await ImprovementAction.countDocuments({ stoppedAt: { $ne: null } })).toBe(1);
    expect(await Section.countDocuments({ classId: { $in: [w.c2Main.classId, w.c4Boys.classId] }, active: true })).toBe(2);
    const audit = (await Audit.findOne({ eventKind: "YEAR_CHANGE_CUT_OVER" }).lean()) as unknown as { meta: { runId: string; before: unknown[] } };
    expect(audit.meta.runId).toBe(RUN);
    expect(audit.meta.before).toHaveLength(9); // 7 children + 2 admissions
  });

  it("a re-run writes 0", async () => {
    await prepare();
    await applyCutover(RUN, w.principal);
    const snap = JSON.stringify(await Student.find({}).sort({ schoolId: 1 }).lean());
    const again = await applyCutover(RUN, w.principal);
    expect(again.total).toBe(0);
    expect(JSON.stringify(await Student.find({}).sort({ schoolId: 1 }).lean())).toBe(snap);
    expect(await Audit.countDocuments({ eventKind: "YEAR_CHANGE_CUT_OVER" })).toBe(1);
  });

  it("finishes a broken run (killed after closing some enrolments and moving one child)", async () => {
    await prepare();
    // simulate the first half of a crashed cut-over: before-state saved, two old rows closed, one pointer moved
    const run = (await YearChangeRun.findOne({ runId: RUN }))!;
    const all = await Student.find({}).lean();
    run.before = all
      .filter((s) => s.yearChangeRunId === RUN || ["T-E1", "T-E2", "T-E3", "T-E4", "T-E5", "T-E6", "T-E7"].includes(s.schoolId))
      .map((s) => ({ studentId: s._id.toString(), classId: s.classId.toString(), sectionId: s.sectionId.toString(), active: s.active, ...(s.scholarshipExcluded !== undefined ? { scholarshipExcluded: s.scholarshipExcluded } : {}) }));
    run.status = "CUTTING_OVER";
    await run.save();
    for (const id of [w.c2Up, w.c4Up]) {
      await Enrolment.updateOne({ studentId: id, academicYearId: w.years.y2026 }, { $set: { status: "CLOSED", endKey: "2026-12-31", outcome: "PROMOTED" } });
    }
    const to = (await Enrolment.findOne({ studentId: w.c2Up, runId: RUN }).lean())!;
    await Enrolment.updateOne({ _id: to._id }, { $set: { status: "ACTIVE" } });
    await Student.updateOne({ _id: w.c2Up }, { $set: { classId: to.classId, sectionId: to.sectionId } });

    const r = await applyCutover(RUN, w.principal);
    expect(r.writes.enrolmentsClosed).toBe(5); // the 5 still open
    expect(r.writes.enrolmentsActivated).toBe(6);
    expect(r.writes.yearFlipped).toBe(1);
    expect(await checkInvariant()).toEqual([]);
    expect((await Student.findById(w.c4Up).lean())!.sectionId.toString()).not.toBe(w.c4Boys.sectionId.toString());
    expect((await Enrolment.findOne({ studentId: w.c4Up, academicYearId: w.years.y2026 }).lean())!.outcome).toBe("PROMOTED");
    expect((await applyCutover(RUN, w.principal)).total).toBe(0);
  });
});

describe("YC-4: undo", () => {
  it("undoCutover restores the Student rows byte for byte and the current year", async () => {
    await prepare();
    await ImprovementAction.collection.insertOne({ scope: "CLASS", sectionId: w.c4Boys.sectionId, classId: w.c4Boys.classId, subject: "BAN", repeat: "NONE", days: 2, startKey: "2026-12-28", dayKeys: ["2027-01-03", "2027-01-04"], stoppedAt: null });
    const studentsBefore = JSON.stringify(await Student.find({}).sort({ schoolId: 1 }).lean());
    const enrolBefore = JSON.stringify(
      (await Enrolment.find({}).sort({ studentId: 1, startKey: 1 }).lean()).map((e) => ({ s: e.studentId, y: e.academicYearId, sec: e.sectionId, st: e.status, a: e.startKey, b: e.endKey ?? null, o: e.outcome ?? null })),
    );
    const todayBefore = await todaySnapshot();

    await applyCutover(RUN, w.principal);
    expect(JSON.stringify(await Student.find({}).sort({ schoolId: 1 }).lean())).not.toBe(studentsBefore);

    await expect(undoCutover(RUN, w.office)).rejects.toBeInstanceOf(ForbiddenError);
    const dry = await planUndoCutover(RUN, w.principal);
    expect(dry.counts).toMatchObject({ studentsRestored: 9, pastEnrolmentsReopened: 7, newEnrolmentsToPlanned: 7, improvementRestarted: 1 });
    expect(printUndo(dry)).toContain("studentsRestored");

    const r = await undoCutover(RUN, w.principal);
    expect(r.total).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(await Student.find({}).sort({ schoolId: 1 }).lean()))).toEqual(JSON.parse(studentsBefore));
    expect(
      JSON.stringify((await Enrolment.find({}).sort({ studentId: 1, startKey: 1 }).lean()).map((e) => ({ s: e.studentId, y: e.academicYearId, sec: e.sectionId, st: e.status, a: e.startKey, b: e.endKey ?? null, o: e.outcome ?? null }))),
    ).toBe(enrolBefore);
    expect((await AcademicYear.findById(w.years.y2026))!.current).toBe(true);
    expect((await AcademicYear.findById(w.years.y2027))!.current).toBe(false);
    expect(await ImprovementAction.countDocuments({ stoppedAt: { $ne: null } })).toBe(0);
    expect(await todaySnapshot()).toEqual(todayBefore);
    expect((await YearChangeRun.findOne({ runId: RUN }))!.status).toBe("PREPARED");
    expect(await Audit.countDocuments({ eventKind: "YEAR_CHANGE_CUT_OVER_UNDONE" })).toBe(1);

    // the prepared run can be cut over again
    expect((await applyCutover(RUN, w.principal)).writes.yearFlipped).toBe(1);
    expect(await checkInvariant()).toEqual([]);
  });

  it("undoCutover lists work created on 2027 sections in between", async () => {
    await prepare();
    await applyCutover(RUN, w.principal);
    const six = (await Section.findOne({ runId: RUN, code: "Boys", classId: (await Class.findOne({ level: 6, runId: RUN }))!._id }).lean())!;
    await HomeworkItem.collection.insertOne({ sectionId: six._id, classId: six.classId, status: "issued", hwId: "HW-NEW-1" });
    const dry = await planUndoCutover(RUN);
    expect(dry.counts.homeworkOnNewSections).toBe(1);
    expect(dry.notes.join(" ")).toContain("বাড়ির কাজ 1");
  });

  it("undoPrepare leaves 0 rows with the run id and restores a pre-existing section's class teacher", async () => {
    // a 2027 Class 4 with a Boys section that the Office already made, with its own teacher
    const c4 = await Class.create({ level: 4, nameBn: "চতুর্থ", academicYearId: w.years.y2027 });
    const sec = await Section.create({ classId: c4._id, code: "Boys", nameBn: "বালক", classTeacherId: w.teacherOther });
    const r = await prepare();
    expect(r.writes.classes).toBe(4); // class 4 existed
    expect((await Section.findById(sec._id))!.classTeacherId!.toString()).toBe(w.teacher4.toString());

    await expect(undoPrepare(RUN, w.office)).rejects.toBeInstanceOf(ForbiddenError);
    const dry = await undoPrepare(RUN, w.principal, { dryRun: true });
    expect(dry.total).toBe(0);
    expect(dry.plan.counts).toMatchObject({ enrolments: 7, admissions: 2, classTeachersRestored: 1 });
    expect(await rowsWithRun()).toMatchObject({ enrolments: 7 });

    const u = await undoPrepare(RUN, w.principal);
    expect(u.total).toBeGreaterThan(0);
    expect(await rowsWithRun()).toEqual({ classes: 0, sections: 0, enrolments: 0, students: 0, runs: 0 });
    expect(await Student.countDocuments({ schoolId: { $in: ["T-A1", "T-A2"] } })).toBe(0);
    // the Office's class and section stay, with their old teacher
    expect(await Class.countDocuments({ academicYearId: w.years.y2027 })).toBe(1);
    expect((await Section.findById(sec._id))!.classTeacherId!.toString()).toBe(w.teacherOther.toString());
    expect(await Enrolment.countDocuments({ academicYearId: w.years.y2027 })).toBe(0);
    expect(await Audit.countDocuments({ eventKind: "YEAR_CHANGE_PREPARE_UNDONE" })).toBe(1);
    // and the run can be prepared again from scratch
    expect((await prepare()).writes.enrolments).toBe(7);
  });

  it("undoPrepare is refused once the cut-over has run", async () => {
    await prepare();
    await applyCutover(RUN, w.principal);
    await expect(undoPrepare(RUN, w.principal)).rejects.toBeInstanceOf(YearChangeRefusal);
    expect(await rowsWithRun()).toMatchObject({ enrolments: 7, runs: 1 });
  });
});

describe("YC-4: retirePastYearSections", () => {
  it("is refused for the current year, then sets the old sections inactive once, idempotently", async () => {
    await prepare();
    await expect(retirePastYearSections(w.years.y2026.toString(), w.principal)).rejects.toBeInstanceOf(YearChangeRefusal);
    await applyCutover(RUN, w.principal);
    expect(await Section.countDocuments({ classId: w.c4Boys.classId, active: true })).toBe(1); // still open after the cut-over
    await expect(retirePastYearSections(w.years.y2026.toString(), w.office)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await retirePastYearSections(w.years.y2026.toString(), w.principal)).retired).toBe(4);
    expect(await Section.countDocuments({ classId: w.c4Boys.classId, active: true })).toBe(0);
    expect((await retirePastYearSections(w.years.y2026.toString(), w.principal)).retired).toBe(0);
    // next year's sections untouched
    expect(await Section.countDocuments({ runId: RUN, active: true })).toBe(9);
  });
});
