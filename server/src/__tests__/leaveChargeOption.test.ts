/**
 * D-#898 — the optional, per-person "charge leave to salary" switch on a payroll run.
 *
 * Asserts what a person would SEE, not the mechanism (the D-#590 lesson): the payslip
 * figure, the held days the hub and confirmation read, the balance after confirmation,
 * and the refusals. Real queries against an in-memory Mongo, because every one of these
 * outcomes is a join across the run, the ledger and the leave rows.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import { StaffProfile } from "../modules/foundation/models/StaffProfile";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { StaffLeaveApplication } from "../modules/hr/models/StaffLeaveApplication";
import { ProbationLeaveDebt } from "../modules/hr/models/ProbationLeaveDebt";
import { ProbationDebtRecovery } from "../modules/hr/models/ProbationDebtRecovery";
import { LeaveBalanceRecovery } from "../modules/hr/models/LeaveBalanceRecovery";
import { OffboardingCase } from "../modules/hr/models/OffboardingCase";
import { PayrollRun } from "../modules/hr/models/PayrollRun";
import { Payslip } from "../modules/hr/models/Payslip";
import {
  preparePayrollRun,
  approvePayrollRun,
  cancelPayrollRun,
  PROBATION_CHARGE_NOTE,
} from "../modules/hr/services/PayrollService";
import {
  recordProbationDebt,
  heldDebtForStaff,
  pendingExitDebt,
  settleOnExit,
} from "../modules/hr/services/ProbationDebtService";
import { confirmEmployment } from "../modules/hr/services/ConfirmationService";
import { pooledBalanceForStaff } from "../modules/hr/services/LeaveEntitlementService";
import { leaveChargeCandidates, latenessChargeCandidates } from "../modules/hr/services/LeaveChargeService";
import { setHrPolicy } from "../modules/hr/services/HrPolicyService";
import { decideLeave } from "../modules/hr/services/StaffLeaveService";
import { lateDateKeysForMonth } from "../modules/hr/services/LatenessService";
import { TeacherAttendanceDay } from "../modules/attendance/models/TeacherAttendanceDay";
import { LatenessCharge } from "../modules/hr/models/LatenessCharge";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const ACTOR = new Types.ObjectId().toString();
const MONTH = "2026-10";
const WORKING_DAYS = 26;
const SALARY = 26_000;
let seq = 0;

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
  await AcademicYear.create({
    label: "2026",
    startDate: new Date("2026-01-01"),
    endDate: new Date("2026-12-31"),
    current: true,
  });
});

async function staff(name: string, confirmationDate?: string): Promise<string> {
  const s = await StaffProfile.create({
    schoolId: `LC${++seq}`,
    name,
    category: "teacher",
    monthlySalary: SALARY,
    active: true,
    joiningDate: new Date("2026-01-01"),
    confirmationDate: confirmationDate ? new Date(confirmationDate) : null,
    employmentStatus: confirmationDate ? "confirmed" : "probation",
  });
  return s._id.toString();
}

/** An approved probation leave, held exactly as StaffLeaveService records one. */
async function heldLeave(staffProfileId: string, fromKey: string, days: number): Promise<string> {
  const app = await StaffLeaveApplication.create({
    staffProfileId,
    leaveType: "casual",
    fromKey,
    toKey: fromKey,
    days,
    reason: "test",
    status: "approved",
    paidDays: 0,
    unpaidDays: days,
    probationHeld: true,
    appliedBy: ACTOR,
  });
  await recordProbationDebt({ staffProfileId, leaveApplicationId: app._id, fromKey, leaveType: "casual", days });
  return app._id.toString();
}

/** Paid pooled leave for a confirmed member — enough of it overdraws the balance. */
async function paidLeave(staffProfileId: string, fromKey: string, days: number): Promise<void> {
  await StaffLeaveApplication.create({
    staffProfileId,
    leaveType: "casual",
    fromKey,
    toKey: fromKey,
    days,
    reason: "test",
    status: "approved",
    paidDays: days,
    unpaidDays: 0,
    appliedBy: ACTOR,
  });
}

function prepare(adjustments: Array<Record<string, unknown> & { staffProfileId: string }> = []) {
  return preparePayrollRun({ monthKey: MONTH, workingDays: WORKING_DAYS, adjustments, actorId: ACTOR });
}

async function slipFor(staffProfileId: string) {
  const run = await PayrollRun.findOne({ monthKey: MONTH, status: { $ne: "cancelled" } }).lean();
  return Payslip.findOne({ payrollRunId: run!._id, staffProfileId }).lean();
}

