/**
 * StudentAttendanceService (AT-2, D-#63/#64) — in-app, once-daily, ABSENT-ONLY
 * student capture per section.
 *
 * WHO MAY MARK (CT-2, AT2.2): the section's marker-of-the-day — a covering
 * `SectionAttendanceAssignment` override if present, else the section's class
 * teacher (`Section.classTeacherId`). Principal/Office are NOT auto-allowed to
 * mark (they assign markers; D-#64) — that asymmetry is deliberate, mirroring
 * `assertIsClassTeacher`.
 *
 * LOCK RULE (O2): the day is editable by the marker until end of day; past days
 * are amendable only via `amendStudentAttendance` (attendance:manage, audited).
 *
 * CALENDAR (AT4.1 base): section attendance exists only on FULL days — the
 * D-#50 calendar (`resolveDayType`) is the single source; OFF/QURAN_ONLY/HOLIDAY
 * dates reject. (SubjectGroup/Quran attendance is the §7 fast-follow.)
 */
import { Types } from "mongoose";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { resolveDayType } from "../../routine/calendar";
import { dateKeyOf, parseDateKey } from "../dates";
import {
  SectionAttendanceAssignment,
  type ISectionAttendanceAssignment,
} from "../models/SectionAttendanceAssignment";
import { StudentAttendanceDay, type IStudentAttendanceDay } from "../models/StudentAttendanceDay";
import { Section } from "../../foundation/models/Section";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";

export class AttendanceError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AttendanceError";
  }
}

// ---------------------------------------------------------------------------
// Marker resolution (CT-2)
// ---------------------------------------------------------------------------

type AssignmentLike = Pick<ISectionAttendanceAssignment, "fromKey" | "toKey" | "createdAt"> & {
  teacherId: { toString(): string };
};

/** Pure: the WINNING override among assignments covering `dateKey` — the most
 *  recently created one (a later assignment supersedes an earlier overlap). */
export function pickCoveringAssignment<T extends AssignmentLike>(
  assignments: T[],
  dateKey: string,
): T | null {
  const covering = assignments.filter((a) => a.fromKey <= dateKey && dateKey <= a.toKey);
  if (covering.length === 0) return null;
  return covering.reduce((latest, a) =>
    new Date(a.createdAt).getTime() > new Date(latest.createdAt).getTime() ? a : latest,
  );
}

export interface MarkerResolution {
  teacherId: string | null;
  source: "assignment" | "class_teacher" | null;
}

/** The section's marker for a date: override assignment, else class teacher (AT2.2). */
export async function markerForDate(sectionId: string, dateKey: string): Promise<MarkerResolution> {
  const assignments = await SectionAttendanceAssignment.find({
    sectionId,
    active: true,
    fromKey: { $lte: dateKey },
    toKey: { $gte: dateKey },
  }).lean();
  const winner = pickCoveringAssignment(assignments, dateKey);
  if (winner) return { teacherId: winner.teacherId.toString(), source: "assignment" };
  const section = await Section.findById(sectionId).lean();
  if (!section) throw new AttendanceError("Section not found");
  return section.classTeacherId
    ? { teacherId: section.classTeacherId.toString(), source: "class_teacher" }
    : { teacherId: null, source: null };
}

/** CT-2 gate: the caller must be the section's marker for `dateKey`. */
export async function assertMayMark(
  ctx: AppContext,
  sectionId: string,
  dateKey: string,
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const marker = await markerForDate(sectionId, dateKey);
  if (!marker.teacherId || marker.teacherId !== ctx.auth.userId) {
    throw new ForbiddenError("Only the section's assigned marker for this date may mark attendance (CT-2)");
  }
}

// ---------------------------------------------------------------------------
// Marker assignment (AT2.1 — attendance:manage)
// ---------------------------------------------------------------------------

