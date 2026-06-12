/**
 * RoutineCoverService (R-4) — substitution/cover assignment + the proxy-manage
 * availability view. A Section cover is backed by a time-bounded proxy ScopeGrant
 * (D-#20/#22, reusing assignProxy/revokeProxy); a Quran/Arabic group cover is just
 * recorded (no content scope). Availability ranking is pure (cover.ts).
 */
import { Types } from "mongoose";
import { DAYS_OF_WEEK } from "@scd/shared";
import { RoutineSlot } from "../models/RoutineSlot";
import { RoutineSubstitution, type IRoutineSubstitution } from "../models/RoutineSubstitution";
import { User } from "../../foundation/models/User";
import { assignProxy, revokeProxy } from "../../foundation/services/ScopeGrantService";
import { rankAvailability, type AvailabilityRow } from "../cover";
import { emitCoverAssigned } from "../../notifications/services/emitters";

/** Local-day bounds for date-range queries. */
function dayBounds(date: Date): { start: Date; end: Date } {
  const s = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const e = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return { start: s, end: e };
}

/** Active slots covering a date (effective window contains it) for its weekday. */
async function daySlots(date: Date): Promise<
  Array<{ _id: Types.ObjectId; teacherId?: Types.ObjectId; periodNumber: number }>
> {
  const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
  return RoutineSlot.find({
    dayOfWeek,
    active: true,
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: date } }],
  }).lean() as unknown as Array<{ _id: Types.ObjectId; teacherId?: Types.ObjectId; periodNumber: number }>;
}

/**
 * Teacher availability for an absence at (date, periodNumber) (R4.1): who is free
 * at that slot, and how many classes each already has that day. Free teachers
 * first, lightest-loaded next.
 */
export async function teacherAvailability(date: Date, periodNumber: number): Promise<AvailabilityRow[]> {
  const slots = await daySlots(date);

  // Load = substantive slots that day, per teacher.
  const loadMap: Record<string, number> = {};
  for (const s of slots) {
    if (!s.teacherId) continue;
    const id = s.teacherId.toString();
    loadMap[id] = (loadMap[id] ?? 0) + 1;
  }

  // Busy at the target period = substantive teacher there, plus any cover already
  // assigned there for this date.
  const busy = new Set<string>();
  for (const s of slots) {
    if (s.periodNumber === periodNumber && s.teacherId) busy.add(s.teacherId.toString());
  }
  const { start, end } = dayBounds(date);
  const slotPeriod = new Map(slots.map((s) => [s._id.toString(), s.periodNumber]));
  const subs = await RoutineSubstitution.find({ active: true, date: { $gte: start, $lte: end } }).lean();
  for (const su of subs) {
    const cover = su.coverTeacherId.toString();
    loadMap[cover] = (loadMap[cover] ?? 0) + 1; // a cover adds to that teacher's day load
    if (slotPeriod.get(su.slotId.toString()) === periodNumber) busy.add(cover);
  }

  const teachers = (await User.find({ role: "TEACHER", active: true }).select("_id name").lean()) as unknown as Array<{
    _id: Types.ObjectId;
    name: string;
  }>;
  return rankAvailability(
    teachers.map((t) => ({ id: t._id.toString(), name: t.name })),
    busy,
    loadMap,
  );
}

export interface AssignCoverInput {
  slotId: string;
  date: Date;
  coverTeacherId: string;
  reason?: string | null;
  durationDays?: number;
  actorId: string;
}

/** Assign a cover for a slot on a date (R4.2); back it with a proxy grant for a
 *  Section slot (content scope), record-only for a SubjectGroup slot. */
export async function assignCover(input: AssignCoverInput): Promise<IRoutineSubstitution> {
  const slot = await RoutineSlot.findById(input.slotId).lean();
  if (!slot) throw new Error("Routine slot not found");

  const sub = await RoutineSubstitution.create({
    slotId: new Types.ObjectId(input.slotId),
    date: input.date,
    coverTeacherId: new Types.ObjectId(input.coverTeacherId),
    absentTeacherId: slot.teacherId,
    reason: input.reason ?? undefined,
    createdBy: new Types.ObjectId(input.actorId),
  });

  if (slot.groupType === "section" && slot.classId) {
    const grantId = await assignProxy({
      coveringTeacherId: input.coverTeacherId,
      absentTeacherId: slot.teacherId ? slot.teacherId.toString() : undefined,
      classId: slot.classId.toString(),
      sectionId: slot.groupId.toString(),
      startDate: input.date,
      durationDays: input.durationDays && input.durationDays > 0 ? input.durationDays : 1,
      assignedBy: input.actorId,
    });
    await RoutineSubstitution.updateOne({ _id: sub._id }, { $set: { proxyGrantId: new Types.ObjectId(grantId) } });
  }

  // N1.6: tell the covering teacher. Best-effort — never blocks the assignment
  // (D-#72). Cancel emits nothing (the cover list is the truth).
  await emitCoverAssigned({
    _id: sub._id,
    slotId: sub.slotId,
    date: sub.date,
    coverTeacherId: sub.coverTeacherId,
  });

  return sub;
}

/** Cancel a cover (R4.3): deactivate the substitution + revoke its proxy grant. */
export async function cancelCover(subId: string, actorId: string): Promise<void> {
  const sub = await RoutineSubstitution.findById(subId).lean();
  if (!sub) throw new Error("Substitution not found");
  await RoutineSubstitution.updateOne({ _id: subId }, { $set: { active: false } });
  if (sub.proxyGrantId) await revokeProxy(sub.proxyGrantId.toString(), actorId);
}

/** Active covers on a date (R4.1/R4.4 list). */
export async function coversForDate(date: Date): Promise<IRoutineSubstitution[]> {
  const { start, end } = dayBounds(date);
  return RoutineSubstitution.find({ active: true, date: { $gte: start, $lte: end } })
    .sort({ createdAt: 1 })
    .lean() as unknown as IRoutineSubstitution[];
}
