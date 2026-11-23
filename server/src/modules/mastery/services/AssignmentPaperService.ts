/**
 * AssignmentPaperService — AL-6 of the 2027 academic loop (docs/prd-academic-loop-2027.md §3.1, §3.6, §4.4, D-#1669,
 * D-#1671): every weekly assignment of a class × subject is a `MasteryPaper` (source AS) linked to its tracker item,
 * and the week it belongs to is held to the time budget.
 *
 *   planFinalise / afterSend      the TAILORED week (M-4 `sendAssignment`): the budget check (week cap, the two home
 *                                 days — AC-C4, AC-C9), the tracker link of its AS paper (trackerLinked → the §3.1
 *                                 guards, the write-back and the item lock apply), the item's minutes + day split
 *   onAssignmentItemDelivered     the tracker item was delivered: a tailored paper already sent for that week is
 *                                 linked to it, otherwise a non-tailored paper is made from the item's question set
 *                                 (Part A only; marks-only where no tree is locked, R20)
 *   syncAsPaperForItem            (re)build that non-tailored paper; refuses a change once it is locked (guard 4)
 *   finaliseWeekDays              `confirmAssignmentWeek`: the per-day check (AC-C4) + day split for items without one
 *   onAssignmentIssued            the week was issued → the paper locks and its §3.2 AS rows are written (idempotent
 *                                 with the tailored finalise write: one row per question, never double counted)
 *
 * Everything here runs only with `academicLoop2027On` (§3.6): the callers read the switch, so with it off a 2026
 * assignment flow is byte-for-byte unchanged. Nursery / KG have no weekly assignment, so no budget (AC-C15).
 */
import { Types } from "mongoose";
import type { MasterySubject } from "@scd/shared";
import { MasteryAssignment, type IMasteryAssignment } from "../models/MasteryAssignment";
import { MasteryPaper, type IMasteryPaper, type IMasteryPaperItem } from "../models/MasteryPaper";
import { MasteryResult } from "../models/MasteryResult";
import { AssessmentSet } from "../../assessment/models/AssessmentSet";
import { AssignmentItem, type IAssignmentItem } from "../../trackers/models/AssignmentItem";
import { dateOnlyISO } from "../../trackers/assignmentCalendar";
import { writeAudit } from "../../platform/services/AuditService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { recordUsesSafe, usesOfPaper } from "../../assessment/services/QuestionUseService";
import { groupStimulusParts, printPlan } from "../parts";
import { isMasteryEnabled } from "./MasteryCatalogueService";
import { MasteryWorkError, nextPaperId, sectionContext } from "./MasteryWorkService";
import { PAPER_LOCKED_MESSAGE, bankItemsOf, lockPaper, removePaperById, removePaperOfAsItem } from "./HomeworkPaperService";
import { linkedAsPaper } from "../paperLink";
import {
  budgetPolicy,
  countedMinutes,
  dayCapMinutes,
  dayLabel,
  staffDaySplit,
  dayOverMessage,
  hasAssignmentBudget,
  loadsOf,
  minutesOfMarks,
  placeSubject,
  splitDays,
  weekCapMinutes,
  weekOverMessage,
  type DayLoads,
  type DoOnDay,
  type Placement,
} from "../assignmentBudget";

const oid = (s: string | Types.ObjectId) => new Types.ObjectId(String(s));
const sumMarks = (xs: { marks: number }[]) => xs.reduce((s, x) => s + x.marks, 0);

// ---------------------------------------------------------------------------
// The week's other subjects
// ---------------------------------------------------------------------------

export interface WeekPeer {
  subject: string;
  minutes: number;
  minutesByDay: { FRI: number; SAT: number } | null;
}

const DAY_MS = 86_400_000;
/** "YYYY-MM-DD" of a tracker item's due day (the item stores a local-midnight date; see `dateOnlyISO`). */
export const dueDayKey = (d: Date): string => dateOnlyISO(d).slice(0, 10);
const dayNum = (key: string): number => Date.parse(`${key}T00:00:00.000Z`) / DAY_MS;
/**
 * The paper ↔ item ↔ peers match is by the TRACKER week, never by the due date's ISO week: a holiday / Eid roll can land a
 * Sunday due date on a Monday and two tracker weeks' dues in one ISO week. Two due days belong to the same tracker week
 * when they are within 3 days (a roll moves a due day by a few days; the next week's is a week away), and an explicit
 * `asItemId` link always wins.
 */
