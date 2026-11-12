/**
 * YC-2 past-period readers (docs/prd-year-change.md §5 YC-2, D-#1461, D-#1470–#1474).
 *
 * On the fixture (one 2026 ACTIVE enrolment per child, as prod has after the backfill):
 *  - BEFORE a cut-over, every reader that now reads the enrolment gives exactly the output
 *    of its pre-YC-2 path (the same call with no enrolment rows in the database);
 *  - AFTER a SIMULATED cut-over (2026 rows closed 2027-01-02 PROMOTED, 2027 rows from
 *    2027-01-03, pointers moved, 2027 current):
 *      the 2026 absentee report, student history, absent-without-application and ranking
 *      equal their pre-cut-over output; a 2026 day can be amended; an unfinished 2026 class
 *      test lists its children and its denominator is not 0; a December 2026 monthly
 *      revision keeps the 2026 section / class / year; re-editing a 2026 class note keeps its
 *      roster; the 2026 class teacher opens the 2026 profile read-only.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { seedPastReadersWorld, seedProdSplitWorld, simulateCutover, type PastReadersFixture } from "./fixtures/yearChange";
import { Enrolment } from "../modules/foundation/models/Enrolment";
import { Student } from "../modules/foundation/models/Student";
import { Section } from "../modules/foundation/models/Section";
import { dayBefore, placementSpans } from "../modules/foundation/services/EnrolmentService";
import { dhakaDayKey } from "../lib/dhakaDay";
import { rosterGroupedBySection } from "../modules/attendance/resolvers/studentAttendance";
import { StudentAttendanceDay } from "../modules/attendance/models/StudentAttendanceDay";
import {
  absenteeReport,
  absentNoApplication,
  classPresenceForDate,
  sectionPresenceForDate,
  sectionsAttendanceForDate,
  studentAttendanceHistory,
} from "../modules/attendance/services/AttendanceReportService";
import { rankStudents } from "../modules/attendance/services/AttendanceRankingService";
import { rosterForUnit } from "../modules/attendance/attendanceUnit";
import { amendAttendanceUnit } from "../modules/attendance/services/StudentAttendanceService";
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { classTestRosterStudents, rosterCount, rosterStudentIds } from "../modules/trackers/classTestAnchor";
import { reportsStatus } from "../modules/trackers/services/ClassTestSummaryService";
import { MonthlyReport } from "../modules/reports/models/MonthlyReport";
import { buildMonthlyReport } from "../modules/reports/services/MonthlyReportService";
import { periodPlacement, sectionMonthRoster } from "../modules/reports/services/MonthlyMetricsService";
import { LessonProgressConfig } from "../modules/lesson-progress/models/LessonProgressConfig";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { recordDelivery } from "../modules/lesson-progress/services/LessonDeliveryService";
import { assertStudentProfileRead } from "../modules/trackers/resolvers/studentProfile";
import { classAttendanceComparison, studentProfileHeader } from "../modules/trackers/services/StudentProfileContextService";
import { assertCanWrite, allowedSubjectCodesForSection, ForbiddenError } from "../middleware/authz";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
let w: PastReadersFixture;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
  w = await seedPastReadersWorld();
});

const OCT = { from: "2026-10-01", to: "2026-10-31" };
const ctxOf = (userId: Types.ObjectId | string): AppContext =>
  ({ auth: { userId: userId.toString(), role: "TEACHER" } }) as unknown as AppContext;

/** Every past-period read the acceptance compares, as plain data. */
async function pastViews(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of w.dayKeys) out[`absentees:${key}`] = await absenteeReport(key);
  for (const id of [...w.nursery, ...w.boys]) {
    out[`history:${id}`] = await studentAttendanceHistory(id.toString(), OCT.from, "2026-12-31");
  }
  out.absentNoApplicationAll = await absentNoApplication(null, OCT.from, OCT.to);
  out.absentNoApplicationC3 = await absentNoApplication(w.c3Boys2026.sectionId.toString(), OCT.from, OCT.to);
  out.rankSchool = await rankStudents({ window: "month", anchorKey: "2026-10-05", axis: "school" });
  out.rankClass = await rankStudents({ window: "month", anchorKey: "2026-10-05", axis: "class", axisValue: w.c3Boys2026.classId.toString() });
  out.rankSection = await rankStudents({ window: "month", anchorKey: "2026-10-05", axis: "section", axisValue: w.nursery2026.sectionId.toString() });
  out.rankYear = await rankStudents({ window: "annual", anchorKey: "2026-10-05", axis: "school", academicYearId: w.years.y2026.toString() });
  out.register = await sectionsAttendanceForDate([w.nursery2026.sectionId.toString(), w.c3Boys2026.sectionId.toString()], "2026-10-06");
  return JSON.parse(JSON.stringify(out));
}

