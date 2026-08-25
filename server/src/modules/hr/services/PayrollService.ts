/**
 * PayrollService (HR-3; prd-hr §4.2/§4.6) — the monthly run.
 *
 *   preparePayrollRun  — Office computes payslips for every active salaried staff
 *                        (incl. support, D-#25): gross (pro-rated on the day-rate via
 *                        an optional per-staff payableDays), the unpaid-leave deduction
 *                        from the STORED leave split (D-#110 — NOT the read-time
 *                        attendance overlay), advance recovery with the net-pay guard,
 *                        and any manual arrears/bonus/clawback lines. Re-preparing a
 *                        `prepared` month recomputes it; a locked month is refused.
 *   approvePayrollRun  — Principal approves → run LOCKS (immutable) + advance balances
 *                        are decremented by the recovered amounts. Payslips + the
 *                        payment export issue only from a locked run.
 *   paymentExport      — net pay per staff for bank/bKash bulk upload; cash EXCLUDED.
 *
 * A locked run is NEVER retro-edited; a post-lock correction rides an `arrears` line on
 * the NEXT run (D-#110). Identity/operational plane; NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { StaffLeaveApplication } from "../models/StaffLeaveApplication";
import { PayrollRun, type IPayrollRun } from "../models/PayrollRun";
import { Payslip, type IPayslip } from "../models/Payslip";
import { AdvanceLoan } from "../models/AdvanceLoan";
import { writeAudit } from "../../platform/services/AuditService";
import { assertMonthKey, dayRate, computePayslip, PayrollError, type PayLineInput } from "./payrollMath";
import { activeAdvanceByStaff } from "./AdvanceService";
import { computeLatenessCharge, freezeLatenessCharges } from "./LatenessService";

export interface StaffAdjustment {
  staffProfileId: string;
  /** Pro-ration: pay only this many days at the day-rate (mid-month joiner/leaver/
   *  part-timer). Omit = full monthlySalary as gross (§4.2; exact fractions parked §10). */
  payableDays?: number;
  latenessDeduction?: number;
  manualDeductions?: PayLineInput[];
  manualAdditions?: PayLineInput[];
}

export interface PreparePayrollInput {
  monthKey: string;
  workingDays: number;
  adjustments?: StaffAdjustment[];
  note?: string;
  actorId: string;
}

/** Stored unpaid-leave days per staff for a month — summed from APPROVED leaves whose
 *  fromKey falls in the month (D-#110: the leave application's STORED split is the
 *  payroll truth; a cross-month leave's unpaid days attribute to its start month).
 *
 *  EXCLUDES probation-held leave (SH-3, D-#540): those days are unpaid but deliberately
 *  NOT payable now — they sit on the ProbationLeaveDebt ledger and are collected once,
 *  at confirmation (against the new pool) or at exit (against the final settlement).
 *  Counting them here would dock the same absence twice. */
async function unpaidLeaveDaysByStaff(monthKey: string): Promise<Map<string, number>> {
  const rows = await StaffLeaveApplication.find({
    status: "approved",
    probationHeld: { $ne: true },
    fromKey: { $gte: `${monthKey}-01`, $lte: `${monthKey}-31` },
  })
    .select("staffProfileId unpaidDays")
    .lean();
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!r.unpaidDays) continue;
    const key = r.staffProfileId.toString();
    map.set(key, (map.get(key) ?? 0) + r.unpaidDays);
  }
  return map;
}

