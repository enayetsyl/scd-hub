/**
 * HrPayrollBridge (FIN-2A, prd-finance-fin2.md §3.A/§5, D-#228) — the PII-free read seam
 * that pre-fills the monthly SALARY expense from HR payroll. It returns ONLY the
 * aggregate net-payable figure (Σ payslip.netPay over the `approved_locked` run for a
 * month); NO individual payslip / per-staff row ever crosses into finance — the ADR-005
 * PII boundary holds (finance never reads who was paid what).
 *
 * Both planes are identity/operational (HR payroll + finance) — this import is allowed;
 * the firewall only blocks the corpus plane, and finance reads no corpus model here.
 */
import { PayrollRun } from "../../hr/models/PayrollRun";
import { Payslip } from "../../hr/models/Payslip";

export interface HrNetPayableTotal {
  monthKey: string;
  /** Σ netPay over the approved_locked run (0 when no locked run exists). */
  total: number;
  /** True iff an approved_locked run exists for the month. */
  found: boolean;
}

/**
 * The month's HR net-payable aggregate (approved_locked run only). PII-free: the return
 * is a single number, never a payslip. An unlocked / absent run ⇒ { total: 0, found: false }.
 */
export async function hrPayrollNetPayableTotal(monthKey: string): Promise<HrNetPayableTotal> {
  const run = await PayrollRun.findOne({ monthKey, status: "approved_locked" }).lean<{ _id: unknown }>();
  if (!run) return { monthKey, total: 0, found: false };
  const slips = await Payslip.find({ payrollRunId: run._id }).lean<Array<{ netPay: number }>>();
  const total = slips.reduce((sum, s) => sum + (s.netPay ?? 0), 0);
  return { monthKey, total, found: true };
}
