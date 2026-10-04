/**
 * WorkBoardService (WB-1/WB-2, D-#701) — the UNIFIED board: manual tasks beside
 * auto cards projected from records other modules already keep.
 *
 * Every adapter is BATCHED over a set of users (the load grid asks for all staff
 * for a week in one call) and BEST-EFFORT (one failing source never empties the
 * board — the AdminToday `safe()` posture). An auto card is never stored: its
 * status is read from the source each time, so "done" on the board means the
 * source record changed (class note published, marks submitted, job delivered).
 *
 *   PERIOD / COVER      routine slots (own, cover-overlaid) + substitutions + approved
 *                       HR cover slots; DONE when a ClassNote exists for (slot, date)
 *   HOMEWORK_CHECK      one card per homework item with SUBMITTED records (owner ruling:
 *                       per item, never per student); gone when all are checked
 *   CLASS_TEST_MARKS    a PRINTED test past its exam date whose results are not all
 *                       submitted (classTestSettled — the CT-8 rule)
 *   VIDEO_REVIEW        a PENDING VideoReviewAssignment
 *   PLAN_REVIEW         an `assigned` ReviewAssignment
 *   PRINT_JOB           a REQUESTED PrintRequest — on every OFFICE actor's board
 *   LEAVE_APPROVAL      an `applied` StaffLeaveApplication — on every leave:manage
 *                       Principal/Office actor's board
 *
 * The "now" adapters (everything but PERIOD/COVER and manual tasks) only produce
 * cards when the window contains TODAY: pending work is owed now, not on a date.
 */
import { Types } from "mongoose";
import {
  DAYS_OF_WEEK,
  DAY_SLOT_BOUNDARIES_MIN,
  ROUTINE_SUBJECT_LABELS_BN,
  WORK_EFFORT_MIN,
  callerHasPermission,
  type DaySlot,
  type PeriodTrack,
  type TaskPriority,
  type TaskStatus,
  type WorkCardKind,
} from "@scd/shared";
import { dateKeyOf, dateKeysBetween, parseDateKey } from "../../attendance/dates";
import { buildDayTypeResolver, dayTypeAdmitsTrack } from "../../routine/calendar";
import { hhmmToMinutes } from "../../routine/schedule";
import { enrichRoutineSlots } from "../../routine/slotView";
import { isLiveOn } from "../../routine/liveWindow";
import { RoutineSlot, type IRoutineSlot } from "../../routine/models/RoutineSlot";
import { RoutineSubstitution } from "../../routine/models/RoutineSubstitution";
import { ClassNote } from "../../routine/models/ClassNote";
import { StaffCoverSlot } from "../../hr/models/StaffCoverSlot";
import { StaffLeaveApplication } from "../../hr/models/StaffLeaveApplication";
import { HomeworkItem } from "../../trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../../trackers/models/HomeworkStudentRecord";
import { ClassTest } from "../../trackers/models/ClassTest";
import { ClassTestResult } from "../../trackers/models/ClassTestResult";
import { classTestSettled } from "../../reports/services/MonthlyPendingWorkService";
import { VideoReviewAssignment } from "../../classroom-observation/models/VideoReviewAssignment";
import { ClassroomObservation } from "../../classroom-observation/models/ClassroomObservation";
import { ReviewAssignment } from "../../content/models/ReviewAssignment";
import { PrintRequest } from "../../printing/models/PrintRequest";
import { User } from "../../foundation/models/User";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { normalizePhone } from "../../foundation/services/credentials";
import type { ITask } from "../models/Task";
import { tasksOnBoards } from "./TaskService";
import { PULLABLE_KINDS, isBackup, officeRecipients, officeUncoveredToday, pullsFor } from "./OfficeCoverService";

export interface WorkCardLink {
  screen: string;
  params: Record<string, string>;
}

export interface WorkCard {
  /** Stable per (kind, source, user, date) — the app's list key. */
  key: string;
  kind: WorkCardKind;
  userId: string;
  titleBn: string;
  detailBn: string | null;
  dateKey: string;
  slot: DaySlot;
  /** Minutes of the day the card starts at, when the source has a clock time. */
  startMin: number | null;
  effortMin: number;
  status: TaskStatus;
  overdue: boolean;
  priority: TaskPriority | null;
  blockedReason: string | null;
  assignedById: string | null;
  assignedByName: string | null;
  forLabel: string | null;
  taskId: string | null;
  sourceId: string | null;
  link: WorkCardLink | null;
  /** WB-5 (D-#702): an office-queue card a backup may take, or one already taken. */
  canPull?: boolean;
  pulledById?: string | null;
  pulledByName?: string | null;
}

/** What one staff user looks like to the board (role + templates + grants, for gates). */
export interface BoardUser {
  _id: Types.ObjectId;
  name: string;
  role: string;
  phone?: string;
  additionalTemplates?: string[];
  grantedPermissions?: string[];
  revokedPermissions?: string[];
}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
export const bn = (n: number | string): string => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
const subjectBn = (s: string): string => (ROUTINE_SUBJECT_LABELS_BN as Record<string, string>)[s] ?? s;

