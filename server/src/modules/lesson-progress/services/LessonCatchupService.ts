/**
 * Lesson-plan progress LP-4 (D-#827) — the Office's corrective action: a catch-up TASK on the
 * work board for the শাখা × subject's teacher, recorded as a `LessonCatchup`.
 *
 *  - reads (`catchupsFor`, `openCatchupCounts`) are used by the tracker / overview;
 *  - `catchupSuggestion` pre-fills the form (the routine teacher(s) + class teacher, a title, notes
 *    naming the skipped sessions and those many students missed, a due date a week out);
 *  - `createCatchup` writes through the EXISTING `createTask` (its `work_board:assign` gate, audit
 *    and TASK_ASSIGNED notice), then the record. No new permission (D-#826 view_all + work_board:assign).
 */
import { Types } from "mongoose";
import type { AccessProfile } from "@scd/shared";
import type { AuthPayload } from "../../../context";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { liveWindow } from "../../routine/liveWindow";
import { Task } from "../../workboard/models/Task";
import { createTask } from "../../workboard/services/TaskService";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";
import { LessonCatchup } from "../models/LessonCatchup";
import { LessonProgressError } from "./LessonDeliveryService";
import type { CatchupView, SectionTracker } from "./LessonProgressService";

type Auth = AccessProfile & { userId: string; role: string };

/** Catch-up tasks of one শাখা × subject, newest first, with the task's live state. */
export async function catchupsFor(sectionId: string, subject: string): Promise<CatchupView[]> {
  const rows = await LessonCatchup.find({ sectionId: new Types.ObjectId(sectionId), subject }).sort({ createdAt: -1 }).limit(50).lean();
  if (rows.length === 0) return [];
  const tasks = await Task.find({ _id: { $in: rows.map((r) => r.taskId) } })
    .select("titleBn assigneeUserId dueKey status blockedReason cancelledAt")
    .lean();
  const byId = new Map(tasks.map((t) => [String(t._id), t]));
  const names = new Map(
    (await User.find({ _id: { $in: tasks.map((t) => t.assigneeUserId) } }).select("name").lean()).map((u) => [String(u._id), u.name as string]),
  );
  return rows.map((r) => {
    const t = byId.get(String(r.taskId));
    return {
      id: String(r._id),
      taskId: String(r.taskId),
      titleBn: t?.titleBn ?? "",
      assigneeName: t ? names.get(String(t.assigneeUserId)) ?? "" : "",
      dueKey: t?.dueKey ?? "",
      status: !t || t.cancelledAt ? "CANCELLED" : t.status,
      blockedReason: t?.blockedReason ?? null,
      createdAt: new Date(r.createdAt).toISOString(),
      snapshot: r.snapshot,
    };
  });
}

