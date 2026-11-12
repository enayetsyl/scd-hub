/**
 * RoutineSlotService — slot create/delete with the conflict engine + scope binding
 * (R-2). Conflict detection + the binding decision are pure (conflicts.ts /
 * binding.ts); this layer does the DB queries + the idempotent ScopeGrant sync.
 */
import { Types } from "mongoose";
import { DAYS_OF_WEEK, subjectAllowedForClassLevel, type DayOfWeek, type RoutineSubject, type PeriodTrack } from "@scd/shared";
import { RoutineSlot, type IRoutineSlot } from "../models/RoutineSlot";
import { RoutineSubstitution } from "../models/RoutineSubstitution";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { currentAcademicYearId } from "../../foundation/services/currentYear";
import { YearChangeRun, type IYearChangeRun } from "../../year-change/models/YearChangeRun";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { SubjectGroup } from "../models/SubjectGroup";
import { Subject } from "../../foundation/models/Subject";
import { User } from "../../foundation/models/User";
import { ScopeGrant } from "../../foundation/models/ScopeGrant";
import { writeAudit } from "../../platform/services/AuditService";
import { weekdayBaseDayType, dayTypeAdmitsTrack } from "../calendar";
import { detectConflicts, type SlotLite } from "../conflicts";
import { liveWindow, startOfDay, endOfDayBefore } from "../liveWindow";
import { routineGrantPlan, ROUTINE_GRANT_SUBJECTS } from "../binding";
import { onRoutineSlotChangedSync } from "../../chat/services/ChatGroupService";
import { recordPlaceMistake } from "../../staff-mistakes/services/StaffMistakeNoteService";

export interface CreateSlotInput {
  groupType: "section" | "subjectgroup";
  groupId: string;
  dayOfWeek: DayOfWeek;
  periodNumber: number;
  subject: RoutineSubject;
  track: PeriodTrack;
  isBreak: boolean;
  teacherId?: string | null;
  roomId?: string | null;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  createdBy: string;
}

export interface CreateSlotResult {
  slot: IRoutineSlot;
  warnings: string[];
}

function toLite(s: {
  _id: { toString(): string };
  dayOfWeek: string;
  periodNumber: number;
  groupType: string;
  groupId: { toString(): string };
  teacherId?: { toString(): string } | null;
  roomId?: { toString(): string } | null;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}): SlotLite {
  return {
    id: s._id.toString(),
    dayOfWeek: s.dayOfWeek,
    periodNumber: s.periodNumber,
    groupType: s.groupType,
    groupId: s.groupId.toString(),
    teacherId: s.teacherId ? s.teacherId.toString() : null,
    roomId: s.roomId ? s.roomId.toString() : null,
    effectiveFrom: s.effectiveFrom,
    effectiveTo: s.effectiveTo ?? null,
  };
}

// ---------------------------------------------------------------------------
// Year-change awareness (YC-6 fixes): a section of a NEXT year is edited in place and grants nothing until
// the cut-over; a section of the year being closed ends where the run ends it.
// ---------------------------------------------------------------------------

interface SectionYearInfo {
  id: Types.ObjectId;
  startDate: Date;
}

async function sectionYear(sectionId: string | Types.ObjectId): Promise<SectionYearInfo | null> {
  const section = (await Section.findById(sectionId).select("classId").lean()) as { classId?: Types.ObjectId } | null;
  if (!section?.classId) return null;
  const klass = (await Class.findById(section.classId).select("academicYearId").lean()) as { academicYearId?: Types.ObjectId } | null;
  if (!klass?.academicYearId) return null;
  const year = (await AcademicYear.findById(klass.academicYearId).select("startDate").lean()) as { _id: Types.ObjectId; startDate: Date } | null;
  return year ? { id: year._id, startDate: year.startDate } : null;
}

/** True when a year is flagged current and this section belongs to a different one (no grant work happens there). */
async function sectionOutsideCurrentYear(sectionId: string | Types.ObjectId): Promise<boolean> {
  const cur = await currentAcademicYearId();
  if (!cur) return false;
  const y = await sectionYear(sectionId);
  return !!y && !y.id.equals(cur);
}

/**
 * Decision B: for a section of a year that starts in the future, the first day a routine row may take
 * effect - the run's new-routine start (the 3rd of January) when a year-change run exists, else the
 * year's own start. Null for every other section.
 */
async function futureRoutineStart(sectionId: string | Types.ObjectId): Promise<Date | null> {
  const cur = await currentAcademicYearId();
  if (!cur) return null;
  const y = await sectionYear(sectionId);
  if (!y) return null;
  const today = dhakaDayKey(new Date());
  const yearNum = dhakaDayKey(y.startDate).slice(0, 4);
  const run = await YearChangeRun.findOne({ toYearId: y.id }).select("_id").lean();
  // While a run exists the floor is the new routine's first day (3 Jan) - also on 1-2 Jan, and also once the
  // cut-over has made the year current (the evening of 1 Jan): the old routine still runs until 2 Jan.
  if (run) return today < `${yearNum}-01-03` ? new Date(`${yearNum}-01-03`) : null;
  if (y.id.equals(cur)) return null;
  if (dhakaDayKey(y.startDate) <= today) return null;
  return new Date(dhakaDayKey(y.startDate));
}

