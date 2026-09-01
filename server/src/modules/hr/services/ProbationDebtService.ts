/**
 * ProbationDebtService (SH-3; docs/prd-staff-hub.md §4, D-#540).
 *
 * The owner's rule for probation leave: *"Record as unpaid and will be adjusted when
 * [they] become permanent, or if not, [it] will be adjusted on final month salary."*
 *
 * So probation leave is a HELD DEBT — neither paid (it must not draw the pool) nor an
 * immediate salary deduction (nothing comes off that month's pay). It waits for
 * exactly one of two events:
 *
 *   settleOnConfirmation — debited from the newly-granted pool; anything over the
 *                          pool falls through to salary as a returned figure
 *   settleOnExit         — everything still held becomes a salary charge at day-rate
 *
 * THE PIVOT IS A DATE, NOT A STATUS. `isProbationLeave` compares the leave's own
 * `fromKey` against `StaffProfile.confirmationDate`. Reading the live
 * `employmentStatus` instead would make a confirmation retroactively pay for leave
 * taken months earlier while the person was still on probation — the balance would
 * change under a decision that was already made and already communicated.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import { ProbationLeaveDebt, type IProbationLeaveDebt } from "../models/ProbationLeaveDebt";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { StaffLeaveApplication } from "../models/StaffLeaveApplication";
import { writeAudit } from "../../platform/services/AuditService";
import { roundLeaveDays } from "./dates";

/**
 * `YYYY-MM-DD` for a stored profile date.
 *
 * UTC getters, deliberately: `confirmationDate`, `joiningDate` and `dob` are all
 * written by parsing a bare `YYYY-MM-DD`, which JavaScript resolves to UTC midnight.
 * Reading them back with LOCAL getters would shift the day at any negative UTC offset,
 * and comparing a local-derived key against a `fromKey` string would then classify a
 * leave on the confirmation date itself as probation leave — unpaid, wrongly.
 */
export function toDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Was this leave taken while on probation? True when the staff member has no
 * `confirmationDate` at all, or when the leave STARTS before it.
 *
 * Deliberately date-driven, and deliberately generous at the boundary: leave starting
 * ON the confirmation date is confirmed-service leave and is paid.
 */
export function isProbationLeave(fromKey: string, confirmationDate?: Date | null): boolean {
  if (!confirmationDate) return true;
  return fromKey < toDateKey(confirmationDate);
}

/** The same test, reading the profile. */
export async function isProbationLeaveForStaff(
  staffProfileId: string | Types.ObjectId,
  fromKey: string,
): Promise<boolean> {
  const staff = await StaffProfile.findById(staffProfileId).select("confirmationDate").lean();
  return isProbationLeave(fromKey, staff?.confirmationDate ?? null);
}

/** Record (or refresh) the held debt for an approved probation leave. Idempotent on
 *  the application id, so re-approving after a cancel does not double-charge. */
