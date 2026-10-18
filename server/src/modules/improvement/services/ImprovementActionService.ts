/**
 * Improvement actions (SP-2..SP-4, docs/prd-student-progress.md §4–§7, D-#735..#738).
 *
 * Writes: create / stop / extend an action, tick / untick a day, set a day's assignee.
 * Reads: the teacher's and guardian's tasks for a day, the Office's list for a day, the
 * action detail (day strips), and the leave cover hand-over rows.
 *
 * WHO does a teacher day is resolved here (§5): override → cover teacher while the
 * assigned teacher is away → the assigned teacher. The pure decision lives in
 * `rules.responsibleFor`; this file only gathers its inputs.
 *
 * Identity plane (ADR-005). Every write leaves an audit row (ADR-008).
 */
import { Types } from "mongoose";
import {
  HW_SUBJECTS,
  IMPROVEMENT_MAX_DAYS,
  IMPROVEMENT_TEACHER_REASONS,
  IMPROVEMENT_GUARDIAN_REASONS,
  IMPROVEMENT_ON_BEHALF_REASONS,
  HW_SUBJECT_LABELS_BN,
  type HwSubject,
  type ImprovementScope,
  type ImprovementRepeat,
  type ImprovementPart,
  type ImprovementTickStatus,
  type ImprovementReason,
  type ImprovementActionState,
} from "@scd/shared";
import { ImprovementAction, type IImprovementAction } from "../models/ImprovementAction";
import { ImprovementTick, type IImprovementTick } from "../models/ImprovementTick";
import { ImprovementDayAssignee } from "../models/ImprovementDayAssignee";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { liveWindow } from "../../routine/liveWindow";
import { StaffCoverSlot } from "../../hr/models/StaffCoverSlot";
import { StaffLeaveApplication } from "../../hr/models/StaffLeaveApplication";
import { resolveStaffProfileForUser } from "../../hr/services/staffMatch";
import { buildIsOpenDayForRange } from "../../trackers/classTestCalendar";
import { dateKeyOf, parseDateKey, isValidDateKey } from "../../attendance/dates";
import { writeAudit } from "../../platform/services/AuditService";
import { emit } from "../../notifications/services/NotificationService";
import {
  scheduleDayKeys,
  actionState,
  dayNumber,
  pastDays,
  responsibleFor,
  addDaysKey,
  type ResponsibleSource,
} from "../rules";
import { personName } from "../../../lib/personName";

export class ImprovementError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ImprovementError";
  }
}

const oid = (id: string | Types.ObjectId): Types.ObjectId => new Types.ObjectId(id.toString());
const str = (id: unknown): string => (id == null ? "" : String(id));
export const todayKey = (now: Date = new Date()): string => dateKeyOf(now);

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** Weekdays (0=Sun) on which the section's live routine has a period of `subject`. */
async function subjectWeekdays(sectionId: string, subject: string, on: Date): Promise<Set<number>> {
  const slots = (await RoutineSlot.find({
    groupType: "section",
    groupId: oid(sectionId),
    subject,
    isBreak: false,
    active: true,
    ...liveWindow(on),
  })
    .select("dayOfWeek")
    .lean()) as unknown as Array<{ dayOfWeek: string }>;
  const idx: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  return new Set(slots.map((s) => idx[s.dayOfWeek]).filter((n) => n !== undefined));
}

async function computeDayKeys(
  sectionId: string,
  subject: string,
  repeat: ImprovementRepeat,
  fromKey: string,
  count: number,
): Promise<string[]> {
  const from = parseDateKey(fromKey);
  // Generous window: SUBJECT_DAYS of a once-a-week subject needs ~7 calendar days each.
  const span = repeat === "SUBJECT_DAYS" ? count * 8 + 30 : count * 2 + 30;
  const isOpen = await buildIsOpenDayForRange(from, new Date(from.getTime() + span * DAY_MS));
  const weekdays = repeat === "SUBJECT_DAYS" ? await subjectWeekdays(sectionId, subject, from) : null;
  return scheduleDayKeys(fromKey, count, (k) => isOpen(parseDateKey(k)), weekdays, span);
}

/** The section's routine teacher for a subject (most periods), or null. */
export async function defaultSubjectTeacher(sectionId: string, subject: string, on = new Date()): Promise<string | null> {
  const slots = (await RoutineSlot.find({
    groupType: "section",
    groupId: oid(sectionId),
    subject,
    isBreak: false,
    active: true,
    teacherId: { $ne: null },
    ...liveWindow(on),
  })
    .select("teacherId")
    .lean()) as unknown as Array<{ teacherId: Types.ObjectId }>;
  const count = new Map<string, number>();
  for (const s of slots) count.set(str(s.teacherId), (count.get(str(s.teacherId)) ?? 0) + 1);
  let best: string | null = null;
  for (const [id, n] of count) if (!best || n > (count.get(best) ?? 0)) best = id;
  return best;
}

// ---------------------------------------------------------------------------
// Create / stop / extend
// ---------------------------------------------------------------------------

export interface CreateActionInput {
  scope: ImprovementScope;
  sectionId: string;
  studentId?: string | null;
  subject: string;
  reason?: string | null;
  teacherTask?: string | null;
  teacherUserId?: string | null;
  guardianTask?: string | null;
  startKey: string;
  days: number;
  repeat: ImprovementRepeat;
  alertClassTeacher?: boolean | null;
}