export async function preparePayrollRun(input: PreparePayrollInput): Promise<{ run: IPayrollRun; payslips: IPayslip[] }> {
  assertMonthKey(input.monthKey);
  if (input.workingDays < 1) throw new PayrollError("workingDays must be ≥ 1");

  // One non-cancelled run per month: recompute a prepared one, refuse a locked one.
  const existing = await PayrollRun.findOne({ monthKey: input.monthKey, status: { $ne: "cancelled" } });
  if (existing) {
    if (existing.status === "approved_locked") {
      throw new PayrollError(`${input.monthKey} is locked — corrections ride arrears on a later run (D-#110)`);
    }
    await Payslip.deleteMany({ payrollRunId: existing._id });
    await PayrollRun.deleteOne({ _id: existing._id });
  }

  const [staff, leaveDays, advances] = await Promise.all([
    StaffProfile.find({ active: true, monthlySalary: { $gt: 0 } })
      .select("name category monthlySalary paymentMethod")
      .lean(),
    unpaidLeaveDaysByStaff(input.monthKey),
    activeAdvanceByStaff(),
  ]);

  const adjByStaff = new Map((input.adjustments ?? []).map((a) => [a.staffProfileId, a]));

  const run = await PayrollRun.create({
    monthKey: input.monthKey,
    status: "prepared",
    workingDays: input.workingDays,
    preparedBy: new Types.ObjectId(input.actorId),
    preparedAt: new Date(),
    note: input.note,
  });

  const payslipDocs: Array<Partial<IPayslip>> = [];
  for (const s of staff) {
    const sid = s._id.toString();
    const rate = dayRate(s.monthlySalary!, input.workingDays);
    const adj = adjByStaff.get(sid);
    const gross = adj?.payableDays != null ? Math.round(rate * adj.payableDays) : s.monthlySalary!;
    const advance = advances.get(sid);
    // SH-4 / D-#541: the 3-lates-to-a-day charge. Returns null while the rule is off,
    // in which case nothing is passed and the payslip is byte-identical to today. An
    // explicit per-staff `latenessDeduction` adjustment still wins — it is the manual
    // override the Office has always had.
    const latenessRow = await computeLatenessCharge({
      staffProfileId: sid,
      monthKey: input.monthKey,
      dayRate: rate,
      actorId: input.actorId,
      payrollRunId: run._id,
    });
    const latenessDeduction = adj?.latenessDeduction ?? (latenessRow?.amount || undefined);
    const computed = computePayslip({
      grossSalary: gross,
      dayRate: rate,
      unpaidLeaveDays: leaveDays.get(sid) ?? 0,
      latenessDeduction,
      manualDeductions: adj?.manualDeductions,
      manualAdditions: adj?.manualAdditions,
      advance: advance
        ? {
            advanceId: advance._id.toString(),
            recoveryMode: advance.recoveryMode,
            installmentAmount: advance.installmentAmount,
            balance: advance.balance,
          }
        : null,
    });
    payslipDocs.push({
      payrollRunId: run._id,
      staffProfileId: s._id,
      monthKey: input.monthKey,
      snapshotName: s.name,
      category: s.category,
      paymentMethod: s.paymentMethod,
      grossSalary: gross,
      dayRate: rate,
      paidLeaveDays: 0,
      unpaidLeaveDays: leaveDays.get(sid) ?? 0,
      deductions: computed.deductions,
      additions: computed.additions,
      totalDeductions: computed.totalDeductions,
      totalAdditions: computed.totalAdditions,
      netPay: computed.netPay,
      advanceRepaid: computed.advanceRepaid,
      advanceId: computed.advanceId ? new Types.ObjectId(computed.advanceId) : null,
    });
  }
  const payslips = payslipDocs.length ? await Payslip.insertMany(payslipDocs) : [];

  await writeAudit({
    eventKind: "PAYROLL_PREPARED",
    actorId: input.actorId,
    targetId: run._id,
    targetKind: "PayrollRun",
    meta: { monthKey: input.monthKey, staff: payslips.length, workingDays: input.workingDays, recomputed: !!existing },
  });
  return { run, payslips: payslips as unknown as IPayslip[] };
}

/** Principal approve → LOCK + commit advance recovery. Idempotent guard: only a
 *  `prepared` run can be approved (a second call on a locked run throws). */
