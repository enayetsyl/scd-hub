/**
 * CoverService (HR-2; prd-hr §3.5, D-#20/#22 — per-meeting redesign PXG-1/D-#268) —
 * the leave→proxy seam.
 *
 * A leave fans out ONE cover slot per actual (date, period) class meeting the absent
 * teacher teaches during the leave span, derived from `RoutineSlot.teacherId` (the
 * routine IS the accurate per-meeting source — `ScopeGrant` has no day/period data,
 * so the old section+subject-for-the-whole-leave fan-out couldn't distinguish a
 * Sunday meeting from a Tuesday one). Each slot is a PROPOSAL: a covering teacher is
 * proposed (or an admin overrides/direct-assigns), but write access begins ONLY when
 * Principal/Office APPROVE the slot (D-#22/#268). On approval the slot mints a D-#20
 * proxy grant scoped to JUST that one date (assignProxy, durationDays: 1 — a
 * deliberate deviation from the original whole-leave-span grant, per the PXG-1 build
 * ruling); cancelling/rejecting the leave revokes every live grant across all slots.
 *
 * Identity/operational plane; the corpus-plane boundary still overrides (ADR-005).
 */
import { Types } from "mongoose";
import { StaffCoverSlot, type IStaffCoverSlot } from "../models/StaffCoverSlot";
import { StaffLeaveApplication } from "../models/StaffLeaveApplication";
import { Subject } from "../../foundation/models/Subject";
import { User } from "../../foundation/models/User";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { assignProxy, revokeProxy } from "../../foundation/services/ScopeGrantService";
import { slotsForTeacherOnDate } from "../../routine/services/RoutineSlotService";
import { resolveDayType } from "../../routine/calendar";
import { resolveUserIdForStaff } from "./staffMatch";
import { parseDateKey, datesInRange, LeaveError } from "./dates";
import { writeAudit } from "../../platform/services/AuditService";
import { emitHrCoverAssigned } from "../../notifications/services/emitters";

/** Fan out one needs-cover slot per actual class meeting (date × period) the absent
 *  staff teaches during the leave span. No-op (zero slots) when the staff has no
 *  login/routine slots (support staff don't teach). `subjectgroup` routine slots
 *  (cross-section combined groups) are excluded — no single section to fan to. */
export async function fanOutCoverSlots(
  leaveApplicationId: string,
  absentStaffProfileId: string,
): Promise<IStaffCoverSlot[]> {
  const absentUserId = await resolveUserIdForStaff(absentStaffProfileId);
  if (!absentUserId) return [];

  const leave = await StaffLeaveApplication.findById(leaveApplicationId).lean();
  if (!leave) return [];

  const created: IStaffCoverSlot[] = [];
  for (const { date, dateKey } of datesInRange(leave.fromKey, leave.toKey)) {
    const dayType = await resolveDayType(date);
    if (dayType === "OFF" || dayType === "HOLIDAY") continue;

    const daySlots = await slotsForTeacherOnDate(absentUserId, date);
    for (const rs of daySlots) {
      if (rs.isBreak || !rs.classId) continue;
      const exists = await StaffCoverSlot.findOne({
        leaveApplicationId: new Types.ObjectId(leaveApplicationId),
        routineSlotId: rs._id,
        dateKey,
      })
        .select("_id")
        .lean();
      if (exists) continue;

      // A cover is per-subject (D-#257): resolve the meeting's subject code to a
      // Subject doc when one exists (content subjects only; others resolve to none).
      const subj = await Subject.findOne({ code: rs.subject }).select("_id").lean();
      const slot = await StaffCoverSlot.create({
        leaveApplicationId: new Types.ObjectId(leaveApplicationId),
        classId: rs.classId,
        sectionId: rs.groupId,
        subjectId: subj ? subj._id : null,
        absentTeacherUserId: new Types.ObjectId(absentUserId),
        dateKey,
        periodNumber: rs.periodNumber,
        routineSlotId: rs._id,
        status: "needs_cover",
      });
      created.push(slot);
    }
  }
  return created;
}

/** Propose a covering teacher for a slot (the legwork — D-#22). Does NOT grant
 *  write access; the slot moves to `proposed` and awaits approval. */
export async function proposeCover(
  slotId: string,
  coverTeacherUserId: string,
  actorId: string,
): Promise<IStaffCoverSlot> {
  const slot = await StaffCoverSlot.findById(slotId);
  if (!slot) throw new LeaveError("Cover slot not found");
  if (slot.status === "approved") throw new LeaveError("Slot already approved — revoke before re-proposing");
  slot.proposedCoverTeacherId = new Types.ObjectId(coverTeacherUserId);
  slot.status = "proposed";
  await slot.save();
  await writeAudit({
    eventKind: "STAFF_COVER_PROPOSED",
    actorId,
    targetId: slot._id,
    targetKind: "StaffCoverSlot",
    meta: { coverTeacherUserId, sectionId: slot.sectionId.toString() },
  });
  return slot;
}

