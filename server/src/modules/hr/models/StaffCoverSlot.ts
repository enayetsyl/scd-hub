import { Schema, model, Document, Types } from "mongoose";
import { COVER_SLOT_STATUSES, type CoverSlotStatus } from "@scd/shared";

/**
 * StaffCoverSlot (HR-2; prd-hr §3.5, D-#20/#22 — per-meeting redesign PXG-1, D-#268
 * deviation) — the seam to the proxy system. A leave fans out ONE slot per actual
 * (date, period) class meeting the absent teacher teaches during the leave span
 * (derived from RoutineSlot.teacherId, not from ScopeGrant — routine is the accurate
 * per-meeting source; ScopeGrant has no day/period data). Each slot independently
 * names a covering teacher; the slot is a PROPOSAL until Principal/Office approve it
 * — only then does CoverService mint a D-#20 proxy grant SCOPED TO THAT ONE DATE
 * (write access begins) and store its `proxyGrantId` here. Cancelling/rejecting the
 * leave revokes those grants.
 *
 * DEVIATION FROM prd-hr §8 / prd-proxy-cover-ux.md §6 (deliberate, user-directed,
 * PXG-1 build session): the original grant model minted ONE grant spanning the whole
 * leave per (section, subject). This redesign mints one grant PER MEETING INSTANCE
 * instead, so a different colleague can genuinely cover a Tuesday differently than a
 * Thursday. `groupType: "subjectgroup"` routine slots (cross-section combined groups)
 * have no single section to fan a slot to — excluded from fan-out for this build.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IStaffCoverSlot extends Document {
  _id: Types.ObjectId;
  leaveApplicationId: Types.ObjectId;
  /** The covered class/section + subject (from the matching RoutineSlot). */
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  subjectId?: Types.ObjectId | null;
  /** The absent teacher's User id (proxy `absentTeacherId`). */
  absentTeacherUserId?: Types.ObjectId | null;
  /** The specific class meeting this slot covers (PXG-1 — one slot per instance). */
  dateKey: string;
  periodNumber: number;
  /** The RoutineSlot this instance was fanned out from (traceability + re-fanout guard). */
  routineSlotId: Types.ObjectId;
  /** Proposed covering teacher (User id); null while the slot still needs cover. */
  proposedCoverTeacherId?: Types.ObjectId | null;
  /** The teacher who ACTUALLY ends up covering (proposer's pick, or an admin override) —
   *  set on approval; distinct from `proposedCoverTeacherId`, which stays the historical
   *  proposal even when an override picks someone else. */
  finalCoverTeacherUserId?: Types.ObjectId | null;
  status: CoverSlotStatus;
  /** Set when status flips to `approved` — the live D-#20 proxy grant backing it. */
  proxyGrantId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const StaffCoverSlotSchema = new Schema<IStaffCoverSlot>(
  {
    leaveApplicationId: { type: Schema.Types.ObjectId, ref: "StaffLeaveApplication", required: true },
    classId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    subjectId: { type: Schema.Types.ObjectId, default: null },
    absentTeacherUserId: { type: Schema.Types.ObjectId, default: null },
    dateKey: { type: String, required: true },
    periodNumber: { type: Number, required: true },
    routineSlotId: { type: Schema.Types.ObjectId, ref: "RoutineSlot", required: true },
    proposedCoverTeacherId: { type: Schema.Types.ObjectId, default: null },
    finalCoverTeacherUserId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: COVER_SLOT_STATUSES, required: true, default: "needs_cover" },
    proxyGrantId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

StaffCoverSlotSchema.index({ leaveApplicationId: 1 });
StaffCoverSlotSchema.index({ leaveApplicationId: 1, routineSlotId: 1, dateKey: 1 }, { unique: true });
StaffCoverSlotSchema.index({ status: 1, dateKey: 1 });

export const StaffCoverSlot = model<IStaffCoverSlot>("StaffCoverSlot", StaffCoverSlotSchema);
