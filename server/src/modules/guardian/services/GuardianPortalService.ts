/**
 * GuardianPortalService — the guardian read layer (GP-1, D-#68).
 *
 * Every function here serves a guardian-scoped query, AFTER the resolver has
 * passed `assertGuardianOfStudent` (link-scoped row authz, middleware/authz.ts).
 * Reads are operational/identity-plane ONLY (Student/Section/Class/SubjectGroup/
 * RoutineSlot/ClassNote/HomeworkItem/HomeworkStudentRecord) — this module NEVER
 * imports the corpus plane (ADR-005; the firewall test asserts it).
 *
 * D-#69 (no staffing/location detail): the guardian slot shape carries ONLY
 * subject + period + computed clock times. It is built FRESH here (never a
 * spread of a staff slot), so teacherId/roomId/cover can never leak. Slots come
 * from `slotsForDate` (no `RoutineSubstitution` read at all).
 */
import {
  DAY_TYPE_LABELS_BN,
  ROSTER_CLASS_LABELS_BN,
  ROUTINE_SUBJECT_LABELS_BN,
  HW_SUBJECT_LABELS_BN,
  LIFECYCLE_STATE_LABELS_BN,
  HW_RESULT_LABELS_BN,
  type DayType,
  type RosterClassLevel,
  type RoutineSubject,
  type HwSubject,
  type LifecycleState,
  type HwResult,
} from "@scd/shared";
import { StoredFile } from "../../platform/models/StoredFile";
import { parseDateKey } from "../../attendance/dates";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Student, type IStudent } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { SubjectGroup, type ISubjectGroup } from "../../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { HolidayException } from "../../routine/models/HolidayException";
import { ScheduleWindow, type IScheduleWindow } from "../../routine/models/ScheduleWindow";
import { PeriodGrid, type IPeriodGrid } from "../../routine/models/PeriodGrid";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { dayTypeFor } from "../../routine/calendar";
import { computePeriodTimes, windowFor } from "../../routine/schedule";
import { slotsForDate } from "../../routine/services/RoutineSlotService";
import { classNotesForDate } from "../../routine/services/RoutineTriggerService";
import {
  studentAttendanceHistory,
  type StudentHistory,
} from "../../attendance/services/AttendanceReportService";
import {
  leaveApplicationsForStudent,
  submitLeaveApplication,
} from "../../attendance/services/LeaveApplicationService";
import { HomeworkItem, type IHomeworkItem } from "../../trackers/models/HomeworkItem";
import { HomeworkNilDeclaration } from "../../trackers/models/HomeworkNilDeclaration";
import { HomeworkStudentRecord } from "../../trackers/models/HomeworkStudentRecord";
import {
  getStudentDayLoad,
  type StudentDayLoadResult,
} from "../../trackers/services/HomeworkResubmissionService";
import { guardianDueFor } from "../../finance/services/FeeSupportService";
import { ForbiddenError } from "../../../middleware/authz";

// ---------------------------------------------------------------------------
// Shapes (narrow by design — built fresh, never spreads of staff documents)
// ---------------------------------------------------------------------------

export interface GuardianChildGroup {
  id: string;
  name: string;
}

export interface GuardianChild {
  studentId: string;
  name: string;
  nameBn: string;
  gender: string | null;
  classLevel: number;
  rosterClassLabel: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string;
  quranGroup: GuardianChildGroup | null;
  arabicGroup: GuardianChildGroup | null;
}

/** D-#69: subject + period + time ONLY. No teacher, no room, no cover — the
 *  fields do not exist on this shape (a guardian client cannot even ask). */
export interface GuardianSlot {
  subject: RoutineSubject;
  subjectLabelBn: string;
  periodNumber: number;
  startHHMM: string | null;
  endHHMM: string | null;
}

export interface GuardianDay {
  dayType: DayType;
  dayTypeLabelBn: string;
  /** Set only when dayType is HOLIDAY (the exception's Bangla name). */
  holidayNameBn: string | null;
  slots: GuardianSlot[];
}

