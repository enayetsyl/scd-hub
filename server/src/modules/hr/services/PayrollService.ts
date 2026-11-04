/**
 * PayrollService (HR-3; prd-hr §4.2/§4.6) — the monthly run.
 *
 *   preparePayrollRun  — Office computes payslips for every active salaried staff
 *                        (incl. support, D-#25): gross (pro-rated on the day-rate for a
 *                        mid-month joiner/leaver from the joining date / exit case — a
 *                        leaver's last payslip also carries the exit dues, D-#711 — or
 *                        an explicit per-staff payableDays), the unpaid-leave deduction
 *                        from the STORED leave split (D-#110 — NOT the read-time
 *                        attendance overlay), advance recovery with the net-pay guard,
 *                        and any manual arrears/bonus/clawback lines. Re-preparing a
 *                        `prepared` month recomputes it; a locked month is refused.
 *   approvePayrollRun  — Principal approves → run LOCKS (immutable) + advance balances
 *                        are decremented by the recovered amounts. Payslips + the
 *                        payment export issue only from a locked run.
 *   paymentExport      — net pay per staff for bank/bKash bulk upload; cash EXCLUDED.
 *
 * A locked run is NEVER retro-edited; a post-lock correction rides an `arrears` line on
 * the NEXT run (D-#110). Identity/operational plane; NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { StaffLeaveApplication } from "../models/StaffLeaveApplication";
import { PayrollRun, type IPayrollRun } from "../models/PayrollRun";
import { Payslip, type IPayslip } from "../models/Payslip";
import { AdvanceLoan } from "../models/AdvanceLoan";
import { LeaveBalanceRecovery } from "../models/LeaveBalanceRecovery";
import { ProbationDebtRecovery } from "../models/ProbationDebtRecovery";
import { ProbationLeaveDebt } from "../models/ProbationLeaveDebt";
import { LatenessCharge } from "../models/LatenessCharge";
import { OffboardingCase } from "../models/OffboardingCase";
import { overdrawnDays, staffWithOpenExit, chargeableLateDays } from "./LeaveChargeService";
import { getHrPolicy } from "./HrPolicyService";
import { roundLeaveDays } from "./dates";
import { bnNum } from "../../../lib/bnNum";
import { salariesEffectiveIn } from "./PayHistoryService";
import { writeAudit } from "../../platform/services/AuditService";
import {
  assertMonthKey,
  dayRate,
  computePayslip,
  payableDaysInMonth,
  PayrollError,
  type PayLineInput,
} from "./payrollMath";
import { activeAdvanceByStaff } from "./AdvanceService";
import { computeLatenessCharge, freezeLatenessCharges } from "./LatenessService";
import { exitsUpTo, exitDues, commitExitPayslips, OVERDRAWN_LEAVE_NOTE } from "./ExitPayService";
import { toDateKey, openHeldDays } from "./ProbationDebtService";
import { recordPlaceMistake } from "../../staff-mistakes/services/StaffMistakeNoteService";

export interface StaffAdjustment {
  staffProfileId: string;
  /** Pro-ration: pay only this many days at the day-rate (mid-month joiner/leaver/
   *  part-timer). Omit = full monthlySalary as gross (§4.2; exact fractions parked §10). */
  payableDays?: number;
  latenessDeduction?: number;
  manualDeductions?: PayLineInput[];
  manualAdditions?: PayLineInput[];
  /**
   * Whether this run recovers the staff member's outstanding advance (D-#622).
   *
   * Left undefined it follows the advance's own arrangement — see `recoverAdvance`.
   * `true` recovers a one-off this month; `false` skips a recovery that would
   * otherwise happen.
   */
  recoverAdvance?: boolean;
  /**
   * Days of a NEGATIVE leave balance the staff member has agreed to settle out of this
   * month's pay (D-#617). Optional and off by default: an overdrawn balance is never
   * recovered from salary automatically, only at exit or by agreement. Partial is the
   * normal case — the office asks, the teacher agrees to some or all of it.
   */
  leaveRecoveryDays?: number;
  /** The office's note on that agreement — it was made verbally, so this is the record. */
  leaveRecoveryNote?: string;
  /**
   * Days of HELD probation leave to charge to this month's pay (D-#898). Optional and
   * off by default, like the recovery above: probation leave otherwise waits for
   * confirmation or exit (D-#540). Up to the whole held debt; partial is allowed.
   */
  probationChargeDays?: number;
  probationChargeNote?: string;
  /**
   * Days of LATENESS to charge this person this month, by choice (D-#908) — only while
   * the school-wide rule is off (it would charge everyone itself). Up to
   * floor(late marks / lateDaysPerCharge); `latenessChargeTo` says where it lands:
   * "salary" (a বিলম্ব কর্তন line) or "leave" (off the leave balance, D-#616).
   */
  latenessChargeDays?: number;
  latenessChargeTo?: "salary" | "leave";
}

