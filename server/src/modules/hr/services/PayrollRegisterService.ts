/**
 * The payroll REGISTER (D-#625) — the accounting view of a run.
 *
 * The advice pack is a payment INSTRUCTION: split by channel, and deliberately silent
 * about anyone the run cannot pay and about every deduction that produced the figure.
 * That is right for a bank and useless for accounts, who need the opposite — one row per
 * person, every line that moved the money, and totals that reconcile.
 *
 * So this is a second VIEW of the same payslips, never a second computation of them.
 * Nothing here re-derives pay: it buckets the stored `deductions` and `additions` by type
 * and adds them up. `check` exists to prove exactly that. `computePayslip` guarantees
 * `net = gross + additions − deductions`, so a non-zero `check` on any row means the
 * stored payslip disagrees with itself — and accounts should see that rather than a
 * balanced-looking sheet.
 *
 * Available on a PREPARED run, not only a locked one. Checking the numbers before
 * approving is the main thing an accountant wants this for, and a run that cannot be
 * inspected until it is frozen gets approved unread.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import {
  PAY_ADDITION_TYPES,
  PAY_DEDUCTION_TYPES,
  type PayAdditionType,
  type PayDeductionType,
  type PaymentMethod,
} from "@scd/shared";
import { PayrollRun } from "../models/PayrollRun";
import { Payslip, type IPayLine, type IPayslip } from "../models/Payslip";
import { AdvanceLoan } from "../models/AdvanceLoan";
import { PayrollError } from "./payrollMath";

export type DeductionTotals = Record<PayDeductionType, number>;
export type AdditionTotals = Record<PayAdditionType, number>;

export interface RegisterRow {
  name: string;
  category: string;
  paymentMethod: PaymentMethod | null;
  grossSalary: number;
  unpaidLeaveDays: number;
  deductions: DeductionTotals;
  additions: AdditionTotals;
  totalDeductions: number;
  totalAdditions: number;
  netPay: number;
  /**
   * gross + (bucketed additions) − (bucketed deductions) − net. Zero on every
   * well-formed payslip, and deliberately built from the BUCKETS rather than the
   * payslip's own totals — see `registerRowFrom`.
   */
  check: number;
}

/** One itemised line behind the register's columns, for the detail sheet. */
export interface RegisterLine {
  name: string;
  kind: "addition" | "deduction";
  type: string;
  days: number | null;
  amount: number;
  note: string;
}

export interface RegisterAdvance {
  name: string;
  recoveredThisRun: number;
  /** TODAY's outstanding figure — see `payrollRegister` for why it is not a closing balance. */
  balanceNow: number;
  status: string;
  recoveryMode: string;
}

export interface PayrollRegister {
  monthKey: string;
  status: string;
  workingDays: number;
  preparedAt: Date;
  approvedAt: Date | null;
  rows: RegisterRow[];
  totals: RegisterRow;
  lines: RegisterLine[];
  advances: RegisterAdvance[];
}

const zeroDeductions = (): DeductionTotals =>
  Object.fromEntries(PAY_DEDUCTION_TYPES.map((t) => [t, 0])) as DeductionTotals;
const zeroAdditions = (): AdditionTotals =>
  Object.fromEntries(PAY_ADDITION_TYPES.map((t) => [t, 0])) as AdditionTotals;

/**
 * Bucket a payslip's lines by type.
 *
 * An UNKNOWN type has no column to land in, so it is left out — and `registerRowFrom`
 * measures `check` against these buckets precisely so that it cannot be left out
 * SILENTLY. The failure worth designing for is a type added to the enum later and a
 * register that under-reports money the payslip did in fact move.
 */
export function bucketLines<T extends string>(
  lines: IPayLine[],
  known: readonly T[],
  zero: () => Record<T, number>,
): Record<T, number> {
  const out = zero();
  for (const l of lines) {
    if ((known as readonly string[]).includes(l.type)) out[l.type as T] += l.amount;
  }
  return out;
}

/**
 * One payslip as a register row. Buckets and sums; never recomputes pay.
 *
 * `check` is measured against the BUCKETS, not against the payslip's stored totals, and
 * that choice is what makes it worth printing. Built from the stored totals it would only
 * restate an identity `computePayslip` already guarantees, and would sit at zero while a
 * line type the register does not recognise quietly went missing from the columns. Built
 * from the buckets it catches both: a payslip that disagrees with itself, AND a column
 * set that no longer adds up to the money the payslip actually moved.
 */
