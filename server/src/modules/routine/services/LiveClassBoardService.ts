/**
 * LiveClassBoardService — "who is standing in front of each class right now?"
 *
 * The Principal/Office ask (2026-09-15): the Today screen must show the CURRENTLY
 * RUNNING period class by class with the teacher's name — the cover teacher's name
 * when a cover is APPROVED, and a loud alert when the class is running with nobody
 * in front of it — refreshing as the day moves from period to period; plus the same
 * thing for the whole day (class × period) as a board, for the management decisions
 * that are not about this minute.
 *
 * It composes seams that already exist and invents no new stored state:
 *   RoutineSlot + liveWindow   — the day's effective slots (the routine is the truth
 *                                about who SHOULD teach; D-#47(3) effective-dating)
 *   RoutineSubstitution        — the routine-module direct-assign cover (R-4): an
 *                                admin action, so it is approved by construction
 *   StaffCoverSlot             — the HR leave fan-out (PXG-1/D-#268): one row per
 *                                class meeting, `approved` ONLY after Principal/Office
 *                                decide. `needs_cover`/`proposed` is exactly the
 *                                owner's "not proxy approved" case → UNCOVERED
 *   StaffLeaveApplication      — an approved leave with no fan-out row still means
 *                                the teacher is out (period-scoped for partial days)
 *   TeacherAttendanceDay       — the biometric sheet (AT-1): a staff member marked
 *                                ABSENT for the date whom nobody filed leave for.
 *                                Silent when the day's sheet has not been imported
 *                                yet, which is the normal mid-morning state.
 *
 * Clock times are DATE-AWARE, unlike the weekly `slotView` enrichment: the board
 * resolves the ScheduleWindow covering the date, so a winter 07:15/07:30 start slides
 * the whole board (D-#55). `slotView`'s regular-season times are right for the weekly
 * grid and would put the live marker on the wrong period in winter.
 *
 * The server's `phase`/`*Now` counts are computed from the SERVER clock; the app
 * re-derives phase from the DEVICE clock on its own minute tick (the TodayScreen
 * `slotPhase` precedent) so the card keeps ticking between fetches. Both read the
 * same `startTime`/`endTime` strings, so they cannot disagree about the grid itself.
 *
 * Identity/operational plane (ADR-005) — teacher names on an operational read, NO
 * corpus path, no student identity at all.
 */
import { Types } from "mongoose";
import { DAYS_OF_WEEK, type PeriodTrack } from "@scd/shared";
import { RoutineSlot, type IRoutineSlot } from "../models/RoutineSlot";
import { RoutineSubstitution } from "../models/RoutineSubstitution";
import { PeriodGrid, type IPeriodGrid } from "../models/PeriodGrid";
import { ScheduleWindow, type IScheduleWindow } from "../models/ScheduleWindow";
import { SubjectGroup } from "../models/SubjectGroup";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { normalizePhone } from "../../foundation/services/credentials";
import { StaffCoverSlot } from "../../hr/models/StaffCoverSlot";
import { userIdsOnLeave } from "../../hr/services/CoverService";
import { TeacherAttendanceDay } from "../../attendance/models/TeacherAttendanceDay";
import { parseDateKey } from "../../attendance/dates";
import { resolveDayType, dayTypeAdmitsTrack } from "../calendar";
import { computePeriodTimes, minutesToHHMM, windowFor } from "../schedule";
import { liveWindow } from "../liveWindow";

/** Why the substantive teacher is not taking this period. */
export type AbsenceReason = "leave" | "leave_pending" | "attendance_absent" | null;

/**
 * ON_DUTY    — the routine's own teacher takes it (nothing says otherwise)
 * COVERED    — an APPROVED cover teacher takes it (proxy name shown)
 * UNCOVERED  — the teacher is out and no cover is approved  ← the alert
 * UNASSIGNED — the routine slot names no teacher at all (an authoring gap)
 */
export type LiveCellStatus = "ON_DUTY" | "COVERED" | "UNCOVERED" | "UNASSIGNED";

export type LiveCellPhase = "past" | "current" | "upcoming";

export interface LiveClassCell {
  slotId: string;
  groupType: string;
  groupId: string;
  groupName: string | null;
  classLevel: number | null;
  periodNumber: number;
  startTime: string | null;
  endTime: string | null;
  subject: string;
  track: string;
  /** The routine's substantive teacher — named even when someone else covers. */
  teacherId: string | null;
  teacherName: string | null;
  /** The APPROVED cover teacher, when there is one. */
  coverTeacherId: string | null;
  coverTeacherName: string | null;
  /** A cover PROPOSED but not yet approved — shown with the alert, never instead of it. */
  pendingCoverTeacherName: string | null;
  /** The HR cover slot's own status (`needs_cover` | `proposed`), when one exists. */
  coverSlotStatus: string | null;
  absenceReason: AbsenceReason;
  status: LiveCellStatus;
  phase: LiveCellPhase;
}

