/**
 * Finance FIN-5 tests (prd-finance-fin5.md §10, J-FIN5-1..J-FIN5-5).
 *   A. Pure budgetMath — monthsBetween, monthlyTarget (override ?? annual/12), aggregateActuals
 *      (fee→income mapping, movement excluded, reversal negates), headVariance.
 *   B. The service — DB-free (BudgetLine/FinancePosting/AcademicYear + writeAudit mocked):
 *      setBudgetLine validation + audit, budgetVsActual (derived actuals), surplus/deficit.
 */
import {
  monthsBetween,
  monthlyTarget,
  aggregateActuals,
  headVariance,
  type ActualPostingLike,
} from "../modules/finance/budgetMath";

interface Row { _id: { toString(): string }; [k: string]: unknown }
const mockBudgets: Row[] = [];
const mockPostings: Row[] = [];
const mockYears: Row[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];

const matchVal = (rv: unknown, cond: unknown): boolean => {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, Date>;
    if ("$lte" in c && (rv as Date).getTime() > c.$lte.getTime()) return false;
    if ("$gte" in c && (rv as Date).getTime() < c.$gte.getTime()) return false;
    return true;
  }
  return (rv && typeof rv === "object" ? (rv as { toString(): string }).toString() : rv) === cond;
};
const matches = (r: Row, q: Record<string, unknown>) => Object.entries(q).every(([k, v]) => matchVal(r[k], v));
const queryObj = (arr: Row[]) => ({ lean: () => Promise.resolve(arr), sort: () => Promise.resolve(arr) });
function makeModel(store: Row[], prefix: string) {
  return {
    create: (doc: Record<string, unknown>) => {
      const seq = ++mockSeq;
      const row: Row = { ...doc, _id: { toString: () => `${prefix}-${seq}` }, createdAt: new Date(Date.now() + seq), save: () => Promise.resolve(row) };
      store.push(row);
      return Promise.resolve(row);
    },
    find: (q: Record<string, unknown> = {}) => queryObj(store.filter((r) => matches(r, q))),
    findOne: (q: Record<string, unknown> = {}) => Promise.resolve(store.find((r) => matches(r, q)) ?? null),
    findById: (id: string) => ({ lean: () => Promise.resolve(store.find((r) => r._id.toString() === id) ?? null) }),
  };
}

jest.mock("../modules/finance/models/BudgetLine", () => ({ BudgetLine: makeModel(mockBudgets, "bl") }));
jest.mock("../modules/finance/models/FinancePosting", () => ({ FinancePosting: makeModel(mockPostings, "fp") }));
jest.mock("../modules/foundation/models/AcademicYear", () => ({ AcademicYear: makeModel(mockYears, "ay") }));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: Record<string, unknown>) => { mockAudits.push(p); return Promise.resolve(); },
}));

import * as BS from "../modules/finance/services/BudgetService";
import { FinanceError } from "../modules/finance/services/FinanceLedgerService";

const ACTOR = { userId: "principal-1", role: "PRINCIPAL" };
const d = (iso: string) => new Date(iso);
const YEAR = "0000000000000000000000d1";

beforeEach(() => {
  [mockBudgets, mockPostings, mockYears].forEach((s) => (s.length = 0));
  mockAudits.length = 0;
  mockSeq = 0;
});

// ===========================================================================
// A. Pure math
// ===========================================================================

