/**
 * StaffLeaveService (HR-2; prd-hr §3, H2) — the leave lifecycle + the seam the
 * biometric importer left open.
 *
 *   applyForLeave  — record a leave (self or Office on behalf), resolve its academic
 *                    year, fan out cover slots (CoverService). Status `applied`. A
 *                    D-#361 partial day (late entry / early leave, single date) fans
 *                    out only its missed periods and costs 1/3 of a day.
 *   decideLeave    — Principal/Office approve/reject/cancel. Approve stamps the
 *                    paid/unpaid split: paid days draw the balance, the excess is
 *                    unpaid (LWP) and only WARNS (§3.3 — never blocks). Cancel/reject
 *                    revoke any live cover proxy grants.
 *   approvedLeaveCovers / loadApprovedLeaves — the read-time overlay the attendance
 *                    module uses to flip a biometric ✘ from ABSENT → LEAVE (the AT-1
 *                    seam; data-driven, correct even when leave is approved AFTER the
 *                    snapshot import).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import {
  LEAVE_TYPES,
  LEAVE_TYPE_RULES,
  LEAVE_DAY_PARTS,
  PARTIAL_DAY_FRACTION,
  type LeaveType,
  type LeaveDayPart,
} from "@scd/shared";
import { StaffLeaveApplication, type IStaffLeaveApplication } from "../models/StaffLeaveApplication";
import { StaffLeaveEntitlement } from "../models/StaffLeaveEntitlement";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { writeAudit } from "../../platform/services/AuditService";
import { countLeaveDays, parseDateKey, rangeCovers, roundLeaveDays, LeaveError } from "./dates";
import { computeRemaining, takenPaidDays } from "./LeaveEntitlementService";
import { fanOutCoverSlots, revokeCoversForLeave, resolvePartialPeriods } from "./CoverService";

// --- pure split math -------------------------------------------------------

export interface LeaveSplit {
  paidDays: number;
  unpaidDays: number;
  exceedWarning: string | null;
}

/** The §3.2/§3.3 paid/unpaid split. Unpaid/event-capped types are wholly unpaid
 *  (maternity D-#23, hajj, LWP). Balance-tracked paid types draw the remaining
 *  balance; any excess is unpaid (LWP) and only WARNS. */
export function splitLeaveDays(leaveType: LeaveType, days: number, remainingBalance: number): LeaveSplit {
  const rules = LEAVE_TYPE_RULES[leaveType];
  if (!rules.paid || !rules.balanceTracked) {
    return { paidDays: 0, unpaidDays: days, exceedWarning: null };
  }
  const paidDays = Math.max(0, Math.min(days, remainingBalance));
  const unpaidDays = days - paidDays;
  const exceedWarning =
    unpaidDays > 0
      ? `Exceeds ${leaveType} balance by ${roundLeaveDays(unpaidDays)} day(s) — recorded as unpaid (LWP). (§3.3)`
      : null;
  return { paidDays, unpaidDays, exceedWarning };
}

// --- academic-year resolution ----------------------------------------------

/** The AcademicYear whose [startDate, endDate] covers a date key, else the current
 *  year, else null (balance then treated as 0 — fully unpaid). */
export async function resolveAcademicYearId(dateKey: string): Promise<Types.ObjectId | null> {
  const d = parseDateKey(dateKey);
  const covering = await AcademicYear.findOne({ startDate: { $lte: d }, endDate: { $gte: d } })
    .select("_id")
    .lean();
  if (covering) return covering._id;
  const current = await AcademicYear.findOne({ current: true }).select("_id").lean();
  return current ? current._id : null;
}

// --- apply -----------------------------------------------------------------

export interface ApplyLeaveInput {
  staffProfileId: string;
  leaveType: LeaveType;
  fromKey: string;
  toKey: string;
  reason: string;
  actorId: string;
  /** D-#361 — omit (or "full") for the original whole-day leave. */
  dayPart?: LeaveDayPart;
  /** D-#361 — how many periods a partial day spans; required when dayPart is partial. */
  partialPeriodCount?: number;
}

