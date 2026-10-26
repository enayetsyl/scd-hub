/**
 * Who a pop-up notice reaches (D-#853/#854, docs/prd-popup-notice.md §3).
 *
 * An audience is three parts, UNIONED:
 *   - a staff filter   (role × employment × gender × class taught × subject taught × class teacher)
 *   - a guardian filter (child's class level and/or section)
 *   - hand-picked people (staff logins and families-by-child) — the owner's custom list
 * Inside the staff filter the rows are ANDed and the values inside a row ORed, so
 * "female teachers who teach KG" is one filter.
 *
 * Every input is data that already exists: `User` (role, active), `StaffProfile`
 * (gender, employmentStatus — joined by the staffMatch phone-then-email rule, D-#788),
 * the LIVE routine (`RoutineSlot` → class level and subject; a Quran/Arabic group slot
 * takes the class levels of the group's members, since those slots carry no class),
 * `Section.classTeacherId`, and `GuardianLink → Student → Class/Section`.
 *
 * A guardian with two matched children is ONE recipient carrying both names. A guardian
 * with no app login, and a family with no guardian row at all, are recipients that cannot
 * be reached (`reachable: false`): they are counted and listed for wa.me, never dropped.
 *
 * Identity plane; no corpus path (ADR-005). Read-only.
 */
import { Types } from "mongoose";
import {
  DEFAULT_SECTION_CODE,
  ROSTER_CLASS_LABELS_BN,
  ROUTINE_SUBJECTS,
  ROUTINE_SUBJECT_LABELS_BN,
  type RosterClassLevel,
  type RoutineSubject,
} from "@scd/shared";
import { User } from "../../foundation/models/User";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { Student } from "../../foundation/models/Student";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { normalizePhone } from "../../foundation/services/credentials";
import { personName } from "../../../lib/personName";
import { pageOf, type Page, type PageArgs } from "../../../lib/paging";
import type { PopupAudience, PopupGuardianFilter, PopupStaffFilter } from "../models/PopupNotice";
import type { PopupRecipientKind, PopupRecipientVars } from "../models/PopupNoticeRecipient";

export class PopupNoticeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PopupNoticeError";
  }
}

const STAFF_ROLES = ["PRINCIPAL", "TEACHER", "OFFICE"] as const;
const ROLE_BN: Record<string, string> = { PRINCIPAL: "প্রধান শিক্ষক", TEACHER: "শিক্ষক", OFFICE: "অফিস" };
const LEVELS = new Set<number>([-1, 0, 1, 2, 3, 4, 5]);
const SUBJECTS = new Set<string>(ROUTINE_SUBJECTS);
const GENDERS = new Set(["male", "female"]);
const EMPLOYMENT = new Set(["current", "probation", "confirmed"]);

// ---------------------------------------------------------------------------
// Input normalisation (what the composer sends → what is stored)
// ---------------------------------------------------------------------------

export interface PopupAudienceInput {
  staff?: {
    roles?: string[] | null;
    employment?: string | null;
    genders?: string[] | null;
    classLevels?: number[] | null;
    subjects?: string[] | null;
    classTeachersOnly?: boolean | null;
  } | null;
  guardian?: { classLevels?: number[] | null; sectionIds?: string[] | null } | null;
  userIds?: string[] | null;
  studentIds?: string[] | null;
}

