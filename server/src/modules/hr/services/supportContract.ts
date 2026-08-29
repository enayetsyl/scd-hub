/**
 * The Bangla support-staff contract — নিয়োগ চুক্তিপত্র (SH/D-#586).
 *
 * The খালা and দারোয়ান contracts the school actually uses are ONE document with two
 * fillings: the same eight numbered sections, differing in the title, the duties
 * schedule, the hours, and (for the দারোয়ান) a food allowance. So there is one
 * template here and a per-role DEFAULT for the two parts that genuinely differ.
 *
 * The duty lists below are transcribed from the school's own signed contracts. They are
 * DEFAULTS, not law: the issue form loads them and the operator edits before issuing,
 * because a duties schedule is the part of a contract most likely to be negotiated per
 * person, and because a hard-coded list would silently become wrong the first time the
 * school changed what a দারোয়ান does.
 *
 * The leave line follows the school-wide pool (20 days, D-#539) rather than the 36 days
 * one sample contract carried — the owner's ruling, so that what the contract promises
 * and what আমার ছুটি shows are the same number.
 */

/** Which default duties schedule to load. Support staff are one HR category, so the
 *  ROLE is chosen at issue rather than derived — a school may hire a cook next. */
export const SUPPORT_ROLES = ["helper", "guard"] as const;
export type SupportRole = (typeof SUPPORT_ROLES)[number];

export const SUPPORT_ROLE_LABELS_BN: Record<SupportRole, string> = {
  helper: "খালা (সহায়ক কর্মী)",
  guard: "দারোয়ান (গেটকিপার)",
};

/** The contract's own title line, as it heads the page. */
export const SUPPORT_CONTRACT_TITLE_BN: Record<SupportRole, string> = {
  helper: "খালা (সহায়ক কর্মী – পরিচ্ছন্নতা ও সহায়তা কার্যক্রম) নিয়োগ চুক্তিপত্র",
  guard: "দারোয়ান নিয়োগ চুক্তিপত্র",
};

export const SUPPORT_WORKING_HOURS_BN: Record<SupportRole, string> = {
  helper: "কর্মঘণ্টা: প্রতিদিন সকাল ৭:০০ টা হতে সন্ধ্যা ৬:৩০ টা পর্যন্ত। সপ্তাহে ৬ (ছয়) দিন ডিউটি করতে হবে।",
  guard: "কর্মী প্রতিদিন ২৪ (চব্বিশ) ঘণ্টা প্রাতিষ্ঠানিক ভবনের সার্বিক নিরাপত্তার দায়িত্বে নিয়োজিত থাকবেন।",
};