export async function createAction(input: CreateActionInput, actorId: string, actorRole?: string): Promise<IImprovementAction> {
  if (!(HW_SUBJECTS as readonly string[]).includes(input.subject)) throw new ImprovementError("বিষয়টি সঠিক নয়");
  if (!Types.ObjectId.isValid(input.sectionId)) throw new ImprovementError("শাখাটি পাওয়া যায়নি");
  if (!isValidDateKey(input.startKey)) throw new ImprovementError("শুরুর তারিখ সঠিক নয়");
  if (input.startKey < todayKey()) throw new ImprovementError("শুরুর তারিখ আজ বা পরে হতে হবে");
  const days = Math.floor(input.days);
  if (!(days >= 1 && days <= IMPROVEMENT_MAX_DAYS)) {
    throw new ImprovementError(`দিনের সংখ্যা ১ থেকে ${IMPROVEMENT_MAX_DAYS} এর মধ্যে দিন`);
  }
  const teacherTask = input.teacherTask?.trim() || null;
  const guardianTask = input.guardianTask?.trim() || null;
  if (!teacherTask && !guardianTask) throw new ImprovementError("শিক্ষক বা অভিভাবকের অংশ — অন্তত একটি দিন");

  const section = (await Section.findById(input.sectionId).select("classId active").lean()) as {
    _id: Types.ObjectId;
    classId: Types.ObjectId;
  } | null;
  if (!section) throw new ImprovementError("শাখাটি পাওয়া যায়নি");

  let studentId: Types.ObjectId | null = null;
  if (input.scope === "STUDENT") {
    if (!input.studentId || !Types.ObjectId.isValid(input.studentId)) throw new ImprovementError("শিক্ষার্থী বেছে নিন");
    const st = (await Student.findById(input.studentId).select("sectionId active").lean()) as {
      sectionId: Types.ObjectId;
      active: boolean;
    } | null;
    if (!st || !st.active) throw new ImprovementError("শিক্ষার্থীকে পাওয়া যায়নি");
    if (str(st.sectionId) !== str(section._id)) throw new ImprovementError("শিক্ষার্থী এই শাখার নয়");
    studentId = oid(input.studentId);
  } else if (input.scope !== "CLASS") {
    throw new ImprovementError("কার জন্য — শিক্ষার্থী না পুরো শাখা — বেছে নিন");
  }

  let teacherUserId: Types.ObjectId | null = null;
  if (teacherTask) {
    const chosen = input.teacherUserId || (await defaultSubjectTeacher(input.sectionId, input.subject));
    if (!chosen || !Types.ObjectId.isValid(chosen)) throw new ImprovementError("শিক্ষকের অংশের জন্য একজন শিক্ষক বেছে নিন");
    const u = await User.findOne({ _id: oid(chosen), active: true }).select("_id").lean();
    if (!u) throw new ImprovementError("শিক্ষককে পাওয়া যায়নি");
    teacherUserId = oid(chosen);
  }

  const dayKeys = await computeDayKeys(input.sectionId, input.subject, input.repeat, input.startKey, days);
  if (dayKeys.length === 0) {
    throw new ImprovementError(
      input.repeat === "SUBJECT_DAYS"
        ? "এই শাখার রুটিনে এই বিষয়ের কোনো ক্লাস নেই — 'প্রতিটি স্কুল দিন' বেছে নিন"
        : "এই সময়ে কোনো স্কুল দিন নেই",
    );
  }

  const action = await ImprovementAction.create({
    scope: input.scope,
    sectionId: section._id,
    classId: section.classId,
    studentId,
    subject: input.subject,
    reason: input.reason?.trim() || undefined,
    teacherUserId,
    teacherTask,
    guardianTask,
    repeat: input.repeat,
    days,
    startKey: dayKeys[0],
    dayKeys,
    alertClassTeacher: input.alertClassTeacher ?? true,
    createdBy: oid(actorId),
  });
  await writeAudit({
    eventKind: "IMPROVEMENT_ACTION_CREATED",
    actorId,
    actorRole,
    targetId: action._id,
    targetKind: "ImprovementAction",
    meta: { scope: action.scope, subject: action.subject, days, start: dayKeys[0], end: dayKeys[dayKeys.length - 1] },
  });
  await notifyAssigned(action).catch((err) => console.error("[improvement] assign notify failed:", err));
  return action;
}

export async function stopAction(actionId: string, reason: string | null | undefined, actorId: string, actorRole?: string): Promise<IImprovementAction> {
  const action = await loadAction(actionId);
  if (action.stoppedAt) throw new ImprovementError("কাজটি আগেই বন্ধ করা হয়েছে");
  action.stoppedAt = new Date();
  action.stoppedBy = oid(actorId);
  action.stopReason = reason?.trim() || null;
  await action.save();
  await writeAudit({ eventKind: "IMPROVEMENT_ACTION_STOPPED", actorId, actorRole, targetId: action._id, targetKind: "ImprovementAction", meta: { reason: action.stopReason } });
  return action;
}

export async function extendAction(actionId: string, extraDays: number, actorId: string, actorRole?: string): Promise<IImprovementAction> {
  const action = await loadAction(actionId);
  if (action.stoppedAt) throw new ImprovementError("বন্ধ করা কাজ বাড়ানো যায় না");
  const extra = Math.floor(extraDays);
  if (!(extra >= 1) || action.dayKeys.length + extra > IMPROVEMENT_MAX_DAYS) {
    throw new ImprovementError(`মোট দিন ${IMPROVEMENT_MAX_DAYS} এর বেশি হতে পারে না`);
  }
  const last = action.dayKeys[action.dayKeys.length - 1];
  const from = [addDaysKey(last, 1), todayKey()].sort()[1];
  const more = await computeDayKeys(str(action.sectionId), action.subject, action.repeat, from, extra);
  if (more.length === 0) throw new ImprovementError("আর কোনো স্কুল দিন পাওয়া যায়নি");
  action.dayKeys = [...action.dayKeys, ...more];
  action.days = action.dayKeys.length;
  await action.save();
  await writeAudit({ eventKind: "IMPROVEMENT_ACTION_EXTENDED", actorId, actorRole, targetId: action._id, targetKind: "ImprovementAction", meta: { extra: more.length, end: more[more.length - 1] } });
  return action;
}

async function loadAction(actionId: string) {
  if (!Types.ObjectId.isValid(actionId)) throw new ImprovementError("কাজটি পাওয়া যায়নি");
  const action = await ImprovementAction.findById(actionId);
  if (!action) throw new ImprovementError("কাজটি পাওয়া যায়নি");
  return action;
}

// ---------------------------------------------------------------------------
// Who does a teacher day (§5)
// ---------------------------------------------------------------------------

type LeanAction = Pick<
  IImprovementAction,
  "_id" | "scope" | "sectionId" | "classId" | "studentId" | "subject" | "teacherUserId" | "teacherTask" | "guardianTask" | "dayKeys" | "stoppedAt" | "reason" | "repeat" | "startKey" | "days" | "alertClassTeacher" | "createdBy" | "createdAt" | "stopReason"
>;

export interface DayResponsibility {
  userId: string | null;
  source: ResponsibleSource;
  /** The assigned teacher is away that day. */
  teacherAway: boolean;
  /** The id of the leave making them away, when any. */
  leaveApplicationId: string | null;
}

/**
 * Memoised per call site: one action list can ask the same (teacher, day) many times.
 * `away` reads the teacher's leave; `cover` reads cover slots for the section + subject.
 */
