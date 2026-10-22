/**
 * Lesson-plan progress LP-3 (docs/prd-lesson-progress.md §4, D-#823/#825) — the student link.
 *
 * A child "sat" a session when a `LessonDelivery` naming it holds the child in its roster snapshot
 * (so a section move keeps the old শাখা's lessons and never inherits the new one's past). Presence
 * at that session = the child's DAY attendance on every day it was taught:
 *   PRESENT  present on every teaching day (no day unknown)
 *   PARTIAL  present on some day, and absent or unknown on another
 *   ABSENT   present on none, absent on at least one (`onLeave` when every absence was leave-covered)
 *   UNKNOWN  attendance not taken on any of those days — never assumed present.
 */
import { Types } from "mongoose";
import { callerHasPermission, type AccessProfile } from "@scd/shared";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { studentAttendanceHistory } from "../../attendance/services/AttendanceReportService";
import { applicationCovers } from "../../attendance/services/LeaveApplicationService";
import { StudentAttendanceDay } from "../../attendance/models/StudentAttendanceDay";
import { StudentLeaveApplication } from "../../attendance/models/StudentLeaveApplication";
import { teachesSectionSubject } from "../../trackers/subjectTeacher";
import { LessonDelivery, type ILessonDelivery } from "../models/LessonDelivery";
import { LessonProgressError, sessionKey } from "./LessonDeliveryService";

type Auth = AccessProfile & { userId: string; role: string };

export type Presence = "PRESENT" | "PARTIAL" | "ABSENT" | "UNKNOWN";

export interface StudentSession {
  subject: string;
  key: string;
  chapter: string;
  anchorWord: string;
  sessionIndex: number;
  sessionOf: number;
  titleBn: string;
  /** Every day this session was taught in the child's শাখা while they were on its roster. */
  taughtOn: string[];
  absentOn: string[];
  unknownOn: string[];
  presence: Presence;
  onLeave: boolean;
}

export interface StudentLessons {
  studentId: string;
  subjects: Array<{
    subject: string;
    counts: Record<Presence, number>;
    sessions: StudentSession[];
  }>;
}

type DeliveryLite = Pick<ILessonDelivery, "subject" | "dateKey" | "sessions">;

/** Group deliveries into sessions with their teaching days. Pure. */
export function sessionsTaught(deliveries: DeliveryLite[]): Map<string, Omit<StudentSession, "absentOn" | "unknownOn" | "presence" | "onLeave">> {
  const out = new Map<string, Omit<StudentSession, "absentOn" | "unknownOn" | "presence" | "onLeave">>();
  for (const d of deliveries) {
    for (const s of d.sessions) {
      const key = sessionKey(s.chapter, s.sessionIndex);
      const k = `${d.subject}|${key}`;
      const row = out.get(k) ?? {
        subject: d.subject,
        key,
        chapter: s.chapter,
        anchorWord: s.anchorWord ?? "",
        sessionIndex: s.sessionIndex,
        sessionOf: s.sessionOf,
        titleBn: s.titleBn,
        taughtOn: [],
      };
      if (!row.taughtOn.includes(d.dateKey)) row.taughtOn.push(d.dateKey);
      out.set(k, row);
    }
  }
  for (const r of out.values()) r.taughtOn.sort();
  return out;
}

/** Presence over a session's teaching days from the child's day records. Pure. */
export function presenceOf(
  taughtOn: string[],
  days: Map<string, { absent: boolean; leaveCovered: boolean }>,
): { presence: Presence; absentOn: string[]; unknownOn: string[]; onLeave: boolean } {
  const absentOn = taughtOn.filter((k) => days.get(k)?.absent === true);
  const unknownOn = taughtOn.filter((k) => !days.has(k));
  const presentOn = taughtOn.filter((k) => days.get(k)?.absent === false);
  const presence: Presence =
    presentOn.length === 0 && absentOn.length === 0
      ? "UNKNOWN"
      : presentOn.length === 0
        ? "ABSENT"
        : absentOn.length === 0 && unknownOn.length === 0
          ? "PRESENT"
          : "PARTIAL";
  const onLeave = absentOn.length > 0 && absentOn.every((k) => days.get(k)?.leaveCovered === true);
  return { presence, absentOn, unknownOn, onLeave };
}