/** Decision E: for a section of the year a run is closing, the instant that run ends the old routine. */
async function closingRunEnd(sectionId: string | Types.ObjectId): Promise<{ runId: string; endDate: Date } | null> {
  if (!(await YearChangeRun.exists({}))) return null; // no year change was ever prepared: nothing to look up
  const y = await sectionYear(sectionId);
  if (!y) return null;
  const run = await YearChangeRun.findOne({ fromYearId: y.id }).select("runId toYearId").lean();
  if (!run) return null;
  const to = (await AcademicYear.findById(run.toYearId).select("startDate").lean()) as { startDate: Date } | null;
  if (!to) return null;
  return { runId: run.runId, endDate: endOfDayBefore(new Date(Number(dhakaDayKey(to.startDate).slice(0, 4)), 0, 3)) };
}

/**
 * A new row (or a replacement) that carries the run's stamped end is recorded on the run so an undo can take it
 * back. One atomic `$push` (no read-modify-write of the whole list). `previous` is the caller's own effectiveTo
 * when one was given, else what the row it replaces had.
 */
async function recordYearChangeEnd(slotId: Types.ObjectId, runId: string | null, inheritFrom?: Types.ObjectId, previous: string | null = null): Promise<void> {
  let prev = previous;
  let target = runId;
  if (!target && inheritFrom) {
    const run = (await YearChangeRun.findOne({ "routineEnds.slotId": String(inheritFrom) }).select("runId routineEnds").lean()) as { runId: string; routineEnds: Array<{ slotId: string; previous: string | null }> } | null;
    if (!run) return;
    target = run.runId;
    prev = run.routineEnds.find((e) => e.slotId === String(inheritFrom))?.previous ?? null;
  }
  if (!target) return;
  await YearChangeRun.updateOne({ runId: target }, { $push: { routineEnds: { slotId: String(slotId), previous: prev } } });
}

/** Create a routine slot (R2.1–R2.6): validate the day admits the track, run the
 *  conflict engine, persist, then bind the routine teaching grant (+ warn). */
export async function createRoutineSlot(input: CreateSlotInput): Promise<CreateSlotResult> {
  // R2.1 — the weekday must admit the track (Fri rejected; Sat only quran).
  const idx = DAYS_OF_WEEK.indexOf(input.dayOfWeek);
  if (idx < 0) throw new Error("Invalid dayOfWeek");
  if (!dayTypeAdmitsTrack(weekdayBaseDayType(idx), input.track))
    throw new Error(`A ${input.track} slot cannot be scheduled on ${input.dayOfWeek}`);
  // R2.1 — a break period takes no subject/teacher.
  if (input.isBreak && input.teacherId)
    throw new Error("A break period takes no teacher");

  // Resolve the group + (for sections) the classId the scope binding needs.
  let classId: Types.ObjectId | undefined;
  let effectiveFrom = input.effectiveFrom;
  let effectiveTo: Date | null = input.effectiveTo ?? null;
  let stampedByRun: string | null = null;
  let stampedPrevious: string | null = null;
  if (input.groupType === "section") {
    const section = await Section.findById(input.groupId).lean();
    if (!section) throw new Error("Section not found");
    classId = section.classId as Types.ObjectId;
    // Decision B: a next-year row never starts before the new routine does.
    const floor = await futureRoutineStart(input.groupId);
    if (floor && effectiveFrom.getTime() < floor.getTime()) effectiveFrom = floor;
    // Decision E: a row added to the year being closed, after a prepare, ends where the run ends the old routine
    // (clamped BEFORE the conflict check, so it no longer collides with its 2027 copy).
    const closing = await closingRunEnd(input.groupId);
    if (closing && startOfDay(effectiveFrom).getTime() > closing.endDate.getTime()) {
      throw new Error(`This section's year ends on ${dhakaDayKey(closing.endDate)}; add a period starting later to the next year's section instead`);
    }
    if (closing && (!effectiveTo || effectiveTo.getTime() > closing.endDate.getTime())) {
      stampedPrevious = effectiveTo ? effectiveTo.toISOString() : null;
      effectiveTo = closing.endDate;
      stampedByRun = closing.runId;
    }
    const klass = (await Class.findById(classId).select("level").lean()) as { level: number } | null;
    if (klass && !subjectAllowedForClassLevel(input.subject, klass.level)) {
      throw new Error("এই বিষয়টি ষষ্ঠ শ্রেণি থেকে চালু; নিচের শ্রেণির জন্য নেওয়া যাবে না");
    }
  } else {
    const group = await SubjectGroup.findById(input.groupId).lean();
    if (!group) throw new Error("SubjectGroup not found");
  }

  // R2.2–R2.4 — conflict engine against existing active slots at this (day, period).
  const candidate: SlotLite = {
    id: "new",
    dayOfWeek: input.dayOfWeek,
    periodNumber: input.periodNumber,
    groupType: input.groupType,
    groupId: input.groupId,
    teacherId: input.teacherId ?? null,
    roomId: input.roomId ?? null,
    effectiveFrom,
    effectiveTo,
  };
  const existingDocs = await RoutineSlot.find({
    dayOfWeek: input.dayOfWeek,
    periodNumber: input.periodNumber,
    active: true,
  }).lean();
  const conflicts = detectConflicts(candidate, existingDocs.map(toLite));
  if (conflicts.teacher) throw new Error(`Teacher already booked at ${input.dayOfWeek} P${input.periodNumber}`);
  if (conflicts.group) throw new Error(`Group already booked at ${input.dayOfWeek} P${input.periodNumber}`);
  if (conflicts.room) throw new Error(`Room already booked at ${input.dayOfWeek} P${input.periodNumber}`);

  const slot = await RoutineSlot.create({
    groupType: input.groupType,
    groupId: new Types.ObjectId(input.groupId),
    classId,
    dayOfWeek: input.dayOfWeek,
    periodNumber: input.periodNumber,
    subject: input.subject,
    track: input.track,
    isBreak: input.isBreak,
    teacherId: input.teacherId ? new Types.ObjectId(input.teacherId) : undefined,
    roomId: input.roomId ? new Types.ObjectId(input.roomId) : undefined,
    effectiveFrom,
    effectiveTo: effectiveTo ?? undefined,
    createdBy: new Types.ObjectId(input.createdBy),
  });
  if (stampedByRun) await recordYearChangeEnd(slot._id, stampedByRun, undefined, stampedPrevious);

  // R2.5/R2.6 — bind the routine teaching grant (+ authority warning).
  const warnings: string[] = [];
  const plan = routineGrantPlan(
    { groupType: input.groupType, isBreak: input.isBreak, teacherId: input.teacherId, subject: input.subject },
    ROUTINE_GRANT_SUBJECTS,
  );
  if (plan.bind && input.teacherId && classId) {
    const warn = await bindRoutineGrant(
      input.teacherId,
      classId.toString(),
      input.groupId,
      input.subject,
      input.createdBy,
    );
    if (warn) warnings.push(warn);
  }

  // M-2 (D-#78): keep the SECTION + SUBJECT chat groups in sync with the new
  // slot's teacher. Best-effort — never blocks the routine mutation.
  await onRoutineSlotChangedSync(slot);
  if (input.teacherId) {
    await announceRoutineTeachersChanged({
      teacherIds: [input.teacherId],
      from: effectiveFrom,
      actorId: input.createdBy,
      cells: sectionCells(input.groupType, input.groupId, [input.subject]),
    });
  }

  return { slot, warnings };
}