export class ResponsibilityResolver {
  private profileOf = new Map<string, string | null>();
  private leaveOf = new Map<string, { id: string; full: boolean } | null>();
  private coverOf = new Map<string, { userId: string | null; leaveId: string } | null>();
  private overrideOf = new Map<string, string | null>();

  async staffProfile(userId: string): Promise<string | null> {
    if (!this.profileOf.has(userId)) {
      const p = await resolveStaffProfileForUser(userId);
      this.profileOf.set(userId, p ? str(p._id) : null);
    }
    return this.profileOf.get(userId) ?? null;
  }

  /** A live (applied/approved) leave of the teacher covering `dayKey`. */
  async leave(userId: string, dayKey: string): Promise<{ id: string; full: boolean } | null> {
    const k = `${userId}|${dayKey}`;
    if (!this.leaveOf.has(k)) {
      const profileId = await this.staffProfile(userId);
      let found: { id: string; full: boolean } | null = null;
      if (profileId) {
        const leave = (await StaffLeaveApplication.findOne({
          staffProfileId: oid(profileId),
          status: { $in: ["applied", "approved"] },
          fromKey: { $lte: dayKey },
          toKey: { $gte: dayKey },
        })
          .select("_id dayPart")
          .lean()) as { _id: Types.ObjectId; dayPart?: string } | null;
        if (leave) found = { id: str(leave._id), full: !leave.dayPart || leave.dayPart === "full" };
      }
      this.leaveOf.set(k, found);
    }
    return this.leaveOf.get(k) ?? null;
  }

