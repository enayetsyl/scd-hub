/**
 * FeeSupportAllocation — a roster-linked, effective-dated, APPEND-ONLY "living master"
 * of which provider covers which heads for a student (FIN-2B, prd-finance-fin2.md §3.B,
 * D-#226). Adds / removes / amount-changes are NEW dated rows; the active allocation for
 * a student on a date = the latest by `createdAt` with `effectiveDate ≤ date`, status
 * ACTIVE, and not ended. Coverage is PER-HEAD: each entry is FULL (the whole posted head)
 * or AMOUNT (a ৳ cap per posting).
 *
 * No `schoolId` (single school, D-#145). Identity plane (names studentId) — no corpus
 * path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";
import {
  FINANCE_STUDENT_FEE_HEADS,
  FEE_COVERAGE_TYPES,
  FEE_SUPPORT_ALLOCATION_STATUSES,
} from "@scd/shared";

export interface ICoverageItem {
  head: string;
  type: string; // FEE_COVERAGE_TYPES
  amount?: number | null; // required for AMOUNT (the ৳ cap)
}

export interface IFeeSupportAllocation extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  providerId: Types.ObjectId;
  coverage: ICoverageItem[];
  effectiveDate: Date;
  endDate?: Date | null;
  status: string;
  note?: string | null;
  enteredByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CoverageItemSchema = new Schema<ICoverageItem>(
  {
    head: { type: String, required: true, enum: FINANCE_STUDENT_FEE_HEADS as unknown as string[] },
    type: { type: String, required: true, enum: FEE_COVERAGE_TYPES as unknown as string[] },
    amount: { type: Number, default: null },
  },
  { _id: false },
);

const FeeSupportAllocationSchema = new Schema<IFeeSupportAllocation>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    providerId: { type: Schema.Types.ObjectId, ref: "FeeProvider", required: true },
    coverage: { type: [CoverageItemSchema], required: true },
    effectiveDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    status: { type: String, required: true, enum: FEE_SUPPORT_ALLOCATION_STATUSES as unknown as string[], default: "ACTIVE" },
    note: { type: String, default: null, trim: true },
    enteredByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// Active-allocation resolution keys off (student, effectiveDate, createdAt).
FeeSupportAllocationSchema.index({ studentId: 1, effectiveDate: -1, createdAt: -1 });
FeeSupportAllocationSchema.index({ providerId: 1 });

export const FeeSupportAllocation = model<IFeeSupportAllocation>(
  "FeeSupportAllocation",
  FeeSupportAllocationSchema,
);