export function registerRowFrom(p: IPayslip): RegisterRow {
  const deductions = bucketLines(p.deductions ?? [], PAY_DEDUCTION_TYPES, zeroDeductions);
  const additions = bucketLines(p.additions ?? [], PAY_ADDITION_TYPES, zeroAdditions);
  const bucketedDeductions = Object.values(deductions).reduce((a, b) => a + b, 0);
  const bucketedAdditions = Object.values(additions).reduce((a, b) => a + b, 0);
  return {
    name: p.snapshotName,
    category: p.category,
    paymentMethod: p.paymentMethod ?? null,
    grossSalary: p.grossSalary,
    unpaidLeaveDays: p.unpaidLeaveDays ?? 0,
    deductions,
    additions,
    totalDeductions: p.totalDeductions,
    totalAdditions: p.totalAdditions,
    netPay: p.netPay,
    check: p.grossSalary + bucketedAdditions - bucketedDeductions - p.netPay,
  };
}

/**
 * The column totals, as a row of the same shape.
 *
 * `check` is summed like every other column, and that total is a GLANCE, not the
 * assertion: two rows out by +500 and −500 would cancel here. The real check is per row,
 * which is why the row-level cell is the one the workbook turns red.
 */
export function registerTotals(rows: RegisterRow[]): RegisterRow {
  const total: RegisterRow = {
    name: "Total",
    category: "",
    paymentMethod: null,
    grossSalary: 0,
    unpaidLeaveDays: 0,
    deductions: zeroDeductions(),
    additions: zeroAdditions(),
    totalDeductions: 0,
    totalAdditions: 0,
    netPay: 0,
    check: 0,
  };
  for (const r of rows) {
    total.grossSalary += r.grossSalary;
    total.unpaidLeaveDays += r.unpaidLeaveDays;
    total.totalDeductions += r.totalDeductions;
    total.totalAdditions += r.totalAdditions;
    total.netPay += r.netPay;
    total.check += r.check;
    for (const t of PAY_DEDUCTION_TYPES) total.deductions[t] += r.deductions[t];
    for (const t of PAY_ADDITION_TYPES) total.additions[t] += r.additions[t];
  }
  return total;
}

/** Every itemised line, flattened, in the order the sheet reads. */
export function registerLines(slips: IPayslip[]): RegisterLine[] {
  const out: RegisterLine[] = [];
  for (const p of slips) {
    for (const l of p.additions ?? []) {
      out.push({
        name: p.snapshotName,
        kind: "addition",
        type: l.type,
        days: l.days ?? null,
        amount: l.amount,
        note: l.note ?? "",
      });
    }
    for (const l of p.deductions ?? []) {
      out.push({
        name: p.snapshotName,
        kind: "deduction",
        type: l.type,
        days: l.days ?? null,
        amount: l.amount,
        note: l.note ?? "",
      });
    }
  }
  return out;
}

/**
 * The register for one run.
 *
 * THE QARD SHEET REPORTS WHAT IS KNOWN, NOT WHAT IS INFERRED. `recoveredThisRun` is
 * stored on the payslip and is always right. The loan's balance is not: recovery commits
 * at LOCK time, so on a prepared run it has not moved yet, and on an older locked run a
 * later run may have moved it again. A "closing balance" column would therefore be a
 * guess dressed as a figure, on a sheet going to accounts. So the balance is labelled as
 * today's, and the arithmetic between the two is left to a human who knows which runs exist.
 */
export async function payrollRegister(runId: string): Promise<PayrollRegister> {
  if (!Types.ObjectId.isValid(runId)) throw new PayrollError("Payroll run not found");
  const run = await PayrollRun.findById(runId).lean();
  if (!run) throw new PayrollError("Payroll run not found");
  if (run.status === "cancelled") {
    throw new PayrollError("A cancelled run has no register — its payslips were deleted");
  }

  const slips = (await Payslip.find({ payrollRunId: run._id })
    .sort({ snapshotName: 1 })
    .lean()) as unknown as IPayslip[];

  const rows = slips.map(registerRowFrom);

  const advances: RegisterAdvance[] = [];
  for (const p of slips) {
    if (!(p.advanceRepaid > 0) || !p.advanceId) continue;
    const loan = await AdvanceLoan.findById(p.advanceId).lean();
    advances.push({
      name: p.snapshotName,
      recoveredThisRun: p.advanceRepaid,
      balanceNow: loan?.balance ?? 0,
      status: loan?.status ?? "unknown",
      recoveryMode: loan?.recoveryMode ?? "unknown",
    });
  }

  return {
    monthKey: run.monthKey,
    status: run.status,
    workingDays: run.workingDays,
    preparedAt: run.preparedAt,
    approvedAt: run.approvedAt ?? null,
    rows,
    totals: registerTotals(rows),
    lines: registerLines(slips),
    advances,
  };
}
