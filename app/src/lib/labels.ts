/**
 * Bangla display labels (NFR-5). Operational vocabulary is looked up from the
 * shared *_LABELS_BN maps (single source of truth); UI chrome strings live in
 * STR. English codes stay on form fields / tracker columns per the glossary.
 */
import {
  SUBJECT_LABELS_BN,
  DIFFICULTY_LABELS_BN,
  PAPER_ROLE_LABELS_BN,
  REVIEW_STATUS_LABELS_BN,
  CURATION_TAG_LABELS_BN,
  SET_TYPE_LABELS_BN,
  TRACKER_KIND_LABELS_BN,
  DOC_TYPE_LABELS_BN,
  type Subject,
  type Difficulty,
  type PaperRole,
  type ReviewStatus,
  type CurationTag,
  ROSTER_CLASS_LABELS_BN,
  HR_CATEGORY_LABELS_BN,
  EMPLOYMENT_TYPE_LABELS_BN,
  EMPLOYMENT_STATUS_LABELS_BN,
  type SetType,
  type TrackerKind,
  type DocType,
  type RosterClassLevel,
  type HrCategory,
  type EmploymentType,
  type EmploymentStatus,
} from "@scd/shared";

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/** Render a number with Bangla numerals (NFR-5). */
export function bnNum(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

export const subjectLabel = (code?: string | null): string =>
  (code && SUBJECT_LABELS_BN[code as Subject]) || code || "—";

export const difficultyLabel = (v?: string | null): string =>
  (v && DIFFICULTY_LABELS_BN[v as Difficulty]) || v || "—";

export const paperRoleLabel = (v?: string | null): string =>
  (v && PAPER_ROLE_LABELS_BN[v as PaperRole]) || v || "—";

export const reviewStatusLabel = (v?: string | null): string =>
  (v && REVIEW_STATUS_LABELS_BN[v as ReviewStatus]) || v || "—";

export const curationTagLabel = (v?: string | null): string =>
  (v && CURATION_TAG_LABELS_BN[v as CurationTag]) || v || "—";

export const setTypeLabel = (v?: string | null): string =>
  (v && SET_TYPE_LABELS_BN[v as SetType]) || v || "—";

export const trackerKindLabel = (v?: string | null): string =>
  (v && TRACKER_KIND_LABELS_BN[v as TrackerKind]) || v || "—";

export const docTypeLabel = (v?: string | null): string =>
  (v && DOC_TYPE_LABELS_BN[v as DocType]) || v || "—";

/** Roster-aware: pre-primary (−1 Nursery / 0 KG) use the roster label; 1..5 stay "শ্রেণি N". */
export const classLevelLabel = (level: number): string =>
  level <= 0 ? ROSTER_CLASS_LABELS_BN[level as RosterClassLevel] ?? `শ্রেণি ${bnNum(level)}` : `শ্রেণি ${bnNum(level)}`;

export const genderLabel = (v?: string | null): string =>
  v === "male" ? "ছেলে" : v === "female" ? "মেয়ে" : v === "other" ? "অন্যান্য" : "—";

/** Guardian relation → Bangla. */
export const relationLabel = (v?: string | null): string =>
  v === "father" ? "বাবা" : v === "mother" ? "মা" : v === "guardian" ? "অভিভাবক" : v || "—";

/** HR staff vocab → Bangla (falls back to the raw code, then —). */
export const hrCategoryLabel = (v?: string | null): string =>
  (v && HR_CATEGORY_LABELS_BN[v as HrCategory]) || v || "—";

export const employmentTypeLabel = (v?: string | null): string =>
  (v && EMPLOYMENT_TYPE_LABELS_BN[v as EmploymentType]) || v || "—";

export const employmentStatusLabel = (v?: string | null): string =>
  (v && EMPLOYMENT_STATUS_LABELS_BN[v as EmploymentStatus]) || v || "—";

/** UI chrome strings — Bangla labels, buttons, headers, statuses, errors. */
export const STR = {
  // App / nav
  appName: "SCD Hub",
  appSub: "School for Community Development",
  tabContent: "কন্টেন্ট",
  tabQuestions: "প্রশ্ন",
  tabSets: "সেট",
  tabTrackers: "ট্র্যাকার",
  tabAdmin: "প্রশাসন",

  // Auth
  login: "লগইন",
  logout: "লগআউট",
  email: "ইমেইল",
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

  // Admin
  admin: "প্রশাসন",
  importContent: "কন্টেন্ট ইম্পোর্ট",
  pickFile: "ফাইল নির্বাচন",
  pickFiles: "ফাইল নির্বাচন (JSON + Markdown)",
  selectedFiles: "নির্বাচিত ফাইল",
  removeFile: "সরান",
  clearFiles: "সব মুছুন",
  importHint: "একটি প্ল্যান হলে .json ও .md দুটোই দিন; অথবা একটি তৈরি খাম (.json) দিন।",
  envelopeAutoBuilt: "অ্যাপ স্বয়ংক্রিয়ভাবে খাম তৈরি করেছে",
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
} as const;
