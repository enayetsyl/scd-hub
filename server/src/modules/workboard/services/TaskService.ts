/**
 * TaskService (WB-1, D-#701) — the manual-task state machine + who may touch what.
 *
 *   who may CREATE for X:  X themselves (no permission), or a `tasks:assign` holder
 *   who may EDIT/MOVE/REASSIGN/CANCEL: the assigner, or a `tasks:assign` holder
 *   who may change STATUS / BLOCK: the assignee, the assigner, or a `tasks:assign` holder
 *
 * Every write is audited (TASK_WRITE, meta.action) and the notification emitters
 * are best-effort — a failed push never rolls a task back.
 */
import { Types } from "mongoose";
import { callerHasPermission, DAY_SLOTS, TASK_PRIORITIES, TASK_STATUSES } from "@scd/shared";
import type { DaySlot, TaskPriority, TaskStatus } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { isValidDateKey } from "../../attendance/dates";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { Task, type ITask } from "../models/Task";
import { emitTaskAssigned, emitTaskBlocked, emitTaskDone } from "./workBoardNotifications";

export interface TaskInput {
  titleBn: string;
  notes?: string | null;
  assigneeUserId: string;
  forLabel?: string | null;
  priority?: TaskPriority | null;
  dueKey: string;
  slot?: DaySlot | null;
  effortMin: number;
}

export interface TaskPatch {
  titleBn?: string | null;
  notes?: string | null;
  forLabel?: string | null;
  priority?: TaskPriority | null;
  dueKey?: string | null;
  slot?: DaySlot | null;
  effortMin?: number | null;
}

export const canAssign = (auth: AuthPayload): boolean => callerHasPermission(auth, "tasks:assign");

function requireAuth(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  return auth;
}

function validateCommon(p: { titleBn?: string | null; dueKey?: string | null; effortMin?: number | null; priority?: string | null; slot?: string | null }): void {
  if (p.titleBn !== undefined && p.titleBn !== null && p.titleBn.trim().length === 0) {
    throw new Error("কাজের শিরোনাম লিখুন");
  }
  if (p.dueKey !== undefined && p.dueKey !== null && !isValidDateKey(p.dueKey)) {
    throw new Error("শেষ তারিখ সঠিক নয়");
  }
  if (p.effortMin !== undefined && p.effortMin !== null && (p.effortMin < 5 || p.effortMin > 480)) {
    throw new Error("সময় ৫ থেকে ৪৮০ মিনিটের মধ্যে দিন");
  }
  if (p.priority && !(TASK_PRIORITIES as readonly string[]).includes(p.priority)) throw new Error("অগ্রাধিকার সঠিক নয়");
  if (p.slot && !(DAY_SLOTS as readonly string[]).includes(p.slot)) throw new Error("দিনের সময় সঠিক নয়");
}

async function assertAssignee(userId: string): Promise<void> {
  if (!Types.ObjectId.isValid(userId)) throw new Error("কাকে দেবেন তা বাছুন");
  const u = await User.findById(userId).select("role active").lean();
  if (!u || !u.active || u.role === "GUARDIAN") throw new Error("এই ব্যক্তিকে কাজ দেওয়া যায় না");
}

async function nameOf(userId: string): Promise<string | null> {
  const u = await User.findById(userId).select("name").lean();
  return u?.name ?? null;
}

export async function taskById(id: string): Promise<ITask> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Task not found");
  const doc = await Task.findById(id);
  if (!doc || doc.cancelledAt) throw new Error("Task not found");
  return doc;
}

/** Read gate: the assignee, the assigner, or a tasks:assign holder. */
export function assertCanReadTask(auth: AuthPayload, task: ITask): void {
  const me = auth.userId;
  if (task.assigneeUserId.toString() === me || task.assignedBy.toString() === me || canAssign(auth)) return;
  throw new ForbiddenError("এই কাজটি আপনার নয়");
}

function assertCanManage(auth: AuthPayload, task: ITask): void {
  if (task.assignedBy.toString() === auth.userId || canAssign(auth)) return;
  throw new ForbiddenError("কাজটি যিনি দিয়েছেন কেবল তিনিই বদলাতে পারেন");
}

function assertCanWork(auth: AuthPayload, task: ITask): void {
  if (task.assigneeUserId.toString() === auth.userId) return;
  assertCanManage(auth, task);
}