/**
 * The child's day record on each teaching day. First from the units the delivery snapshotted
 * (D-#823 — survives a split/move): listed absent on any of them → absent; every unit recorded and
 * not listed → present. Otherwise the child's CURRENT unit history (`studentAttendanceHistory`).
 * A day with neither is left out — `presenceOf` reads it as unknown.
 */
async function dayRecords(
  studentId: string,
  dayKeys: string[],
  deliveries: Array<{ dateKey: string; attendanceUnits?: string[] }>,
): Promise<Map<string, { absent: boolean; leaveCovered: boolean }>> {
  const unitsByDay = new Map<string, Set<string>>();
  for (const d of deliveries) {
    for (const u of d.attendanceUnits ?? []) unitsByDay.set(d.dateKey, (unitsByDay.get(d.dateKey) ?? new Set()).add(u));
  }
  const byUnit = new Map<string, string[]>();
  for (const [day, units] of unitsByDay) for (const u of units) byUnit.set(u, [...(byUnit.get(u) ?? []), day]);
  const or = [...byUnit.entries()].flatMap(([u, ds]) => {
    const [type, id] = u.split(":");
    if (!Types.ObjectId.isValid(id)) return [];
    return [{ [type === "subjectgroup" ? "subjectGroupId" : "sectionId"]: new Types.ObjectId(id), dateKey: { $in: ds } }];
  });
  const recs = or.length
    ? ((await StudentAttendanceDay.find({ $or: or }).select("sectionId subjectGroupId dateKey absentStudentIds").lean()) as unknown as Array<{
        sectionId?: Types.ObjectId;
        subjectGroupId?: Types.ObjectId;
        dateKey: string;
        absentStudentIds: Types.ObjectId[];
      }>)
    : [];
  const from = dayKeys[0];
  const to = dayKeys[dayKeys.length - 1];
  const [history, apps] = await Promise.all([
    studentAttendanceHistory(studentId, from, to),
    StudentLeaveApplication.find({ studentId: new Types.ObjectId(studentId), fromKey: { $lte: to }, toKey: { $gte: from } }).lean(),
  ]);
  const current = new Map(history.days.map((d) => [d.dateKey, { absent: d.absent, leaveCovered: d.leaveCovered }]));
  const out = new Map<string, { absent: boolean; leaveCovered: boolean }>();
  for (const day of dayKeys) {
    const units = unitsByDay.get(day);
    if (units?.size) {
      const recorded = recs.filter((r) => r.dateKey === day && units.has(r.subjectGroupId ? `subjectgroup:${r.subjectGroupId}` : `section:${r.sectionId}`));
      if (recorded.some((r) => r.absentStudentIds.some((x) => String(x) === studentId))) {
        out.set(day, { absent: true, leaveCovered: applicationCovers(apps as never, studentId, day) });
        continue;
      }
      if (recorded.length === units.size) {
        out.set(day, { absent: false, leaveCovered: false });
        continue;
      }
    }
    const c = current.get(day);
    if (c) out.set(day, c);
  }
  return out;
}

const chapterOrder = (a: string, b: string): number => {
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
};

/**
 * The child's lessons (optionally one subject / one chapter). Internal — the gate is the caller's:
 * `studentLessonsFor` for the staff view, the mastery resolvers for the chapter link.
 */
