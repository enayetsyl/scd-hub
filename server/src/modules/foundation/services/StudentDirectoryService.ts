/**
 * Student directory — the whole active roster as flat table rows (Office/Principal,
 * roster:manage). One row per student: class + section, the Quran and Arabic
 * `SubjectGroup` they sit in (≤1 per track, D-#48), and the linked guardians'
 * phone numbers. Built from six batched reads so the table never pays the
 * per-student guardian lookup the section roster's `Student.guardians` field does.
 *
 * `buildDirectoryRows` is pure (lean docs in → rows out) so the joining rules are
 * testable without a database; `loadStudentDirectory` is the thin loader.
 */
import type { Types } from "mongoose";
import { Student } from "../models/Student";
import { Class } from "../models/Class";
import { Section } from "../models/Section";
import { GuardianLink } from "../models/GuardianLink";
import { Guardian } from "../models/Guardian";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";

export interface DirectoryGroup {
  id: string;
  code: string;
  level: string;
  gender: string;
  nameBn: string;
}

export interface DirectoryGuardian {
  relation: string;
  name: string;
  phone: string;
}

export interface DirectoryRow {
  id: string;
  schoolId: string;
  name: string;
  nameBn: string | null;
  classId: string;
  classLevel: number | null;
  classNameBn: string | null;
  sectionId: string;
  sectionCode: string | null;
  sectionNameBn: string | null;
  quranGroup: DirectoryGroup | null;
  arabicGroup: DirectoryGroup | null;
  /** Guardians that HAVE a phone, one entry per distinct number (a mother and
   *  father sharing the family phone show once). */
  guardians: DirectoryGuardian[];
}

type Oid = Types.ObjectId;

export interface DirectoryInput {
  students: { _id: Oid; schoolId: string; name: string; nameBn?: string; classId: Oid; sectionId: Oid }[];
  classes: { _id: Oid; level: number; nameBn: string }[];
  sections: { _id: Oid; code: string; nameBn: string }[];
  groups: { _id: Oid; track: string; code: string; level: string; gender: string; nameBn: string }[];
  memberships: { groupId: Oid; studentId: Oid; track: string }[];
  links: { guardianId: Oid; studentId: Oid; relation: string }[];
  guardians: { _id: Oid; name: string; phone?: string }[];
}

/** Rows ordered class level → section code → school ID, the order the office
 *  reads a register in. */
export function buildDirectoryRows(input: DirectoryInput): DirectoryRow[] {
  const classById = new Map(input.classes.map((c) => [c._id.toString(), c]));
  const sectionById = new Map(input.sections.map((s) => [s._id.toString(), s]));
  const groupById = new Map(input.groups.map((g) => [g._id.toString(), g]));
  const guardianById = new Map(input.guardians.map((g) => [g._id.toString(), g]));

  const groupsByStudent = new Map<string, { quran?: DirectoryGroup; arabic?: DirectoryGroup }>();
  for (const m of input.memberships) {
    const g = groupById.get(m.groupId.toString());
    if (!g) continue; // inactive / deleted group — not a placement to show
    const view: DirectoryGroup = { id: g._id.toString(), code: g.code, level: g.level, gender: g.gender, nameBn: g.nameBn };
    const key = m.studentId.toString();
    const slot = groupsByStudent.get(key) ?? {};
    if (g.track === "quran") slot.quran = view;
    else if (g.track === "arabic") slot.arabic = view;
    groupsByStudent.set(key, slot);
  }

  const guardiansByStudent = new Map<string, DirectoryGuardian[]>();
  for (const l of input.links) {
    const g = guardianById.get(l.guardianId.toString());
    const phone = g?.phone?.trim();
    if (!g || !phone) continue;
    const key = l.studentId.toString();
    const list = guardiansByStudent.get(key) ?? [];
    if (!list.some((x) => x.phone === phone)) list.push({ relation: l.relation, name: g.name, phone });
    guardiansByStudent.set(key, list);
  }

  const rows = input.students.map((s): DirectoryRow => {
    const key = s._id.toString();
    const cls = classById.get(s.classId.toString());
    const sec = sectionById.get(s.sectionId.toString());
    const groups = groupsByStudent.get(key);
    return {
      id: key,
      schoolId: s.schoolId,
      name: s.name,
      nameBn: s.nameBn ?? null,
      classId: s.classId.toString(),
      classLevel: cls ? cls.level : null,
      classNameBn: cls ? cls.nameBn : null,
      sectionId: s.sectionId.toString(),
      sectionCode: sec ? sec.code : null,
      sectionNameBn: sec ? sec.nameBn : null,
      quranGroup: groups?.quran ?? null,
      arabicGroup: groups?.arabic ?? null,
      guardians: guardiansByStudent.get(key) ?? [],
    };
  });

  return rows.sort(
    (a, b) =>
      (a.classLevel ?? 99) - (b.classLevel ?? 99) ||
      (a.sectionCode ?? "").localeCompare(b.sectionCode ?? "") ||
      a.schoolId.localeCompare(b.schoolId, undefined, { numeric: true }),
  );
}

export async function loadStudentDirectory(): Promise<DirectoryRow[]> {
  const students = await Student.find({ active: true })
    .select("schoolId name nameBn classId sectionId")
    .lean();
  const studentIds = students.map((s) => s._id);
  const [classes, sections, groups, memberships, links] = await Promise.all([
    Class.find({ _id: { $in: [...new Set(students.map((s) => s.classId.toString()))] } }).select("level nameBn").lean(),
    Section.find({ _id: { $in: [...new Set(students.map((s) => s.sectionId.toString()))] } }).select("code nameBn").lean(),
    SubjectGroup.find({ active: true }).select("track code level gender nameBn").lean(),
    SubjectGroupMembership.find({ studentId: { $in: studentIds } }).select("groupId studentId track").lean(),
    GuardianLink.find({ studentId: { $in: studentIds } }).select("guardianId studentId relation").lean(),
  ]);
  const guardians = await Guardian.find({ _id: { $in: links.map((l) => l.guardianId) } })
    .select("name phone")
    .lean();
  return buildDirectoryRows({ students, classes, sections, groups, memberships, links, guardians });
}
