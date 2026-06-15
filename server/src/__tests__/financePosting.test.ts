/**
 * Finance FIN-2A tests (prd-finance-fin2.md §10.1, J-FIN2-1..J-FIN2-4 + §3.A math).
 * Two halves:
 *   A. The PURE math (`postingEffects` / `sumLedgerDelta` / `dayInOut`) — effect rules per
 *      kind, reversal negation, as-of cutoffs, day in/out.
 *   B. The service — DB-free (FinancePosting + LedgerOpeningBalance + writeAudit + the HR
 *      payroll models mocked with in-memory stores): record/reverse (append-only, J-FIN2-2),
 *      the extended `ledgerBalanceAsOf` seam (opening + Σ postings, D-#225), `dailySnapshot`
 *      (J-FIN2-1), transfer double-effect (J-FIN2-3), SALARY pre-fill + adjustments
 *      (J-FIN2-4), month-to-date, and the PII-free HR aggregate.
 */
import {
  postingEffects,
  sumLedgerDelta,
  dayInOut,
  type PostingLike,
} from "../modules/finance/postingMath";

// ---------------------------------------------------------------------------
// Mocks (mock-prefixed for jest.mock hoisting)
// ---------------------------------------------------------------------------

interface Row {
  _id: { toString(): string };
  [k: string]: unknown;
}
const mockPostings: Row[] = [];
const mockOpenings: Row[] = [];
const mockRuns: Row[] = [];
const mockSlips: Row[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];

const idStr = (x: unknown): string | null => (x ? (x as { toString(): string }).toString() : null);
const matches = (r: Row, q: Record<string, unknown>): boolean =>
  Object.entries(q).every(([k, v]) => {
    // ObjectId-like fields compare by string id (must precede the date-operator branch).
    if (k === "reversesPostingId" || k === "payrollRunId" || k === "studentId" || k === "_id") {
      return idStr(r[k]) === idStr(v);
    }
    // a Mongo range condition { $lte / $lt / $gte }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const cond = v as Record<string, Date>;
      const rv = r[k] as Date;
      if ("$lte" in cond && rv.getTime() > cond.$lte.getTime()) return false;
      if ("$lt" in cond && rv.getTime() >= cond.$lt.getTime()) return false;
      if ("$gte" in cond && rv.getTime() < cond.$gte.getTime()) return false;
      return true;
    }
    return r[k] === v;
  });

const query = (arr: Row[]) => ({
  lean: () => Promise.resolve(arr),
  sort: () => Promise.resolve([...arr].sort((a, b) => (b.date as Date).getTime() - (a.date as Date).getTime())),
});

function makeModel(store: Row[], prefix: string) {
  return {
    create: (doc: Record<string, unknown>) => {
      const seq = ++mockSeq;
      const row: Row = { ...doc, _id: { toString: () => `${prefix}-${seq}` }, createdAt: new Date(Date.now() + seq) };
      store.push(row);
      return Promise.resolve(row);
    },
    find: (q: Record<string, unknown> = {}) => query(store.filter((r) => matches(r, q))),
    findById: (id: string) => Promise.resolve(store.find((r) => r._id.toString() === id) ?? null),
    findOne: (q: Record<string, unknown> = {}) => {
      const hit = store.find((r) => matches(r, q)) ?? null;
      return { lean: () => Promise.resolve(hit), then: (res: (v: unknown) => unknown) => Promise.resolve(hit).then(res) };
    },
  };
}

jest.mock("../modules/finance/models/FinancePosting", () => ({
  FinancePosting: makeModel(mockPostings, "fp"),
}));
jest.mock("../modules/finance/models/LedgerOpeningBalance", () => ({
  LedgerOpeningBalance: makeModel(mockOpenings, "ob"),
}));
jest.mock("../modules/hr/models/PayrollRun", () => ({
  PayrollRun: { findOne: (q: Record<string, unknown>) => ({ lean: () => Promise.resolve(mockRuns.find((r) => matches(r, q)) ?? null) }) },
}));
jest.mock("../modules/hr/models/Payslip", () => ({
  Payslip: { find: (q: Record<string, unknown>) => ({ lean: () => Promise.resolve(mockSlips.filter((r) => matches(r, q))) }) },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (params: Record<string, unknown>) => {
    mockAudits.push(params);
    return Promise.resolve();
  },
}));