/** `sectionId|subject` → catch-up tasks not done and not cancelled. */
export async function openCatchupCounts(pairs: Array<{ sectionId: string; subject: string }>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (pairs.length === 0) return out;
  const rows = await LessonCatchup.find({ $or: pairs.map((p) => ({ sectionId: new Types.ObjectId(p.sectionId), subject: p.subject })) })
    .select("sectionId subject taskId")
    .lean();
  if (rows.length === 0) return out;
  const open = new Set(
    (await Task.find({ _id: { $in: rows.map((r) => r.taskId) }, status: { $ne: "DONE" }, cancelledAt: null }).select("_id").lean()).map((t) => String(t._id)),
  );
  for (const r of rows) {
    if (!open.has(String(r.taskId))) continue;
    const k = `${r.sectionId}|${r.subject}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

export interface CatchupSuggestion {
  assignees: Array<{ userId: string; name: string; why: "ROUTINE" | "CLASS_TEACHER" }>;
  titleBn: string;
  notes: string;
  dueKey: string;
  sessionKeys: string[];
}

/** The pre-filled form for a catch-up (from the tracker the caller already opened). */
export async function catchupSuggestion(t: SectionTracker, today = new Date()): Promise<CatchupSuggestion> {
  const { row } = t;
  const slots = (await RoutineSlot.find({
    groupType: "section",
    groupId: new Types.ObjectId(row.sectionId),
    subject: row.subject,
    active: true,
    isBreak: { $ne: true },
    ...liveWindow(today),
  })
    .select("teacherId")
    .lean()) as unknown as Array<{ teacherId?: Types.ObjectId }>;
  const sec = await Section.findById(row.sectionId).select("classTeacherId").lean();
  const ids: Array<{ id: string; why: "ROUTINE" | "CLASS_TEACHER" }> = [];
  for (const s of slots) if (s.teacherId && !ids.some((x) => x.id === String(s.teacherId))) ids.push({ id: String(s.teacherId), why: "ROUTINE" });
  if (sec?.classTeacherId && !ids.some((x) => x.id === String(sec.classTeacherId))) ids.push({ id: String(sec.classTeacherId), why: "CLASS_TEACHER" });
  const users = await User.find({ _id: { $in: ids.map((x) => new Types.ObjectId(x.id)) }, active: true }).select("name").lean();
  const nameOf = new Map(users.map((u) => [String(u._id), u.name as string]));

  const bn = (n: number | string) => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
  const label = (s: SectionTracker["sessions"][number]) => `${s.anchorWord} ${bn(s.chapter)} · সেশন ${bn(s.sessionIndex)}/${bn(s.sessionOf)} · ${s.titleBn}`;
  const skipped = t.sessions.filter((s) => s.status === "SKIPPED");
  // "Many missed": three or more children absent on a day the session was taught.
  const missed = t.sessions.filter((s) => s.status === "FINISHED" && s.absentCount >= 3);
  const lines: string[] = [];
  lines.push(`অগ্রগতি: ${bn(row.finished)}/${bn(row.total)} সেশন শেষ${row.lagSessions > 0 ? `, পাশের শাখার চেয়ে ${bn(row.lagSessions)} সেশন পিছিয়ে` : ""}।`);
  if (skipped.length) lines.push(`বাদ পড়া সেশন: ${skipped.map(label).join("; ")}`);
  if (missed.length) lines.push(`অনেকে অনুপস্থিত ছিল: ${missed.map((s) => `${label(s)} (${bn(s.absentCount)} জন)`).join("; ")}`);
  lines.push("কীভাবে ঘাটতি পূরণ করবেন তা পরিকল্পনা করে এই কাজে লিখে জানান।");
  return {
    assignees: ids.filter((x) => nameOf.has(x.id)).map((x) => ({ userId: x.id, name: nameOf.get(x.id)!, why: x.why })),
    titleBn: `${row.classNameBn} ${row.sectionNameBn} — পাঠ পরিকল্পনার ঘাটতি পূরণ`,
    notes: lines.join("\n"),
    dueKey: dateKeyOf(new Date(parseDateKey(dateKeyOf(today)).getTime() + 7 * 864e5)),
    sessionKeys: [...skipped, ...missed].map((s) => s.key),
  };
}

export interface CatchupInput {
  assigneeUserId: string;
  titleBn: string;
  notes?: string | null;
  dueKey: string;
  effortMin?: number | null;
  sessionKeys?: string[] | null;
}

/** Raise the catch-up: the work-board task first (its own gates), then the record. */
export async function createCatchup(t: SectionTracker, input: CatchupInput, auth: Auth): Promise<CatchupView> {
  if (!input.assigneeUserId) throw new LessonProgressError("কাকে কাজটি দেবেন তা বাছুন।");
  const task = await createTask(auth as unknown as AuthPayload, {
    titleBn: input.titleBn,
    notes: input.notes ?? null,
    assigneeUserId: input.assigneeUserId,
    forLabel: `পাঠ অগ্রগতি · ${t.row.classNameBn} ${t.row.sectionNameBn}`,
    priority: "NORMAL",
    dueKey: input.dueKey,
    slot: "ANY",
    effortMin: input.effortMin ?? 40,
  });
  const keys = new Set(t.sessions.map((s) => s.key));
  await LessonCatchup.create([
    {
      sectionId: new Types.ObjectId(t.row.sectionId),
      subject: t.row.subject,
      taskId: task._id,
      createdBy: new Types.ObjectId(auth.userId),
      snapshot: { finished: t.row.finished, total: t.row.total, lagSessions: t.row.lagSessions, skipped: t.row.skipped },
      sessionKeys: (input.sessionKeys ?? []).filter((k) => keys.has(k)),
    },
  ]);
  const [view] = (await catchupsFor(t.row.sectionId, t.row.subject)).filter((c) => c.taskId === String(task._id));
  return view;
}
