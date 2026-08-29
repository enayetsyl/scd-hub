/**
 * Taka in words, the way the school's own advice letter writes it (D-#591):
 * "Tk. 160,500/- (One Lac Sixty Thousand Five Hundred Only)".
 *
 * The BANGLADESHI grouping, not the international one — crore, lac, thousand, hundred.
 * 160,500 is "One Lac Sixty Thousand Five Hundred", never "One Hundred Sixty Thousand
 * Five Hundred". Getting this wrong on a payment instruction is the kind of error a
 * bank rejects the letter for, and the figure in words is the one that governs when the
 * two disagree.
 *
 * Whole taka only: every amount the app produces is already rounded to the taka
 * (payrollMath rounds every line), so there are no poisha to spell.
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
  "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0–99. */
function underHundred(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

/** 0–999. */
function underThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(`${ONES[h]} Hundred`);
  if (rest > 0) parts.push(underHundred(rest));
  return parts.join(" ");
}

/**
 * "One Lac Sixty Thousand Five Hundred Only" — capitalised as the letter has it, with
 * the trailing "Only" the bank expects.
 */
export function takaInWords(amount: number): string {
  const n = Math.max(0, Math.round(amount));
  if (n === 0) return "Zero Only";

  const crore = Math.floor(n / 10000000);
  const lac = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${underThousand(crore)} Crore`);
  if (lac > 0) parts.push(`${underThousand(lac)} Lac`);
  if (thousand > 0) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest > 0) parts.push(underThousand(rest));

  return `${parts.join(" ")} Only`;
}

/** "160,500" — the figure beside the words. */
export function takaFigure(amount: number): string {
  return Math.round(amount).toLocaleString("en-US");
}