describe("A. budgetMath", () => {
  test("monthsBetween spans inclusive calendar months", () => {
    expect(monthsBetween(d("2026-01-15"), d("2026-04-02"))).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  test("monthlyTarget = override ?? annual/12 (J-FIN5-1/2)", () => {
    expect(monthlyTarget(1200, null, "2026-03")).toBe(100);
    expect(monthlyTarget(1200, { "2026-03": 500 }, "2026-03")).toBe(500);
    expect(monthlyTarget(1200, { "2026-03": 500 }, "2026-04")).toBe(100);
  });

  test("J-FIN5-5 aggregateActuals: fee→income map, OTHER_INCOME, expense; TRANSFER excluded; reversal negates", () => {
    const ps: ActualPostingLike[] = [
      { kind: "FEE_COLLECTION", date: d("2026-03-05"), amount: 1000, feeLines: [{ head: "TUITION", amount: 1000 }] },
      { kind: "OTHER_INCOME", date: d("2026-03-06"), amount: 200, incomeHead: "SADAKA" },
      { kind: "EXPENSE", date: d("2026-03-07"), amount: 300, expenseHead: "RENT" },
      { kind: "TRANSFER", date: d("2026-03-08"), amount: 999 }, // excluded
      { kind: "EXPENSE", date: d("2026-03-09"), amount: 300, expenseHead: "RENT", reversesPostingId: "x" }, // reversal
    ];
    const a = aggregateActuals(ps);
    expect(a.income.get("TUITION_FEE")?.get("2026-03")).toBe(1000);
    expect(a.income.get("SADAKA")?.get("2026-03")).toBe(200);
    expect(a.expense.get("RENT")?.get("2026-03")).toBe(0); // 300 − 300 reversal
  });

  test("headVariance: monthly + cumulative (≤ asOfMonth)", () => {
    const actualByMonth = new Map([["2026-01", 100], ["2026-02", 80]]);
    const hv = headVariance({ head: "RENT", kind: "EXPENSE", annualAmount: 1200 }, ["2026-01", "2026-02", "2026-03"], actualByMonth, "2026-02");
    expect(hv.months[0]).toEqual({ monthKey: "2026-01", target: 100, actual: 100, variance: 0 });
    expect(hv.cumulativeTarget).toBe(200); // jan + feb (mar excluded by asOf)
    expect(hv.cumulativeActual).toBe(180);
    expect(hv.cumulativeVariance).toBe(-20);
  });
});

// ===========================================================================
// B. The service
// ===========================================================================

describe("B. BudgetService", () => {
  const seedYear = () => mockYears.push({ _id: { toString: () => YEAR }, startDate: d("2026-01-01"), endDate: d("2026-12-31") } as Row);

  test("J-FIN5-1 setBudgetLine validates head vs kind + audits (prior null → new)", async () => {
    const line = await BS.setBudgetLine({ academicYearId: YEAR, head: "RENT", kind: "EXPENSE", annualAmount: 1200 }, ACTOR);
    expect(line.head).toBe("RENT");
    const a = mockAudits.find((x) => x.eventKind === "BUDGET_LINE_SET");
    expect((a!.meta as { prior: unknown }).prior).toBeNull();
  });

  test("setBudgetLine rejects an income head for an EXPENSE kind", async () => {
    await expect(BS.setBudgetLine({ academicYearId: YEAR, head: "SADAKA", kind: "EXPENSE", annualAmount: 100 }, ACTOR)).rejects.toThrow(FinanceError);
    await expect(BS.setBudgetLine({ academicYearId: YEAR, head: "RENT", kind: "INCOME", annualAmount: 100 }, ACTOR)).rejects.toThrow(FinanceError);
  });

  test("J-FIN5-3 budgetVsActual derives actuals off postings", async () => {
    seedYear();
    mockBudgets.push({ _id: { toString: () => "bl-1" }, academicYearId: { toString: () => YEAR }, head: "RENT", kind: "EXPENSE", annualAmount: 1200, monthlyOverrides: null } as Row);
    mockBudgets.push({ _id: { toString: () => "bl-2" }, academicYearId: { toString: () => YEAR }, head: "TUITION_FEE", kind: "INCOME", annualAmount: 12000, monthlyOverrides: null } as Row);
    mockPostings.push({ _id: { toString: () => "fp-1" }, kind: "EXPENSE", date: d("2026-03-07"), amount: 150, expenseHead: "RENT" } as Row);
    mockPostings.push({ _id: { toString: () => "fp-2" }, kind: "FEE_COLLECTION", date: d("2026-03-08"), amount: 1000, feeLines: [{ head: "TUITION", amount: 1000 }] } as Row);

    const bva = await BS.budgetVsActual(YEAR, d("2026-03-31"));
    const rent = bva.lines.find((l) => l.head === "RENT")!;
    const marchRent = rent.months.find((m) => m.monthKey === "2026-03")!;
    expect(marchRent.target).toBe(100); // 1200/12
    expect(marchRent.actual).toBe(150);
    expect(marchRent.variance).toBe(50);
    const tuition = bva.lines.find((l) => l.head === "TUITION_FEE")!;
    expect(tuition.months.find((m) => m.monthKey === "2026-03")!.actual).toBe(1000);
  });

  test("J-FIN5-4 surplusDeficit = income − expense (monthly + YTD)", async () => {
    seedYear();
    mockPostings.push({ _id: { toString: () => "fp-1" }, kind: "FEE_COLLECTION", date: d("2026-03-08"), amount: 1000, feeLines: [{ head: "TUITION", amount: 1000 }] } as Row);
    mockPostings.push({ _id: { toString: () => "fp-2" }, kind: "EXPENSE", date: d("2026-03-09"), amount: 300, expenseHead: "RENT" } as Row);
    const sd = await BS.surplusDeficit(YEAR, d("2026-03-31"));
    expect(sd.ytdIncome).toBe(1000);
    expect(sd.ytdExpense).toBe(300);
    expect(sd.ytdSurplus).toBe(700);
  });
});
