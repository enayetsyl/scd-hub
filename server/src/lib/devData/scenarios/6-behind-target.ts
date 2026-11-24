/**
 * Scenario 6 (AL-11): term target dates + a শাখা × subject 2+ weeks behind (prd-academic-loop-2027 section 3.3, journey A,
 * R14, D-#1675). Run it after scenario 0 (the lessons it counts).
 *
 * Targets are set THROUGH `setSyllabusTargets` for every Class 1..5 subject that has session plans: HALF_YEARLY ends at the
 * middle of the book mid-year, ANNUAL at the book's end near the year's end. A class x subject that already has a target (a
 * real one copied from prod) is left alone. ONE of the new class x subject pairs is then given a half-yearly target that ended
 * on the run's last school day with the WHOLE book as its end point, so its sections read many sessions behind; the weekly
 * `LPBEHIND` pass runs on the next morning (an explicit `asOf`, so the result does not depend on the real clock). Nothing
 * reaches a real person (the generator mutes the emitters). Targets are tagged and removed with the run.
 */
import { Types } from "mongoose";
import { classToken } from "@scd/shared";
import { AcademicYear } from "../../../modules/foundation/models/AcademicYear";
import { SyllabusTarget } from "../../../modules/lesson-progress/models/SyllabusTarget";
import { setSyllabusTargets, planSubjectsOfLevel, runLessonBehind } from "../../../modules/lesson-progress/services/SyllabusTargetService";
import { sessionPlansFor } from "../../../modules/lesson-progress/services/LessonDeliveryService";
import { dateKeyOf, parseDateKey } from "../../../modules/attendance/dates";
import type { Scenario, ScenarioCtx } from "./types";

const DAY = 24 * 3600 * 1000;

export const scenario6: Scenario = {
  id: 6,
  legacy: true,
  name: "behind-target",
  collections: [{ model: "SyllabusTarget" }],
  async run(ctx: ScenarioCtx): Promise<Record<string, number>> {
    const c: Record<string, number> = { targetsSet: 0, refused: 0, kept: 0, behindSections: 0, notified: 0 };
    const year = await AcademicYear.findById(ctx.academicYearId).select("startDate endDate current").lean();
    const lastDay = ctx.dayKeys[ctx.dayKeys.length - 1];
    if (!year || !year.current || !lastDay) return c; // targets read the CURRENT year only
    const yStart = parseDateKey(dateKeyOf(year.startDate as Date)).getTime();
    const yEnd = parseDateKey(dateKeyOf(year.endDate as Date)).getTime();
    const halfKey = dateKeyOf(new Date(yStart + (yEnd - yStart) / 2));
    const annualKey = dateKeyOf(new Date(yEnd - 14 * DAY));
    const since = new Date();
    const actor = new Types.ObjectId().toString();

    const created: Array<{ level: number; subject: string; lastIdx: number }> = [];
    for (const level of [...new Set(ctx.sections.filter((s) => s.level >= 1 && s.level <= 5).map((s) => s.level))]) {
      for (const subject of await planSubjectsOfLevel(level)) {
        if (await SyllabusTarget.exists({ academicYearId: ctx.academicYearId, classToken: classToken(level), subject })) {
          c.kept++;
          continue;
        }
        const plan = await sessionPlansFor(level, subject);
        if (plan.length < 2) continue;
        const mid = plan[Math.floor(plan.length / 2) - 1]!;
        const last = plan[plan.length - 1]!;
        try {
          await setSyllabusTargets(
            [
              { classLevel: level, subject, term: "HALF_YEARLY", targetDate: halfKey, endChapter: mid.chapter, endSessionIndex: mid.sessionIndex },
              { classLevel: level, subject, term: "ANNUAL", targetDate: annualKey, endChapter: last.chapter, endSessionIndex: last.sessionIndex },
            ],
            actor,
          );
          c.targetsSet += 2;
          created.push({ level, subject, lastIdx: plan.length - 1 });
        } catch {
          c.refused++;
        }
      }
    }

    // One class x subject: the half-yearly target ENDED on the run's last school day and wants the whole book.
    const pick = ctx.pick(created, 1)[0];
    if (pick) {
      const plan = await sessionPlansFor(pick.level, pick.subject);
      const last = plan[plan.length - 1]!;
      try {
        // the annual end may not precede the half-yearly: move both to the book's end / the year's end first
        await setSyllabusTargets(
          [
            { classLevel: pick.level, subject: pick.subject, term: "ANNUAL", targetDate: annualKey, endChapter: last.chapter, endSessionIndex: last.sessionIndex },
            { classLevel: pick.level, subject: pick.subject, term: "HALF_YEARLY", targetDate: lastDay, endChapter: last.chapter, endSessionIndex: last.sessionIndex },
          ],
          actor,
        );
      } catch {
        c.refused++;
      }
    }
    await ctx.tagSince(since);

    // The weekly alert on the morning after the run's last school day.
    const asOf = new Date(`${dateKeyOf(new Date(parseDateKey(lastDay).getTime() + DAY + 12 * 3600 * 1000))}T08:30:00+06:00`);
    const run = await runLessonBehind(asOf);
    c.behindSections = run.behind;
    c.notified = run.notified; // 0 under the generator's notification mute — the count of behind rows is the check
    return c;
  },
};
