/**
 * BudgetService (FIN-5, prd-finance-fin5.md §3/§6, J-FIN5-1..J-FIN5-5, D-#237/#238) —
 * per-(year × head) budgets/targets + the DERIVED budget-vs-actual variance and the
 * running surplus/deficit. Actuals are auto-fed from FIN-2 postings by head × month
 * (movement heads excluded); nothing is pasted. The budget edit is audited prior+new.
 *
 * Identity/operational plane; NO corpus path (ADR-005).
 */
import {
  FINANCE_EXPENSE_HEADS,
  FINANCE_INCOME_HEADS,
  BUDGET_LINE_KINDS,
} from "@scd/shared";
import { BudgetLine, type IBudgetLine } from "../models/BudgetLine";
import { FinancePosting } from "../models/FinancePosting";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { FinanceError, type FinanceActor } from "./FinanceLedgerService";
import {
  monthsBetween,
  aggregateActuals,
  headVariance,
  type ActualPostingLike,
  type HeadVariance,
} from "../budgetMath";
import { writeAudit } from "../../platform/services/AuditService";

const EXPENSE_SET = new Set<string>(FINANCE_EXPENSE_HEADS);
const INCOME_SET = new Set<string>(FINANCE_INCOME_HEADS);
const KIND_SET = new Set<string>(BUDGET_LINE_KINDS);

export interface SetBudgetLineInput {
  academicYearId: string;
  head: string;
  kind: string;
  annualAmount: number;
  monthlyOverrides?: Record<string, number> | null;
  note?: string | null;
}

function overridesToObject(o: IBudgetLine["monthlyOverrides"]): Record<string, number> | null {
  if (!o) return null;
  if (o instanceof Map) return Object.fromEntries(o);
  return o as Record<string, number>;
}

function snapshot(line: IBudgetLine) {
  return { annualAmount: line.annualAmount, monthlyOverrides: overridesToObject(line.monthlyOverrides), note: line.note ?? null };
}

/** Set (upsert) a budget line for (year, head). Validates head ∈ the kind's enum; audited
 *  prior+new (the budget's history, D-#101 pattern). */
export async function setBudgetLine(input: SetBudgetLineInput, actor: FinanceActor): Promise<IBudgetLine> {
  if (!KIND_SET.has(input.kind)) throw new FinanceError(`অজানা বাজেট ধরন: ${input.kind}`);
  const validHead = input.kind === "EXPENSE" ? EXPENSE_SET.has(input.head) : INCOME_SET.has(input.head);
  if (!validHead) throw new FinanceError(`“${input.head}” খাতটি ${input.kind} বাজেটের জন্য বৈধ নয়`);
  if (!Number.isFinite(input.annualAmount) || input.annualAmount < 0) throw new FinanceError("বার্ষিক পরিমাণ বৈধ নয়");
  if (input.monthlyOverrides) {
    for (const v of Object.values(input.monthlyOverrides)) {
      if (!Number.isFinite(v)) throw new FinanceError("মাসিক ওভাররাইড বৈধ নয়");
    }
  }

  const existing = await BudgetLine.findOne({ academicYearId: input.academicYearId, head: input.head });
  const prior = existing ? snapshot(existing) : null;

  let line: IBudgetLine;
  if (existing) {
    existing.kind = input.kind;
    existing.annualAmount = input.annualAmount;
    existing.monthlyOverrides = input.monthlyOverrides ?? undefined;
    existing.note = input.note ?? null;
    line = await existing.save();
  } else {
    line = await BudgetLine.create({
      academicYearId: input.academicYearId,
      head: input.head,
      kind: input.kind,
      annualAmount: input.annualAmount,
      monthlyOverrides: input.monthlyOverrides ?? undefined,
      note: input.note ?? null,
      enteredByUserId: actor.userId,
    });
  }

  await writeAudit({
    eventKind: "BUDGET_LINE_SET",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: line._id,
    targetKind: "BudgetLine",
    meta: { academicYearId: input.academicYearId, head: input.head, kind: input.kind, prior, next: snapshot(line) },
  });
  return line;
}

export async function budgetLines(academicYearId: string): Promise<IBudgetLine[]> {
  return BudgetLine.find({ academicYearId }).sort({ kind: 1, head: 1 });
}

// --- Derived reads ----------------------------------------------------------

