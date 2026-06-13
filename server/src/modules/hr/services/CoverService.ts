/**
 * CoverService (HR-2; prd-hr §3.5, D-#20/#22) — the leave→proxy seam.
 *
 * A leave fans out ONE cover slot per class/section the absent teacher teaches
 * (from their active teaching ScopeGrants — the same "who teaches what" source the
 * routine binds, D-#49). Each slot is a PROPOSAL: a covering teacher is proposed,
 * but write access begins ONLY when Principal/Office APPROVE the slot (D-#22). On
 * approval the slot mints a D-#20 proxy grant (assignProxy, model unchanged — N
 * classes → N grants); cancelling/rejecting the leave revokes those grants.
 *
 * Identity/operational plane; the corpus-plane boundary still overrides (ADR-005).
 */
import { Types } from "mongoose";
import { StaffCoverSlot, type IStaffCoverSlot } from "../models/StaffCoverSlot";
import { StaffLeaveApplication } from "../models/StaffLeaveApplication";
import { ScopeGrant } from "../../foundation/models/ScopeGrant";
import { assignProxy, revokeProxy } from "../../foundation/services/ScopeGrantService";
import { resolveUserIdForStaff } from "./staffMatch";
import { parseDateKey, LeaveError } from "./dates";
import { writeAudit } from "../../platform/services/AuditService";

/** Fan out one needs-cover slot per class the absent staff teaches. No-op (zero
 *  slots) when the staff has no login/teaching grants (support staff don't teach). */
export async function fanOutCoverSlots(
  leaveApplicationId: string,
  absentStaffProfileId: string,
): Promise<IStaffCoverSlot[]> {
  const absentUserId = await resolveUserIdForStaff(absentStaffProfileId);
  if (!absentUserId) return [];

  // The teaching variant carries classId/sectionId/subjectId; the discriminated
  // union hides them, so read through a narrow shape (the composeTeacherScope idiom).
  const grants = (await ScopeGrant.find({
    teacherId: new Types.ObjectId(absentUserId),
    kind: "teaching",
    active: true,
  })
    .select("classId sectionId subjectId")
    .lean()) as Array<{ classId?: Types.ObjectId; sectionId?: Types.ObjectId; subjectId?: Types.ObjectId }>;

  // Dedupe by section+subject so two grants for the same cell make one slot.
  const seen = new Set<string>();
  const created: IStaffCoverSlot[] = [];
  for (const g of grants) {
    if (!g.classId || !g.sectionId) continue;
    const key = `${g.sectionId.toString()}:${g.subjectId?.toString() ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const slot = await StaffCoverSlot.create({
      leaveApplicationId: new Types.ObjectId(leaveApplicationId),
      classId: g.classId,
      sectionId: g.sectionId,
      subjectId: g.subjectId ?? null,
      absentTeacherUserId: new Types.ObjectId(absentUserId),
      status: "needs_cover",
    });
    created.push(slot);
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
 * Approve a proposed slot → mint the D-#20 proxy grant (write access begins), or
 * reject it → back to needs_cover (revoking any prior grant). Principal/Office only
 * (gated at the resolver). The grant window = the leave's [fromKey, fromKey+days).
 */
export async function decideCoverSlot(
  slotId: string,
  approve: boolean,
  actorId: string,
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

  if (!slot.proposedCoverTeacherId) {
    throw new LeaveError("Propose a covering teacher before approving the slot (D-#22)");
  }
  if (slot.status === "approved") return slot; // idempotent

  const leave = await StaffLeaveApplication.findById(slot.leaveApplicationId).lean();
  if (!leave) throw new LeaveError("Parent leave application not found");

  const grantId = await assignProxy({
    coveringTeacherId: slot.proposedCoverTeacherId.toString(),
    absentTeacherId: slot.absentTeacherUserId ? slot.absentTeacherUserId.toString() : undefined,
    classId: slot.classId.toString(),
    sectionId: slot.sectionId.toString(),
    startDate: parseDateKey(leave.fromKey),
    durationDays: leave.days,
    assignedBy: actorId,
  });
  slot.proxyGrantId = new Types.ObjectId(grantId);
  slot.status = "approved";
  await slot.save();
  await writeAudit({
    eventKind: "STAFF_COVER_DECIDED",
    actorId, targetId: slot._id, targetKind: "StaffCoverSlot",
    meta: { decision: "approved", proxyGrantId: grantId, sectionId: slot.sectionId.toString() },
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