describe("probation staff — charging held leave is optional, per person (D-#898)", () => {
  it("nothing is charged unless the run asks: the payslip is the full salary and the days stay held", async () => {
    const s = await staff("Probationer");
    await heldLeave(s, "2026-09-07", 5);

    await prepare();

    const slip = await slipFor(s);
    expect(slip!.netPay).toBe(SALARY);
    expect((await heldDebtForStaff(s)).totalDays).toBe(5);
  });

  it("charging 3 of 5 held days takes 3 × day-rate off the payslip and leaves 2 held", async () => {
    const s = await staff("Probationer");
    await heldLeave(s, "2026-09-07", 5);

    await prepare([{ staffProfileId: s, probationChargeDays: 3 }]);

    const slip = await slipFor(s);
    const line = slip!.deductions.find((d) => d.note === PROBATION_CHARGE_NOTE);
    expect(line).toMatchObject({ type: "unpaid_leave", days: 3, amount: 3 * slip!.dayRate });
    expect(slip!.netPay).toBe(SALARY - 3 * slip!.dayRate);
    // The hub, the confirmation preview and the exit dues all read the remainder.
    expect((await heldDebtForStaff(s)).totalDays).toBe(2);
    expect(await pendingExitDebt(s)).toBe(2);
  });

  it("re-preparing without the charge, or cancelling the run, puts every day back on hold", async () => {
    const s = await staff("Probationer");
    await heldLeave(s, "2026-09-07", 5);

    await prepare([{ staffProfileId: s, probationChargeDays: 3 }]);
    await prepare();
    expect((await heldDebtForStaff(s)).totalDays).toBe(5);
    expect(await ProbationDebtRecovery.countDocuments()).toBe(0);

    const { run } = await prepare([{ staffProfileId: s, probationChargeDays: 3 }]);
    await cancelPayrollRun(run._id.toString(), ACTOR);
    expect((await heldDebtForStaff(s)).totalDays).toBe(5);
  });

  it("refuses more than is held — before anything is written", async () => {
    const s = await staff("Probationer");
    await heldLeave(s, "2026-09-07", 5);

    await expect(prepare([{ staffProfileId: s, probationChargeDays: 6 }])).rejects.toThrow(/৫ দিন/);
    expect(await PayrollRun.countDocuments()).toBe(0);
  });

  it("the screen's list offers the WHOLE held debt, even while a prepared run already charges part of it", async () => {
    const s = await staff("Probationer");
    await heldLeave(s, "2026-09-07", 5);
    await prepare([{ staffProfileId: s, probationChargeDays: 3 }]);

    expect(await leaveChargeCandidates(MONTH)).toEqual([
      { staffProfileId: s, name: "Probationer", kind: "probation", days: 5 },
    ]);
    // Re-preparing at the full figure is therefore allowed.
    await expect(prepare([{ staffProfileId: s, probationChargeDays: 5 }])).resolves.toBeDefined();
  });

  it("confirmation then debits ONLY the days still held from the pool, oldest charged first", async () => {
    const s = await staff("Probationer");
    const older = await heldLeave(s, "2026-08-03", 2);
    const newer = await heldLeave(s, "2026-09-07", 3);
    const { run } = await prepare([{ staffProfileId: s, probationChargeDays: 3 }]);
    await approvePayrollRun(run._id.toString(), ACTOR);

    await confirmEmployment({ staffProfileId: s, confirmationDate: "2026-11-01", issueLetter: false, actorId: ACTOR });

    // 5 held − 3 charged = 2 left for the pool.
    const pool = await pooledBalanceForStaff(s);
    expect(pool.takenDays).toBe(2);
    expect(pool.remainingDays).toBe(pool.allowanceDays - 2);
    // The charge took the whole older leave and 1 day of the newer one.
    const [a, b] = await Promise.all([
      StaffLeaveApplication.findById(older).lean(),
      StaffLeaveApplication.findById(newer).lean(),
    ]);
    expect(a).toMatchObject({ paidDays: 0, unpaidDays: 0, probationHeld: false });
    expect(b).toMatchObject({ paidDays: 2, unpaidDays: 0, probationHeld: false });
    // Nothing is left held, and the charge is spent.
    expect((await heldDebtForStaff(s)).totalDays).toBe(0);
    expect(await ProbationDebtRecovery.countDocuments({ applied: false })).toBe(0);
  });

  it("confirmation is refused while the charge sits in a run that is not yet locked", async () => {
    const s = await staff("Probationer");
    await heldLeave(s, "2026-09-07", 5);
    await prepare([{ staffProfileId: s, probationChargeDays: 3 }]);

    await expect(
      confirmEmployment({ staffProfileId: s, confirmationDate: "2026-11-01", issueLetter: false, actorId: ACTOR }),
    ).rejects.toThrow(/লক/);
    expect((await StaffProfile.findById(s).lean())!.confirmationDate).toBeNull();
  });

  it("an exit charges only what the run did not already take", async () => {
    const s = await staff("Probationer");
    await heldLeave(s, "2026-09-07", 5);
    const { run } = await prepare([{ staffProfileId: s, probationChargeDays: 3 }]);
    await approvePayrollRun(run._id.toString(), ACTOR);

    const settled = await settleOnExit(s, ACTOR);
    expect(settled.toSalary).toBe(2);
    expect(await ProbationLeaveDebt.countDocuments({ settled: false })).toBe(0);
  });

  it("someone with an exit case is not offered, and cannot be charged — the exit dues take it all", async () => {
    const s = await staff("Leaver");
    await heldLeave(s, "2026-09-07", 5);
    await OffboardingCase.create({
      staffProfileId: s,
      trigger: "resignation",
      lastWorkingDayKey: "2026-12-31",
      initiatedBy: ACTOR,
    });

    expect(await leaveChargeCandidates(MONTH)).toEqual([]);
    await expect(prepare([{ staffProfileId: s, probationChargeDays: 1 }])).rejects.toThrow(/প্রস্থান/);
  });
});

