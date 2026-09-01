/**
 * The payroll register (D-#625) — the accounting view of a run.
 *
 * The register's whole claim is that it does not recompute anything: it buckets the
 * stored payslip lines and foots them. So what is worth testing is exactly that claim —
 * that the buckets add back up to the payslip's own totals, that an unfamiliar line type
 * cannot go missing quietly, and that the file the accountant opens carries the same
 * figures the objects do.
 *
 * The workbook is BUILT AND READ BACK rather than asserted on the builder's inputs. The
 * one defect this file exists to prevent is a sheet whose numbers disagree with the run,
 * and every earlier export fault in this repo (D-#590 stripped leading zeros, D-#601 two
 * documents disagreeing about who was payable) was invisible to a test that stopped at
 * the data.
 *
 * DB-free: models mocked, the repo's convention.
 */
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import type { IPayslip } from "../modules/hr/models/Payslip";

const mockRunFindById = jest.fn();
const mockSlipFind = jest.fn(() => [] as unknown[]);
const mockLoanFindById = jest.fn();

jest.mock("../modules/hr/models/PayrollRun", () => ({
  PayrollRun: { findById: (id: unknown) => ({ lean: async () => mockRunFindById(id) }) },
}));
jest.mock("../modules/hr/models/Payslip", () => ({
  Payslip: { find: () => ({ sort: () => ({ lean: async () => mockSlipFind() }) }) },
}));
jest.mock("../modules/hr/models/AdvanceLoan", () => ({
  AdvanceLoan: { findById: (id: unknown) => ({ lean: async () => mockLoanFindById(id) }) },
}));

import {
  bucketLines,
  payrollRegister,
  registerLines,
  registerRowFrom,
  registerTotals,
} from "../modules/hr/services/PayrollRegisterService";
import { buildRegisterWorkbook } from "../modules/hr/routes/payrollRegisterXlsx";

const oid = () => new mongoose.Types.ObjectId();

const slip = (over: Partial<IPayslip> = {}): IPayslip =>
  ({
    _id: oid(),
    payrollRunId: oid(),
    staffProfileId: oid(),
    monthKey: "2026-08",
    snapshotName: "Someone",
    category: "teacher",
    paymentMethod: "bank",
    grossSalary: 10000,
    dayRate: 455,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    deductions: [],
    additions: [],
    totalDeductions: 0,
    totalAdditions: 0,
    netPay: 10000,
    advanceRepaid: 0,
    advanceId: null,
    ...over,
  }) as unknown as IPayslip;

/** A payslip that is internally consistent, the way `computePayslip` produces them. */
const consistent = (over: Partial<IPayslip>): IPayslip => {
  const base = slip(over);
  const totalDeductions = (base.deductions ?? []).reduce((n, l) => n + l.amount, 0);
  const totalAdditions = (base.additions ?? []).reduce((n, l) => n + l.amount, 0);
  return slip({
    ...over,
    totalDeductions,
    totalAdditions,
    netPay: base.grossSalary + totalAdditions - totalDeductions,
  });
};

beforeEach(() => {
  mockRunFindById.mockReset();
  mockSlipFind.mockReset();
  mockSlipFind.mockReturnValue([]);
  mockLoanFindById.mockReset();
  mockLoanFindById.mockReturnValue(null);
});