export async function createTask(authIn: AuthPayload | null, input: TaskInput): Promise<ITask> {
  const auth = requireAuth(authIn);
  validateCommon(input);
  if (!input.dueKey) throw new Error("শেষ তারিখ দিন");
  const self = input.assigneeUserId === auth.userId;
  if (!self && !canAssign(auth)) throw new ForbiddenError("অন্যকে কাজ দেওয়ার অনুমতি নেই");
  await assertAssignee(input.assigneeUserId);

  const doc = await Task.create({
    titleBn: input.titleBn.trim(),
    notes: input.notes?.trim() || undefined,
    assigneeUserId: new Types.ObjectId(input.assigneeUserId),
    assignedBy: new Types.ObjectId(auth.userId),
    forLabel: input.forLabel?.trim() || undefined,
    priority: input.priority ?? "NORMAL",
    dueKey: input.dueKey,
    slot: input.slot ?? "ANY",
    effortMin: input.effortMin,
    status: "TODO",
  });
  await writeAudit({
    eventKind: "TASK_WRITE",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id.toString(),
    targetKind: "Task",
    meta: { action: "create", assigneeUserId: input.assigneeUserId, dueKey: input.dueKey },
  });
  if (!self) await emitTaskAssigned(doc, await nameOf(auth.userId));
  return doc;
}

export async function updateTask(authIn: AuthPayload | null, id: string, patch: TaskPatch): Promise<ITask> {
  const auth = requireAuth(authIn);
  const doc = await taskById(id);
  assertCanManage(auth, doc);
  validateCommon(patch);
  if (patch.titleBn != null) doc.titleBn = patch.titleBn.trim();
  if (patch.notes !== undefined) doc.notes = patch.notes?.trim() || undefined;
  if (patch.forLabel !== undefined) doc.forLabel = patch.forLabel?.trim() || undefined;
  if (patch.priority != null) doc.priority = patch.priority;
  if (patch.dueKey != null) doc.dueKey = patch.dueKey;
  if (patch.slot != null) doc.slot = patch.slot;
  if (patch.effortMin != null) doc.effortMin = patch.effortMin;
  await doc.save();
  await writeAudit({
    eventKind: "TASK_WRITE",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id.toString(),
    targetKind: "Task",
    meta: { action: "update", patch },
  });
  return doc;
}

/** The status machine: any of the three → any other. DONE stamps who/when and clears
 *  a block; leaving DONE (a reopen) clears the stamp so a second finish can be told. */
export async function setTaskStatus(authIn: AuthPayload | null, id: string, status: TaskStatus): Promise<ITask> {
  const auth = requireAuth(authIn);
  if (!(TASK_STATUSES as readonly string[]).includes(status)) throw new Error("অবস্থা সঠিক নয়");
  const doc = await taskById(id);
  assertCanWork(auth, doc);
  const from = doc.status;
  if (from === status) return doc;
  doc.status = status;
  if (status === "DONE") {
    doc.doneAt = new Date();
    doc.doneBy = new Types.ObjectId(auth.userId);
    doc.blockedReason = undefined;
    doc.blockedAt = undefined;
  } else {
    doc.doneAt = undefined;
    doc.doneBy = undefined;
    if (status === "DOING" && !doc.startedAt) doc.startedAt = new Date();
  }
  await doc.save();
  await writeAudit({
    eventKind: "TASK_WRITE",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id.toString(),
    targetKind: "Task",
    meta: { action: "status", from, to: status },
  });
  if (status === "DONE") await emitTaskDone(doc, await nameOf(auth.userId));
  return doc;
}

/** Block (reason required) or unblock (reason null) an OPEN task. */
export async function setTaskBlocked(authIn: AuthPayload | null, id: string, reason: string | null): Promise<ITask> {
  const auth = requireAuth(authIn);
  const doc = await taskById(id);
  assertCanWork(auth, doc);
  if (doc.status === "DONE") throw new Error("শেষ হওয়া কাজ আটকানো যায় না");
  const trimmed = reason?.trim() ?? "";
  if (reason !== null && trimmed.length === 0) throw new Error("কেন আটকে আছে, এক লাইনে লিখুন");
  const wasBlocked = !!doc.blockedReason;
  if (reason === null) {
    doc.blockedReason = undefined;
    doc.blockedAt = undefined;
  } else {
    doc.blockedReason = trimmed;
    doc.blockedAt = new Date();
  }
  await doc.save();
  await writeAudit({
    eventKind: "TASK_WRITE",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id.toString(),
    targetKind: "Task",
    meta: { action: reason === null ? "unblock" : "block", reason: trimmed || undefined, wasBlocked },
  });
  if (reason !== null) await emitTaskBlocked(doc, await nameOf(auth.userId));
  return doc;
}

