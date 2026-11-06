// =============================================================================
// STAFF MISTAKE RECORD — kinds, statuses and reason buttons (D-#936–#939)
// =============================================================================
// docs/prd-staff-mistakes.md. Server and app read the same reason list, so the button a
// teacher taps and the code the server stores never drift apart.

/** Where a mistake was caught. MR-1: the homework/assignment same-day correction;
 *  MR-3: an attendance list changed after it was submitted (D-#944);
 *  MR-4: class-test marks re-published with changes, published scripts pulled back (D-#945);
 *  MR-5: a guardian's "done at home" claim accepted, a checked / resubmit mark undone (D-#951). */
export const STAFF_MISTAKE_KINDS = [
  "MARK_CORRECTION",
  "ATTENDANCE_CORRECTION",
  "CLASS_TEST_MARKS",
  "CLASS_TEST_SCRIPTS",
  "WORK_CLAIM_ACCEPTED",
  "WORK_REVERT",
  // MR-6 (D-#954): the remaining tier-1 places — recorded on a generic StaffMistakeNote.
  "POPUP_NOTICE_CHANGE",
  "MONTHLY_REPORT_REVOKE",
  "SYLLABUS_REOPEN",
  "EXAM_ROUTINE_CHANGE",
  "STAFF_LETTER_VOID",
  "PAYROLL_REOPEN",
  "FINANCE_REVERSAL",
  "MASTERY_CORRECTION",
  "QURAN_EXAM_CORRECTION",
  "CLASS_NOTE_CHANGE",
  // MR-7 (D-#953): tier 2 — someone else caught it before it reached anyone.
  "CT_RESULT_SENT_BACK",
  "CT_DETAILS_FIXED",
  "CT_REQUEST_CHANGED",
  "CT_PAPER_SENT_BACK",
  "HW_ITEM_VOIDED",
  "ASSIGNMENT_ITEM_CHANGED",
  "COMMENT_REVISED",
  "OBSERVATION_REJECTED",
  "OBSERVATION_RESTORED",
  "TASK_REOPENED",
  "SCRIPTS_RECEIVE_UNDONE",
  "COVER_CANCELLED",
  "ROUTINE_CELL_REVISED",
  "LEAVE_REDECIDED",
  "PRINT_CANCELLED",
  // MR-8 (D-#955): tier 3 — a duty missed or late, caught by the sweeps that already chase it.
  "ATTENDANCE_NOT_MARKED",
  "HW_PASS_SKIPPED",
  "ASSIGNMENT_UNMARKED",
  "OBSERVATION_NO_RESPONSE",
  "TASK_OVERDUE",
  "WORK_CLAIM_UNANSWERED",
  // MR-9: the places deferred from MR-6..8 — tier 1 (D-#1001, D-#1002), tier 3 (D-#1003), tier 2 (D-#1004).
  "QURAN_EXAM_UNLOCK_CHANGE",
  "REVISION_ENTRY_CORRECTED",
  "CT_MARKS_OVERDUE",
  "QUESTION_RESTORED",
  "STAFF_ATTENDANCE_REIMPORTED",
  "SALARY_ENTERED_TWICE",
  "GUARDIAN_LINK_UNDONE",
  "ABSENT_AT_DELIVERY",
] as const;
export type StaffMistakeKind = (typeof STAFF_MISTAKE_KINDS)[number];

/**
 * What happened, in one Bangla line per place — the server's copy of the app's
 * `smrKindTitle_*` labels, for the "please explain" notice (D-#1012): a notice that says only
 * "a mistake was caught" gives the person nothing to go on.
 */
