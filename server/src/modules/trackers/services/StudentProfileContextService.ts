/**
 * StudentProfileContextService (SP-2, docs/prd-student-profile.md §5.5/§5.6 + §7) —
 * the three NON-tracker panels of the student profile:
 *
 *   studentProfileHeader     — who the child is: roster identity, section + class
 *                              labels, the primary guardian to phone, the section's
 *                              class teacher, and the current academic year (which
 *                              supplies the §5.7 default window).
 *   studentProfileAttendance — the per-day history + the derived numbers a profile
 *                              needs that no existing read exposes: uncovered
 *                              absences, the longest absent run, and a per-month
 *                              series for the chart. Leave applications ride along
 *                              so a run of absences reads as COVERED, not truant.
 *   studentProfileComments   — the daily comment log (windowed) + a CONCERN/POSITIVE
 *                              tally + the parent-meeting note history.
 *
 * REUSE, not re-derivation: `studentAttendanceHistory` (D-#278 unit-cutover-safe),
 * `attendanceSplitOf` (the whole-picture recent-vs-earlier definition),
 * `studentComments`, and `studentCommentTimeline` (the CM-5 meeting timeline) are all
 * called as they stand. This service only adds what genuinely did not exist.
 *
 * Derived at read time (D-#85). Identity plane — names the child, their guardian's
 * phone and their teachers; allowed here and forbidden only on the corpus plane
 * (ADR-005), which never imports this file.
 */
import { Types } from "mongoose";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { StudentLeaveApplication } from "../../attendance/models/StudentLeaveApplication";
import { studentAttendanceHistory } from "../../attendance/services/AttendanceReportService";
import { dateKeyOf } from "../../attendance/dates";
import { studentComments, type StudentCommentShape } from "../../comments/services/StudentCommentService";
import {
  studentCommentTimeline,
  type StudentCommentTimeline,
} from "../../comments/services/MeetingCommentService";
import { attendanceSplitOf } from "./WholePictureService";

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export interface ProfileGuardian {
  guardianId: string;
  name: string;
  relation: string;
  phone: string | null;
  /** The earliest ACTIVE link — the number the school actually calls (the D-#350 rule). */
  primary: boolean;
}

export interface ProfileAcademicYear {
  academicYearId: string;
  label: string;
  /** The §5.7 default window: year start → today (never past the year's end). */
  fromKey: string;
  toKey: string;
}

export interface StudentProfileHeader {
  studentId: string;
  name: string;
  nameBn: string | null;
  rollNumber: string | null;
  gender: string | null;
  dob: string | null;
  bloodGroup: string | null;
  phone: string | null;
  classLevel: number;
  sectionId: string;
  sectionNameBn: string | null;
  classTeacherName: string | null;
  guardians: ProfileGuardian[];
  academicYear: ProfileAcademicYear | null;
}

/** The default profile window (D-#358): the current academic year to date. Falls
 *  back to a 90-day trailing window when no year is marked current, so the screen
 *  always has bounds to open with. */
export async function defaultProfileWindow(now: Date = new Date()): Promise<ProfileAcademicYear | null> {
  const year = (await AcademicYear.findOne({ current: true })
    .select("label startDate endDate")
    .lean()) as unknown as { _id: Types.ObjectId; label: string; startDate: Date; endDate: Date } | null;
  if (!year) return null;
  const end = new Date(year.endDate);
  const to = now.getTime() < end.getTime() ? now : end;
  return {
    academicYearId: year._id.toString(),
    label: year.label,
    fromKey: dateKeyOf(new Date(year.startDate)),
    toKey: dateKeyOf(to),
  };
}

