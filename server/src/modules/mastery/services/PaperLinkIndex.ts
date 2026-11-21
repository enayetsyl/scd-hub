/**
 * AL-4 (docs/prd-academic-loop-2027.md §3.1, D-#1669): make `MasteryPaper.links.hwItemId` unique for CLASS homework.
 *
 * A partial index cannot use `$ne`, so the order is fixed: (1) backfill `extra: false` on every paper that has no
 * `extra` field, (2) duplicate check — refuse to build while two class papers share a homework item, (3) build the
 * partial unique index `{ "links.hwItemId": 1 }` with `{ extra: false, "links.hwItemId": { $exists: true } }`.
 * The index is built HERE (not by Mongoose autoIndex) only when the duplicate check is clean.
 *
 * The unique-index step (3) runs only while `academicLoop2027On` is true; the `extra:false` backfill (1) may run any time.
 * Idempotent. `apply: false` (the default) only counts. The script wrapper is `server/scripts/backfill-paper-extra-false.ts`.
 */
import { MasteryPaper } from "../models/MasteryPaper";
import { isLoop2027On } from "../../assessment/services/QuestionUseService";

export const PAPER_LINK_INDEX_NAME = "uniq_class_paper_per_hw_item";

export interface PaperLinkIndexReport {
  /** Papers with no `extra` field (set to false when applied). */
  missingExtra: number;
  /** Homework items that more than one class paper links to. */
  duplicates: { hwItemId: string; papers: string[] }[];
  /** The unique index is present (before this run, or built by it). */
  indexPresent: boolean;
  indexBuilt: boolean;
  /** --apply asked for the index but academicLoop2027On is false. */
  indexBlockedBySwitch: boolean;
}

export async function backfillPaperExtraFalse(opts: { apply?: boolean } = {}): Promise<PaperLinkIndexReport> {
  const apply = opts.apply === true;
  const missingExtra = await MasteryPaper.countDocuments({ extra: { $exists: false } });
  if (apply && missingExtra > 0) await MasteryPaper.updateMany({ extra: { $exists: false } }, { $set: { extra: false } });

  // Class papers = extra not true. In a dry run the not-yet-backfilled ones count too.
  const dup = await MasteryPaper.aggregate<{ _id: unknown; papers: string[]; n: number }>([
    { $match: { "links.hwItemId": { $exists: true }, extra: { $ne: true } } },
    { $group: { _id: "$links.hwItemId", n: { $sum: 1 }, papers: { $push: "$paperId" } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  const duplicates = dup.map((d) => ({ hwItemId: String(d._id), papers: d.papers }));

  const existing = await MasteryPaper.collection.indexes().catch(() => []);
  let indexPresent = existing.some((i) => i.name === PAPER_LINK_INDEX_NAME);
  let indexBuilt = false;
  let indexBlockedBySwitch = false;
  // The unique-index step refuses while the release switch is off (the extra:false backfill may run any time).
  const switchOn = await isLoop2027On();
  if (apply && duplicates.length === 0 && !indexPresent && !switchOn) indexBlockedBySwitch = true;
  if (apply && duplicates.length === 0 && !indexPresent && switchOn) {
    await MasteryPaper.collection.createIndex(
      { "links.hwItemId": 1 },
      { unique: true, name: PAPER_LINK_INDEX_NAME, partialFilterExpression: { extra: false, "links.hwItemId": { $exists: true } } },
    );
    indexPresent = true;
    indexBuilt = true;
  }
  return { missingExtra, duplicates, indexPresent, indexBuilt, indexBlockedBySwitch };
}
