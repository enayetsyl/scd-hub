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
import { SectionMerge } from "../../modules/foundation/models/SectionMerge";
import { Enrolment } from "../../modules/foundation/models/Enrolment";
import { Audit } from "../../modules/platform/models/Audit";
import { SubjectGroup } from "../../modules/routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../modules/routine/models/SubjectGroupMembership";
import { StudentAttendanceDay } from "../../modules/attendance/models/StudentAttendanceDay";
import { Subject } from "../../modules/foundation/models/Subject";
import { ScopeGrant } from "../../modules/foundation/models/ScopeGrant";

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
  await Promise.all([Audit.deleteMany({ eventKind: "SECTIONS_SPLIT" }), Enrolment.deleteMany({}), SectionMerge.deleteMany({}), Student.deleteMany({}), Section.deleteMany({}), Class.deleteMany({}), AcademicYear.deleteMany({})]);
}

export interface SplitHistoryFixture {
  boys: Types.ObjectId;
  girls: Types.ObjectId;
  combined: Types.ObjectId;
  /** Two boys and two girls; all active, now back in boys / girls. */
  boy1: Types.ObjectId;
  boy2: Types.ObjectId;
  girl1: Types.ObjectId;
  girl2: Types.ObjectId;
  /** Merged on this date key, split on `splitKey`. */
  mergeKey: string;
  splitKey: string;
}

/**
 * YC-1: class 3 of 2026 was split into Boys / Girls, merged into one combined section on
 * 2026-03-01, and split again on 2026-06-01. Four children (T-S1..T-S4) end in their gender
 * sections; the SectionMerge row (status "split") names where each started. Needs `seedYears`
 * and `seedClasses` first (uses class 3 of 2026).
 */
export async function seedSplitHistory(c: ClassFixture): Promise<SplitHistoryFixture> {
  const mk = async (code: string): Promise<Types.ObjectId> =>
    (await Section.create({ classId: c.c3Y2026, code, nameBn: `Split ${code}`, active: true }))._id;
  const boys = await mk("Boys");
  const girls = await mk("Girls");
  const combined = await mk("Combined");
  const kid = async (n: number, sectionId: Types.ObjectId, gender: "male" | "female"): Promise<Types.ObjectId> =>
    (await Student.create({ schoolId: `T-S${n}`, name: `Split Child ${n}`, classId: c.c3Y2026, sectionId, gender, active: true }))._id;
  const boy1 = await kid(1, boys, "male");
  const boy2 = await kid(2, boys, "male");
  const girl1 = await kid(3, girls, "female");
  const girl2 = await kid(4, girls, "female");
  await SectionMerge.create({
    classId: c.c3Y2026,
    combinedSectionId: combined,
    sourceSectionIds: [boys, girls],
    moves: [
      { studentId: boy1, fromSectionId: boys },
      { studentId: boy2, fromSectionId: boys },
      { studentId: girl1, fromSectionId: girls },
      { studentId: girl2, fromSectionId: girls },
    ],
    status: "split",
    mergedBy: new Types.ObjectId(),
    mergedAt: new Date("2026-03-01T06:00:00.000Z"),
    splitBy: new Types.ObjectId(),
    splitAt: new Date("2026-06-01T06:00:00.000Z"),
  });
  return { boys, girls, combined, boy1, boy2, girl1, girl2, mergeKey: "2026-03-01", splitKey: "2026-06-01" };
}

export interface ProdSplitFixture {
  classId: Types.ObjectId;
  combined: Types.ObjectId;
  boys: Types.ObjectId;
  girls: Types.ObjectId;
  /** Three children (T-P1..T-P3), now in boys / girls. */
  kids: Types.ObjectId[];
  effective: string | null;
}

/**
 * YC-1: the shape prod has for C3/C4/C5 - a class of 2026 that began the year in one combined
 * section and was split into boys / girls by the split skill. NO `SectionMerge` row exists; there
 * is only a `SECTIONS_SPLIT` audit on the combined section with `meta.{classId, movedStudents,
 * effective}`. `effective: null` leaves `meta.effective` out (the older copy of the skill).
 */