export function slotForMinute(min: number | null | undefined): DaySlot {
  if (min == null) return "ANY";
  if (min >= DAY_SLOT_BOUNDARIES_MIN.afternoonFrom) return "AFTERNOON";
  if (min >= DAY_SLOT_BOUNDARIES_MIN.middayFrom) return "MIDDAY";
  return "MORNING";
}

const actsAsAny = (u: BoardUser, roles: string[]): boolean =>
  roles.includes(u.role) || (u.additionalTemplates ?? []).some((t) => roles.includes(t));

const profileOf = (u: BoardUser) => ({
  role: u.role as "PRINCIPAL" | "TEACHER" | "OFFICE" | "GUARDIAN",
  additionalTemplates: (u.additionalTemplates ?? []) as ("PRINCIPAL" | "TEACHER" | "OFFICE" | "GUARDIAN")[],
  grantedPermissions: (u.grantedPermissions ?? []) as never[],
  revokedPermissions: (u.revokedPermissions ?? []) as never[],
});

async function safe<T>(label: string, build: () => Promise<T[]>): Promise<T[]> {
  try {
    return await build();
  } catch (err) {
    console.error(`[workboard] ${label} adapter failed (board shown without it):`, err);
    return [];
  }
}

/** Class/section labels, batched once per board build. */
async function labelMaps(): Promise<{ cls: Map<string, string>; sec: Map<string, string> }> {
  const [classes, sections] = await Promise.all([
    Class.find({}).select("nameBn level").lean() as Promise<Array<{ _id: Types.ObjectId; nameBn?: string; level?: number }>>,
    Section.find({}).select("nameBn code").lean() as Promise<Array<{ _id: Types.ObjectId; nameBn?: string; code?: string }>>,
  ]);
  return {
    cls: new Map(classes.map((c) => [c._id.toString(), c.nameBn ?? `L${c.level ?? "?"}`])),
    sec: new Map(sections.map((s) => [s._id.toString(), s.nameBn ?? s.code ?? "?"])),
  };
}

// ---------------------------------------------------------------------------
// Manual tasks
// ---------------------------------------------------------------------------

function manualCard(t: ITask, todayKey: string, names: Map<string, string>): WorkCard {
  const overdue = t.status !== "DONE" && t.dueKey < todayKey;
  return {
    key: `TASK:${t._id.toString()}`,
    kind: "TASK",
    userId: t.assigneeUserId.toString(),
    titleBn: t.titleBn,
    detailBn: t.notes ?? null,
    dateKey: t.dueKey,
    slot: t.slot,
    startMin: null,
    effortMin: t.effortMin,
    status: t.status,
    overdue,
    priority: t.priority,
    blockedReason: t.blockedReason ?? null,
    assignedById: t.assignedBy.toString(),
    assignedByName: names.get(t.assignedBy.toString()) ?? null,
    forLabel: t.forLabel ?? null,
    taskId: t._id.toString(),
    sourceId: null,
    link: { screen: "TaskDetail", params: { taskId: t._id.toString() } },
  };
}

// ---------------------------------------------------------------------------
// Auto adapters
// ---------------------------------------------------------------------------

