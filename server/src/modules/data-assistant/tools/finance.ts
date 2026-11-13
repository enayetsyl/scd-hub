/**
 * finance_summary, fee_dues (docs/prd-data-assistant-mcp.md §7 tools 20–21).
 *
 * fee_dues gate (build-time finding, D-#1567): the code has NO staff query for one child's due or
 * the school's outstanding total under `fee_support:view` (that switch gates only the fee-provider
 * screens). The school total is shown on the finance dashboard (`financeYearOverview.feesDueOutstanding`);
 * one child's payments are `studentFeeHistory` (`finance_ledger:view`). The tool mirrors those two.
 * `chaseFeeDue` / `feeDueWaLink` are never called (they notify families and carry phones).
 */
import { z } from "zod";
import { monthlyReport, yearOverview, financeTrends } from "../../finance/services/FinanceRollupService";
import { dailySnapshot, monthToDate, studentFeeHistory } from "../../finance/services/FinanceSnapshotService";
import { guardianDueFor, totalGuardianDueOutstanding } from "../../finance/services/FeeSupportService";
import { assertRule, gateOf } from "../gates";
import { ToolInvalid, type ToolDef } from "../types";
import { cap, checkDay, currentYearIdOrThrow, DATE_KEY, MONTH_KEY, OBJECT_ID } from "./common";

const errToInvalid = async <T>(p: Promise<T>): Promise<T> => {
  try {
    return await p;
  } catch (e) {
    throw new ToolInvalid((e as Error)?.message || "invalid");
  }
};

const FIN_MONTH = { anyOf: ["finance_reports:view"] } as const;
const FIN_YEAR = { anyOf: ["finance_reports:view", "reports:finance_dashboard"] } as const;
const FIN_MTD = { anyOf: ["finance_ledger:view"] } as const;
const FIN_DAY = { anyOf: ["finance_ledger:view", "reports:daily_snapshot"] } as const;

const heads = (rows: Array<{ head: string; amount: number }>) => rows.slice(0, 60).map((r) => ({ head: r.head, amount: r.amount }));

