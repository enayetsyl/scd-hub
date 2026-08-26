/**
 * HR-3 — payroll math, the monthly run lifecycle, advances, payment export
 * (prd-hr §4, D-#26/#27/#109/#110). Pure math exercised directly; services run
 * against mocked models (DB-free, the repo's convention).
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockStaffFindById = jest.fn();
const mockStaffFind = jest.fn();
const mockLeaveFind = jest.fn();
const mockRunFindOne = jest.fn();
const mockRunFindById = jest.fn();
const mockRunCreate = jest.fn();
const mockSlipInsert = jest.fn();
const mockSlipFind = jest.fn();
const mockSlipDelete = jest.fn().mockResolvedValue(undefined);
const mockAdvFind = jest.fn();
const mockAdvFindOne = jest.fn();
const mockAdvFindById = jest.fn();
const mockAdvCreate = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: {
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockStaffFindById(id) }) }),
    find: (q: unknown) => ({ select: () => ({ lean: () => mockStaffFind(q) }) }),
  },
}));
jest.mock("../modules/hr/models/StaffLeaveApplication", () => ({
  StaffLeaveApplication: { find: (q: unknown) => ({ select: () => ({ lean: () => mockLeaveFind(q) }) }) },
}));
jest.mock("../modules/hr/models/PayrollRun", () => ({
  PayrollRun: {
    findOne: (q: unknown) => mockRunFindOne(q),
    findById: (id: unknown) => mockRunFindById(id),
    create: (d: unknown) => mockRunCreate(d),
    deleteOne: jest.fn().mockResolvedValue(undefined),
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
  },
}));
jest.mock("../modules/hr/models/Payslip", () => ({
  Payslip: {
    insertMany: (d: unknown) => mockSlipInsert(d),
    find: (q: unknown) => ({ lean: async () => mockSlipFind(q), sort: () => ({ lean: async () => mockSlipFind(q) }) }),
    deleteMany: (q: unknown) => mockSlipDelete(q),
  },
}));
jest.mock("../modules/hr/models/AdvanceLoan", () => ({
  AdvanceLoan: {
    find: (q: unknown) => ({ lean: () => mockAdvFind(q) }),
    findOne: (q: unknown) => ({ select: () => ({ lean: () => mockAdvFindOne(q) }) }),
    findById: (id: unknown) => mockAdvFindById(id),
    create: (d: unknown) => mockAdvCreate(d),
  },
}));
// SH-4 (D-#541): prepare/approve now touch the lateness reckoning. The policy is
// mocked to its DEFAULT — an absent HrPolicy row reads as HR_POLICY_DEFAULTS in
// production too, and the default has `latenessRuleEnabled: false`. That is exactly
// what the assertions below rely on: with the rule off, every payslip figure in this
// suite must be identical to what it was before SH-4 existed.
jest.mock("../modules/hr/models/HrPolicy", () => ({
  HrPolicy: { findOne: () => ({ lean: async () => null }) },
}));
jest.mock("../modules/hr/models/LatenessCharge", () => ({
  LatenessCharge: {
    findOne: () => ({ lean: async () => null }),
    findOneAndUpdate: jest.fn().mockResolvedValue({ _id: "x", amount: 0 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import { assertMonthKey, dayRate, computePayslip, PayrollError } from "../modules/hr/services/payrollMath";
import { preparePayrollRun, approvePayrollRun, cancelPayrollRun, paymentExport } from "../modules/hr/services/PayrollService";
import { issueAdvance, settleAdvance } from "../modules/hr/services/AdvanceService";
import { splitLatenessCharge } from "../modules/hr/services/LatenessService";
import { HR_POLICY_DEFAULTS } from "@scd/shared";

const ACTOR = oid().toString();
beforeEach(() => jest.clearAllMocks());

// ===========================================================================
describe("payroll math (pure)", () => {
  test("assertMonthKey accepts YYYY-MM, rejects junk", () => {
    expect(() => assertMonthKey("2026-06")).not.toThrow();
    expect(() => assertMonthKey("2026-13")).toThrow(PayrollError);
    expect(() => assertMonthKey("2026/06")).toThrow(PayrollError);
  });
  test("dayRate = monthly ÷ working days (rounded)", () => {
    expect(dayRate(30000, 30)).toBe(1000);
    expect(dayRate(20000, 30)).toBe(667);
    expect(() => dayRate(1000, 0)).toThrow(PayrollError);
  });
  test("net = gross − deductions + additions", () => {
    const r = computePayslip({
      grossSalary: 10000, dayRate: 333, unpaidLeaveDays: 0,
      manualAdditions: [{ type: "bonus", amount: 2000 }],
      manualDeductions: [{ type: "other", amount: 500 }],
    });
    expect(r.totalAdditions).toBe(2000);
    expect(r.totalDeductions).toBe(500);
    expect(r.netPay).toBe(11500);
  });
  test("additions are whole-taka rounded (net never comes out fractional)", () => {
    const r = computePayslip({
      grossSalary: 10000, dayRate: 333, unpaidLeaveDays: 0,
      manualAdditions: [{ type: "bonus", amount: 1500.5 }],
    });
    expect(r.totalAdditions).toBe(1501);
    expect(Number.isInteger(r.netPay)).toBe(true);
    expect(r.netPay).toBe(11501);
  });
  test("unpaid leave deducts day-rate × days (the only always-on deduction, D-#26)", () => {
    const r = computePayslip({ grossSalary: 30000, dayRate: 1000, unpaidLeaveDays: 3 });
    expect(r.deductions).toEqual([{ type: "unpaid_leave", amount: 3000, days: 3 }]);
    expect(r.netPay).toBe(27000);
  });
  test("lateness deduction only when a rule amount is passed (off by default, D-#26)", () => {
    expect(computePayslip({ grossSalary: 10000, dayRate: 333, unpaidLeaveDays: 0 }).deductions).toEqual([]);
    const r = computePayslip({ grossSalary: 10000, dayRate: 333, unpaidLeaveDays: 0, latenessDeduction: 250 });
    expect(r.deductions.some((d) => d.type === "lateness" && d.amount === 250)).toBe(true);
  });
});

// ===========================================================================
describe("the lateness rule (SH-4, D-#541 — pure)", () => {
  const N = HR_POLICY_DEFAULTS.lateDaysPerCharge; // 3

  test("the rule ships OFF, so landing SH-4 changes no existing payslip", () => {
    expect(HR_POLICY_DEFAULTS.latenessRuleEnabled).toBe(false);
    expect(N).toBe(3);
  });

  test("every 3 lates cost one day; 1–2 leftovers are forgiven at month end", () => {
    expect(splitLatenessCharge(2, N, 20)).toMatchObject({ chargedDays: 0, forgivenLates: 2 });
    expect(splitLatenessCharge(3, N, 20)).toMatchObject({ chargedDays: 1, forgivenLates: 0 });
    expect(splitLatenessCharge(5, N, 20)).toMatchObject({ chargedDays: 1, forgivenLates: 2 });
    expect(splitLatenessCharge(7, N, 20)).toMatchObject({ chargedDays: 2, forgivenLates: 1 });
  });

  test("the charge comes off the leave pool FIRST, then salary", () => {
    // Pool covers it entirely.
    expect(splitLatenessCharge(6, N, 20)).toMatchObject({ chargedDays: 2, paidFromLeave: 2, chargedToSalary: 0 });
    // Pool covers one of the two.
    expect(splitLatenessCharge(6, N, 1)).toMatchObject({ chargedDays: 2, paidFromLeave: 1, chargedToSalary: 1 });
    // Empty pool → straight to salary. This is the probationer's case: they have no
    // pool at all, so every third late is money.
    expect(splitLatenessCharge(3, N, 0)).toMatchObject({ chargedDays: 1, paidFromLeave: 0, chargedToSalary: 1 });
  });

  test("a fractional pool cannot absorb a whole charged day (D-#361 partial days are 1/3)", () => {
    // 2/3 of a day left is not a day. Floor it, or the balance is left with an
    // unexplainable stub and the payslip is short by a third of a day-rate.
    expect(splitLatenessCharge(3, N, 0.67)).toMatchObject({ paidFromLeave: 0, chargedToSalary: 1 });
    expect(splitLatenessCharge(3, N, 1.33)).toMatchObject({ paidFromLeave: 1, chargedToSalary: 0 });
  });

  test("no lates → nothing charged; a negative count is treated as zero", () => {
    expect(splitLatenessCharge(0, N, 20)).toMatchObject({ chargedDays: 0, paidFromLeave: 0, chargedToSalary: 0 });
    expect(splitLatenessCharge(-4, N, 20)).toMatchObject({ chargedDays: 0, forgivenLates: 0 });
  });

  test("a policy of 0 days per charge is refused rather than dividing by zero", () => {
    expect(() => splitLatenessCharge(5, 0, 20)).toThrow();
  });
  test("advance net-pay guard: one-shot caps at net, never negative (excess rolls forward, D-#27)", () => {
    const r = computePayslip({
      grossSalary: 10000, dayRate: 333, unpaidLeaveDays: 0,
      advance: { advanceId: "a1", recoveryMode: "one_shot", balance: 50000 },
    });
    expect(r.advanceRepaid).toBe(10000); // capped at gross, not 50000
    expect(r.netPay).toBe(0);            // never below zero
  });
  test("advance installments recover min(installment, balance)", () => {
    const r = computePayslip({
      grossSalary: 30000, dayRate: 1000, unpaidLeaveDays: 0,
      advance: { advanceId: "a1", recoveryMode: "installments", installmentAmount: 2000, balance: 5000 },
    });
    expect(r.advanceRepaid).toBe(2000);
    expect(r.netPay).toBe(28000);
  });
});

// ===========================================================================
describe("preparePayrollRun", () => {
  /**
   * SH-3 / D-#540 — the double-charge guard. Probation leave is stored unpaid but
   * HELD: the ProbationLeaveDebt ledger collects it once, at confirmation or exit.
   * If payroll also counted it, the same absence would be charged twice — once
   * silently, that month, against the owner's explicit rule that it is not.
   */
  test("EXCLUDES probation-held leave from the unpaid-leave deduction", async () => {
    mockRunFindOne.mockResolvedValue(null);
    const staffA = oid();
    mockStaffFind.mockResolvedValue([
      { _id: staffA, name: "A", category: "teacher", monthlySalary: 30000, paymentMethod: "bank" },
    ]);
    mockAdvFind.mockResolvedValue([]);
    mockRunCreate.mockResolvedValue({ _id: oid(), monthKey: "2026-06", status: "prepared" });
    mockSlipInsert.mockImplementation(async (docs: unknown) => docs);
    // The service's query carries `probationHeld: { $ne: true }`, so a held row never
    // reaches this mock. Assert the FILTER, not just the arithmetic — the arithmetic
    // would look right even if the exclusion were dropped and no held leave existed.
    mockLeaveFind.mockResolvedValue([]);

    await preparePayrollRun({ monthKey: "2026-06", workingDays: 30, actorId: ACTOR });

    expect(mockLeaveFind).toHaveBeenCalledWith(
      expect.objectContaining({ probationHeld: { $ne: true } }),
    );
    const slip = (mockSlipInsert.mock.calls[0][0] as Array<Record<string, unknown>>)[0];
    expect(slip.unpaidLeaveDays).toBe(0);
    expect(slip.netPay).toBe(30000); // nothing docked
  });

  test("computes a payslip per salaried staff with leave + advance applied", async () => {
    const runId = oid();
    const staffA = oid(), staffB = oid();
    mockRunFindOne.mockResolvedValue(null); // no existing run
    mockStaffFind.mockResolvedValue([
      { _id: staffA, name: "A", category: "teacher", monthlySalary: 30000, paymentMethod: "bank" },
      { _id: staffB, name: "B", category: "support", monthlySalary: 20000, paymentMethod: "cash" },
    ]);
    mockLeaveFind.mockResolvedValue([{ staffProfileId: staffA, unpaidDays: 2 }]); // A: 2 unpaid days
    mockAdvFind.mockResolvedValue([
      { _id: oid(), staffProfileId: staffA, recoveryMode: "installments", installmentAmount: 2000, balance: 5000 },
    ]);
    mockRunCreate.mockResolvedValue({ _id: runId, monthKey: "2026-06", status: "prepared" });
    mockSlipInsert.mockImplementation(async (docs) => docs);

    const { payslips } = await preparePayrollRun({ monthKey: "2026-06", workingDays: 30, actorId: ACTOR });

    expect(mockSlipInsert).toHaveBeenCalledTimes(1);
    const a = payslips.find((p: any) => p.staffProfileId.equals(staffA))!;
    const b = payslips.find((p: any) => p.staffProfileId.equals(staffB))!;
    // A: gross 30000 − leave(1000×2=2000) − advance 2000 = 26000
    expect(a.netPay).toBe(26000);
    expect(a.advanceRepaid).toBe(2000);
    expect(a.unpaidLeaveDays).toBe(2);
    // B: gross 20000, nothing applied
    expect(b.netPay).toBe(20000);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "PAYROLL_PREPARED" }));
  });

  test("refuses to re-prepare a LOCKED month (corrections ride arrears, D-#110)", async () => {
    mockRunFindOne.mockResolvedValue({ _id: oid(), status: "approved_locked" });
    await expect(preparePayrollRun({ monthKey: "2026-06", workingDays: 30, actorId: ACTOR })).rejects.toThrow(/locked/i);
    expect(mockRunCreate).not.toHaveBeenCalled();
  });

  test("recomputes a prepared month (deletes prior payslips + run)", async () => {
    mockRunFindOne.mockResolvedValue({ _id: oid(), status: "prepared" });
    mockStaffFind.mockResolvedValue([]);
    mockLeaveFind.mockResolvedValue([]);
    mockAdvFind.mockResolvedValue([]);
    mockRunCreate.mockResolvedValue({ _id: oid(), monthKey: "2026-06", status: "prepared" });
    await preparePayrollRun({ monthKey: "2026-06", workingDays: 30, actorId: ACTOR });
    expect(mockSlipDelete).toHaveBeenCalled();
  });
});

