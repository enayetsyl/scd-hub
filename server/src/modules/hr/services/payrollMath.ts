/**
 * Payroll math (HR-3; prd-hr §4 — pure, unit-tested directly).
 *
 * net = consolidated gross − deductions + additions (§4.2). The ONLY always-on
 * attendance-driven deduction is unpaid leave at the day-rate (§4.3, D-#26); advance
 * repayment carries a NET-PAY GUARD (a repayment never pushes net negative — the
 * excess caps and rolls forward, §4.5/D-#27). All figures are whole-taka rounded.
 */
import type { PayDeductionType, PayAdditionType } from "@scd/shared";
import { isSchoolDay } from "../../trackers/calendar";

export class PayrollError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PayrollError";
  }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export function assertMonthKey(monthKey: string): void {
  if (!MONTH_RE.test(monthKey)) throw new PayrollError(`Invalid month key (want YYYY-MM): ${monthKey}`);
}

/** Day-rate = monthly ÷ that month's working days (§4.1 default basis). */
export function dayRate(monthlySalary: number, workingDays: number): number {
  if (workingDays <= 0) throw new PayrollError("workingDays must be ≥ 1");
  return Math.round(monthlySalary / workingDays);
}

/** Sun–Thu days in [fromKey, toKey] inclusive — the school week the run's
 *  `workingDays` is counted on (trackers/calendar.ts is the one source of that rule). */
function weekdaysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  const cursor = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  let n = 0;
  for (; cursor <= end; cursor.setDate(cursor.getDate() + 1)) if (isSchoolDay(cursor)) n += 1;
  return n;
}

/**
 * How many of this month's working days a staff member was actually employed for —
 * a mid-month joiner from their joining date, a leaver up to their last working day.
 *
 * Returns `null` for a full month (pay the salary as-is, no day-rate rounding), `0`
 * when the whole month falls outside their service, else the pro-rated day count.
 *
 * The count is the share of the month's Sun–Thu days that fall inside the service
 * span, scaled onto the run's own `workingDays`. When the Office enters the plain
 * Sun–Thu count (22 for Sept 2026) the scaling is exact; when they enter fewer (a
 * holiday taken out) a leaver still gets the same SHARE of the month, not a figure
 * counted on a different basis from the day-rate it is multiplied by.
 */
export function payableDaysInMonth(input: {
  monthKey: string;
  workingDays: number;
  joinedKey?: string | null;
  lastDayKey?: string | null;
}): number | null {
  const [y, m] = input.monthKey.split("-").map(Number);
  const monthStart = `${input.monthKey}-01`;
  const monthEnd = `${input.monthKey}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const from = input.joinedKey && input.joinedKey > monthStart ? input.joinedKey : monthStart;
  const to = input.lastDayKey && input.lastDayKey < monthEnd ? input.lastDayKey : monthEnd;
  if (from === monthStart && to === monthEnd) return null;
  if (from > to) return 0;
  const monthDays = weekdaysBetween(monthStart, monthEnd);
  const served = weekdaysBetween(from, to);
  return Math.min(input.workingDays, Math.round((served / monthDays) * input.workingDays));
}

export interface PayLineInput {
  type: PayDeductionType | PayAdditionType;
  amount: number;
  days?: number;
  note?: string;
}

export interface AdvanceRecovery {
  advanceId: string;
  recoveryMode: "one_shot" | "installments";
  installmentAmount?: number;
  balance: number;
}

export interface ComputePayslipInput {
  grossSalary: number;
  dayRate: number;
  unpaidLeaveDays: number;
  /** Optional Principal-configured lateness deduction (off by default, §4.3/D-#26). */
  latenessDeduction?: number;
  /** Manual arrears/bonus/encashment/statutory/other lines (§4.4 + the D-#110 seam). */
  manualDeductions?: PayLineInput[];
  manualAdditions?: PayLineInput[];
  advance?: AdvanceRecovery | null;
}

export interface ComputedPayslip {
  deductions: PayLineInput[];
  additions: PayLineInput[];
  totalDeductions: number;
  totalAdditions: number;
  netPay: number;
  advanceRepaid: number;
  advanceId: string | null;
}

const sum = (lines: PayLineInput[]) => lines.reduce((s, l) => s + l.amount, 0);

/**
 * Compute one payslip. Order: unpaid-leave + optional lateness + manual deductions
 * are taken first; additions are added; THEN the advance repayment is sized against
 * the running net so it can never drive net below zero (the §4.5 net-pay guard).
 */
export function computePayslip(input: ComputePayslipInput): ComputedPayslip {
  // Additions are whole-taka rounded too (mirrors deductions below) so net can
  // never come out fractional — the header invariant "all figures whole-taka".
  const additions: PayLineInput[] = (input.manualAdditions ?? []).map((a) => ({
    ...a,
    amount: Math.round(a.amount),
  }));
  const deductions: PayLineInput[] = [];

  if (input.unpaidLeaveDays > 0) {
    deductions.push({
      type: "unpaid_leave",
      amount: Math.round(input.dayRate * input.unpaidLeaveDays),
      days: input.unpaidLeaveDays,
    });
  }
  if (input.latenessDeduction && input.latenessDeduction > 0) {
    deductions.push({ type: "lateness", amount: Math.round(input.latenessDeduction) });
  }
  for (const d of input.manualDeductions ?? []) deductions.push({ ...d, amount: Math.round(d.amount) });

  const additionsTotal = sum(additions);
  const preAdvanceDeductions = sum(deductions);
  // Net available before advance recovery — the guard ceiling.
  const netBeforeAdvance = input.grossSalary + additionsTotal - preAdvanceDeductions;

  let advanceRepaid = 0;
  let advanceId: string | null = null;
  if (input.advance && input.advance.balance > 0) {
    advanceId = input.advance.advanceId;
    const desired =
      input.advance.recoveryMode === "one_shot"
        ? input.advance.balance
        : Math.min(input.advance.installmentAmount ?? input.advance.balance, input.advance.balance);
    // NET-PAY GUARD: never push net below zero; the excess rolls forward in `balance`.
    advanceRepaid = Math.max(0, Math.min(desired, netBeforeAdvance));
    if (advanceRepaid > 0) {
      // No note: it used to be `advance <ObjectId>`, and that string is PRINTED on the
      // payslip line a teacher reads. The id is already on the payslip's `advanceId`
      // field, which is where a system needs it and a person does not.
      deductions.push({ type: "advance_repayment", amount: advanceRepaid });
    }
  }

  const totalDeductions = sum(deductions);
  const totalAdditions = additionsTotal;
  const netPay = input.grossSalary + totalAdditions - totalDeductions;
  return { deductions, additions, totalDeductions, totalAdditions, netPay, advanceRepaid, advanceId };
}
