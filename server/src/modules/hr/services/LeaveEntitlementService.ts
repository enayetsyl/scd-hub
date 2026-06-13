/**
 * LeaveEntitlementService (HR-2; prd-hr §3.1/§3.4) — the balance half of leave.
 *
 * Balance = allowance + carriedOver − taken, where `taken` is the sum of APPROVED
 * applications' PAID days for that (staff, year, type). Pure math is split out so it
 * is unit-testable without a DB; the persisted side just upserts admin-set allowances
 * (numbers PARKED, §10 — admin DATA, never seeded; the D-#97 read-time-default posture
 * means a type with no entitlement row simply has a 0 balance, no startup write).
 */
import { Types } from "mongoose";
import { LEAVE_TYPES, LEAVE_TYPE_RULES, type LeaveType } from "@scd/shared";
import { StaffLeaveEntitlement } from "../models/StaffLeaveEntitlement";
import { StaffLeaveApplication } from "../models/StaffLeaveApplication";
import { writeAudit } from "../../platform/services/AuditService";
import { LeaveError } from "./dates";

// --- pure helpers ----------------------------------------------------------

/** remaining = max(0, allowance + carriedOver − taken). */
export function computeRemaining(allowanceDays: number, carriedOverDays: number, takenDays: number): number {
  return Math.max(0, allowanceDays + carriedOverDays - takenDays);
}

/** Pro-rate an annual allowance for a mid-year joiner: full year → full allowance;
 *  a joiner part-way through → the fraction of the year remaining from joiningDate,
 *  rounded to whole days. Used as an admin ASSIST when granting (the stored
 *  allowanceDays is authoritative). */
export function proRateAllowance(
  annualDays: number,
  joiningDate: Date | null,
  yearStart: Date,
  yearEnd: Date,
): number {
  if (!joiningDate || joiningDate <= yearStart) return annualDays;
  if (joiningDate >= yearEnd) return 0;
  const totalMs = yearEnd.getTime() - yearStart.getTime();
  const remainingMs = yearEnd.getTime() - joiningDate.getTime();
  if (totalMs <= 0) return annualDays;
  return Math.round(annualDays * (remainingMs / totalMs));
}

// --- persisted side --------------------------------------------------------

export interface UpsertEntitlementInput {
  staffProfileId: string;
  academicYearId: string;
  leaveType: LeaveType;
  allowanceDays: number;
  carriedOverDays?: number;
  note?: string;
  actorId: string;
}

/** Set/edit a staff member's allowance for a year + type (Principal/Office). Only
 *  balance-tracked paid types carry an allowance (§3.2). */
export async function upsertEntitlement(input: UpsertEntitlementInput) {
  if (!LEAVE_TYPE_RULES[input.leaveType].balanceTracked) {
    throw new LeaveError(`${input.leaveType} is not balance-tracked — no entitlement applies (§3.2)`);
  }
  if (input.allowanceDays < 0) throw new LeaveError("allowanceDays must be ≥ 0");
  const set: Record<string, unknown> = {
    allowanceDays: input.allowanceDays,
    grantedBy: new Types.ObjectId(input.actorId),
  };
  if (input.carriedOverDays !== undefined) set.carriedOverDays = Math.max(0, input.carriedOverDays);
  if (input.note !== undefined) set.note = input.note;

  const row = await StaffLeaveEntitlement.findOneAndUpdate(
    {
      staffProfileId: new Types.ObjectId(input.staffProfileId),
      academicYearId: new Types.ObjectId(input.academicYearId),
      leaveType: input.leaveType,
    },
    { $set: set },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await writeAudit({
    eventKind: "STAFF_LEAVE_ENTITLEMENT_SET",
    actorId: input.actorId,
    targetId: row._id,
    targetKind: "StaffLeaveEntitlement",
    meta: {
      staffProfileId: input.staffProfileId,
      academicYearId: input.academicYearId,
      leaveType: input.leaveType,
      allowanceDays: input.allowanceDays,
    },
  });
  return row;
}

/** Sum of APPROVED PAID days for (staff, year, type) — the `taken` term. An
 *  optional `excludeId` lets the approve path compute the balance *before* this
 *  application without double-counting it. */
export async function takenPaidDays(
  staffProfileId: string,
  academicYearId: string,
  leaveType: LeaveType,
  excludeId?: string,
): Promise<number> {
  const q: Record<string, unknown> = {
    staffProfileId: new Types.ObjectId(staffProfileId),
    academicYearId: new Types.ObjectId(academicYearId),
    leaveType,
    status: "approved",
  };
  if (excludeId) q._id = { $ne: new Types.ObjectId(excludeId) };
  const rows = await StaffLeaveApplication.find(q).select("paidDays days").lean();
  return rows.reduce((sum, r) => sum + (r.paidDays ?? r.days), 0);
}

export interface LeaveBalanceView {
  leaveType: LeaveType;
  paid: boolean;
  balanceTracked: boolean;
  allowanceDays: number;
  carriedOverDays: number;
  takenDays: number;
  remainingDays: number;
  /** §3.4 budget line: carried-over days still encashable (in-service cash-out draws these). */
  encashableDays: number;
}

/** Per-type balances for a staff member in a year (§3.1/§3.4 budget surface). */
export async function balancesForStaff(
  staffProfileId: string,
  academicYearId: string,
): Promise<LeaveBalanceView[]> {
  const ents = await StaffLeaveEntitlement.find({
    staffProfileId: new Types.ObjectId(staffProfileId),
    academicYearId: new Types.ObjectId(academicYearId),
  }).lean();
  const entByType = new Map(ents.map((e) => [e.leaveType, e]));

  const out: LeaveBalanceView[] = [];
  for (const leaveType of LEAVE_TYPES) {
    const rules = LEAVE_TYPE_RULES[leaveType];
    if (!rules.balanceTracked) continue;
    const ent = entByType.get(leaveType);
    const allowanceDays = ent?.allowanceDays ?? 0;
    const carriedOverDays = ent?.carriedOverDays ?? 0;
    const takenDays = await takenPaidDays(staffProfileId, academicYearId, leaveType);
    out.push({
      leaveType,
      paid: rules.paid,
      balanceTracked: true,
      allowanceDays,
      carriedOverDays,
      takenDays,
      remainingDays: computeRemaining(allowanceDays, carriedOverDays, takenDays),
      encashableDays: rules.encashable ? carriedOverDays : 0,
    });
  }
  return out;
}