function oid(id: string, what: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new PopupNoticeError(`${what} সঠিক নয়`);
  return new Types.ObjectId(id);
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/** Validates and canonicalises an audience. Throws a Bangla PopupNoticeError on bad input. */
export function normalizeAudience(input: PopupAudienceInput | null | undefined): PopupAudience {
  const a = input ?? {};
  let staff: PopupStaffFilter | null = null;
  if (a.staff) {
    const roles = uniq(a.staff.roles ?? []);
    if (roles.some((r) => !(STAFF_ROLES as readonly string[]).includes(r))) throw new PopupNoticeError("কর্মীর ভূমিকা সঠিক নয়");
    const employment = a.staff.employment ?? "current";
    if (!EMPLOYMENT.has(employment)) throw new PopupNoticeError("চাকরির অবস্থা সঠিক নয়");
    const genders = uniq(a.staff.genders ?? []);
    if (genders.some((g) => !GENDERS.has(g))) throw new PopupNoticeError("লিঙ্গ সঠিক নয়");
    const classLevels = uniq(a.staff.classLevels ?? []);
    if (classLevels.some((l) => !LEVELS.has(l))) throw new PopupNoticeError("শ্রেণি সঠিক নয়");
    const subjects = uniq(a.staff.subjects ?? []);
    if (subjects.some((s) => !SUBJECTS.has(s))) throw new PopupNoticeError("বিষয় সঠিক নয়");
    staff = {
      roles,
      employment: employment as PopupStaffFilter["employment"],
      genders,
      classLevels,
      subjects,
      classTeachersOnly: !!a.staff.classTeachersOnly,
    };
  }
  let guardian: PopupGuardianFilter | null = null;
  if (a.guardian) {
    const classLevels = uniq(a.guardian.classLevels ?? []);
    if (classLevels.some((l) => !LEVELS.has(l))) throw new PopupNoticeError("শ্রেণি সঠিক নয়");
    guardian = {
      classLevels,
      sectionIds: uniq(a.guardian.sectionIds ?? []).map((s) => oid(s, "শাখা")),
    };
  }
  return {
    staff,
    guardian,
    userIds: uniq(a.userIds ?? []).map((u) => oid(u, "কর্মী")),
    studentIds: uniq(a.studentIds ?? []).map((s) => oid(s, "শিক্ষার্থী")),
  };
}

/** Does the audience name anyone at all (a filter or a picked person)? */
export function audienceIsEmpty(a: PopupAudience): boolean {
  return !a.staff && !a.guardian && a.userIds.length === 0 && a.studentIds.length === 0;
}

/** Which halves of the audience need which send permission. */
export function audienceTouches(a: PopupAudience): { staff: boolean; guardian: boolean } {
  return { staff: !!a.staff || a.userIds.length > 0, guardian: !!a.guardian || a.studentIds.length > 0 };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedRecipient {
  kind: PopupRecipientKind;
  id: Types.ObjectId;
  reachable: boolean;
  vars: PopupRecipientVars;
}

export interface ResolvedAudience {
  recipients: ResolvedRecipient[];
  staffCount: number;
  guardianCount: number;
  /** Guardians without a login + families with no guardian row. */
  unreachableCount: number;
  /** Staff matched by every other row of a gender filter but with no gender on file. */
  staffMissingGender: number;
}

interface StaffInfo {
  gender?: string;
  employmentStatus?: string;
}

/** The StaffProfile facts per staff User id, by the staffMatch rule (D-#788): normalised
 *  phone first; the email only when the phone finds no one; one match per key only. */
async function staffInfoFor(users: Array<{ _id: Types.ObjectId; phone?: string; email?: string }>): Promise<Map<string, StaffInfo>> {
  const out = new Map<string, StaffInfo>();
  const profiles = (await StaffProfile.find({ active: true, $or: [{ phone: { $ne: null } }, { email: { $nin: [null, ""] } }] })
    .select("phone email gender employmentStatus")
    .lean()) as unknown as Array<{ phone?: string; email?: string; gender?: string; employmentStatus?: string }>;
  const normEmail = (e?: string | null): string => (e ?? "").trim().toLowerCase();
  const byPhone = new Map<string, StaffInfo[]>();
  const byEmail = new Map<string, StaffInfo[]>();
  for (const p of profiles) {
    const info = { gender: p.gender, employmentStatus: p.employmentStatus };
    if (p.phone) {
      const k = normalizePhone(p.phone);
      byPhone.set(k, [...(byPhone.get(k) ?? []), info]);
    }
    const e = normEmail(p.email);
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), info]);
  }
  for (const u of users) {
    const viaPhone = u.phone ? byPhone.get(normalizePhone(u.phone)) ?? [] : [];
    const found = viaPhone.length > 0 ? viaPhone : byEmail.get(normEmail(u.email)) ?? [];
    if (found.length === 1) out.set(u._id.toString(), found[0]);
  }
  return out;
}