  /** The cover slot of the teacher's period of this section + subject on the day. */
  async cover(userId: string, sectionId: string, subject: string, dayKey: string): Promise<{ userId: string | null; leaveId: string } | null> {
    const k = `${userId}|${sectionId}|${subject}|${dayKey}`;
    if (!this.coverOf.has(k)) {
      const slots = (await StaffCoverSlot.find({
        absentTeacherUserId: oid(userId),
        sectionId: oid(sectionId),
        dateKey: dayKey,
      })
        .select("routineSlotId finalCoverTeacherUserId proposedCoverTeacherId leaveApplicationId periodNumber")
        .sort({ periodNumber: 1 })
        .lean()) as unknown as Array<{
        routineSlotId: Types.ObjectId;
        finalCoverTeacherUserId?: Types.ObjectId | null;
        proposedCoverTeacherId?: Types.ObjectId | null;
        leaveApplicationId: Types.ObjectId;
      }>;
      let found: { userId: string | null; leaveId: string } | null = null;
      if (slots.length) {
        const live = (await StaffLeaveApplication.find({
          _id: { $in: slots.map((s) => s.leaveApplicationId) },
          status: { $in: ["applied", "approved"] },
        })
          .select("_id")
          .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
        const liveIds = new Set(live.map((l) => str(l._id)));
        const routine = (await RoutineSlot.find({ _id: { $in: slots.map((s) => s.routineSlotId) } })
          .select("_id subject")
          .lean()) as unknown as Array<{ _id: Types.ObjectId; subject: string }>;
        const subjectOf = new Map(routine.map((r) => [str(r._id), r.subject]));
        const match = slots.find((s) => liveIds.has(str(s.leaveApplicationId)) && subjectOf.get(str(s.routineSlotId)) === subject);
        if (match) {
          const who = match.finalCoverTeacherUserId ?? match.proposedCoverTeacherId ?? null;
          found = { userId: who ? str(who) : null, leaveId: str(match.leaveApplicationId) };
        }
      }
      this.coverOf.set(k, found);
    }
    return this.coverOf.get(k) ?? null;
  }

  async override(actionId: string, dayKey: string): Promise<string | null> {
    const k = `${actionId}|${dayKey}`;
    if (!this.overrideOf.has(k)) {
      const row = (await ImprovementDayAssignee.findOne({ actionId: oid(actionId), dayKey }).select("userId").lean()) as {
        userId: Types.ObjectId;
      } | null;
      this.overrideOf.set(k, row ? str(row.userId) : null);
    }
    return this.overrideOf.get(k) ?? null;
  }

  async forDay(action: LeanAction, dayKey: string): Promise<DayResponsibility> {
    const assigned = str(action.teacherUserId);
    const override = await this.override(str(action._id), dayKey);
    const cover = await this.cover(assigned, str(action.sectionId), action.subject, dayKey);
    const leave = cover ? null : await this.leave(assigned, dayKey);
    // Away = this exact period is covered (full or partial leave), or a FULL-day leave
    // with no period of the subject that day (nobody to hand it to → NONE).
    const teacherAway = !!cover || !!leave?.full;
    const r = responsibleFor({ assignedUserId: assigned, overrideUserId: override, teacherAway, coverUserId: cover?.userId ?? null });
    return { ...r, teacherAway, leaveApplicationId: cover?.leaveId ?? leave?.id ?? null };
  }
}

// ---------------------------------------------------------------------------
// Ticks
// ---------------------------------------------------------------------------

export interface TickInput {
  actionId: string;
  part: ImprovementPart;
  dayKey: string;
  studentId?: string | null;
  status: ImprovementTickStatus;
  reason?: ImprovementReason | null;
}

export interface Caller {
  userId?: string | null;
  guardianId?: string | null;
  role?: string;
  /** Holds roster:manage — Office/Principal. */
  isAdmin: boolean;
}

function checkReason(part: ImprovementPart, status: ImprovementTickStatus, reason: ImprovementReason | null | undefined, onBehalf: boolean): ImprovementReason | null {
  if (status === "DONE") {
    if (!onBehalf) return null;
    if (!reason || !(IMPROVEMENT_ON_BEHALF_REASONS as readonly string[]).includes(reason)) {
      throw new ImprovementError("কীভাবে জানলেন তা বেছে নিন");
    }
    return reason;
  }
  const allowed = part === "TEACHER" ? IMPROVEMENT_TEACHER_REASONS : IMPROVEMENT_GUARDIAN_REASONS;
  if (!reason || !(allowed as readonly string[]).includes(reason)) throw new ImprovementError("কারণ বেছে নিন");
  return reason;
}

/** Is `studentId` covered by the action (STUDENT: that child; CLASS: in the section)? */
async function actionCoversStudent(action: LeanAction, studentId: string): Promise<boolean> {
  if (action.scope === "STUDENT") return str(action.studentId) === studentId;
  const st = (await Student.findById(studentId).select("sectionId active").lean()) as { sectionId: Types.ObjectId; active: boolean } | null;
  return !!st && st.active && str(st.sectionId) === str(action.sectionId);
}

export async function tick(input: TickInput, caller: Caller): Promise<IImprovementTick> {
  const action = (await loadAction(input.actionId)).toObject() as LeanAction;
  if (action.stoppedAt) throw new ImprovementError("কাজটি বন্ধ করা হয়েছে");
  if (!action.dayKeys.includes(input.dayKey)) throw new ImprovementError("এই দিনটি কাজের তালিকায় নেই");
  const today = todayKey();
  if (input.dayKey > today) throw new ImprovementError("আগামী দিনের কাজ আগে চিহ্নিত করা যায় না");

  let onBehalf = false;
  let asCover = false;
  let studentId: Types.ObjectId | null = null;

  if (input.part === "TEACHER") {
    if (!action.teacherTask) throw new ImprovementError("এই কাজে শিক্ষকের অংশ নেই");
    if (!caller.userId) throw new ImprovementError("শিক্ষকের অংশ শুধু স্কুলের কর্মীরা চিহ্নিত করতে পারেন");
    const r = await new ResponsibilityResolver().forDay(action, input.dayKey);
    const isResponsible = r.userId === caller.userId;
    if (isResponsible && input.dayKey === today) {
      asCover = r.source === "COVER" || (r.source === "OVERRIDE" && r.userId !== str(action.teacherUserId));
    } else if (caller.isAdmin) {
      onBehalf = true;
    } else {
      throw new ImprovementError(isResponsible ? "শুধু আজকের কাজ চিহ্নিত করা যায়" : "এই দিনের কাজটি আপনার নয়");
    }
  } else {
    if (!action.guardianTask) throw new ImprovementError("এই কাজে অভিভাবকের অংশ নেই");
    if (!caller.guardianId) throw new ImprovementError("অভিভাবকের অংশ শুধু অভিভাবক চিহ্নিত করতে পারেন");
    if (input.dayKey !== today) throw new ImprovementError("শুধু আজকের কাজ চিহ্নিত করা যায়");
    if (!input.studentId || !Types.ObjectId.isValid(input.studentId)) throw new ImprovementError("সন্তান বেছে নিন");
    const link = await GuardianLink.findOne({
      guardianId: oid(caller.guardianId),
      studentId: oid(input.studentId),
      active: { $ne: false },
    })
      .select("_id")
      .lean();
    if (!link) throw new ImprovementError("এই শিক্ষার্থী আপনার সাথে যুক্ত নয়");
    if (!(await actionCoversStudent(action, input.studentId))) throw new ImprovementError("এই কাজটি এই শিক্ষার্থীর জন্য নয়");
    studentId = oid(input.studentId);
  }

  const reason = checkReason(input.part, input.status, input.reason, onBehalf);
  const filter = { actionId: action._id, part: input.part, dayKey: input.dayKey, studentId };
  const existing = await ImprovementTick.findOne(filter).select("_id").lean();
  if (existing) throw new ImprovementError("এই দিনটি আগেই চিহ্নিত করা হয়েছে — আগে বাতিল করুন");
  const row = await ImprovementTick.create({
    ...filter,
    status: input.status,
    reason,
    markedByUserId: caller.userId ? oid(caller.userId) : null,
    markedByGuardianId: caller.guardianId ? oid(caller.guardianId) : null,
    onBehalf,
    asCover,
  });
  await writeAudit({
    eventKind: "IMPROVEMENT_TICKED",
    actorId: caller.userId ?? caller.guardianId ?? undefined,
    actorRole: caller.role,
    targetId: action._id,
    targetKind: "ImprovementAction",
    meta: { part: input.part, day: input.dayKey, status: input.status, reason, onBehalf, asCover, studentId: studentId ? str(studentId) : null },
  });
  return row;
}

/** Same-day undo, by whoever ticked it or by Office/Principal. */
export async function untick(
  input: { actionId: string; part: ImprovementPart; dayKey: string; studentId?: string | null },
  caller: Caller,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(input.actionId)) throw new ImprovementError("কাজটি পাওয়া যায়নি");
  const filter = {
    actionId: oid(input.actionId),
    part: input.part,
    dayKey: input.dayKey,
    studentId: input.part === "GUARDIAN" && input.studentId && Types.ObjectId.isValid(input.studentId) ? oid(input.studentId) : null,
  };
  const row = (await ImprovementTick.findOne(filter).lean()) as IImprovementTick | null;
  if (!row) return false;
  const mine =
    (caller.userId && str(row.markedByUserId) === caller.userId) ||
    (caller.guardianId && input.part === "GUARDIAN" && (await GuardianLink.exists({ guardianId: oid(caller.guardianId), studentId: row.studentId, active: { $ne: false } })));
  if (!mine && !caller.isAdmin) throw new ImprovementError("এটি আপনি চিহ্নিত করেননি");
  if (!caller.isAdmin && input.dayKey !== todayKey()) throw new ImprovementError("শুধু আজকের চিহ্ন বাতিল করা যায়");
  await ImprovementTick.deleteOne({ _id: row._id });
  await writeAudit({
    eventKind: "IMPROVEMENT_UNTICKED",
    actorId: caller.userId ?? caller.guardianId ?? undefined,
    actorRole: caller.role,
    targetId: row.actionId,
    targetKind: "ImprovementAction",
    meta: { part: row.part, day: row.dayKey, was: row.status, studentId: row.studentId ? str(row.studentId) : null },
  });
  return true;
}

export async function setDayAssignee(actionId: string, dayKey: string, userId: string | null, actorId: string, actorRole?: string): Promise<boolean> {
  const action = await loadAction(actionId);
  if (!action.teacherTask) throw new ImprovementError("এই কাজে শিক্ষকের অংশ নেই");
  if (!action.dayKeys.includes(dayKey)) throw new ImprovementError("এই দিনটি কাজের তালিকায় নেই");
  if (userId) {
    if (!Types.ObjectId.isValid(userId) || !(await User.exists({ _id: oid(userId), active: true }))) {
      throw new ImprovementError("শিক্ষককে পাওয়া যায়নি");
    }
    await ImprovementDayAssignee.updateOne(
      { actionId: action._id, dayKey },
      { $set: { userId: oid(userId), setBy: oid(actorId) } },
      { upsert: true },
    );
  } else {
    await ImprovementDayAssignee.deleteOne({ actionId: action._id, dayKey });
  }
  await writeAudit({ eventKind: "IMPROVEMENT_ASSIGNEE_SET", actorId, actorRole, targetId: action._id, targetKind: "ImprovementAction", meta: { day: dayKey, userId } });
  return true;
}

