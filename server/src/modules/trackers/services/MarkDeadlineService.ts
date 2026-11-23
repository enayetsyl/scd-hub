/**
 * MarkDeadlineService (AL-9, docs/prd-academic-loop-2027.md §7, R3, R30, B10) — the "marks entered" stage of the
 * mark-submission ladder (D-#889–#893).
 *
 * The 2026 ladder asks one question on an assignment's due Sunday: "who handed it in?" (records GIVEN | DUE). This
 * stage asks the 2027 question: "are the per-question marks entered and the paper confirmed?" It watches the papers the
 * AL-4 / AL-6 creators linked to a tracker item (`MasteryPaper.trackerLinked`, `links.hwItemId` / `links.asItemId`):
 *
 *   homework   deadline = the day it COMES IN (the records' `dueDate`, set at issue by resolveHomeworkDueDate - the next teaching
 *              day, holiday-rolled; NOT `dateGiven`) + `hwMarkDeadlineDays` open school days (0 = the day it comes in)
 *   assignment deadline = the first `asMarkDeadlineDow` weekday on or after the hand-in day, rolled to an open day
 *
 * A paper still OPEN after its deadline is late. Per owning teacher, the deadline moves past every day that is closed
 * (Fri/Sat/holiday), paused (`HOMEWORK_REQUIRED` for homework; `ASSIGNMENT_CHASE` / `ASSIGNMENT_GENERATION` for the
 * assignment, D-#1655) or on that teacher's approved leave (AC-S2: the first school day back). A paper confirmed by
 * ANYONE — the subject teacher or a substitute — is simply not late, so "a substitute who marked counts" needs no
 * extra rule. The check is per PAPER, never per child, so a child on ABSENT_REDELIVER can neither hold a paper late nor
 * be counted unmarked (AC-E3).
 *
 * The stage is silent on a day that is not an open school day (lead decision): no late list, no snapshot, no pop-up.
 * It looks back LOOKBACK_DAYS (60) from today only: an older unconfirmed paper is history, not a live deadline.
 *
 * Everything is behind the release switch (`academicLoop2027On`, §3.6): with it OFF `latePapers` returns [] before any
 * other read and the 2026 ladder is untouched. Identity/operational plane (ADR-005: no corpus path).
 */
import { Types } from "mongoose";
import type { HwSubject } from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { termOfDate } from "../../../lib/academicTerm";
import { atMidnight, dateOnlyISO } from "../assignmentCalendar";
import { deadlineFrom } from "../classTestCalendar";
import { loadOpenDayPredicate } from "./AssignmentScheduleService";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { AssignmentItem } from "../models/AssignmentItem";
import { MasteryPaper } from "../../mastery/models/MasteryPaper";
import { getPolicy } from "../../mastery/services/MasteryCatalogueService";
import { isLoop2027On } from "../../assessment/services/QuestionUseService";
import { loadPausePredicate, type PauseKind } from "../../academic-pause/services/AcademicPauseService";
import { StaffLeaveApplication } from "../../hr/models/StaffLeaveApplication";
import { resolveStaffProfileForUser } from "../../hr/services/staffMatch";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Papers older than this are history, not a deadline anyone can still act on. */
const LOOKBACK_DAYS = 60;
/** Hard stop for the "move the deadline forward" walk (a longer run means bad calendar data). */
const MAX_WALK_DAYS = 120;

export type MarkTracker = "HOMEWORK" | "ASSIGNMENT";

export interface LatePaper {
  tracker: MarkTracker;
  /** The tracker item's Mongo id (HomeworkItem or AssignmentItem). */
  itemId: string;
  /** The tracker item's printed code (HW-… / AS-…). */
  code: string;
  subject: HwSubject;
  sectionId: string;
  paperId: string;
  /** The nominal deadline day (before leave / pause / closed-day moves). */
  deadlineKey: string;
  /** The teachers whose own deadline has passed (leave-aware). */
  teacherIds: string[];
  /** Per late teacher: the day their deadline actually fell on after closed / paused / leave days (the day the leave rule reads). */
  effectiveKeys: Record<string, string>;
  /** R30: this late paper also writes the quiet staff-mistake row (the term is ≥ `lateMarksMistakeFromTerm`). */
  mistakeDue: boolean;
}

