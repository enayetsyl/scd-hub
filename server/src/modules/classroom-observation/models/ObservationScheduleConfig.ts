import { Schema, model, Document, Types } from "mongoose";

/**
 * ObservationScheduleConfig (CO-6) — the admin-tunable cadence for the review
 * SCHEDULER (the "due for review" suggestion list). At most ONE row (a
 * `key: "SINGLETON"` document); a missing row falls back to the working defaults in
 * `DEFAULT_SCHEDULE_CONFIG` (ObservationScheduleService) — read-time defaults, NEVER
 * seeded by a startup/bulk write against the shared live DB (D-#97). Mirrors the CO-3
 * ObservationEscalationConfig singleton shape.
 *
 * Fields:
 *   baseIntervalDays            — the DEVELOPING (base) review interval in days
 *                                 (default 30).
 *   strongMultiplier            — STRONG-tier multiplier (longest cadence; default 2).
 *   developingMultiplier        — DEVELOPING-tier multiplier (base; default 1).
 *   needsSupportMultiplier      — NEEDS_SUPPORT-tier multiplier (shortest cadence;
 *                                 default 0.5).
 *   frequencyCapDays            — guardrail: the minimum days between suggested reviews;
 *                                 the per-tier interval is FLOORED by this (default 14).
 *
 * Edited in-app via `setObservationScheduleConfig` (observation:manage). The scheduler
 * NEVER assigns/creates an observation — this only tunes the suggestion interval.
 *
 * Identity/operational plane — no corpus path (ADR-005).
 */
export interface IObservationScheduleConfig extends Document {
  _id: Types.ObjectId;
  /** Always "SINGLETON" — at most one config row. */
  key: string;
  baseIntervalDays: number;
  strongMultiplier: number;
  developingMultiplier: number;
  needsSupportMultiplier: number;
  frequencyCapDays: number;
  createdAt: Date;
  updatedAt: Date;
}

const ObservationScheduleConfigSchema = new Schema<IObservationScheduleConfig>(
  {
    key: { type: String, required: true, unique: true, default: "SINGLETON" },
    baseIntervalDays: { type: Number, required: true, min: 1 },
    strongMultiplier: { type: Number, required: true, min: 0 },
    developingMultiplier: { type: Number, required: true, min: 0 },
    needsSupportMultiplier: { type: Number, required: true, min: 0 },
    frequencyCapDays: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

export const ObservationScheduleConfig = model<IObservationScheduleConfig>(
  "ObservationScheduleConfig",
  ObservationScheduleConfigSchema,
);
