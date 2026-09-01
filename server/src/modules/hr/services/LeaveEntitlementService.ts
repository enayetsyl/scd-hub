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
import { LatenessCharge } from "../models/LatenessCharge";
import { LeaveBalanceRecovery } from "../models/LeaveBalanceRecovery";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { writeAudit } from "../../platform/services/AuditService";
import { getHrPolicy } from "./HrPolicyService";
import { LeaveError, roundLeaveDays } from "./dates";

// --- pure helpers ----------------------------------------------------------

/**
 * remaining = allowance + carriedOver − taken. MAY BE NEGATIVE (D-#612).
 *
 * It used to floor at zero, which was right while `carriedOverDays` could only be
 * positive: you cannot take more paid leave than you have, so a shortfall was always
 * someone's arithmetic slip. It stops being right once a year can END overdrawn. One
 * teacher took 51 days against a 20-day allowance in 2025; the owner's instruction is
 * that the other 31 carry into 2026 as a debt he works off.
 *
 * Flooring here would quietly forgive it: he would show "0 days left" — indistinguishable
 * from someone who simply used their allowance — take no paid leave for a year, and start
 * the NEXT year at zero rather than still owing 11.
 *
 * Since D-#616 nothing floors it downstream either: pooled leave and lateness both draw
 * the balance in full and the deficit is recovered at exit, or earlier by agreement, so
 * the negative IS the record rather than a number to be clamped away.
 */
export function computeRemaining(allowanceDays: number, carriedOverDays: number, takenDays: number): number {
  return allowanceDays + carriedOverDays - takenDays;
}

export interface LeaveYearWindow {
  /** First day of the current entitlement period, YYYY-MM-DD. */
  start: string;
  /** Last day of it, YYYY-MM-DD (inclusive). */
  end: string;
  /**
   * True while this is the staff member's FIRST period — the one that begins at
   * confirmation. Everything they accrued on probation is counted against it
   * (D-#619), so the reads widen the lower bound when this is set.
   */
  isFirst: boolean;
}

/**
 * The leave year is the STAFF MEMBER'S OWN, anchored on confirmation (D-#618).
 *
 * It used to be the school's academic year, with the allowance pro-rated for anyone who
 * joined part-way through. The owner's rule is different and simpler: the 20 days begin
 * when someone becomes permanent, and renew on each anniversary of that date. So a
 * teacher confirmed on 24 June carries 24 Jun → 23 Jun, and gets a fresh 20 days each
 * 24 June rather than each 1 January.
 *
 * Pro-ration disappears with it: a year that starts at confirmation is never partial.
 *
 * Returns null while there is no confirmation date. That is not "no leave" — a
 * probationer's leave is HELD and settles against the first year's allowance when they
 * are confirmed (D-#540) — it is "no entitlement period has begun yet".
 */
export function leaveYearWindow(
  confirmationDate: Date | string | null | undefined,
  asOf: Date = new Date(),
): LeaveYearWindow | null {
  if (!confirmationDate) return null;
  const c = new Date(confirmationDate);
  if (Number.isNaN(c.getTime())) return null;

  const month = c.getUTCMonth();
  const day = c.getUTCDate();
  const on = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));

  // This year's anniversary; if it has not happened yet, the period began last year.
  let start = new Date(Date.UTC(on.getUTCFullYear(), month, day));
  if (start.getTime() > on.getTime()) start = new Date(Date.UTC(on.getUTCFullYear() - 1, month, day));
  // Before the very first anniversary the period still starts at confirmation itself.
  if (start.getTime() < c.getTime()) start = new Date(Date.UTC(c.getUTCFullYear(), month, day));

  const nextStart = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);
  const startKey = start.toISOString().slice(0, 10);
  return {
    start: startKey,
    end: end.toISOString().slice(0, 10),
    // The first period is the one that opens ON the confirmation date; every later
    // anniversary starts after it.
    isFirst: startKey === c.toISOString().slice(0, 10),
  };
}

/**
 * The pooled carry-forward across a staff member's per-type entitlement rows (D-#612).
 *
 * Leave is ONE pool (D-#539) but entitlements are stored per type, so up to three rows
 * can carry a number. "Highest wins" protects against a 0-day row for a type nobody uses
 * silently reducing the pool — a zero can be an accident of setup.
 *
 * A NEGATIVE cannot be an accident: zero is the default and the column could not even
 * hold a negative until now, so any negative is a deliberate year-end deficit. Reading
 * it generously would forgive the debt the admin had just entered, which is the whole
 * point of recording it. So a deficit wins, and the deepest one wins outright.
 */
