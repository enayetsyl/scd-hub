/**
 * Pack fixtures P-01 … P-08 (docs/prd-child-support-profile.md §16.9). The roster is invented
 * (supportFixtures.ROSTER); these are the report texts that must come out masked or refused.
 */
export const PACK_TEXTS = {
  /** P-01: the child's first and full name inside the text → [S] both times. */
  p01: (first: string, full: string) => `${first} আজ দলে অঙ্ক করেছে। পরে ${full} বোর্ডে এসে উত্তর দিয়েছে।`,
  /** P-02: a classmate's listed nickname that passed intake → [অন্য শিশু]. */
  p02: (nick: string) => `টিফিনে সে ${nick}-এর সাথে খেলেছে এবং পালা মেনে খেলেছে।`,
  /** P-03: a teacher's name inside the text → that teacher's T- code (an author in the batch), or
   *  [শিক্ষক] when the teacher is not in the batch's map (DE-2). */
  p03: (author: string, other: string) => `${author} আপা বলেছেন সে আজ চুপচাপ ছিল; ${other} স্যারও তাই বলেছেন।`,
  /** P-04: a phone number typed into settingNote → masked. */
  p04: "অভিভাবক ফোন করতে বলেছেন 01712345678 নম্বরে।",
  /** P-05: a guardian's name in an unusual spelling that only the final scan finds → refused. */
  p05: "Abdool Kareem এসে খাতা নিয়ে গেছেন।",
};
export const CLASSMATE_NICKNAME = "টুনটুন";
