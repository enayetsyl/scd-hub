import { Schema, model, Document, Types } from "mongoose";
import { LEAVE_TYPES, LEAVE_STATUSES, type LeaveType, type LeaveStatus } from "@scd/shared";

/**
 * StaffLeaveApplication (HR-2; prd-hr §3, H2) — the PARENT leave record (D-#22):
 * applicant (StaffProfile, so support staff with no login are covered too, D-#25),
 * type, [fromKey, toKey], reason, status. It fans out one StaffCoverSlot per class
 * the absent teacher teaches (CoverService) and, when an approved application's ✘
 * appears in the biometric import, drives the LEAVE-vs-ABSENT split (the seam AT-1
 * left open) via a read-time overlay.
 *
 * The exceed rule WARNS, never blocks (§3.3): on approval the days over the balance
 * are recorded as `unpaidDays` (LWP); `paidDays` draw the entitlement. Maternity/
 * Hajj are wholly unpaid (D-#23, §3.2).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IStaffLeaveApplication extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  /** Academic year this leave is counted against (resolved from fromKey); null when
   *  no year covers the date (balance then treated as 0 / fully unpaid). */
  academicYearId?: Types.ObjectId | null;
  leaveType: LeaveType;
  fromKey: string; // YYYY-MM-DD inclusive
  toKey: string;   // YYYY-MM-DD inclusive
  /** Inclusive calendar-day span (derived at apply time, stored for balance math). */
  days: number;
  reason: string;
  status: LeaveStatus;
  /** Split stamped at approval (paid draws balance; unpaid = LWP overflow / unpaid type). */
  paidDays?: number;
  unpaidDays?: number;
  /** Warning surfaced when the application exceeds the remaining balance (§3.3). */
  exceedWarning?: string | null;
  appliedBy: Types.ObjectId;   // the actor who recorded it (self or Office on behalf)
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  decisionNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StaffLeaveApplicationSchema = new Schema<IStaffLeaveApplication>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", default: null },
    leaveType: { type: String, enum: LEAVE_TYPES, required: true },
    fromKey: { type: String, required: true },
    toKey: { type: String, required: true },
    days: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: LEAVE_STATUSES, required: true, default: "applied" },
    paidDays: { type: Number, min: 0 },
    unpaidDays: { type: Number, min: 0 },
    exceedWarning: { type: String, default: null },
    appliedBy: { type: Schema.Types.ObjectId, required: true },
    decidedBy: { type: Schema.Types.ObjectId },
    decidedAt: { type: Date },
    decisionNote: { type: String, trim: true },
  },
  { timestamps: true },
);

StaffLeaveApplicationSchema.index({ staffProfileId: 1, fromKey: -1 });
StaffLeaveApplicationSchema.index({ status: 1, fromKey: -1 });

export const StaffLeaveApplication = model<IStaffLeaveApplication>(
  "StaffLeaveApplication",
  StaffLeaveApplicationSchema,
);
