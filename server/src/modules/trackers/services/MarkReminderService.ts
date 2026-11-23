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
 * AL-9 (switch on): a second, later question rides the same ladder — "are the per-question marks entered?".
 * A homework / assignment paper still OPEN after its deadline (MarkDeadlineService) is a "MARKS" row: it joins the
 * teacher's pop-up (one reminder per teacher per day, the same MORNING / NINE acks), the 09:30 snapshot, and — from
 * term 2 — one quiet staff-mistake row (D-#1020). With the switch off none of it exists.
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
import { MarkEscalation, MarkReminderAck, type MarkReminderStage, type MarkRowStage } from "../models/MarkReminder";
import { confirmedPaperIds, latePapers, type LatePaper, type MarkTracker } from "./MarkDeadlineService";
import { reportSilentFailure } from "../../../lib/reportError";
import { RoutineSubstitution } from "../../routine/models/RoutineSubstitution";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { emitMarkSubmissionEscalation } from "../../notifications/services/emitters";
import { recordPlaceMistake } from "../../staff-mistakes/services/StaffMistakeNoteService";
import { isPausedOn } from "../../academic-pause/services/AcademicPauseService";

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
  /** AL-9 — absent / "RECORDS" = nobody marked who handed in (2026); "MARKS" = the paper's marks are not entered. */
  stage?: MarkRowStage;
  tracker?: MarkTracker;
  paperId?: string;
  mistakeDue?: boolean;
  /** MARKS rows: per teacher, the day their deadline really fell on (the day an approved leave is checked against). */
  effectiveKeys?: Record<string, string>;
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
  // D-#1655: no marking pop-ups / escalation on an ASSIGNMENT_CHASE-paused day.
  if (await isPausedOn("ASSIGNMENT_CHASE", today)) return [];
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

/** AL-9: papers whose marks are still not entered after their deadline, as ladder items (empty with the switch off). */
/** The late-paper read is ~8 queries and the pop-up polls every few minutes per teacher: when the caller asks for the live
 *  clock (`cacheable`) the result is kept for LATE_CACHE_MS. An explicit `now` (tests, the scheduler) always reads fresh. */
const LATE_CACHE_MS = 30_000;
let lateCache: { at: number; dayKey: string; late: LatePaper[] } | null = null;

/** `latePapers` that can never break the 2026 RECORDS path: a throw is reported and reads as "nothing late". */
async function safeLatePapers(now: Date, cacheable: boolean): Promise<LatePaper[]> {
  try {
    if (cacheable && lateCache && Date.now() - lateCache.at < LATE_CACHE_MS && lateCache.dayKey === dhakaDayKey(now)) return lateCache.late;
    const late = await latePapers(now);
    if (cacheable) lateCache = { at: Date.now(), dayKey: dhakaDayKey(now), late };
    return late;
  } catch (err) {
    await reportSilentFailure("MarkReminderService.latePapers", err);
    return [];
  }
}

/** Test hook: forget the cached late list. */
export function resetLateMarkCache(): void {
  lateCache = null;
}

export async function lateMarkItems(now: Date = new Date(), cacheable = false): Promise<DueItemShape[]> {
  const late = await safeLatePapers(now, cacheable);
  if (late.length === 0) return [];
  const labels = await sectionLabels([...new Set(late.map((l) => l.sectionId))]);
  return late.map((l) => ({
    asItemId: l.itemId,
    asId: l.code,
    subject: l.subject,
    sectionId: l.sectionId,
    sectionLabel: labels.get(l.sectionId) ?? "",
    marked: false,
    teacherIds: l.teacherIds,
    stage: "MARKS" as const,
    tracker: l.tracker,
    paperId: l.paperId,
    mistakeDue: l.mistakeDue,
    effectiveKeys: l.effectiveKeys,
  }));
}

// ---------------------------------------------------------------------------
// The teacher's pop-ups (MORNING / NINE)
// ---------------------------------------------------------------------------

export interface MyMarkReminderShape {
  stage: "MORNING" | "NINE";
  dateKey: string;
  items: DueItemShape[];
}

export async function myMarkReminder(userId: string, nowArg?: Date): Promise<MyMarkReminderShape | null> {
  const now = nowArg ?? new Date();
  const mine = [...(await dueItemsToday(now)), ...(await lateMarkItems(now, !nowArg))].filter((i) => i.teacherIds.includes(userId));
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
  const records = (await dueItemsToday(now)).filter((i) => !i.marked);
  const marks = await lateMarkItems(now);
  const late = [...records, ...marks];
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
        ...(i.stage === "MARKS" ? { stage: "MARKS" as const, tracker: i.tracker, paperId: new Types.ObjectId(i.paperId!) } : {}),
      })),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return 0; // another tick won the race
    throw err;
  }
  const teacherCount = new Set(late.flatMap((i) => i.teacherIds)).size;
  // D-#955: on the 09:30 list — a missed duty for each teacher of the item.
  for (const i of records) {
    for (const t of i.teacherIds) {
      await recordPlaceMistake({
        kind: "ASSIGNMENT_UNMARKED", tier: 3, refKey: i.asItemId, ownerId: t, correctedBy: "system", at: now,
        oncePerRef: true, leaveDateKey: dateKey, line: `${i.asId}: ০৯:৩০-এর মধ্যেও জমার হিসাব দেওয়া হয়নি`,
      });
    }
  }
  // AL-9 R30: term 1 = the list + the Principal's alert only; from `lateMarksMistakeFromTerm` also ONE quiet row per
  // teacher x paper (no notice to the teacher, D-#1020, even with staff_mistakes:view_own: `quiet`).
  for (const i of marks) {
    if (!i.mistakeDue) continue;
    for (const t of i.teacherIds) {
      await recordPlaceMistake({
        kind: i.tracker === "HOMEWORK" ? "HOMEWORK_MARKS_LATE" : "ASSIGNMENT_MARKS_LATE", tier: 3, refKey: `AL9:${i.tracker}:${i.asItemId}`,
        ownerId: t, correctedBy: "system", at: now, oncePerRef: true, quiet: true,
        leaveDateKey: i.effectiveKeys?.[t] ?? dateKey,
        line: `${i.asId}: ${i.tracker === "HOMEWORK" ? "বাড়ির কাজের" : "অ্যাসাইনমেন্টের"} প্রশ্নভিত্তিক নম্বর শেষ দিনের মধ্যে দেওয়া হয়নি`,
      });
    }
  }
  return emitMarkSubmissionEscalation({ dateKey, teacherCount, itemCount: late.length, marksItemCount: marks.length });
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
  /** AL-9: "RECORDS" (2026 hand-in ladder) or "MARKS" (per-question marks not entered). */
  stage: MarkRowStage;
  tracker: MarkTracker;
}