export async function approvePayrollRun(runId: string, actorId: string): Promise<IPayrollRun> {
  const run = await PayrollRun.findById(runId);
  if (!run) throw new PayrollError("Payroll run not found");
  if (run.status !== "prepared") throw new PayrollError(`Run is ${run.status} — only a prepared run can be approved`);

  // Commit advance recovery at lock time (never at prepare — prevents double-decrement on recompute).
  const payslips = await Payslip.find({ payrollRunId: run._id, advanceRepaid: { $gt: 0 } }).lean();
  for (const p of payslips) {
    if (!p.advanceId) continue;
    const advance = await AdvanceLoan.findById(p.advanceId);
    if (!advance) continue;
    advance.balance = Math.max(0, advance.balance - p.advanceRepaid);
    if (advance.balance === 0) {
      advance.status = "settled";
      advance.settledAt = new Date();
    }
    await advance.save();
  }

  // SH-4 / D-#541: freeze this month's lateness charges alongside the payslips they
  // fed. A re-uploaded attendance sheet REPLACES that date's rows wholesale (AT1.5),
  // so an unfrozen charge would let a later correction restate an already-paid payslip.
  const frozen = await freezeLatenessCharges(run.monthKey, run._id);

  run.status = "approved_locked";
  run.approvedBy = new Types.ObjectId(actorId);
  run.approvedAt = new Date();
  await run.save();

  await writeAudit({
    eventKind: "PAYROLL_APPROVED",
    actorId,
    targetId: run._id,
    targetKind: "PayrollRun",
    meta: { monthKey: run.monthKey, advancesRecovered: payslips.length, latenessChargesFrozen: frozen },
  });
  return run;
}

export async function cancelPayrollRun(runId: string, actorId: string): Promise<IPayrollRun> {
  const run = await PayrollRun.findById(runId);
  if (!run) throw new PayrollError("Payroll run not found");
  if (run.status !== "prepared") throw new PayrollError("Only a prepared run can be cancelled");
  await Payslip.deleteMany({ payrollRunId: run._id });
  run.status = "cancelled";
  await run.save();
  await writeAudit({ eventKind: "PAYROLL_CANCELLED", actorId, targetId: run._id, targetKind: "PayrollRun", meta: { monthKey: run.monthKey } });
  return run;
}

// --- reads -----------------------------------------------------------------

export async function payrollRuns(limit = 36): Promise<IPayrollRun[]> {
  return PayrollRun.find({ status: { $ne: "cancelled" } })
    .sort({ monthKey: -1 })
    .limit(limit)
    .lean() as unknown as Promise<IPayrollRun[]>;
}

export async function payslipsForRun(runId: string): Promise<IPayslip[]> {
  return Payslip.find({ payrollRunId: new Types.ObjectId(runId) })
    .sort({ snapshotName: 1 })
    .lean() as unknown as Promise<IPayslip[]>;
}

/**
 * HR-G1 own-row read: a staff member's OWN payslips across runs (newest month first).
 * LOCKED-RUNS-ONLY — a staff member must never see a draft/`prepared` (or `cancelled`)
 * payslip; only `approved_locked` runs are issued (§4.2). The caller's StaffProfile is
 * resolved by the resolver (phone-join, fail-closed); this read is scoped to that one id.
 */
export async function payslipsForStaff(staffProfileId: string): Promise<IPayslip[]> {
  const lockedRuns = await PayrollRun.find({ status: "approved_locked" }).select("_id").lean();
  if (lockedRuns.length === 0) return [];
  return Payslip.find({
    staffProfileId: new Types.ObjectId(staffProfileId),
    payrollRunId: { $in: lockedRuns.map((r) => r._id) },
  })
    .sort({ monthKey: -1 })
    .lean() as unknown as Promise<IPayslip[]>;
}

export interface PaymentExportRow {
  staffProfileId: string;
  name: string;
  paymentMethod: string;
  account: string | null;
  netPay: number;
}

/** Net pay per staff for bank/bKash bulk upload — cash EXCLUDED (§4.6). Locked run only. */
export async function paymentExport(runId: string): Promise<PaymentExportRow[]> {
  const run = await PayrollRun.findById(runId).lean();
  if (!run) throw new PayrollError("Payroll run not found");
  if (run.status !== "approved_locked") throw new PayrollError("Payment export issues only from a locked run (§4.6)");
  const slips = await Payslip.find({ payrollRunId: new Types.ObjectId(runId), paymentMethod: { $ne: "cash" } }).lean();
  const staff = await StaffProfile.find({ _id: { $in: slips.map((s) => s.staffProfileId) } })
    .select("bankAccount")
    .lean();
  const acctById = new Map(staff.map((s) => [s._id.toString(), s.bankAccount ?? null]));
  return slips
    .map((s) => ({
      staffProfileId: s.staffProfileId.toString(),
      name: s.snapshotName,
      paymentMethod: s.paymentMethod ?? "",
      account: acctById.get(s.staffProfileId.toString()) ?? null,
      netPay: s.netPay,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