export const SUPPORT_DUTIES_BN: Record<SupportRole, string[]> = {
  helper: [
    "নির্ধারিত ফ্লোরের সকল শ্রেণিকক্ষের সব কিছু (টেবিল, চেয়ার, বেঞ্চ ইত্যাদি) পরিষ্কার-পরিচ্ছন্ন রাখা।",
    "শিক্ষার্থীদের জন্য টিফিন স্কুলে পৌঁছানোর পরে নির্ধারিত বাটিতে পরিবেশনের জন্য প্রস্তুত রাখা।",
    "টিফিনের সময় প্রস্তুতকৃত খাবার পরিবেশন ও বিতরণ করা, যথাযথ হিসাব রাখা এবং দায়িত্বরত ব্যক্তিকে বিতরণের সঠিক সংখ্যা অবগত করা।",
    "সার্বক্ষণিকভাবে নিজ দায়িত্বপ্রাপ্ত ফ্লোরে উপস্থিত থাকা। প্রয়োজন ব্যতীত নিজ ফ্লোর থেকে কোথাও যাওয়া যাবে না।",
    "উস্তাজ/উস্তাজাদের প্রয়োজনীয় কাজে সহযোগিতা করা।",
    "পর্দা সহকারে থাকতে হবে এবং ইসলামিক সকল নিয়ম মেনে চলতে হবে।",
    "উপরোক্ত দায়িত্ব ছাড়াও প্রয়োজনে কর্তৃপক্ষের নির্দেশনা অনুযায়ী অতিরিক্ত দায়িত্ব পালন করতে বাধ্য থাকবেন।",
  ],
  guard: [
    "প্রতিষ্ঠানে আগত সকল শিক্ষার্থী, শিক্ষক, অতিথি ও অভিভাবকবৃন্দের আগমন ও বহির্গমন নিয়ন্ত্রণ করা।",
    "পুরো ভবনের নিরাপত্তা নিশ্চিত করা, বিশেষ করে রাতের বেলায় গেট বন্ধ রাখা এবং অচেনা বা সন্দেহজনক ব্যক্তিকে পর্যবেক্ষণ করা।",
    "প্রতিষ্ঠানের জানমাল রক্ষা করা, যেন কোনো ধরনের চুরি, ক্ষতি বা অপব্যবহার না ঘটে।",
    "প্রয়োজনে রেজিস্টারে আগত ব্যক্তির নাম, ফোন নম্বর ও সময় এন্ট্রি করা এবং অনুমতি ব্যতীত কাউকে প্রবেশ করতে না দেওয়া।",
    "প্রতিষ্ঠানের যে কোনো সম্পত্তি বা মালামাল গেট দিয়ে বের হওয়ার পূর্বে কর্তৃপক্ষের লিখিত অনুমতি গ্রহণ নিশ্চিত করা।",
    "রাতে গেট লক করার পূর্বে ভবনের চারপাশে টহল দেওয়া এবং অস্বাভাবিক কিছু লক্ষ্য করলে তাৎক্ষণিকভাবে কর্তৃপক্ষকে অবহিত করা।",
    "প্রতিষ্ঠানে ব্যবহৃত সিসি ক্যামেরা বা নিরাপত্তা সরঞ্জাম ঠিকভাবে চলছে কি না তা নিয়মিত পর্যবেক্ষণ করা এবং সমস্যার বিষয়ে রিপোর্ট প্রদান করা।",
    "কোনো ধরনের ভাঙচুর, বিশৃঙ্খলা বা নিরাপত্তা বিঘ্নের ঘটনা ঘটলে সঙ্গে সঙ্গে কর্তৃপক্ষকে জানানো ও প্রাথমিক প্রতিরোধমূলক পদক্ষেপ গ্রহণ করা।",
    "আগুন লাগার বা অন্য জরুরি পরিস্থিতিতে ফায়ার এক্সটিংগুইশার ব্যবহার করতে সক্ষম থাকা এবং প্রতিষ্ঠানের নির্ধারিত জরুরি নিরাপত্তা প্রটোকল অনুযায়ী ব্যবস্থা নেওয়া।",
    "অফিস টাইমের বাইরে কেউ প্রবেশ করতে চাইলে বিশেষভাবে সতর্ক হয়ে অনুমতির বিষয়টি নিশ্চিত করা।",
    "প্রতিষ্ঠানের প্রবেশপথে বহিরাগত যানবাহন ঢুকতে না দেওয়া, বিশেষ করে স্কুল টাইমে ও ছুটির সময়ে।",
    "কর্তৃপক্ষের নির্দেশ অনুযায়ী যাবতীয় দায়িত্ব পালন করা।",
  ],
};

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
/** Latin digits → Bangla. The contract is Bangla throughout, dates and money included. */
export function bnDigits(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/**
 * The Bangla WORD for a small whole number, for the contract's "২০ (বিশ) দিন" style.
 *
 * The source contracts write the digits and then the word — "২০ (বিশ) দিন", "৩ (তিন)
 * মাস". The first version printed the digits twice ("২০ (২০) দিন"), which reads as a
 * typo on a document someone signs (D-#590). Beyond the table the bracket is dropped
 * rather than filled with a wrong word: a contract should never invent Bangla.
 */
const BN_WORDS: Record<number, string> = {
  1: "এক", 2: "দুই", 3: "তিন", 4: "চার", 5: "পাঁচ", 6: "ছয়", 7: "সাত", 8: "আট",
  9: "নয়", 10: "দশ", 11: "এগারো", 12: "বারো", 15: "পনেরো", 18: "আঠারো", 20: "বিশ",
  21: "একুশ", 24: "চব্বিশ", 25: "পঁচিশ", 30: "ত্রিশ", 36: "ছত্রিশ", 40: "চল্লিশ",
  45: "পঁয়তাল্লিশ", 50: "পঞ্চাশ", 60: "ষাট",
};

/** "২০ (বিশ)" when the word is known, plain "২০" when it is not. */
export function bnCount(n: number): string {
  const word = BN_WORDS[n];
  return word ? `${bnDigits(n)} (${word})` : bnDigits(n);
}

const MONTHS_BN = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

/** "2025-06-24" → "২৪ জুন ২০২৫". Falls back to the key if it is not a date. */
export function longDateBn(dateKey: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey ?? "");
  if (!m) return dateKey ?? "";
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return dateKey ?? "";
  return `${bnDigits(Number(m[3]))} ${MONTHS_BN[monthIdx]} ${bnDigits(m[1])}`;
}

/** "১০,০০০/- (দশ হাজার) টাকা" is how the contracts write money; we print the figure and
 *  leave the words to the reader — a wrong words-in-Bangla conversion on a signed
 *  contract is worse than none. */
export function takaBn(n: number): string {
  return `${bnDigits(n.toLocaleString("en-US"))}/- টাকা`;
}
