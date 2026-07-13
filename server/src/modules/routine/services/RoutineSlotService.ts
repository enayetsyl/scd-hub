/**
 * RoutineSlotService — slot create/delete with the conflict engine + scope binding
 * (R-2). Conflict detection + the binding decision are pure (conflicts.ts /
 * binding.ts); this layer does the DB queries + the idempotent ScopeGrant sync.
 */
import { Types } from "mongoose";
import { SUBJECTS, DAYS_OF_WEEK, type DayOfWeek, type RoutineSubject, type PeriodTrack } from "@scd/shared";
import { RoutineSlot, type IRoutineSlot } from "../models/RoutineSlot";
import { RoutineSubstitution } from "../models/RoutineSubstitution";
import { Section } from "../../foundation/models/Section";
import { SubjectGroup } from "../models/SubjectGroup";
import { Subject } from "../../foundation/models/Subject";
import { User } from "../../foundation/models/User";
import { ScopeGrant } from "../../foundation/models/ScopeGrant";
import { writeAudit } from "../../platform/services/AuditService";
import { weekdayBaseDayType, dayTypeAdmitsTrack } from "../calendar";
import { detectConflicts, type SlotLite } from "../conflicts";
import { routineGrantPlan } from "../binding";
import { onRoutineSlotChangedSync } from "../../chat/services/ChatGroupService";

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
  if (input.groupType === "section") {
    const section = await Section.findById(input.groupId).lean();
    if (!section) throw new Error("Section not found");
    classId = section.classId as Types.ObjectId;
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
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
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
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? undefined,
    createdBy: new Types.ObjectId(input.createdBy),
  });

  // R2.5/R2.6 — bind the routine teaching grant (+ authority warning).
  const warnings: string[] = [];
  const plan = routineGrantPlan(
    { groupType: input.groupType, isBreak: input.isBreak, teacherId: input.teacherId, subject: input.subject },
    SUBJECTS,
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

  return { slot, warnings };
}

export interface UpdateSlotInput {
  slotId: string;
  subject: RoutineSubject;
  track: PeriodTrack;
  teacherId?: string | null;
  roomId?: string | null;
  actorId: string;
}

/** Edit an existing slot in place (R-3 master-grid cell edit): change the subject,
 *  track, teacher or room of one slot WITHOUT moving its (group, day, period) or
 *  effective window. Runs the same conflict engine as create (excluding the slot
 *  itself) and re-syncs the routine teaching grant — unbinding the old (teacher,
 *  subject) if it is now orphaned, binding the new one (+ authority warning). */
export async function updateRoutineSlot(input: UpdateSlotInput): Promise<CreateSlotResult> {
  const existing = await RoutineSlot.findById(input.slotId).lean();
  if (!existing) throw new Error("Routine slot not found");

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
    effectiveFrom: existing.effectiveFrom,
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

  // Persist the field changes ($unset clears a removed teacher/room).
  const set: Record<string, unknown> = { subject: input.subject, track: input.track };
  const unset: Record<string, ""> = {};
  if (newTeacherId) set.teacherId = new Types.ObjectId(newTeacherId);
  else unset.teacherId = "";
  if (input.roomId) set.roomId = new Types.ObjectId(input.roomId);
  else unset.roomId = "";
  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length) update.$unset = unset;
  await RoutineSlot.updateOne({ _id: existing._id }, update);

  // Re-sync the routine teaching grant: unbind the old (teacher, subject) if it is
  // now orphaned, then bind the new one. unbind runs AFTER the write so its
  // "still justified?" check sees the new state.
  const warnings: string[] = [];
  const oldPlan = routineGrantPlan(
    { groupType: existing.groupType, isBreak: existing.isBreak, teacherId: oldTeacherId ?? undefined, subject: oldSubject },
    SUBJECTS,
  );
  if (oldPlan.bind && oldTeacherId && (oldTeacherId !== newTeacherId || oldSubject !== input.subject)) {
    await unbindIfOrphaned(oldTeacherId, existing.groupId.toString(), oldSubject, input.actorId);
  }
  const newPlan = routineGrantPlan(
    { groupType: existing.groupType, isBreak: existing.isBreak, teacherId: newTeacherId ?? undefined, subject: input.subject },
    SUBJECTS,
  );
  if (newPlan.bind && newTeacherId && classId) {
    const warn = await bindRoutineGrant(newTeacherId, classId.toString(), existing.groupId.toString(), input.subject, input.actorId);
    if (warn) warnings.push(warn);
  }

  const slot = await RoutineSlot.findById(existing._id).lean();
  await onRoutineSlotChangedSync(slot as unknown as IRoutineSlot);
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
    await ScopeGrant.updateOne(
      { _id: existing._id },
      { $set: { active: true, classId: new Types.ObjectId(classId) } },
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

/** Delete a routine slot; revoke its routine grant only if no remaining slot
 *  justifies it (idempotent sync — manual grants are never touched, D-#49). */
export async function deleteRoutineSlot(slotId: string, actorId: string): Promise<void> {
  const slot = await RoutineSlot.findById(slotId).lean();
  if (!slot) throw new Error("Routine slot not found");
  await RoutineSlot.deleteOne({ _id: slotId });

  const plan = routineGrantPlan(
    { groupType: slot.groupType, isBreak: slot.isBreak, teacherId: slot.teacherId?.toString(), subject: slot.subject },
    SUBJECTS,
  );
  if (plan.bind && slot.teacherId) {
    await unbindIfOrphaned(slot.teacherId.toString(), slot.groupId.toString(), slot.subject, actorId);
  }

  // M-2 (D-#78): re-sync the affected SECTION + SUBJECT chat groups (the teacher
  // may now have dropped out of one). Best-effort — never blocks the delete.
  await onRoutineSlotChangedSync(slot);
}

/** Revoke the routine teaching grant for (teacher, section, subject) iff no other
 *  active routine section-slot still maps to it. */
async function unbindIfOrphaned(
  teacherId: string,
  sectionId: string,
  subjectCode: string,
  actorId: string,
): Promise<void> {
  const remaining = await RoutineSlot.findOne({
    groupType: "section",
    groupId: sectionId,
    teacherId,
    subject: subjectCode,
    active: true,
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
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: date } }],
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
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: date } }],
  })
    .sort({ periodNumber: 1 })
    .lean() as unknown as Promise<IRoutineSlot[]>;
}

// ---------------------------------------------------------------------------
// Subject-teacher ⇄ routine visibility + sync (D-#291)
// ---------------------------------------------------------------------------

/** LIVE (effective-now) section slots for a section, optionally one subject. */
async function liveSectionSlots(sectionId: string, subject?: string, now = new Date()) {
  const filter: Record<string, unknown> = {
    groupType: "section",
    groupId: sectionId,
    active: true,
    isBreak: false,
    effectiveFrom: { $lte: now },
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: now } }],
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
 */
export async function reassignRoutineSubjectTeacher(
  sectionId: string,
  subject: string,
  teacherId: string,
  actorId: string,
  now = new Date(),
): Promise<ReassignSubjectTeacherResult> {
  const slots = await liveSectionSlots(sectionId, subject, now);
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
    effectiveFrom: { $lte: now },
    $and: [
      { $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: now } }] },
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
