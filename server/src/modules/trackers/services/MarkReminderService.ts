/**
 * MarkReminderService (D-#889/#890, docs/prd-mark-submission-guard.md §2) — the Sunday
 * mark-submission ladder for Thursday assignments.
 *
 * "Sunday" is the item's DUE DAY: an ISSUED AssignmentItem whose `dueDate` is today. The
 * holiday rolls (D-#86) already moved `dueDate`, so a rolled week rings on the rolled day
 * and this module owns no calendar. An item is UNMARKED while any original record is still
 * GIVEN | DUE — the submit pass leaves every actionable record SUBMITTED or CHASE.
 *
 * The item's teachers (owner, 2026-11-02): whoever gave it on Thursday (`deliveredBy`), and
 * the proxy covering that section for them on the due day — an active RoutineSubstitution
 * dated today, on a section slot of the item's section, whose absent teacher is the
 * deliverer or the item's subject teacher.
 *
 *   first open   MORNING — every teacher of a due item, once per day
 *   09:00        NINE    — teachers still unmarked; only "বুঝেছি" closes it, once per day
 *   09:30        the scheduler snapshots what is still unmarked and pushes Office + Principal
 *                (`mark_submission:alerts`); their pop-up reads the snapshot
 *
 * Identity/operational plane behind ADR-005 (no corpus path).
 */
import { Types } from "mongoose";
import type { HwSubject } from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { personName } from "../../../lib/personName";
import { dateOnlyISO } from "../assignmentCalendar";
import { AssignmentItem } from "../models/AssignmentItem";
import { AssignmentStudentRecord } from "../models/AssignmentStudentRecord";
import { MarkEscalation, MarkReminderAck, type MarkReminderStage } from "../models/MarkReminder";
import { RoutineSubstitution } from "../../routine/models/RoutineSubstitution";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { emitMarkSubmissionEscalation } from "../../notifications/services/emitters";
import { recordPlaceMistake } from "../../staff-mistakes/services/StaffMistakeNoteService";

/** 09:00 Asia/Dhaka — the "বুঝেছি" pop-up opens for teachers still unmarked. */
export const MARK_NINE_MINUTES = 9 * 60;
/** 09:30 — the scheduler's escalation rung (local clock = Dhaka on the VM). */
export const MARK_ESCALATION_MINUTES = 9 * 60 + 30;

/** Minutes since Dhaka midnight. Dhaka has no DST, so UTC+6 is exact. */
export function dhakaMinutes(d: Date): number {
  return ((d.getUTCHours() + 6) % 24) * 60 + d.getUTCMinutes();
}

/** The calendar day of a date-only anchor (stored at local midnight), as YYYY-MM-DD. */
const anchorKey = (d: Date) => dateOnlyISO(new Date(d)).slice(0, 10);

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DueItemShape {
  asItemId: string;
  asId: string;
  subject: HwSubject;
  sectionId: string;
  sectionLabel: string;
  marked: boolean;
  teacherIds: string[];
}

async function sectionLabels(sectionIds: string[]): Promise<Map<string, string>> {
  const sections = await Section.find({ _id: { $in: sectionIds } }).select("nameBn classId").lean();
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("nameBn").lean();
  const className = new Map(classes.map((c) => [String(c._id), c.nameBn]));
  return new Map(
    sections.map((s) => [String(s._id), [className.get(String(s.classId)), s.nameBn].filter(Boolean).join(" · ")]),
  );
}

