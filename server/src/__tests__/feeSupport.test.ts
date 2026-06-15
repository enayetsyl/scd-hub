/**
 * Finance FIN-2B tests (prd-finance-fin2.md §10.2, J-FIN2-5..J-FIN2-7 + §3.B math).
 *   A. Pure `splitFee` (FULL / AMOUNT cap / uncovered / mixed) + `activeAllocationFor`
 *      (latest-by-createdAt, effective-dating, status, endDate).
 *   B. The service — DB-free (models + Student + renderTemplate + emitFinanceFeeDue +
 *      writeAudit mocked): allocation append + audit, provider receipt, the derived
 *      provider statement (raised − received = outstanding, J-FIN2-6), and the guardian
 *      fee-due chase (wa.me + emit + audit; null when no due, J-FIN2-7).
 */
import { splitFee, activeAllocationFor, type AllocationLike } from "../modules/finance/feeSplit";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface Row { _id: { toString(): string }; [k: string]: unknown }
const mockProviders: Row[] = [];
const mockAllocs: Row[] = [];
const mockReceipts: Row[] = [];
const mockPostings: Row[] = [];
const mockStudents: Row[] = [];
let mockSeq = 0;
const mockAudits: Array<Record<string, unknown>> = [];
const mockEmits: Array<Record<string, unknown>> = [];

const idStr = (x: unknown): string | null => (x ? (x as { toString(): string }).toString() : null);
const matchVal = (rv: unknown, cond: unknown): boolean => {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("$ne" in c) return idStr(rv) !== idStr(c.$ne);
    if ("$in" in c) return (c.$in as unknown[]).map(idStr).includes(idStr(rv));
    if ("$lte" in c) return (rv as Date).getTime() <= (c.$lte as Date).getTime();
    return true;
  }
  return idStr(rv) === idStr(cond) || rv === cond;
};
const matches = (r: Row, q: Record<string, unknown>): boolean =>
  Object.entries(q).every(([k, v]) => matchVal(r[k], v));

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
    findById: (id: string) => ({ lean: () => Promise.resolve(store.find((r) => r._id.toString() === id) ?? null), then: (res: (v: unknown) => unknown) => Promise.resolve(store.find((r) => r._id.toString() === id) ?? null).then(res) }),
  };
}

jest.mock("../modules/finance/models/FeeProvider", () => ({ FeeProvider: makeModel(mockProviders, "prov") }));
jest.mock("../modules/finance/models/FeeSupportAllocation", () => ({ FeeSupportAllocation: makeModel(mockAllocs, "alloc") }));
jest.mock("../modules/finance/models/ProviderReceipt", () => ({ ProviderReceipt: makeModel(mockReceipts, "rcpt") }));
jest.mock("../modules/finance/models/FinancePosting", () => ({ FinancePosting: makeModel(mockPostings, "fp") }));
jest.mock("../modules/foundation/models/Student", () => ({ Student: makeModel(mockStudents, "stu") }));
jest.mock("../modules/templates/services/MessageTemplateService", () => ({
  renderTemplate: (key: string, params: Record<string, unknown> = {}) => Promise.resolve(`${key}|${JSON.stringify(params)}`),
}));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitFinanceFeeDue: (ev: Record<string, unknown>) => {
    mockEmits.push(ev);
    return Promise.resolve(["g1"]);
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: Record<string, unknown>) => { mockAudits.push(p); return Promise.resolve(); },
}));

import * as FS from "../modules/finance/services/FeeSupportService";
import { FinanceError } from "../modules/finance/services/FinanceLedgerService";

const ACTOR = { userId: "office-1", role: "OFFICE" };
const d = (iso: string) => new Date(iso);
// valid 24-hex student ids (Types.ObjectId(...) is used in the service filters)
const STU1 = "0000000000000000000000a1";
const PROV1 = "0000000000000000000000b1";

beforeEach(() => {
  [mockProviders, mockAllocs, mockReceipts, mockPostings, mockStudents].forEach((s) => (s.length = 0));
  mockAudits.length = 0;
  mockEmits.length = 0;
  mockSeq = 0;
});

// ===========================================================================
// A. Pure math
// ===========================================================================