export const STAFF_MISTAKE_KIND_TITLE_BN: Record<StaffMistakeKind, string> = {
  MARK_CORRECTION: "একই দিনে \"জমা দেয়নি\" বদলানো",
  ATTENDANCE_CORRECTION: "জমা দেওয়া উপস্থিতি বদলানো হয়েছে",
  CLASS_TEST_MARKS: "প্রকাশের পর ক্লাস টেস্টের নম্বর বদলানো হয়েছে",
  CLASS_TEST_SCRIPTS: "প্রকাশিত খাতা ফেরত নেওয়া হয়েছে",
  WORK_CLAIM_ACCEPTED: "অভিভাবকের দাবি মানা হয়েছে — \"জমা দেয়নি\" ভুল ছিল",
  WORK_REVERT: "দেওয়া চিহ্ন ফেরানো হয়েছে",
  POPUP_NOTICE_CHANGE: "দেখার পর পপ-আপ বার্তা বদলানো / বন্ধ করা হয়েছে",
  MONTHLY_REPORT_REVOKE: "পাঠানো মাসিক রিপোর্ট ফেরত নেওয়া হয়েছে",
  SYLLABUS_REOPEN: "প্রকাশিত সিলেবাস বদলানো হয়েছে",
  EXAM_ROUTINE_CHANGE: "প্রকাশিত পরীক্ষার রুটিন বদলানো হয়েছে",
  STAFF_LETTER_VOID: "পাঠানো পত্র বাতিল করা হয়েছে",
  PAYROLL_REOPEN: "লক করা বেতন আবার খোলা হয়েছে",
  FINANCE_REVERSAL: "হিসাবের এন্ট্রি উল্টানো হয়েছে",
  MASTERY_CORRECTION: "নিশ্চিত করার পর ফল বদলানো হয়েছে",
  QURAN_EXAM_CORRECTION: "কুরআন পরীক্ষায় অনুপস্থিত চিহ্ন বদলানো হয়েছে",
  CLASS_NOTE_CHANGE: "প্রকাশিত ক্লাস নোট বদলানো / মুছে ফেলা হয়েছে",
  CT_RESULT_SENT_BACK: "অফিস ক্লাস টেস্টের ফল ফেরত পাঠিয়েছে",
  CT_DETAILS_FIXED: "ক্লাস টেস্টের মোট / পাস নম্বর সংশোধন করা হয়েছে",
  CT_REQUEST_CHANGED: "অফিস টাইপ করার পরে প্রশ্নের অনুরোধ বদলানো / বাতিল হয়েছে",
  CT_PAPER_SENT_BACK: "শিক্ষক প্রশ্নপত্র সংশোধনের জন্য ফেরত পাঠিয়েছেন",
  HW_ITEM_VOIDED: "অফিস বাড়ির কাজ বাতিল করেছে",
  ASSIGNMENT_ITEM_CHANGED: "দেওয়ার পর অ্যাসাইনমেন্ট বদলানো হয়েছে",
  COMMENT_REVISED: "পর্যালোচক মন্তব্য বদলেছেন / বাতিল করেছেন",
  OBSERVATION_REJECTED: "পর্যবেক্ষক ভিডিও দেখার মতো নয় বলে বাতিল করেছেন",
  OBSERVATION_RESTORED: "বাতিল করা পর্যবেক্ষণ আবার ফেরানো হয়েছে",
  TASK_REOPENED: "সম্পন্ন দেওয়া কাজ আবার খোলা হয়েছে",
  SCRIPTS_RECEIVE_UNDONE: "খাতা গ্রহণ ফেরানো হয়েছে",
  COVER_CANCELLED: "দেওয়া প্রক্সি বাতিল করা হয়েছে",
  ROUTINE_CELL_REVISED: "কার্যকর হওয়ার আগেই রুটিনের ঘর বদলানো হয়েছে",
  LEAVE_REDECIDED: "ছুটির সিদ্ধান্ত বদলানো হয়েছে",
  PRINT_CANCELLED: "অফিস প্রিন্টের অনুরোধ বাতিল করেছে",
  ATTENDANCE_NOT_MARKED: "সময়মতো উপস্থিতি নেওয়া হয়নি",
  HW_PASS_SKIPPED: "বাড়ির কাজ যাচাই করা হয়নি — অ্যাপ নিজে \"জমা দেয়নি\" দিয়েছে",
  ASSIGNMENT_UNMARKED: "অ্যাসাইনমেন্টের নম্বর সময়মতো দেওয়া হয়নি",
  OBSERVATION_NO_RESPONSE: "পর্যবেক্ষণের ভিডিওর উত্তর দেওয়া হয়নি",
  TASK_OVERDUE: "নির্ধারিত দিনে কাজ শেষ হয়নি",
  WORK_CLAIM_UNANSWERED: "অভিভাবকের কাজ জমার দাবির উত্তর দেওয়া হয়নি",
  QURAN_EXAM_UNLOCK_CHANGE: "লক হওয়া নম্বর আনলকের পরে বদলানো হয়েছে",
  REVISION_ENTRY_CORRECTED: "পাঠানো রিভিশনের এন্ট্রি সংশোধন করতে হয়েছে",
  CT_MARKS_OVERDUE: "শেষ দিনের মধ্যে ক্লাস টেস্টের নম্বর জমা হয়নি",
  QUESTION_RESTORED: "বাতিল করা প্রশ্ন অন্যজন আবার ফিরিয়েছেন",
  STAFF_ATTENDANCE_REIMPORTED: "অন্যজন নতুন শিট দেওয়ায় উপস্থিতি বদলেছে",
  SALARY_ENTERED_TWICE: "একই মাসের বেতন আবার এন্ট্রি হয়েছে",
  GUARDIAN_LINK_UNDONE: "অভিভাবকের সংযোগ অল্প দিনেই খুলে ফেলা হয়েছে",
  ABSENT_AT_DELIVERY: "খাতায় উপস্থিত শিক্ষার্থীকে কাজ দেওয়ার সময় অনুপস্থিত দেখানো হয়েছে",
};

