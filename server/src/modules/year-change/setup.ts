/**
 * yearChangeSetup (YC-5, docs/prd-year-change.md section 5): everything the Principal's year-change
 * screen needs to prefill step 1 - the years, the past year's classes and sections, every active
 * child (ordered by school ID, no roll numbers - D-#1463), the class teachers, and the default
 * choices. READ-ONLY.
 *
 * Prefill: every child PROMOTE (a child already in the top class defaults to LEFT - there is no
 * class after it, and the engine refuses a promotion past it); the next year's default section
 * shape; each new section's class teacher = the past year's teacher of the same level and code.
 */
import { ROSTER_CLASS_LEVEL_MAX } from "@scd/shared";
import { AcademicYear } from "../foundation/models/AcademicYear";
import { Class } from "../foundation/models/Class";
import { Section } from "../foundation/models/Section";
import { Student } from "../foundation/models/Student";
import { User } from "../foundation/models/User";
import { Enrolment } from "../foundation/models/Enrolment";
import { YearChangeRun } from "./models/YearChangeRun";
import { normSchoolId } from "./plan";
import { SECTION_CODES, defaultSections, type SectionCode } from "./types";

const sid = (id: unknown): string => String(id);

export interface SetupYear {
  id: string;
  label: string;
  current: boolean;
}
export interface SetupSection {
  id: string;
  code: string;
  nameBn: string;
  classTeacherId: string | null;
}
export interface SetupClass {
  id: string;
  level: number;
  nameBn: string;
  sections: SetupSection[];
}
export interface SetupChild {
  studentId: string;
  schoolId: string;
  name: string;
  nameBn: string | null;
  gender: string | null;
  level: number;
  sectionCode: string;
  /** PROMOTE (LEFT for a child in the top class); a prepared run's own choice when one exists. */
  decision: "PROMOTE" | "REPEAT" | "LEFT";
  /** The section the prepared run placed the child in; null when there is no prepared run. */
  toSectionCode: string | null;
}
export interface SetupAdmission {
  schoolId: string;
  name: string;
  nameBn: string | null;
  gender: string;
  level: number;
  sectionCode: string;
  guardianPhone: string;
}
export interface SetupTeacher {
  id: string;
  name: string;
}
export interface SetupClassPlan {
  level: number;
  nameBn: string;
  sections: SectionCode[];
}
export interface SetupClassTeacher {
  level: number;
  sectionCode: SectionCode;
  teacherId: string;
}
export interface YearChangeSetup {
  years: SetupYear[];
  fromYearId: string | null;
  toYearId: string | null;
  classes: SetupClass[];
  children: SetupChild[];
  teachers: SetupTeacher[];
  classPlan: SetupClassPlan[];
  classTeachers: SetupClassTeacher[];
  /** The prepared run of this year pair (null on a first prepare): the lists above are ITS choices. */
  preparedRunId: string | null;
  admissions: SetupAdmission[];
  copy: Record<string, boolean> | null;
}

/** Numeric order of school IDs ("0059" before "103"), ties by the raw text. */
export function bySchoolId(a: string, b: string): number {
  const x = Number(normSchoolId(a));
  const y = Number(normSchoolId(b));
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  return a.localeCompare(b, "en", { numeric: true });
}