// ---------------------------------------------------------------------------
// Reads — shared shapes
// ---------------------------------------------------------------------------

export interface TaskRow {
  actionId: string;
  part: ImprovementPart;
  dayKey: string;
  dayNumber: number;
  totalDays: number;
  scope: ImprovementScope;
  subject: string;
  sectionId: string;
  classLevel: number | null;
  sectionNameBn: string;
  studentId: string | null;
  studentName: string | null;
  task: string;
  /** Teacher part: who does it today, and whether that is a hand-over. */
  responsibleUserId: string | null;
  responsibleName: string | null;
  responsibleSource: ResponsibleSource | null;
  assignedTeacherName: string | null;
  /** Ticks so far on this part (for this child on the guardian side), and days passed incl. today. */
  doneSoFar: number;
  daysSoFar: number;
  /** Today's answer, when given. */
  status: ImprovementTickStatus | null;
  reason: ImprovementReason | null;
  markedByName: string | null;
  onBehalf: boolean;
  markedByMe: boolean;
}

interface Names {
  users: Map<string, string>;
  students: Map<string, { name: string; nameBn: string | null; sectionId: string }>;
  sections: Map<string, { nameBn: string; classId: string; classLevel: number | null }>;
}

async function loadNames(userIds: string[], studentIds: string[], sectionIds: string[]): Promise<Names> {
  const uniq = (a: string[]) => [...new Set(a.filter(Boolean))].map((id) => oid(id));
  const [users, students, sections] = await Promise.all([
    User.find({ _id: { $in: uniq(userIds) } }).select("name").lean() as unknown as Promise<Array<{ _id: Types.ObjectId; name: string }>>,
    Student.find({ _id: { $in: uniq(studentIds) } }).select("name nameBn sectionId").lean() as unknown as Promise<Array<{ _id: Types.ObjectId; name: string; nameBn?: string; sectionId: Types.ObjectId }>>,
    Section.find({ _id: { $in: uniq(sectionIds) } }).select("nameBn classId").lean() as unknown as Promise<Array<{ _id: Types.ObjectId; nameBn: string; classId: Types.ObjectId }>>,
  ]);
  const classes = (await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("level").lean()) as unknown as Array<{ _id: Types.ObjectId; level: number }>;
  const levelOf = new Map(classes.map((c) => [str(c._id), c.level]));
  return {
    users: new Map(users.map((u) => [str(u._id), u.name])),
    students: new Map(students.map((s) => [str(s._id), { name: s.name, nameBn: s.nameBn ?? null, sectionId: str(s.sectionId) }])),
    sections: new Map(sections.map((s) => [str(s._id), { nameBn: s.nameBn, classId: str(s.classId), classLevel: levelOf.get(str(s.classId)) ?? null }])),
  };
}

const live = (dayKey: string) => ({ dayKeys: dayKey, stoppedAt: null });

function baseRow(a: LeanAction, part: ImprovementPart, dayKey: string, names: Names) {
  const sec = names.sections.get(str(a.sectionId));
  const st = a.studentId ? names.students.get(str(a.studentId)) : null;
  return {
    actionId: str(a._id),
    part,
    dayKey,
    dayNumber: dayNumber(a.dayKeys, dayKey),
    totalDays: a.dayKeys.length,
    scope: a.scope,
    subject: a.subject,
    sectionId: str(a.sectionId),
    classLevel: sec?.classLevel ?? null,
    sectionNameBn: sec?.nameBn ?? "",
    studentId: a.studentId ? str(a.studentId) : null,
    studentName: st ? personName(st) : null,
    task: (part === "TEACHER" ? a.teacherTask : a.guardianTask) ?? "",
  };
}

// ---------------------------------------------------------------------------
// The teacher's day (Today card)
// ---------------------------------------------------------------------------

export async function teacherTasks(userId: string, dayKey = todayKey()): Promise<TaskRow[]> {
  const candidates = (await ImprovementAction.find({ ...live(dayKey), teacherTask: { $ne: null } }).lean()) as unknown as LeanAction[];
  const resolver = new ResponsibilityResolver();
  const mine: Array<{ a: LeanAction; r: DayResponsibility }> = [];
  for (const a of candidates) {
    const r = await resolver.forDay(a, dayKey);
    if (r.userId === userId) mine.push({ a, r });
  }
  if (!mine.length) return [];
  const ticks = (await ImprovementTick.find({ actionId: { $in: mine.map((m) => m.a._id) }, part: "TEACHER" }).lean()) as unknown as IImprovementTick[];
  const names = await loadNames(
    [...mine.map((m) => str(m.a.teacherUserId)), ...ticks.map((t) => str(t.markedByUserId))],
    mine.map((m) => str(m.a.studentId)),
    mine.map((m) => str(m.a.sectionId)),
  );
  return mine.map(({ a, r }) => {
    const mineTicks = ticks.filter((t) => str(t.actionId) === str(a._id));
    const today = mineTicks.find((t) => t.dayKey === dayKey);
    return {
      ...baseRow(a, "TEACHER", dayKey, names),
      responsibleUserId: r.userId,
      responsibleName: r.userId ? names.users.get(r.userId) ?? null : null,
      responsibleSource: r.source,
      assignedTeacherName: names.users.get(str(a.teacherUserId)) ?? null,
      doneSoFar: mineTicks.filter((t) => t.status === "DONE" && t.dayKey <= dayKey).length,
      daysSoFar: a.dayKeys.filter((k) => k <= dayKey).length,
      status: today?.status ?? null,
      reason: today?.reason ?? null,
      markedByName: today?.markedByUserId ? names.users.get(str(today.markedByUserId)) ?? null : null,
      onBehalf: !!today?.onBehalf,
      markedByMe: !!today && str(today.markedByUserId) === userId,
    };
  });
}

// ---------------------------------------------------------------------------
// The guardian's day (guardian Today card) — for ONE child
// ---------------------------------------------------------------------------

