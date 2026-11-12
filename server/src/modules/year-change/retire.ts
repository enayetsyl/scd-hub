/**
 * retirePastYearSections (YC-4, owner ruling 2026-11-12): the past year's sections stay `active`
 * through the cut-over (December monthly reports are revised until 15 Jan 2027). The Principal runs
 * this AFTER that date to set them inactive. Idempotent - a second run writes 0. It never touches
 * the current year, and never deletes anything.
 */
import { dhakaDayKey } from "../../lib/dhakaDay";
import { AcademicYear } from "../foundation/models/AcademicYear";
import { Class } from "../foundation/models/Class";
import { Section } from "../foundation/models/Section";
import { writeAudit } from "../platform/services/AuditService";
import { assertYearChangeRight } from "./authz";
import { YearChangeRefusal, type YearChangeActor } from "./types";

/** The day the grace period ends: 15 days after the last day of the year (15 Jan for a Jan-Dec year). */
export function retireFromKey(endDate: Date): string {
  const d = new Date(`${dhakaDayKey(endDate)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 15);
  return d.toISOString().slice(0, 10);
}

export async function retirePastYearSections(
  yearId: string,
  actor: YearChangeActor,
  opts: { allowEarly?: boolean; today?: string } = {},
): Promise<{ retired: number }> {
  assertYearChangeRight(actor, "cut_over");
  const year = await AcademicYear.findById(yearId).lean();
  if (!year) throw new YearChangeRefusal(["শিক্ষাবর্ষ পাওয়া যায়নি।"]);
  if (year.current) throw new YearChangeRefusal([`${year.label} এখন চলতি শিক্ষাবর্ষ — এর শাখা বন্ধ করা যাবে না।`]);
  const from = retireFromKey(year.endDate);
  const today = opts.today ?? dhakaDayKey(new Date());
  if (!opts.allowEarly && today < from) {
    throw new YearChangeRefusal([`${year.label} বর্ষের শাখা ${from}-এর আগে বন্ধ করা যাবে না (আজ ${today})।`]);
  }
  const classes = await Class.find({ academicYearId: year._id }).select("_id").lean();
  const res = await Section.updateMany({ classId: { $in: classes.map((c) => c._id) }, active: true }, { $set: { active: false } });
  const retired = res.modifiedCount;
  if (retired > 0) {
    await writeAudit({
      eventKind: "YEAR_CHANGE_SECTIONS_RETIRED",
      actorId: actor.userId,
      targetId: year._id,
      targetKind: "AcademicYear",
      meta: { yearId: String(year._id), label: year.label, retired },
    });
  }
  return { retired };
}
