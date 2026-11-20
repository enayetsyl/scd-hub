/**
 * Exam duty roster (D-#1660) — who invigilates each sitting of the exam routine (D-#883).
 *
 *   examDutyRoster   — exam:manage: every sitting of the routine with its invigilators, the
 *                      conflicts, and a per-teacher count (fairness).
 *   myExamDuties     — exam:read: the caller's own upcoming duties (the teacher's screen + Today).
 *   assignExamDuty   — exam:manage: put a teacher on a sitting seat, or swap the teacher
 *                      already there (a reason is then required). Audited; the teacher is told.
 *   clearExamDuty    — exam:manage: take a duty off (reason required). Audited; the teacher is told.
 *
 * A sitting is a routine slot (class, date, subject, kind); time and class come from the
 * routine live. Conflicts are FLAGGED, never refused — the Office decides: the same teacher
 * on overlapping sittings, or on an approved leave that covers the date.
 */
import { Types } from "mongoose";
import { callerHasPermission, ROUTINE_SUBJECTS } from "@scd/shared";
import type { AppContext } from "../../../context";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { personName } from "../../../lib/personName";
import { Class } from "../../foundation/models/Class";
import { resolveStaffProfileForUser } from "../../hr/services/staffMatch";
import { User } from "../../foundation/models/User";
import { StaffLeaveApplication } from "../../hr/models/StaffLeaveApplication";
import { writeAudit } from "../../platform/services/AuditService";
import { emitExamDuty } from "../../notifications/services/emitters";
import { Exam } from "../models/Exam";
import { ExamRoutine, EXAM_ROUTINE_KINDS, type IExamRoutineSlot } from "../models/ExamRoutine";
import { ExamSittingDuty, type IExamSittingDuty } from "../models/ExamSittingDuty";

export class ExamDutyError extends Error {}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_SEAT = 6;
/** Roles that may sit on a duty — the same pool the oral exams draw examiners from. */
const DUTY_ROLES = ["TEACHER", "PRINCIPAL", "OFFICE"];

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new ExamDutyError("ভুল আইডি।");
  return new Types.ObjectId(id);
};

export type DutyConflict = "OVERLAP" | "LEAVE" | "NO_SITTING";

export interface DutyShape {
  id: string;
  seat: number;
  teacherId: string;
  teacherName: string;
  room: string;
  conflicts: DutyConflict[];
}

export interface SittingShape {
  classId: string;
  classLabelBn: string;
  level: number;
  dateKey: string;
  subject: string;
  kind: string;
  start: string;
  end: string;
  /** True when the duty row's sitting is no longer in the routine (kept, flagged). */
  orphan: boolean;
  duties: DutyShape[];
}

export interface TeacherCountShape {
  teacherId: string;
  teacherName: string;
  count: number;
}

export interface DutyRosterShape {
  examId: string;
  examName: string;
  sittings: SittingShape[];
  counts: TeacherCountShape[];
  /** Number of duties carrying at least one conflict. */
  conflictCount: number;
  /** Sittings with no invigilator yet. */
  emptyCount: number;
}

export interface MyDutyShape {
  id: string;
  examId: string;
  examName: string;
  dateKey: string;
  subject: string;
  kind: string;
  classLabelBn: string;
  start: string;
  end: string;
  room: string;
}

export interface DutyCandidateShape {
  userId: string;
  name: string;
}

type SittingKey = { classId: unknown; dateKey: string; subject: string; kind: string };

const keyOf = (x: SittingKey) => `${String(x.classId)}|${x.dateKey}|${x.subject}|${x.kind}`;

const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  !!a.start && !!b.start && a.start < b.end && b.start < a.end;

function must(ctx: AppContext, perm: "exam:manage" | "exam:read") {
  if (!ctx.auth || !callerHasPermission(ctx.auth, perm)) throw new ExamDutyError("এই কাজের অনুমতি আপনার নেই।");
  return ctx.auth;
}

/** Teachers on an approved leave that covers a date: User id -> the dates. */
async function onLeave(teacherIds: Types.ObjectId[], dateKeys: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!teacherIds.length || !dateKeys.length) return out;
  // There is no stored User -> StaffProfile key: staffMatch bridges them by phone/email (D-#788).
  const resolved = await Promise.all(teacherIds.map(async (t) => [String(t), await resolveStaffProfileForUser(String(t))] as const));
  const profiles = resolved.flatMap(([uid, p]) => (p ? [{ _id: p._id, uid }] : []));
  const userOf = new Map(profiles.map((p) => [String(p._id), p.uid]));
  const sorted = [...dateKeys].sort();
  const lo = sorted[0]!;
  const hi = sorted[sorted.length - 1]!;
  const leaves = await StaffLeaveApplication.find(
    { staffProfileId: { $in: profiles.map((p) => p._id) }, status: "approved", fromKey: { $lte: hi }, toKey: { $gte: lo } },
    { staffProfileId: 1, fromKey: 1, toKey: 1 },
  ).lean();
  for (const l of leaves) {
    const uid = userOf.get(String(l.staffProfileId));
    if (!uid) continue;
    for (const d of dateKeys) {
      if (d >= l.fromKey && d <= l.toKey) {
        const set = out.get(uid) ?? new Set<string>();
        set.add(d);
        out.set(uid, set);
      }
    }
  }
  return out;
}

