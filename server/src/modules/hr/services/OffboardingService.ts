/**
 * OffboardingService (HR-5; prd-hr §6, H6, D-#29/#117) — the cross-cutting exit
 * workflow. It COMPOSES the earlier HR slices, it does not twin them:
 *   - access revocation REUSES `revokeAllGrantsForUser` (foundation ScopeGrantService)
 *     + the User login flag (no new revoke logic);
 *   - the final settlement REUSES `dayRate`/`computePayslip` (payrollMath), the leave
 *     encashment from `balancesForStaff` (HR-2), and the advance from `activeAdvanceByStaff`
 *     (HR-3) — it does not re-implement payroll;
 *   - the trigger sets `StaffProfile.employmentStatus` (HR-1 field; termination's value
 *     is the HR-4 H5.3 entry point).
 *
 * Access revocation follows the settled no-cron / lazy posture (D-#20/#21): a lazy
 * date gate (`lastWorkingDayReached`) means access is revoked only ON/after the last
 * working day, and the "by the system" requirement (H6.3) is met by the N-2 in-process
 * ticker calling `runDueOffboardingRevocations` (NOT a new scheduler) — plus a manual
 * admin path. The final settlement is HARD-HELD until clearance is complete (H6.4/D-#29).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import type { OffboardingTrigger, ClearanceItemStatus } from "@scd/shared";
import { OffboardingCase, type IOffboardingCase, type IFinalSettlement } from "../models/OffboardingCase";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { User } from "../../foundation/models/User";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { AdvanceLoan } from "../models/AdvanceLoan";
import { revokeAllGrantsForUser } from "../../foundation/services/ScopeGrantService";
import { writeAudit } from "../../platform/services/AuditService";
import { dateKeyOf } from "../../attendance/dates";
import { parseDateKey } from "./dates";
import { dayRate, computePayslip, type PayLineInput } from "./payrollMath";
import { pendingExitDebt, settleOnExit } from "./ProbationDebtService";
import { balancesForStaff, pooledBalanceForStaff } from "./LeaveEntitlementService";
import { activeAdvanceByStaff } from "./AdvanceService";
import { resolveUserIdForStaff } from "./staffMatch";
import {
  OffboardingError,
  employmentStatusForTrigger,
  defaultClearanceItems,
  clearanceComplete,
  lastWorkingDayReached,
} from "./offboardingMath";

// --- H6.1 initiate ----------------------------------------------------------

export interface InitiateOffboardingInput {
  staffProfileId: string;
  trigger: OffboardingTrigger;
  lastWorkingDayKey: string;
  noticeDateKey?: string;
  actorId: string;
}

export async function initiateOffboarding(input: InitiateOffboardingInput): Promise<IOffboardingCase> {
  parseDateKey(input.lastWorkingDayKey); // validate
  if (input.noticeDateKey) parseDateKey(input.noticeDateKey);
  const staff = await StaffProfile.findById(input.staffProfileId).select("_id active").lean();
  if (!staff) throw new OffboardingError("Staff profile not found");

  // One live exit per staff: refuse a second case that hasn't completed/cancelled.
  const open = await OffboardingCase.findOne({
    staffProfileId: new Types.ObjectId(input.staffProfileId),
    status: { $in: ["initiated", "access_revoked"] },
  })
    .select("_id")
    .lean();
  if (open) throw new OffboardingError("This staff member already has an open offboarding case");

  const offboarding = await OffboardingCase.create({
    staffProfileId: new Types.ObjectId(input.staffProfileId),
    trigger: input.trigger,
    status: "initiated",
    lastWorkingDayKey: input.lastWorkingDayKey,
    noticeDateKey: input.noticeDateKey ?? null,
    clearanceItems: defaultClearanceItems().map((i) => ({ ...i, status: "pending" as ClearanceItemStatus })),
    initiatedBy: new Types.ObjectId(input.actorId),
  });

  // H6.1 — the trigger sets the employment status (retained, never deleted, H6.5).
  await StaffProfile.findByIdAndUpdate(input.staffProfileId, {
    employmentStatus: employmentStatusForTrigger(input.trigger),
  });

  await writeAudit({
    eventKind: "OFFBOARDING_INITIATED",
    actorId: input.actorId,
    targetId: offboarding._id,
    targetKind: "OffboardingCase",
    meta: { staffProfileId: input.staffProfileId, trigger: input.trigger, lastWorkingDayKey: input.lastWorkingDayKey },
  });
  return offboarding;
}

// --- H6.2 clearance checklist -----------------------------------------------

export async function addClearanceItem(caseId: string, key: string, label: string, actorId: string): Promise<IOffboardingCase> {
  const c = await OffboardingCase.findById(caseId);
  if (!c) throw new OffboardingError("Offboarding case not found");
  if (c.status === "completed" || c.status === "cancelled") throw new OffboardingError("This offboarding case is closed");
  if (c.clearanceItems.some((i) => i.key === key)) throw new OffboardingError(`Clearance item "${key}" already exists`);
  c.clearanceItems.push({ key, label, status: "pending", note: null, updatedBy: new Types.ObjectId(actorId), updatedAt: new Date() });
  await c.save();
  await writeAudit({ eventKind: "OFFBOARDING_CLEARANCE_UPDATED", actorId, targetId: c._id, targetKind: "OffboardingCase", meta: { added: key } });
  return c;
}

export async function updateClearanceItem(
  caseId: string,
  key: string,
  status: ClearanceItemStatus,
  note: string | undefined,
  actorId: string,
): Promise<IOffboardingCase> {
  const c = await OffboardingCase.findById(caseId);
  if (!c) throw new OffboardingError("Offboarding case not found");
  if (c.status === "completed" || c.status === "cancelled") throw new OffboardingError("This offboarding case is closed");
  const item = c.clearanceItems.find((i) => i.key === key);
  if (!item) throw new OffboardingError(`Clearance item "${key}" not found`);
  item.status = status;
  if (note !== undefined) item.note = note;
  item.updatedBy = new Types.ObjectId(actorId);
  item.updatedAt = new Date();
  await c.save();
  await writeAudit({
    eventKind: "OFFBOARDING_CLEARANCE_UPDATED",
    actorId,
    targetId: c._id,
    targetKind: "OffboardingCase",
    meta: { key, status },
  });
  return c;
}

// --- H6.3 access revocation (by the system, on the last working day) --------

export interface RevokeAccessInput {
  caseId: string;
  /** The acting admin for a manual revoke; the system sweep attributes to the case
   *  initiator (no real "system user" row). */
  actorId?: string;
  now?: Date;
}

