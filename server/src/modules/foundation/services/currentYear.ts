/**
 * "The current academic year" as a query filter (YC-0 step 3, docs/prd-year-change.md §1.2).
 *
 * Readers that list classes / sections / bell windows with no year filter would, once 2027 rows
 * exist next to the 2026 ones, return both years. They add one of these filters instead.
 *
 * Rule (D-#1452): when NO year is flagged current, every helper returns "no filter" ({} / null),
 * so behaviour stays exactly as it is today.
 */
import { Types } from "mongoose";
import { AcademicYear } from "../models/AcademicYear";
import { Class } from "../models/Class";

/** The id of the year flagged `current`, or null when none is. */
export async function currentAcademicYearId(): Promise<Types.ObjectId | null> {
  const y = (await AcademicYear.findOne({ current: true }).select("_id").lean()) as { _id: Types.ObjectId } | null;
  return y ? y._id : null;
}

/** Spread into a Class / ScheduleWindow query: `{ academicYearId }` or `{}` (no current year). */
export async function currentYearFilter(): Promise<{ academicYearId?: Types.ObjectId }> {
  const id = await currentAcademicYearId();
  return id ? { academicYearId: id } : {};
}

/** Ids of the current year's classes, or null when no year is current (= do not filter). */
export async function currentYearClassIds(): Promise<Types.ObjectId[] | null> {
  const id = await currentAcademicYearId();
  if (!id) return null;
  const rows = (await Class.find({ academicYearId: id }).select("_id").lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  return rows.map((r) => r._id);
}

/** Spread into a Section query: `{ classId: { $in: current classes } }` or `{}` (no current year). */
export async function currentYearSectionFilter(): Promise<{ classId?: { $in: Types.ObjectId[] } }> {
  const ids = await currentYearClassIds();
  return ids ? { classId: { $in: ids } } : {};
}