export interface GuardianClassNoteHomework {
  hwId: string;
  subject: HwSubject;
  subjectLabelBn: string;
  qCount: number;
  timeDecl: number;
}

/** A file the teacher attached to the note — the guardian taps to open it. */
export interface GuardianClassNoteAttachment {
  id: string;
  name: string;
  mime: string;
}

export interface GuardianClassNote {
  subject: RoutineSubject;
  subjectLabelBn: string;
  periodNumber: number | null;
  taughtSummaryBn: string;
  homework: GuardianClassNoteHomework | null;
  /** Worksheets/handouts the teacher attached (guardian-readable follow-up). */
  attachments: GuardianClassNoteAttachment[];
}

export interface GuardianHomeworkRecord {
  recordId: string;
  hwId: string;
  subject: HwSubject;
  subjectLabelBn: string;
  dateGiven: string;
  state: LifecycleState;
  stateLabelBn: string;
  givenAt: string | null;
  dueDate: string | null;
  submittedAt: string | null;
  checkedAt: string | null;
  returnedAt: string | null;
  chaseCount: number;
  result: HwResult | null;
  resultLabelBn: string | null;
  /** What was assigned (mandatory since D-#317; null on legacy rows). */
  description: string | null;
  /** Declared question count + estimated minutes — lets the lesson history show the day's load. */
  qCount: number;
  timeDecl: number;
  /** Set on a resubmission record — the prior record it re-issues (D-#43). */
  resubOf: string | null;
  topupFlag: boolean;
  topupQCount: number;
  topupTimeMin: number | null;
  /** StoredFile ids — populated by GP-A; null when no file is attached. */
  questionFileId: string | null;
  answerFileId: string | null;
  /** Declare-form multi-attachments on the item (≤5) — empty when none. */
  attachmentIds: string[];
}

export interface GuardianAttendanceDay {
  dateKey: string;
  absent: boolean;
  leaveCovered: boolean;
}

export interface GuardianAttendanceHistory {
  studentId: string;
  sectionId: string;
  days: GuardianAttendanceDay[];
  markedDays: number;
  absentDays: number;
  presentPct: number;
}

export interface GuardianFeeDue {
  studentId: string;
  studentName: string;
  guardianDue: number;
}