// ===========================================================================
describe("approvePayrollRun (lock + advance recovery commit)", () => {
  test("locks the run and decrements the advance balance; settles at zero", async () => {
    const advId = oid();
    const run: any = { _id: oid(), monthKey: "2026-06", status: "prepared", save: jest.fn() };
    mockRunFindById.mockResolvedValue(run);
    mockSlipFind.mockReturnValue([{ advanceId: advId, advanceRepaid: 2000 }]);
    const advance: any = { _id: advId, balance: 5000, status: "active", save: jest.fn() };
    mockAdvFindById.mockResolvedValue(advance);

    const res = await approvePayrollRun(run._id.toString(), ACTOR);
    expect(res.status).toBe("approved_locked");
    expect(advance.balance).toBe(3000); // 5000 − 2000
    expect(advance.status).toBe("active");
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "PAYROLL_APPROVED" }));
  });

  test("advance fully recovered → settled", async () => {
    const advId = oid();
    const run: any = { _id: oid(), monthKey: "2026-06", status: "prepared", save: jest.fn() };
    mockRunFindById.mockResolvedValue(run);
    mockSlipFind.mockReturnValue([{ advanceId: advId, advanceRepaid: 2000 }]);
    const advance: any = { _id: advId, balance: 2000, status: "active", save: jest.fn() };
    mockAdvFindById.mockResolvedValue(advance);
    await approvePayrollRun(run._id.toString(), ACTOR);
    expect(advance.balance).toBe(0);
    expect(advance.status).toBe("settled");
  });

  test("a locked run cannot be approved again", async () => {
    mockRunFindById.mockResolvedValue({ _id: oid(), status: "approved_locked", save: jest.fn() });
    await expect(approvePayrollRun(oid().toString(), ACTOR)).rejects.toThrow(/only a prepared run/i);
  });
});