export const STAFF_MISTAKE_STATUSES = ["EXPLANATION_DUE", "PENDING_REVIEW", "COUNTED", "EXCUSED", "MOVED"] as const;
export type StaffMistakeStatus = (typeof STAFF_MISTAKE_STATUSES)[number];

export const STAFF_MISTAKE_DECISIONS = ["EXCUSE", "COUNT", "MOVE"] as const;
export type StaffMistakeDecision = (typeof STAFF_MISTAKE_DECISIONS)[number];

export interface StaffMistakeReason {
  code: string;
  bn: string;
  en: string;
  /** Bangla hint under the button. */
  hintBn: string;
  /** The person admits it — counted at once, no review. */
  selfCounts?: boolean;
  /** Free text is required with this reason. */
  needsText?: boolean;
  /** Not a mistake at all — accepted at once, no review (D-#944, the mockup's dashed buttons). */
  autoExcuses?: boolean;
}

const MINE_REASON: StaffMistakeReason = { code: "MINE", bn: "আমার ভুল ছিল", en: "It was my mistake", hintBn: "ভুলটা আমার", selfCounts: true };
const OTHER_REASON: StaffMistakeReason = { code: "OTHER", bn: "অন্য কারণ", en: "Another reason", hintBn: "নিচে নিজের ভাষায় লিখুন", needsText: true };
/** The missed-duty frame (D-#955): an approved leave is accepted at once (the sweep checks it
 *  itself first); "I forgot" counts; the rest go to review. */
const DUTY_REASONS: readonly StaffMistakeReason[] = [
  { code: "ON_LEAVE", bn: "ছুটিতে ছিলাম", en: "I was on leave", hintBn: "অনুমোদিত ছুটি থাকলে নিজে থেকেই গ্রহণযোগ্য", autoExcuses: true },
  { code: "PROXY_HAD_IT", bn: "প্রক্সি দায়িত্বে ছিল", en: "A cover teacher had it", hintBn: "দায় প্রক্সির — যাচাইকারী সরাতে পারবেন" },
  { code: "APP_PROBLEM", bn: "অ্যাপ / ইন্টারনেট সমস্যা", en: "App or internet problem", hintBn: "" },
  { code: "OTHER_DUTY", bn: "অন্য দায়িত্বে ছিলাম", en: "I was on another duty", hintBn: "" },
  { code: "FORGOT", bn: "ভুলে গিয়েছিলাম", en: "I forgot", hintBn: "", selfCounts: true },
  { code: "OTHER", bn: "অন্য কারণ", en: "Another reason", hintBn: "নিচে নিজের ভাষায় লিখুন", needsText: true },
];

/** MINE + the place's own buttons + OTHER (MR-6 places share the frame). */
const withFrame = (...own: StaffMistakeReason[]): readonly StaffMistakeReason[] => [MINE_REASON, ...own, OTHER_REASON];