export function pooledCarryForward(values: number[]): number {
  const deficits = values.filter((n) => n < 0);
  if (deficits.length > 0) return Math.min(...deficits);
  return values.reduce((max, n) => Math.max(max, n), 0);
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
  // A NEGATIVE carry-forward is kept as given (D-#612) — this used to clamp to 0, so
  // an admin entering a year-end deficit got a silent zero and no error.
  if (input.carriedOverDays !== undefined) set.carriedOverDays = input.carriedOverDays;
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
  window?: LeaveYearWindow | null,
): Promise<number> {
  const q: Record<string, unknown> = {
    staffProfileId: new Types.ObjectId(staffProfileId),
    leaveType: { $in: [...POOLED_LEAVE_TYPES] },
    status: "approved",
  };
  /**
   * The entitlement period is the staff member's anniversary year when they have one
   * (D-#618); the academic year remains the fallback for a probationer, so nothing
   * regresses for someone who has not started a period yet.
   *
   * THE FIRST PERIOD REACHES BACK (D-#619). Probation leave is HELD, not paid, and it
   * settles against the pool at confirmation (D-#540) — but it is DATED during
   * probation, which is before the window opens. Left as a plain window filter, the
   * settlement re-stamped the applications as paid and then counted none of them: the
   * ledger moved and the balance did not, which is D-#590 arriving again through the
   * back door of my own D-#618. Pre-confirmation lateness charges had the same problem.
   *
   * Both belong to the first year — the appointment letter says so in as many words:
   * "leave taken during probation is unpaid; the school did not deduct your salary for
   * those days; instead they are adjusted against the entitlement that begins now." So
   * for the first period the lower bound is dropped and everything earlier counts.
   * Later periods keep the closed window, because by then the probation history has
   * already been absorbed and must not be charged twice.
   */
  const openLowerBound = window?.isFirst === true;
  if (window) q.fromKey = openLowerBound ? { $lte: window.end } : { $gte: window.start, $lte: window.end };
  else q.academicYearId = new Types.ObjectId(academicYearId);
  if (excludeId) q._id = { $ne: new Types.ObjectId(excludeId) };
  const rows = await StaffLeaveApplication.find(q).select("paidDays days").lean();
  // Summed EXACTLY (a partial day is 1/3, D-#361); rounded only where displayed.
  const fromLeave = rows.reduce((sum, r) => sum + (r.paidDays ?? 0), 0);

  /**
   * LATENESS COUNTS AGAINST THE POOL TOO (D-#616).
   *
   * `LatenessService` computed `paidFromLeave`, stored it on the charge and showed it —
   * and the pool never read it, so "1 day taken from leave" left the balance exactly
   * where it was. The same shape as the probation-settlement bug (D-#590): a ledger
   * ticked, a balance unmoved. Now that a charge can no longer fall through to salary,
   * this is the ONLY place it lands, so the omission would have meant lateness costing
   * nothing at all.
   */
  const chargeQ: Record<string, unknown> = { staffProfileId: new Types.ObjectId(staffProfileId) };
  if (window) {
    chargeQ.monthKey = openLowerBound
      ? { $lte: window.end.slice(0, 7) }
      : { $gte: window.start.slice(0, 7), $lte: window.end.slice(0, 7) };
  }
  const charges = await LatenessCharge.find(chargeQ).select("paidFromLeave").lean();
  const fromLateness = charges.reduce((sum, c) => sum + (c.paidFromLeave ?? 0), 0);

  /**
   * An AGREED recovery gives days back (D-#617). The staff member settled part of a
   * negative balance out of a month's salary, so those days are no longer owed — they
   * come OFF `taken`, which is what pushes the balance back up. Without this the
   * payslip would take the money and the balance would still read negative, and the
   * same days could be collected again at exit.
   */
  const recQ: Record<string, unknown> = { staffProfileId: new Types.ObjectId(staffProfileId) };
  if (window) {
    recQ.monthKey = openLowerBound
      ? { $lte: window.end.slice(0, 7) }
      : { $gte: window.start.slice(0, 7), $lte: window.end.slice(0, 7) };
  }
  const recoveries = await LeaveBalanceRecovery.find(recQ).select("days").lean();
  const recovered = recoveries.reduce((sum, r) => sum + (r.days ?? 0), 0);

  return fromLeave + fromLateness - recovered;
}

export interface PooledBalanceView {
  academicYearId: string | null;
  /** The staff member's own entitlement period (D-#618); null before confirmation. */
  leaveYearStart: string | null;
  leaveYearEnd: string | null;
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
    leaveYearStart: null,
    leaveYearEnd: null,
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

  const carriedOverDays = pooledCarryForward(overrides.map((e) => e.carriedOverDays ?? 0));
  const overridden = overrides.length > 0;

  /**
   * The entitlement period is the staff member's own anniversary year (D-#618), not the
   * academic year. `proRated` is now always false and kept only so the field does not
   * vanish from the GraphQL view: a year that begins at confirmation is never partial,
   * which is what made pro-ration necessary in the first place.
   */
  const window = leaveYearWindow(profile?.confirmationDate ?? null);

  let allowanceDays: number;
  if (overridden) {
    allowanceDays = overrides.reduce((max, e) => Math.max(max, e.allowanceDays ?? 0), 0);
  } else {
    // No window means no entitlement period has begun — a probationer's allowance is
    // what they WILL get, so the figure is shown in full rather than as zero.
    allowanceDays = policy.annualLeaveDays;
  }

  const takenDays = await takenPooledDays(staffProfileId, yearId, undefined, window);
  return {
    academicYearId: yearId,
    leaveYearStart: window?.start ?? null,
    leaveYearEnd: window?.end ?? null,
    allowanceDays,
    carriedOverDays,
    takenDays: roundLeaveDays(takenDays),
    remainingDays: roundLeaveDays(computeRemaining(allowanceDays, carriedOverDays, takenDays)),
    overridden,
    proRated: false,
    onProbation,
  };
}