export interface LiveBoardPeriod {
  periodNumber: number;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  phase: LiveCellPhase;
}

export interface LiveBoardRow {
  groupType: string;
  groupId: string;
  label: string;
  sublabel: string | null;
  classLevel: number | null;
}

export interface LiveClassBoard {
  date: string;
  dayType: string;
  season: string;
  dayStartHHMM: string;
  /** The server clock at read time, "HH:MM" — the app shows its own, this is the audit. */
  nowHHMM: string;
  periods: LiveBoardPeriod[];
  rows: LiveBoardRow[];
  cells: LiveClassCell[];
  /** Cells running right now (server clock). */
  liveCount: number;
  /** Of those, how many have nobody in front of them. */
  uncoveredNowCount: number;
  /** Uncovered cells across the WHOLE day — what the day still needs fixing. */
  uncoveredTodayCount: number;
}

const WHOLE_CLASS_SECTIONS = ["মূল", "সম্মিলিত"];

/** The period grid a group reads: Nursery/KG (level ≤ 0) has its own (D-#57). */
const audienceForLevel = (level: number | null | undefined): string =>
  level != null && level <= 0 ? "nursery_kg" : "class_1_5";

const hhmmNow = (now: Date): string =>
  `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

/** Zero-padded "HH:MM" strings compare lexicographically — the TodayScreen rule. */
function phaseOf(start: string | null, end: string | null, nowHM: string): LiveCellPhase {
  if (!start || !end) return "upcoming";
  if (end <= nowHM) return "past";
  if (start <= nowHM) return "current";
  return "upcoming";
}

const emptyBoard = (
  date: string,
  dayType: string,
  season: string,
  dayStartHHMM: string,
  nowHHMM: string,
): LiveClassBoard => ({
  date,
  dayType,
  season,
  dayStartHHMM,
  nowHHMM,
  periods: [],
  rows: [],
  cells: [],
  liveCount: 0,
  uncoveredNowCount: 0,
  uncoveredTodayCount: 0,
});

/**
 * User ids of staff the biometric sheet marks ABSENT on `dateKey` (AT-1, D-#63).
 *
 * Only ABSENT counts: LEAVE is already the leave path, and LATE means they arrived.
 * Empty — and therefore silent — until that day's sheet is imported, which is the
 * normal state while the day is still running. The User↔StaffProfile join is
 * phone-only (staffMatch), batched here into one query rather than per row.
 */
async function biometricAbsentUserIds(dateKey: string): Promise<Set<string>> {
  const rows = (await TeacherAttendanceDay.find({ dateKey, status: "ABSENT" })
    .select("staffProfileId")
    .lean()) as unknown as Array<{ staffProfileId: Types.ObjectId }>;
  if (rows.length === 0) return new Set();
  const staff = (await StaffProfile.find({ _id: { $in: rows.map((r) => r.staffProfileId) } })
    .select("phone")
    .lean()) as unknown as Array<{ phone?: string | null }>;
  const phones = staff.map((s) => (s.phone ? normalizePhone(s.phone) : null)).filter(Boolean) as string[];
  if (phones.length === 0) return new Set();
  const users = (await User.find({ phone: { $in: phones }, active: true })
    .select("_id")
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  return new Set(users.map((u) => u._id.toString()));
}

/**
 * The day's class board (rows = groups, columns = periods), each cell carrying who
 * actually takes it and whether anybody does.
 *
 * `now` is injectable so the phase/counts are testable without waiting for a period.
 */
export async function liveClassBoard(dateStr: string, now: Date = new Date()): Promise<LiveClassBoard> {
  const dateKey = dateStr.slice(0, 10);
  const date = parseDateKey(dateKey);
  const nowHM = hhmmNow(now);

  // 1. The day itself: type + the window that sets the season and the day-start.
  const [dayType, windows] = await Promise.all([
    resolveDayType(date),
    ScheduleWindow.find({ active: true }).lean() as unknown as Promise<IScheduleWindow[]>,
  ]);
  const win = windowFor(date, windows);
  const season = win ? win.season : "regular";
  const dayStartMinutes = win ? win.dayStartMinutes : 420;
  const dayStartHHMM = minutesToHHMM(dayStartMinutes);
  if (dayType === "OFF" || dayType === "HOLIDAY") {
    return emptyBoard(dateKey, dayType, season, dayStartHHMM, nowHM);
  }

  // 2. Period times per audience, computed from THIS date's day-start (D-#55).
  const grids = (await PeriodGrid.find({ season, active: true }).lean()) as unknown as IPeriodGrid[];
  const timesByAudience = new Map<string, Map<number, { start: string; end: string; isBreak: boolean }>>();
  for (const g of grids) {
    timesByAudience.set(
      g.audienceKey,
      new Map(
        computePeriodTimes(dayStartMinutes, g.periods).map((p) => [
          p.number,
          { start: p.startHHMM, end: p.endHHMM, isBreak: p.isBreak },
        ]),
      ),
    );
  }
  // Columns come from the class_1_5 grid — the superset (8 periods incl. the break);
  // Nursery/KG shares P1–P6 and simply has no P7/P8 (the routineMaster precedent).
  const columnGrid = grids.find((g) => g.audienceKey === "class_1_5") ?? grids[0];
  const periods: LiveBoardPeriod[] = columnGrid
    ? computePeriodTimes(dayStartMinutes, columnGrid.periods).map((p) => ({
        periodNumber: p.number,
        startTime: p.startHHMM,
        endTime: p.endHHMM,
        isBreak: p.isBreak,
        phase: phaseOf(p.startHHMM, p.endHHMM, nowHM),
      }))
    : [];

  // 3. The day's effective teaching slots, day-type filtered (R2.1).
  const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
  const raw = (await RoutineSlot.find({
    dayOfWeek,
    active: true,
    isBreak: false,
    ...liveWindow(date),
  })
    .sort({ periodNumber: 1 })
    .lean()) as unknown as IRoutineSlot[];
  const slots = raw.filter((s) => dayTypeAdmitsTrack(dayType, s.track as PeriodTrack));
  if (slots.length === 0) return emptyBoard(dateKey, dayType, season, dayStartHHMM, nowHM);

  // 4. Group labels (rows) + class levels, batched.
  const sectionIds = new Set<string>();
  const groupIds = new Set<string>();
  const classIds = new Set<string>();
  for (const s of slots) {
    if (s.groupType === "section") {
      sectionIds.add(s.groupId.toString());
      if (s.classId) classIds.add(s.classId.toString());
    } else {
      groupIds.add(s.groupId.toString());
    }
  }
  const [sections, classes, subjectGroups] = await Promise.all([
    Section.find({ _id: { $in: [...sectionIds] } }).select("nameBn classId").lean(),
    Class.find({ _id: { $in: [...classIds] } }).select("nameBn level").lean(),
    SubjectGroup.find({ _id: { $in: [...groupIds] } }).select("nameBn track").lean(),
  ]);
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
  const groupById = new Map(subjectGroups.map((g) => [g._id.toString(), g]));

  const trackOrder: Record<string, number> = { quran: 1, arabic: 2 };
  const ordered = [
    ...sections.map((sec) => {
      const cls = classById.get(sec.classId.toString());
      const sublabel = cls && WHOLE_CLASS_SECTIONS.includes(sec.nameBn) ? null : sec.nameBn;
      return {
        sortKey: (cls?.level ?? 0) * 10,
        row: {
          groupType: "section",
          groupId: sec._id.toString(),
          label: cls?.nameBn ?? sec.nameBn,
          sublabel,
          classLevel: cls?.level ?? null,
        } as LiveBoardRow,
      };
    }),
    ...subjectGroups.map((g) => ({
      sortKey: 1000 + (trackOrder[g.track] ?? 9) * 100,
      row: {
        groupType: "subjectgroup",
        groupId: g._id.toString(),
        label: g.nameBn,
        sublabel: null,
        classLevel: null,
      } as LiveBoardRow,
    })),
  ].sort((a, b) => a.sortKey - b.sortKey || a.row.label.localeCompare(b.row.label));
  const rows = ordered.map((o) => o.row);
  const rowByGroupId = new Map(rows.map((r) => [r.groupId, r]));

  // 5. Who covers what today — the two cover mechanisms + the two absence sources.
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const slotIds = slots.map((s) => s._id);
  const [subs, hrCovers, absentBiometric] = await Promise.all([
    RoutineSubstitution.find({ slotId: { $in: slotIds }, active: true, date: { $gte: dayStart, $lte: dayEnd } })
      .select("slotId coverTeacherId")
      .lean(),
    StaffCoverSlot.find({ routineSlotId: { $in: slotIds }, dateKey })
      .select("routineSlotId status finalCoverTeacherUserId proposedCoverTeacherId")
      .lean(),
    biometricAbsentUserIds(dateKey),
  ]);
  const subBySlot = new Map(subs.map((s) => [s.slotId.toString(), s.coverTeacherId.toString()]));
  // One HR row per (slot, date) by the fan-out's own guard; a later row wins only if
  // it is the approved one, so approvals are never masked by a stale needs_cover row.
  const hrBySlot = new Map<string, (typeof hrCovers)[number]>();
  for (const c of hrCovers) {
    const key = c.routineSlotId.toString();
    const prev = hrBySlot.get(key);
    if (!prev || (prev.status !== "approved" && c.status === "approved")) hrBySlot.set(key, c);
  }

  // Approved leave ONLY: an `applied` leave means the teacher is still expected, and
  // its fan-out row already flags the meeting as needing cover (the branch below).
  // Period-scoped, so a partial-day leave only marks the periods it actually covers.
  const onLeaveByPeriod = new Map<number, Set<string>>();
  for (const p of new Set(slots.map((s) => s.periodNumber))) {
    onLeaveByPeriod.set(p, await userIdsOnLeave(dateKey, p, ["approved"]));
  }

  // 6. Names for every teacher who can appear in a cell.
  const userIds = new Set<string>();
  for (const s of slots) if (s.teacherId) userIds.add(s.teacherId.toString());
  for (const id of subBySlot.values()) userIds.add(id);
  for (const c of hrCovers) {
    if (c.finalCoverTeacherUserId) userIds.add(c.finalCoverTeacherUserId.toString());
    if (c.proposedCoverTeacherId) userIds.add(c.proposedCoverTeacherId.toString());
  }
  const users = await User.find({ _id: { $in: [...userIds] } }).select("name").lean();
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));

  // 7. The cells.
  const cells: LiveClassCell[] = slots.map((s) => {
    const row = rowByGroupId.get(s.groupId.toString());
    const classLevel = row?.classLevel ?? null;
    const times = timesByAudience.get(audienceForLevel(classLevel))?.get(s.periodNumber);
    const start = times?.start ?? null;
    const end = times?.end ?? null;
    const teacherId = s.teacherId ? s.teacherId.toString() : null;

    const directCover = subBySlot.get(s._id.toString()) ?? null;
    const hr = hrBySlot.get(s._id.toString()) ?? null;
    const hrApproved = hr && hr.status === "approved" && hr.finalCoverTeacherUserId
      ? hr.finalCoverTeacherUserId.toString()
      : null;
    const coverTeacherId = directCover ?? hrApproved;

    let status: LiveCellStatus;
    let absenceReason: AbsenceReason = null;
    let pendingCoverTeacherName: string | null = null;
    if (!teacherId) {
      status = "UNASSIGNED";
    } else if (coverTeacherId) {
      status = "COVERED";
      absenceReason = hr ? "leave" : null;
    } else if (hr) {
      // A fan-out row exists and is NOT approved — the owner's "proxy not approved"
      // case. `proposed` still shows WHO was put forward, so the admin can approve
      // from the alert instead of starting the search again.
      status = "UNCOVERED";
      absenceReason = hr.status === "proposed" ? "leave_pending" : "leave";
      pendingCoverTeacherName = hr.proposedCoverTeacherId
        ? nameById.get(hr.proposedCoverTeacherId.toString()) ?? null
        : null;
    } else if (onLeaveByPeriod.get(s.periodNumber)?.has(teacherId)) {
      status = "UNCOVERED";
      absenceReason = "leave";
    } else if (absentBiometric.has(teacherId)) {
      status = "UNCOVERED";
      absenceReason = "attendance_absent";
    } else {
      status = "ON_DUTY";
    }

    return {
      slotId: s._id.toString(),
      groupType: s.groupType,
      groupId: s.groupId.toString(),
      groupName: row ? (row.sublabel ? `${row.label} · ${row.sublabel}` : row.label) : null,
      classLevel,
      periodNumber: s.periodNumber,
      startTime: start,
      endTime: end,
      subject: s.subject,
      track: s.track,
      teacherId,
      teacherName: teacherId ? nameById.get(teacherId) ?? null : null,
      coverTeacherId,
      coverTeacherName: coverTeacherId ? nameById.get(coverTeacherId) ?? null : null,
      pendingCoverTeacherName,
      coverSlotStatus: hr && hr.status !== "approved" ? hr.status : null,
      absenceReason,
      status,
      phase: phaseOf(start, end, nowHM),
    };
  });

  cells.sort((a, b) => a.periodNumber - b.periodNumber || (a.groupName ?? "").localeCompare(b.groupName ?? ""));

  const live = cells.filter((c) => c.phase === "current");
  return {
    date: dateKey,
    dayType,
    season,
    dayStartHHMM,
    nowHHMM: nowHM,
    periods,
    rows,
    cells,
    liveCount: live.length,
    uncoveredNowCount: live.filter((c) => c.status === "UNCOVERED" || c.status === "UNASSIGNED").length,
    uncoveredTodayCount: cells.filter((c) => c.status === "UNCOVERED" || c.status === "UNASSIGNED").length,
  };
}