async function loadYearBounds(academicYearId: string): Promise<{ start: Date; end: Date }> {
  const year = await AcademicYear.findById(academicYearId).lean<{ startDate: Date; endDate: Date }>();
  if (!year) throw new FinanceError("শিক্ষাবর্ষ পাওয়া যায়নি");
  return { start: new Date(year.startDate), end: new Date(year.endDate) };
}

async function loadActualPostings(start: Date, end: Date): Promise<ActualPostingLike[]> {
  const endOfRange = new Date(`${end.toISOString().slice(0, 10)}T23:59:59.999Z`);
  const rows = await FinancePosting.find({ date: { $gte: start, $lte: endOfRange } }).lean<
    Array<{ kind: string; date: Date; amount: number; feeLines?: Array<{ head: string; amount: number }>; incomeHead?: string | null; expenseHead?: string | null; reversesPostingId?: unknown }>
  >();
  return rows.map((r) => ({
    kind: r.kind,
    date: new Date(r.date),
    amount: r.amount,
    feeLines: r.feeLines,
    incomeHead: r.incomeHead ?? null,
    expenseHead: r.expenseHead ?? null,
    reversesPostingId: r.reversesPostingId ?? null,
  }));
}

const monthKeyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export interface BudgetVsActual {
  academicYearId: string;
  asOfMonth: string;
  lines: HeadVariance[];
}

/** Per-head monthly + cumulative variance for the year (J-FIN5-3), actuals auto-derived. */
export async function budgetVsActual(academicYearId: string, asOf: Date = new Date()): Promise<BudgetVsActual> {
  const { start, end } = await loadYearBounds(academicYearId);
  const monthKeys = monthsBetween(start, end);
  const asOfMonth = monthKeyOf(asOf);

  const [lines, postings] = await Promise.all([
    BudgetLine.find({ academicYearId }).lean<Array<{ head: string; kind: string; annualAmount: number; monthlyOverrides?: Record<string, number> | Map<string, number> | null }>>(),
    loadActualPostings(start, end),
  ]);
  const actuals = aggregateActuals(postings);

  const out = lines.map((l) => {
    const overrides = l.monthlyOverrides instanceof Map ? Object.fromEntries(l.monthlyOverrides) : (l.monthlyOverrides ?? null);
    const actualByMonth = l.kind === "EXPENSE" ? actuals.expense.get(l.head) : actuals.income.get(l.head);
    return headVariance({ head: l.head, kind: l.kind, annualAmount: l.annualAmount, monthlyOverrides: overrides }, monthKeys, actualByMonth, asOfMonth);
  });
  out.sort((a, b) => (a.kind === b.kind ? a.head.localeCompare(b.head) : a.kind.localeCompare(b.kind)));
  return { academicYearId, asOfMonth, lines: out };
}

export interface SurplusMonth {
  monthKey: string;
  income: number;
  expense: number;
  surplus: number;
}
export interface SurplusDeficit {
  academicYearId: string;
  months: SurplusMonth[];
  ytdIncome: number;
  ytdExpense: number;
  ytdSurplus: number;
}

/** Σ income actual − Σ expense actual, monthly + YTD (≤ asOf) (J-FIN5-4). */
export async function surplusDeficit(academicYearId: string, asOf: Date = new Date()): Promise<SurplusDeficit> {
  const { start, end } = await loadYearBounds(academicYearId);
  const monthKeys = monthsBetween(start, end);
  const asOfMonth = monthKeyOf(asOf);
  const postings = await loadActualPostings(start, end);
  const actuals = aggregateActuals(postings);

  const sumMonth = (m: Map<string, Map<string, number>>, mk: string) => {
    let s = 0;
    for (const byMonth of m.values()) s += byMonth.get(mk) ?? 0;
    return s;
  };

  const months: SurplusMonth[] = [];
  let ytdIncome = 0;
  let ytdExpense = 0;
  for (const mk of monthKeys) {
    const income = sumMonth(actuals.income, mk);
    const expense = sumMonth(actuals.expense, mk);
    months.push({ monthKey: mk, income, expense, surplus: income - expense });
    if (mk <= asOfMonth) { ytdIncome += income; ytdExpense += expense; }
  }
  return { academicYearId, months, ytdIncome, ytdExpense, ytdSurplus: ytdIncome - ytdExpense };
}
