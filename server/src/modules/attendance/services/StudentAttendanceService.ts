/**
 * StudentAttendanceService (AT-2, D-#63/#64; reshaped by D-#278) — in-app,
 * once-daily, ABSENT-ONLY student capture per **attendance unit**.
 *
 * WHERE (D-#278, see `../attendanceUnit.ts`): attendance is taken in the student's
 * FIRST CLASS of the day. Class 1–5's first class is a cross-section Quran
 * `SubjectGroup`, so capture is per Quran group; Nursery/KG's first class is a
 * section slot, so capture stays section-keyed. Reports roll every unit back up to
 * class → section — the group is never a display axis.
 *
 * WHO MAY MARK (CT-2, AT2.2 → D-#278): the unit's marker-of-the-day, resolved in
 * this order:
 *   1. a covering `SectionAttendanceAssignment` override (admin escape hatch);
 *   2. ROUTINE — the unit's first-class teacher for that date, cover-aware
 *      (a `RoutineSubstitution` on that slot OR an approved HR leave-cover
 *      `StaffCoverSlot` for that meeting hands marking to the cover teacher):
 *        • Quran group  → teacher of its earliest `track:"quran"` slot
 *        • Nursery/KG section → teacher of its earliest period
 *   3. FALLBACK — the section's `classTeacherId` (also the standing marker for a
 *      Class 1–5 section unit, which only ever holds Quran-group-less leftovers).
 * Principal/Office are NOT auto-allowed to mark (they assign markers; D-#64).
 *
 * LOCK RULE (O2): the day is editable by the marker until end of day; past days
 * are amendable only via `amendAttendanceUnit` (attendance:manage, audited).
 *
 * CALENDAR (AT4.1 base): attendance exists only on FULL days — the D-#50 calendar
 * (`resolveDayType`) is the single source; OFF/QURAN_ONLY/HOLIDAY dates reject
 * (Saturdays stay attendance-free by ruling, D-#278).
 */
import { Types } from "mongoose";
import {
  returningStudentsFor,
  previousSchoolDayKey,
} from "../../trackers/services/ReturnFromLeaveService";
import { emitStudentReturned } from "../../notifications/services/emitters";
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
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { RoutineSubstitution } from "../../routine/models/RoutineSubstitution";
import { StaffCoverSlot } from "../../hr/models/StaffCoverSlot";
import { slotsForTeacherOnDate } from "../../routine/services/RoutineSlotService";
import { writeAudit } from "../../platform/services/AuditService";
import {
  isNurseryKg,
  isLegacyAttendanceDate,
  firstPeriodTeacher,
  firstQuranSlotTeacher,
  rosterForUnit,
  unitKey,
  type AttendanceUnit,
  type UnitType,
} from "../attendanceUnit";

export class AttendanceError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AttendanceError";
  }
}

export const sectionUnit = (sectionId: string): AttendanceUnit => ({ unitType: "section", unitId: sectionId });
export const groupUnit = (groupId: string): AttendanceUnit => ({ unitType: "subjectgroup", unitId: groupId });

/** Mongo filter selecting a unit's rows on the day / assignment collections. */
const unitFilter = (unit: AttendanceUnit): Record<string, unknown> =>
  unit.unitType === "section" ? { sectionId: unit.unitId } : { subjectGroupId: unit.unitId };

// ---------------------------------------------------------------------------
// Marker resolution (CT-2 → D-#278)
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

export type MarkerSource = "assignment" | "routine" | "class_teacher" | null;

export interface MarkerResolution {
  teacherId: string | null;
  source: MarkerSource;
}

/** The unit's marker for a date: override → routine first-class teacher → class-teacher
 *  fallback (D-#278). A Quran group has no class teacher, so it can resolve to null —
 *  the unit then shows as unmarked until an admin assigns a marker. */