async function periodCards(userIds: string[], fromKey: string, toKey: string, keys: string[]): Promise<WorkCard[]> {
  const idSet = new Set(userIds);
  const fromDate = parseDateKey(fromKey);
  const toDate = parseDateKey(toKey);
  const resolveDayType = await buildDayTypeResolver(fromDate, toDate);
  const days = keys.map((k) => ({ key: k, date: parseDateKey(k) })).map((d) => ({ ...d, dayType: resolveDayType(d.date) }));
  const schoolDays = days.filter((d) => d.dayType !== "OFF" && d.dayType !== "HOLIDAY");
  if (schoolDays.length === 0) return [];
  const weekdays = [...new Set(schoolDays.map((d) => DAYS_OF_WEEK[d.date.getDay()]))];

  // Own slots (any live window overlapping the range), overlaid by substitutions.
  const own = (await RoutineSlot.find({
    teacherId: { $in: userIds.map((u) => new Types.ObjectId(u)) },
    dayOfWeek: { $in: weekdays },
    active: true,
    isBreak: false,
  }).lean()) as unknown as IRoutineSlot[];
  const rangeStart = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 0, 0, 0, 0);
  const rangeEnd = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999);
  const [subsOnOwn, subsForMe, hrCovers] = await Promise.all([
    own.length
      ? RoutineSubstitution.find({ slotId: { $in: own.map((s) => s._id) }, active: true, date: { $gte: rangeStart, $lte: rangeEnd } }).lean()
      : Promise.resolve([]),
    RoutineSubstitution.find({
      coverTeacherId: { $in: userIds.map((u) => new Types.ObjectId(u)) },
      active: true,
      date: { $gte: rangeStart, $lte: rangeEnd },
    }).lean(),
    StaffCoverSlot.find({
      finalCoverTeacherUserId: { $in: userIds.map((u) => new Types.ObjectId(u)) },
      dateKey: { $gte: fromKey, $lte: toKey },
      status: "approved",
    })
      .select("routineSlotId dateKey finalCoverTeacherUserId absentTeacherUserId")
      .lean(),
  ]);
  const coveredAway = new Map<string, string>(); // `${slotId}:${dateKey}` → cover teacher (someone else takes it)
  for (const su of subsOnOwn) coveredAway.set(`${su.slotId.toString()}:${dateKeyOf(new Date(su.date))}`, su.coverTeacherId.toString());

  // Slots I cover for others (either mechanism), loaded once.
  const coverSlotIds = [
    ...new Set([...subsForMe.map((s) => s.slotId.toString()), ...hrCovers.map((c) => c.routineSlotId.toString())]),
  ].filter((id) => !own.some((s) => s._id.toString() === id));
  const coverSlots = coverSlotIds.length
    ? ((await RoutineSlot.find({ _id: { $in: coverSlotIds }, active: true }).lean()) as unknown as IRoutineSlot[])
    : [];
  const slotById = new Map<string, IRoutineSlot>([...own, ...coverSlots].map((s) => [s._id.toString(), s]));
  const enriched = await enrichRoutineSlots([...own, ...coverSlots].map((s) => ({ ...s, coverTeacherId: null })));
  const viewById = new Map(enriched.map((s) => [s._id.toString(), s]));

  // Class notes over the range settle "done".
  const noteRows = slotById.size
    ? await ClassNote.find({ slotId: { $in: [...slotById.keys()] }, date: { $gte: rangeStart, $lte: rangeEnd } })
        .select("slotId date")
        .lean()
    : [];
  const noted = new Set(noteRows.map((n) => `${n.slotId.toString()}:${dateKeyOf(new Date(n.date))}`));

  const todayKey = dateKeyOf(new Date());
  const out: WorkCard[] = [];
  const push = (slot: IRoutineSlot, userId: string, dateKey: string, kind: "PERIOD" | "COVER", absentName: string | null) => {
    const view = viewById.get(slot._id.toString());
    const startMin = view?.startTime ? hhmmToMinutes(view.startTime) : null;
    const endMin = view?.endTime ? hhmmToMinutes(view.endTime) : null;
    const effort = startMin != null && endMin != null && endMin > startMin ? endMin - startMin : WORK_EFFORT_MIN.periodFallback;
    const done = noted.has(`${slot._id.toString()}:${dateKey}`);
    const overdue = !done && dateKey < todayKey;
    const group = view?.groupName ?? "";
    out.push({
      key: `${kind}:${slot._id.toString()}:${dateKey}:${userId}`,
      kind,
      userId,
      titleBn: `${bn(slot.periodNumber)}ম পিরিয়ড · ${group} · ${subjectBn(slot.subject)}`,
      detailBn: kind === "COVER" ? `${absentName ?? "সহকর্মী"}-এর বদলে · ক্লাস নোট দিলে শেষ হবে` : done ? "ক্লাস নোট প্রকাশিত" : "ক্লাস নোট দিলে শেষ হবে",
      dateKey,
      slot: slotForMinute(startMin),
      startMin,
      effortMin: effort,
      status: done ? "DONE" : "TODO",
      overdue,
      priority: null,
      blockedReason: null,
      assignedById: null,
      assignedByName: null,
      forLabel: null,
      taskId: null,
      sourceId: slot._id.toString(),
      link: { screen: "MyRoutine", params: {} },
    });
  };

  for (const day of schoolDays) {
    const dow = DAYS_OF_WEEK[day.date.getDay()];
    for (const s of own) {
      if (s.dayOfWeek !== dow || !isLiveOn(s, day.date)) continue;
      if (!dayTypeAdmitsTrack(day.dayType, s.track as PeriodTrack)) continue;
      const teacherId = s.teacherId?.toString();
      if (!teacherId || !idSet.has(teacherId)) continue;
      if (coveredAway.has(`${s._id.toString()}:${day.key}`)) continue; // someone else's card that day
      push(s, teacherId, day.key, "PERIOD", null);
    }
  }
  const absentNames = new Map<string, string>();
  const absentIds = [
    ...new Set([
      ...subsForMe.map((s) => s.absentTeacherId?.toString()).filter(Boolean),
      ...hrCovers.map((c) => c.absentTeacherUserId?.toString()).filter(Boolean),
    ]),
  ] as string[];
  if (absentIds.length) {
    const users = await User.find({ _id: { $in: absentIds } }).select("name").lean();
    for (const u of users) absentNames.set(u._id.toString(), u.name);
  }
  const seen = new Set<string>();
  const pushCover = (slotId: string, userId: string, dateKey: string, absentId: string | null) => {
    const k = `${slotId}:${dateKey}:${userId}`;
    if (seen.has(k)) return;
    const slot = slotById.get(slotId);
    const day = schoolDays.find((d) => d.key === dateKey);
    if (!slot || !day) return;
    if (!dayTypeAdmitsTrack(day.dayType, slot.track as PeriodTrack)) return;
    seen.add(k);
    const absent = absentId ?? slot.teacherId?.toString() ?? null;
    push(slot, userId, dateKey, "COVER", absent ? absentNames.get(absent) ?? viewById.get(slotId)?.teacherName ?? null : null);
  };
  for (const su of subsForMe) pushCover(su.slotId.toString(), su.coverTeacherId.toString(), dateKeyOf(new Date(su.date)), su.absentTeacherId?.toString() ?? null);
  for (const c of hrCovers) if (c.finalCoverTeacherUserId) pushCover(c.routineSlotId.toString(), c.finalCoverTeacherUserId.toString(), c.dateKey, c.absentTeacherUserId?.toString() ?? null);
  return out;
}

