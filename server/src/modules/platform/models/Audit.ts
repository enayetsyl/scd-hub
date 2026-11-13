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
  | "LESSON_PLAN_QUESTION_SET" // the class note's lesson-plan question switched on/off (D-#952) — meta.on
  | "HOME_GUIDES_IMPORTED" // session home guides loaded for guardians (GH-4, D-#1528) — meta.created/updated/dryRun=false only
  | "SCOPE_GRANT_ASSIGN"
  | "SCOPE_GRANT_REVOKE"
  | "SCOPE_GRANT_EXTEND"
  | "PROXY_EXPIRED"       // stamped at request-time on first denied-after-expiry (D-#21)
  | "REVIEW_ASSIGNED"     // plan-review round assigned to a teacher (D-#39)
  | "REVIEW_SUBMITTED"    // reviewer submitted a verdict + feedback (D-#38)
  | "REVIEW_CANCELLED"    // an open review round was cancelled/superseded (D-#40)
  | "REVIEW_CONDITION_CLEARED" // a question's APPROVE_WITH_CONDITION hold was cleared and
                              // sent back to the same reviewer for another round (D-#525)
  | "REVIEW_REASSIGNED"   // untouched rounds changed hands wholesale — a chapter moved from
                          // one reviewer to another (QR-15, D-#650). meta names BOTH
                          // reviewers, the chapters and what was left behind as decided.
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
  | "QUESTION_EXAM_HELD"          // set aside for the exam papers (PR-I, D-#1408)
  | "QUESTION_EXAM_RELEASED"      // released back to the pickers
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
  | "YEAR_CHANGE_PREPARED"   // year change step 1: next-year classes/sections/PLANNED enrolments/admissions written (YC-4) - meta.runId + counts
  | "YEAR_CHANGE_CUT_OVER"   // year change step 2: children moved, current year flipped (YC-4) - meta.runId + before-state of every changed Student
  | "YEAR_CHANGE_PREPARE_UNDONE" // step 1 cancelled, every row of the run deleted (YC-4) - meta.runId + counts
  | "YEAR_CHANGE_CUT_OVER_UNDONE" // step 2 reversed from the audit before-state (YC-4) - meta.runId + work left on next-year sections
  | "YEAR_CHANGE_SECTIONS_RETIRED" // the past year's sections set inactive after the grace date (YC-4) - meta.yearId + counts
  | "ENROLMENT_MOVED"     // one child moved to another section from a date (YC-1 moveStudent); meta: from/to section, onKey
  | "ATTENDANCE_DAYS_COPIED" // a retired Quran/Arabic group's attendance days copied to the groups its children moved to (D-#865)
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
  | "STAFF_LETTER_SENT"           // an issued letter sent to the staff member's app by notification and/or pop-up (D-#902)
  | "SALARY_SENT_ANNOUNCED"       // a payment group of a locked run told its salary went out, by notification and/or pop-up (D-#915)
  | "STAFF_MISTAKE_EXPLAINED"     // a staff member gave the reason for a caught mistake (D-#937) — meta.kind/reasonCode/status
  | "STAFF_MISTAKE_DECIDED"       // a reviewer excused, counted or moved a caught mistake (D-#939) — meta.decision/movedToUserId
  | "STAFF_MISTAKE_SETTINGS_SET"  // the Principal changed the mistake rules (D-#1005) — meta.before/after
  | "STAFF_WARNING_REACHED"       // a person reached a warning-ladder rung (D-#940) — meta.staffUserId/step/weightedCount
  | "STAFF_WARNING_MEETING_SET"   // the face-to-face talk after a warning was booked (D-#941) — meta.at/place
  | "STAFF_WARNING_MEETING_RECORDED" // what was said and agreed at that talk (D-#941) — meta.followUpDateKey/sentSummary
  | "STAFF_EMPLOYMENT_CONFIRMED"  // probation → confirmed, with the date the pool starts from (SH-2, D-#540)
  | "PROBATION_DEBT_SETTLED"      // held probation leave settled against the pool or the final salary (SH-3, D-#540)
  | "STAFF_LATENESS_CHARGED"      // a month's 3-lates-to-a-day reckoning written at payroll prepare (SH-4, D-#541)
  | "STAFF_COVER_PROPOSED"        // a covering teacher proposed for a leave's cover slot (HR-2, D-#22)
  | "STAFF_COVER_DECIDED"         // cover slot approved (→ proxy grant) or returned to needs-cover (HR-2, D-#22)
  | "STAFF_PAY_SET"               // staff monthly salary / payment method set or edited (HR-3, prd-hr §4.1)
  | "PAYROLL_PREPARED"            // a monthly run computed/recomputed (Office, HR-3, H4.2)
  | "PAYROLL_APPROVED"            // a run approved + LOCKED by the Principal, advances decremented (HR-3, H4.2)
  | "PAYROLL_CANCELLED"           // a prepared run discarded before approval (HR-3)
  | "PAYROLL_REOPENED"            // a locked run unlocked to correct it; what the lock did is reversed (D-#904)
  | "PAYROLL_PAYMENT_EXPORTED"    // the payment CSV (names + account numbers) downloaded (D-#579)
  | "PAYROLL_REGISTER_EXPORTED"   // the accounting register (every salary in the school) downloaded (D-#625)
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
  | "FINAL_SETTLEMENT_REOPENED"   // a leaver's settlement taken back because its payroll run was reopened (D-#904)
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
  | "CLASS_TEST_RECHECK_CONFIRMED"  // CT-RC: teacher ticked (or un-ticked) "I checked the script again" on an unusual mark / the whole class
  | "CLASS_TEST_RECHECK_REVIEWED"   // CT-RC: approver confirmed they looked at the unusual marks before approving
  | "CLASS_TEST_RECHECK_HELD"       // CT-RC Option B: approver held (or un-held) one result to see the paper
  | "CLASS_TEST_RECHECK_RULES_CHANGED" // CT-RC: the unusual-mark % thresholds were changed
  | "VOCAB_RESULT_RECORDED"       // a student's vocab marks recorded — attendance + per-position mistakes (VC-3, §3.6, D-#142)
  | "VOCAB_RESULT_MESSAGED"       // guardian vocab-result messages generated for a test — wa.me + emit() (VC-4, §8, D-#154)
  | "HW_FILE_ATTACHED"    // a question/answer file attached to homework (GP-A, D-#70)
  // A lifecycle REVERT is the one tracker action that leaves no trace on the record
  // itself: popActionGroup DELETES the popped stateDates stamps, so completed work
  // can silently return to "pending" with nothing to show it ever happened. These
  // two rows are the only evidence — they carry the popped states + the restored
  // state so "I marked it and it went back to pending" is answerable (D-#354).
  | "HW_RECORD_REVERTED"  // a homework student record's last action was undone (D-#338)
  | "HW_ITEM_VOIDED"      // Principal/Office removed a never-issued homework declaration (D-#741)
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
  | "STUDENT_COMMENT_READ_CONFIRMED" // the family tapped "পড়েছি" on the comment pop-up (D-#886)
  | "CLASSROOM_OBSERVATION_UPLOADED"   // Principal/Office uploaded a recorded session as an observation (CO-1, §5/J1, D-#194)
  | "CLASSROOM_OBSERVATION_ASSIGNED"   // a senior-teacher observer assigned to an observation (CO-1, §5/J1, D-#147)
  | "CLASSROOM_OBSERVATION_REVIEWED"   // the assigned observer scored the observation → REVIEWED (observer/Principal-only since CO-8, D-#271)
  | "CLASSROOM_OBSERVATION_PUBLISHED"  // Principal/Office published a reviewed observation → released to the observed teacher (CO-8, D-#271)
  | "CLASSROOM_OBSERVATION_WITHHELD"   // Principal/Office recorded a decision NOT to publish a reviewed observation, with a reason (CO-12, D-#369)
  | "CLASSROOM_OBSERVATION_HOLD_LIFTED" // a withhold was lifted → back into the awaiting-publish queue (CO-12, D-#369)
  | "CLASSROOM_OBSERVATION_CANCELLED"  // Principal/Office called off a planned (UPLOADED/ASSIGNED) review, with a reason (CO-15, D-#428)
  | "CLASSROOM_OBSERVATION_RESTORED"   // a cancel was undone → the row returns to its same state + observer (CO-15, D-#428)
  | "CLASSROOM_OBSERVATION_REJECTED"   // the ASSIGNED observer rejected an unreviewable video (class test, blank footage), with a reason — stored as a cancel
  | "CLASSROOM_OBSERVATION_REVIEW_EDITED" // Principal/Office edited a REVIEWED, unpublished review; the observer's original is kept on the row
  | "OBSERVATION_ROTA_SAVED"          // a generated review rota was accepted and stored (CO-14, D-#426) — creates NO assignments
  | "CLASSROOM_OBSERVATION_SUPERSEDED" // a re-review superseded a prior observation (CO-1, §5, D-#194)
  | "CLASSROOM_OBSERVATION_RESPONDED"  // the observed teacher acknowledged a released observation → TEACHER_RESPONDED (CO-3)
  | "OBSERVATION_REVIEW_RATED"         // the observed teacher rated the review's fairness/usefulness (CO-7, observation:read)
  | "CLASSROOM_OBSERVATION_ESCALATED"  // the response ladder flagged a still-unanswered observation to the Principal (CO-3)
  | "OBSERVATION_ESCALATION_CONFIG_SET" // an admin edited the response-escalation cadence thresholds (CO-3, observation:manage)
  | "OBSERVATION_SCHEDULE_CONFIG_SET"   // an admin edited the review-scheduler cadence (base interval + per-tier multipliers, CO-6, observation:manage)
  | "RESULT_ENTRY_TARGET_SET"           // a teacher's class-test result backlog target set/changed (D-#739, Principal)
  | "REVIEW_QUOTA_SET"                  // an observer's daily review target set/changed (owner ask 2026-10-12, Principal)
  | "SESSION_RECORDING_ADDED"          // CO-2 footage linked to an observation
  | "PARENT_MEETING_CREATED"    // an admin created a parents' meeting in draft (CM-3, §3/§6, D-#123)
  | "PARENT_MEETING_SLOTS_GENERATED" // per-family slots (re)generated wholesale for a meeting (CM-3, J-CM3, D-#175)
  | "PARENT_MEETING_SLOTS_REORDERED" // slots reordered / a family flagged On-Call → re-timed (CM-3, J-CM4, D-#123)
  | "PARENT_MEETING_SCHEDULED"  // a meeting dispatched (draft → scheduled) — timing notices fanned out (CM-4, §6/J-CM5, D-#176)
  | "MEETING_SLOT_ATTENDANCE_SET" // a family slot's present/absent captured at the meeting (CM-4, §6, D-#176)
  | "MEETING_SLOT_RESPONDED"    // a guardian answered the family's slot: confirmed / change requested / can't come (D-#840)
  | "MEETING_CHANGE_APPROVED"   // Principal/VP approved a change request — the two families swapped (D-#842)
  | "MEETING_CHANGE_DECLINED"   // Principal/VP declined a change request — the time stays (D-#842)
  | "MEETING_CHANGE_OUTCOME_SEEN" // the family acknowledged the approved/declined pop-up (D-#844)
  // Pop-up notices (docs/prd-popup-notice.md, D-#852..#858)
  | "POPUP_NOTICE_PUBLISHED"    // a pop-up notice went out — audience frozen into recipient rows (counts in meta)
  | "POPUP_NOTICE_EDITED"       // the words / end date of a sent notice fixed (before/after + reshow in meta)
  | "POPUP_NOTICE_WITHDRAWN"    // a sent notice stopped — gone from every screen, report kept
  | "POPUP_NOTICE_ANSWERED"     // a recipient tapped an answer button (meta.previous on a changed answer)
  | "POPUP_NOTICE_FOLLOW_UP"    // the sender re-showed it to the rest, or added new matches (meta.action + count)
  | "POPUP_NOTICE_NOTIFIED"     // a sent notice's people also got a phone notification, SCHOOL_NOTICE (D-#1072; counts in meta)
  | "MEETING_COMMENT_SAVED"     // a class teacher saved a (student × meeting) positive+concern note (CM-5, §3/§6/J-CM6, D-#124)
  // Parents'-meeting comment chain (MC-1..MC-4, docs/prd-meeting-comments.md, D-#752..#756)
  | "MEETING_COMMENTS_OPENED"          // collection opened (roster counts in meta) or its due dates changed (meta.datesOnly)
  | "MEETING_COMMENT_ROSTER_REFRESHED" // who-comments-on-whom rebuilt from the routine; written notes kept
  | "MEETING_SUBJECT_SKIPPED"          // a subject skipped for a section (reason in meta) — meta.undone on a restore
  | "MEETING_SUBJECT_NOTE_SAVED"       // a subject teacher saved a child's Strengths + Concerns (meta.edit on a rewrite)
  | "MEETING_FINAL_COMMENT_SAVED"      // Principal/Office saved the final word (source AS_IS/EDITED/OWN in meta)
  | "MEETING_NOTE_REMINDER_SENT"       // the Office sent a teacher a reminder about comments left
  | "ROLE_TEMPLATE_CHANGED" // Principal switched a catalogue action on/off for a whole role (TEACHER/OFFICE) — prior + next delta + affected login count (PM, D-#801)
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
  | "SR_REVISION_RECORDED"        // a Saturday Hifz revision entry recorded/edited — surah:ayah portions (Saturday-Revision SR-1/SR-5, §3/J-SR1-1, D-#241/#242/#833)
  | "SR_REVISION_RESET"           // every revision entry deleted once, at the move to surah:ayah ranges; meta carries the counts (Saturday-Revision SR-5, D-#838)
  | "SR_ENTRY_CORRECTED"          // a delivered revision entry corrected (D-#1002) — meta.correction/note/previousAuthor
  | "SR_ENTRY_DELIVERED"          // a revision entry delivered to the family — absent alert / weekly digest, sealed (Saturday-Revision SR-2, §3/J-SR2-1/2/3, D-#244)
  | "SR_ABSENCE_ESCALATED"        // a consecutive-absence streak escalated to guardian + Principal (Saturday-Revision SR-2, §3/J-SR2-4, D-#245)
  | "SR_ESCALATION_CONFIG_SET"    // the consecutive-absence threshold edited (Saturday-Revision SR-2, message:dispatch)
  | "SR_TARGET_SET"               // a Hifz level's weekly revision target declared/changed (SR-6, D-#1170) — meta.level/date/categories
  | "SR_LISTENER_SET"             // a student given to / taken from a revision listener (SR-6, D-#1171) — meta.from/to
  | "SR_SATURDAY_RELEASED"        // a Saturday's recorded revision entries released to families (SR-6, D-#1173) — meta.date/released
  | "HOMEWORK_SUPERVISOR_SET"     // a school-wide homework supervisor toggled on/off (roster:manage)
  | "VIDEO_REVIEW_ASSIGNED"       // a class-session YouTube video logged + assigned to a teacher (owner ask 2026-07-20; observation:upload)
  | "VIDEO_REVIEW_REVIEWED"       // the assigned teacher's OK / NOT_OK-with-comment verdict (observation:review)
  | "CT_QUESTION_REQUESTED"       // a subject teacher asked the office to produce a class-test question paper (owner ask 2026-07-20; tracker:write)
  | "CT_QUESTION_SENT_FOR_REVIEW" // the office uploaded a paper round and sent it for teacher review (roster:manage)
  | "CT_QUESTION_REVIEWED"        // the teacher's verdict on a round — approve (locks) or changes-requested with comment (tracker:write)
  | "CT_QUESTION_EDITED"          // the requester corrected the details — meta carries before AND after (owner ask 2026-09-15; tracker:write)
  | "CT_QUESTION_CANCELLED"       // the requester withdrew the request before it was confirmed (owner ask 2026-09-15; tracker:write)
  | "CT_QUESTION_DELETED"         // the office/principal soft-deleted the row, active:false (owner ask 2026-09-15; roster:manage)
  | "ENGLISH_DRIVE_UPLOADED"      // an English Drive md document uploaded — new (class, block, kind) (D-#344; roster:manage)
  | "ENGLISH_DRIVE_REPLACED"      // a newer version replaced an existing (class, block, kind) doc — old row stamped replacedAt (D-#344)
  | "TEACHING_NOTE_UPLOADED"      // a teaching note uploaded — new (class, subject, kind, seq) (TN-1, D-#519; roster:manage)
  | "TEACHING_NOTE_REPLACED"      // a newer version replaced an existing teaching note — old row stamped replacedAt, retained (TN-1, D-#522)
  | "TEACHING_NOTE_COMMENTED"     // a teacher left an improvement comment on a teaching note (TN-2, D-#520)
  | "TEACHING_NOTE_COMMENT_ADDRESSED" // a comment marked ADDRESSED (or reopened) by the uploader / P/O (TN-2, D-#520)
  | "TEACHING_NOTE_COMMENT_DELETED"   // a comment soft-deleted by its author or P/O (TN-2)
  | "ASSIGNMENT_ITEM_EDITED"      // a delivered assignment was edited after the fact (D-#353)
  | "ASSIGNMENT_ITEM_DELETED"     // a still-DRAFT delivered assignment was deleted (D-#353)
  | "ASSIGNMENT_PLAN_FOLLOWED_ROUTINE" // a routine teacher change re-pointed the matching assignment-plan cells (D-#880)
  | "MONTHLY_REPORT_CONFIG_SET"    // Principal edited the monthly-report thresholds / gate / calendar — prior + new retained (MR-2, D-#395)
  | "MONTHLY_REPORT_RELEASED"      // a monthly report revision released to the family, individually or in a batch (MR-3, D-#397)
  | "MONTHLY_REPORT_RERELEASED"    // a LATER revision released over one the family had already seen (MR-3, D-#393)
  | "MONTHLY_REPORT_REVOKED"       // a released report withdrawn — guardian access removed (Principal only, MR-3, D-#397)
  | "MONTHLY_REPORT_GATE_OVERRIDDEN" // the coverage block overridden with a reason (Principal only, MR-3, D-#394)
  | "MONTHLY_REPORT_UNLOCKED"      // a hard-locked month reopened with a reason (Principal only, MR-3, D-#398)
  | "MONTHLY_COMMENTS_EXPORTED"    // de-identified comment pack streamed for Desktop authoring (MR-8, D-#415)
  | "SCHOLARSHIP_ANALYSIS_EXPORTED" // one NAMED student's topic weakness streamed as .md (SC-8, D-#695)
  | "SCHOLARSHIP_CANDIDATE_ADDED"    // a child entered for the scholarship examination (SC-9, D-#697)
  | "SCHOLARSHIP_CANDIDATE_REMOVED"  // a child taken out of it; her marks are KEPT, only scoped out
  | "MONTHLY_COMMENTS_IMPORTED"    // a comment envelope pasted back — counts + per-row refusals in meta (MR-8, D-#415)
  // Answer-script archive (AR-1..AR-3, prd-script-archive §5/§7, D-#443–#447)
  | "SCRIPT_BUNDLE_FILED"          // a test's scripts filed into a box (teacher tracker:write / Office roster:manage)
  | "SCRIPT_BUNDLE_ACKNOWLEDGED"   // the ONE office acknowledgement stamped (additive, D-#444)
  | "SCRIPT_BUNDLE_CHECKED_OUT"    // desk handed a bundle out — borrower + purpose in meta (Office only)
  | "SCRIPT_BUNDLE_CHECKED_IN"     // bundle returned to a box (optionally re-boxed)
  | "SCRIPT_BUNDLE_DISPOSED"       // outside-retention bundle disposed with a reason (D-#446; shred AFTER this row)
  | "SCRIPT_BUNDLE_VOIDED"         // a filed-in-error bundle voided — record kept, unique slot freed
  | "STORAGE_BOX_CHANGED"          // box create/update/retire — prior+new in meta (the LIBRARY_CATALOG_CHANGED pattern)
  // Class-test scripts (CS-1..CS-3, docs/prd-ct-scripts.md §4, D-#715–#719)
  | "CT_SCRIPTS_RECEIVED"          // Office counted the paper in at the desk (count in meta)
  | "CT_SCRIPTS_RECEIVE_UNDONE"    // a receipt taken back before anything was tagged
  | "CT_SCRIPT_TAGGED"             // a page added/removed or a student marked খাতা নেই — studentId + before/after in meta
  | "CT_SCRIPTS_PUBLISHED"         // scans released to guardians (version in meta)
  | "CT_SCRIPTS_UNPUBLISHED"       // scans pulled back from guardians
  | "CT_SCRIPTS_HANDED_BACK"       // Office gave the paper to the teacher to return in class (D-#719)
  | "CT_SCRIPTS_RETURNED"          // the teacher (or Office for an absent teacher) returned it to the students
  | "CT_SCRIPTS_WAIVED"            // closed without scans, with a reason (D-#718) — meta.undone on an unwaive
  // Improvement actions (SP-2..SP-4, docs/prd-student-progress.md, D-#735..#737)
  | "IMPROVEMENT_ACTION_CREATED"   // Office/Principal set an action (scope, subject, days, start/end in meta)
  | "IMPROVEMENT_ACTION_STOPPED"   // stopped early, with an optional reason
  | "IMPROVEMENT_ACTION_EXTENDED"  // more school days added (count + new end in meta)
  | "IMPROVEMENT_TICKED"           // a day marked DONE/COULDNT — part, day, reason, onBehalf/asCover in meta
  | "IMPROVEMENT_UNTICKED"         // a day's mark taken back (what it was in meta)
  | "IMPROVEMENT_ASSIGNEE_SET"     // who does a teacher day changed on the leave cover screen (null = back to the default)
  // Exam syllabus (SY-1..SY-6, docs/prd-exam-syllabus.md §6/§7, D-#530–#532)
  | "EXAM_CREATED"                    // an exam row created (exam:manage)
  | "EXAM_UPDATED"                    // an exam's name/date window edited; meta lists WHICH fields moved, never their values (the D-#526 posture)
  | "EXAM_SYLLABUS_SAVED"             // Office wrote/edited a syllabus row — prose, mark rows, question types
  | "EXAM_SYLLABUS_SUBMITTED"         // sent to the named SUBJECT TEACHER for sign-off (approverUserId in meta)
  | "EXAM_SYLLABUS_TEACHER_APPROVED"  // the subject teacher signed it off (D-#533)
  | "EXAM_SYLLABUS_REASSIGNED"        // Office/Principal moved a TEACHER_REVIEW row to a different routine holder (D-#613)
  | "EXAM_SYLLABUS_TEACHER_BYPASSED"  // the Principal signed off IN THE TEACHER'S PLACE — no routine holder (§7.2).
                                      // A DISTINCT kind on purpose: folding it into _TEACHER_APPROVED would make the
                                      // stage decorative the first time it was inconvenient, and leave no way to ask
                                      // afterwards which sign-offs a teacher actually gave.
  | "EXAM_SYLLABUS_SENT_BACK"         // teacher or Principal returned it to DRAFT with a mandatory reason
  | "EXAM_SYLLABUS_REOPENED"          // a content edit cleared an existing teacher approval (§7.3, the D-#520 rule)
  | "EXAM_SYLLABUS_PUBLISHED"         // Principal published — publishedAt set, guardians can now read it
  | "EXAM_CLASS_NOTE_SAVED"            // the per-class question-type footer written/updated (§5.5)
  // Guardian work claim (GC-2, D-#551..#554). The claim NEVER writes a lifecycle
  // state, so these rows are the only record that a family spoke and who answered.
  | "WORK_CLAIM_FILED"        // a guardian asserted the work was done at home
  | "WORK_CLAIM_ACCEPTED"     // closed by the teacher’s ordinary submit pass (resolution AUTO)
  | "WORK_CLAIM_REJECTED"     // the one manual close — reason is a picker value, never free text
  | "WORK_CLAIM_NUDGED"       // Office re-fired the teacher’s notification (Office cannot resolve)
  | "WORK_CLAIM_REASSIGNED"   // teaching changed hands; the open claim followed it (WC-7)
  | "WORK_CLAIM_EXPIRED"      // 7 school days with no answer — leaves the queue, stays here
  | "WORK_CLAIM_DIGEST_RECIPIENTS_SET" // Principal changed who ELSE gets the 10:30 digest (D-#710)
  // "View as" (VA-1, D-#638). Deliberately NOT LOGIN_SUCCESS: the guardian-engagement
  // report counts guardian logins to find families that have gone quiet, and a Principal
  // checking a family's view is not that family showing up (G7).
  // scholarship practice papers (SC-0.., D-#656)
  | "SCHOLARSHIP_TOPIC_SAVED"   // a topic added or edited in the per-(subject, class) catalogue
  | "SCHOLARSHIP_TOPIC_RETIRED"  // soft retire — historical items tagged with it keep resolving
  // mastery tracker catalogue (M-0, docs/prd-mastery.md, D-#775–#787)
  | "MASTERY_CATALOGUE_IMPORTED" // a class × subject catalogue applied from its locked file; meta = counts + marks changes
  | "MASTERY_CATALOGUE_LOCKED"   // DRAFT → LOCKED; codes became permanent (D-#776)
  | "MASTERY_OUTCOME_SAVED"      // label / home tip / source text / question types edited
  | "MASTERY_OUTCOME_RETIRED"    // LOCKED → RETIRED, or a DRAFT removed
  | "MASTERY_QT_SAVED"           // a question type's marks/label saved; marks history appended (D-#777)
  | "MASTERY_TAG_SAVED"          // a diagnosis tag added or edited (D-#778/#787)
  | "MASTERY_POLICY_SAVED"       // the school policy or a class × subject override saved
  | "MASTERY_ENABLEMENT_SET"     // the add-on switched on/off for a year × class × subject (D-#775)
  | "MASTERY_PAPER_CREATED"      // a work sheet (HW / CT / rubric) created with its items (M-2)
  | "MASTERY_PAPER_DELETED"      // an OPEN sheet with no results removed
  | "MASTERY_RESULTS_SAVED"      // exceptions saved; meta.correction = after confirmation (evidence rewritten)
  | "MASTERY_EXTRA_HOMEWORK_CREATED" // PR-D: an extra tailored homework sheet for weak children (D-#1323)
  | "MASTERY_PAPER_CONFIRMED"    // "সব ঠিক আছে" — evidence written for the whole roster (D-#778)
  | "MASTERY_ITEM_EXCLUDED"      // a teacher took an item (or a bank question, scope QID) out of diagnosis for their section (D-#782)
  | "MASTERY_EXCLUSION_REVOKED"  // that exclusion undone; the evidence counts again
  | "MASTERY_ASSIGNMENT_BUILT"   // a weekly tailored assignment built / rebuilt from the teacher's layout (M-4)
  | "MASTERY_ASSIGNMENT_SENT"    // sent: one AS work sheet written with each student's own items (D-#809)
  | "MASTERY_ACTION_PROPOSED"    // a section crossed the trigger on an outcome; one PROPOSED action opened (M-5, D-#811)
  | "MASTERY_ACTION_DECIDED"     // an approver planned an extra class / re-teach, or rejected the proposal
  | "MASTERY_EXTRA_CLASS_HELD"   // the teacher recorded the class and who came
  | "MASTERY_RETEST_BUILT"       // the re-test sheet was built (unseen questions per student)
  | "MASTERY_ACTION_CLOSED"      // closed with before / after and an outcome
  | "MASTERY_REVIEW_EVENT"       // objective-tree review log (prd-objective-tree §5): every MasteryReviewEvent row is mirrored here; meta = action/code/round
  | "MASTERY_REVIEW_ASSIGNED"    // OT-2: the Principal assigned (বরাদ্দ) reviewers to a tree review round; meta = round + reviewer ids
  | "MASTERY_REVIEW_SUBMITTED"   // OT-2: the reviewer submitted the round for the Principal's lock
  | "MASTERY_LEVEL_LABELS_SAVED" // the level names (ক্ষেত্র / শিখনফল / …) on the SCHOOL policy row changed (D-#923)
  | "SCHOLARSHIP_PAPER_DECLARED" // a practice paper and its item structure declared; meta carries the item count + total
  | "SCHOLARSHIP_PAPER_UPDATED"  // the item list or header edited after declaration; meta names WHICH fields moved
  | "SCHOLARSHIP_SCORES_ENTERED" // per-item marks written for one or more students on one paper
  | "IMPERSONATION_START"     // Principal opened someone else's account view; target = the account
  | "IMPERSONATION_END"       // returned to their own account (or the borrowed token expired)
  | "TASK_WRITE"              // work board (WB-1, D-#701): a manual task/template created, moved, re-statused, reassigned, blocked, cancelled — meta.action
  | "AI_SETTINGS_CHANGED"     // an AI key / model / feature / cap / budget saved or cleared in the app (D-#967, D-#1121–#1126) — meta.provider/keyChanged/keyLast4/model/keyCleared/feature/…; never the key
  | "AI_POLICY_SAVED"         // a new version of an AI rules document (AI-3, D-#1093) — meta.key/version/hash/chars; never the text
  | "AI_POLICY_ACTIVATED"     // one AI rules version switched on (others of its key off) — meta.key/version/hash
  | "AI_POLICY_DEACTIVATED"   // an AI rules key switched off (no version active) — meta.key
  | "AI_EXCHANGES_DELETED"    // AI request/reply log rows deleted by hand (D-#1179) — meta.count + feature/month or one row
  | "AI_PROJECT_CHANGED"      // AI Workspace project created / settings / members / archived (W-1) — meta.action + what changed
  | "AI_PROJECT_FILE_CHANGED" // AI Workspace file added / re-read / pinned / removed (W-1) — meta.action/fileId/name; never the text
  | "AI_DRAFT_CHANGED"        // AI Workspace draft created / new version / approved / sent to a pipeline (W-3) — meta.action/version/pipeline/ok
  | "QUESTION_HINTS_IMPORTED" // guardian question hints loaded (GH-1, D-#1520) - meta.total/created/updated/unchanged/refused
  | "HOMEWORK_INTEGRITY_RECORDED" // Office recorded the outcome of a homework-honesty case (GH-3, D-#1522) - meta.studentId/loCode/outcome/gap
  | "AI_JOB_CHANGED"          // AI Workspace batch job created / cancelled (W-4) — meta.action/items/runAt/model/estimateUsd
  | "AI_MCP_AUTHORIZED"       // the Principal allowed an MCP client (Claude) into the AI Workspace (W-5) — meta.client/clientId
  | "AI_MCP_REVOKED"          // the Principal disconnected an MCP client (W-5) — meta.clientId/tokens
  | "DATA_MCP_AUTHORIZED"     // a person allowed Claude to read school data as them (data assistant DA-3, D-#1536) — meta.client/clientId
  | "DATA_MCP_REVOKED"        // a data-assistant connection was cut: disconnect, permission loss, deactivation, password reset (D-#1536) — meta.reason/clientId/tokens
  | "STUDENT_BANGLA_NAME_SET" // a student's Bangla name set (AI-4, D-#1131) — meta.before/after
  | "WORKSHEET_SENT_TO_PRINT" // a generated Nursery/KG paper filed to the print queue (D-#747) — meta.kind/subject/seed
  | "WORKSHEET_PLAN_SAVED"    // how a class level × subject's মানবন্টন rows are generated, + presets (D-#745)
  | "WORKSHEET_PICTURE_EDITED" // a picture-bank row re-tagged / hidden / reserved for the final (D-#746)
  | "CLASS_BOOK_UPLOADED"     // a class book PDF uploaded and queued for page rendering (D-#870) — meta.classLevel/title
  | "CLASS_BOOK_EDITED"       // a class book renamed / moved class / reordered / hidden or shown (D-#870) — meta before/after
  | "CLASS_BOOK_DELETED"      // a class book removed with its page images (D-#870)
  | "REFERENCE_PAPER_UPLOADED" // another branch's paper uploaded for reading (D-#1030) — meta term/year/classLevel/subject
  | "REFERENCE_PAPER_EDITED"   // its class / subject / term / title corrected (D-#1030) — meta before/after
  | "REFERENCE_PAPER_DELETED"  // removed with its pages and original (D-#1030)
  | "EXAM_PAPER_DRAFT_IMPORTED"      // a draft paper imported for review (D-#1031) — meta key
  | "EXAM_PAPER_REVIEWER_ASSIGNED"   // reviewer chosen for one or more draft papers (D-#1032) — meta reviewerUserId/paperIds
  | "EXAM_PAPER_SUGGESTION_MADE"     // reviewer suggested an edit / deletion / new question (D-#1032)
  | "EXAM_PAPER_SUGGESTION_RESOLVED" // a suggestion accepted (applied) or rejected (D-#1032) — meta accepted
  | "EXAM_PAPER_REVIEW_SUBMITTED"    // reviewer said the review is done (D-#1032)
  | "EXAM_PAPER_FINALIZED"           // a draft paper marked final (D-#1033)
  | "EXAM_PAPER_REOPENED"            // a final paper opened again (D-#1033)
  | "QURAN_EXAM_PAPER_SAVED"      // a Quran exam paper created/edited (D-#874) — meta.level/scheme/fullMarks
  | "QURAN_EXAM_SITTINGS_LOADED"  // sittings created in bulk for an exam (D-#875) — meta.count
  | "QURAN_EXAM_SITTING_MOVED"    // a sitting moved to another examiner (D-#875) — meta.from/to + times
  | "QURAN_EXAM_EXAMINER_ADDED"   // a teacher added as an examiner for a day (D-#875) — meta.dateKey
  | "QURAN_EXAM_EXAMINER_REMOVED" // an examiner removed for a day; sittings shared out (D-#875) — meta.moved
  | "QURAN_EXAM_RESULT_SAVED"     // marks / absence saved on a sitting (D-#876) — meta.status/total
  | "QURAN_EXAM_MADE_UP"          // an absent sitting rescheduled (D-#876) — meta.dateKey/start/examiner
  | "QURAN_EXAM_PUBLISHED"        // the schedule published or withdrawn (D-#877) — meta.status
  | "QURAN_EXAM_LOCKED"           // marks locked or unlocked (D-#876) — meta.locked
  | "QURAN_EXAM_REMINDED"         // pending-marks reminder pop-ups re-armed (D-#878) — meta.examiners
  | "VIVA_PAPER_SAVED"            // a Nursery/KG oral paper's questions saved (D-#1081) — meta.before/after
  | "VIVA_EXAMINERS_SAVED"        // who examines which child on an oral paper (D-#1083) — meta.before/after
  | "VIVA_MARKS_LOCKED"           // an oral paper's marks locked (D-#1084) — meta.classId/subject/dateKey
  | "VIVA_MARKS_UNLOCKED"         // an oral paper's marks unlocked (D-#1084)
  | "VIVA_SET_DRAWN"              // a child's oral question set drawn at the examiner's tap (D-#1276) — meta.studentId/setKey/counts
  | "EXAM_ROUTINE_SAVED"          // one class's exam routine saved (D-#883) — meta.classId/slots
  | "EXAM_ROUTINE_PUBLISHED"      // the exam routine published or withdrawn (D-#883) — meta.published
  | "GUARDIAN_FEATURE_SET"        // a guardian feature switched on/off for all or one guardian (D-#1011) — meta.feature/onForAll/guardianId/on
  // Exams (docs/prd-exams.md, D-#375–#382). The custody rows are the point: the paper
  // sheets carry names and signatures but no counts and no issue/return record, so
  // "how many scripts went out, how many came back" was unanswerable (D-#382).
  | "EXAM_PAPER_UPSERTED"         // a class×subject paper created/re-shaped — meta carries the component split (EX-1, D-#376)
  | "EXAM_STATUS_CHANGED"         // exam lifecycle transition (EX-1)
  | "EXAM_DUTY_ASSIGNED"          // invigilator/checker/rechecker/tabulator put on a paper (EX-2)
  | "EXAM_DUTY_REVOKED"           // a duty row removed (EX-2)
  | "EXAM_MARKS_ENTERED"          // a checker wrote/replaced marks on a paper (EX-3)
  | "EXAM_CT_PULLED"              // CT component pulled from the class-test tracker (EX-3, D-#378)
  | "EXAM_RECHECK_ENTERED"        // the rechecker wrote their INDEPENDENT figures (EX-4)
  | "EXAM_DIVERGENCE_RESOLVED"    // a checker/rechecker disagreement settled by a named person (EX-4)
  | "EXAM_PAPER_TABULATED"        // a paper locked after every divergence was settled (EX-4)
  | "EXAM_PAPER_TABULATION_REOPENED" // a tabulated paper re-opened with a reason (EX-4, exam_results:reopen). NOT EXAM_PAPER_REOPENED — that is the paper bank (D-#1033)
  | "EXAM_REPORT_COMMENT_SET"     // the "Comment from School" line written for a student (EX-5)
  | "EXAM_CUSTODY_HANDED_OVER"    // giver recorded a physical handover with a count (EX-6, D-#382)
  | "EXAM_CUSTODY_ACKNOWLEDGED"   // the named receiver confirmed the same count (EX-6)
  | "EXAM_CUSTODY_DISPUTED"       // receiver counted DIFFERENTLY — both numbers kept, note required (EX-6)
  | "EXAM_CUSTODY_CANCELLED"      // giver withdrew a still-unacknowledged handover (EX-6)
  | "EXAM_RESULTS_SUBMITTED"       // the card set sent for approval; every paper tabulated (EX-9)
  | "EXAM_RESULTS_PUBLISHED"       // approve+publish — the guardian-visible flip (EX-9)
  | "EXAM_RESULTS_SENT_BACK"       // returned to marking with a reason (EX-9)
  | "EXAM_RESULTS_UNPUBLISHED"     // pulled back out of guardian view (EX-9)
  | "PERMISSION_DENIED"
  | "SUPPORT_PROFILE_VIEWED" // a support-profile content read: card/full/history/report — meta studentId, versionNo, surface, via, readerVia; never text (CSP-1, D-#1549)
  | "SUPPORT_REPORT_SUBMITTED" // a support report saved for processing — reportId, studentId, source, checkSkipped, flag counts (D-#1582)
  | "SUPPORT_REPORT_WITHDRAWN" // a teacher withdrew their own waiting support report (D-#1582)
  | "SUPPORT_REPORT_DECIDED" // the Principal decided a support report — reportId, decision (D-#1555)
  | "SUPPORT_VERSION_PUBLISHED" // a support-profile version published — versionNo, item counts per level (D-#1555)
  | "SUPPORT_VERSION_DISCARDED" // a support-profile draft discarded (D-#1555)
  | "SUPPORT_BATCH_CREATED" // a support processing batch made — batchId, mode, methodVersion, counts (D-#1585)
  | "SUPPORT_BATCH_CANCELLED" // a support batch cancelled; its reports back to waiting (D-#1585)
  | "SUPPORT_BATCH_EXPIRED" // a support batch expired after 14 days with no result (D-#1585)
  | "SUPPORT_PACK_DOWNLOADED" // an analysis pack downloaded — batchId, packHash, methodVersion, counts, size; never text (D-#1586)
  | "SUPPORT_RESULT_UPLOADED" // a batch result uploaded and validated — fileHash, producer, valid/rejected counts (D-#1587)
  | "SUPPORT_RESULT_APPLIED" // a validated batch result applied (D-#1587)
  | "SUPPORT_RESULT_DISCARDED" // an uploaded batch result discarded before apply (D-#1587)
  | "SUPPORT_PROFILE_OPENED" // a support profile opened — first report or by the Principal (D-#1546)
  | "SUPPORT_PROFILE_CLOSED" // a support profile closed by the Principal, or LEFT by the leaver sweep (D-#1558)
  | "SUPPORT_PROFILE_REOPENED" // a support profile reopened by the Principal (D-#1558)
  | "SUPPORT_ACCESS_REFUSED" // an authenticated staff read of a support profile refused by scope or role — studentId, reason (D-#1548)
  | "SAFEGUARDING_REFERRAL_RAISED" // a safeguarding referral raised — referralId, studentId, source, signs; never text (D-#1564)
  | "SAFEGUARDING_REFERRAL_SEEN"; // the receiver marked a safeguarding referral seen (D-#1564)

export interface IAudit extends Document {
  _id: Types.ObjectId;
  eventKind: AuditEventKind;
  actorId?: Types.ObjectId;
  actorRole?: string;
  /**
   * The borrowed account, when the row was written inside a "View as" session (D-#638).
   * `actorId` names the Principal who acted; this names whose account they acted through.
   * Absent on every ordinary row, which is all rows written before VA-1.
   */
  onBehalfOf?: Types.ObjectId;
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
    onBehalfOf: { type: Schema.Types.ObjectId },
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
