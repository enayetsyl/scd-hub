/**
 * Lesson-plan progress LP-4 (D-#828) + GH-4 (D-#1523/#1528) — guardians and the lessons their child missed.
 *
 *  - `childMissedLessonsPage` — every marked class this academic year where the child was on the
 *    roster and listed absent that day: subject, the session(s) taught, the teacher's class-note
 *    text, the homework the note linked and, per session, the loaded home guide (steps + the
 *    classwork items done in class). Newest first. Paged (D-#761). Gate: guardian:read_child + the
 *    link (resolver).
 *  - `dispatchLessonMissed` — the 1 pm school-day notice (GH-4; was 18:00 in LP-4): one row per
 *    guardian x child naming every class marked so far where the child was listed absent. A class
 *    marked after 1 pm is not covered yet, so it rides the NEXT school day's 1 pm notice; once a
 *    class is covered it is stamped (`missedNoticeAt`) and never noticed twice. The dedupe key
 *    carries the child, the day and the guardian (an entity-only key swallows the second guardian's
 *    notice).
 *
 * Only real absences: a day without attendance, or a child not listed absent, never notifies.
 */
import { Types } from "mongoose";
import { ROUTINE_SUBJECT_LABELS_BN } from "@scd/shared";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Student } from "../../foundation/models/Student";
import { ClassNote } from "../../routine/models/ClassNote";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { StudentLeaveApplication } from "../../attendance/models/StudentLeaveApplication";
import { applicationCovers } from "../../attendance/services/LeaveApplicationService";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";
import { emit } from "../../notifications/services/NotificationService";
import { personName } from "../../../lib/personName";
import { pageOf, type Page, type PageArgs } from "../../../lib/paging";
import { LessonDelivery, type ILessonDelivery } from "../models/LessonDelivery";
import { absencesByNote } from "../presence";
import { guidesForSessions, type SessionHomeGuideView } from "./HomeGuideService";

const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const subjectBn = (s: string) => (ROUTINE_SUBJECT_LABELS_BN as Record<string, string>)[s] ?? s;
const sessionLine = (s: ILessonDelivery["sessions"][number]) =>
  `${s.anchorWord ? `${s.anchorWord} ` : ""}${bn(s.chapter)} · সেশন ${bn(s.sessionIndex)}/${bn(s.sessionOf)} · ${s.titleBn}`;

/** The noon rung (13:00 Dhaka, school days; GH-4 — was 18:00 in LP-4). */
export const LESSON_MISSED_MINUTES = 13 * 60;
/** A class not covered yet (marked late, or attendance not taken) is looked for this many calendar days back. */
export const LESSON_MISSED_LOOKBACK_DAYS = 21;

export const lessonMissedDedupe = (studentId: string, dateKey: string, guardianId: string) => `LPMISS:${studentId}:${dateKey}:${guardianId}`;

type DeliveryRow = Pick<ILessonDelivery, "noteId" | "dateKey" | "subject" | "classLevel" | "sessions" | "rosterStudentIds" | "attendanceUnits">;

export interface MissedHomework {
  description: string | null;
  qCount: number;
  timeDecl: number;
}

export interface MissedLesson {
  dateKey: string;
  subject: string;
  sessions: Array<{
    chapter: string;
    anchorWord: string;
    sessionIndex: number;
    sessionOf: number;
    titleBn: string;
    finished: boolean;
    /** GH-4: the loaded home guide for this session (null until one is imported). */
    guide: SessionHomeGuideView | null;
  }>;
  /** What the teacher wrote in the class note that day (what to go over at home). */
  noteBn: string | null;
  /** GH-4: the homework the class note linked that day (null = none). */
  homework: MissedHomework | null;
  onLeave: boolean;
}

async function yearStartKey(): Promise<string> {
  const y = await AcademicYear.findOne({ current: true }).select("startDate").lean();
  return y ? dateKeyOf(new Date(y.startDate)) : "0000-00-00";
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
}

export async function childMissedLessonsPage(studentId: string, args: PageArgs = {}): Promise<Page<MissedLesson>> {
  if (!Types.ObjectId.isValid(studentId)) return pageOf([], args);
  const sid = new Types.ObjectId(studentId);
  // Bounded: one child's marked classes in the current academic year.
  const deliveries = (await LessonDelivery.find({ rosterStudentIds: sid, "sessions.0": { $exists: true }, dateKey: { $gte: await yearStartKey() } })
    .select("noteId dateKey subject classLevel sessions rosterStudentIds attendanceUnits")
    .sort({ dateKey: -1 })
    .lean()) as unknown as DeliveryRow[];
  const absences = await absencesByNote(deliveries);
  const missed = deliveries.filter((d) => absences.get(String(d.noteId))?.absent.has(studentId));
  if (missed.length === 0) return pageOf([], args);
  const noteRows = await ClassNote.find({ _id: { $in: missed.map((d) => d.noteId) } })
    .select("taughtSummaryBn homeworkItemId")
    .lean();
  const notes = new Map(noteRows.map((n) => [String(n._id), n.taughtSummaryBn as string]));
  const hwIds = noteRows.map((n) => n.homeworkItemId).filter(Boolean);
  const homeworks = new Map<string, MissedHomework>(
    (hwIds.length ? await HomeworkItem.find({ _id: { $in: hwIds } }).select("description qCount timeDecl").lean() : []).map((h) => [
      String(h._id),
      { description: (h.description as string | undefined) ?? null, qCount: h.qCount as number, timeDecl: h.timeDecl as number },
    ]),
  );
  const hwOfNote = new Map(noteRows.map((n) => [String(n._id), n.homeworkItemId ? (homeworks.get(String(n.homeworkItemId)) ?? null) : null]));
  // Home guides: one read per class level x subject (bounded by the child's year of missed classes).
  const guideSets = new Map<string, Map<string, SessionHomeGuideView>>();
  for (const [k, group] of groupBy(missed, (d) => `${d.classLevel}|${d.subject}`)) {
    const [level, subject] = k.split("|");
    guideSets.set(k, await guidesForSessions(Number(level), subject, group.flatMap((d) => d.sessions)));
  }
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
      guide: guideSets.get(`${d.classLevel}|${d.subject}`)?.get(`${Number(s.chapter)}:${s.sessionIndex}`) ?? null,
    })),
    noteBn: notes.get(String(d.noteId)) ?? null,
    homework: hwOfNote.get(String(d.noteId)) ?? null,
    onLeave: applicationCovers(apps as never, studentId, d.dateKey),
  }));
  return pageOf(rows, args);
}

