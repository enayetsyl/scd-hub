/**
 * MyDayService (UX-4, prd-ux-improvements.md §4.4, D-#265) — the staff "Today"
 * dashboard read. ONE gated query composes three EXISTING seams, adding no new
 * permission and no new scope logic:
 *   slots             — the caller's own routine periods for the date (the
 *                       myRoutineSlots filter narrowed to the date's weekday +
 *                       effective range, cover-overlaid like routineForDate,
 *                       day-type-filtered per R2.1, view-enriched per R-3)
 *   homework          — pendingChecking / openResubmissions / activeChases summed
 *                       over the caller's ACCESSIBLE refs — authorized per section
 *                       exactly like homeworkClassOverview (confirm-scope OR read-
 *                       scope; unreadable refs silently skipped)
 *   attendancePending — the caller marks ≥1 section for the date (class-teacher /
 *                       marker path via myMarkingSections) and a record is missing
 * Callers without the underlying permission get empty/zero fields, never an error
 * (a guardian or office login lands here too — the dashboard must render).
 */
import { DAYS_OF_WEEK, callerHasPermission, type PeriodTrack } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertCanConfirmHomework, assertCanRead } from "../../../middleware/authz";
import { Section } from "../../foundation/models/Section";
import { RoutineSlot, type IRoutineSlot } from "../models/RoutineSlot";
import { RoutineSubstitution } from "../models/RoutineSubstitution";
import { enrichRoutineSlots, type SlotViewFields } from "../slotView";
import { resolveDayType, dayTypeAdmitsTrack } from "../calendar";
import { homeworkClassOverview } from "../../trackers/services/HomeworkSummaryService";
import { myMarkingSections } from "../../attendance/services/StudentAttendanceService";

export interface MyDayHomeworkCounts {
  pendingChecking: number;
  openResubmissions: number;
  activeChases: number;
}

export type MyDaySlot = IRoutineSlot & SlotViewFields & { coverTeacherId?: string | null };

export interface MyDayResult {
  date: string;
  dayType: string;
  slots: MyDaySlot[];
  homework: MyDayHomeworkCounts;
  attendancePending: boolean;
}

export async function myDayFor(ctx: AppContext, dateStr: string): Promise<MyDayResult> {
  const auth = ctx.auth;
  if (!auth) throw new ForbiddenError("Unauthenticated");
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) throw new Error("Invalid date");
  const dateKey = dateStr.slice(0, 10);
  const dayType = await resolveDayType(d);

  // 1. Own periods — the myRoutineSlots filter (teacherId = caller) narrowed to the
  //    date, cover-overlaid (R4.4) and day-type-filtered (R2.1: OFF/HOLIDAY admit
  //    nothing, QURAN_ONLY only the quran track).
  let slots: MyDaySlot[] = [];
  if (callerHasPermission(auth, "routine:read")) {
    const dayOfWeek = DAYS_OF_WEEK[d.getDay()];
    const raw = (await RoutineSlot.find({
      teacherId: auth.userId,
      dayOfWeek,
      active: true,
      isBreak: false,
      effectiveFrom: { $lte: d },
      $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: d } }],
    })
      .sort({ periodNumber: 1 })
      .lean()) as unknown as IRoutineSlot[];
    const admitted = raw.filter((s) => dayTypeAdmitsTrack(dayType, s.track as PeriodTrack));
    if (admitted.length > 0) {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const subs = await RoutineSubstitution.find({
        slotId: { $in: admitted.map((s) => s._id) },
        active: true,
        date: { $gte: start, $lte: end },
      }).lean();
      const coverMap = new Map(subs.map((su) => [su.slotId.toString(), su.coverTeacherId.toString()]));
      const withCover = admitted.map((s) => ({
        ...s,
        coverTeacherId: coverMap.get(s._id.toString()) ?? null,
      }));
      slots = (await enrichRoutineSlots(withCover)) as MyDaySlot[];
    }
  }

  // 2. Homework counts over the caller's accessible refs — per-section authorization
  //    identical to homeworkClassOverview (confirm-scope first, then read-scope;
  //    unreadable refs silently skipped so a stale ref never breaks the dashboard).
  const homework: MyDayHomeworkCounts = { pendingChecking: 0, openResubmissions: 0, activeChases: 0 };
  if (callerHasPermission(auth, "tracker:read")) {
    const sections = (await Section.find({ active: true }).select("_id classId").lean()) as unknown as Array<{
      _id: { toString(): string };
      classId: { toString(): string };
    }>;
    const authorized = new Set<string>();
    for (const s of sections) {
      const sectionId = s._id.toString();
      const classId = s.classId.toString();
      try {
        try {
          await assertCanConfirmHomework(ctx, sectionId);
        } catch {
          await assertCanRead(ctx, sectionId, classId);
        }
        authorized.add(classId);
      } catch {
        // Not this caller's section — skipped, exactly like homeworkClassOverview.
      }
    }
    if (authorized.size > 0) {
      const overview = await homeworkClassOverview([...authorized], Date.now());
      for (const o of overview) {
        homework.pendingChecking += o.pendingChecking;
        homework.openResubmissions += o.openResubmissions;
        homework.activeChases += o.activeChases;
      }
    }
  }

  // 3. Attendance pending — the caller marks ≥1 section for the date and that
  //    section's day record is still absent (marker/class-teacher path, AT2.3).
  let attendancePending = false;
  if (callerHasPermission(auth, "attendance:mark")) {
    const marking = await myMarkingSections(auth.userId, dateKey);
    attendancePending = marking.some((m) => !m.marked);
  }

  return { date: dateKey, dayType, slots, homework, attendancePending };
}