export async function seedProdSplit(
  y: YearFixture,
  opts: { effective?: string | null; movedStudents?: number } = {},
): Promise<ProdSplitFixture> {
  const effective = opts.effective === undefined ? "2026-10-01" : opts.effective;
  const classId = (await Class.create({ level: 5, nameBn: "Class 5 (prod split)", academicYearId: y.y2026 }))._id;
  const mk = async (code: string, active: boolean): Promise<Types.ObjectId> =>
    (await Section.create({ classId, code, nameBn: `Prod ${code}`, active }))._id;
  const combined = await mk("ALL", true);
  const boys = await mk("Boys", true);
  const girls = await mk("Girls", true);
  const kid = async (n: number, sectionId: Types.ObjectId): Promise<Types.ObjectId> =>
    (await Student.create({ schoolId: `T-P${n}`, name: `Prod Split Child ${n}`, classId, sectionId, active: true }))._id;
  const kids = [await kid(1, boys), await kid(2, boys), await kid(3, girls)];
  await Audit.create({
    eventKind: "SECTIONS_SPLIT",
    targetId: combined,
    targetKind: "Section",
    meta: { classId: classId.toString(), movedStudents: opts.movedStudents ?? 3, byGender: true, ...(effective ? { effective } : {}) },
  });
  return { classId, combined, boys, girls, kids, effective };
}

// ---------------------------------------------------------------------------
// YC-2: past-period readers (docs/prd-year-change.md §5 YC-2 acceptance)
// ---------------------------------------------------------------------------

export interface PastReadersFixture {
  years: YearFixture;
  /** 2026: Nursery (Main) and Class 3 বালক; 2027: KG (Main) and Class 4 বালক — where they move up to. */
  nursery2026: { classId: Types.ObjectId; sectionId: Types.ObjectId };
  c3Boys2026: { classId: Types.ObjectId; sectionId: Types.ObjectId };
  kg2027: { classId: Types.ObjectId; sectionId: Types.ObjectId };
  c4Boys2027: { classId: Types.ObjectId; sectionId: Types.ObjectId };
  /** The Quran group the Class 3 boys are captured on (unchanged by the year change, Q11). */
  quranGroupId: Types.ObjectId;
  /** T-N1..T-N3 (Nursery) and T-B1..T-B3 (Class 3 বালক). */
  nursery: Types.ObjectId[];
  boys: Types.ObjectId[];
  /** Class teacher of the 2026 Class 3 বালক section only. */
  classTeacher2026: Types.ObjectId;
  /** Who marked the attendance days. */
  marker: Types.ObjectId;
  /** Section / group days in October and December 2026 (see the builder). */
  dayKeys: string[];
}

/**
 * YC-2: a small 2026 school after the backfill — every child has one 2026 ACTIVE enrolment
 * from 2026-01-01 — with attendance on a Nursery SECTION and on a Class 3 Quran GROUP, and
 * the 2027 sections the children move up to. Uses `seedYears()` (2026 current).
 */