export async function applyForLeave(input: ApplyLeaveInput): Promise<IStaffLeaveApplication> {
  if (!LEAVE_TYPES.includes(input.leaveType)) throw new LeaveError(`Unknown leave type: ${input.leaveType}`);
  if (!input.reason.trim()) throw new LeaveError("A reason is required");
  const spanDays = countLeaveDays(input.fromKey, input.toKey); // validates keys + ordering

  // --- D-#361 partial day ---------------------------------------------------
  const dayPart: LeaveDayPart = input.dayPart ?? "full";
  if (!LEAVE_DAY_PARTS.includes(dayPart)) throw new LeaveError(`Unknown leave day part: ${dayPart}`);
  if (dayPart !== "full" && input.fromKey !== input.toKey) {
    throw new LeaveError("A late-entry / early-leave application covers ONE date — apply per day (D-#361)");
  }
  const partialPeriodCount = dayPart === "full" ? null : input.partialPeriodCount ?? 0;
  if (partialPeriodCount !== null && partialPeriodCount < 1) {
    throw new LeaveError("Choose how many periods the partial-day leave covers (D-#361)");
  }
  // 3 partial days = 1 day of balance, so one partial day costs exactly 1/3 whatever
  // its period count (owner ruling, D-#361).
  const days = dayPart === "full" ? spanDays : PARTIAL_DAY_FRACTION;

  const staff = await StaffProfile.findById(input.staffProfileId).select("active").lean();
  if (!staff || !staff.active) throw new LeaveError("Staff profile not found");

  const academicYearId = await resolveAcademicYearId(input.fromKey);
  const partialPeriods =
    dayPart === "full"
      ? []
      : await resolvePartialPeriods(input.staffProfileId, input.fromKey, dayPart, partialPeriodCount!);

  const application = await StaffLeaveApplication.create({
    staffProfileId: new Types.ObjectId(input.staffProfileId),
    academicYearId,
    leaveType: input.leaveType,
    fromKey: input.fromKey,
    toKey: input.toKey,
    dayPart,
    partialPeriodCount,
    partialPeriods,
    days,
    reason: input.reason.trim(),
    status: "applied",
    appliedBy: new Types.ObjectId(input.actorId),
  });

  // Fan out cover slots for a teaching absentee (no-op for support / non-teachers).
  await fanOutCoverSlots(application._id.toString(), input.staffProfileId);

  await writeAudit({
    eventKind: "STAFF_LEAVE_SUBMITTED",
    actorId: input.actorId,
    targetId: application._id,
    targetKind: "StaffLeaveApplication",
    meta: {
      staffProfileId: input.staffProfileId,
      leaveType: input.leaveType,
      fromKey: input.fromKey,
      toKey: input.toKey,
      days,
      dayPart,
      partialPeriods,
    },
  });
  return application;
}

// --- decide ----------------------------------------------------------------

export type LeaveDecision = "approve" | "reject" | "cancel";

export async function decideLeave(
  applicationId: string,
  decision: LeaveDecision,
  actorId: string,
  note?: string,
): Promise<IStaffLeaveApplication> {
  const app = await StaffLeaveApplication.findById(applicationId);
  if (!app) throw new LeaveError("Leave application not found");

  if (decision === "approve") {
    const rules = LEAVE_TYPE_RULES[app.leaveType];
    let remaining = 0;
    if (rules.balanceTracked && app.academicYearId) {
      const ent = await StaffLeaveEntitlement.findOne({
        staffProfileId: app.staffProfileId,
        academicYearId: app.academicYearId,
        leaveType: app.leaveType,
      }).lean();
      const taken = await takenPaidDays(
        app.staffProfileId.toString(),
        app.academicYearId.toString(),
        app.leaveType,
        app._id.toString(),
      );
      remaining = computeRemaining(ent?.allowanceDays ?? 0, ent?.carriedOverDays ?? 0, taken);
    }
    const split = splitLeaveDays(app.leaveType, app.days, remaining);
    app.status = "approved";
    app.paidDays = split.paidDays;
    app.unpaidDays = split.unpaidDays;
    app.exceedWarning = split.exceedWarning;
  } else {
    app.status = decision === "reject" ? "rejected" : "cancelled";
    // Pull back any live cover write-access for a leave that is no longer happening.
    await revokeCoversForLeave(app._id.toString(), actorId);
  }
  app.decidedBy = new Types.ObjectId(actorId);
  app.decidedAt = new Date();
  if (note !== undefined) app.decisionNote = note;
  await app.save();

  await writeAudit({
    eventKind: "STAFF_LEAVE_DECIDED",
    actorId,
    targetId: app._id,
    targetKind: "StaffLeaveApplication",
    meta: {
      decision,
      status: app.status,
      paidDays: app.paidDays ?? null,
      unpaidDays: app.unpaidDays ?? null,
    },
  });
  return app;
}

