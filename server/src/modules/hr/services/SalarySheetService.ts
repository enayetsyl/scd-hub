/**
 * The SALARY SHEET (D-#914) — the register, grouped the way the money goes out.
 *
 * The office pays a month in three bundles: one transfer letter to the school's own bank,
 * one BEFTN letter for everyone at another bank, and a cash voucher. Each bundle's voucher
 * needs a sheet behind it saying, per person, what the salary was, what came off it and
 * why, and what was paid. Until now that sheet was typed up by hand from the payslips.
 *
 * So this is the register (D-#625) — same rows, same bucketed deduction and addition
 * columns, same `check` — with each person placed on the channel the advice pack would put
 * them on (`channelFor`), and a subtotal per channel. Each channel's NET subtotal is the
 * figure on that channel's bank letter or cash voucher; the grand total is the month.
 *
 * Nothing is recomputed: rows come from `registerRowFrom`, totals from `registerTotals`.
 * Offered on a PREPARED run as well as a locked one (the register's own reasoning — the
 * numbers are checked before approval), and stamped as a draft when it is one.
 *
 * Unlike the advice pack, nobody is left off: a person the bank sheet would block (no
 * account number) still drew a salary, and an expense sheet that drops them under-reports
 * the month. They sit on the channel their payment method points to.
 *
 * The columns follow the voucher, not the payslip (D-#929). The accounting app books the
 * month as a salary EXPENSE paid out, then each recovery (advance, loan) as money back in.
 * Unpaid leave and lateness are neither: no cash ever moved for them, so booking the gross
 * as the expense sent cash out that never left. So the sheet reads left to right:
 *   gross − NOT-PAID deductions (unpaid leave, lateness) + additions = SALARY EXPENSE
 *   salary expense − ADJUSTMENTS (advance, statutory, other) = NET PAY
 * The breakdown of the not-paid lines stays in SCD Hub; the voucher takes the expense.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import {
  PAY_ADDITION_TYPES,
  PAY_DEDUCTION_TYPES,
  type PayAdditionType,
  type PayDeductionType,
  type PaymentChannel,
} from "@scd/shared";
import { PayrollRun } from "../models/PayrollRun";
import { Payslip, type IPayslip } from "../models/Payslip";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { registerRowFrom, registerTotals, type RegisterRow } from "./PayrollRegisterService";
import { channelFor } from "./PaymentAdviceService";
import { getHrPolicy, type HrPolicyView } from "./HrPolicyService";
import { PayrollError } from "./payrollMath";

export interface SheetGroup {
  channel: PaymentChannel;
  rows: RegisterRow[];
  subtotal: RegisterRow;
}

export interface SalarySheet {
  monthKey: string;
  status: string;
  workingDays: number;
  policy: HrPolicyView;
  groups: SheetGroup[];
  total: RegisterRow;
  /** Only the kinds that moved money this month get a column — a sheet of empty columns is noise. */
  notPaidColumns: PayDeductionType[];
  additionColumns: PayAdditionType[];
  adjustmentColumns: PayDeductionType[];
}

/** The bank letters first (they go out first), then bKash, then the cash voucher. */
const CHANNEL_ORDER: PaymentChannel[] = ["internal", "beftn", "bkash", "cash"];

/**
 * Deductions the school never pays and never gets back — they come off the expense itself.
 * Every other kind is an ADJUSTMENT: the salary was earned (an expense) and part of it went
 * to settle something else — an advance, tax held for the government, a manual "other"
 * (in practice a loan recovered by hand).
 */
export const NOT_PAID_DEDUCTIONS: readonly PayDeductionType[] = ["unpaid_leave", "lateness"];

/** PURE — what the voucher books as salary expense: gross − not-paid lines + every addition. */
export function salaryExpense(r: RegisterRow): number {
  const notPaid = NOT_PAID_DEDUCTIONS.reduce((sum, t) => sum + r.deductions[t], 0);
  const added = PAY_ADDITION_TYPES.reduce((sum, t) => sum + r.additions[t], 0);
  return r.grossSalary - notPaid + added;
}

/** The deduction and addition kinds with a non-zero total, in the vocabulary's order. */
export function usedColumns(total: RegisterRow): {
  notPaidColumns: PayDeductionType[];
  additionColumns: PayAdditionType[];
  adjustmentColumns: PayDeductionType[];
} {
  const used = PAY_DEDUCTION_TYPES.filter((t) => total.deductions[t] !== 0);
  return {
    notPaidColumns: used.filter((t) => NOT_PAID_DEDUCTIONS.includes(t)),
    additionColumns: PAY_ADDITION_TYPES.filter((t) => total.additions[t] !== 0),
    adjustmentColumns: used.filter((t) => !NOT_PAID_DEDUCTIONS.includes(t)),
  };
}

/** PURE — rows already placed on a channel, grouped in channel order with subtotals. */
export function groupSheetRows(placed: Array<{ channel: PaymentChannel; row: RegisterRow }>): SheetGroup[] {
  return CHANNEL_ORDER.map((channel) => {
    const rows = placed
      .filter((p) => p.channel === channel)
      .map((p) => p.row)
      .sort((a, b) => a.name.localeCompare(b.name));
    return { channel, rows, subtotal: { ...registerTotals(rows), name: "Subtotal" } };
  }).filter((g) => g.rows.length > 0);
}

export async function salarySheet(runId: string): Promise<SalarySheet> {
  if (!Types.ObjectId.isValid(runId)) throw new PayrollError("Payroll run not found");
  const run = await PayrollRun.findById(runId).lean();
  if (!run) throw new PayrollError("Payroll run not found");
  if (run.status === "cancelled") {
    throw new PayrollError("A cancelled run has no salary sheet — its payslips were deleted");
  }

  const policy = await getHrPolicy();
  const slips = (await Payslip.find({ payrollRunId: run._id }).lean()) as unknown as IPayslip[];
  const staff = await StaffProfile.find({ _id: { $in: slips.map((s) => s.staffProfileId) } })
    .select("bankName")
    .lean();
  const bankOf = new Map(staff.map((s) => [s._id.toString(), s.bankName ?? null]));

  const groups = groupSheetRows(
    slips.map((p) => ({
      channel: channelFor(p.paymentMethod, bankOf.get(p.staffProfileId.toString()), policy.schoolBankName),
      row: registerRowFrom(p),
    })),
  );
  const total = { ...registerTotals(groups.flatMap((g) => g.rows)), name: "Grand total" };

  return {
    monthKey: run.monthKey,
    status: run.status,
    workingDays: run.workingDays,
    policy,
    groups,
    total,
    ...usedColumns(total),
  };
}