export async function revokeOffboardingAccess(input: RevokeAccessInput): Promise<IOffboardingCase> {
  const c = await OffboardingCase.findById(input.caseId);
  if (!c) throw new OffboardingError("Offboarding case not found");
  if (c.status === "cancelled") throw new OffboardingError("This offboarding case was cancelled");
  if (c.accessRevoked) return c; // idempotent — already revoked

  const now = input.now ?? new Date();
  if (!lastWorkingDayReached(c.lastWorkingDayKey, dateKeyOf(now))) {
    throw new OffboardingError(`Access is revoked on the last working day (${c.lastWorkingDayKey}) — not before (H6.3)`);
  }
  const actorId = input.actorId ?? c.initiatedBy.toString();

  // Disable the login (support staff have no User — no-op there) + revoke ALL grants.
  const userId = await resolveUserIdForStaff(c.staffProfileId.toString());
  let loginDisabled = false;
  if (userId) {
    await User.findByIdAndUpdate(userId, { active: false });
    loginDisabled = true;
  }
  const grantsRevoked = userId ? await revokeAllGrantsForUser(userId, actorId) : 0;

  c.accessRevoked = true;
  c.accessRevokedAt = now;
  c.loginDisabled = loginDisabled;
  c.grantsRevokedCount = grantsRevoked;
  if (c.status === "initiated") c.status = "access_revoked";
  await c.save();

  await writeAudit({
    eventKind: "OFFBOARDING_ACCESS_REVOKED",
    actorId,
    targetId: c._id,
    targetKind: "OffboardingCase",
    meta: { staffProfileId: c.staffProfileId.toString(), userId, loginDisabled, grantsRevoked },
  });
  return c;
}

