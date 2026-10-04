/**
 * ExitPayService (D-#711) — what a LEAVER is owed in their last month, and how it is
 * paid. ONE source for the exit dues, read by both places that pay them:
 *
 *   - the monthly run (`preparePayrollRun`) when the last working day falls inside the
 *     month being run — the owner's rule: *"prorated also with leave encashment and
 *     leave charge where necessary"*. The leaver is paid with everyone else; the D-#29
 *     clearance hold no longer applies to that money (owner ruling 2026-10-04).
 *   - the standalone final settlement (`computeFinalSettlement`) for an exit no run
 *     has paid, e.g. one whose month was already locked when the case was opened.
 *
 * The dues are the H6.4 set, unchanged: leave encashment (carried-over encashable days),
 * the overdrawn leave balance (D-#616) and the probation-held leave debt (D-#540), each
 * at the day-rate.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import { OffboardingCase } from "../models/OffboardingCase";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { writeAudit } from "../../platform/services/AuditService";
import type { PayLineInput } from "./payrollMath";
import { pendingExitDebt, settleOnExit } from "./ProbationDebtService";
import { balancesForStaff, pooledBalanceForStaff } from "./LeaveEntitlementService";
import { clearanceComplete } from "./offboardingMath";

/** The overdrawn-balance line's note — also how the run's recovery row is labelled. */
export const OVERDRAWN_LEAVE_NOTE = "ঋণাত্মক ছুটির জমা (D-#616)";

export interface StaffExit {
  caseId: Types.ObjectId;
  lastWorkingDayKey: string;
  /** The case's own settlement was RELEASED outside any run — already paid in full. */
  settledOutsideRun: boolean;
}

/** Every live (not cancelled) exit whose last working day is on or before the end of
 *  `monthKey`, by staff id. Someone whose last day was in an EARLIER month is not paid
 *  by this run at all; someone whose last day is in this month gets their last payslip. */
export async function exitsUpTo(monthKey: string): Promise<Map<string, StaffExit>> {
  const cases = await OffboardingCase.find({
    status: { $ne: "cancelled" },
    lastWorkingDayKey: { $lte: `${monthKey}-31` },
  })
    .select("staffProfileId lastWorkingDayKey settlement")
    .lean();
  const out = new Map<string, StaffExit>();
  for (const c of cases) {
    out.set(c.staffProfileId.toString(), {
      caseId: c._id,
      lastWorkingDayKey: c.lastWorkingDayKey,
      settledOutsideRun: !!c.settlement && c.settlement.held === false && !c.settlement.paidInMonthKey,
    });
  }
  return out;
}

export interface ExitDues {
  encashableDays: number;
  overdrawnDays: number;
  heldProbationDays: number;
  /** Leave encashment, or null when nothing is encashable. */
  encashment: PayLineInput | null;
  /** The overdrawn-balance charge (D-#616), or null. */
  overdrawn: PayLineInput | null;
  /** The probation-held leave charge (D-#540), or null. */
  probation: PayLineInput | null;
}

/**
 * The exit dues for one staff member at a given day-rate. READ-ONLY: nothing is marked
 * settled here — the probation debt is settled when the money is committed (run approval
 * or settlement release), so a recompute can never consume it.
 */
