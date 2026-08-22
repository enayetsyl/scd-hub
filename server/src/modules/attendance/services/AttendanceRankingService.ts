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
import { Class } from "../../foundation/models/Class";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import {
  quranGroupByStudent,
  isLegacyAttendanceDate,
  isNurseryKg,
  unitKey,
} from "../attendanceUnit";

export type RankWindow = "week" | "month" | "cumulative" | "annual";

/** Which units the student ranking covers. The first three read SECTION rows, the
 *  last three read SUBJECT-GROUP rows — never both in one list. */
export type StudentRankAxis = "school" | "class" | "section" | "group" | "track" | "level";

/**
 * Row ORDER only. `rank` is computed from attendance and never changes with this —
 * sorting by class regroups the same numbered rows, so a rank means the same thing in
 * both views and a screenshot of one cannot be misread as the other (D-#512).
 * Renumbering per class would make "1" mean group-winner in one view and class-winner
 * in the other, with nothing on the row to say which.
 */
export type StudentRankSort = "rank" | "class";

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
  /**
   * The student's GENERAL class (students only; absent on staff rows).
   *
   * On a section-shaped axis this repeats what `unitLabel` already leads with, but on
   * the Quran/Arabic axes it is the only place the class appears at all — those groups
   * are cross-grade by design (D-#48), so "কায়দা" alone never says whether a name is a
   * class-1 child or a class-5 one. That was the question the first live read produced.
   */
  classLabel?: string;
  /** Roster level behind `classLabel` (-1 nursery, 0 KG, 1..5) — what `sortBy: "class"`
   *  orders on, so nursery sorts before KG before class 1 rather than alphabetically. */
  classLevel?: number;
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
  /**
   * The most recent day this register was marked at all, ignoring the window. An
   * empty ranking is ambiguous on its own — nobody attended? wrong filter? nothing
   * marked yet? — and the honest answer is usually "the window is ahead of the data".
   * Carrying the last marked day lets the empty state say which, instead of leaving
   * the reader to guess (the Saturday-anchor confusion that surfaced this).
   */
  lastMarkedKey: string | null;
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

/**
 * The school week containing `dateKey`: SUNDAY → SATURDAY.
 *
 * Fixed after the first live check (2026-08-15): this school's week is **Sunday to
 * Thursday**, with BOTH Friday and Saturday off — across the 32 marked dates on prod,
 * Sun–Thu carry 43/42/42/41/49 rows and Fri/Sat carry **zero**. A Saturday-start week
 * (the first guess) put a Saturday anchor at the head of the week *ahead*, so asking
 * for "this week" on a Saturday showed five unmarked future days and an empty list.
 * Sunday-start puts the weekend at the END, so a Friday or Saturday anchor reports the
 * school week that just finished — which is what someone looking on a day off means.
 */