export async function assignSectionMarker(
  sectionId: string,
  teacherId: string,
  fromKey: string,
  toKey: string,
  actorId: string,
): Promise<ISectionAttendanceAssignment> {
  parseDateKey(fromKey);
  parseDateKey(toKey);
  if (fromKey > toKey) throw new AttendanceError("fromDate must not be after toDate");
  const section = await Section.findById(sectionId).lean();
  if (!section) throw new AttendanceError("Section not found");
  const teacher = await User.findById(teacherId).lean();
  if (!teacher || teacher.role !== "TEACHER") throw new AttendanceError("Marker must be a TEACHER");

  const assignment = await SectionAttendanceAssignment.create({
    sectionId: new Types.ObjectId(sectionId),
    teacherId: new Types.ObjectId(teacherId),
    fromKey,
    toKey,
    actorId: new Types.ObjectId(actorId),
    active: true,
  });
  await writeAudit({
    eventKind: "ATTENDANCE_MARKER_ASSIGNED",
    actorId,
    targetId: assignment._id,
    targetKind: "SectionAttendanceAssignment",
    meta: { sectionId, teacherId, fromKey, toKey, op: "assigned" },
  });
  return assignment;
}

export async function revokeSectionMarker(
  assignmentId: string,
  actorId: string,
): Promise<ISectionAttendanceAssignment> {
  const assignment = await SectionAttendanceAssignment.findById(assignmentId);
  if (!assignment) throw new AttendanceError("Assignment not found");
  if (!assignment.active) throw new AttendanceError("Assignment already revoked");
  assignment.active = false;
  assignment.revokedBy = new Types.ObjectId(actorId);
  assignment.revokedAt = new Date();
  await assignment.save();
  await writeAudit({
    eventKind: "ATTENDANCE_MARKER_ASSIGNED",
    actorId,
    targetId: assignment._id,
    targetKind: "SectionAttendanceAssignment",
    meta: { sectionId: assignment.sectionId.toString(), op: "revoked" },
  });
  return assignment;
}

// ---------------------------------------------------------------------------
// Marking (AT2.3/AT2.4) + the O2 amend path
// ---------------------------------------------------------------------------

async function validateAbsentees(sectionId: string, absentStudentIds: string[]): Promise<Types.ObjectId[]> {
  const unique = [...new Set(absentStudentIds)];
  if (unique.length === 0) return [];
  const enrolled = await Student.find({
    _id: { $in: unique },
    sectionId,
    active: true,
  })
    .select("_id")
    .lean();
  if (enrolled.length !== unique.length) {
    throw new AttendanceError("Every absentee must be an active student of this section");
  }
  return unique.map((id) => new Types.ObjectId(id));
}

async function assertFullDay(dateKey: string): Promise<void> {
  const dayType = await resolveDayType(parseDateKey(dateKey));
  if (dayType !== "FULL") {
    throw new AttendanceError(`Attendance is not expected on a ${dayType} day (D-#50)`);
  }
}

async function upsertDay(
  sectionId: string,
  dateKey: string,
  absentIds: Types.ObjectId[],
  actorId: string,
  amend: boolean,
): Promise<IStudentAttendanceDay> {
  const now = new Date();
  const existing = await StudentAttendanceDay.findOne({ sectionId, dateKey });
  let day: IStudentAttendanceDay;
  if (existing) {
    existing.absentStudentIds = absentIds;
    if (amend) {
      existing.amendedBy = new Types.ObjectId(actorId);
      existing.amendedAt = now;
    } else {
      existing.markedBy = new Types.ObjectId(actorId);
      existing.markedAt = now;
    }
    day = await existing.save();
  } else {
    day = await StudentAttendanceDay.create({
      sectionId: new Types.ObjectId(sectionId),
      dateKey,
      absentStudentIds: absentIds,
      markedBy: new Types.ObjectId(actorId),
      markedAt: now,
      ...(amend ? { amendedBy: new Types.ObjectId(actorId), amendedAt: now } : {}),
    });
  }
  await writeAudit({
    eventKind: "ATTENDANCE_MARKED",
    actorId,
    targetId: day._id,
    targetKind: "StudentAttendanceDay",
    meta: { sectionId, dateKey, absent: absentIds.length, amended: amend, replaced: !!existing },
  });
  return day;
}