export async function studentProfileHeader(
  studentId: string,
  now: Date = new Date(),
): Promise<StudentProfileHeader> {
  const student = (await Student.findById(studentId)
    .select("name nameBn rollNumber gender dob bloodGroup phone classId sectionId")
    .lean()) as unknown as {
    _id: Types.ObjectId;
    name: string;
    nameBn?: string;
    rollNumber?: string;
    gender?: string;
    dob?: Date;
    bloodGroup?: string;
    phone?: string;
    classId: Types.ObjectId;
    sectionId: Types.ObjectId;
  } | null;
  if (!student) throw new Error("Student not found");

  const [section, klass, links, year] = await Promise.all([
    Section.findById(student.sectionId).select("nameBn classTeacherId").lean() as Promise<
      { nameBn: string; classTeacherId?: Types.ObjectId } | null
    >,
    Class.findById(student.classId).select("level").lean() as Promise<{ level: number } | null>,
    // Earliest-first so the FIRST active link is the primary one (the rule the
    // homework chase drill already uses — not a second notion of "primary").
    GuardianLink.find({ studentId: student._id, active: { $ne: false } })
      .select("guardianId relation createdAt")
      .sort({ createdAt: 1 })
      .lean() as Promise<Array<{ guardianId: Types.ObjectId; relation: string }>>,
    defaultProfileWindow(now),
  ]);

  const guardianDocs = links.length
    ? ((await Guardian.find({ _id: { $in: links.map((l) => l.guardianId) } })
        .select("name phone")
        .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; phone?: string }>)
    : [];
  const guardianById = new Map(guardianDocs.map((g) => [g._id.toString(), g]));

  const guardians: ProfileGuardian[] = links.map((l, i) => {
    const g = guardianById.get(l.guardianId.toString());
    return {
      guardianId: l.guardianId.toString(),
      name: g?.name ?? "অভিভাবক",
      relation: l.relation,
      phone: g?.phone ?? null,
      primary: i === 0,
    };
  });

  const classTeacher = section?.classTeacherId
    ? ((await User.findById(section.classTeacherId).select("name").lean()) as { name: string } | null)
    : null;

  return {
    studentId: student._id.toString(),
    name: student.name,
    nameBn: student.nameBn ?? null,
    rollNumber: student.rollNumber ?? null,
    gender: student.gender ?? null,
    dob: student.dob ? new Date(student.dob).toISOString() : null,
    bloodGroup: student.bloodGroup ?? null,
    phone: student.phone ?? null,
    classLevel: klass?.level ?? 0,
    sectionId: student.sectionId.toString(),
    sectionNameBn: section?.nameBn ?? null,
    classTeacherName: classTeacher?.name ?? null,
    guardians,
    academicYear: year,
  };
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export interface ProfileAttendanceDay {
  dateKey: string;
  absent: boolean;
  leaveCovered: boolean;
}

export interface ProfileAttendanceMonth {
  /** `YYYY-MM`. */
  monthKey: string;
  markedDays: number;
  absentDays: number;
  presentPct: number | null;
}

export interface ProfileLeave {
  leaveId: string;
  fromKey: string;
  toKey: string;
  reason: string;
  submittedAt: string;
  /** Days of THIS leave that fall inside the requested window. */
  daysInWindow: number;
}

export interface StudentProfileAttendance {
  studentId: string;
  fromKey: string;
  toKey: string;
  markedDays: number;
  absentDays: number;
  presentPct: number;
  /** Absences with NO covering leave application — the actionable number. */
  absentUncoveredDays: number;
  /** Longest run of consecutive MARKED days absent (a run reads worse than a total). */
  absentStreakMax: number;
  recentPresentPct: number | null;
  earlierPresentPct: number | null;
  trajectory: string;
  monthly: ProfileAttendanceMonth[];
  days: ProfileAttendanceDay[];
  leaves: ProfileLeave[];
}

/** Longest run of consecutive absent entries. PURE (days must be date-ordered). */
export function absentStreakMaxOf(days: readonly { absent: boolean }[]): number {
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = d.absent ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/** Per-month roll-up for the chart. PURE. */
export function monthlyAttendanceOf(
  days: readonly { dateKey: string; absent: boolean }[],
): ProfileAttendanceMonth[] {
  const acc = new Map<string, { markedDays: number; absentDays: number }>();
  for (const d of days) {
    const key = d.dateKey.slice(0, 7);
    const m = acc.get(key) ?? acc.set(key, { markedDays: 0, absentDays: 0 }).get(key)!;
    m.markedDays += 1;
    if (d.absent) m.absentDays += 1;
  }
  return [...acc.entries()]
    .map(([monthKey, m]) => ({
      monthKey,
      markedDays: m.markedDays,
      absentDays: m.absentDays,
      presentPct:
        m.markedDays === 0 ? null : Math.round(((m.markedDays - m.absentDays) / m.markedDays) * 100),
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

/** Inclusive count of a leave's days that fall inside [fromKey, toKey]. PURE — string
 *  keys only, never Date instants (the D-#354 comparison rule). */
export function leaveDaysInWindow(
  leave: { fromKey: string; toKey: string },
  fromKey: string,
  toKey: string,
): number {
  const start = leave.fromKey > fromKey ? leave.fromKey : fromKey;
  const end = leave.toKey < toKey ? leave.toKey : toKey;
  if (start > end) return 0;
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const diff = new Date(ye, me - 1, de).getTime() - new Date(ys, ms - 1, ds).getTime();
  return Math.round(diff / 86_400_000) + 1;
}

export async function studentProfileAttendance(
  studentId: string,
  fromKey: string,
  toKey: string,
): Promise<StudentProfileAttendance> {
  // One existing read, D-#278 cutover-safe; `days` come back oldest → newest.
  const history = await studentAttendanceHistory(studentId, fromKey, toKey);

  const leaveDocs = (await StudentLeaveApplication.find({
    studentId: new Types.ObjectId(studentId),
    fromKey: { $lte: toKey },
    toKey: { $gte: fromKey },
  })
    .sort({ fromKey: -1 })
    .lean()) as unknown as Array<{
    _id: Types.ObjectId;
    fromKey: string;
    toKey: string;
    reason: string;
    submittedAt: Date;
  }>;

  return {
    studentId,
    fromKey,
    toKey,
    markedDays: history.markedDays,
    absentDays: history.absentDays,
    presentPct: history.presentPct,
    absentUncoveredDays: history.days.filter((d) => d.absent && !d.leaveCovered).length,
    absentStreakMax: absentStreakMaxOf(history.days),
    ...attendanceSplitOf(history.days),
    monthly: monthlyAttendanceOf(history.days),
    days: history.days,
    leaves: leaveDocs.map((l) => ({
      leaveId: l._id.toString(),
      fromKey: l.fromKey,
      toKey: l.toKey,
      reason: l.reason,
      submittedAt: new Date(l.submittedAt).toISOString(),
      daysInWindow: leaveDaysInWindow(l, fromKey, toKey),
    })),
  };
}

// ---------------------------------------------------------------------------
// Comments + parent meetings
// ---------------------------------------------------------------------------

export interface ProfileComment extends StudentCommentShape {
  /** The teacher who wrote it — the shape carries only the id. */
  authorName: string | null;
}

export interface ProfileCommentTally {
  total: number;
  concern: number;
  positive: number;
  /** Written but not yet delivered to the guardian — a to-do, not a record. */
  undelivered: number;
}

export interface StudentProfileComments {
  studentId: string;
  fromKey: string;
  toKey: string;
  tally: ProfileCommentTally;
  comments: ProfileComment[];
  /** The CM-5 meeting-note history + the since-last-meeting by-type rollup. */
  timeline: StudentCommentTimeline;
}

export async function studentProfileComments(
  studentId: string,
  fromKey: string,
  toKey: string,
): Promise<StudentProfileComments> {
  const [all, timeline] = await Promise.all([
    studentComments(studentId), // newest first, staff shape
    studentCommentTimeline(studentId),
  ]);

  // Window on the comment's own date, by KEY (never an instant comparison).
  const inWindow = all.filter((c) => {
    const key = dateKeyOf(new Date(c.createdAt));
    return key >= fromKey && key <= toKey;
  });

  const authorIds = [...new Set(inWindow.map((c) => c.authorUserId))];
  const authors = authorIds.length
    ? ((await User.find({ _id: { $in: authorIds.map((id) => new Types.ObjectId(id)) } })
        .select("name")
        .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string }>)
    : [];
  const nameOf = new Map(authors.map((a) => [a._id.toString(), a.name]));

  return {
    studentId,
    fromKey,
    toKey,
    tally: {
      total: inWindow.length,
      concern: inWindow.filter((c) => c.sentiment === "CONCERN").length,
      positive: inWindow.filter((c) => c.sentiment === "POSITIVE").length,
      undelivered: inWindow.filter((c) => !c.deliveredAt).length,
    },
    comments: inWindow.map((c) => ({ ...c, authorName: nameOf.get(c.authorUserId) ?? null })),
    timeline,
  };
}
