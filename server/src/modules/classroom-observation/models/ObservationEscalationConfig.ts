import { Schema, model, Document, Types } from "mongoose";

/**
 * ObservationEscalationConfig (CO-3) — the admin-tunable escalation cadence for the
 * teacher-response ladder on a RELEASED (REVIEWED) classroom observation. At most ONE
 * row (a `key: "SINGLETON"` document); a missing row falls back to the working
 * defaults in `DEFAULT_ESCALATION_CONFIG` (ObservationEscalationService) — read-time
 * defaults, NEVER seeded by a startup/bulk write against the shared live DB (D-#97).
 *
 * The three thresholds are CALENDAR days since the observation was released:
 *   reminderDays1     — 1st reminder to the observed teacher (default 2)
 *   reminderDays2     — 2nd reminder to the observed teacher (default 4)
 *   principalFlagDays — flag to the Principal (default 7)
 * Edited in-app via `setObservationEscalationConfig` (observation:manage).
 *
 * Identity/operational plane — no corpus path (ADR-005).
 */
export interface IObservationEscalationConfig extends Document {
  _id: Types.ObjectId;
  /** Always "SINGLETON" — at most one config row. */
  key: string;
  reminderDays1: number;
  reminderDays2: number;
  principalFlagDays: number;
  createdAt: Date;
  updatedAt: Date;
}

const ObservationEscalationConfigSchema = new Schema<IObservationEscalationConfig>(
  {
    key: { type: String, required: true, unique: true, default: "SINGLETON" },
    reminderDays1: { type: Number, required: true, min: 1 },
    reminderDays2: { type: Number, required: true, min: 1 },
    principalFlagDays: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

export const ObservationEscalationConfig = model<IObservationEscalationConfig>(
  "ObservationEscalationConfig",
  ObservationEscalationConfigSchema,
);
