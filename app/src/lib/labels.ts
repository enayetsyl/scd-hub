/**
 * Bilingual display labels (NFR-5). The app renders Bangla **or** English per the
 * user's chosen language (see state/LanguageContext). Operational vocabulary is
 * looked up from the shared *_LABELS_BN / *_LABELS_EN maps (single source of
 * truth); UI chrome strings live in STR_BN / STR_EN. English codes stay on form
 * fields / tracker columns per the glossary.
 *
 * Reactivity: the active language is a module-level variable read at render time
 * by `STR` (a Proxy) and the label functions below. LanguageContext flips it via
 * `setActiveLang` and remounts the navigation subtree, so every screen re-reads
 * the current language. Do not cache `STR.foo` across a language change.
 */
import {
  SUBJECT_LABELS_BN,
  SUBJECT_LABELS_EN,
  DIFFICULTY_LABELS_BN,
  DIFFICULTY_LABELS_EN,
  PAPER_ROLE_LABELS_BN,
  PAPER_ROLE_LABELS_EN,
  REVIEW_STATUS_LABELS_BN,
  REVIEW_STATUS_LABELS_EN,
  REVIEW_VERDICT_LABELS_BN,
  REVIEW_VERDICT_LABELS_EN,
  CURATION_TAG_LABELS_BN,
  CURATION_TAG_LABELS_EN,
  SET_TYPE_LABELS_BN,
  SET_TYPE_LABELS_EN,
  TRACKER_KIND_LABELS_BN,
  TRACKER_KIND_LABELS_EN,
  DOC_TYPE_LABELS_BN,
  DOC_TYPE_LABELS_EN,
  type Subject,
  type Difficulty,
  type PaperRole,
  type ReviewStatus,
  type ReviewVerdict,
  type CurationTag,
  ROSTER_CLASS_LABELS_BN,
  ROSTER_CLASS_LABELS_EN,
  HR_CATEGORY_LABELS_BN,
  HR_CATEGORY_LABELS_EN,
  EMPLOYMENT_TYPE_LABELS_BN,
  EMPLOYMENT_TYPE_LABELS_EN,
  EMPLOYMENT_STATUS_LABELS_BN,
  EMPLOYMENT_STATUS_LABELS_EN,
  HW_SUBJECT_LABELS_BN,
  HW_SUBJECT_LABELS_EN,
  LIFECYCLE_STATE_LABELS_BN,
  LIFECYCLE_STATE_LABELS_EN,
  HW_RESULT_LABELS_BN,
  HW_RESULT_LABELS_EN,
  RECON_STATE_LABELS_BN,
  RECON_STATE_LABELS_EN,
  TRIM_RANK_LABELS_BN,
  TRIM_RANK_LABELS_EN,
  ROUTINE_SUBJECT_LABELS_BN,
  ROUTINE_SUBJECT_LABELS_EN,
  DAY_OF_WEEK_LABELS_BN,
  DAY_OF_WEEK_LABELS_EN,
  PERIOD_TRACK_LABELS_BN,
  PERIOD_TRACK_LABELS_EN,
  type SetType,
  type TrackerKind,
  type DocType,
  type RosterClassLevel,
  type HrCategory,
  type EmploymentType,
  type EmploymentStatus,
  type HwSubject,
  type LifecycleState,
  type HwResult,
  type ReconState,
  type TrimRank,
  type RoutineSubject,
  type DayOfWeek,
  type PeriodTrack,
} from "@scd/shared";

// --- Active language (module-level; read at render time) ---------------------

export type Lang = "bn" | "en";

let _lang: Lang = "bn";

/** Set the active UI language. Called by LanguageContext; takes effect on the
 *  next render of any component that reads STR / a label fn. */
export function setActiveLang(lang: Lang): void {
  _lang = lang;
}

/** The current active language. */
export function getActiveLang(): Lang {
  return _lang;
}

/** Pick the BN or EN variant of a value by the active language. */
const pick = <T>(bn: T, en: T): T => (_lang === "en" ? en : bn);

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/** Render a number with Bangla numerals in Bangla mode, Latin digits in English
 *  (NFR-5). Kept named `bnNum` for call-site stability. */
