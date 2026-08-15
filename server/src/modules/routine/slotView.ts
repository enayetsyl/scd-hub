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
import { Section } from "../foundation/models/Section";
import { PeriodGrid } from "./models/PeriodGrid";
import { ScheduleWindow } from "./models/ScheduleWindow";
import { SubjectGroup } from "./models/SubjectGroup";
import { computePeriodTimes } from "./schedule";

/** Sections that ARE the whole class (post-merge) — their name is redundant next
 *  to the class, so the group name shows just the class. Boys/Girls stay appended. */
const WHOLE_CLASS_SECTIONS = ["মূল", "সম্মিলিত"];

/** The view-only fields attached to each slot (read by the RoutineSlot GraphQL type). */
export interface SlotViewFields {
  teacherName: string | null;
  coverTeacherName: string | null;
  startTime: string | null;
  endTime: string | null;
  /** The class/group this slot belongs to (section → class [+ Boys/Girls]; subjectgroup → its name). */
  groupName: string | null;
}

interface Enrichable {
  groupType: string;
  periodNumber: number;
  classId?: Types.ObjectId | string | null;
  groupId?: Types.ObjectId | string | null;
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

  // 2. Class levels + names for section slots → audience + group name.
  const classIds = new Set<string>();
  const sectionIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const s of slots) {
    if (s.groupType === "section") {
      if (s.classId) classIds.add(s.classId.toString());
      if (s.groupId) sectionIds.add(s.groupId.toString());
    } else if (s.groupType === "subjectgroup" && s.groupId) {
      groupIds.add(s.groupId.toString());
    }
  }
  const classes = await Class.find({ _id: { $in: [...classIds] } }).select("level nameBn").lean();
  const levelById = new Map(classes.map((c) => [c._id.toString(), c.level]));
  const classNameById = new Map(classes.map((c) => [c._id.toString(), c.nameBn]));
  const sections = await Section.find({ _id: { $in: [...sectionIds] } }).select("nameBn").lean();
  const sectionNameById = new Map(sections.map((s) => [s._id.toString(), s.nameBn]));
  const subjectGroups = await SubjectGroup.find({ _id: { $in: [...groupIds] } }).select("nameBn").lean();
  const groupNameById = new Map(subjectGroups.map((g) => [g._id.toString(), g.nameBn]));

  /** Section slot → class name (+ Boys/Girls if a real sub-section); subjectgroup → its name. */
  const groupNameOf = (s: Enrichable): string | null => {
    if (s.groupType === "subjectgroup") {
      return s.groupId ? groupNameById.get(s.groupId.toString()) ?? null : null;
    }
    const className = s.classId ? classNameById.get(s.classId.toString()) ?? null : null;
    const sectionName = s.groupId ? sectionNameById.get(s.groupId.toString()) ?? null : null;
    if (!className) return sectionName;
    return sectionName && !WHOLE_CLASS_SECTIONS.includes(sectionName) ? `${className} · ${sectionName}` : className;
  };

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
      // DE-4 (D-#477): the period card declares homework inline, and the topic
      // picker is keyed on (subject, classLevel). The level is already resolved
      // here for the audience/time lookup, so surfacing it costs nothing and saves
      // the card a CLASSES round-trip per period.
      classLevel: s.classId ? levelById.get(s.classId.toString()) ?? null : null,
      groupName: groupNameOf(s),
    };
  });
}