describe("A. splitFee (the pure per-head fee-split)", () => {
  test("uncovered head ⇒ all guardian-due", () => {
    const s = splitFee([{ head: "TUITION", amount: 1000 }], []);
    expect(s).toMatchObject({ gross: 1000, providerDue: 0, guardianDue: 1000 });
  });

  test("FULL ⇒ all provider-due", () => {
    const s = splitFee([{ head: "TUITION", amount: 1000 }], [{ head: "TUITION", type: "FULL" }]);
    expect(s).toMatchObject({ providerDue: 1000, guardianDue: 0 });
  });

  test("J-FIN2-5 AMOUNT caps the provider share; the rest is guardian-due", () => {
    const s = splitFee([{ head: "TUITION", amount: 1000 }], [{ head: "TUITION", type: "AMOUNT", amount: 400 }]);
    expect(s).toMatchObject({ providerDue: 400, guardianDue: 600 });
  });

  test("AMOUNT cap above the posted amount never exceeds it", () => {
    const s = splitFee([{ head: "TUITION", amount: 300 }], [{ head: "TUITION", type: "AMOUNT", amount: 400 }]);
    expect(s).toMatchObject({ providerDue: 300, guardianDue: 0 });
  });

  test("mixed lines: FULL on one head, AMOUNT on another, uncovered on a third", () => {
    const s = splitFee(
      [{ head: "TUITION", amount: 1000 }, { head: "TRANSPORT", amount: 500 }, { head: "BOOKS_STATIONERIES", amount: 300 }],
      [{ head: "TUITION", type: "FULL" }, { head: "TRANSPORT", type: "AMOUNT", amount: 200 }],
    );
    expect(s.gross).toBe(1800);
    expect(s.providerDue).toBe(1200); // 1000 + 200
    expect(s.guardianDue).toBe(600); // 300 (transport remainder) + 300 (books)
  });
});

describe("A2. activeAllocationFor", () => {
  const a = (over: Partial<AllocationLike>): AllocationLike => ({
    studentId: STU1, providerId: PROV1, coverage: [], effectiveDate: d("2026-06-01"), endDate: null, status: "ACTIVE", createdAt: d("2026-06-01T10:00:00Z"), ...over,
  });

  test("latest by createdAt with effectiveDate ≤ asOf wins", () => {
    const list = [a({ createdAt: d("2026-06-01T10:00:00Z"), coverage: [{ head: "TUITION", type: "FULL" }] }), a({ createdAt: d("2026-06-05T10:00:00Z"), coverage: [{ head: "TUITION", type: "AMOUNT", amount: 100 }] })];
    expect(activeAllocationFor(list, STU1, d("2026-06-10"))?.coverage[0].type).toBe("AMOUNT");
  });

  test("effective-dating: an allocation not yet effective is ignored", () => {
    const list = [a({ effectiveDate: d("2026-06-10") })];
    expect(activeAllocationFor(list, STU1, d("2026-06-09"))).toBeNull();
  });

  test("ENDED status + a past endDate are excluded", () => {
    expect(activeAllocationFor([a({ status: "ENDED" })], STU1, d("2026-06-10"))).toBeNull();
    expect(activeAllocationFor([a({ endDate: d("2026-06-05") })], STU1, d("2026-06-10"))).toBeNull();
  });
});

// ===========================================================================
// B. The service
// ===========================================================================

