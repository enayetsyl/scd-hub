import { Schema, model, Document, Types } from "mongoose";
import { COVER_SLOT_STATUSES, type CoverSlotStatus } from "@scd/shared";

/**
 * StaffCoverSlot (HR-2; prd-hr §3.5, D-#20/#22) — the seam to the proxy system.
 * A leave fans out ONE slot per class/section the absent teacher teaches (derived
 * from their active teaching ScopeGrants). Each slot independently names a covering
 * teacher; the slot is a PROPOSAL until Principal/Office approve it — only then does
 * CoverService mint the D-#20 proxy grant (write access begins) and store its
 * `proxyGrantId` here. Cancelling/rejecting the leave revokes those grants.
 *
 * The grant model is UNCHANGED (prd-hr §8): N classes → N grants via the existing
 * assignProxy/revokeProxy. teacherIds here are `User` ids (the proxy/grant key),
 * resolved from StaffProfiles via the phone link (staffMatch).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IStaffCoverSlot extends Document {
  _id: Types.ObjectId;
  leaveApplicationId: Types.ObjectId;
  /** The covered class/section + subject (from the absent teacher's teaching grant). */
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  subjectId?: Types.ObjectId | null;
  /** The absent teacher's User id (proxy `absentTeacherId`). */
  absentTeacherUserId?: Types.ObjectId | null;
  /** Proposed covering teacher (User id); null while the slot still needs cover. */
  proposedCoverTeacherId?: Types.ObjectId | null;
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
    proposedCoverTeacherId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: COVER_SLOT_STATUSES, required: true, default: "needs_cover" },
    proxyGrantId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

StaffCoverSlotSchema.index({ leaveApplicationId: 1 });

export const StaffCoverSlot = model<IStaffCoverSlot>("StaffCoverSlot", StaffCoverSlotSchema);