/** Ids (of `ids`) still holding a GIVEN | DUE original record. */
async function unmarkedIds(ids: Types.ObjectId[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const open = await AssignmentStudentRecord.distinct("asItemId", {
    asItemId: { $in: ids },
    state: { $in: ["GIVEN", "DUE"] },
    resubOf: null,
  });
  return new Set(open.map((x) => String(x)));
}

/** Every ISSUED assignment due today, with its teachers and marked state. */
export async function dueItemsToday(now: Date = new Date()): Promise<DueItemShape[]> {
  const today = dhakaDayKey(now);
  const items = (
    await AssignmentItem.find({
      status: "ISSUED",
      dueDate: { $gte: new Date(now.getTime() - 3 * DAY_MS), $lte: new Date(now.getTime() + 3 * DAY_MS) },
    })
      .select("asId subject sectionId deliveredBy teacherId dueDate")
      .lean()
  ).filter((i) => anchorKey(i.dueDate) === today);
  if (items.length === 0) return [];

  const open = await unmarkedIds(items.map((i) => i._id));

  // Due-day proxies: today's active substitutions on section slots of these sections.
  const subs = (
    await RoutineSubstitution.find({
      active: true,
      date: { $gte: new Date(now.getTime() - 3 * DAY_MS), $lte: new Date(now.getTime() + 3 * DAY_MS) },
    })
      .select("slotId date coverTeacherId absentTeacherId")
      .lean()
  ).filter((s) => anchorKey(s.date) === today && s.absentTeacherId);
  const slots = subs.length
    ? await RoutineSlot.find({ _id: { $in: subs.map((s) => s.slotId) }, groupType: "section" })
        .select("groupId")
        .lean()
    : [];
  const slotSection = new Map(slots.map((s) => [String(s._id), String(s.groupId)]));

  const labels = await sectionLabels([...new Set(items.map((i) => String(i.sectionId)))]);
  return items.map((i) => {
    const owners = new Set([String(i.deliveredBy), String(i.teacherId)]);
    const teachers = new Set<string>([String(i.deliveredBy)]);
    for (const s of subs) {
      if (slotSection.get(String(s.slotId)) !== String(i.sectionId)) continue;
      if (!owners.has(String(s.absentTeacherId))) continue;
      teachers.add(String(s.coverTeacherId));
    }
    return {
      asItemId: String(i._id),
      asId: i.asId,
      subject: i.subject,
      sectionId: String(i.sectionId),
      sectionLabel: labels.get(String(i.sectionId)) ?? "",
      marked: !open.has(String(i._id)),
      teacherIds: [...teachers],
    };
  });
}

// ---------------------------------------------------------------------------
// The teacher's pop-ups (MORNING / NINE)
// ---------------------------------------------------------------------------

export interface MyMarkReminderShape {
  stage: "MORNING" | "NINE";
  dateKey: string;
  items: DueItemShape[];
}

export async function myMarkReminder(userId: string, now: Date = new Date()): Promise<MyMarkReminderShape | null> {
  const mine = (await dueItemsToday(now)).filter((i) => i.teacherIds.includes(userId));
  if (mine.length === 0) return null;
  const dateKey = dhakaDayKey(now);
  const acked = new Set(
    (await MarkReminderAck.find({ userId: new Types.ObjectId(userId), dateKey }).select("stage").lean()).map(
      (a) => a.stage,
    ),
  );
  const unmarked = mine.filter((i) => !i.marked);
  if (dhakaMinutes(now) >= MARK_NINE_MINUTES && unmarked.length > 0 && !acked.has("NINE")) {
    return { stage: "NINE", dateKey, items: unmarked };
  }
  // After the stronger 09:00 pop-up, the gentler morning one has nothing left to say.
  if (!acked.has("MORNING") && !acked.has("NINE")) return { stage: "MORNING", dateKey, items: mine };
  return null;
}

async function writeAck(userId: string, dateKey: string, stage: MarkReminderStage): Promise<void> {
  await MarkReminderAck.updateOne(
    { userId: new Types.ObjectId(userId), dateKey, stage },
    { $setOnInsert: { userId: new Types.ObjectId(userId), dateKey, stage } },
    { upsert: true },
  ).catch((err: { code?: number }) => {
    if (err.code !== 11000) throw err; // a double tap racing the upsert is already acked
  });
}

export async function acknowledgeMarkReminder(
  userId: string,
  stage: "MORNING" | "NINE",
  now: Date = new Date(),
): Promise<boolean> {
  const dateKey = dhakaDayKey(now);
  await writeAck(userId, dateKey, stage);
  if (stage === "NINE") await writeAck(userId, dateKey, "MORNING");
  return true;
}

// ---------------------------------------------------------------------------
// 09:30 — Office + Principal
// ---------------------------------------------------------------------------

/** The scheduler's 09:30 step: snapshot the still-unmarked items and push the alert
 *  holders. Idempotent per day (the snapshot is unique on dateKey). Returns rows written. */
export async function runMarkEscalation(now: Date = new Date()): Promise<number> {
  const dateKey = dhakaDayKey(now);
  if (await MarkEscalation.exists({ dateKey })) return 0;
  const late = (await dueItemsToday(now)).filter((i) => !i.marked);
  if (late.length === 0) return 0; // nothing unmarked ⇒ say nothing
  try {
    await MarkEscalation.create({
      dateKey,
      rows: late.map((i) => ({
        asItemId: new Types.ObjectId(i.asItemId),
        asId: i.asId,
        sectionId: new Types.ObjectId(i.sectionId),
        subject: i.subject,
        teacherIds: i.teacherIds.map((t) => new Types.ObjectId(t)),
      })),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return 0; // another tick won the race
    throw err;
  }
  const teacherCount = new Set(late.flatMap((i) => i.teacherIds)).size;
  // D-#955: on the 09:30 list — a missed duty for each teacher of the item.
  for (const i of late) {
    for (const t of i.teacherIds) {
      await recordPlaceMistake({
        kind: "ASSIGNMENT_UNMARKED", tier: 3, refKey: i.asItemId, ownerId: t, correctedBy: "system", at: now,
        oncePerRef: true, leaveDateKey: dateKey, line: `${i.asId}: ০৯:৩০-এর মধ্যেও জমার হিসাব দেওয়া হয়নি`,
      });
    }
  }
  return emitMarkSubmissionEscalation({ dateKey, teacherCount, itemCount: late.length });
}

export interface MarkEscalationRowShape {
  asItemId: string;
  asId: string;
  subject: HwSubject;
  sectionId: string;
  classId: string;
  sectionLabel: string;
  teacherNames: string[];
  /** Marked after the 09:30 snapshot. */
  markedNow: boolean;
}

export interface MyMarkEscalationShape {
  dateKey: string;
  createdAt: Date;
  rows: MarkEscalationRowShape[];
}

/** Rows of one snapshot, with names, labels and "marked since". */
async function escalationShape(snap: {
  dateKey: string;
  createdAt: Date;
  rows: { asItemId: Types.ObjectId; asId: string; sectionId: Types.ObjectId; subject: HwSubject; teacherIds: Types.ObjectId[] }[];
}): Promise<MyMarkEscalationShape> {
  const open = await unmarkedIds(snap.rows.map((r) => r.asItemId));
  const sectionIds = [...new Set(snap.rows.map((r) => String(r.sectionId)))];
  const labels = await sectionLabels(sectionIds);
  const sections = await Section.find({ _id: { $in: sectionIds } }).select("classId").lean();
  const classOf = new Map(sections.map((s) => [String(s._id), String(s.classId)]));
  const users = await User.find({ _id: { $in: snap.rows.flatMap((r) => r.teacherIds) } })
    .select("name nameBn")
    .lean();
  const name = new Map(users.map((u) => [String(u._id), personName(u)]));
  return {
    dateKey: snap.dateKey,
    createdAt: snap.createdAt,
    rows: snap.rows.map((r) => ({
      asItemId: String(r.asItemId),
      asId: r.asId,
      subject: r.subject,
      sectionId: String(r.sectionId),
      classId: classOf.get(String(r.sectionId)) ?? "",
      sectionLabel: labels.get(String(r.sectionId)) ?? "",
      teacherNames: r.teacherIds.map((t) => name.get(String(t)) ?? "").filter(Boolean),
      markedNow: !open.has(String(r.asItemId)),
    })),
  };
}

/** Today's 09:30 list for an alert holder who has not closed it yet. */
export async function myMarkEscalation(userId: string, now: Date = new Date()): Promise<MyMarkEscalationShape | null> {
  const dateKey = dhakaDayKey(now);
  const snap = await MarkEscalation.findOne({ dateKey }).lean();
  if (!snap || snap.rows.length === 0) return null;
  if (await MarkReminderAck.exists({ userId: new Types.ObjectId(userId), dateKey, stage: "ESCALATION" })) return null;
  return escalationShape(snap);
}

/**
 * D-#1106 — the 09:30 list reopened from a button, whether or not "বুঝেছি" was tapped.
 * `dateKey` omitted ⇒ the newest snapshot. Null when that day had none (nothing was late).
 */
export async function markEscalationFor(dateKey?: string | null): Promise<MyMarkEscalationShape | null> {
  const snap = dateKey
    ? await MarkEscalation.findOne({ dateKey }).lean()
    : await MarkEscalation.findOne({}).sort({ dateKey: -1 }).lean();
  if (!snap) return null;
  return escalationShape(snap);
}

export interface MarkEscalationDayShape {
  dateKey: string;
  itemCount: number;
  /** Rows still unmarked right now. */
  openCount: number;
}

/** D-#1106 — the days that had a 09:30 list, newest first, for the day picker. */
export async function markEscalationDays(limit = 26): Promise<MarkEscalationDayShape[]> {
  const snaps = await MarkEscalation.find({})
    .sort({ dateKey: -1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .select("dateKey rows.asItemId")
    .lean();
  const open = await unmarkedIds(snaps.flatMap((s) => s.rows.map((r) => r.asItemId)));
  return snaps.map((s) => ({
    dateKey: s.dateKey,
    itemCount: s.rows.length,
    openCount: s.rows.filter((r) => open.has(String(r.asItemId))).length,
  }));
}

export async function acknowledgeMarkEscalation(userId: string, now: Date = new Date()): Promise<boolean> {
  await writeAck(userId, dhakaDayKey(now), "ESCALATION");
  return true;
}
