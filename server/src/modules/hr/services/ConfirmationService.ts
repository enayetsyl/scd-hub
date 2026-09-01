/**
 * ConfirmationService (SH-2; docs/prd-staff-hub.md §4, D-#540/#542).
 *
 * Confirming employment is an EVENT with side effects, not a field edit — which is why
 * `confirmationDate` is deliberately absent from `StaffProfileInput` and only reachable
 * here. One call:
 *
 *   1. stamps `confirmationDate` + flips `employmentStatus` → "confirmed";
 *   2. settles the held probation-leave debt against the newly-granted pool, returning
 *      whatever the pool could not absorb so the caller can show it as a salary charge;
 *   3. optionally issues the confirmation letter from the same data.
 *
 * The order matters. The date is written FIRST, because the pool's pro-ration and every
 * later paid/unpaid test read it — settling before stamping would compute the debt
 * against a pool that does not exist yet.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { StaffLetter } from "../models/StaffLetter";
import { pooledBalanceForStaff } from "./LeaveEntitlementService";
import { settleOnConfirmation, heldDebtForStaff, type SettlementResult } from "./ProbationDebtService";
import { issueLetter } from "./StaffLetterService";
import { writeAudit } from "../../platform/services/AuditService";
import { LeaveError } from "./dates";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ConfirmEmploymentInput {
  staffProfileId: string;
  /** YYYY-MM-DD. */
  confirmationDate: string;
  /** Optional extra paragraph for the confirmation letter. */
  extraText?: string | null;
  /** Issue the confirmation letter in the same call (default true). */
  issueLetter?: boolean;
  actorId: string;
}

export interface ConfirmEmploymentResult {
  staffProfileId: string;
  confirmationDate: string;
  settlement: SettlementResult;
  /** The pool AFTER the debt was debited — what the person actually has left. */
  poolRemainingAfter: number;
  letterId: string | null;
  /** Set when the confirmation SUCCEEDED but the letter could not be issued (D-#574). */
  letterError: string | null;
}

/**
 * A dry run of exactly what `confirmEmployment` would do. The স্থায়ীকরণ sheet shows
 * this ledger before the button is pressed, so nothing is settled by looking at it.
 */
export async function previewConfirmation(
  staffProfileId: string,
): Promise<{ heldDays: number; poolAllowance: number; poolRemaining: number; fromPool: number; toSalary: number }> {
  const held = await heldDebtForStaff(staffProfileId);
  const pool = await pooledBalanceForStaff(staffProfileId);
  // The preview must promise what the button will DO (D-#621): the pool absorbs the
  // whole debt and may end negative, so nothing falls to salary. Leaving the old
  // capped split here would show the Principal a salary charge that never arrives.
  return {
    heldDays: held.totalDays,
    poolAllowance: pool.allowanceDays,
    poolRemaining: pool.remainingDays,
    fromPool: held.totalDays,
    toSalary: 0,
  };
}

