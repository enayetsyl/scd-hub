import { Schema, model, Document, Types } from "mongoose";
import {
  OFFBOARDING_TRIGGERS,
  OFFBOARDING_STATUSES,
  CLEARANCE_ITEM_STATUSES,
  PAY_DEDUCTION_TYPES,
  PAY_ADDITION_TYPES,
  type OffboardingTrigger,
  type OffboardingStatus,
  type ClearanceItemStatus,
} from "@scd/shared";

/**
 * OffboardingCase (HR-5; prd-hr §6, H6, D-#29/#117) — the cross-cutting exit record
 * that stitches HR-1 records + HR-2 leave + HR-3 payroll + HR-4 conduct:
 *
 *   trigger → sets StaffProfile.employmentStatus (H6.1; termination already wired from
 *             HR-4 H5.3 — this is its entry point).
 *   clearanceItems → the configurable asset-return / handover / no-dues checklist (H6.2;
 *             list items are admin DATA with read-time defaults, the D-#97 no-seed posture).
 *   access revocation → the SYSTEM disables the User login + revokes ALL scope grants on
 *             the last working day (H6.3; the N-2 ticker sweep + a manual admin path).
 *   settlement → a final pay computation (salary pro-rated + arrears + full leave
 *             encashment − outstanding advance) HARD-HELD until clearance is complete
 *             (H6.4/D-#29 — no deadline). Released by the Principal (payroll:approve).
 *   retention → the StaffProfile is NEVER deleted; this case + a service certificate +
 *             optional exit interview are retained, confidentiality continues (H6.5).
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */

/** One clearance checklist line (embedded). */
export interface IClearanceItem {
  key: string;
  label: string;
  status: ClearanceItemStatus;
  note?: string | null;
  updatedBy?: Types.ObjectId | null;
  updatedAt?: Date | null;
}

/** One computed settlement line (mirrors the payroll PayLineInput shape). */
export interface ISettlementLine {
  type: string;
  amount: number;
  days?: number | null;
  note?: string | null;
}

/** The hard-held final settlement (computed once; released by the Principal). */
export interface IFinalSettlement {
  workingDays: number;
  payableDays?: number | null;
  dayRate: number;
  grossSalary: number;
  leaveEncashmentDays: number;
  deductions: ISettlementLine[];
  additions: ISettlementLine[];
  totalDeductions: number;
  totalAdditions: number;
  netPay: number;
  advanceId?: Types.ObjectId | null;
  advanceRecovered: number;
  /** Hard-held until clearance is complete (H6.4/D-#29). */
  held: boolean;
  computedAt: Date;
  computedBy: Types.ObjectId;
  releasedAt?: Date | null;
  releasedBy?: Types.ObjectId | null;
}

export interface IOffboardingCase extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  trigger: OffboardingTrigger;
  status: OffboardingStatus;
  noticeDateKey?: string | null;
  lastWorkingDayKey: string; // YYYY-MM-DD — access revoked on/after this day (H6.3)

  clearanceItems: IClearanceItem[];

  accessRevoked: boolean;
  accessRevokedAt?: Date | null;
  grantsRevokedCount?: number;
  loginDisabled?: boolean;

  settlement?: IFinalSettlement | null;

  // Retention (H6.5)
  exitInterview?: { reason?: string | null; feedback?: string | null; conductedBy: Types.ObjectId; conductedAt: Date } | null;
  serviceCertificateIssuedAt?: Date | null;
  serviceCertificateBy?: Types.ObjectId | null;

  initiatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ClearanceItemSchema = new Schema<IClearanceItem>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    status: { type: String, enum: CLEARANCE_ITEM_STATUSES, required: true, default: "pending" },
    note: { type: String, default: null },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

const SettlementLineSchema = new Schema<ISettlementLine>(
  {
    type: { type: String, enum: [...PAY_DEDUCTION_TYPES, ...PAY_ADDITION_TYPES], required: true },
    amount: { type: Number, required: true },
    days: { type: Number, default: null },
    note: { type: String, default: null },
  },
  { _id: false },
);

const FinalSettlementSchema = new Schema<IFinalSettlement>(
  {
    workingDays: { type: Number, required: true },
    payableDays: { type: Number, default: null },
    dayRate: { type: Number, required: true },
    grossSalary: { type: Number, required: true },
    leaveEncashmentDays: { type: Number, required: true, default: 0 },
    deductions: { type: [SettlementLineSchema], default: [] },
    additions: { type: [SettlementLineSchema], default: [] },
    totalDeductions: { type: Number, required: true },
    totalAdditions: { type: Number, required: true },
    netPay: { type: Number, required: true },
    advanceId: { type: Schema.Types.ObjectId, default: null },
    advanceRecovered: { type: Number, required: true, default: 0 },
    held: { type: Boolean, required: true, default: true },
    computedAt: { type: Date, required: true },
    computedBy: { type: Schema.Types.ObjectId, required: true },
    releasedAt: { type: Date, default: null },
    releasedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const OffboardingCaseSchema = new Schema<IOffboardingCase>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    trigger: { type: String, enum: OFFBOARDING_TRIGGERS, required: true },
    status: { type: String, enum: OFFBOARDING_STATUSES, required: true, default: "initiated" },
    noticeDateKey: { type: String, default: null },
    lastWorkingDayKey: { type: String, required: true },

    clearanceItems: { type: [ClearanceItemSchema], default: [] },

    accessRevoked: { type: Boolean, default: false },
    accessRevokedAt: { type: Date, default: null },
    grantsRevokedCount: { type: Number, default: 0 },
    loginDisabled: { type: Boolean, default: false },

    settlement: { type: FinalSettlementSchema, default: null },

    exitInterview: {
      type: new Schema(
        {
          reason: { type: String, default: null },
          feedback: { type: String, default: null },
          conductedBy: { type: Schema.Types.ObjectId, required: true },
          conductedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    serviceCertificateIssuedAt: { type: Date, default: null },
    serviceCertificateBy: { type: Schema.Types.ObjectId, default: null },

    initiatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

OffboardingCaseSchema.index({ staffProfileId: 1, createdAt: -1 });
// The system access-revocation sweep reads this (lazy, on the last working day, H6.3).
OffboardingCaseSchema.index({ status: 1, accessRevoked: 1, lastWorkingDayKey: 1 });

export const OffboardingCase = model<IOffboardingCase>("OffboardingCase", OffboardingCaseSchema);
