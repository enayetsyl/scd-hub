/**
 * ক/খ parts (prd-objective-tree §8.2, D-#926). A question that tests two skills is authored as a
 * `stimulus` (the shared stem — the story, the passage) plus one `question` per part, each with ONE
 * code and its own marks; each part question names the stem by `payload.stimulus_ref`. Never two
 * codes on one item.
 *
 * On a work sheet the parts stay separate items (each part is its own result, evidence row and
 * code), but they print under one number and one stem: 4(ক), 4(খ). Pure — no database:
 *
 *   groupStimulusParts — stable reorder: the later parts of a stem move up beside its first part,
 *                        parts in authored order (qid) inside the group
 *   printPlan          — the printed number of every item, and its part label when its stem has
 *                        two or more parts on the same sheet (a lone part prints as a plain number
 *                        under its stem)
 *   partLabelsByItem   — the part label of every item of a paper (in item order), for storing on
 *                        MasteryPaper items
 */

/** The part letters, in order (ক খ গ …). */
export const PART_LABELS_BN = ["ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ", "ঝ", "ঞ"] as const;

export interface PartLike {
  stimulusRef?: string | null;
  qid?: string | null;
}

/** The stimulus a bank question's payload depends on, or null. */
export function stimulusRefOf(payload: Record<string, unknown> | null | undefined): string | null {
  const ref = payload?.stimulus_ref;
  return typeof ref === "string" && ref.trim() ? ref.trim() : null;
}

export function groupStimulusParts<T extends PartLike>(items: T[]): T[] {
  const out: T[] = [];
  const placed = new Set<number>();
  items.forEach((it, i) => {
    if (placed.has(i)) return;
    const ref = it.stimulusRef ?? null;
    if (!ref) {
      out.push(it);
      placed.add(i);
      return;
    }
    const group: { it: T; i: number }[] = [];
    items.forEach((o, j) => {
      if (j >= i && !placed.has(j) && (o.stimulusRef ?? null) === ref) group.push({ it: o, i: j });
    });
    // Authored order: the parts' qids run in the order they were written (…Q01 ক, …Q02 খ).
    if (group.every((g) => g.it.qid)) group.sort((a, b) => String(a.it.qid).localeCompare(String(b.it.qid)) || a.i - b.i);
    for (const g of group) {
      out.push(g.it);
      placed.add(g.i);
    }
  });
  return out;
}

export interface PrintLine<T> {
  item: T;
  /** The printed question number (parts of one stem share it). */
  no: number;
  /** "ক", "খ" … when the stem has ≥ 2 parts here; null otherwise. */
  partLabel: string | null;
  /** The stem this item hangs under, or null. */
  stimulusRef: string | null;
  /** The first item of its number — the stem (if any) prints above it. */
  startsGroup: boolean;
}

/**
 * Number the items as printed, starting after `startAt` (a sheet's Part B continues Part A's
 * numbers). Consecutive items with the same stem share one number; call groupStimulusParts first
 * so a stem's parts are consecutive.
 */
export function printPlan<T extends PartLike>(items: T[], startAt = 0): PrintLine<T>[] {
  const out: PrintLine<T>[] = [];
  let no = startAt;
  items.forEach((item, i) => {
    const ref = item.stimulusRef ?? null;
    const prev = i > 0 ? items[i - 1].stimulusRef ?? null : null;
    const continues = ref !== null && ref === prev;
    if (!continues) no += 1;
    out.push({ item, no, partLabel: null, stimulusRef: ref, startsGroup: !continues });
  });
  for (let s = 0; s < out.length; ) {
    let e = s + 1;
    while (e < out.length && out[e].no === out[s].no) e += 1;
    if (e - s >= 2) for (let k = s; k < e; k++) out[k].partLabel = PART_LABELS_BN[k - s] ?? String(k - s + 1);
    s = e;
  }
  return out;
}

/** A printed number as the sheet shows it: "4" or "4(ক)" (digits as given). */
export function printLabel(no: number | string, partLabel: string | null): string {
  return partLabel ? `${no}(${partLabel})` : String(no);
}

/**
 * Part labels for a paper's items in item order: within each stem, the parts in item order get
 * ক, খ …, but only when the stem has ≥ 2 parts on the paper. (An AS paper is the union of every
 * student's sheet, so a stem's parts need not be adjacent there.)
 */
export function partLabelsByItem<T extends PartLike>(items: T[]): (string | null)[] {
  const count = new Map<string, number>();
  for (const it of items) if (it.stimulusRef) count.set(it.stimulusRef, (count.get(it.stimulusRef) ?? 0) + 1);
  const seen = new Map<string, number>();
  return items.map((it) => {
    const ref = it.stimulusRef ?? null;
    if (!ref || (count.get(ref) ?? 0) < 2) return null;
    const k = seen.get(ref) ?? 0;
    seen.set(ref, k + 1);
    return PART_LABELS_BN[k] ?? String(k + 1);
  });
}