/**
 * LATENESS CHARGED BY CHOICE, PER PERSON (D-#908) — the rule-off counterpart of
 * `computeLatenessCharge`. The owner: *"one to one lateness deduction"*.
 *
 * Writes the same `LatenessCharge` row the school-wide rule writes, so everything that
 * already reads it keeps working: the hub's lateness line, the leave balance (which
 * counts `paidFromLeave`, D-#616), the freeze at lock and the reopen. `to` decides which
 * half carries the days — "salary" makes a বিলম্ব কর্তন line of days × day-rate; "leave"
 * takes them off the balance and leaves the payslip alone.
 *
 * Called only while the rule is OFF (the caller passes the rule's row first). A person
 * with no choice this run has an earlier CHOICE row for the month removed (`byChoice`) —
 * a choice not repeated is withdrawn; rows the rule or an import wrote are not touched.
 * `adj` is 0 for a leaver: their exit settlement collects what is owed.
 */
async function chargeLatenessByChoice(
  sid: string,
  input: PreparePayrollInput,
  runId: Types.ObjectId,
  rate: number,
  adj: StaffAdjustment | 0 | undefined,
): Promise<{ amount: number } | null> {
  const key = { staffProfileId: new Types.ObjectId(sid), monthKey: input.monthKey };
  const days = adj ? Math.max(0, adj.latenessChargeDays ?? 0) : 0;
  if (days === 0) {
    await LatenessCharge.deleteOne({ ...key, frozen: false, byChoice: true });
    return null;
  }
  const toSalary = adj && adj.latenessChargeTo === "salary";
  const policy = await getHrPolicy();
  const { lateDateKeys } = await chargeableLateDays(sid, input.monthKey, policy.lateDaysPerCharge);
  const amount = toSalary ? Math.round(rate * days) : 0;
  const row = await LatenessCharge.findOneAndUpdate(
    key,
    {
      $set: {
        lateDateKeys,
        lateDaysPerCharge: policy.lateDaysPerCharge,
        chargedDays: days,
        paidFromLeave: toSalary ? 0 : days,
        chargedToSalary: toSalary ? days : 0,
        dayRate: rate,
        amount,
        payrollRunId: runId,
        frozen: false,
        byChoice: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await writeAudit({
    eventKind: "STAFF_LATENESS_CHARGED",
    actorId: input.actorId,
    targetId: row._id,
    targetKind: "LatenessCharge",
    meta: {
      staffProfileId: sid,
      monthKey: input.monthKey,
      lateCount: lateDateKeys.length,
      chargedDays: days,
      to: toSalary ? "salary" : "leave",
      amount,
      byChoice: true,
    },
  });
  return { amount };
}

/** The payslip note when held probation leave is charged by choice (D-#898). */
export const PROBATION_CHARGE_NOTE = "প্রবেশনকালীন ছুটির বেতন কর্তন";

/** A day count may carry a partial day (1/3, D-#361); compare with a little slack. */
const DAY_EPSILON = 0.01;

/**
 * Refuse a charge above what the person actually owes — BEFORE the first write (D-#574).
 *
 * Both kinds were taken on trust until D-#898: the screen typed a number and the server
 * charged it, so "3" against a balance of −1 took two days nobody owed, and pushed the
 * balance positive with days that were never taken. `existingRunId` is the run being
 * re-prepared, whose own charges are about to be replaced and must not count against
 * the figure.
 */
async function assertChargesWithinOwed(
  adjustments: StaffAdjustment[],
  existingRunId: Types.ObjectId | null,
  monthKey: string,
): Promise<void> {
  const charges = adjustments.filter(
    (a) => (a.probationChargeDays ?? 0) !== 0 || (a.leaveRecoveryDays ?? 0) !== 0 || (a.latenessChargeDays ?? 0) !== 0,
  );
  if (charges.length === 0) return;
  const exiting = await staffWithOpenExit();
  const policy = await getHrPolicy();
  for (const a of charges) {
    const probation = a.probationChargeDays ?? 0;
    const overdrawn = a.leaveRecoveryDays ?? 0;
    const late = a.latenessChargeDays ?? 0;
    if (probation < 0 || overdrawn < 0 || late < 0) throw new PayrollError("কর্তনের দিন ঋণাত্মক হতে পারে না");
    const staff = await StaffProfile.findById(a.staffProfileId).select("name").lean();
    const who = staff?.name ?? a.staffProfileId;
    if (exiting.has(a.staffProfileId)) {
      throw new PayrollError(`${who}: প্রস্থান প্রক্রিয়া চলছে — ছুটির পাওনা চূড়ান্ত নিষ্পত্তিতে পুরোটাই কাটা হবে`);
    }
    if (late > 0) {
      // The school-wide rule already charges everyone; a per-person charge on top would
      // count the same late days twice (D-#908).
      if (policy.latenessRuleEnabled) {
        throw new PayrollError("বিলম্বের নিয়ম চালু আছে — নিয়ম অনুযায়ী সবার হিসাব হবে, আলাদা করে কাটা যাবে না");
      }
      if (a.latenessChargeTo !== "salary" && a.latenessChargeTo !== "leave") {
        throw new PayrollError(`${who}: বিলম্বের কর্তন বেতন না ছুটির জমা থেকে — তা বাছাই করুন`);
      }
      const { days } = await chargeableLateDays(a.staffProfileId, monthKey, policy.lateDaysPerCharge);
      if (late > days + DAY_EPSILON) {
        throw new PayrollError(`${who}: এই মাসে বিলম্বে কাটার মতো ${bnNum(days)} দিন — এর বেশি কাটা যায় না`);
      }
    }
    if (probation > 0) {
      const held = await openHeldDays(a.staffProfileId, existingRunId);
      if (probation > held + DAY_EPSILON) {
        throw new PayrollError(`${who}: প্রবেশনকালীন জমা ছুটি ${bnNum(roundLeaveDays(held))} দিন — এর বেশি কাটা যায় না`);
      }
    }
    if (overdrawn > 0) {
      const over = await overdrawnDays(a.staffProfileId, existingRunId);
      if (overdrawn > over + DAY_EPSILON) {
        throw new PayrollError(`${who}: ছুটির জমা ঋণাত্মক ${bnNum(roundLeaveDays(over))} দিন — এর বেশি কাটা যায় না`);
      }
    }
  }
}

/**
 * Does THIS run recover THIS person's advance? (D-#622)
 *
 * An INSTALLMENT arrangement is a standing agreement — a fixed amount every month —
 * so it keeps running unless the operator explicitly turns it off for a month.
 *
 * A ONE-SHOT is the opposite: it takes the entire outstanding balance the first time
 * any run touches the person, which for a large qard is most of a month's pay. The
 * owner's rule is that it must be CHOSEN each time — *"at the time of payroll run there
 * should be option to adjust or not; if adjust is clicked then will be adjusted
 * otherwise not"*. So a one-shot recovers only when asked, never by default.
 *
 * The immediate case: a ৳10,000 one-shot against a ৳35,000 salary that the owner did
 * not want taken in August. Before this the only way to stop it was to edit the loan.
 */
export function recoverAdvance(
  advance: { recoveryMode: string } | null | undefined,
  adj: { recoverAdvance?: boolean } | undefined,
): boolean {
  if (!advance) return false;
  if (adj?.recoverAdvance !== undefined) return adj.recoverAdvance;
  return advance.recoveryMode !== "one_shot";
}

export interface PreparePayrollInput {
  monthKey: string;
  workingDays: number;
  adjustments?: StaffAdjustment[];
  note?: string;
  actorId: string;
}

/** Stored unpaid-leave days per staff for a month — summed from APPROVED leaves whose
 *  fromKey falls in the month (D-#110: the leave application's STORED split is the
 *  payroll truth; a cross-month leave's unpaid days attribute to its start month).
 *
 *  EXCLUDES probation-held leave (SH-3, D-#540): those days are unpaid but deliberately
 *  NOT payable now — they sit on the ProbationLeaveDebt ledger and are collected once,
 *  at confirmation (against the new pool) or at exit (against the final settlement).
 *  Counting them here would dock the same absence twice. */
async function unpaidLeaveDaysByStaff(monthKey: string): Promise<Map<string, number>> {
  const rows = await StaffLeaveApplication.find({
    status: "approved",
    probationHeld: { $ne: true },
    fromKey: { $gte: `${monthKey}-01`, $lte: `${monthKey}-31` },
  })
    .select("staffProfileId unpaidDays")
    .lean();
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!r.unpaidDays) continue;
    const key = r.staffProfileId.toString();
    map.set(key, (map.get(key) ?? 0) + r.unpaidDays);
  }
  return map;
}

export async function preparePayrollRun(input: PreparePayrollInput): Promise<{ run: IPayrollRun; payslips: IPayslip[] }> {
  assertMonthKey(input.monthKey);
  if (input.workingDays < 1) throw new PayrollError("workingDays must be ≥ 1");

  // One non-cancelled run per month: recompute a prepared one, refuse a locked one.
  const existing = await PayrollRun.findOne({ monthKey: input.monthKey, status: { $ne: "cancelled" } });
  if (existing?.status === "approved_locked") {
    throw new PayrollError(`${input.monthKey} is locked — corrections ride arrears on a later run (D-#110)`);
  }
  await assertChargesWithinOwed(input.adjustments ?? [], existing?._id ?? null, input.monthKey);
  if (existing) {
    await Payslip.deleteMany({ payrollRunId: existing._id });
    // The old run's leave-balance credits go with it. They are keyed to ITS id, so the
    // new run's per-staff cleanup below never reaches them — left behind, a re-prepare
    // would credit the same agreed (or exit) recovery to the balance twice.
    await LeaveBalanceRecovery.deleteMany({ payrollRunId: existing._id });
    // Same for its probation charges (D-#898): left behind, they would keep the days
    // off the held debt with no payslip collecting them.
    await ProbationDebtRecovery.deleteMany({ payrollRunId: existing._id });
    await PayrollRun.deleteOne({ _id: existing._id });
  }

  // Exits up to this month's end (D-#711). Read FIRST: a leaver whose last working day
  // is in this month is paid even if someone has since switched their profile off.
  const exits = await exitsUpTo(input.monthKey);
  const leaverIds = [...exits.keys()].map((id) => new Types.ObjectId(id));

  const [staff, leaveDays, advances, effectiveSalaries] = await Promise.all([
    StaffProfile.find({
      monthlySalary: { $gt: 0 },
      $or: [{ active: true }, { _id: { $in: leaverIds } }],
    })
      .select("name category monthlySalary paymentMethod joiningDate")
      .lean(),
    unpaidLeaveDaysByStaff(input.monthKey),
    activeAdvanceByStaff(),
    // The salary EFFECTIVE IN THIS MONTH (D-#587). Empty for anyone with no recorded
    // change, and then the profile's current figure is used — which is exactly what
    // this did before history existed, so landing it moves no existing run.
    salariesEffectiveIn(input.monthKey),
  ]);

  const adjByStaff = new Map((input.adjustments ?? []).map((a) => [a.staffProfileId, a]));

  const run = await PayrollRun.create({
    monthKey: input.monthKey,
    status: "prepared",
    workingDays: input.workingDays,
    preparedBy: new Types.ObjectId(input.actorId),
    preparedAt: new Date(),
    note: input.note,
  });

  const payslipDocs: Array<Partial<IPayslip>> = [];
  for (const s of staff) {
    const sid = s._id.toString();
    // A raise agreed in July but entered in September is a JULY raise, and re-running
    // August must still pay the old figure. The recorded change decides; the profile's
    // current salary is the fallback for everyone who has never had one recorded.
    const salary = effectiveSalaries.get(sid) ?? s.monthlySalary!;
    const rate = dayRate(salary, input.workingDays);
    const adj = adjByStaff.get(sid);

    /**
     * A MID-MONTH JOINER OR LEAVER IS PAID FOR THE DAYS THEY SERVED (D-#711).
     *
     * Before this the run paid every active salaried profile the whole month unless the
     * Office typed payable days by hand — so a teacher whose exit case said she left on
     * the 13th drew the full salary, and a support staff member who joined on the 13th
     * would have too. The joining date and the exit case's last working day are both on
     * record; the run now reads them. An explicit `payableDays` adjustment still wins.
     */
    const exit = exits.get(sid);
    // Already paid by a settlement released on its own (before this rule existed).
    if (exit?.settledOutsideRun) continue;
    const servedDays = payableDaysInMonth({
      monthKey: input.monthKey,
      workingDays: input.workingDays,
      joinedKey: s.joiningDate ? toDateKey(s.joiningDate) : null,
      lastDayKey: exit?.lastWorkingDayKey ?? null,
    });
    // Not in service at all this month — left before it began, or joins after it ends.
    if (servedDays === 0 && adj?.payableDays == null) continue;
    const payableDays = adj?.payableDays ?? servedDays;
    const gross = payableDays != null ? Math.round(rate * payableDays) : salary;
    // This month is the leaver's LAST payslip only when the last working day falls in it
    // (`exitsUpTo` also returns earlier exits, which are normally skipped just above).
    const exitThisMonth = exit && exit.lastWorkingDayKey >= `${input.monthKey}-01` ? exit : undefined;
    const dues = exitThisMonth ? await exitDues(sid, rate) : null;
    const advance = advances.get(sid);
    // SH-4 / D-#541: the 3-lates-to-a-day charge. Returns null while the rule is off,
    // in which case nothing is passed and the payslip is byte-identical to today. An
    // explicit per-staff `latenessDeduction` adjustment still wins — it is the manual
    // override the Office has always had.
    const latenessRow = await computeLatenessCharge({
      staffProfileId: sid,
      monthKey: input.monthKey,
      dayRate: rate,
      actorId: input.actorId,
      payrollRunId: run._id,
    });
    const manualLate = latenessRow ? null : await chargeLatenessByChoice(sid, input, run._id, rate, dues ? 0 : adj);
    const latenessDeduction = adj?.latenessDeduction ?? (latenessRow?.amount || manualLate?.amount || undefined);

    /**
     * An AGREED recovery of a negative leave balance (D-#617). It becomes an ordinary
     * payslip deduction AND a `LeaveBalanceRecovery` row, which `takenPooledDays`
     * subtracts so the balance actually moves back up. Both halves or neither: money off
     * the payslip with the balance still negative would let the same days be collected
     * again at exit.
     *
     * Upserted per (staff, run) so re-preparing the run replaces rather than stacks.
     *
     * A LEAVER's last payslip recovers the WHOLE overdrawn balance instead (D-#616 —
     * collected at exit). It rides the same row, so the balance reads zero afterwards
     * and nothing downstream can collect those days a second time.
     */
    const recoveryDays = dues ? dues.overdrawnDays : Math.max(0, adj?.leaveRecoveryDays ?? 0);
    const recoveryNote = dues ? OVERDRAWN_LEAVE_NOTE : adj?.leaveRecoveryNote?.trim();
    const recoveryDeductions: PayLineInput[] = [...(adj?.manualDeductions ?? [])];
    if (dues?.probation) recoveryDeductions.push(dues.probation);
    if (recoveryDays > 0) {
      const amount = Math.round(rate * recoveryDays);
      recoveryDeductions.push({
        type: "unpaid_leave",
        amount,
        days: recoveryDays,
        note: recoveryNote || "ঋণাত্মক ছুটির জমা সমন্বয় (সম্মতিক্রমে)",
      });
      await LeaveBalanceRecovery.findOneAndUpdate(
        { staffProfileId: new Types.ObjectId(sid), payrollRunId: run._id },
        {
          $set: {
            monthKey: input.monthKey,
            days: recoveryDays,
            amount,
            note: recoveryNote,
            agreedBy: new Types.ObjectId(input.actorId),
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
    } else {
      // Dropping the days from a re-prepare must also drop the credit.
      await LeaveBalanceRecovery.deleteOne({ staffProfileId: new Types.ObjectId(sid), payrollRunId: run._id });
    }

    /**
     * HELD PROBATION LEAVE CHARGED BY CHOICE (D-#898).
     *
     * The same two halves as the recovery above: a payslip deduction AND a row that
     * takes the days off the held debt, so confirmation does not debit them from the
     * pool and exit does not charge them again. A leaver never reaches here with a
     * charge (`assertChargesWithinOwed` refused it): their exit dues take the whole debt.
     */
    const probationDays = dues ? 0 : Math.max(0, adj?.probationChargeDays ?? 0);
    if (probationDays > 0) {
      const amount = Math.round(rate * probationDays);
      const note = adj?.probationChargeNote?.trim();
      recoveryDeductions.push({ type: "unpaid_leave", amount, days: probationDays, note: note || PROBATION_CHARGE_NOTE });
      await ProbationDebtRecovery.findOneAndUpdate(
        { staffProfileId: new Types.ObjectId(sid), payrollRunId: run._id },
        {
          $set: {
            monthKey: input.monthKey,
            days: probationDays,
            amount,
            note,
            chargedBy: new Types.ObjectId(input.actorId),
          },
          $setOnInsert: { applied: false },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }

    const additions: PayLineInput[] = [...(adj?.manualAdditions ?? [])];
    if (dues?.encashment) additions.push(dues.encashment);
    // At exit the outstanding advance is netted in FULL (H6.4), still under the net-pay
    // guard; the Office can hold it back with an explicit `recoverAdvance: false`.
    const takeAdvance = dues ? !!advance && adj?.recoverAdvance !== false : recoverAdvance(advance, adj);

    const computed = computePayslip({
      grossSalary: gross,
      dayRate: rate,
      unpaidLeaveDays: leaveDays.get(sid) ?? 0,
      latenessDeduction,
      manualDeductions: recoveryDeductions,
      manualAdditions: additions,
      advance: takeAdvance
        ? {
            advanceId: advance!._id.toString(),
            recoveryMode: dues ? "one_shot" : advance!.recoveryMode,
            installmentAmount: advance!.installmentAmount,
            balance: advance!.balance,
          }
        : null,
    });
    payslipDocs.push({
      payrollRunId: run._id,
      staffProfileId: s._id,
      monthKey: input.monthKey,
      snapshotName: s.name,
      category: s.category,
      paymentMethod: s.paymentMethod,
      grossSalary: gross,
      dayRate: rate,
      paidLeaveDays: 0,
      unpaidLeaveDays: leaveDays.get(sid) ?? 0,
      deductions: computed.deductions,
      additions: computed.additions,
      totalDeductions: computed.totalDeductions,
      totalAdditions: computed.totalAdditions,
      netPay: computed.netPay,
      advanceRepaid: computed.advanceRepaid,
      advanceId: computed.advanceId ? new Types.ObjectId(computed.advanceId) : null,
      payableDays: payableDays ?? null,
      exitCaseId: exitThisMonth?.caseId ?? null,
    });
  }
  const payslips = payslipDocs.length ? await Payslip.insertMany(payslipDocs) : [];

  await writeAudit({
    eventKind: "PAYROLL_PREPARED",
    actorId: input.actorId,
    targetId: run._id,
    targetKind: "PayrollRun",
    meta: { monthKey: input.monthKey, staff: payslips.length, workingDays: input.workingDays, recomputed: !!existing },
  });
  return { run, payslips: payslips as unknown as IPayslip[] };
}

/** Principal approve → LOCK + commit advance recovery. Idempotent guard: only a
 *  `prepared` run can be approved (a second call on a locked run throws). */
export async function approvePayrollRun(runId: string, actorId: string): Promise<IPayrollRun> {
  const run = await PayrollRun.findById(runId);
  if (!run) throw new PayrollError("Payroll run not found");
  if (run.status !== "prepared") throw new PayrollError(`Run is ${run.status} — only a prepared run can be approved`);

  // Commit advance recovery at lock time (never at prepare — prevents double-decrement on recompute).
  const payslips = await Payslip.find({ payrollRunId: run._id, advanceRepaid: { $gt: 0 } }).lean();
  for (const p of payslips) {
    if (!p.advanceId) continue;
    const advance = await AdvanceLoan.findById(p.advanceId);
    if (!advance) continue;
    advance.balance = Math.max(0, advance.balance - p.advanceRepaid);
    if (advance.balance === 0) {
      advance.status = "settled";
      advance.settledAt = new Date();
    }
    await advance.save();
  }

  // SH-4 / D-#541: freeze this month's lateness charges alongside the payslips they
  // fed. A re-uploaded attendance sheet REPLACES that date's rows wholesale (AT1.5),
  // so an unfrozen charge would let a later correction restate an already-paid payslip.
  const frozen = await freezeLatenessCharges(run.monthKey, run._id);

  // D-#711: a leaver's last payslip IS their final settlement — commit it onto the exit
  // case (and settle the probation debt it charged) so it is never paid a second time.
  const exitSlips = await Payslip.find({ payrollRunId: run._id, exitCaseId: { $ne: null } }).lean();
  const exitsSettled = await commitExitPayslips(exitSlips, run.workingDays, actorId);

  run.status = "approved_locked";
  run.approvedBy = new Types.ObjectId(actorId);
  run.approvedAt = new Date();
  await run.save();

  await writeAudit({
    eventKind: "PAYROLL_APPROVED",
    actorId,
    targetId: run._id,
    targetKind: "PayrollRun",
    meta: { monthKey: run.monthKey, advancesRecovered: payslips.length, latenessChargesFrozen: frozen, exitsSettled },
  });
  return run;
}

export async function cancelPayrollRun(runId: string, actorId: string): Promise<IPayrollRun> {
  const run = await PayrollRun.findById(runId);
  if (!run) throw new PayrollError("Payroll run not found");
  if (run.status !== "prepared") throw new PayrollError("Only a prepared run can be cancelled");
  await Payslip.deleteMany({ payrollRunId: run._id });
  // The run's leave-balance credits were never paid — they must not keep raising a balance.
  await LeaveBalanceRecovery.deleteMany({ payrollRunId: run._id });
  // Nor may its probation charges keep days off the held debt (D-#898).
  await ProbationDebtRecovery.deleteMany({ payrollRunId: run._id });
  // Nor its per-person lateness choices (D-#908). Rule-mode rows are left exactly as before.
  if (!(await getHrPolicy()).latenessRuleEnabled) {
    await LatenessCharge.deleteMany({ payrollRunId: run._id, frozen: false, byChoice: true });
  }
  run.status = "cancelled";
  await run.save();
  await writeAudit({ eventKind: "PAYROLL_CANCELLED", actorId, targetId: run._id, targetKind: "PayrollRun", meta: { monthKey: run.monthKey } });
  return run;
}

/**
 * How long the lock's own writes can precede `approvedAt`. `approvePayrollRun` saves the
 * advances, freezes lateness and settles the leavers FIRST and stamps the run last, so
 * everything the lock wrote is dated at or shortly before `approvedAt`.
 */
const LOCK_WRITE_WINDOW_MS = 10 * 60_000;

/**
 * Reopen a LOCKED run so a mistake can be corrected (D-#904, overriding D-#110's "a
 * locked run is never retro-edited"). The owner: *"option to cancel the payroll if later
 * find any mistake."*
 *
 * Reopening must leave the books exactly as if the run had never been locked, because
 * the next lock will do all of it again. So everything `approvePayrollRun` did is undone:
 *   - advance recovery: each payslip's `advanceRepaid` goes back onto its loan, and a loan
 *     the lock settled becomes active again;
 *   - lateness: the month's charges this run froze are unfrozen;
 *   - leavers (D-#711): the settlement written onto the exit case is taken back, with the
 *     held probation debt and any probation charge the lock settled.
 * The run returns to `prepared` — staff stop seeing its payslips (they read locked runs
 * only) and the bank files cannot be produced — and can be re-prepared, cancelled or
 * locked again. Every reopen is kept on the run with its reason, and audited.
 *
 * REFUSED, before anything is written (D-#574), when undoing is not safe:
 *   - a LATER month is already locked (it was computed from this month's balances);
 *   - an advance this run recovered has changed since (another run, an early payoff or
 *     a write-off) — putting the money back would double it;
 *   - a probation charge in this run has since been settled by a confirmation (D-#898).
 */
export async function reopenPayrollRun(runId: string, reason: string, actorId: string): Promise<IPayrollRun> {
  const run = await PayrollRun.findById(runId);
  if (!run) throw new PayrollError("Payroll run not found");
  if (run.status !== "approved_locked") throw new PayrollError("শুধু লক করা বেতনের হিসাব আবার খোলা যায়");
  const why = reason.trim();
  if (!why) throw new PayrollError("কেন আবার খুলছেন তা লিখুন");
  const lockedAt = run.approvedAt ?? run.updatedAt;

  const later = await PayrollRun.findOne({ monthKey: { $gt: run.monthKey }, status: "approved_locked" })
    .sort({ monthKey: 1 })
    .select("monthKey")
    .lean();
  if (later) {
    throw new PayrollError(`${later.monthKey} মাসের বেতন লক করা আছে — আগে সেই মাসটি আবার খুলুন, তারপর এটি`);
  }

  const slips = await Payslip.find({ payrollRunId: run._id }).lean();
  const advanceSlips = slips.filter((p) => p.advanceId && p.advanceRepaid > 0);
  const advances = await AdvanceLoan.find({ _id: { $in: advanceSlips.map((p) => p.advanceId!) } });
  const byId = new Map(advances.map((a) => [a._id.toString(), a]));
  for (const p of advanceSlips) {
    const a = byId.get(p.advanceId!.toString());
    if (a && a.updatedAt.getTime() > lockedAt.getTime()) {
      throw new PayrollError(
        `${p.snapshotName}-এর অগ্রিম এই রান লক হওয়ার পর বদলেছে — অগ্রিম ঠিক না করে এই রান আবার খোলা যাবে না`,
      );
    }
  }
  if (await ProbationDebtRecovery.exists({ payrollRunId: run._id, applied: true })) {
    throw new PayrollError("এই রানের প্রবেশনকালীন ছুটির কর্তন স্থায়ীকরণে সমন্বয় হয়ে গেছে — রানটি আবার খোলা যাবে না");
  }

  // 1. Advance recovery back onto the loans.
  for (const p of advanceSlips) {
    const a = byId.get(p.advanceId!.toString());
    if (!a) continue;
    a.balance += p.advanceRepaid;
    if (a.status === "settled") {
      a.status = "active";
      a.settledAt = undefined;
    }
    await a.save();
  }

  // 2. Lateness charges unfrozen — the next lock freezes them again.
  const unfrozen = await LatenessCharge.updateMany(
    { payrollRunId: run._id, frozen: true },
    { $set: { frozen: false } },
  );

  // 3. Leavers: the settlement this run wrote onto the exit case is taken back.
  const windowStart = new Date(lockedAt.getTime() - LOCK_WRITE_WINDOW_MS);
  let exitsReopened = 0;
  for (const p of slips.filter((s) => s.exitCaseId)) {
    const c = await OffboardingCase.findById(p.exitCaseId);
    if (!c || c.settlement?.paidInMonthKey !== run.monthKey) continue;
    c.set("settlement", undefined);
    if (c.status === "completed") c.status = c.accessRevoked ? "access_revoked" : "initiated";
    await c.save();
    const lockWindow = { $gte: windowStart, $lte: lockedAt };
    await ProbationLeaveDebt.updateMany(
      { staffProfileId: p.staffProfileId, settled: true, settledVia: "exit", settledAt: lockWindow },
      { $set: { settled: false, settledAt: null, settledVia: null, settledFromPool: null, settledToSalary: null } },
    );
    await ProbationDebtRecovery.updateMany(
      { staffProfileId: p.staffProfileId, applied: true, appliedVia: "exit", appliedAt: lockWindow },
      { $set: { applied: false, appliedAt: null, appliedVia: null } },
    );
    await writeAudit({
      eventKind: "FINAL_SETTLEMENT_REOPENED",
      actorId,
      targetId: c._id,
      targetKind: "OffboardingCase",
      meta: { monthKey: run.monthKey, payrollRunId: run._id.toString(), reason: why },
    });
    exitsReopened += 1;
  }

  // 4. The run itself, back to prepared — with the reopen kept on it.
  const previousApprovedAt = run.approvedAt ?? null;
  run.status = "prepared";
  run.approvedBy = undefined;
  run.approvedAt = undefined;
  run.reopenings = [
    ...(run.reopenings ?? []),
    { at: new Date(), by: new Types.ObjectId(actorId), reason: why, previousApprovedAt },
  ];
  await run.save();

  await writeAudit({
    eventKind: "PAYROLL_REOPENED",
    actorId,
    targetId: run._id,
    targetKind: "PayrollRun",
    meta: {
      monthKey: run.monthKey,
      reason: why,
      advancesRestored: advanceSlips.length,
      latenessUnfrozen: unfrozen.modifiedCount ?? 0,
      exitsReopened,
    },
  });
  // D-#952: staff had seen the payslips — the preparer's correction to explain.
  await recordPlaceMistake({
    kind: "PAYROLL_REOPEN",
    refKey: String(run._id),
    ownerId: run.preparedBy,
    correctedBy: actorId,
    at: new Date(),
    line: `${run.monthKey} মাসের বেতন লক করার পর আবার খোলা হয়েছে: "${why}"`,
  });
  return run;
}

// --- reads -----------------------------------------------------------------

export async function payrollRuns(limit = 36): Promise<IPayrollRun[]> {
  return PayrollRun.find({ status: { $ne: "cancelled" } })
    .sort({ monthKey: -1 })
    .limit(limit)
    .lean() as unknown as Promise<IPayrollRun[]>;
}

export async function payslipsForRun(runId: string): Promise<IPayslip[]> {
  return Payslip.find({ payrollRunId: new Types.ObjectId(runId) })
    .sort({ snapshotName: 1 })
    .lean() as unknown as Promise<IPayslip[]>;
}

/**
 * HR-G1 own-row read: a staff member's OWN payslips across runs (newest month first).
 * LOCKED-RUNS-ONLY — a staff member must never see a draft/`prepared` (or `cancelled`)
 * payslip; only `approved_locked` runs are issued (§4.2). The caller's StaffProfile is
 * resolved by the resolver (phone-join, fail-closed); this read is scoped to that one id.
 */
export async function payslipsForStaff(staffProfileId: string): Promise<IPayslip[]> {
  const lockedRuns = await PayrollRun.find({ status: "approved_locked" }).select("_id").lean();
  if (lockedRuns.length === 0) return [];
  return Payslip.find({
    staffProfileId: new Types.ObjectId(staffProfileId),
    payrollRunId: { $in: lockedRuns.map((r) => r._id) },
  })
    .sort({ monthKey: -1 })
    .lean() as unknown as Promise<IPayslip[]>;
}

export interface PaymentExportRow {
  staffProfileId: string;
  name: string;
  paymentMethod: string;
  account: string | null;
  /** SH-10's three fields. A bank transfer cannot be made from a number alone. */
  accountName: string | null;
  bankName: string | null;
  bankBranch: string | null;
  netPay: number;
  /**
   * `null` when the row can actually be paid; otherwise WHY it cannot — a missing
   * account, or a net of zero.
   *
   * Blocked rows are RETURNED, not filtered out (D-#579). Dropping them silently is
   * how a person misses a salary: the operator sees a list, pays it, and nobody
   * notices the two names that were never on it. They are returned and shown apart,
   * and only the payable ones go into the file.
   */
  blockedReason: string | null;
}

const NO_ACCOUNT = "অ্যাকাউন্ট নম্বর নেই";
const NO_BANK_DETAILS = "ব্যাংকের নাম/শাখা/হিসাবধারীর নাম অসম্পূর্ণ";
const ZERO_NET = "নিট বেতন শূন্য";

/** Net pay per staff for bank/bKash bulk upload — cash EXCLUDED (§4.6). Locked run only. */
export async function paymentExport(runId: string): Promise<PaymentExportRow[]> {
  const run = await PayrollRun.findById(runId).lean();
  if (!run) throw new PayrollError("Payroll run not found");
  if (run.status !== "approved_locked") throw new PayrollError("Payment export issues only from a locked run (§4.6)");
  const slips = await Payslip.find({ payrollRunId: new Types.ObjectId(runId), paymentMethod: { $ne: "cash" } }).lean();
  const staff = await StaffProfile.find({ _id: { $in: slips.map((s) => s.staffProfileId) } })
    .select("bankAccount bankAccountName bankName bankBranch")
    .lean();
  const byId = new Map(staff.map((s) => [s._id.toString(), s]));
  return slips
    .map((s) => {
      const d = byId.get(s.staffProfileId.toString());
      const account = d?.bankAccount?.trim() || null;
      const accountName = d?.bankAccountName?.trim() || null;
      const bankName = d?.bankName?.trim() || null;
      const bankBranch = d?.bankBranch?.trim() || null;
      // bKash pays to a number; a bank transfer needs the name, bank and branch too.
      const bankIncomplete =
        s.paymentMethod === "bank" && !(accountName && bankName && bankBranch);
      const blockedReason =
        s.netPay <= 0 ? ZERO_NET : !account ? NO_ACCOUNT : bankIncomplete ? NO_BANK_DETAILS : null;
      return {
        staffProfileId: s.staffProfileId.toString(),
        name: s.snapshotName,
        paymentMethod: s.paymentMethod ?? "",
        account,
        accountName,
        bankName,
        bankBranch,
        netPay: s.netPay,
        blockedReason,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