// ---------------------------------------------------------------------------
// Routine-change listeners
// ---------------------------------------------------------------------------

/** A teacher's timetable changed from `from` on (a slot was created, re-assigned, or
 *  retired). Listeners re-derive whatever was planned against the old timetable. */
export interface RoutineTeachersChange {
  teacherIds: string[];
  from: Date;
  actorId: string;
  /** D-#880: the SECTION × subject cells the edit touched (both subjects when an edit
   *  changed it). Subject-group slots carry none — the assignment plan is section-keyed. */
  cells?: Array<{ sectionId: string; subject: string }>;
}

function sectionCells(
  groupType: string,
  groupId: { toString(): string },
  subjects: string[],
): Array<{ sectionId: string; subject: string }> {
  if (groupType !== "section") return [];
  return [...new Set(subjects)].map((subject) => ({ sectionId: groupId.toString(), subject }));
}
type RoutineChangeListener = (change: RoutineTeachersChange) => Promise<void>;
const routineChangeListeners: RoutineChangeListener[] = [];

/** Subscribe to routine changes. The leave-cover service registers here so covers follow
 *  the timetable (owner report 2026-10-01: a cover arranged before the C4/C5 split kept
 *  pointing at the retired combined-section period). A registry instead of a direct import
 *  because CoverService already imports this module. */
export function onRoutineTeachersChanged(listener: RoutineChangeListener): void {
  routineChangeListeners.push(listener);
}

/** Best-effort fan-out to the listeners — a listener failure never blocks a routine edit. */
async function announceRoutineTeachersChanged(change: RoutineTeachersChange): Promise<void> {
  const teacherIds = [...new Set(change.teacherIds.filter(Boolean))];
  if (teacherIds.length === 0) return;
  for (const listener of routineChangeListeners) {
    try {
      await listener({ ...change, teacherIds });
    } catch (err) {
      console.error("[routine] change listener failed (routine edit unaffected):", err);
    }
  }
}

export interface UpdateSlotInput {
  slotId: string;
  subject: RoutineSubject;
  track: PeriodTrack;
  teacherId?: string | null;
  roomId?: string | null;
  actorId: string;
  /** The date the change takes effect (D-#47(3)). Defaults to today. */
  effectiveFrom?: Date | null;
}