// --- reads -----------------------------------------------------------------

export async function leaveForStaff(staffProfileId: string): Promise<IStaffLeaveApplication[]> {
  return StaffLeaveApplication.find({ staffProfileId: new Types.ObjectId(staffProfileId) })
    .sort({ fromKey: -1 })
    .lean() as unknown as Promise<IStaffLeaveApplication[]>;
}

export interface ListLeaveFilter {
  status?: string;
  fromKey?: string;
  toKey?: string;
}

/** Office/Principal list: applications overlapping a range, optionally by status. */
export async function listLeave(filter: ListLeaveFilter): Promise<IStaffLeaveApplication[]> {
  const q: Record<string, unknown> = {};
  if (filter.status) q.status = filter.status;
  if (filter.fromKey) q.toKey = { $gte: filter.fromKey };
  if (filter.toKey) q.fromKey = { $lte: filter.toKey };
  return StaffLeaveApplication.find(q)
    .sort({ fromKey: -1 })
    .lean() as unknown as Promise<IStaffLeaveApplication[]>;
}

// --- attendance overlay (the AT-1 ✘ → LEAVE seam) --------------------------

export interface ApprovedLeaveWindow {
  staffProfileId: string;
  fromKey: string;
  toKey: string;
  /** D-#361; absent on pre-D-#361 rows, which are all full-day. */
  dayPart?: LeaveDayPart;
}

/** Approved leave windows overlapping [fromKey, toKey] for a set of staff — loaded
 *  once, then matched per attendance row by the pure `staffLeaveCovers`. */
export async function loadApprovedLeaves(
  staffProfileIds: string[],
  fromKey: string,
  toKey: string,
): Promise<ApprovedLeaveWindow[]> {
  if (staffProfileIds.length === 0) return [];
  const rows = await StaffLeaveApplication.find({
    staffProfileId: { $in: staffProfileIds.map((id) => new Types.ObjectId(id)) },
    status: "approved",
    fromKey: { $lte: toKey },
    toKey: { $gte: fromKey },
  })
    .select("staffProfileId fromKey toKey dayPart")
    .lean();
  return rows.map((r) => ({
    staffProfileId: r.staffProfileId.toString(),
    fromKey: r.fromKey,
    toKey: r.toKey,
    dayPart: r.dayPart,
  }));
}

/** Pure: does an approved FULL-DAY leave cover this staff member on this date?
 *
 *  A D-#361 partial day deliberately does NOT: the staff member was at school that
 *  day, so their biometric row is a real presence record (and a ✘ against it is a real
 *  full-day absence worth investigating, not something to silently relabel LEAVE). The
 *  partial leave is visible on the leave screens and in the cover slots instead. */
export function staffLeaveCovers(
  leaves: ApprovedLeaveWindow[],
  staffProfileId: string,
  dateKey: string,
): boolean {
  return leaves.some(
    (l) =>
      l.staffProfileId === staffProfileId &&
      (l.dayPart ?? "full") === "full" &&
      rangeCovers(l.fromKey, l.toKey, dateKey),
  );
}