export async function lessonsOfStudent(studentId: string, filter: { subjects?: string[] | null; chapter?: string | null } = {}): Promise<StudentLessons> {
  if (!Types.ObjectId.isValid(studentId)) throw new LessonProgressError("শিক্ষার্থী পাওয়া যায়নি।");
  const q: Record<string, unknown> = { rosterStudentIds: new Types.ObjectId(studentId), "sessions.0": { $exists: true } };
  if (filter.subjects) q.subject = { $in: filter.subjects };
  if (filter.chapter) q["sessions.chapter"] = filter.chapter;
  const deliveries = (await LessonDelivery.find(q).select("subject dateKey sessions attendanceUnits").lean()) as unknown as Array<
    DeliveryLite & { attendanceUnits?: string[] }
  >;
  const taught = [...sessionsTaught(deliveries).values()].filter((s) => !filter.chapter || s.chapter === filter.chapter);
  if (taught.length === 0) return { studentId, subjects: [] };

  const allDays = [...new Set(taught.flatMap((s) => s.taughtOn))].sort();
  const days = await dayRecords(studentId, allDays, deliveries);

  const bySubject = new Map<string, StudentSession[]>();
  for (const s of taught) {
    const row: StudentSession = { ...s, ...presenceOf(s.taughtOn, days) };
    bySubject.set(s.subject, [...(bySubject.get(s.subject) ?? []), row]);
  }
  return {
    studentId,
    subjects: [...bySubject.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subject, sessions]) => {
        sessions.sort((a, b) => chapterOrder(a.chapter, b.chapter) || a.sessionIndex - b.sessionIndex);
        const counts: Record<Presence, number> = { PRESENT: 0, PARTIAL: 0, ABSENT: 0, UNKNOWN: 0 };
        for (const s of sessions) counts[s.presence] += 1;
        return { subject, counts, sessions };
      }),
  };
}

/**
 * The staff view (D-#826): `view_all` sees every subject; otherwise the class teacher of the child's
 * শাখা sees every subject, and a subject teacher only the subjects the routine gives them there.
 */
export async function studentLessonsFor(studentId: string, auth: Auth): Promise<StudentLessons & { narrowed: boolean }> {
  if (!Types.ObjectId.isValid(studentId)) throw new LessonProgressError("শিক্ষার্থী পাওয়া যায়নি।");
  if (callerHasPermission(auth, "lesson_progress:view_all")) return { ...(await lessonsOfStudent(studentId)), narrowed: false };
  const st = await Student.findById(studentId).select("sectionId").lean();
  if (!st) throw new LessonProgressError("শিক্ষার্থী পাওয়া যায়নি।");
  const sec = await Section.findById(st.sectionId).select("classTeacherId").lean();
  if (sec?.classTeacherId && String(sec.classTeacherId) === auth.userId) return { ...(await lessonsOfStudent(studentId)), narrowed: false };
  const subjects = (await LessonDelivery.distinct("subject", { rosterStudentIds: new Types.ObjectId(studentId) })) as string[];
  const mine: string[] = [];
  for (const s of subjects) if (await teachesSectionSubject(auth.userId, String(st.sectionId), s)) mine.push(s);
  if (mine.length === 0 && subjects.length > 0) throw new LessonProgressError("এই শিক্ষার্থীর পাঠের তথ্য দেখার অনুমতি আপনার নেই।");
  return { ...(await lessonsOfStudent(studentId, { subjects: mine })), narrowed: mine.length < subjects.length };
}

/** For mastery (D-#825): one chapter's sessions for one child — the gate is mastery's own. */
export async function chapterLessons(studentId: string, subject: string, chapter: string): Promise<StudentSession[]> {
  const r = await lessonsOfStudent(studentId, { subjects: [subject], chapter });
  return r.subjects[0]?.sessions ?? [];
}

/**
 * For the M-5 proposal (D-#825): of these students, who missed (ABSENT / PARTIAL) at least one taught
 * session of the chapter, and whether the chapter was taught at all in their শাখা.
 */
export async function missedChapter(
  studentIds: string[],
  subject: string,
  chapter: string,
): Promise<{ taught: boolean; missed: string[] }> {
  let taught = false;
  const missed: string[] = [];
  for (const id of studentIds) {
    const sessions = await chapterLessons(id, subject, chapter);
    if (sessions.length) taught = true;
    if (sessions.some((s) => s.presence === "ABSENT" || s.presence === "PARTIAL")) missed.push(id);
  }
  return { taught, missed };
}
