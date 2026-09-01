/**
 * LatenessService (SH-4; docs/prd-staff-hub.md §4, D-#541).
 *
 * The owner's rule: *"for 3 days late entry one day first leave deduct then salary
 * deduct."* Per CALENDAR MONTH, with the leftover 1–2 lates forgiven at month end.
 *
 * `prd-hr.md` H4.3 parked exactly this — *"lateness/early-departure = no deduction by
 * default … with an optional Principal-configurable deduction rule (parameters
 * parked)"* — so this fills the parked parameters and stays OFF until
 * `HrPolicy.latenessRuleEnabled` is switched on. Shipping it changes no existing figure.
 *
 * WHAT COUNTS AS LATE. `TeacherAttendanceDay.status === "LATE"` and nothing else. That
 * status is read straight off the biometric sheet's 𝓛 symbol (AT-1) — the app does no
 * arrival-time arithmetic and has no grace window, so there is exactly one definition
 * of "late" in the system and it is the one the device already applied.
 *
 * FROZEN AT LOCK. The charge is computed at payroll PREPARE and frozen when the run is
 * approved. It has to be: re-uploading an attendance sheet REPLACES that date's rows
 * wholesale (AT1.5), so an unfrozen charge would let a correction to March silently
 * restate a payslip that was paid in March.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import { TeacherAttendanceDay } from "../../attendance/models/TeacherAttendanceDay";
import { LatenessCharge, type ILatenessCharge } from "../models/LatenessCharge";
import { getHrPolicy } from "./HrPolicyService";
import { pooledBalanceForStaff } from "./LeaveEntitlementService";
import { writeAudit } from "../../platform/services/AuditService";

// --- pure math (unit-tested directly, no DB) --------------------------------

export interface LatenessSplit {
  chargedDays: number;
  paidFromLeave: number;
  chargedToSalary: number;
  /** The 1–2 lates that did not reach a full charge and are forgiven at month end. */
  forgivenLates: number;
}

/**
 * `floor(lateCount / lateDaysPerCharge)` days are charged; the remainder is forgiven.
 * The charge is taken from the leave pool first and only then from salary.
 *
 * `poolRemaining` may be fractional (a D-#361 partial day is 1/3), so the pooled part
 * is floored to whole days — a third of a day of leave cannot absorb a whole charged
 * day, and charging the fraction would leave an unexplainable stub on the balance.
 */
export function splitLatenessCharge(
  lateCount: number,
  lateDaysPerCharge: number,
  _poolRemaining: number,
): LatenessSplit {
  if (lateDaysPerCharge < 1) throw new Error("lateDaysPerCharge must be ≥ 1");
  const chargedDays = Math.floor(Math.max(0, lateCount) / lateDaysPerCharge);
  const forgivenLates = Math.max(0, lateCount) - chargedDays * lateDaysPerCharge;
  /**
   * THE WHOLE CHARGE GOES TO THE LEAVE BALANCE (D-#616).
   *
   * It used to take from the pool only as far as the pool went and bill the rest to
   * salary — "first leave deduct then salary deduct". The owner has since drawn the
   * line differently: leave and lateness are settled against the BALANCE, which may
   * run negative, and salary is touched only at exit or by explicit agreement
   * (D-#617). So there is no automatic salary half any more.
   *
   * `poolRemaining` is kept in the signature and ignored: the caller reads it for
   * display, and dropping the parameter would ripple through call sites for no gain
   * while making it harder to restore the split if the policy ever changes back.
   */
  return {
    chargedDays,
    paidFromLeave: chargedDays,
    chargedToSalary: 0,
    forgivenLates,
  };
}

// --- persisted side ---------------------------------------------------------

/** Every LATE dateKey for a staff member inside a month, ascending. */
export async function lateDateKeysForMonth(
  staffProfileId: string,
  monthKey: string,
): Promise<string[]> {
  const rows = await TeacherAttendanceDay.find({
    staffProfileId: new Types.ObjectId(staffProfileId),
    status: "LATE",
    dateKey: { $gte: `${monthKey}-01`, $lte: `${monthKey}-31` },
  })
    .select("dateKey")
    .sort({ dateKey: 1 })
    .lean();
  return rows.map((r) => r.dateKey);
}

export interface ComputeLatenessInput {
  staffProfileId: string;
  monthKey: string;
  dayRate: number;
  actorId: string;
  payrollRunId?: Types.ObjectId | null;
}