export async function seedPastReadersWorld(): Promise<PastReadersFixture> {
  const years = await seedYears();
  const classTeacher2026 = new Types.ObjectId();
  const marker = new Types.ObjectId();
  const mkPlace = async (level: number, year: Types.ObjectId, code: string, nameBn: string, ct?: Types.ObjectId) => {
    const classId = (await Class.create({ level, nameBn: `${nameBn} ${level}`, academicYearId: year }))._id;
    const sectionId = (await Section.create({ classId, code, nameBn, active: true, ...(ct ? { classTeacherId: ct } : {}) }))._id;
    return { classId, sectionId };
  };
  const nursery2026 = await mkPlace(-1, years.y2026, "Main", "মূল");
  const c3Boys2026 = await mkPlace(3, years.y2026, "Boys", "বালক", classTeacher2026);
  const kg2027 = await mkPlace(0, years.y2027, "Main", "মূল");
  const c4Boys2027 = await mkPlace(4, years.y2027, "Boys", "বালক");

  const kid = async (schoolId: string, name: string, place: { classId: Types.ObjectId; sectionId: Types.ObjectId }) => {
    const s = await Student.create({ schoolId, name, gender: "male", classId: place.classId, sectionId: place.sectionId, active: true });
    await Enrolment.create({
      studentId: s._id,
      academicYearId: years.y2026,
      classId: place.classId,
      classLevel: (await Class.findById(place.classId).lean())!.level,
      sectionId: place.sectionId,
      status: "ACTIVE",
      startKey: "2026-01-01",
    });
    return s._id;
  };
  const nursery = [await kid("T-N1", "Test Child N1", nursery2026), await kid("T-N2", "Test Child N2", nursery2026), await kid("T-N3", "Test Child N3", nursery2026)];
  const boys = [await kid("T-B1", "Test Child B1", c3Boys2026), await kid("T-B2", "Test Child B2", c3Boys2026), await kid("T-B3", "Test Child B3", c3Boys2026)];

  // The class teacher also teaches MATH there (a routine grant, as in prod).
  const math = (await Subject.findOne({ code: "MATH" })) ?? (await Subject.create({ code: "MATH", nameBn: "গণিত" }));
  await ScopeGrant.create({
    teacherId: classTeacher2026,
    kind: "teaching",
    source: "routine",
    classId: c3Boys2026.classId,
    sectionId: c3Boys2026.sectionId,
    subjectId: math._id,
    createdBy: marker,
  });

  const quranGroupId = (await SubjectGroup.create({ track: "quran", level: "Nazera", gender: "boys", code: "QN-B", nameBn: "নাজেরা বালক" }))._id;
  for (const b of boys) await SubjectGroupMembership.create({ groupId: quranGroupId, studentId: b, track: "quran" });

  const day = async (unit: { sectionId?: Types.ObjectId; subjectGroupId?: Types.ObjectId }, dateKey: string, absent: Types.ObjectId[]) =>
    StudentAttendanceDay.create({ ...unit, dateKey, absentStudentIds: absent, markedBy: marker, markedAt: new Date(`${dateKey}T03:00:00.000Z`) });
  const dayKeys = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-12-10"];
  await day({ sectionId: nursery2026.sectionId }, "2026-10-05", [nursery[0]]);
  await day({ subjectGroupId: quranGroupId }, "2026-10-05", [boys[1]]);
  await day({ sectionId: nursery2026.sectionId }, "2026-10-06", []);
  await day({ subjectGroupId: quranGroupId }, "2026-10-06", [boys[1], boys[2]]);
  await day({ sectionId: nursery2026.sectionId }, "2026-10-07", [nursery[1]]);
  await day({ subjectGroupId: quranGroupId }, "2026-10-07", []);
  await day({ sectionId: nursery2026.sectionId }, "2026-12-10", []);
  await day({ subjectGroupId: quranGroupId }, "2026-12-10", []);

  return { years, nursery2026, c3Boys2026, kg2027, c4Boys2027, quranGroupId, nursery, boys, classTeacher2026, marker, dayKeys };
}

/**
 * YC-2: a SIMULATED cut-over (the YC-4 engine does not exist yet). Every 2026 ACTIVE
 * enrolment closes on 2027-01-02 as PROMOTED; the 2027 one opens on 2027-01-03 in the
 * section one level up (Nursery → KG, Class 3 বালক → Class 4 বালক); the Student pointers
 * move; the 2026 routine grants lapse; the current year flips to 2027 last.
 */
export async function simulateCutover(w: PastReadersFixture): Promise<void> {
  const up = new Map([
    [w.nursery2026.sectionId.toString(), w.kg2027],
    [w.c3Boys2026.sectionId.toString(), w.c4Boys2027],
  ]);
  const actives = await Enrolment.find({ academicYearId: w.years.y2026, status: "ACTIVE" });
  for (const e of actives) {
    const to = up.get(e.sectionId.toString());
    if (!to) continue;
    await Enrolment.create({
      studentId: e.studentId,
      academicYearId: w.years.y2027,
      classId: to.classId,
      classLevel: (await Class.findById(to.classId).lean())!.level,
      sectionId: to.sectionId,
      status: "ACTIVE",
      startKey: "2027-01-03",
    });
    await Student.updateOne({ _id: e.studentId }, { $set: { classId: to.classId, sectionId: to.sectionId } });
    e.status = "CLOSED";
    e.endKey = "2027-01-02";
    e.outcome = "PROMOTED";
    await e.save();
  }
  // The 2026 routine ends with the year: its grants lapse (YC-6 future-dates this to
  // 2027-01-03; the test clock is earlier, so the lapse is stamped in the past here).
  await ScopeGrant.updateMany(
    { kind: "teaching", source: "routine", sectionId: { $in: [w.nursery2026.sectionId, w.c3Boys2026.sectionId] } },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } },
  );
  await AcademicYear.updateMany({}, { $set: { current: false } });
  await AcademicYear.updateOne({ _id: w.years.y2027 }, { $set: { current: true } });
}