export async function guardianTasks(studentId: string, guardianId: string, dayKey = todayKey()): Promise<TaskRow[]> {
  const st = (await Student.findById(studentId).select("sectionId active").lean()) as { sectionId: Types.ObjectId; active: boolean } | null;
  if (!st || !st.active) return [];
  const actions = (await ImprovementAction.find({
    ...live(dayKey),
    guardianTask: { $ne: null },
    $or: [{ scope: "STUDENT", studentId: oid(studentId) }, { scope: "CLASS", sectionId: st.sectionId }],
  }).lean()) as unknown as LeanAction[];
  if (!actions.length) return [];
  const ticks = (await ImprovementTick.find({
    actionId: { $in: actions.map((a) => a._id) },
    part: "GUARDIAN",
    studentId: oid(studentId),
  }).lean()) as unknown as IImprovementTick[];
  const names = await loadNames([], [studentId], actions.map((a) => str(a.sectionId)));
  return actions.map((a) => {
    const mine = ticks.filter((t) => str(t.actionId) === str(a._id));
    const today = mine.find((t) => t.dayKey === dayKey);
    return {
      ...baseRow(a, "GUARDIAN", dayKey, names),
      studentId,
      studentName: personName(names.students.get(studentId)) || null,
      responsibleUserId: null,
      responsibleName: null,
      responsibleSource: null,
      assignedTeacherName: null,
      doneSoFar: mine.filter((t) => t.status === "DONE" && t.dayKey <= dayKey).length,
      daysSoFar: a.dayKeys.filter((k) => k <= dayKey).length,
      status: today?.status ?? null,
      reason: today?.reason ?? null,
      markedByName: null,
      onBehalf: false,
      markedByMe: !!today && str(today.markedByGuardianId) === guardianId,
    };
  });
}

/** Past scheduled days' answers for one child on one action — the guardian card's streak row. */
export async function guardianStreak(actionId: string, studentId: string): Promise<Array<{ dayKey: string; status: ImprovementTickStatus | null }>> {
  const action = (await ImprovementAction.findById(actionId).select("dayKeys").lean()) as { dayKeys: string[] } | null;
  if (!action) return [];
  const ticks = (await ImprovementTick.find({ actionId: oid(actionId), part: "GUARDIAN", studentId: oid(studentId) }).select("dayKey status").lean()) as unknown as Array<{ dayKey: string; status: ImprovementTickStatus }>;
  const by = new Map(ticks.map((t) => [t.dayKey, t.status]));
  return action.dayKeys.map((k) => ({ dayKey: k, status: by.get(k) ?? null }));
}

// ---------------------------------------------------------------------------
// The Office/Principal's day — every teacher task of a day (11:00 list)
// ---------------------------------------------------------------------------

export async function officeDayTasks(dayKey = todayKey(), viewerUserId?: string): Promise<TaskRow[]> {
  const actions = (await ImprovementAction.find({ ...live(dayKey), teacherTask: { $ne: null } }).lean()) as unknown as LeanAction[];
  if (!actions.length) return [];
  const resolver = new ResponsibilityResolver();
  const resp = new Map<string, DayResponsibility>();
  for (const a of actions) resp.set(str(a._id), await resolver.forDay(a, dayKey));
  const ticks = (await ImprovementTick.find({ actionId: { $in: actions.map((a) => a._id) }, part: "TEACHER" }).lean()) as unknown as IImprovementTick[];
  const names = await loadNames(
    [...actions.map((a) => str(a.teacherUserId)), ...[...resp.values()].map((r) => r.userId ?? ""), ...ticks.map((t) => str(t.markedByUserId))],
    actions.map((a) => str(a.studentId)),
    actions.map((a) => str(a.sectionId)),
  );
  return actions.map((a) => {
    const r = resp.get(str(a._id))!;
    const mine = ticks.filter((t) => str(t.actionId) === str(a._id));
    const today = mine.find((t) => t.dayKey === dayKey);
    return {
      ...baseRow(a, "TEACHER", dayKey, names),
      responsibleUserId: r.userId,
      responsibleName: r.userId ? names.users.get(r.userId) ?? null : null,
      responsibleSource: r.source,
      assignedTeacherName: names.users.get(str(a.teacherUserId)) ?? null,
      doneSoFar: mine.filter((t) => t.status === "DONE" && t.dayKey <= dayKey).length,
      daysSoFar: a.dayKeys.filter((k) => k <= dayKey).length,
      status: today?.status ?? null,
      reason: today?.reason ?? null,
      markedByName: today?.markedByUserId ? names.users.get(str(today.markedByUserId)) ?? null : null,
      onBehalf: !!today?.onBehalf,
      markedByMe: !!today && !!viewerUserId && str(today.markedByUserId) === viewerUserId,
    };
  });
}

// ---------------------------------------------------------------------------
// Action summaries + detail
// ---------------------------------------------------------------------------

export interface ActionSummary {
  id: string;
  scope: ImprovementScope;
  subject: string;
  sectionId: string;
  classLevel: number | null;
  sectionNameBn: string;
  studentId: string | null;
  studentName: string | null;
  reason: string | null;
  teacherTask: string | null;
  teacherUserId: string | null;
  teacherName: string | null;
  guardianTask: string | null;
  repeat: ImprovementRepeat;
  startKey: string;
  endKey: string;
  dayKeys: string[];
  state: ImprovementActionState;
  dayNumber: number;
  createdByName: string | null;
  createdAt: string;
  stopReason: string | null;
  /** Teacher part: done days / scheduled days passed (incl. today). */
  teacherDone: number;
  teacherOwed: number;
  teacherNotMarked: number;
  /** Guardian part: done ticks / (owed days × children). */
  guardianDone: number;
  guardianOwed: number;
  alertClassTeacher: boolean;
}