export async function recordProbationDebt(params: {
  staffProfileId: Types.ObjectId | string;
  leaveApplicationId: Types.ObjectId | string;
  fromKey: string;
  leaveType: string;
  days: number;
}): Promise<void> {
  await ProbationLeaveDebt.findOneAndUpdate(
    { leaveApplicationId: new Types.ObjectId(params.leaveApplicationId.toString()) },
    {
      $set: {
        staffProfileId: new Types.ObjectId(params.staffProfileId.toString()),
        fromKey: params.fromKey,
        leaveType: params.leaveType,
        days: params.days,
      },
      $setOnInsert: { settled: false },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/** Drop a held debt whose leave was later rejected or cancelled — an absence that did
 *  not happen must not carry a charge into the person's confirmation. */
export async function clearProbationDebt(leaveApplicationId: Types.ObjectId | string): Promise<void> {
  await ProbationLeaveDebt.deleteOne({
    leaveApplicationId: new Types.ObjectId(leaveApplicationId.toString()),
    settled: false,
  });
}

export interface HeldDebtView {
  totalDays: number;
  rows: Array<{
    id: string;
    fromKey: string;
    leaveType: string;
    days: number;
  }>;
}

/** Everything still held for a staff member — the hub's ছুটি tab reads this. */
export async function heldDebtForStaff(staffProfileId: string): Promise<HeldDebtView> {
  const rows = (await ProbationLeaveDebt.find({
    staffProfileId: new Types.ObjectId(staffProfileId),
    settled: false,
  })
    .sort({ fromKey: 1 })
    .lean()) as unknown as IProbationLeaveDebt[];

  const totalDays = rows.reduce((s, r) => s + r.days, 0);
  return {
    totalDays: roundLeaveDays(totalDays),
    rows: rows.map((r) => ({
      id: r._id.toString(),
      fromKey: r.fromKey,
      leaveType: r.leaveType,
      days: roundLeaveDays(r.days),
    })),
  };
}

export interface SettlementResult {
  heldDays: number;
  fromPool: number;
  toSalary: number;
  rowsSettled: number;
}

/**
 * Settle at CONFIRMATION (D-#540): the held days are debited from the pool the person
 * has just been granted; anything the pool cannot absorb is returned as `toSalary` for
 * the caller to charge.
 *
 * `poolRemaining` is passed in rather than read here so the caller — which has just
 * written `confirmationDate` and may have pro-rated the allowance in the same
 * transaction — decides what "the new pool" means exactly once.
 */
export async function settleOnConfirmation(
  staffProfileId: string,
  poolRemaining: number,
  actorId: string,
): Promise<SettlementResult> {
  const rows = (await ProbationLeaveDebt.find({
    staffProfileId: new Types.ObjectId(staffProfileId),
    settled: false,
  })
    .sort({ fromKey: 1 })
    .lean()) as unknown as IProbationLeaveDebt[];

  const heldDays = rows.reduce((s, r) => s + r.days, 0);
  /**
   * THE POOL ABSORBS ALL OF IT, EVEN PAST ZERO (D-#621).
   *
   * This used to cap at `poolRemaining` and push the remainder to salary as ordinary
   * unpaid leave. That was right under the old rule; since D-#616 leave is settled
   * against the BALANCE and never automatically against salary, and this was the one
   * place the old behaviour survived.
   *
   * It surfaced on a real confirmation. A teacher's letter says his 16 probation days
   * and 12 lateness days are "adjusted against the entitlement that begins now" and
   * that the school "did not deduct your salary for those days" — but 10 lateness days
   * had already consumed half his allowance, so settlement pooled 10 of the 16 and left
   * 6 as unpaid leave that the August run would have deducted. The letter promises the
   * opposite of what the code did.
   *
   * `toSalary` stays in the result and is now always 0 for a confirmation; the EXIT
   * path (`settleOnExit`) is where a debt legitimately becomes money.
   */
  const fromPool = heldDays;
  const toSalary = 0;

  // Oldest debt first, so the ledger reads in the order the days were incurred.
  const now = new Date();
  for (const r of rows) {
    const pooled = r.days;

    /**
     * THE LEAVE ITSELF IS RE-STAMPED, not just the ledger row (D-#590).
     *
     * The pool's `taken` is the sum of approved PAID days, so ticking the debt row
     * "settled" while the application still read `paidDays: 0, probationHeld: true`
     * debited nothing: the confirmation preview promised "20 − 3 = 17", the audit
     * recorded `poolRemainingAfter: 17`, and the pool went on reading 20. Payroll
     * skips `probationHeld` rows too, so the days were not charged to salary either —
     * they simply left the accounting. Found by the owner driving prod: "3 leave
     * didn't adjust".
     *
     * So the held days BECOME PAID LEAVE and the pool debits them by its ordinary rule
     * — all of them, taking the balance negative if that is where it lands (D-#621).
     * None of it becomes unpaid: an overdrawn balance is recovered at exit, or earlier
     * by agreement, never by a deduction nobody asked for.
     */
    await StaffLeaveApplication.updateOne(
      { _id: r.leaveApplicationId },
      { $set: { paidDays: pooled, unpaidDays: 0, probationHeld: false } },
    );

    await ProbationLeaveDebt.updateOne(
      { _id: r._id },
      {
        $set: {
          settled: true,
          settledAt: now,
          settledVia: "confirmation",
          settledFromPool: pooled,
          settledToSalary: r.days - pooled,
        },
      },
    );
  }

  const result: SettlementResult = {
    heldDays: roundLeaveDays(heldDays),
    fromPool: roundLeaveDays(fromPool),
    toSalary: roundLeaveDays(toSalary),
    rowsSettled: rows.length,
  };

  if (rows.length > 0) {
    await writeAudit({
      eventKind: "PROBATION_DEBT_SETTLED",
      actorId,
      targetKind: "StaffProfile",
      targetId: staffProfileId,
      meta: { via: "confirmation", ...result },
    });
  }
  return result;
}

/**
 * Settle at EXIT (D-#540): a probationer who leaves before being confirmed carries the
 * whole held balance to the final settlement, at day-rate. Nothing is forgiven here —
 * the pool that would have absorbed it was never granted.
 */
export async function settleOnExit(
  staffProfileId: string,
  actorId: string,
): Promise<SettlementResult> {
  const rows = (await ProbationLeaveDebt.find({
    staffProfileId: new Types.ObjectId(staffProfileId),
    settled: false,
  }).lean()) as unknown as IProbationLeaveDebt[];

  const heldDays = rows.reduce((s, r) => s + r.days, 0);
  const now = new Date();
  for (const r of rows) {
    await ProbationLeaveDebt.updateOne(
      { _id: r._id },
      {
        $set: {
          settled: true,
          settledAt: now,
          settledVia: "exit",
          settledFromPool: 0,
          settledToSalary: r.days,
        },
      },
    );
  }

  const result: SettlementResult = {
    heldDays: roundLeaveDays(heldDays),
    fromPool: 0,
    toSalary: roundLeaveDays(heldDays),
    rowsSettled: rows.length,
  };

  if (rows.length > 0) {
    await writeAudit({
      eventKind: "PROBATION_DEBT_SETTLED",
      actorId,
      targetKind: "StaffProfile",
      targetId: staffProfileId,
      meta: { via: "exit", ...result },
    });
  }
  return result;
}

/** Read-only preview of what `settleOnExit` would charge — the offboarding screen
 *  shows this before the case is finalised, so nothing is settled by looking at it. */
export async function pendingExitDebt(staffProfileId: string): Promise<number> {
  const rows = await ProbationLeaveDebt.find({
    staffProfileId: new Types.ObjectId(staffProfileId),
    settled: false,
  })
    .select("days")
    .lean();
  return roundLeaveDays(rows.reduce((s, r) => s + r.days, 0));
}
