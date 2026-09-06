/**
 * auditLabels — the human-readable name of every audit event kind, plus the
 * family it belongs to (AL-1, D-#645).
 *
 * WHY IT LIVES HERE, NEXT TO THE UNION, AND NOT IN THE APP'S `labels.ts`.
 * `AUDIT_KIND_LABELS` is typed `Record<AuditEventKind, …>`, so adding a kind to
 * `models/Audit.ts` without naming it here fails `tsc`. A copy in the app would
 * be a mirror nobody is forced to update — and a stale mirror in a log whose
 * whole value is "what happened" is worse than the raw SCREAMING_CASE, because
 * it renders a wrong sentence instead of an ugly true one. This is deliberately
 * NOT a `/shared/vocab.ts` mirrored enum (the two-place contract-sync rule does
 * not apply): audit kinds have never been on the wire contract and are not
 * mirrored in the import schema. The server sends the label; the app renders it.
 *
 * The Bangla is the primary text — the reader is the Principal — and follows the
 * vocabulary already in `app/src/lib/labels.ts` (শাখা, বাড়ির কাজ, উপস্থিতি,
 * রিমাইন্ডার). English rides along for the EN surface.
 */
import type { AuditEventKind } from "./models/Audit";

/** Event families — the axis the activity screen filters on, since 219 kinds
 *  in one picker is not a filter. */
export const ACTIVITY_GROUPS = [
  "ACCESS",
  "ROSTER",
  "ROUTINE",
  "HOMEWORK",
  "ASSIGNMENT",
  "ATTENDANCE",
  "CONTENT",
  "EXAM",
  "VOCAB",
  "OBSERVATION",
  "MESSAGING",
  "REPORTS",
  "PRINT",
  "ARCHIVE",
  "NOTES",
  "REVISION",
  "LIBRARY",
  "PUBLISHING",
  "HR",
  "FINANCE",
  "WORK_CLAIM",
  "OTHER",
] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

export const ACTIVITY_GROUP_LABELS: Record<ActivityGroup, { bn: string; en: string }> = {
  ACCESS: { bn: "প্রবেশ ও অনুমতি", en: "Access & permissions" },
  ROSTER: { bn: "রোস্টার ও প্রতিষ্ঠান", en: "Roster & organisation" },
  ROUTINE: { bn: "রুটিন", en: "Routine" },
  HOMEWORK: { bn: "বাড়ির কাজ", en: "Homework" },
  ASSIGNMENT: { bn: "অ্যাসাইনমেন্ট", en: "Assignments" },
  ATTENDANCE: { bn: "উপস্থিতি ও ছুটি", en: "Attendance & leave" },
  CONTENT: { bn: "প্রশ্ন ও কনটেন্ট", en: "Questions & content" },
  EXAM: { bn: "পরীক্ষা ও ক্লাস টেস্ট", en: "Exams & class tests" },
  VOCAB: { bn: "শব্দভাণ্ডার", en: "Vocabulary" },
  OBSERVATION: { bn: "ক্লাস পর্যবেক্ষণ", en: "Classroom observation" },
  MESSAGING: { bn: "বার্তা ও যোগাযোগ", en: "Messaging & comms" },
  REPORTS: { bn: "মাসিক রিপোর্ট", en: "Monthly reports" },
  PRINT: { bn: "প্রিন্ট", en: "Printing" },
  ARCHIVE: { bn: "উত্তরপত্র সংরক্ষণ", en: "Script archive" },
  NOTES: { bn: "শিক্ষণ নোট ও ড্রাইভ", en: "Teaching notes & drive" },
  REVISION: { bn: "শনিবারের রিভিশন", en: "Saturday revision" },
  LIBRARY: { bn: "লাইব্রেরি", en: "Library" },
  PUBLISHING: { bn: "বই প্রকাশনা", en: "Book production" },
  HR: { bn: "কর্মী ও এইচআর", en: "Staff & HR" },
  FINANCE: { bn: "আর্থিক", en: "Finance" },
  WORK_CLAIM: { bn: "অভিভাবকের দাবি", en: "Guardian work claim" },
  OTHER: { bn: "অন্যান্য", en: "Other" },
};

export interface AuditKindLabel {
  bn: string;
  en: string;
  group: ActivityGroup;
}

/**
 * EXHAUSTIVE by type. A new `AuditEventKind` with no row here is a compile error
 * — that is the point of this file.
 */