/** The "by the system" sweep (H6.3) — revoke access for every initiated case whose
 *  last working day has arrived. Called by the N-2 ticker (no new scheduler) + a
 *  best-effort per-case try so one failure never stalls the rest. Returns the count. */
export async function runDueOffboardingRevocations(now: Date = new Date()): Promise<number> {
  const todayKey = dateKeyOf(now);
  const due = await OffboardingCase.find({
    status: "initiated",
    accessRevoked: false,
    lastWorkingDayKey: { $lte: todayKey },
  })
    .select("_id")
    .lean();
  let revoked = 0;
  for (const d of due) {
    try {
      await revokeOffboardingAccess({ caseId: d._id.toString(), now });
      revoked += 1;
    } catch (e) {
      console.error("[offboarding] access revocation failed for case", d._id.toString(), e);
    }
  }
  return revoked;
}

// --- H6.4 final settlement (hard-held until clearance) ----------------------

export interface ComputeSettlementInput {
  caseId: string;
  workingDays: number;
  academicYearId?: string;
  payableDays?: number;
  manualAdditions?: PayLineInput[];
  manualDeductions?: PayLineInput[];
  actorId: string;
}

export async function computeFinalSettlement(input: ComputeSettlementInput): Promise<IOffboardingCase> {
  if (input.workingDays < 1) throw new OffboardingError("workingDays must be ≥ 1");
  const c = await OffboardingCase.findById(input.caseId);
  if (!c) throw new OffboardingError("Offboarding case not found");
  if (c.status === "cancelled" || c.status === "completed") throw new OffboardingError("This offboarding case is closed");
  if (c.settlement && c.settlement.held === false) {
    throw new OffboardingError("The final settlement is already released — it cannot be recomputed");
  }

  const staff = await StaffProfile.findById(c.staffProfileId).select("monthlySalary").lean();
  if (!staff) throw new OffboardingError("Staff profile not found");
  if (!staff.monthlySalary || staff.monthlySalary <= 0) {
    throw new OffboardingError("Staff member has no monthly salary set — cannot compute a settlement");
  }

  const rate = dayRate(staff.monthlySalary, input.workingDays);
  const gross = input.payableDays != null ? Math.round(rate * input.payableDays) : staff.monthlySalary;

  // H6.4 — full leave encashment: the carried-over encashable days × day-rate (H2.4(b)).
  const ayId =
    input.academicYearId ?? (await AcademicYear.findOne({ current: true }).select("_id").lean())?._id?.toString();
  let encashableDays = 0;
  if (ayId) {
    const balances = await balancesForStaff(c.staffProfileId.toString(), ayId);
    encashableDays = balances.reduce((s, b) => s + b.encashableDays, 0);
  }
  const additions: PayLineInput[] = [...(input.manualAdditions ?? [])];
  if (encashableDays > 0) {
    additions.push({ type: "leave_encashment", amount: Math.round(rate * encashableDays), days: encashableDays });
  }

  // SH-3 / D-#540 — a probationer who leaves before being confirmed carries their HELD
  // leave debt to the final settlement: the pool that would have absorbed it was never
  // granted. Read-only here; the rows are marked settled only when the settlement is
  // RELEASED, so a recompute cannot consume the debt and then leave it out of the
  // figure the Principal actually approves.
  const heldProbationDays = await pendingExitDebt(c.staffProfileId.toString());
  const deductions: PayLineInput[] = [...(input.manualDeductions ?? [])];

  /**
   * AN OVERDRAWN LEAVE BALANCE IS RECOVERED HERE, AND ONLY HERE (D-#616).
   *
   * Leave and lateness both draw the pool and the pool may go negative; payroll never
   * turns that into a salary deduction while someone is employed. The debt is real
   * though, and this is the last payslip — so the final settlement is where it lands,
   * exactly as the probation-held debt above does.
   *
   * The two do not overlap. Held probation days never entered the pool at all (there was
   * no pool to enter), so they are counted separately; a negative balance is days that
   * DID draw a pool and took it past zero.
   *
   * An earlier agreed recovery (D-#617) has already moved the balance back up, so
   * whatever remains negative here is genuinely still owed.
   */
  const pool = await pooledBalanceForStaff(c.staffProfileId.toString(), ayId ?? null);
  const overdrawnDays = pool.remainingDays < 0 ? Math.abs(pool.remainingDays) : 0;
  if (overdrawnDays > 0) {
    deductions.push({
      type: "unpaid_leave",
      amount: Math.round(rate * overdrawnDays),
      days: overdrawnDays,
      note: "ঋণাত্মক ছুটির জমা (D-#616)",
    });
  }

  if (heldProbationDays > 0) {
    deductions.push({
      type: "unpaid_leave",
      amount: Math.round(rate * heldProbationDays),
      days: heldProbationDays,
      note: "প্রবেশনকালীন জমা ছুটি (D-#540)",
    });
  }

  // H6.4 — outstanding advance netted in FULL at exit (one_shot), capped by the net-pay guard.
  const advance = (await activeAdvanceByStaff()).get(c.staffProfileId.toString());
  const computed = computePayslip({
    grossSalary: gross,
    dayRate: rate,
    unpaidLeaveDays: 0,
    manualDeductions: deductions,
    manualAdditions: additions,
    advance: advance
      ? { advanceId: advance._id.toString(), recoveryMode: "one_shot", balance: advance.balance }
      : null,
  });

  const settlement: IFinalSettlement = {
    workingDays: input.workingDays,
    payableDays: input.payableDays ?? null,
    dayRate: rate,
    grossSalary: gross,
    leaveEncashmentDays: encashableDays,
    deductions: computed.deductions,
    additions: computed.additions,
    totalDeductions: computed.totalDeductions,
    totalAdditions: computed.totalAdditions,
    netPay: computed.netPay,
    advanceId: computed.advanceId ? new Types.ObjectId(computed.advanceId) : null,
    advanceRecovered: computed.advanceRepaid,
    held: true,
    computedAt: new Date(),
    computedBy: new Types.ObjectId(input.actorId),
    releasedAt: null,
    releasedBy: null,
  };
  c.settlement = settlement;
  await c.save();

  await writeAudit({
    eventKind: "FINAL_SETTLEMENT_COMPUTED",
    actorId: input.actorId,
    targetId: c._id,
    targetKind: "OffboardingCase",
    meta: { netPay: settlement.netPay, encashableDays, advanceRecovered: settlement.advanceRecovered },
  });
  return c;
}

