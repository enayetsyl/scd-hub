/**
 * Finance FIN-3 tests (prd-finance-fin3.md §10, J-FIN3-1..J-FIN3-5 + §3 math).
 *   A. Pure `qardIouMath` — per-entry ledger effects (disburse/repay/adjust + reversal),
 *      partyOutstanding, overdueList ranking.
 *   B. The service + the extended seam — DB-free (FinanceParty/QardIouEntry +
 *      LedgerOpeningBalance/FinancePosting + writeAudit mocked): setParty, recordEntry
 *      validation (ADJUSTMENT signed; disburse > 0), the per-party outstanding, the
 *      overdue list, and that `ledgerBalanceAsOf` folds in BOTH the cash and control
 *      effects of one entry (D-#233, no double-count).
 */
import {
  qardEntryEffects,
  partyOutstanding as partyOutstandingPure,
  overdueList,
  controlLedgerFor,
  type QardEntryLike,
} from "../modules/finance/qardIouMath";

interface Row { _id: { toString(): string }; [k: string]: unknown }
const mockParties: Row[] = [];
const mockEntries: Row[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];

const idStr = (x: unknown): string | null => (x ? (x as { toString(): string }).toString() : null);
const matchVal = (rv: unknown, cond: unknown): boolean => {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("$lte" in c) return (rv as Date).getTime() <= (c.$lte as Date).getTime();
    return true;
  }
  return idStr(rv) === idStr(cond) || rv === cond;
};
const matches = (r: Row, q: Record<string, unknown>) => Object.entries(q).every(([k, v]) => matchVal(r[k], v));
const query = (arr: Row[]) => ({ lean: () => Promise.resolve(arr), sort: () => Promise.resolve(arr) });
function makeModel(store: Row[], prefix: string) {
  return {
    create: (doc: Record<string, unknown>) => {
      const seq = ++mockSeq;
      const row: Row = { ...doc, _id: { toString: () => `${prefix}-${seq}` }, createdAt: new Date(Date.now() + seq) };
      store.push(row);
      return Promise.resolve(row);
    },
    find: (q: Record<string, unknown> = {}) => query(store.filter((r) => matches(r, q))),
    findById: (id: string) => ({ lean: () => Promise.resolve(store.find((r) => r._id.toString() === id) ?? null) }),
  };
}

jest.mock("../modules/finance/models/FinanceParty", () => ({ FinanceParty: makeModel(mockParties, "party") }));
jest.mock("../modules/finance/models/QardIouEntry", () => ({ QardIouEntry: makeModel(mockEntries, "qe") }));
jest.mock("../modules/finance/models/LedgerOpeningBalance", () => ({ LedgerOpeningBalance: { find: () => ({ lean: () => Promise.resolve([]) }) } }));
jest.mock("../modules/finance/models/FinancePosting", () => ({ FinancePosting: { find: () => ({ lean: () => Promise.resolve([]) }) } }));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: Record<string, unknown>) => { mockAudits.push(p); return Promise.resolve(); },
}));

import * as QS from "../modules/finance/services/QardIouService";
import { ledgerBalanceAsOf, FinanceError } from "../modules/finance/services/FinanceLedgerService";

const ACTOR = { userId: "office-1", role: "OFFICE" };
const d = (iso: string) => new Date(iso);
const PARTY1 = "0000000000000000000000c1";

beforeEach(() => {
  mockParties.length = 0;
  mockEntries.length = 0;
  mockAudits.length = 0;
  mockSeq = 0;
});

// ===========================================================================
// A. Pure math
// ===========================================================================

describe("A. qardIouMath", () => {
  const e = (over: Partial<QardEntryLike>): QardEntryLike => ({
    type: "QARD_E_HASANA", direction: "NEW_DISBURSEMENT", amount: 1000, date: d("2026-06-01"), mode: "CASH", partyId: PARTY1, ...over,
  });

  test("controlLedgerFor maps type → control ledger", () => {
    expect(controlLedgerFor("QARD_E_HASANA")).toBe("QARD_CONTROL");
    expect(controlLedgerFor("IOU")).toBe("IOU_CONTROL");
  });

  test("NEW_DISBURSEMENT: cash out + control up (one record, both effects)", () => {
    expect(qardEntryEffects(e({}))).toEqual([
      { ledger: "CASH", delta: -1000 },
      { ledger: "QARD_CONTROL", delta: 1000 },
    ]);
  });

  test("REPAYMENT_RECEIVED: cash in + control down", () => {
    expect(qardEntryEffects(e({ direction: "REPAYMENT_RECEIVED", amount: 400 }))).toEqual([
      { ledger: "CASH", delta: 400 },
      { ledger: "QARD_CONTROL", delta: -400 },
    ]);
  });

  test("ADJUSTMENT: control only, signed (write-off negative)", () => {
    expect(qardEntryEffects(e({ direction: "ADJUSTMENT", amount: -300 }))).toEqual([{ ledger: "QARD_CONTROL", delta: -300 }]);
  });

  test("a reversal negates the whole effect", () => {
    expect(qardEntryEffects(e({ reversesEntryId: "x" }))).toEqual([
      { ledger: "CASH", delta: 1000 },
      { ledger: "QARD_CONTROL", delta: -1000 },
    ]);
  });

  test("J-FIN3-1/2 partyOutstanding: Σ disburse − repay ± adjust", () => {
    const list = [e({}), e({ direction: "REPAYMENT_RECEIVED", amount: 400, date: d("2026-06-10") })];
    expect(partyOutstandingPure(list, PARTY1, d("2026-06-15"), "QARD_E_HASANA")).toBe(600);
  });

  test("J-FIN3-3 overdueList: past-due unpaid ranked by lateness; settled excluded", () => {
    const list = [
      e({ partyId: PARTY1, dueDate: d("2026-06-05") }), // QARD disbursed, due 06-05
      e({ partyId: "0000000000000000000000c2", type: "IOU", dueDate: d("2026-06-01") }), // IOU, due earlier
    ];
    const rows = overdueList(list, d("2026-06-15"));
    expect(rows).toHaveLength(2);
    expect(rows[0].partyId).toBe("0000000000000000000000c2"); // most overdue first
    expect(rows[0].daysLate).toBe(14);
  });

  test("overdueList omits a disbursement fully repaid", () => {
    const list = [
      e({ partyId: PARTY1, amount: 1000, dueDate: d("2026-06-05") }),
      e({ partyId: PARTY1, direction: "REPAYMENT_RECEIVED", amount: 1000, date: d("2026-06-06") }),
    ];
    expect(overdueList(list, d("2026-06-15"))).toHaveLength(0);
  });
});

