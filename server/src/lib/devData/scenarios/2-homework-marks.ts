/**
 * Scenario 2a (AL-4): homework with per-question marks (prd-academic-loop-2027 sections 3.1 and 9.3).
 *
 * For each of the first school days of the run, each section of Class 1..5 declares homework for up to two of its routine
 * subjects THROUGH the real services:
 *   - `declareHomeworkItem` with picked bank qids (and, on some days, a free line and a teacher-written marked item) —
 *     with the release switch on this makes a HW paper: a normal one when the class x subject has mastery on, a
 *     MARKS-ONLY one when it has not (so one run shows both kinds, depending on the copied catalogue);
 *   - `issueHomeworkItem` (a few children absent), then the submit pass (`transitionRecord` GIVEN -> DUE -> SUBMITTED, ~10 %
 *     CHASE);
 *   - the tick-wrong grid (`saveResults`: a few wrong / half-marked items), a free-line "not done" tick when there are free
 *     lines, and `confirmPaper` (evidence only for normal papers; marks-only papers write none).
 * The release switch is configuration, not run data: it is switched on here when off, NOT tagged, and `--remove` leaves it
 * on (recorded in the manifest, like scenario 0's class-note question).
 */
import { classToken, HW_SUBJECTS, subjectAllowedForClassLevel } from "@scd/shared";
import { MasteryPolicy } from "../../../modules/mastery/models/MasteryPolicy";
import { Student } from "../../../modules/foundation/models/Student";
import { HomeworkItem } from "../../../modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../../../modules/trackers/models/HomeworkStudentRecord";
import { MasteryPaper } from "../../../modules/mastery/models/MasteryPaper";
import { declareHomeworkItem, issueHomeworkItem, transitionRecord } from "../../../modules/trackers/services/HomeworkService";
import { saveFreeLineTicks } from "../../../modules/trackers/services/HomeworkFreeLineService";
import { confirmPaper, saveResults, type Auth } from "../../../modules/mastery/services/MasteryWorkService";
import { isLoop2027On } from "../../../modules/assessment/services/QuestionUseService";
import { slotsForDate } from "../../../modules/routine/services/RoutineSlotService";
import { resolveDayType } from "../../../modules/routine/calendar";
import { parseDateKey } from "../../../modules/attendance/dates";
import { pickAllowedHomeworkQids } from "./helpers";
import type { Scenario, ScenarioCtx } from "./types";

const DAYS = 10;
const SUBJECTS_PER_SECTION_DAY = 2;
const ABSENCE_RATE = 0.05;
const CHASE_RATE = 0.1;

