/**
 * Finance FIN-6A tests (prd-finance-fin6.md §10.1, J-FIN6-1/2). The rollup service composes
 * the FIN-1..FIN-5 reads — here those underlying services are mocked so the test pins the
 * COMPOSITION (net, cash-position sum, zakat/receivable sums, income-statement split, trends).
 */
const mockBalances: Record<string, number> = {};

jest.mock("../modules/finance/services/FinanceLedgerService", () => ({
  ledgerBalanceAsOf: (ledger: string) => Promise.resolve(mockBalances[ledger] ?? 0),
  allLedgerBalancesAsOf: () => Promise.resolve(Object.entries(mockBalances).map(([ledger, amount]) => ({ ledger, amount }))),
}));
const mockMonthToDate = jest.fn();
jest.mock("../modules/finance/services/FinanceSnapshotService", () => ({ monthToDate: (m: string) => mockMonthToDate(m) }));
const mockSurplus = jest.fn();
const mockBva = jest.fn();
jest.mock("../modules/finance/services/BudgetService", () => ({
  surplusDeficit: (...a: unknown[]) => mockSurplus(...a),
  budgetVsActual: (...a: unknown[]) => mockBva(...a),
}));
const mockProviderStatements = jest.fn();
const mockGuardianDue = jest.fn();
jest.mock("../modules/finance/services/FeeSupportService", () => ({
  providerStatements: () => mockProviderStatements(),
  totalGuardianDueOutstanding: () => mockGuardianDue(),
}));
const mockLastRecon = jest.fn();
jest.mock("../modules/finance/services/ReconciliationService", () => ({ mostRecentReconciliation: () => mockLastRecon() }));

import * as RU from "../modules/finance/services/FinanceRollupService";

const d = (iso: string) => new Date(iso);

beforeEach(() => {
  for (const k of Object.keys(mockBalances)) delete mockBalances[k];
  jest.clearAllMocks();
});

describe("FinanceRollupService", () => {
  test("J-FIN6-2 monthlyReport: net = totalIn − totalOut + the month-end ledger snapshot", async () => {
    mockMonthToDate.mockResolvedValue({
      month: "2026-03",
      feeByHead: [{ head: "TUITION", amount: 1000 }],
      incomeByHead: [{ head: "SADAKA", amount: 200 }],
      expenseByHead: [{ head: "RENT", amount: 300 }],
      totalIn: 1200,
      totalOut: 300,
    });
    mockBalances.CASH = 5000;
    mockBalances.BANK = 9000;

    const r = await RU.monthlyReport("2026-03");
    expect(r.net).toBe(900);
    expect(r.ledgerSnapshot).toEqual([
      { ledger: "CASH", balance: 5000 },
      { ledger: "BANK", balance: 9000 },
    ]);
  });

  test("J-FIN6-1 yearOverview: cash position sum + zakat/receivable sums + KPI bundle", async () => {
    mockBalances.CASH = 5000;
    mockBalances.BANK = 9000;
    mockBalances.ONLINE = 1500;
    mockBalances.QARD_CONTROL = 2000;
    mockBalances.IOU_CONTROL = 800;
    mockSurplus.mockResolvedValue({ ytdIncome: 50000, ytdExpense: 42000, ytdSurplus: 8000, months: [] });
    mockProviderStatements.mockResolvedValue([
      { providerId: "p1", providerName: "Zakat", raised: 6000, received: 4000, outstanding: 2000 },
      { providerId: "p2", providerName: "Sponsor", raised: 3000, received: 3000, outstanding: 0 },
    ]);
    mockGuardianDue.mockResolvedValue(12000);
    mockLastRecon.mockResolvedValue({ date: d("2026-03-31T23:59:59.999Z"), bankDiff: 200, eximusDiff: { CASH: 0, BANK: 100, ONLINE: 0 } });

    const o = await RU.yearOverview("year-1", d("2026-03-31"));
    expect(o.cashPosition).toBe(15500); // 5000+9000+1500
    expect(o.qardOutstanding).toBe(2000);
    expect(o.iouOutstanding).toBe(800);
    expect(o.ytdSurplus).toBe(8000);
    expect(o.zakatApplied).toBe(9000); // 6000+3000
    expect(o.providerReceivableOutstanding).toBe(2000);
    expect(o.feesDueOutstanding).toBe(12000);
    expect(o.lastReconciliation).toEqual({ date: d("2026-03-31T23:59:59.999Z").toISOString(), bankDiff: 200, eximusDiff: { CASH: 0, BANK: 100, ONLINE: 0 } });
  });

  test("yearOverview: a no-reconciliation year reports lastReconciliation = null", async () => {
    mockSurplus.mockResolvedValue({ ytdIncome: 0, ytdExpense: 0, ytdSurplus: 0, months: [] });
    mockProviderStatements.mockResolvedValue([]);
    mockGuardianDue.mockResolvedValue(0);
    mockLastRecon.mockResolvedValue(null);
    const o = await RU.yearOverview("year-1");
    expect(o.lastReconciliation).toBeNull();
  });

  test("ytdIncomeStatement: splits budget-vs-actual lines into income/expense, net = income − expense", async () => {
    mockBva.mockResolvedValue({
      academicYearId: "year-1",
      asOfMonth: "2026-03",
      lines: [
        { head: "TUITION_FEE", kind: "INCOME", cumulativeActual: 30000, annualTarget: 0, months: [], cumulativeTarget: 0, cumulativeVariance: 0 },
        { head: "RENT", kind: "EXPENSE", cumulativeActual: 12000, annualTarget: 0, months: [], cumulativeTarget: 0, cumulativeVariance: 0 },
      ],
    });
    const s = await RU.ytdIncomeStatement("year-1", d("2026-03-31"));
    expect(s.totalIncome).toBe(30000);
    expect(s.totalExpense).toBe(12000);
    expect(s.net).toBe(18000);
  });

  test("financeTrends maps surplusDeficit months to income/expense/net points", async () => {
    mockSurplus.mockResolvedValue({
      months: [
        { monthKey: "2026-01", income: 1000, expense: 600, surplus: 400 },
        { monthKey: "2026-02", income: 1200, expense: 1300, surplus: -100 },
      ],
      ytdIncome: 0, ytdExpense: 0, ytdSurplus: 0,
    });
    const trends = await RU.financeTrends("year-1");
    expect(trends).toEqual([
      { monthKey: "2026-01", income: 1000, expense: 600, net: 400 },
      { monthKey: "2026-02", income: 1200, expense: 1300, net: -100 },
    ]);
  });
});
