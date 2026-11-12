/**
 * Year-change fixtures (YC-0 step 3, docs/prd-year-change.md).
 *
 * Years 2026 (current), 2027 and 2029 (the stray year), with a few classes and sections each,
 * plus a couple of fake children. Every piece is a separate named export so a later slice (YC-1:
 * enrolments) can add its own pieces next to these without touching them.
 *
 * Pure builders: they only need an open mongoose connection (in-memory MongoDB in the tests).
 */
import { Types } from "mongoose";
import { AcademicYear } from "../../modules/foundation/models/AcademicYear";
import { Class } from "../../modules/foundation/models/Class";
import { Section } from "../../modules/foundation/models/Section";
import { Student } from "../../modules/foundation/models/Student";

export interface YearFixture {
  y2026: Types.ObjectId;
  y2027: Types.ObjectId;
  y2029: Types.ObjectId;
}

export async function seedYears(opts: { current?: "2026" | "2027" | "2029" | null } = {}): Promise<YearFixture> {
  const current = opts.current === undefined ? "2026" : opts.current;
  const mk = async (label: string): Promise<Types.ObjectId> =>
    (
      await AcademicYear.create({
        label,
        startDate: new Date(`${label}-01-01T00:00:00.000Z`),
        endDate: new Date(`${label}-12-31T00:00:00.000Z`),
        current: current === label,
      })
    )._id;
  return { y2026: await mk("2026"), y2027: await mk("2027"), y2029: await mk("2029") };
}

export interface ClassFixture {
  c3Y2026: Types.ObjectId;
  c3Y2027: Types.ObjectId;
  c4Y2026: Types.ObjectId;
  c4Y2027: Types.ObjectId;
}

/** Classes 3 and 4 in 2026 and in 2027. */
export async function seedClasses(y: YearFixture): Promise<ClassFixture> {
  const mk = async (level: number, year: Types.ObjectId, tag: string): Promise<Types.ObjectId> =>
    (await Class.create({ level, nameBn: `Class ${level} (${tag})`, academicYearId: year }))._id;
  return {
    c3Y2026: await mk(3, y.y2026, "2026"),
    c3Y2027: await mk(3, y.y2027, "2027"),
    c4Y2026: await mk(4, y.y2026, "2026"),
    c4Y2027: await mk(4, y.y2027, "2027"),
  };
}

export interface SectionFixture {
  s3Y2026: Types.ObjectId;
  s3Y2027: Types.ObjectId;
  s4Y2026: Types.ObjectId;
  s4Y2027: Types.ObjectId;
}

/** One section per class; `classTeacherId` (if given) is class teacher of EVERY one of them. */
export async function seedSections(c: ClassFixture, classTeacherId?: Types.ObjectId | string): Promise<SectionFixture> {
  const mk = async (classId: Types.ObjectId, tag: string): Promise<Types.ObjectId> =>
    (
      await Section.create({
        classId,
        code: "Main",
        nameBn: `Section ${tag}`,
        active: true,
        ...(classTeacherId ? { classTeacherId } : {}),
      })
    )._id;
  return {
    s3Y2026: await mk(c.c3Y2026, "3-2026"),
    s3Y2027: await mk(c.c3Y2027, "3-2027"),
    s4Y2026: await mk(c.c4Y2026, "4-2026"),
    s4Y2027: await mk(c.c4Y2027, "4-2027"),
  };
}

export interface ChildFixture {
  childA1: Types.ObjectId;
  childB1: Types.ObjectId;
}

/** Two fake children: `Test Child A1` (T-001) in class 3's 2026 section, `Test Child B1` (T-002)
 *  in class 3's 2027 section — both active, so a view that ignores the year sees both. */
export async function seedChildren(c: ClassFixture, s: SectionFixture): Promise<ChildFixture> {
  const a = await Student.create({ schoolId: "T-001", name: "Test Child A1", classId: c.c3Y2026, sectionId: s.s3Y2026, active: true });
  const b = await Student.create({ schoolId: "T-002", name: "Test Child B1", classId: c.c3Y2027, sectionId: s.s3Y2027, active: true });
  return { childA1: a._id, childB1: b._id };
}

export async function clearYearChangeFixtures(): Promise<void> {
  await Promise.all([Student.deleteMany({}), Section.deleteMany({}), Class.deleteMany({}), AcademicYear.deleteMany({})]);
}
