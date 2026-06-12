import { Schema, model, Document, Types } from "mongoose";

/** Audit event kinds tracked in the access/security log (ADR-008, R-AC7). */
export type AuditEventKind =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAIL"
  | "CONTENT_READ"
  | "CONTENT_IMPORT"
  | "SET_ASSEMBLE"
  | "TRACKER_WRITE"
  | "ROSTER_MANAGE"
  | "GUARDIAN_LINK"
  | "SCOPE_GRANT_ASSIGN"
  | "SCOPE_GRANT_REVOKE"
  | "SCOPE_GRANT_EXTEND"
  | "PROXY_EXPIRED"       // stamped at request-time on first denied-after-expiry (D-#21)
  | "REVIEW_ASSIGNED"     // plan-review round assigned to a teacher (D-#39)
  | "REVIEW_SUBMITTED"    // reviewer submitted a verdict + feedback (D-#38)
  | "REVIEW_CANCELLED"    // an open review round was cancelled/superseded (D-#40)
  | "PLAN_APPROVED"       // Principal sign-off: reviewed → gold (D-#38; PR-2)
  | "CREDENTIAL_PROVISIONED" // login generated/reset for a guardian or staff member (D-#59/#60)
  | "SECTIONS_MERGED"     // a class's gender sections combined into one (D-#62)
  | "SECTIONS_SPLIT"      // a merged class split back to its source sections (D-#62)
  | "HW_FILE_ATTACHED"    // a question/answer file attached to homework (GP-A, D-#70)
  | "PERMISSION_DENIED";

export interface IAudit extends Document {
  _id: Types.ObjectId;
  eventKind: AuditEventKind;
  actorId?: Types.ObjectId;
  actorRole?: string;
  targetId?: Types.ObjectId;
  targetKind?: string;
  /** ISO timestamp of the event. Populated by the server — never user-supplied. */
  eventAt: Date;
  /** For PROXY_EXPIRED: the nominal window-end (start_date + duration_days). */
  windowEndedAt?: Date;
  meta?: Record<string, unknown>;
}

const AuditSchema = new Schema<IAudit>(
  {
    eventKind: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId },
    actorRole: { type: String },
    targetId: { type: Schema.Types.ObjectId },
    targetKind: { type: String },
    eventAt: { type: Date, required: true, default: () => new Date() },
    windowEndedAt: { type: Date },
    meta: { type: Schema.Types.Mixed },
  },
  {
    // No updatedAt — audit rows are append-only; never edited (ADR-008)
    timestamps: false,
    // Disable Mongoose automatic _id versioning to keep rows lean
    versionKey: false,
  },
);

AuditSchema.index({ actorId: 1, eventAt: -1 });
AuditSchema.index({ eventKind: 1, eventAt: -1 });

export const Audit = model<IAudit>("Audit", AuditSchema);
