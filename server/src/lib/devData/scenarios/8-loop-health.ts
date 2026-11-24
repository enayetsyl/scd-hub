/**
 * Scenario 8 (AL-13): the loop-health page + the readiness list read the run (prd-academic-loop-2027 section 9.3, journey L).
 * Run it LAST - it counts what scenarios 0..7 made. It WRITES NOTHING (the page is a read), so it declares no collection and
 * removal has nothing to do for it; its job is to prove, at the full run, that every health row and the readiness list can be
 * built over generated data without an error, and to print the headline numbers in the manifest.
 *
 * The period is the run's own school days and "now" is the evening of the run's last day (the run's dates are in the future
 * while testing in December), so every period and deadline of the run is already behind it.
 */
import { AcademicYear } from "../../../modules/foundation/models/AcademicYear";
import { loopHealthRows } from "../../../modules/mastery/services/LoopHealthService";
import { loopReadiness } from "../../../modules/mastery/services/LoopReadinessService";
import type { Scenario, ScenarioCtx } from "./types";

export const scenario8: Scenario = {
  id: 8,
  legacy: true, // the realistic term (scenario 9) runs this itself, after its own pass, so the read sees the generated term
  name: "loop-health",
  collections: [],
  async run(ctx: ScenarioCtx): Promise<Record<string, number>> {
    const c: Record<string, number> = { sectionRows: 0, teacherRows: 0, periodsMarked: 0, periodsScheduled: 0, readinessPairs: 0, readyPairs: 0, lowStock: 0 };
    const from = ctx.dayKeys[0];
    const to = ctx.dayKeys[ctx.dayKeys.length - 1];
    if (!from || !to) return c;
    const now = new Date(`${to}T20:00:00+06:00`);
    const sections = await loopHealthRows("SECTION", from, to, now);
    const teachers = await loopHealthRows("TEACHER", from, to, now);
    c.sectionRows = sections.length;
    c.teacherRows = teachers.length;
    for (const r of sections) {
      c.periodsMarked += r.periods.done;
      c.periodsScheduled += r.periods.total;
    }
    const year = await AcademicYear.findById(ctx.academicYearId).select("current").lean();
    if (year?.current) {
      // the readiness list reads the current year; for a prepared (not yet current) year it is read by id elsewhere
      const v = await loopReadiness({ pageSize: 200 }, now);
      c.readinessPairs = v.totalPairs;
      c.readyPairs = v.readyPairs;
      c.lowStock = v.lowStock.length;
    }
    return c;
  },
};
