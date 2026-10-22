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
  const deliveries = (await LessonDelivery.find(q).select("subject dateKey sessions").lean()) as unknown as DeliveryLite[];
  const taught = [...sessionsTaught(deliveries).values()].filter((s) => !filter.chapter || s.chapter === filter.chapter);
  if (taught.length === 0) return { studentId, subjects: [] };

  const allDays = taught.flatMap((s) => s.taughtOn).sort();
  const history = await studentAttendanceHistory(studentId, allDays[0], allDays[allDays.length - 1]);
  const days = new Map(history.days.map((d) => [d.dateKey, { absent: d.absent, leaveCovered: d.leaveCovered }]));

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