/**
 * Edit a slot (R-3 master-grid cell edit): change the subject, track, teacher or room
 * WITHOUT moving its (group, day, period).
 *
 * VERSIONED (D-#47(3)): the edit does not overwrite the past. The existing row is
 * CLOSED the day before `effectiveFrom` and a REPLACEMENT row is opened from that date
 * carrying the new values, so "who taught this period in June?" stays answerable. The
 * one exception is an edit effective at or before the row's own start — there is no
 * history to preserve, so that row is corrected in place (this is the same-day
 * fix-a-typo path, and it keeps a slot created today from spawning a zero-length
 * historical twin).
 *
 * Runs the same conflict engine as create (excluding the row being replaced, and
 * window-aware so a retired row never blocks its own successor) and re-syncs the
 * routine teaching grant — unbinding the old (teacher, subject) if it is orphaned as
 * of the changeover date, binding the new one (+ authority warning).
 */
export async function updateRoutineSlot(input: UpdateSlotInput): Promise<CreateSlotResult> {
  const existing = await RoutineSlot.findById(input.slotId).lean();
  if (!existing) throw new Error("Routine slot not found");

  let changeFrom = startOfDay(input.effectiveFrom ?? new Date());
  // Decision B: a row of a next year that has not started is edited in place, and never "from" before the new routine.
  const futureStart = existing.groupType === "section" ? await futureRoutineStart(existing.groupId) : null;
  if (futureStart && changeFrom < startOfDay(futureStart)) changeFrom = startOfDay(futureStart);
  // Editing a row that has already been retired would rewrite history — the caller
  // wants whichever row is in force on that date instead.
  if (existing.effectiveTo && startOfDay(new Date(existing.effectiveTo)) < changeFrom)
    throw new Error(
      `That slot stopped applying on ${new Date(existing.effectiveTo).toISOString().slice(0, 10)} — ` +
        `edit the slot in force on the change date instead`,
    );
  // Nothing to preserve when the change starts at or before the row's own start.
  const inPlace = changeFrom <= startOfDay(new Date(existing.effectiveFrom)) || (!!futureStart && startOfDay(new Date(existing.effectiveFrom)) > startOfDay(new Date()));

  // R2.1 — the weekday must admit the new track; a break takes no teacher.
  const idx = DAYS_OF_WEEK.indexOf(existing.dayOfWeek as DayOfWeek);
  if (idx < 0) throw new Error("Invalid dayOfWeek");
  if (!dayTypeAdmitsTrack(weekdayBaseDayType(idx), input.track))
    throw new Error(`A ${input.track} slot cannot be scheduled on ${existing.dayOfWeek}`);
  if (existing.isBreak && input.teacherId)
    throw new Error("A break period takes no teacher");

  // Resolve the section's classId the scope binding needs.
  let classId: Types.ObjectId | undefined;
  if (existing.groupType === "section") {
    const section = await Section.findById(existing.groupId).lean();
    if (!section) throw new Error("Section not found");
    classId = section.classId as Types.ObjectId;
    // Only a subject CHANGE is checked, so an older slot can still change teacher/room.
    if (input.subject !== existing.subject) {
      const klass = (await Class.findById(classId).select("level").lean()) as { level: number } | null;
      if (klass && !subjectAllowedForClassLevel(input.subject, klass.level)) {
        throw new Error("এই বিষয়টি ষষ্ঠ শ্রেণি থেকে চালু; নিচের শ্রেণির জন্য নেওয়া যাবে না");
      }
    }
  }

  // R2.2–R2.4 — conflict engine against the other active slots at this (day, period).
  const candidate: SlotLite = {
    id: existing._id.toString(),
    dayOfWeek: existing.dayOfWeek,
    periodNumber: existing.periodNumber,
    groupType: existing.groupType,
    groupId: existing.groupId.toString(),
    teacherId: input.teacherId ?? null,
    roomId: input.roomId ?? null,
    // The replacement runs from the changeover date, not from the old row's start —
    // otherwise it would appear to collide with slots that only ever overlapped the
    // period it is replacing.
    effectiveFrom: inPlace ? existing.effectiveFrom : changeFrom,
    effectiveTo: existing.effectiveTo ?? null,
  };
  const otherDocs = await RoutineSlot.find({
    dayOfWeek: existing.dayOfWeek,
    periodNumber: existing.periodNumber,
    active: true,
    _id: { $ne: existing._id },
  }).lean();
  const conflicts = detectConflicts(candidate, otherDocs.map(toLite));
  if (conflicts.teacher) throw new Error(`Teacher already booked at ${existing.dayOfWeek} P${existing.periodNumber}`);
  if (conflicts.group) throw new Error(`Group already booked at ${existing.dayOfWeek} P${existing.periodNumber}`);
  if (conflicts.room) throw new Error(`Room already booked at ${existing.dayOfWeek} P${existing.periodNumber}`);

  const oldTeacherId = existing.teacherId ? existing.teacherId.toString() : null;
  const oldSubject = existing.subject;
  const newTeacherId = input.teacherId ?? null;

  // Persist. In place when there is no history to keep; otherwise close the old row
  // the day before the change and open its replacement ($unset clears a removed
  // teacher/room on the in-place path).
  let liveId = existing._id;
  if (inPlace) {
    const set: Record<string, unknown> = { subject: input.subject, track: input.track };
    const unset: Record<string, ""> = {};
    if (newTeacherId) set.teacherId = new Types.ObjectId(newTeacherId);
    else unset.teacherId = "";
    if (input.roomId) set.roomId = new Types.ObjectId(input.roomId);
    else unset.roomId = "";
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;
    await RoutineSlot.updateOne({ _id: existing._id }, update);
  } else {
    await RoutineSlot.updateOne({ _id: existing._id }, { $set: { effectiveTo: endOfDayBefore(changeFrom) } });
    const replacement = await RoutineSlot.create({
      groupType: existing.groupType,
      groupId: existing.groupId,
      classId: existing.classId,
      dayOfWeek: existing.dayOfWeek,
      periodNumber: existing.periodNumber,
      subject: input.subject,
      track: input.track,
      isBreak: existing.isBreak,
      teacherId: newTeacherId ? new Types.ObjectId(newTeacherId) : undefined,
      roomId: input.roomId ? new Types.ObjectId(input.roomId) : undefined,
      effectiveFrom: changeFrom,
      effectiveTo: existing.effectiveTo ?? undefined,
      createdBy: new Types.ObjectId(input.actorId),
    });
    liveId = replacement._id;
    // the replacement inherits the run's stamped end; an undo-prepare must be able to take it back too
    if (existing.effectiveTo) await recordYearChangeEnd(replacement._id, null, existing._id);
  }
  await writeAudit({
    eventKind: "ROUTINE_SLOT_REVISED",
    actorId: input.actorId,
    targetId: liveId,
    targetKind: "RoutineSlot",
    meta: {
      supersededSlotId: inPlace ? null : existing._id.toString(),
      effectiveFrom: changeFrom.toISOString().slice(0, 10),
      inPlace,
      from: { subject: oldSubject, teacherId: oldTeacherId },
      to: { subject: input.subject, teacherId: newTeacherId },
    },
  });
  // D-#953: a cell changed before it ever applied was set up wrong.
  if (inPlace && !futureStart) {
    await recordPlaceMistake({ kind: "ROUTINE_CELL_REVISED", tier: 2, refKey: existing._id.toString(), ownerId: existing.createdBy, correctedBy: input.actorId, at: new Date(), line: `${existing.dayOfWeek} · পিরিয়ড ${existing.periodNumber}: কার্যকর হওয়ার আগেই বদলানো হয়েছে` });
  }

  // Re-sync the routine teaching grant: unbind the old (teacher, subject) if it is
  // orphaned AS OF the changeover date, then bind the new one. unbind runs AFTER the
  // write so its "still justified?" check sees the new state.
  const warnings: string[] = [];
  const oldPlan = routineGrantPlan(
    { groupType: existing.groupType, isBreak: existing.isBreak, teacherId: oldTeacherId ?? undefined, subject: oldSubject },
    ROUTINE_GRANT_SUBJECTS,
  );
  if (oldPlan.bind && oldTeacherId && (oldTeacherId !== newTeacherId || oldSubject !== input.subject)) {
    await unbindIfOrphaned(oldTeacherId, existing.groupId.toString(), oldSubject, input.actorId, changeFrom);
  }
  const newPlan = routineGrantPlan(
    { groupType: existing.groupType, isBreak: existing.isBreak, teacherId: newTeacherId ?? undefined, subject: input.subject },
    ROUTINE_GRANT_SUBJECTS,
  );
  if (newPlan.bind && newTeacherId && classId) {
    const warn = await bindRoutineGrant(newTeacherId, classId.toString(), existing.groupId.toString(), input.subject, input.actorId);
    if (warn) warnings.push(warn);
  }

  const slot = await RoutineSlot.findById(liveId).lean();
  await onRoutineSlotChangedSync(slot as unknown as IRoutineSlot);
  await announceRoutineTeachersChanged({
    teacherIds: [oldTeacherId, newTeacherId].filter((t): t is string => !!t),
    from: changeFrom,
    actorId: input.actorId,
    cells: sectionCells(existing.groupType, existing.groupId, [oldSubject, input.subject]),
  });
  return { slot: slot as unknown as IRoutineSlot, warnings };
}