export interface GuardianLeaveApplication {
  id: string;
  studentId: string;
  fromKey: string;
  toKey: string;
  reason: string;
  submittedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dayBounds(date: Date): { start: Date; end: Date } {
  const s = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const e = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return { start: s, end: e };
}

/** The active HolidayException covering a date, if any (single calendar source —
 *  same query shape as routine/calendar.resolveDayType, but the doc is needed
 *  here for its Bangla name). */
async function activeHolidayFor(date: Date) {
  const { start, end } = dayBounds(date);
  return HolidayException.findOne({
    active: true,
    fromDate: { $lte: end },
    toDate: { $gte: start },
  }).lean();
}

async function requireStudent(studentId: string): Promise<IStudent> {
  const student = (await Student.findById(studentId).lean()) as unknown as IStudent | null;
  if (!student) throw new Error("Student not found");
  return student;
}

/** The student's Quran/Arabic groups (≤1 per track, R1.4). */
async function groupsOf(studentId: string): Promise<ISubjectGroup[]> {
  const memberships = await SubjectGroupMembership.find({ studentId }).lean();
  if (memberships.length === 0) return [];
  const ids = memberships.map((m) => m.groupId);
  return SubjectGroup.find({ _id: { $in: ids }, active: true }).lean() as unknown as Promise<
    ISubjectGroup[]
  >;
}

/** Period clock times for the child's audience grid on a date (D-#55/#58):
 *  window → season + day-start, grid by (classLevels ∋ level, season), then
 *  computePeriodTimes. Returns a periodNumber → {startHHMM,endHHMM} map (empty
 *  when no grid exists — slots then render without times, never throw). */
async function periodTimesFor(
  classLevel: number,
  date: Date,
): Promise<Map<number, { startHHMM: string; endHHMM: string }>> {
  const windows = (await ScheduleWindow.find({ active: true }).lean()) as unknown as IScheduleWindow[];
  const win = windowFor(date, windows);
  const season = win ? win.season : "regular";
  const dayStartMinutes = win ? win.dayStartMinutes : 420;
  const grid = (await PeriodGrid.findOne({
    classLevels: classLevel,
    season,
    active: true,
  }).lean()) as unknown as IPeriodGrid | null;
  const map = new Map<number, { startHHMM: string; endHHMM: string }>();
  if (!grid) return map;
  for (const p of computePeriodTimes(dayStartMinutes, grid.periods)) {
    map.set(p.number, { startHHMM: p.startHHMM, endHHMM: p.endHHMM });
  }
  return map;
}

function lastStampAt(
  stateDates: Array<{ state: string; at: Date }>,
  state: string,
): string | null {
  for (let i = stateDates.length - 1; i >= 0; i--) {
    if (stateDates[i].state === state) return new Date(stateDates[i].at).toISOString();
  }
  return null;
}

const idStr = (x: { toString(): string }) => x.toString();

// ---------------------------------------------------------------------------
// myChildren (GP-1 §4.1) — feeds the child switcher (J5.3)
// ---------------------------------------------------------------------------

export async function myChildren(guardianId: string): Promise<GuardianChild[]> {
  const guardian = await Guardian.findById(guardianId).lean();
  if (!guardian || !guardian.active) {
    throw new ForbiddenError("অভিভাবক অ্যাকাউন্টটি সক্রিয় নয়");
  }

  const links = await GuardianLink.find({ guardianId }).lean();
  const activeLinks = links.filter((l) => l.active !== false);
  if (activeLinks.length === 0) return [];

  const studentIds = activeLinks.map((l) => l.studentId);
  const students = (await Student.find({
    _id: { $in: studentIds },
    active: true,
  }).lean()) as unknown as IStudent[];
  if (students.length === 0) return [];

  const sectionIds = [...new Set(students.map((s) => s.sectionId.toString()))];
  const classIds = [...new Set(students.map((s) => s.classId.toString()))];
  const [sections, classes, memberships] = await Promise.all([
    Section.find({ _id: { $in: sectionIds } }).lean(),
    Class.find({ _id: { $in: classIds } }).lean(),
    SubjectGroupMembership.find({ studentId: { $in: studentIds } }).lean(),
  ]);
  const groupIds = [...new Set(memberships.map((m) => m.groupId.toString()))];
  const groups =
    groupIds.length > 0
      ? ((await SubjectGroup.find({ _id: { $in: groupIds }, active: true }).lean()) as unknown as ISubjectGroup[])
      : [];

  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));
  const classById = new Map(classes.map((c) => [c._id.toString(), c]));
  const groupById = new Map(groups.map((g) => [g._id.toString(), g]));
  const groupsByStudent = new Map<string, ISubjectGroup[]>();
  for (const m of memberships) {
    const g = groupById.get(m.groupId.toString());
    if (!g) continue;
    const key = m.studentId.toString();
    const list = groupsByStudent.get(key) ?? [];
    list.push(g);
    groupsByStudent.set(key, list);
  }

  return students.map((s) => {
    const section = sectionById.get(s.sectionId.toString());
    const cls = classById.get(s.classId.toString());
    const myGroups = groupsByStudent.get(s._id.toString()) ?? [];
    const quran = myGroups.find((g) => g.track === "quran") ?? null;
    const arabic = myGroups.find((g) => g.track === "arabic") ?? null;
    return {
      studentId: idStr(s._id),
      name: s.name,
      nameBn: s.nameBn ?? s.name,
      gender: s.gender ?? null,
      classLevel: cls?.level ?? 0,
      rosterClassLabel: cls
        ? ROSTER_CLASS_LABELS_BN[cls.level as RosterClassLevel] ?? String(cls.level)
        : "",
      sectionId: idStr(s.sectionId),
      sectionCode: section ? section.code : "",
      sectionName: section ? section.nameBn : "",
      quranGroup: quran ? { id: idStr(quran._id), name: quran.nameBn } : null,
      arabicGroup: arabic ? { id: idStr(arabic._id), name: arabic.nameBn } : null,
    };
  });
}

