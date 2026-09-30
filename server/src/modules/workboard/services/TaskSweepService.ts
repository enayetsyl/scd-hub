/**
 * TaskSweepService (WB-1, D-#701) — the two scheduler jobs for MANUAL tasks:
 *   07:30  due digest  — one row per person with open work (today + overdue)
 *   16:00  overdue     — one row per recipient: assignee AND assigner, for every
 *                        task still open at end of day
 * Both are called from the notification ticker behind its school-day gate and are
 * idempotent per (date, recipient) through the dedupe keys.
 */
import { dateKeyOf } from "../../attendance/dates";
import { Task, type ITask } from "../models/Task";
import { emitTaskDueDigest, emitTaskOverdue, type DigestLine, type OverdueLine } from "./workBoardNotifications";

export const TASK_DIGEST_MINUTES = 7 * 60 + 30;
export const TASK_OVERDUE_MINUTES = 16 * 60;

/** Pure: group open tasks into per-assignee (today, overdue) counts. */
export function digestLines(tasks: Pick<ITask, "assigneeUserId" | "dueKey" | "status">[], todayKey: string): DigestLine[] {
  const by = new Map<string, DigestLine>();
  for (const t of tasks) {
    if (t.status === "DONE" || t.dueKey > todayKey) continue;
    const id = t.assigneeUserId.toString();
    const line = by.get(id) ?? { recipientId: id, today: 0, overdue: 0 };
    if (t.dueKey === todayKey) line.today += 1;
    else line.overdue += 1;
    by.set(id, line);
  }
  return [...by.values()];
}

/** Pure: every open task due today or earlier → its assignee and (if different) assigner. */
export function overdueLines(tasks: Pick<ITask, "assigneeUserId" | "assignedBy" | "dueKey" | "status" | "titleBn">[], todayKey: string): OverdueLine[] {
  const by = new Map<string, OverdueLine>();
  const add = (id: string, title: string) => {
    const line = by.get(id) ?? { recipientId: id, titles: [] };
    line.titles.push(title);
    by.set(id, line);
  };
  for (const t of tasks) {
    if (t.status === "DONE" || t.dueKey > todayKey) continue;
    const a = t.assigneeUserId.toString();
    const b = t.assignedBy.toString();
    add(a, t.titleBn);
    if (b !== a) add(b, t.titleBn);
  }
  return [...by.values()];
}

async function openTasksDueBy(todayKey: string): Promise<ITask[]> {
  return Task.find({ cancelledAt: null, status: { $ne: "DONE" }, dueKey: { $lte: todayKey } })
    .select("assigneeUserId assignedBy dueKey status titleBn")
    .lean() as unknown as Promise<ITask[]>;
}

export async function dispatchTaskDigest(now: Date): Promise<number> {
  const todayKey = dateKeyOf(now);
  const tasks = await openTasksDueBy(todayKey);
  return emitTaskDueDigest(todayKey, digestLines(tasks, todayKey));
}

export async function dispatchTaskOverdue(now: Date): Promise<number> {
  const todayKey = dateKeyOf(now);
  const tasks = await openTasksDueBy(todayKey);
  return emitTaskOverdue(todayKey, overdueLines(tasks, todayKey));
}