/**
 * Compute (or recompute) a month's charge and upsert it. Returns the row, or null when
 * the rule is off — the caller then passes no lateness figure at all, so payroll output
 * is byte-identical to today.
 *
 * A FROZEN row is returned untouched: once the run that consumed it locked, the charge
 * is part of an issued payslip and recomputing it would restate history.
 */
export async function computeLatenessCharge(
  input: ComputeLatenessInput,
): Promise<ILatenessCharge | null> {
  const policy = await getHrPolicy();
  if (!policy.latenessRuleEnabled) return null;

  const existing = await LatenessCharge.findOne({
    staffProfileId: new Types.ObjectId(input.staffProfileId),
    monthKey: input.monthKey,
  });
  if (existing?.frozen) return existing;

  const lateDateKeys = await lateDateKeysForMonth(input.staffProfileId, input.monthKey);
  const pool = await pooledBalanceForStaff(input.staffProfileId);
  const split = splitLatenessCharge(
    lateDateKeys.length,
    policy.lateDaysPerCharge,
    pool.remainingDays,
  );
  const amount = Math.round(split.chargedToSalary * input.dayRate);

  const row = await LatenessCharge.findOneAndUpdate(
    {
      staffProfileId: new Types.ObjectId(input.staffProfileId),
      monthKey: input.monthKey,
    },
    {
      $set: {
        lateDateKeys,
        lateDaysPerCharge: policy.lateDaysPerCharge,
        chargedDays: split.chargedDays,
        paidFromLeave: split.paidFromLeave,
        chargedToSalary: split.chargedToSalary,
        dayRate: input.dayRate,
        amount,
        payrollRunId: input.payrollRunId ?? null,
        frozen: false,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (split.chargedDays > 0) {
    await writeAudit({
      eventKind: "STAFF_LATENESS_CHARGED",
      actorId: input.actorId,
      targetId: row._id,
      targetKind: "LatenessCharge",
      meta: {
        staffProfileId: input.staffProfileId,
        monthKey: input.monthKey,
        lateCount: lateDateKeys.length,
        lateDateKeys,
        chargedDays: split.chargedDays,
        paidFromLeave: split.paidFromLeave,
        chargedToSalary: split.chargedToSalary,
        amount,
      },
    });
  }
  return row;
}

/** Freeze a run's charges at approval, alongside the payslips they fed. */
export async function freezeLatenessCharges(
  monthKey: string,
  payrollRunId: Types.ObjectId,
): Promise<number> {
  const res = await LatenessCharge.updateMany(
    { monthKey, frozen: false },
    { $set: { frozen: true, payrollRunId } },
  );
  return res.modifiedCount ?? 0;
}

/** The hub's উপস্থিতি + বেতন tabs: this person's charge for a month, if any. */
export async function latenessChargeFor(
  staffProfileId: string,
  monthKey: string,
): Promise<ILatenessCharge | null> {
  return LatenessCharge.findOne({
    staffProfileId: new Types.ObjectId(staffProfileId),
    monthKey,
  }).lean() as unknown as Promise<ILatenessCharge | null>;
}

/**
 * A live, UNSAVED preview for a month with no payroll run yet — what the উপস্থিতি tab
 * shows beside the calendar ("2 lates, 1 more costs a day"). Never writes, so opening
 * a screen can never create a charge.
 */
export interface LatenessPreview {
  enabled: boolean;
  lateCount: number;
  lateDateKeys: string[];
  lateDaysPerCharge: number;
  chargedDays: number;
  paidFromLeave: number;
  chargedToSalary: number;
  /** How many more lates until the next charged day. */
  latesUntilNextCharge: number;
}

export async function previewLateness(
  staffProfileId: string,
  monthKey: string,
): Promise<LatenessPreview> {
  const policy = await getHrPolicy();
  const lateDateKeys = await lateDateKeysForMonth(staffProfileId, monthKey);
  const pool = await pooledBalanceForStaff(staffProfileId);
  const split = splitLatenessCharge(
    lateDateKeys.length,
    policy.lateDaysPerCharge,
    pool.remainingDays,
  );
  return {
    enabled: policy.latenessRuleEnabled,
    lateCount: lateDateKeys.length,
    lateDateKeys,
    lateDaysPerCharge: policy.lateDaysPerCharge,
    chargedDays: split.chargedDays,
    paidFromLeave: split.paidFromLeave,
    chargedToSalary: split.chargedToSalary,
    latesUntilNextCharge: policy.lateDaysPerCharge - split.forgivenLates,
  };
}