import * as LEDGER from "../modules/finance/services/FinanceLedgerService";
import * as SNAP from "../modules/finance/services/FinanceSnapshotService";
import { hrPayrollNetPayableTotal } from "../modules/finance/services/HrPayrollBridge";

const ACTOR = { userId: "office-1", role: "OFFICE" };
const d = (iso: string) => new Date(iso);

beforeEach(() => {
  mockPostings.length = 0;
  mockOpenings.length = 0;
  mockRuns.length = 0;
  mockSlips.length = 0;
  mockAudits.length = 0;
  mockSeq = 0;
});

// ===========================================================================
// A. The pure math
// ===========================================================================

describe("A. postingMath (pure ledger effects)", () => {
  const p = (over: Partial<PostingLike>): PostingLike => ({
    date: d("2026-06-02"), kind: "OTHER_INCOME", mode: "CASH", amount: 100, ...over,
  });

  test("FEE_COLLECTION / OTHER_INCOME credit the mode ledger", () => {
    expect(postingEffects(p({ kind: "OTHER_INCOME", mode: "BANK", amount: 50 }))).toEqual([{ ledger: "BANK", delta: 50 }]);
    expect(postingEffects(p({ kind: "FEE_COLLECTION", mode: "CASH", amount: 70 }))).toEqual([{ ledger: "CASH", delta: 70 }]);
  });

  test("EXPENSE debits the mode ledger", () => {
    expect(postingEffects(p({ kind: "EXPENSE", mode: "CASH", amount: 40 }))).toEqual([{ ledger: "CASH", delta: -40 }]);
  });

  test("TRANSFER debits mode + credits toLedger (J-FIN2-3)", () => {
    expect(postingEffects(p({ kind: "TRANSFER", mode: "CASH", toLedger: "BANK", amount: 300 }))).toEqual([
      { ledger: "CASH", delta: -300 },
      { ledger: "BANK", delta: 300 },
    ]);
  });

  test("a reversal negates the normal effect (J-FIN2-2)", () => {
    expect(postingEffects(p({ kind: "EXPENSE", mode: "CASH", amount: 40, reversesPostingId: "x" }))).toEqual([
      { ledger: "CASH", delta: 40 },
    ]);
  });

  test("sumLedgerDelta respects the asOf cutoff", () => {
    const ps: PostingLike[] = [
      p({ date: d("2026-06-01"), kind: "OTHER_INCOME", mode: "CASH", amount: 100 }),
      p({ date: d("2026-06-05"), kind: "EXPENSE", mode: "CASH", amount: 30 }),
    ];
    expect(sumLedgerDelta(ps, "CASH", d("2026-06-03"))).toBe(100); // 06-05 excluded
    expect(sumLedgerDelta(ps, "CASH", d("2026-06-05"))).toBe(70);
  });

  test("dayInOut splits credits/debits within the day window", () => {
    const ps: PostingLike[] = [
      p({ date: d("2026-06-02T09:00:00Z"), kind: "OTHER_INCOME", mode: "CASH", amount: 500 }),
      p({ date: d("2026-06-02T10:00:00Z"), kind: "EXPENSE", mode: "CASH", amount: 200 }),
      p({ date: d("2026-06-03T10:00:00Z"), kind: "EXPENSE", mode: "CASH", amount: 999 }),
    ];
    expect(dayInOut(ps, "CASH", d("2026-06-02T00:00:00Z"), d("2026-06-02T23:59:59.999Z"))).toEqual({ in: 500, out: 200 });
  });
});

// ===========================================================================
// B. The service
// ===========================================================================