/** Idempotent upsert of a routine teaching grant; returns an R2.6 warning if the
 *  teacher had no prior teaching authority for this section+subject. */
async function bindRoutineGrant(
  teacherId: string,
  classId: string,
  sectionId: string,
  subjectCode: string,
  createdBy: string,
): Promise<string | null> {
  // Decision A: a section of a year that is not the current one grants nothing; the cut-over makes its grants.
  if (await sectionOutsideCurrentYear(sectionId)) return null;
  const subject = await Subject.findOne({ code: subjectCode }).lean();
  if (!subject) return null;
  const subjectId = subject._id;
  // R2.6 — warn (don't block) if there is no prior teaching authority here.
  const prior = await ScopeGrant.findOne({
    teacherId,
    kind: "teaching",
    sectionId,
    subjectId,
    active: true,
  }).lean();
  const warn = prior
    ? null
    : `Teacher has no prior teaching authority for ${subjectCode} in this section; the routine slot now grants it.`;

  const existing = await ScopeGrant.findOne({
    teacherId,
    kind: "teaching",
    sectionId,
    subjectId,
    source: "routine",
  }).lean();
  if (existing) {
    // A slot justifies the grant again, so any lapse a future-dated retirement
    // stamped on it is void - except the lapse a year-change run stamped (decision E): the old
    // year's grant still ends on the first day of the new routine.
    // When a year-change run stamped this grant, the lapse goes back to the run's value (a later future-dated
    // unbind may have moved it earlier): the old year's grant still ends on the first day of the new routine.
    const stampRun = (await YearChangeRun.findOne({ "grantExpiries.grantId": String(existing._id) })) as IYearChangeRun | null;
    let lapse: Date | null = null;
    if (stampRun) {
      const to = (await AcademicYear.findById(stampRun.toYearId).select("startDate").lean()) as { startDate: Date } | null;
      if (to) lapse = new Date(`${dhakaDayKey(to.startDate).slice(0, 4)}-01-03T00:00:00+06:00`);
    }
    await ScopeGrant.updateOne(
      { _id: existing._id },
      lapse
        ? { $set: { active: true, classId: new Types.ObjectId(classId), expiresAt: lapse } }
        : { $set: { active: true, classId: new Types.ObjectId(classId) }, $unset: { expiresAt: "" } },
    );
  } else {
    await ScopeGrant.create({
      teacherId: new Types.ObjectId(teacherId),
      kind: "teaching",
      classId: new Types.ObjectId(classId),
      sectionId: new Types.ObjectId(sectionId),
      subjectId,
      source: "routine",
      active: true,
      createdBy: new Types.ObjectId(createdBy),
    });
  }
  await writeAudit({
    eventKind: "SCOPE_GRANT_ASSIGN",
    actorId: createdBy,
    targetKind: "RoutineTeachingGrant",
    meta: { source: "routine", teacherId, sectionId, subject: subjectCode },
  });
  return warn;
}