describe("a row is the payslip bucketed, never the payslip recomputed", () => {
  test("each line lands in its own column and the columns add back up", () => {
    const r = registerRowFrom(
      consistent({
        snapshotName: "Mahzabin Yasmin",
        grossSalary: 14000,
        unpaidLeaveDays: 2,
        deductions: [
          { type: "unpaid_leave", amount: 1200, days: 2 },
          { type: "advance_repayment", amount: 5000 },
          { type: "lateness", amount: 500 },
        ],
        additions: [{ type: "arrears", amount: 6000, note: "June and July" }],
      } as Partial<IPayslip>),
    );
    expect(r.deductions.unpaid_leave).toBe(1200);
    expect(r.deductions.advance_repayment).toBe(5000);
    expect(r.deductions.lateness).toBe(500);
    expect(r.additions.arrears).toBe(6000);
    expect(r.totalDeductions).toBe(6700);
    expect(r.netPay).toBe(14000 + 6000 - 6700);
    expect(r.check).toBe(0);
  });

  test("two lines of the same type are added, not overwritten", () => {
    const r = registerRowFrom(
      consistent({
        deductions: [
          { type: "other", amount: 300, note: "uniform" },
          { type: "other", amount: 200, note: "book" },
        ],
      } as Partial<IPayslip>),
    );
    expect(r.deductions.other).toBe(500);
    expect(r.check).toBe(0);
  });

  test("a payslip that disagrees with itself shows a NON-ZERO check", () => {
    // Never expected — but a register that silently balances a broken payslip is worse
    // than one that shows the break, because the sheet is what accounts post from.
    const r = registerRowFrom(
      slip({
        grossSalary: 10000,
        deductions: [{ type: "lateness", amount: 1000 }],
        totalDeductions: 1000,
        totalAdditions: 0,
        netPay: 9500, // should be 9000
      } as Partial<IPayslip>),
    );
    expect(r.check).toBe(-500);
  });

  test("an UNRECOGNISED line type surfaces as a non-zero check rather than vanishing", () => {
    // The failure this guards: a deduction type added to the enum later, and a register
    // quietly under-reporting money that was in fact deducted.
    const r = registerRowFrom(
      consistent({
        grossSalary: 10000,
        deductions: [{ type: "provident_fund" as never, amount: 700 }],
      } as Partial<IPayslip>),
    );
    expect(Object.values(r.deductions).reduce((a, b) => a + b, 0)).toBe(0);
    expect(r.totalDeductions).toBe(700);
    expect(r.check).toBe(700);
  });

  test("bucketLines ignores what it does not know and keeps what it does", () => {
    const out = bucketLines(
      [
        { type: "bonus", amount: 100 },
        { type: "mystery" as never, amount: 999 },
      ],
      ["bonus", "arrears"] as const,
      () => ({ bonus: 0, arrears: 0 }),
    );
    expect(out).toEqual({ bonus: 100, arrears: 0 });
  });
});

describe("the totals row", () => {
  test("every column is footed", () => {
    const rows = [
      registerRowFrom(consistent({ grossSalary: 10000, deductions: [{ type: "lateness", amount: 500 }] } as Partial<IPayslip>)),
      registerRowFrom(consistent({ grossSalary: 14000, additions: [{ type: "arrears", amount: 6000 }] } as Partial<IPayslip>)),
    ];
    const t = registerTotals(rows);
    expect(t.grossSalary).toBe(24000);
    expect(t.deductions.lateness).toBe(500);
    expect(t.additions.arrears).toBe(6000);
    expect(t.netPay).toBe(9500 + 20000);
    expect(t.check).toBe(0);
  });

  test("an empty run totals to zeros rather than throwing", () => {
    const t = registerTotals([]);
    expect(t.netPay).toBe(0);
    expect(t.deductions.unpaid_leave).toBe(0);
  });
});

describe("the itemised lines", () => {
  test("every line is listed with its note and day count", () => {
    const lines = registerLines([
      consistent({
        snapshotName: "Jerin",
        additions: [{ type: "arrears", amount: 6000, note: "June and July" }],
        deductions: [{ type: "unpaid_leave", amount: 1200, days: 2 }],
      } as Partial<IPayslip>),
    ]);
    expect(lines).toEqual([
      { name: "Jerin", kind: "addition", type: "arrears", days: null, amount: 6000, note: "June and July" },
      { name: "Jerin", kind: "deduction", type: "unpaid_leave", days: 2, amount: 1200, note: "" },
    ]);
  });
});

describe("which runs have a register", () => {
  test("a cancelled run does not — its payslips were deleted", async () => {
    const id = oid();
    mockRunFindById.mockReturnValue({ _id: id, monthKey: "2026-08", status: "cancelled" });
    await expect(payrollRegister(id.toString())).rejects.toThrow(/cancelled/i);
  });

  test("a PREPARED run does — checking the figures before approving is the point", async () => {
    const id = oid();
    mockRunFindById.mockReturnValue({
      _id: id, monthKey: "2026-08", status: "prepared", workingDays: 22, preparedAt: new Date("2026-09-01"),
    });
    mockSlipFind.mockReturnValue([consistent({ snapshotName: "A", grossSalary: 10000 } as Partial<IPayslip>)]);
    const reg = await payrollRegister(id.toString());
    expect(reg.status).toBe("prepared");
    expect(reg.totals.netPay).toBe(10000);
  });

  test("a missing or malformed id is refused, not thrown as a cast error", async () => {
    await expect(payrollRegister("not-an-id")).rejects.toThrow(/not found/i);
  });
});