/** What each teacher teaches in the routine live at `now`: class levels and subjects. */
async function teachingFor(now: Date): Promise<Map<string, { levels: Set<number>; subjects: Set<string> }>> {
  const slots = (await RoutineSlot.find({
    active: true,
    isBreak: { $ne: true },
    teacherId: { $ne: null },
    effectiveFrom: { $lte: now },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: now } }],
  })
    .select("teacherId groupType groupId classId subject")
    .lean()) as unknown as Array<{ teacherId: Types.ObjectId; groupType: string; groupId: Types.ObjectId; classId?: Types.ObjectId; subject: string }>;
  if (slots.length === 0) return new Map();

  const classes = (await Class.find({}).select("level").lean()) as unknown as Array<{ _id: Types.ObjectId; level: number }>;
  const levelOfClass = new Map(classes.map((c) => [c._id.toString(), c.level]));
  const sectionIds = uniq(slots.filter((s) => s.groupType === "section").map((s) => s.groupId.toString()));
  const sections = (await Section.find({ _id: { $in: sectionIds } }).select("classId").lean()) as unknown as Array<{ _id: Types.ObjectId; classId: Types.ObjectId }>;
  const classOfSection = new Map(sections.map((s) => [s._id.toString(), s.classId.toString()]));

  // A Quran/Arabic group slot has no class: it teaches the classes its members are in.
  const groupIds = uniq(slots.filter((s) => s.groupType === "subjectgroup").map((s) => s.groupId.toString()));
  const levelsOfGroup = new Map<string, Set<number>>();
  if (groupIds.length > 0) {
    const members = (await SubjectGroupMembership.find({ groupId: { $in: groupIds } }).select("groupId studentId").lean()) as unknown as Array<{ groupId: Types.ObjectId; studentId: Types.ObjectId }>;
    const kids = (await Student.find({ _id: { $in: members.map((m) => m.studentId) }, active: true }).select("classId").lean()) as unknown as Array<{ _id: Types.ObjectId; classId: Types.ObjectId }>;
    const classOfKid = new Map(kids.map((k) => [k._id.toString(), k.classId.toString()]));
    for (const m of members) {
      const cls = classOfKid.get(m.studentId.toString());
      const lvl = cls ? levelOfClass.get(cls) : undefined;
      if (lvl === undefined) continue;
      const set = levelsOfGroup.get(m.groupId.toString()) ?? new Set<number>();
      set.add(lvl);
      levelsOfGroup.set(m.groupId.toString(), set);
    }
  }

  const out = new Map<string, { levels: Set<number>; subjects: Set<string> }>();
  for (const s of slots) {
    const key = s.teacherId.toString();
    const entry = out.get(key) ?? { levels: new Set<number>(), subjects: new Set<string>() };
    entry.subjects.add(s.subject);
    if (s.groupType === "subjectgroup") {
      for (const l of levelsOfGroup.get(s.groupId.toString()) ?? []) entry.levels.add(l);
    } else {
      const cls = s.classId?.toString() ?? classOfSection.get(s.groupId.toString());
      const lvl = cls ? levelOfClass.get(cls) : undefined;
      if (lvl !== undefined) entry.levels.add(lvl);
    }
    out.set(key, entry);
  }
  return out;
}