async function namesOf(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  const users = await User.find({ _id: { $in: ids } }, { name: 1, nameBn: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), personName(u as { name?: string; nameBn?: string }, "—")]));
}

async function mustExam(examId: string) {
  const exam = await Exam.findById(oid(examId)).lean();
  if (!exam) throw new ExamDutyError("পরীক্ষাটি পাওয়া যায়নি।");
  return exam;
}

export async function examDutyRoster(ctx: AppContext, examId: string): Promise<DutyRosterShape> {
  must(ctx, "exam:manage");
  const exam = await mustExam(examId);
  const [routine, duties, classes] = await Promise.all([
    ExamRoutine.findOne({ examId: exam._id }).lean(),
    ExamSittingDuty.find({ examId: exam._id }).sort({ seat: 1 }).lean(),
    Class.find({ academicYearId: exam.academicYearId }, { level: 1, nameBn: 1 }).lean(),
  ]);
  const classOf = new Map(classes.map((c) => [String(c._id), c]));
  const slots = (routine?.slots ?? []) as IExamRoutineSlot[];
  const teacherIds = [...new Set(duties.map((d) => String(d.teacherId)))].map((i) => new Types.ObjectId(i));
  const names = await namesOf(teacherIds);
  const leave = await onLeave(teacherIds, [...new Set(duties.map((d) => d.dateKey))]);

  const sittings = new Map<string, SittingShape>();
  const add = (s: SittingKey & { start: string; end: string }, orphan: boolean) => {
    const c = classOf.get(String(s.classId));
    sittings.set(keyOf(s), {
      classId: String(s.classId),
      classLabelBn: c?.nameBn ?? "",
      level: c?.level ?? 0,
      dateKey: s.dateKey,
      subject: s.subject,
      kind: s.kind,
      start: s.start,
      end: s.end,
      orphan,
      duties: [],
    });
  };
  for (const s of slots) add(s, false);
  for (const d of duties) if (!sittings.has(keyOf(d))) add({ ...d, start: "", end: "" }, true);

  // Overlap: per teacher + date, compare sitting times (an empty time claims no clash).
  const byTeacher = new Map<string, { key: string; start: string; end: string }[]>();
  for (const d of duties) {
    const st = sittings.get(keyOf(d))!;
    const k = `${String(d.teacherId)}|${d.dateKey}`;
    const arr = byTeacher.get(k) ?? [];
    arr.push({ key: String(d._id), start: st.start, end: st.end });
    byTeacher.set(k, arr);
  }
  let conflictCount = 0;
  const counts = new Map<string, number>();
  for (const d of duties) {
    const st = sittings.get(keyOf(d))!;
    const tid = String(d.teacherId);
    const conflicts: DutyConflict[] = [];
    if (st.orphan) conflicts.push("NO_SITTING");
    const mine = byTeacher.get(`${tid}|${d.dateKey}`) ?? [];
    if (mine.some((o) => o.key !== String(d._id) && overlaps(o, st))) conflicts.push("OVERLAP");
    if (leave.get(tid)?.has(d.dateKey)) conflicts.push("LEAVE");
    if (conflicts.length) conflictCount += 1;
    counts.set(tid, (counts.get(tid) ?? 0) + 1);
    st.duties.push({ id: String(d._id), seat: d.seat, teacherId: tid, teacherName: names.get(tid) ?? "—", room: d.room ?? "", conflicts });
  }

  const list = [...sittings.values()].sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.start.localeCompare(b.start) || a.level - b.level || a.subject.localeCompare(b.subject),
  );
  return {
    examId: String(exam._id),
    examName: exam.name,
    sittings: list,
    counts: [...counts.entries()]
      .map(([teacherId, count]) => ({ teacherId, teacherName: names.get(teacherId) ?? "—", count }))
      .sort((a, b) => b.count - a.count || a.teacherName.localeCompare(b.teacherName)),
    conflictCount,
    emptyCount: list.filter((s) => !s.orphan && s.duties.length === 0).length,
  };
}

