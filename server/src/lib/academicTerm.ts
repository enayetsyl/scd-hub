/**
 * "Term" for the 2027 loop (docs/prd-academic-loop-2027.md section 1 R30/R32; D-#1529): the two halves of an academic year,
 * split at the midpoint of its start and end dates. Shared by the homework-honesty recurring badge and the late-marks
 * rule so both read one definition. Returns 1 or 2.
 *
 * A year that cannot be found has no midpoint. `whenMissing` says what the caller wants then: the default is term 1
 * (the late-marks rule: no staff-mistake row without a real year); the homework-honesty badge keeps its older
 * behaviour (second half) by passing 2.
 */
import type { Types } from "mongoose";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";

export async function termOfDate(
  yearId: Types.ObjectId | string,
  at: Date,
  cache: Map<string, number> = new Map(),
  whenMissing: 1 | 2 = 1,
): Promise<1 | 2> {
  const k = String(yearId);
  let mid = cache.get(k);
  if (mid === undefined) {
    const y = await AcademicYear.findById(yearId).select("startDate endDate").lean();
    if (!y) return whenMissing;
    mid = (y.startDate.getTime() + y.endDate.getTime()) / 2;
    cache.set(k, mid);
  }
  return at.getTime() < mid ? 1 : 2;
}

/**
 * The instant the term containing `at` ends (AL-12, R32: "the tag lasts the term"): the year's midpoint for term 1,
 * its end date for term 2. A year that cannot be found has no term end — `null`; the caller picks a fallback.
 */
export async function termEndOf(yearId: Types.ObjectId | string, at: Date): Promise<Date | null> {
  const y = await AcademicYear.findById(yearId).select("startDate endDate").lean();
  if (!y) return null;
  const mid = (y.startDate.getTime() + y.endDate.getTime()) / 2;
  return at.getTime() < mid ? new Date(mid) : new Date(y.endDate);
}
