import { Schema, model, Document, Types } from "mongoose";

/**
 * CT-RC — the unusual-mark recheck thresholds (owner 2026-11-10: "keep the
 * configuration option for changing the % range"). ONE singleton row; read-time
 * defaults while it does not exist (the D-#97 pattern — never seeded).
 *
 * Every percent here is a DIFFERENCE IN PERCENTAGE POINTS of the test's total, so it
 * reads the same on a 20-mark test (1 mark = 5%) and on any other total.
 */
export interface IClassTestRecheckSettings extends Document {
  _id: Types.ObjectId;
  key: "singleton";
  /** Off = no flags anywhere; submit and approve behave as before. */
  enabled: boolean;
  /** R1: flag when this test is at least this many % ABOVE the student's average. */
  highPct: number;
  /** R2: flag when this test is at least this many % BELOW the student's average. */
  lowPct: number;
  /** R3: full marks are flagged while the student's average is under this %. */
  fullMarksBelowPct: number;
  /** R4: flag the whole test when the class average is this many % above the class's usual. */
  classHighPct: number;
  /** Fewer earlier tests than this in the subject → fall back to the all-subject average. */
  minPriorTests: number;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_CT_RECHECK_SETTINGS = {
  enabled: true,
  highPct: 20,
  lowPct: 20,
  fullMarksBelowPct: 85,
  classHighPct: 15,
  minPriorTests: 3,
} as const;

const ClassTestRecheckSettingsSchema = new Schema<IClassTestRecheckSettings>(
  {
    key: { type: String, required: true, default: "singleton" },
    enabled: { type: Boolean },
    highPct: { type: Number, min: 5, max: 100 },
    lowPct: { type: Number, min: 5, max: 100 },
    fullMarksBelowPct: { type: Number, min: 0, max: 100 },
    classHighPct: { type: Number, min: 5, max: 100 },
    minPriorTests: { type: Number, min: 1, max: 20 },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

ClassTestRecheckSettingsSchema.index({ key: 1 }, { unique: true });

export const ClassTestRecheckSettings = model<IClassTestRecheckSettings>(
  "ClassTestRecheckSettings",
  ClassTestRecheckSettingsSchema,
);
