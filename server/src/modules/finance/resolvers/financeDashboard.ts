/**
 * Finance dashboard / rollup resolvers (FIN-6A, prd-finance-fin6.md §3/§6, J-FIN6-1/2).
 *
 * The derived Principal-dashboard reads — monthly report, year overview/KPIs, YTD income
 * statement, trends. EVERY field is gated `finance:manage` (Principal+Office); guardian
 * none (the finance wall, J-FIN6-4). Identity plane; no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { FinanceError } from "../services/FinanceLedgerService";
import {
  monthlyReport,
  yearOverview,
  ytdIncomeStatement,
  financeTrends,
  type MonthlyReport,
  type YearOverview,
  type YtdIncomeStatement,
  type TrendPoint,
} from "../services/FinanceRollupService";
import type { ILedgerTriple } from "../models/ReconciliationEntry";

function parseDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new FinanceError(`তারিখ বৈধ নয়: ${value}`);
  return d;
}

// --- shared small refs ------------------------------------------------------

const HeadTotalRef = builder.objectRef<{ head: string; amount: number }>("FinanceRollupHeadTotal");
HeadTotalRef.implement({
  fields: (t) => ({ head: t.exposeString("head"), amount: t.exposeFloat("amount") }),
});

const TripleRef = builder.objectRef<ILedgerTriple>("FinanceRollupTriple");
TripleRef.implement({
  fields: (t) => ({ CASH: t.exposeFloat("CASH"), BANK: t.exposeFloat("BANK"), ONLINE: t.exposeFloat("ONLINE") }),
});

// --- monthly report ---------------------------------------------------------

const LedgerSnapshotRef = builder.objectRef<{ ledger: string; balance: number }>("FinanceLedgerSnapshotCell");
LedgerSnapshotRef.implement({
  fields: (t) => ({ ledger: t.exposeString("ledger"), balance: t.exposeFloat("balance") }),
});

const MonthlyReportRef = builder.objectRef<MonthlyReport>("FinanceMonthlyReport");
MonthlyReportRef.implement({
  fields: (t) => ({
    month: t.exposeString("month"),
    feeByHead: t.field({ type: [HeadTotalRef], resolve: (r) => r.feeByHead }),
    incomeByHead: t.field({ type: [HeadTotalRef], resolve: (r) => r.incomeByHead }),
    expenseByHead: t.field({ type: [HeadTotalRef], resolve: (r) => r.expenseByHead }),
    totalIn: t.exposeFloat("totalIn"),
    totalOut: t.exposeFloat("totalOut"),
    net: t.exposeFloat("net"),
    ledgerSnapshot: t.field({ type: [LedgerSnapshotRef], resolve: (r) => r.ledgerSnapshot }),
  }),
});

// --- year overview ----------------------------------------------------------

const LastReconRef = builder.objectRef<NonNullable<YearOverview["lastReconciliation"]>>("FinanceLastRecon");
LastReconRef.implement({
  fields: (t) => ({
    date: t.exposeString("date"),
    bankDiff: t.float({ nullable: true, resolve: (r) => r.bankDiff }),
    eximusDiff: t.field({ type: TripleRef, nullable: true, resolve: (r) => r.eximusDiff }),
  }),
});

const YearOverviewRef = builder.objectRef<YearOverview>("FinanceYearOverview");
YearOverviewRef.implement({
  fields: (t) => ({
    academicYearId: t.exposeString("academicYearId"),
    cashPosition: t.exposeFloat("cashPosition"),
    ytdIncome: t.exposeFloat("ytdIncome"),
    ytdExpense: t.exposeFloat("ytdExpense"),
    ytdSurplus: t.exposeFloat("ytdSurplus"),
    qardOutstanding: t.exposeFloat("qardOutstanding"),
    iouOutstanding: t.exposeFloat("iouOutstanding"),
    zakatApplied: t.exposeFloat("zakatApplied"),
    providerReceivableOutstanding: t.exposeFloat("providerReceivableOutstanding"),
    feesDueOutstanding: t.exposeFloat("feesDueOutstanding"),
    lastReconciliation: t.field({ type: LastReconRef, nullable: true, resolve: (r) => r.lastReconciliation }),
  }),
});

// --- YTD income statement ---------------------------------------------------

const StatementLineRef = builder.objectRef<{ head: string; amount: number }>("FinanceIncomeStatementLine");
StatementLineRef.implement({
  fields: (t) => ({ head: t.exposeString("head"), amount: t.exposeFloat("amount") }),
});

const IncomeStatementRef = builder.objectRef<YtdIncomeStatement>("FinanceYtdIncomeStatement");
IncomeStatementRef.implement({
  fields: (t) => ({
    academicYearId: t.exposeString("academicYearId"),
    incomeLines: t.field({ type: [StatementLineRef], resolve: (s) => s.incomeLines }),
    expenseLines: t.field({ type: [StatementLineRef], resolve: (s) => s.expenseLines }),
    totalIncome: t.exposeFloat("totalIncome"),
    totalExpense: t.exposeFloat("totalExpense"),
    net: t.exposeFloat("net"),
  }),
});

// --- trends -----------------------------------------------------------------

const TrendPointRef = builder.objectRef<TrendPoint>("FinanceTrendPoint");
TrendPointRef.implement({
  fields: (t) => ({
    monthKey: t.exposeString("monthKey"),
    income: t.exposeFloat("income"),
    expense: t.exposeFloat("expense"),
    net: t.exposeFloat("net"),
  }),
});

// --- Reads (finance:manage) -------------------------------------------------

builder.queryField("financeMonthlyReport", (t) =>
  t.field({
    type: MonthlyReportRef,
    description: "The month's income/expense by head + the month-end ledger snapshot + net (derived). Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { month: t.arg.string({ required: true }) },
    resolve: (_root, args) => monthlyReport(args.month),
  }),
);

builder.queryField("financeYearOverview", (t) =>
  t.field({
    type: YearOverviewRef,
    description: "The Principal-dashboard KPI bundle for a year (derived, no cross-file stitching). Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { academicYearId: t.arg.string({ required: true }), asOf: t.arg.string({ required: false }) },
    resolve: (_root, args) => yearOverview(args.academicYearId, args.asOf ? parseDate(args.asOf) : undefined),
  }),
);

builder.queryField("financeYtdIncomeStatement", (t) =>
  t.field({
    type: IncomeStatementRef,
    description: "The YTD income-statement view (income − expense = net; not a GL). Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { academicYearId: t.arg.string({ required: true }), asOf: t.arg.string({ required: false }) },
    resolve: (_root, args) => ytdIncomeStatement(args.academicYearId, args.asOf ? parseDate(args.asOf) : undefined),
  }),
);

builder.queryField("financeTrends", (t) =>
  t.field({
    type: [TrendPointRef],
    description: "Monthly income/expense/net series for the year (charts). Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { academicYearId: t.arg.string({ required: true }), asOf: t.arg.string({ required: false }) },
    resolve: (_root, args) => financeTrends(args.academicYearId, args.asOf ? parseDate(args.asOf) : undefined),
  }),
);
