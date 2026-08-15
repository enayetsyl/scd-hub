/**
 * AttendanceRankingService (AR-1 — docs/prd-attendance-ranking.md).
 *
 * Ranks students and staff by attendance over a window. NOTHING here captures
 * anything: both registers already exist and are populated —
 *   • students: `StudentAttendanceDay`, ABSENT-ONLY per (unit, dateKey), D-#63
 *   • staff:    `TeacherAttendanceDay`, one row per staff per day from the AT-1
 *                biometric import
 * The only thing that was missing school-wide is ranged aggregation, which is all
 * this file is.
 *
 * THE METRIC (owner's choice): present % of HELD days.
 *   heldDays(unit)      = rows that exist for that unit in the window
 *   absentDays(student) = those rows listing the student
 *   presentPct          = 1 − absent / held
 * A day exists only because someone marked it, so the denominator is self-defining:
 * holidays, Saturday revision, section merges and weekday patterns need no calendar,
 * and a section is never punished for a day it did not hold. The flip side — an
 * UNMARKED day is invisible to the ranking — is deliberate: the school has no
 * evidence about that day either way. `heldDays` rides on every row so a thin
 * denominator is never hidden.
 *
 * THE TWO REGISTERS ARE NEVER MIXED. A section axis reads section rows; a Quran /
 * Arabic axis reads subjectGroup rows. A student legitimately appears in both with
 * different denominators — "present for Quran, absent for general class" is exactly
 * the pattern worth seeing (PRD §5).
 *
 * Identity/operational plane (ADR-005) — no corpus path.
 */
import { StudentAttendanceDay } from "../models/StudentAttendanceDay";
import { TeacherAttendanceDay } from "../models/TeacherAttendanceDay";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";

export type RankWindow = "week" | "month" | "cumulative" | "annual";

/** Which units the student ranking covers. The first three read SECTION rows, the
 *  last three read SUBJECT-GROUP rows — never both in one list. */
export type StudentRankAxis = "school" | "class" | "section" | "group" | "track" | "level";

/** Below this many held days a row still appears, but flagged and sorted last: a
 *  student with 3 held days at 100% must not outrank one with 60 days at 98%
 *  (PRD §9 Q3, owner-confirmed). A constant, deliberately easy to retune. */
export const MIN_HELD_DAYS = 10;

export interface RankRow {
  /** Competition ranking — ties share a rank (1, 1, 3). Below-floor rows keep
   *  ranking after every qualifying row. */
  rank: number;
  id: string;
  name: string;
  /** The unit this person's denominator came from (section or group name). */
  unitLabel: string;
  heldDays: number;
  absentDays: number;
  /** 0..100, one decimal. */
  presentPct: number;
  /** Staff only — counts as PRESENT, shown separately, breaks ties (PRD §6). */
  lateDays?: number;
  /** Staff only — days excluded from the denominator as approved leave. */
  leaveDays?: number;
  /** heldDays < MIN_HELD_DAYS: ranked, but not comparable on equal terms. */
  belowFloor: boolean;
}

export interface RankResult {
  fromKey: string;
  toKey: string;
  rows: RankRow[];
  /** Units that contributed rows — lets the screen say what was actually measured. */
  unitCount: number;
}