describe("permanent staff — the agreed recovery is capped at the deficit (D-#617 → D-#898)", () => {
  async function overdrawn(by: number): Promise<string> {
    const s = await staff("Permanent", "2026-03-01");
    const { allowanceDays } = await pooledBalanceForStaff(s);
    await paidLeave(s, "2026-06-01", allowanceDays + by);
    return s;
  }

  it("lists the deficit, refuses more than it, and charging all of it brings the balance to zero", async () => {
    const s = await overdrawn(4);
    expect(await leaveChargeCandidates(MONTH)).toEqual([
      { staffProfileId: s, name: "Permanent", kind: "overdrawn", days: 4 },
    ]);

    await expect(prepare([{ staffProfileId: s, leaveRecoveryDays: 5 }])).rejects.toThrow(/৪ দিন/);

    await prepare([{ staffProfileId: s, leaveRecoveryDays: 4 }]);
    expect((await pooledBalanceForStaff(s)).remainingDays).toBe(0);
    expect(await LeaveBalanceRecovery.countDocuments()).toBe(1);
    const slip = await slipFor(s);
    expect(slip!.netPay).toBe(SALARY - 4 * slip!.dayRate);
  });

  it("a member with leave to spare is not listed and cannot be charged", async () => {
    const s = await staff("Healthy", "2026-03-01");
    await paidLeave(s, "2026-06-01", 2);

    expect(await leaveChargeCandidates(MONTH)).toEqual([]);
    await expect(prepare([{ staffProfileId: s, leaveRecoveryDays: 1 }])).rejects.toThrow(/০ দিন/);
  });
});

