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
import { ScopeGrant } from "../../foundation/models/ScopeGrant";
import { writeAudit } from "../../platform/services/AuditService";
import { weekdayBaseDayType, dayTypeAdmitsTrack } from "../calendar";
import { detectConflicts, type SlotLite } from "../conflicts";
import { routineGrantPlan } from "../binding";

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
  return { slot, warnings };
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

/** Resolve the effective slots for a group on a date (R2.7) — slots whose
 *  `[effectiveFrom, effectiveTo)` window contains the date, ordered by period —
 *  with any active cover for that date overlaid (R4.4). */
export async function routineForDate(
  groupType: "section" | "subjectgroup",
  groupId: string,
  date: Date,
): Promise<ResolvedSlot[]> {
  const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
  const slots = (await RoutineSlot.find({
    groupType,
    groupId,
    dayOfWeek,
    active: true,
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: date } }],
  })
    .sort({ periodNumber: 1 })
    .lean()) as unknown as IRoutineSlot[];

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
