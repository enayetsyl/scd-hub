/**
 * Salary sheet PDF (D-#914) + "salary sent" notice (D-#915), on a real (in-memory) DB:
 * the sheet groups a run's payslips by how they are paid, with subtotals that are the
 * figures on each bank letter / cash voucher; the notice tells one payment group at a
 * time, only the people that group actually paid, and opens their payslip.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { StaffProfile } from "../modules/foundation/models/StaffProfile";
import { User } from "../modules/foundation/models/User";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { PayrollRun } from "../modules/hr/models/PayrollRun";
import { Notification } from "../modules/notifications/models/Notification";
import { PopupNotice } from "../modules/popup-notices/models/PopupNotice";
import { setHrPolicy } from "../modules/hr/services/HrPolicyService";
import { preparePayrollRun, approvePayrollRun } from "../modules/hr/services/PayrollService";
import { salarySheet, salaryExpense } from "../modules/hr/services/SalarySheetService";
import { renderSalarySheet, sheetColumns } from "../modules/hr/routes/salarySheetPdf";
import {
  announceSalarySent,
  salarySentGroups,
  MY_RECORD_TARGET,
} from "../modules/hr/services/SalarySentService";
import type { AppContext } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let seq = 0;
let principalId: string;
let ctx: AppContext;

const SCHOOL_BANK = "Islami Bank Bangladesh PLC";

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  await AcademicYear.create({ label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), current: true });
  const p = await User.create({ email: `principal${++seq}@t.test`, passwordHash: "x", role: "PRINCIPAL", name: "Principal" });
  principalId = p._id.toString();
  ctx = { auth: { userId: principalId, role: "PRINCIPAL" } } as unknown as AppContext;
  await setHrPolicy({ schoolBankName: SCHOOL_BANK, actorId: principalId });
});

/** A staff member paid one way; `login` gives them an app account. */
async function staff(name: string, salary: number, pay: Record<string, unknown>, login = true): Promise<string> {
  const n = ++seq;
  const s = await StaffProfile.create({
    schoolId: `SS${n}`,
    name,
    category: "teacher",
    designation: "Teacher",
    monthlySalary: salary,
    active: true,
    joiningDate: new Date("2026-01-01"),
    confirmationDate: new Date("2026-03-01"),
    phone: `+88017100${String(n).padStart(5, "0")}`,
    ...pay,
  });
  if (login) await User.create({ phone: s.phone, passwordHash: "x", role: "TEACHER", name });
  return s._id.toString();
}

const ownBank = { paymentMethod: "bank", bankName: SCHOOL_BANK, bankAccount: "2050321740001", bankAccountName: "X" };
const otherBank = {
  paymentMethod: "bank", bankName: "Eastern Bank", bankBranch: "Chowhatta", bankAccount: "0921240273513",
  bankAccountName: "Y", routingNo: "095910855",
};
const cash = { paymentMethod: "cash" };

async function lockedRun(adjustments: Parameters<typeof preparePayrollRun>[0]["adjustments"] = []): Promise<string> {
  const { run } = await preparePayrollRun({ monthKey: "2026-10", workingDays: 20, actorId: principalId, adjustments });
  await approvePayrollRun(run._id.toString(), principalId);
  return run._id.toString();
}

