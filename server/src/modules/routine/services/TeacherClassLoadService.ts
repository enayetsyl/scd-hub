/**
 * TeacherClassLoadService (D-#327) — per-teacher teaching load from the routine.
 *
 * A "class" = one routine PERIOD the teacher is assigned (active, non-break slot).
 * For a teacher (or every teacher), we report:
 *   - perWeekday   — the standard weekly pattern (count per weekday)
 *   - weekTotal    — periods in a typical week
 *   - monthTotal   — CALENDAR-ACCURATE count for the chosen month: iterate each
 *                    date, resolve its day-type (FULL Sun–Thu / QURAN_ONLY Sat /
 *                    OFF Fri / HOLIDAY), and add the teacher's matching slots on
 *                    teaching days only — netting out holidays, honouring each
 *                    slot's [effectiveFrom, effectiveTo) window, and counting only
 *                    quran-track slots on Saturdays.
 *   - slots        — the enriched weekly grid (day · period · time · subject ·
 *                    section/group) for the drill-down detail.
 *
 * Counts the SCHEDULED (substantive) load — cover/substitution is not re-attributed
 * (a later refinement). Identity/operational plane; NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { DAYS_OF_WEEK, type DayType } from "@scd/shared";
import { RoutineSlot } from "../models/RoutineSlot";
import { HolidayException } from "../models/HolidayException";
import { User } from "../../foundation/models/User";
import { enrichRoutineSlots } from "../slotView";
import { dayTypeFor } from "../calendar";

export interface ClassLoadSlotShape {
  dayOfWeek: string;
  periodNumber: number;
  subject: string;
  track: string;
  groupName: string | null;
  startTime: string | null;
  endTime: string | null;
}
export interface WeekdayCountShape {
  dayOfWeek: string;
  count: number;
}
export interface TeacherClassLoadShape {
  teacherId: string;
  teacherName: string;
  perWeekday: WeekdayCountShape[];
  weekTotal: number;
  monthKey: string;
  monthTotal: number;
  monthTeachingDays: number;
  slots: ClassLoadSlotShape[];
}

const dayStart = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const dayEnd = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

interface SlotLite {
  teacherId: Types.ObjectId;
  groupType: "section" | "subjectgroup";
  groupId?: Types.ObjectId;
  classId?: Types.ObjectId;
  dayOfWeek: string;
  periodNumber: number;
  subject: string;
  track: string;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}

/**
 * Per-teacher class load for a month. `monthKey` = "YYYY-MM". Without `teacherId`
 * every teacher with slots is returned (oversight); with it, just that teacher.
 * Sorted by teacher name.
 */
export async function teacherClassLoad(
  monthKey: string,
  teacherId?: string,
): Promise<TeacherClassLoadShape[]> {
  const mm = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!mm) throw new Error("month must be YYYY-MM");
  const year = Number(mm[1]);
  const month0 = Number(mm[2]) - 1;
  if (month0 < 0 || month0 > 11) throw new Error("month must be YYYY-MM (01..12)");
  const monthStart = new Date(year, month0, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month0 + 1, 0, 23, 59, 59, 999);
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();

  const q: Record<string, unknown> = {
    active: true,
    isBreak: false,
    teacherId: teacherId ? new Types.ObjectId(teacherId) : { $ne: null },
    effectiveFrom: { $lte: monthEnd },
    $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gte: monthStart } }],
  };
  const slots = (await RoutineSlot.find(q)
    .select("teacherId groupType groupId classId dayOfWeek periodNumber subject track effectiveFrom effectiveTo")
    .lean()) as unknown as SlotLite[];
  if (slots.length === 0) return [];

  // Holidays overlapping the month — one load; day-type resolved in-memory.
  const holidays = (await HolidayException.find({
    active: true,
    fromDate: { $lte: monthEnd },
    toDate: { $gte: monthStart },
  })
    .select("fromDate toDate")
    .lean()) as unknown as Array<{ fromDate: Date; toDate: Date }>;
  const isHoliday = (d: Date): boolean =>
    holidays.some((h) => new Date(h.fromDate) <= dayEnd(d) && new Date(h.toDate) >= dayStart(d));

  // Pre-resolve each date's day-type + weekday once.
  const calendar: Array<{ date: Date; dow: string; dayType: DayType }> = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month0, d);
    calendar.push({ date, dow: DAYS_OF_WEEK[date.getDay()], dayType: dayTypeFor(date, isHoliday(date)) });
  }
  const monthTeachingDays = calendar.filter((c) => c.dayType === "FULL" || c.dayType === "QURAN_ONLY").length;

  // Enriched detail (names/times/group labels) for every slot — batched, no N+1.
  const enriched = await enrichRoutineSlots(slots);
  const enrichedByTeacher = new Map<string, typeof enriched>();
  for (const s of enriched) {
    const tid = s.teacherId.toString();
    (enrichedByTeacher.get(tid) ?? enrichedByTeacher.set(tid, []).get(tid)!).push(s);
  }

  const byTeacher = new Map<string, SlotLite[]>();
  for (const s of slots) {
    const tid = s.teacherId.toString();
    (byTeacher.get(tid) ?? byTeacher.set(tid, []).get(tid)!).push(s);
  }

  const users = (await User.find({ _id: { $in: [...byTeacher.keys()] } })
    .select("name")
    .lean()) as unknown as Array<{ _id: { toString(): string }; name: string }>;
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));

  const out: TeacherClassLoadShape[] = [];
  for (const [tid, tslots] of byTeacher) {
    const perWeekdayMap = new Map<string, number>();
    for (const s of tslots) perWeekdayMap.set(s.dayOfWeek, (perWeekdayMap.get(s.dayOfWeek) ?? 0) + 1);
    const perWeekday = DAYS_OF_WEEK.map((dow) => ({ dayOfWeek: dow, count: perWeekdayMap.get(dow) ?? 0 })).filter(
      (x) => x.count > 0,
    );

    let monthTotal = 0;
    for (const { date, dow, dayType } of calendar) {
      if (dayType !== "FULL" && dayType !== "QURAN_ONLY") continue;
      for (const s of tslots) {
        if (s.dayOfWeek !== dow) continue;
        if (new Date(s.effectiveFrom) > dayEnd(date)) continue;
        if (s.effectiveTo && new Date(s.effectiveTo) < dayStart(date)) continue;
        if (dayType === "QURAN_ONLY" && s.track !== "quran") continue;
        monthTotal += 1;
      }
    }

    const detail: ClassLoadSlotShape[] = (enrichedByTeacher.get(tid) ?? [])
      .map((s) => ({
        dayOfWeek: s.dayOfWeek,
        periodNumber: s.periodNumber,
        subject: s.subject,
        track: s.track,
        groupName: s.groupName,
        startTime: s.startTime,
        endTime: s.endTime,
      }))
      .sort(
        (a, b) =>
          DAYS_OF_WEEK.indexOf(a.dayOfWeek as (typeof DAYS_OF_WEEK)[number]) -
            DAYS_OF_WEEK.indexOf(b.dayOfWeek as (typeof DAYS_OF_WEEK)[number]) || a.periodNumber - b.periodNumber,
      );

    out.push({
      teacherId: tid,
      teacherName: nameById.get(tid) ?? tid,
      perWeekday,
      weekTotal: tslots.length,
      monthKey,
      monthTotal,
      monthTeachingDays,
      slots: detail,
    });
  }
  out.sort((a, b) => a.teacherName.localeCompare(b.teacherName));
  return out;
}
