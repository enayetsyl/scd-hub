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
] as const;
export type StaffMistakeKind = (typeof STAFF_MISTAKE_KINDS)[number];

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
  disabledKinds: [],
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