describe("B. FinanceSnapshotService + the extended seam", () => {
  const seedOpening = (ledger: string, amount: number, eff: string) =>
    LEDGER.setOpeningBalance({ ledger, amount, effectiveDate: d(eff) }, ACTOR);

  test("J-FIN2-1 recordPosting appends + audits; the seam adds Σ postings to the opening (D-#225)", async () => {
    await seedOpening("CASH", 1000, "2026-06-01");
    await SNAP.recordPosting({ date: d("2026-06-02"), kind: "FEE_COLLECTION", mode: "CASH", studentId: "s1", feeLines: [{ head: "TUITION", amount: 500 }] }, ACTOR);
    expect(mockPostings).toHaveLength(1);
    expect(mockAudits.some((a) => a.eventKind === "FINANCE_POSTING_RECORDED")).toBe(true);
    expect(await LEDGER.ledgerBalanceAsOf("CASH", d("2026-06-02"))).toBe(1500);
    expect(await LEDGER.ledgerBalanceAsOf("CASH", d("2026-05-31"))).toBe(0); // before the opening
  });

  test("FEE_COLLECTION amount = Σ feeLines; per-head history", async () => {
    const row = await SNAP.recordPosting(
      { date: d("2026-06-02"), kind: "FEE_COLLECTION", mode: "CASH", studentId: "s1", feeLines: [{ head: "TUITION", amount: 500 }, { head: "TRANSPORT", amount: 100 }] },
      ACTOR,
    );
    expect(row.amount).toBe(600);
    const hist = await SNAP.studentFeeHistory("s1");
    expect(hist).toHaveLength(1);
  });

  test("J-FIN2-3 dailySnapshot derives opening/in/out/closing incl. the transfer double-effect", async () => {
    await seedOpening("CASH", 1000, "2026-06-01");
    await SNAP.recordPosting({ date: d("2026-06-02"), kind: "FEE_COLLECTION", mode: "CASH", studentId: "s1", feeLines: [{ head: "TUITION", amount: 500 }] }, ACTOR);
    await SNAP.recordPosting({ date: d("2026-06-02"), kind: "EXPENSE", mode: "CASH", expenseHead: "RENT", amount: 200 }, ACTOR);
    await SNAP.recordPosting({ date: d("2026-06-02"), kind: "TRANSFER", mode: "CASH", toLedger: "BANK", amount: 300 }, ACTOR);

    const snap = await SNAP.dailySnapshot("2026-06-02");
    const byLedger = Object.fromEntries(snap.ledgers.map((l) => [l.ledger, l]));
    expect(byLedger.CASH).toMatchObject({ opening: 1000, in: 500, out: 500, closing: 1000 });
    expect(byLedger.BANK).toMatchObject({ opening: 0, in: 300, out: 0, closing: 300 });
    expect(byLedger.ONLINE).toMatchObject({ opening: 0, in: 0, out: 0, closing: 0 });
  });

  test("J-FIN2-2 reversal: append-only, the original stays, the balance nets to correct", async () => {
    const orig = await SNAP.recordPosting({ date: d("2026-06-02"), kind: "EXPENSE", mode: "CASH", expenseHead: "RENT", amount: 200 }, ACTOR);
    expect(await LEDGER.ledgerBalanceAsOf("CASH", d("2026-06-02"))).toBe(-200);
    await SNAP.reversePosting(orig._id.toString(), ACTOR);
    expect(mockPostings).toHaveLength(2); // append-only — original retained
    expect(await LEDGER.ledgerBalanceAsOf("CASH", d("2026-06-02"))).toBe(0);
    expect(mockAudits.some((a) => a.eventKind === "FINANCE_POSTING_REVERSED")).toBe(true);
  });

  test("reversal guards: cannot reverse twice or reverse a reversal", async () => {
    const orig = await SNAP.recordPosting({ date: d("2026-06-02"), kind: "EXPENSE", mode: "CASH", expenseHead: "RENT", amount: 200 }, ACTOR);
    const rev = await SNAP.reversePosting(orig._id.toString(), ACTOR);
    await expect(SNAP.reversePosting(orig._id.toString(), ACTOR)).rejects.toThrow(LEDGER.FinanceError);
    await expect(SNAP.reversePosting(rev._id.toString(), ACTOR)).rejects.toThrow(LEDGER.FinanceError);
  });

  test("J-FIN2-4 SALARY pre-fill: amount = HR base + Σ adjustments; base + adjustments stored", async () => {
    const row = await SNAP.recordPosting(
      { date: d("2026-06-30"), kind: "EXPENSE", mode: "BANK", expenseHead: "SALARY", salaryBaseAmount: 100000, salaryAdjustments: [{ label: "exclude cash-paid", amount: -8000 }, { label: "round", amount: -50 }] },
      ACTOR,
    );
    expect(row.amount).toBe(91950);
    expect(row.salaryBaseAmount).toBe(100000);
    expect(await LEDGER.ledgerBalanceAsOf("BANK", d("2026-06-30"))).toBe(-91950);
  });

  test("validation rejects unknown kind / mode / head / non-positive amount", async () => {
    await expect(SNAP.recordPosting({ date: d("2026-06-02"), kind: "NOPE", mode: "CASH", amount: 1 }, ACTOR)).rejects.toThrow(LEDGER.FinanceError);
    await expect(SNAP.recordPosting({ date: d("2026-06-02"), kind: "EXPENSE", mode: "WALLET", expenseHead: "RENT", amount: 1 }, ACTOR)).rejects.toThrow(LEDGER.FinanceError);
    await expect(SNAP.recordPosting({ date: d("2026-06-02"), kind: "OTHER_INCOME", mode: "CASH", incomeHead: "NOPE", amount: 1 }, ACTOR)).rejects.toThrow(LEDGER.FinanceError);
    await expect(SNAP.recordPosting({ date: d("2026-06-02"), kind: "EXPENSE", mode: "CASH", expenseHead: "RENT", amount: 0 }, ACTOR)).rejects.toThrow(LEDGER.FinanceError);
    await expect(SNAP.recordPosting({ date: d("2026-06-02"), kind: "TRANSFER", mode: "CASH", toLedger: "CASH", amount: 50 }, ACTOR)).rejects.toThrow(LEDGER.FinanceError);
  });

  test("monthToDate totals by head (fee/expense) and totals in/out; transfers excluded", async () => {
    await SNAP.recordPosting({ date: d("2026-06-02"), kind: "FEE_COLLECTION", mode: "CASH", studentId: "s1", feeLines: [{ head: "TUITION", amount: 500 }] }, ACTOR);
    await SNAP.recordPosting({ date: d("2026-06-10"), kind: "EXPENSE", mode: "CASH", expenseHead: "RENT", amount: 200 }, ACTOR);
    await SNAP.recordPosting({ date: d("2026-06-15"), kind: "TRANSFER", mode: "CASH", toLedger: "BANK", amount: 300 }, ACTOR);
    const mtd = await SNAP.monthToDate("2026-06");
    expect(mtd.feeByHead).toEqual([{ head: "TUITION", amount: 500 }]);
    expect(mtd.expenseByHead).toEqual([{ head: "RENT", amount: 200 }]);
    expect(mtd.totalIn).toBe(500);
    expect(mtd.totalOut).toBe(200); // transfer not counted as income/expense
  });
});

describe("B2. HR payroll bridge (PII-free aggregate)", () => {
  test("J-FIN2-4 returns Σ netPay over the approved_locked run; absent run ⇒ 0/found:false", async () => {
    expect(await hrPayrollNetPayableTotal("2026-06")).toEqual({ monthKey: "2026-06", total: 0, found: false });

    mockRuns.push({ _id: "run-1", monthKey: "2026-06", status: "approved_locked" } as unknown as Row);
    mockSlips.push({ _id: "ps-1", payrollRunId: "run-1", netPay: 50000 } as unknown as Row);
    mockSlips.push({ _id: "ps-2", payrollRunId: "run-1", netPay: 42000 } as unknown as Row);
    const out = await hrPayrollNetPayableTotal("2026-06");
    expect(out).toEqual({ monthKey: "2026-06", total: 92000, found: true });
  });
});
