/**
 * Budget resolvers (FIN-5, prd-finance-fin5.md §3/§6, J-FIN5-1..J-FIN5-4).
 *
 * Per-(year × head) budgets + the derived budget-vs-actual variance + surplus/deficit.
 * EVERY field is gated `finance:manage` (Principal+Office); guardian none. Identity plane;
 * no corpus path (ADR-005). Dates cross as ISO strings.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { FinanceError, type FinanceActor } from "../services/FinanceLedgerService";
import {
  setBudgetLine,
  budgetLines,
  budgetVsActual,
  surplusDeficit,
  type BudgetVsActual,
  type SurplusDeficit,
} from "../services/BudgetService";
import type { IBudgetLine } from "../models/BudgetLine";
import type { HeadVariance, MonthCell } from "../budgetMath";

function actorOf(ctx: AppContext): FinanceActor {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return { userId: ctx.auth.userId, role: ctx.auth.role };
}
function parseDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new FinanceError(`তারিখ বৈধ নয়: ${value}`);
  return d;
}

// --- Input ------------------------------------------------------------------

const MonthlyOverrideInputRef = builder.inputType("BudgetMonthlyOverrideInput", {
  description: "One month's target override (monthKey YYYY-MM → amount).",
  fields: (t) => ({
    monthKey: t.string({ required: true }),
    amount: t.float({ required: true }),
  }),
});

// --- Output -----------------------------------------------------------------

function overridesObj(o: IBudgetLine["monthlyOverrides"]): Record<string, number> {
  if (!o) return {};
  return o instanceof Map ? Object.fromEntries(o) : (o as Record<string, number>);
}

const OverrideRef = builder.objectRef<{ monthKey: string; amount: number }>("BudgetMonthlyOverride");
OverrideRef.implement({
  fields: (t) => ({ monthKey: t.exposeString("monthKey"), amount: t.exposeFloat("amount") }),
});

const BudgetLineRef = builder.objectRef<IBudgetLine>("BudgetLine");
BudgetLineRef.implement({
  fields: (t) => ({
    id: t.id({ resolve: (l) => l._id.toString() }),
    academicYearId: t.string({ resolve: (l) => l.academicYearId.toString() }),
    head: t.exposeString("head"),
    kind: t.exposeString("kind"),
    annualAmount: t.exposeFloat("annualAmount"),
    monthlyOverrides: t.field({
      type: [OverrideRef],
      resolve: (l) => Object.entries(overridesObj(l.monthlyOverrides)).map(([monthKey, amount]) => ({ monthKey, amount })),
    }),
    note: t.string({ nullable: true, resolve: (l) => l.note ?? null }),
  }),
});

const MonthCellRef = builder.objectRef<MonthCell>("BudgetMonthCell");
MonthCellRef.implement({
  fields: (t) => ({
    monthKey: t.exposeString("monthKey"),
    target: t.exposeFloat("target"),
    actual: t.exposeFloat("actual"),
    variance: t.exposeFloat("variance"),
  }),
});

const HeadVarianceRef = builder.objectRef<HeadVariance>("BudgetHeadVariance");
HeadVarianceRef.implement({
  fields: (t) => ({
    head: t.exposeString("head"),
    kind: t.exposeString("kind"),
    annualTarget: t.exposeFloat("annualTarget"),
    months: t.field({ type: [MonthCellRef], resolve: (h) => h.months }),
    cumulativeTarget: t.exposeFloat("cumulativeTarget"),
    cumulativeActual: t.exposeFloat("cumulativeActual"),
    cumulativeVariance: t.exposeFloat("cumulativeVariance"),
  }),
});

const BudgetVsActualRef = builder.objectRef<BudgetVsActual>("BudgetVsActual");
BudgetVsActualRef.implement({
  fields: (t) => ({
    academicYearId: t.exposeString("academicYearId"),
    asOfMonth: t.exposeString("asOfMonth"),
    lines: t.field({ type: [HeadVarianceRef], resolve: (b) => b.lines }),
  }),
});

const SurplusMonthRef = builder.objectRef<SurplusDeficit["months"][number]>("BudgetSurplusMonth");
SurplusMonthRef.implement({
  fields: (t) => ({
    monthKey: t.exposeString("monthKey"),
    income: t.exposeFloat("income"),
    expense: t.exposeFloat("expense"),
    surplus: t.exposeFloat("surplus"),
  }),
});

const SurplusDeficitRef = builder.objectRef<SurplusDeficit>("BudgetSurplusDeficit");
SurplusDeficitRef.implement({
  fields: (t) => ({
    academicYearId: t.exposeString("academicYearId"),
    months: t.field({ type: [SurplusMonthRef], resolve: (s) => s.months }),
    ytdIncome: t.exposeFloat("ytdIncome"),
    ytdExpense: t.exposeFloat("ytdExpense"),
    ytdSurplus: t.exposeFloat("ytdSurplus"),
  }),
});

// --- Mutation (finance:manage) ----------------------------------------------

builder.mutationField("setBudgetLine", (t) =>
  t.field({
    type: BudgetLineRef,
    description:
      "Set (upsert) a per-(year × head) budget/target. kind=EXPENSE → a FINANCE_EXPENSE_HEADS head; " +
      "kind=INCOME → a FINANCE_INCOME_HEADS head. monthlyOverrides phase a seasonal head. Requires " +
      "finance:manage. Audited BUDGET_LINE_SET (prior + new).",
    authScopes: { hasPermission: "finance:manage" },
    args: {
      academicYearId: t.arg.string({ required: true }),
      head: t.arg.string({ required: true }),
      kind: t.arg.string({ required: true }),
      annualAmount: t.arg.float({ required: true }),
      monthlyOverrides: t.arg({ type: [MonthlyOverrideInputRef], required: false }),
      note: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      setBudgetLine(
        {
          academicYearId: args.academicYearId,
          head: args.head,
          kind: args.kind,
          annualAmount: args.annualAmount,
          monthlyOverrides: args.monthlyOverrides
            ? Object.fromEntries(args.monthlyOverrides.map((o) => [o.monthKey, o.amount]))
            : null,
          note: args.note ?? null,
        },
        actorOf(ctx),
      ),
  }),
);

// --- Reads (finance:manage) -------------------------------------------------

builder.queryField("budgetLines", (t) =>
  t.field({
    type: [BudgetLineRef],
    description: "A year's budget lines. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { academicYearId: t.arg.string({ required: true }) },
    resolve: (_root, args) => budgetLines(args.academicYearId),
  }),
);

builder.queryField("budgetVsActual", (t) =>
  t.field({
    type: BudgetVsActualRef,
    description: "Per-head monthly + cumulative variance for a year (actuals auto-derived). Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { academicYearId: t.arg.string({ required: true }), asOf: t.arg.string({ required: false }) },
    resolve: (_root, args) => budgetVsActual(args.academicYearId, args.asOf ? parseDate(args.asOf) : undefined),
  }),
);

builder.queryField("budgetSurplusDeficit", (t) =>
  t.field({
    type: SurplusDeficitRef,
    description: "Monthly + YTD income − expense surplus/deficit for a year. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { academicYearId: t.arg.string({ required: true }), asOf: t.arg.string({ required: false }) },
    resolve: (_root, args) => surplusDeficit(args.academicYearId, args.asOf ? parseDate(args.asOf) : undefined),
  }),
);