/**
 * Marker writes TODAY's section day (absent-only; everyone else present).
 * Re-submitting the same day overwrites it — editable until end of day (O2).
 */
export async function markSectionAttendance(
  ctx: AppContext,
  sectionId: string,
  dateKey: string,
  absentStudentIds: string[],
  now: Date = new Date(),
): Promise<IStudentAttendanceDay> {
  parseDateKey(dateKey);
  await assertMayMark(ctx, sectionId, dateKey);
  const todayKey = dateKeyOf(now);
  if (dateKey > todayKey) throw new AttendanceError("Cannot mark attendance for a future date");
  if (dateKey < todayKey) {
    throw new AttendanceError(
      "This day is locked (editable until end of day) — Principal/Office can amend it (O2)",
    );
  }
  await assertFullDay(dateKey);
  const absentIds = await validateAbsentees(sectionId, absentStudentIds);
  return upsertDay(sectionId, dateKey, absentIds, ctx.auth!.userId, false);
}

/** Principal/Office unlock-amend for a past (or missed) day — audited (O2).
 *  Resolver gates on attendance:manage. */
export async function amendStudentAttendance(
  sectionId: string,
  dateKey: string,
  absentStudentIds: string[],
  actorId: string,
  now: Date = new Date(),
): Promise<IStudentAttendanceDay> {
  parseDateKey(dateKey);
  if (dateKey > dateKeyOf(now)) throw new AttendanceError("Cannot mark attendance for a future date");
  const section = await Section.findById(sectionId).lean();
  if (!section) throw new AttendanceError("Section not found");
  await assertFullDay(dateKey);
  const absentIds = await validateAbsentees(sectionId, absentStudentIds);
  return upsertDay(sectionId, dateKey, absentIds, actorId, true);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function sectionAttendanceForDate(
  sectionId: string,
  dateKey: string,
): Promise<IStudentAttendanceDay | null> {
  return StudentAttendanceDay.findOne({ sectionId, dateKey }).lean() as unknown as Promise<IStudentAttendanceDay | null>;
}

export interface MarkingSection {
  sectionId: string;
  marked: boolean;
  viaAssignment: boolean;
}

/** The sections the caller is marker of for `dateKey`, with marked state —
 *  the teacher's daily worklist (AT2.3 entry point). */
export async function myMarkingSections(userId: string, dateKey: string): Promise<MarkingSection[]> {
  const [own, assigned] = await Promise.all([
    Section.find({ classTeacherId: userId, active: true }).select("_id").lean(),
    SectionAttendanceAssignment.find({
      teacherId: userId,
      active: true,
      fromKey: { $lte: dateKey },
      toKey: { $gte: dateKey },
    })
      .select("sectionId")
      .lean(),
  ]);
  const candidateIds = [
    ...new Set([
      ...own.map((s) => s._id.toString()),
      ...assigned.map((a) => a.sectionId.toString()),
    ]),
  ];
  const out: MarkingSection[] = [];
  for (const sectionId of candidateIds) {
    const marker = await markerForDate(sectionId, dateKey);
    if (marker.teacherId !== userId) continue; // overridden by someone else's assignment
    const day = await StudentAttendanceDay.findOne({ sectionId, dateKey }).select("_id").lean();
    out.push({ sectionId, marked: day !== null, viaAssignment: marker.source === "assignment" });
  }
  return out;
}

/** Active marker assignments covering a date (admin view, AT2.1 — surfaced
 *  multi-section load included). */
export async function assignmentsForDate(dateKey: string): Promise<ISectionAttendanceAssignment[]> {
  return SectionAttendanceAssignment.find({
    active: true,
    fromKey: { $lte: dateKey },
    toKey: { $gte: dateKey },
  }).lean() as unknown as Promise<ISectionAttendanceAssignment[]>;
}
