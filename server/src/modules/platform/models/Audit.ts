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
  | "OBSERVATION_SUBMITTED"       // a performance observation submitted (supervisor or admin, HR-4, H5.1/H5.2, D-#28)
  | "APPRAISAL_PREPARED"          // an annual appraisal created/edited in draft (Office/Principal, HR-4, H5.1)
  | "APPRAISAL_SIGNED_OFF"        // Principal sign-off: outcome set + development needs emitted to CPD (HR-4, H5.2)
  | "CONDUCT_STEP_RECORDED"       // a conduct-ladder step raised in draft (HR-4, H5.3, D-#113)
  | "CONDUCT_HEARING_RECORDED"    // the person's response/hearing captured before finalisation ('adl, HR-4, H5.3)
  | "CONDUCT_STEP_FINALIZED"      // a conduct step finalised — the disciplinary judgement (Principal, HR-4, H5.3)
  | "CONDUCT_WARNING_LAPSED"      // a finalised warning lapsed past liveUntil — stays on file (lazy, HR-4, H5.3/D-#113)
  | "STAFF_TERMINATED"            // a termination step finalised → employmentStatus terminated (HR-4 → offboarding HR-5)
  | "GRIEVANCE_RAISED"            // a staff member raised a confidential grievance (HR-4, H5.4)
  | "GRIEVANCE_UPDATED"           // a grievance moved/resolved/closed by Principal/Office (HR-4, H5.4)
  | "DEVELOPMENT_LOGGED"          // a CPD development-log entry added (HR-4, H5.4)
  | "OFFBOARDING_INITIATED"       // an exit case opened → employmentStatus set (HR-5, H6.1, D-#117)
  | "OFFBOARDING_CLEARANCE_UPDATED" // a clearance checklist item set done/waived/pending (HR-5, H6.2)
  | "OFFBOARDING_ACCESS_REVOKED"  // the SYSTEM disabled the login + revoked all scope grants (HR-5, H6.3)
  | "FINAL_SETTLEMENT_COMPUTED"   // the hard-held final settlement was computed (HR-5, H6.4/D-#29)
  | "FINAL_SETTLEMENT_RELEASED"   // Principal released the settlement after clearance (HR-5, H6.4/D-#29)
  | "EXIT_INTERVIEW_RECORDED"     // optional exit interview captured (HR-5, H6.5)
  | "SERVICE_CERTIFICATE_ISSUED"  // a service/experience certificate issued (HR-5, H6.5)
  | "OFFBOARDING_CANCELLED"       // an exit was withdrawn before completion (HR-5, H6)
  | "VOCAB_WORD_ADDED"            // a word added to a program×classLevel word bank (VC-1, D-#104/#105/#126)
  | "VOCAB_WORD_UPDATED"          // a word's headword / Bangla meaning edited (VC-1)
  | "VOCAB_WORD_DEACTIVATED"      // a word deactivated or reactivated in the bank (VC-1)
  | "VOCAB_TEST_CREATED"          // a vocab test created in draft (VC-2, §3.3, D-#127)
  | "VOCAB_TEST_UPDATED"          // a vocab test's metadata edited — label/marks/half-miss/date (VC-2)
  | "VOCAB_TEST_POSITIONS_SET"    // positions auto-laid from selected words per direction (VC-2, §3.4)
  | "VOCAB_TESTER_ASSIGNED"       // weekly tester assigned to a (section × program) (VC-2, §3.5, roster:manage)
  | "CLASS_TEST_REQUESTED"        // a teacher filed a class-test print request (CT-1, §5/J1, D-#119)
  | "CLASS_TEST_PRINTED"          // Office marked printed → the official exam record (CT-1, §5/J2, D-#120)
  | "CLASS_TEST_CANCELLED"        // Office cancelled a withdrawn print request (CT-1, §5)
  | "CLASS_TEST_RESULT_ENTERED"   // a teacher entered/edited a student's class-test result — marks/Absent + weakness/actions (CT-2, §3.3/J3, D-#158)
  | "CLASS_TEST_RESULT_PUBLISHED" // a student's / an exam's results published → guardian delivery (CT-3, §5/J4, D-#160; publishedVersion bumped)
  | "CLASS_TEST_RESULT_UNPUBLISHED" // a student's / an exam's results unpublished — pulled from the guardian card (CT-3, §5/J4, D-#160)
  | "VOCAB_RESULT_RECORDED"       // a student's vocab marks recorded — attendance + per-position mistakes (VC-3, §3.6, D-#142)
  | "VOCAB_RESULT_MESSAGED"       // guardian vocab-result messages generated for a test — wa.me + emit() (VC-4, §8, D-#154)
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
  | "CHAT_ATTACHMENT_UPLOADED" // a chat attachment (image/pdf/video/audio) streamed to Drive (M-4, D-#108)
  | "CHAT_OVERSIGHT_OPENED" // Principal opened a conversation via chat:oversee read-override (M-6, D-#77/#111)
  | "NOTICE_SENT"         // a guardian notice composed + fanned out as wa.me links (M-6, D-#79/#111)
  | "MESSAGE_TEMPLATE_EDITED" // Principal edited/reset a generated-message template — prior body retained here (MT-1, D-#129; ADR-008)
  | "STUDENT_COMMENT_RECORDED" // a teacher recorded/edited a daily student comment — type/sentiment/text (CM-1, §3/§6/J-CM1, D-#115)
  | "STUDENT_COMMENT_DELIVERED" // a daily comment delivered to the family — wa.me + emit() inbox/push (CM-2, §6/J-CM1, D-#172)
  | "CLASSROOM_OBSERVATION_UPLOADED"   // Principal/Office uploaded a recorded session as an observation (CO-1, §5/J1, D-#194)
  | "CLASSROOM_OBSERVATION_ASSIGNED"   // a senior-teacher observer assigned to an observation (CO-1, §5/J1, D-#147)
  | "CLASSROOM_OBSERVATION_REVIEWED"   // the assigned observer scored+released the observation to the teacher (CO-1, §5/J2, D-#147)
  | "CLASSROOM_OBSERVATION_SUPERSEDED" // a re-review superseded a prior observation (CO-1, §5, D-#194)
  | "SESSION_RECORDING_ADDED"          // CO-2 footage linked to an observation
  | "PARENT_MEETING_CREATED"    // an admin created a parents' meeting in draft (CM-3, §3/§6, D-#123)
  | "PARENT_MEETING_SLOTS_GENERATED" // per-family slots (re)generated wholesale for a meeting (CM-3, J-CM3, D-#175)
  | "PARENT_MEETING_SLOTS_REORDERED" // slots reordered / a family flagged On-Call → re-timed (CM-3, J-CM4, D-#123)
  | "PARENT_MEETING_SCHEDULED"  // a meeting dispatched (draft → scheduled) — timing notices fanned out (CM-4, §6/J-CM5, D-#176)
  | "MEETING_SLOT_ATTENDANCE_SET" // a family slot's present/absent captured at the meeting (CM-4, §6, D-#176)
  | "MEETING_COMMENT_SAVED"     // a class teacher saved a (student × meeting) positive+concern note (CM-5, §3/§6/J-CM6, D-#124)
  | "USER_ACCESS_CHANGED"   // Principal edited a staff User's per-user access — prior + new {templates, granted, revoked} retained here (Access Control AC-1, §6/J-AC6, D-#193/#214; ADR-008/D-#101 prior-state pattern)
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
