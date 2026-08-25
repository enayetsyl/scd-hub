import { Schema, model, Document, Types } from "mongoose";
import {
  LEAVE_TYPES,
  LEAVE_STATUSES,
  LEAVE_DAY_PARTS,
  type LeaveType,
  type LeaveStatus,
  type LeaveDayPart,
} from "@scd/shared";

/**
 * StaffLeaveApplication (HR-2; prd-hr §3, H2) — the PARENT leave record (D-#22):
 * applicant (StaffProfile, so support staff with no login are covered too, D-#25),
 * type, [fromKey, toKey], reason, status. It fans out one StaffCoverSlot per class
 * the absent teacher teaches (CoverService) and, when an approved application's ✘
 * appears in the biometric import, drives the LEAVE-vs-ABSENT split (the seam AT-1
 * left open) via a read-time overlay.
 *
 * A leave is whole-day by default; D-#361 adds the SINGLE-DATE partial day (`dayPart`
 * late_entry / early_leave + a period count) for the common "I'll miss the first two
 * periods" case — it fans out cover slots for only those periods and costs 1/3 of a day.
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
  /**
   * Which part of the day this leave covers (D-#361). `full` (the default, and what
   * every pre-D-#361 row reads as) is the original whole-day leave. `late_entry` /
   * `early_leave` are SINGLE-DATE partial leaves: the staff member misses only the
   * first / last `partialPeriodCount` periods, so only THOSE class meetings fan out
   * cover slots and the day costs PARTIAL_DAY_FRACTION (1/3) of the balance.
   */
  dayPart: LeaveDayPart;
  /** How many periods the partial-day leave spans (null for a full-day leave). */
  partialPeriodCount?: number | null;
  /**
   * The period numbers actually missed — RESOLVED at apply time from the staff
   * member's own routine for that date (their last teaching period anchors an
   * `early_leave` window) and STORED, so every downstream read (cover fan-out,
   * "can this teacher cover?", the app's card) is an exact list lookup rather than a
   * re-derivation against a routine that may have changed since. Empty for `full`.
   */
  partialPeriods: number[];
  /** Day span for balance math: the inclusive calendar-day count for a full-day leave,
   *  or the exact 1/3 fraction for a partial day (D-#361). */
  days: number;
  reason: string;
  status: LeaveStatus;
  /** Split stamped at approval (paid draws balance; unpaid = LWP overflow / unpaid type). */
  paidDays?: number;
  unpaidDays?: number;
  /**
   * SH-3 / D-#540 — these `unpaidDays` are HELD as probation debt, NOT payable now.
   *
   * Without this flag the rule contradicts itself: probation leave is unpaid, and
   * `PayrollService.unpaidLeaveDaysByStaff` deducts day-rate × `unpaidDays` for every
   * approved leave in the month — so "recorded as unpaid, adjusted at confirmation or
   * on the final salary" would have become "docked this month" too, charging the same
   * days twice. Payroll excludes these rows; the `ProbationLeaveDebt` ledger is what
   * eventually collects them, once, at confirmation or exit.
   */
  probationHeld?: boolean;
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
    dayPart: { type: String, enum: LEAVE_DAY_PARTS, required: true, default: "full" },
    partialPeriodCount: { type: Number, default: null, min: 1 },
    partialPeriods: { type: [Number], default: [] },
    // min 0, not 1: a partial day is 1/3 (D-#361).
    days: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true },
    status: { type: String, enum: LEAVE_STATUSES, required: true, default: "applied" },
    paidDays: { type: Number, min: 0 },
    unpaidDays: { type: Number, min: 0 },
    // Absent reads as false — every pre-SH-3 row is payable-as-usual, no migration.
    probationHeld: { type: Boolean, default: false },
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