export const scenario2: Scenario = {
  id: 2,
  legacy: true,
  name: "homework-marks",
  collections: [
    { model: "HomeworkItem" },
    { model: "HomeworkStudentRecord" },
    { model: "MasteryPaper" },
    { model: "MasteryResult" },
    { model: "HomeworkReconciliation" },
  ],
  async run(ctx: ScenarioCtx): Promise<Record<string, number>> {
    const c: Record<string, number> = {
      declared: 0, declareRefused: 0, normalPapers: 0, marksOnlyPapers: 0, freeLineOnly: 0,
      issued: 0, submitted: 0, chased: 0, wrongTicks: 0, freeLineTicks: 0, confirmed: 0, confirmRefused: 0,
    };

    if (!(await isLoop2027On())) {
      await MasteryPolicy.updateOne(
        { scopeKey: "SCHOOL" },
        { $set: { "values.academicLoop2027On": true }, $setOnInsert: { scopeKey: "SCHOOL" } },
        { upsert: true },
      );
      ctx.switchedOn.push("academicLoop2027On");
    }

    const hwSubjects = new Set<string>(HW_SUBJECTS);
    let taught = 0;
    for (const dayKey of ctx.dayKeys) {
      if (taught >= DAYS) break;
      const day = parseDateKey(dayKey);
      if ((await resolveDayType(day)) !== "FULL") continue;
      taught++;
      const since = new Date();
      ctx.clock(dayKey); // every date rule in the services reads the fake day, not the real one

      for (const sec of ctx.sections.filter((s) => s.level >= 1)) {
        const slots = (await slotsForDate("section", sec.sectionId, day)).filter((s) => !s.isBreak && s.teacherId && hwSubjects.has(s.subject));
        const bySubject = new Map<string, string>();
        for (const s of slots) if (!bySubject.has(s.subject)) bySubject.set(s.subject, String(s.teacherId));
        const subjects = ctx.pick([...bySubject.keys()].filter((s) => subjectAllowedForClassLevel(s as never, sec.level)), SUBJECTS_PER_SECTION_DAY);
        for (const subject of subjects) {
          const teacherId = bySubject.get(subject)!;
          // Only questions the declare's own pick guard accepts (no-repeat window, R21 share) - a blind pick refused a quarter of the sheets.
          const qids = await pickAllowedHomeworkQids(ctx, sec, subject, dayKey, 3);
          const withLines = ctx.rng() < 0.5 || qids.length === 0;
          let item: { itemId: string } | null = null;
          try {
            item = await declareHomeworkItem({
              academicYearId: ctx.academicYearId,
              classId: sec.classId,
              classLevel: sec.level,
              sectionId: sec.sectionId,
              subject,
              dateGiven: dayKey,
              topTags: [`TOP-${subject}-${classToken(sec.level)}-GEN`],
              qCount: Math.max(1, qids.length),
              selectedQids: qids,
              description: `ফেক বাড়ির কাজ — ${subject}`,
              freeLines: withLines ? [{ kind: "HANDWRITING", textBn: "হাতের লেখা ১ পৃষ্ঠা", estMinutes: 10 }] : undefined,
              teacherItems: qids.length > 0 && ctx.rng() < 0.3 ? [{ textBn: "নিজে একটি বাক্য লেখো।", marks: 2 }] : undefined,
              actorId: teacherId,
            });
            c.declared++;
          } catch (e) {
            c.declareRefused++;
            ctx.refuse("declareRefused", e);
            continue;
          }
          const doc = await HomeworkItem.findById(item.itemId);
          if (!doc) continue;
          if (!doc.paperId) c.freeLineOnly++;
          const paper = doc.paperId ? await MasteryPaper.findById(doc.paperId) : null;
          if (paper) c[paper.marksOnly ? "marksOnlyPapers" : "normalPapers"]++;

          const kids = await Student.find({ sectionId: sec.sectionId, active: true }).select("_id").lean();
          if (kids.length === 0) continue;
          const roster = kids.map((k) => ({ studentId: String(k._id), present: ctx.rng() >= ABSENCE_RATE }));
          await issueHomeworkItem(item.itemId, roster, teacherId);
          c.issued++;

          const recs = await HomeworkStudentRecord.find({ hwItemId: doc._id, state: "GIVEN" }).select("_id studentId").lean();
          const handedIn: string[] = [];
          for (const r of recs) {
            await transitionRecord({ recordId: String(r._id), toState: "DUE", actorId: teacherId });
            if (ctx.rng() < CHASE_RATE) {
              await transitionRecord({ recordId: String(r._id), toState: "CHASE", actorId: teacherId });
              c.chased++;
            } else {
              await transitionRecord({ recordId: String(r._id), toState: "SUBMITTED", actorId: teacherId });
              handedIn.push(String(r.studentId));
              c.submitted++;
            }
          }

          if (paper) {
            const auth = { userId: teacherId, role: "TEACHER" } as unknown as Auth;
            const wrong = ctx.pick(handedIn, Math.min(3, handedIn.length));
            const rows = wrong.map((studentId) => {
              const it = paper.items[Math.floor(ctx.rng() * paper.items.length)]!;
              return { studentId, items: [{ itemNo: it.itemNo, marks: ctx.rng() < 0.5 ? 0 : Math.max(0, it.marks / 2) }] };
            });
            if (rows.length > 0) {
              await saveResults(paper.paperId, rows, auth);
              c.wrongTicks += rows.length;
            }
          }
          if ((doc.freeLines?.length ?? 0) > 0 && handedIn.length > 0) {
            await saveFreeLineTicks(item.itemId, [{ studentId: ctx.pick(handedIn, 1)[0]!, notDone: [0] }]);
            c.freeLineTicks++;
          }
          if (paper) {
            try {
              await confirmPaper(paper.paperId, { userId: teacherId, role: "TEACHER" } as unknown as Auth);
              c.confirmed++;
            } catch (e) {
              c.confirmRefused++;
              ctx.refuse("confirmRefused", e);
            }
          }
        }
      }
      await ctx.tagSince(since);
    }
    return c;
  },
};