export const sameTrackerWeek = (a: string, b: string): boolean => Math.abs(dayNum(a) - dayNum(b)) <= 3;
const dueRange = (key: string) => ({ $gte: new Date((dayNum(key) - 3) * DAY_MS), $lte: new Date((dayNum(key) + 3) * DAY_MS) });

/** The tailored assignment (any status) of this item's tracker week: linked to it, or unlinked with a due day within the week. */
async function tailoredFor(item: Pick<IAssignmentItem, "_id" | "sectionId" | "subject" | "dueDate">) {
  return MasteryAssignment.findOne({
    sectionId: item.sectionId,
    subject: item.subject,
    $or: [{ asItemId: item._id }, { asItemId: null, dueDate: dueRange(dueDayKey(item.dueDate)) }],
  });
}

/**
 * What the শাখা's week already holds, one entry per subject, EXCLUDING `exceptSubject`: a finalised tailored assignment
 * counts its `countedMinutes` (a pre-2027 one its layout minutes); a subject with no tailored assignment counts the
 * tracker item's `estMinutes`. A subject is counted once (the tailored one wins over its own linked tracker item).
 */
export async function weekPeers(sectionId: Types.ObjectId | string, dueKey: string, exceptSubject?: string): Promise<WeekPeer[]> {
  const tailored = await MasteryAssignment.find({ sectionId: oid(sectionId), dueDate: dueRange(dueKey), status: "SENT" })
    .select("subject countedMinutes layout.minutes minutesByDay")
    .lean(); // bounded: one per subject of one week
  const out: WeekPeer[] = tailored
    .filter((t) => t.subject !== exceptSubject)
    .map((t) => ({
      subject: t.subject,
      minutes: typeof t.countedMinutes === "number" ? t.countedMinutes : (t.layout?.minutes ?? 0),
      minutesByDay: t.minutesByDay ? { FRI: t.minutesByDay.FRI ?? 0, SAT: t.minutesByDay.SAT ?? 0 } : null,
    }));
  const covered = new Set([...tailored.map((t) => t.subject as string), ...(exceptSubject ? [exceptSubject] : [])]);
  // Tracker items of that tracker week (due days within the week window; see `sameTrackerWeek`).
  const items = await AssignmentItem.find({ sectionId: oid(sectionId) })
    .sort({ dueDate: -1 })
    .limit(80)
    .select("subject dueDate estMinutes minutesByDay")
    .lean(); // bounded: one item per subject per week; the recent 80 cover well over the weeks that matter
  for (const it of items) {
    if (covered.has(it.subject) || !sameTrackerWeek(dueDayKey(it.dueDate), dueKey)) continue;
    covered.add(it.subject);
    out.push({
      subject: it.subject,
      minutes: it.estMinutes ?? 0,
      minutesByDay: it.minutesByDay ? { FRI: it.minutesByDay.FRI ?? 0, SAT: it.minutesByDay.SAT ?? 0 } : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The tailored week: finalise
// ---------------------------------------------------------------------------

export interface FinalisePlan {
  /** Counted minutes of this subject (Part A + the median child's Part B marks) × minutesPerMark. */
  counted: number;
  placement: Placement | null;
  /** The tracker item the AS paper links to (explicit on the assignment, else found by its due day), or null. */
  asItemId: Types.ObjectId | null;
  /** An untailored paper of that item the new one replaces — removed only AFTER the new paper exists (`afterSend`). */
  replaces: Types.ObjectId | null;
}

/** The tracker item of this শাখা × subject in the assignment's tracker week (nearest due day) — when the teacher did not pick one. */
async function findItemForWeek(a: IMasteryAssignment): Promise<Types.ObjectId | null> {
  if (a.asItemId) return a.asItemId;
  const key = a.dueDate.toISOString().slice(0, 10);
  const near = await AssignmentItem.find({ sectionId: a.sectionId, subject: a.subject, dueDate: dueRange(key) })
    .select("dueDate")
    .lean(); // bounded: a subject's items within one week window
  const taken = new Set((await MasteryAssignment.find({ asItemId: { $in: near.map((i) => i._id) } }).select("asItemId").lean()).map((x) => String(x.asItemId)));
  const free = near.filter((i) => !taken.has(String(i._id))).sort((x, y) => Math.abs(dayNum(dueDayKey(x.dueDate)) - dayNum(key)) - Math.abs(dayNum(dueDayKey(y.dueDate)) - dayNum(key)));
  return free[0] ? (free[0]._id as Types.ObjectId) : null;
}

/**
 * Finalise check (switch ON), run before the AS paper is made: the week budget (AC-C4) and the day budget (AC-C9),
 * both refused in Bangla naming the overage; then the tracker item the paper will link to. A non-tailored paper that
 * was made from the item's question set earlier is replaced (when it was not printed / issued / worked), else refused.
 * Nursery / KG: no budget (AC-C15).
 */
export async function planFinalise(a: IMasteryAssignment, sheets: { items: { marks: number }[] }[]): Promise<FinalisePlan> {
  let counted = 0;
  let placement: Placement | null = null;
  if (hasAssignmentBudget(a.classToken)) {
    const bp = await budgetPolicy();
    counted = countedMinutes(sumMarks(a.partA ?? []), sheets.map((s) => sumMarks(s.items)), bp);
    const peers = await weekPeers(a.sectionId, a.dueDate.toISOString().slice(0, 10), a.subject);
    const total = peers.reduce((s, p) => s + p.minutes, 0) + counted;
    const cap = weekCapMinutes(bp);
    if (total > cap) throw new MasteryWorkError(weekOverMessage(total, cap));
    placement = placeSubject(loadsOf(peers), counted, dayCapMinutes(bp));
    if (placement.overBy > 0) throw new MasteryWorkError(dayOverMessage(placement.overBy, dayCapMinutes(bp)));
  }
  const asItemId = await findItemForWeek(a);
  let replaces: Types.ObjectId | null = null;
  if (asItemId) {
    const other = await linkedAsPaper(asItemId);
    if (other && !other.links?.assignmentId) {
      // A non-tailored paper (from the item's question set) already stands for this item: replace it while nobody has
      // seen or worked it; otherwise the children already have a different sheet.
      const worked = other.lockedAt || other.entryState === "CONFIRMED" || (await MasteryResult.exists({ paperId: other._id }));
      if (worked) throw new MasteryWorkError("এই সপ্তাহের শিট আগেই প্রিন্টে গেছে বা নম্বর তোলা শুরু হয়েছে — নতুন অ্যাসাইনমেন্ট বানানো যাবে না।");
      replaces = other._id as Types.ObjectId;
    }
  }
  return { counted, placement, asItemId, replaces };
}

/** After the AS paper exists (switch ON): the item's minutes (R26) and day split, and the audit line. */
export async function afterSend(a: IMasteryAssignment, plan: FinalisePlan, actorId: string): Promise<void> {
  // The untailored paper goes only now that the tailored one exists, so a failed send never strands the item without a paper.
  if (plan.replaces) await removePaperById(plan.replaces);
  if (!plan.asItemId) return;
  const item = await AssignmentItem.findById(plan.asItemId);
  if (!item) return;
  if (plan.placement) {
    item.doOnDay = plan.placement.doOnDay;
    item.minutesByDay = plan.placement.minutesByDay;
  }
  // The week reconcile sums the item's declared minutes: with a sheet it is the counted time (frozen once issued).
  if (item.status === "DRAFT" && hasAssignmentBudget(a.classToken)) item.estMinutes = plan.counted;
  await item.save();
  void writeAudit({
    eventKind: "MASTERY_PAPER_CREATED",
    actorId,
    targetKind: "AssignmentItem",
    targetId: item._id,
    meta: { asId: item.asId, linkedAs: true, countedMinutes: plan.counted, doOnDay: plan.placement?.doOnDay, week: a.week },
  });
}

// ---------------------------------------------------------------------------
// The tracker item was delivered
// ---------------------------------------------------------------------------

/** deliverAssignmentItem hook (switch ON): link a tailored paper already sent for the week, else make the item's paper. */
export async function onAssignmentItemDelivered(item: IAssignmentItem, actorId: string): Promise<void> {
  if (item.classLevel <= 0) return; // Nursery / KG: no weekly assignment (R25)
  const tailored = await tailoredFor(item);
  if (tailored) {
    if (tailored.status !== "SENT" || !tailored.paperId) return; // a draft links itself when it is sent
    const paper = await MasteryPaper.findById(tailored.paperId);
    if (!paper || paper.links?.asItemId) return;
    paper.links = { ...(paper.links ?? {}), asItemId: item._id } as never;
    paper.trackerLinked = true;
    await paper.save();
    tailored.asItemId = item._id;
    await tailored.save();
    if (tailored.minutesByDay || typeof tailored.countedMinutes === "number") {
      if (tailored.doOnDay) item.doOnDay = tailored.doOnDay;
      if (tailored.minutesByDay) item.minutesByDay = { FRI: tailored.minutesByDay.FRI ?? 0, SAT: tailored.minutesByDay.SAT ?? 0 };
      if (typeof tailored.countedMinutes === "number") item.estMinutes = tailored.countedMinutes;
      await item.save();
    }
    return;
  }
  await syncAsPaperForItem(item, actorId);
}

/** The bank questions the item's question set carries (an assembled / draft `AssessmentSet`), in basket order. */
async function setQidsOf(item: Pick<IAssignmentItem, "setId">): Promise<string[]> {
  if (!item.setId) return [];
  const set = await AssessmentSet.findById(item.setId).select("basketItems.qid").lean();
  return [...new Set((set?.basketItems ?? []).map((b) => b.qid).filter(Boolean))];
}

/**
 * (Re)build the NON-tailored AS paper of a tracker item from its question set (Part A only: every child has every
 * item). Marks-only where no tree is locked (R20). A paper that is locked (printed / issued), worked or confirmed
 * cannot change (§3.1 guard 4). No set / no bank question → no paper (the item stays a 2026-style tracker row).
 */
export async function syncAsPaperForItem(item: IAssignmentItem, actorId: string): Promise<void> {
  if (item.classLevel <= 0) return;
  if (await tailoredFor(item)) return; // a tailored week owns it: never a second, untailored paper
  const qids = await setQidsOf(item);
  const existing = await linkedAsPaper(item._id);
  if (qids.length === 0) {
    if (existing && !existing.links?.assignmentId) {
      if (existing.lockedAt) throw new MasteryWorkError(PAPER_LOCKED_MESSAGE);
      await removePaperOfAsItem(item._id);
      // The split belonged to the removed paper — a stale one would be used by the week's day check.
      if (item.status === "DRAFT") {
        item.doOnDay = undefined;
        item.minutesByDay = undefined;
        await item.save();
      }
    }
    return;
  }
  if (existing?.links?.assignmentId) return; // a tailored paper owns this item
  const ctx = await sectionContext(String(item.sectionId));
  const enabled = await isMasteryEnabled(ctx.academicYearId, ctx.classToken, item.subject as MasterySubject);
  const { built } = await bankItemsOf(item, qids, enabled, ctx);
  const grouped = groupStimulusParts(built);
  const labels = printPlan(grouped).map((l) => l.partLabel);
  const items: IMasteryPaperItem[] = grouped.map((x, i) => ({ ...x, itemNo: i + 1, ...(labels[i] ? { partLabel: labels[i]! } : {}) }));

  if (existing) {
    const same =
      existing.items.length === items.length && existing.items.every((x, i) => x.qid === items[i]!.qid && x.marks === items[i]!.marks);
    if (!same || Boolean(existing.marksOnly) !== !enabled) {
      if (existing.lockedAt || existing.entryState === "CONFIRMED") throw new MasteryWorkError(PAPER_LOCKED_MESSAGE);
      if (await MasteryResult.exists({ paperId: existing._id })) throw new MasteryWorkError("নম্বর তোলা শুরু হয়েছে — প্রশ্ন বদলানো যায় না।");
      existing.items = items as never;
      existing.marksOnly = !enabled;
      await existing.save();
    }
  } else {
    const paper = await MasteryPaper.create({
      paperId: await nextPaperId(ctx.classToken, item.subject),
      source: "AS",
      title: "সাপ্তাহিক অ্যাসাইনমেন্ট",
      extra: false,
      trackerLinked: true,
      marksOnly: !enabled,
      sectionId: ctx.sectionId,
      classId: ctx.classId,
      academicYearId: ctx.academicYearId,
      classToken: ctx.classToken,
      subject: item.subject,
      date: new Date(`${dateOnlyISO(item.dueDate).slice(0, 10)}T00:00:00.000Z`),
      links: { asItemId: item._id },
      items,
      entryState: "OPEN",
      createdBy: Types.ObjectId.isValid(actorId) ? oid(actorId) : undefined,
    });
    void writeAudit({
      eventKind: "MASTERY_PAPER_CREATED",
      actorId,
      targetKind: "MasteryPaper",
      targetId: paper._id,
      meta: { paperId: paper.paperId, source: "AS", items: items.length, marksOnly: !enabled, viaDelivery: true, asId: item.asId },
    });
  }

  // R26: the item's time follows its marks; the day split reads the rest of the week (§4.4). A DRAFT only.
  if (item.status === "DRAFT") {
    const bp = await budgetPolicy();
    item.estMinutes = minutesOfMarks(sumMarks(items), bp);
    const placement = placeSubject(loadsOf(await weekPeers(item.sectionId, dueDayKey(item.dueDate), item.subject)), item.estMinutes, dayCapMinutes(bp));
    item.doOnDay = placement.doOnDay;
    item.minutesByDay = placement.minutesByDay;
    await item.save();
  }
}

// ---------------------------------------------------------------------------
// Confirm week (the tracker's finalise path)
// ---------------------------------------------------------------------------

/**
 * `confirmAssignmentWeek` (switch ON): the day budget. Items that already carry a day split (a tailored week) keep it;
 * the others are placed largest first on what is left. A week that cannot fit Friday + Saturday is refused naming the
 * overage (AC-C4) and nothing is written. Nursery / KG: no budget. Returns the minutes each item gets per day.
 */
export async function finaliseWeekDays(items: IAssignmentItem[]): Promise<void> {
  const budgeted = items.filter((i) => i.classLevel > 0);
  if (budgeted.length === 0) return;
  const bp = await budgetPolicy();
  const dayCap = dayCapMinutes(bp);
  const fixed = budgeted.filter((i) => i.doOnDay && i.minutesByDay);
  const loose = budgeted.filter((i) => !(i.doOnDay && i.minutesByDay));
  const loads: DayLoads = loadsOf(fixed.map((i) => ({ minutesByDay: i.minutesByDay })));
  const order = loose.map((it, i) => ({ it, i })).sort((a, b) => (b.it.estMinutes ?? 0) - (a.it.estMinutes ?? 0) || a.i - b.i);
  const planned: { it: IAssignmentItem; pl: Placement }[] = [];
  let overBy = 0;
  for (const { it } of order) {
    const pl = placeSubject(loads, it.estMinutes ?? 0, dayCap);
    loads.FRI += pl.minutesByDay.FRI;
    loads.SAT += pl.minutesByDay.SAT;
    overBy += pl.overBy;
    planned.push({ it, pl });
  }
  if (overBy > 0) throw new Error(dayOverMessage(overBy, dayCap));
  for (const { it, pl } of planned) {
    it.doOnDay = pl.doOnDay as DoOnDay;
    it.minutesByDay = pl.minutesByDay;
    await it.save();
  }
}

/**
 * Re-sync a delivered item's AS paper from its question set (AL-6b "বদলানো প্রশ্ন নিন" button, and the set-update hook).
 * A paper that is locked / worked / confirmed refuses (guard 4); nothing to do for an item with no paper and no set.
 */
export async function resyncAssignmentPaper(itemId: string, actorId: string): Promise<{ changed: boolean }> {
  if (!Types.ObjectId.isValid(itemId)) throw new MasteryWorkError("অ্যাসাইনমেন্ট পাওয়া যায়নি।");
  const item = await AssignmentItem.findById(itemId);
  if (!item) throw new MasteryWorkError("অ্যাসাইনমেন্ট পাওয়া যায়নি।");
  const before = await linkedAsPaper(item._id);
  const sig = (p: IMasteryPaper | null) => (p ? `${String(p._id)}:${p.items.map((i) => i.qid).join(",")}` : "");
  await syncAsPaperForItem(item, actorId);
  return { changed: sig(before) !== sig(await linkedAsPaper(item._id)) };
}

/** Re-sync every DRAFT, unlocked item that uses this question set (the set's basket was edited). Failures are per item, never thrown. */
export async function resyncItemsOfSet(setId: Types.ObjectId | string, actorId: string): Promise<{ resynced: number; failed: { itemId: string; reason: string }[] }> {
  const items = await AssignmentItem.find({ setId: oid(setId), status: "DRAFT" }); // bounded: the items that picked one set
  let resynced = 0;
  const failed: { itemId: string; reason: string }[] = [];
  for (const it of items) {
    try {
      const paper = await linkedAsPaper(it._id);
      if (paper?.lockedAt) continue;
      await syncAsPaperForItem(it, actorId);
      resynced += 1;
    } catch (err) {
      failed.push({ itemId: String(it._id), reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { resynced, failed };
}

/** True when the week's items (all of them) fit Friday + Saturday under the per-day cap — the dry check behind the refusal. */
export function weekFitsDays(minutes: number[], dayCap: number): boolean {
  return splitDays(minutes.map((m, i) => ({ key: String(i), minutes: m })), dayCap).overBy === 0;
}

// ---------------------------------------------------------------------------
// Issue → lock
// ---------------------------------------------------------------------------

/** confirmAssignmentWeek claimed an item (switch ON): a linked AS paper locks and its §3.2 AS rows are written. */
export async function onAssignmentIssued(itemId: Types.ObjectId | string): Promise<void> {
  const paper: IMasteryPaper | null = await linkedAsPaper(itemId);
  if (!paper) return;
  try {
    await lockPaper(paper);
  } catch (err) {
    // Same fallback as the homework issue path: the ledger rows are written even when the lock failed.
    await recordUsesSafe(usesOfPaper(paper, "AS", { givenOn: dhakaDayKey(new Date()), wholeIfAll: true }));
    throw err;
  }
}

/**
 * AL-6b: the day label of an item for the finalise screen, in Bangla and English: "শুক্রবার" / "শনিবার", or for a subject
 * that spans both days the Part A split plus where the per-child part falls — "শুক্রবার: প্রশ্ন ১–৬ · শনিবার: প্রশ্ন
 * ৭–১২ + নিজস্ব অংশ". The per-child part is read off the median child's own questions. Null for a 2026 item.
 */
export async function dayLabelsOfItem(item: Pick<IAssignmentItem, "_id" | "doOnDay" | "minutesByDay">): Promise<{ bn: string; en: string } | null> {
  if (!item.doOnDay) return null;
  const pair = (split?: Parameters<typeof dayLabel>[2], own?: DoOnDay | null) => ({
    bn: dayLabel("bn", item.doOnDay, split, own) as string,
    en: dayLabel("en", item.doOnDay, split, own) as string,
  });
  if (item.doOnDay !== "BOTH") return pair();
  const paper = await linkedAsPaper(item._id);
  if (!paper) return pair();
  const per = paper.perStudentItems ?? [];
  const isCommon = (no: number) => per.length === 0 || per.every((p) => p.itemNos.includes(no));
  const common = paper.items.filter((it) => isCommon(it.itemNo));
  // The representative child: the median of the children's own-part marks (the same median the budget counts).
  const marksOf = (nos: number[]) => paper.items.filter((it) => nos.includes(it.itemNo) && !isCommon(it.itemNo)).reduce((s, it) => s + it.marks, 0);
  const ranked = per.map((p) => ({ nos: p.itemNos, marks: marksOf(p.itemNos) })).sort((a, b) => a.marks - b.marks);
  const mid = ranked[Math.floor(ranked.length / 2)];
  const own = mid ? paper.items.filter((it) => mid.nos.includes(it.itemNo) && !isCommon(it.itemNo)) : [];
  const bp = await budgetPolicy();
  const aLines = printPlan(common, 0);
  const lastA = aLines.at(-1)?.no ?? 0;
  const bLines = printPlan(own, lastA);
  const r = staffDaySplit(
    aLines.map((l) => ({ no: l.no, marks: l.item.marks })),
    bLines.map((l) => ({ no: l.no, marks: l.item.marks })),
    item.minutesByDay?.FRI ?? 0,
    bp.minutesPerMark,
  );
  return pair(r.split, r.own);
}

/** The Bangla day label (see `dayLabelsOfItem`). */
export async function dayLabelOfItem(item: Pick<IAssignmentItem, "_id" | "doOnDay" | "minutesByDay">): Promise<string | null> {
  return (await dayLabelsOfItem(item))?.bn ?? null;
}
