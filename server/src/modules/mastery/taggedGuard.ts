/**
 * The tagged-row guard (D-#943, prd-objective-tree §4/§8.1): on a TREE catalogue an untagged
 * objective only groups its sub-objectives — questions, rubric grades and evidence name the
 * tagged rows. Wherever a teacher picks a code for a work-sheet item (paper entry, rubric, the
 * weekly assignment's own question / Part A), a grouping row's code is refused and the tagged
 * child codes to use are named. A flat M-0 catalogue has no untagged rows, so nothing changes there.
 */
import { MasteryOutcome } from "./models/MasteryOutcome";

/** A Bangla refusal naming the first grouping code and its tagged children, or null. */
export async function untaggedRefusal(codes: string[]): Promise<string | null> {
  const list = [...new Set(codes)];
  if (list.length === 0) return null;
  const grouping = await MasteryOutcome.find({ code: { $in: list }, tagged: false }).select("code").lean();
  if (grouping.length === 0) return null;
  const code = list.find((c) => grouping.some((g) => g.code === c))!;
  const kids = await MasteryOutcome.find({ parentCode: code, tagged: { $ne: false }, status: { $ne: "RETIRED" } })
    .select("code order")
    .sort({ order: 1, code: 1 })
    .lean();
  const names = kids.map((k) => k.code).join(", ");
  return `${code} একটি দলবদ্ধ সারি — প্রশ্নে বা নম্বরে এর নিচের কোড ব্যবহার করুন${names ? `: ${names}` : ""}।`;
}