async function homeworkCards(userIds: string[], todayKey: string, labels: { cls: Map<string, string>; sec: Map<string, string> }): Promise<WorkCard[]> {
  const since = new Date(Date.now() - 45 * 24 * 3600 * 1000);
  const items = (await HomeworkItem.find({
    declaredBy: { $in: userIds.map((u) => new Types.ObjectId(u)) },
    dateGiven: { $gte: since },
  })
    .select("hwId subject classId sectionId dateGiven declaredBy")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; hwId: string; subject: string; classId: Types.ObjectId; sectionId: Types.ObjectId; dateGiven: Date; declaredBy: Types.ObjectId }>;
  if (items.length === 0) return [];
  const counts = (await HomeworkStudentRecord.aggregate([
    { $match: { hwItemId: { $in: items.map((i) => i._id) }, state: "SUBMITTED" } },
    { $group: { _id: "$hwItemId", n: { $sum: 1 } } },
  ])) as Array<{ _id: Types.ObjectId; n: number }>;
  const byItem = new Map(counts.map((c) => [c._id.toString(), c.n]));
  const out: WorkCard[] = [];
  for (const it of items) {
    const n = byItem.get(it._id.toString()) ?? 0;
    if (n === 0) continue;
    const userId = it.declaredBy.toString();
    out.push({
      key: `HOMEWORK_CHECK:${it._id.toString()}:${userId}`,
      kind: "HOMEWORK_CHECK",
      userId,
      titleBn: `বাড়ির কাজ দেখা · ${labels.cls.get(it.classId.toString()) ?? "?"} / ${labels.sec.get(it.sectionId.toString()) ?? "?"} · ${subjectBn(it.subject)}`,
      detailBn: `${bn(n)}টি জমা হয়েছে, দেখা বাকি · ${it.hwId}`,
      dateKey: todayKey,
      slot: "ANY",
      startMin: null,
      effortMin: n * WORK_EFFORT_MIN.homeworkPerCopy,
      status: "TODO",
      overdue: false,
      priority: null,
      blockedReason: null,
      assignedById: null,
      assignedByName: null,
      forLabel: null,
      taskId: null,
      sourceId: it._id.toString(),
      link: { screen: "HomeworkWorkspace", params: {} },
    });
  }
  return out;
}

