/**
 * Attendance backlog (D-#279) — "which of the caller's marking days are still
 * unmarked?", over a whole window, in a BOUNDED number of queries.
 *
 * `myMarkingUnits` answers this for ONE date, but costs ~16 queries. The Today
 * dashboard needs a 7-day look-back on every load, so this module loads each
 * collection ONCE for the window and then resolves the marker PURELY per (unit, day).
 *
 * The marker rule is the same as `StudentAttendanceService.markerForUnit` (D-#278):
 *   override assignment → routine first-class teacher (cover-aware) → class-teacher
 * and is kept in lockstep by `attendanceBacklog.test.ts`, which asserts the two agree.
 *
 * Identity/operational plane — no corpus path.
 */
import type { Types } from "mongoose";
import { DAYS_OF_WEEK } from "@scd/shared";
import { RoutineSlot } from "../routine/models/RoutineSlot";
import { liveWindow } from "../routine/liveWindow";
import { RoutineSubstitution } from "../routine/models/RoutineSubstitution";
import { StaffCoverSlot } from "../hr/models/StaffCoverSlot";
import { Section } from "../foundation/models/Section";
import { Class } from "../foundation/models/Class";
import { Student } from "../foundation/models/Student";
import { SectionAttendanceAssignment } from "./models/SectionAttendanceAssignment";
import { StudentAttendanceDay } from "./models/StudentAttendanceDay";
import { parseDateKey } from "./dates";
import {
  compareSlotOrder,
  isNurseryKg,
  isLegacyAttendanceDate,
  resolveUnits,
  unitKey,
  type AttendanceUnit,
  type UnitType,
} from "./attendanceUnit";
import { pickCoveringAssignment } from "./services/StudentAttendanceService";

