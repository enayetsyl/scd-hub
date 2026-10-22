/**
 * Lesson-plan progress LP-4 (D-#828) — guardians and the lessons their child missed.
 *
 *  - `childMissedLessonsPage` — every marked class this academic year where the child was on the
 *    roster and listed absent that day: subject, the session(s) taught, and the teacher's class-note
 *    text, newest first. Paged (D-#761). Gate: guardian:read_child + the link (resolver).
 *  - `dispatchLessonMissed` — the 18:00 school-day notice: one row per guardian × child naming the
 *    subjects/sessions missed TODAY, so the family can go over it at home. The dedupe key carries the
 *    child, the day and the guardian (an entity-only key swallows the second guardian's notice).
 *
 * Only real absences: a day without attendance, or a child not listed absent, never notifies.
 */
import { Types } from "mongoose";
import { ROUTINE_SUBJECT_LABELS_BN } from "@scd/shared";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Student } from "../../foundation/models/Student";
import { ClassNote } from "../../routine/models/ClassNote";
import { StudentLeaveApplication } from "../../attendance/models/StudentLeaveApplication";
import { applicationCovers } from "../../attendance/services/LeaveApplicationService";
import { dateKeyOf } from "../../attendance/dates";
import { emit } from "../../notifications/services/NotificationService";
import { personName } from "../../../lib/personName";
import { pageOf, type Page, type PageArgs } from "../../../lib/paging";
import { LessonDelivery, type ILessonDelivery } from "../models/LessonDelivery";
import { absencesByNote } from "../presence";

const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const subjectBn = (s: string) => (ROUTINE_SUBJECT_LABELS_BN as Record<string, string>)[s] ?? s;
const sessionLine = (s: ILessonDelivery["sessions"][number]) =>
  `${s.anchorWord ? `${s.anchorWord} ` : ""}${bn(s.chapter)} · সেশন ${bn(s.sessionIndex)}/${bn(s.sessionOf)} · ${s.titleBn}`;

/** The evening rung (18:00 Dhaka, school days) — after the last period's class note is in. */
export const LESSON_MISSED_MINUTES = 18 * 60;

export const lessonMissedDedupe = (studentId: string, dateKey: string, guardianId: string) => `LPMISS:${studentId}:${dateKey}:${guardianId}`;

type DeliveryRow = Pick<ILessonDelivery, "noteId" | "dateKey" | "subject" | "sessions" | "rosterStudentIds" | "attendanceUnits">;

export interface MissedLesson {
  dateKey: string;
  subject: string;
  sessions: Array<{ chapter: string; anchorWord: string; sessionIndex: number; sessionOf: number; titleBn: string; finished: boolean }>;
  /** What the teacher wrote in the class note that day (what to go over at home). */
  noteBn: string | null;
  onLeave: boolean;
}

async function yearStartKey(): Promise<string> {
  const y = await AcademicYear.findOne({ current: true }).select("startDate").lean();
  return y ? dateKeyOf(new Date(y.startDate)) : "0000-00-00";
}

export async function childMissedLessonsPage(studentId: string, args: PageArgs = {}): Promise<Page<MissedLesson>> {
  if (!Types.ObjectId.isValid(studentId)) return pageOf([], args);
  const sid = new Types.ObjectId(studentId);
  // Bounded: one child's marked classes in the current academic year.
  const deliveries = (await LessonDelivery.find({ rosterStudentIds: sid, "sessions.0": { $exists: true }, dateKey: { $gte: await yearStartKey() } })
    .select("noteId dateKey subject sessions rosterStudentIds attendanceUnits")
    .sort({ dateKey: -1 })
    .lean()) as unknown as DeliveryRow[];
  const absences = await absencesByNote(deliveries);
  const missed = deliveries.filter((d) => absences.get(String(d.noteId))?.absent.has(studentId));
  if (missed.length === 0) return pageOf([], args);
  const notes = new Map(
    (await ClassNote.find({ _id: { $in: missed.map((d) => d.noteId) } }).select("taughtSummaryBn").lean()).map((n) => [String(n._id), n.taughtSummaryBn as string]),
  );
  const keys = missed.map((d) => d.dateKey).sort();
  const apps = await StudentLeaveApplication.find({ studentId: sid, fromKey: { $lte: keys[keys.length - 1] }, toKey: { $gte: keys[0] } }).lean();
  const rows: MissedLesson[] = missed.map((d) => ({
    dateKey: d.dateKey,
    subject: d.subject,
    sessions: d.sessions.map((s) => ({
      chapter: s.chapter,
      anchorWord: s.anchorWord ?? "",
      sessionIndex: s.sessionIndex,
      sessionOf: s.sessionOf,
      titleBn: s.titleBn,
      finished: s.finished,
    })),
    noteBn: notes.get(String(d.noteId)) ?? null,
    onLeave: applicationCovers(apps as never, studentId, d.dateKey),
  }));
  return pageOf(rows, args);
}

/** 18:00 on a school day: tell each guardian which of today's marked lessons their child missed. */
export async function dispatchLessonMissed(now: Date): Promise<number> {
  const today = dateKeyOf(now);
  const deliveries = (await LessonDelivery.find({ dateKey: today, "sessions.0": { $exists: true } })
    .select("noteId dateKey subject sessions rosterStudentIds attendanceUnits")
    .lean()) as unknown as DeliveryRow[];
  if (deliveries.length === 0) return 0;
  const absences = await absencesByNote(deliveries);
  const byStudent = new Map<string, Array<{ subject: string; lines: string[] }>>();
  for (const d of deliveries) {
    for (const sid of absences.get(String(d.noteId))?.absent ?? []) {
      const list = byStudent.get(sid) ?? [];
      list.push({ subject: d.subject, lines: d.sessions.map(sessionLine) });
      byStudent.set(sid, list);
    }
  }
  if (byStudent.size === 0) return 0;
  const ids = [...byStudent.keys()].map((s) => new Types.ObjectId(s));
  const students = new Map((await Student.find({ _id: { $in: ids } }).select("name nameBn").lean()).map((s) => [String(s._id), personName(s as never)]));
  const links = (await GuardianLink.find({ studentId: { $in: ids }, active: { $ne: false } }).select("guardianId studentId").lean()) as unknown as Array<{
    guardianId: Types.ObjectId;
    studentId: Types.ObjectId;
  }>;
  let sent = 0;
  for (const l of links) {
    const sid = String(l.studentId);
    const missed = byStudent.get(sid) ?? [];
    if (missed.length === 0) continue;
    const subjects = [...new Set(missed.map((m) => subjectBn(m.subject)))].join(", ");
    const first = missed[0].lines[0] ?? "";
    const r = await emit({
      recipientGuardianId: String(l.guardianId),
      kind: "LESSON_MISSED",
      titleBn: "আজকের ক্লাসের পাঠ",
      bodyBn: `${students.get(sid) ?? ""} আজ ${subjects} ক্লাসে অনুপস্থিত ছিল — ${first}${missed.length > 1 || missed[0].lines.length > 1 ? " …" : ""}। বাড়িতে পাঠটি একবার দেখে নিন।`,
      refs: { studentId: sid },
      dedupeKey: lessonMissedDedupe(sid, today, String(l.guardianId)),
    });
    if (r.created) sent++;
  }
  return sent;
}
