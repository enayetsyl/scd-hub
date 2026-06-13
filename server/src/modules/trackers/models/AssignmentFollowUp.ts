/**
 * AssignmentFollowUp — the Office follow-up ladder log (AS-T4, D-#88).
 *
 * APPEND-ONLY per ADR-008 (replaces the sheet's "Missing Submissions" +
 * "Guardian Messages" tabs): one row per escalation step taken on a chased
 * record. Step + message are immutable once written; the ONLY post-append
 * mutation is the outcome stamp (`sentStatus`/`outcome`/`sentAt` — the sheet's
 * Sent Status column), mirroring the notifications "append + markRead only"
 * posture. Rows are never edited otherwise and never deleted.
 *
 * Ladder (D-#88): steps 1–2 = in-app guardian notification (rides the D-#72
 * `emit()` seam; contact-only guardians and a not-yet-registered notification
 * kind leave the step SKIPPED — the recorded delivery-reality posture); step
 * 3+ = WhatsApp via the generated Bangla message + wa.me link, sent MANUALLY
 * by Office (ADR-003) and outcome-logged. CALL/OTHER are manual alternatives
 * at step 3+.
 *
 * The step/status vocabularies are module-level consts (English codes, Bangla
 * labels app-side): /shared/vocab.ts is owned by another in-flight session —
 * no vocab change rides this branch (PRD header: app-native additions only if
 * needed; not needed for server enums, HOMEWORK_ITEM_STATUSES precedent).
 *
 * Identity-bearing (student + guardian refs), operational plane only (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export const FOLLOWUP_STEPS = ["IN_APP_1", "IN_APP_2", "WHATSAPP", "CALL", "OTHER"] as const;
export type FollowUpStep = (typeof FOLLOWUP_STEPS)[number];

/** RECORDED = in-app inbox row(s) written; PENDING = manual send awaiting the
 *  outcome stamp; SENT/SKIPPED = the stamped outcomes. */
export const FOLLOWUP_SENT_STATUSES = ["RECORDED", "PENDING", "SENT", "SKIPPED"] as const;
export type FollowUpSentStatus = (typeof FOLLOWUP_SENT_STATUSES)[number];

export interface IAssignmentFollowUp extends Document {
  _id: Types.ObjectId;
  recordId: Types.ObjectId;
  asItemId: Types.ObjectId;
  asId: string;
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  /** 1-based position in this record's ladder (1 → IN_APP_1, 2 → IN_APP_2, 3+ → manual). */
  stepNumber: number;
  step: FollowUpStep;
  /** The generated Bangla guardian message (PRD §7 template). */
  messageBn: string;
  /** wa.me deep link (WHATSAPP step; null when the student has no phone on file). */
  waLink?: string;
  /** Login-enabled guardians whose inbox rows this step wrote (in-app steps). */
  notifiedGuardianIds: Types.ObjectId[];
  sentStatus: FollowUpSentStatus;
  /** Free text logged by Office at the outcome stamp. */
  outcome?: string;
  followUpDate: Date;
  sentAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AssignmentFollowUpSchema = new Schema<IAssignmentFollowUp>(
  {
    recordId: { type: Schema.Types.ObjectId, required: true },
    asItemId: { type: Schema.Types.ObjectId, required: true },
    asId: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    stepNumber: { type: Number, required: true, min: 1 },
    step: { type: String, enum: FOLLOWUP_STEPS, required: true },
    messageBn: { type: String, required: true },
    waLink: { type: String },
    notifiedGuardianIds: { type: [Schema.Types.ObjectId], default: [] },
    sentStatus: { type: String, enum: FOLLOWUP_SENT_STATUSES, required: true },
    outcome: { type: String },
    followUpDate: { type: Date, required: true },
    sentAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// One row per ladder position per record — a concurrent double-escalate loses.
AssignmentFollowUpSchema.index({ recordId: 1, stepNumber: 1 }, { unique: true });
AssignmentFollowUpSchema.index({ studentId: 1, followUpDate: -1 });

export const AssignmentFollowUp = model<IAssignmentFollowUp>(
  "AssignmentFollowUp",
  AssignmentFollowUpSchema,
);