async function classTestCards(userIds: string[], todayKey: string, labels: { cls: Map<string, string>; sec: Map<string, string> }): Promise<WorkCard[]> {
  const ids = userIds.map((u) => new Types.ObjectId(u));
  const today = parseDateKey(todayKey);
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  const tests = (await ClassTest.find({
    $or: [{ teacherId: { $in: ids } }, { requestedBy: { $in: ids }, teacherId: null }],
    status: "PRINTED",
    examDate: { $gte: since, $lte: endOfToday },
  })
    .select("ctId subject classId sectionId examDate deadlineDays teacherId requestedBy")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; ctId: string; subject: string; classId?: Types.ObjectId | null; sectionId?: Types.ObjectId | null; examDate: Date; deadlineDays: number; teacherId?: Types.ObjectId | null; requestedBy: Types.ObjectId }>;
  if (tests.length === 0) return [];
  const results = (await ClassTestResult.find({ testId: { $in: tests.map((t) => t._id) } })
    .select("testId status marks submittedAt")
    .lean()) as unknown as Array<{ testId: Types.ObjectId; status: string; marks?: number | null; submittedAt?: Date | null }>;
  const byTest = new Map<string, typeof results>();
  for (const r of results) {
    const k = r.testId.toString();
    const g = byTest.get(k);
    if (g) g.push(r);
    else byTest.set(k, [r]);
  }
  const out: WorkCard[] = [];
  for (const t of tests) {
    const rs = byTest.get(t._id.toString()) ?? [];
    if (classTestSettled(rs)) continue;
    const userId = (t.teacherId ?? t.requestedBy).toString();
    if (!userIds.includes(userId)) continue;
    const exam = new Date(t.examDate);
    const due = new Date(exam.getFullYear(), exam.getMonth(), exam.getDate() + (t.deadlineDays ?? 2));
    const dueKey = dateKeyOf(due);
    const students = rs.length || 20;
    out.push({
      key: `CLASS_TEST_MARKS:${t._id.toString()}:${userId}`,
      kind: "CLASS_TEST_MARKS",
      userId,
      titleBn: `নম্বর এন্ট্রি · ${t.classId ? labels.cls.get(t.classId.toString()) ?? "?" : "?"}${t.sectionId ? " / " + (labels.sec.get(t.sectionId.toString()) ?? "?") : ""} · ${subjectBn(t.subject)} · ${t.ctId}`,
      detailBn: `${bn(students)} জন শিক্ষার্থী · পরীক্ষা ${dateKeyOf(exam)} · জমার শেষ দিন ${dueKey}`,
      dateKey: dueKey < todayKey ? todayKey : dueKey,
      slot: "ANY",
      startMin: null,
      effortMin: students * WORK_EFFORT_MIN.classTestPerStudent,
      status: "TODO",
      overdue: dueKey < todayKey,
      priority: null,
      blockedReason: null,
      assignedById: null,
      assignedByName: null,
      forLabel: null,
      taskId: null,
      sourceId: t._id.toString(),
      link: { screen: "ClassTestResults", params: { testId: t._id.toString(), title: t.ctId } },
    });
  }
  return out;
}

async function videoReviewCards(userIds: string[], todayKey: string): Promise<WorkCard[]> {
  const rows = (await VideoReviewAssignment.find({
    teacherId: { $in: userIds.map((u) => new Types.ObjectId(u)) },
    status: "PENDING",
    active: true,
  })
    .select("teacherId classDate timeLabel classLabel assignedBy")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; teacherId: Types.ObjectId; classDate: string; timeLabel: string; classLabel: string }>;
  return rows.map((r) => ({
    key: `VIDEO_REVIEW:${r._id.toString()}`,
    kind: "VIDEO_REVIEW" as const,
    userId: r.teacherId.toString(),
    titleBn: `ভিডিও পর্যবেক্ষণ · ${r.classLabel}`,
    detailBn: `${r.classDate} ${r.timeLabel}`,
    dateKey: todayKey,
    slot: "ANY" as const,
    startMin: null,
    effortMin: WORK_EFFORT_MIN.videoReview,
    status: "TODO" as const,
    overdue: r.classDate < todayKey,
    priority: null,
    blockedReason: null,
    assignedById: null,
    assignedByName: null,
    forLabel: null,
    taskId: null,
    sourceId: r._id.toString(),
    link: { screen: "FreeMixingHome", params: {} },
  }));
}

/** Plan/chapter reviews are one card each. QUESTION reviews share the same model
 *  (QuestionReviewService writes a ReviewAssignment per question) and a reviewer can
 *  hold thousands at once — those become ONE card per reviewer with the count. */
async function planReviewCards(userIds: string[], todayKey: string): Promise<WorkCard[]> {
  const rows = (await ReviewAssignment.find({
    reviewerId: { $in: userIds.map((u) => new Types.ObjectId(u)) },
    status: "assigned",
  })
    .select("reviewerId docType subject classLevel anchorWord addressNumber artifactId assignedAt")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; reviewerId: Types.ObjectId; docType: string; subject: string; classLevel: number; anchorWord: string; addressNumber: string; artifactId: Types.ObjectId; assignedAt: Date }>;
  const out: WorkCard[] = [];
  const questions = new Map<string, { n: number; oldest: Date }>();
  for (const r of rows) {
    if (r.docType === "question") {
      const id = r.reviewerId.toString();
      const cur = questions.get(id) ?? { n: 0, oldest: new Date(r.assignedAt) };
      cur.n += 1;
      if (new Date(r.assignedAt) < cur.oldest) cur.oldest = new Date(r.assignedAt);
      questions.set(id, cur);
      continue;
    }
    out.push({
      key: `PLAN_REVIEW:${r._id.toString()}`,
      kind: "PLAN_REVIEW",
      userId: r.reviewerId.toString(),
      titleBn: `পরিকল্পনা রিভিউ · ${bn(r.classLevel)}ম শ্রেণি ${subjectBn(r.subject)} · ${r.anchorWord} ${r.addressNumber}`,
      detailBn: `বরাদ্দ ${dateKeyOf(new Date(r.assignedAt))}`,
      dateKey: todayKey,
      slot: "ANY",
      startMin: null,
      effortMin: WORK_EFFORT_MIN.planReview,
      status: "TODO",
      overdue: false,
      priority: null,
      blockedReason: null,
      assignedById: null,
      assignedByName: null,
      forLabel: null,
      taskId: null,
      sourceId: r._id.toString(),
      link: { screen: "ReviewSubmit", params: { assignmentId: r._id.toString(), artifactId: r.artifactId.toString() } },
    });
  }
  for (const [userId, q] of questions) {
    out.push({
      key: `QUESTION_REVIEW:${userId}`,
      kind: "QUESTION_REVIEW",
      userId,
      titleBn: `প্রশ্ন রিভিউ · ${bn(q.n)}টি বাকি`,
      detailBn: `সবচেয়ে পুরোনো বরাদ্দ ${dateKeyOf(q.oldest)}`,
      dateKey: todayKey,
      slot: "ANY",
      startMin: null,
      effortMin: q.n * WORK_EFFORT_MIN.questionPerItem,
      status: "TODO",
      overdue: false,
      priority: null,
      blockedReason: null,
      assignedById: null,
      assignedByName: null,
      forLabel: null,
      taskId: null,
      sourceId: null,
      link: { screen: "QuestionReviewQueue", params: {} },
    });
  }
  return out;
}