describe("cancelPayrollRun", () => {
  test("cancels a prepared run and drops its payslips", async () => {
    const run: any = { _id: oid(), monthKey: "2026-06", status: "prepared", save: jest.fn() };
    mockRunFindById.mockResolvedValue(run);
    const res = await cancelPayrollRun(run._id.toString(), ACTOR);
    expect(res.status).toBe("cancelled");
    expect(mockSlipDelete).toHaveBeenCalled();
  });
});

// ===========================================================================
describe("paymentExport (§4.6)", () => {
  test("locked run → net per non-cash staff, account joined", async () => {
    const sA = oid();
    mockRunFindById.mockReturnValue({ lean: async () => ({ _id: oid(), status: "approved_locked" }) });
    mockSlipFind.mockReturnValue([{ staffProfileId: sA, snapshotName: "A", paymentMethod: "bank", netPay: 26000 }]);
    mockStaffFind.mockResolvedValue([{ _id: sA, bankAccount: "12345" }]);
    const rows = await paymentExport(oid().toString());
    expect(rows).toEqual([{ staffProfileId: sA.toString(), name: "A", paymentMethod: "bank", account: "12345", netPay: 26000 }]);
  });
  test("export refused on a non-locked run", async () => {
    mockRunFindById.mockReturnValue({ lean: async () => ({ _id: oid(), status: "prepared" }) });
    await expect(paymentExport(oid().toString())).rejects.toThrow(/locked run/i);
  });
});

