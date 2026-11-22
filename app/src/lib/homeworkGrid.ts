/**
 * homeworkGrid — the tick-wrong grid's cell logic for a whole শাখা (AL-5, B7, AC-B4, AC-B12, R35).
 *
 * PURE module (no React / React Native / `labels` import) so the server suite can unit-test it, the posture
 * `giftGrouping.ts` takes — the app workspace has no test runner.
 *
 * Every cell starts at FULL marks. A tap cycles full → ½ → 0 → full, and the ½ step exists only where half of the
 * question's marks is itself a multiple of 0.5 (the server saves lost marks in 0.5 steps): a 1- or 2-mark question
 * has a ½, a 1½- or 2½-mark one does not. A cell the server holds at some other value (an older entry, e.g. 3 of 5)
 * shows that number and the next tap resets it to full.
 *
 * Only EXCEPTIONS are saved (D-#778): a full cell with no re-work and no tag is no row at all. A cell's tags and
 * re-work flag belong to the item-by-item entry screen and ride along untouched when the grid changes its marks.
 */

export type CellState = "FULL" | "HALF" | "ZERO" | "CUSTOM";

export interface GridItemX {
  itemNo: number;
  /** Marks earned; null = full marks (the exception row carries only a re-work / tag). */
  marks: number | null;
  rework: boolean;
  tags: string[];
}

/** May the ½ step be offered on a question worth `itemMarks`? */
export const allowsHalf = (itemMarks: number): boolean => Number.isInteger(itemMarks) && itemMarks >= 1;

/** Marks a student holds on one item right now (an absent row = full). */
export const earnedOf = (items: readonly GridItemX[], itemNo: number, itemMarks: number): number => {
  const x = items.find((i) => i.itemNo === itemNo);
  return x && x.marks !== null ? x.marks : itemMarks;
};

export function cellState(earned: number, itemMarks: number): CellState {
  if (earned === itemMarks) return "FULL";
  if (earned === 0) return "ZERO";
  if (allowsHalf(itemMarks) && earned === itemMarks / 2) return "HALF";
  return "CUSTOM";
}

/** The marks a tap moves a cell to. */
export function nextEarned(earned: number, itemMarks: number): number {
  switch (cellState(earned, itemMarks)) {
    case "FULL":
      return allowsHalf(itemMarks) ? itemMarks / 2 : 0;
    case "HALF":
      return 0;
    default: // ZERO → full; CUSTOM → reset to full
      return itemMarks;
  }
}

/** One tap on (student, item): the student's new exception list. Other items, tags and re-work are untouched. */
export function tapCell(items: readonly GridItemX[], itemNo: number, itemMarks: number): GridItemX[] {
  const earned = nextEarned(earnedOf(items, itemNo, itemMarks), itemMarks);
  const cur = items.find((i) => i.itemNo === itemNo) ?? { itemNo, marks: null, rework: false, tags: [] };
  const next: GridItemX = { ...cur, marks: earned === itemMarks ? null : earned };
  const rest = items.filter((i) => i.itemNo !== itemNo);
  const keep = next.marks !== null || next.rework || next.tags.length > 0;
  return keep ? [...rest, next].sort((a, b) => a.itemNo - b.itemNo) : rest;
}

/** What the child scored on the items shown: { earned, available }. */
export function childTotal(items: readonly GridItemX[], paperItems: readonly { itemNo: number; marks: number }[]): { earned: number; available: number } {
  let earned = 0;
  let available = 0;
  for (const it of paperItems) {
    available += it.marks;
    earned += earnedOf(items, it.itemNo, it.marks);
  }
  return { earned, available };
}

/** What a cell shows: the earned marks as a plain figure (no result word, R35). */
export const cellLabel = (earned: number, itemMarks: number, num: (n: number | string) => string): string => {
  const e = Number.isInteger(earned) ? String(earned) : String(Math.round(earned * 2) / 2);
  const m = Number.isInteger(itemMarks) ? String(itemMarks) : String(Math.round(itemMarks * 2) / 2);
  return `${num(e)}/${num(m)}`;
};

/** A free-line "হয়নি" tick: toggles line `index` in the child's not-done list (0-based, sorted, no duplicates). */
export function toggleNotDone(notDone: readonly number[], index: number): number[] {
  return notDone.includes(index) ? notDone.filter((n) => n !== index) : [...notDone, index].sort((a, b) => a - b);
}

/** The grid is read-only for a child who is absent or has no record for the item (AC-B9: never full marks). */
export function rowEditable(defaultStatus: string, resultStatus: string | null, hasRecord: boolean): boolean {
  const status = resultStatus ?? defaultStatus;
  return hasRecord && status === "PRESENT";
}

const PART_LETTERS = ["ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ", "ঝ", "ঞ"];

/** The numbers as printed on the sheet (ক/খ parts, D-#926): consecutive parts of one stem share a number and are
 *  lettered (৪(ক), ৪(খ)); a lone part is a plain number. `num` formats digits (the language-aware `bnNum`). */
export function printedLabels(items: readonly { stimulusRef?: string | null }[], num: (n: number | string) => string): string[] {
  const nos: number[] = [];
  let no = 0;
  items.forEach((it, i) => {
    const ref = it.stimulusRef ?? null;
    if (!(ref !== null && ref === (items[i - 1]?.stimulusRef ?? null))) no += 1;
    nos.push(no);
  });
  return nos.map((n, i) => {
    const first = nos.indexOf(n);
    const size = nos.lastIndexOf(n) - first + 1;
    return size >= 2 ? `${num(n)}(${PART_LETTERS[i - first] ?? num(i - first + 1)})` : num(n);
  });
}

/** Student-ID order (D-#1463): numeric-aware on the ID, a child with no ID after the others, then by name. */
export function byStudentId<T extends { schoolId?: string | null; name: string }>(rows: readonly T[]): T[] {
  return rows.slice().sort((a, b) => {
    const x = a.schoolId ?? "";
    const y = b.schoolId ?? "";
    if (x && !y) return -1;
    if (!x && y) return 1;
    return x.localeCompare(y, "en", { numeric: true }) || a.name.localeCompare(b.name);
  });
}