export const STAFF_MISTAKE_REASONS: Record<StaffMistakeKind, readonly StaffMistakeReason[]> = {
  MARK_CORRECTION: [
    { code: "MINE", bn: "আমার ভুল ছিল", en: "It was my mistake", hintBn: "ভুল করে \"জমা দেয়নি\" চিহ্নিত করেছিলাম", selfCounts: true },
    { code: "LATE_DIRECT", bn: "পরে সরাসরি আমার কাছে জমা দিয়েছে", en: "Handed to me directly later", hintBn: "ক্লাস ক্যাপ্টেন / অফিসে জমা দেয়নি; ক্লাসে যাওয়ার পর আমার হাতে দিয়েছে" },
    { code: "OFFICE_LATE", bn: "অফিস থেকে খাতা দেরিতে বা কম পেয়েছি", en: "Office handed the scripts over late or short", hintBn: "অফিসে জমা ছিল, কিন্তু আমার কাছে পৌঁছায়নি" },
    { code: "OTHER", bn: "অন্য কারণ", en: "Another reason", hintBn: "নিচে নিজের ভাষায় লিখুন", needsText: true },
  ],
  ATTENDANCE_CORRECTION: [
    { code: "MINE", bn: "আমার ভুল ছিল", en: "It was my mistake", hintBn: "ভুল শিক্ষার্থীকে অনুপস্থিত / উপস্থিত দিয়েছিলাম", selfCounts: true },
    { code: "LATE_ARRIVAL", bn: "শিক্ষার্থী দেরিতে এসেছে", en: "The student came late", hintBn: "উপস্থিতি নেওয়ার পরে ক্লাসে এসেছে", autoExcuses: true },
    { code: "AWAY", bn: "শিক্ষার্থী অন্য কাজে বাইরে ছিল", en: "The student was away on other work", hintBn: "অফিস / অনুষ্ঠান / অন্য শিক্ষকের কাছে", autoExcuses: true },
    { code: "OTHER", bn: "অন্য কারণ", en: "Another reason", hintBn: "নিচে নিজের ভাষায় লিখুন", needsText: true },
  ],
  CLASS_TEST_MARKS: [
    { code: "ADDITION", bn: "যোগে ভুল", en: "An addition mistake", hintBn: "নম্বর যোগ করতে ভুল হয়েছিল", selfCounts: true },
    { code: "WRONG_STUDENT", bn: "ভুল শিক্ষার্থীর ঘরে নম্বর", en: "Marks in the wrong student's row", hintBn: "একজনের নম্বর আরেকজনের ঘরে দিয়েছিলাম", selfCounts: true },
    { code: "LATE_SCRIPT", bn: "খাতা পরে পাওয়া গেছে", en: "The script turned up later", hintBn: "অনুপস্থিত / না পাওয়া খাতা পরে পাওয়া গেছে", autoExcuses: true },
    { code: "OTHER", bn: "অন্য কারণ", en: "Another reason", hintBn: "নিচে নিজের ভাষায় লিখুন", needsText: true },
  ],
  CLASS_TEST_SCRIPTS: [
    { code: "MINE", bn: "আমার ভুল ছিল", en: "It was my mistake", hintBn: "ভুল পাতা যুক্ত / ভুলে প্রকাশ করেছিলাম", selfCounts: true },
    { code: "WRONG_PAGE", bn: "পাতা ভুল শিক্ষার্থীর সাথে যুক্ত ছিল", en: "A page was on the wrong student", hintBn: "পাতা যিনি যুক্ত করেছেন, তাঁর ভুল হতে পারে" },
    { code: "UNCLEAR_SCAN", bn: "স্ক্যান অস্পষ্ট ছিল", en: "The scan was unclear", hintBn: "আবার স্ক্যান করতে হয়েছে" },
    { code: "OTHER", bn: "অন্য কারণ", en: "Another reason", hintBn: "নিচে নিজের ভাষায় লিখুন", needsText: true },
  ],
  WORK_CLAIM_ACCEPTED: [
    { code: "MINE", bn: "আমার ভুল ছিল", en: "It was my mistake", hintBn: "ভুল করে \"জমা দেয়নি\" দিয়েছিলাম", selfCounts: true },
    { code: "WITH_OTHER", bn: "খাতা অন্যের কাছে ছিল", en: "The script was with someone else", hintBn: "অফিস / ক্যাপ্টেন / অন্য শিক্ষকের কাছে ছিল" },
    { code: "SHOWN_LATER", bn: "শিক্ষার্থী পরে দেখিয়েছে", en: "The student showed it later", hintBn: "জমার দিনে দেখায়নি, পরে দেখিয়েছে", autoExcuses: true },
    { code: "OTHER", bn: "অন্য কারণ", en: "Another reason", hintBn: "নিচে নিজের ভাষায় লিখুন", needsText: true },
  ],
  WORK_REVERT: [
    { code: "WRONG_ROW", bn: "ভুল শিক্ষার্থীর ঘরে চাপ পড়েছে", en: "Tapped the wrong student's row", hintBn: "অন্য শিক্ষার্থীর ঘরে চিহ্ন দিয়েছিলাম", selfCounts: true },
    { code: "RECHECKED", bn: "খাতা আবার দেখে বদলেছি", en: "Changed it after checking again", hintBn: "দ্বিতীয়বার দেখে ফল বদলাতে হয়েছে" },
    { code: "OTHER", bn: "অন্য কারণ", en: "Another reason", hintBn: "নিচে নিজের ভাষায় লিখুন", needsText: true },
  ],
  POPUP_NOTICE_CHANGE: withFrame(
    { code: "WRONG_AUDIENCE", bn: "ভুল জনদের পাঠানো হয়েছিল", en: "Sent to the wrong people", hintBn: "প্রাপক বাছাইয়ে ভুল" },
    { code: "PLAN_CHANGED", bn: "পরিকল্পনা বদলেছে", en: "The plan changed", hintBn: "তারিখ / সময় / অনুষ্ঠান বদলেছে — বার্তা ঠিক ছিল", autoExcuses: true },
  ),
  MONTHLY_REPORT_REVOKE: withFrame(
    { code: "LATE_DATA", bn: "শিক্ষকের তথ্য দেরিতে এসেছে", en: "A teacher's data came late", hintBn: "রিপোর্টের পরে নম্বর / উপস্থিতি যোগ হয়েছে" },
    { code: "LEAVE_LATE", bn: "ছুটি পরে অনুমোদিত হয়েছে", en: "A leave was approved later", hintBn: "অনুপস্থিতি পরে ছুটি হিসেবে গণ্য", autoExcuses: true },
  ),
  SYLLABUS_REOPEN: withFrame(
    { code: "WRONG_CHAPTER", bn: "অধ্যায় / নম্বর ভুল ছিল", en: "A chapter or the marks were wrong", hintBn: "প্রকাশের আগে মেলানো হয়নি", selfCounts: true },
    { code: "POLICY", bn: "নীতিগত পরিবর্তন", en: "A policy change", hintBn: "স্কুল সিলেবাস বদলেছে", autoExcuses: true },
  ),
  EXAM_ROUTINE_CHANGE: withFrame(
    { code: "WRONG_TIME", bn: "তারিখ / সময় ভুল ছিল", en: "A date or time was wrong", hintBn: "প্রকাশের আগে মেলানো হয়নি", selfCounts: true },
    { code: "POLICY", bn: "পরীক্ষার তারিখ বদলেছে", en: "The exam was rescheduled", hintBn: "ছুটি / অনুষ্ঠানের জন্য স্কুল বদলেছে", autoExcuses: true },
  ),
  STAFF_LETTER_VOID: withFrame(
    { code: "WRONG_DETAIL", bn: "নাম / তারিখ / অঙ্ক ভুল ছিল", en: "A name, date or amount was wrong", hintBn: "ইস্যুর আগে মেলানো হয়নি", selfCounts: true },
    { code: "TERMS_CHANGED", bn: "শর্ত বদলেছে", en: "The terms changed", hintBn: "পত্র ঠিক ছিল, পরে সিদ্ধান্ত বদলেছে", autoExcuses: true },
  ),
  PAYROLL_REOPEN: withFrame(
    { code: "LATE_SHEET", bn: "উপস্থিতির শিট দেরিতে এসেছে", en: "The attendance sheet came late", hintBn: "লকের পরে শিট এসেছে" },
    { code: "RAISE_LATER", bn: "পরে বেতন বাড়ানো হয়েছে", en: "A raise was backdated", hintBn: "লকের পরে আগের মাস থেকে বেতন বাড়ানো", autoExcuses: true },
  ),
  FINANCE_REVERSAL: withFrame(
    { code: "WRONG_AMOUNT", bn: "অঙ্ক / শিক্ষার্থী ভুল ছিল", en: "The amount or student was wrong", hintBn: "এন্ট্রির সময় ভুল", selfCounts: true },
    { code: "REFUND", bn: "টাকা ফেরত / চেক ফেরত", en: "A refund or a bounced cheque", hintBn: "এন্ট্রি ঠিক ছিল", autoExcuses: true },
  ),
  MASTERY_CORRECTION: withFrame(
    { code: "WRONG_ROW", bn: "ভুল ঘরে নম্বর দিয়েছিলাম", en: "Marks in the wrong box", hintBn: "অন্য প্রশ্ন / শিক্ষার্থীর ঘরে", selfCounts: true },
    { code: "LATE_SCRIPT", bn: "খাতা পরে পাওয়া গেছে", en: "The script turned up later", hintBn: "নিশ্চিত করার পরে খাতা পাওয়া গেছে", autoExcuses: true },
  ),
  QURAN_EXAM_CORRECTION: withFrame(
    { code: "EXAMINER_CHANGED", bn: "পরীক্ষক বদল হয়েছে", en: "The examiner changed", hintBn: "অন্য পরীক্ষক পরে পরীক্ষা নিয়েছেন", autoExcuses: true },
  ),
  CLASS_NOTE_CHANGE: withFrame(
    { code: "WRONG_LESSON", bn: "ভুল পাঠ / ফাইল দিয়েছিলাম", en: "Wrong lesson or file", hintBn: "অন্য ক্লাসের নোট / ভুল সংযুক্তি", selfCounts: true },
    { code: "HW_ADDED", bn: "পরে বাড়ির কাজ যোগ করেছি", en: "Added the homework later", hintBn: "নোট ঠিক ছিল, শুধু যোগ করা", autoExcuses: true },
  ),
  CT_RESULT_SENT_BACK: [
    MINE_REASON,
    { code: "ADDITION", bn: "যোগে / নম্বরে ভুল ছিল", en: "A marks mistake", hintBn: "অফিস ধরেছে", selfCounts: true },
    { code: "OFFICE_MISREAD", bn: "অফিস ভুল বুঝেছে", en: "The Office misread it", hintBn: "নম্বর ঠিকই ছিল" },
    OTHER_REASON,
  ],
  CT_DETAILS_FIXED: [
    MINE_REASON,
    { code: "TYPO", bn: "টাইপে ভুল", en: "A typing mistake", hintBn: "মোট / পাস নম্বর ভুল লিখেছিলাম", selfCounts: true },
    { code: "POSTPONED", bn: "পরীক্ষা বদলেছে", en: "The exam changed", hintBn: "প্রশ্নের মান বদলাতে হয়েছে", autoExcuses: true },
    OTHER_REASON,
  ],
  CT_REQUEST_CHANGED: [
    MINE_REASON,
    { code: "WRONG_CHAPTER", bn: "ভুল অধ্যায় / নম্বর দিয়েছিলাম", en: "Wrong chapter or marks", hintBn: "অফিস টাইপ শুরু করার পরে বদলাতে হয়েছে", selfCounts: true },
    { code: "EXAM_CHANGED", bn: "পরীক্ষা বাতিল / বদলেছে", en: "The exam was cancelled or changed", hintBn: "স্কুলের সিদ্ধান্ত", autoExcuses: true },
    OTHER_REASON,
  ],
  CT_PAPER_SENT_BACK: [
    MINE_REASON,
    { code: "TYPO", bn: "টাইপে ভুল", en: "A typing mistake", hintBn: "প্রশ্ন / নম্বর ভুল টাইপ হয়েছে", selfCounts: true },
    { code: "TEACHER_CHANGED", bn: "শিক্ষক পরে প্রশ্ন বদলেছেন", en: "The teacher changed the questions", hintBn: "আমার টাইপ ঠিক ছিল", autoExcuses: true },
    OTHER_REASON,
  ],
  HW_ITEM_VOIDED: [
    MINE_REASON,
    { code: "NOTE_AS_HW", bn: "ক্লাস নোটকে বাড়ির কাজ দিয়েছি", en: "Filed a class note as homework", hintBn: "", selfCounts: true },
    { code: "WRONG_CLASS", bn: "ভুল শ্রেণিতে দিয়েছি", en: "Filed it for the wrong class", hintBn: "", selfCounts: true },
    OTHER_REASON,
  ],
  ASSIGNMENT_ITEM_CHANGED: [
    MINE_REASON,
    { code: "WRONG_QUESTION", bn: "ভুল প্রশ্ন দিয়েছিলাম", en: "Gave the wrong questions", hintBn: "", selfCounts: true },
    { code: "NOT_TAUGHT", bn: "অধ্যায় এখনো পড়ানো হয়নি", en: "The chapter was not taught yet", hintBn: "পরে বুঝেছি" },
    OTHER_REASON,
  ],
  COMMENT_REVISED: [
    MINE_REASON,
    { code: "TONE", bn: "ভাষা ঠিক ছিল না", en: "The wording was not right", hintBn: "", selfCounts: true },
    { code: "WRONG_STUDENT", bn: "ভুল শিক্ষার্থীর মন্তব্য", en: "Wrong student", hintBn: "", selfCounts: true },
    OTHER_REASON,
  ],
  OBSERVATION_REJECTED: [
    MINE_REASON,
    { code: "WRONG_VIDEO", bn: "ভুল দিনের ভিডিও দিয়েছি", en: "Uploaded the wrong day's video", hintBn: "", selfCounts: true },
    { code: "CAMERA", bn: "ক্যামেরা / রেকর্ডিং সমস্যা", en: "A camera or recording problem", hintBn: "", autoExcuses: true },
    OTHER_REASON,
  ],
  OBSERVATION_RESTORED: [
    MINE_REASON,
    { code: "WRONG_CANCEL", bn: "ভুল ভিডিও বাতিল করেছিলাম", en: "Cancelled the wrong video", hintBn: "", selfCounts: true },
    OTHER_REASON,
  ],
  TASK_REOPENED: [
    MINE_REASON,
    { code: "EARLY_DONE", bn: "ভুলে সম্পন্ন চেপেছি", en: "Marked done by mistake", hintBn: "", selfCounts: true },
    { code: "SCOPE_GREW", bn: "কাজের পরিধি বেড়েছে", en: "The task grew", hintBn: "", autoExcuses: true },
    OTHER_REASON,
  ],
  SCRIPTS_RECEIVE_UNDONE: [
    MINE_REASON,
    { code: "MISCOUNT", bn: "গুনতে ভুল", en: "Miscounted", hintBn: "", selfCounts: true },
    { code: "WRONG_TEST", bn: "ভুল পরীক্ষায় গ্রহণ করেছি", en: "Received under the wrong test", hintBn: "", selfCounts: true },
    OTHER_REASON,
  ],
  COVER_CANCELLED: [
    MINE_REASON,
    { code: "WRONG_TEACHER", bn: "ভুল শিক্ষককে দিয়েছিলাম", en: "Gave it to the wrong teacher", hintBn: "", selfCounts: true },
    { code: "CAME_IN", bn: "শিক্ষক পরে এসেছেন", en: "The teacher came in after all", hintBn: "", autoExcuses: true },
    OTHER_REASON,
  ],
  ROUTINE_CELL_REVISED: [
    MINE_REASON,
    { code: "WRONG_CELL", bn: "ভুল শিক্ষক / বিষয় দিয়েছিলাম", en: "Wrong teacher or subject", hintBn: "", selfCounts: true },
    { code: "POLICY", bn: "রুটিনের নীতি বদলেছে", en: "The routine plan changed", hintBn: "", autoExcuses: true },
    OTHER_REASON,
  ],
  LEAVE_REDECIDED: [
    MINE_REASON,
    { code: "WRONG_DATES", bn: "ভুল তারিখ / ধরনে অনুমোদন", en: "Approved the wrong dates or type", hintBn: "", selfCounts: true },
    { code: "WITHDRAWN", bn: "কর্মী নিজে ছুটি তুলে নিয়েছেন", en: "The staff member withdrew it", hintBn: "", autoExcuses: true },
    OTHER_REASON,
  ],
  ATTENDANCE_NOT_MARKED: DUTY_REASONS,
  HW_PASS_SKIPPED: DUTY_REASONS,
  ASSIGNMENT_UNMARKED: DUTY_REASONS,
  OBSERVATION_NO_RESPONSE: DUTY_REASONS,
  TASK_OVERDUE: DUTY_REASONS,
  WORK_CLAIM_UNANSWERED: DUTY_REASONS,
  PRINT_CANCELLED: [
    MINE_REASON,
    { code: "WRONG_REQUEST", bn: "ভুল অনুরোধ দিয়েছিলাম", en: "Filed the wrong request", hintBn: "", selfCounts: true },
    { code: "NOT_NEEDED", bn: "আর দরকার নেই", en: "No longer needed", hintBn: "পরীক্ষা / কাজ বাতিল", autoExcuses: true },
    OTHER_REASON,
  ],
  QURAN_EXAM_UNLOCK_CHANGE: [
    MINE_REASON,
    { code: "WRONG_ENTRY", bn: "ভুল নম্বর / ভুল শিক্ষার্থীর ঘরে দিয়েছিলাম", en: "Entered the wrong marks or student", hintBn: "", selfCounts: true },
    { code: "RECHECKED", bn: "পুনর্মূল্যায়নে নম্বর বদলেছে", en: "The marks changed on a recheck", hintBn: "পরীক্ষক / প্রধান শিক্ষকের সিদ্ধান্ত", autoExcuses: true },
    OTHER_REASON,
  ],
  REVISION_ENTRY_CORRECTED: [
    MINE_REASON,
    { code: "WRONG_STUDENT", bn: "ভুল শিক্ষার্থীর ঘরে লিখেছিলাম", en: "Wrote it under the wrong student", hintBn: "", selfCounts: true },
    { code: "WRONG_PORTION", bn: "ভুল পারা / সূরা / নম্বর লিখেছিলাম", en: "Wrote the wrong portion or marks", hintBn: "", selfCounts: true },
    OTHER_REASON,
  ],
  CT_MARKS_OVERDUE: DUTY_REASONS,
  QUESTION_RESTORED: [
    MINE_REASON,
    { code: "WRONG_QUESTION", bn: "ভুল প্রশ্ন বাতিল করেছিলাম", en: "Retired the wrong question", hintBn: "", selfCounts: true },
    { code: "POLICY", bn: "প্রশ্ন রাখার সিদ্ধান্ত পরে বদলেছে", en: "The decision to keep it changed later", hintBn: "প্রধান শিক্ষক / বিষয় প্রধানের সিদ্ধান্ত", autoExcuses: true },
    OTHER_REASON,
  ],
  STAFF_ATTENDANCE_REIMPORTED: [
    MINE_REASON,
    { code: "WRONG_FILE", bn: "ভুল দিনের / অসম্পূর্ণ শিট দিয়েছিলাম", en: "Uploaded the wrong or an incomplete sheet", hintBn: "", selfCounts: true },
    { code: "MACHINE", bn: "মেশিনের শিট পরে ঠিক হয়েছে", en: "The machine sheet was corrected later", hintBn: "মেশিন / সফটওয়্যারের সমস্যা", autoExcuses: true },
    OTHER_REASON,
  ],
  SALARY_ENTERED_TWICE: [
    MINE_REASON,
    { code: "DUPLICATE", bn: "একই বেতন দুবার লিখেছি", en: "Entered the same salary twice", hintBn: "", selfCounts: true },
    { code: "INSTALMENT", bn: "বেতন দুই কিস্তিতে দেওয়া হয়েছে", en: "Salary was paid in two instalments", hintBn: "দুটি এন্ট্রিই ঠিক", autoExcuses: true },
    OTHER_REASON,
  ],
  GUARDIAN_LINK_UNDONE: [
    MINE_REASON,
    { code: "WRONG_CHILD", bn: "ভুল শিক্ষার্থীর সাথে যুক্ত করেছিলাম", en: "Linked to the wrong child", hintBn: "", selfCounts: true },
    { code: "FAMILY_ASKED", bn: "পরিবার পরে বদলাতে বলেছে", en: "The family asked to change it", hintBn: "", autoExcuses: true },
    OTHER_REASON,
  ],
  ABSENT_AT_DELIVERY: [
    MINE_REASON,
    { code: "LEFT_EARLY", bn: "শিক্ষার্থী তখন ক্লাসে ছিল না", en: "The child was not in class then", hintBn: "আগে চলে গেছে / অন্য কাজে ছিল", autoExcuses: true },
    { code: "REGISTER_WRONG", bn: "উপস্থিতির খাতাই ভুল ছিল", en: "The attendance register was wrong", hintBn: "খাতায় যিনি উপস্থিতি দিয়েছেন — যাচাইকারী সরাতে পারবেন" },
    OTHER_REASON,
  ],
};

