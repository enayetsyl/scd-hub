import { Schema, model, Document, Types } from "mongoose";

/**
 * RevisionEscalationConfig (SR-2, D-#245) — the admin-tunable consecutive-absence
 * threshold for the Saturday-revision escalation. At most ONE row (`key: "SINGLETON"`);
 * a missing row falls back to the working default in `RevisionDeliveryService`
 * (`DEFAULT_ABSENCE_THRESHOLD = 2`) — read-time defaults, NEVER seeded by a startup/
 * bulk write against the shared live DB (D-#97). Edited in-app via
 * `setRevisionEscalationConfig` (message:dispatch + Principal/Office).
 *
 * Identity/operational plane — no corpus path (ADR-005).
 */
export interface IRevisionEscalationConfig extends Document {
  _id: Types.ObjectId;
  /** Always "SINGLETON" — at most one config row. */
  key: string;
  /** N consecutive QURAN_ONLY-Saturday absences that trigger the escalation (default 2). */
  consecutiveAbsenceThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

const RevisionEscalationConfigSchema = new Schema<IRevisionEscalationConfig>(
  {
    key: { type: String, required: true, unique: true, default: "SINGLETON" },
    consecutiveAbsenceThreshold: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

export const RevisionEscalationConfig = model<IRevisionEscalationConfig>(
  "RevisionEscalationConfig",
  RevisionEscalationConfigSchema,
);