async function resolveStaff(a: PopupAudience, now: Date): Promise<{ rows: ResolvedRecipient[]; missingGender: number }> {
  const f = a.staff;
  const picked = new Set(a.userIds.map((u) => u.toString()));
  if (!f && picked.size === 0) return { rows: [], missingGender: 0 };

  const users = (await User.find({ active: true, role: { $in: STAFF_ROLES } })
    .select("name role phone email")
    .sort({ name: 1 })
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; role: string; phone?: string; email?: string }>;

  // Even "current" needs the HR row: a resigned person whose login is still active is out.
  const info = f ? await staffInfoFor(users) : new Map<string, StaffInfo>();
  const needsRoutine = !!f && (f.classLevels.length > 0 || f.subjects.length > 0);
  const teaching = needsRoutine ? await teachingFor(now) : new Map();
  const classTeachers = f?.classTeachersOnly
    ? new Set(
        ((await Section.find({ active: true, classTeacherId: { $ne: null } }).select("classTeacherId").lean()) as unknown as Array<{ classTeacherId: Types.ObjectId }>)
          .map((s) => s.classTeacherId.toString()),
      )
    : new Set<string>();

  let missingGender = 0;
  const matches = (u: (typeof users)[number]): boolean => {
    if (!f) return false;
    const id = u._id.toString();
    if (f.roles.length > 0 && !f.roles.includes(u.role)) return false;
    const p = info.get(id);
    // "Current" = probation + confirmed (owner, 2026-10-26). An active login with no
    // HR row is current by definition — it can sign in, so it can be told.
    if (f.employment === "current") {
      if (p?.employmentStatus && !["probation", "confirmed"].includes(p.employmentStatus)) return false;
    } else if (p?.employmentStatus !== f.employment) return false;
    if (f.classLevels.length > 0 && !f.classLevels.some((l) => teaching.get(id)?.levels.has(l))) return false;
    if (f.subjects.length > 0 && !f.subjects.some((s) => teaching.get(id)?.subjects.has(s))) return false;
    if (f.classTeachersOnly && !classTeachers.has(id)) return false;
    if (f.genders.length > 0) {
      if (!p?.gender) {
        missingGender += 1;
        return false;
      }
      if (!f.genders.includes(p.gender)) return false;
    }
    return true;
  };

  const rows: ResolvedRecipient[] = [];
  for (const u of users) {
    if (!picked.has(u._id.toString()) && !matches(u)) continue;
    rows.push({
      kind: "USER",
      id: u._id,
      reachable: true,
      vars: { name: personName(u), childNames: [], classLabels: [], group: ROLE_BN[u.role] ?? u.role, phone: u.phone ?? "" },
    });
  }
  return { rows, missingGender };
}

/** "তৃতীয় শ্রেণি বালিকা" — the class label, plus the section's name unless it is the only (default) one. */
function classLabel(level: number | undefined, section: { code?: string; nameBn?: string } | undefined): string {
  const cls = level !== undefined ? ROSTER_CLASS_LABELS_BN[level as RosterClassLevel] ?? "" : "";
  if (!section || section.code === DEFAULT_SECTION_CODE || !section.nameBn) return cls;
  return cls ? `${cls} ${section.nameBn}` : section.nameBn;
}

async function resolveGuardians(a: PopupAudience): Promise<ResolvedRecipient[]> {
  const g = a.guardian;
  if (!g && a.studentIds.length === 0) return [];

  const classes = (await Class.find({}).select("level active").lean()) as unknown as Array<{ _id: Types.ObjectId; level: number; active?: boolean }>;
  const levelOfClass = new Map(classes.map((c) => [c._id.toString(), c.level]));

  const or: Record<string, unknown>[] = [];
  if (g) {
    if (g.classLevels.length === 0 && g.sectionIds.length === 0) or.push({});
    if (g.classLevels.length > 0) {
      const classIds = classes.filter((c) => g.classLevels.includes(c.level)).map((c) => c._id);
      or.push({ classId: { $in: classIds } });
    }
    if (g.sectionIds.length > 0) or.push({ sectionId: { $in: g.sectionIds } });
  }
  if (a.studentIds.length > 0) or.push({ _id: { $in: a.studentIds } });
  const students = (await Student.find({ active: true, $or: or })
    .select("name nameBn classId sectionId phone")
    .sort({ name: 1 })
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string; classId: Types.ObjectId; sectionId: Types.ObjectId; phone?: string }>;
  if (students.length === 0) return [];

  const sections = (await Section.find({ _id: { $in: uniq(students.map((s) => s.sectionId.toString())) } })
    .select("code nameBn")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; code?: string; nameBn?: string }>;
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
  const labelOf = (s: (typeof students)[number]): string =>
    classLabel(levelOfClass.get(s.classId.toString()), sectionById.get(s.sectionId.toString()));

  const links = (await GuardianLink.find({ studentId: { $in: students.map((s) => s._id) }, active: { $ne: false } })
    .select("guardianId studentId")
    .lean()) as unknown as Array<{ guardianId: Types.ObjectId; studentId: Types.ObjectId }>;
  const guardians = (await Guardian.find({ _id: { $in: uniq(links.map((l) => l.guardianId.toString())) }, active: true })
    .select("name phone loginEnabled")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; phone?: string; loginEnabled?: boolean }>;
  const guardianById = new Map(guardians.map((x) => [x._id.toString(), x]));
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));

  const kidsOf = new Map<string, Array<(typeof students)[number]>>();
  const covered = new Set<string>();
  for (const l of links) {
    const gid = l.guardianId.toString();
    if (!guardianById.has(gid)) continue;
    const kid = studentById.get(l.studentId.toString());
    if (!kid) continue;
    kidsOf.set(gid, [...(kidsOf.get(gid) ?? []), kid]);
    covered.add(kid._id.toString());
  }

  const rows: ResolvedRecipient[] = [];
  for (const [gid, kids] of kidsOf) {
    const gd = guardianById.get(gid)!;
    const labels = uniq(kids.map(labelOf).filter(Boolean));
    rows.push({
      kind: "GUARDIAN",
      id: gd._id,
      reachable: !!gd.loginEnabled,
      vars: {
        name: personName(gd),
        childNames: kids.map((k) => personName(k)),
        classLabels: labels,
        group: labels[0] ?? "",
        phone: gd.phone || kids.find((k) => k.phone)?.phone || "",
      },
    });
  }
  // A family with no guardian row at all still exists for the sender: unreachable, by child.
  for (const s of students) {
    if (covered.has(s._id.toString())) continue;
    const label = labelOf(s);
    rows.push({
      kind: "STUDENT",
      id: s._id,
      reachable: false,
      vars: { name: personName(s), childNames: [personName(s)], classLabels: label ? [label] : [], group: label, phone: s.phone ?? "" },
    });
  }
  rows.sort((x, y) => x.vars.group.localeCompare(y.vars.group) || x.vars.name.localeCompare(y.vars.name));
  return rows;
}

