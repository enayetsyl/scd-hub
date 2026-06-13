import { Schema, model, Document, Types } from "mongoose";
import { LEAVE_TYPES, type LeaveType } from "@scd/shared";

/**
 * StaffLeaveEntitlement (HR-2; prd-hr §3.1) — the per-staff, per-academic-year
 * allowance for a balance-tracked leave type (casual/sick/bereavement). It is the
 * "allowance" half of the balance (allowance + carriedOver − taken = remaining);
 * `taken` is DERIVED from approved applications, never stored here.
 *
 * Numbers are PARKED (prd-hr §10): allowances are admin DATA (Principal/Office set
 * them per staff via `leave:manage`), NOT seeded constants — same posture as the
 * library policy's read-time defaults (D-#97), so no startup/bulk write runs against
 * the shared live Atlas. Per-role defaults + pro-ration are an admin assist
 * (LeaveEntitlementService helpers), not a hidden hardcoded grant.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IStaffLeaveEntitlement extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  academicYearId: Types.ObjectId;
  leaveType: LeaveType;
  /** Granted allowance for this year (days). Admin-set; pro-rated for mid-year joiners. */
  allowanceDays: number;
  /** Carried-over prior-year remaining (uncapped, §3.4). Admin-set / rolled forward. */
  carriedOverDays: number;
  note?: string;
  grantedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const StaffLeaveEntitlementSchema = new Schema<IStaffLeaveEntitlement>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    leaveType: { type: String, enum: LEAVE_TYPES, required: true },
    allowanceDays: { type: Number, required: true, min: 0, default: 0 },
    carriedOverDays: { type: Number, required: true, min: 0, default: 0 },
    note: { type: String, trim: true },
    grantedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// One entitlement row per (staff, year, type) — upsert key.
StaffLeaveEntitlementSchema.index(
  { staffProfileId: 1, academicYearId: 1, leaveType: 1 },
  { unique: true },
);

export const StaffLeaveEntitlement = model<IStaffLeaveEntitlement>(
  "StaffLeaveEntitlement",
  StaffLeaveEntitlementSchema,
);
