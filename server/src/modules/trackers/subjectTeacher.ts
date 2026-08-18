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
  groupType?: "section" | "subjectgroup";
  groupId: { toString(): string };
  subject: string;
  dayOfWeek: string;
  periodNumber: number;
  teacherId?: { toString(): string } | null;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}

/** One attribution question: "who owns `subject` in this unit on `on`?"
 *
 *  The unit is a Section by default. D-#507 admits `groupType: "subjectgroup"` for
 *  the cross-class Quran/Arabic groups, so a group-anchored class test attributes
 *  by the SAME rule instead of a second copy of it. */
export interface SubjectTeacherQuery {
  /** Caller's own key — the returned map is keyed by this. */
  key: string;
  /** The section id, or the SubjectGroup id when groupType is "subjectgroup". */
  sectionId: string;
  /** Defaults to "section" — every pre-D-#507 caller. */
  groupType?: "section" | "subjectgroup";
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

  const unitIds = [...new Set(queries.map((q) => q.sectionId))];
  const subjects = [...new Set(queries.map((q) => q.subject))];
  // Both unit shapes in ONE query — the cell key carries the groupType, so a
  // section and a group that happened to share an id could never be confused.
  const groupTypes = [...new Set(queries.map((q) => q.groupType ?? "section"))];
  const slots = (await RoutineSlot.find({
    groupType: groupTypes.length === 1 ? groupTypes[0] : { $in: groupTypes },
    active: true,
    isBreak: false,
    groupId: { $in: unitIds },
    subject: { $in: subjects },
  })
    .select("groupType groupId dayOfWeek periodNumber subject teacherId effectiveFrom effectiveTo")
    .lean()) as unknown as SlotLite[];

  const byCell = new Map<string, SlotLite[]>();
  for (const s of slots) {
    if (!s.teacherId) continue;
    const k = `${s.groupType ?? "section"}|${s.groupId.toString()}|${s.subject}`;
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
    const cell = byCell.get(`${q.groupType ?? "section"}|${q.sectionId}|${q.subject}`) ?? [];
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
  groupType: "section" | "subjectgroup" = "section",
): Promise<string | null> {
  const m = await resolveSubjectTeachers([{ key: "x", sectionId, groupType, subject, on }]);
  return m.get("x") ?? null;
}

/**
 * Does the routine name this teacher on ANY live slot of this subject-group?
 * (D-#507 authz.) `assertCanWrite` is section-shaped — teacher scopes are grants
 * over sections — so a cross-class group has no section to check. The routine is
 * the honest answer to "is this your group?", and it is the same source the
 * accountable-teacher default above reads, so the two can never disagree.
 */
export async function teachesSubjectGroup(
  teacherId: string,
  subjectGroupId: string,
  subject: string,
): Promise<boolean> {
  const slots = (await RoutineSlot.find({
    groupType: "subjectgroup",
    groupId: subjectGroupId,
    subject,
    teacherId,
    active: true,
    isBreak: false,
  })
    .select("_id")
    .limit(1)
    .lean()) as unknown as Array<{ _id: unknown }>;
  return slots.length > 0;
}