interface SlotLite {
  id: string;
  groupType: UnitType;
  groupId: string;
  dayOfWeek: string;
  periodNumber: number;
  track: string;
  isBreak: boolean;
  teacherId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

const toSlotLite = (s: {
  _id: Types.ObjectId;
  groupType: string;
  groupId: Types.ObjectId;
  dayOfWeek: string;
  periodNumber: number;
  track: string;
  isBreak: boolean;
  teacherId?: Types.ObjectId | null;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}): SlotLite => ({
  id: s._id.toString(),
  groupType: s.groupType as UnitType,
  groupId: s.groupId.toString(),
  dayOfWeek: s.dayOfWeek,
  periodNumber: s.periodNumber,
  track: s.track,
  isBreak: s.isBreak,
  teacherId: s.teacherId ? s.teacherId.toString() : null,
  effectiveFrom: new Date(s.effectiveFrom),
  effectiveTo: s.effectiveTo ? new Date(s.effectiveTo) : null,
});

/** A slot is live on a date when the date sits inside its effective window. */
const liveOn = (s: SlotLite, date: Date): boolean =>
  s.effectiveFrom.getTime() <= date.getTime() && (s.effectiveTo === null || s.effectiveTo.getTime() >= date.getTime());

/**
 * The caller's unmarked marking days within `fullDayKeys` (which must already be
 * FULL days — attendance isn't expected otherwise, AT4.1). Returns the date keys
 * on which at least one unit they mark still has no record, oldest first.
 */
export async function unmarkedMarkingDays(userId: string, fullDayKeys: string[]): Promise<string[]> {
  if (fullDayKeys.length === 0) return [];
  const keys = [...fullDayKeys].sort();
  const dates = new Map(keys.map((k) => [k, parseDateKey(k)]));
  const windowStart = dates.get(keys[0])!;
  const windowEnd = new Date(dates.get(keys[keys.length - 1])!);
  windowEnd.setHours(23, 59, 59, 999);

  // ---- 1. Candidate units: the four ways a teacher becomes responsible ----------
  const [ownSlotsRaw, myCovers, myHrCovers, ctSections, myAssignments] = await Promise.all([
    // No live-window filter: this is a LOOK-BACK: a slot retired mid-window still owed
    // attendance on the days it applied. `liveOn` applies the window per date below.
    RoutineSlot.find({ teacherId: userId, active: true, isBreak: false }).lean(),
    RoutineSubstitution.find({ coverTeacherId: userId, active: true, date: { $gte: windowStart, $lte: windowEnd } })
      .select("slotId")
      .lean(),
    // Approved HR leave-covers in the window (StaffCoverSlot, PXG-1) — the leave
    // flow writes no RoutineSubstitution, so it is its own candidate source.
    StaffCoverSlot.find({ finalCoverTeacherUserId: userId, status: "approved", dateKey: { $in: keys } })
      .select("routineSlotId")
      .lean(),
    Section.find({ classTeacherId: userId, active: true }).select("_id").lean(),
    SectionAttendanceAssignment.find({
      teacherId: userId,
      active: true,
      fromKey: { $lte: keys[keys.length - 1] },
      toKey: { $gte: keys[0] },
    })
      .select("sectionId subjectGroupId")
      .lean(),
  ]);

  const candidates = new Map<string, AttendanceUnit>();
  const add = (u: AttendanceUnit): void => void candidates.set(unitKey(u), u);
  for (const s of ownSlotsRaw.map(toSlotLite)) add({ unitType: s.groupType, unitId: s.groupId });
  const coveredSlotIds = [...myCovers.map((c) => c.slotId), ...myHrCovers.map((c) => c.routineSlotId)];
  if (coveredSlotIds.length > 0) {
    const coveredSlots = await RoutineSlot.find({ _id: { $in: coveredSlotIds }, active: true })
      .select("groupType groupId isBreak")
      .lean();
    for (const s of coveredSlots) {
      if (s.isBreak) continue;
      add({ unitType: s.groupType as UnitType, unitId: s.groupId.toString() });
    }
  }
  for (const s of ctSections) add({ unitType: "section", unitId: s._id.toString() });
  for (const a of myAssignments) {
    if (a.sectionId) add({ unitType: "section", unitId: a.sectionId.toString() });
    else if (a.subjectGroupId) add({ unitType: "subjectgroup", unitId: a.subjectGroupId.toString() });
  }
  if (candidates.size === 0) return [];

  // A unit with NO students has nothing to mark, so it can never receive a day record —
  // keeping it would raise a red "attendance pending" alert the teacher is unable to
  // clear. This bites the Class 1–5 SECTION unit in particular: it holds only the
  // Quran-group-less leftovers, so it is usually empty. The check is PER DAY (D-#292):
  // a pre-cutover day is section-shaped, so there the section counts as populated
  // whenever it has ANY active student (and subjectgroup units did not exist at all).
  const allStudents = await Student.find({ active: true }).select("_id sectionId classId").lean();
  const unitByStudent = await resolveUnits(
    allStudents.map((s) => ({
      id: s._id.toString(),
      sectionId: s.sectionId.toString(),
      classId: s.classId.toString(),
    })),
  );
  const populated = new Set([...unitByStudent.values()].map(unitKey));
  const legacyPopulatedSections = new Set(
    allStudents.map((s) => unitKey({ unitType: "section", unitId: s.sectionId.toString() })),
  );
  const populatedOn = (unit: AttendanceUnit, dateKey: string): boolean =>
    isLegacyAttendanceDate(dateKey)
      ? unit.unitType === "section" && legacyPopulatedSections.has(unitKey(unit))
      : populated.has(unitKey(unit));
  // Drop units empty under BOTH shapes — they can never owe anything.
  for (const [key, unit] of [...candidates.entries()]) {
    if (!populated.has(key) && !(unit.unitType === "section" && legacyPopulatedSections.has(key))) {
      candidates.delete(key);
    }
  }
  if (candidates.size === 0) return [];

  // ---- 2. Everything needed to resolve each candidate's marker, loaded ONCE -------
  const sectionIds = [...candidates.values()].filter((u) => u.unitType === "section").map((u) => u.unitId);
  const groupIds = [...candidates.values()].filter((u) => u.unitType === "subjectgroup").map((u) => u.unitId);

  const [unitSlotsRaw, sections, unitAssignments, dayRecords] = await Promise.all([
    RoutineSlot.find({
      active: true,
      isBreak: false,
      $or: [
        ...(sectionIds.length ? [{ groupType: "section", groupId: { $in: sectionIds } }] : []),
        ...(groupIds.length ? [{ groupType: "subjectgroup", groupId: { $in: groupIds } }] : []),
      ],
    }).lean(),
    sectionIds.length
      ? Section.find({ _id: { $in: sectionIds } }).select("_id classId classTeacherId").lean()
      : Promise.resolve([]),
    SectionAttendanceAssignment.find({
      active: true,
      fromKey: { $lte: keys[keys.length - 1] },
      toKey: { $gte: keys[0] },
      $or: [
        ...(sectionIds.length ? [{ sectionId: { $in: sectionIds } }] : []),
        ...(groupIds.length ? [{ subjectGroupId: { $in: groupIds } }] : []),
      ],
    }).lean(),
    StudentAttendanceDay.find({ dateKey: { $in: keys } }).select("sectionId subjectGroupId dateKey").lean(),
  ]);

  const unitSlots = unitSlotsRaw.map(toSlotLite);
  const [covers, hrCovers] = unitSlots.length
    ? await Promise.all([
        RoutineSubstitution.find({
          slotId: { $in: unitSlots.map((s) => s.id) },
          active: true,
          date: { $gte: windowStart, $lte: windowEnd },
        })
          .select("slotId date coverTeacherId")
          .lean(),
        StaffCoverSlot.find({
          routineSlotId: { $in: unitSlots.map((s) => s.id) },
          dateKey: { $in: keys },
          status: "approved",
          finalCoverTeacherUserId: { $ne: null },
        })
          .select("routineSlotId dateKey finalCoverTeacherUserId")
          .lean(),
      ])
    : [[], []];

  const classes = sections.length
    ? await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("_id level").lean()
    : [];
  const levelByClassId = new Map(classes.map((c) => [c._id.toString(), c.level]));
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));

  // slotId|dateKey → cover teacher. HR leave-covers fill first so a
  // RoutineSubstitution on the same (slot, day) overwrites — same precedence as
  // `attendanceUnit.effectiveTeacher` (substitution → HR cover → own teacher).
  const coverBySlotDay = new Map<string, string>();
  for (const c of hrCovers) {
    coverBySlotDay.set(`${c.routineSlotId.toString()}|${c.dateKey}`, c.finalCoverTeacherUserId!.toString());
  }
  for (const c of covers) {
    const d = new Date(c.date);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    coverBySlotDay.set(`${c.slotId.toString()}|${k}`, c.coverTeacherId.toString());
  }

  const slotsByUnit = new Map<string, SlotLite[]>();
  for (const s of unitSlots) {
    const k = unitKey({ unitType: s.groupType, unitId: s.groupId });
    const list = slotsByUnit.get(k);
    if (list) list.push(s);
    else slotsByUnit.set(k, [s]);
  }
  // Same deterministic order as `attendanceUnit.firstQuranSlotTeacher` — period, then
  // newest effective row, then _id. Without the tie-break, two live rows on the same
  // period make the marker (and this alert) flip between identical requests.
  for (const list of slotsByUnit.values())
    list.sort((a, b) => compareSlotOrder({ _id: a.id, periodNumber: a.periodNumber, effectiveFrom: a.effectiveFrom }, { _id: b.id, periodNumber: b.periodNumber, effectiveFrom: b.effectiveFrom }));

  const assignmentsByUnit = new Map<string, typeof unitAssignments>();
  for (const a of unitAssignments) {
    const u: AttendanceUnit = a.sectionId
      ? { unitType: "section", unitId: a.sectionId.toString() }
      : { unitType: "subjectgroup", unitId: a.subjectGroupId!.toString() };
    const k = unitKey(u);
    const list = assignmentsByUnit.get(k);
    if (list) list.push(a);
    else assignmentsByUnit.set(k, [a]);
  }

  const marked = new Set(
    dayRecords.map((d) =>
      d.sectionId
        ? `section:${d.sectionId.toString()}|${d.dateKey}`
        : `subjectgroup:${d.subjectGroupId!.toString()}|${d.dateKey}`,
    ),
  );

  // ---- 3. Pure marker resolution per (unit, day) — mirrors markerForUnit ----------
  const effectiveTeacher = (s: SlotLite, dateKey: string): string | null =>
    coverBySlotDay.get(`${s.id}|${dateKey}`) ?? s.teacherId;

  const markerOf = (unit: AttendanceUnit, dateKey: string, date: Date): string | null => {
    const k = unitKey(unit);
    const legacy = isLegacyAttendanceDate(dateKey); // D-#292: pre-cutover has no routine rule
    const winner = pickCoveringAssignment(
      (assignmentsByUnit.get(k) ?? []) as unknown as Array<{
        teacherId: { toString(): string };
        fromKey: string;
        toKey: string;
        createdAt: Date;
      }>,
      dateKey,
    );
    if (winner) return winner.teacherId.toString();

    const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
    const slots = (slotsByUnit.get(k) ?? []).filter((s) => s.dayOfWeek === dayOfWeek && liveOn(s, date));

    if (unit.unitType === "subjectgroup") {
      if (legacy) return null; // group capture did not exist pre-cutover
      for (const s of slots) {
        if (s.track !== "quran") continue;
        const t = effectiveTeacher(s, dateKey);
        if (t) return t;
      }
      return null; // a cross-section group has no class-teacher fallback
    }

    const section = sectionById.get(unit.unitId);
    if (!section) return null;
    const level = levelByClassId.get(section.classId.toString());
    if (!legacy && level !== undefined && isNurseryKg(level)) {
      for (const s of slots) {
        const t = effectiveTeacher(s, dateKey);
        if (t) return t;
      }
    }
    return section.classTeacherId ? section.classTeacherId.toString() : null;
  };

  const pendingDays: string[] = [];
  for (const dateKey of keys) {
    const date = dates.get(dateKey)!;
    const anyPending = [...candidates.values()].some(
      (unit) =>
        populatedOn(unit, dateKey) &&
        markerOf(unit, dateKey, date) === userId &&
        !marked.has(`${unitKey(unit)}|${dateKey}`),
    );
    if (anyPending) pendingDays.push(dateKey);
  }
  return pendingDays;
}
