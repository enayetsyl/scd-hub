/**
 * Per-year id counters (YC-0, D-#1450 / prd-year-change §1.4 "ID sequences", §6 Q5).
 *
 * The HW / AS / CT / CT-G / SP ids carry no year and are `unique: true`, so a new
 * academic year's counter must CONTINUE the previous numbers (HW-C3-BAN-0131 …),
 * not restart at 1. `nextYearSeq` does that:
 *
 *   1. fast path — atomic $inc on the existing (year, key) row;
 *   2. row missing — seed it ONCE at the highest `seq` of the same key in any
 *      EARLIER year ($setOnInsert upsert, so a racing creator never overwrites a
 *      row another caller already advanced), then $inc.
 *
 * No number is handed out before the seed exists and every hand-out is an atomic
 * $inc, so two concurrent first-creates of a new year get different numbers.
 */
import type { Model } from "mongoose";
import { Types } from "mongoose";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";

type SeqModel = Model<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Highest `seq` of `key` in any year that starts before `academicYearId` (0 if none). */
async function priorYearMax(
  model: SeqModel,
  academicYearId: Types.ObjectId,
  key: Record<string, unknown>,
): Promise<number> {
  const year = await AcademicYear.findById(academicYearId).select("startDate").lean();
  const earlier = await AcademicYear.find(
    year ? { startDate: { $lt: year.startDate } } : { _id: { $ne: academicYearId } },
  )
    .select("_id")
    .lean();
  if (earlier.length === 0) return 0;
  const top = (await model
    .findOne({ ...key, academicYearId: { $in: earlier.map((y) => y._id) } })
    .sort({ seq: -1 })
    .select("seq")
    .lean()) as unknown as { seq?: number } | null;
  return top?.seq ?? 0;
}

export async function nextYearSeq(
  model: SeqModel,
  academicYearId: string | Types.ObjectId,
  key: Record<string, unknown>,
): Promise<number> {
  const yearId = new Types.ObjectId(String(academicYearId));
  const filter = { ...key, academicYearId };
  const bump = () => model.findOneAndUpdate(filter, { $inc: { seq: 1 } }, { new: true });

  const hit = await bump();
  if (hit) return (hit as unknown as { seq: number }).seq;

  const base = await priorYearMax(model, yearId, key);
  try {
    await model.updateOne(filter, { $setOnInsert: { seq: base } }, { upsert: true });
  } catch (e) {
    // A racing creator inserted the seed first — theirs stands; we only $inc below.
    if ((e as { code?: number })?.code !== 11000) throw e;
  }
  const after = await bump();
  return (after as unknown as { seq: number }).seq;
}

/** The one Bangla message for "this id is already taken" (never a raw E11000). */
export const DUPLICATE_ID_BN =
  "এই আইডি নম্বরটি আগেই ব্যবহার করা হয়েছে — অনুগ্রহ করে আবার চেষ্টা করুন";

/**
 * `.catch(translateDuplicateId("hwId"))` on an item insert: a duplicate on the id
 * field becomes a plain Bangla error; any other error passes through unchanged.
 */
export function translateDuplicateId(idField: string) {
  return (err: unknown): never => {
    const e = err as { code?: number; keyPattern?: Record<string, unknown>; message?: string };
    if (e?.code === 11000 && (e.keyPattern ? idField in e.keyPattern : !!e.message?.includes(idField))) {
      throw new Error(DUPLICATE_ID_BN);
    }
    throw err;
  };
}
