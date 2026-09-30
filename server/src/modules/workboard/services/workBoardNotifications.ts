/**
 * Work-board notification emitters (WB-1, D-#701) — best-effort wrappers over
 * NotificationService.emit(), the emitters.ts posture: a notification failure is
 * logged and swallowed, never thrown into the host mutation.
 *
 * Manual tasks only. Auto cards keep the reminders their SOURCE modules already
 * send (class-note prompt, homework chase, print request, leave submitted), so
 * nothing on the board is ever told twice.
 */
import { emit } from "../../notifications/services/NotificationService";
import type { ITask } from "../models/Task";

async function bestEffort(label: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    console.error(`notification emit failed (${label} — never blocks the host operation):`, err);
  }
}

/** One registry of prefixes, so a new key cannot collide with an existing one. */
export const taskDedupeKeys = {
  /** Per task PER RECIPIENT: a hand-over to a new assignee must not be swallowed by
   *  the first assignee's row (the entity-only-key trap, WC-7). */
  assigned: (taskId: string, assigneeId: string) => `TASKA:${taskId}:${assigneeId}`,
  /** Per task: the assigner is told once how it ended; a reopen + second finish
   *  carries the finish instant so it CAN be told again. */
  done: (taskId: string, doneAtMs: number) => `TASKD:${taskId}:${doneAtMs}`,
  blocked: (taskId: string, blockedAtMs: number) => `TASKB:${taskId}:${blockedAtMs}`,
  /** One digest row per recipient per day — never one per task (D-#554's lesson). */
  dueDigest: (dateKey: string, recipientId: string) => `TASKDG:${dateKey}:${recipientId}`,
  overdue: (dateKey: string, recipientId: string) => `TASKO:${dateKey}:${recipientId}`,
} as const;

const trimTitle = (t: string): string => (t.length > 60 ? `${t.slice(0, 57)}…` : t);

export async function emitTaskAssigned(task: ITask, assignerName: string | null): Promise<void> {
  await bestEffort("task assigned", async () => {
    await emit({
      recipientUserId: task.assigneeUserId.toString(),
      kind: "TASK_ASSIGNED",
      titleBn: "নতুন কাজ",
      bodyBn: `${assignerName ?? "কেউ"} আপনাকে একটি কাজ দিয়েছেন: ${trimTitle(task.titleBn)} (শেষ তারিখ ${task.dueKey})`,
      refs: { taskId: task._id.toString(), date: task.dueKey },
      dedupeKey: taskDedupeKeys.assigned(task._id.toString(), task.assigneeUserId.toString()),
    });
  });
}

export async function emitTaskDone(task: ITask, doerName: string | null): Promise<void> {
  if (task.assignedBy.toString() === task.assigneeUserId.toString()) return; // self-assigned: nobody to tell
  await bestEffort("task done", async () => {
    await emit({
      recipientUserId: task.assignedBy.toString(),
      kind: "TASK_DONE",
      titleBn: "কাজ শেষ",
      bodyBn: `${doerName ?? "সহকর্মী"} কাজটি শেষ করেছেন: ${trimTitle(task.titleBn)}`,
      refs: { taskId: task._id.toString(), date: task.dueKey },
      dedupeKey: taskDedupeKeys.done(task._id.toString(), task.doneAt?.getTime() ?? Date.now()),
    });
  });
}

export async function emitTaskBlocked(task: ITask, assigneeName: string | null): Promise<void> {
  if (task.assignedBy.toString() === task.assigneeUserId.toString()) return;
  await bestEffort("task blocked", async () => {
    await emit({
      recipientUserId: task.assignedBy.toString(),
      kind: "TASK_BLOCKED",
      titleBn: "কাজ আটকে আছে",
      bodyBn: `${assigneeName ?? "সহকর্মী"}: "${trimTitle(task.titleBn)}" আটকে আছে — ${task.blockedReason ?? ""}`,
      refs: { taskId: task._id.toString(), date: task.dueKey },
      dedupeKey: taskDedupeKeys.blocked(task._id.toString(), task.blockedAt?.getTime() ?? Date.now()),
    });
  });
}

export interface DigestLine {
  recipientId: string;
  today: number;
  overdue: number;
}

/** 07:30 on a school day: "today's tasks" to each person with open manual work. */
export async function emitTaskDueDigest(dateKey: string, lines: DigestLine[]): Promise<number> {
  let n = 0;
  for (const line of lines) {
    if (line.today + line.overdue === 0) continue;
    await bestEffort("task due digest", async () => {
      const parts = [`আজ ${line.today}টি কাজ`];
      if (line.overdue > 0) parts.push(`${line.overdue}টি বকেয়া`);
      const res = await emit({
        recipientUserId: line.recipientId,
        kind: "TASK_DUE_DIGEST",
        titleBn: "আজকের কাজ",
        bodyBn: `${parts.join(", ")} — বোর্ডে দেখুন।`,
        refs: { date: dateKey },
        dedupeKey: taskDedupeKeys.dueDigest(dateKey, line.recipientId),
      });
      if (res.created) n += 1;
    });
  }
  return n;
}

export interface OverdueLine {
  recipientId: string;
  /** Titles of the overdue tasks this person is on (as assignee or assigner). */
  titles: string[];
}

/** 16:00 on a school day: one overdue notice per recipient (assignee AND assigner). */
export async function emitTaskOverdue(dateKey: string, lines: OverdueLine[]): Promise<number> {
  let n = 0;
  for (const line of lines) {
    if (line.titles.length === 0) continue;
    await bestEffort("task overdue", async () => {
      const shown = line.titles.slice(0, 3).map(trimTitle).join("; ");
      const more = line.titles.length > 3 ? ` (+${line.titles.length - 3})` : "";
      const res = await emit({
        recipientUserId: line.recipientId,
        kind: "TASK_OVERDUE",
        titleBn: "কাজ বকেয়া",
        bodyBn: `${line.titles.length}টি কাজ এখনও শেষ হয়নি: ${shown}${more}`,
        refs: { date: dateKey },
        dedupeKey: taskDedupeKeys.overdue(dateKey, line.recipientId),
      });
      if (res.created) n += 1;
    });
  }
  return n;
}
