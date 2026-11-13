/**
 * Book lifecycle — shared enums, reason codes and version helpers
 * (docs/prd-book-lifecycle.md, D-#1590–#1616). App-native: no wire twin in the import
 * schema. Server models, resolvers, MCP tools and the app all read these lists.
 */

export const BOOK_EDITIONS = ["TEACHER", "STUDENT", "SCHOLARSHIP_STUDENT"] as const;
export type BookEdition = (typeof BOOK_EDITIONS)[number];
export const BOOK_EDITION_LABELS_BN: Record<BookEdition, string> = {
  TEACHER: "শিক্ষক সংস্করণ",
  STUDENT: "শিক্ষার্থী সংস্করণ",
  SCHOLARSHIP_STUDENT: "বৃত্তি শিক্ষার্থী সংস্করণ",
};

export const BOOK_VERSION_STATUSES = ["draft", "in_review", "changes_requested", "approved", "final", "print_released"] as const;
export type BookVersionStatus = (typeof BOOK_VERSION_STATUSES)[number];
export const BOOK_VERSION_STATUS_BN: Record<BookVersionStatus, string> = {
  draft: "খসড়া",
  in_review: "পর্যালোচনায় (কাগজে)",
  changes_requested: "পরিবর্তন দরকার",
  approved: "অনুমোদিত",
  final: "চূড়ান্ত",
  print_released: "ছাপা হয়েছে",
};

export const BOOK_VERSION_SOURCES = ["import", "upload", "ai_job", "mcp", "bundle"] as const;
export type BookVersionSource = (typeof BOOK_VERSION_SOURCES)[number];

export const BOOK_VERSION_FILE_ROLES = ["master_md", "master_docx", "master_pdf", "edition"] as const;
export type BookVersionFileRole = (typeof BOOK_VERSION_FILE_ROLES)[number];
export const BOOK_FILE_FORMATS = ["md", "docx", "pdf"] as const;
export type BookFileFormat = (typeof BOOK_FILE_FORMATS)[number];

export const BOOK_CHANGE_ROUTES = ["needs_reviewer", "direct_fix", "verbal_errata", "instruction"] as const;
export type BookChangeRoute = (typeof BOOK_CHANGE_ROUTES)[number];

export const BOOK_ROUND_STATUSES = ["draft", "packet_ready", "sent_on_paper", "returned", "withdrawn"] as const;
export type BookRoundStatus = (typeof BOOK_ROUND_STATUSES)[number];
export const BOOK_OPEN_ROUND_STATUSES: readonly BookRoundStatus[] = ["draft", "packet_ready", "sent_on_paper"];
export const BOOK_ROUND_STATUS_BN: Record<BookRoundStatus, string> = {
  draft: "খসড়া স্মারক",
  packet_ready: "প্যাকেট তৈরি",
  sent_on_paper: "কাগজে পাঠানো হয়েছে",
  returned: "ফেরত লিপিবদ্ধ",
  withdrawn: "প্রত্যাহার",
};
export const BOOK_ROUND_VERDICTS = ["approve", "changes"] as const;
export type BookRoundVerdict = (typeof BOOK_ROUND_VERDICTS)[number];
export const BOOK_ITEM_VERDICTS = ["agree", "disagree", "modify"] as const;
export type BookItemVerdict = (typeof BOOK_ITEM_VERDICTS)[number];
export const BOOK_PACKET_SCOPES = ["whole", "changed"] as const;
export type BookPacketScope = (typeof BOOK_PACKET_SCOPES)[number];
export const BOOK_TRANSCRIBE_VIA = ["hand", "mcp", "bundle"] as const;
export type BookTranscribeVia = (typeof BOOK_TRANSCRIBE_VIA)[number];

export const BOOK_FEEDBACK_SOURCES = ["reviewer", "teacher", "school", "print_error", "proof_read"] as const;
export type BookFeedbackSource = (typeof BOOK_FEEDBACK_SOURCES)[number];
export const BOOK_FEEDBACK_CATEGORIES = ["spelling", "grammar", "fact", "sacred_text", "picture", "layout", "instruction", "exercise", "other"] as const;
export type BookFeedbackCategory = (typeof BOOK_FEEDBACK_CATEGORIES)[number];
export const BOOK_FEEDBACK_CATEGORY_BN: Record<BookFeedbackCategory, string> = {
  spelling: "বানান",
  grammar: "ব্যাকরণ",
  fact: "তথ্য",
  sacred_text: "কুরআন/হাদিস/দোয়া",
  picture: "ছবি",
  layout: "বিন্যাস",
  instruction: "নির্দেশনা",
  exercise: "অনুশীলনী",
  other: "অন্যান্য",
};
export const BOOK_FEEDBACK_ROUTES = ["needs_reviewer", "direct_fix", "verbal_errata"] as const;
export type BookFeedbackRoute = (typeof BOOK_FEEDBACK_ROUTES)[number];
export const BOOK_FEEDBACK_STATUSES = ["open", "with_reviewer", "accepted", "applied", "rejected", "duplicate"] as const;
export type BookFeedbackStatus = (typeof BOOK_FEEDBACK_STATUSES)[number];
export const BOOK_FEEDBACK_STATUS_BN: Record<BookFeedbackStatus, string> = {
  open: "নতুন",
  with_reviewer: "পর্যালোচকের কাছে",
  accepted: "গৃহীত",
  applied: "সংশোধিত",
  rejected: "বাতিল",
  duplicate: "একই",
};