// ---------------------------------------------------------------------------
// Window resolution
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` compares lexicographically in date order, so ranges need no Date
 *  objects — and no timezone can shift a boundary (the D-#479 day-key lesson). */
function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Day of week for a key, 0=Sunday..6=Saturday (UTC-safe: the key IS the local day). */
function dowOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The school week containing `dateKey`: SATURDAY → FRIDAY (the Bangladesh school
 *  week; Friday is the holiday, so it sits at the end and contributes no held days). */
export function weekRange(dateKey: string): { fromKey: string; toKey: string } {
  const back = (dowOf(dateKey) + 1) % 7; // Saturday(6) → 0, Sunday(0) → 1, …
  const fromKey = addDays(dateKey, -back);
  return { fromKey, toKey: addDays(fromKey, 6) };
}

export function monthRange(dateKey: string): { fromKey: string; toKey: string } {
  const [y, m] = dateKey.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { fromKey: `${y}-${mm}-01`, toKey: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/**
 * Resolve a window to an inclusive day-key range.
 *   week/month  — around the anchor date
 *   cumulative  — academic-year start → the anchor ("how are we doing so far")
 *   annual      — the whole academic year (the settled end-of-year figure)
 * Cumulative and annual are the same computation with a different end date; both
 * exist because they answer different questions.
 */
export async function resolveWindow(
  window: RankWindow,
  anchorKey: string,
  academicYearId?: string,
): Promise<{ fromKey: string; toKey: string }> {
  if (window === "week") return weekRange(anchorKey);
  if (window === "month") return monthRange(anchorKey);

  const year = academicYearId
    ? await AcademicYear.findById(academicYearId).lean()
    : await AcademicYear.findOne().sort({ startDate: -1 }).lean();
  if (!year) throw new Error("No academic year found for a cumulative/annual window");
  const startKey = new Date(year.startDate).toISOString().slice(0, 10);
  const endKey = new Date(year.endDate).toISOString().slice(0, 10);
  return window === "annual"
    ? { fromKey: startKey, toKey: endKey }
    : { fromKey: startKey, toKey: anchorKey < startKey ? startKey : anchorKey };
}

// ---------------------------------------------------------------------------
// Ranking assembly
// ---------------------------------------------------------------------------

/** Sort + number a finished row set. Qualifying rows first (present % desc, then
 *  fewer late, then fewer absences, then name); below-floor rows after, same order.
 *  Competition ranking: equal present % shares a rank. */
function rankRows(rows: Omit<RankRow, "rank">[]): RankRow[] {
  const cmp = (a: Omit<RankRow, "rank">, b: Omit<RankRow, "rank">): number =>
    b.presentPct - a.presentPct ||
    (a.lateDays ?? 0) - (b.lateDays ?? 0) ||
    a.absentDays - b.absentDays ||
    a.name.localeCompare(b.name);
  const ordered = [
    ...rows.filter((r) => !r.belowFloor).sort(cmp),
    ...rows.filter((r) => r.belowFloor).sort(cmp),
  ];
  const out: RankRow[] = [];
  let lastPct: number | null = null;
  let lastRank = 0;
  ordered.forEach((r, i) => {
    const rank = lastPct !== null && r.presentPct === lastPct && !r.belowFloor ? lastRank : i + 1;
    lastPct = r.belowFloor ? null : r.presentPct;
    lastRank = rank;
    out.push({ ...r, rank });
  });
  return out;
}

const pct = (held: number, absent: number): number =>
  held === 0 ? 0 : Math.round(((held - absent) / held) * 1000) / 10;

/** The units (and their rosters) a student axis covers. */
async function resolveStudentUnits(
  axis: StudentRankAxis,
  axisValue?: string,
): Promise<{ byGroup: boolean; units: { id: string; label: string }[] }> {
  if (axis === "school" || axis === "class" || axis === "section") {
    const filter: Record<string, unknown> = {};
    if (axis === "section") filter._id = axisValue;
    if (axis === "class") filter.classId = axisValue;
    const sections = await Section.find(filter).select("code nameBn classId").lean();
    return {
      byGroup: false,
      units: sections.map((s) => ({
        id: s._id.toString(),
        label: (s as { nameBn?: string; code?: string }).nameBn ?? s.code ?? s._id.toString(),
      })),
    };
  }
  const filter: Record<string, unknown> = { active: true };
  if (axis === "group") filter._id = axisValue;
  if (axis === "track") filter.track = axisValue;
  if (axis === "level") filter.level = axisValue;
  const groups = await SubjectGroup.find(filter).select("nameBn code track level").lean();
  return {
    byGroup: true,
    units: groups.map((g) => ({ id: g._id.toString(), label: g.nameBn ?? g.code })),
  };
}

/**
 * Rank students over a window on one axis. Present % of the unit's held days; every
 * enrolled student in a measured unit appears, including those with zero absences
 * (that is the point of a ranking, and absent-only capture means they are otherwise
 * invisible in the attendance rows).
 */
export async function rankStudents(input: {
  window: RankWindow;
  anchorKey: string;
  axis: StudentRankAxis;
  axisValue?: string;
  academicYearId?: string;
}): Promise<RankResult> {
  const { fromKey, toKey } = await resolveWindow(input.window, input.anchorKey, input.academicYearId);
  const { byGroup, units } = await resolveStudentUnits(input.axis, input.axisValue);
  const unitIds = units.map((u) => u.id);
  const labelOf = new Map(units.map((u) => [u.id, u.label]));
  if (unitIds.length === 0) return { fromKey, toKey, rows: [], unitCount: 0 };

  const days = await StudentAttendanceDay.find({
    dateKey: { $gte: fromKey, $lte: toKey },
    ...(byGroup ? { subjectGroupId: { $in: unitIds } } : { sectionId: { $in: unitIds } }),
  })
    .select("sectionId subjectGroupId absentStudentIds")
    .lean();

  // heldDays per unit + absence tally per student.
  const held = new Map<string, number>();
  const absences = new Map<string, number>();
  for (const d of days) {
    const unitId = (byGroup ? d.subjectGroupId : d.sectionId)?.toString();
    if (!unitId) continue;
    held.set(unitId, (held.get(unitId) ?? 0) + 1);
    for (const sid of d.absentStudentIds ?? []) {
      const k = sid.toString();
      absences.set(k, (absences.get(k) ?? 0) + 1);
    }
  }
  // Only units that actually held a day can rank anyone.
  const measured = [...held.keys()];
  if (measured.length === 0) return { fromKey, toKey, rows: [], unitCount: 0 };

  // Roster per measured unit → student's unit membership.
  const unitOfStudent = new Map<string, string>();
  let students: { _id: { toString(): string }; name: string; nameBn?: string }[] = [];
  if (byGroup) {
    const memberships = await SubjectGroupMembership.find({ groupId: { $in: measured } })
      .select("groupId studentId")
      .lean();
    for (const m of memberships) unitOfStudent.set(m.studentId.toString(), m.groupId.toString());
    students = await Student.find({ _id: { $in: [...unitOfStudent.keys()] }, active: true })
      .select("name nameBn")
      .lean();
  } else {
    students = await Student.find({ sectionId: { $in: measured }, active: true })
      .select("name nameBn sectionId")
      .lean();
    for (const s of students as unknown as { _id: { toString(): string }; sectionId: { toString(): string } }[]) {
      unitOfStudent.set(s._id.toString(), s.sectionId.toString());
    }
  }

  const rows = students.flatMap((s) => {
    const id = s._id.toString();
    const unitId = unitOfStudent.get(id);
    const h = unitId ? held.get(unitId) ?? 0 : 0;
    if (!unitId || h === 0) return []; // unit held no day in the window — nothing to rank on
    const a = absences.get(id) ?? 0;
    return [{
      id,
      name: s.nameBn || s.name,
      unitLabel: labelOf.get(unitId) ?? "—",
      heldDays: h,
      absentDays: a,
      presentPct: pct(h, a),
      belowFloor: h < MIN_HELD_DAYS,
    }];
  });

  return { fromKey, toKey, rows: rankRows(rows), unitCount: measured.length };
}

/**
 * Rank staff over a window from the biometric register.
 *   denominator = the staff member's own rows, EXCLUDING approved LEAVE (owner
 *                 ruling, PRD §9 Q1) — leave is not absence, and counting it as
 *                 such would rank maternity/Hajj/bereavement to the bottom.
 *   present     = PRESENT + LATE; `lateDays` is carried separately and breaks ties,
 *                 because two staff at 100% are not equal if one was late eleven times.
 * A mid-year joiner is judged only on days they have rows for.
 */
export async function rankStaff(input: {
  window: RankWindow;
  anchorKey: string;
  academicYearId?: string;
}): Promise<RankResult> {
  const { fromKey, toKey } = await resolveWindow(input.window, input.anchorKey, input.academicYearId);
  const days = await TeacherAttendanceDay.find({ dateKey: { $gte: fromKey, $lte: toKey } })
    .select("staffProfileId status")
    .lean();
  if (days.length === 0) return { fromKey, toKey, rows: [], unitCount: 0 };

  type Tally = { held: number; absent: number; late: number; leave: number };
  const tally = new Map<string, Tally>();
  for (const d of days) {
    const k = d.staffProfileId.toString();
    const t = tally.get(k) ?? { held: 0, absent: 0, late: 0, leave: 0 };
    if (d.status === "LEAVE") {
      t.leave += 1; // excluded from the denominator entirely
    } else {
      t.held += 1;
      if (d.status === "ABSENT") t.absent += 1;
      if (d.status === "LATE") t.late += 1;
    }
    tally.set(k, t);
  }

  const staff = await StaffProfile.find({ _id: { $in: [...tally.keys()] } })
    .select("name nameBn category")
    .lean();

  const rows = staff.flatMap((s) => {
    const t = tally.get(s._id.toString());
    if (!t || t.held === 0) return []; // every day in the window was approved leave
    return [{
      id: s._id.toString(),
      name: (s as { nameBn?: string; name: string }).nameBn || s.name,
      unitLabel: (s as { category?: string }).category ?? "—",
      heldDays: t.held,
      absentDays: t.absent,
      presentPct: pct(t.held, t.absent),
      lateDays: t.late,
      leaveDays: t.leave,
      belowFloor: t.held < MIN_HELD_DAYS,
    }];
  });

  return { fromKey, toKey, rows: rankRows(rows), unitCount: rows.length };
}