/** Principal releases the hard-held settlement — GATED on clearance being complete
 *  (H6.4/D-#29; no deadline). Commits the advance recovery and closes the case. */
export async function releaseFinalSettlement(caseId: string, actorId: string): Promise<IOffboardingCase> {
  const c = await OffboardingCase.findById(caseId);
  if (!c) throw new OffboardingError("Offboarding case not found");
  if (!c.settlement) throw new OffboardingError("No settlement has been computed yet");
  if (c.settlement.held === false) throw new OffboardingError("The settlement is already released");
  if (!clearanceComplete(c.clearanceItems)) {
    throw new OffboardingError(
      "The final settlement is hard-held until clearance is complete — every item must be done or waived (H6.4/D-#29)",
    );
  }

  // Commit the advance recovery (mirrors the payroll lock, HR-3) — at exit the
  // outstanding is netted against the settlement (H6.4).
  if (c.settlement.advanceId && c.settlement.advanceRecovered > 0) {
    const advance = await AdvanceLoan.findById(c.settlement.advanceId);
    if (advance) {
      advance.balance = Math.max(0, advance.balance - c.settlement.advanceRecovered);
      if (advance.balance === 0) {
        advance.status = "settled";
        advance.settledAt = new Date();
      }
      await advance.save();
    }
  }

  // SH-3 / D-#540 — the held probation debt is marked settled only NOW, at release:
  // the deduction is part of the figure being paid out, and a recompute before this
  // point must never have consumed it.
  await settleOnExit(c.staffProfileId.toString(), actorId);

  c.settlement.held = false;
  c.settlement.releasedAt = new Date();
  c.settlement.releasedBy = new Types.ObjectId(actorId);
  c.markModified("settlement");
  c.status = "completed";
  await c.save();

  await writeAudit({
    eventKind: "FINAL_SETTLEMENT_RELEASED",
    actorId,
    targetId: c._id,
    targetKind: "OffboardingCase",
    meta: { netPay: c.settlement.netPay },
  });
  return c;
}

