/**
 * DeidScopeService (AI-4, D-#1094) — who might be named in a text, from the roster.
 *
 * For a comment about ONE child: that child (token [S]), every other child in the same
 * section, the guardians linked to any of them, and every active staff login. Inactive
 * links count too: a separated parent's name is still a name.
 *
 * Every spelling we hold is used: English name, Bangla name (`nameBn`). PRD P11: most
 * children have no Bangla name yet, so the Office fills them (AI-4's Bangla-name screen)
 * before the checker is switched on — `deidReadiness()` reports how far that has got.
 */
import { Types } from "mongoose";
import { Student } from "../../foundation/models/Student";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { User } from "../../foundation/models/User";
import type { DeidPerson, DeidScope } from "../ai/deidentify";

const names = (...xs: Array<string | null | undefined>) => xs.filter((x): x is string => !!x && x.trim().length > 0);

async function staffPeople(): Promise<DeidPerson[]> {
  const staff = await User.find({ active: true, role: { $ne: "GUARDIAN" } }).select("name").lean();
  return staff.map((u) => ({ kind: "T" as const, id: u._id.toString(), names: names(u.name) }));
}

/** The scope for a text about one child. Throws when the child does not exist. */
export async function scopeForStudent(studentId: string): Promise<DeidScope> {
  if (!Types.ObjectId.isValid(studentId)) throw new Error("শিক্ষার্থী পাওয়া যায়নি");
  const own = await Student.findById(studentId).select("name nameBn sectionId").lean();
  if (!own) throw new Error("শিক্ষার্থী পাওয়া যায়নি");
  const classmates = await Student.find({ sectionId: own.sectionId, _id: { $ne: own._id } }).select("name nameBn").lean();
  const studentIds = [own._id, ...classmates.map((s) => s._id)];
  const links = await GuardianLink.find({ studentId: { $in: studentIds } }).select("guardianId").lean();
  const guardians = await Guardian.find({ _id: { $in: [...new Set(links.map((l) => l.guardianId.toString()))] } }).select("name").lean();

  const people: DeidPerson[] = [
    { kind: "S", id: own._id.toString(), names: names(own.name, own.nameBn), own: true },
    ...classmates.map((s) => ({ kind: "S" as const, id: s._id.toString(), names: names(s.name, s.nameBn) })),
    ...guardians.map((g) => ({ kind: "G" as const, id: g._id.toString(), names: names(g.name) })),
    ...(await staffPeople()),
  ];
  return { people };
}

/** The scope for a text about several sections (the teacher assistant, AI-6). */
export async function scopeForSections(sectionIds: string[]): Promise<DeidScope> {
  const ids = sectionIds.filter((s) => Types.ObjectId.isValid(s)).map((s) => new Types.ObjectId(s));
  const students = ids.length ? await Student.find({ sectionId: { $in: ids } }).select("name nameBn").lean() : [];
  const links = students.length ? await GuardianLink.find({ studentId: { $in: students.map((s) => s._id) } }).select("guardianId").lean() : [];
  const guardians = links.length ? await Guardian.find({ _id: { $in: [...new Set(links.map((l) => l.guardianId.toString()))] } }).select("name").lean() : [];
  return {
    people: [
      ...students.map((s) => ({ kind: "S" as const, id: s._id.toString(), names: names(s.name, s.nameBn) })),
      ...guardians.map((g) => ({ kind: "G" as const, id: g._id.toString(), names: names(g.name) })),
      ...(await staffPeople()),
    ],
  };
}

export interface DeidReadiness {
  activeStudents: number;
  withBanglaName: number;
  missingBanglaName: number;
}

/** How many active children still lack a Bangla name (PRD P11). */
export async function deidReadiness(): Promise<DeidReadiness> {
  const [activeStudents, withBanglaName] = await Promise.all([
    Student.countDocuments({ active: { $ne: false } }),
    Student.countDocuments({ active: { $ne: false }, nameBn: { $nin: [null, ""] } }),
  ]);
  return { activeStudents, withBanglaName, missingBanglaName: activeStudents - withBanglaName };
}