const keyOf = (d: Date): string => dateOnlyISO(d).slice(0, 10);
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function ids(...xs: (Types.ObjectId | string | null | undefined)[]): string[] {
  return [...new Set(xs.filter(Boolean).map(String))];
}

/** The assignment deadline: the first `dow` weekday on or after the hand-in day, rolled forward to an open day. */
function assignmentDeadline(dueDate: Date, dow: number, isOpen: (d: Date) => boolean): Date {
  const base = atMidnight(dueDate);
  let d = addDays(base, (dow - base.getDay() + 7) % 7);
  for (let i = 0; i < MAX_WALK_DAYS && !isOpen(d); i++) d = addDays(d, 1);
  return d;
}

/**
 * Every paper that is late right now, with the teachers it is late for. Empty with the switch off.
 * Pure read — nothing is written here.
 */
export async function latePapers(now: Date = new Date()): Promise<LatePaper[]> {
  if (!(await isLoop2027On())) return [];
  const today = dhakaDayKey(now);
  const policy = (await getPolicy(null, null)).resolved;
  const hwDays = Number(policy.hwMarkDeadlineDays ?? 0);
  const asDow = Number(policy.asMarkDeadlineDow ?? 2);
  const fromTerm = Number(policy.lateMarksMistakeFromTerm ?? 2);

  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
  const papers = await MasteryPaper.find({
    trackerLinked: true,
    extra: { $ne: true },
    source: { $in: ["HW", "AS"] },
    entryState: { $ne: "CONFIRMED" },
    date: { $gte: since },
  })
    .select("source links academicYearId")
    .lean();
  if (papers.length === 0) return [];

  const hwPaper = new Map<string, (typeof papers)[number]>();
  const asPaper = new Map<string, (typeof papers)[number]>();
  for (const p of papers) {
    if (p.source === "HW" && p.links?.hwItemId) hwPaper.set(String(p.links.hwItemId), p);
    if (p.source === "AS" && p.links?.asItemId) asPaper.set(String(p.links.asItemId), p);
  }
  const hwItems = hwPaper.size
    ? await HomeworkItem.find({ _id: { $in: [...hwPaper.keys()] }, status: "issued" })
        .select("hwId subject sectionId dateGiven declaredBy")
        .lean()
    : [];
  const asItems = asPaper.size
    ? await AssignmentItem.find({ _id: { $in: [...asPaper.keys()] }, status: "ISSUED" })
        .select("asId subject sectionId dueDate deliveredBy teacherId")
        .lean()
    : [];
  if (hwItems.length + asItems.length === 0) return [];

  const isOpen = await loadOpenDayPredicate(since, new Date(now.getTime() + 7 * DAY_MS));
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  if (!isOpen(new Date(ty, tm - 1, td))) return []; // closed day: the marks stage says nothing
  const isPaused = await loadPausePredicate(keyOf(since), today);

  // Approved leave per owning teacher, in one pass.
  const owners = ids(...hwItems.map((i) => i.declaredBy), ...asItems.flatMap((i) => [i.deliveredBy, i.teacherId]));
  const profileOf = new Map<string, string>();
  for (const o of owners) {
    const prof = await resolveStaffProfileForUser(o);
    if (prof) profileOf.set(o, String(prof._id));
  }
  const leaves = profileOf.size
    ? await StaffLeaveApplication.find({
        staffProfileId: { $in: [...profileOf.values()].map((p) => new Types.ObjectId(p)) },
        status: "approved",
        fromKey: { $lte: today },
        toKey: { $gte: keyOf(since) },
      })
        .select("staffProfileId fromKey toKey")
        .lean()
    : [];
  const onLeave = (owner: string, key: string): boolean => {
    const prof = profileOf.get(owner);
    return !!prof && leaves.some((l) => String(l.staffProfileId) === prof && l.fromKey <= key && l.toKey >= key);
  };

  /** The first day on or after `from` this owner is actually expected to mark (open, unpaused, not on leave). */
  const effectiveKey = (from: Date, owner: string, kinds: PauseKind[]): string | null => {
    let d = from;
    for (let i = 0; i < MAX_WALK_DAYS; i++) {
      const k = keyOf(d);
      if (k > today) return null; // still in the future: not late today
      if (isOpen(d) && !kinds.some((kind) => isPaused(kind, k)) && !onLeave(owner, k)) return k;
      d = addDays(d, 1);
    }
    return null;
  };

  // The day each homework comes in: the records' due date (an absent child has none until re-delivered).
  const hwDue = new Map<string, Date>();
  if (hwItems.length) {
    const rows = await HomeworkStudentRecord.aggregate<{ _id: Types.ObjectId; due: Date }>([
      { $match: { hwItemId: { $in: hwItems.map((i) => i._id) }, dueDate: { $ne: null } } },
      { $group: { _id: "$hwItemId", due: { $min: "$dueDate" } } },
    ]);
    for (const r of rows) hwDue.set(String(r._id), r.due);
  }

  const termCache = new Map<string, number>();
  const out: LatePaper[] = [];

  async function consider(args: {
    tracker: MarkTracker; item: { _id: Types.ObjectId; subject: HwSubject; sectionId: Types.ObjectId };
    code: string; paper: (typeof papers)[number]; deadline: Date; owners: string[]; kinds: PauseKind[];
  }): Promise<void> {
    // A paused TODAY is silent for everyone (AC-P1) — the walk below also moves past earlier paused days.
    if (args.kinds.some((kind) => isPaused(kind, today))) return;
    const effectiveKeys: Record<string, string> = {};
    const late = args.owners.filter((o) => {
      const eff = effectiveKey(args.deadline, o, args.kinds);
      if (eff !== null && today > eff) {
        effectiveKeys[o] = eff;
        return true;
      }
      return false;
    });
    if (late.length === 0) return;
    const term = await termOfDate(args.paper.academicYearId, now, termCache);
    out.push({
      tracker: args.tracker,
      itemId: String(args.item._id),
      code: args.code,
      subject: args.item.subject,
      sectionId: String(args.item.sectionId),
      paperId: String(args.paper._id),
      deadlineKey: keyOf(args.deadline),
      teacherIds: late,
      effectiveKeys,
      mistakeDue: term >= fromTerm,
    });
  }

  for (const i of hwItems) {
    await consider({
      tracker: "HOMEWORK",
      item: i,
      code: i.hwId,
      paper: hwPaper.get(String(i._id))!,
      deadline: deadlineFrom(atMidnight(hwDue.get(String(i._id)) ?? i.dateGiven), Math.max(0, hwDays), isOpen),
      owners: ids(i.declaredBy),
      kinds: ["HOMEWORK_REQUIRED"],
    });
  }
  for (const i of asItems) {
    await consider({
      tracker: "ASSIGNMENT",
      item: i,
      code: i.asId,
      paper: asPaper.get(String(i._id))!,
      deadline: assignmentDeadline(i.dueDate, asDow, isOpen),
      owners: ids(i.deliveredBy, i.teacherId),
      kinds: ["ASSIGNMENT_CHASE", "ASSIGNMENT_GENERATION"],
    });
  }
  return out;
}

/** Of these paper ids, the ones now CONFIRMED (for the snapshot's live "marked since" flag). */
export async function confirmedPaperIds(paperIds: (Types.ObjectId | string)[]): Promise<Set<string>> {
  const valid = paperIds.filter((p) => Types.ObjectId.isValid(String(p)));
  if (valid.length === 0) return new Set();
  const rows = await MasteryPaper.find({ _id: { $in: valid }, entryState: "CONFIRMED" }).select("_id").lean();
  return new Set(rows.map((r) => String(r._id)));
}
