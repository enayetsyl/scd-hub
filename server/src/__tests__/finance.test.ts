/**
 * Finance FIN-1 tests (prd-finance-fin1.md §10, J-FIN1-1..J-FIN1-4 + the RBAC/vocab
 * invariants the verifier also proves). Two halves:
 *
 *   A. The PURE seam (`openingFor`) — the authoritative-opening resolution: latest
 *      declaration wins (J-FIN1-3 append-only correction), effective-dating returns 0
 *      before the declaration's date (J-FIN1-4), un-declared ⇒ 0.
 *   B. The service — DB-free (the LedgerOpeningBalance model + writeAudit are mocked with
 *      small in-memory stores): setOpeningBalance APPENDS (never overwrites) + validates +
 *      audits (J-FIN1-1); openingBalances is the 5-ledger vector (J-FIN1-2); the
 *      ledgerBalanceAsOf seam returns the opening (FIN-1).
 *
 * NOTE: everything referenced inside a jest.mock() factory is `mock`-prefixed so
 * babel-plugin-jest-hoist allows the out-of-scope reference.
 */
import {
  openingFor,
  type OpeningDeclaration,
} from "../modules/finance/services/FinanceLedgerService";
import { LEDGER_KINDS } from "@scd/shared";

// ---------------------------------------------------------------------------
// Mocks (mock-prefixed for jest.mock hoisting)
// ---------------------------------------------------------------------------

interface MockRow {
  _id: { toString(): string };
  ledger: string;
  amount: number;
  effectiveDate: Date;
  note: string | null;
  enteredByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}
const mockStore: MockRow[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];

jest.mock("../modules/finance/models/LedgerOpeningBalance", () => ({
  LedgerOpeningBalance: {
    create: (doc: Record<string, unknown>) => {
      const seq = ++mockSeq;
      const now = new Date(Date.now() + seq); // strictly monotonic createdAt for latest-wins
      const row: MockRow = {
        _id: { toString: () => `ob-${seq}` },
        ledger: doc.ledger as string,
        amount: doc.amount as number,
        effectiveDate: doc.effectiveDate as Date,
        note: (doc.note as string | null) ?? null,
        enteredByUserId: doc.enteredByUserId as string,
        createdAt: now,
        updatedAt: now,
      };
      mockStore.push(row);
      return Promise.resolve(row);
    },
    find: () => ({ lean: () => Promise.resolve(mockStore) }),
  },
}));

// FIN-2A extended ledgerBalanceAsOf to add Σ postings — stub the model to NO postings so
// the FIN-1 seam still resolves to the opening-only figure these tests assert.
jest.mock("../modules/finance/models/FinancePosting", () => ({
  FinancePosting: { find: () => ({ lean: () => Promise.resolve([]) }) },
}));
// FIN-3 extended the seam again to add Σ Qard/IOU entries — stub to none for FIN-1 tests.
jest.mock("../modules/finance/models/QardIouEntry", () => ({
  QardIouEntry: { find: () => ({ lean: () => Promise.resolve([]) }) },
}));

jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (params: Record<string, unknown>) => {
    mockAudits.push(params);
    return Promise.resolve();
  },
}));

import * as FIN from "../modules/finance/services/FinanceLedgerService";

const ACTOR = { userId: "office-1", role: "OFFICE" };

beforeEach(() => {
  mockStore.length = 0;
  mockAudits.length = 0;
  mockSeq = 0;
});

const d = (iso: string) => new Date(iso);

// ===========================================================================
// A. The pure seam — openingFor
// ===========================================================================

describe("A. openingFor (the pure authoritative-opening seam)", () => {
  test("un-declared ledger ⇒ 0", () => {
    expect(openingFor([], "CASH", d("2026-06-15"))).toBe(0);
  });

  test("J-FIN1-1: a single declaration is returned at/after its effectiveDate", () => {
    const decls: OpeningDeclaration[] = [
      { ledger: "CASH", amount: 5000, effectiveDate: d("2026-06-01"), createdAt: d("2026-06-01T10:00:00Z") },
    ];
    expect(openingFor(decls, "CASH", d("2026-06-01"))).toBe(5000);
    expect(openingFor(decls, "CASH", d("2026-06-30"))).toBe(5000);
  });

  test("J-FIN1-4 effective-dating: asOf BEFORE the effectiveDate ⇒ 0", () => {
    const decls: OpeningDeclaration[] = [
      { ledger: "CASH", amount: 5000, effectiveDate: d("2026-06-10"), createdAt: d("2026-06-10T10:00:00Z") },
    ];
    expect(openingFor(decls, "CASH", d("2026-06-09"))).toBe(0);
    expect(openingFor(decls, "CASH", d("2026-06-10"))).toBe(5000);
  });

  test("J-FIN1-3 append-only correction: the LATEST declaration (by createdAt) supersedes", () => {
    const decls: OpeningDeclaration[] = [
      { ledger: "CASH", amount: 5000, effectiveDate: d("2026-06-01"), createdAt: d("2026-06-01T10:00:00Z") },
      // a later re-declaration, same effective date, entered afterwards (the correction)
      { ledger: "CASH", amount: 5200, effectiveDate: d("2026-06-01"), createdAt: d("2026-06-02T09:00:00Z") },
    ];
    expect(openingFor(decls, "CASH", d("2026-06-15"))).toBe(5200);
  });

  test("control ledger opening may be negative", () => {
    const decls: OpeningDeclaration[] = [
      { ledger: "QARD_CONTROL", amount: -1200, effectiveDate: d("2026-06-01"), createdAt: d("2026-06-01T10:00:00Z") },
    ];
    expect(openingFor(decls, "QARD_CONTROL", d("2026-06-15"))).toBe(-1200);
  });

  test("declarations for other ledgers are ignored", () => {
    const decls: OpeningDeclaration[] = [
      { ledger: "BANK", amount: 9000, effectiveDate: d("2026-06-01"), createdAt: d("2026-06-01T10:00:00Z") },
    ];
    expect(openingFor(decls, "CASH", d("2026-06-15"))).toBe(0);
    expect(openingFor(decls, "BANK", d("2026-06-15"))).toBe(9000);
  });
});

