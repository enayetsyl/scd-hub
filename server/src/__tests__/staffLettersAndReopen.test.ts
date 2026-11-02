/**
 * D-#900–#902 — increment letters, letter preview, sending a letter to the staff app,
 * and reopening a locked payroll run.
 *
 * Asserts what people see, not the mechanism (the D-#590 lesson): the salary payroll
 * will pay, the rows a preview did NOT write, the notice and pop-up that reach the
 * staff login, and the loan / lateness / leaver records after a reopen. Real queries on
 * an in-memory Mongo, because every one of these is a join across several collections.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { StaffProfile } from "../modules/foundation/models/StaffProfile";
import { User } from "../modules/foundation/models/User";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { StaffLetter } from "../modules/hr/models/StaffLetter";
import { StaffPayChange } from "../modules/hr/models/StaffPayChange";
import { AdvanceLoan } from "../modules/hr/models/AdvanceLoan";
import { LatenessCharge } from "../modules/hr/models/LatenessCharge";
import { OffboardingCase } from "../modules/hr/models/OffboardingCase";
import { ProbationLeaveDebt } from "../modules/hr/models/ProbationLeaveDebt";
import { StaffLeaveApplication } from "../modules/hr/models/StaffLeaveApplication";
import { PayrollRun } from "../modules/hr/models/PayrollRun";
import { Payslip } from "../modules/hr/models/Payslip";
import { Notification } from "../modules/notifications/models/Notification";
import { PopupNotice } from "../modules/popup-notices/models/PopupNotice";
import { PopupNoticeRecipient } from "../modules/popup-notices/models/PopupNoticeRecipient";
import { buildLetter, issueLetter } from "../modules/hr/services/StaffLetterService";
import { sendLetter, MY_LETTERS_TARGET } from "../modules/hr/services/StaffLetterSendService";
import { renderLetterToPdf } from "../modules/hr/routes/staffLetterPdf";
import { salariesEffectiveIn } from "../modules/hr/services/PayHistoryService";
import { recordProbationDebt } from "../modules/hr/services/ProbationDebtService";
import {
  preparePayrollRun,
  approvePayrollRun,
  reopenPayrollRun,
} from "../modules/hr/services/PayrollService";
import type { AppContext } from "../context";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let seq = 0;
let principalId: string;
let ctx: AppContext;

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
});

async function staff(over: Record<string, unknown> = {}): Promise<string> {
  const n = ++seq;
  const s = await StaffProfile.create({
    schoolId: `SL${n}`,
    name: `Staff ${n}`,
    category: "teacher",
    designation: "Teacher",
    monthlySalary: 20_000,
    active: true,
    joiningDate: new Date("2026-01-01"),
    confirmationDate: new Date("2026-03-01"),
    phone: `+88017000${String(n).padStart(5, "0")}`,
    ...over,
  });
  return s._id.toString();
}

async function loginFor(staffProfileId: string): Promise<string> {
  const s = await StaffProfile.findById(staffProfileId).lean();
  const u = await User.create({ phone: s!.phone, passwordHash: "x", role: "TEACHER", name: s!.name });
  return u._id.toString();
}

const incrementInput = (staffProfileId: string, over: Record<string, unknown> = {}) => ({
  staffProfileId,
  kind: "increment" as const,
  effectiveFrom: "2026-10-01",
  salaryMode: "paid" as const,
  monthlySalary: 25_000,
  actorId: principalId,
  ...over,
});

describe("increment letter (D-#900)", () => {
  it("issuing it records the raise: payroll pays the new figure from its month, the old one before", async () => {
    const s = await staff();
    const letter = await issueLetter(incrementInput(s));

    expect(letter.kind).toBe("increment");
    expect(letter.snapshot).toMatchObject({ previousSalary: 20_000, monthlySalary: 25_000, incrementMonth: "2026-10" });
    expect((await StaffProfile.findById(s).lean())!.monthlySalary).toBe(25_000);
    expect((await salariesEffectiveIn("2026-10")).get(s)).toBe(25_000);
    expect((await salariesEffectiveIn("2026-09")).get(s)).toBe(20_000);
  });

  it("a raise Set pay already recorded is reused — never recorded twice", async () => {
    const s = await staff({ monthlySalary: 25_000 });
    await StaffPayChange.create({
      staffProfileId: s, effectiveFrom: "2026-10", monthlySalary: 25_000, previousSalary: 20_000, actorId: principalId,
    });

    const letter = await issueLetter(incrementInput(s));

    expect(letter.snapshot.previousSalary).toBe(20_000);
    expect(await StaffPayChange.countDocuments({ staffProfileId: s })).toBe(1);
  });

  it("refuses a figure that is not a raise", async () => {
    const s = await staff();
    await expect(issueLetter(incrementInput(s, { monthlySalary: 18_000 }))).rejects.toThrow(/বেশি হতে হবে/);
    expect(await StaffLetter.countDocuments()).toBe(0);
  });
});

describe("preview (D-#902)", () => {
  it("builds the letter and renders a PDF without writing a letter, a pay change or the profile", async () => {
    const s = await staff();

    const built = await buildLetter(incrementInput(s, { extraText: "Custom body." }));
    const pdf = await renderLetterToPdf(
      { kind: "increment", refNo: "—", status: "issued", snapshot: built.snapshot, extraText: built.extraText, voidReason: null },
      { preview: true },
    );

    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(await StaffLetter.countDocuments()).toBe(0);
    expect(await StaffPayChange.countDocuments()).toBe(0);
    expect((await StaffProfile.findById(s).lean())!.monthlySalary).toBe(20_000);
  });
});

describe("sending a letter to the staff app (D-#901)", () => {
  it("notification + pop-up both reach that one login, and the send is recorded", async () => {
    const s = await staff();
    const userId = await loginFor(s);
    const letter = await issueLetter(incrementInput(s));

    const sent = await sendLetter(ctx, letter._id.toString(), ["notification", "popup"]);

    expect(sent.sends).toHaveLength(1);
    expect(sent.sends![0].channels.sort()).toEqual(["notification", "popup"]);
    const notes = await Notification.find({ kind: "STAFF_LETTER_SENT" }).lean();
    expect(notes.map((n) => n.recipientUserId?.toString())).toEqual([userId]);
    const popup = await PopupNotice.findById(sent.sends![0].popupNoticeId).lean();
    expect(popup!.status).toBe("PUBLISHED");
    expect(popup!.actions[0]).toMatchObject({ kind: "OPEN_SCREEN", target: MY_LETTERS_TARGET });
    const recipients = await PopupNoticeRecipient.find({ noticeId: popup!._id, test: false }).lean();
    expect(recipients.map((r) => r.recipientId.toString())).toEqual([userId]);
  });

  it("sending again is a NEW notice, not swallowed by the first one's key", async () => {
    const s = await staff();
    await loginFor(s);
    const letter = await issueLetter(incrementInput(s));

    await sendLetter(ctx, letter._id.toString(), ["notification"]);
    await sendLetter(ctx, letter._id.toString(), ["notification"]);

    expect(await Notification.countDocuments({ kind: "STAFF_LETTER_SENT" })).toBe(2);
  });

  it("refuses a staff member with no app login, and a void letter", async () => {
    const s = await staff();
    const letter = await issueLetter(incrementInput(s));
    await expect(sendLetter(ctx, letter._id.toString(), ["notification"])).rejects.toThrow(/লগইন নেই/);

    await loginFor(s);
    await StaffLetter.updateOne({ _id: letter._id }, { $set: { status: "void" } });
    await expect(sendLetter(ctx, letter._id.toString(), ["notification"])).rejects.toThrow(/বাতিল/);
    expect(await Notification.countDocuments()).toBe(0);
  });
});

describe("reopening a locked payroll run (D-#903)", () => {
  const MONTH = "2026-10";
  const prepare = () => preparePayrollRun({ monthKey: MONTH, workingDays: 26, actorId: principalId });

  it("undoes the lock: advance balance back, lateness unfrozen, staff no longer see it — and it can lock again", async () => {
    const s = await staff();
    const loan = await AdvanceLoan.create({
      staffProfileId: s, principal: 3000, issueDate: new Date("2026-09-01"), recoveryMode: "installments",
      installmentAmount: 3000, balance: 3000, approvedBy: principalId,
    });
    await LatenessCharge.create({ staffProfileId: s, monthKey: MONTH, lateDaysPerCharge: 3 });
    const { run } = await prepare();
    await approvePayrollRun(run._id.toString(), principalId);
    expect((await AdvanceLoan.findById(loan._id).lean())).toMatchObject({ balance: 0, status: "settled" });

    const reopened = await reopenPayrollRun(run._id.toString(), "wrong working days", principalId);

    expect(reopened.status).toBe("prepared");
    expect(reopened.reopenings).toHaveLength(1);
    expect(await AdvanceLoan.findById(loan._id).lean()).toMatchObject({ balance: 3000, status: "active" });
    expect((await LatenessCharge.findOne({ staffProfileId: s }).lean())!.frozen).toBe(false);

    await approvePayrollRun(run._id.toString(), principalId);
    expect((await AdvanceLoan.findById(loan._id).lean())).toMatchObject({ balance: 0, status: "settled" });
  });

  it("a leaver's settlement and held probation debt are taken back, and locking again re-settles them", async () => {
    const s = await staff({ confirmationDate: null });
    const app = await StaffLeaveApplication.create({
      staffProfileId: s, leaveType: "casual", fromKey: "2026-09-07", toKey: "2026-09-07", days: 2,
      reason: "t", status: "approved", paidDays: 0, unpaidDays: 2, probationHeld: true, appliedBy: principalId,
    });
    await recordProbationDebt({ staffProfileId: s, leaveApplicationId: app._id, fromKey: "2026-09-07", leaveType: "casual", days: 2 });
    const exitCase = await OffboardingCase.create({
      staffProfileId: s, trigger: "resignation", lastWorkingDayKey: "2026-10-15", initiatedBy: principalId,
    });
    const { run } = await prepare();
    await approvePayrollRun(run._id.toString(), principalId);
    expect((await OffboardingCase.findById(exitCase._id).lean())!.settlement?.paidInMonthKey).toBe(MONTH);
    expect(await ProbationLeaveDebt.countDocuments({ settled: true })).toBe(1);

    await reopenPayrollRun(run._id.toString(), "leaver's last day was wrong", principalId);

    expect((await OffboardingCase.findById(exitCase._id).lean())!.settlement ?? null).toBeNull();
    expect(await ProbationLeaveDebt.countDocuments({ settled: false })).toBe(1);

    await approvePayrollRun(run._id.toString(), principalId);
    expect((await OffboardingCase.findById(exitCase._id).lean())!.settlement?.paidInMonthKey).toBe(MONTH);
    expect(await ProbationLeaveDebt.countDocuments({ settled: true })).toBe(1);
  });

  it("is refused while a later month is locked, and when a recovered advance has changed since", async () => {
    const s = await staff();
    const loan = await AdvanceLoan.create({
      staffProfileId: s, principal: 6000, issueDate: new Date("2026-09-01"), recoveryMode: "installments",
      installmentAmount: 3000, balance: 6000, approvedBy: principalId,
    });
    const { run } = await prepare();
    await approvePayrollRun(run._id.toString(), principalId);

    const next = await preparePayrollRun({ monthKey: "2026-11", workingDays: 26, actorId: principalId });
    await approvePayrollRun(next.run._id.toString(), principalId);
    await expect(reopenPayrollRun(run._id.toString(), "x", principalId)).rejects.toThrow(/2026-11/);

    // The November run is fine to reopen; then October's loan has changed since October locked.
    await reopenPayrollRun(next.run._id.toString(), "x", principalId);
    await AdvanceLoan.updateOne({ _id: loan._id }, { $set: { balance: 0, status: "written_off" } });
    await expect(reopenPayrollRun(run._id.toString(), "x", principalId)).rejects.toThrow(/অগ্রিম/);
    expect((await PayrollRun.findById(run._id).lean())!.status).toBe("approved_locked");
    expect(await Payslip.countDocuments({ payrollRunId: run._id })).toBeGreaterThan(0);
  });
});