// ===========================================================================
describe("advances (qard hasan, D-#27)", () => {
  test("issueAdvance creates an active loan at full principal, no fee field", async () => {
    mockStaffFindById.mockResolvedValue({ active: true });
    mockAdvCreate.mockImplementation(async (d) => ({ _id: oid(), ...d }));
    const adv = await issueAdvance({
      staffProfileId: oid().toString(), principal: 5000, issueDate: new Date("2026-06-01"),
      recoveryMode: "installments", installmentAmount: 1000, actorId: ACTOR,
    });
    expect(mockAdvCreate.mock.calls[0][0]).toMatchObject({ balance: 5000, status: "active", principal: 5000 });
    expect(adv).toBeDefined();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "ADVANCE_ISSUED" }));
  });
  test("installments require an installmentAmount", async () => {
    mockStaffFindById.mockResolvedValue({ active: true });
    await expect(
      issueAdvance({ staffProfileId: oid().toString(), principal: 5000, issueDate: new Date(), recoveryMode: "installments", actorId: ACTOR }),
    ).rejects.toThrow(PayrollError);
  });
  test("rejects a SECOND active advance for the same staff (§4.5 one-active invariant)", async () => {
    mockStaffFindById.mockResolvedValue({ active: true });
    mockAdvFindOne.mockResolvedValue({ _id: oid() }); // an active advance already exists
    await expect(
      issueAdvance({ staffProfileId: oid().toString(), principal: 5000, issueDate: new Date(), recoveryMode: "one_shot", actorId: ACTOR }),
    ).rejects.toThrow(PayrollError);
    expect(mockAdvCreate).not.toHaveBeenCalled();
  });
  test("settleAdvance zeroes the balance and closes the record", async () => {
    const advance: any = { _id: oid(), balance: 3000, status: "active", save: jest.fn() };
    mockAdvFindById.mockResolvedValue(advance);
    await settleAdvance(advance._id.toString(), false, ACTOR);
    expect(advance.balance).toBe(0);
    expect(advance.status).toBe("settled");
    const advance2: any = { _id: oid(), balance: 3000, status: "active", save: jest.fn() };
    mockAdvFindById.mockResolvedValue(advance2);
    await settleAdvance(advance2._id.toString(), true, ACTOR);
    expect(advance2.status).toBe("written_off");
  });
});
