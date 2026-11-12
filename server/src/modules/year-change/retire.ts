/**
 * retirePastYearSections (YC-4, owner ruling 2026-11-12): the past year's sections stay `active`
 * through the cut-over (December monthly reports are revised until 15 Jan 2027). The Principal runs
 * this AFTER that date to set them inactive. Idempotent - a second run writes 0. It never touches
 * the current year, and never deletes anything.
 */
import { AcademicYear } from "../foundation/models/AcademicYear";
import { Class } from "../foundation/models/Class";
import { Section } from "../foundation/models/Section";
import { writeAudit } from "../platform/services/AuditService";
import { assertYearChangeRight } from "./authz";
import { YearChangeRefusal, type YearChangeActor } from "./types";

export async function retirePastYearSections(yearId: string, actor: YearChangeActor): Promise<{ retired: number }> {
  assertYearChangeRight(actor, "cut_over");
  const year = await AcademicYear.findById(yearId).lean();
  if (!year) throw new YearChangeRefusal(["শিক্ষাবর্ষ পাওয়া যায়নি।"]);
  if (year.current) throw new YearChangeRefusal([`${year.label} এখন চলতি শিক্ষাবর্ষ — এর শাখা বন্ধ করা যাবে না।`]);
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
