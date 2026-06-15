/**
 * Finance FIN-4 tests (prd-finance-fin4.md §10, J-FIN4-1..J-FIN4-4).
 * DB-free: the seam's models (LedgerOpeningBalance/FinancePosting/QardIouEntry) +
 * ReconciliationEntry + writeAudit are mocked. We seed openings so `ledgerBalanceAsOf`
 * returns known per-ledger figures, then assert the diffs, append-only history, and the
 * unreconciled-days read.
 */
interface Row { _id: { toString(): string }; [k: string]: unknown }
const mockOpenings: Row[] = [];
const mockPostings: Row[] = [];
const mockQard: Row[] = [];
const mockRecons: Row[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];

const matchVal = (rv: unknown, cond: unknown): boolean => {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, Date>;
    if ("$lte" in c && (rv as Date).getTime() > c.$lte.getTime()) return false;
    if ("$gte" in c && (rv as Date).getTime() < c.$gte.getTime()) return false;
    return true;
  }
  return rv === cond;
};
const matches = (r: Row, q: Record<string, unknown>) => Object.entries(q).every(([k, v]) => matchVal(r[k], v));
const queryObj = (arr: Row[]) => ({
  lean: () => Promise.resolve(arr),
  select: () => ({ lean: () => Promise.resolve(arr) }),
  sort: () => Promise.resolve([...arr].sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())),
});
function makeModel(store: Row[], prefix: string) {
  return {
    create: (doc: Record<string, unknown>) => {
      const seq = ++mockSeq;
      const row: Row = { ...doc, _id: { toString: () => `${prefix}-${seq}` }, createdAt: new Date(Date.now() + seq) };
      store.push(row);
      return Promise.resolve(row);
    },
    find: (q: Record<string, unknown> = {}) => queryObj(store.filter((r) => matches(r, q))),
    findOne: (q: Record<string, unknown> = {}) => {
      const hit = store.filter((r) => matches(r, q));
      return { sort: () => Promise.resolve(hit.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0] ?? null) };
    },
  };
}

jest.mock("../modules/finance/models/LedgerOpeningBalance", () => ({ LedgerOpeningBalance: makeModel(mockOpenings, "ob") }));
jest.mock("../modules/finance/models/FinancePosting", () => ({ FinancePosting: makeModel(mockPostings, "fp") }));
jest.mock("../modules/finance/models/QardIouEntry", () => ({ QardIouEntry: makeModel(mockQard, "qe") }));
jest.mock("../modules/finance/models/ReconciliationEntry", () => ({ ReconciliationEntry: makeModel(mockRecons, "rc") }));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: Record<string, unknown>) => { mockAudits.push(p); return Promise.resolve(); },
}));

import * as RS from "../modules/finance/services/ReconciliationService";
import { FinanceError } from "../modules/finance/services/FinanceLedgerService";

const ACTOR = { userId: "office-1", role: "OFFICE" };
const d = (iso: string) => new Date(iso);

beforeEach(() => {
  [mockOpenings, mockPostings, mockQard, mockRecons].forEach((s) => (s.length = 0));
  mockAudits.length = 0;
  mockSeq = 0;
});

const seedOpening = (ledger: string, amount: number) =>
  mockOpenings.push({ _id: { toString: () => `ob-${++mockSeq}` }, ledger, amount, effectiveDate: d("2026-06-01"), createdAt: d("2026-06-01") } as Row);

describe("ReconciliationService", () => {
  test("J-FIN4-1/2 bank + Eximus diffs computed off the derived seam + audited", async () => {
    seedOpening("CASH", 5000);
    seedOpening("BANK", 9000);
    seedOpening("ONLINE", 1500);

    const row = await RS.recordReconciliation(
      { date: "2026-06-15", bankStatementBalance: 8800, eximusClosing: { CASH: 5000, BANK: 8900, ONLINE: 1500 } },
      ACTOR,
    );
    expect(row.appBankBalance).toBe(9000);
    expect(row.bankDiff).toBe(200); // 9000 − 8800
    expect(row.eximusDiff).toEqual({ CASH: 0, BANK: 100, ONLINE: 0 }); // BANK drifted by 100
    expect(row.appClosing).toEqual({ CASH: 5000, BANK: 9000, ONLINE: 1500 });
    expect(mockAudits.some((a) => a.eventKind === "RECONCILIATION_RECORDED")).toBe(true);
  });

  test("bank-only reconciliation leaves Eximus null", async () => {
    seedOpening("BANK", 9000);
    const row = await RS.recordReconciliation({ date: "2026-06-15", bankStatementBalance: 9000 }, ACTOR);
    expect(row.bankDiff).toBe(0);
    expect(row.eximusDiff).toBeNull();
  });

  test("at least one figure is required", async () => {
    await expect(RS.recordReconciliation({ date: "2026-06-15" }, ACTOR)).rejects.toThrow(FinanceError);
  });

  test("J-FIN4-4 re-reconcile appends a new entry; latest wins (history retained)", async () => {
    seedOpening("BANK", 9000);
    await RS.recordReconciliation({ date: "2026-06-15", bankStatementBalance: 8800 }, ACTOR);
    await RS.recordReconciliation({ date: "2026-06-15", bankStatementBalance: 9000 }, ACTOR);
    expect(mockRecons).toHaveLength(2); // append-only
    const latest = await RS.latestReconciliation("2026-06-15");
    expect(latest!.bankDiff).toBe(0); // the corrected (latest) entry
  });

  test("J-FIN4-3 unreconciledDays: posting days with no reconciliation", async () => {
    mockPostings.push({ _id: { toString: () => "fp-1" }, date: d("2026-06-10T09:00:00Z") } as Row);
    mockQard.push({ _id: { toString: () => "qe-1" }, date: d("2026-06-12T09:00:00Z") } as Row);
    // reconcile only 06-10
    mockRecons.push({ _id: { toString: () => "rc-1" }, date: d("2026-06-10T23:59:59.999Z"), createdAt: d("2026-06-10") } as Row);

    const days = await RS.unreconciledDays("2026-06-01", "2026-06-30");
    expect(days).toEqual(["2026-06-12"]); // 06-10 reconciled, 06-12 not
  });
});