const addDays = (key: string, days: number): string => dateKeyOf(new Date(parseDateKey(key).getTime() + days * 86_400_000));

/**
 * 13:00 on a school day (GH-4): tell each guardian which marked classes their child missed that no
 * earlier notice covered. A class is covered once its attendance is fully on record and it was part
 * of this run; a class marked after 13:00 (or whose attendance is not taken yet) waits for the next
 * school day.
 */
export async function dispatchLessonMissed(now: Date): Promise<number> {
  const today = dateKeyOf(now);
  const deliveries = (await LessonDelivery.find({
    dateKey: { $gte: addDays(today, -LESSON_MISSED_LOOKBACK_DAYS), $lte: today },
    "sessions.0": { $exists: true },
    missedNoticeAt: { $exists: false },
  })
    .select("noteId dateKey subject classLevel sessions rosterStudentIds attendanceUnits")
    .lean()) as unknown as Array<DeliveryRow & { _id: Types.ObjectId }>;
  if (deliveries.length === 0) return 0;
  const absences = await absencesByNote(deliveries);
  const byStudent = new Map<string, Array<{ dateKey: string; subject: string; lines: string[] }>>();
  const candidates: Array<{ id: Types.ObjectId; absent: string[] }> = [];
  for (const d of deliveries) {
    const a = absences.get(String(d.noteId));
    if (!a?.recorded) continue; // attendance not (fully) taken yet — look again next school day
    candidates.push({ id: d._id, absent: [...a.absent] });
    for (const sid of a.absent) {
      const list = byStudent.get(sid) ?? [];
      list.push({ dateKey: d.dateKey, subject: d.subject, lines: d.sessions.map(sessionLine) });
      byStudent.set(sid, list);
    }
  }
  let sent = 0;
  // A child whose notice the dedupe key swallowed (a second run the same day) keeps their classes unstamped,
  // so the next school day notices them (GH-4 review).
  const swallowed = new Set<string>();
  if (byStudent.size > 0) {
    const ids = [...byStudent.keys()].map((s) => new Types.ObjectId(s));
    const students = new Map((await Student.find({ _id: { $in: ids } }).select("name nameBn").lean()).map((s) => [String(s._id), personName(s as never)]));
    const links = (await GuardianLink.find({ studentId: { $in: ids }, active: { $ne: false } }).select("guardianId studentId").lean()) as unknown as Array<{
      guardianId: Types.ObjectId;
      studentId: Types.ObjectId;
    }>;
    for (const l of links) {
      const sid = String(l.studentId);
      const missed = [...(byStudent.get(sid) ?? [])].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      if (missed.length === 0) continue;
      const subjects = [...new Set(missed.map((m) => subjectBn(m.subject)))].join(", ");
      const first = missed[0].lines[0] ?? "";
      const earlier = missed.some((m) => m.dateKey !== today);
      const r = await emit({
        recipientGuardianId: String(l.guardianId),
        kind: "LESSON_MISSED",
        titleBn: earlier ? "ক্লাসের মিস হওয়া পাঠ" : "আজকের ক্লাসের পাঠ",
        bodyBn: `${students.get(sid) ?? ""} ${earlier ? "" : "আজ "}${subjects} ক্লাসে অনুপস্থিত ছিল — ${first}${missed.length > 1 || missed[0].lines.length > 1 ? " …" : ""}। বাড়িতে পাঠটি একবার দেখে নিন — সংক্ষিপ্ত গাইড অ্যাপে আছে।`,
        refs: { studentId: sid },
        dedupeKey: lessonMissedDedupe(sid, today, String(l.guardianId)),
      });
      if (r.created) sent++;
      else swallowed.add(sid);
    }
  }
  const covered = candidates.filter((c) => !c.absent.some((sid) => swallowed.has(sid))).map((c) => c.id);
  if (covered.length > 0) await LessonDelivery.updateMany({ _id: { $in: covered }, missedNoticeAt: { $exists: false } }, { $set: { missedNoticeAt: now } });
  return sent;
}