/**
 * Remove a slot from the routine; revoke its routine grant only if no remaining slot
 * justifies it (idempotent sync — manual grants are never touched, D-#49).
 *
 * VERSIONED (D-#47(3)): a slot that has already been taught is RETIRED, not deleted —
 * `effectiveTo` closes the day before `effectiveFrom` so the past stays intact. Only a
 * slot whose window has not started yet is hard-deleted, which is the "this row was a
 * mistake" path. Retirement never sets `active: false`: every read filters on `active`,
 * so that would hide the row from historical queries as well.
 */
export async function deleteRoutineSlot(
  slotId: string,
  actorId: string,
  effectiveFrom?: Date | null,
): Promise<void> {
  const slot = await RoutineSlot.findById(slotId).lean();
  if (!slot) throw new Error("Routine slot not found");

  let changeFrom = startOfDay(effectiveFrom ?? new Date());
  const futureStart = slot.groupType === "section" ? await futureRoutineStart(slot.groupId) : null;
  if (futureStart && changeFrom < startOfDay(futureStart)) changeFrom = startOfDay(futureStart);
  const neverApplied =
    changeFrom <= startOfDay(new Date(slot.effectiveFrom)) || (!!futureStart && startOfDay(new Date(slot.effectiveFrom)) > startOfDay(new Date()));
  if (neverApplied) {
    await RoutineSlot.deleteOne({ _id: slotId });
  } else {
    await RoutineSlot.updateOne({ _id: slotId }, { $set: { effectiveTo: endOfDayBefore(changeFrom) } });
  }
  await writeAudit({
    eventKind: "ROUTINE_SLOT_RETIRED",
    actorId,
    targetId: slot._id,
    targetKind: "RoutineSlot",
    meta: {
      deleted: neverApplied,
      effectiveTo: neverApplied ? null : endOfDayBefore(changeFrom).toISOString().slice(0, 10),
      subject: slot.subject,
      teacherId: slot.teacherId ? slot.teacherId.toString() : null,
    },
  });

  const plan = routineGrantPlan(
    { groupType: slot.groupType, isBreak: slot.isBreak, teacherId: slot.teacherId?.toString(), subject: slot.subject },
    ROUTINE_GRANT_SUBJECTS,
  );
  if (plan.bind && slot.teacherId) {
    await unbindIfOrphaned(slot.teacherId.toString(), slot.groupId.toString(), slot.subject, actorId, changeFrom);
  }

  // M-2 (D-#78): re-sync the affected SECTION + SUBJECT chat groups (the teacher
  // may now have dropped out of one). Best-effort — never blocks the delete.
  await onRoutineSlotChangedSync(slot);
  if (slot.teacherId) {
    await announceRoutineTeachersChanged({
      teacherIds: [slot.teacherId.toString()],
      from: changeFrom,
      actorId,
      cells: sectionCells(slot.groupType, slot.groupId, [slot.subject]),
    });
  }
}

/** Revoke the routine teaching grant for (teacher, section, subject) iff no routine
 *  section-slot that is IN FORCE on `on` still maps to it. The window filter is what
 *  stops a retired slot from justifying a grant forever (D-#47(3)); `on` is the date
 *  the routine change takes effect, so a future-dated retirement is evaluated against
 *  the state it will actually produce. */