export async function confirmEmployment(
  input: ConfirmEmploymentInput,
): Promise<ConfirmEmploymentResult> {
  if (!DATE_RE.test(input.confirmationDate)) {
    throw new LeaveError(`Invalid confirmation date (want YYYY-MM-DD): ${input.confirmationDate}`);
  }

  const staff = await StaffProfile.findById(input.staffProfileId);
  if (!staff) throw new LeaveError("কর্মীর প্রোফাইল পাওয়া যায়নি");
  if (staff.confirmationDate) {
    throw new LeaveError("এই কর্মী ইতিমধ্যে স্থায়ী — তারিখ ভুল হলে প্রোফাইল থেকে সংশোধন করুন");
  }
  if (staff.joiningDate) {
    const joinKey = staff.joiningDate.toISOString().slice(0, 10);
    if (input.confirmationDate < joinKey) {
      throw new LeaveError("স্থায়ীকরণের তারিখ যোগদানের তারিখের আগে হতে পারে না");
    }
  }

  // 0. Everything that CAN refuse is checked BEFORE the first write (D-#574).
  //
  // The letter needs a designation; without this check the refusal arrives at step 3,
  // after the status flip and the debt settlement have already committed. Validating
  // here turns "half-done and reported as failed" into a clean refusal that changed
  // nothing — which is what the operator's error message already implied had happened.
  if (input.issueLetter !== false && !(staff.designation ?? "").trim()) {
    throw new LeaveError(
      "পদবি ছাড়া স্থায়ীকরণ পত্র তৈরি করা যায় না — আগে পদবি দিন, অথবা পত্র ছাড়া স্থায়ী করুন",
    );
  }

  // 1. Stamp the date first — the pool's pro-ration and every paid/unpaid test read it.
  //
  // UTC midnight, NOT local: `new Date("2026-07-01")` parses a bare date-only string as
  // UTC, which is exactly what `StaffProfileService.parseDate` already does for
  // joiningDate and dob. Using `T00:00:00` here would store LOCAL midnight, and every
  // read that round-trips through `toISOString()` — the GraphQL `iso()` the app slices,
  // and the joining-date guard below — would come back one day EARLY at any positive
  // UTC offset. Bangladesh is +06, so a confirmation on 1 July displayed as 30 June.
  staff.confirmationDate = new Date(input.confirmationDate);
  staff.employmentStatus = "confirmed";
  await staff.save();

  // 2. Settle the held debt against the pool the person has just been granted.
  const pool = await pooledBalanceForStaff(input.staffProfileId);
  const settlement = await settleOnConfirmation(input.staffProfileId, pool.remainingDays, input.actorId);
  // NOT floored (D-#621). The pool absorbs the whole probation debt and may end
  // negative; clamping here would tell the Principal "0 days left" at the moment of
  // confirmation while the balance they are about to see reads −2, and would hide
  // exactly the case worth knowing about.
  const poolRemainingAfter = pool.remainingDays - settlement.fromPool;

  // 3. The letter, from the same data — NON-FATAL (D-#574).
  //
  // Found by driving prod: a staff member with no `designation` reached this line, the
  // letter refused (it is what clause 5 prints), the whole mutation threw — and steps 1
  // and 2 had ALREADY COMMITTED. She was confirmed, her 3 held days were settled, the
  // operator was told "failed" twice, and because `writeAudit` sits below this line the
  // confirmation went into the record with NO AUDIT ROW AT ALL.
  //
  // The confirmation is the act that matters; the letter is a document that can be
  // issued afterwards from the কাগজপত্র tab. So a letter failure is REPORTED, never
  // fatal — and the audit is written either way. The step-0 designation check above
  // catches the known cause before anything is written, so this catch is the backstop
  // for a failure we did not foresee, not the primary guard.
  let letterId: string | null = null;
  let letterError: string | null = null;
  if (input.issueLetter !== false) {
    try {
      const letter = await issueLetter({
        staffProfileId: input.staffProfileId,
        kind: "confirmation",
        effectiveFrom: input.confirmationDate,
        // A confirmation letter restates the standing terms; honorary staff have no
        // figure to restate, so the mode follows whether a salary is actually on record.
        salaryMode: staff.monthlySalary && staff.monthlySalary > 0 ? "paid" : "honorary",
        extraText: input.extraText ?? null,
        actorId: input.actorId,
      });
      letterId = letter._id.toString();
    } catch (err) {
      letterError = err instanceof Error ? err.message : String(err);
    }
  }

  await writeAudit({
    eventKind: "STAFF_EMPLOYMENT_CONFIRMED",
    actorId: input.actorId,
    targetId: staff._id,
    targetKind: "StaffProfile",
    meta: {
      confirmationDate: input.confirmationDate,
      heldDays: settlement.heldDays,
      settledFromPool: settlement.fromPool,
      settledToSalary: settlement.toSalary,
      poolRemainingAfter,
      letterId,
      letterError,
    },
  });

  return {
    staffProfileId: input.staffProfileId,
    confirmationDate: input.confirmationDate,
    settlement,
    poolRemainingAfter,
    letterId,
    letterError,
  };
}

/** Has this staff member ever had a letter of a given kind issued (and not voided)? */
export async function hasLiveLetter(staffProfileId: string, kind: string): Promise<boolean> {
  const found = await StaffLetter.exists({ staffProfileId, kind, status: "issued" });
  return found !== null;
}