/**
 * Approve a proposed (or needs-cover, via override) slot → mint a D-#20 proxy grant
 * scoped to just that one meeting date (write access begins), or reject it → back
 * to needs_cover (revoking any prior grant). Principal/Office only (gated at the
 * resolver).
 *
 * `overrideCoverTeacherUserId` (PXG-1, D-#268) is additive: omitted, this is
 * byte-identical to the original approve-the-proposal behavior. Supplied, it mints
 * for the OVERRIDE teacher instead of the proposer's pick (recording both — the slot
 * keeps `proposedCoverTeacherId` as the historical proposal and sets
 * `finalCoverTeacherUserId` to who actually ends up covering) — and it also lets an
 * admin approve a slot with NO proposal at all (direct-assign from the needs-cover
 * inbox).
 */
export async function decideCoverSlot(
  slotId: string,
  approve: boolean,
  actorId: string,
  overrideCoverTeacherUserId?: string,
): Promise<IStaffCoverSlot> {
  const slot = await StaffCoverSlot.findById(slotId);
  if (!slot) throw new LeaveError("Cover slot not found");

  if (!approve) {
    if (slot.proxyGrantId) await revokeProxy(slot.proxyGrantId.toString(), actorId);
    slot.proxyGrantId = null;
    slot.status = "needs_cover";
    await slot.save();
    await writeAudit({
      eventKind: "STAFF_COVER_DECIDED",
      actorId, targetId: slot._id, targetKind: "StaffCoverSlot",
      meta: { decision: "rejected", sectionId: slot.sectionId.toString() },
    });
    return slot;
  }

  const finalTeacherId =
    overrideCoverTeacherUserId ?? (slot.proposedCoverTeacherId ? slot.proposedCoverTeacherId.toString() : undefined);
  if (!finalTeacherId) {
    throw new LeaveError(
      "Propose a covering teacher, or assign someone directly, before approving the slot (D-#22/D-#268)",
    );
  }
  // Re-approving/re-overriding an already-approved slot is out of scope this build
  // (D-#268) — reject-then-reassign is the existing path for swapping an approved cover.
  if (slot.status === "approved") return slot;

  // A teacher can only physically be in one place at a given (date, period) — reject
  // approving this slot for them if they already hold an approved cover at the exact
  // same meeting elsewhere (found live-testing: nothing previously stopped the same
  // teacher being double-booked across two different absent teachers' same-period
  // slots). Own-teaching-vs-cover conflicts stay advisory-only via teacherAvailability
  // (unchanged, pre-existing design) — this guard is scoped to cover-vs-cover only.
  const conflict = await StaffCoverSlot.findOne({
    _id: { $ne: slot._id },
    finalCoverTeacherUserId: new Types.ObjectId(finalTeacherId),
    dateKey: slot.dateKey,
    periodNumber: slot.periodNumber,
    status: "approved",
  })
    .select("_id")
    .lean();
  if (conflict) {
    throw new LeaveError(
      `This teacher already covers another class at ${slot.dateKey} period ${slot.periodNumber} — pick someone else or reject that cover first`,
    );
  }

  const grantId = await assignProxy({
    coveringTeacherId: finalTeacherId,
    absentTeacherId: slot.absentTeacherUserId ? slot.absentTeacherUserId.toString() : undefined,
    classId: slot.classId.toString(),
    sectionId: slot.sectionId.toString(),
    subjectId: slot.subjectId ? slot.subjectId.toString() : undefined,
    startDate: parseDateKey(slot.dateKey),
    durationDays: 1,
    assignedBy: actorId,
  });
  slot.proxyGrantId = new Types.ObjectId(grantId);
  slot.finalCoverTeacherUserId = new Types.ObjectId(finalTeacherId);
  slot.status = "approved";
  await slot.save();
  await writeAudit({
    eventKind: "STAFF_COVER_DECIDED",
    actorId, targetId: slot._id, targetKind: "StaffCoverSlot",
    meta: {
      decision: "approved",
      proxyGrantId: grantId,
      sectionId: slot.sectionId.toString(),
      override: !!overrideCoverTeacherUserId,
      proposedCoverTeacherId: slot.proposedCoverTeacherId ? slot.proposedCoverTeacherId.toString() : null,
      finalCoverTeacherUserId: finalTeacherId,
    },
  });
  await emitHrCoverAssigned({
    slotId: slot._id.toString(),
    grantId,
    coverTeacherUserId: finalTeacherId,
    dateKey: slot.dateKey,
  });
  return slot;
}

