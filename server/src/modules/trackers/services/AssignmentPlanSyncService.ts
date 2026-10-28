/**
 * The assignment plan follows the routine (D-#880).
 *
 * The weekly assignment rotation (AssignmentSchedule) names a teacher per
 * cycle-week × section × subject, but the WRITE GATES follow the routine teaching grant.
 * The two used to be edited separately, so a routine re-assignment left the plan naming
 * the old teacher: on 2026-10-25 Office swapped C3 Bangla between বালক and বালিকা in the
 * routine, and the plan kept the old pairing — each half's Bangla card showed on the
 * wrong teacher, who was then refused on deliver / declare / submit / check.
 *
 * Every routine create / re-assign / retire now re-points the touched section × subject
 * cells at the routine teacher, from the change date on:
 *   - only when the routine has exactly ONE teacher for that section × subject on that
 *     date — none (an emptied section) or several (a shared subject) is the admin's call,
 *     so the plan is left alone;
 *   - a cell that ran before the change date is CLOSED the day before and a successor
 *     opened from it, so past weeks keep their teacher (the expected grid reads the cell
 *     in force on each week's delivery date); a cell starting on/after it is corrected
 *     in place;
 *   - it never adds or removes cells — which subjects get an assignment in which cycle
 *     week stays an admin decision.
 *
 * Best-effort, like every routine-change listener: a failure is logged and never blocks
 * the routine edit.
 */
import { Types } from "mongoose";
import { HW_SUBJECTS } from "@scd/shared";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { liveWindow } from "../../routine/liveWindow";
import { onRoutineTeachersChanged } from "../../routine/services/RoutineSlotService";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { writeAudit } from "../../platform/services/AuditService";
import { AssignmentSchedule } from "../models/AssignmentSchedule";

export interface PlanSyncResult {
  /** Cells corrected in place (they had not started before the change date). */
  reassigned: number;
  /** Cells closed the day before the change + a successor opened with the new teacher. */
  split: number;
  skipped?: "not_assignment_subject" | "no_single_routine_teacher" | "no_schedule";
}

/** Local calendar day as YYYY-MM-DD — the rotation entries' window format. */
function localKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayBeforeKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return localKey(new Date(y, m - 1, d - 1));
}

export async function syncAssignmentPlanToRoutine(
  sectionId: string,
  subject: string,
  from: Date,
  actorId: string,
): Promise<PlanSyncResult> {
  if (!(HW_SUBJECTS as readonly string[]).includes(subject)) {
    return { reassigned: 0, split: 0, skipped: "not_assignment_subject" };
  }

  const slots = await RoutineSlot.find({
    groupType: "section",
    groupId: sectionId,
    subject,
    active: true,
    isBreak: false,
    ...liveWindow(from),
  })
    .select("teacherId")
    .lean();
  const teachers = new Set(slots.map((s) => s.teacherId?.toString()).filter((t): t is string => !!t));
  if (teachers.size !== 1) return { reassigned: 0, split: 0, skipped: "no_single_routine_teacher" };
  const [teacherId] = [...teachers];

  const section = await Section.findById(sectionId).select("classId").lean();
  const cls = section ? await Class.findById(section.classId).select("academicYearId").lean() : null;
  const schedule = cls ? await AssignmentSchedule.findOne({ academicYearId: cls.academicYearId }) : null;
  if (!schedule) return { reassigned: 0, split: 0, skipped: "no_schedule" };

  const fromKey = localKey(from);
  const stale = schedule.entries.filter(
    (e) =>
      e.sectionId.toString() === sectionId &&
      e.subject === subject &&
      e.teacherId.toString() !== teacherId &&
      (!e.effectiveTo || e.effectiveTo >= fromKey),
  );
  if (stale.length === 0) return { reassigned: 0, split: 0 };

  const changes: Array<{ entryId: string; cycleWeek: number; fromTeacherId: string; mode: "in_place" | "split" }> = [];
  let reassigned = 0;
  let split = 0;
  for (const e of stale) {
    const fromTeacherId = e.teacherId.toString();
    if (e.effectiveFrom && e.effectiveFrom >= fromKey) {
      e.teacherId = new Types.ObjectId(teacherId);
      reassigned++;
      changes.push({ entryId: e._id.toString(), cycleWeek: e.cycleWeek, fromTeacherId, mode: "in_place" });
      continue;
    }
    schedule.entries.push({
      cycleWeek: e.cycleWeek,
      classId: e.classId,
      classLevel: e.classLevel,
      sectionId: e.sectionId,
      subject: e.subject,
      teacherId: new Types.ObjectId(teacherId),
      effectiveFrom: fromKey,
      effectiveTo: e.effectiveTo ?? null,
    });
    e.effectiveTo = dayBeforeKey(fromKey);
    split++;
    changes.push({ entryId: e._id.toString(), cycleWeek: e.cycleWeek, fromTeacherId, mode: "split" });
  }
  await schedule.save();

  await writeAudit({
    eventKind: "ASSIGNMENT_PLAN_FOLLOWED_ROUTINE",
    actorId,
    targetId: schedule._id,
    targetKind: "AssignmentSchedule",
    meta: { sectionId, subject, effectiveFrom: fromKey, toTeacherId: teacherId, changes },
  });
  return { reassigned, split };
}

onRoutineTeachersChanged(async ({ cells, from, actorId }) => {
  for (const c of cells ?? []) await syncAssignmentPlanToRoutine(c.sectionId, c.subject, from, actorId);
});
