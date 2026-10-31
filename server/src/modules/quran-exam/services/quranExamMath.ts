/**
 * Pure helpers for the Quran oral exam (QX-1, docs/prd-quran-exam.md). No DB access, so
 * the marking rules and the move rule are unit-tested on their own.
 */

export interface PaperShape {
  scheme: "ITEMS" | "HIFZ_DEDUCTION";
  fullMarks: number;
  sections: { title: string; items: { label: string; marks: number }[]; deduction?: { tanbihPerMark: number; fathCost: number } | null }[];
  hifz?: { paras: number[]; tanbihPerMark: number; fathCost: number } | null;
}

export interface HifzCount {
  para: number;
  tanbih: number;
  fath: number;
}

/** "HH:mm" → minutes after midnight. */
export function toMin(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Bad time "${hhmm}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes after midnight → "HH:mm". */
export function fromMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Hifz mark (D-#874): full − floor(T / tanbihPerMark) − fathCost × F, never below 0,
 * T and F totalled over every count given (all the student's sittings, all paras).
 */
export function hifzMark(paper: PaperShape, counts: HifzCount[]): {
  tanbih: number;
  fath: number;
  tanbihCut: number;
  fathCut: number;
  mark: number;
} {
  const rule = paper.hifz;
  if (paper.scheme !== "HIFZ_DEDUCTION" || !rule) throw new Error("Not a Hifz paper");
  const tanbih = counts.reduce((a, c) => a + c.tanbih, 0);
  const fath = counts.reduce((a, c) => a + c.fath, 0);
  const tanbihCut = Math.floor(tanbih / rule.tanbihPerMark);
  const fathCut = fath * rule.fathCost;
  return { tanbih, fath, tanbihCut, fathCut, mark: Math.max(0, paper.fullMarks - tanbihCut - fathCut) };
}

/**
 * A deduction section's mark (D-#881): its full marks minus floor(T / tanbihPerMark) and
 * fathCost × F, never below 0 — the Hifz rule applied to one section of an ITEMS paper.
 */
export function sectionDeductionMark(
  marks: number,
  rule: { tanbihPerMark: number; fathCost: number },
  tanbih: number,
  fath: number,
): number {
  return Math.max(0, marks - Math.floor(tanbih / rule.tanbihPerMark) - fath * rule.fathCost);
}

/** Sum of an ITEMS paper's question marks (what `fullMarks` must equal). */
export function itemsFullMarks(paper: PaperShape): number {
  return paper.sections.reduce((a, s) => a + s.items.reduce((b, i) => b + i.marks, 0), 0);
}

/**
 * Validate one sitting's item marks against an ITEMS paper: same shape, each mark an
 * integer between 0 and that question's marks. Returns the total. Throws a message the
 * resolver can show.
 */
export function checkItemMarks(paper: PaperShape, marks: number[][]): number {
  if (paper.scheme !== "ITEMS") throw new Error("এই প্রশ্নপত্রে প্রশ্নভিত্তিক নম্বর নেই।");
  if (marks.length !== paper.sections.length) throw new Error("নম্বরের তালিকা প্রশ্নপত্রের সাথে মেলেনি।");
  let total = 0;
  paper.sections.forEach((s, si) => {
    const row = marks[si];
    if (!Array.isArray(row) || row.length !== s.items.length) {
      throw new Error("নম্বরের তালিকা প্রশ্নপত্রের সাথে মেলেনি।");
    }
    s.items.forEach((it, ii) => {
      const v = row[ii];
      if (!Number.isInteger(v) || v < 0 || v > it.marks) {
        throw new Error(`"${it.label}"-এর নম্বর ০ থেকে ${it.marks}-এর মধ্যে হতে হবে।`);
      }
      total += v;
    });
  });
  return total;
}

/** Validate Hifz counts for one sitting: only that sitting's paras, non-negative integers. */
export function checkHifzCounts(paras: number[], counts: HifzCount[]): HifzCount[] {
  const seen = new Set<number>();
  for (const c of counts) {
    if (!paras.includes(c.para)) throw new Error(`পারা ${c.para} এই বসার অংশ নয়।`);
    if (seen.has(c.para)) throw new Error(`পারা ${c.para} দুবার দেওয়া হয়েছে।`);
    seen.add(c.para);
    for (const v of [c.tanbih, c.fath]) {
      if (!Number.isInteger(v) || v < 0 || v > 999) throw new Error("তানবীহ/ফাত্হ ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে।");
    }
  }
  const missing = paras.filter((p) => !seen.has(p));
  if (missing.length) throw new Error(`পারা ${missing.join(", ")}-এর গণনা দিন।`);
  return paras.map((p) => counts.find((c) => c.para === p)!);
}

export interface Window {
  start: string;
  end: string;
}

function overlaps(a: Window, b: Window): boolean {
  return toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
}

/**
 * Where a moved sitting lands with a new examiner (D-#875): the same window if the
 * examiner is free then, otherwise right after their last sitting that day. `busy` is
 * the examiner's other sittings that day; `length` keeps the sitting's own length.
 */
export function placeForMove(current: Window, busy: Window[]): Window & { kept: boolean } {
  if (!busy.some((b) => overlaps(b, current))) return { ...current, kept: true };
  const length = toMin(current.end) - toMin(current.start);
  const lastEnd = Math.max(...busy.map((b) => toMin(b.end)));
  return { start: fromMin(lastEnd), end: fromMin(lastEnd + length), kept: false };
}

/** True when two windows of the same person overlap. */
export function windowsOverlap(a: Window, b: Window): boolean {
  return overlaps(a, b);
}