export async function markerForUnit(unit: AttendanceUnit, dateKey: string): Promise<MarkerResolution> {
  const date = parseDateKey(dateKey);
  const legacy = isLegacyAttendanceDate(dateKey);

  // 1. Admin override wins (any date — assignments were the pre-D-#278 system too).
  const assignments = await SectionAttendanceAssignment.find({
    ...unitFilter(unit),
    active: true,
    fromKey: { $lte: dateKey },
    toKey: { $gte: dateKey },
  }).lean();
  const winner = pickCoveringAssignment(assignments, dateKey);
  if (winner) return { teacherId: winner.teacherId.toString(), source: "assignment" };

  // 2a. Quran group → its first Quran period's teacher (cover-aware). No class-teacher
  //     fallback exists for a cross-section group. Pre-cutover dates (D-#292) had no
  //     group capture at all — nobody is retroactively made responsible.
  if (unit.unitType === "subjectgroup") {
    if (legacy) return { teacherId: null, source: null };
    const teacherId = await firstQuranSlotTeacher(unit.unitId, date);
    return teacherId ? { teacherId, source: "routine" } : { teacherId: null, source: null };
  }

  // 2b. Section unit. Nursery/KG → its first period's teacher (their Quran period is
  //     P3/P5, so "first period", not "first Quran period" — the owner's rule). The
  //     routine step did not exist pre-cutover (D-#292) — legacy dates skip it.
  const section = await Section.findById(unit.unitId).lean();
  if (!section) throw new AttendanceError("Section not found");
  if (!legacy) {
    const cls = await Class.findById(section.classId).select("level").lean();
    if (cls && isNurseryKg(cls.level)) {
      const teacherId = await firstPeriodTeacher(unit.unitId, date);
      if (teacherId) return { teacherId, source: "routine" };
    }
  }

  // 3. Class-teacher fallback (and the standing marker for a Class 1–5 section unit,
  //    which holds only students without a Quran group; pre-cutover it is THE rule).
  return section.classTeacherId
    ? { teacherId: section.classTeacherId.toString(), source: "class_teacher" }
    : { teacherId: null, source: null };
}

/** Back-compat wrapper: a section's marker for a date. */
export async function markerForDate(sectionId: string, dateKey: string): Promise<MarkerResolution> {
  return markerForUnit(sectionUnit(sectionId), dateKey);
}

/** CT-2 gate: the caller must be the unit's marker for `dateKey`. */
export async function assertMayMarkUnit(
  ctx: AppContext,
  unit: AttendanceUnit,
  dateKey: string,
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const marker = await markerForUnit(unit, dateKey);
  if (!marker.teacherId || marker.teacherId !== ctx.auth.userId) {
    throw new ForbiddenError(
      "Only the unit's marker for this date may mark attendance — the first-class teacher (CT-2/D-#278)",
    );
  }
}

export async function assertMayMark(ctx: AppContext, sectionId: string, dateKey: string): Promise<void> {
  return assertMayMarkUnit(ctx, sectionUnit(sectionId), dateKey);
}

// ---------------------------------------------------------------------------
// Marker assignment (AT2.1 — attendance:manage)
// ---------------------------------------------------------------------------

export async function assignUnitMarker(
  unit: AttendanceUnit,
  teacherId: string,
  fromKey: string,
  toKey: string,
  actorId: string,
): Promise<ISectionAttendanceAssignment> {
  parseDateKey(fromKey);
  parseDateKey(toKey);
  if (fromKey > toKey) throw new AttendanceError("fromDate must not be after toDate");
  if (unit.unitType === "section") {
    const section = await Section.findById(unit.unitId).lean();
    if (!section) throw new AttendanceError("Section not found");
  }
  const teacher = await User.findById(teacherId).lean();
  if (!teacher || teacher.role !== "TEACHER") throw new AttendanceError("Marker must be a TEACHER");

  const assignment = await SectionAttendanceAssignment.create({
    ...(unit.unitType === "section"
      ? { sectionId: new Types.ObjectId(unit.unitId) }
      : { subjectGroupId: new Types.ObjectId(unit.unitId) }),
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
    meta: { unitType: unit.unitType, unitId: unit.unitId, teacherId, fromKey, toKey, op: "assigned" },
  });
  return assignment;
}

