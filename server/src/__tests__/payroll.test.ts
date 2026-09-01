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
// D-#617 — preparing a run upserts (or clears) an agreed leave-balance recovery.
const mockRecoveryUpsert = jest.fn().mockResolvedValue({});
const mockRecoveryDelete = jest.fn().mockResolvedValue({});
jest.mock("../modules/hr/models/LeaveBalanceRecovery", () => ({
  LeaveBalanceRecovery: {
    find: () => ({ select: () => ({ lean: async () => [] }) }),
    findOneAndUpdate: (q: unknown, u: unknown, o: unknown) => mockRecoveryUpsert(q, u, o),
    deleteOne: (q: unknown) => mockRecoveryDelete(q),
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
// D-#587 — payroll now resolves the salary EFFECTIVE in the month being run. Mocked
// empty by default, which is the state of every staff member who has never had a
// change recorded: the run then uses the profile's current figure, and every existing
// assertion in this file must still hold to the taka.
const mockPayChangeFind = jest.fn(() => [] as unknown[]);
jest.mock("../modules/hr/models/StaffPayChange", () => ({
  StaffPayChange: {
    find: () => ({ sort: () => ({ select: () => ({ lean: async () => mockPayChangeFind() }) }) }),
    findOne: () => ({ sort: () => ({ select: () => ({ lean: async () => null }) }) }),
    create: jest.fn().mockResolvedValue({ _id: "x" }),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import { assertMonthKey, dayRate, computePayslip, PayrollError } from "../modules/hr/services/payrollMath";
import { preparePayrollRun, approvePayrollRun, cancelPayrollRun, paymentExport } from "../modules/hr/services/PayrollService";
import ExcelJS from "exceljs";
import { buildPaymentWorkbook } from "../modules/hr/routes/paymentExportCsv";
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

  /**
   * D-#616 changed the second half of the owner's original rule. It was "first leave
   * deduct then salary deduct"; it is now leave only, with the balance free to go
   * negative and salary touched at exit or by agreement. So there is no split left to
   * test — the whole charge lands on the pool whatever the pool holds.
   */
  test("the whole charge goes to the leave pool — never to salary (D-#616)", () => {
    expect(splitLatenessCharge(6, N, 20)).toMatchObject({ chargedDays: 2, paidFromLeave: 2, chargedToSalary: 0 });
    // A pool that cannot cover it no longer spills into pay; the balance goes negative.
    expect(splitLatenessCharge(6, N, 1)).toMatchObject({ chargedDays: 2, paidFromLeave: 2, chargedToSalary: 0 });
    // The probationer's case: no pool at all, and still nothing reaches their salary.
    expect(splitLatenessCharge(3, N, 0)).toMatchObject({ chargedDays: 1, paidFromLeave: 1, chargedToSalary: 0 });
    expect(splitLatenessCharge(3, N, -11)).toMatchObject({ chargedDays: 1, paidFromLeave: 1, chargedToSalary: 0 });
  });

  test("the pool balance no longer changes the outcome — only the late COUNT does", () => {
    // Flooring a fractional pool mattered while the remainder became salary. It cannot
    // now: 3 lates are one charged day against the balance at any pool value.
    for (const pool of [0.67, 1.33, 0, 20, -5]) {
      expect(splitLatenessCharge(3, N, pool)).toMatchObject({ paidFromLeave: 1, chargedToSalary: 0 });
    }
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
  const locked = () =>
    mockRunFindById.mockReturnValue({ lean: async () => ({ _id: oid(), status: "approved_locked" }) });

  test("locked run → net per non-cash staff, full disbursement details joined", async () => {
    const sA = oid();
    locked();
    mockSlipFind.mockReturnValue([{ staffProfileId: sA, snapshotName: "A", paymentMethod: "bank", netPay: 26000 }]);
    mockStaffFind.mockResolvedValue([
      { _id: sA, bankAccount: "12345", bankAccountName: "A", bankName: "IBBL", bankBranch: "Uttara" },
    ]);
    const rows = await paymentExport(oid().toString());
    expect(rows).toEqual([
      {
        staffProfileId: sA.toString(),
        name: "A",
        paymentMethod: "bank",
        account: "12345",
        accountName: "A",
        bankName: "IBBL",
        bankBranch: "Uttara",
        netPay: 26000,
        blockedReason: null,
      },
    ]);
  });

  // D-#579 — these three used to be indistinguishable from payable rows.
  test("no account number → BLOCKED, and still returned so the person is visible", async () => {
    const sA = oid();
    locked();
    mockSlipFind.mockReturnValue([{ staffProfileId: sA, snapshotName: "A", paymentMethod: "bkash", netPay: 9000 }]);
    mockStaffFind.mockResolvedValue([{ _id: sA }]);
    const rows = await paymentExport(oid().toString());
    expect(rows).toHaveLength(1);
    expect(rows[0].blockedReason).toBe("অ্যাকাউন্ট নম্বর নেই");
  });

  test("a ৳0 net is blocked — a bank upload cannot accept it", async () => {
    const sA = oid();
    locked();
    mockSlipFind.mockReturnValue([{ staffProfileId: sA, snapshotName: "A", paymentMethod: "bkash", netPay: 0 }]);
    mockStaffFind.mockResolvedValue([{ _id: sA, bankAccount: "017…" }]);
    const rows = await paymentExport(oid().toString());
    expect(rows[0].blockedReason).toBe("নিট বেতন শূন্য");
  });

  test("a bank transfer needs name + bank + branch; bKash needs only the number", async () => {
    const bankOnly = oid();
    const bkash = oid();
    locked();
    mockSlipFind.mockReturnValue([
      { staffProfileId: bankOnly, snapshotName: "A", paymentMethod: "bank", netPay: 100 },
      { staffProfileId: bkash, snapshotName: "B", paymentMethod: "bkash", netPay: 100 },
    ]);
    mockStaffFind.mockResolvedValue([
      { _id: bankOnly, bankAccount: "12345" }, // number alone — not payable by transfer
      { _id: bkash, bankAccount: "017…" }, // a number IS the whole instruction here
    ]);
    const rows = await paymentExport(oid().toString());
    expect(rows.find((r) => r.name === "A")!.blockedReason).toBe("ব্যাংকের নাম/শাখা/হিসাবধারীর নাম অসম্পূর্ণ");
    expect(rows.find((r) => r.name === "B")!.blockedReason).toBeNull();
  });

  test("export refused on a non-locked run", async () => {
    mockRunFindById.mockReturnValue({ lean: async () => ({ _id: oid(), status: "prepared" }) });
    await expect(paymentExport(oid().toString())).rejects.toThrow(/locked run/i);
  });
});

// ===========================================================================
describe("the payment workbook (D-#579; format D-#590; rebuilt D-#601)", () => {
  const BLOCKED = {
    staffProfileId: "s9",
    name: "Test BEFTN Teacher",
    accountName: "Test BEFTN Teacher",
    account: "Al-Arafah Islami Bank", // the bank's NAME, typed into the account box
    bankName: "Al-Arafah Islami Bank",
    bankBranch: "Zindabazar",
    routingNo: null,
    amount: 12000,
    blockedReason: "রাউটিং নম্বর নেই",
  };

  const ADVICE = {
    monthKey: "2026-08",
    paymentInfo: "SCD Aug '26 Salary",
    letterDate: "2026-09-01",
    policy: {} as never,
    groups: [
      {
        channel: "internal" as const,
        total: 26000,
        blocked: [],
        rows: [
          {
            staffProfileId: "s1",
            name: "মোঃ করিম, জুনিয়র",
            accountName: "Md Karim",
            account: "0011002200330",
            bankName: "Islami Bank Bangladesh PLC",
            bankBranch: "Sylhet",
            routingNo: null,
            amount: 26000,
            blockedReason: null,
          },
        ],
      },
      {
        channel: "beftn" as const,
        total: 12000,
        blocked: [BLOCKED],
        rows: [
          {
            staffProfileId: "s2",
            name: "Test BEFTN Teacher two",
            accountName: "Test BEFTN Teacher Two",
            account: "0231120145584",
            bankName: "Al-Arafah Islami Bank",
            bankBranch: "Sylhet",
            routingNo: "015914152",
            amount: 12000,
            blockedReason: null,
          },
        ],
      },
      // In use for nobody this month: it must not produce a worksheet at all.
      { channel: "bkash" as const, total: 0, blocked: [], rows: [] },
      {
        channel: "cash" as const,
        total: 8000,
        blocked: [],
        rows: [
          {
            staffProfileId: "s3",
            name: "Test Cash Staff",
            accountName: null,
            account: null,
            bankName: null,
            bankBranch: null,
            routingNo: null,
            amount: 8000,
            blockedReason: null,
          },
        ],
      },
    ],
  };

  /** Read the file back the way Excel would, rather than trusting what we wrote. */
  async function reopen() {
    const buf = await buildPaymentWorkbook(ADVICE as never);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return wb;
  }

  test("the ACCOUNT keeps its leading zeros — the whole reason this is not a CSV", async () => {
    const wb = await reopen();
    // The prod bug: 0011002200330 opened as 11002200330.
    expect(wb.getWorksheet("Own bank (internal)")!.getCell("C2").value).toBe("0011002200330");
    expect(wb.getWorksheet("Other banks (BEFTN)")!.getCell("C2").value).toBe("0231120145584");
  });

  test("the account cell is TEXT, so Excel cannot re-convert it on open", async () => {
    const ws = (await reopen()).getWorksheet("Own bank (internal)")!;
    expect(ws.getCell("C2").numFmt).toBe("@");
    expect(typeof ws.getCell("C2").value).toBe("string");
  });

  test("the ROUTING NUMBER is on the BEFTN sheet, as text, with its leading zero", async () => {
    const ws = (await reopen()).getWorksheet("Other banks (BEFTN)")!;
    expect(ws.getRow(1).values).toEqual(expect.arrayContaining(["Routing no"]));
    expect(ws.getCell("F2").value).toBe("015914152");
    expect(ws.getCell("F2").numFmt).toBe("@");
  });

  test("the amount stays a NUMBER — the office sums that column", async () => {
    const ws = (await reopen()).getWorksheet("Own bank (internal)")!;
    expect(ws.getCell("D2").value).toBe(26000);
    expect(typeof ws.getCell("D2").value).toBe("number");
  });

  test("a Bangla name with a comma survives", async () => {
    const ws = (await reopen()).getWorksheet("Own bank (internal)")!;
    expect(ws.getCell("A2").value).toBe("মোঃ করিম, জুনিয়র");
  });

  /**
   * THE REGRESSION THIS REBUILD EXISTS FOR (D-#601). The spreadsheet and the PDF were
   * built from different queries with different ideas of "payable": the older one never
   * read the routing number, so a teacher the PDF refused was row 2 of the file the
   * office would have paid from — with her bank's name in the account field.
   */
  test("a person the pack cannot pay is NOT on a payable sheet", async () => {
    const wb = await reopen();
    const ws = wb.getWorksheet("Other banks (BEFTN)")!;
    const names: unknown[] = [];
    ws.eachRow((row) => names.push(row.getCell("A").value));
    expect(names).not.toContain("Test BEFTN Teacher");
    expect(names).toContain("Test BEFTN Teacher two");
  });

  test("…she is on the 'Cannot pay' sheet instead, with the reason", async () => {
    const ws = (await reopen()).getWorksheet("Cannot pay")!;
    expect(ws.getCell("A2").value).toBe("Test BEFTN Teacher");
    expect(ws.getCell("B2").value).toBe("Other banks (BEFTN)");
    expect(ws.getCell("C2").value).toBe("রাউটিং নম্বর নেই");
  });

  test("one sheet per channel IN USE — and none for a channel nobody is paid by", async () => {
    const wb = await reopen();
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(["Own bank (internal)", "Other banks (BEFTN)", "Cash", "Cannot pay"]);
    expect(names).not.toContain("bKash");
  });

  test("cash people are IN the file, on their own sheet, with no account column", async () => {
    const ws = (await reopen()).getWorksheet("Cash")!;
    expect(ws.getCell("A2").value).toBe("Test Cash Staff");
    expect(ws.getRow(1).values).not.toEqual(expect.arrayContaining(["Account"]));
  });

  test("each sheet carries the total the covering letter quotes", async () => {
    const wb = await reopen();
    expect(wb.getWorksheet("Own bank (internal)")!.getCell("D3").value).toBe(26000);
    expect(wb.getWorksheet("Other banks (BEFTN)")!.getCell("G3").value).toBe(12000);
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

// ===========================================================================
describe("a mid-year raise (D-#587)", () => {
  const alice = oid();

  beforeEach(() => {
    mockRunFindOne.mockResolvedValue(null);
    mockRunCreate.mockImplementation(async (d: Record<string, unknown>) => ({ ...d, _id: oid() }));
    mockLeaveFind.mockReturnValue([]);
    mockAdvFind.mockReturnValue([]);
    mockSlipInsert.mockImplementation(async (docs: unknown[]) => docs);
    // Her CURRENT salary is 6,000 — she was raised from 5,000.
    mockStaffFind.mockResolvedValue([
      { _id: alice, name: "Alice", category: "teacher", monthlySalary: 6000, paymentMethod: "bank" },
    ]);
  });

  async function grossFor(monthKey: string): Promise<number> {
    const { payslips } = await preparePayrollRun({
      monthKey,
      workingDays: 30,
      actorId: ACTOR,
    });
    return (payslips[0] as unknown as { grossSalary: number }).grossSalary;
  }

  /** The rows exactly as stored — the resolver now reads them ALL and picks in JS, so
   *  the mock must carry `effectiveFrom` rather than pretend the query pre-filtered. */
  const HISTORY = {
    joinedThenRaised: [
      { staffProfileId: alice, effectiveFrom: "2025-07", monthlySalary: 5000, previousSalary: null },
      { staffProfileId: alice, effectiveFrom: "2026-07", monthlySalary: 6000, previousSalary: 5000 },
    ],
    // The PROD SHAPE that broke it (D-#590): the initial figure was dated at the month
    // it was TYPED (2026-08), later than the backdated raise it is supposed to precede.
    initialRowDatedLate: [
      { staffProfileId: alice, effectiveFrom: "2026-07", monthlySalary: 6000, previousSalary: 5000 },
      { staffProfileId: alice, effectiveFrom: "2026-08", monthlySalary: 5000, previousSalary: null },
    ],
  };

  test("with NO recorded change, every month pays the profile's figure — today's behaviour", async () => {
    mockPayChangeFind.mockReturnValue([]);
    expect(await grossFor("2026-05")).toBe(6000);
    expect(await grossFor("2026-09")).toBe(6000);
  });

  test("a raise effective in July pays 6,000 from July and 5,000 before it", async () => {
    mockPayChangeFind.mockReturnValue(HISTORY.joinedThenRaised);
    expect(await grossFor("2026-06")).toBe(5000);
    // The latest change already in effect wins. Getting this backwards would pay the
    // raise a month early, every month.
    expect(await grossFor("2026-07")).toBe(6000);
    expect(await grossFor("2026-08")).toBe(6000);
  });

  test("a month BEFORE every recorded change pays what came before it — never the profile", async () => {
    // The profile holds 6,000 by now. Re-running an old month must not pay the raise.
    mockPayChangeFind.mockReturnValue([HISTORY.joinedThenRaised[1]]); // only the raise row
    expect(await grossFor("2026-03")).toBe(5000); // its previousSalary
  });

  test("an initial row with no previousSalary IS the figure that applied before it", async () => {
    mockPayChangeFind.mockReturnValue([HISTORY.joinedThenRaised[0]]); // 2025-07 → 5000, prev null
    expect(await grossFor("2025-01")).toBe(5000);
  });

  /**
   * The prod failure, kept as a test: the wizard dated her initial 5,000 at the month of
   * ENTRY (2026-08), after the July raise to 6,000. Ordering by effectiveFrom then let
   * the initial row outrank the raise and August paid the OLD salary.
   *
   * The primary fix is that the first row is dated from JOINING (covered in
   * payHistory.test.ts). This asserts the consequence a payslip would show if such a
   * pair ever existed again: August genuinely has a 5,000 row in effect, so 5,000 is
   * the honest answer for that data — and July, which only the raise covers, is 6,000.
   */
  test("with the prod row-shape, the resolution is at least self-consistent", async () => {
    mockPayChangeFind.mockReturnValue(HISTORY.initialRowDatedLate);
    expect(await grossFor("2026-07")).toBe(6000);
    expect(await grossFor("2026-08")).toBe(5000);
  });

  test("the day rate follows the effective salary, so leave is docked at the right rate", async () => {
    mockPayChangeFind.mockReturnValue(HISTORY.joinedThenRaised);
    const { payslips } = await preparePayrollRun({ monthKey: "2026-06", workingDays: 30, actorId: ACTOR });
    // 5000 / 30 = 167, not 6000 / 30 = 200.
    expect((payslips[0] as unknown as { dayRate: number }).dayRate).toBe(167);
  });
});