export async function summarize(actions: LeanAction[], today = todayKey()): Promise<ActionSummary[]> {
  if (!actions.length) return [];
  const ticks = (await ImprovementTick.find({ actionId: { $in: actions.map((a) => a._id) } }).select("actionId part dayKey status").lean()) as unknown as IImprovementTick[];
  const names = await loadNames(
    [...actions.map((a) => str(a.teacherUserId)), ...actions.map((a) => str(a.createdBy))],
    actions.map((a) => str(a.studentId)),
    actions.map((a) => str(a.sectionId)),
  );
  // CLASS guardian denominators: active students per section.
  const classSections = [...new Set(actions.filter((a) => a.scope === "CLASS" && a.guardianTask).map((a) => str(a.sectionId)))];
  const sizes = new Map<string, number>();
  for (const s of classSections) sizes.set(s, await Student.countDocuments({ sectionId: oid(s), active: true }));

  return actions.map((a) => {
    const stopKey = a.stoppedAt ? dateKeyOf(new Date(a.stoppedAt)) : null;
    const owedKeys = a.dayKeys.filter((k) => k <= today && (!stopKey || k <= stopKey));
    const past = pastDays(a.dayKeys, today, stopKey ? addDaysKey(stopKey, 1) : null);
    const mine = ticks.filter((t) => str(t.actionId) === str(a._id));
    const tDays = new Set(mine.filter((t) => t.part === "TEACHER").map((t) => t.dayKey));
    const sec = names.sections.get(str(a.sectionId));
    const st = a.studentId ? names.students.get(str(a.studentId)) : null;
    const kids = a.scope === "CLASS" ? sizes.get(str(a.sectionId)) ?? 0 : 1;
    return {
      id: str(a._id),
      scope: a.scope,
      subject: a.subject,
      sectionId: str(a.sectionId),
      classLevel: sec?.classLevel ?? null,
      sectionNameBn: sec?.nameBn ?? "",
      studentId: a.studentId ? str(a.studentId) : null,
      studentName: st ? personName(st) : null,
      reason: a.reason ?? null,
      teacherTask: a.teacherTask ?? null,
      teacherUserId: a.teacherUserId ? str(a.teacherUserId) : null,
      teacherName: names.users.get(str(a.teacherUserId)) ?? null,
      guardianTask: a.guardianTask ?? null,
      repeat: a.repeat,
      startKey: a.dayKeys[0] ?? a.startKey,
      endKey: a.dayKeys[a.dayKeys.length - 1] ?? a.startKey,
      dayKeys: a.dayKeys,
      state: actionState(a.dayKeys, !!a.stoppedAt, today),
      dayNumber: dayNumber(a.dayKeys, today),
      createdByName: names.users.get(str(a.createdBy)) ?? null,
      createdAt: new Date(a.createdAt).toISOString(),
      stopReason: a.stopReason ?? null,
      teacherDone: a.teacherTask ? mine.filter((t) => t.part === "TEACHER" && t.status === "DONE" && owedKeys.includes(t.dayKey)).length : 0,
      teacherOwed: a.teacherTask ? owedKeys.length : 0,
      teacherNotMarked: a.teacherTask ? past.filter((k) => !tDays.has(k)).length : 0,
      guardianDone: a.guardianTask ? mine.filter((t) => t.part === "GUARDIAN" && t.status === "DONE" && owedKeys.includes(t.dayKey)).length : 0,
      guardianOwed: a.guardianTask ? owedKeys.length * kids : 0,
      alertClassTeacher: a.alertClassTeacher,
    };
  });
}

export async function listActions(filter: { studentId?: string | null; sectionId?: string | null }): Promise<ActionSummary[]> {
  const q: Record<string, unknown> = {};
  if (filter.studentId && Types.ObjectId.isValid(filter.studentId)) {
    const st = (await Student.findById(filter.studentId).select("sectionId").lean()) as { sectionId: Types.ObjectId } | null;
    q.$or = [{ scope: "STUDENT", studentId: oid(filter.studentId) }, ...(st ? [{ scope: "CLASS", sectionId: st.sectionId }] : [])];
  } else if (filter.sectionId && Types.ObjectId.isValid(filter.sectionId)) {
    q.sectionId = oid(filter.sectionId);
  }
  const actions = (await ImprovementAction.find(q).sort({ createdAt: -1 }).limit(300).lean()) as unknown as LeanAction[];
  const rows = await summarize(actions);
  const order: Record<ImprovementActionState, number> = { RUNNING: 0, UPCOMING: 1, ENDED: 2, STOPPED: 3 };
  return rows.sort((x, y) => order[x.state] - order[y.state]);
}

export interface DayCell {
  dayKey: string;
  /** DONE / COULDNT / null (not marked yet or still to come). */
  status: ImprovementTickStatus | null;
  reason: ImprovementReason | null;
  /** Who: SELF (the assigned teacher), COVER, OFFICE (on behalf), GUARDIAN. */
  by: "SELF" | "COVER" | "OFFICE" | "GUARDIAN" | null;
  byName: string | null;
  future: boolean;
}

export interface FamilyRow {
  studentId: string;
  name: string;
  done: number;
  owed: number;
  last3: Array<ImprovementTickStatus | null>;
}

export interface ActionDetail {
  summary: ActionSummary;
  teacherDays: DayCell[];
  guardianDays: DayCell[];
  families: FamilyRow[];
  /** Today's teacher hand-over, when the assigned teacher is away. */
  todayResponsibleName: string | null;
  todayResponsibleSource: ResponsibleSource | null;
}

export async function actionDetail(actionId: string, today = todayKey()): Promise<ActionDetail> {
  const action = (await loadAction(actionId)).toObject() as LeanAction;
  const [summary] = await summarize([action], today);
  const ticks = (await ImprovementTick.find({ actionId: action._id }).lean()) as unknown as IImprovementTick[];
  const names = await loadNames(ticks.map((t) => str(t.markedByUserId)), ticks.map((t) => str(t.studentId)), []);

  const cell = (dayKey: string, t: IImprovementTick | undefined, part: ImprovementPart): DayCell => {
    let by: DayCell["by"] = null;
    if (t) {
      if (part === "GUARDIAN") by = "GUARDIAN";
      else if (t.onBehalf) by = "OFFICE";
      else if (t.asCover) by = "COVER";
      else by = "SELF";
    }
    return {
      dayKey,
      status: t?.status ?? null,
      reason: t?.reason ?? null,
      by,
      byName: t?.markedByUserId ? names.users.get(str(t.markedByUserId)) ?? null : null,
      future: dayKey > today,
    };
  };

  const teacherDays = action.teacherTask
    ? action.dayKeys.map((k) => cell(k, ticks.find((t) => t.part === "TEACHER" && t.dayKey === k), "TEACHER"))
    : [];
  const guardianDays =
    action.guardianTask && action.scope === "STUDENT"
      ? action.dayKeys.map((k) => cell(k, ticks.find((t) => t.part === "GUARDIAN" && t.dayKey === k && str(t.studentId) === str(action.studentId)), "GUARDIAN"))
      : [];

  let families: FamilyRow[] = [];
  if (action.guardianTask && action.scope === "CLASS") {
    const kids = (await Student.find({ sectionId: action.sectionId, active: true }).select("name nameBn rollNumber").sort({ rollNumber: 1, name: 1 }).lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string }>;
    const owedKeys = action.dayKeys.filter((k) => k <= today);
    families = kids
      .map((k) => {
        const mine = ticks.filter((t) => t.part === "GUARDIAN" && str(t.studentId) === str(k._id));
        const by = new Map(mine.map((t) => [t.dayKey, t.status]));
        return {
          studentId: str(k._id),
          name: personName(k),
          done: mine.filter((t) => t.status === "DONE" && owedKeys.includes(t.dayKey)).length,
          owed: owedKeys.length,
          last3: owedKeys.slice(-3).map((d) => by.get(d) ?? null),
        };
      })
      .sort((a, b) => a.done - b.done || a.name.localeCompare(b.name));
  }

  let todayResponsibleName: string | null = null;
  let todayResponsibleSource: ResponsibleSource | null = null;
  if (action.teacherTask && action.dayKeys.includes(today) && !action.stoppedAt) {
    const r = await new ResponsibilityResolver().forDay(action, today);
    todayResponsibleSource = r.source;
    if (r.userId) {
      const u = (await User.findById(r.userId).select("name").lean()) as { name: string } | null;
      todayResponsibleName = u?.name ?? null;
    }
  }
  return { summary, teacherDays, guardianDays, families, todayResponsibleName, todayResponsibleSource };
}

