/**
 * LeaveChargeService (D-#898) — who is over their leave, and by how much, for the
 * payroll run's optional "charge to salary" switch.
 *
 * The owner: *"I want an option to cut salary for temp and permanent staff (when more
 * than their leave balance) in one to one basis. so if i want i can charge if i don't
 * i won't."* Two kinds of "over", one per side of confirmation:
 *
 *   probation — every HELD probation day (D-#540). Probation leave is unpaid by rule
 *               and only waits for confirmation or exit; the Office may now collect any
 *               of it from a monthly run instead (`ProbationDebtRecovery`).
 *   overdrawn — a confirmed staff member's NEGATIVE pooled balance (D-#616), which the
 *               agreed recovery (D-#617, `LeaveBalanceRecovery`) already collects.
 *
 * Nothing here charges anyone. It answers "how many days COULD be charged", for the
 * screen to offer and for `preparePayrollRun` to refuse a figure above it.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { OffboardingCase } from "../models/OffboardingCase";
import { LeaveBalanceRecovery } from "../models/LeaveBalanceRecovery";
import { PayrollRun } from "../models/PayrollRun";
import { pooledBalanceForStaff } from "./LeaveEntitlementService";
import { lateDateKeysForMonth } from "./LatenessService";
import { getHrPolicy } from "./HrPolicyService";
import { openHeldDays } from "./ProbationDebtService";
import { roundLeaveDays } from "./dates";

export type LeaveChargeKind = "probation" | "overdrawn";

export interface LeaveChargeCandidate {
  staffProfileId: string;
  name: string;
  kind: LeaveChargeKind;
  /** The most that may be charged this run — the whole held debt, or the whole deficit. */
  days: number;
}

/**
 * A confirmed staff member's deficit in days, or 0 (D-#617).
 *
 * `excludeRunId` adds back that run's own agreed recovery — the balance already counts
 * it as repaid, and the run being re-prepared is about to replace it.
 */
export async function overdrawnDays(
  staffProfileId: string,
  excludeRunId?: Types.ObjectId | string | null,
): Promise<number> {
  const pool = await pooledBalanceForStaff(staffProfileId);
  if (pool.onProbation) return 0;
  let remaining = pool.remainingDays;
  if (excludeRunId) {
    const own = await LeaveBalanceRecovery.findOne({
      staffProfileId: new Types.ObjectId(staffProfileId),
      payrollRunId: new Types.ObjectId(excludeRunId.toString()),
    })
      .select("days")
      .lean();
    remaining -= own?.days ?? 0;
  }
  return remaining < 0 ? -remaining : 0;
}

/**
 * Staff with an exit case (any not cancelled) are left out: their held and overdrawn
 * leave is collected in full by the exit dues (D-#711), and a charge taken while the
 * case is open would move the figure its settlement was computed from.
 */
export async function staffWithOpenExit(): Promise<Set<string>> {
  const ids = await OffboardingCase.distinct("staffProfileId", { status: { $ne: "cancelled" } });
  return new Set(ids.map((id: Types.ObjectId) => id.toString()));
}

// --- lateness, per person (D-#908) ------------------------------------------

/** Someone with chargeable late days in a month — the lateness card's row. */
export interface LatenessChargeCandidate {
  staffProfileId: string;
  name: string;
  /** Every LATE mark that month (late-entry leave days included, owner 2026-11-02). */
  lateCount: number;
  lateDateKeys: string[];
  /** floor(lateCount / lateDaysPerCharge) — the most that may be charged. */
  days: number;
}

export interface LatenessCandidatesView {
  /** The school-wide rule is on: it charges everyone at prepare, so the card stands down. */
  ruleOn: boolean;
  lateDaysPerCharge: number;
  rows: LatenessChargeCandidate[];
}

/** A month's late marks and what they may cost, by the policy's own ratio (D-#541). */
export async function chargeableLateDays(
  staffProfileId: string,
  monthKey: string,
  lateDaysPerCharge: number,
): Promise<{ lateDateKeys: string[]; days: number }> {
  const lateDateKeys = await lateDateKeysForMonth(staffProfileId, monthKey);
  return { lateDateKeys, days: Math.floor(lateDateKeys.length / Math.max(1, lateDaysPerCharge)) };
}

/**
 * Everyone whose late marks in `monthKey` add up to at least one chargeable day
 * (D-#908). Nothing here charges anyone — the run does, for the rows the Office turns
 * on. While the school-wide rule is ON this returns no rows: the rule already charges
 * every one of them at prepare, and a second, per-person charge would count the same
 * late days twice.
 */
export async function latenessChargeCandidates(monthKey: string): Promise<LatenessCandidatesView> {
  const policy = await getHrPolicy();
  if (policy.latenessRuleEnabled) return { ruleOn: true, lateDaysPerCharge: policy.lateDaysPerCharge, rows: [] };
  const [staff, exiting] = await Promise.all([
    StaffProfile.find({ active: true, monthlySalary: { $gt: 0 } }).select("name").lean(),
    staffWithOpenExit(),
  ]);
  const rows: LatenessChargeCandidate[] = [];
  for (const s of staff) {
    const sid = s._id.toString();
    if (exiting.has(sid)) continue;
    const { lateDateKeys, days } = await chargeableLateDays(sid, monthKey, policy.lateDaysPerCharge);
    if (days > 0) rows.push({ staffProfileId: sid, name: s.name, lateCount: lateDateKeys.length, lateDateKeys, days });
  }
  return {
    ruleOn: false,
    lateDaysPerCharge: policy.lateDaysPerCharge,
    rows: rows.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name)),
  };
}

/** Everyone a run for `monthKey` could charge, probation first, then by name. */
export async function leaveChargeCandidates(monthKey: string): Promise<LeaveChargeCandidate[]> {
  const [staff, exiting, run] = await Promise.all([
    StaffProfile.find({ active: true, monthlySalary: { $gt: 0 } })
      .select("name confirmationDate")
      .lean(),
    staffWithOpenExit(),
    // A prepared run for this month is about to be replaced; its own charges must not
    // shrink what the screen offers.
    PayrollRun.findOne({ monthKey, status: "prepared" }).select("_id").lean(),
  ]);

  const out: LeaveChargeCandidate[] = [];
  for (const s of staff) {
    const sid = s._id.toString();
    if (exiting.has(sid)) continue;
    // A probationer's charge is the held debt; a confirmed person's is the deficit.
    // Held rows can outlive a confirmation only if it failed half-way, so read both.
    const held = await openHeldDays(sid, run?._id ?? null);
    if (held > 0) {
      out.push({ staffProfileId: sid, name: s.name, kind: "probation", days: roundLeaveDays(held) });
      continue;
    }
    if (!s.confirmationDate) continue;
    const over = await overdrawnDays(sid, run?._id ?? null);
    if (over > 0) out.push({ staffProfileId: sid, name: s.name, kind: "overdrawn", days: roundLeaveDays(over) });
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "probation" ? -1 : 1));
}