describe("lateness, person by person (D-#908)", () => {
  async function lates(staffProfileId: string, n: number): Promise<void> {
    for (let d = 1; d <= n; d++) {
      await TeacherAttendanceDay.create({
        staffProfileId, dateKey: `${MONTH}-${String(d).padStart(2, "0")}`, status: "LATE", importedBy: ACTOR,
      });
    }
  }

  it("lists late marks → chargeable days (3 lates = 1 day, remainder forgiven); 2 lates is not listed", async () => {
    const a = await staff("Late Nine", "2026-03-01");
    const b = await staff("Late Two", "2026-03-01");
    await lates(a, 9);
    await lates(b, 2);

    const view = await latenessChargeCandidates(MONTH);
    expect(view.ruleOn).toBe(false);
    expect(view.rows.map((r) => [r.name, r.lateCount, r.days])).toEqual([["Late Nine", 9, 3]]);
  });

  it("nothing is charged unless chosen; SALARY puts days × day-rate on the payslip and leaves the balance alone", async () => {
    const s = await staff("Late Nine", "2026-03-01");
    await lates(s, 9);
    const before = (await pooledBalanceForStaff(s)).remainingDays;

    await prepare();
    expect((await slipFor(s))!.netPay).toBe(SALARY);

    await prepare([{ staffProfileId: s, latenessChargeDays: 2, latenessChargeTo: "salary" }]);
    const slip = await slipFor(s);
    const line = slip!.deductions.find((d) => d.type === "lateness");
    expect(line?.amount).toBe(2 * slip!.dayRate);
    expect(slip!.netPay).toBe(SALARY - 2 * slip!.dayRate);
    expect((await pooledBalanceForStaff(s)).remainingDays).toBe(before);
  });

  it("LEAVE BALANCE takes the days off the balance and leaves the payslip whole", async () => {
    const s = await staff("Late Nine", "2026-03-01");
    await lates(s, 9);
    const before = (await pooledBalanceForStaff(s)).remainingDays;

    await prepare([{ staffProfileId: s, latenessChargeDays: 3, latenessChargeTo: "leave" }]);

    expect((await slipFor(s))!.netPay).toBe(SALARY);
    expect((await pooledBalanceForStaff(s)).remainingDays).toBe(before - 3);
  });

  it("re-preparing without the choice, or cancelling, withdraws the charge", async () => {
    const s = await staff("Late Nine", "2026-03-01");
    await lates(s, 9);
    const before = (await pooledBalanceForStaff(s)).remainingDays;

    await prepare([{ staffProfileId: s, latenessChargeDays: 3, latenessChargeTo: "leave" }]);
    await prepare();
    expect((await pooledBalanceForStaff(s)).remainingDays).toBe(before);
    expect(await LatenessCharge.countDocuments()).toBe(0);

    const { run } = await prepare([{ staffProfileId: s, latenessChargeDays: 3, latenessChargeTo: "leave" }]);
    await cancelPayrollRun(run._id.toString(), ACTOR);
    expect((await pooledBalanceForStaff(s)).remainingDays).toBe(before);
  });

  it("refuses more days than the late marks allow, a missing destination, and any choice while the rule is on", async () => {
    const s = await staff("Late Nine", "2026-03-01");
    await lates(s, 9);

    await expect(prepare([{ staffProfileId: s, latenessChargeDays: 4, latenessChargeTo: "salary" }])).rejects.toThrow(/৩ দিন/);
    await expect(prepare([{ staffProfileId: s, latenessChargeDays: 1 }])).rejects.toThrow(/বাছাই/);
    expect(await PayrollRun.countDocuments()).toBe(0);

    await setHrPolicy({ latenessRuleEnabled: true, actorId: ACTOR });
    expect((await latenessChargeCandidates(MONTH)).ruleOn).toBe(true);
    await expect(prepare([{ staffProfileId: s, latenessChargeDays: 1, latenessChargeTo: "salary" }])).rejects.toThrow(/নিয়ম চালু/);
  });
});

describe("an approved late entry is a late, not a third of a day's leave (D-#911)", () => {
  async function lateEntry(staffProfileId: string, dateKey: string): Promise<string> {
    const app = await StaffLeaveApplication.create({
      staffProfileId, leaveType: "sick", fromKey: dateKey, toKey: dateKey, dayPart: "late_entry",
      partialPeriodCount: 1, days: 1 / 3, reason: "late entry", status: "applied", appliedBy: ACTOR,
    });
    await decideLeave(app._id.toString(), "approve", ACTOR);
    return app._id.toString();
  }

  it("approving it takes nothing from the leave balance — confirmed or on probation", async () => {
    const confirmed = await staff("Confirmed", "2026-03-01");
    const probationer = await staff("Probationer");
    const before = (await pooledBalanceForStaff(confirmed)).remainingDays;

    const a = await lateEntry(confirmed, `${MONTH}-20`);
    await lateEntry(probationer, `${MONTH}-20`);

    expect(await StaffLeaveApplication.findById(a).lean()).toMatchObject({ status: "approved", paidDays: 0, unpaidDays: 0, probationHeld: false });
    expect((await pooledBalanceForStaff(confirmed)).remainingDays).toBe(before);
    expect((await heldDebtForStaff(probationer)).totalDays).toBe(0);
  });

  it("its day counts as late — once, even when the attendance sheet also marks it LATE", async () => {
    const s = await staff("Late Entries", "2026-03-01");
    await TeacherAttendanceDay.create({ staffProfileId: s, dateKey: `${MONTH}-28`, status: "LATE", importedBy: ACTOR });
    await TeacherAttendanceDay.create({ staffProfileId: s, dateKey: `${MONTH}-29`, status: "LATE", importedBy: ACTOR });
    await lateEntry(s, `${MONTH}-20`); // no attendance row that day (Maruf's 20 Oct)
    await lateEntry(s, `${MONTH}-28`); // the same morning the sheet marks LATE

    expect(await lateDateKeysForMonth(s, MONTH)).toEqual([`${MONTH}-20`, `${MONTH}-28`, `${MONTH}-29`]);
    expect((await latenessChargeCandidates(MONTH)).rows.map((r) => [r.lateCount, r.days])).toEqual([[3, 1]]);
  });
});