// ---------------------------------------------------------------------------
// childRoutine (GP-1 §4.2) — the child's resolved day, NARROW slots (D-#69)
// ---------------------------------------------------------------------------

export async function childRoutine(studentId: string, date: Date): Promise<GuardianDay> {
  const holiday = await activeHolidayFor(date);
  const dayType = dayTypeFor(date, holiday !== null);
  const base: GuardianDay = {
    dayType,
    dayTypeLabelBn: DAY_TYPE_LABELS_BN[dayType],
    holidayNameBn: holiday ? holiday.nameBn : null,
    slots: [],
  };
  // OFF / HOLIDAY: day-type + label, empty slot list (GP-J3 holiday case).
  if (dayType === "OFF" || dayType === "HOLIDAY") return base;

  const student = await requireStudent(studentId);
  const groups = await groupsOf(studentId);

  const slotDocs = [];
  if (dayType === "QURAN_ONLY") {
    // Saturday: Quran-group slots ONLY (D-#50); no Quran group → empty Saturday.
    for (const g of groups.filter((g) => g.track === "quran")) {
      slotDocs.push(...(await slotsForDate("subjectgroup", g._id.toString(), date)));
    }
  } else {
    // FULL: union of the child's Section slots + their SubjectGroup slots.
    slotDocs.push(...(await slotsForDate("section", student.sectionId.toString(), date)));
    for (const g of groups) {
      slotDocs.push(...(await slotsForDate("subjectgroup", g._id.toString(), date)));
    }
  }

  const cls = await Class.findById(student.classId).lean();
  const times = cls ? await periodTimesFor(cls.level, date) : new Map<number, { startHHMM: string; endHHMM: string }>();

  // Build the narrow guardian shape FRESH (D-#69: never spread a staff slot —
  // teacherId/roomId/cover must not even exist as keys).
  const slots: GuardianSlot[] = slotDocs
    .filter((s) => !s.isBreak)
    .map((s) => ({
      subject: s.subject,
      subjectLabelBn: ROUTINE_SUBJECT_LABELS_BN[s.subject] ?? s.subject,
      periodNumber: s.periodNumber,
      startHHMM: times.get(s.periodNumber)?.startHHMM ?? null,
      endHHMM: times.get(s.periodNumber)?.endHHMM ?? null,
    }))
    .sort((a, b) => a.periodNumber - b.periodNumber);

  return { ...base, slots };
}

// ---------------------------------------------------------------------------
// childClassNotes (GP-1 §4.3) — published notes for the child's section + groups
// ---------------------------------------------------------------------------