export function weekRange(dateKey: string): { fromKey: string; toKey: string } {
  const fromKey = addDays(dateKey, -dowOf(dateKey)); // Sunday(0) → 0, Monday(1) → 1, …
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

  // The CURRENT year, not the newest one. Live check 2026-08-15: prod carries 2026
  // (current), 2027 and 2029, so "newest startDate" resolved to 2029 and every
  // cumulative/annual ranking came back empty. `current` is the field that means
  // "the year the school is in"; sorting by date is a guess that future-dated
  // planning rows silently break.
  const year = academicYearId
    ? await AcademicYear.findById(academicYearId).lean()
    : (await AcademicYear.findOne({ current: true }).lean()) ??
      (await AcademicYear.findOne().sort({ startDate: -1 }).lean());
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

/**
 * studentId → their general class label + roster level, in ONE query for the whole set.
 * `nameBn` is the school's own wording for the class; the numeric level is the fallback
 * so a class row missing a Bangla name still renders something rather than a blank cell.
 */
async function classLabelByStudent(
  students: { _id: { toString(): string }; classId?: { toString(): string } }[],
): Promise<Map<string, { label: string; level: number }>> {
  const classIds = [...new Set(students.map((s) => s.classId?.toString()).filter(Boolean))];
  if (classIds.length === 0) return new Map();
  const classes = await Class.find({ _id: { $in: classIds } }).select("nameBn level").lean();
  const byClass = new Map(
    classes.map((c) => {
      const level = (c as { level?: number }).level ?? 0;
      return [c._id.toString(), { label: (c as { nameBn?: string }).nameBn ?? String(level), level }];
    }),
  );
  const out = new Map<string, { label: string; level: number }>();
  for (const s of students) {
    const hit = s.classId ? byClass.get(s.classId.toString()) : undefined;
    if (hit) out.set(s._id.toString(), hit);
  }
  return out;
}

/**
 * Reorder finished rows for delivery. `rank` is already assigned and is NOT touched.
 *
 * Sorting by class keeps each class's rows in their existing ranked order (the input is
 * already qualifying-first, present % desc), so within a class the best attender still
 * leads. A student whose class could not be resolved sorts last rather than colliding
 * with nursery at level 0 — `?? 99`, not `?? 0`.
 */
function sortRows(rows: RankRow[], sortBy: StudentRankSort): RankRow[] {
  if (sortBy !== "class") return rows;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (a.row.classLevel ?? 99) - (b.row.classLevel ?? 99) || a.i - b.i)
    .map((x) => x.row);
}