/** The caller's own duties from today on (all exams), in date/time order. */
export async function myExamDuties(ctx: AppContext): Promise<MyDutyShape[]> {
  const auth = must(ctx, "exam:read");
  const today = dhakaDayKey(new Date());
  const rows = await ExamSittingDuty.find({ teacherId: oid(auth.userId), dateKey: { $gte: today } }).lean();
  if (!rows.length) return [];
  const examIds = [...new Set(rows.map((r) => String(r.examId)))].map((i) => new Types.ObjectId(i));
  const [exams, routines, classes] = await Promise.all([
    Exam.find({ _id: { $in: examIds } }, { name: 1 }).lean(),
    ExamRoutine.find({ examId: { $in: examIds } }, { examId: 1, slots: 1 }).lean(),
    Class.find({ _id: { $in: [...new Set(rows.map((r) => String(r.classId)))] } }, { nameBn: 1 }).lean(),
  ]);
  const examName = new Map(exams.map((e) => [String(e._id), e.name]));
  const classLabel = new Map(classes.map((c) => [String(c._id), c.nameBn]));
  const slotOf = new Map<string, IExamRoutineSlot>();
  for (const r of routines) for (const s of r.slots as IExamRoutineSlot[]) slotOf.set(`${String(r.examId)}|${keyOf(s)}`, s);
  return rows
    .map((r) => {
      const s = slotOf.get(`${String(r.examId)}|${keyOf(r)}`);
      return {
        id: String(r._id),
        examId: String(r.examId),
        examName: examName.get(String(r.examId)) ?? "",
        dateKey: r.dateKey,
        subject: r.subject,
        kind: r.kind,
        classLabelBn: classLabel.get(String(r.classId)) ?? "",
        start: s?.start ?? "",
        end: s?.end ?? "",
        room: r.room ?? "",
      };
    })
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.start.localeCompare(b.start));
}

