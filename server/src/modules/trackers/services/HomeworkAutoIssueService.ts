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
 *
 * D-#389: each pass covers the last HW_AUTO_ISSUE_LOOKBACK_SCHOOL_DAYS school days,
 * not just today. The window is what the gates are checked AGAINST — every day is
 * confirmed as itself, on its own attendance — so widening it recovers days that
 * became ready after 17:00 without ever issuing one on the wrong day's evidence.
 */
import { HomeworkItem } from "../models/HomeworkItem";
import { Student } from "../../foundation/models/Student";
import { StudentAttendanceDay } from "../../attendance/models/StudentAttendanceDay";
import { resolveUnits, unitKey, type StudentLite } from "../../attendance/attendanceUnit";
import { dateKeyOf } from "../../attendance/dates";
import { isSchoolDay } from "../calendar";
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
 * How many school days back the sweep looks (D-#389). The sweep used to query
 * `dateGiven` = TODAY only, so a class whose gates cleared after the 17:00 window
 * closed — a late declaration, attendance marked in the evening — was never looked
 * at again and its items sat in `declared` permanently. 6 of the 24 items purged on
 * 2026-07-28 died exactly that way, with every gate passing at the time of audit.
 *
 * 5 school days ≈ a full week's tail: long enough that a Sunday stranded by a
 * Thursday-evening declaration is still recovered, short enough that the sweep
 * never silently resurrects a day the school has moved on from.
 */
export const HW_AUTO_ISSUE_LOOKBACK_SCHOOL_DAYS = 5;

/** The school days (newest first) the sweep considers, `now` included. */
export function autoIssueWindow(now: Date, lookback = HW_AUTO_ISSUE_LOOKBACK_SCHOOL_DAYS): Date[] {
  const days: Date[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Walk back a bounded number of CALENDAR days, collecting only school days, so a
  // long holiday can never make this loop unbounded.
  for (let i = 0; i < lookback * 3 && days.length < lookback; i += 1) {
    const d = new Date(cursor);
    d.setDate(d.getDate() - i);
    if (isSchoolDay(d)) days.push(d);
  }
  return days;
}

/**
 * One sweep pass: for each school day in the lookback window (newest first), every
 * class with ≥1 still-`declared` item that day gets ONE confirm attempt off that
 * day's attendance-backed roster. Any confirm-gate failure (coverage, ceiling,
 * raced double-confirm) defers the class to the next tick — the sweep never trims,
 * never guesses, never throws.
 */
export async function sweepHomeworkAutoIssue(now = new Date()): Promise<AutoIssueSummary> {
  const summary: AutoIssueSummary = { issued: 0, deferred: 0 };

  // D-#389: look back over recent school days, not just today. Each day is confirmed
  // AS ITSELF — its own roster, its own dateKey, its own gates — so a stale day can
  // only ever issue on the evidence that day actually has. Newest first, so today
  // still gets served before any tail work.
  for (const day of autoIssueWindow(now)) {
    const dateKey = dateKeyOf(day);
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const items = (await HomeworkItem.find({
      status: "declared",
      dateGiven: { $gte: dayStart, $lt: dayEnd },
    })
      .select("classId sectionId")
      .lean()) as unknown as Array<{ classId: { toString(): string }; sectionId: { toString(): string } }>;
    if (items.length === 0) continue;

    const sectionOfClass = new Map<string, string>();
    for (const it of items) sectionOfClass.set(it.classId.toString(), it.sectionId.toString());

    // D-#319: reconciled classes are NOT filtered out — every class in the map has
    // ≥1 still-`declared` item on this day, so a reconciled one is a LATE TOP-UP
    // candidate and confirm handles it (issuing only the still-declared items).
    // A fully-issued day never enters the map.

    for (const [classId, sectionId] of sectionOfClass) {
      // The roster is built for THAT day's attendance — never today's, or a
      // recovered Sunday would spawn records off Thursday's absentees.
      const roster = await buildIssueRoster(sectionId, dateKey);
      if (!roster) {
        summary.deferred += 1;
        continue;
      }
      let res: ConfirmHomeworkDayResult;
      try {
        res = await confirmHomeworkDay({
          classId,
          date: day,
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
  }
  return summary;
}