/** The latest day either register was marked, window-independent (see `lastMarkedKey`). */
async function lastMarked(byGroup: boolean | "staff"): Promise<string | null> {
  const doc =
    byGroup === "staff"
      ? await TeacherAttendanceDay.findOne().sort({ dateKey: -1 }).select("dateKey").lean()
      : await StudentAttendanceDay.findOne(
          byGroup ? { subjectGroupId: { $exists: true } } : { sectionId: { $exists: true } },
        )
          .sort({ dateKey: -1 })
          .select("dateKey")
          .lean();
  return doc?.dateKey ?? null;
}

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
    // The section name alone is USELESS as a label: every class's default section is
    // "Main"/মূল (D-#1), so a whole-school ranking rendered "মূল" on every row and the
    // reader could not tell a Nursery row from a class-4 one — which is exactly the
    // question the first live read produced. Prefix the class.
    const classes = await Class.find({
      _id: { $in: [...new Set(sections.map((s) => s.classId?.toString()).filter(Boolean))] },
    })
      .select("nameBn level")
      .lean();
    const classLabel = new Map(
      classes.map((c) => [
        c._id.toString(),
        (c as { nameBn?: string; level?: number }).nameBn ?? String((c as { level?: number }).level ?? ""),
      ]),
    );
    return {
      byGroup: false,
      units: sections.map((s) => {
        const sectionName =
          (s as { nameBn?: string; code?: string }).nameBn ?? s.code ?? s._id.toString();
        const cls = s.classId ? classLabel.get(s.classId.toString()) : undefined;
        return { id: s._id.toString(), label: cls ? `${cls} · ${sectionName}` : sectionName };
      }),
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
 * Rank students on a CLASS/SECTION-shaped axis (school | class | section).
 *
 * Attendance for Class 1–5 is NOT captured on their section: since the D-#278
 * cutover (2026-07-13) their first class of the day is a cross-section Quran
 * `SubjectGroup`, so their day record carries `subjectGroupId`. Nursery/KG stay
 * section-captured, and every date BEFORE the cutover is section-shaped for
 * everyone (D-#292).
 *
 * So a section-shaped ranking cannot count section rows — it must resolve EACH
 * STUDENT's own attendance unit FOR EACH DATE and count that, exactly as
 * `absenteeReport` does. Counting section rows made classes 1–5 look like they
 * had stopped marking on the cutover date; they had simply moved units.
 *
 * Display stays class → section throughout: the group is a record-keeping unit,
 * never a display axis (prd-attendance-firstclass §3).
 *
 * One pass, no per-date queries: memberships and class levels are date-independent,
 * and only the legacy/cutover branch varies per date.
 */
async function rankStudentsByUnit(
  fromKey: string,
  toKey: string,
  axis: "school" | "class" | "section",
  axisValue: string | undefined,
): Promise<RankResult> {
  const studentFilter: Record<string, unknown> = { active: true };
  if (axis === "class") studentFilter.classId = axisValue;
  if (axis === "section") studentFilter.sectionId = axisValue;
  const students = await Student.find(studentFilter).select("name nameBn sectionId classId").lean();
  if (students.length === 0)
    return { fromKey, toKey, rows: [], unitCount: 0, lastMarkedKey: await lastMarked(false) };

  // Every day record in the window, BOTH shapes — a student's unit decides which
  // one covers them, so neither shape can be filtered out up front.
  const days = (await StudentAttendanceDay.find({ dateKey: { $gte: fromKey, $lte: toKey } })
    .select("sectionId subjectGroupId dateKey absentStudentIds")
    .lean()) as unknown as Array<{
    sectionId?: { toString(): string };
    subjectGroupId?: { toString(): string };
    dateKey: string;
    absentStudentIds?: Array<{ toString(): string }>;
  }>;
  if (days.length === 0)
    return { fromKey, toKey, rows: [], unitCount: 0, lastMarkedKey: await lastMarked(false) };

  // date → (units marked that date, students marked absent that date)
  const byDate = new Map<string, { units: Set<string>; absent: Set<string> }>();
  for (const d of days) {
    let e = byDate.get(d.dateKey);
    if (!e) {
      e = { units: new Set(), absent: new Set() };
      byDate.set(d.dateKey, e);
    }
    const u = d.subjectGroupId
      ? unitKey({ unitType: "subjectgroup", unitId: d.subjectGroupId.toString() })
      : d.sectionId
        ? unitKey({ unitType: "section", unitId: d.sectionId.toString() })
        : null;
    if (u) e.units.add(u);
    for (const sid of d.absentStudentIds ?? []) e.absent.add(sid.toString());
  }

  // The two date-independent inputs to unit resolution.
  const studentIds = students.map((s) => s._id.toString());
  const quranGroup = await quranGroupByStudent(studentIds);
  const classIds = [...new Set(students.map((s) => s.classId.toString()))];
  const classes = await Class.find({ _id: { $in: classIds } }).select("nameBn level").lean();
  const levelOf = new Map(classes.map((c) => [c._id.toString(), c.level]));
  const classNameOf = new Map(
    classes.map((c) => [c._id.toString(), (c as { nameBn?: string }).nameBn ?? String(c.level)]),
  );
  const sections = await Section.find({ _id: { $in: [...new Set(students.map((s) => s.sectionId.toString()))] } })
    .select("code nameBn")
    .lean();
  const sectionNameOf = new Map(
    sections.map((s) => [s._id.toString(), (s as { nameBn?: string; code?: string }).nameBn ?? s.code ?? ""]),
  );

  const dates = [...byDate.keys()].sort();
  const measuredUnits = new Set<string>();
  const rows = students.flatMap((s) => {
    const id = s._id.toString();
    const sectionId = s.sectionId.toString();
    const level = levelOf.get(s.classId.toString()) ?? 0;
    const group = quranGroup.get(id);
    const groupKey = group ? unitKey({ unitType: "subjectgroup", unitId: group }) : null;
    const sectionKey = unitKey({ unitType: "section", unitId: sectionId });

    let held = 0;
    let absent = 0;
    for (const date of dates) {
      const e = byDate.get(date)!;
      // The D-#292 legacy shape: before the cutover EVERYONE was section-captured.
      const myUnit =
        isLegacyAttendanceDate(date) || isNurseryKg(level) || !groupKey ? sectionKey : groupKey;
      if (!e.units.has(myUnit)) continue; // their unit did not mark that day
      held += 1;
      measuredUnits.add(myUnit);
      if (e.absent.has(id)) absent += 1;
    }
    if (held === 0) return [];
    const cls = classNameOf.get(s.classId.toString());
    const sec = sectionNameOf.get(sectionId) ?? "";
    return [{
      id,
      name: (s as { nameBn?: string }).nameBn || s.name,
      unitLabel: cls ? `${cls} · ${sec}` : sec,
      classLabel: cls,
      classLevel: level,
      heldDays: held,
      absentDays: absent,
      presentPct: pct(held, absent),
      belowFloor: held < MIN_HELD_DAYS,
    }];
  });

  return {
    fromKey,
    toKey,
    rows: rankRows(rows),
    unitCount: measuredUnits.size,
    lastMarkedKey: await lastMarked(false),
  };
}

/**
 * Rank students over a window on one axis. Present % of held days; every enrolled
 * student appears, including those with zero absences (that is the point of a
 * ranking, and absent-only capture means they are otherwise invisible in the rows).
 *
 * Two paths, because the two questions are different:
 *   school | class | section → per-student unit resolution (see above)
 *   group  | track | level   → the Quran/Arabic register read directly, which is the
 *                              owner's explicit "Quran-group wise" analysis
 */
export async function rankStudents(input: {
  window: RankWindow;
  anchorKey: string;
  axis: StudentRankAxis;
  axisValue?: string;
  academicYearId?: string;
  sortBy?: StudentRankSort;
}): Promise<RankResult> {
  // Ranking and ordering are separate steps on purpose: the ranked set is computed once,
  // identically for both sorts, and only the delivery order differs (D-#512). Applied here
  // rather than inside each path so neither path can forget it — both have early returns.
  const result = await rankStudentsRanked(input);
  return { ...result, rows: sortRows(result.rows, input.sortBy ?? "rank") };
}

async function rankStudentsRanked(input: {
  window: RankWindow;
  anchorKey: string;
  axis: StudentRankAxis;
  axisValue?: string;
  academicYearId?: string;
}): Promise<RankResult> {
  const { fromKey, toKey } = await resolveWindow(input.window, input.anchorKey, input.academicYearId);
  if (input.axis === "school" || input.axis === "class" || input.axis === "section") {
    return rankStudentsByUnit(fromKey, toKey, input.axis, input.axisValue);
  }
  const { byGroup, units } = await resolveStudentUnits(input.axis, input.axisValue);
  const unitIds = units.map((u) => u.id);
  const labelOf = new Map(units.map((u) => [u.id, u.label]));
  if (unitIds.length === 0)
    return { fromKey, toKey, rows: [], unitCount: 0, lastMarkedKey: await lastMarked(byGroup) };

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
  if (measured.length === 0)
    return { fromKey, toKey, rows: [], unitCount: 0, lastMarkedKey: await lastMarked(byGroup) };

  // Roster per measured unit → student's unit membership.
  const unitOfStudent = new Map<string, string>();
  let students: {
    _id: { toString(): string };
    name: string;
    nameBn?: string;
    classId?: { toString(): string };
  }[] = [];
  if (byGroup) {
    const memberships = await SubjectGroupMembership.find({ groupId: { $in: measured } })
      .select("groupId studentId")
      .lean();
    for (const m of memberships) unitOfStudent.set(m.studentId.toString(), m.groupId.toString());
    students = await Student.find({ _id: { $in: [...unitOfStudent.keys()] }, active: true })
      .select("name nameBn classId")
      .lean();
  } else {
    students = await Student.find({ sectionId: { $in: measured }, active: true })
      .select("name nameBn sectionId classId")
      .lean();
    for (const s of students as unknown as { _id: { toString(): string }; sectionId: { toString(): string } }[]) {
      unitOfStudent.set(s._id.toString(), s.sectionId.toString());
    }
  }

  // The general class per student. On the group axes this is the ONLY class signal on
  // the row — the group is cross-grade, so `unitLabel` cannot carry it.
  const classOf = await classLabelByStudent(students);

  const rows = students.flatMap((s) => {
    const id = s._id.toString();
    const unitId = unitOfStudent.get(id);
    const h = unitId ? held.get(unitId) ?? 0 : 0;
    if (!unitId || h === 0) return []; // unit held no day in the window — nothing to rank on
    const a = absences.get(id) ?? 0;
    const cls = classOf.get(id);
    return [{
      id,
      name: s.nameBn || s.name,
      unitLabel: labelOf.get(unitId) ?? "—",
      classLabel: cls?.label,
      classLevel: cls?.level,
      heldDays: h,
      absentDays: a,
      presentPct: pct(h, a),
      belowFloor: h < MIN_HELD_DAYS,
    }];
  });

  return {
    fromKey,
    toKey,
    rows: rankRows(rows),
    unitCount: measured.length,
    lastMarkedKey: await lastMarked(byGroup),
  };
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
  if (days.length === 0)
    return { fromKey, toKey, rows: [], unitCount: 0, lastMarkedKey: await lastMarked("staff") };

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

  return {
    fromKey,
    toKey,
    rows: rankRows(rows),
    unitCount: rows.length,
    lastMarkedKey: await lastMarked("staff"),
  };
}

// ---------------------------------------------------------------------------
// Per-group breakdown (AR-4, D-#514)
// ---------------------------------------------------------------------------

/** One group's card: the group, its denominator, and its own ranked list. */
export interface GroupRankBlock {
  groupId: string;
  code: string;
  nameBn: string;
  level: string;
  gender: string;
  /** Active members on the roster — NOT the number of ranked rows. The two differ
   *  whenever the group held no day in the window, and the gap is worth seeing. */
  memberCount: number;
  /** Days THIS group marked in the window. Its own denominator; groups in the same
   *  breakdown routinely differ (Hifz 1 started marking a month after Ammapara). */
  heldDays: number;
  rows: RankRow[];
}

export interface GroupRankBreakdown {
  fromKey: string;
  toKey: string;
  lastMarkedKey: string | null;
  /** EVERY active group of the track, including ones that marked nothing — an absent
   *  card would read as "this group does not exist" rather than "nobody marked it". */
  groups: GroupRankBlock[];
  groupsMeasured: number;
  studentsRanked: number;
  maxHeldDays: number;
  perfectCount: number;
}

type BreakdownStudent = {
  _id: { toString(): string };
  name: string;
  nameBn?: string;
  classId?: { toString(): string };
};

/**
 * Rank EVERY group of one track side by side, each against its own denominator.
 *
 * The existing `rankStudents({axis:"track"})` pools every Quran student into ONE list
 * with one shared ranking — useful for "who attends best school-wide", useless for
 * "how is each group doing", because a group that held 4 days and a group that held 28
 * are ranked against each other on incomparable denominators.
 *
 * Deliberately ONE set of queries for all groups, not a loop of `rankStudents` per
 * group: a per-group fan-out is the exact pattern D-#476 removed from the guardian
 * screen, and with 8 Quran groups it would mean ~40 round trips per screen open.
 *
 * A student belongs to at most one group per track (the unique `(studentId, track)`
 * index behind D-#48), so absences can be tallied per STUDENT without ambiguity about
 * which group's day the absence belongs to.
 */
export async function rankStudentsByGroupBreakdown(input: {
  window: RankWindow;
  anchorKey: string;
  track: "quran" | "arabic";
  sortBy?: StudentRankSort;
  academicYearId?: string;
}): Promise<GroupRankBreakdown> {
  const { fromKey, toKey } = await resolveWindow(input.window, input.anchorKey, input.academicYearId);
  const empty = {
    fromKey,
    toKey,
    groups: [],
    groupsMeasured: 0,
    studentsRanked: 0,
    maxHeldDays: 0,
    perfectCount: 0,
  };

  // Ordered in JS, not Mongo: `level` is a free string ("Qaida", "Hifz 1", "Book 2"),
  // so a Mongo sort on it is alphabetical too — this just keeps the ordering visible
  // next to the code that depends on it.
  const groups = (await SubjectGroup.find({ track: input.track, active: true })
    .select("nameBn code level gender")
    .lean()).sort(
      (a, b) => String(a.level).localeCompare(String(b.level)) || String(a.gender).localeCompare(String(b.gender)),
    );
  if (groups.length === 0) return { ...empty, lastMarkedKey: await lastMarked(true) };

  const groupIds = groups.map((g) => g._id.toString());
  const days = await StudentAttendanceDay.find({
    dateKey: { $gte: fromKey, $lte: toKey },
    subjectGroupId: { $in: groupIds },
  })
    .select("subjectGroupId absentStudentIds")
    .lean();

  // heldDays PER GROUP (each keeps its own denominator) + absences per student.
  const held = new Map<string, number>();
  const absences = new Map<string, number>();
  for (const d of days) {
    const gid = d.subjectGroupId?.toString();
    if (!gid) continue;
    held.set(gid, (held.get(gid) ?? 0) + 1);
    for (const sid of d.absentStudentIds ?? []) {
      const k = sid.toString();
      absences.set(k, (absences.get(k) ?? 0) + 1);
    }
  }

  const memberships = await SubjectGroupMembership.find({ groupId: { $in: groupIds } })
    .select("groupId studentId")
    .lean();
  const groupOfStudent = new Map<string, string>();
  for (const m of memberships) groupOfStudent.set(m.studentId.toString(), m.groupId.toString());

  const students = (await Student.find({
    _id: { $in: [...groupOfStudent.keys()] },
    active: true,
  })
    .select("name nameBn classId")
    .lean()) as unknown as BreakdownStudent[];
  const classOf = await classLabelByStudent(students);

  const membersByGroup = new Map<string, BreakdownStudent[]>();
  for (const s of students) {
    const gid = groupOfStudent.get(s._id.toString());
    if (!gid) continue;
    const arr = membersByGroup.get(gid);
    if (arr) arr.push(s);
    else membersByGroup.set(gid, [s]);
  }

  const sortBy = input.sortBy ?? "rank";
  const blocks: GroupRankBlock[] = groups.map((g) => {
    const gid = g._id.toString();
    const h = held.get(gid) ?? 0;
    const members = membersByGroup.get(gid) ?? [];
    const nameBn = (g as { nameBn?: string }).nameBn ?? g.code;
    // h === 0: the group held no day in this window, so there is nothing to rank on.
    // The card still ships, saying so, rather than the group vanishing.
    const rows = h === 0
      ? []
      : rankRows(
          members.map((s) => {
            const id = s._id.toString();
            const a = absences.get(id) ?? 0;
            const cls = classOf.get(id);
            return {
              id,
              name: s.nameBn || s.name,
              unitLabel: nameBn,
              classLabel: cls?.label,
              classLevel: cls?.level,
              heldDays: h,
              absentDays: a,
              presentPct: pct(h, a),
              belowFloor: h < MIN_HELD_DAYS,
            };
          }),
        );
    return {
      groupId: gid,
      code: g.code,
      nameBn,
      level: g.level,
      gender: g.gender,
      memberCount: members.length,
      heldDays: h,
      rows: sortRows(rows, sortBy),
    };
  });

  const measured = blocks.filter((b) => b.rows.length > 0);
  return {
    fromKey,
    toKey,
    lastMarkedKey: await lastMarked(true),
    groups: blocks,
    groupsMeasured: measured.length,
    studentsRanked: measured.reduce((n, b) => n + b.rows.length, 0),
    maxHeldDays: measured.reduce((n, b) => Math.max(n, b.heldDays), 0),
    perfectCount: measured.reduce(
      (n, b) => n + b.rows.filter((r) => r.presentPct === 100).length,
      0,
    ),
  };
}
