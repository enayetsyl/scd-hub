/**
 * Cover / proxy-manage helpers (R4.1) — pure availability ranking.
 *
 * Given the teacher roster, who is busy at the target (day, period), and each
 * teacher's class count that day, rank teachers so the admin can pick the
 * lightest-loaded free teacher to cover an absence.
 */
export interface AvailabilityRow {
  teacherId: string;
  name: string;
  classCount: number;
  free: boolean;
}

/** Free teachers first, then ascending by that day's class count (lightest first). */
export function rankAvailability(
  teachers: { id: string; name: string }[],
  busyIds: Set<string>,
  loadMap: Record<string, number>,
): AvailabilityRow[] {
  return teachers
    .map((t) => ({
      teacherId: t.id,
      name: t.name,
      classCount: loadMap[t.id] ?? 0,
      free: !busyIds.has(t.id),
    }))
    .sort((a, b) => {
      if (a.free !== b.free) return a.free ? -1 : 1;
      return a.classCount - b.classCount;
    });
}