// --- H6.5 retention: exit interview + service certificate -------------------

export async function recordExitInterview(
  caseId: string,
  reason: string | undefined,
  feedback: string | undefined,
  actorId: string,
): Promise<IOffboardingCase> {
  const c = await OffboardingCase.findById(caseId);
  if (!c) throw new OffboardingError("Offboarding case not found");
  c.exitInterview = {
    reason: reason ?? null,
    feedback: feedback ?? null,
    conductedBy: new Types.ObjectId(actorId),
    conductedAt: new Date(),
  };
  await c.save();
  await writeAudit({ eventKind: "EXIT_INTERVIEW_RECORDED", actorId, targetId: c._id, targetKind: "OffboardingCase" });
  return c;
}

export async function issueServiceCertificate(caseId: string, actorId: string): Promise<IOffboardingCase> {
  const c = await OffboardingCase.findById(caseId);
  if (!c) throw new OffboardingError("Offboarding case not found");
  c.serviceCertificateIssuedAt = new Date();
  c.serviceCertificateBy = new Types.ObjectId(actorId);
  await c.save();
  await writeAudit({ eventKind: "SERVICE_CERTIFICATE_ISSUED", actorId, targetId: c._id, targetKind: "OffboardingCase" });
  return c;
}

/** Withdraw an exit BEFORE access has been revoked (e.g. a resignation pulled). The
 *  StaffProfile.employmentStatus is left as-is for an admin to correct via the profile
 *  surface (re-confirming is not this slice's call). */
export async function cancelOffboarding(caseId: string, actorId: string): Promise<IOffboardingCase> {
  const c = await OffboardingCase.findById(caseId);
  if (!c) throw new OffboardingError("Offboarding case not found");
  if (c.status !== "initiated") throw new OffboardingError("Only an initiated case (before access revocation) can be cancelled");
  c.status = "cancelled";
  await c.save();
  await writeAudit({ eventKind: "OFFBOARDING_CANCELLED", actorId, targetId: c._id, targetKind: "OffboardingCase" });
  return c;
}

// --- reads ------------------------------------------------------------------

export async function offboardingCaseById(caseId: string): Promise<IOffboardingCase | null> {
  return OffboardingCase.findById(caseId).lean() as unknown as Promise<IOffboardingCase | null>;
}

export async function offboardingCases(status?: string): Promise<IOffboardingCase[]> {
  const q: Record<string, unknown> = {};
  if (status) q.status = status;
  return OffboardingCase.find(q).sort({ createdAt: -1 }).lean() as unknown as Promise<IOffboardingCase[]>;
}

export async function offboardingCasesForStaff(staffProfileId: string): Promise<IOffboardingCase[]> {
  return OffboardingCase.find({ staffProfileId: new Types.ObjectId(staffProfileId) })
    .sort({ createdAt: -1 })
    .lean() as unknown as Promise<IOffboardingCase[]>;
}
