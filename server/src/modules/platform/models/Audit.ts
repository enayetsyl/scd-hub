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
  | "ATTENDANCE_IMPORTED"        // teacher Excel snapshot committed for a date (AT1.5, D-#63)
  | "ATTENDANCE_MARKED"          // a section's student-attendance day written/amended (AT2.3, D-#63)
  | "ATTENDANCE_MARKER_ASSIGNED" // marker override assigned/revoked on a section (AT2.1, D-#64)
  | "ATTENDANCE_REMINDER_SENT"   // a reminder/escalation tier dispatched (AT4.6, D-#65; engine = AT-4)
  | "LEAVE_APPLICATION_SUBMITTED" // student leave application recorded (AT3.1, D-#66)
  | "STAFF_LEAVE_ENTITLEMENT_SET" // staff leave allowance granted/edited per year (HR-2, prd-hr §3.1)
  | "STAFF_LEAVE_SUBMITTED"       // staff leave application recorded (HR-2, prd-hr H2.1)
  | "STAFF_LEAVE_DECIDED"         // staff leave approved/rejected/cancelled (HR-2, H2.3/H2.6)
  | "STAFF_COVER_PROPOSED"        // a covering teacher proposed for a leave's cover slot (HR-2, D-#22)
  | "STAFF_COVER_DECIDED"         // cover slot approved (→ proxy grant) or returned to needs-cover (HR-2, D-#22)
  | "STAFF_PAY_SET"               // staff monthly salary / payment method set or edited (HR-3, prd-hr §4.1)
  | "PAYROLL_PREPARED"            // a monthly run computed/recomputed (Office, HR-3, H4.2)
  | "PAYROLL_APPROVED"            // a run approved + LOCKED by the Principal, advances decremented (HR-3, H4.2)
  | "PAYROLL_CANCELLED"           // a prepared run discarded before approval (HR-3)
  | "ADVANCE_ISSUED"              // a qard-hasan advance/loan issued (Principal-approved, HR-3, H4.5/D-#27)
  | "ADVANCE_SETTLED"             // an advance fully settled / written off (HR-3, H4.5)
  | "HW_FILE_ATTACHED"    // a question/answer file attached to homework (GP-A, D-#70)
  | "BOOK_ISSUED"         // library desk issued a copy to a borrower (LB-2, D-#81/#82)
  | "BOOK_RETURNED"       // copy returned at the desk (LB-2)
  | "BOOK_RENEWED"        // loan renewed (LB-2)
  | "BOOK_MARKED_LOST"    // loan settled as lost — replacement note, no money (LB-2, D-#27)
  | "RESERVATION_PLACED"  // title-level reservation queued (LB-3, D-#83)
  | "RESERVATION_EXPIRED" // a READY hold lapsed at request time (lazy expiry, D-#21/#83)
  | "LIBRARIAN_ASSIGNED"  // librarian duty assigned/revoked on a teacher (LB-1, D-#81)
  | "LIBRARY_CATALOG_CHANGED" // title/copy/policy catalog mutation (LB-1)
  | "CHAT_GROUP_CREATED"  // a CUSTOM ad-hoc group created by Principal/Office (M-2, D-#78)
  | "CHAT_MEMBERSHIP_CHANGED" // manual add/remove or an auto-provision resync (M-2, D-#78)
  | "MESSAGE_EDITED"      // sender edited own message — prior body retained here (M-3, D-#77; ADR-008)
  | "MESSAGE_DELETED"     // sender deleted own message — original body/attachment refs retained here (M-3, D-#77)
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