export interface MyMarkEscalationShape {
  dateKey: string;
  createdAt: Date;
  rows: MarkEscalationRowShape[];
}

type SnapRow = {
  asItemId: Types.ObjectId; asId: string; sectionId: Types.ObjectId; subject: HwSubject; teacherIds: Types.ObjectId[];
  stage?: MarkRowStage; tracker?: MarkTracker; paperId?: Types.ObjectId;
};

/** Keys (`RECORDS:<id>` / `MARKS:<id>`, so one id in both stages cannot mask the other) of these rows still open: records GIVEN|DUE for a RECORDS row, an unconfirmed
 *  paper for a MARKS row. */
async function openRowIds(rows: SnapRow[]): Promise<Set<string>> {
  const records = rows.filter((r) => r.stage !== "MARKS");
  const marks = rows.filter((r) => r.stage === "MARKS" && r.paperId);
  const open = new Set<string>();
  for (const id of await unmarkedIds(records.map((r) => r.asItemId))) open.add(`RECORDS:${id}`);
  if (marks.length) {
    const done = await confirmedPaperIds(marks.map((r) => r.paperId!));
    for (const r of marks) if (!done.has(String(r.paperId))) open.add(`MARKS:${r.asItemId}`);
  }
  return open;
}

/** Rows of one snapshot, with names, labels and "marked since". */
async function escalationShape(snap: {
  dateKey: string;
  createdAt: Date;
  rows: SnapRow[];
}): Promise<MyMarkEscalationShape> {
  const open = await openRowIds(snap.rows);
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
      markedNow: !open.has(`${r.stage ?? "RECORDS"}:${r.asItemId}`),
      stage: r.stage ?? "RECORDS",
      tracker: r.tracker ?? "ASSIGNMENT",
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
    .select("dateKey rows.asItemId rows.stage rows.paperId")
    .lean();
  const open = await openRowIds(snaps.flatMap((s) => s.rows) as unknown as SnapRow[]);
  return snaps.map((s) => ({
    dateKey: s.dateKey,
    itemCount: s.rows.length,
    openCount: s.rows.filter((r) => open.has(`${r.stage ?? "RECORDS"}:${r.asItemId}`)).length,
  }));
}

export async function acknowledgeMarkEscalation(userId: string, now: Date = new Date()): Promise<boolean> {
  await writeAck(userId, dhakaDayKey(now), "ESCALATION");
  return true;
}