export async function assignSectionMarker(
  sectionId: string,
  teacherId: string,
  fromKey: string,
  toKey: string,
  actorId: string,
): Promise<ISectionAttendanceAssignment> {
  return assignUnitMarker(sectionUnit(sectionId), teacherId, fromKey, toKey, actorId);
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
    meta: {
      sectionId: assignment.sectionId?.toString(),
      subjectGroupId: assignment.subjectGroupId?.toString(),
      op: "revoked",
    },
  });
  return assignment;
}

// ---------------------------------------------------------------------------
// Marking (AT2.3/AT2.4) + the O2 amend path
// ---------------------------------------------------------------------------

/** Every absentee must belong to the unit's roster for that DATE (D-#292: a
 *  pre-cutover section day validates against the full section, no group split). */
async function validateAbsentees(
  unit: AttendanceUnit,
  absentStudentIds: string[],
  dateKey: string,
): Promise<Types.ObjectId[]> {
  const unique = [...new Set(absentStudentIds)];
  if (unique.length === 0) return [];
  const roster = new Set((await rosterForUnit(unit, dateKey)).map((s) => s.id));
  for (const id of unique) {
    if (!roster.has(id)) {
      throw new AttendanceError("Every absentee must be an active student of this attendance unit");
    }
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
  unit: AttendanceUnit,
  dateKey: string,
  absentIds: Types.ObjectId[],
  actorId: string,
  amend: boolean,
): Promise<IStudentAttendanceDay> {
  const now = new Date();
  const existing = await StudentAttendanceDay.findOne({ ...unitFilter(unit), dateKey });
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
      ...(unit.unitType === "section"
        ? { sectionId: new Types.ObjectId(unit.unitId) }
        : { subjectGroupId: new Types.ObjectId(unit.unitId) }),
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
    meta: {
      unitType: unit.unitType,
      unitId: unit.unitId,
      dateKey,
      absent: absentIds.length,
      amended: amend,
      replaced: !!existing,
    },
  });
  return day;
}

/**
 * The unit's marker writes TODAY's absentees (absent-only; everyone else present).
 * Re-submitting the same day overwrites it — editable until end of day (O2).
 */
/**
 * RL-2: tell the CLASS TEACHER which students are back today and what to ask them
 * for. Class teacher only (D-#556) — the card is scoped to subject teachers too,
 * but one returning student would otherwise push every teacher who meets them.
 *
 * Best-effort: a notification must never fail an attendance save.
 */
async function notifyReturnsFromLeave(
  unit: AttendanceUnit,
  dateKey: string,
  now: Date,
): Promise<void> {
  try {
    // Section units only: a Quran/Arabic group has no class teacher to tell.
    if (unit.unitType !== "section") return;
    const section = (await Section.findById(unit.unitId).select("classTeacherId").lean()) as
      | { classTeacherId?: unknown }
      | null;
    if (!section?.classTeacherId) return;

    const prevKey = await previousSchoolDayKey(parseDateKey(dateKey), async (probe) => {
      const dt = await resolveDayType(probe);
      return dt !== "OFF" && dt !== "HOLIDAY";
    });
    const returning = await returningStudentsFor([unit.unitId], dateKey, prevKey);

    for (const r of returning) {
      // Only the attendance-CONFIRMED half is ever pushed.
      if (r.source !== "RETURNED") continue;
      await emitStudentReturned({
        studentId: r.studentId,
        studentNameBn: r.studentNameBn,
        sectionId: unit.unitId,
        teacherId: section.classTeacherId as never,
        redeliverCount: r.items.filter((i) => i.group === "REDELIVER").length,
        collectCount: r.items.filter((i) => i.group === "COLLECT").length,
        at: now,
      });
    }
  } catch (err) {
    console.error("[attendance] return-from-leave notify failed (save unaffected):", err);
  }
}