export async function dutyCandidates(ctx: AppContext): Promise<DutyCandidateShape[]> {
  must(ctx, "exam:manage");
  const users = await User.find({ role: { $in: DUTY_ROLES }, active: true }, { name: 1, nameBn: 1 }).lean();
  return users
    .map((u) => ({ userId: String(u._id), name: personName(u as { name?: string; nameBn?: string }, "—") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AssignDutyInput {
  examId: string;
  classId: string;
  dateKey: string;
  subject: string;
  kind: string;
  seat?: number | null;
  teacherId: string;
  room?: string | null;
  reason?: string | null;
}

async function notify(
  duty: IExamSittingDuty,
  recipient: Types.ObjectId,
  what: "ASSIGNED" | "CHANGED" | "REMOVED",
  slot: IExamRoutineSlot | undefined,
): Promise<void> {
  const cls = await Class.findById(duty.classId, { nameBn: 1 }).lean();
  await emitExamDuty({
    dutyId: duty._id,
    rev: duty.rev,
    recipientUserId: recipient,
    what,
    dateKey: duty.dateKey,
    subject: duty.subject,
    classLabelBn: cls?.nameBn ?? "",
    start: slot?.start ?? "",
    end: slot?.end ?? "",
    room: duty.room ?? "",
  });
}

async function shapeOne(d: IExamSittingDuty): Promise<DutyShape> {
  const names = await namesOf([d.teacherId]);
  const leave = await onLeave([d.teacherId], [d.dateKey]);
  const conflicts: DutyConflict[] = [];
  if (leave.get(String(d.teacherId))?.has(d.dateKey)) conflicts.push("LEAVE");
  return { id: String(d._id), seat: d.seat, teacherId: String(d.teacherId), teacherName: names.get(String(d.teacherId)) ?? "—", room: d.room ?? "", conflicts };
}

export async function assignExamDuty(ctx: AppContext, input: AssignDutyInput): Promise<DutyShape> {
  const auth = must(ctx, "exam:manage");
  const exam = await mustExam(input.examId);
  const classId = oid(input.classId);
  if (!DATE_KEY.test(input.dateKey)) throw new ExamDutyError("তারিখ YYYY-MM-DD আকারে দিন।");
  if (!(ROUTINE_SUBJECTS as readonly string[]).includes(input.subject)) throw new ExamDutyError("বিষয়টি সঠিক নয়।");
  if (!(EXAM_ROUTINE_KINDS as readonly string[]).includes(input.kind)) throw new ExamDutyError("লিখিত না মৌখিক তা বাছাই করুন।");
  const kind = input.kind as "WRITTEN" | "ORAL";
  const seat = input.seat ?? 1;
  if (!Number.isInteger(seat) || seat < 1 || seat > MAX_SEAT) throw new ExamDutyError("ডিউটির ক্রম ১ থেকে ৬-এর মধ্যে দিন।");
  const room = (input.room ?? "").trim().slice(0, 40);
  const reason = (input.reason ?? "").trim();

  const routine = await ExamRoutine.findOne({ examId: exam._id }).lean();
  const slot = (routine?.slots as IExamRoutineSlot[] | undefined)?.find(
    (s) => String(s.classId) === String(classId) && s.dateKey === input.dateKey && s.subject === input.subject && s.kind === kind,
  );
  if (!slot) throw new ExamDutyError("এই পরীক্ষাটি রুটিনে নেই।");

  const teacher = await User.findOne({ _id: oid(input.teacherId), role: { $in: DUTY_ROLES }, active: true }, { _id: 1 }).lean();
  if (!teacher) throw new ExamDutyError("শিক্ষককে পাওয়া যায়নি।");

  const key = { examId: exam._id, classId, dateKey: input.dateKey, subject: input.subject, kind };
  const sameSitting = await ExamSittingDuty.find(key);
  if (sameSitting.some((d) => String(d.teacherId) === String(teacher._id) && d.seat !== seat)) {
    throw new ExamDutyError("এই শিক্ষক এই পরীক্ষায় আগেই আছেন।");
  }
  const existing = sameSitting.find((d) => d.seat === seat);
  const meta = { examId: String(exam._id), classId: input.classId, dateKey: input.dateKey, subject: input.subject, kind, seat };

  if (!existing) {
    // Two quick taps on the same seat race into the unique index: say so plainly.
    const created = await ExamSittingDuty.create({ ...key, seat, teacherId: teacher._id, room, rev: 1, updatedBy: oid(auth.userId) }).catch((err: unknown) => {
      if ((err as { code?: number }).code === 11000) throw new ExamDutyError("এই ডিউটি এইমাত্র অন্য কেউ দিয়েছেন। পাতাটি নতুন করে খুলে দেখুন।");
      throw err;
    });
    await writeAudit({
      eventKind: "EXAM_SITTING_DUTY_ASSIGNED",
      actorId: auth.userId,
      targetId: created._id,
      targetKind: "ExamSittingDuty",
      meta: { ...meta, teacherId: String(teacher._id), room },
    });
    await notify(created, teacher._id, "ASSIGNED", slot);
    return shapeOne(created);
  }

  const sameTeacher = String(existing.teacherId) === String(teacher._id);
  if (sameTeacher && (existing.room ?? "") === room) return shapeOne(existing);
  if (!sameTeacher && reason.length < 3) throw new ExamDutyError("শিক্ষক বদলাতে কারণ লিখুন।");

  const fromTeacher = existing.teacherId;
  existing.teacherId = teacher._id;
  existing.room = room;
  existing.rev += 1;
  existing.updatedBy = oid(auth.userId);
  await existing.save();
  await writeAudit({
    eventKind: "EXAM_SITTING_DUTY_CHANGED",
    actorId: auth.userId,
    targetId: existing._id,
    targetKind: "ExamSittingDuty",
    meta: { ...meta, teacherId: String(teacher._id), fromTeacherId: String(fromTeacher), room, reason },
  });
  await notify(existing, teacher._id, sameTeacher ? "CHANGED" : "ASSIGNED", slot);
  if (!sameTeacher) await notify(existing, fromTeacher, "REMOVED", slot);
  return shapeOne(existing);
}

export async function clearExamDuty(ctx: AppContext, dutyId: string, reason: string): Promise<boolean> {
  const auth = must(ctx, "exam:manage");
  const duty = await ExamSittingDuty.findById(oid(dutyId));
  if (!duty) return true;
  const why = (reason ?? "").trim();
  if (why.length < 3) throw new ExamDutyError("ডিউটি তুলে নিতে কারণ লিখুন।");
  const routine = await ExamRoutine.findOne({ examId: duty.examId }).lean();
  const slot = (routine?.slots as IExamRoutineSlot[] | undefined)?.find((s) => keyOf(s) === keyOf(duty));
  await duty.deleteOne();
  duty.rev += 1; // the removal notice gets its own key
  await writeAudit({
    eventKind: "EXAM_SITTING_DUTY_CLEARED",
    actorId: auth.userId,
    targetId: duty._id,
    targetKind: "ExamSittingDuty",
    meta: {
      examId: String(duty.examId),
      classId: String(duty.classId),
      dateKey: duty.dateKey,
      subject: duty.subject,
      kind: duty.kind,
      seat: duty.seat,
      fromTeacherId: String(duty.teacherId),
      reason: why,
    },
  });
  await notify(duty, duty.teacherId, "REMOVED", slot);
  return true;
}