describe("before the cut-over: the enrolment path equals the pre-YC-2 path", () => {
  test("every switched reader gives the same output with and without enrolment rows", async () => {
    const reads = async (): Promise<unknown> => {
      const key = "2026-10-05";
      const exam = { sectionId: w.c3Boys2026.sectionId.toString(), classId: w.c3Boys2026.classId.toString(), subjectGroupId: null, subject: "MATH", examDate: new Date("2026-10-08T06:00:00Z") };
      return JSON.parse(
        JSON.stringify({
          views: await pastViews(),
          classPresence: await classPresenceForDate(key),
          sectionPresence: await sectionPresenceForDate(key),
          rosterSection: await rosterForUnit({ unitType: "section", unitId: w.nursery2026.sectionId.toString() }, key),
          rosterGroup: await rosterForUnit({ unitType: "subjectgroup", unitId: w.quranGroupId.toString() }, key),
          ctRoster: await rosterStudentIds(exam),
          ctCount: await rosterCount(exam),
          period: await periodPlacement(w.boys[0].toString(), "2026-10", new Date("2026-11-12T06:00:00Z")),
          monthRoster: await sectionMonthRoster(w.c3Boys2026.sectionId.toString(), "2026-10"),
          classmates: await classAttendanceComparison(w.boys[0].toString(), OCT.from, "2026-11-12"),
          header: await studentProfileHeader(w.boys[0].toString(), new Date("2026-11-12T06:00:00Z")),
        }),
      );
    };
    const withEnrolments = await reads();
    await Enrolment.deleteMany({});
    const legacy = (await reads()) as Record<string, Record<string, unknown>>;
    const enrolled = withEnrolments as Record<string, Record<string, unknown>>;
    // The year picker is the one new field: it lists the enrolled year only when rows exist.
    expect(enrolled.header.enrolledYears).toEqual([{ academicYearId: w.years.y2026.toString(), label: "2026", current: true }]);
    expect(legacy.header.enrolledYears).toEqual([]);
    delete enrolled.header.enrolledYears;
    delete legacy.header.enrolledYears;
    expect(enrolled).toEqual(legacy);
    // And the views are not trivially empty.
    expect((enrolled.views as Record<string, unknown[]>)["absentees:2026-10-05"]).toHaveLength(2);
    expect(enrolled.ctCount).toBe(3);
  });
});

