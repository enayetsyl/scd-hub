/**
 * KG Maths 2026 (D-#846) — read from the scans of the KG Math (Bangla) and Math (English)
 * books and the 2025 KG final. The Bangla book prints number words only for 1–50 (pp. 5–9),
 * so no Bangla number word above 50 is generated. Its spellings: এগারো, বারো, ষোলো, উনিশ but
 * ঊনত্রিশ/ঊনচল্লিশ/ঊনপঞ্চাশ (long ঊ), বিয়াল্লিশ, ছেচল্লিশ.
 */

export const BN_NUMBER_WORDS: Record<number, string> = {
  "1": "এক",
  "2": "দুই",
  "3": "তিন",
  "4": "চার",
  "5": "পাঁচ",
  "6": "ছয়",
  "7": "সাত",
  "8": "আট",
  "9": "নয়",
  "10": "দশ",
  "11": "এগারো",
  "12": "বারো",
  "13": "তেরো",
  "14": "চৌদ্দ",
  "15": "পনেরো",
  "16": "ষোলো",
  "17": "সতেরো",
  "18": "আঠারো",
  "19": "উনিশ",
  "20": "বিশ",
  "21": "একুশ",
  "22": "বাইশ",
  "23": "তেইশ",
  "24": "চব্বিশ",
  "25": "পঁচিশ",
  "26": "ছাব্বিশ",
  "27": "সাতাশ",
  "28": "আটাশ",
  "29": "ঊনত্রিশ",
  "30": "ত্রিশ",
  "31": "একত্রিশ",
  "32": "বত্রিশ",
  "33": "তেত্রিশ",
  "34": "চৌত্রিশ",
  "35": "পঁয়ত্রিশ",
  "36": "ছত্রিশ",
  "37": "সাঁইত্রিশ",
  "38": "আটত্রিশ",
  "39": "ঊনচল্লিশ",
  "40": "চল্লিশ",
  "41": "একচল্লিশ",
  "42": "বিয়াল্লিশ",
  "43": "তেতাল্লিশ",
  "44": "চুয়াল্লিশ",
  "45": "পঁয়তাল্লিশ",
  "46": "ছেচল্লিশ",
  "47": "সাতচল্লিশ",
  "48": "আটচল্লিশ",
  "49": "ঊনপঞ্চাশ",
  "50": "পঞ্চাশ"
};

/** The highest number with a Bangla word in the book. */
export const BN_NUMBER_WORDS_MAX = 50;

const EN_UNITS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** The book's style (pp. 8–12): Title Case, a space and no hyphen — "Twenty One". */
export function enNumberWord(n: number): string {
  if (n === 100) return "One Hundred";
  if (n < 20) return EN_UNITS[n];
  const t = EN_TENS[Math.floor(n / 10)];
  return n % 10 ? `${t} ${EN_UNITS[n % 10]}` : t;
}
