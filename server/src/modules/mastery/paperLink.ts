/**
 * Which tracker row a mastery paper belongs to, and the pure marks arithmetic of the 2027 write-back
 * (AL-4, docs/prd-academic-loop-2027.md §3.1, D-#1669). Kept light — models and the release-switch read only — so
 * the homework / assignment services can import it without pulling the mastery services (no import cycle).
 *
 * Everything that CHANGES behaviour is gated by `academicLoop2027On` (§3.6): with the switch off a linked paper
 * behaves exactly as in 2026 — no guard, no cache, no deferred ledger write.
 */
import { Types } from "mongoose";
import { MasteryPaper, type IMasteryPaper } from "./models/MasteryPaper";
import { isLoop2027On } from "../assessment/services/QuestionUseService";

/** Shown when someone tries to type a result / marks on a tracker record whose work is a question sheet. */
export const SHEET_GUARD_MESSAGE = "প্রশ্নভিত্তিক শিটে নম্বর দিন — এই কাজের নম্বর শিট থেকেই আসে।";

/** The class HW paper linked to a homework item (never an extra-homework sheet), or null. */
export async function linkedHwPaper(hwItemId: Types.ObjectId | string): Promise<IMasteryPaper | null> {
  if (!Types.ObjectId.isValid(String(hwItemId))) return null;
  return MasteryPaper.findOne({ "links.hwItemId": new Types.ObjectId(String(hwItemId)), extra: { $ne: true }, trackerLinked: true });
}

/** The AS paper linked to an assignment item, or null. */
export async function linkedAsPaper(asItemId: Types.ObjectId | string): Promise<IMasteryPaper | null> {
  if (!Types.ObjectId.isValid(String(asItemId))) return null;
  return MasteryPaper.findOne({ "links.asItemId": new Types.ObjectId(String(asItemId)), trackerLinked: true });
}

/**
 * §3.1 guard 3: with the switch on, a record whose item has a linked paper takes no hand-typed result or marks.
 * Returns the refusal sentence, or null (switch off, or no linked paper: the record checks as today).
 */
export async function manualCheckRefusal(tracker: "HOMEWORK" | "ASSIGNMENT", itemId: Types.ObjectId | string): Promise<string | null> {
  if (!(await isLoop2027On())) return null;
  const paper = tracker === "HOMEWORK" ? await linkedHwPaper(itemId) : await linkedAsPaper(itemId);
  return paper ? SHEET_GUARD_MESSAGE : null;
}

/** True when the paper is tied to a homework / assignment item (so §3.1's guards and write-back apply, switch on). */
export function isTrackerLinked(paper: Pick<IMasteryPaper, "links" | "extra" | "source" | "trackerLinked">): boolean {
  if (paper.extra || paper.trackerLinked !== true) return false; // AL-4-created only — never `links.*` alone
  return Boolean(paper.links?.hwItemId) || (paper.source === "AS" && Boolean(paper.links?.asItemId));
}

/** Half marks only (the grid steps in 0.5). */
export const roundHalf = (n: number): number => Math.round(n * 2) / 2;

export interface PaperItemMarks {
  itemNo: number;
  marks: number;
}

/**
 * One child's total on a paper: Σ marks of the items on THEIR sheet (`given` = their item numbers; omitted = every
 * item), minus what the grid took off. `lost` maps itemNo → marks the child EARNED on that item when they lost some
 * (the grid stores the earned figure; no row = full marks).
 */
export function childTotals(
  items: PaperItemMarks[],
  earnedByItem: Map<number, number | undefined>,
  given?: Set<number>,
): { earned: number; available: number } {
  let earned = 0;
  let available = 0;
  for (const it of items) {
    if (given && !given.has(it.itemNo)) continue;
    available += it.marks;
    const e = earnedByItem.get(it.itemNo);
    earned += Math.min(it.marks, Math.max(0, e === undefined || e === null ? it.marks : e));
  }
  return { earned: roundHalf(earned), available: roundHalf(available) };
}

/** The internal result word from a percentage (policy: ≥ masteredAtPct CORRECT, ≥ weakBelowPct PARTIAL, else WRONG). */
export function resultFromPct(earned: number, available: number, masteredAtPct: number, weakBelowPct: number): "CORRECT" | "PARTIAL" | "WRONG" | null {
  if (!(available > 0)) return null;
  const pct = (earned / available) * 100;
  if (pct >= masteredAtPct) return "CORRECT";
  if (pct >= weakBelowPct) return "PARTIAL";
  return "WRONG";
}
