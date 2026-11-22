/**
 * AL-5: `HomeworkItem.paperId` is the MasteryPaper's Mongo _id, but every mastery read / write (`masteryPaper`,
 * `saveMasteryResults`, `confirmMasteryPaper`) takes the paper CODE ("MP-…"). The app gets both: the code for the
 * mastery calls, the Mongo id only for the print request. One bounded query for the papers of a list of items.
 */
import { Types } from "mongoose";
import { MasteryPaper } from "../mastery/models/MasteryPaper";

export async function paperCodesOf(ids: ReadonlyArray<Types.ObjectId | string | null | undefined>): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is Types.ObjectId | string => Boolean(x)).map(String))].filter((s) => Types.ObjectId.isValid(s));
  const out = new Map<string, string>();
  if (want.length === 0) return out;
  for (const p of await MasteryPaper.find({ _id: { $in: want } }).select("paperId").lean()) out.set(String(p._id), p.paperId);
  return out;
}
