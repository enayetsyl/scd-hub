/**
 * TaskTemplateService (WB-2, D-#701) — recurring manual tasks.
 *
 * `templateDueToday` is the pure rule (tested without a DB); `materializeTaskTemplates`
 * runs it once per school day from the notification ticker, behind its OFF/HOLIDAY
 * gate, and relies on the (templateId, dueKey) unique index for idempotence.
 */
import { Types } from "mongoose";
import { DAY_SLOTS, TASK_PRIORITIES, TASK_RECURRENCES } from "@scd/shared";
import type { DaySlot, TaskPriority, TaskRecurrence } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { dateKeyOf } from "../../attendance/dates";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { Task } from "../models/Task";
import { TaskTemplate, type ITaskTemplate } from "../models/TaskTemplate";
import { canAssign } from "./TaskService";

export interface TaskTemplateInput {
  titleBn: string;
  notes?: string | null;
  assigneeUserId: string;
  forLabel?: string | null;
  priority?: TaskPriority | null;
  slot?: DaySlot | null;
  effortMin: number;
  recurrence: TaskRecurrence;
  weekdays?: number[] | null;
  monthDay?: number | null;
  weekOfMonth?: number | null;
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Does this template produce a task on `date` (already known to be a SCHOOL day)? */
export function templateDueOn(
  t: Pick<ITaskTemplate, "recurrence" | "weekdays" | "monthDay"> & { weekOfMonth?: number | null },
  date: Date,
): boolean {
  switch (t.recurrence) {
    case "SCHOOL_DAYS":
      return true;
    case "WEEKLY":
      return (t.weekdays ?? []).includes(date.getDay());
    case "MONTHLY": {
      if (!t.monthDay) return false;
      const last = daysInMonth(date);
      const target = Math.min(t.monthDay, last);
      return date.getDate() === target;
    }
    case "MONTHLY_WEEKDAY": {
      // "the first Saturday": weekday must match, and this must be the Nth such
      // weekday of the month (N = ceil(date / 7)); 5 means the LAST one, which is
      // whichever occurrence has no same-weekday date 7 days later in the month.
      const weekday = (t.weekdays ?? [])[0];
      if (weekday == null || !t.weekOfMonth) return false;
      if (date.getDay() !== weekday) return false;
      const nth = Math.ceil(date.getDate() / 7);
      if (t.weekOfMonth === 5) return date.getDate() + 7 > daysInMonth(date);
      return nth === t.weekOfMonth;
    }
    default:
      return false;
  }
}

export async function createTaskTemplate(authIn: AuthPayload | null, input: TaskTemplateInput): Promise<ITaskTemplate> {
  if (!authIn) throw new ForbiddenError("Unauthenticated");
  const auth = authIn;
  const self = input.assigneeUserId === auth.userId;
  if (!self && !canAssign(auth)) throw new ForbiddenError("অন্যকে কাজ দেওয়ার অনুমতি নেই");
  if (!input.titleBn?.trim()) throw new Error("কাজের শিরোনাম লিখুন");
  if (input.effortMin < 5 || input.effortMin > 480) throw new Error("সময় ৫ থেকে ৪৮০ মিনিটের মধ্যে দিন");
  if (!(TASK_RECURRENCES as readonly string[]).includes(input.recurrence)) throw new Error("পুনরাবৃত্তি সঠিক নয়");
  if (input.priority && !(TASK_PRIORITIES as readonly string[]).includes(input.priority)) throw new Error("অগ্রাধিকার সঠিক নয়");
  if (input.slot && !(DAY_SLOTS as readonly string[]).includes(input.slot)) throw new Error("দিনের সময় সঠিক নয়");
  const weekdays = (input.weekdays ?? []).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  if (input.recurrence === "WEEKLY" && weekdays.length === 0) throw new Error("সপ্তাহের অন্তত একটি দিন বাছুন");
  if (input.recurrence === "MONTHLY" && (!input.monthDay || input.monthDay < 1 || input.monthDay > 31)) {
    throw new Error("মাসের তারিখ ১ থেকে ৩১-এর মধ্যে দিন");
  }
  if (input.recurrence === "MONTHLY_WEEKDAY") {
    if (weekdays.length !== 1) throw new Error("সপ্তাহের ঠিক একটি দিন বাছুন");
    if (!input.weekOfMonth || !Number.isInteger(input.weekOfMonth) || input.weekOfMonth < 1 || input.weekOfMonth > 5) {
      throw new Error("মাসের কততম সপ্তাহ, তা বাছুন");
    }
  }
  if (!Types.ObjectId.isValid(input.assigneeUserId)) throw new Error("কাকে দেবেন তা বাছুন");
  const u = await User.findById(input.assigneeUserId).select("role active").lean();
  if (!u || !u.active || u.role === "GUARDIAN") throw new Error("এই ব্যক্তিকে কাজ দেওয়া যায় না");

  const doc = await TaskTemplate.create({
    titleBn: input.titleBn.trim(),
    notes: input.notes?.trim() || undefined,
    assigneeUserId: new Types.ObjectId(input.assigneeUserId),
    createdBy: new Types.ObjectId(auth.userId),
    forLabel: input.forLabel?.trim() || undefined,
    priority: input.priority ?? "NORMAL",
    slot: input.slot ?? "ANY",
    effortMin: input.effortMin,
    recurrence: input.recurrence,
    weekdays,
    monthDay: input.recurrence === "MONTHLY" ? input.monthDay ?? undefined : undefined,
    weekOfMonth: input.recurrence === "MONTHLY_WEEKDAY" ? input.weekOfMonth ?? undefined : undefined,
    active: true,
  });
  await writeAudit({
    eventKind: "TASK_WRITE",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id.toString(),
    targetKind: "TaskTemplate",
    meta: { action: "template_create", recurrence: input.recurrence, assigneeUserId: input.assigneeUserId },
  });
  return doc;
}

export async function setTaskTemplateActive(authIn: AuthPayload | null, id: string, active: boolean): Promise<ITaskTemplate> {
  if (!authIn) throw new ForbiddenError("Unauthenticated");
  if (!Types.ObjectId.isValid(id)) throw new Error("Template not found");
  const doc = await TaskTemplate.findById(id);
  if (!doc) throw new Error("Template not found");
  const mine = doc.createdBy.toString() === authIn.userId || doc.assigneeUserId.toString() === authIn.userId;
  if (!mine && !canAssign(authIn)) throw new ForbiddenError("এই টেমপ্লেট আপনার নয়");
  doc.active = active;
  await doc.save();
  await writeAudit({
    eventKind: "TASK_WRITE",
    actorId: authIn.userId,
    actorRole: authIn.role,
    targetId: doc._id.toString(),
    targetKind: "TaskTemplate",
    meta: { action: active ? "template_activate" : "template_deactivate" },
  });
  return doc;
}

/** tasks:assign sees every template; anyone else sees the ones on their own board. */
export async function listTaskTemplates(auth: AuthPayload): Promise<ITaskTemplate[]> {
  const filter = canAssign(auth) ? {} : { assigneeUserId: new Types.ObjectId(auth.userId) };
  return TaskTemplate.find(filter).sort({ active: -1, createdAt: -1 }).lean() as unknown as Promise<ITaskTemplate[]>;
}

/** Once per SCHOOL day (the caller gates on day type): create today's instances.
 *  Returns how many were newly created; a duplicate (retried tick) is a silent no-op. */
export async function materializeTaskTemplates(now: Date): Promise<number> {
  const dateKey = dateKeyOf(now);
  const templates = (await TaskTemplate.find({ active: true }).lean()) as unknown as ITaskTemplate[];
  let created = 0;
  for (const t of templates) {
    if (!templateDueOn(t, now)) continue;
    try {
      await Task.create({
        titleBn: t.titleBn,
        notes: t.notes,
        assigneeUserId: t.assigneeUserId,
        assignedBy: t.createdBy,
        forLabel: t.forLabel,
        priority: t.priority,
        dueKey: dateKey,
        slot: t.slot,
        effortMin: t.effortMin,
        status: "TODO",
        templateId: t._id,
      });
      created += 1;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) continue; // already materialised today
      throw err;
    }
  }
  return created;
}
