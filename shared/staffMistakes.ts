// =============================================================================
// STAFF MISTAKE RECORD — kinds, statuses and reason buttons (D-#936–#939)
// =============================================================================
// docs/prd-staff-mistakes.md. Server and app read the same reason list, so the button a
// teacher taps and the code the server stores never drift apart.

/** Where a mistake was caught. MR-1 ships the homework/assignment same-day correction. */
export const STAFF_MISTAKE_KINDS = ["MARK_CORRECTION"] as const;
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
}

export const STAFF_MISTAKE_REASONS: Record<StaffMistakeKind, readonly StaffMistakeReason[]> = {
  MARK_CORRECTION: [
    { code: "MINE", bn: "আমার ভুল ছিল", en: "It was my mistake", hintBn: "ভুল করে \"জমা দেয়নি\" চিহ্নিত করেছিলাম", selfCounts: true },
    { code: "LATE_DIRECT", bn: "পরে সরাসরি আমার কাছে জমা দিয়েছে", en: "Handed to me directly later", hintBn: "ক্লাস ক্যাপ্টেন / অফিসে জমা দেয়নি; ক্লাসে যাওয়ার পর আমার হাতে দিয়েছে" },
    { code: "OFFICE_LATE", bn: "অফিস থেকে খাতা দেরিতে বা কম পেয়েছি", en: "Office handed the scripts over late or short", hintBn: "অফিসে জমা ছিল, কিন্তু আমার কাছে পৌঁছায়নি" },
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