/** A classroom observation handed to an observer (state ASSIGNED) — gone once reviewed.
 *  A cancelled plan keeps state ASSIGNED (CO-15, D-#428), so it is excluded here exactly
 *  as the review queue and the drawer badge exclude it — otherwise every cancelled
 *  plan lingers on the board as a task the queue no longer offers. */
export async function observationCards(userIds: string[], todayKey: string): Promise<WorkCard[]> {
  const rows = (await ClassroomObservation.find({
    observerId: { $in: userIds.map((u) => new Types.ObjectId(u)) },
    state: "ASSIGNED",
    cancelledAt: null,
  })
    .select("observerId teacherId classDate subject periodNumber")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; observerId: Types.ObjectId; teacherId: Types.ObjectId; classDate: string; subject: string; periodNumber?: number | null }>;
  if (rows.length === 0) return [];
  const names = new Map(
    (await User.find({ _id: { $in: rows.map((r) => r.teacherId) } }).select("name").lean()).map((u) => [u._id.toString(), u.name]),
  );
  return rows.map((r) => ({
    key: `OBSERVATION:${r._id.toString()}`,
    kind: "OBSERVATION" as const,
    userId: r.observerId.toString(),
    titleBn: `শ্রেণি পর্যবেক্ষণ · ${names.get(r.teacherId.toString()) ?? "শিক্ষক"} · ${subjectBn(r.subject)}`,
    detailBn: `ক্লাস ${r.classDate}${r.periodNumber ? ` · ${bn(r.periodNumber)}ম পিরিয়ড` : ""}`,
    dateKey: todayKey,
    slot: "ANY" as const,
    startMin: null,
    effortMin: WORK_EFFORT_MIN.observation,
    status: "TODO" as const,
    overdue: false,
    priority: null,
    blockedReason: null,
    assignedById: null,
    assignedByName: null,
    forLabel: null,
    taskId: null,
    sourceId: r._id.toString(),
    link: { screen: "ObservationDetail", params: { observationId: r._id.toString() } },
  }));
}

async function printCards(officeUsers: BoardUser[], todayKey: string): Promise<WorkCard[]> {
  if (officeUsers.length === 0) return [];
  const jobs = (await PrintRequest.find({ status: "REQUESTED" })
    .select("title copies neededByKey requestedBy requestedAt")
    .sort({ requestedAt: 1 })
    .lean()) as unknown as Array<{ _id: Types.ObjectId; title: string; copies: number; neededByKey?: string; requestedBy: Types.ObjectId }>;
  if (jobs.length === 0) return [];
  const names = new Map(
    (await User.find({ _id: { $in: jobs.map((j) => j.requestedBy) } }).select("name").lean()).map((u) => [u._id.toString(), u.name]),
  );
  const out: WorkCard[] = [];
  for (const u of officeUsers) {
    for (const j of jobs) {
      const due = j.neededByKey ?? todayKey;
      out.push({
        key: `PRINT_JOB:${j._id.toString()}:${u._id.toString()}`,
        kind: "PRINT_JOB",
        userId: u._id.toString(),
        titleBn: `প্রিন্ট · ${j.title} × ${bn(j.copies)}`,
        detailBn: `${names.get(j.requestedBy.toString()) ?? "শিক্ষক"} অনুরোধ করেছেন${j.neededByKey ? ` · ${j.neededByKey}-এর জন্য` : ""}`,
        dateKey: due < todayKey ? todayKey : due,
        slot: "ANY",
        startMin: null,
        effortMin: WORK_EFFORT_MIN.printJob,
        status: "TODO",
        overdue: due < todayKey,
        priority: null,
        blockedReason: null,
        assignedById: null,
        assignedByName: null,
        forLabel: null,
        taskId: null,
        sourceId: j._id.toString(),
        link: { screen: "PrintHome", params: {} },
      });
    }
  }
  return out;
}