export const STAFF_MISTAKE_TEXT_MAX = 500;

export function staffMistakeReason(kind: StaffMistakeKind, code: string): StaffMistakeReason | undefined {
  return STAFF_MISTAKE_REASONS[kind].find((r) => r.code === code);
}

/**
 * Validate a reason for a kind. Returns a Bangla error message, or null when it is fine.
 * The text is trimmed by the caller.
 */
export function staffMistakeReasonError(kind: StaffMistakeKind, code: string, text: string): string | null {
  const reason = staffMistakeReason(kind, code);
  if (!reason) return "অজানা কারণ";
  if (reason.needsText && !text) return "এই কারণের সাথে বিস্তারিত লিখতে হবে";
  if (text.length > STAFF_MISTAKE_TEXT_MAX) return `বিস্তারিত ${STAFF_MISTAKE_TEXT_MAX} অক্ষরের মধ্যে লিখুন`;
  return null;
}

// -----------------------------------------------------------------------------
// MR-2 (D-#940–#942, #1005): the warning ladder, the deadline choice and per-place switches
// -----------------------------------------------------------------------------

/** WARNING = a pop-up to the person; MEETING = a face-to-face talk is booked; CONDUCT = the
 *  Principal is told to consider a conduct step (never opened automatically). */
export const STAFF_WARNING_STEPS = ["WARNING", "MEETING", "CONDUCT"] as const;
export type StaffWarningStep = (typeof STAFF_WARNING_STEPS)[number];