async function unbindIfOrphaned(
  teacherId: string,
  sectionId: string,
  subjectCode: string,
  actorId: string,
  on: Date = new Date(),
): Promise<void> {
  if (await sectionOutsideCurrentYear(sectionId)) return; // decision A: nothing to revoke there
  // Still justified by a row live on `on` OR one that starts after it (decision A): only a row that has
  // already ended before `on` stops justifying the grant.
  const remaining = await RoutineSlot.findOne({
    groupType: "section",
    groupId: sectionId,
    teacherId,
    subject: subjectCode,
    active: true,
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: startOfDay(on) } }],
  }).lean();
  if (remaining) return; // still justified by another slot

  const subject = await Subject.findOne({ code: subjectCode }).lean();
  if (!subject) return;
  const grant = await ScopeGrant.findOne({
    teacherId,
    kind: "teaching",
    sectionId,
    subjectId: subject._id,
    source: "routine",
    active: true,
  }).lean();
  if (!grant) return;

  // A FUTURE-dated retirement: the slot still runs until `on`, so the teacher must
  // keep writing for it until then. Stamp the lapse instead of deactivating now —
  // deactivating immediately locked six teachers out of their own periods for the
  // rest of the day when the C4/C5 split was applied at noon for the next day
  // (owner report 2026-09-30). The grant lapses at request time (composeTeacherScope).
  const lapseAt = startOfDay(on);
  if (lapseAt.getTime() > startOfDay(new Date()).getTime()) {
    await ScopeGrant.updateOne({ _id: grant._id }, { $set: { expiresAt: lapseAt } });
    await writeAudit({
      eventKind: "SCOPE_GRANT_REVOKE",
      actorId,
      targetId: grant._id,
      targetKind: "RoutineTeachingGrant",
      meta: { source: "routine", teacherId, sectionId, subject: subjectCode, effectiveFrom: lapseAt.toISOString() },
    });
    return;
  }

  await ScopeGrant.updateOne({ _id: grant._id }, { $set: { active: false } });
  await writeAudit({
    eventKind: "SCOPE_GRANT_REVOKE",
    actorId,
    targetId: grant._id,
    targetKind: "RoutineTeachingGrant",
    meta: { source: "routine", teacherId, sectionId, subject: subjectCode },
  });
}

/** A resolved slot for a date — the stored slot plus the cover teacher (if any)
 *  overriding it on that date (R4.4). `coverTeacherId` is null when uncovered. */
export type ResolvedSlot = IRoutineSlot & { coverTeacherId: string | null };

/** The effective slots for a group on a date (R2.7) — slots whose
 *  `[effectiveFrom, effectiveTo)` window contains the date, ordered by period.
 *  NO cover overlay: this never reads `RoutineSubstitution`, so it is the safe
 *  source for the guardian portal's narrow view (D-#69 — guardians see no
 *  cover/substitution data at all). Staff views overlay covers via
 *  `routineForDate` below. */
export async function slotsForDate(
  groupType: "section" | "subjectgroup",
  groupId: string,
  date: Date,
): Promise<IRoutineSlot[]> {
  const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
  return RoutineSlot.find({
    groupType,
    groupId,
    dayOfWeek,
    active: true,
    ...liveWindow(date),
  })
    .sort({ periodNumber: 1 })
    .lean() as unknown as Promise<IRoutineSlot[]>;
}

/** A teacher's own effective slots on a date (PXG-1) — mirrors `slotsForDate`'s
 *  effective-window logic but keyed by `teacherId` across ALL their groups instead
 *  of one, so a leave's per-meeting cover fan-out can find every period a teacher
 *  actually teaches that day. Returns BOTH `section` and `subjectgroup` (Quran/
 *  Arabic) meetings — the caller (`fanOutCoverSlots`) branches on each slot's
 *  `groupType` (D-#268 Quran/Arabic follow-up; the earlier section-only filter is
 *  why Quran/Arabic periods never fanned out). */
export async function slotsForTeacherOnDate(teacherId: string, date: Date): Promise<IRoutineSlot[]> {
  const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
  return RoutineSlot.find({
    teacherId,
    dayOfWeek,
    active: true,
    ...liveWindow(date),
  })
    .sort({ periodNumber: 1 })
    .lean() as unknown as Promise<IRoutineSlot[]>;
}

// ---------------------------------------------------------------------------
// Subject-teacher ⇄ routine visibility + sync (D-#291)
// ---------------------------------------------------------------------------

/** LIVE (effective-now) section slots for a section, optionally one subject. */
async function liveSectionSlots(
  sectionId: string,
  subject?: string,
  now = new Date(),
  groupType: "section" | "subjectgroup" = "section",
) {
  const filter: Record<string, unknown> = {
    groupType,
    groupId: sectionId,
    active: true,
    isBreak: false,
    ...liveWindow(now),
  };
  if (subject) filter.subject = subject;
  return RoutineSlot.find(filter).lean();
}

export interface SubjectRoutineTeachers {
  subject: string;
  teacherIds: string[];
  teacherNames: string[];
}

/**
 * Per-subject ROUTINE teachers for a section's live slots — the Assign-subject-teacher
 * screen shows these beside the teaching grants so a grant/timetable mismatch is
 * visible instead of silently drifting (the routine drives attendance markers,
 * class-note prompts and Today; grants drive tracker access, D-#287).
 */