describe("B. FeeSupportService", () => {
  const seedProvider = async () => {
    mockProviders.push({ _id: { toString: () => PROV1 }, name: "Zakat Fund", active: true } as Row);
  };
  const seedStudent = (over: Partial<Row> = {}) => {
    mockStudents.push({ _id: { toString: () => STU1 }, name: "Asila", phone: "01711000000", ...over } as Row);
  };
  const seedFee = (lines: Array<{ head: string; amount: number }>, date: string, reversed = false) => {
    mockPostings.push({ _id: { toString: () => `fp-${++mockSeq}` }, kind: "FEE_COLLECTION", studentId: { toString: () => STU1 }, date: d(date), feeLines: lines, reversesPostingId: reversed ? { toString: () => "x" } : null } as Row);
  };
  const seedAlloc = (coverage: Array<{ head: string; type: string; amount?: number }>, eff: string) => {
    mockAllocs.push({ _id: { toString: () => `alloc-${++mockSeq}` }, studentId: { toString: () => STU1 }, providerId: { toString: () => PROV1 }, coverage, effectiveDate: d(eff), endDate: null, status: "ACTIVE", createdAt: d(eff) } as Row);
  };

  test("setFeeSupportAllocation validates coverage, appends + audits", async () => {
    await seedProvider();
    const row = await FS.setFeeSupportAllocation(
      { studentId: STU1, providerId: PROV1, coverage: [{ head: "TUITION", type: "FULL" }], effectiveDate: d("2026-06-01") },
      ACTOR,
    );
    expect(row.status).toBe("ACTIVE");
    expect(mockAllocs).toHaveLength(1);
    expect(mockAudits.some((x) => x.eventKind === "FEE_SUPPORT_ALLOCATION_SET")).toBe(true);
  });

  test("setFeeSupportAllocation rejects an AMOUNT head with no amount + an unknown head", async () => {
    await seedProvider();
    await expect(FS.setFeeSupportAllocation({ studentId: STU1, providerId: PROV1, coverage: [{ head: "TUITION", type: "AMOUNT" }], effectiveDate: d("2026-06-01") }, ACTOR)).rejects.toThrow(FinanceError);
    await expect(FS.setFeeSupportAllocation({ studentId: STU1, providerId: PROV1, coverage: [{ head: "NOPE", type: "FULL" }], effectiveDate: d("2026-06-01") }, ACTOR)).rejects.toThrow(FinanceError);
  });

  test("J-FIN2-6 provider statement: raised (derived via splitFee) − received = outstanding", async () => {
    await seedProvider();
    seedAlloc([{ head: "TUITION", type: "AMOUNT", amount: 400 }], "2026-06-01");
    seedFee([{ head: "TUITION", amount: 1000 }], "2026-06-05"); // provider-due 400
    seedFee([{ head: "TUITION", amount: 1000 }], "2026-06-10"); // provider-due 400
    mockReceipts.push({ _id: { toString: () => "rcpt-1" }, providerId: { toString: () => PROV1 }, amount: 500 } as Row);

    const stmt = await FS.providerStatement(PROV1);
    expect(stmt.raised).toBe(800);
    expect(stmt.received).toBe(500);
    expect(stmt.outstanding).toBe(300);
  });

  test("recordProviderReceipt appends + audits; rejects bad mode/amount", async () => {
    await seedProvider();
    const r = await FS.recordProviderReceipt({ providerId: PROV1, amount: 500, date: d("2026-06-12"), mode: "BANK" }, ACTOR);
    expect(r.amount).toBe(500);
    expect(mockAudits.some((x) => x.eventKind === "PROVIDER_RECEIPT_RECORDED")).toBe(true);
    await expect(FS.recordProviderReceipt({ providerId: PROV1, amount: 0, date: d("2026-06-12"), mode: "BANK" }, ACTOR)).rejects.toThrow(FinanceError);
    await expect(FS.recordProviderReceipt({ providerId: PROV1, amount: 50, date: d("2026-06-12"), mode: "WALLET" }, ACTOR)).rejects.toThrow(FinanceError);
  });

  test("J-FIN2-7 chaseFeeDue: derives guardian-due, builds wa.me, emits, audits", async () => {
    seedStudent();
    seedAlloc([{ head: "TUITION", type: "AMOUNT", amount: 400 }], "2026-06-01");
    seedFee([{ head: "TUITION", amount: 1000 }], "2026-06-05"); // guardian-due 600

    const out = await FS.chaseFeeDue(STU1, ACTOR, d("2026-06-15"));
    expect(out).not.toBeNull();
    expect(out!.guardianDue).toBe(600);
    expect(out!.waLink).toContain("wa.me/01711000000");
    expect(out!.notifiedGuardianIds).toEqual(["g1"]);
    expect(mockEmits).toHaveLength(1);
    expect(mockAudits.some((x) => x.eventKind === "FINANCE_FEE_DUE_CHASED")).toBe(true);
  });

  test("J-FIN2-7 chaseFeeDue returns null when there is no outstanding guardian-due (FULL coverage)", async () => {
    seedStudent();
    seedAlloc([{ head: "TUITION", type: "FULL" }], "2026-06-01");
    seedFee([{ head: "TUITION", amount: 1000 }], "2026-06-05"); // guardian-due 0

    const out = await FS.chaseFeeDue(STU1, ACTOR, d("2026-06-15"));
    expect(out).toBeNull();
    expect(mockEmits).toHaveLength(0);
  });

  test("chaseFeeDue: a phone-less family is unreachableByWa but still emits to login-enabled guardians", async () => {
    seedStudent({ phone: undefined });
    seedFee([{ head: "TUITION", amount: 1000 }], "2026-06-05"); // no allocation ⇒ all guardian-due

    const out = await FS.chaseFeeDue(STU1, ACTOR, d("2026-06-15"));
    expect(out!.guardianDue).toBe(1000);
    expect(out!.waLink).toBeNull();
    expect(out!.unreachableByWa).toBe(true);
    expect(out!.notifiedGuardianIds).toEqual(["g1"]);
  });
});
