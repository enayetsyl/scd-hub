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
  | "ROUTINE_SLOT_REVISED"  // a routine cell edited — old row closed, replacement opened (D-#47(3))
  | "ROUTINE_SLOT_RETIRED"  // a routine cell removed from the timetable (retired, or deleted if unstarted)
  | "SCOPE_GRANT_ASSIGN"
  | "SCOPE_GRANT_REVOKE"
  | "SCOPE_GRANT_EXTEND"
  | "PROXY_EXPIRED"       // stamped at request-time on first denied-after-expiry (D-#21)
  | "REVIEW_ASSIGNED"     // plan-review round assigned to a teacher (D-#39)
  | "REVIEW_SUBMITTED"    // reviewer submitted a verdict + feedback (D-#38)
  | "REVIEW_CANCELLED"    // an open review round was cancelled/superseded (D-#40)
  | "REVIEW_CONDITION_CLEARED" // a question's APPROVE_WITH_CONDITION hold was cleared and
                              // sent back to the same reviewer for another round (D-#525)
  | "PLAN_APPROVED"       // Principal sign-off: reviewed → gold (D-#38; PR-2)
  | "QUESTION_PUBLISHED"  // Principal publish: a question reaches the teachers' shelf (D-#508)
  // Question corrections (D-#548). meta carries the qid, WHICH fields moved, and their
  // before/after values — question content is curriculum, not identity, so unlike the D-#526
  // staff posture the values themselves are the point: "who changed what, when".
  | "QUESTION_EDITED"     // content/answer corrected in place by Principal or Office
  | "QUESTION_RETIRED"    // soft-deleted: hidden from bank/picker/assembly, sets still resolve
  | "QUESTION_RESTORED"   // a retirement undone
  // The IMPORTANT mark (QR-9, D-#550). meta.viaReviewQueue separates a reviewer working
  // her own queue from a desk mark, because the two reach the mutation by different gates.
  | "QUESTION_MARKED_IMPORTANT"   // raised: normal → important
  | "QUESTION_UNMARKED_IMPORTANT" // lowered back to the usual state
  // Book production (SB-1, D-#403–#428). SECURITY log only — who did what. The
  // EDITORIAL "why" lives in the book plane's own BookEvent (D-#411); the two answer
  // different questions and neither is derivable from the other.
  | "BOOK_CREATED"          // a support book or storybook was created (book:manage)
  | "BOOK_POLICY_ACTIVATED" // a new governance-document version was activated (D-#403)
  | "BOOK_PATCH_MERGED"     // a lesson patch passed the validator and merged wholesale
  | "BOOK_PATCH_REJECTED"   // a lesson patch was refused by the validator (stored, not merged)
  | "BOOK_REVIEW_ASSIGNED"   // a review round opened on a পাঠ (SB-3)
  | "BOOK_REVIEW_SUBMITTED"  // a reviewer submitted a verdict + checklist
  | "BOOK_ESCALATION_RESOLVED" // a senior reviewer closed an escalation with a ruling
  | "BOOK_COMMENT_RESOLVED"    // a per-item review note was marked dealt with (D-#440)
  | "BOOK_LESSON_SIGNED_OFF"   // the content sign-off was recorded on a পাঠ
  | "BOOK_BUILD_QUEUED"        // a render was queued (SB-4); `forced` records a gate override
  | "STAFF_PROFILE_CREATED"  // an HR staff record created from the app (D-#526)
  | "STAFF_PROFILE_UPDATED"  // an HR staff record edited from the app; meta lists WHICH
                             // fields moved, never their values (NID/bank live here)
  | "CREDENTIAL_PROVISIONED" // login generated/reset for a guardian or staff member (D-#59/#60)
  | "SECTIONS_MERGED"     // a class's gender sections combined into one (D-#62)
  | "SECTIONS_SPLIT"      // a merged class split back to its source sections (D-#62)
  | "ACADEMIC_YEAR_CREATED"     // a new academic year added (Principal/Office)
  | "ACADEMIC_YEAR_SET_CURRENT" // the active academic year switched (operational screens default to it)
  | "ATTENDANCE_IMPORTED"        // teacher Excel snapshot committed for a date (AT1.5, D-#63)
  | "ATTENDANCE_MARKED"          // a section's student-attendance day written/amended (AT2.3, D-#63)
  | "ATTENDANCE_MARKER_ASSIGNED" // marker override assigned/revoked on a section (AT2.1, D-#64)
  | "ATTENDANCE_REMINDER_SENT"   // a reminder/escalation tier dispatched (AT4.6, D-#65; engine = AT-4)
  | "LEAVE_APPLICATION_SUBMITTED" // student leave application recorded (AT3.1, D-#66)
  | "STAFF_LEAVE_ENTITLEMENT_SET" // staff leave allowance granted/edited per year (HR-2, prd-hr §3.1)
  | "STAFF_LEAVE_SUBMITTED"       // staff leave application recorded (HR-2, prd-hr H2.1)
  | "STAFF_LEAVE_DECIDED"         // staff leave approved/rejected/cancelled (HR-2, H2.3/H2.6)
  // --- Staff hub (SH-1..SH-4; docs/prd-staff-hub.md, D-#539–#545) -----------
  | "HR_POLICY_SET"               // the annual leave pool / lateness rule edited (SH-3, D-#539/#541)
  | "STAFF_LETTER_ISSUED"         // an appointment/confirmation/service letter issued (SH-1, D-#542)
  | "STAFF_LETTER_VOIDED"         // a letter voided — kept + renderable, superseded by a new ref no (SH-1, D-#542)
  | "STAFF_EMPLOYMENT_CONFIRMED"  // probation → confirmed, with the date the pool starts from (SH-2, D-#540)
  | "PROBATION_DEBT_SETTLED"      // held probation leave settled against the pool or the final salary (SH-3, D-#540)
  | "STAFF_LATENESS_CHARGED"      // a month's 3-lates-to-a-day reckoning written at payroll prepare (SH-4, D-#541)
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
  | "PRINT_REQUEST_CREATED"       // a teacher filed a print request (PQ-1, D-#281)
  | "PRINT_REQUEST_PRINTED"       // Office marked it printed (PQ-1, D-#281)
  | "PRINT_REQUEST_DELIVERED"     // Office handed it back to the requesting teacher (PQ-1, D-#281)
  | "PRINT_REQUEST_CANCELLED"     // requester (while REQUESTED) or Office withdrew it (PQ-1, D-#281)
  | "PRINT_REQUEST_REPRINTED"     // an already-printed job re-queued from the history, source reused (D-#362)
  | "PRINT_REQUEST_CLASS_TAGGED"  // a person named the class/subject a historical job was for (PQ-9, D-#392)
  | "CLASS_TEST_REQUESTED"        // a teacher filed a class-test print request (CT-1, §5/J1, D-#119)
  | "CLASS_TEST_PRINTED"          // Office marked printed → the official exam record (CT-1, §5/J2, D-#120)
  | "CLASS_TEST_CANCELLED"        // Office cancelled a withdrawn print request (CT-1, §5)
  | "CLASS_TEST_RESTORED"         // a retired (CANCELLED) exam put back on the boards
  | "CLASS_TEST_DETAILS_EDITED"   // total marks / pass mark / exam date corrected (refused once marks exist)
  | "CLASS_TEST_RESULT_ENTERED"   // a teacher entered/edited a student's class-test result — marks/Absent + weakness/actions (CT-2, §3.3/J3, D-#158)
  | "CLASS_TEST_RESULT_SUBMITTED" // teacher submitted an exam's results for Office/Principal approval (CT-8 approval gate)
  | "CLASS_TEST_RESULT_RECALLED"  // teacher recalled a pending submission back to draft (CT-8)
  | "CLASS_TEST_RESULT_SENT_BACK" // Office/Principal sent a submission back to the teacher with a reason (CT-8)
  | "CLASS_TEST_RESULT_PUBLISHED" // APPROVE: a student's / an exam's results released → guardian delivery (CT-3/CT-8, §5/J4, D-#160; publishedVersion bumped)
  | "CLASS_TEST_RESULT_UNPUBLISHED" // a student's / an exam's results unpublished — pulled from the guardian card (CT-3, §5/J4, D-#160)
  | "VOCAB_RESULT_RECORDED"       // a student's vocab marks recorded — attendance + per-position mistakes (VC-3, §3.6, D-#142)
  | "VOCAB_RESULT_MESSAGED"       // guardian vocab-result messages generated for a test — wa.me + emit() (VC-4, §8, D-#154)
  | "HW_FILE_ATTACHED"    // a question/answer file attached to homework (GP-A, D-#70)
  // A lifecycle REVERT is the one tracker action that leaves no trace on the record
  // itself: popActionGroup DELETES the popped stateDates stamps, so completed work
  // can silently return to "pending" with nothing to show it ever happened. These
  // two rows are the only evidence — they carry the popped states + the restored
  // state so "I marked it and it went back to pending" is answerable (D-#354).
  | "HW_RECORD_REVERTED"  // a homework student record's last action was undone (D-#338)
  | "AS_RECORD_REVERTED"  // an assignment student record's last action was undone (D-#338)
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
  | "CLASSROOM_OBSERVATION_REVIEWED"   // the assigned observer scored the observation → REVIEWED (observer/Principal-only since CO-8, D-#271)
  | "CLASSROOM_OBSERVATION_PUBLISHED"  // Principal/Office published a reviewed observation → released to the observed teacher (CO-8, D-#271)
  | "CLASSROOM_OBSERVATION_WITHHELD"   // Principal/Office recorded a decision NOT to publish a reviewed observation, with a reason (CO-12, D-#369)
  | "CLASSROOM_OBSERVATION_HOLD_LIFTED" // a withhold was lifted → back into the awaiting-publish queue (CO-12, D-#369)
  | "CLASSROOM_OBSERVATION_CANCELLED"  // Principal/Office called off a planned (UPLOADED/ASSIGNED) review, with a reason (CO-15, D-#428)
  | "CLASSROOM_OBSERVATION_RESTORED"   // a cancel was undone → the row returns to its same state + observer (CO-15, D-#428)
  | "OBSERVATION_ROTA_SAVED"          // a generated review rota was accepted and stored (CO-14, D-#426) — creates NO assignments
  | "CLASSROOM_OBSERVATION_SUPERSEDED" // a re-review superseded a prior observation (CO-1, §5, D-#194)
  | "CLASSROOM_OBSERVATION_RESPONDED"  // the observed teacher acknowledged a released observation → TEACHER_RESPONDED (CO-3)
  | "OBSERVATION_REVIEW_RATED"         // the observed teacher rated the review's fairness/usefulness (CO-7, observation:read)
  | "CLASSROOM_OBSERVATION_ESCALATED"  // the response ladder flagged a still-unanswered observation to the Principal (CO-3)
  | "OBSERVATION_ESCALATION_CONFIG_SET" // an admin edited the response-escalation cadence thresholds (CO-3, observation:manage)
  | "OBSERVATION_SCHEDULE_CONFIG_SET"   // an admin edited the review-scheduler cadence (base interval + per-tier multipliers, CO-6, observation:manage)
  | "SESSION_RECORDING_ADDED"          // CO-2 footage linked to an observation
  | "PARENT_MEETING_CREATED"    // an admin created a parents' meeting in draft (CM-3, §3/§6, D-#123)
  | "PARENT_MEETING_SLOTS_GENERATED" // per-family slots (re)generated wholesale for a meeting (CM-3, J-CM3, D-#175)
  | "PARENT_MEETING_SLOTS_REORDERED" // slots reordered / a family flagged On-Call → re-timed (CM-3, J-CM4, D-#123)
  | "PARENT_MEETING_SCHEDULED"  // a meeting dispatched (draft → scheduled) — timing notices fanned out (CM-4, §6/J-CM5, D-#176)
  | "MEETING_SLOT_ATTENDANCE_SET" // a family slot's present/absent captured at the meeting (CM-4, §6, D-#176)
  | "MEETING_COMMENT_SAVED"     // a class teacher saved a (student × meeting) positive+concern note (CM-5, §3/§6/J-CM6, D-#124)
  | "USER_ACCESS_CHANGED"   // Principal edited a staff User's per-user access — prior + new {templates, granted, revoked} retained here (Access Control AC-1, §6/J-AC6, D-#193/#214; ADR-008/D-#101 prior-state pattern)
  | "FINANCE_OPENING_BALANCE_SET" // an opening balance declared/re-declared for a ledger (effective-dated, append-only — Finance FIN-1, §3/J-FIN1-1, D-#222)
  | "FINANCE_POSTING_RECORDED"    // a finance money event (fee/income/expense/transfer) appended (Finance FIN-2A, §3.A/J-FIN2-1, D-#224)
  | "FINANCE_POSTING_REVERSED"    // a reversing posting appended against an original (a correction, never an edit/delete — FIN-2A, J-FIN2-2, D-#224)
  | "FEE_SUPPORT_ALLOCATION_SET"  // a zakat/3rd-party fee-support allocation declared/re-declared (effective-dated, append-only — Finance FIN-2B, §3.B, D-#226)
  | "PROVIDER_RECEIPT_RECORDED"   // a fee-support provider's payment against its receivable recorded (Finance FIN-2B, §3.B/J-FIN2-6)
  | "FINANCE_FEE_DUE_CHASED"      // the guardian fee-due chase run for a student/family (Finance FIN-2B, §6/J-FIN2-7, D-#227)
  | "FINANCE_PARTY_SET"           // a Qard/IOU counterparty master created/edited (Finance FIN-3, §3, D-#232)
  | "QARD_IOU_ENTRY_RECORDED"     // a Qard/IOU register movement (disburse/repay/adjust) appended (Finance FIN-3, §3/J-FIN3-1, D-#232)
  | "RECONCILIATION_RECORDED"     // a dated bank + Eximus reconciliation check recorded (append-only — Finance FIN-4, §3/J-FIN4-1, D-#235)
  | "BUDGET_LINE_SET"             // a per-(year × head) budget/target line set or edited — prior + new retained (Finance FIN-5, §3/J-FIN5-1, D-#237)
  | "SR_REVISION_RECORDED"        // a Saturday Hifz revision entry recorded/edited — per-juz records (Saturday-Revision SR-1, §3/J-SR1-1, D-#241/#242)
  | "SR_ENTRY_DELIVERED"          // a revision entry delivered to the family — absent alert / weekly digest, sealed (Saturday-Revision SR-2, §3/J-SR2-1/2/3, D-#244)
  | "SR_ABSENCE_ESCALATED"        // a consecutive-absence streak escalated to guardian + Principal (Saturday-Revision SR-2, §3/J-SR2-4, D-#245)
  | "SR_ESCALATION_CONFIG_SET"    // the consecutive-absence threshold edited (Saturday-Revision SR-2, message:dispatch)
  | "HOMEWORK_SUPERVISOR_SET"     // a school-wide homework supervisor toggled on/off (roster:manage)
  | "VIDEO_REVIEW_ASSIGNED"       // a class-session YouTube video logged + assigned to a teacher (owner ask 2026-07-20; observation:upload)
  | "VIDEO_REVIEW_REVIEWED"       // the assigned teacher's OK / NOT_OK-with-comment verdict (observation:review)
  | "CT_QUESTION_REQUESTED"       // a subject teacher asked the office to produce a class-test question paper (owner ask 2026-07-20; tracker:write)
  | "CT_QUESTION_SENT_FOR_REVIEW" // the office uploaded a paper round and sent it for teacher review (roster:manage)
  | "CT_QUESTION_REVIEWED"        // the teacher's verdict on a round — approve (locks) or changes-requested with comment (tracker:write)
  | "ENGLISH_DRIVE_UPLOADED"      // an English Drive md document uploaded — new (class, block, kind) (D-#344; roster:manage)
  | "ENGLISH_DRIVE_REPLACED"      // a newer version replaced an existing (class, block, kind) doc — old row stamped replacedAt (D-#344)
  | "TEACHING_NOTE_UPLOADED"      // a teaching note uploaded — new (class, subject, kind, seq) (TN-1, D-#519; roster:manage)
  | "TEACHING_NOTE_REPLACED"      // a newer version replaced an existing teaching note — old row stamped replacedAt, retained (TN-1, D-#522)
  | "TEACHING_NOTE_COMMENTED"     // a teacher left an improvement comment on a teaching note (TN-2, D-#520)
  | "TEACHING_NOTE_COMMENT_ADDRESSED" // a comment marked ADDRESSED (or reopened) by the uploader / P/O (TN-2, D-#520)
  | "TEACHING_NOTE_COMMENT_DELETED"   // a comment soft-deleted by its author or P/O (TN-2)
  | "ASSIGNMENT_ITEM_EDITED"      // a delivered assignment was edited after the fact (D-#353)
  | "ASSIGNMENT_ITEM_DELETED"     // a still-DRAFT delivered assignment was deleted (D-#353)
  | "MONTHLY_REPORT_CONFIG_SET"    // Principal edited the monthly-report thresholds / gate / calendar — prior + new retained (MR-2, D-#395)
  | "MONTHLY_REPORT_RELEASED"      // a monthly report revision released to the family, individually or in a batch (MR-3, D-#397)
  | "MONTHLY_REPORT_RERELEASED"    // a LATER revision released over one the family had already seen (MR-3, D-#393)
  | "MONTHLY_REPORT_REVOKED"       // a released report withdrawn — guardian access removed (Principal only, MR-3, D-#397)
  | "MONTHLY_REPORT_GATE_OVERRIDDEN" // the coverage block overridden with a reason (Principal only, MR-3, D-#394)
  | "MONTHLY_REPORT_UNLOCKED"      // a hard-locked month reopened with a reason (Principal only, MR-3, D-#398)
  | "MONTHLY_COMMENTS_EXPORTED"    // de-identified comment pack streamed for Desktop authoring (MR-8, D-#415)
  | "MONTHLY_COMMENTS_IMPORTED"    // a comment envelope pasted back — counts + per-row refusals in meta (MR-8, D-#415)
  // Answer-script archive (AR-1..AR-3, prd-script-archive §5/§7, D-#443–#447)
  | "SCRIPT_BUNDLE_FILED"          // a test's scripts filed into a box (teacher tracker:write / Office roster:manage)
  | "SCRIPT_BUNDLE_ACKNOWLEDGED"   // the ONE office acknowledgement stamped (additive, D-#444)
  | "SCRIPT_BUNDLE_CHECKED_OUT"    // desk handed a bundle out — borrower + purpose in meta (Office only)
  | "SCRIPT_BUNDLE_CHECKED_IN"     // bundle returned to a box (optionally re-boxed)
  | "SCRIPT_BUNDLE_DISPOSED"       // outside-retention bundle disposed with a reason (D-#446; shred AFTER this row)
  | "SCRIPT_BUNDLE_VOIDED"         // a filed-in-error bundle voided — record kept, unique slot freed
  | "STORAGE_BOX_CHANGED"          // box create/update/retire — prior+new in meta (the LIBRARY_CATALOG_CHANGED pattern)
  // Exam syllabus (SY-1..SY-6, docs/prd-exam-syllabus.md §6/§7, D-#530–#532)
  | "EXAM_CREATED"                    // an exam row created (exam:manage)
  | "EXAM_UPDATED"                    // an exam's name/date window edited; meta lists WHICH fields moved, never their values (the D-#526 posture)
  | "EXAM_SYLLABUS_SAVED"             // Office wrote/edited a syllabus row — prose, mark rows, question types
  | "EXAM_SYLLABUS_SUBMITTED"         // sent to the named SUBJECT TEACHER for sign-off (approverUserId in meta)
  | "EXAM_SYLLABUS_TEACHER_APPROVED"  // the subject teacher signed it off (D-#533)
  | "EXAM_SYLLABUS_TEACHER_BYPASSED"  // the Principal signed off IN THE TEACHER'S PLACE — no routine holder (§7.2).
                                      // A DISTINCT kind on purpose: folding it into _TEACHER_APPROVED would make the
                                      // stage decorative the first time it was inconvenient, and leave no way to ask
                                      // afterwards which sign-offs a teacher actually gave.
  | "EXAM_SYLLABUS_SENT_BACK"         // teacher or Principal returned it to DRAFT with a mandatory reason
  | "EXAM_SYLLABUS_REOPENED"          // a content edit cleared an existing teacher approval (§7.3, the D-#520 rule)
  | "EXAM_SYLLABUS_PUBLISHED"         // Principal published — publishedAt set, guardians can now read it
  | "EXAM_CLASS_NOTE_SAVED"            // the per-class question-type footer written/updated (§5.5)
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