/** Revoke all live proxy grants backing a leave's cover slots (on cancel/reject). */
export async function revokeCoversForLeave(leaveApplicationId: string, actorId: string): Promise<number> {
  const slots = await StaffCoverSlot.find({
    leaveApplicationId: new Types.ObjectId(leaveApplicationId),
    status: "approved",
  });
  let revoked = 0;
  for (const slot of slots) {
    if (slot.proxyGrantId) {
      await revokeProxy(slot.proxyGrantId.toString(), actorId);
      revoked++;
    }
    slot.proxyGrantId = null;
    slot.status = "needs_cover";
    await slot.save();
  }
  return revoked;
}

export async function coverSlotsForLeave(leaveApplicationId: string): Promise<IStaffCoverSlot[]> {
  return StaffCoverSlot.find({ leaveApplicationId: new Types.ObjectId(leaveApplicationId) })
    .sort({ createdAt: 1 })
    .lean() as unknown as Promise<IStaffCoverSlot[]>;
}

/** A cross-leave needs-cover row (PXG-1) — one per uncovered class meeting, with
 *  display labels resolved server-side (the inbox has no single academicYearId
 *  anchor to join names client-side the way a single-leave screen does). */
export interface NeedsCoverRow {
  slotId: string;
  leaveApplicationId: string;
  absentTeacherUserId: string | null;
  absentTeacherName: string | null;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  subjectId: string | null;
  subjectName: string | null;
  dateKey: string;
  periodNumber: number;
}

/** Every uncovered class meeting (status `needs_cover` — covers both "never
 *  proposed" and "rejected-back", since decideCoverSlot's reject branch already
 *  flips a slot back to this status) belonging to an APPROVED leave overlapping
 *  [from, to]. Same gate as decideStaffCoverSlot today (leave:manage). */
export async function needsCoverSlots(fromKey: string, toKey: string): Promise<NeedsCoverRow[]> {
  const leaves = await StaffLeaveApplication.find({
    status: "approved",
    fromKey: { $lte: toKey },
    toKey: { $gte: fromKey },
  })
    .select("_id")
    .lean();
  const leaveIds = leaves.map((l) => l._id);
  if (leaveIds.length === 0) return [];

  const slots = await StaffCoverSlot.find({ leaveApplicationId: { $in: leaveIds }, status: "needs_cover" })
    .sort({ dateKey: 1, periodNumber: 1 })
    .lean();
  if (slots.length === 0) return [];

  const teacherIds = [...new Set(slots.map((s) => s.absentTeacherUserId?.toString()).filter((id): id is string => !!id))];
  const classIds = [...new Set(slots.map((s) => s.classId.toString()))];
  const sectionIds = [...new Set(slots.map((s) => s.sectionId.toString()))];
  const subjectIds = [...new Set(slots.map((s) => s.subjectId?.toString()).filter((id): id is string => !!id))];

  const [teachers, classes, sections, subjects] = await Promise.all([
    User.find({ _id: { $in: teacherIds } }).select("name").lean(),
    Class.find({ _id: { $in: classIds } }).select("nameBn").lean(),
    Section.find({ _id: { $in: sectionIds } }).select("nameBn").lean(),
    Subject.find({ _id: { $in: subjectIds } }).select("nameBn").lean(),
  ]);
  const teacherName = new Map(teachers.map((t) => [t._id.toString(), t.name]));
  const className = new Map(classes.map((c) => [c._id.toString(), c.nameBn]));
  const sectionName = new Map(sections.map((s) => [s._id.toString(), s.nameBn]));
  const subjectName = new Map(subjects.map((s) => [s._id.toString(), s.nameBn]));

  return slots.map((s) => ({
    slotId: s._id.toString(),
    leaveApplicationId: s.leaveApplicationId.toString(),
    absentTeacherUserId: s.absentTeacherUserId ? s.absentTeacherUserId.toString() : null,
    absentTeacherName: s.absentTeacherUserId ? teacherName.get(s.absentTeacherUserId.toString()) ?? null : null,
    classId: s.classId.toString(),
    className: className.get(s.classId.toString()) ?? "?",
    sectionId: s.sectionId.toString(),
    sectionName: sectionName.get(s.sectionId.toString()) ?? "?",
    subjectId: s.subjectId ? s.subjectId.toString() : null,
    subjectName: s.subjectId ? subjectName.get(s.subjectId.toString()) ?? null : null,
    dateKey: s.dateKey,
    periodNumber: s.periodNumber,
  }));
}