describe("after a simulated cut-over", () => {
  test("the 2026 absentee report, history, absent-without-application and ranking equal the pre-cut-over output", async () => {
    const before = await pastViews();
    await simulateCutover(w);
    const after = await pastViews();
    expect(after).toEqual(before);
    // The comparison is not between two empty reports.
    const oct5 = before["absentees:2026-10-05"] as Array<{ classLevel: number; absentCount: number }>;
    expect(oct5.map((c) => [c.classLevel, c.absentCount])).toEqual([[-1, 1], [3, 1]]);
    expect((before.rankSchool as { rows: unknown[] }).rows).toHaveLength(6);
  });

  test("a 2026 day can be amended (section and Quran group), and a non-member is still refused", async () => {
    await simulateCutover(w);
    const now = new Date("2027-01-10T06:00:00Z");
    const sec = await amendAttendanceUnit({ unitType: "section", unitId: w.nursery2026.sectionId.toString() }, "2026-10-06", [w.nursery[2].toString()], w.marker.toString(), now);
    expect(sec.absentStudentIds.map(String)).toEqual([w.nursery[2].toString()]);
    const grp = await amendAttendanceUnit({ unitType: "subjectgroup", unitId: w.quranGroupId.toString() }, "2026-10-07", [w.boys[0].toString()], w.marker.toString(), now);
    expect(grp.absentStudentIds.map(String)).toEqual([w.boys[0].toString()]);
    await expect(
      amendAttendanceUnit({ unitType: "section", unitId: w.nursery2026.sectionId.toString() }, "2026-10-06", [w.boys[0].toString()], w.marker.toString(), now),
    ).rejects.toThrow(/absentee/);
    // A 2027 section has nobody on a 2026 day.
    expect(await rosterForUnit({ unitType: "section", unitId: w.kg2027.sectionId.toString() }, "2026-10-06")).toEqual([]);
  });

  test("an unfinished 2026 class test lists its children and its denominator is not 0", async () => {
    await ClassTest.create({
      ctId: "CT-C3-MATH-0901",
      academicYearId: w.years.y2026,
      classLevel: 3,
      classId: w.c3Boys2026.classId,
      sectionId: w.c3Boys2026.sectionId,
      subject: "MATH",
      testNumber: 1,
      examDate: new Date("2026-10-08T06:00:00Z"),
      totalMarks: 20,
      passMark: 8,
      source: "UPLOADED_PAPER",
      status: "PRINTED",
      requestedBy: w.classTeacher2026,
      teacherId: w.classTeacher2026,
    });
    await simulateCutover(w);
    const exam = { sectionId: w.c3Boys2026.sectionId.toString(), classId: w.c3Boys2026.classId.toString(), subjectGroupId: null, subject: "MATH", examDate: new Date("2026-10-08T06:00:00Z") };
    expect((await rosterStudentIds(exam)).sort()).toEqual(w.boys.map(String).sort());
    expect(await rosterCount(exam)).toBe(3);
    const listed = await classTestRosterStudents(exam);
    expect(listed.map((s) => s.schoolId).sort()).toEqual(["T-B1", "T-B2", "T-B3"]);
    const [row] = await reportsStatus({ academicYearId: w.years.y2026.toString(), asOf: new Date("2027-01-05T06:00:00Z") });
    expect(row.rosterCount).toBe(3);
    expect(row.complete).toBe(false);
  });

  test("a December 2026 monthly-report revision keeps the 2026 section, class and year", async () => {
    const child = w.boys[0].toString();
    const first = await buildMonthlyReport(child, "2026-12", { now: new Date("2026-12-31T12:00:00Z") });
    expect(first.report.revision).toBe(1);
    await MonthlyReport.updateOne({ _id: first.report._id }, { $set: { status: "RELEASED" } });
    // A late correction to a December day changes the printed figures.
    await StudentAttendanceDay.updateOne({ subjectGroupId: w.quranGroupId, dateKey: "2026-12-10" }, { $set: { absentStudentIds: [w.boys[0]] } });
    await simulateCutover(w);

    const placed = await periodPlacement(child, "2026-12", new Date("2027-01-05T06:00:00Z"));
    expect(placed?.yearFromKey).toBe("2026-01-01");
    const rev = await buildMonthlyReport(child, "2026-12", { now: new Date("2027-01-05T06:00:00Z") });
    expect(rev.created).toBe(true);
    expect(rev.report.revision).toBe(2);
    expect(String(rev.report.sectionId)).toBe(w.c3Boys2026.sectionId.toString());
    expect(String(rev.report.classId)).toBe(w.c3Boys2026.classId.toString());
    expect(String(rev.report.academicYearId)).toBe(w.years.y2026.toString());
    // The December roster of the 2026 section still holds the child; the 2027 section's does not.
    expect(await sectionMonthRoster(w.c3Boys2026.sectionId.toString(), "2026-12")).toContain(child);
    expect(await sectionMonthRoster(w.c4Boys2027.sectionId.toString(), "2026-12")).toEqual([]);
  });

  test("re-editing a 2026 class note keeps its roster", async () => {
    await LessonProgressConfig.create({ classNoteQuestionOn: true });
    await ContentArtifact.create({
      docType: "session_plan",
      subject: "MATH",
      classLevel: 3,
      address: { anchorWord: "অধ্যায়", number: 1, title: "সংখ্যা" },
      curationTag: "KEEP_AS_IS",
      reviewStatus: "reviewed",
      current: true,
      importedBy: new Types.ObjectId(),
      envelopeJson: { payload: { session_plan: { session_form: "single_period_standalone" } } },
    });
    const slot = await RoutineSlot.create({
      groupType: "section",
      groupId: w.c3Boys2026.sectionId,
      classId: w.c3Boys2026.classId,
      dayOfWeek: "TUE",
      periodNumber: 5,
      subject: "MATH",
      track: "general",
      teacherId: w.classTeacher2026,
      effectiveFrom: new Date("2026-01-01"),
      createdBy: w.marker,
    });
    const note = {
      _id: new Types.ObjectId(),
      slotId: slot._id,
      groupType: "section" as const,
      groupId: w.c3Boys2026.sectionId,
      date: new Date("2026-10-06T06:00:00Z"),
      subject: "MATH",
      publishedBy: w.classTeacher2026,
    };
    await recordDelivery(note as never, { sessions: [{ key: "1:1", finished: true }] }, w.classTeacher2026.toString());
    const before = await LessonDelivery.findOne({ noteId: note._id }).lean();
    expect(before!.rosterStudentIds.map(String).sort()).toEqual(w.boys.map(String).sort());

    await simulateCutover(w);
    await recordDelivery(note as never, { sessions: [{ key: "1:1", finished: false }] }, w.classTeacher2026.toString());
    const after = await LessonDelivery.findOne({ noteId: note._id }).lean();
    expect(after!.rosterStudentIds.map(String).sort()).toEqual(w.boys.map(String).sort());
    expect(after!.attendanceUnits).toEqual(before!.attendanceUnits);
  });

  test("the 2026 class teacher opens the 2026 profile read-only", async () => {
    const child = w.boys[0].toString();
    const ct = ctxOf(w.classTeacher2026);
    // Before: today's section is theirs.
    await expect(assertStudentProfileRead(ct, child)).resolves.toMatchObject({ sectionId: w.c3Boys2026.sectionId.toString() });

    await simulateCutover(w);
    // Today (2027) the child is not in their class.
    await expect(assertStudentProfileRead(ct, child)).rejects.toBeInstanceOf(ForbiddenError);
    // The 2026 window: allowed, full view (class teacher), on the 2026 section.
    const gate = await assertStudentProfileRead(ct, child, { academicYearId: w.years.y2026.toString() });
    expect(gate).toEqual({ subjects: null, sectionId: w.c3Boys2026.sectionId.toString(), classId: w.c3Boys2026.classId.toString() });
    await expect(assertStudentProfileRead(ct, child, { onKey: "2026-12-31" })).resolves.toMatchObject({ subjects: null });

    const header = await studentProfileHeader(child, new Date("2027-01-10T06:00:00Z"), w.years.y2026.toString());
    expect(header).toMatchObject({ classLevel: 3, sectionId: w.c3Boys2026.sectionId.toString(), pastYear: true });
    expect(header.academicYear).toMatchObject({ label: "2026", fromKey: "2026-01-01", toKey: "2026-12-31" });
    expect(header.enrolledYears!.map((y) => y.label)).toEqual(["2027", "2026"]);
    const today = await studentProfileHeader(child, new Date("2027-01-10T06:00:00Z"));
    expect(today).toMatchObject({ classLevel: 4, sectionId: w.c4Boys2027.sectionId.toString(), pastYear: false });

    // Classmates of the 2026 window are the 2026 section's children.
    expect((await classAttendanceComparison(child, OCT.from, "2026-12-31")).classSize).toBe(3);

    // Read only: no write on the 2026 section.
    await expect(assertCanWrite(ct, w.c3Boys2026.sectionId.toString())).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a subject teacher with a lapsed 2026 routine grant reads the 2026 section for that subject only", async () => {
    await simulateCutover(w);
    // The class teacher's MATH grant has lapsed; strip the class-teacher tie to see the grant alone.
    const { Section } = await import("../modules/foundation/models/Section");
    await Section.updateOne({ _id: w.c3Boys2026.sectionId }, { $unset: { classTeacherId: 1 } });
    const ct = ctxOf(w.classTeacher2026);
    const subjects = await allowedSubjectCodesForSection(ct, w.c3Boys2026.sectionId.toString(), w.c3Boys2026.classId.toString());
    expect(subjects && [...subjects]).toEqual(["MATH"]);
    await expect(assertStudentProfileRead(ct, w.boys[0].toString(), { academicYearId: w.years.y2026.toString() })).resolves.toMatchObject({
      subjects: ["MATH"],
    });
    // A teacher with no tie to the 2026 section is refused.
    await expect(
      assertStudentProfileRead(ctxOf(new Types.ObjectId()), w.boys[0].toString(), { academicYearId: w.years.y2026.toString() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// D-#1476 - review fixes: the prod split shape (one ACTIVE enrolment per child in the half)
// ---------------------------------------------------------------------------

describe("prod split shape: the enrolment path equals the pre-YC-2 path", () => {
  let p: Awaited<ReturnType<typeof seedProdSplitWorld>>;
  beforeEach(async () => {
    await mongoose.connection.db!.dropDatabase();
    p = await seedProdSplitWorld();
  });

  const ct = (examDate: string, sectionId: Types.ObjectId, testNumber: number, subject = "MATH") =>
    ClassTest.create({
      ctId: `CT-C4-${subject}-${testNumber}`,
      academicYearId: p.years.y2026,
      classLevel: 4,
      classId: p.classId,
      sectionId,
      subject,
      testNumber,
      examDate: new Date(`${examDate}T06:00:00Z`),
      totalMarks: 20,
      passMark: 8,
      source: "UPLOADED_PAPER",
      status: "PRINTED",
      requestedBy: p.girlsTeacher,
      teacherId: p.girlsTeacher,
    });

  const NOW = new Date("2026-11-12T06:00:00Z");

  /** Every screen the YC-2 switch touches, for the split's before and after dates. */
  async function screens(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const [k0, , k2] = p.dayKeys;
    // The amend calls below write; snapshot the days so the second run reads the same data.
    const daysBefore = await StudentAttendanceDay.find({}).lean();
    const sec = (id: Types.ObjectId): { unitType: "section"; unitId: string } => ({ unitType: "section", unitId: id.toString() });
    for (const key of p.dayKeys) {
      out[`absentees:${key}`] = await absenteeReport(key);
      out[`classPresence:${key}`] = await classPresenceForDate(key);
      out[`sectionPresence:${key}`] = await sectionPresenceForDate(key);
      for (const [name, id] of [["boys", p.boys], ["girls", p.girls], ["combined", p.combined]] as const) {
        out[`roster:${name}:${key}`] = await rosterForUnit(sec(id), key);
        out[`grouped:${name}:${key}`] = await rosterGroupedBySection(sec(id), key);
      }
    }
    out.register = await sectionsAttendanceForDate([p.boys, p.girls, p.combined].map(String), k0);
    out.registerAfter = await sectionsAttendanceForDate([p.boys, p.girls, p.combined].map(String), k2);
    for (const id of p.kids) out[`history:${id}`] = await studentAttendanceHistory(id.toString(), "2026-09-01", "2026-10-31");
    out.absentNoApplication = await absentNoApplication(null, "2026-09-01", "2026-10-31");
    out.absentNoApplicationBoys = await absentNoApplication(p.boys.toString(), "2026-09-01", "2026-10-31");
    out.rankSchool = await rankStudents({ window: "month", anchorKey: k2, axis: "school" });
    out.rankSchoolSep = await rankStudents({ window: "month", anchorKey: k0, axis: "school" });
    out.rankClass = await rankStudents({ window: "month", anchorKey: k0, axis: "class", axisValue: p.classId.toString() });
    out.rankSection = await rankStudents({ window: "month", anchorKey: k0, axis: "section", axisValue: p.girls.toString() });
    // Amend validation: a member passes, a child of the other half is refused.
    const amend = async (id: Types.ObjectId, kid: Types.ObjectId, key: string): Promise<unknown> => {
      try {
        return (await amendAttendanceUnit(sec(id), key, [kid.toString()], p.marker.toString(), NOW)).absentStudentIds.map(String);
      } catch (e) {
        return `refused: ${(e as Error).message}`;
      }
    };
    out.amendOk = await amend(p.boys, p.kids[1], k0);
    out.amendOther = await amend(p.boys, p.kids[2], k0);
    out.amendAfterOk = await amend(p.girls, p.kids[2], k2);
    out.amendAfterOther = await amend(p.girls, p.kids[0], k2);
    await StudentAttendanceDay.deleteMany({});
    await StudentAttendanceDay.insertMany(daysBefore);
    // Class tests: one sat before the split on the emptied combined section, one on each half.
    for (const [name, exam] of [
      ["preSplitCombined", { sectionId: p.combined, examDate: "2026-09-10" }],
      ["boysAfter", { sectionId: p.boys, examDate: "2026-10-15" }],
      ["girlsBefore", { sectionId: p.girls, examDate: "2026-09-10" }],
    ] as const) {
      const e = { sectionId: exam.sectionId.toString(), classId: p.classId.toString(), subjectGroupId: null, subject: "MATH", examDate: new Date(`${exam.examDate}T06:00:00Z`) };
      out[`ct:${name}:ids`] = (await rosterStudentIds(e)).sort();
      out[`ct:${name}:count`] = await rosterCount(e);
      out[`ct:${name}:marks`] = await classTestRosterStudents(e);
    }
    out.ctStatus = await reportsStatus({ academicYearId: p.years.y2026.toString(), asOf: new Date("2026-11-20T06:00:00Z") });
    // Monthly report: stamp, period placement and the section-month roster, September and October.
    for (const month of ["2026-09", "2026-10"]) {
      out[`period:${month}`] = await periodPlacement(p.kids[0].toString(), month, NOW);
      out[`periodGirl:${month}`] = await periodPlacement(p.kids[2].toString(), month, NOW);
      for (const [name, id] of [["boys", p.boys], ["girls", p.girls], ["combined", p.combined]] as const) {
        out[`monthRoster:${name}:${month}`] = (await sectionMonthRoster(id.toString(), month)).slice().sort();
      }
      await MonthlyReport.deleteMany({});
      const built = await buildMonthlyReport(p.kids[3].toString(), month, { now: NOW });
      const r = built.report as unknown as Record<string, unknown>;
      out[`report:${month}`] = { sectionId: r.sectionId, classId: r.classId, academicYearId: r.academicYearId, revision: r.revision, created: built.created };
    }
    // Profile gate: the Girls class teacher, window 2026-08-01..09-15 (before the split).
    const gate = ctxOf(p.girlsTeacher);
    const tryGate = async (kid: Types.ObjectId, win: { academicYearId?: string; onKey?: string }): Promise<unknown> => {
      try {
        return await assertStudentProfileRead(gate, kid.toString(), win);
      } catch (e) {
        return `refused: ${(e as Error).constructor.name}`;
      }
    };
    out.gateGirl = await tryGate(p.kids[2], { onKey: "2026-09-15" });
    out.gateGirlYear = await tryGate(p.kids[2], { academicYearId: p.years.y2026.toString() });
    out.gateBoy = await tryGate(p.kids[0], { onKey: "2026-09-15" });
    out.header = await studentProfileHeader(p.kids[2].toString(), NOW);
    out.classmates = await classAttendanceComparison(p.kids[2].toString(), "2026-08-01", "2026-09-15");
    return JSON.parse(JSON.stringify(out));
  }

  test("attendance report/history/ranking/register/amend, class tests, monthly report and the profile gate give the same output with the enrolment path on and off", async () => {
    await ct("2026-09-10", p.combined, 1);
    await ct("2026-10-15", p.boys, 2);
    await ct("2026-09-10", p.girls, 3);
    const on = await screens();
    expect(await Enrolment.countDocuments({ status: "CLOSED" })).toBe(0);
    await Enrolment.deleteMany({});
    const off = await screens();
    const a = on as Record<string, Record<string, unknown>>;
    const b = off as Record<string, Record<string, unknown>>;
    // The year picker is the one new field (it lists the enrolled year only when rows exist).
    delete a.header.enrolledYears;
    delete b.header.enrolledYears;
    expect(a).toEqual(b);

    // Not trivially empty: the pre-split combined test lists all four children (reconstruction fallback),
    // the halves list their own, and the gate lets the Girls class teacher in.
    expect((on["ct:preSplitCombined:ids"] as string[]).length).toBe(4);
    expect(on["ct:preSplitCombined:count"]).toBe(4);
    expect(on["ct:boysAfter:count"]).toBe(2);
    expect(on["ct:girlsBefore:count"]).toBe(2);
    expect((on["absentees:2026-09-14"] as unknown[]).length).toBeGreaterThan(0);
    expect(on.amendOk).toEqual([p.kids[1].toString()]);
    expect(String(on.amendOther)).toMatch(/^refused/);
    expect(on.gateGirl).toMatchObject({ sectionId: p.girls.toString() });
    expect(String(on.gateBoy)).toMatch(/^refused/);
    expect((on["monthRoster:girls:2026-09"] as string[]).length).toBe(2);
    expect(on["monthRoster:combined:2026-09"]).toEqual([]);
    expect((on["report:2026-09"] as { sectionId: string }).sectionId).toBe(p.girls.toString());
  });
});

describe("D-#1476 review fixes", () => {
  test("profile gate: a window placement the caller cannot read falls back to today's section (either passes)", async () => {
    await mongoose.connection.db!.dropDatabase();
    const p = await seedProdSplitWorld();
    // The OLD backfill shape for one child: CLOSED in the combined section up to the day before the split.
    const girl = p.kids[2];
    await Enrolment.deleteMany({ studentId: girl });
    const base = { studentId: girl, academicYearId: p.years.y2026, classId: p.classId, classLevel: 4 };
    await Enrolment.create({ ...base, sectionId: p.combined, status: "CLOSED", startKey: "2026-01-01", endKey: "2026-09-30", outcome: "MOVED" });
    await Enrolment.create({ ...base, sectionId: p.girls, status: "ACTIVE", startKey: "2026-10-01" });
    const gate = ctxOf(p.girlsTeacher);
    // C4 Girls class teacher, window 2026-08-01..09-15: the placement is the combined section (not theirs), today's is.
    await expect(assertStudentProfileRead(gate, girl.toString(), { onKey: "2026-09-15" })).resolves.toMatchObject({ sectionId: p.girls.toString() });
    // And a teacher with neither is refused.
    await expect(assertStudentProfileRead(ctxOf(new Types.ObjectId()), girl.toString(), { onKey: "2026-09-15" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("placement spans: from today on only ACTIVE children; the past still answers for a deactivated child", async () => {
    const world = await seedPastReadersWorld();
    const gone = world.boys[2];
    await Student.updateOne({ _id: gone }, { $set: { active: false } });
    const today = dhakaDayKey(new Date());
    const sec = [world.c3Boys2026.sectionId];
    const idsOf = (spans: Array<{ studentId: string }>): string[] => [...new Set(spans.map((x) => x.studentId))].sort();
    const all = world.boys.map(String).sort();
    const rest = world.boys.slice(0, 2).map(String).sort();
    expect(idsOf(await placementSpans({ sectionIds: sec }, { from: today, to: today }))).toEqual(rest);
    expect(idsOf(await placementSpans({ sectionIds: sec }, { from: "2026-10-01", to: dayBefore(today) }))).toEqual(all);
    // A range that straddles today keeps the past part of the deactivated child's span.
    const straddle = await placementSpans({ sectionIds: sec }, { from: "2026-10-01", to: "2026-12-31" });
    const goneSpan = straddle.filter((x) => x.studentId === gone.toString());
    expect(goneSpan).toHaveLength(1);
    expect(goneSpan[0].toKey).toBe(dayBefore(today));
    // A by-id read (the profile, one child's history) is never narrowed.
    expect(idsOf(await placementSpans({ studentIds: [gone], includeInactive: true }, { from: today, to: today }))).toEqual([gone.toString()]);
  });

  test("authz: a current-year section answers pastYearSectionTie with null, and one memoised section lookup per request", async () => {
    const world = await seedPastReadersWorld();
    const { pastYearSectionTie } = await import("../middleware/authz");
    const memo = {};
    const spy = jest.spyOn(Section, "findById");
    const sectionId = world.c3Boys2026.sectionId.toString();
    expect(await pastYearSectionTie(world.classTeacher2026.toString(), sectionId, memo)).toBeNull();
    expect(await pastYearSectionTie(world.classTeacher2026.toString(), sectionId, memo)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
