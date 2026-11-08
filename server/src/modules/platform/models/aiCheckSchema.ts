import { Schema } from "mongoose";

/**
 * The AI comment-check stamp (AI-5, D-#1095) — stored on `StudentComment` and on
 * `ClassTestResult`. It holds NO text: no prompt, no suggestion, only what the analytics
 * need (AI-7) and what "why did it say this" needs (the policy hash).
 *
 *   CHECKED      the teacher ran the check on this text (or saved right after it)
 *   NOT_CHECKED  the checker was switched on but this text went unchecked — the teacher
 *                chose not to wait, or the AI was down / capped / refused (D-#1100); the
 *                Principal sees the count
 * Absent = the checker was switched off when the text was saved.
 */
export const AI_CHECK_STATUSES = ["CHECKED", "NOT_CHECKED"] as const;
export type AiCheckStatus = (typeof AI_CHECK_STATUSES)[number];

export interface IAiCheck {
  status: AiCheckStatus;
  /** NOT_CHECKED only: SKIPPED · FEATURE_OFF · NO_STANDARD · CAPPED · AI_ERROR · NAMES_LEFT. */
  reason?: string;
  policyHash?: string;
  model?: string;
  issuesFound?: number;
  issuesAccepted?: number;
  /** True when the teacher sent their own text although the AI found issues. */
  teacherOverrode?: boolean;
  checkedAt?: Date;
}

export const AiCheckSchema = new Schema<IAiCheck>(
  {
    status: { type: String, required: true, enum: AI_CHECK_STATUSES },
    reason: { type: String },
    policyHash: { type: String },
    model: { type: String },
    issuesFound: { type: Number, min: 0 },
    issuesAccepted: { type: Number, min: 0 },
    teacherOverrode: { type: Boolean },
    checkedAt: { type: Date },
  },
  { _id: false },
);
