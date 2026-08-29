import { Schema, model, Document, Types } from "mongoose";
import {
  STAFF_LETTER_KINDS,
  STAFF_LETTER_STATUSES,
  SALARY_MODES,
  type StaffLetterKind,
  type StaffLetterStatus,
  type SalaryMode,
} from "@scd/shared";

/**
 * StaffLetter (SH-1; docs/prd-staff-hub.md §4, D-#542) — an ISSUED letter, stored as
 * a FROZEN RECORD rather than as a print job.
 *
 * The whole design turns on one rule: **the PDF renders from `snapshot`, never from
 * the live StaffProfile.** A letter is a document a person signed and holds a paper
 * copy of; re-rendering it after their address, designation or salary is edited must
 * produce the same page, or the copy on file and the copy in the app stop matching.
 * This is exactly why `Payslip` stores `snapshotName` instead of joining the profile.
 *
 * Consequences, deliberate:
 *   - a letter is NEVER edited. A wrong one is `void`ed (kept + still renderable, so
 *     the paper copy can be matched) and a fresh one issued with a new ref no;
 *   - `refNo` is unique and per-year sequential, so it is never reused;
 *   - `extraText` is the owner's "additional text" — it is part of the snapshot the
 *     moment it is issued, not an editable annotation.
 *
 * The template's two self-contradictions are resolved HERE, not reproduced:
 * `salaryMode` picks clause 1 (paid) or clause 2 (honorary) — never both — and
 * `designation` is snapshotted so clause 6 names the real post instead of the
 * template's stray "principal".
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */

/** Every merge field the renderer may read. Frozen at issue; never re-derived. */
export interface ILetterSnapshot {
  // who
  staffName: string;
  staffNameBn?: string | null;
  schoolId: string;
  designation: string;
  address?: string | null;
  // terms
  salaryMode: SalaryMode;
  /** Whole taka. Present iff salaryMode === "paid". */
  monthlySalary?: number | null;
  /** Free text as it prints, e.g. "25 (5*5)" — a letter field, not a profile column. */
  weeklyHours?: string | null;
  annualLeaveDays: number;
  /** "September, 2026" — the letter's own wording for the effective month. */
  effectiveFrom: string;
  /** Confirmation letters only: the date employment was confirmed (YYYY-MM-DD). */
  confirmationDate?: string | null;
  /**
   * Service-certificate dates (D-#583), snapshotted like everything else here.
   *
   * A certificate with no dates certifies almost nothing — a bank or a next employer
   * needs the period, not just the fact. `serviceTo` is null while the person is still
   * employed, and that is what decides the TENSE: "has been serving since X" for a
   * current employee, "served from X to Y" for someone who has left. The first version
   * said "served" for everyone, which reads as a leaving certificate to anyone holding
   * it — the opposite of what a serving teacher needs it to say.
   */
  serviceFrom?: string | null;
  serviceTo?: string | null;
  // signature block
  signatoryName: string;
  signatoryTitle: string;
  /** The letter's own printed date (YYYY-MM-DD). */
  letterDate: string;
}

export interface IStaffLetter extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  kind: StaffLetterKind;
  /** e.g. "SCD/HR/2026/0052". Unique — allocated once, never reused (D-#542). */
  refNo: string;
  /** The year the ref-no sequence belongs to, so allocation is a scoped max(). */
  refYear: number;
  refSeq: number;
  issuedOn: Date;
  status: StaffLetterStatus;
  snapshot: ILetterSnapshot;
  /** The owner's optional extra paragraph, printed after the numbered clauses. */
  extraText?: string | null;
  issuedBy: Types.ObjectId;
  voidedBy?: Types.ObjectId | null;
  voidedAt?: Date | null;
  voidReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const LetterSnapshotSchema = new Schema<ILetterSnapshot>(
  {
    staffName: { type: String, required: true },
    staffNameBn: { type: String, default: null },
    schoolId: { type: String, required: true },
    designation: { type: String, required: true },
    address: { type: String, default: null },
    salaryMode: { type: String, enum: SALARY_MODES, required: true },
    monthlySalary: { type: Number, default: null, min: 0 },
    weeklyHours: { type: String, default: null },
    annualLeaveDays: { type: Number, required: true, min: 0 },
    effectiveFrom: { type: String, required: true },
    confirmationDate: { type: String, default: null },
    serviceFrom: { type: String, default: null },
    serviceTo: { type: String, default: null },
    signatoryName: { type: String, required: true },
    signatoryTitle: { type: String, required: true },
    letterDate: { type: String, required: true },
  },
  { _id: false },
);

const StaffLetterSchema = new Schema<IStaffLetter>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    kind: { type: String, enum: STAFF_LETTER_KINDS, required: true },
    refNo: { type: String, required: true, unique: true, trim: true },
    refYear: { type: Number, required: true },
    refSeq: { type: Number, required: true, min: 1 },
    issuedOn: { type: Date, required: true },
    status: { type: String, enum: STAFF_LETTER_STATUSES, required: true, default: "issued" },
    snapshot: { type: LetterSnapshotSchema, required: true },
    extraText: { type: String, default: null, trim: true },
    issuedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    voidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: null, trim: true },
  },
  { timestamps: true },
);

// The hub's কাগজপত্র tab: this person's letters, newest first.
StaffLetterSchema.index({ staffProfileId: 1, issuedOn: -1 });
// Ref-no allocation reads max(refSeq) within a year.
StaffLetterSchema.index({ refYear: 1, refSeq: -1 });

export const StaffLetter = model<IStaffLetter>("StaffLetter", StaffLetterSchema);
