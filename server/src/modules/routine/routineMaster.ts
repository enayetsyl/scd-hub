/**
 * Master routine grid (admin overview, R-3) — every section + subject-group for ONE
 * day in a single grid (rows = groups, columns = periods), with cross-group conflict
 * detection (a teacher booked in two cells of the same period). Read-only aggregate
 * over the conflict engine's invariant, surfaced for the whole timetable at once.
 */
import { RoutineSlot, type IRoutineSlot } from "./models/RoutineSlot";
import { Section } from "../foundation/models/Section";
import { Class } from "../foundation/models/Class";
import { SubjectGroup } from "./models/SubjectGroup";
import { PeriodGrid } from "./models/PeriodGrid";
import { ScheduleWindow } from "./models/ScheduleWindow";
import { computePeriodTimes } from "./schedule";
import { enrichRoutineSlots, type SlotViewFields } from "./slotView";

export interface MasterColumn { periodNumber: number; startTime: string | null; endTime: string | null; isBreak: boolean; }
export interface MasterRow { groupType: string; groupId: string; label: string; sublabel: string | null; }
export interface MasterConflict { periodNumber: number; teacherId: string; teacherName: string | null; labels: string[]; }
export interface RoutineMaster {
  day: string;
  columns: MasterColumn[];
  rows: MasterRow[];
  slots: (IRoutineSlot & SlotViewFields)[];
  conflicts: MasterConflict[];
}

export async function routineMasterGrid(day: string): Promise<RoutineMaster> {
  const raw = (await RoutineSlot.find({ dayOfWeek: day, active: true }).sort({ periodNumber: 1 }).lean()) as unknown as IRoutineSlot[];
  const slots = await enrichRoutineSlots(raw);

  // Columns: the class_1_5 grid is the superset (8 periods incl. the break); its times
  // cover nursery/KG too (P1–P6 share durations). Nursery/KG rows simply have no P7/P8.
  const grid = await PeriodGrid.findOne({ audienceKey: "class_1_5", season: "regular", active: true }).lean();
  const win = await ScheduleWindow.findOne({ season: "regular", active: true }).sort({ fromDate: 1 }).lean();
  const dayStart = win?.dayStartMinutes ?? 420;
  const columns: MasterColumn[] = grid
    ? computePeriodTimes(dayStart, grid.periods).map((p) => ({ periodNumber: p.number, startTime: p.startHHMM, endTime: p.endHHMM, isBreak: p.isBreak }))
    : [];

  // Rows: every group that has a slot today, labelled + ordered (sections by class level, then groups).
  const sectionIds = new Set<string>(), groupIds = new Set<string>();
  for (const s of raw) (s.groupType === "section" ? sectionIds : groupIds).add(s.groupId.toString());
  const sections = await Section.find({ _id: { $in: [...sectionIds] } }).lean();
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).lean();
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const groups = await SubjectGroup.find({ _id: { $in: [...groupIds] } }).lean();

  const trackOrder: Record<string, number> = { quran: 1, arabic: 2 };
  const ordered = [
    ...sections.map((sec) => {
      const cls = classById.get(sec.classId.toString());
      return { sortKey: (cls?.level ?? 0) * 10, row: { groupType: "section", groupId: sec._id.toString(), label: cls?.nameBn ?? "—", sublabel: sec.nameBn } as MasterRow };
    }),
    ...groups.map((g) => ({ sortKey: 1000 + (trackOrder[g.track] ?? 9) * 100, row: { groupType: "subjectgroup", groupId: g._id.toString(), label: g.nameBn, sublabel: null } as MasterRow })),
  ].sort((a, b) => a.sortKey - b.sortKey || a.row.label.localeCompare(b.row.label));
  const rows = ordered.map((o) => o.row);
  const labelByGroupId = new Map(rows.map((r) => [r.groupId, r.sublabel ? `${r.label} · ${r.sublabel}` : r.label]));

  // Conflicts: same teacher in ≥2 slots at the same period today.
  const byTP = new Map<string, typeof slots>();
  for (const s of slots) {
    if (!s.teacherId) continue;
    const k = `${s.teacherId.toString()}|${s.periodNumber}`;
    (byTP.get(k) ?? byTP.set(k, []).get(k)!).push(s);
  }
  const conflicts: MasterConflict[] = [];
  for (const [k, arr] of byTP) {
    if (arr.length < 2) continue;
    const [teacherId, per] = k.split("|");
    conflicts.push({ periodNumber: Number(per), teacherId, teacherName: arr[0].teacherName, labels: arr.map((s) => labelByGroupId.get(s.groupId.toString()) ?? "—") });
  }
  conflicts.sort((a, b) => a.periodNumber - b.periodNumber);

  return { day, columns, rows, slots, conflicts };
}

/** The full teaching week (Sun–Thu), one master grid per day. */
export async function routineMasterWeek(): Promise<RoutineMaster[]> {
  const days = ["SUN", "MON", "TUE", "WED", "THU"];
  return Promise.all(days.map((d) => routineMasterGrid(d)));
}