export async function markAttendanceUnit(
  ctx: AppContext,
  unit: AttendanceUnit,
  dateKey: string,
  absentStudentIds: string[],
  now: Date = new Date(),
): Promise<IStudentAttendanceDay> {
  parseDateKey(dateKey);
  await assertMayMarkUnit(ctx, unit, dateKey);
  const todayKey = dateKeyOf(now);
  if (dateKey > todayKey) throw new AttendanceError("Cannot mark attendance for a future date");
  if (dateKey < todayKey) {
    throw new AttendanceError(
      "This day is locked (editable until end of day) — Principal/Office can amend it (O2)",
    );
  }
  await assertFullDay(dateKey);
  const absentIds = await validateAbsentees(unit, absentStudentIds, dateKey);
  const day = await upsertDay(unit, dateKey, absentIds, ctx.auth!.userId, false);

  // RL-2 (D-#556, owner ruling 2026-08-25): the return push fires HERE, the moment
  // attendance CONFIRMS a child is back — not at the school-day start and not off
  // the leave register. The register records an intention; only this records what
  // happened, and a notification teachers learn to distrust is worse than none.
  await notifyReturnsFromLeave(unit, dateKey, now);

  return day;
}

export async function markSectionAttendance(
  ctx: AppContext,
  sectionId: string,
  dateKey: string,
  absentStudentIds: string[],
  now: Date = new Date(),
): Promise<IStudentAttendanceDay> {
  return markAttendanceUnit(ctx, sectionUnit(sectionId), dateKey, absentStudentIds, now);
}

/** Principal/Office unlock-amend for a past (or missed) day — audited (O2).
 *  Resolver gates on attendance:manage. */
export async function amendAttendanceUnit(
  unit: AttendanceUnit,
  dateKey: string,
  absentStudentIds: string[],
  actorId: string,
  now: Date = new Date(),
): Promise<IStudentAttendanceDay> {
  parseDateKey(dateKey);
  if (dateKey > dateKeyOf(now)) throw new AttendanceError("Cannot mark attendance for a future date");
  if (unit.unitType === "section") {
    const section = await Section.findById(unit.unitId).lean();
    if (!section) throw new AttendanceError("Section not found");
  }
  await assertFullDay(dateKey);
  const absentIds = await validateAbsentees(unit, absentStudentIds, dateKey);
  const day = await upsertDay(unit, dateKey, absentIds, actorId, true);
  // An amendment can be the first time a return is recorded, so it fires too —
  // the (date, student, teacher) dedupe makes a re-save a no-op.
  await notifyReturnsFromLeave(unit, dateKey, now);
  return day;
}

export async function amendStudentAttendance(
  sectionId: string,
  dateKey: string,
  absentStudentIds: string[],
  actorId: string,
  now: Date = new Date(),
): Promise<IStudentAttendanceDay> {
  return amendAttendanceUnit(sectionUnit(sectionId), dateKey, absentStudentIds, actorId, now);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function attendanceDayForUnit(
  unit: AttendanceUnit,
  dateKey: string,
): Promise<IStudentAttendanceDay | null> {
  return StudentAttendanceDay.findOne({ ...unitFilter(unit), dateKey }).lean() as unknown as Promise<
    IStudentAttendanceDay | null
  >;
}

export async function sectionAttendanceForDate(
  sectionId: string,
  dateKey: string,
): Promise<IStudentAttendanceDay | null> {
  return attendanceDayForUnit(sectionUnit(sectionId), dateKey);
}

export interface MarkingUnit {
  unitType: UnitType;
  unitId: string;
  marked: boolean;
  source: MarkerSource;
}

/** Local-day bounds for the substitution lookup. */
function dayBounds(date: Date): { start: Date; end: Date } {
  return {
    start: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0),
    end: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999),
  };
}

