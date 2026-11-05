/**
 * TaskSweepService (WB-1, D-#701) — the two scheduler jobs for MANUAL tasks:
 *   07:30  due digest  — one row per person with open work (today + overdue)
 *   16:00  overdue     — one row per recipient: assignee AND assigner, for every
 *                        task still open at end of day
 *   08:00 / 17:00  "tasks you gave" — one row per assigner (D-#966)
 * All are called from the notification ticker behind its school-day gate and are
 * idempotent per (date, recipient) through the dedupe keys.
 */
import { dateKeyOf, parseDateKey } from "../../attendance/dates";
import { Task, type ITask } from "../models/Task";
import {
  emitTaskDueDigest,
  emitTaskGivenSummary,
  emitTaskOverdue,
  type DigestLine,
  type GivenSummaryLine,
  type OverdueLine,
} from "./workBoardNotifications";
import { recordPlaceMistake } from "../../staff-mistakes/services/StaffMistakeNoteService";

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
  // D-#955: past its day and still open — the assignee's missed duty, once per task.
  for (const t of tasks) {
    if (t.dueKey >= todayKey) continue;
    await recordPlaceMistake({
      kind: "TASK_OVERDUE", tier: 3, refKey: String(t._id), ownerId: t.assigneeUserId, correctedBy: "system", at: now,
      oncePerRef: true, leaveDateKey: t.dueKey, line: `"${t.titleBn}" — শেষ তারিখ ${t.dueKey} পেরিয়ে গেছে`,
    });
  }
  return emitTaskOverdue(todayKey, overdueLines(tasks, todayKey));
}

// ---------------------------------------------------------------------------
// D-#966: "tasks you gave" — 08:00 and 17:00 to every assigner, others' tasks only.
// ---------------------------------------------------------------------------

export const TASK_GIVEN_AM_MINUTES = 8 * 60;
export const TASK_GIVEN_PM_MINUTES = 17 * 60;
export type GivenPart = "AM" | "PM";

type GivenTask = Pick<ITask, "assigneeUserId" | "assignedBy" | "dueKey" | "status" | "blockedReason" | "doneAt">;

/** Pure: per assigner, counts over the tasks they gave SOMEONE ELSE. A line with
 *  nothing to say is dropped. AM = open due today / overdue; PM = done today, still
 *  open (due ≤ today), and blocked among those open. */
export function givenSummaryLines(tasks: GivenTask[], todayKey: string, part: GivenPart): GivenSummaryLine[] {
  const by = new Map<string, GivenSummaryLine>();
  for (const t of tasks) {
    const giver = t.assignedBy.toString();
    if (giver === t.assigneeUserId.toString()) continue;
    const line = by.get(giver) ?? { recipientId: giver, dueToday: 0, overdue: 0, doneToday: 0, open: 0, blocked: 0 };
    if (t.status === "DONE") {
      if (part === "PM" && t.doneAt && dateKeyOf(new Date(t.doneAt)) === todayKey) line.doneToday += 1;
    } else if (t.dueKey <= todayKey) {
      if (t.dueKey === todayKey) line.dueToday += 1;
      else line.overdue += 1;
      line.open += 1;
      if (t.blockedReason) line.blocked += 1;
    }
    by.set(giver, line);
  }
  return [...by.values()].filter((l) => (part === "AM" ? l.open > 0 : l.open + l.doneToday > 0));
}

export async function dispatchTaskGivenSummary(now: Date, part: GivenPart): Promise<number> {
  const todayKey = dateKeyOf(now);
  const tasks = (await Task.find({
    cancelledAt: null,
    $or: [{ status: { $ne: "DONE" }, dueKey: { $lte: todayKey } }, { status: "DONE", doneAt: { $gte: parseDateKey(todayKey) } }],
  })
    .select("assigneeUserId assignedBy dueKey status blockedReason doneAt")
    .lean()) as unknown as GivenTask[];
  return emitTaskGivenSummary(todayKey, part, givenSummaryLines(tasks, todayKey, part));
}
