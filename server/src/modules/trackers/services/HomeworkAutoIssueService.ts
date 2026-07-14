/**
 * HomeworkAutoIssueService (D-#314) — the system confirms a class's homework day
 * WHEN NOTHING IS LEFT FOR THE HUMAN TO DECIDE, and informs the confirmer.
 *
 * A class auto-issues only when ALL of:
 *   1. every routine-expected subject that day carries a declaration or an
 *      explicit nil (the D-#310 coverage gate — enforced inside confirm),
 *   2. DAY_TOTAL ≤ 120 — no trim needed (over-ceiling = human judgment, D-#314:
 *      the sweep NEVER trims; the pending ladder keeps nagging the teacher),
 *   3. the day is not already reconciled (double-issue guard, D-#310),
 *   4. ATTENDANCE IS FULLY CAPTURED for the section's students — the roster the
 *      records spawn from is real (absent students → ABSENT_REDELIVER), never
 *      guessed. Unmarked attendance = defer; the 13:00+ ladder still nags.
 *
 * Mechanically the sweep just builds the attendance-backed roster and calls the
 * SAME confirmHomeworkDay the class teacher uses (actor = the all-zero system
 * sentinel, autoIssued stamped on the reconciliation row); every gate above
 * throws inside confirm and is treated as "not ready — skip silently". The
 * scheduler runs this every tick inside the 12:00–17:00 window on school days.
 */
import { Types } from "mongoose";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkReconciliation, reconDayKey } from "../models/HomeworkReconciliation";
import { Student } from "../../foundation/models/Student";
import { StudentAttendanceDay } from "../../attendance/models/StudentAttendanceDay";
import { resolveUnits, unitKey, type StudentLite } from "../../attendance/attendanceUnit";
import { dateKeyOf } from "../../attendance/dates";
import { confirmHomeworkDay, type ConfirmHomeworkDayResult } from "./HomeworkReconciliationService";
import type { IssueRosterEntry } from "./HomeworkService";
import { emitHwAutoIssued } from "../../notifications/services/emitters";

/** The sweep's actor — RECON_BY on system confirms (a valid, never-a-user id). */
export const HW_AUTO_ISSUE_ACTOR_ID = "000000000000000000000000";
/** The sweep only runs inside this local-hour window (attendance lands ~12:00). */
export const HW_AUTO_ISSUE_START_HOUR = 12;
export const HW_AUTO_ISSUE_END_HOUR = 17;

/**
 * The attendance-backed present/absent roster for a section's active students —
 * or `null` when ANY of them has no marked attendance unit for the day (defer:
 * the roster must be real before records spawn from it).
 */
export async function buildIssueRoster(
  sectionId: string,
  dateKey: string,
): Promise<IssueRosterEntry[] | null> {
  const students = (await Student.find({ sectionId, active: true })
    .select("_id sectionId classId")
    .lean()) as unknown as Array<{
    _id: { toString(): string };
    sectionId: { toString(): string };
    classId: { toString(): string };
  }>;
  if (students.length === 0) return null;

  const days = (await StudentAttendanceDay.find({ dateKey }).lean()) as unknown as Array<{
    sectionId?: { toString(): string } | null;
    subjectGroupId?: { toString(): string } | null;
    absentStudentIds: Array<{ toString(): string }>;
  }>;
  const markedUnits = new Set(
    days.map((d) =>
      d.sectionId ? `section:${d.sectionId.toString()}` : `subjectgroup:${d.subjectGroupId!.toString()}`,
    ),
  );
  const absentIds = new Set(days.flatMap((d) => d.absentStudentIds.map((id) => id.toString())));

  const lites: StudentLite[] = students.map((s) => ({
    id: s._id.toString(),
    sectionId: s.sectionId.toString(),
    classId: s.classId.toString(),
  }));
  const units = await resolveUnits(lites, dateKey);

  const roster: IssueRosterEntry[] = [];
  for (const s of students) {
    const unit = units.get(s._id.toString());
    if (!unit || !markedUnits.has(unitKey(unit))) return null; // attendance incomplete — defer
    roster.push({ studentId: s._id.toString(), present: !absentIds.has(s._id.toString()) });
  }
  return roster;
}

export interface AutoIssueSummary {
  issued: number;
  deferred: number;
}

/**
 * One sweep pass: every class with ≥1 still-`declared` item today whose day is
 * not yet reconciled gets ONE confirm attempt off the attendance-backed roster.
 * Any confirm-gate failure (coverage, ceiling, raced double-confirm) defers the
 * class to the next tick — the sweep never trims, never guesses, never throws.
 */
export async function sweepHomeworkAutoIssue(now = new Date()): Promise<AutoIssueSummary> {
  const summary: AutoIssueSummary = { issued: 0, deferred: 0 };
  const dateKey = dateKeyOf(now);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const items = (await HomeworkItem.find({
    status: "declared",
    dateGiven: { $gte: dayStart, $lt: dayEnd },
  })
    .select("classId sectionId")
    .lean()) as unknown as Array<{ classId: { toString(): string }; sectionId: { toString(): string } }>;
  if (items.length === 0) return summary;

  const sectionOfClass = new Map<string, string>();
  for (const it of items) sectionOfClass.set(it.classId.toString(), it.sectionId.toString());

  const recons = (await HomeworkReconciliation.find({
    classId: { $in: [...sectionOfClass.keys()].map((id) => new Types.ObjectId(id)) },
    reconDate: reconDayKey(now),
    reconState: "reconciled",
  })
    .select("classId")
    .lean()) as unknown as Array<{ classId: { toString(): string } }>;
  for (const r of recons) sectionOfClass.delete(r.classId.toString());

  for (const [classId, sectionId] of sectionOfClass) {
    const roster = await buildIssueRoster(sectionId, dateKey);
    if (!roster) {
      summary.deferred += 1;
      continue;
    }
    let res: ConfirmHomeworkDayResult;
    try {
      res = await confirmHomeworkDay({
        classId,
        date: now,
        roster,
        actorId: HW_AUTO_ISSUE_ACTOR_ID,
        autoIssued: true,
      });
    } catch {
      // Coverage gate / over-ceiling / raced confirm — not ready; the pending
      // ladder keeps the human in the loop. Next tick retries.
      summary.deferred += 1;
      continue;
    }
    summary.issued += 1;
    await emitHwAutoIssued({
      classId,
      sectionId,
      dateKey,
      issuedItems: res.issuedItems,
      dayTotal: res.dayTotal,
    });
  }
  return summary;
}