/** Everyone the audience reaches at `now`, deduplicated per person. */
export async function resolveAudience(a: PopupAudience, now = new Date()): Promise<ResolvedAudience> {
  const [staff, guardians] = await Promise.all([resolveStaff(a, now), resolveGuardians(a)]);
  const recipients = [...staff.rows, ...guardians];
  return {
    recipients,
    staffCount: staff.rows.length,
    // Families: guardians, plus children with no guardian row (each one family).
    guardianCount: guardians.length,
    unreachableCount: recipients.filter((r) => !r.reachable).length,
    staffMissingGender: staff.missingGender,
  };
}

// ---------------------------------------------------------------------------
// Description + preview
// ---------------------------------------------------------------------------

const join = (xs: string[]): string => xs.join(" বা ");

/** A Bangla one-line description of an audience, e.g. "শিক্ষক · নারী · কেজিতে পড়ান + ৩ জন বাছাই". */
export async function describeAudience(a: PopupAudience): Promise<string> {
  const parts: string[] = [];
  const bn = (n: number) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
  if (a.staff) {
    const f = a.staff;
    const s: string[] = [f.roles.length ? join(f.roles.map((r) => ROLE_BN[r] ?? r)) : "সব কর্মী"];
    if (f.employment === "probation") s.push("শিক্ষানবিশ");
    if (f.employment === "confirmed") s.push("স্থায়ী");
    if (f.genders.length) s.push(join(f.genders.map((g) => (g === "male" ? "পুরুষ" : "নারী"))));
    if (f.classLevels.length) s.push(`${join(f.classLevels.map((l) => ROSTER_CLASS_LABELS_BN[l as RosterClassLevel]))}-এ পড়ান`);
    if (f.subjects.length) s.push(`${join(f.subjects.map((x) => ROUTINE_SUBJECT_LABELS_BN[x as RoutineSubject] ?? x))} পড়ান`);
    if (f.classTeachersOnly) s.push("শ্রেণি শিক্ষক");
    parts.push(s.join(" · "));
  }
  if (a.guardian) {
    const g = a.guardian;
    const names: string[] = g.classLevels.map((l) => ROSTER_CLASS_LABELS_BN[l as RosterClassLevel]);
    if (g.sectionIds.length) {
      const secs = (await Section.find({ _id: { $in: g.sectionIds } }).select("classId code nameBn").lean()) as unknown as Array<{ classId: Types.ObjectId; code?: string; nameBn?: string }>;
      const classes = (await Class.find({ _id: { $in: secs.map((s) => s.classId) } }).select("level").lean()) as unknown as Array<{ _id: Types.ObjectId; level: number }>;
      const lvl = new Map(classes.map((c) => [c._id.toString(), c.level]));
      for (const s of secs) names.push(classLabel(lvl.get(s.classId.toString()), s));
    }
    parts.push(`অভিভাবক: ${names.length ? join(names) : "সব শ্রেণি"}`);
  }
  const picked = a.userIds.length + a.studentIds.length;
  if (picked) parts.push(`${bn(picked)} জন বাছাই করা`);
  return parts.join(" + ") || "কেউ নেই";
}