// ---------------------------------------------------------------------------
// Leave hand-over rows (§5) — for the leave cover screen
// ---------------------------------------------------------------------------

export interface LeaveTaskRow {
  actionId: string;
  dayKey: string;
  scope: ImprovementScope;
  subject: string;
  classLevel: number | null;
  sectionNameBn: string;
  studentName: string | null;
  task: string;
  dayNumber: number;
  totalDays: number;
  responsibleUserId: string | null;
  responsibleName: string | null;
  source: ResponsibleSource;
}

export async function leaveTasks(leaveApplicationId: string): Promise<{ teacherUserId: string | null; rows: LeaveTaskRow[] }> {
  if (!Types.ObjectId.isValid(leaveApplicationId)) throw new ImprovementError("ছুটির আবেদনটি পাওয়া যায়নি");
  const leave = (await StaffLeaveApplication.findById(leaveApplicationId).select("staffProfileId fromKey toKey status").lean()) as {
    staffProfileId: Types.ObjectId;
    fromKey: string;
    toKey: string;
  } | null;
  if (!leave) throw new ImprovementError("ছুটির আবেদনটি পাওয়া যায়নি");
  const { resolveUserIdForStaff } = await import("../../hr/services/staffMatch");
  const teacherUserId = await resolveUserIdForStaff(str(leave.staffProfileId));
  if (!teacherUserId) return { teacherUserId: null, rows: [] };
  const actions = (await ImprovementAction.find({
    teacherUserId: oid(teacherUserId),
    teacherTask: { $ne: null },
    stoppedAt: null,
    dayKeys: { $elemMatch: { $gte: leave.fromKey, $lte: leave.toKey } },
  }).lean()) as unknown as LeanAction[];
  if (!actions.length) return { teacherUserId, rows: [] };
  const resolver = new ResponsibilityResolver();
  const pending: Array<{ a: LeanAction; dayKey: string; r: DayResponsibility }> = [];
  for (const a of actions) {
    for (const k of a.dayKeys.filter((d) => d >= leave.fromKey && d <= leave.toKey)) {
      pending.push({ a, dayKey: k, r: await resolver.forDay(a, k) });
    }
  }
  const names = await loadNames(
    pending.map((p) => p.r.userId ?? ""),
    actions.map((a) => str(a.studentId)),
    actions.map((a) => str(a.sectionId)),
  );
  const rows = pending.map(({ a, dayKey, r }) => {
    const b = baseRow(a, "TEACHER", dayKey, names);
    return {
      actionId: b.actionId,
      dayKey,
      scope: b.scope,
      subject: b.subject,
      classLevel: b.classLevel,
      sectionNameBn: b.sectionNameBn,
      studentName: b.studentName,
      task: b.task,
      dayNumber: b.dayNumber,
      totalDays: b.totalDays,
      responsibleUserId: r.userId,
      responsibleName: r.userId ? names.users.get(r.userId) ?? null : null,
      source: r.source,
    };
  });
  rows.sort((x, y) => x.dayKey.localeCompare(y.dayKey) || x.subject.localeCompare(y.subject));
  return { teacherUserId, rows };
}

// ---------------------------------------------------------------------------
// Notifications (§7, D-#738)
// ---------------------------------------------------------------------------

const subjectBn = (s: string): string => (HW_SUBJECT_LABELS_BN as Record<string, string>)[s] ?? s;

async function notifyAssigned(action: IImprovementAction): Promise<void> {
  const names = await loadNames([], action.studentId ? [str(action.studentId)] : [], [str(action.sectionId)]);
  const who = action.studentId ? names.students.get(str(action.studentId)) : null;
  const target = who ? personName(who) : names.sections.get(str(action.sectionId))?.nameBn ?? "";
  const days = action.dayKeys.length;
  const refs = { improvementActionId: str(action._id), date: action.dayKeys[0] };
  if (action.teacherUserId && action.teacherTask) {
    await emit({
      recipientUserId: str(action.teacherUserId),
      kind: "IMPROVEMENT_ACTION_ASSIGNED",
      titleBn: `নতুন উন্নতির কাজ — ${subjectBn(action.subject)}`,
      bodyBn: `${target}: ${action.teacherTask} (${days} স্কুল দিন, শুরু ${action.dayKeys[0]})`,
      refs,
      dedupeKey: `IAA:${str(action._id)}:U:${str(action.teacherUserId)}`,
    });
  }
  if (action.guardianTask) {
    const studentIds = action.studentId
      ? [action.studentId]
      : ((await Student.find({ sectionId: action.sectionId, active: true }).select("_id").lean()) as unknown as Array<{ _id: Types.ObjectId }>).map((s) => s._id);
    const links = (await GuardianLink.find({ studentId: { $in: studentIds }, active: { $ne: false } }).select("guardianId studentId").lean()) as unknown as Array<{ guardianId: Types.ObjectId; studentId: Types.ObjectId }>;
    const seen = new Set<string>();
    for (const l of links) {
      const g = str(l.guardianId);
      if (seen.has(g)) continue;
      seen.add(g);
      await emit({
        recipientGuardianId: g,
        kind: "IMPROVEMENT_ACTION_ASSIGNED",
        titleBn: `স্কুল থেকে প্রতিদিনের কাজ — ${subjectBn(action.subject)}`,
        bodyBn: `${action.guardianTask} (${days} স্কুল দিন, শুরু ${action.dayKeys[0]}) — প্রতিদিন অ্যাপে "আজ করেছি" চাপুন।`,
        refs: { ...refs, studentId: str(l.studentId) },
        dedupeKey: `IAA:${str(action._id)}:G:${g}`,
      });
    }
  }
}

export { DAY_MS as IMPROVEMENT_DAY_MS };