// ===========================================================================
// B. The service (mocked store)
// ===========================================================================

describe("B. FinanceLedgerService", () => {
  test("J-FIN1-1 setOpeningBalance appends a row + audits FINANCE_OPENING_BALANCE_SET", async () => {
    const row = await FIN.setOpeningBalance(
      { ledger: "CASH", amount: 5000, effectiveDate: d("2026-06-01"), note: "cutover" },
      ACTOR,
    );
    expect(row.ledger).toBe("CASH");
    expect(row.amount).toBe(5000);
    expect(mockStore).toHaveLength(1);

    expect(mockAudits).toHaveLength(1);
    const a = mockAudits[0];
    expect(a.eventKind).toBe("FINANCE_OPENING_BALANCE_SET");
    expect(a.actorId).toBe("office-1");
    expect(a.targetKind).toBe("LedgerOpeningBalance");
    const meta = a.meta as { ledger: string; amount: number };
    expect(meta.ledger).toBe("CASH");
    expect(meta.amount).toBe(5000);
  });

  test("J-FIN1-3 a correction APPENDS (never overwrites) — both rows retained, latest authoritative", async () => {
    await FIN.setOpeningBalance({ ledger: "CASH", amount: 5000, effectiveDate: d("2026-06-01") }, ACTOR);
    await FIN.setOpeningBalance({ ledger: "CASH", amount: 5200, effectiveDate: d("2026-06-01") }, ACTOR);
    expect(mockStore).toHaveLength(2); // append-only — the prior row is kept
    expect(await FIN.ledgerBalanceAsOf("CASH", d("2026-06-15"))).toBe(5200); // latest wins
  });

  test("validation: unknown ledger / non-finite amount / bad date are rejected (Bangla 422)", async () => {
    await expect(
      FIN.setOpeningBalance({ ledger: "NOPE", amount: 1, effectiveDate: d("2026-06-01") }, ACTOR),
    ).rejects.toThrow(FIN.FinanceError);
    await expect(
      FIN.setOpeningBalance({ ledger: "CASH", amount: Infinity, effectiveDate: d("2026-06-01") }, ACTOR),
    ).rejects.toThrow(FIN.FinanceError);
    await expect(
      FIN.setOpeningBalance({ ledger: "CASH", amount: 1, effectiveDate: new Date("not-a-date") }, ACTOR),
    ).rejects.toThrow(FIN.FinanceError);
    expect(mockStore).toHaveLength(0);
    expect(mockAudits).toHaveLength(0);
  });

  test("J-FIN1-2 openingBalances returns the 5-ledger vector (un-declared ⇒ 0)", async () => {
    await FIN.setOpeningBalance({ ledger: "CASH", amount: 5000, effectiveDate: d("2026-06-01") }, ACTOR);
    await FIN.setOpeningBalance({ ledger: "BANK", amount: 9000, effectiveDate: d("2026-06-01") }, ACTOR);
    const vec = await FIN.openingBalances(d("2026-06-15"));
    expect(vec.map((b) => b.ledger).sort()).toEqual([...LEDGER_KINDS].sort());
    const byLedger = Object.fromEntries(vec.map((b) => [b.ledger, b.amount]));
    expect(byLedger.CASH).toBe(5000);
    expect(byLedger.BANK).toBe(9000);
    expect(byLedger.ONLINE).toBe(0); // un-declared
    expect(byLedger.QARD_CONTROL).toBe(0);
    expect(byLedger.IOU_CONTROL).toBe(0);
  });

  test("ledgerBalanceAsOf seam: opening before the effective date is 0, at/after is the amount", async () => {
    await FIN.setOpeningBalance({ ledger: "ONLINE", amount: 1500, effectiveDate: d("2026-06-10") }, ACTOR);
    expect(await FIN.ledgerBalanceAsOf("ONLINE", d("2026-06-09"))).toBe(0);
    expect(await FIN.ledgerBalanceAsOf("ONLINE", d("2026-06-10"))).toBe(1500);
  });

  test("ledgerBalanceAsOf rejects an unknown ledger", async () => {
    await expect(FIN.ledgerBalanceAsOf("NOPE", d("2026-06-15"))).rejects.toThrow(FIN.FinanceError);
  });
});
