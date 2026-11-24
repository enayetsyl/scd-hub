/**
 * Scenario 0 (AL-2): lessons, attendance and absences (prd-academic-loop-2027 section 9.3).
 *
 * Per school day of the run (holidays and class-note pauses skipped):
 *   - every section's routine period is published as a class note THROUGH `publishClassNote`, and the lesson
 *     delivery is recorded THROUGH `recordDelivery` (the next session of the plan, ~15 % left "continuing");
 *   - attendance is marked THROUGH `markAttendanceUnit` per attendance unit, as the unit's real marker, with
 *     ~5 % of the children absent (seeded, so a seed reproduces the run).
 * Services stamp real "now" on a few lifecycle fields; they are corrected by a raw update on the tagged rows
 * (class note `publishedAt`, attendance `markedAt`) so the rows read as made on the fake day.
 * Notifications are muted by the generator, so the services' emitters leave no rows.
 */
import { Types } from "mongoose";
import { ClassNote } from "../../../modules/routine/models/ClassNote";
import { StudentAttendanceDay } from "../../../modules/attendance/models/StudentAttendanceDay";
import { slotsForDate } from "../../../modules/routine/services/RoutineSlotService";
import { resolveDayType } from "../../../modules/routine/calendar";
import { publishClassNote } from "../../../modules/routine/services/RoutineTriggerService";
import { isPausedOn } from "../../../modules/academic-pause/services/AcademicPauseService";
import {
  nextSessionKey,
  recordDelivery,
  sectionSessionStates,
  sessionPlansFor,
  type PlanSession,
} from "../../../modules/lesson-progress/services/LessonDeliveryService";
import {
  isLessonPlanQuestionOn,
  setLessonPlanQuestionOn,
} from "../../../modules/lesson-progress/services/LessonPlanQuestionSwitch";
import { markAttendanceUnit, markerForUnit } from "../../../modules/attendance/services/StudentAttendanceService";
import { resolveUnits, studentLitesOn, unitKey, type AttendanceUnit } from "../../../modules/attendance/attendanceUnit";
import { parseDateKey } from "../../../modules/attendance/dates";
import type { AppContext } from "../../../context";
import type { Scenario, ScenarioCtx } from "./types";

const ABSENCE_RATE = 0.05;
const CONTINUING_RATE = 0.15;

export const scenario0: Scenario = {
  id: 0,
  legacy: true,
  name: "lessons-attendance",
  collections: [
    { model: "ClassNote" },
    { model: "LessonDelivery" },
    { model: "StudentAttendanceDay" },
    { model: "AttendanceCorrectionNote" },
  ],
  async run(ctx: ScenarioCtx): Promise<Record<string, number>> {
    const c: Record<string, number> = {
      daysTaught: 0,
      daysSkipped: 0,
      notes: 0,
      deliveries: 0,
      notesWithoutPlan: 0,
      attendanceUnitsMarked: 0,
      attendanceUnitsNoMarker: 0,
      absences: 0,
    };

    // The class-note question must be on for a delivery to be written (D-#952). Configuration, not run data:
    // it is NOT tagged and `--remove` leaves it on (recorded in the manifest).
    if (!(await isLessonPlanQuestionOn())) {
      await setLessonPlanQuestionOn(true, new Types.ObjectId().toString());
      ctx.switchedOn.push("classNoteQuestionOn");
    }

    const planCache = new Map<string, PlanSession[]>();
    const planFor = async (level: number, subject: string): Promise<PlanSession[]> => {
      const k = `${level}:${subject}`;
      if (!planCache.has(k)) planCache.set(k, await sessionPlansFor(level, subject));
      return planCache.get(k) as PlanSession[];
    };

    for (const dayKey of ctx.dayKeys) {
      const day = parseDateKey(dayKey);
      if ((await resolveDayType(day)) !== "FULL" || (await isPausedOn("CLASS_NOTE_CHASE", dayKey))) {
        c.daysSkipped++;
        continue;
      }
      const since = new Date();

      // ---- lessons: one class note + delivery per routine period of every section -----------------------------
      for (const sec of ctx.sections) {
        const slots = await slotsForDate("section", sec.sectionId, day);
        for (const slot of slots) {
          if (slot.isBreak || !slot.teacherId) continue;
          const teacherId = String(slot.teacherId);
          const note = await publishClassNote({
            slotId: String(slot._id),
            date: day,
            taughtSummaryBn: `ফেক ক্লাস নোট — ${slot.subject}`,
            actorId: teacherId,
            canManage: true,
          });
          c.notes++;
          const plan = await planFor(sec.level, slot.subject);
          if (plan.length === 0) {
            c.notesWithoutPlan++;
            continue;
          }
          const states = await sectionSessionStates(sec.sectionId, slot.subject);
          const key = nextSessionKey(plan, states);
          if (!key) {
            c.notesWithoutPlan++;
            continue;
          }
          const finished = ctx.rng() >= CONTINUING_RATE;
          const delivery = await recordDelivery(note, { sessions: [{ key, finished }] }, teacherId);
          if (delivery) c.deliveries++;
        }
      }

      // ---- attendance: per attendance unit, ~5 % absent --------------------------------------------------------
      const units = new Map<string, { unit: AttendanceUnit; students: Set<string> }>();
      for (const sec of ctx.sections) {
        const lites = await studentLitesOn(dayKey, { sectionIds: [sec.sectionId] });
        const byStudent = await resolveUnits(lites, dayKey);
        for (const [studentId, unit] of byStudent) {
          const k = unitKey(unit);
          const e = units.get(k) ?? { unit, students: new Set<string>() };
          e.students.add(studentId);
          units.set(k, e);
        }
      }
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0);
      for (const k of [...units.keys()].sort()) {
        const { unit, students } = units.get(k)!;
        const marker = await markerForUnit(unit, dayKey);
        if (!marker.teacherId) {
          c.attendanceUnitsNoMarker++;
          continue;
        }
        const absent = [...students].sort().filter(() => ctx.rng() < ABSENCE_RATE);
        const fakeCtx = { auth: { userId: marker.teacherId, role: "TEACHER" } } as unknown as AppContext;
        await markAttendanceUnit(fakeCtx, unit, dayKey, absent, at);
        c.attendanceUnitsMarked++;
        c.absences += absent.length;
      }

      // ---- stamp + put the lifecycle times on the fake day ----------------------------------------------------
      await ctx.tagSince(since);
      await ClassNote.collection.updateMany(
        { devFakeRun: ctx.runId, date: day },
        { $set: { publishedAt: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 13, 0, 0) } },
      );
      await StudentAttendanceDay.collection.updateMany(
        { devFakeRun: ctx.runId, dateKey: dayKey },
        { $set: { markedAt: at } },
      );
      c.daysTaught++;
    }
    return c;
  },
};