export async function sectionSubjectRoutineTeachers(
  sectionId: string,
  now = new Date(),
): Promise<SubjectRoutineTeachers[]> {
  const slots = await liveSectionSlots(sectionId, undefined, now);
  const bySubject = new Map<string, Set<string>>();
  for (const s of slots) {
    if (!s.teacherId) continue;
    const set = bySubject.get(s.subject) ?? bySubject.set(s.subject, new Set()).get(s.subject)!;
    set.add(s.teacherId.toString());
  }
  const allIds = [...new Set([...bySubject.values()].flatMap((set) => [...set]))];
  const users = allIds.length
    ? await User.find({ _id: { $in: allIds } }).select("name").lean()
    : [];
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
  return [...bySubject.entries()]
    .map(([subject, ids]) => ({
      subject,
      teacherIds: [...ids],
      teacherNames: [...ids].map((id) => nameOf.get(id) ?? id),
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

export interface ReassignSubjectTeacherResult {
  updatedSlots: number;
  warnings: string[];
}

/**
 * Point every live routine slot of (section, subject) at a new teacher — the
 * optional "also update the routine" step after assigning a subject teacher
 * (D-#291). Pre-checks the new teacher's availability across ALL affected
 * (day, period) cells so the change applies whole-or-not-at-all, then reuses
 * `updateRoutineSlot` per slot (same conflict engine, grant re-binding and chat
 * re-sync as a master-grid cell edit — no new edge logic).
 *
 * D-#895 `scope` — the master grid's "all this teacher's periods" edit: `groupType`
 * reaches a Quran/Arabic subject group too, and `fromTeacherId` narrows the change to
 * the periods that teacher holds (a co-teacher's periods of the subject stay put).
 */
export async function reassignRoutineSubjectTeacher(
  sectionId: string,
  subject: string,
  teacherId: string,
  actorId: string,
  effectiveFrom?: Date | null,
  scope: { groupType?: "section" | "subjectgroup"; fromTeacherId?: string | null } = {},
): Promise<ReassignSubjectTeacherResult> {
  // Everything below is evaluated as of the changeover date: which slots are in force,
  // whether the new teacher is free, and the effective date each replacement carries.
  let now = startOfDay(effectiveFrom ?? new Date());
  // a section of the next year (the December draft): the change date is never before the new routine starts
  if ((scope.groupType ?? "section") === "section") {
    const fs = await futureRoutineStart(sectionId);
    if (fs && now < startOfDay(fs)) now = startOfDay(fs);
  }
  const slots = (await liveSectionSlots(sectionId, subject, now, scope.groupType)).filter(
    (s) => !scope.fromTeacherId || String(s.teacherId ?? "") === scope.fromTeacherId,
  );
  if (slots.length === 0) {
    throw new Error(`No live routine slots for ${subject} in this section — nothing to update`);
  }

  // Whole-or-nothing pre-check: the new teacher must be free at every affected
  // (day, period) outside the slots being reassigned.
  const targetIds = slots.map((s) => s._id);
  const clashes = await RoutineSlot.find({
    _id: { $nin: targetIds },
    teacherId,
    active: true,
    // liveWindow carries its own `$or`, so it must go inside the `$and` here.
    $and: [
      liveWindow(now),
      { $or: slots.map((s) => ({ dayOfWeek: s.dayOfWeek, periodNumber: s.periodNumber })) },
    ],
  })
    .select("dayOfWeek periodNumber")
    .lean();
  if (clashes.length > 0) {
    const where = clashes.map((c) => `${c.dayOfWeek} P${c.periodNumber}`).join(", ");
    throw new Error(`Teacher already booked at ${where} — resolve those periods first`);
  }

  const warnings = new Set<string>();
  let updatedSlots = 0;
  for (const s of slots) {
    const res = await updateRoutineSlot({
      slotId: s._id.toString(),
      subject: s.subject as RoutineSubject,
      track: s.track as PeriodTrack,
      teacherId,
      roomId: s.roomId ? s.roomId.toString() : null,
      actorId,
      effectiveFrom: now,
    });
    for (const w of res.warnings) warnings.add(w);
    updatedSlots += 1;
  }
  return { updatedSlots, warnings: [...warnings] };
}

/** Resolve the effective slots for a group on a date (R2.7) with any active
 *  cover for that date overlaid (R4.4). Staff-facing only. */
export async function routineForDate(
  groupType: "section" | "subjectgroup",
  groupId: string,
  date: Date,
): Promise<ResolvedSlot[]> {
  const slots = await slotsForDate(groupType, groupId, date);

  // Overlay covers for this date (R4.4).
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const slotIds = slots.map((s) => s._id);
  const subs = await RoutineSubstitution.find({
    slotId: { $in: slotIds },
    active: true,
    date: { $gte: start, $lte: end },
  }).lean();
  const coverMap = new Map(subs.map((su) => [su.slotId.toString(), su.coverTeacherId.toString()]));
  return slots.map((s) => ({
    ...s,
    coverTeacherId: coverMap.get(s._id.toString()) ?? null,
  })) as unknown as ResolvedSlot[];
}