export async function yearChangeSetup(fromYearId?: string | null, toYearId?: string | null): Promise<YearChangeSetup> {
  const yearDocs = await AcademicYear.find({}).sort({ startDate: 1 }).lean();
  const years: SetupYear[] = yearDocs.map((y) => ({ id: sid(y._id), label: y.label, current: !!y.current }));
  const empty: YearChangeSetup = { years, fromYearId: null, toYearId: null, classes: [], children: [], teachers: [], classPlan: [], classTeachers: [], preparedRunId: null, admissions: [], copy: null };

  const from = (fromYearId && yearDocs.find((y) => sid(y._id) === fromYearId)) || yearDocs.find((y) => y.current) || null;
  if (!from) return empty;
  const to =
    (toYearId && yearDocs.find((y) => sid(y._id) === toYearId && sid(y._id) !== sid(from._id))) ||
    yearDocs.find((y) => y.startDate > from.startDate) ||
    null;
  const base = { ...empty, fromYearId: sid(from._id), toYearId: to ? sid(to._id) : null };

  const fromClasses = await Class.find({ academicYearId: from._id }).sort({ level: 1 }).lean();
  const sections = await Section.find({ classId: { $in: fromClasses.map((c) => c._id) }, code: { $in: SECTION_CODES as unknown as string[] } }).lean();
  const sectionById = new Map(sections.map((s) => [sid(s._id), s]));
  const classById = new Map(fromClasses.map((c) => [sid(c._id), c]));

  const classes: SetupClass[] = fromClasses.map((c) => ({
    id: sid(c._id),
    level: c.level,
    nameBn: c.nameBn,
    sections: sections
      .filter((s) => sid(s.classId) === sid(c._id))
      .map((s) => ({ id: sid(s._id), code: s.code, nameBn: s.nameBn, classTeacherId: s.classTeacherId ? sid(s.classTeacherId) : null })),
  }));

  const students = await Student.find({ active: true, classId: { $in: fromClasses.map((c) => c._id) } })
    .select("schoolId name nameBn gender classId sectionId")
    .lean();
  const children: SetupChild[] = students
    .map((s) => {
      const cls = classById.get(sid(s.classId));
      const sec = sectionById.get(sid(s.sectionId));
      const level = cls?.level ?? 0;
      return {
        studentId: sid(s._id),
        schoolId: s.schoolId,
        name: s.name,
        nameBn: s.nameBn ?? null,
        gender: s.gender ?? null,
        level,
        sectionCode: sec?.code ?? "?",
        decision: (level >= ROSTER_CLASS_LEVEL_MAX ? "LEFT" : "PROMOTE") as SetupChild["decision"],
        toSectionCode: null as string | null,
      };
    })
    .sort((a, b) => bySchoolId(a.schoolId, b.schoolId));

  const teacherDocs = await User.find({ role: "TEACHER", active: { $ne: false } }).select("name").sort({ name: 1 }).lean();
  const teachers: SetupTeacher[] = teacherDocs.map((u) => ({ id: sid(u._id), name: u.name }));

  // A prepared run of this pair: re-opening the screen must show ITS choices, or a second
  // "apply" would silently undo the first preparation (the engine reconciles to what it is sent).
  const run = to ? await YearChangeRun.findOne({ fromYearId: from._id, toYearId: to._id, status: "PREPARED" }).lean() : null;
  const teacherIds = new Set(teachers.map((t) => t.id));
  const activeTeacher = (id: string | null | undefined): string | null => (id && teacherIds.has(id) ? id : null);
  let admissions: SetupAdmission[] = [];
  let copy: Record<string, boolean> | null = null;
  const toShapes = new Map<number, SectionCode[]>();
  const runTeachers: SetupClassTeacher[] = [];
  if (run && to) {
    copy = (run.copyOptions as Record<string, boolean> | undefined) ?? null;
    const toClasses = await Class.find({ academicYearId: to._id }).lean();
    const toSections = await Section.find({ classId: { $in: toClasses.map((c) => c._id) }, code: { $in: SECTION_CODES as unknown as string[] } }).lean();
    const levelOfClass = new Map(toClasses.map((c) => [sid(c._id), c.level]));
    const codeOfSection = new Map(toSections.map((x) => [sid(x._id), x.code as SectionCode]));
    for (const c of toClasses) {
      const codes = toSections.filter((x) => sid(x.classId) === sid(c._id)).map((x) => x.code as SectionCode);
      if (codes.length) toShapes.set(c.level, SECTION_CODES.filter((k) => codes.includes(k)));
    }
    for (const x of toSections) {
      const t = activeTeacher(x.classTeacherId ? sid(x.classTeacherId) : null);
      const level = levelOfClass.get(sid(x.classId));
      if (t && level !== undefined) runTeachers.push({ level, sectionCode: x.code as SectionCode, teacherId: t });
    }
    const planned = await Enrolment.find({ runId: run.runId, academicYearId: to._id }).select("studentId classLevel sectionId").lean();
    const plannedOf = new Map(planned.map((e) => [sid(e.studentId), e]));
    const leavers = new Set(run.leaverIds ?? []);
    for (const ch of children) {
      if (leavers.has(ch.studentId)) {
        ch.decision = "LEFT";
        continue;
      }
      const e = plannedOf.get(ch.studentId);
      if (!e) continue;
      ch.decision = e.classLevel > ch.level ? "PROMOTE" : "REPEAT";
      ch.toSectionCode = codeOfSection.get(sid(e.sectionId)) ?? null;
    }
    const adm = await Student.find({ yearChangeRunId: run.runId }).select("schoolId name nameBn gender phone").lean();
    admissions = adm
      .map((a) => {
        const e = plannedOf.get(sid(a._id));
        return {
          schoolId: a.schoolId,
          name: a.name,
          nameBn: a.nameBn ?? null,
          gender: a.gender ?? "male",
          level: e?.classLevel ?? 0,
          sectionCode: (e && codeOfSection.get(sid(e.sectionId))) || "Main",
          guardianPhone: a.phone ?? "",
        };
      })
      .sort((x, y) => bySchoolId(x.schoolId, y.schoolId));
  }

  // The next year's levels: everyone one up, repeaters/admissions on the same level, and the top class.
  const fromLevels = classes.map((c) => c.level);
  const levels = [...new Set<number>([...fromLevels, ...fromLevels.map((l) => l + 1).filter((l) => l <= ROSTER_CLASS_LEVEL_MAX), ROSTER_CLASS_LEVEL_MAX])].sort((a, b) => a - b);
  const nameOfLevel = (level: number): string => classes.find((c) => c.level === level)?.nameBn ?? "";
  const classPlan: SetupClassPlan[] = levels.map((level) => ({ level, nameBn: nameOfLevel(level), sections: toShapes.get(level) ?? defaultSections(level) }));

  // Class teachers: the prepared run's, else last year's teacher of the same level and code - and only
  // a teacher who is still an active TEACHER (a left or re-roled one would be refused at the apply).
  const classTeachers: SetupClassTeacher[] = [...runTeachers];
  for (const p of classPlan) {
    const past = classes.find((c) => c.level === p.level);
    for (const code of p.sections) {
      if (classTeachers.some((t) => t.level === p.level && t.sectionCode === code)) continue;
      const t = activeTeacher(past?.sections.find((s) => s.code === code)?.classTeacherId);
      if (t) classTeachers.push({ level: p.level, sectionCode: code, teacherId: t });
    }
  }
  return { ...base, classes, children, teachers, classPlan, classTeachers, preparedRunId: run?.runId ?? null, admissions, copy };
}
