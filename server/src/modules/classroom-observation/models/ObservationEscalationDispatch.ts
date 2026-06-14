import { Schema, model, Document, Types } from "mongoose";

/** The escalation ladder rungs (CO-3) — one fired ONCE per observation. */
export const OBSERVATION_ESCALATION_STAGES = ["REMINDER_1", "REMINDER_2", "PRINCIPAL_FLAG"] as const;
export type ObservationEscalationStage = (typeof OBSERVATION_ESCALATION_STAGES)[number];

/**
 * ObservationEscalationDispatch (CO-3) — the idempotency ledger for the
 * teacher-response escalation ladder (mirrors AttendanceReminderDispatch). ONE row
 * per (observationId, stage): its existence means "this rung already fired for this
 * observation", so the periodic driver can run repeatedly and re-emit NOTHING extra
 * (the driver owns *when*, this service owns *what*). The notification itself rides
 * the D-#72 emit() seam (kind-gated, own idempotency too); this is the per-rung dedupe.
 *
 * Identity/operational plane — no corpus path (ADR-005).
 */
export interface IObservationEscalationDispatch extends Document {
  _id: Types.ObjectId;
  observationId: Types.ObjectId;
  stage: ObservationEscalationStage;
  /** Recipients the rung targeted (for audit/debug — not identity-sensitive). */
  recipientUserIds: Types.ObjectId[];
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ObservationEscalationDispatchSchema = new Schema<IObservationEscalationDispatch>(
  {
    observationId: { type: Schema.Types.ObjectId, ref: "ClassroomObservation", required: true },
    stage: { type: String, enum: OBSERVATION_ESCALATION_STAGES, required: true },
    recipientUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    sentAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// The idempotency key: one dispatch per observation per ladder rung.
ObservationEscalationDispatchSchema.index({ observationId: 1, stage: 1 }, { unique: true });

export const ObservationEscalationDispatch = model<IObservationEscalationDispatch>(
  "ObservationEscalationDispatch",
  ObservationEscalationDispatchSchema,
);