export const AUDIT_KIND_LABELS: Record<AuditEventKind, AuditKindLabel> = {
  // --- Access & permissions -------------------------------------------------
  LOGIN_SUCCESS: { bn: "লগইন করেছেন", en: "Signed in", group: "ACCESS" },
  LOGIN_FAIL: { bn: "লগইন ব্যর্থ হয়েছে", en: "Sign-in failed", group: "ACCESS" },
  PERMISSION_DENIED: { bn: "অনুমতি না থাকায় বাধা পেয়েছেন", en: "Permission denied", group: "ACCESS" },
  CREDENTIAL_PROVISIONED: { bn: "লগইন তৈরি/রিসেট করেছেন", en: "Login provisioned or reset", group: "ACCESS" },
  USER_ACCESS_CHANGED: { bn: "ব্যবহারকারীর অনুমতি বদলেছেন", en: "Changed a user's access", group: "ACCESS" },
  SCOPE_GRANT_ASSIGN: { bn: "দায়িত্ব (স্কোপ) দিয়েছেন", en: "Assigned a scope grant", group: "ACCESS" },
  SCOPE_GRANT_REVOKE: { bn: "দায়িত্ব (স্কোপ) প্রত্যাহার করেছেন", en: "Revoked a scope grant", group: "ACCESS" },
  SCOPE_GRANT_EXTEND: { bn: "দায়িত্বের মেয়াদ বাড়িয়েছেন", en: "Extended a scope grant", group: "ACCESS" },
  PROXY_EXPIRED: { bn: "প্রক্সি দায়িত্বের মেয়াদ শেষ", en: "Proxy window expired", group: "ACCESS" },
  IMPERSONATION_START: { bn: "অন্যের অ্যাকাউন্টে দেখা শুরু করেছেন", en: "Started a View-as session", group: "ACCESS" },
  IMPERSONATION_END: { bn: "অন্যের অ্যাকাউন্টে দেখা শেষ করেছেন", en: "Ended a View-as session", group: "ACCESS" },

  // --- Roster & organisation ------------------------------------------------
  ROSTER_MANAGE: { bn: "রোস্টার পরিবর্তন করেছেন", en: "Changed the roster", group: "ROSTER" },
  GUARDIAN_LINK: { bn: "অভিভাবক সংযুক্ত করেছেন", en: "Linked a guardian", group: "ROSTER" },
  SECTIONS_MERGED: { bn: "শাখা একত্র করেছেন", en: "Merged sections", group: "ROSTER" },
  SECTIONS_SPLIT: { bn: "শাখা আলাদা করেছেন", en: "Split sections", group: "ROSTER" },
  ACADEMIC_YEAR_CREATED: { bn: "শিক্ষাবর্ষ যোগ করেছেন", en: "Created an academic year", group: "ROSTER" },
  ACADEMIC_YEAR_SET_CURRENT: { bn: "চলতি শিক্ষাবর্ষ বদলেছেন", en: "Switched the current academic year", group: "ROSTER" },
  HOMEWORK_SUPERVISOR_SET: { bn: "বাড়ির কাজের তত্ত্বাবধায়ক নির্ধারণ করেছেন", en: "Set the homework supervisor", group: "ROSTER" },

  // --- Routine --------------------------------------------------------------
  ROUTINE_SLOT_REVISED: { bn: "রুটিনের পিরিয়ড সংশোধন করেছেন", en: "Revised a routine slot", group: "ROUTINE" },
  ROUTINE_SLOT_RETIRED: { bn: "রুটিনের পিরিয়ড বাদ দিয়েছেন", en: "Retired a routine slot", group: "ROUTINE" },

  // --- Homework -------------------------------------------------------------
  TRACKER_WRITE: { bn: "ট্র্যাকারে লিখেছেন", en: "Tracker write", group: "HOMEWORK" },
  HW_FILE_ATTACHED: { bn: "বাড়ির কাজে ফাইল যুক্ত করেছেন", en: "Attached a homework file", group: "HOMEWORK" },
  HW_RECORD_REVERTED: { bn: "বাড়ির কাজের সর্বশেষ ধাপ ফিরিয়ে নিয়েছেন", en: "Reverted a homework record", group: "HOMEWORK" },

  // --- Assignments ----------------------------------------------------------
  AS_RECORD_REVERTED: { bn: "অ্যাসাইনমেন্টের সর্বশেষ ধাপ ফিরিয়ে নিয়েছেন", en: "Reverted an assignment record", group: "ASSIGNMENT" },
  ASSIGNMENT_ITEM_EDITED: { bn: "প্রদত্ত অ্যাসাইনমেন্ট সম্পাদনা করেছেন", en: "Edited a delivered assignment", group: "ASSIGNMENT" },
  ASSIGNMENT_ITEM_DELETED: { bn: "খসড়া অ্যাসাইনমেন্ট মুছেছেন", en: "Deleted a draft assignment", group: "ASSIGNMENT" },

  // --- Attendance & leave ---------------------------------------------------
  ATTENDANCE_IMPORTED: { bn: "উপস্থিতি এক্সেল থেকে নিয়েছেন", en: "Imported attendance", group: "ATTENDANCE" },
  ATTENDANCE_MARKED: { bn: "উপস্থিতি নিয়েছেন", en: "Marked attendance", group: "ATTENDANCE" },
  ATTENDANCE_MARKER_ASSIGNED: { bn: "উপস্থিতি নেওয়ার দায়িত্ব দিয়েছেন", en: "Assigned an attendance marker", group: "ATTENDANCE" },
  ATTENDANCE_REMINDER_SENT: { bn: "উপস্থিতির রিমাইন্ডার পাঠিয়েছেন", en: "Sent an attendance reminder", group: "ATTENDANCE" },
  LEAVE_APPLICATION_SUBMITTED: { bn: "শিক্ষার্থীর ছুটির আবেদন জমা দিয়েছেন", en: "Submitted a student leave application", group: "ATTENDANCE" },

  // --- Questions & content --------------------------------------------------
  CONTENT_READ: { bn: "কনটেন্ট পড়েছেন", en: "Read content", group: "CONTENT" },
  CONTENT_IMPORT: { bn: "কনটেন্ট ইমপোর্ট করেছেন", en: "Imported content", group: "CONTENT" },
  SET_ASSEMBLE: { bn: "প্রশ্নপত্র সাজিয়েছেন", en: "Assembled a question set", group: "CONTENT" },
  REVIEW_ASSIGNED: { bn: "পর্যালোচনার দায়িত্ব দিয়েছেন", en: "Assigned a review round", group: "CONTENT" },
  REVIEW_SUBMITTED: { bn: "পর্যালোচনার মতামত দিয়েছেন", en: "Submitted a review verdict", group: "CONTENT" },
  REVIEW_CANCELLED: { bn: "পর্যালোচনা বাতিল করেছেন", en: "Cancelled a review round", group: "CONTENT" },
  REVIEW_CONDITION_CLEARED: { bn: "শর্তসাপেক্ষ অনুমোদনের শর্ত নিষ্পত্তি করেছেন", en: "Cleared a review condition", group: "CONTENT" },
  PLAN_APPROVED: { bn: "পরিকল্পনা অনুমোদন করেছেন", en: "Approved a plan", group: "CONTENT" },
  QUESTION_PUBLISHED: { bn: "প্রশ্ন প্রকাশ করেছেন", en: "Published a question", group: "CONTENT" },
  QUESTION_EDITED: { bn: "প্রশ্ন সংশোধন করেছেন", en: "Edited a question", group: "CONTENT" },
  QUESTION_RETIRED: { bn: "প্রশ্ন বাতিল করেছেন", en: "Retired a question", group: "CONTENT" },
  QUESTION_RESTORED: { bn: "বাতিল প্রশ্ন ফিরিয়েছেন", en: "Restored a question", group: "CONTENT" },
  QUESTION_MARKED_IMPORTANT: { bn: "প্রশ্ন গুরুত্বপূর্ণ চিহ্নিত করেছেন", en: "Marked a question important", group: "CONTENT" },
  QUESTION_UNMARKED_IMPORTANT: { bn: "প্রশ্নের গুরুত্ব চিহ্ন তুলে নিয়েছেন", en: "Unmarked a question important", group: "CONTENT" },

  // --- Exams & class tests --------------------------------------------------
  CLASS_TEST_REQUESTED: { bn: "ক্লাস টেস্টের প্রশ্ন চেয়েছেন", en: "Requested a class test", group: "EXAM" },
  CLASS_TEST_PRINTED: { bn: "ক্লাস টেস্ট প্রিন্ট হয়েছে চিহ্নিত করেছেন", en: "Marked a class test printed", group: "EXAM" },
  CLASS_TEST_CANCELLED: { bn: "ক্লাস টেস্ট বাতিল করেছেন", en: "Cancelled a class test", group: "EXAM" },
  CLASS_TEST_RESTORED: { bn: "বাতিল ক্লাস টেস্ট ফিরিয়েছেন", en: "Restored a class test", group: "EXAM" },
  CLASS_TEST_DETAILS_EDITED: { bn: "ক্লাস টেস্টের তথ্য সংশোধন করেছেন", en: "Edited class-test details", group: "EXAM" },
  CLASS_TEST_RESULT_ENTERED: { bn: "ক্লাস টেস্টের ফলাফল লিখেছেন", en: "Entered class-test results", group: "EXAM" },
  CLASS_TEST_RESULT_SUBMITTED: { bn: "ক্লাস টেস্টের ফলাফল জমা দিয়েছেন", en: "Submitted class-test results", group: "EXAM" },
  CLASS_TEST_RESULT_RECALLED: { bn: "জমা দেওয়া ফলাফল ফিরিয়ে নিয়েছেন", en: "Recalled a result submission", group: "EXAM" },
  CLASS_TEST_RESULT_SENT_BACK: { bn: "ফলাফল শিক্ষকের কাছে ফেরত পাঠিয়েছেন", en: "Sent results back to the teacher", group: "EXAM" },
  CLASS_TEST_RESULT_PUBLISHED: { bn: "ক্লাস টেস্টের ফলাফল প্রকাশ করেছেন", en: "Published class-test results", group: "EXAM" },
  CLASS_TEST_RESULT_UNPUBLISHED: { bn: "প্রকাশিত ফলাফল তুলে নিয়েছেন", en: "Unpublished class-test results", group: "EXAM" },
  CT_QUESTION_REQUESTED: { bn: "ক্লাস টেস্টের প্রশ্নপত্র তৈরির অনুরোধ করেছেন", en: "Requested a class-test paper", group: "EXAM" },
  CT_QUESTION_SENT_FOR_REVIEW: { bn: "প্রশ্নপত্র পর্যালোচনার জন্য পাঠিয়েছেন", en: "Sent a paper for review", group: "EXAM" },
  CT_QUESTION_REVIEWED: { bn: "প্রশ্নপত্র পর্যালোচনা করেছেন", en: "Reviewed a class-test paper", group: "EXAM" },
  EXAM_CREATED: { bn: "পরীক্ষা তৈরি করেছেন", en: "Created an exam", group: "EXAM" },
  EXAM_UPDATED: { bn: "পরীক্ষার তথ্য সম্পাদনা করেছেন", en: "Updated an exam", group: "EXAM" },
  EXAM_SYLLABUS_SAVED: { bn: "সিলেবাস লিখেছেন", en: "Saved an exam syllabus", group: "EXAM" },
  EXAM_SYLLABUS_SUBMITTED: { bn: "সিলেবাস অনুমোদনের জন্য পাঠিয়েছেন", en: "Submitted a syllabus for sign-off", group: "EXAM" },
  EXAM_SYLLABUS_TEACHER_APPROVED: { bn: "সিলেবাস অনুমোদন করেছেন (বিষয় শিক্ষক)", en: "Approved a syllabus as subject teacher", group: "EXAM" },
  EXAM_SYLLABUS_REASSIGNED: { bn: "সিলেবাস অনুমোদনের দায়িত্ব বদলেছেন", en: "Reassigned a syllabus approver", group: "EXAM" },
  EXAM_SYLLABUS_TEACHER_BYPASSED: { bn: "শিক্ষকের বদলে সিলেবাস অনুমোদন করেছেন", en: "Signed off a syllabus in the teacher's place", group: "EXAM" },
  EXAM_SYLLABUS_SENT_BACK: { bn: "সিলেবাস ফেরত পাঠিয়েছেন", en: "Sent a syllabus back", group: "EXAM" },
  EXAM_SYLLABUS_REOPENED: { bn: "সম্পাদনার কারণে সিলেবাসের অনুমোদন বাতিল হয়েছে", en: "Reopened a syllabus after an edit", group: "EXAM" },
  EXAM_SYLLABUS_PUBLISHED: { bn: "সিলেবাস প্রকাশ করেছেন", en: "Published a syllabus", group: "EXAM" },
  EXAM_CLASS_NOTE_SAVED: { bn: "শ্রেণির প্রশ্নের ধরনের নোট লিখেছেন", en: "Saved an exam class note", group: "EXAM" },

  // --- Vocabulary -----------------------------------------------------------
  VOCAB_WORD_ADDED: { bn: "শব্দ যোগ করেছেন", en: "Added a vocabulary word", group: "VOCAB" },
  VOCAB_WORD_UPDATED: { bn: "শব্দ সম্পাদনা করেছেন", en: "Updated a vocabulary word", group: "VOCAB" },
  VOCAB_WORD_DEACTIVATED: { bn: "শব্দ নিষ্ক্রিয়/সক্রিয় করেছেন", en: "Deactivated or reactivated a word", group: "VOCAB" },
  VOCAB_TEST_CREATED: { bn: "শব্দ পরীক্ষা তৈরি করেছেন", en: "Created a vocabulary test", group: "VOCAB" },
  VOCAB_TEST_UPDATED: { bn: "শব্দ পরীক্ষার তথ্য বদলেছেন", en: "Updated a vocabulary test", group: "VOCAB" },
  VOCAB_TEST_POSITIONS_SET: { bn: "শব্দ পরীক্ষার শব্দক্রম সাজিয়েছেন", en: "Set vocabulary test positions", group: "VOCAB" },
  VOCAB_TESTER_ASSIGNED: { bn: "সাপ্তাহিক শব্দ পরীক্ষক নিয়োগ করেছেন", en: "Assigned a weekly vocabulary tester", group: "VOCAB" },
  VOCAB_RESULT_RECORDED: { bn: "শব্দ পরীক্ষার ফলাফল লিখেছেন", en: "Recorded a vocabulary result", group: "VOCAB" },
  VOCAB_RESULT_MESSAGED: { bn: "শব্দ পরীক্ষার ফলাফল অভিভাবককে পাঠিয়েছেন", en: "Messaged vocabulary results home", group: "VOCAB" },

  // --- Classroom observation ------------------------------------------------
  CLASSROOM_OBSERVATION_UPLOADED: { bn: "ক্লাসের রেকর্ডিং আপলোড করেছেন", en: "Uploaded a classroom observation", group: "OBSERVATION" },
  CLASSROOM_OBSERVATION_ASSIGNED: { bn: "পর্যবেক্ষক নিয়োগ করেছেন", en: "Assigned an observer", group: "OBSERVATION" },
  CLASSROOM_OBSERVATION_REVIEWED: { bn: "ক্লাস পর্যবেক্ষণ মূল্যায়ন করেছেন", en: "Reviewed a classroom observation", group: "OBSERVATION" },
  CLASSROOM_OBSERVATION_PUBLISHED: { bn: "পর্যবেক্ষণ শিক্ষককে প্রকাশ করেছেন", en: "Published an observation to the teacher", group: "OBSERVATION" },
  CLASSROOM_OBSERVATION_WITHHELD: { bn: "পর্যবেক্ষণ প্রকাশ স্থগিত রেখেছেন", en: "Withheld an observation", group: "OBSERVATION" },
  CLASSROOM_OBSERVATION_HOLD_LIFTED: { bn: "পর্যবেক্ষণের স্থগিতাদেশ তুলে নিয়েছেন", en: "Lifted an observation hold", group: "OBSERVATION" },
  CLASSROOM_OBSERVATION_CANCELLED: { bn: "পরিকল্পিত পর্যবেক্ষণ বাতিল করেছেন", en: "Cancelled a planned observation", group: "OBSERVATION" },
  CLASSROOM_OBSERVATION_RESTORED: { bn: "বাতিল পর্যবেক্ষণ ফিরিয়েছেন", en: "Restored a cancelled observation", group: "OBSERVATION" },
  CLASSROOM_OBSERVATION_SUPERSEDED: { bn: "পুনঃপর্যবেক্ষণে আগেরটি প্রতিস্থাপিত হয়েছে", en: "Superseded a prior observation", group: "OBSERVATION" },
  CLASSROOM_OBSERVATION_RESPONDED: { bn: "পর্যবেক্ষণে শিক্ষকের জবাব দিয়েছেন", en: "Responded to an observation", group: "OBSERVATION" },
  CLASSROOM_OBSERVATION_ESCALATED: { bn: "জবাব না আসায় পর্যবেক্ষণ প্রধান শিক্ষকের কাছে গেছে", en: "Escalated an unanswered observation", group: "OBSERVATION" },
  OBSERVATION_REVIEW_RATED: { bn: "পর্যবেক্ষণের মূল্যায়নে রেটিং দিয়েছেন", en: "Rated an observation review", group: "OBSERVATION" },
  OBSERVATION_ROTA_SAVED: { bn: "পর্যবেক্ষণের রোটা সংরক্ষণ করেছেন", en: "Saved an observation rota", group: "OBSERVATION" },
  OBSERVATION_ESCALATION_CONFIG_SET: { bn: "পর্যবেক্ষণের তাগাদার নিয়ম বদলেছেন", en: "Set the observation escalation cadence", group: "OBSERVATION" },
  OBSERVATION_SCHEDULE_CONFIG_SET: { bn: "পর্যবেক্ষণের সময়সূচির নিয়ম বদলেছেন", en: "Set the observation schedule cadence", group: "OBSERVATION" },
  SESSION_RECORDING_ADDED: { bn: "ক্লাসের ভিডিও যুক্ত করেছেন", en: "Added a session recording", group: "OBSERVATION" },
  VIDEO_REVIEW_ASSIGNED: { bn: "ভিডিও পর্যালোচনার দায়িত্ব দিয়েছেন", en: "Assigned a video review", group: "OBSERVATION" },
  VIDEO_REVIEW_REVIEWED: { bn: "ভিডিও পর্যালোচনা করেছেন", en: "Reviewed a video", group: "OBSERVATION" },

  // --- Messaging & comms ----------------------------------------------------
  CHAT_GROUP_CREATED: { bn: "চ্যাট গ্রুপ তৈরি করেছেন", en: "Created a chat group", group: "MESSAGING" },
  CHAT_MEMBERSHIP_CHANGED: { bn: "চ্যাট গ্রুপের সদস্য বদলেছেন", en: "Changed chat membership", group: "MESSAGING" },
  MESSAGE_EDITED: { bn: "নিজের বার্তা সম্পাদনা করেছেন", en: "Edited own message", group: "MESSAGING" },
  MESSAGE_DELETED: { bn: "নিজের বার্তা মুছেছেন", en: "Deleted own message", group: "MESSAGING" },
  CHAT_ATTACHMENT_UPLOADED: { bn: "চ্যাটে ফাইল পাঠিয়েছেন", en: "Uploaded a chat attachment", group: "MESSAGING" },
  CHAT_OVERSIGHT_OPENED: { bn: "তত্ত্বাবধানে কথোপকথন খুলেছেন", en: "Opened a conversation for oversight", group: "MESSAGING" },
  NOTICE_SENT: { bn: "অভিভাবকদের নোটিশ পাঠিয়েছেন", en: "Sent a guardian notice", group: "MESSAGING" },
  MESSAGE_TEMPLATE_EDITED: { bn: "বার্তার টেমপ্লেট সম্পাদনা করেছেন", en: "Edited a message template", group: "MESSAGING" },
  STUDENT_COMMENT_RECORDED: { bn: "শিক্ষার্থীর মন্তব্য লিখেছেন", en: "Recorded a student comment", group: "MESSAGING" },
  STUDENT_COMMENT_DELIVERED: { bn: "শিক্ষার্থীর মন্তব্য পরিবারে পাঠিয়েছেন", en: "Delivered a student comment", group: "MESSAGING" },
  PARENT_MEETING_CREATED: { bn: "অভিভাবক সভা তৈরি করেছেন", en: "Created a parents' meeting", group: "MESSAGING" },
  PARENT_MEETING_SLOTS_GENERATED: { bn: "সভার সময়সূচি তৈরি করেছেন", en: "Generated meeting slots", group: "MESSAGING" },
  PARENT_MEETING_SLOTS_REORDERED: { bn: "সভার সময়সূচি সাজিয়েছেন", en: "Reordered meeting slots", group: "MESSAGING" },
  PARENT_MEETING_SCHEDULED: { bn: "অভিভাবক সভা ঘোষণা করেছেন", en: "Scheduled a parents' meeting", group: "MESSAGING" },
  MEETING_SLOT_ATTENDANCE_SET: { bn: "সভায় উপস্থিতি লিখেছেন", en: "Set meeting slot attendance", group: "MESSAGING" },
  MEETING_COMMENT_SAVED: { bn: "সভার জন্য মন্তব্য লিখেছেন", en: "Saved a meeting comment", group: "MESSAGING" },

  // --- Monthly reports ------------------------------------------------------
  MONTHLY_REPORT_CONFIG_SET: { bn: "মাসিক রিপোর্টের নিয়ম বদলেছেন", en: "Set the monthly-report config", group: "REPORTS" },
  MONTHLY_REPORT_RELEASED: { bn: "মাসিক রিপোর্ট পরিবারে দিয়েছেন", en: "Released a monthly report", group: "REPORTS" },
  MONTHLY_REPORT_RERELEASED: { bn: "মাসিক রিপোর্টের নতুন সংস্করণ দিয়েছেন", en: "Re-released a monthly report", group: "REPORTS" },
  MONTHLY_REPORT_REVOKED: { bn: "প্রকাশিত মাসিক রিপোর্ট তুলে নিয়েছেন", en: "Revoked a monthly report", group: "REPORTS" },
  MONTHLY_REPORT_GATE_OVERRIDDEN: { bn: "মাসিক রিপোর্টের শর্ত শিথিল করেছেন", en: "Overrode the monthly-report gate", group: "REPORTS" },
  MONTHLY_REPORT_UNLOCKED: { bn: "বন্ধ মাস আবার খুলেছেন", en: "Unlocked a closed month", group: "REPORTS" },
  MONTHLY_COMMENTS_EXPORTED: { bn: "মন্তব্যের প্যাক রপ্তানি করেছেন", en: "Exported the comment pack", group: "REPORTS" },
  MONTHLY_COMMENTS_IMPORTED: { bn: "মন্তব্যের প্যাক ইমপোর্ট করেছেন", en: "Imported the comment pack", group: "REPORTS" },

  // --- Printing -------------------------------------------------------------
  PRINT_REQUEST_CREATED: { bn: "প্রিন্টের অনুরোধ করেছেন", en: "Filed a print request", group: "PRINT" },
  PRINT_REQUEST_PRINTED: { bn: "প্রিন্ট হয়েছে চিহ্নিত করেছেন", en: "Marked a print request printed", group: "PRINT" },
  PRINT_REQUEST_DELIVERED: { bn: "প্রিন্ট বুঝিয়ে দিয়েছেন", en: "Delivered a print request", group: "PRINT" },
  PRINT_REQUEST_CANCELLED: { bn: "প্রিন্টের অনুরোধ বাতিল করেছেন", en: "Cancelled a print request", group: "PRINT" },
  PRINT_REQUEST_REPRINTED: { bn: "আগের প্রিন্ট আবার দিয়েছেন", en: "Reprinted an earlier job", group: "PRINT" },
  PRINT_REQUEST_CLASS_TAGGED: { bn: "প্রিন্টের শ্রেণি/বিষয় চিহ্নিত করেছেন", en: "Tagged a print job's class", group: "PRINT" },

  // --- Script archive -------------------------------------------------------
  SCRIPT_BUNDLE_FILED: { bn: "উত্তরপত্রের বান্ডিল জমা দিয়েছেন", en: "Filed a script bundle", group: "ARCHIVE" },
  SCRIPT_BUNDLE_ACKNOWLEDGED: { bn: "উত্তরপত্র বুঝে নিয়েছেন", en: "Acknowledged a script bundle", group: "ARCHIVE" },
  SCRIPT_BUNDLE_CHECKED_OUT: { bn: "উত্তরপত্র ধার দিয়েছেন", en: "Checked out a script bundle", group: "ARCHIVE" },
  SCRIPT_BUNDLE_CHECKED_IN: { bn: "উত্তরপত্র ফেরত নিয়েছেন", en: "Checked in a script bundle", group: "ARCHIVE" },
  SCRIPT_BUNDLE_DISPOSED: { bn: "মেয়াদোত্তীর্ণ উত্তরপত্র নিষ্পত্তি করেছেন", en: "Disposed of a script bundle", group: "ARCHIVE" },
  SCRIPT_BUNDLE_VOIDED: { bn: "ভুল বান্ডিল বাতিল করেছেন", en: "Voided a script bundle", group: "ARCHIVE" },
  STORAGE_BOX_CHANGED: { bn: "সংরক্ষণ বাক্স পরিবর্তন করেছেন", en: "Changed a storage box", group: "ARCHIVE" },

  // --- Teaching notes & drive -----------------------------------------------
  TEACHING_NOTE_UPLOADED: { bn: "শিক্ষণ নোট আপলোড করেছেন", en: "Uploaded a teaching note", group: "NOTES" },
  TEACHING_NOTE_REPLACED: { bn: "শিক্ষণ নোটের নতুন সংস্করণ দিয়েছেন", en: "Replaced a teaching note", group: "NOTES" },
  TEACHING_NOTE_COMMENTED: { bn: "শিক্ষণ নোটে মন্তব্য করেছেন", en: "Commented on a teaching note", group: "NOTES" },
  TEACHING_NOTE_COMMENT_ADDRESSED: { bn: "শিক্ষণ নোটের মন্তব্য নিষ্পত্তি করেছেন", en: "Addressed a teaching-note comment", group: "NOTES" },
  TEACHING_NOTE_COMMENT_DELETED: { bn: "শিক্ষণ নোটের মন্তব্য মুছেছেন", en: "Deleted a teaching-note comment", group: "NOTES" },
  ENGLISH_DRIVE_UPLOADED: { bn: "ইংলিশ ড্রাইভ ডকুমেন্ট আপলোড করেছেন", en: "Uploaded an English Drive doc", group: "NOTES" },
  ENGLISH_DRIVE_REPLACED: { bn: "ইংলিশ ড্রাইভ ডকুমেন্ট বদলেছেন", en: "Replaced an English Drive doc", group: "NOTES" },

  // --- Saturday revision ----------------------------------------------------
  SR_REVISION_RECORDED: { bn: "শনিবারের রিভিশন লিখেছেন", en: "Recorded a Saturday revision", group: "REVISION" },
  SR_ENTRY_DELIVERED: { bn: "রিভিশনের খবর পরিবারে পাঠিয়েছেন", en: "Delivered a revision entry", group: "REVISION" },
  SR_ABSENCE_ESCALATED: { bn: "টানা অনুপস্থিতি জানিয়েছেন", en: "Escalated a revision absence", group: "REVISION" },
  SR_ESCALATION_CONFIG_SET: { bn: "রিভিশনের অনুপস্থিতির সীমা বদলেছেন", en: "Set the revision escalation threshold", group: "REVISION" },

  // --- Library --------------------------------------------------------------
  BOOK_ISSUED: { bn: "বই ইস্যু করেছেন", en: "Issued a book", group: "LIBRARY" },
  BOOK_RETURNED: { bn: "বই ফেরত নিয়েছেন", en: "Took a book back", group: "LIBRARY" },
  BOOK_RENEWED: { bn: "বইয়ের মেয়াদ বাড়িয়েছেন", en: "Renewed a loan", group: "LIBRARY" },
  BOOK_MARKED_LOST: { bn: "বই হারানো চিহ্নিত করেছেন", en: "Marked a book lost", group: "LIBRARY" },
  RESERVATION_PLACED: { bn: "বইয়ের জন্য নাম লিখিয়েছেন", en: "Placed a reservation", group: "LIBRARY" },
  RESERVATION_EXPIRED: { bn: "বইয়ের সংরক্ষণের মেয়াদ শেষ", en: "A reservation expired", group: "LIBRARY" },
  LIBRARIAN_ASSIGNED: { bn: "লাইব্রেরিয়ানের দায়িত্ব দিয়েছেন", en: "Assigned librarian duty", group: "LIBRARY" },
  LIBRARY_CATALOG_CHANGED: { bn: "লাইব্রেরির ক্যাটালগ বদলেছেন", en: "Changed the library catalog", group: "LIBRARY" },

  // --- Book production ------------------------------------------------------
  BOOK_CREATED: { bn: "বই তৈরি করেছেন", en: "Created a book", group: "PUBLISHING" },
  BOOK_POLICY_ACTIVATED: { bn: "বইয়ের নীতিমালা কার্যকর করেছেন", en: "Activated a book policy", group: "PUBLISHING" },
  BOOK_PATCH_MERGED: { bn: "পাঠের সংশোধনী যুক্ত করেছেন", en: "Merged a lesson patch", group: "PUBLISHING" },
  BOOK_PATCH_REJECTED: { bn: "পাঠের সংশোধনী বাতিল হয়েছে", en: "A lesson patch was rejected", group: "PUBLISHING" },
  BOOK_REVIEW_ASSIGNED: { bn: "পাঠ পর্যালোচনার দায়িত্ব দিয়েছেন", en: "Assigned a lesson review", group: "PUBLISHING" },
  BOOK_REVIEW_SUBMITTED: { bn: "পাঠ পর্যালোচনা জমা দিয়েছেন", en: "Submitted a lesson review", group: "PUBLISHING" },
  BOOK_ESCALATION_RESOLVED: { bn: "পাঠের বিরোধ নিষ্পত্তি করেছেন", en: "Resolved a book escalation", group: "PUBLISHING" },
  BOOK_COMMENT_RESOLVED: { bn: "পাঠের মন্তব্য নিষ্পত্তি করেছেন", en: "Resolved a book comment", group: "PUBLISHING" },
  BOOK_LESSON_SIGNED_OFF: { bn: "পাঠ চূড়ান্ত অনুমোদন করেছেন", en: "Signed off a lesson", group: "PUBLISHING" },
  BOOK_BUILD_QUEUED: { bn: "বই তৈরির কাজ সারিতে দিয়েছেন", en: "Queued a book build", group: "PUBLISHING" },

  // --- Staff & HR -----------------------------------------------------------
  STAFF_PROFILE_CREATED: { bn: "কর্মীর প্রোফাইল তৈরি করেছেন", en: "Created a staff profile", group: "HR" },
  STAFF_PROFILE_UPDATED: { bn: "কর্মীর প্রোফাইল সম্পাদনা করেছেন", en: "Updated a staff profile", group: "HR" },
  HR_POLICY_SET: { bn: "এইচআর নীতিমালা বদলেছেন", en: "Set an HR policy", group: "HR" },
  STAFF_LETTER_ISSUED: { bn: "কর্মীর চিঠি ইস্যু করেছেন", en: "Issued a staff letter", group: "HR" },
  STAFF_LETTER_VOIDED: { bn: "কর্মীর চিঠি বাতিল করেছেন", en: "Voided a staff letter", group: "HR" },
  STAFF_EMPLOYMENT_CONFIRMED: { bn: "চাকরি স্থায়ী করেছেন", en: "Confirmed an employment", group: "HR" },
  PROBATION_DEBT_SETTLED: { bn: "শিক্ষানবিশকালের ছুটির হিসাব নিষ্পত্তি করেছেন", en: "Settled probation leave debt", group: "HR" },
  STAFF_LATENESS_CHARGED: { bn: "দেরির হিসাব কেটেছেন", en: "Charged lateness", group: "HR" },
  STAFF_LEAVE_ENTITLEMENT_SET: { bn: "কর্মীর ছুটির কোটা নির্ধারণ করেছেন", en: "Set a leave entitlement", group: "HR" },
  STAFF_LEAVE_SUBMITTED: { bn: "ছুটির আবেদন করেছেন", en: "Applied for leave", group: "HR" },
  STAFF_LEAVE_DECIDED: { bn: "ছুটির আবেদন নিষ্পত্তি করেছেন", en: "Decided a leave application", group: "HR" },
  STAFF_COVER_PROPOSED: { bn: "কভার শিক্ষক প্রস্তাব করেছেন", en: "Proposed a covering teacher", group: "HR" },
  STAFF_COVER_DECIDED: { bn: "কভার নিয়োগ নিষ্পত্তি করেছেন", en: "Decided a cover slot", group: "HR" },
  STAFF_PAY_SET: { bn: "কর্মীর বেতন নির্ধারণ করেছেন", en: "Set staff pay", group: "HR" },
  PAYROLL_PREPARED: { bn: "বেতনের হিসাব তৈরি করেছেন", en: "Prepared a payroll run", group: "HR" },
  PAYROLL_APPROVED: { bn: "বেতন অনুমোদন করেছেন", en: "Approved a payroll run", group: "HR" },
  PAYROLL_CANCELLED: { bn: "বেতনের হিসাব বাতিল করেছেন", en: "Cancelled a payroll run", group: "HR" },
  PAYROLL_PAYMENT_EXPORTED: { bn: "বেতন পরিশোধের তালিকা রপ্তানি করেছেন", en: "Exported the payment advice", group: "HR" },
  PAYROLL_REGISTER_EXPORTED: { bn: "বেতনের রেজিস্টার রপ্তানি করেছেন", en: "Exported the payroll register", group: "HR" },
  ADVANCE_ISSUED: { bn: "কর্জে হাসানা/অগ্রিম দিয়েছেন", en: "Issued an advance", group: "HR" },
  ADVANCE_SETTLED: { bn: "অগ্রিম নিষ্পত্তি করেছেন", en: "Settled an advance", group: "HR" },
  OBSERVATION_SUBMITTED: { bn: "কর্মীর পারফরম্যান্স পর্যবেক্ষণ জমা দিয়েছেন", en: "Submitted a performance observation", group: "HR" },
  APPRAISAL_PREPARED: { bn: "বার্ষিক মূল্যায়ন খসড়া করেছেন", en: "Prepared an appraisal", group: "HR" },
  APPRAISAL_SIGNED_OFF: { bn: "বার্ষিক মূল্যায়ন চূড়ান্ত করেছেন", en: "Signed off an appraisal", group: "HR" },
  CONDUCT_STEP_RECORDED: { bn: "শৃঙ্খলার ধাপ খসড়া করেছেন", en: "Recorded a conduct step", group: "HR" },
  CONDUCT_HEARING_RECORDED: { bn: "শৃঙ্খলার শুনানি লিপিবদ্ধ করেছেন", en: "Recorded a conduct hearing", group: "HR" },
  CONDUCT_STEP_FINALIZED: { bn: "শৃঙ্খলার সিদ্ধান্ত চূড়ান্ত করেছেন", en: "Finalised a conduct step", group: "HR" },
  CONDUCT_WARNING_LAPSED: { bn: "সতর্কতার মেয়াদ শেষ হয়েছে", en: "A warning lapsed", group: "HR" },
  STAFF_TERMINATED: { bn: "কর্মীর চাকরির অবসান করেছেন", en: "Terminated a staff member", group: "HR" },
  GRIEVANCE_RAISED: { bn: "অভিযোগ জানিয়েছেন", en: "Raised a grievance", group: "HR" },
  GRIEVANCE_UPDATED: { bn: "অভিযোগের অগ্রগতি লিখেছেন", en: "Updated a grievance", group: "HR" },
  DEVELOPMENT_LOGGED: { bn: "পেশাগত উন্নয়নের তথ্য লিখেছেন", en: "Logged development", group: "HR" },
  OFFBOARDING_INITIATED: { bn: "বিদায় প্রক্রিয়া শুরু করেছেন", en: "Initiated offboarding", group: "HR" },
  OFFBOARDING_CLEARANCE_UPDATED: { bn: "ছাড়পত্রের তালিকা হালনাগাদ করেছেন", en: "Updated an offboarding clearance", group: "HR" },
  OFFBOARDING_ACCESS_REVOKED: { bn: "বিদায়ে অ্যাকাউন্ট বন্ধ হয়েছে", en: "Revoked access on exit", group: "HR" },
  FINAL_SETTLEMENT_COMPUTED: { bn: "চূড়ান্ত হিসাব করেছেন", en: "Computed a final settlement", group: "HR" },
  FINAL_SETTLEMENT_RELEASED: { bn: "চূড়ান্ত পাওনা ছাড় করেছেন", en: "Released a final settlement", group: "HR" },
  EXIT_INTERVIEW_RECORDED: { bn: "বিদায়ী সাক্ষাৎকার লিখেছেন", en: "Recorded an exit interview", group: "HR" },
  SERVICE_CERTIFICATE_ISSUED: { bn: "অভিজ্ঞতার সনদ দিয়েছেন", en: "Issued a service certificate", group: "HR" },
  OFFBOARDING_CANCELLED: { bn: "বিদায় প্রক্রিয়া প্রত্যাহার করেছেন", en: "Cancelled an offboarding", group: "HR" },

  // --- Finance --------------------------------------------------------------
  FINANCE_OPENING_BALANCE_SET: { bn: "প্রারম্ভিক স্থিতি ঘোষণা করেছেন", en: "Set an opening balance", group: "FINANCE" },
  FINANCE_POSTING_RECORDED: { bn: "আর্থিক লেনদেন লিখেছেন", en: "Recorded a finance posting", group: "FINANCE" },
  FINANCE_POSTING_REVERSED: { bn: "আর্থিক লেনদেন বিপরীত করেছেন", en: "Reversed a finance posting", group: "FINANCE" },
  FEE_SUPPORT_ALLOCATION_SET: { bn: "ফি সহায়তা বরাদ্দ করেছেন", en: "Set a fee-support allocation", group: "FINANCE" },
  PROVIDER_RECEIPT_RECORDED: { bn: "সহায়তাদাতার প্রাপ্তি লিখেছেন", en: "Recorded a provider receipt", group: "FINANCE" },
  FINANCE_FEE_DUE_CHASED: { bn: "বকেয়া ফি-র তাগাদা দিয়েছেন", en: "Chased a fee due", group: "FINANCE" },
  FINANCE_PARTY_SET: { bn: "লেনদেনের পক্ষ যুক্ত/সম্পাদনা করেছেন", en: "Set a finance counterparty", group: "FINANCE" },
  QARD_IOU_ENTRY_RECORDED: { bn: "কর্জ/দেনা-পাওনার হিসাব লিখেছেন", en: "Recorded a Qard/IOU entry", group: "FINANCE" },
  RECONCILIATION_RECORDED: { bn: "ব্যাংক মিলকরণ লিখেছেন", en: "Recorded a reconciliation", group: "FINANCE" },
  BUDGET_LINE_SET: { bn: "বাজেটের খাত নির্ধারণ করেছেন", en: "Set a budget line", group: "FINANCE" },

  // --- Guardian work claim --------------------------------------------------
  WORK_CLAIM_FILED: { bn: "বাড়িতে কাজ হয়েছে জানিয়েছেন", en: "Filed a work claim", group: "WORK_CLAIM" },
  WORK_CLAIM_ACCEPTED: { bn: "দাবি গৃহীত হয়েছে", en: "A work claim was accepted", group: "WORK_CLAIM" },
  WORK_CLAIM_REJECTED: { bn: "দাবি নাকচ করেছেন", en: "Rejected a work claim", group: "WORK_CLAIM" },
  WORK_CLAIM_NUDGED: { bn: "শিক্ষককে আবার মনে করিয়ে দিয়েছেন", en: "Nudged the teacher on a claim", group: "WORK_CLAIM" },
  WORK_CLAIM_REASSIGNED: { bn: "দাবির দায়িত্ব অন্য শিক্ষককে দিয়েছেন", en: "Reassigned a work claim", group: "WORK_CLAIM" },
  WORK_CLAIM_EXPIRED: { bn: "উত্তর না আসায় দাবির মেয়াদ শেষ", en: "A work claim expired", group: "WORK_CLAIM" },
};

const FALLBACK_GROUP: ActivityGroup = "OTHER";

/**
 * Label for a kind read back from the database. Rows written by an older build
 * can carry a kind this build no longer declares, so an unknown string is
 * title-cased rather than dropped — the log must not hide a row it cannot name.
 */
export function auditKindLabel(kind: string): AuditKindLabel {
  const known = (AUDIT_KIND_LABELS as Record<string, AuditKindLabel | undefined>)[kind];
  if (known) return known;
  const readable = kind
    .toLowerCase()
    .split("_")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return { bn: readable, en: readable, group: FALLBACK_GROUP };
}

/** The kinds belonging to one family — the server-side expansion of a group filter. */
export function kindsInGroup(group: ActivityGroup): string[] {
  return Object.entries(AUDIT_KIND_LABELS)
    .filter(([, v]) => v.group === group)
    .map(([k]) => k);
}