export const BOOK_DECISION_STATUSES = ["open", "ruled", "superseded"] as const;
export type BookDecisionStatus = (typeof BOOK_DECISION_STATUSES)[number];

export const BOOK_EDIT_DRAFT_SOURCES = ["ai_job", "mcp", "bundle", "upload"] as const;
export type BookEditDraftSource = (typeof BOOK_EDIT_DRAFT_SOURCES)[number];
export const BOOK_EDIT_DRAFT_STATUSES = ["open", "submitted", "ready", "accepted", "rejected", "stale", "abandoned"] as const;
export type BookEditDraftStatus = (typeof BOOK_EDIT_DRAFT_STATUSES)[number];
export const BOOK_DRAFT_CHAPTER_STATUSES = ["pending", "edited", "unchanged", "failed", "accepted", "rejected"] as const;
export type BookDraftChapterStatus = (typeof BOOK_DRAFT_CHAPTER_STATUSES)[number];
export const BOOK_VERSION_BUMPS = ["minor", "major"] as const;
export type BookVersionBump = (typeof BOOK_VERSION_BUMPS)[number];

export const BOOK_EDIT_JOB_STATUSES = ["queued", "running", "done", "partial", "failed", "stopped", "stale_base"] as const;
export type BookEditJobStatus = (typeof BOOK_EDIT_JOB_STATUSES)[number];

export const BOOK_RELEASE_STATUSES = ["prepared", "sent_to_press", "printed", "superseded"] as const;
export type BookReleaseStatus = (typeof BOOK_RELEASE_STATUSES)[number];
export const BOOK_RELEASE_STATUS_BN: Record<BookReleaseStatus, string> = {
  prepared: "প্রস্তুত",
  sent_to_press: "ছাপাখানায়",
  printed: "ছাপা হয়েছে",
  superseded: "পুরোনো",
};
export const BOOK_RELEASE_FILE_KINDS = ["idml_zip", "preview_pdf", "print_pdf", "images_zip", "pageplan_json", "checks_json"] as const;
export type BookReleaseFileKind = (typeof BOOK_RELEASE_FILE_KINDS)[number];

export const BOOK_ERRATUM_STATUSES = ["draft", "announced", "withdrawn"] as const;
export type BookErratumStatus = (typeof BOOK_ERRATUM_STATUSES)[number];

/** Derived book status for lists (§4.5). */
export const BOOK_LIST_STATUSES = ["drafting", "in_review", "approved", "final", "in_print", "in_use"] as const;
export type BookListStatus = (typeof BOOK_LIST_STATUSES)[number];

/** `C1-BAN`, `C5-ENG-SCH` (§5.1). */
export const BOOK_CODE_RE = /^[A-Z0-9]{1,4}-[A-Z0-9]{2,8}(-[A-Z0-9]{1,8})?$/;

export const BOOK_LC_LIMITS = {
  /** A chapter over this is cut into parts for the API (§6.2). */
  apiPartChars: 60_000,
  /** VR-11 hard cap on one chapter. */
  chapterChars: 150_000,
  /** VR-4. */
  opsPerChapter: 300,
  masterMdBytes: 5 * 1024 * 1024,
  masterDocxBytes: 40 * 1024 * 1024,
  masterPdfBytes: 100 * 1024 * 1024,
  mediaBytes: 15 * 1024 * 1024,
  mediaZipBytes: 200 * 1024 * 1024,
  packetBytes: 150 * 1024 * 1024,
  scanBytes: 100 * 1024 * 1024,
  photoBytes: 5 * 1024 * 1024,
  printBytes: 250 * 1024 * 1024,
  historyBytes: 50 * 1024 * 1024,
  feedbackText: 2_000,
  reviewerName: 120,
  where: 200,
  quote: 500,
  page: 20,
  excerpt: 300,
  reason: 500,
  changeSummary: 2_000,
  reviewerNote: 5_000,
  instruction: 4_000,
  ruleSetBody: 200_000,
} as const;

