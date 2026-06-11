/**
 * Routine conflict engine — pure collision detection (R2.2–R2.4).
 *
 * A clash needs the same (day, period) AND overlapping effective windows; then a
 * teacher / group / room appearing twice is a conflict. All pure — the resolver
 * feeds the existing active slots in and rejects on any conflict.
 */

/** Plain slot shape the checks operate on (id'd for reporting). */
export interface SlotLite {
  id: string;
  dayOfWeek: string;
  periodNumber: number;
  groupType: string;
  groupId: string;
  teacherId?: string | null;
  roomId?: string | null;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}

const FAR_FUTURE = new Date(8640000000000000); // max representable Date

function dayKey(d: Date): number {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
}

/** Two effective windows overlap (date-only, inclusive; null/undefined `to` = open). */
export function effectiveOverlap(
  aFrom: Date,
  aTo: Date | null | undefined,
  bFrom: Date,
  bTo: Date | null | undefined,
): boolean {
  const aEnd = aTo ?? FAR_FUTURE;
  const bEnd = bTo ?? FAR_FUTURE;
  return dayKey(aFrom) <= dayKey(bEnd) && dayKey(bFrom) <= dayKey(aEnd);
}

/** Same (day, period) AND overlapping window — the precondition for any clash. */
function clashesInTime(a: SlotLite, b: SlotLite): boolean {
  return (
    a.dayOfWeek === b.dayOfWeek &&
    a.periodNumber === b.periodNumber &&
    effectiveOverlap(a.effectiveFrom, a.effectiveTo, b.effectiveFrom, b.effectiveTo)
  );
}

export interface ConflictReport {
  teacher: SlotLite | null;
  group: SlotLite | null;
  room: SlotLite | null;
}

/**
 * Detect teacher / group / room double-bookings for `candidate` against `existing`
 * (R2.2–R2.4). `existing` must exclude the candidate's own row (on edit). Returns the
 * first conflicting slot per dimension, or null.
 */
export function detectConflicts(candidate: SlotLite, existing: SlotLite[]): ConflictReport {
  const report: ConflictReport = { teacher: null, group: null, room: null };
  for (const e of existing) {
    if (e.id === candidate.id) continue;
    if (!clashesInTime(candidate, e)) continue;
    if (!report.teacher && candidate.teacherId && e.teacherId && candidate.teacherId === e.teacherId)
      report.teacher = e;
    if (!report.group && candidate.groupType === e.groupType && candidate.groupId === e.groupId)
      report.group = e;
    if (!report.room && candidate.roomId && e.roomId && candidate.roomId === e.roomId)
      report.room = e;
  }
  return report;
}

export function hasConflict(r: ConflictReport): boolean {
  return !!(r.teacher || r.group || r.room);
}
