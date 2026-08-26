/**
 * StaffLetterService (SH-1; docs/prd-staff-hub.md §4, D-#542).
 *
 * Issues a letter by FREEZING every merge field into `StaffLetter.snapshot`. The PDF
 * renderer reads the snapshot and nothing else, so re-rendering an old letter after the
 * profile has been edited still produces the page the person signed.
 *
 * Ref numbers are `${prefix}/${year}/${seq}` with `seq` a per-year sequence. Allocation
 * retries on the unique index rather than holding a lock: two Office users issuing at
 * the same second is rare, and a duplicate-key retry is both simpler and safer than a
 * counter document that can drift from the letters it is supposed to number.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
import { Types } from "mongoose";
import { STAFF_LETTER_KINDS, SALARY_MODES, type StaffLetterKind, type SalaryMode } from "@scd/shared";
import { StaffLetter, type IStaffLetter, type ILetterSnapshot } from "../models/StaffLetter";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { getHrPolicy } from "./HrPolicyService";
import { writeAudit } from "../../platform/services/AuditService";

export class LetterError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "LetterError";
  }
}

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-09-01" → "September, 2026" — the letter's own wording for clause 0. */
export function effectiveFromText(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) throw new LetterError(`Invalid date (want YYYY-MM-DD): ${dateKey}`);
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) throw new LetterError(`Invalid month in ${dateKey}`);
  return `${MONTHS_EN[monthIdx]}, ${m[1]}`;
}

/** `SCD/HR/2026/0052`. */
function formatRefNo(prefix: string, year: number, seq: number): string {
  return `${prefix}/${year}/${String(seq).padStart(4, "0")}`;
}