export interface AudiencePreviewPerson {
  kind: PopupRecipientKind;
  id: string;
  name: string;
  detail: string;
  reachable: boolean;
}

export interface AudiencePreview {
  total: number;
  staffCount: number;
  guardianCount: number;
  reachableCount: number;
  unreachableCount: number;
  staffMissingGender: number;
  summary: string;
  people: Page<AudiencePreviewPerson>;
}

/** The composer's live count + name list (paged). */
export async function previewAudience(a: PopupAudience, args: PageArgs = {}, now = new Date()): Promise<AudiencePreview> {
  const r = await resolveAudience(a, now);
  const people: AudiencePreviewPerson[] = r.recipients.map((x) => ({
    kind: x.kind,
    id: x.id.toString(),
    name: x.vars.name,
    detail: x.kind === "USER" ? x.vars.group : [x.vars.childNames.join(", "), x.vars.classLabels.join(", ")].filter(Boolean).join(" · "),
    reachable: x.reachable,
  }));
  return {
    total: r.recipients.length,
    staffCount: r.staffCount,
    guardianCount: r.guardianCount,
    reachableCount: r.recipients.length - r.unreachableCount,
    unreachableCount: r.unreachableCount,
    staffMissingGender: r.staffMissingGender,
    summary: await describeAudience(a),
    people: pageOf(people, args),
  };
}

export interface PopupPersonHit {
  kind: "USER" | "STUDENT";
  id: string;
  name: string;
  detail: string;
}

/** The custom-list picker: staff by name, families by child's name or school id. */
export async function searchPopupPeople(query: string, args: PageArgs = {}): Promise<Page<PopupPersonHit>> {
  const q = query.trim();
  if (q.length < 2) return pageOf([], args);
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const [users, students, classes] = await Promise.all([
    User.find({ active: true, role: { $in: STAFF_ROLES }, name: rx }).select("name role").sort({ name: 1 }).lean(),
    Student.find({ active: true, $or: [{ name: rx }, { nameBn: rx }, { schoolId: rx }] }).select("name nameBn schoolId classId sectionId").sort({ name: 1 }).lean(),
    Class.find({}).select("level").lean(),
  ]);
  const levelOfClass = new Map((classes as unknown as Array<{ _id: Types.ObjectId; level: number }>).map((c) => [c._id.toString(), c.level]));
  const kids = students as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string; schoolId: string; classId: Types.ObjectId; sectionId: Types.ObjectId }>;
  const sections = (await Section.find({ _id: { $in: uniq(kids.map((k) => k.sectionId.toString())) } }).select("code nameBn").lean()) as unknown as Array<{ _id: Types.ObjectId; code?: string; nameBn?: string }>;
  const secById = new Map(sections.map((s) => [s._id.toString(), s]));
  const hits: PopupPersonHit[] = [
    ...(users as unknown as Array<{ _id: Types.ObjectId; name: string; role: string }>).map((u) => ({
      kind: "USER" as const,
      id: u._id.toString(),
      name: personName(u),
      detail: ROLE_BN[u.role] ?? u.role,
    })),
    ...kids.map((k) => ({
      kind: "STUDENT" as const,
      id: k._id.toString(),
      name: personName(k),
      detail: [classLabel(levelOfClass.get(k.classId.toString()), secById.get(k.sectionId.toString())), k.schoolId].filter(Boolean).join(" · "),
    })),
  ];
  return pageOf(hits, args, 20);
}
