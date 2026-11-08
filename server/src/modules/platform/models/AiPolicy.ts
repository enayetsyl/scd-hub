import { Schema, model, Document, Types } from "mongoose";

/**
 * AiPolicy (AI-3, D-#1093) — the AI rules the Principal writes, kept as numbered VERSIONS.
 *
 * One document per (key, version). Saving never edits a version: it adds the next one,
 * so "why did the AI say this" stays answerable from the `policyHash` every AI result
 * carries. At most one version per key is `active`; with none active, the features that
 * read that key do not run (PRD §5.1 step 4: no check before an approved standard).
 *
 *   comment_standard     daily StudentComment checker (AI-5)
 *   ct_comment_standard  class-test comment checker (AI-5)
 *   assistant_rules      the teacher assistant (AI-6)
 */
export const AI_POLICY_KEYS = ["comment_standard", "ct_comment_standard", "assistant_rules"] as const;
export type AiPolicyKey = (typeof AI_POLICY_KEYS)[number];

export interface IAiPolicy extends Document {
  _id: Types.ObjectId;
  key: AiPolicyKey;
  version: number;
  /** Markdown; it is the stable prompt prefix, so it holds no dates, ids or names. */
  body: string;
  /** First 12 hex of sha256(body) — part of the policy hash. */
  bodyHash: string;
  /** Why this version was written (optional). */
  note?: string;
  active: boolean;
  /** Absent for a seeded draft. */
  createdBy?: Types.ObjectId;
  activatedAt?: Date;
  activatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AiPolicySchema = new Schema<IAiPolicy>(
  {
    key: { type: String, required: true, enum: AI_POLICY_KEYS },
    version: { type: Number, required: true, min: 1 },
    body: { type: String, required: true },
    bodyHash: { type: String, required: true },
    note: { type: String, trim: true, maxlength: 500 },
    active: { type: Boolean, required: true, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    activatedAt: { type: Date },
    activatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

AiPolicySchema.index({ key: 1, version: 1 }, { unique: true });
AiPolicySchema.index({ key: 1, active: 1 });

export const AiPolicy = model<IAiPolicy>("AiPolicy", AiPolicySchema);