export interface IssueLetterInput {
  staffProfileId: string;
  kind: StaffLetterKind;
  /** The letter's printed date (YYYY-MM-DD). Defaults to today. */
  letterDate?: string;
  /** When the appointment/confirmation takes effect (YYYY-MM-DD). */
  effectiveFrom: string;
  salaryMode: SalaryMode;
  /** Overrides the profile's salary for this letter only; ignored when honorary. */
  monthlySalary?: number | null;
  designation?: string | null;
  weeklyHours?: string | null;
  extraText?: string | null;
  actorId: string;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Issue a letter. Builds the snapshot from the live profile + policy ONCE, here; every
 * later read (screen, PDF, WhatsApp share) goes through the stored copy.
 */
export async function issueLetter(input: IssueLetterInput): Promise<IStaffLetter> {
  if (!STAFF_LETTER_KINDS.includes(input.kind)) throw new LetterError(`Unknown letter kind: ${input.kind}`);
  if (!SALARY_MODES.includes(input.salaryMode)) throw new LetterError(`Unknown salary mode: ${input.salaryMode}`);

  const staff = await StaffProfile.findById(input.staffProfileId).lean();
  if (!staff) throw new LetterError("Staff profile not found");

  const policy = await getHrPolicy();
  const letterDate = input.letterDate ?? todayKey();
  const effectiveFrom = effectiveFromText(input.effectiveFrom);

  const designation = (input.designation ?? staff.designation ?? "").trim();
  if (!designation) {
    // Clause 6 names the post. The Word template's stray "principal" is exactly what
    // happens when this is left to a default, so refuse rather than print a wrong one.
    throw new LetterError("A designation is required — it is printed in the letter (clause 6)");
  }

  // The two clauses are MUTUALLY EXCLUSIVE (D-#542). An honorary letter carries no
  // figure at all, so a later reader cannot mistake a leftover salary for the terms.
  const monthlySalary =
    input.salaryMode === "honorary" ? null : input.monthlySalary ?? staff.monthlySalary ?? null;
  if (input.salaryMode === "paid" && (monthlySalary === null || monthlySalary <= 0)) {
    throw new LetterError(
      "A paid appointment letter prints a salary figure — set the monthly salary first, or issue it as honorary",
    );
  }

  const snapshot: ILetterSnapshot = {
    staffName: staff.name,
    staffNameBn: staff.nameBn ?? null,
    schoolId: staff.schoolId,
    designation,
    address: staff.presentAddress ?? staff.permanentAddress ?? null,
    salaryMode: input.salaryMode,
    monthlySalary,
    weeklyHours: input.weeklyHours ?? policy.weeklyHoursText,
    annualLeaveDays: policy.annualLeaveDays,
    effectiveFrom,
    confirmationDate:
      input.kind === "confirmation" ? input.effectiveFrom : null,
    signatoryName: policy.signatoryName,
    signatoryTitle: policy.signatoryTitle,
    letterDate,
  };

  const year = Number(letterDate.slice(0, 4));
  const doc = await createWithRefNo(
    {
      staffProfileId: new Types.ObjectId(input.staffProfileId),
      kind: input.kind,
      issuedOn: new Date(),
      status: "issued",
      snapshot,
      extraText: input.extraText?.trim() || null,
      issuedBy: new Types.ObjectId(input.actorId),
    },
    policy.letterRefPrefix,
    year,
  );

  await writeAudit({
    eventKind: "STAFF_LETTER_ISSUED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "StaffLetter",
    meta: {
      staffProfileId: input.staffProfileId,
      kind: input.kind,
      refNo: doc.refNo,
      salaryMode: input.salaryMode,
      monthlySalary,
    },
  });

  /**
   * The letter IS the agreed terms, so the figure it promises must reach the record
   * that pays it. Found in the 2026-08-26 prod E2E test: a letter was issued promising
   * Tk. 12,345 against a profile with NO salary, because the override lived only in the
   * snapshot. Nothing looked wrong — the letter was correct, the record was silently
   * incomplete, and payroll would have computed nothing for that person.
   *
   * So a PAID letter whose figure the profile does not already carry writes it back,
   * audited under the ordinary pay-change kind (this is a pay change; it just arrived
   * through the letter). The snapshot is untouched either way — it stays frozen.
   * An honorary letter writes nothing: it promises no figure to honour.
   */
  if (input.salaryMode === "paid" && monthlySalary !== null && staff.monthlySalary !== monthlySalary) {
    const previous = staff.monthlySalary ?? null;
    await StaffProfile.updateOne({ _id: staff._id }, { $set: { monthlySalary } });
    await writeAudit({
      eventKind: "STAFF_PAY_SET",
      actorId: input.actorId,
      targetId: staff._id,
      targetKind: "StaffProfile",
      meta: {
        monthlySalary,
        previous,
        via: "letter",
        letterRefNo: doc.refNo,
        reason: "the salary a paid letter promises is written back to the record that pays it",
      },
    });
  }

  return doc;
}

/**
 * Allocate the next per-year sequence and insert, retrying on the `refNo` unique index.
 * The index is the arbiter, so two concurrent issues can never share a number — the
 * loser simply reads the new max and tries again.
 */
async function createWithRefNo(
  base: Partial<IStaffLetter>,
  prefix: string,
  year: number,
): Promise<IStaffLetter> {
  const MAX_TRIES = 5;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const last = await StaffLetter.findOne({ refYear: year }).sort({ refSeq: -1 }).select("refSeq").lean();
    const refSeq = (last?.refSeq ?? 0) + 1;
    try {
      return await StaffLetter.create({
        ...base,
        refYear: year,
        refSeq,
        refNo: formatRefNo(prefix, year, refSeq),
      });
    } catch (err) {
      const isDup = typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
      if (!isDup || attempt === MAX_TRIES - 1) throw err;
    }
  }
  throw new LetterError("Could not allocate a letter reference number — try again");
}

/**
 * Void a letter. It is KEPT and stays renderable: someone is holding a paper copy with
 * this ref no on it, and being able to pull it up and see "void, superseded" is the
 * whole point of not deleting it (D-#542).
 */
export async function voidLetter(
  letterId: string,
  reason: string,
  actorId: string,
): Promise<IStaffLetter> {
  const letter = await StaffLetter.findById(letterId);
  if (!letter) throw new LetterError("Letter not found");
  if (letter.status === "void") return letter;
  if (!reason.trim()) throw new LetterError("A reason is required to void a letter");

  letter.status = "void";
  letter.voidedBy = new Types.ObjectId(actorId);
  letter.voidedAt = new Date();
  letter.voidReason = reason.trim();
  await letter.save();

  await writeAudit({
    eventKind: "STAFF_LETTER_VOIDED",
    actorId,
    targetId: letter._id,
    targetKind: "StaffLetter",
    meta: { refNo: letter.refNo, kind: letter.kind, reason: letter.voidReason },
  });
  return letter;
}

/** This person's letters, newest first — the hub's কাগজপত্র tab. */
export async function lettersForStaff(staffProfileId: string): Promise<IStaffLetter[]> {
  return StaffLetter.find({ staffProfileId: new Types.ObjectId(staffProfileId) })
    .sort({ issuedOn: -1 })
    .lean() as unknown as Promise<IStaffLetter[]>;
}

export async function letterById(letterId: string): Promise<IStaffLetter | null> {
  return StaffLetter.findById(letterId).lean() as unknown as Promise<IStaffLetter | null>;
}
