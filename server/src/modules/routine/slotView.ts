/**
 * View enrichment for routine slots (R-3): resolve `teacherId`/`coverTeacherId` to
 * names and compute each period's clock window from the active grid + schedule window,
 * so the app shows "07:00–07:45 · Bangla · Hamida Akter" instead of raw ObjectIds.
 *
 * Batched per query (one User/Class/Grid load for the whole list) — no N+1. Times use
 * the regular-season window's day-start (the standard weekly view); date-specific
 * winter shifts are out of scope for the grid view.
 */
import { Types } from "mongoose";
import { User } from "../foundation/models/User";
import { Class } from "../foundation/models/Class";
import { PeriodGrid } from "./models/PeriodGrid";
import { ScheduleWindow } from "./models/ScheduleWindow";
import { computePeriodTimes } from "./schedule";

/** The view-only fields attached to each slot (read by the RoutineSlot GraphQL type). */
export interface SlotViewFields {
  teacherName: string | null;
  coverTeacherName: string | null;
  startTime: string | null;
  endTime: string | null;
}

interface Enrichable {
  groupType: string;
  periodNumber: number;
  classId?: Types.ObjectId | string | null;
  teacherId?: Types.ObjectId | string | null;
  coverTeacherId?: Types.ObjectId | string | null;
}

const audienceForLevel = (level: number | undefined): string =>
  level != null && level <= 0 ? "nursery_kg" : "class_1_5";

/** Attach teacher/cover names + period start/end times to a list of (lean) slots. */
export async function enrichRoutineSlots<T extends Enrichable>(slots: T[]): Promise<(T & SlotViewFields)[]> {
  if (slots.length === 0) return [];

  // 1. Teacher + cover names (one batched load).
  const userIds = new Set<string>();
  for (const s of slots) {
    if (s.teacherId) userIds.add(s.teacherId.toString());
    if (s.coverTeacherId) userIds.add(s.coverTeacherId.toString());
  }
  const users = await User.find({ _id: { $in: [...userIds] } }).select("name").lean();
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));

  // 2. Class levels for section slots → audience.
  const classIds = new Set<string>();
  for (const s of slots) if (s.groupType === "section" && s.classId) classIds.add(s.classId.toString());
  const classes = await Class.find({ _id: { $in: [...classIds] } }).select("level").lean();
  const levelById = new Map(classes.map((c) => [c._id.toString(), c.level]));

  // 3. Period times per audience from the regular-season grids + window.
  const grids = await PeriodGrid.find({ season: "regular", active: true }).lean();
  const win = await ScheduleWindow.findOne({ season: "regular", active: true }).sort({ fromDate: 1 }).lean();
  const dayStart = win?.dayStartMinutes ?? 420;
  const timesByAudience = new Map<string, Map<number, { start: string; end: string }>>();
  for (const g of grids) {
    const computed = computePeriodTimes(dayStart, g.periods);
    timesByAudience.set(g.audienceKey, new Map(computed.map((p) => [p.number, { start: p.startHHMM, end: p.endHHMM }])));
  }

  return slots.map((s) => {
    const audience = s.groupType === "subjectgroup"
      ? "class_1_5"
      : audienceForLevel(s.classId ? levelById.get(s.classId.toString()) : undefined);
    const t = timesByAudience.get(audience)?.get(s.periodNumber);
    return {
      ...s,
      teacherName: s.teacherId ? nameById.get(s.teacherId.toString()) ?? null : null,
      coverTeacherName: s.coverTeacherId ? nameById.get(s.coverTeacherId.toString()) ?? null : null,
      startTime: t?.start ?? null,
      endTime: t?.end ?? null,
    };
  });
}