export async function childClassNotes(studentId: string, date: Date): Promise<GuardianClassNote[]> {
  const student = await requireStudent(studentId);
  const groups = await groupsOf(studentId);

  const notes = [...(await classNotesForDate("section", student.sectionId.toString(), date))];
  for (const g of groups) {
    notes.push(...(await classNotesForDate("subjectgroup", g._id.toString(), date)));
  }
  if (notes.length === 0) return [];

  const slotIds = [...new Set(notes.map((n) => n.slotId.toString()))];
  const slots = await RoutineSlot.find({ _id: { $in: slotIds } }).lean();
  const periodBySlot = new Map(slots.map((s) => [s._id.toString(), s.periodNumber]));

  // Attachment names/mimes in ONE batched load (the admin list uses the same shape).
  const fileIds = [...new Set(notes.flatMap((n) => (n.attachmentIds ?? []).map((a) => a.toString())))];
  const files =
    fileIds.length > 0
      ? await StoredFile.find({ _id: { $in: fileIds } }).select("originalName mime").lean()
      : [];
  const fileById = new Map(files.map((f) => [f._id.toString(), f]));

  const hwIds = [
    ...new Set(notes.filter((n) => n.homeworkItemId).map((n) => n.homeworkItemId!.toString())),
  ];
  const items =
    hwIds.length > 0
      ? ((await HomeworkItem.find({ _id: { $in: hwIds } }).lean()) as unknown as IHomeworkItem[])
      : [];
  const itemById = new Map(items.map((i) => [i._id.toString(), i]));

  return notes.map((n) => {
    const item = n.homeworkItemId ? itemById.get(n.homeworkItemId.toString()) : undefined;
    const subject = n.subject as RoutineSubject;
    return {
      subject,
      subjectLabelBn: ROUTINE_SUBJECT_LABELS_BN[subject] ?? n.subject,
      periodNumber: periodBySlot.get(n.slotId.toString()) ?? null,
      taughtSummaryBn: n.taughtSummaryBn,
      homework: item
        ? {
            hwId: item.hwId,
            subject: item.subject,
            subjectLabelBn: HW_SUBJECT_LABELS_BN[item.subject] ?? item.subject,
            qCount: item.qCount,
            timeDecl: item.timeDecl,
          }
        : null,
      attachments: (n.attachmentIds ?? []).map((a) => {
        const f = fileById.get(a.toString());
        return { id: a.toString(), name: f?.originalName ?? "file", mime: f?.mime ?? "" };
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// childHomework (GP-1 §4.4) — FULL lifecycle, resubmission chain via hwId
// ---------------------------------------------------------------------------

export async function childHomework(
  studentId: string,
  from: Date,
  to: Date,
): Promise<GuardianHomeworkRecord[]> {
  const records = await HomeworkStudentRecord.find({ studentId }).lean();
  if (records.length === 0) return [];

  const itemIds = [...new Set(records.map((r) => r.hwItemId.toString()))];
  const items = (await HomeworkItem.find({
    _id: { $in: itemIds },
  }).lean()) as unknown as IHomeworkItem[];
  const itemById = new Map(items.map((i) => [i._id.toString(), i]));

  const { start } = dayBounds(from);
  const { end } = dayBounds(to);

  const out: GuardianHomeworkRecord[] = [];
  for (const r of records) {
    const item = itemById.get(r.hwItemId.toString());
    if (!item) continue;
    const given = new Date(item.dateGiven);
    if (given < start || given > end) continue;
    out.push({
      recordId: idStr(r._id),
      hwId: r.hwId,
      subject: item.subject,
      subjectLabelBn: HW_SUBJECT_LABELS_BN[item.subject] ?? item.subject,
      dateGiven: given.toISOString(),
      state: r.state,
      stateLabelBn: LIFECYCLE_STATE_LABELS_BN[r.state] ?? r.state,
      givenAt: lastStampAt(r.stateDates, "GIVEN"),
      dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
      submittedAt: lastStampAt(r.stateDates, "SUBMITTED"),
      checkedAt: lastStampAt(r.stateDates, "CHECKED"),
      returnedAt: lastStampAt(r.stateDates, "RETURNED"),
      chaseCount: r.chaseCount,
      result: r.result ?? null,
      resultLabelBn: r.result ? HW_RESULT_LABELS_BN[r.result] ?? null : null,
      description: item.description ?? null,
      qCount: item.qCount,
      timeDecl: item.timeDecl,
      resubOf: r.resubOf ? idStr(r.resubOf) : null,
      topupFlag: r.topupFlag,
      topupQCount: r.topupQids?.length ?? 0,
      topupTimeMin: r.topupTime ?? null,
      // GP-A StoredFile refs — null when no file is attached.
      questionFileId: item.questionFileId ? item.questionFileId.toString() : null,
      answerFileId: r.answerFileId ? r.answerFileId.toString() : null,
      attachmentIds: (item.attachmentIds ?? []).map((id) => id.toString()),
    });
  }

  // Newest day first; inside a day group by HW_ID so a resubmission chain
  // (same hwId, resubOf set) renders adjacent (GP-J5).
  out.sort(
    (a, b) =>
      b.dateGiven.localeCompare(a.dateGiven) ||
      a.hwId.localeCompare(b.hwId) ||
      (a.resubOf ? 1 : 0) - (b.resubOf ? 1 : 0),
  );
  return out;
}

// ---------------------------------------------------------------------------
// childHomeworkNilDays (D-#299) — the class's explicit "no homework today"
// declarations in a range, so a parent sees "deliberately none" instead of
// wondering whether the child is hiding something.
// ---------------------------------------------------------------------------

export interface GuardianHwNilDay {
  dateKey: string;
  subject: string;
  subjectLabelBn: string;
  reason: string;
}

export async function childHomeworkNilDays(
  studentId: string,
  fromKey: string,
  toKey: string,
): Promise<GuardianHwNilDay[]> {
  const student = (await Student.findById(studentId).select("classId").lean()) as {
    classId?: { toString(): string };
  } | null;
  if (!student?.classId) return [];
  const rows = await HomeworkNilDeclaration.find({
    classId: student.classId,
    dateKey: { $gte: fromKey, $lte: toKey },
  }).lean();
  return rows
    .map((r) => ({
      dateKey: r.dateKey,
      subject: r.subject,
      subjectLabelBn: HW_SUBJECT_LABELS_BN[r.subject] ?? r.subject,
      reason: r.reason,
    }))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || a.subject.localeCompare(b.subject));
}

// ---------------------------------------------------------------------------
// childDayLoad (GP-1 §4.4) — base + top-up vs the LOCKED 120 (guardian-gated
// wrapper over getStudentDayLoad; NOT the staff tracker:read query)
// ---------------------------------------------------------------------------

export async function childDayLoad(studentId: string, date: Date): Promise<StudentDayLoadResult> {
  const student = await requireStudent(studentId);
  return getStudentDayLoad(student.classId.toString(), studentId, date);
}

// ---------------------------------------------------------------------------
// Guardian riders for attendance / fees / leave (GP-3+)
// ---------------------------------------------------------------------------

export async function childAttendanceHistory(
  studentId: string,
  fromKey: string,
  toKey: string,
): Promise<GuardianAttendanceHistory> {
  parseDateKey(fromKey);
  parseDateKey(toKey);
  const history = await studentAttendanceHistory(studentId, fromKey, toKey);
  return history;
}

export async function childFeeDue(studentId: string): Promise<GuardianFeeDue> {
  const student = await requireStudent(studentId);
  return {
    studentId,
    studentName: student.nameBn ?? student.name,
    guardianDue: await guardianDueFor(studentId),
  };
}

export async function childLeaveApplications(
  studentId: string,
  fromKey: string,
  toKey: string,
): Promise<GuardianLeaveApplication[]> {
  parseDateKey(fromKey);
  parseDateKey(toKey);
  const rows = await leaveApplicationsForStudent(studentId, fromKey, toKey);
  return rows.map((r) => ({
    id: r._id.toString(),
    studentId: r.studentId.toString(),
    fromKey: r.fromKey,
    toKey: r.toKey,
    reason: r.reason,
    submittedAt: new Date(r.submittedAt).toISOString(),
  }));
}

export async function submitGuardianLeaveApplication(
  studentId: string,
  fromKey: string,
  toKey: string,
  reason: string,
  actorId: string,
): Promise<GuardianLeaveApplication> {
  const app = await submitLeaveApplication(studentId, fromKey, toKey, reason, actorId);
  return {
    id: app._id.toString(),
    studentId: app.studentId.toString(),
    fromKey: app.fromKey,
    toKey: app.toKey,
    reason: app.reason,
    submittedAt: new Date(app.submittedAt).toISOString(),
  };
}
