/**
 * FinanceRollupService (FIN-6A, prd-finance-fin6.md §3, D-#239) — the Principal-dashboard
 * rollups. ALL DERIVED over the existing FIN-1..FIN-5 data (no new model, D-#85): the
 * monthly report, the year overview / KPIs, the YTD income statement, and the trend series.
 * Composes `ledgerBalanceAsOf` / `monthToDate` / `surplusDeficit` / `budgetVsActual` / the
 * FIN-2B provider statements / FIN-4 reconciliation. Income-statement view only — not a
 * double-entry GL (REQ §1).
 *
 * Identity/operational plane; NO corpus path (ADR-005).
 */
import { allLedgerBalancesAsOf, ledgerBalanceAsOf } from "./FinanceLedgerService";
import { monthToDate, type HeadTotal } from "./FinanceSnapshotService";
import { surplusDeficit, budgetVsActual } from "./BudgetService";
import { providerStatements, totalGuardianDueOutstanding } from "./FeeSupportService";
import { mostRecentReconciliation } from "./ReconciliationService";
import type { ILedgerTriple } from "../models/ReconciliationEntry";

function endOfDay(dateKey: string): Date {
  return new Date(`${dateKey}T23:59:59.999Z`);
}
const monthEndKey = (month: string): string => {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0); // last day of `month`
  return end.toISOString().slice(0, 10);
};

export interface LedgerSnapshotCell {
  ledger: string;
  balance: number;
}
export interface MonthlyReport {
  month: string;
  feeByHead: HeadTotal[];
  incomeByHead: HeadTotal[];
  expenseByHead: HeadTotal[];
  totalIn: number;
  totalOut: number;
  net: number;
  ledgerSnapshot: LedgerSnapshotCell[];
}

/** The Daily-tab month report (J-FIN6-2): income/expense by head + the month-end per-ledger
 *  snapshot + net, all derived. */
export async function monthlyReport(month: string): Promise<MonthlyReport> {
  const mtd = await monthToDate(month);
  const asOf = endOfDay(monthEndKey(month));
  const balances = await allLedgerBalancesAsOf(asOf);
  return {
    month,
    feeByHead: mtd.feeByHead,
    incomeByHead: mtd.incomeByHead,
    expenseByHead: mtd.expenseByHead,
    totalIn: mtd.totalIn,
    totalOut: mtd.totalOut,
    net: mtd.totalIn - mtd.totalOut,
    ledgerSnapshot: balances.map((b) => ({ ledger: b.ledger, balance: b.amount })),
  };
}

export interface YearOverview {
  academicYearId: string;
  /** Σ Cash + Bank + Online balances as of now. */
  cashPosition: number;
  ytdIncome: number;
  ytdExpense: number;
  ytdSurplus: number;
  qardOutstanding: number;
  iouOutstanding: number;
  /** Σ provider-due raised across providers (zakat support applied). */
  zakatApplied: number;
  /** Σ provider receivable outstanding (raised − received). */
  providerReceivableOutstanding: number;
  /** School-wide outstanding guardian fee-due. */
  feesDueOutstanding: number;
  /** The most recent reconciliation's diffs (null when none). */
  lastReconciliation: { date: string; bankDiff: number | null; eximusDiff: ILedgerTriple | null } | null;
}

/** The year KPI bundle (J-FIN6-1) — one live view, no cross-file stitching. */
export async function yearOverview(academicYearId: string, asOf: Date = new Date()): Promise<YearOverview> {
  const [cash, bank, online, qard, iou, sd, providers, feesDue, lastRecon] = await Promise.all([
    ledgerBalanceAsOf("CASH", asOf),
    ledgerBalanceAsOf("BANK", asOf),
    ledgerBalanceAsOf("ONLINE", asOf),
    ledgerBalanceAsOf("QARD_CONTROL", asOf),
    ledgerBalanceAsOf("IOU_CONTROL", asOf),
    surplusDeficit(academicYearId, asOf),
    providerStatements(),
    totalGuardianDueOutstanding(asOf),
    mostRecentReconciliation(),
  ]);

  const zakatApplied = providers.reduce((s, p) => s + p.raised, 0);
  const providerReceivableOutstanding = providers.reduce((s, p) => s + p.outstanding, 0);

  return {
    academicYearId,
    cashPosition: cash + bank + online,
    ytdIncome: sd.ytdIncome,
    ytdExpense: sd.ytdExpense,
    ytdSurplus: sd.ytdSurplus,
    qardOutstanding: qard,
    iouOutstanding: iou,
    zakatApplied,
    providerReceivableOutstanding,
    feesDueOutstanding: feesDue,
    lastReconciliation: lastRecon
      ? { date: lastRecon.date.toISOString(), bankDiff: lastRecon.bankDiff ?? null, eximusDiff: lastRecon.eximusDiff ?? null }
      : null,
  };
}

export interface IncomeStatementLine {
  head: string;
  amount: number;
}
export interface YtdIncomeStatement {
  academicYearId: string;
  incomeLines: IncomeStatementLine[];
  expenseLines: IncomeStatementLine[];
  totalIncome: number;
  totalExpense: number;
  net: number;
}

/** The YTD income-statement view (income heads − expense heads = net) — NOT a GL (REQ §1).
 *  Built from the FIN-5 budget-vs-actual ACTUALS (cumulative ≤ asOf), so heads agree. */
export async function ytdIncomeStatement(academicYearId: string, asOf: Date = new Date()): Promise<YtdIncomeStatement> {
  const bva = await budgetVsActual(academicYearId, asOf);
  const incomeLines: IncomeStatementLine[] = [];
  const expenseLines: IncomeStatementLine[] = [];
  for (const line of bva.lines) {
    const cell = { head: line.head, amount: line.cumulativeActual };
    if (line.kind === "INCOME") incomeLines.push(cell);
    else expenseLines.push(cell);
  }
  const totalIncome = incomeLines.reduce((s, l) => s + l.amount, 0);
  const totalExpense = expenseLines.reduce((s, l) => s + l.amount, 0);
  return { academicYearId, incomeLines, expenseLines, totalIncome, totalExpense, net: totalIncome - totalExpense };
}

export interface TrendPoint {
  monthKey: string;
  income: number;
  expense: number;
  net: number;
}

/** Monthly income/expense/net series for the year (charts, J-FIN6 dashboard). */
export async function financeTrends(academicYearId: string, asOf: Date = new Date()): Promise<TrendPoint[]> {
  const sd = await surplusDeficit(academicYearId, asOf);
  return sd.months.map((m) => ({ monthKey: m.monthKey, income: m.income, expense: m.expense, net: m.surplus }));
}