async function leaveCards(approvers: BoardUser[], todayKey: string): Promise<WorkCard[]> {
  if (approvers.length === 0) return [];
  const apps = (await StaffLeaveApplication.find({ status: "applied" })
    .select("staffProfileId fromKey toKey days leaveType")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; staffProfileId: Types.ObjectId; fromKey: string; toKey: string; days: number }>;
  if (apps.length === 0) return [];
  const staff = new Map(
    (await StaffProfile.find({ _id: { $in: apps.map((a) => a.staffProfileId) } }).select("name").lean()).map((s) => [s._id.toString(), s.name]),
  );
  const out: WorkCard[] = [];
  for (const u of approvers) {
    for (const a of apps) {
      out.push({
        key: `LEAVE_APPROVAL:${a._id.toString()}:${u._id.toString()}`,
        kind: "LEAVE_APPROVAL",
        userId: u._id.toString(),
        titleBn: `ছুটির আবেদন অনুমোদন · ${staff.get(a.staffProfileId.toString()) ?? "স্টাফ"}`,
        detailBn: `${a.fromKey}${a.toKey !== a.fromKey ? ` – ${a.toKey}` : ""} · ${bn(a.days)} দিন`,
        dateKey: todayKey,
        slot: "ANY",
        startMin: null,
        effortMin: WORK_EFFORT_MIN.leaveApproval,
        status: "TODO",
        overdue: a.fromKey < todayKey,
        priority: null,
        blockedReason: null,
        assignedById: null,
        assignedByName: null,
        forLabel: null,
        taskId: null,
        sourceId: a._id.toString(),
        link: { screen: "LeaveAdmin", params: {} },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, NORMAL: 1, LATER: 2 };
const SLOT_RANK: Record<DaySlot, number> = { MORNING: 0, MIDDAY: 1, AFTERNOON: 2, ANY: 3 };

/** overdue first, then day, then slot/clock, then priority, then title. DONE sinks. */
export function sortCards(cards: WorkCard[]): WorkCard[] {
  return [...cards].sort((a, b) => {
    const aDone = a.status === "DONE" ? 1 : 0;
    const bDone = b.status === "DONE" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    const sa = a.startMin ?? (SLOT_RANK[a.slot] * 1000 + 999);
    const sb = b.startMin ?? (SLOT_RANK[b.slot] * 1000 + 999);
    if (SLOT_RANK[a.slot] !== SLOT_RANK[b.slot]) return SLOT_RANK[a.slot] - SLOT_RANK[b.slot];
    if (sa !== sb) return sa - sb;
    const pa = a.priority ? PRIORITY_RANK[a.priority] : 1;
    const pb = b.priority ? PRIORITY_RANK[b.priority] : 1;
    if (pa !== pb) return pa - pb;
    return a.titleBn.localeCompare(b.titleBn);
  });
}

export async function loadBoardUsers(userIds: string[]): Promise<BoardUser[]> {
  return (await User.find({ _id: { $in: userIds.map((u) => new Types.ObjectId(u)) }, active: true })
    .select("name role phone additionalTemplates grantedPermissions revokedPermissions")
    .lean()) as unknown as BoardUser[];
}

/** All active staff logins (never guardians) — the load grid's rows. */
export async function allStaffUsers(): Promise<BoardUser[]> {
  return (await User.find({ active: true, role: { $in: ["PRINCIPAL", "TEACHER", "OFFICE"] } })
    .select("name role phone additionalTemplates grantedPermissions revokedPermissions")
    .sort({ name: 1 })
    .lean()) as unknown as BoardUser[];
}

/** StaffProfile category per user id, joined by normalised phone (the staffMatch rule). */
export async function categoriesFor(users: BoardUser[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const withPhone = users.filter((u) => u.phone);
  if (withPhone.length === 0) return out;
  const profiles = (await StaffProfile.find({ active: true, phone: { $ne: null } }).select("phone category").lean()) as unknown as Array<{ phone?: string; category: string }>;
  const byPhone = new Map<string, string[]>();
  for (const p of profiles) {
    if (!p.phone) continue;
    const k = normalizePhone(p.phone);
    byPhone.set(k, [...(byPhone.get(k) ?? []), p.category]);
  }
  for (const u of withPhone) {
    const cats = byPhone.get(normalizePhone(u.phone!)) ?? [];
    if (cats.length === 1) out.set(u._id.toString(), cats[0]);
  }
  return out;
}

/** The unified board for a set of users over [fromKey, toKey] (≤ 31 days). */
export async function boardFor(users: BoardUser[], fromKey: string, toKey: string, now = new Date()): Promise<WorkCard[]> {
  if (users.length === 0) return [];
  const keys = dateKeysBetween(fromKey, toKey, 31);
  if (keys.length === 0) return [];
  const todayKey = dateKeyOf(now);
  const userIds = users.map((u) => u._id.toString());
  const nowInRange = fromKey <= todayKey && todayKey <= toKey;

  const [tasks, labels] = await Promise.all([tasksOnBoards(userIds, fromKey, toKey), labelMaps()]);
  const assignerIds = [...new Set(tasks.map((t) => t.assignedBy.toString()))];
  const names = new Map(
    assignerIds.length ? (await User.find({ _id: { $in: assignerIds } }).select("name").lean()).map((u) => [u._id.toString(), u.name]) : [],
  );
  const manual = tasks.map((t) => manualCard(t, todayKey, names));

  // WB-5 (D-#702): office-queue cards belong to the DESK (primary-role OFFICE). While
  // the desk is on leave the backups (OFFICE-template teacher-admins, the Principal)
  // see them too and may pull one; a pulled card sits on the puller's board alone.
  const uncovered = nowInRange ? await officeUncoveredToday(todayKey) : false;
  const pulls = nowInRange ? await pullsFor(PULLABLE_KINDS) : [];
  const pullerIds = new Set(pulls.map((p) => p.userId));
  const officeRecipientsIn = officeRecipients(users, uncovered);
  const withPullers = (base: BoardUser[]): BoardUser[] => {
    const ids = new Set(base.map((u) => u._id.toString()));
    return [...base, ...users.filter((u) => pullerIds.has(u._id.toString()) && !ids.has(u._id.toString()))];
  };
  const officeUsers = withPullers(officeRecipientsIn);
  const approvers = withPullers(officeRecipientsIn.filter((u) => callerHasPermission(profileOf(u), "leave:manage")));

  const auto = await Promise.all([
    safe("period", () => periodCards(userIds, fromKey, toKey, keys)),
    nowInRange ? safe("homework", () => homeworkCards(userIds, todayKey, labels)) : Promise.resolve([]),
    nowInRange ? safe("classTest", () => classTestCards(userIds, todayKey, labels)) : Promise.resolve([]),
    nowInRange ? safe("videoReview", () => videoReviewCards(userIds, todayKey)) : Promise.resolve([]),
    nowInRange ? safe("planReview", () => planReviewCards(userIds, todayKey)) : Promise.resolve([]),
    nowInRange ? safe("observation", () => observationCards(userIds, todayKey)) : Promise.resolve([]),
    nowInRange ? safe("print", () => printCards(officeUsers, todayKey)) : Promise.resolve([]),
    nowInRange ? safe("leave", () => leaveCards(approvers, todayKey)) : Promise.resolve([]),
  ]);
  const pullerNames = new Map<string, string>();
  if (pulls.length) {
    const rows = await User.find({ _id: { $in: [...pullerIds] } }).select("name").lean();
    for (const r of rows) pullerNames.set(r._id.toString(), r.name);
  }
  return sortCards(applyPulls([...manual, ...auto.flat()], pulls, users, pullerNames));
}

/** Pure (WB-5): a pulled office card shows on the puller's board ALONE; an unpulled one
 *  on a backup's board is marked pullable. Desk logins never see a pull button on their
 *  own queue — it is theirs already. */
export function applyPulls(
  cards: WorkCard[],
  pulls: Array<{ kind: string; sourceId: string; userId: string }>,
  users: Array<{ _id: { toString(): string }; role: string; additionalTemplates?: string[] }>,
  names: Map<string, string>,
): WorkCard[] {
  const pulledBy = new Map(pulls.map((p) => [`${p.kind}:${p.sourceId}`, p.userId]));
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  const out: WorkCard[] = [];
  for (const c of cards) {
    if (!(PULLABLE_KINDS as readonly string[]).includes(c.kind) || !c.sourceId) {
      out.push(c);
      continue;
    }
    const owner = pulledBy.get(`${c.kind}:${c.sourceId}`);
    if (owner) {
      if (owner !== c.userId) continue; // taken by someone else — off this board
      out.push({ ...c, pulledById: owner, pulledByName: names.get(owner) ?? null, canPull: false });
      continue;
    }
    const u = byId.get(c.userId);
    out.push({ ...c, canPull: !!u && isBackup(u), pulledById: null, pulledByName: null });
  }
  return out;
}

export interface WorkBoardCounts {
  openToday: number;
  overdue: number;
}

export async function boardCountsFor(user: BoardUser, now = new Date()): Promise<WorkBoardCounts> {
  const todayKey = dateKeyOf(now);
  const cards = await boardFor([user], todayKey, todayKey, now);
  // Only cards DATED today count as "open today": a marks card whose deadline is
  // still ahead sits on a future day and would otherwise inflate the badge above
  // what the board's আজ view shows (prod, 2026-09-30: badge 14 vs tile 11).
  const open = cards.filter((c) => c.status !== "DONE");
  return {
    openToday: open.filter((c) => !c.overdue && c.dateKey === todayKey).length,
    overdue: open.filter((c) => c.overdue).length,
  };
}
