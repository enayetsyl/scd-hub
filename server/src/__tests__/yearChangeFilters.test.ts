/**
 * YC-0 step 3 — current-year filters (docs/prd-year-change.md §1.2, D-#1452).
 *
 * With 2026 rows AND 2027 rows in the same database, the readers that list classes / sections /
 * bell windows must return only the CURRENT year's. With no current year they must behave as
 * today (no filter). One test per touched module:
 *
 *   foundation  the helper itself + mySectionsAsClassTeacher
 *   attendance  unmarkedSections (the chase list) never lists a 2027 section while 2026 is current
 *   exams       the syllabus board lists the exam's own year's classes once
 *   routine     the "earliest regular window" day-start follows the current year
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import {
  currentAcademicYearId,
  currentYearClassIds,
  currentYearFilter,
  currentYearSectionFilter,
} from "../modules/foundation/services/currentYear";
import { mySectionsAsClassTeacher } from "../modules/foundation/services/ClassTeacherService";
import { unmarkedSections } from "../modules/attendance/services/AttendanceReportService";
import { examSyllabusBoard } from "../modules/exams/services/ExamSyllabusReadService";
import { Exam } from "../modules/exams/models/Exam";
import { routineMasterGrid } from "../modules/routine/routineMaster";
import { ScheduleWindow } from "../modules/routine/models/ScheduleWindow";
import { PeriodGrid } from "../modules/routine/models/PeriodGrid";
import {
  clearYearChangeFixtures,
  seedChildren,
  seedClasses,
  seedSections,
  seedYears,
  type ClassFixture,
  type SectionFixture,
  type YearFixture,
} from "./fixtures/yearChange";

let mongod: MongoMemoryServer;
const TEACHER = new Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([Exam.init(), ScheduleWindow.init()]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

let y: YearFixture;
let c: ClassFixture;
let s: SectionFixture;

async function seed(current: "2026" | "2027" | null = "2026"): Promise<void> {
  await clearYearChangeFixtures();
  await Promise.all([Exam.deleteMany({}), ScheduleWindow.deleteMany({}), PeriodGrid.deleteMany({})]);
  y = await seedYears({ current });
  c = await seedClasses(y);
  s = await seedSections(c, TEACHER);
}

const ids = (xs: Array<{ _id: unknown }>): string[] => xs.map((x) => String(x._id)).sort();

describe("foundation — helper + mySectionsAsClassTeacher", () => {
  test("only the current year is returned with 2027 rows present", async () => {
    await seed("2026");
    expect(String(await currentAcademicYearId())).toBe(String(y.y2026));
    expect(String((await currentYearFilter()).academicYearId)).toBe(String(y.y2026));
    expect((await currentYearClassIds())!.map(String).sort()).toEqual([String(c.c3Y2026), String(c.c4Y2026)].sort());
    const mine = await mySectionsAsClassTeacher(String(TEACHER));
    expect(ids(mine)).toEqual([String(s.s3Y2026), String(s.s4Y2026)].sort());
  });

  test("flipping the current year moves the answer; no current year = no filter", async () => {
    await seed("2027");
    expect(ids(await mySectionsAsClassTeacher(String(TEACHER)))).toEqual([String(s.s3Y2027), String(s.s4Y2027)].sort());

    await AcademicYear.updateMany({}, { current: false });
    expect(await currentAcademicYearId()).toBeNull();
    expect(await currentYearFilter()).toEqual({});
    expect(await currentYearClassIds()).toBeNull();
    expect(await currentYearSectionFilter()).toEqual({});
    expect(ids(await mySectionsAsClassTeacher(String(TEACHER)))).toHaveLength(4);
  });
});

describe("attendance — unmarkedSections", () => {
  test("a 2027 section with a child is not on the 2026 chase list", async () => {
    await seed("2026");
    await seedChildren(c, s);
    const rows = await unmarkedSections("2026-11-17", { withMarkers: false }); // a Tuesday
    expect(rows.map((r) => r.sectionId)).toEqual([String(s.s3Y2026)]);

    await AcademicYear.updateMany({}, { current: false });
    const all = await unmarkedSections("2026-11-17", { withMarkers: false });
    expect(all.map((r) => r.sectionId).sort()).toEqual([String(s.s3Y2026), String(s.s3Y2027)].sort());
  });
});

describe("exams — examSyllabusBoard", () => {
  test("lists the exam's own year's classes once, not both years'", async () => {
    await seed("2026");
    const exam = await Exam.create({ academicYearId: y.y2026, term: "ANNUAL", name: "Final 2026", createdBy: TEACHER });
    const ctx = { auth: { userId: String(TEACHER), role: "PRINCIPAL" } } as unknown as AppContext;
    const board = await examSyllabusBoard(ctx, String(exam._id));
    expect(board.map((b) => b.classId).sort()).toEqual([String(c.c3Y2026), String(c.c4Y2026)].sort());
  });
});

describe("routine — earliest regular window", () => {
  test("the day-start comes from the current year's window, not the earliest across years", async () => {
    await seed("2027");
    await ScheduleWindow.create([
      { academicYearId: y.y2026, fromDate: new Date("2026-01-04"), toDate: new Date("2026-12-31"), season: "regular", dayStartMinutes: 420, label: "2026" },
      { academicYearId: y.y2027, fromDate: new Date("2027-01-03"), toDate: new Date("2027-12-31"), season: "regular", dayStartMinutes: 450, label: "2027" },
    ]);
    await PeriodGrid.create({
      audienceKey: "class_1_5",
      classLevels: [1, 2, 3, 4, 5],
      season: "regular",
      periods: [{ number: 1, durationMin: 35, isBreak: false, track: "general", nameBn: "P1" }],
    });
    const master = await routineMasterGrid("SUN", new Date(2027, 0, 10));
    expect(master.columns[0].startTime).toBe("07:30");

    await AcademicYear.updateMany({}, { current: false });
    await AcademicYear.updateOne({ _id: y.y2026 }, { current: true });
    const back = await routineMasterGrid("SUN", new Date(2026, 5, 10));
    expect(back.columns[0].startTime).toBe("07:00");
  });
});