/** Bangla one-line reasons for validator findings and refusals (§12.3; VR-* codes). */
export const BOOK_EDIT_REASONS = {
  VR1_STALE: "খসড়ার ভিত্তি-সংস্করণ আর সর্বশেষ নয় — নতুন খসড়া খুলুন",
  VR1_BASE_SHA: "অধ্যায়ের baseSha খসড়ার ভিত্তির সাথে মেলে না",
  VR2_SCHEMA: "কাঠামো ভুল",
  VR2_METHOD: "পদ্ধতির সংস্করণ খসড়ার সাথে মেলে না",
  VR3_UNKNOWN_REF: "অজানা সূত্র",
  VR3_DEAD_REF: "বাতিল/একই চিহ্নিত মতামত উল্লেখ করা যাবে না",
  VR4_NOT_FOUND: "উদ্ধৃত লেখা অধ্যায়ে পাওয়া যায়নি",
  VR4_NOT_UNIQUE: "উদ্ধৃত লেখা একাধিকবার আছে",
  VR4_OVERLAP: "দুটি পরিবর্তন একই জায়গায় পড়েছে",
  VR4_SAME: "নতুন লেখা পুরোনোর মতোই",
  VR4_TOO_MANY: "একটি অধ্যায়ে ৩০০-র বেশি পরিবর্তন",
  VR5_SCOPE: "এই অধ্যায় খসড়ার আওতার বাইরে",
  VR5_FRONT: "শুরুর অংশ বদলানোর মতো কোনো মতামত নেই",
  VR6_MARKER: "অধ্যায়-চিহ্ন বদলানো যাবে না",
  VR7_UNEXPLAINED: "ব্যাখ্যাহীন পরিবর্তন",
  VR8_PICTURE: "ছবির মতামত ছাড়া ছবি সরানো/যোগ করা যাবে না",
  VR8_MISSING_MEDIA: "নতুন ছবির ফাইল নেই",
  VR9_REGION: "সুরক্ষিত বা সার্ভার-অংশ বদলানো যাবে না",
  VR10_CHARS: "অনুমোদিত নয় এমন অক্ষর/HTML/লিংক",
  VR11_GROWTH: "অধ্যায় দেড়গুণের বেশি বড় হয়েছে",
  VR11_MAX: "অধ্যায় ১,৫০,০০০ অক্ষরের বেশি",
  VR12_SACRED: "কুরআন/হাদিস/দোয়ার লেখা কেবল পর্যালোচকের রায়-দেওয়া মতামত থেকে হুবহু বসানো যায়",
  VR13_LEXICON: "নিয়ম-তালিকার বানানের সাথে মেলে না",
  VR14_SILENT: "চুপচাপ বাদ পড়েছে",
  PROTECTED_CHANGED: "সুরক্ষিত লেখা বদলেছে — কেবল চূড়ান্তকারী নিশ্চিত করে তুলতে পারেন",
  REGION_UNMATCHED: "সুরক্ষিত/সার্ভার অংশ খুঁজে পাওয়া যায়নি",
} as const;
export type BookEditReasonCode = keyof typeof BOOK_EDIT_REASONS;

// ---------------------------------------------------------------------------
// Version numbers (§4.2)
// ---------------------------------------------------------------------------

export interface BookVersionNo {
  major: number;
  minor: number;
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export function toBnDigits(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/** `v7` for minor 0, else `v7.4`. */
export function formatBookVersion(v: BookVersionNo): string {
  return v.minor === 0 ? `v${v.major}` : `v${v.major}.${v.minor}`;
}
/** `সংস্করণ ৭.৪`. */
export function formatBookVersionBn(v: BookVersionNo): string {
  return `সংস্করণ ${toBnDigits(v.minor === 0 ? String(v.major) : `${v.major}.${v.minor}`)}`;
}
/** Accepts `v7`, `v7.4`, `7.4`; null when malformed. */
export function parseBookVersion(s: string): BookVersionNo | null {
  const m = /^v?(\d{1,3})(?:\.(\d{1,3}))?$/.exec(s.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] === undefined ? 0 : Number(m[2]) };
}
export function compareBookVersion(a: BookVersionNo, b: BookVersionNo): number {
  return a.major !== b.major ? a.major - b.major : a.minor - b.minor;
}
export function nextBookVersion(parent: BookVersionNo, bump: BookVersionBump): BookVersionNo {
  return bump === "major" ? { major: parent.major + 1, minor: 0 } : { major: parent.major, minor: parent.minor + 1 };
}
/** Refs a change may cite: F-n (feedback), I-n (instruction), D-n / D-0n (decision). */
export const BOOK_REF_RE = /^(F|I|D)-\d{1,5}$/;