export const financeSummary: ToolDef = {
  name: "finance_summary",
  label_bn: "হিসাব",
  label_en: "Finance",
  description:
    "School income and expense (আয়, ব্যয়, হিসাব, ফি আদায়, ক্যাশ). view month: a closed month's income / expense by head (month YYYY-MM); " +
    "year: the school year so far (cash, surplus, dues outstanding); trends: month by month this year; month_to_date: this month so far; day: each ledger's " +
    "opening / in / out / closing on a date.",
  input: { view: z.enum(["month", "year", "trends", "month_to_date", "day"]), month: MONTH_KEY.optional(), date: DATE_KEY.optional() },
  gates: [
    { mode: "month", rule: FIN_MONTH, resolver: { file: "modules/finance/resolvers/financeDashboard.ts", field: "financeMonthlyReport" } },
    { mode: "year", rule: FIN_YEAR, resolver: { file: "modules/finance/resolvers/financeDashboard.ts", field: "financeYearOverview" } },
    { mode: "trends", rule: FIN_YEAR, resolver: { file: "modules/finance/resolvers/financeDashboard.ts", field: "financeTrends" } },
    { mode: "month_to_date", rule: FIN_MTD, resolver: { file: "modules/finance/resolvers/financePosting.ts", field: "financeMonthToDate" } },
    { mode: "day", rule: FIN_DAY, resolver: { file: "modules/finance/resolvers/financePosting.ts", field: "financeDailySnapshot" } },
  ],
  maxRows: 60,
  async run(ctx, a) {
    const args = a as { view: "month" | "year" | "trends" | "month_to_date" | "day"; month?: string; date?: string };
    assertRule(ctx.auth, gateOf(financeSummary, args.view));
    const thisMonth = ctx.today.slice(0, 7);
    if (args.view === "month") {
      const r = await errToInvalid(monthlyReport(args.month ?? thisMonth));
      return {
        data: { month: r.month, fees_by_head: heads(r.feeByHead), income_by_head: heads(r.incomeByHead), expense_by_head: heads(r.expenseByHead), total_in: r.totalIn, total_out: r.totalOut, net: r.net, ledger_balances: r.ledgerSnapshot.map((l) => ({ ledger: l.ledger, balance: l.balance })) },
        rowCount: r.feeByHead.length + r.incomeByHead.length + r.expenseByHead.length,
      };
    }
    if (args.view === "month_to_date") {
      const r = await errToInvalid(monthToDate(args.month ?? thisMonth));
      return { data: { month: r.month, fees_by_head: heads(r.feeByHead), income_by_head: heads(r.incomeByHead), expense_by_head: heads(r.expenseByHead), total_in: r.totalIn, total_out: r.totalOut }, rowCount: r.feeByHead.length + r.incomeByHead.length + r.expenseByHead.length };
    }
    if (args.view === "day") {
      const date = args.date ?? ctx.today;
      checkDay(date, ctx.today, 400);
      const r = await errToInvalid(dailySnapshot(date));
      return { data: { date: r.date, ledgers: r.ledgers.map((l) => ({ ledger: l.ledger, opening: l.opening, in: l.in, out: l.out, closing: l.closing })) }, rowCount: r.ledgers.length };
    }
    const yearId = await currentYearIdOrThrow();
    if (args.view === "trends") {
      const t = await errToInvalid(financeTrends(yearId));
      return { data: { months: t.slice(0, 60).map((p) => ({ month: p.monthKey, income: p.income, expense: p.expense, net: p.net })) }, rowCount: t.length };
    }
    const y = await errToInvalid(yearOverview(yearId));
    return {
      data: {
        cash_position: y.cashPosition,
        income_so_far: y.ytdIncome,
        expense_so_far: y.ytdExpense,
        surplus_so_far: y.ytdSurplus,
        qard_outstanding: y.qardOutstanding,
        iou_outstanding: y.iouOutstanding,
        zakat_applied: y.zakatApplied,
        provider_receivable_outstanding: y.providerReceivableOutstanding,
        fees_due_outstanding: y.feesDueOutstanding,
        last_reconciliation: y.lastReconciliation ? { date: y.lastReconciliation.date, bank_difference: y.lastReconciliation.bankDiff } : null,
      },
      rowCount: 1,
    };
  },
};

const DUE_TOTAL = { anyOf: ["finance_reports:view", "reports:finance_dashboard"] } as const;
const DUE_CHILD = { anyOf: ["finance_ledger:view"] } as const;

export const feeDues: ToolDef = {
  name: "fee_dues",
  label_bn: "বকেয়া ফি",
  label_en: "Fee dues",
  description:
    "Fees still owed by families (বকেয়া ফি, বাকি বেতন, পরিশোধ). Without student_id: the school's total outstanding. With student_id (from find_students): " +
    "that child's family due and their last payments. Never sends reminders and never returns phone numbers.",
  input: { student_id: OBJECT_ID.optional() },
  gates: [
    { mode: "total", rule: DUE_TOTAL, resolver: { file: "modules/finance/resolvers/financeDashboard.ts", field: "financeYearOverview" }, note: "feesDueOutstanding on the finance dashboard" },
    { mode: "child", rule: DUE_CHILD, resolver: { file: "modules/finance/resolvers/financePosting.ts", field: "studentFeeHistory" } },
  ],
  maxRows: 60,
  async run(ctx, a) {
    const args = a as { student_id?: string };
    if (!args.student_id) {
      assertRule(ctx.auth, DUE_TOTAL);
      return { data: { total_outstanding: await totalGuardianDueOutstanding() }, rowCount: 1 };
    }
    assertRule(ctx.auth, DUE_CHILD);
    const due = await guardianDueFor(args.student_id);
    const history = cap(await studentFeeHistory(args.student_id), 60);
    return {
      data: {
        student_id: args.student_id,
        family_due: due,
        last_payments: history.rows.map((p) => ({ date: p.date, amount: p.amount, mode: p.mode, heads: (p.feeLines ?? []).map((l) => ({ head: l.head, amount: l.amount })), reversal: !!p.reversesPostingId })),
      },
      rowCount: history.rows.length,
      truncated: history.truncated,
      total: history.total,
    };
  },
};
