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
import { LEAVE_TYPES, LEAVE_TYPE_RULES, POOLED_LEAVE_TYPES, type LeaveType } from "@scd/shared";
import { StaffLeaveEntitlement } from "../models/StaffLeaveEntitlement";
import { StaffLeaveApplication } from "../models/StaffLeaveApplication";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { writeAudit } from "../../platform/services/AuditService";
import { getHrPolicy } from "./HrPolicyService";
import { LeaveError, roundLeaveDays } from "./dates";

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
  // Summed EXACTLY (partial days are 1/3, D-#361) — rounded only where it is displayed.
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
      // The display edge for D-#361 fractions: three 1/3 days read as 1, not 0.99.
      takenDays: roundLeaveDays(takenDays),
      remainingDays: roundLeaveDays(computeRemaining(allowanceDays, carriedOverDays, takenDays)),
      encashableDays: rules.encashable ? carriedOverDays : 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The ONE shared annual pool (SH-3; D-#539)
// ---------------------------------------------------------------------------
//
// The appointment letter, clause 7: "Total 20 days including sick leave and casual
// leave." That is ONE pool, and the per-(staff, year, type) entitlement rows above
// cannot express it — casual 20 + sick 20 would be 40 paid days, contradicting the
// letter every employee signed.
//
// So `casual`, `sick` and `bereavement` draw from a single allowance:
//
//   allowance = per-staff override, else HrPolicy.annualLeaveDays, PRO-RATED for a
//               mid-year joiner by the existing proRateAllowance
//   taken     = the sum of PAID days across ALL pooled types that year
//   remaining = max(0, allowance + carriedOver − taken)
//
// The per-type rows are RETAINED and win when one exists: the individual exception
// (a negotiated extra week, an unpaid-leave arrangement) stays expressible without a
// second mechanism. A row for ANY pooled type is read as an override of the pool's
// allowance, not as a separate bucket — that is what keeps the two models from
// silently adding up again.

/** Sum of APPROVED PAID days across every pooled type for (staff, year). */
export async function takenPooledDays(
  staffProfileId: string,
  academicYearId: string,
  excludeId?: string,
): Promise<number> {
  const q: Record<string, unknown> = {
    staffProfileId: new Types.ObjectId(staffProfileId),
    academicYearId: new Types.ObjectId(academicYearId),
    leaveType: { $in: [...POOLED_LEAVE_TYPES] },
    status: "approved",
  };
  if (excludeId) q._id = { $ne: new Types.ObjectId(excludeId) };
  const rows = await StaffLeaveApplication.find(q).select("paidDays days").lean();
  // Summed EXACTLY (a partial day is 1/3, D-#361); rounded only where displayed.
  return rows.reduce((sum, r) => sum + (r.paidDays ?? 0), 0);
}

export interface PooledBalanceView {
  academicYearId: string | null;
  allowanceDays: number;
  carriedOverDays: number;
  takenDays: number;
  remainingDays: number;
  /** True when a per-staff entitlement row overrode the school-wide pool. */
  overridden: boolean;
  /** True when the allowance was pro-rated for a mid-year joiner. */
  proRated: boolean;
  /**
   * True while the staff member has no `confirmationDate` (D-#576).
   *
   * The pool EXISTS for a probationer — it is what they will get on confirmation — but
   * they cannot draw it: every day taken now is unpaid and held (D-#540). Without this
   * flag the own-row screen showed a probationer "বাকি ২০ দিন", which is the opposite of
   * the rule she is actually under, and the figure she would plan a week off around.
   */
  onProbation: boolean;
}

/**
 * The pooled balance for a staff member in an academic year. `academicYearId` may be
 * omitted, in which case the CURRENT year is used; with no current year the balance is
 * a zeroed view rather than a throw — a hub tab must render for a school that has not
 * configured its year yet.
 */
export async function pooledBalanceForStaff(
  staffProfileId: string,
  academicYearId?: string | null,
): Promise<PooledBalanceView> {
  const year = academicYearId
    ? await AcademicYear.findById(academicYearId).lean()
    : await AcademicYear.findOne({ current: true }).lean();

  const zero: PooledBalanceView = {
    academicYearId: null,
    allowanceDays: 0,
    carriedOverDays: 0,
    takenDays: 0,
    remainingDays: 0,
    overridden: false,
    proRated: false,
    onProbation: false,
  };
  if (!year) return zero;

  const policy = await getHrPolicy();
  const yearId = year._id.toString();

  // Probation is decided by the DATE, never the live employmentStatus (D-#540).
  const profile = await StaffProfile.findById(staffProfileId).select("joiningDate confirmationDate").lean();
  const onProbation = !profile?.confirmationDate;

  // A per-staff row for ANY pooled type overrides the school-wide pool. Highest wins
  // when several exist, so an override can only ever be read generously — never as a
  // silent reduction because someone set a 0-day row for a type nobody uses.
  const overrides = await StaffLeaveEntitlement.find({
    staffProfileId: new Types.ObjectId(staffProfileId),
    academicYearId: year._id,
    leaveType: { $in: [...POOLED_LEAVE_TYPES] },
  }).lean();

  const carriedOverDays = overrides.reduce((max, e) => Math.max(max, e.carriedOverDays ?? 0), 0);
  const overridden = overrides.length > 0;

  let allowanceDays: number;
  let proRated = false;
  if (overridden) {
    allowanceDays = overrides.reduce((max, e) => Math.max(max, e.allowanceDays ?? 0), 0);
  } else {
    const joined = profile?.joiningDate ?? null;
    allowanceDays = proRateAllowance(policy.annualLeaveDays, joined, year.startDate, year.endDate);
    proRated = allowanceDays !== policy.annualLeaveDays;
  }

  const takenDays = await takenPooledDays(staffProfileId, yearId);
  return {
    academicYearId: yearId,
    allowanceDays,
    carriedOverDays,
    takenDays: roundLeaveDays(takenDays),
    remainingDays: roundLeaveDays(computeRemaining(allowanceDays, carriedOverDays, takenDays)),
    overridden,
    proRated,
    onProbation,
  };
}
