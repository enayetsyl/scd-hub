/**
 * Finance posting resolvers (FIN-2A, prd-finance-fin2.md §3.A/§6, J-FIN2-1..J-FIN2-4).
 *
 * Record/reverse postings (append-only) and read the derived daily snapshot, month-to-date
 * totals, per-child fee history, and the PII-free HR salary pre-fill. EVERY field is gated
 * `finance:manage` (Principal+Office); no field is guardian-readable (REQ §5).
 *
 * Identity/operational plane; no corpus path (ADR-005). Dates cross as ISO strings.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { FinanceError, type FinanceActor } from "../services/FinanceLedgerService";
import {
  recordPosting,
  reversePosting,
  dailySnapshot,
  monthToDate,
  studentFeeHistory,
  type DailySnapshot,
  type MonthToDate,
} from "../services/FinanceSnapshotService";
import { hrPayrollNetPayableTotal, type HrNetPayableTotal } from "../services/HrPayrollBridge";
import type { IFinancePosting } from "../models/FinancePosting";

function actorOf(ctx: AppContext): FinanceActor {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return { userId: ctx.auth.userId, role: ctx.auth.role };
}

function parseDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new FinanceError(`তারিখ বৈধ নয়: ${value}`);
  return d;
}

// --- Input types ------------------------------------------------------------

const FeeLineInputRef = builder.inputType("FinanceFeeLineInput", {
  description: "One per-head line of a student fee (head ∈ FINANCE_STUDENT_FEE_HEADS, amount > 0).",
  fields: (t) => ({
    head: t.string({ required: true }),
    amount: t.float({ required: true }),
  }),
});

const SalaryAdjustmentInputRef = builder.inputType("FinanceSalaryAdjustmentInput", {
  description: "A manual SALARY adjustment line over the HR base (signed amount, D-#228).",
  fields: (t) => ({
    label: t.string({ required: true }),
    amount: t.float({ required: true }),
  }),
});

// --- Output types -----------------------------------------------------------

const FeeLineRef = builder.objectRef<{ head: string; amount: number }>("FinanceFeeLine");
FeeLineRef.implement({
  fields: (t) => ({
    head: t.exposeString("head"),
    amount: t.exposeFloat("amount"),
  }),
});

const PostingRef = builder.objectRef<IFinancePosting>("FinancePosting");
PostingRef.implement({
  description: "One append-only money event (FIN-2A). A reversal references the original via reversesPostingId.",
  fields: (t) => ({
    id: t.id({ resolve: (p) => p._id.toString() }),
    date: t.string({ resolve: (p) => p.date.toISOString() }),
    kind: t.exposeString("kind"),
    mode: t.exposeString("mode"),
    amount: t.exposeFloat("amount"),
    note: t.string({ nullable: true, resolve: (p) => p.note ?? null }),
    studentId: t.string({ nullable: true, resolve: (p) => (p.studentId ? p.studentId.toString() : null) }),
    feeLines: t.field({
      type: [FeeLineRef],
      nullable: true,
      resolve: (p) => (p.feeLines && p.feeLines.length ? p.feeLines.map((l) => ({ head: l.head, amount: l.amount })) : null),
    }),
    incomeHead: t.string({ nullable: true, resolve: (p) => p.incomeHead ?? null }),
    expenseHead: t.string({ nullable: true, resolve: (p) => p.expenseHead ?? null }),
    movementHead: t.string({ nullable: true, resolve: (p) => p.movementHead ?? null }),
    toLedger: t.string({ nullable: true, resolve: (p) => p.toLedger ?? null }),
    salaryBaseAmount: t.float({ nullable: true, resolve: (p) => p.salaryBaseAmount ?? null }),
    reversesPostingId: t.string({ nullable: true, resolve: (p) => (p.reversesPostingId ? p.reversesPostingId.toString() : null) }),
    createdAt: t.string({ resolve: (p) => p.createdAt.toISOString() }),
  }),
});

const LedgerDaySnapshotRef = builder.objectRef<DailySnapshot["ledgers"][number]>("LedgerDaySnapshot");
LedgerDaySnapshotRef.implement({
  fields: (t) => ({
    ledger: t.exposeString("ledger"),
    opening: t.exposeFloat("opening"),
    in: t.exposeFloat("in"),
    out: t.exposeFloat("out"),
    closing: t.exposeFloat("closing"),
  }),
});

const DailySnapshotRef = builder.objectRef<DailySnapshot>("FinanceDailySnapshot");
DailySnapshotRef.implement({
  description: "The day's per-ledger opening/in/out/closing for Cash/Bank/Online (derived; FIN-2A).",
  fields: (t) => ({
    date: t.exposeString("date"),
    ledgers: t.field({ type: [LedgerDaySnapshotRef], resolve: (s) => s.ledgers }),
  }),
});

const HeadTotalRef = builder.objectRef<{ head: string; amount: number }>("FinanceHeadTotal");
HeadTotalRef.implement({
  fields: (t) => ({
    head: t.exposeString("head"),
    amount: t.exposeFloat("amount"),
  }),
});

const MonthToDateRef = builder.objectRef<MonthToDate>("FinanceMonthToDate");
MonthToDateRef.implement({
  description: "Month-to-date totals by head (fee/income/expense) + totals in/out (derived; FIN-2A).",
  fields: (t) => ({
    month: t.exposeString("month"),
    feeByHead: t.field({ type: [HeadTotalRef], resolve: (m) => m.feeByHead }),
    incomeByHead: t.field({ type: [HeadTotalRef], resolve: (m) => m.incomeByHead }),
    expenseByHead: t.field({ type: [HeadTotalRef], resolve: (m) => m.expenseByHead }),
    totalIn: t.exposeFloat("totalIn"),
    totalOut: t.exposeFloat("totalOut"),
  }),
});

const HrNetPayableRef = builder.objectRef<HrNetPayableTotal>("HrPayrollNetPayable");
HrNetPayableRef.implement({
  description: "The PII-free HR net-payable aggregate for a month (Σ netPay over the approved_locked run, D-#228).",
  fields: (t) => ({
    monthKey: t.exposeString("monthKey"),
    total: t.exposeFloat("total"),
    found: t.exposeBoolean("found"),
  }),
});

// --- Mutations (finance:manage) ---------------------------------------------

builder.mutationField("recordFinancePosting", (t) =>
  t.field({
    type: PostingRef,
    description:
      "Append a money event (FEE_COLLECTION/OTHER_INCOME/EXPENSE/TRANSFER). The kind dictates the " +
      "required block; for SALARY pass salaryBaseAmount (HR total) + salaryAdjustments. Requires " +
      "finance:manage. Audited FINANCE_POSTING_RECORDED.",
    authScopes: { hasPermission: "finance:manage" },
    args: {
      date: t.arg.string({ required: true }),
      kind: t.arg.string({ required: true }),
      mode: t.arg.string({ required: true }),
      amount: t.arg.float({ required: false }),
      note: t.arg.string({ required: false }),
      studentId: t.arg.string({ required: false }),
      feeLines: t.arg({ type: [FeeLineInputRef], required: false }),
      incomeHead: t.arg.string({ required: false }),
      expenseHead: t.arg.string({ required: false }),
      toLedger: t.arg.string({ required: false }),
      salaryBaseAmount: t.arg.float({ required: false }),
      salaryAdjustments: t.arg({ type: [SalaryAdjustmentInputRef], required: false }),
    },
    resolve: (_root, args, ctx) =>
      recordPosting(
        {
          date: parseDate(args.date),
          kind: args.kind,
          mode: args.mode,
          amount: args.amount ?? undefined,
          note: args.note ?? null,
          studentId: args.studentId ?? null,
          feeLines: args.feeLines ?? undefined,
          incomeHead: args.incomeHead ?? null,
          expenseHead: args.expenseHead ?? null,
          toLedger: args.toLedger ?? null,
          salaryBaseAmount: args.salaryBaseAmount ?? null,
          salaryAdjustments: args.salaryAdjustments ?? undefined,
        },
        actorOf(ctx),
      ),
  }),
);

builder.mutationField("reverseFinancePosting", (t) =>
  t.field({
    type: PostingRef,
    description:
      "Reverse a posting — appends a linked negating posting (the original is never edited/deleted). " +
      "Requires finance:manage. Audited FINANCE_POSTING_REVERSED.",
    authScopes: { hasPermission: "finance:manage" },
    args: { postingId: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) => reversePosting(args.postingId, actorOf(ctx)),
  }),
);

// --- Reads (finance:manage) -------------------------------------------------

builder.queryField("financeDailySnapshot", (t) =>
  t.field({
    type: DailySnapshotRef,
    description: "The day's per-ledger opening/in/out/closing (Cash/Bank/Online), derived. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { date: t.arg.string({ required: true }) },
    resolve: (_root, args) => dailySnapshot(args.date),
  }),
);

builder.queryField("financeMonthToDate", (t) =>
  t.field({
    type: MonthToDateRef,
    description: "Month-to-date totals by head + totals in/out (YYYY-MM), derived. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { month: t.arg.string({ required: true }) },
    resolve: (_root, args) => monthToDate(args.month),
  }),
);

builder.queryField("studentFeeHistory", (t) =>
  t.field({
    type: [PostingRef],
    description: "A student's FEE_COLLECTION postings, newest first. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: (_root, args) => studentFeeHistory(args.studentId),
  }),
);

builder.queryField("hrPayrollNetPayableTotal", (t) =>
  t.field({
    type: HrNetPayableRef,
    description:
      "The PII-free HR net-payable aggregate for a month — the SALARY posting pre-fill (D-#228). " +
      "No individual payslip crosses. Requires finance:manage.",
    authScopes: { hasPermission: "finance:manage" },
    args: { monthKey: t.arg.string({ required: true }) },
    resolve: (_root, args) => hrPayrollNetPayableTotal(args.monthKey),
  }),
);