describe("salary sheet (D-#914)", () => {
  it("groups by how the money is paid, with subtotals that add up to the month", async () => {
    const a = await staff("Akmol", 15_000, ownBank);
    await staff("Tazkir", 25_000, otherBank);
    await staff("Fawjan", 6_000, cash);
    const runId = await lockedRun([
      { staffProfileId: a, manualDeductions: [{ type: "other", amount: 3_000, note: "loan" }] },
    ]);

    const sheet = await salarySheet(runId);

    expect(sheet.groups.map((g) => g.channel)).toEqual(["internal", "beftn", "cash"]);
    expect(sheet.groups.map((g) => g.subtotal.netPay)).toEqual([12_000, 25_000, 6_000]);
    expect(sheet.total.grossSalary).toBe(46_000);
    expect(sheet.total.netPay).toBe(43_000);
    // Only the kinds that moved money get a column; a manual "other" is an adjustment.
    expect(sheet.notPaidColumns).toEqual([]);
    expect(sheet.additionColumns).toEqual([]);
    expect(sheet.adjustmentColumns).toEqual(["other"]);
    expect(sheet.groups.flatMap((g) => g.rows).every((r) => r.check === 0)).toBe(true);
  });

  it("splits the deductions around Salary expense, so expense − adjustments = net (D-#929)", async () => {
    const u = await staff("Uesuf", 8_000, cash);
    await staff("Raian", 5_000, cash);
    const runId = await lockedRun([
      {
        staffProfileId: u,
        latenessDeduction: 1_143,
        manualDeductions: [
          { type: "unpaid_leave", amount: 1_524 },
          { type: "other", amount: 5_000, note: "loan" },
        ],
        manualAdditions: [{ type: "bonus", amount: 200 }],
      },
    ]);

    const sheet = await salarySheet(runId);
    const uesuf = sheet.groups[0].rows.find((r) => r.name === "Uesuf")!;

    expect(sheet.notPaidColumns).toEqual(["unpaid_leave", "lateness"]);
    expect(sheet.additionColumns).toEqual(["bonus"]);
    expect(sheet.adjustmentColumns).toEqual(["other"]);
    // 8,000 − 1,524 − 1,143 + 200: what the voucher books. No cash moved for the leave or lateness.
    expect(salaryExpense(uesuf)).toBe(5_533);
    expect(salaryExpense(uesuf) - 5_000).toBe(uesuf.netPay);
    // Linear, so the subtotal row's expense is the sum of its rows'.
    expect(salaryExpense(sheet.groups[0].subtotal)).toBe(5_533 + 5_000);

    const cols = sheetColumns(sheet).map((c) => c.key);
    expect(cols).toEqual([
      "sl", "name", "gross", "d:unpaid_leave", "d:lateness", "a:bonus", "expense", "d:other", "net",
    ]);
  });

  it("is available on a prepared (draft) run and renders a real PDF", async () => {
    await staff("Akmol", 15_000, ownBank);
    await staff("Fawjan", 6_000, cash);
    const { run } = await preparePayrollRun({ monthKey: "2026-10", workingDays: 20, actorId: principalId });

    const sheet = await salarySheet(run._id.toString());
    expect(sheet.status).toBe("prepared");

    const pdf = await renderSalarySheet(sheet);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("keeps a person the bank sheet would block — they still drew a salary", async () => {
    await staff("No account", 9_000, { paymentMethod: "bank", bankName: SCHOOL_BANK });
    const runId = await lockedRun();

    const sheet = await salarySheet(runId);

    expect(sheet.total.netPay).toBe(9_000);
    expect(sheet.groups[0].rows.map((r) => r.name)).toEqual(["No account"]);
  });
});

describe("salary sent notice (D-#915)", () => {
  it("tells ONE payment group: a notification each with their amount, one pop-up opening the payslip", async () => {
    await staff("Akmol", 15_000, ownBank);
    await staff("Momin", 14_000, ownBank);
    await staff("Fawjan", 6_000, cash);
    const runId = await lockedRun();

    const groups = await announceSalarySent(ctx, runId, "internal", ["notification", "popup"]);

    const notes = await Notification.find({ kind: "SALARY_SENT" }).lean();
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.bodyBn).sort()).toEqual([
      "আপনার বেতন ৳১৪,০০০ আপনার ব্যাংক হিসাবে দেওয়া হয়েছে। কর্তন ও পুরো হিসাব দেখতে চাপুন।",
      "আপনার বেতন ৳১৫,০০০ আপনার ব্যাংক হিসাবে দেওয়া হয়েছে। কর্তন ও পুরো হিসাব দেখতে চাপুন।",
    ]);
    expect(notes[0].titleBn).toBe("অক্টোবর ২০২৬-এর বেতন দেওয়া হয়েছে");

    const popups = await PopupNotice.find({}).lean();
    expect(popups).toHaveLength(1);
    expect(popups[0].audience.userIds).toHaveLength(2);
    expect(popups[0].actions[0].target).toBe(MY_RECORD_TARGET);
    // Shown once, on the next app open (D-#916) — not every day.
    expect(popups[0].repeat).toBe("once");

    const internal = groups.find((g) => g.channel === "internal")!;
    expect(internal.sends).toHaveLength(1);
    expect(internal.sends[0]).toMatchObject({ recipientCount: 2, total: 29_000 });
    // The cash group is untouched until the cash is handed over.
    expect(groups.find((g) => g.channel === "cash")!.sends).toHaveLength(0);
  });

  it("a re-send is a new notice, not swallowed by the first one's dedupe key", async () => {
    await staff("Akmol", 15_000, ownBank);
    const runId = await lockedRun();

    await announceSalarySent(ctx, runId, "internal", ["notification"]);
    const groups = await announceSalarySent(ctx, runId, "internal", ["notification"]);

    expect(await Notification.countDocuments({ kind: "SALARY_SENT" })).toBe(2);
    expect(groups[0].sends).toHaveLength(2);
  });

  it("names who has no app login, and skips them", async () => {
    await staff("Akmol", 15_000, cash);
    await staff("Selina", 6_000, cash, false);
    const runId = await lockedRun();

    expect((await salarySentGroups(runId))[0].withoutLogin).toEqual(["Selina"]);
    await announceSalarySent(ctx, runId, "cash", ["notification"]);
    expect(await Notification.countDocuments({ kind: "SALARY_SENT" })).toBe(1);
  });

  it("refuses a prepared run, and a group nobody was paid through", async () => {
    await staff("Akmol", 15_000, ownBank);
    const { run } = await preparePayrollRun({ monthKey: "2026-10", workingDays: 20, actorId: principalId });
    await expect(announceSalarySent(ctx, run._id.toString(), "internal", ["notification"])).rejects.toThrow(/locked/);

    await approvePayrollRun(run._id.toString(), principalId);
    await expect(announceSalarySent(ctx, run._id.toString(), "cash", ["notification"])).rejects.toThrow(/কাউকে বেতন দেওয়া হয়নি/);
    await expect(announceSalarySent(ctx, run._id.toString(), "internal", [])).rejects.toThrow(/বাছাই করুন/);
    expect(await Notification.countDocuments({ kind: "SALARY_SENT" })).toBe(0);
    expect((await PayrollRun.findById(run._id).lean())!.salarySentNotices).toHaveLength(0);
  });
});
