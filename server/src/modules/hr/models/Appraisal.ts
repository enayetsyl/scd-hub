import { Schema, model, Document, Types } from "mongoose";
import { APPRAISAL_STATUSES, APPRAISAL_OUTCOMES, type AppraisalStatus, type AppraisalOutcome } from "@scd/shared";

/**
 * Appraisal (HR-4; prd-hr §5.1, H5.1/H5.2, D-#28) — one per staff per CYCLE
 * (cycle = annual, aligned to the academic year). It gathers the cycle's
 * observations (rolled up via `Observation.appraisalId`), the cycle's goals, and an
 * overall outcome, and emits development needs into the CPD log on sign-off (H5.4).
 *
 * Lifecycle (D-#112): Office/Principal (`performance:manage`) PREPARE the `draft`
 * (goals + gather); the overall **outcome + sign-off is PRINCIPAL-only**
 * (`performance:signoff`) — a supervisor never sets or sees it (H5.2). The subject
 * sees their OWN appraisal outcome only (H5.5); supervisors do not.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IAppraisal extends Document {
  _id: Types.ObjectId;
  staffProfileId: Types.ObjectId;
  academicYearId: Types.ObjectId;
  status: AppraisalStatus;
  goals: string[];
  /** Development needs captured for the cycle → emitted to the CPD log at sign-off. */
  developmentNeeds: string[];
  /** Set ONLY at Principal sign-off (H5.2). */
  overallOutcome?: AppraisalOutcome | null;
  outcomeNote?: string | null;
  signedOffBy?: Types.ObjectId | null;
  signedOffAt?: Date | null;
  preparedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AppraisalSchema = new Schema<IAppraisal>(
  {
    staffProfileId: { type: Schema.Types.ObjectId, ref: "StaffProfile", required: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    status: { type: String, enum: APPRAISAL_STATUSES, required: true, default: "draft" },
    goals: { type: [String], default: [] },
    developmentNeeds: { type: [String], default: [] },
    overallOutcome: { type: String, enum: APPRAISAL_OUTCOMES, default: null },
    outcomeNote: { type: String, trim: true, default: null },
    signedOffBy: { type: Schema.Types.ObjectId, default: null },
    signedOffAt: { type: Date, default: null },
    preparedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// One appraisal per staff per cycle (H5.1).
AppraisalSchema.index({ staffProfileId: 1, academicYearId: 1 }, { unique: true });

export const Appraisal = model<IAppraisal>("Appraisal", AppraisalSchema);