export const STAFF_MISTAKE_DEADLINES = ["NEXT_SCHOOL_DAY", "HOURS_24", "SCHOOL_DAYS_3"] as const;
export type StaffMistakeDeadline = (typeof STAFF_MISTAKE_DEADLINES)[number];

export interface StaffMistakeRung {
  step: StaffWarningStep;
  /** Weighted counted mistakes that reach this step… */
  count: number;
  /** …within this many days. */
  windowDays: number;
}

export interface StaffMistakeSettingsShape {
  rungs: StaffMistakeRung[];
  /** What one counted mistake of each tier adds to the ladder. */
  tierWeights: { 1: number; 2: number; 3: number };
  deadline: StaffMistakeDeadline;
  /** Places switched off: nothing is recorded for them. */
  disabledKinds: string[];
}

export const STAFF_MISTAKE_DEFAULT_SETTINGS: StaffMistakeSettingsShape = {
  rungs: [
    { step: "WARNING", count: 3, windowDays: 30 },
    { step: "MEETING", count: 5, windowDays: 30 },
    { step: "CONDUCT", count: 8, windowDays: 90 },
  ],
  tierWeights: { 1: 1, 2: 0.5, 3: 0.5 },
  deadline: "NEXT_SCHOOL_DAY",
  // D-#1015: the overdue-task check starts off; the Principal switches it on in the rules.
  disabledKinds: ["TASK_OVERDUE"],
};

/** Bangla error for a bad settings write, or null. */
export function staffMistakeSettingsError(s: StaffMistakeSettingsShape): string | null {
  if (s.rungs.length !== STAFF_WARNING_STEPS.length) return "তিনটি ধাপই দিতে হবে";
  for (const step of STAFF_WARNING_STEPS) {
    const r = s.rungs.find((x) => x.step === step);
    if (!r) return "তিনটি ধাপই দিতে হবে";
    if (!Number.isInteger(r.count) || r.count < 1 || r.count > 50) return "ভুলের সংখ্যা ১ থেকে ৫০ এর মধ্যে দিন";
    if (!Number.isInteger(r.windowDays) || r.windowDays < 1 || r.windowDays > 365) return "দিনের সংখ্যা ১ থেকে ৩৬৫ এর মধ্যে দিন";
  }
  for (const t of [1, 2, 3] as const) {
    const w = s.tierWeights[t];
    if (typeof w !== "number" || !(w >= 0) || w > 5) return "ওজন ০ থেকে ৫ এর মধ্যে দিন";
  }
  if (!(STAFF_MISTAKE_DEADLINES as readonly string[]).includes(s.deadline)) return "অজানা সময়সীমা";
  return null;
}