/**
 * The units the caller is marker of for `dateKey`, with marked state (AT2.3
 * worklist → D-#278). Candidates come from the four ways a teacher can end up
 * responsible — the routine they teach, a cover they hold, a class-teacher
 * designation, or an admin assignment — and each candidate is then CONFIRMED
 * through `markerForUnit`, so an override that moved the duty elsewhere drops out.
 */
export async function myMarkingUnits(userId: string, dateKey: string): Promise<MarkingUnit[]> {
  const date = parseDateKey(dateKey);
  // Attendance isn't expected on OFF/QURAN_ONLY/HOLIDAY days (AT4.1, D-#50) — return an
  // empty worklist rather than nagging for a mark the write path would reject anyway.
  if ((await resolveDayType(date)) !== "FULL") return [];
  const { start, end } = dayBounds(date);

  const [ownSlots, subs, hrCovers, ctSections, assignments] = await Promise.all([
    slotsForTeacherOnDate(userId, date),
    RoutineSubstitution.find({ coverTeacherId: userId, active: true, date: { $gte: start, $lte: end } })
      .select("slotId")
      .lean(),
    // Approved HR leave-covers held today (StaffCoverSlot, PXG-1) — the leave flow
    // writes no RoutineSubstitution, so it must be its own candidate source.
    StaffCoverSlot.find({ finalCoverTeacherUserId: userId, dateKey, status: "approved" })
      .select("routineSlotId")
      .lean(),
    Section.find({ classTeacherId: userId, active: true }).select("_id").lean(),
    SectionAttendanceAssignment.find({
      teacherId: userId,
      active: true,
      fromKey: { $lte: dateKey },
      toKey: { $gte: dateKey },
    })
      .select("sectionId subjectGroupId")
      .lean(),
  ]);

  const candidates = new Map<string, AttendanceUnit>();
  const add = (u: AttendanceUnit): void => {
    candidates.set(unitKey(u), u);
  };

  for (const s of ownSlots) {
    if (s.isBreak) continue;
    add({ unitType: s.groupType, unitId: s.groupId.toString() });
  }
  // Periods the caller COVERS today — the cover teacher inherits the marking duty.
  // Both cover mechanisms count: RoutineSubstitution (routine module) AND an
  // approved HR leave-cover slot (StaffCoverSlot).
  const coveredSlotIds = [...subs.map((s) => s.slotId), ...hrCovers.map((c) => c.routineSlotId)];
  if (coveredSlotIds.length > 0) {
    const coveredSlots = await RoutineSlot.find({ _id: { $in: coveredSlotIds }, active: true })
      .select("groupType groupId isBreak")
      .lean();
    for (const s of coveredSlots) {
      if (s.isBreak) continue;
      add({ unitType: s.groupType as UnitType, unitId: s.groupId.toString() });
    }
  }
  for (const s of ctSections) add(sectionUnit(s._id.toString()));
  for (const a of assignments) {
    if (a.sectionId) add(sectionUnit(a.sectionId.toString()));
    else if (a.subjectGroupId) add(groupUnit(a.subjectGroupId.toString()));
  }

  const out: MarkingUnit[] = [];
  for (const unit of candidates.values()) {
    const marker = await markerForUnit(unit, dateKey);
    if (marker.teacherId !== userId) continue; // not (or no longer) responsible
    const day = await StudentAttendanceDay.findOne({ ...unitFilter(unit), dateKey }).select("_id").lean();
    out.push({ unitType: unit.unitType, unitId: unit.unitId, marked: day !== null, source: marker.source });
  }
  return out;
}

/** Active marker assignments covering a date (admin view, AT2.1). */
export async function assignmentsForDate(dateKey: string): Promise<ISectionAttendanceAssignment[]> {
  return SectionAttendanceAssignment.find({
    active: true,
    fromKey: { $lte: dateKey },
    toKey: { $gte: dateKey },
  }).lean() as unknown as Promise<ISectionAttendanceAssignment[]>;
}
