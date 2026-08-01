import { Schema, model, Document, Types } from "mongoose";

/**
 * MonthlyReportConfig (MR-2, prd-monthly-report §6.1, D-#395) — the Principal-tunable
 * knobs behind the monthly report: every trend threshold and minimum sample, the
 * coverage gate that blocks release, the small-section rule, and the revision calendar.
 *
 * At most ONE row (`key: "SINGLETON"`), and a missing row falls back to
 * `DEFAULT_MONTHLY_REPORT_CONFIG` in MonthlyReportConfigService — **read-time defaults,
 * NEVER seeded by a startup or bulk write against the shared live DB (D-#97)**, the
 * same posture ObservationEscalationConfig holds.
 *
 * The values in force are COPIED INTO EVERY REVISION'S SNAPSHOT (D-#395). Without
 * that, editing a threshold in September silently re-explains a July report a family
 * has already read, and the chip printed on the page can no longer be reproduced.
 *
 * Identity/operational plane — no corpus path (ADR-005).
 */
export interface IMonthlyReportConfig extends Document {
  _id: Types.ObjectId;
  /** Always "SINGLETON" — at most one config row. */
  key: string;

  // --- trend thresholds (percentage points, or raw counts where noted) -------
  attendanceThresholdPp: number;
  attendanceMinDays: number;
  homeworkThresholdPp: number;
  homeworkMinSheets: number;
  assignmentThresholdPp: number;
  assignmentMinItems: number;
  qualityThresholdPp: number;
  qualityMinChecked: number;
  classTestThresholdPp: number;
  classTestMinTests: number;
  /** Raw comment counts, not percentage points. */
  concernThreshold: number;
  resubmissionThreshold: number;
  resubmissionMinIssued: number;

  // --- absolute flags (independent of any trend) ----------------------------
  absentStreakFlag: number;
  absentUncoveredFlag: number;

  // --- release + display ----------------------------------------------------
  coverageGatePct: number;
  minSectionSizeForClassBest: number;
  showClassBest: boolean;
  showFees: boolean;

  // --- the calendar (D-#398) ------------------------------------------------
  /** Day of the following month the first revision is generated on. */
  draftDay: number;
  /** Nightly recompute stays open through this day of the following month. */
  revisionWindowDays: number;
  /** Hard lock; after this only the Principal may reopen, with a reason. */
  hardLockDays: number;

  updatedByUserId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MonthlyReportConfigSchema = new Schema<IMonthlyReportConfig>(
  {
    key: { type: String, required: true, unique: true, default: "SINGLETON" },

    attendanceThresholdPp: { type: Number, required: true, min: 0, max: 100 },
    attendanceMinDays: { type: Number, required: true, min: 1 },
    homeworkThresholdPp: { type: Number, required: true, min: 0, max: 100 },
    homeworkMinSheets: { type: Number, required: true, min: 1 },
    assignmentThresholdPp: { type: Number, required: true, min: 0, max: 100 },
    assignmentMinItems: { type: Number, required: true, min: 1 },
    qualityThresholdPp: { type: Number, required: true, min: 0, max: 100 },
    qualityMinChecked: { type: Number, required: true, min: 1 },
    classTestThresholdPp: { type: Number, required: true, min: 0, max: 100 },
    classTestMinTests: { type: Number, required: true, min: 1 },
    concernThreshold: { type: Number, required: true, min: 1 },
    resubmissionThreshold: { type: Number, required: true, min: 1 },
    resubmissionMinIssued: { type: Number, required: true, min: 1 },

    absentStreakFlag: { type: Number, required: true, min: 1 },
    absentUncoveredFlag: { type: Number, required: true, min: 1 },

    coverageGatePct: { type: Number, required: true, min: 0, max: 100 },
    minSectionSizeForClassBest: { type: Number, required: true, min: 1 },
    showClassBest: { type: Boolean, required: true },
    showFees: { type: Boolean, required: true },

    draftDay: { type: Number, required: true, min: 1, max: 28 },
    revisionWindowDays: { type: Number, required: true, min: 1, max: 28 },
    hardLockDays: { type: Number, required: true, min: 1, max: 28 },

    updatedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const MonthlyReportConfig = model<IMonthlyReportConfig>(
  "MonthlyReportConfig",
  MonthlyReportConfigSchema,
);