export function bnNum(n: number | string): string {
  if (_lang === "en") return String(n);
  return String(n).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

const DASH = "—";

export const subjectLabel = (code?: string | null): string =>
  (code && pick(SUBJECT_LABELS_BN, SUBJECT_LABELS_EN)[code as Subject]) || code || DASH;

export const difficultyLabel = (v?: string | null): string =>
  (v && pick(DIFFICULTY_LABELS_BN, DIFFICULTY_LABELS_EN)[v as Difficulty]) || v || DASH;

export const paperRoleLabel = (v?: string | null): string =>
  (v && pick(PAPER_ROLE_LABELS_BN, PAPER_ROLE_LABELS_EN)[v as PaperRole]) || v || DASH;

export const reviewStatusLabel = (v?: string | null): string =>
  (v && pick(REVIEW_STATUS_LABELS_BN, REVIEW_STATUS_LABELS_EN)[v as ReviewStatus]) || v || DASH;

export const curationTagLabel = (v?: string | null): string =>
  (v && pick(CURATION_TAG_LABELS_BN, CURATION_TAG_LABELS_EN)[v as CurationTag]) || v || DASH;

export const reviewVerdictLabel = (v?: string | null): string =>
  (v && pick(REVIEW_VERDICT_LABELS_BN, REVIEW_VERDICT_LABELS_EN)[v as ReviewVerdict]) || v || DASH;

/** Review-round lifecycle status → label (app-native ReviewAssignment.status). */
export const reviewRoundStatusLabel = (v?: string | null): string => {
  const en = _lang === "en";
  return v === "assigned" ? (en ? "Pending" : "অপেক্ষমাণ")
    : v === "submitted" ? (en ? "Submitted" : "জমা হয়েছে")
    : v === "superseded" ? (en ? "Superseded" : "প্রতিস্থাপিত")
    : v === "cancelled" ? (en ? "Cancelled" : "বাতিল")
    : v || DASH;
};

export const setTypeLabel = (v?: string | null): string =>
  (v && pick(SET_TYPE_LABELS_BN, SET_TYPE_LABELS_EN)[v as SetType]) || v || DASH;

export const trackerKindLabel = (v?: string | null): string =>
  (v && pick(TRACKER_KIND_LABELS_BN, TRACKER_KIND_LABELS_EN)[v as TrackerKind]) || v || DASH;

export const docTypeLabel = (v?: string | null): string =>
  (v && pick(DOC_TYPE_LABELS_BN, DOC_TYPE_LABELS_EN)[v as DocType]) || v || DASH;

/** Roster-aware: pre-primary (−1 Nursery / 0 KG) use the roster label; 1..5 stay "শ্রেণি N" / "Class N". */
export const classLevelLabel = (level: number): string => {
  const roster = pick(ROSTER_CLASS_LABELS_BN, ROSTER_CLASS_LABELS_EN);
  if (level <= 0) return roster[level as RosterClassLevel] ?? (_lang === "en" ? `Class ${bnNum(level)}` : `শ্রেণি ${bnNum(level)}`);
  return _lang === "en" ? `Class ${bnNum(level)}` : `শ্রেণি ${bnNum(level)}`;
};

export const genderLabel = (v?: string | null): string => {
  const en = _lang === "en";
  return v === "male" ? (en ? "Male" : "ছেলে")
    : v === "female" ? (en ? "Female" : "মেয়ে")
    : v === "other" ? (en ? "Other" : "অন্যান্য")
    : DASH;
};

/** Guardian relation → label. */
export const relationLabel = (v?: string | null): string => {
  const en = _lang === "en";
  return v === "father" ? (en ? "Father" : "বাবা")
    : v === "mother" ? (en ? "Mother" : "মা")
    : v === "guardian" ? (en ? "Guardian" : "অভিভাবক")
    : v || DASH;
};

/** HR staff vocab → label (falls back to the raw code, then —). */
export const hrCategoryLabel = (v?: string | null): string =>
  (v && pick(HR_CATEGORY_LABELS_BN, HR_CATEGORY_LABELS_EN)[v as HrCategory]) || v || DASH;

// Homework tracker (HW-T1..T4)
export const hwSubjectLabel = (v?: string | null): string =>
  (v && pick(HW_SUBJECT_LABELS_BN, HW_SUBJECT_LABELS_EN)[v as HwSubject]) || v || DASH;

export const lifecycleStateLabel = (v?: string | null): string =>
  (v && pick(LIFECYCLE_STATE_LABELS_BN, LIFECYCLE_STATE_LABELS_EN)[v as LifecycleState]) || v || DASH;

export const hwResultLabel = (v?: string | null): string =>
  (v && pick(HW_RESULT_LABELS_BN, HW_RESULT_LABELS_EN)[v as HwResult]) || v || DASH;

export const reconStateLabel = (v?: string | null): string =>
  (v && pick(RECON_STATE_LABELS_BN, RECON_STATE_LABELS_EN)[v as ReconState]) || v || DASH;

export const trimRankLabel = (v?: string | null): string =>
  (v && pick(TRIM_RANK_LABELS_BN, TRIM_RANK_LABELS_EN)[v as TrimRank]) || v || DASH;

// Routine / timetable (R-1..R-3)
export const routineSubjectLabel = (v?: string | null): string =>
  (v && pick(ROUTINE_SUBJECT_LABELS_BN, ROUTINE_SUBJECT_LABELS_EN)[v as RoutineSubject]) || v || DASH;

export const dayOfWeekLabel = (v?: string | null): string =>
  (v && pick(DAY_OF_WEEK_LABELS_BN, DAY_OF_WEEK_LABELS_EN)[v as DayOfWeek]) || v || DASH;

export const periodTrackLabel = (v?: string | null): string =>
  (v && pick(PERIOD_TRACK_LABELS_BN, PERIOD_TRACK_LABELS_EN)[v as PeriodTrack]) || v || DASH;

export const employmentTypeLabel = (v?: string | null): string =>
  (v && pick(EMPLOYMENT_TYPE_LABELS_BN, EMPLOYMENT_TYPE_LABELS_EN)[v as EmploymentType]) || v || DASH;

export const employmentStatusLabel = (v?: string | null): string =>
  (v && pick(EMPLOYMENT_STATUS_LABELS_BN, EMPLOYMENT_STATUS_LABELS_EN)[v as EmploymentStatus]) || v || DASH;

/** "নম্বর X–Y এর মধ্যে দিন।" / "Enter a mark between X and Y." (TrackerEntry). */
export const markRangeMsg = (min: number, max: number): string =>
  _lang === "en"
    ? `Enter a mark between ${bnNum(min)} and ${bnNum(max)}.`
    : `নম্বর ${bnNum(min)}–${bnNum(max)} এর মধ্যে দিন।`;

// --- UI chrome strings -------------------------------------------------------

/** Bangla chrome strings — labels, buttons, headers, statuses, errors. The EN
 *  table below mirrors these keys exactly. */
const STR_BN = {
  // App / nav
  appName: "SCD Hub",
  appSub: "School for Community Development",
  language: "ভাষা",
  tabContent: "কন্টেন্ট",
  tabQuestions: "প্রশ্ন",
  tabSets: "সেট",
  tabTrackers: "ট্র্যাকার",
  tabAdmin: "প্রশাসন",

  // Auth
  login: "লগইন",
  logout: "লগআউট",
  email: "ইমেইল",
  emailOrPhone: "ইমেইল বা ফোন",
  password: "পাসওয়ার্ড",
  loggingIn: "লগইন হচ্ছে…",
  loginInvalid: "ইমেইল বা পাসওয়ার্ড ভুল।",
  welcome: "স্বাগতম",

  // Generic actions
  save: "সংরক্ষণ",
  saving: "সংরক্ষণ হচ্ছে…",
  cancel: "বাতিল",
  close: "বন্ধ",
  open: "খুলুন",
  apply: "প্রয়োগ",
  clear: "মুছুন",
  retry: "আবার চেষ্টা",
  copy: "কপি করুন",
  copied: "কপি হয়েছে",
  add: "যোগ করুন",
  remove: "সরান",
  create: "তৈরি করুন",
  select: "নির্বাচন করুন",
  done: "সম্পন্ন",
  loading: "লোড হচ্ছে…",

  // Filters / fields
  filters: "ফিল্টার",
  subject: "বিষয়",
  classLevel: "শ্রেণি",
  all: "সব",
  curationTag: "কিউরেশন ট্যাগ",
  reviewStatus: "পর্যালোচনা অবস্থা",
  difficulty: "কাঠিন্য",
  questionType: "প্রশ্নের ধরন",
  paperRole: "পেপার ভূমিকা",
  bloom: "ব্লুম স্তর",
  marks: "নম্বর",
  marksMin: "সর্বনিম্ন নম্বর",
  marksMax: "সর্বোচ্চ নম্বর",

  // Content
  contentTreeTitle: "কন্টেন্ট",
  planTitle: "সেশন পরিকল্পনা",
  exportPdf: "PDF রপ্তানি",
  preparingPdf: "PDF তৈরি হচ্ছে…",
  noMarkdown: "এই আর্টিফ্যাক্টে প্রদর্শনযোগ্য কন্টেন্ট নেই।",
  pdfWebOnly: "PDF রপ্তানি এখন কেবল ওয়েবে উপলব্ধ।",
  pdfError: "PDF তৈরি করা যায়নি।",
  chapter: "অধ্যায়",
  lesson: "পাঠ",

  // Questions / basket
  questionBank: "প্রশ্ন ব্যাংক",
  preview: "প্রিভিউ",
  addToBasket: "ঝুড়িতে যোগ",
  inBasket: "ঝুড়িতে আছে",
  basket: "ঝুড়ি",
  basketEmpty: "ঝুড়ি খালি।",
  options: "বিকল্পসমূহ",
  answer: "উত্তর",
  totalMarks: "মোট নম্বর",
  questionsWord: "প্রশ্ন",
  studentsWord: "শিক্ষার্থী",
  items: "আইটেম",
  true: "সত্য (True)",
  false: "মিথ্যা (False)",
  descriptiveSeeRubric: "[বর্ণনামূলক — রুব্রিক দেখুন]",

  // Sets
  sets: "সেট",
  setList: "সেট তালিকা",
  setDetail: "সেট বিবরণ",
  createSet: "সেট তৈরি",
  assemble: "সংকলন",
  assembling: "সংকলন হচ্ছে…",
  setType: "সেটের ধরন",
  status: "অবস্থা",
  statusDraft: "খসড়া",
  statusAssembled: "সংকলিত",
  durationMinutes: "সময় (মিনিট)",
  dueDate: "জমার তারিখ",
  section: "শাখা",
  class: "শ্রেণি",

  // Trackers
  trackers: "ট্র্যাকার",
  trackerList: "ট্র্যাকার তালিকা",
  openTracker: "ট্র্যাকার খুলুন",
  closeTracker: "ট্র্যাকার বন্ধ",
  trackerEntry: "এন্ট্রি",
  trackerSummary: "সারসংক্ষেপ",
  kind: "ধরন",
  statusOpen: "চলমান",
  statusClosed: "বন্ধ",
  score: "স্কোর",
  submitted: "জমা দিয়েছে",
  notSubmitted: "জমা দেয়নি",
  complete: "সম্পন্ন",
  incomplete: "অসম্পূর্ণ",
  sendReminder: "রিমাইন্ডার পাঠান",
  pickSet: "একটি সংকলিত সেট নির্বাচন করুন",
  totalEntries: "মোট এন্ট্রি",
  submittedCount: "জমা সংখ্যা",
  completeCount: "সম্পন্ন সংখ্যা",
  averageScore: "গড় স্কোর",
  guardianPhone: "অভিভাবকের ফোন",
  studentName: "শিক্ষার্থীর নাম",
  waLinkHint: "লিংকটি কপি করে নিজে পাঠান (স্বয়ংক্রিয় প্রেরণ নেই)।",

  // Homework Tracker (HW-T1..T4)
  tabHomework: "বাড়ির কাজ",
  hwDate: "তারিখ",
  hwToday: "আজকের বাড়ির কাজ",
  hwDayTotal: "দিনের মোট সময়",
  hwCeiling: "সর্বোচ্চ সীমা",
  hwWithinCeiling: "সীমার মধ্যে",
  hwOverCeiling: "সীমা অতিক্রম",
  hwOverBy: "অতিরিক্ত",
  hwMinutes: "মিনিট",
  hwBandWarning: "৪০ মিনিটের বেশি (সতর্কতা)",
  hwDeclare: "ঘোষণা করুন",
  hwReconcile: "সমন্বয় ও ইস্যু",
  hwChecking: "যাচাই তালিকা",
  hwDeclareTitle: "বাড়ির কাজ ঘোষণা",
  hwReconcileTitle: "দৈনিক সমন্বয়",
  hwCheckingTitle: "যাচাই তালিকা",
  hwSubject: "বিষয়",
  hwTopTags: "টপিক ট্যাগ (কমা দিয়ে)",
  hwTimeDecl: "নির্ধারিত সময় (মিনিট)",
  hwQCount: "প্রশ্ন সংখ্যা",
  hwPoolRef: "প্রশ্নভাণ্ডার সূত্র (ঐচ্ছিক)",
  hwRevItem: "পুনরালোচনা আইটেম",
  hwDeclared: "ঘোষিত",
  hwIssued: "ইস্যু হয়েছে",
  hwChaseList: "তাগাদা তালিকা",
  hwAttention: "নজরে",
  hwCommsPrompt: "অভিভাবককে জানান",
  hwOpenResubmissions: "চলমান পুনঃজমা",
  hwOnTimePct: "সময়মতো জমা %",
  hwChaseVolume: "মোট তাগাদা",
  hwReturnLatency: "ফেরত গড় (দিন)",
  hwTopicTouches: "টপিক স্পর্শ",
  hwTrimPanel: "হ্রাস প্যানেল",
  hwTrimTo: "প্রশ্ন কমিয়ে আনুন",
  hwTrim: "হ্রাস",
  hwConfirmIssue: "নিশ্চিত করে ইস্যু করুন",
  hwRosterPresent: "উপস্থিত",
  hwRosterAbsent: "অনুপস্থিত",
  hwIssuedItems: "ইস্যুকৃত আইটেম",
  hwIssuedRecords: "শিক্ষার্থী রেকর্ড",
  hwCheck: "যাচাই",
  hwResult: "ফলাফল",
  hwResubmit: "পুনঃজমা চান",
  hwTopupQids: "টপ-আপ প্রশ্ন আইডি (কমা দিয়ে)",
  hwTopupTime: "টপ-আপ সময় (মিনিট)",
  hwNoSubmitted: "যাচাইয়ের অপেক্ষায় কিছু নেই",
  hwResubSpawned: "পুনঃজমা তৈরি হয়েছে",
  hwClassTeacherOnly: "শুধু শ্রেণিশিক্ষক সমন্বয় করতে পারেন",
  hwNoClassLevel: "শ্রেণি স্তর পাওয়া যায়নি",
  hwRollups: "সারসংক্ষেপ ও পর্যবেক্ষণ",
  hwRollupsTitle: "রোল-আপ",
  hwWatchList: "পুনঃজমা ওয়াচ-লিস্ট",
  hwWatchHint: "রোলিং ২ সপ্তাহে ৩+ পুনঃজমা",
  hwResubmissions: "পুনঃজমা",
  hwTrimPattern: "হ্রাসের ধরন (মাসিক)",
  hwTrimHint: "মাসের ৩০%+ দিন হ্রাস হলে চিহ্নিত",
  hwTrimmedDays: "হ্রাসকৃত দিন",
  hwSchoolDays: "স্কুল দিন",
  assignClassTeacher: "শ্রেণিশিক্ষক নির্ধারণ",
  ctCurrent: "বর্তমান শ্রেণিশিক্ষক",
  ctTeacherId: "শিক্ষকের আইডি (TEACHER)",
  ctAssign: "নির্ধারণ করুন",
  ctClear: "অপসারণ",
  ctAssigned: "শ্রেণিশিক্ষক নির্ধারিত হয়েছে",
  ctCleared: "শ্রেণিশিক্ষক অপসারিত",
  ctNone: "নির্ধারিত নয়",
  ctHint: "শ্রেণিশিক্ষক দৈনিক সমন্বয় ও ইস্যু পরিচালনা করেন (handoff §9)।",
  ctOverview: "শ্রেণিশিক্ষক তালিকা",
  ctUnassigned: "নিয়োগ হয়নি",
  ctSupport: "সহকারী শিক্ষক",
  ctSupportId: "সহকারী শিক্ষক আইডি (TEACHER)",
  ctSupportAdd: "সহকারী যোগ",
  ctSupportAdded: "সহকারী শিক্ষক যোগ হয়েছে।",
  ctSupportRemoved: "সহকারী শিক্ষক সরানো হয়েছে।",
  ctHistory: "নিয়োগ ইতিহাস",
  ctNoHistory: "কোনো ইতিহাস নেই।",
  ctSections: "শাখা",
  hwFlagged: "চিহ্নিত",
  hwQuestionUsage: "প্রশ্ন ব্যবহার (বেনামি)",
  hwUses: "ব্যবহার",
  hwMonth: "মাস (YYYY-MM)",
  hwNoFlags: "কোনো চিহ্নিত ধরন নেই",

  // Admin
  admin: "প্রশাসন",
  importContent: "কন্টেন্ট ইম্পোর্ট",
  pickFile: "ফাইল নির্বাচন",
  pickFiles: "ফাইল নির্বাচন (JSON + Markdown)",
  selectedFiles: "নির্বাচিত ফাইল",
  removeFile: "সরান",
  clearFiles: "সব মুছুন",
  importHint: "একটি প্ল্যান হলে .json ও .md দুটোই দিন; প্রশ্নব্যাংক হলে শুধু .json দিন; অথবা একটি তৈরি খাম (.json) দিন।",
  envelopeAutoBuilt: "অ্যাপ স্বয়ংক্রিয়ভাবে খাম তৈরি করেছে",
  questionBankDetected: "প্রশ্নব্যাংক শনাক্ত হয়েছে — প্রতিটি প্রশ্ন ও স্টিমুলাস আলাদা খামে ইম্পোর্ট হবে।",
  curationTagLabel: "কিউরেশন ট্যাগ (প্রশ্নব্যাংকের জন্য)",
  curationKeepAsIs: "অপরিবর্তিত",
  curationNeedsReplacement: "প্রতিস্থাপন প্রয়োজন",
  curationFlexible: "নমনীয়",
  unitTitleLabel: "ইউনিট শিরোনাম (ঐচ্ছিক)",
  bankImported: "ইম্পোর্ট সম্পন্ন",
  bankItems: "আইটেম",
  classMismatchWarn: "ঝুড়ির প্রশ্নের শ্রেণি নির্বাচিত শাখার শ্রেণির সাথে মেলে না। সঠিক শ্রেণির শাখা নির্বাচন করুন।",
  viewEnvelope: "তৈরি খাম দেখুন",
  hideEnvelope: "খাম লুকান",
  pasteEnvelopeOptional: "অথবা একটি তৈরি খাম JSON পেস্ট করুন (ঐচ্ছিক)",
  noFilesSelected: "কোনো ফাইল নির্বাচিত হয়নি।",
  importing: "ইম্পোর্ট হচ্ছে…",
  verdict: "ফলাফল",
  warnings: "সতর্কতা",
  advisories: "উপদেশ",
  failChecks: "ব্যর্থ যাচাই",
  users: "ব্যবহারকারী",
  createUser: "ব্যবহারকারী তৈরি",
  role: "ভূমিকা",
  name: "নাম",
  scopeGrants: "স্কোপ গ্রান্ট",
  assignProxy: "প্রক্সি গ্রান্ট",
  revoke: "প্রত্যাহার",
  extend: "মেয়াদ বৃদ্ধি",
  durationDays: "দিন সংখ্যা",
  startDate: "শুরুর তারিখ",
  userListNotExposed: "সম্পূর্ণ ব্যবহারকারী তালিকা এখনো সার্ভারে উন্মুক্ত নয়।",

  // Roster (read-only student list)
  roster: "শিক্ষার্থী তালিকা",
  rosterCount: "শিক্ষার্থী",
  studentId: "আইডি",
  gender: "লিঙ্গ",
  dob: "জন্ম তারিখ",
  phone: "ফোন",
  address: "ঠিকানা",
  bloodGroup: "রক্তের গ্রুপ",
  guardians: "অভিভাবক",
  noGuardians: "কোনো অভিভাবক যুক্ত নেই।",
  changeSection: "শাখা পরিবর্তন",

  // Credential provisioning (D-#59 guardians, D-#60 staff)
  guardianCredentials: "অভিভাবক লগইন",
  staffCredentials: "শিক্ষক/স্টাফ লগইন",
  generateLogin: "লগইন তৈরি করুন",
  resetPassword: "পাসওয়ার্ড রিসেট",
  loginId: "লগইন আইডি",
  generatedPassword: "পাসওয়ার্ড",
  shareWhatsApp: "WhatsApp এ পাঠান",
  credentialOnceWarning: "পাসওয়ার্ড শুধু একবার দেখানো হবে — এখনই কপি বা শেয়ার করুন।",
  loginExistsLabel: "লগইন আছে",
  noLoginLabel: "লগইন নেই",
  familyLoginHint: "এক ফোন = পরিবারের সব সন্তানের জন্য একটি লগইন; দুই অভিভাবকই একই তথ্য ব্যবহার করবেন।",
  staffLoginHint: "ফোন নম্বর দিয়ে শিক্ষক/স্টাফ লগইন; ক্যাটাগরি অনুযায়ী রোল নির্ধারিত হয়।",
  childrenLabel: "সন্তান",
  noProvisionableStaff: "লগইনযোগ্য কোনো স্টাফ নেই।",
  noGuardianCandidates: "কোনো পরিবার পাওয়া যায়নি।",

  // Staff (read-only HR roster)
  staff: "কর্মী তালিকা",
  staffCount: "কর্মী",
  staffId: "আইডি",
  category: "ক্যাটাগরি",
  designation: "পদবি",
  employmentType: "চুক্তির ধরন",
  employmentStatus: "কর্মাবস্থা",
  joiningDate: "যোগদানের তারিখ",
  qualification: "যোগ্যতা",
  fatherName: "পিতার নাম",
  motherName: "মাতার নাম",
  spouseName: "স্বামী/স্ত্রীর নাম",
  maritalStatus: "বৈবাহিক অবস্থা",
  whatsapp: "হোয়াটসঅ্যাপ",
  biometricId: "বায়োমেট্রিক আইডি",
  bankAccount: "ব্যাংক হিসাব",
  nid: "জাতীয় পরিচয়পত্র",
  allCategories: "সব ক্যাটাগরি",

  // Plan review / approval loop (PR-3)
  tabReview: "পর্যালোচনা",
  reviewInbox: "পর্যালোচনা ইনবক্স",
  myReviews: "আমার পর্যালোচনা",
  noInbox: "অপেক্ষমাণ কোনো পর্যালোচনা নেই।",
  noMyReviews: "আপনাকে কোনো পরিকল্পনা পর্যালোচনার জন্য দেওয়া হয়নি।",
  reviewRound: "রাউন্ড",
  reviewVerdict: "মতামত",
  verdictApprove: "অনুমোদন",
  verdictChanges: "পরিবর্তন প্রয়োজন",
  feedback: "মতামত / প্রতিক্রিয়া",
  feedbackForClaude: "এই মতামত Claude Desktop-এ দিয়ে নতুন পরিকল্পনা তৈরি করুন।",
  feedbackRequired: "পরিবর্তন চাইলে মতামত লিখুন।",
  submitReview: "পর্যালোচনা জমা দিন",
  submittingReview: "জমা হচ্ছে…",
  reviewSubmitted: "পর্যালোচনা জমা হয়েছে।",
  reviewThread: "পর্যালোচনার ইতিহাস",
  reviewerId: "পর্যালোচক আইডি (TEACHER)",
  reviewer: "পর্যালোচক (শিক্ষক)",
  selectTeacher: "শিক্ষক নির্বাচন করুন…",
  noTeachers: "কোনো শিক্ষক অ্যাকাউন্ট পাওয়া যায়নি।",
  assignForReview: "পর্যালোচনার জন্য বরাদ্দ",
  assignNextRound: "পরবর্তী রাউন্ড বরাদ্দ",
  assigning: "বরাদ্দ হচ্ছে…",
  reviewerAssigned: "পর্যালোচক বরাদ্দ হয়েছে।",
  approveSignOff: "অনুমোদন / চূড়ান্ত",
  approving: "অনুমোদন হচ্ছে…",
  planApproved: "পরিকল্পনা অনুমোদিত (চূড়ান্ত)।",
  approveNeedsReviewed: "চূড়ান্ত করার আগে পরিকল্পনা 'পর্যালোচিত' হতে হবে।",
  copyFeedback: "মতামত কপি",
  reviewActions: "পর্যালোচনা কার্যক্রম",
  openForReview: "পরিকল্পনা খুলুন",
  awaitingReviewer: "পর্যালোচকের অপেক্ষায়",

  // Section context
  sectionContext: "শাখা প্রসঙ্গ",
  pickSection: "শাখা নির্বাচন করুন",
  academicYearId: "শিক্ষাবর্ষ আইডি",
  academicYearHint: "সেট ও ট্র্যাকারের জন্য শাখা প্রয়োজন। শিক্ষাবর্ষ আইডি দিন।",
  noSectionSelected: "কোনো শাখা নির্বাচিত নেই।",

  // Misc results / validation
  invalidDate: "তারিখ সঠিক নয় (YYYY-MM-DD)।",
  saved: "সংরক্ষিত হয়েছে।",
  noStudents: "এই শাখায় কোনো শিক্ষার্থী নেই।",
  noPermission: "এই কাজের অনুমতি নেই।",
  userCreated: "ব্যবহারকারী তৈরি হয়েছে।",
  grantCreated: "গ্রান্ট তৈরি হয়েছে।",
  actionDone: "সম্পন্ন হয়েছে।",
  pickSetFirst: "প্রথমে একটি সংকলিত সেট নির্বাচন করুন।",

  // Empty / error states
  empty: "কিছু পাওয়া যায়নি।",
  errGeneric: "সমস্যা হয়েছে। আবার চেষ্টা করুন।",
  errNetwork: "সার্ভারে সংযোগ করা যায়নি।",
  errForbiddenWrite: "এই সেকশনে লেখার অনুমতি নেই।",
  errForbiddenRead: "এই কন্টেন্ট দেখার অনুমতি নেই।",

  // Routine / timetable (R-3)
  tabRoutine: "রুটিন",
  routineTitle: "রুটিন",
  myRoutineTitle: "আমার রুটিন",
  groupRoutineTitle: "ক্লাস রুটিন",
  editRoutineTitle: "রুটিন সম্পাদনা",
  rtMyRoutine: "আমার রুটিন",
  rtSectionRoutine: "শাখার রুটিন",
  rtSubjectGroups: "কুরআন / আরবি গ্রুপ",
  rtEdit: "রুটিন সম্পাদনা",
  rtView: "রুটিন দেখুন",
  rtNoSlots: "কোনো রুটিন স্লট নেই।",
  rtBreak: "বিরতি",
  rtPeriodN: "পিরিয়ড",
  rtDay: "দিন",
  rtPeriod: "পিরিয়ড নম্বর",
  rtSubjectF: "বিষয়",
  rtTrack: "ট্র্যাক",
  rtTeacher: "শিক্ষক",
  rtTeacherId: "শিক্ষক আইডি",
  rtRoom: "কক্ষ",
  rtRoomId: "কক্ষ আইডি",
  rtFrom: "কার্যকর শুরু (YYYY-MM-DD)",
  rtTo: "কার্যকর শেষ (ঐচ্ছিক)",
  rtIsBreak: "বিরতি পিরিয়ড",
  rtCreate: "স্লট যোগ করুন",
  rtCreated: "স্লট যোগ হয়েছে।",
  rtDeleted: "স্লট মুছে ফেলা হয়েছে।",
  rtDeleteConfirm: "এই স্লট মুছবেন?",
  rtManageHint: "শাখা বা গ্রুপ নির্বাচন করে স্লট যোগ/মুছুন।",
  rtExisting: "বিদ্যমান স্লট",
  rtToday: "আজ",

  // Routine cover / proxy-manage (R-4)
  coverManageTitle: "কভার ব্যবস্থাপনা",
  rtCover: "কভার",
  rtDate: "তারিখ (YYYY-MM-DD)",
  rtFindCover: "কভার খুঁজুন",
  rtAvailableTeachers: "উপলব্ধ শিক্ষক",
  rtClassesToday: "আজকের ক্লাস",
  rtFree: "মুক্ত",
  rtBusy: "ব্যস্ত",
  rtAssignCover: "কভার নিয়োগ",
  rtCoverAssigned: "কভার নিয়োগ হয়েছে।",
  rtCoverCancelled: "কভার বাতিল হয়েছে।",
  rtActiveCovers: "আজকের কভার",
  rtCovered: "কভার করা হয়েছে",
  rtNoCovers: "কোনো কভার নেই।",

  // Routine triggers + class-note / daily-diary (R-5)
  dailyNoteTitle: "ক্লাস নোট",
  bellScheduleTitle: "ঘণ্টা সূচি",
  rtClassNote: "ক্লাস নোট",
  rtBellSchedule: "ঘণ্টা সূচি",
  rtTaughtSummary: "আজ যা পড়ানো হয়েছে",
  rtHomeworkId: "বাড়ির কাজ আইডি (ঐচ্ছিক)",
  rtPublish: "প্রকাশ করুন",
  rtPublished: "প্রকাশিত হয়েছে।",
  rtNoteFor: "নোট",
  rtNoNotes: "কোনো নোট নেই।",
  rtNotesToPublish: "আজ প্রকাশযোগ্য নোট",
  rtAudienceKey: "অডিয়েন্স কী (যেমন class_1_5)",
  rtBellEnds: "পিরিয়ড শেষ",
  rtBellAdmin: "ঘণ্টা দায়িত্ব",
  rtAdminId: "অ্যাডমিন আইডি",
  rtAssignBell: "ঘণ্টা দায়িত্ব নিয়োগ",
  rtBellAssigned: "ঘণ্টা দায়িত্ব নিয়োগ হয়েছে।",
} as const;

type StrTable = Record<keyof typeof STR_BN, string>;

/** English chrome strings — same keys as STR_BN. */
const STR_EN: StrTable = {
  // App / nav
  appName: "SCD Hub",
  appSub: "School for Community Development",
  language: "Language",
  tabContent: "Content",
  tabQuestions: "Questions",
  tabSets: "Sets",
  tabTrackers: "Trackers",
  tabAdmin: "Admin",

  // Auth
  login: "Log in",
  logout: "Log out",
  email: "Email",
  emailOrPhone: "Email or phone",
  password: "Password",
  loggingIn: "Logging in…",
  loginInvalid: "Email or password is incorrect.",
  welcome: "Welcome",

  // Generic actions
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  close: "Close",
  open: "Open",
  apply: "Apply",
  clear: "Clear",
  retry: "Retry",
  copy: "Copy",
  copied: "Copied",
  add: "Add",
  remove: "Remove",
  create: "Create",
  select: "Select",
  done: "Done",
  loading: "Loading…",

  // Filters / fields
  filters: "Filters",
  subject: "Subject",
  classLevel: "Class",
  all: "All",
  curationTag: "Curation tag",
  reviewStatus: "Review status",
  difficulty: "Difficulty",
  questionType: "Question type",
  paperRole: "Paper role",
  bloom: "Bloom level",
  marks: "Marks",
  marksMin: "Min marks",
  marksMax: "Max marks",

  // Content
  contentTreeTitle: "Content",
  planTitle: "Session plan",
  exportPdf: "Export PDF",
  preparingPdf: "Preparing PDF…",
  noMarkdown: "This artifact has no displayable content.",
  pdfWebOnly: "PDF export is currently available on web only.",
  pdfError: "Could not generate the PDF.",
  chapter: "Chapter",
  lesson: "Lesson",

  // Questions / basket
  questionBank: "Question bank",
  preview: "Preview",
  addToBasket: "Add to basket",
  inBasket: "In basket",
  basket: "Basket",
  basketEmpty: "The basket is empty.",
  options: "Options",
  answer: "Answer",
  totalMarks: "Total marks",
  questionsWord: "Questions",
  studentsWord: "Students",
  items: "Items",
  true: "True",
  false: "False",
  descriptiveSeeRubric: "[Descriptive — see rubric]",

  // Sets
  sets: "Sets",
  setList: "Set list",
  setDetail: "Set detail",
  createSet: "Create set",
  assemble: "Assemble",
  assembling: "Assembling…",
  setType: "Set type",
  status: "Status",
  statusDraft: "Draft",
  statusAssembled: "Assembled",
  durationMinutes: "Duration (min)",
  dueDate: "Due date",
  section: "Section",
  class: "Class",

  // Trackers
  trackers: "Trackers",
  trackerList: "Tracker list",
  openTracker: "Open tracker",
  closeTracker: "Close tracker",
  trackerEntry: "Entry",
  trackerSummary: "Summary",
  kind: "Kind",
  statusOpen: "Open",
  statusClosed: "Closed",
  score: "Score",
  submitted: "Submitted",
  notSubmitted: "Not submitted",
  complete: "Complete",
  incomplete: "Incomplete",
  sendReminder: "Send reminder",
  pickSet: "Select an assembled set",
  totalEntries: "Total entries",
  submittedCount: "Submitted count",
  completeCount: "Complete count",
  averageScore: "Average score",
  guardianPhone: "Guardian phone",
  studentName: "Student name",
  waLinkHint: "Copy the link and send it yourself (no automatic send).",

  // Homework Tracker (HW-T1..T4)
  tabHomework: "Homework",
  hwDate: "Date",
  hwToday: "Today's homework",
  hwDayTotal: "Day total",
  hwCeiling: "Ceiling",
  hwWithinCeiling: "Within limit",
  hwOverCeiling: "Over limit",
  hwOverBy: "Over by",
  hwMinutes: "min",
  hwBandWarning: "More than 40 minutes (warning)",
  hwDeclare: "Declare",
  hwReconcile: "Reconcile & issue",
  hwChecking: "Checking queue",
  hwDeclareTitle: "Declare homework",
  hwReconcileTitle: "Daily reconciliation",
  hwCheckingTitle: "Checking queue",
  hwSubject: "Subject",
  hwTopTags: "Topic tags (comma-separated)",
  hwTimeDecl: "Declared time (min)",
  hwQCount: "Question count",
  hwPoolRef: "Question-pool reference (optional)",
  hwRevItem: "Revision item",
  hwDeclared: "Declared",
  hwIssued: "Issued",
  hwChaseList: "Chase list",
  hwAttention: "Attention",
  hwCommsPrompt: "Notify guardian",
  hwOpenResubmissions: "Open resubmissions",
  hwOnTimePct: "On-time submission %",
  hwChaseVolume: "Total chases",
  hwReturnLatency: "Return latency (days)",
  hwTopicTouches: "Topic touches",
  hwTrimPanel: "Trim panel",
  hwTrimTo: "Reduce questions to",
  hwTrim: "Trim",
  hwConfirmIssue: "Confirm & issue",
  hwRosterPresent: "Present",
  hwRosterAbsent: "Absent",
  hwIssuedItems: "Issued items",
  hwIssuedRecords: "Student records",
  hwCheck: "Check",
  hwResult: "Result",
  hwResubmit: "Request resubmission",
  hwTopupQids: "Top-up question IDs (comma-separated)",
  hwTopupTime: "Top-up time (min)",
  hwNoSubmitted: "Nothing awaiting checking",
  hwResubSpawned: "Resubmission created",
  hwClassTeacherOnly: "Only the class teacher can reconcile",
  hwNoClassLevel: "Class level not found",
  hwRollups: "Summary & monitoring",
  hwRollupsTitle: "Roll-ups",
  hwWatchList: "Resubmission watch-list",
  hwWatchHint: "3+ resubmissions in a rolling 2 weeks",
  hwResubmissions: "Resubmissions",
  hwTrimPattern: "Trim pattern (monthly)",
  hwTrimHint: "Flagged when trimmed on 30%+ of days in a month",
  hwTrimmedDays: "Trimmed days",
  hwSchoolDays: "School days",
  assignClassTeacher: "Assign class teacher",
  ctCurrent: "Current class teacher",
  ctTeacherId: "Teacher ID (TEACHER)",
  ctAssign: "Assign",
  ctClear: "Remove",
  ctAssigned: "Class teacher assigned",
  ctCleared: "Class teacher removed",
  ctNone: "Not assigned",
  ctHint: "The class teacher runs daily reconciliation and issuing (handoff §9).",
  ctOverview: "Class teachers",
  ctUnassigned: "Unassigned",
  ctSupport: "Support teachers",
  ctSupportId: "Support teacher id (TEACHER)",
  ctSupportAdd: "Add support",
  ctSupportAdded: "Support teacher added.",
  ctSupportRemoved: "Support teacher removed.",
  ctHistory: "Assignment history",
  ctNoHistory: "No history.",
  ctSections: "sections",
  hwFlagged: "Flagged",
  hwQuestionUsage: "Question usage (anonymous)",
  hwUses: "Uses",
  hwMonth: "Month (YYYY-MM)",
  hwNoFlags: "No flagged patterns",

  // Admin
  admin: "Admin",
  importContent: "Import content",
  pickFile: "Pick file",
  pickFiles: "Pick files (JSON + Markdown)",
  selectedFiles: "Selected files",
  removeFile: "Remove",
  clearFiles: "Clear all",
  importHint: "For a plan, provide both .json and .md; for a question bank, provide just the .json; or provide a prebuilt envelope (.json).",
  envelopeAutoBuilt: "The app built the envelope automatically",
  questionBankDetected: "Question bank detected — each question and stimulus is imported in a separate envelope.",
  curationTagLabel: "Curation tag (for the question bank)",
  curationKeepAsIs: "Keep as is",
  curationNeedsReplacement: "Needs replacement",
  curationFlexible: "Flexible",
  unitTitleLabel: "Unit title (optional)",
  bankImported: "Import complete",
  bankItems: "items",
  classMismatchWarn: "The basket questions' class does not match the selected section's class. Select a section of the correct class.",
  viewEnvelope: "View built envelope",
  hideEnvelope: "Hide envelope",
  pasteEnvelopeOptional: "Or paste a prebuilt envelope JSON (optional)",
  noFilesSelected: "No files selected.",
  importing: "Importing…",
  verdict: "Verdict",
  warnings: "Warnings",
  advisories: "Advisories",
  failChecks: "Failed checks",
  users: "Users",
  createUser: "Create user",
  role: "Role",
  name: "Name",
  scopeGrants: "Scope grants",
  assignProxy: "Proxy grant",
  revoke: "Revoke",
  extend: "Extend",
  durationDays: "Number of days",
  startDate: "Start date",
  userListNotExposed: "A full user list is not yet exposed by the server.",

  // Roster (read-only student list)
  roster: "Student list",
  rosterCount: "Students",
  studentId: "ID",
  gender: "Gender",
  dob: "Date of birth",
  phone: "Phone",
  address: "Address",
  bloodGroup: "Blood group",
  guardians: "Guardians",
  noGuardians: "No guardians linked.",
  changeSection: "Change section",

  // Credential provisioning (D-#59 guardians, D-#60 staff)
  guardianCredentials: "Guardian logins",
  staffCredentials: "Teacher / staff logins",
  generateLogin: "Generate login",
  resetPassword: "Reset password",
  loginId: "Login ID",
  generatedPassword: "Password",
  shareWhatsApp: "Send on WhatsApp",
  credentialOnceWarning: "This password is shown only once — copy or share it now.",
  loginExistsLabel: "Has login",
  noLoginLabel: "No login",
  familyLoginHint: "One phone = one login for the whole family; both parents use the same credentials.",
  staffLoginHint: "Phone-number login for teachers/staff; role is mapped from the HR category.",
  childrenLabel: "children",
  noProvisionableStaff: "No staff eligible for a login.",
  noGuardianCandidates: "No families found.",

  // Staff (read-only HR roster)
  staff: "Staff list",
  staffCount: "Staff",
  staffId: "ID",
  category: "Category",
  designation: "Designation",
  employmentType: "Employment type",
  employmentStatus: "Employment status",
  joiningDate: "Joining date",
  qualification: "Qualification",
  fatherName: "Father's name",
  motherName: "Mother's name",
  spouseName: "Spouse's name",
  maritalStatus: "Marital status",
  whatsapp: "WhatsApp",
  biometricId: "Biometric ID",
  bankAccount: "Bank account",
  nid: "National ID",
  allCategories: "All categories",

  // Plan review / approval loop (PR-3)
  tabReview: "Review",
  reviewInbox: "Review inbox",
  myReviews: "My reviews",
  noInbox: "No reviews pending.",
  noMyReviews: "You have not been assigned any plan to review.",
  reviewRound: "Round",
  reviewVerdict: "Verdict",
  verdictApprove: "Approve",
  verdictChanges: "Changes requested",
  feedback: "Feedback",
  feedbackForClaude: "Take this feedback into Claude Desktop to produce a new plan.",
  feedbackRequired: "Write feedback when requesting changes.",
  submitReview: "Submit review",
  submittingReview: "Submitting…",
  reviewSubmitted: "Review submitted.",
  reviewThread: "Review history",
  reviewerId: "Reviewer ID (TEACHER)",
  reviewer: "Reviewer (teacher)",
  selectTeacher: "Choose a teacher…",
  noTeachers: "No teacher accounts found.",
  assignForReview: "Assign for review",
  assignNextRound: "Assign next round",
  assigning: "Assigning…",
  reviewerAssigned: "Reviewer assigned.",
  approveSignOff: "Approve / sign off",
  approving: "Approving…",
  planApproved: "Plan approved (final).",
  approveNeedsReviewed: "The plan must be 'reviewed' before final sign-off.",
  copyFeedback: "Copy feedback",
  reviewActions: "Review actions",
  openForReview: "Open plan",
  awaitingReviewer: "Awaiting reviewer",

  // Section context
  sectionContext: "Section context",
  pickSection: "Select a section",
  academicYearId: "Academic year ID",
  academicYearHint: "Sets and trackers need a section. Enter the academic year ID.",
  noSectionSelected: "No section selected.",

  // Misc results / validation
  invalidDate: "Date is not valid (YYYY-MM-DD).",
  saved: "Saved.",
  noStudents: "There are no students in this section.",
  noPermission: "You don't have permission for this action.",
  userCreated: "User created.",
  grantCreated: "Grant created.",
  actionDone: "Done.",
  pickSetFirst: "First select an assembled set.",

  // Empty / error states
  empty: "Nothing found.",
  errGeneric: "Something went wrong. Please try again.",
  errNetwork: "Could not connect to the server.",
  errForbiddenWrite: "You don't have write permission for this section.",
  errForbiddenRead: "You don't have permission to view this content.",

  // Routine / timetable (R-3)
  tabRoutine: "Routine",
  routineTitle: "Routine",
  myRoutineTitle: "My routine",
  groupRoutineTitle: "Class routine",
  editRoutineTitle: "Edit routine",
  rtMyRoutine: "My routine",
  rtSectionRoutine: "Section routine",
  rtSubjectGroups: "Quran / Arabic groups",
  rtEdit: "Edit routine",
  rtView: "View routine",
  rtNoSlots: "No routine slots.",
  rtBreak: "Break",
  rtPeriodN: "Period",
  rtDay: "Day",
  rtPeriod: "Period number",
  rtSubjectF: "Subject",
  rtTrack: "Track",
  rtTeacher: "Teacher",
  rtTeacherId: "Teacher id",
  rtRoom: "Room",
  rtRoomId: "Room id",
  rtFrom: "Effective from (YYYY-MM-DD)",
  rtTo: "Effective to (optional)",
  rtIsBreak: "Break period",
  rtCreate: "Add slot",
  rtCreated: "Slot added.",
  rtDeleted: "Slot deleted.",
  rtDeleteConfirm: "Delete this slot?",
  rtManageHint: "Pick a section or group, then add/remove slots.",
  rtExisting: "Existing slots",
  rtToday: "Today",

  // Routine cover / proxy-manage (R-4)
  coverManageTitle: "Cover management",
  rtCover: "Cover",
  rtDate: "Date (YYYY-MM-DD)",
  rtFindCover: "Find cover",
  rtAvailableTeachers: "Available teachers",
  rtClassesToday: "classes today",
  rtFree: "Free",
  rtBusy: "Busy",
  rtAssignCover: "Assign cover",
  rtCoverAssigned: "Cover assigned.",
  rtCoverCancelled: "Cover cancelled.",
  rtActiveCovers: "Today's covers",
  rtCovered: "Covered",
  rtNoCovers: "No covers.",

  // Routine triggers + class-note / daily-diary (R-5)
  dailyNoteTitle: "Class note",
  bellScheduleTitle: "Bell schedule",
  rtClassNote: "Class note",
  rtBellSchedule: "Bell schedule",
  rtTaughtSummary: "What was taught today",
  rtHomeworkId: "Homework id (optional)",
  rtPublish: "Publish",
  rtPublished: "Published.",
  rtNoteFor: "Note",
  rtNoNotes: "No notes.",
  rtNotesToPublish: "Notes to publish today",
  rtAudienceKey: "Audience key (e.g. class_1_5)",
  rtBellEnds: "Period end",
  rtBellAdmin: "Bell duty",
  rtAdminId: "Admin id",
  rtAssignBell: "Assign bell duty",
  rtBellAssigned: "Bell duty assigned.",
};

/** UI chrome strings — resolves to the active language at read time (Proxy). Use
 *  exactly like a plain object: `STR.login`. Don't destructure or cache it across
 *  a language change. */
export const STR: StrTable = new Proxy({} as StrTable, {
  get: (_t, key: string | symbol): string =>
    (_lang === "en" ? STR_EN : (STR_BN as unknown as StrTable))[key as keyof StrTable],
}) as StrTable;