export async function exitDues(staffProfileId: string, rate: number, academicYearId?: string | null): Promise<ExitDues> {
  const ayId = academicYearId ?? (await AcademicYear.findOne({ current: true }).select("_id").lean())?._id?.toString();

  // H6.4 — full leave encashment: the carried-over encashable days × day-rate (H2.4(b)).
  let encashableDays = 0;
  if (ayId) {
    const balances = await balancesForStaff(staffProfileId, ayId);
    encashableDays = balances.reduce((s, b) => s + b.encashableDays, 0);
  }

  /**
   * AN OVERDRAWN LEAVE BALANCE IS RECOVERED AT EXIT (D-#616).
   *
   * Leave and lateness both draw the pool and the pool may go negative; payroll never
   * turns that into a salary deduction while someone is employed. The debt is real
   * though, and this is the last payslip — so this is where it lands.
   *
   * It does not overlap the probation debt below: held probation days never entered the
   * pool at all (there was no pool to enter); a negative balance is days that DID draw a
   * pool and took it past zero. An earlier agreed recovery (D-#617) has already moved the
   * balance back up, so whatever remains negative here is genuinely still owed.
   */
  const pool = await pooledBalanceForStaff(staffProfileId, ayId ?? null);
  const overdrawnDays = pool.remainingDays < 0 ? Math.abs(pool.remainingDays) : 0;

  // SH-3 / D-#540 — a probationer who leaves unconfirmed carries their HELD leave debt
  // to the exit: the pool that would have absorbed it was never granted.
  const heldProbationDays = await pendingExitDebt(staffProfileId);

  return {
    encashableDays,
    overdrawnDays,
    heldProbationDays,
    encashment:
      encashableDays > 0
        ? { type: "leave_encashment", amount: Math.round(rate * encashableDays), days: encashableDays }
        : null,
    overdrawn:
      overdrawnDays > 0
        ? { type: "unpaid_leave", amount: Math.round(rate * overdrawnDays), days: overdrawnDays, note: OVERDRAWN_LEAVE_NOTE }
        : null,
    probation:
      heldProbationDays > 0
        ? {
            type: "unpaid_leave",
            amount: Math.round(rate * heldProbationDays),
            days: heldProbationDays,
            note: "প্রবেশনকালীন জমা ছুটি (D-#540)",
          }
        : null,
  };
}

/** The leaver's payslip, as far as committing it needs to know. */
export interface ExitPayslip {
  staffProfileId: Types.ObjectId;
  exitCaseId?: Types.ObjectId | null;
  monthKey: string;
  payableDays?: number | null;
  dayRate: number;
  grossSalary: number;
  deductions: Array<{ type: string; amount: number; days?: number | null; note?: string | null }>;
  additions: Array<{ type: string; amount: number; days?: number | null; note?: string | null }>;
  totalDeductions: number;
  totalAdditions: number;
  netPay: number;
  advanceId?: Types.ObjectId | null;
  advanceRepaid: number;
}

/**
 * Run approval → the leaver's last payslip BECOMES their final settlement.
 *
 * Settles the probation debt it charged (exactly as a released settlement does) and
 * writes the payslip onto the exit case as a RELEASED settlement stamped with the
 * month, so the case shows what was paid and `computeFinalSettlement` refuses to pay it
 * again. The case stays open until its clearance checklist is finished — assets and
 * handover are still tracked; only the money no longer waits for them.
 */
export async function commitExitPayslips(
  slips: ExitPayslip[],
  workingDays: number,
  actorId: string,
): Promise<number> {
  let committed = 0;
  for (const p of slips) {
    if (!p.exitCaseId) continue;
    const c = await OffboardingCase.findById(p.exitCaseId);
    if (!c) continue;
    await settleOnExit(p.staffProfileId.toString(), actorId);
    const now = new Date();
    const actor = new Types.ObjectId(actorId);
    c.settlement = {
      workingDays,
      payableDays: p.payableDays ?? null,
      dayRate: p.dayRate,
      grossSalary: p.grossSalary,
      leaveEncashmentDays: p.additions.find((a) => a.type === "leave_encashment")?.days ?? 0,
      deductions: p.deductions,
      additions: p.additions,
      totalDeductions: p.totalDeductions,
      totalAdditions: p.totalAdditions,
      netPay: p.netPay,
      advanceId: p.advanceId ?? null,
      advanceRecovered: p.advanceRepaid,
      held: false,
      computedAt: now,
      computedBy: actor,
      releasedAt: now,
      releasedBy: actor,
      paidInMonthKey: p.monthKey,
    };
    c.markModified("settlement");
    if (clearanceComplete(c.clearanceItems)) c.status = "completed";
    await c.save();
    await writeAudit({
      eventKind: "FINAL_SETTLEMENT_RELEASED",
      actorId,
      targetId: c._id,
      targetKind: "OffboardingCase",
      meta: { netPay: p.netPay, paidInMonthKey: p.monthKey },
    });
    committed += 1;
  }
  return committed;
}
