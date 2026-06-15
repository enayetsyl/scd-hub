import { Schema, model, Document, Types } from "mongoose";

/**
 * ObservationScheduleConfig (CO-6, prd-classroom-observation §CO-6) — the admin-tunable
 * review-cadence for the "due for review" scheduler. At most ONE row (a
 * `key: "SINGLETON"` document); a missing row falls back to the working defaults in
 * `DEFAULT_SCHEDULE_CONFIG` (ClassroomObservationSchedulerService) — read-time defaults,
 * NEVER seeded by a startup/bulk write against the shared live DB (D-#97, the CO-3
 * ObservationEscalationConfig precedent).
 *
 * The cadence is tier-driven (SUPPORT_TIERS): DEVELOPING reviews on the `baseIntervalDays`
 * interval; STRONG stretches it by `strongMultiplier` (≥1 → longest); NEEDS_SUPPORT
 * shortens it by `needsSupportMultiplier` (≤1 → shortest). `minIntervalDays` is the
 * frequency-cap guardrail (§CO-6) — a teacher is never suggested more often than this,
 * however short the tiered interval works out.
 *
 * Edited in-app via `setObservationScheduleConfig` (observation:manage).
 * Identity/operational plane — no corpus path (ADR-005).
 */
export interface IObservationScheduleConfig extends Document {
  _id: Types.ObjectId;
  /** Always "SINGLETON" — at most one config row. */
  key: string;
  /** The DEVELOPING (base) review interval, in calendar days. */
  baseIntervalDays: number;
  /** STRONG interval = base × this (≥1 → longest cadence). */
  strongMultiplier: number;
  /** NEEDS_SUPPORT interval = base × this (≤1 → shortest cadence). */
  needsSupportMultiplier: number;
  /** Frequency cap (calendar days): never suggest a teacher more often than this. */
  minIntervalDays: number;
  createdAt: Date;
  updatedAt: Date;
}

const ObservationScheduleConfigSchema = new Schema<IObservationScheduleConfig>(
  {
    key: { type: String, required: true, unique: true, default: "SINGLETON" },
    baseIntervalDays: { type: Number, required: true, min: 1 },
    strongMultiplier: { type: Number, required: true, min: 1 },
    needsSupportMultiplier: { type: Number, required: true, min: 0 },
    minIntervalDays: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

export const ObservationScheduleConfig = model<IObservationScheduleConfig>(
  "ObservationScheduleConfig",
  ObservationScheduleConfigSchema,
);