// ===========================================================================
// B. The service + the extended seam
// ===========================================================================

describe("B. QardIouService + the seam fold", () => {
  const seedParty = () => mockParties.push({ _id: { toString: () => PARTY1 }, name: "Community Fund", kind: "COMMUNITY", active: true } as Row);

  test("setParty validates kind, appends + audits", async () => {
    const p = await QS.setParty({ name: "Community Fund", kind: "COMMUNITY" }, ACTOR);
    expect(p.kind).toBe("COMMUNITY");
    expect(mockAudits.some((a) => a.eventKind === "FINANCE_PARTY_SET")).toBe(true);
    await expect(QS.setParty({ name: "x", kind: "NOPE" }, ACTOR)).rejects.toThrow(FinanceError);
  });

  test("recordEntry validation: disburse must be > 0; ADJUSTMENT may be negative; bad type/mode rejected", async () => {
    seedParty();
    await expect(QS.recordEntry({ partyId: PARTY1, type: "QARD_E_HASANA", direction: "NEW_DISBURSEMENT", amount: -5, date: d("2026-06-01"), mode: "CASH" }, ACTOR)).rejects.toThrow(FinanceError);
    const adj = await QS.recordEntry({ partyId: PARTY1, type: "QARD_E_HASANA", direction: "ADJUSTMENT", amount: -300, date: d("2026-06-01"), mode: "CASH" }, ACTOR);
    expect(adj.amount).toBe(-300);
    await expect(QS.recordEntry({ partyId: PARTY1, type: "NOPE", direction: "ADJUSTMENT", amount: 1, date: d("2026-06-01"), mode: "CASH" }, ACTOR)).rejects.toThrow(FinanceError);
    expect(mockAudits.some((a) => a.eventKind === "QARD_IOU_ENTRY_RECORDED")).toBe(true);
  });

  test("J-FIN3-1 the seam folds BOTH effects of one entry (cash − , control + ); no double-count", async () => {
    seedParty();
    await QS.recordEntry({ partyId: PARTY1, type: "QARD_E_HASANA", direction: "NEW_DISBURSEMENT", amount: 1000, date: d("2026-06-01"), mode: "CASH" }, ACTOR);
    expect(await ledgerBalanceAsOf("CASH", d("2026-06-02"))).toBe(-1000); // cash out
    expect(await ledgerBalanceAsOf("QARD_CONTROL", d("2026-06-02"))).toBe(1000); // outstanding up

    await QS.recordEntry({ partyId: PARTY1, type: "QARD_E_HASANA", direction: "REPAYMENT_RECEIVED", amount: 400, date: d("2026-06-05"), mode: "CASH" }, ACTOR);
    expect(await ledgerBalanceAsOf("CASH", d("2026-06-06"))).toBe(-600);
    expect(await ledgerBalanceAsOf("QARD_CONTROL", d("2026-06-06"))).toBe(600);
  });

  test("J-FIN3-1/2 partyOutstanding (DB) returns only non-zero type rows", async () => {
    seedParty();
    await QS.recordEntry({ partyId: PARTY1, type: "QARD_E_HASANA", direction: "NEW_DISBURSEMENT", amount: 1000, date: d("2026-06-01"), mode: "CASH" }, ACTOR);
    await QS.recordEntry({ partyId: PARTY1, type: "QARD_E_HASANA", direction: "REPAYMENT_RECEIVED", amount: 250, date: d("2026-06-05"), mode: "CASH" }, ACTOR);
    const out = await QS.partyOutstanding(PARTY1, d("2026-06-15"));
    expect(out).toEqual([{ partyId: PARTY1, type: "QARD_E_HASANA", outstanding: 750 }]);
  });

  test("J-FIN3-3 overdueList (DB) surfaces a past-due unpaid party", async () => {
    seedParty();
    await QS.recordEntry({ partyId: PARTY1, type: "QARD_E_HASANA", direction: "NEW_DISBURSEMENT", amount: 1000, date: d("2026-06-01"), mode: "CASH", dueDate: d("2026-06-05") }, ACTOR);
    const rows = await QS.overdueList(d("2026-06-15"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ partyId: PARTY1, outstanding: 1000, daysLate: 10 });
  });
});