describe("the qard sheet reports what is known", () => {
  test("recovery comes from the payslip and the balance is labelled as today's", async () => {
    const id = oid();
    const advId = oid();
    mockRunFindById.mockReturnValue({
      _id: id, monthKey: "2026-08", status: "approved_locked", workingDays: 22,
      preparedAt: new Date("2026-09-01"), approvedAt: new Date("2026-09-01"),
    });
    mockSlipFind.mockReturnValue([
      consistent({
        snapshotName: "Asma", grossSalary: 35000, advanceRepaid: 10000, advanceId: advId,
        deductions: [{ type: "advance_repayment", amount: 10000 }],
      } as Partial<IPayslip>),
    ]);
    mockLoanFindById.mockReturnValue({ _id: advId, balance: 19000, status: "active", recoveryMode: "installments" });
    const reg = await payrollRegister(id.toString());
    expect(reg.advances).toEqual([
      { name: "Asma", recoveredThisRun: 10000, balanceNow: 19000, status: "active", recoveryMode: "installments" },
    ]);
  });

  test("someone with no advance is not on the sheet at all", async () => {
    const id = oid();
    mockRunFindById.mockReturnValue({
      _id: id, monthKey: "2026-08", status: "prepared", workingDays: 22, preparedAt: new Date(),
    });
    mockSlipFind.mockReturnValue([consistent({ snapshotName: "B" } as Partial<IPayslip>)]);
    expect((await payrollRegister(id.toString())).advances).toEqual([]);
  });
});

describe("the workbook the accountant actually opens", () => {
  const register = {
    monthKey: "2026-08",
    status: "approved_locked",
    workingDays: 22,
    preparedAt: new Date("2026-09-01T00:00:00Z"),
    approvedAt: new Date("2026-09-01T00:00:00Z"),
    rows: [
      registerRowFrom(consistent({
        snapshotName: "Mahzabin Yasmin", grossSalary: 14000,
        additions: [{ type: "arrears", amount: 6000, note: "June and July" }],
      } as Partial<IPayslip>)),
      registerRowFrom(consistent({
        snapshotName: "Asma", grossSalary: 35000, advanceRepaid: 10000,
        deductions: [{ type: "advance_repayment", amount: 10000 }],
      } as Partial<IPayslip>)),
    ],
    lines: [] as never[],
    advances: [{ name: "Asma", recoveredThisRun: 10000, balanceNow: 19000, status: "active", recoveryMode: "installments" }],
  };
  const withTotals = { ...register, totals: registerTotals(register.rows) };

  async function read(buf: Buffer): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return wb;
  }

  test("the three sheets accounts asks for are all there", async () => {
    const wb = await read(await buildRegisterWorkbook(withTotals));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Register", "Adjustments", "Qard (advance)"]);
  });

  test("the figures on the sheet are the figures in the run", async () => {
    const wb = await read(await buildRegisterWorkbook(withTotals));
    const ws = wb.getWorksheet("Register")!;
    const cells: string[][] = [];
    ws.eachRow((row) => cells.push((row.values as unknown[]).slice(1).map((v) => String(v ?? ""))));
    const flat = cells.map((r) => r.join("|"));

    expect(flat.some((r) => r.includes("Mahzabin Yasmin") && r.includes("14000") && r.includes("6000"))).toBe(true);
    expect(flat.some((r) => r.includes("Asma") && r.includes("35000") && r.includes("10000"))).toBe(true);
    // Gross 14,000 + 35,000; net 20,000 + 25,000.
    const total = flat.find((r) => r.startsWith("|Total") || r.includes("|Total|"));
    expect(total).toBeDefined();
    expect(total).toContain("49000");
    expect(total).toContain("45000");
  });

  test("a DRAFT run says so on the sheet", async () => {
    // A prepared run's figures can still change; a sheet that does not say so is a sheet
    // somebody posts from.
    const wb = await read(await buildRegisterWorkbook({ ...withTotals, status: "prepared", approvedAt: null }));
    const ws = wb.getWorksheet("Register")!;
    let found = false;
    ws.eachRow((row) => {
      if (String((row.values as unknown[])[1] ?? "").includes("DRAFT")) found = true;
    });
    expect(found).toBe(true);
  });

  test("an approved run does NOT carry the draft warning", async () => {
    const wb = await read(await buildRegisterWorkbook(withTotals));
    const ws = wb.getWorksheet("Register")!;
    let found = false;
    ws.eachRow((row) => {
      if (String((row.values as unknown[])[1] ?? "").includes("DRAFT")) found = true;
    });
    expect(found).toBe(false);
  });

  test("a run with nothing in it still opens as a readable file", async () => {
    const empty = { ...withTotals, rows: [], totals: registerTotals([]), advances: [], lines: [] as never[] };
    const wb = await read(await buildRegisterWorkbook(empty));
    expect(wb.worksheets).toHaveLength(3);
    expect(wb.getWorksheet("Qard (advance)")!.rowCount).toBeGreaterThan(0);
  });
});