export async function reassignTask(authIn: AuthPayload | null, id: string, assigneeUserId: string): Promise<ITask> {
  const auth = requireAuth(authIn);
  const doc = await taskById(id);
  assertCanManage(auth, doc);
  if (doc.status === "DONE") throw new Error("শেষ হওয়া কাজ অন্যকে দেওয়া যায় না");
  await assertAssignee(assigneeUserId);
  const from = doc.assigneeUserId.toString();
  if (from === assigneeUserId) return doc;
  doc.assigneeUserId = new Types.ObjectId(assigneeUserId);
  doc.blockedReason = undefined;
  doc.blockedAt = undefined;
  await doc.save();
  await writeAudit({
    eventKind: "TASK_WRITE",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id.toString(),
    targetKind: "Task",
    meta: { action: "reassign", from, to: assigneeUserId },
  });
  if (assigneeUserId !== auth.userId) await emitTaskAssigned(doc, await nameOf(auth.userId));
  return doc;
}

/** Move to another day and/or slot. The ASSIGNEE may move their own task's slot
 *  (spreading their day is theirs to do); changing the DAY is the assigner's call. */
export async function moveTask(
  authIn: AuthPayload | null,
  id: string,
  to: { dueKey?: string | null; slot?: DaySlot | null },
): Promise<ITask> {
  const auth = requireAuth(authIn);
  const doc = await taskById(id);
  validateCommon(to);
  const isAssignee = doc.assigneeUserId.toString() === auth.userId;
  if (to.dueKey != null && to.dueKey !== doc.dueKey) {
    assertCanManage(auth, doc);
    doc.dueKey = to.dueKey;
  } else if (!isAssignee) {
    assertCanManage(auth, doc);
  }
  if (to.slot != null) doc.slot = to.slot;
  await doc.save();
  await writeAudit({
    eventKind: "TASK_WRITE",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id.toString(),
    targetKind: "Task",
    meta: { action: "move", dueKey: doc.dueKey, slot: doc.slot },
  });
  return doc;
}

export async function cancelTask(authIn: AuthPayload | null, id: string): Promise<ITask> {
  const auth = requireAuth(authIn);
  const doc = await taskById(id);
  assertCanManage(auth, doc);
  if (doc.status === "DONE") throw new Error("শেষ হওয়া কাজ বাতিল করা যায় না");
  doc.cancelledAt = new Date();
  doc.cancelledBy = new Types.ObjectId(auth.userId);
  await doc.save();
  await writeAudit({
    eventKind: "TASK_WRITE",
    actorId: auth.userId,
    actorRole: auth.role,
    targetId: doc._id.toString(),
    targetKind: "Task",
    meta: { action: "cancel" },
  });
  return doc;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Manual tasks that belong on these people's boards for [fromKey, toKey]:
 *  every task DUE in the window, plus every still-open task due BEFORE it
 *  (overdue work follows you until it is done). */
export async function tasksOnBoards(userIds: string[], fromKey: string, toKey: string): Promise<ITask[]> {
  if (userIds.length === 0) return [];
  return Task.find({
    assigneeUserId: { $in: userIds.map((u) => new Types.ObjectId(u)) },
    cancelledAt: null,
    $or: [{ dueKey: { $gte: fromKey, $lte: toKey } }, { status: { $ne: "DONE" }, dueKey: { $lt: fromKey } }],
  })
    .sort({ dueKey: 1, createdAt: 1 })
    .lean() as unknown as Promise<ITask[]>;
}

export async function tasksAssignedBy(userId: string, open: boolean): Promise<ITask[]> {
  return Task.find({
    assignedBy: new Types.ObjectId(userId),
    assigneeUserId: { $ne: new Types.ObjectId(userId) },
    cancelledAt: null,
    status: open ? { $ne: "DONE" } : "DONE",
  })
    .sort(open ? { dueKey: 1, createdAt: 1 } : { doneAt: -1 })
    .limit(open ? 500 : 100)
    .lean() as unknown as Promise<ITask[]>;
}
