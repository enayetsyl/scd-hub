/**
 * Accountable SUBJECT TEACHER resolution (D-#351, generalised).
 *
 * A tracker row must be attributed to the teacher who OWNS the subject for that
 * section — not to whoever physically entered it. A Principal/Office data-entry
 * on a teacher's behalf belongs in that teacher's row, and the remaining flow
 * (submission, checking, results) belongs in that teacher's account.
 *
 * The source of truth is the ROUTINE: the teacher scheduled for that
 * section × subject, resolved with the D-#293 rule —
 *   1. a live slot on the row's own weekday (earliest period wins),
 *   2. else any live slot for the cell,
 *   3. else any slot for the cell, ignoring effective dates.
 * Returns null when the routine names nobody; each caller decides its own
 * fallback (the homework report falls back to the declarer, a class test to the
 * requester, and an admin may override the pick explicitly at creation).
 *
 * Extracted from HomeworkLifecycleReportService so the homework tracker and the
 * class-test tracker resolve attribution IDENTICALLY — one rule, one place.
 */
import { DAYS_OF_WEEK } from "@scd/shared";
import { RoutineSlot } from "../routine/models/RoutineSlot";

interface SlotLite {
  groupId: { toString(): string };
  subject: string;
  dayOfWeek: string;
  periodNumber: number;
  teacherId?: { toString(): string } | null;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}

/** One attribution question: "who owns `subject` in `sectionId` on `on`?" */
export interface SubjectTeacherQuery {
  /** Caller's own key — the returned map is keyed by this. */
  key: string;
  sectionId: string;
  subject: string;
  /** The row's date (homework dateGiven, class-test examDate). */
  on: Date;
}

/**
 * Batch-resolve the routine's subject teacher. Returns key → teacherId, with the
 * key ABSENT when the routine names no teacher for that cell (callers fall back).
 * One routine query for the whole batch.
 */
export async function resolveSubjectTeachers(
  queries: readonly SubjectTeacherQuery[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (queries.length === 0) return out;

  const sectionIds = [...new Set(queries.map((q) => q.sectionId))];
  const subjects = [...new Set(queries.map((q) => q.subject))];
  const slots = (await RoutineSlot.find({
    groupType: "section",
    active: true,
    isBreak: false,
    groupId: { $in: sectionIds },
    subject: { $in: subjects },
  })
    .select("groupId dayOfWeek periodNumber subject teacherId effectiveFrom effectiveTo")
    .lean()) as unknown as SlotLite[];

  const byCell = new Map<string, SlotLite[]>();
  for (const s of slots) {
    if (!s.teacherId) continue;
    const k = `${s.groupId.toString()}|${s.subject}`;
    (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(s);
  }

  const live = (s: SlotLite, t: number): boolean =>
    new Date(s.effectiveFrom).getTime() <= t && (!s.effectiveTo || new Date(s.effectiveTo).getTime() >= t);
  const earliest = (arr: SlotLite[]): string | null => {
    if (arr.length === 0) return null;
    const best = arr.reduce((a, b) => (b.periodNumber < a.periodNumber ? b : a));
    return best.teacherId ? best.teacherId.toString() : null;
  };

  for (const q of queries) {
    const cell = byCell.get(`${q.sectionId}|${q.subject}`) ?? [];
    const d = new Date(q.on);
    const t = d.getTime();
    const dow = DAYS_OF_WEEK[d.getDay()];
    const teacher =
      earliest(cell.filter((s) => s.dayOfWeek === dow && live(s, t))) ?? // scheduled that day
      earliest(cell.filter((s) => live(s, t))) ?? // any live slot for the cell
      earliest(cell); // any slot for the cell, ignoring effective dates
    if (teacher) out.set(q.key, teacher);
  }
  return out;
}

/** Single-cell convenience — null when the routine names nobody. */
export async function resolveSubjectTeacher(
  sectionId: string,
  subject: string,
  on: Date,
): Promise<string | null> {
  const m = await resolveSubjectTeachers([{ key: "x", sectionId, subject, on }]);
  return m.get("x") ?? null;
}
