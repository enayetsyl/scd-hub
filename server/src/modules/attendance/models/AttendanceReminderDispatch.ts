import { Schema, model, Document, Types } from "mongoose";
import { ATTENDANCE_REMINDER_TIERS } from "@scd/shared";

/**
 * AttendanceReminderDispatch (AT-4 / AT4.6, D-#65) — the idempotency ledger for
 * the timed reminder + escalation engine. ONE row per (dateKey, tier, sectionId):
 * its existence means "this section's reminder for this tier was already sent
 * today", so the external scheduler can hit the endpoint repeatedly and the
 * server re-sends NOTHING extra (the server owns *what*, the scheduler owns
 * *when*). Append-only audit of the actual sends lives in `Audit`
 * (ATTENDANCE_REMINDER_SENT); this is the dedupe key, not the audit trail.
 *
 * Identity-plane (ADR-005) — no corpus path.
 */
export interface IAttendanceReminderDispatch extends Document {
  _id: Types.ObjectId;
  dateKey: string;
  tier: (typeof ATTENDANCE_REMINDER_TIERS)[number];
  sectionId: Types.ObjectId;
  /** Recipients the push targeted (for audit/debug — not identity-sensitive). */
  recipientUserIds: Types.ObjectId[];
  /** Active device tokens the push reached at send time. */
  deviceCount: number;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceReminderDispatchSchema = new Schema<IAttendanceReminderDispatch>(
  {
    dateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    tier: { type: String, enum: ATTENDANCE_REMINDER_TIERS, required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    recipientUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    deviceCount: { type: Number, default: 0 },
    sentAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// The idempotency key: one dispatch per section per tier per day (AT4.6).
AttendanceReminderDispatchSchema.index(
  { dateKey: 1, tier: 1, sectionId: 1 },
  { unique: true },
);

export const AttendanceReminderDispatch = model<IAttendanceReminderDispatch>(
  "AttendanceReminderDispatch",
  AttendanceReminderDispatchSchema,
);
