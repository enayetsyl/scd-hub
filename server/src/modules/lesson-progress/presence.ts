/**
 * Who was absent at each marked class (LP-4, D-#827/#828) — from the day attendance of the units the
 * delivery snapshotted at marking (D-#823). A delivery from before `attendanceUnits` existed reads
 * the roster's CURRENT units instead. `recorded` = every unit had a record that day; when it is
 * false, nobody may be called present or absent beyond the names actually listed.
 */
import { Types } from "mongoose";
import { StudentAttendanceDay } from "../attendance/models/StudentAttendanceDay";
import { resolveUnitsForIds } from "../attendance/attendanceUnit";

export interface DeliveryForPresence {
  noteId: Types.ObjectId | string;
  dateKey: string;
  rosterStudentIds: Array<Types.ObjectId | string>;
  attendanceUnits?: string[];
}

export interface ClassAbsence {
  absent: Set<string>;
  recorded: boolean;
}

export async function absencesByNote(deliveries: DeliveryForPresence[]): Promise<Map<string, ClassAbsence>> {
  const out = new Map<string, ClassAbsence>();
  if (deliveries.length === 0) return out;

  // Units per delivery (the snapshot, or today's units of its roster for an older row).
  const unitsOf = new Map<string, string[]>();
  const legacy = deliveries.filter((d) => !d.attendanceUnits?.length);
  if (legacy.length) {
    const ids = [...new Set(legacy.flatMap((d) => d.rosterStudentIds.map(String)))];
    const now = await resolveUnitsForIds(ids);
    for (const d of legacy) {
      unitsOf.set(String(d.noteId), [...new Set(d.rosterStudentIds.map((s) => now.get(String(s))).filter(Boolean).map((u) => `${u!.unitType}:${u!.unitId}`))]);
    }
  }
  for (const d of deliveries) if (d.attendanceUnits?.length) unitsOf.set(String(d.noteId), d.attendanceUnits);

  const daysByUnit = new Map<string, Set<string>>();
  for (const d of deliveries) for (const u of unitsOf.get(String(d.noteId)) ?? []) daysByUnit.set(u, (daysByUnit.get(u) ?? new Set()).add(d.dateKey));
  const or = [...daysByUnit.entries()].flatMap(([u, days]) => {
    const [type, id] = u.split(":");
    if (!Types.ObjectId.isValid(id)) return [];
    return [{ [type === "subjectgroup" ? "subjectGroupId" : "sectionId"]: new Types.ObjectId(id), dateKey: { $in: [...days] } }];
  });
  const recs = or.length
    ? ((await StudentAttendanceDay.find({ $or: or }).select("sectionId subjectGroupId dateKey absentStudentIds").lean()) as unknown as Array<{
        sectionId?: Types.ObjectId;
        subjectGroupId?: Types.ObjectId;
        dateKey: string;
        absentStudentIds: Types.ObjectId[];
      }>)
    : [];
  const recKey = (r: (typeof recs)[number]) => `${r.subjectGroupId ? `subjectgroup:${r.subjectGroupId}` : `section:${r.sectionId}`}|${r.dateKey}`;
  const byKey = new Map(recs.map((r) => [recKey(r), r]));

  for (const d of deliveries) {
    const units = unitsOf.get(String(d.noteId)) ?? [];
    const roster = new Set(d.rosterStudentIds.map(String));
    const absent = new Set<string>();
    let recorded = units.length > 0;
    for (const u of units) {
      const r = byKey.get(`${u}|${d.dateKey}`);
      if (!r) {
        recorded = false;
        continue;
      }
      for (const s of r.absentStudentIds) if (roster.has(String(s))) absent.add(String(s));
    }
    out.set(String(d.noteId), { absent, recorded });
  }
  return out;
}
