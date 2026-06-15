/**
 * budgetMath — PURE budget-vs-actual math (FIN-5, prd-finance-fin5.md §3, D-#237/#238).
 * No DB, no clock — unit-tested directly.
 *
 * Monthly target = `monthlyOverrides[monthKey] ?? annualAmount / 12` (even split, any month
 * overridable — D-#237). Actuals are aggregated from FIN-2 postings by head × month, with
 * the FEE_COLLECTION per-head split mapped to its income head and movement heads excluded
 * (D-#238). Variance = actual − target.
 */

/** student-fee head → income budget head (FIN-5 §3 — the FEE_COLLECTION split feeds the
 *  matching income target; uncovered fee heads fall to OTHER_FEE). */
export const FEE_HEAD_TO_INCOME_HEAD: Record<string, string> = {
  ADMISSION: "ADMISSION_FEE",
  SESSION: "SESSION_FEE",
  TUITION: "TUITION_FEE",
  BOOKS_STATIONERIES: "BOOKS_STATIONERIES",
  REVISION: "REVISION_FEE",
  TRANSPORT: "TRANSPORT_FEE",
  OTHER: "OTHER_FEE",
};

/** The ordered "YYYY-MM" month keys spanning [start, end] inclusive (by calendar month). */
export function monthsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const y0 = start.getUTCFullYear();
  const m0 = start.getUTCMonth();
  const y1 = end.getUTCFullYear();
  const m1 = end.getUTCMonth();
  let y = y0;
  let m = m0;
  while (y < y1 || (y === y1 && m <= m1)) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

/** A head's target for one month (override ?? annual/12). */
export function monthlyTarget(
  annualAmount: number,
  overrides: Record<string, number> | null | undefined,
  monthKey: string,
): number {
  const o = overrides?.[monthKey];
  return o != null ? o : annualAmount / 12;
}

/** A FinancePosting shape the actuals aggregation needs (pure-testable). */
export interface ActualPostingLike {
  kind: string;
  date: Date;
  amount: number;
  feeLines?: Array<{ head: string; amount: number }>;
  incomeHead?: string | null;
  expenseHead?: string | null;
  reversesPostingId?: unknown;
}

const monthKeyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export interface ActualsByHead {
  /** income head → { monthKey → amount } */
  income: Map<string, Map<string, number>>;
  /** expense head → { monthKey → amount } */
  expense: Map<string, Map<string, number>>;
}

/**
 * Aggregate FIN-2 postings into income/expense actuals by head × month (D-#238). TRANSFER
 * (movement) postings are excluded — they are neither income nor expense. A reversal negates.
 */
export function aggregateActuals(postings: readonly ActualPostingLike[]): ActualsByHead {
  const income = new Map<string, Map<string, number>>();
  const expense = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, head: string, month: string, amt: number) => {
    let byMonth = m.get(head);
    if (!byMonth) { byMonth = new Map(); m.set(head, byMonth); }
    byMonth.set(month, (byMonth.get(month) ?? 0) + amt);
  };

  for (const p of postings) {
    const s = p.reversesPostingId != null ? -1 : 1;
    const month = monthKeyOf(p.date);
    if (p.kind === "EXPENSE" && p.expenseHead) {
      bump(expense, p.expenseHead, month, p.amount * s);
    } else if (p.kind === "OTHER_INCOME" && p.incomeHead) {
      bump(income, p.incomeHead, month, p.amount * s);
    } else if (p.kind === "FEE_COLLECTION") {
      for (const l of p.feeLines ?? []) {
        const incomeHead = FEE_HEAD_TO_INCOME_HEAD[l.head] ?? "OTHER_FEE";
        bump(income, incomeHead, month, l.amount * s);
      }
    }
    // TRANSFER excluded (movement, D-#238).
  }
  return { income, expense };
}

export interface MonthCell {
  monthKey: string;
  target: number;
  actual: number;
  variance: number;
}
export interface HeadVariance {
  head: string;
  kind: string;
  annualTarget: number;
  months: MonthCell[];
  cumulativeTarget: number;
  cumulativeActual: number;
  cumulativeVariance: number;
}

/** Per-head monthly + cumulative (≤ asOfMonth) variance for one budget line. */
export function headVariance(
  line: { head: string; kind: string; annualAmount: number; monthlyOverrides?: Record<string, number> | null },
  monthKeys: readonly string[],
  actualByMonth: Map<string, number> | undefined,
  asOfMonth: string,
): HeadVariance {
  const months: MonthCell[] = [];
  let cumulativeTarget = 0;
  let cumulativeActual = 0;
  for (const mk of monthKeys) {
    const target = monthlyTarget(line.annualAmount, line.monthlyOverrides, mk);
    const actual = actualByMonth?.get(mk) ?? 0;
    months.push({ monthKey: mk, target, actual, variance: actual - target });
    if (mk <= asOfMonth) {
      cumulativeTarget += target;
      cumulativeActual += actual;
    }
  }
  return {
    head: line.head,
    kind: line.kind,
    annualTarget: line.annualAmount,
    months,
    cumulativeTarget,
    cumulativeActual,
    cumulativeVariance: cumulativeActual - cumulativeTarget,
  };
}
