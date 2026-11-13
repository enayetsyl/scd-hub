/**
 * Display names for bare user ids (D-#404: no populate across planes). The ONE place in the
 * book-lifecycle module, besides the resolvers, that reads the identity plane — and only `name`.
 * firewall.test.ts pins this.
 */
import { Types } from "mongoose";
import { User } from "../../foundation/models/User";

export async function namesOf(ids: (Types.ObjectId | string | undefined | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean).map((x) => String(x)))].filter((x) => Types.ObjectId.isValid(x));
  if (!list.length) return new Map();
  const rows = await User.find({ _id: { $in: list } }).select("name").lean();
  return new Map(rows.map((u) => [u._id.toString(), u.name]));
}

