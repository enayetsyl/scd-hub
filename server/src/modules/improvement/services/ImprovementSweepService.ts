/**
 * The 11:00 improvement sweep (SP-4, docs/prd-student-progress.md §7, D-#738), run by the
 * scheduler on FULL school days:
 *
 *   1. IMPROVEMENT_TASKS_PENDING — ONE row per Office/Principal (acting-as) when at least
 *      one teacher task of today has no tick yet. Rolled up, never one row per task (the
 *      D-#603 lesson: a noisy inbox stops being read). The list is one tap away.
 *   2. IMPROVEMENT_GUARDIAN_MISSED — to the section's class teacher, when a child's
 *      guardian has left the last 3 scheduled days before today unmarked. One row per
 *      run of missed days (the dedupe key names the run's first day), so a guardian who
 *      stays silent is reported once, not every morning.
 */
import { Types } from "mongoose";
import { HW_SUBJECT_LABELS_BN } from "@scd/shared";
import { ImprovementAction } from "../models/ImprovementAction";
import { ImprovementTick } from "../models/ImprovementTick";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { actingAsFilter } from "../../foundation/services/RoleScope";
import { emit } from "../../notifications/services/NotificationService";
import { officeDayTasks, todayKey } from "./ImprovementActionService";
import { pastDays, trailingUnmarked, addDaysKey } from "../rules";

const str = (id: unknown): string => (id == null ? "" : String(id));

/** Roles told at 11:00 (template-aware via actingAsFilter, D-#467). */
export const IMPROVEMENT_DIGEST_ROLES = ["OFFICE", "PRINCIPAL"] as const;
/** 11:00 local. */
export const IMPROVEMENT_DIGEST_MINUTES = 11 * 60;
/** A guardian is reported after this many scheduled days in a row without a tick. */
export const GUARDIAN_MISSED_RUN = 3;

const bnDigits = (n: number): string => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

export async function emitPendingDigest(now = new Date()): Promise<number> {
  const dayKey = todayKey(now);
  const tasks = await officeDayTasks(dayKey);
  const pending = tasks.filter((t) => t.status === null);
  if (!pending.length) return 0;
  const byWho = new Map<string, number>();
  for (const t of pending) {
    const who = t.responsibleName ?? "দায়িত্ব কারও নয়";
    byWho.set(who, (byWho.get(who) ?? 0) + 1);
  }
  const listed = [...byWho.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, c]) => `${n} ${bnDigits(c)}`).join(", ");
  const recipients = (await User.find(actingAsFilter([...IMPROVEMENT_DIGEST_ROLES])).select("_id").lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  let created = 0;
  for (const r of recipients) {
    const res = await emit({
      recipientUserId: str(r._id),
      kind: "IMPROVEMENT_TASKS_PENDING",
      titleBn: `${bnDigits(pending.length)}টি উন্নতির কাজ এখনো চিহ্নিত হয়নি`,
      bodyBn: `${listed}${byWho.size > 4 ? " …" : ""} — দেখে শিক্ষককে মনে করিয়ে দিন বা তাঁর পক্ষে চিহ্নিত করুন।`,
      refs: { date: dayKey },
      dedupeKey: `IATP:${dayKey}:${str(r._id)}`,
    });
    if (res.created) created += 1;
  }
  return created;
}

export async function emitGuardianMissed(now = new Date()): Promise<number> {
  const today = todayKey(now);
  const actions = (await ImprovementAction.find({
    stoppedAt: null,
    guardianTask: { $ne: null },
    alertClassTeacher: true,
    dayKeys: { $lt: today },
  }).lean()) as unknown as Array<{
    _id: Types.ObjectId;
    scope: string;
    sectionId: Types.ObjectId;
    studentId?: Types.ObjectId | null;
    subject: string;
    dayKeys: string[];
  }>;
  let created = 0;
  for (const a of actions) {
    // An action that ended more than a week ago is history; the dedupe key already stops
    // a run from being reported twice, this only saves the reads.
    const last = a.dayKeys[a.dayKeys.length - 1];
    if (last < addDaysKey(today, -7)) continue;
    const past = pastDays(a.dayKeys, today);
    if (past.length < GUARDIAN_MISSED_RUN) continue;
    const section = (await Section.findById(a.sectionId).select("classTeacherId nameBn").lean()) as { classTeacherId?: Types.ObjectId; nameBn: string } | null;
    if (!section?.classTeacherId) continue;
    const kids = a.studentId
      ? ((await Student.find({ _id: a.studentId, active: true }).select("name nameBn").lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string }>)
      : ((await Student.find({ sectionId: a.sectionId, active: true }).select("name nameBn").lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string }>);
    const ticks = (await ImprovementTick.find({ actionId: a._id, part: "GUARDIAN" }).select("studentId dayKey").lean()) as unknown as Array<{ studentId: Types.ObjectId; dayKey: string }>;
    for (const k of kids) {
      const mine = new Set(ticks.filter((t) => str(t.studentId) === str(k._id)).map((t) => t.dayKey));
      const run = trailingUnmarked(past, mine);
      if (run < GUARDIAN_MISSED_RUN) continue;
      const runStart = past[past.length - run];
      const res = await emit({
        recipientUserId: str(section.classTeacherId),
        kind: "IMPROVEMENT_GUARDIAN_MISSED",
        titleBn: `অভিভাবক টানা ${bnDigits(run)} দিন চিহ্নিত করেননি`,
        bodyBn: `${k.nameBn || k.name} (${section.nameBn}) — ${(HW_SUBJECT_LABELS_BN as Record<string, string>)[a.subject] ?? a.subject}: স্কুলের দেওয়া কাজটি বাড়িতে হচ্ছে কি না অভিভাবকের সাথে কথা বলুন।`,
        refs: { improvementActionId: str(a._id), studentId: str(k._id), date: today },
        dedupeKey: `IAGM:${str(a._id)}:${str(k._id)}:${runStart}`,
      });
      if (res.created) created += 1;
    }
  }
  return created;
}
