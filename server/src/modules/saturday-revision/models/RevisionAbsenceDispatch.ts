import { Schema, model, Document, Types } from "mongoose";

/**
 * RevisionAbsenceDispatch (SR-2, D-#245) — the idempotency ledger for the
 * consecutive-absence escalation (mirrors AttendanceReminderDispatch /
 * ObservationEscalationDispatch). ONE row per (studentId, streakLength): its existence
 * means "the escalation already fired for this student at this streak length", so a
 * re-delivery of the same absent entry re-escalates NOTHING (the threshold crossing
 * fires once — J-SR2-4). A longer streak later (e.g. 3 after 2) is a NEW key, so the
 * next threshold crossing escalates again.
 *
 * Identity/operational plane (names a studentId) — no corpus path (ADR-005).
 */
export interface IRevisionAbsenceDispatch extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  /** The consecutive-absence streak length that triggered this escalation. */
  streakLength: number;
  /** The Saturday whose delivery crossed the threshold (for audit/debug). */
  date: Date;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RevisionAbsenceDispatchSchema = new Schema<IRevisionAbsenceDispatch>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    streakLength: { type: Number, required: true, min: 1 },
    date: { type: Date, required: true },
    sentAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// The idempotency key: one escalation per student per streak length.
RevisionAbsenceDispatchSchema.index({ studentId: 1, streakLength: 1 }, { unique: true });

export const RevisionAbsenceDispatch = model<IRevisionAbsenceDispatch>(
  "RevisionAbsenceDispatch",
  RevisionAbsenceDispatchSchema,
);
