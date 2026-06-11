/**
 * HomeworkReconciliationService — the daily budget reconciliation (handoff §4, HW-T2).
 *
 * "The Homework Tracker is the only place the daily ceiling becomes real" (§5.3).
 *
 *   tallyDay           — live DAY_TOTAL vs the 240 ceiling + band warnings (§4.2, T2.1/T2.5)
 *   getTrimCandidates  — the §4.4 candidates, pre-ranked ক→খ→গ (T2.3)
 *   applyTrim          — one logged cut: by question count, never time; appends an
 *                        immutable trim-log row (§4.4/§4.5, T2.3/T2.4)
 *   confirmHomeworkDay — the gate: block if DAY_TOTAL > 240, else issue all the day's
 *                        items + finalise the reconciliation (§4.3/§4.5, T2.2/T2.6)
 *
 * Trim reduces Q_COUNT; TIME_DECL follows PROPORTIONALLY (count is the lever, time
 * is the target it is tuned to — D-030). No path extends time. The per-subject band
 * (>40 min) only WARNS; only the day-SUM (240) blocks.
 *
 * Write-scope is enforced by the resolver. The class-teacher-only narrowing of who
 * may reconcile/confirm (handoff §9 / T5.1) is deferred — see D-#38.
 */
import {
  HW_DAILY_CEILING_MIN,
  HW_SUBJECT_BAND_MAX_MIN,
  TRIM_RANKS,
} from "@scd/shared";
import type { HwSubject, TrimRank, ReconState } from "@scd/shared";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkReconciliation, reconDayKey } from "../models/HomeworkReconciliation";
import { issueHomeworkItem, listDailyItems, type IssueRosterEntry } from "./HomeworkService";
import { isWeekend } from "../calendar";

// ---------------------------------------------------------------------------
// tallyDay (handoff §4.2 — live DAY_TOTAL vs ceiling)
// ---------------------------------------------------------------------------

export interface DayItemView {
  itemId: string;
  hwId: string;
  subject: HwSubject;
  timeDecl: number;
  qCount: number;
  revItem: boolean;
  status: string;
  /** TIME_DECL exceeds the 40-min band (warn only, never blocks — T2.5). */
  bandWarning: boolean;
}

export interface DayTallyResult {
  classId: string;
  dayTotal: number;
  ceiling: number;
  overBy: number;
  withinCeiling: boolean;
  /** within_ceiling | over_ceiling (live) — or reconciled once confirmed (§2.3). */
  state: ReconState;
  items: DayItemView[];
  /** Items whose single-subject TIME_DECL > 40 (advisory, handoff §4 close). */
  bandWarnings: string[];
}

type LeanItem = Awaited<ReturnType<typeof listDailyItems>>[number];

function toItemView(d: LeanItem): DayItemView {
  return {
    itemId: d._id.toString(),
    hwId: d.hwId,
    subject: d.subject,
    timeDecl: d.timeDecl,
    qCount: d.qCount,
    revItem: d.revItem,
    status: d.status,
    bandWarning: d.timeDecl > HW_SUBJECT_BAND_MAX_MIN,
  };
}

export async function tallyDay(classId: string, date: Date): Promise<DayTallyResult> {
  const docs = await listDailyItems(classId, date);
  const items = docs.map(toItemView);
  const dayTotal = items.reduce((sum, it) => sum + it.timeDecl, 0);
  const overBy = Math.max(0, dayTotal - HW_DAILY_CEILING_MIN);
  const withinCeiling = dayTotal <= HW_DAILY_CEILING_MIN;

  const recon = await HomeworkReconciliation.findOne({
    classId,
    reconDate: reconDayKey(date),
  }).lean();
  const reconciled = recon?.reconState === "reconciled";

  const state: ReconState = reconciled
    ? "reconciled"
    : withinCeiling
      ? "within_ceiling"
      : "over_ceiling";

  return {
    classId,
    dayTotal,
    ceiling: HW_DAILY_CEILING_MIN,
    overBy,
    withinCeiling,
    state,
    items,
    bandWarnings: items.filter((it) => it.bandWarning).map((it) => it.hwId),
  };
}

// ---------------------------------------------------------------------------
// getTrimCandidates (handoff §4.4 — offered ק→খ→গ)
// ---------------------------------------------------------------------------

export interface TrimCandidates {
  /** (a/ক) pure-revision items — cut the revision question first. */
  rankA: DayItemView[];
  /** (b/খ) lightest-priority subjects, sorted ASCENDING by TIME_DECL. */
  rankB: DayItemView[];
  /** (c/গ) zero-out candidates (any item still carrying time). */
  rankC: DayItemView[];
}

export async function getTrimCandidates(classId: string, date: Date): Promise<TrimCandidates> {
  const { items } = await tallyDay(classId, date);
  const live = items.filter((it) => it.status === "declared" && it.qCount > 0);
  return {
    rankA: live.filter((it) => it.revItem),
    rankB: [...live].sort((a, b) => a.timeDecl - b.timeDecl),
    rankC: live,
  };
}

// ---------------------------------------------------------------------------
// applyTrim (handoff §4.4/§4.5 — one logged cut, by count not time)
// ---------------------------------------------------------------------------

/** TIME_DECL follows Q_COUNT proportionally (D-030). Zeroing the count zeroes time. */
function proportionalTime(oldTime: number, oldQ: number, newQ: number): number {
  if (oldQ <= 0 || newQ <= 0) return 0;
  return Math.round((oldTime * newQ) / oldQ);
}

export interface ApplyTrimInput {
  classId: string;
  date: Date;
  itemId: string;
  newQCount: number;
  rank: string;
  actorId: string;
}

export interface ApplyTrimResult {
  hwId: string;
  rank: TrimRank;
  trimFrom: number;
  trimTo: number;
  trimMin: number;
  tally: DayTallyResult;
}

export async function applyTrim(input: ApplyTrimInput): Promise<ApplyTrimResult> {
  if (!(TRIM_RANKS as readonly string[]).includes(input.rank)) {
    throw new Error(`Unknown trim rank "${input.rank}" (allowed: a, b, c → ক/খ/গ)`);
  }
  const rank = input.rank as TrimRank;
  const dayKey = reconDayKey(input.date);

  // Cannot trim once the day is reconciled (trim log is immutable, §4.5).
  const existing = await HomeworkReconciliation.findOne({ classId: input.classId, reconDate: dayKey }).lean();
  if (existing && existing.reconState === "reconciled") {
    throw new Error("Day already reconciled — the trim log is immutable (handoff §4.5)");
  }

  const item = await HomeworkItem.findById(input.itemId);
  if (!item) throw new Error("HomeworkItem not found");
  if (item.classId.toString() !== input.classId) throw new Error("Item is not in this class");
  if (reconDayKey(item.dateGiven).getTime() !== dayKey.getTime()) {
    throw new Error("Item is not part of this reconciliation day");
  }
  if (item.status !== "declared") throw new Error("Only a declared (not-yet-issued) item can be trimmed");

  if (!Number.isInteger(input.newQCount) || input.newQCount < 0) {
    throw new Error("newQCount must be a non-negative integer");
  }
  if (input.newQCount >= item.qCount) {
    throw new Error("A trim must REDUCE Q_COUNT (never extend time — D-030)");
  }

  // Rank-specific guards (handoff §4.4).
  if (rank === "a" && !item.revItem) {
    throw new Error("Rank ক (a) cuts a revision item first — this item carries no revision item");
  }
  if (rank === "b" && input.newQCount < 1) {
    throw new Error("Rank খ (b) reduces Q_COUNT; zeroing a subject is rank গ (c)");
  }
  if (rank === "c" && input.newQCount !== 0) {
    throw new Error("Rank গ (c) zeroes the subject (newQCount must be 0)");
  }

  const trimFrom = item.qCount;
  const trimTo = input.newQCount;
  const newTime = proportionalTime(item.timeDecl, item.qCount, input.newQCount);
  const trimMin = item.timeDecl - newTime;

  item.qCount = trimTo;
  item.timeDecl = newTime;
  if (rank === "a") item.revItem = false; // the revision question is the thing cut
  await item.save();

  const now = new Date();
  await HomeworkReconciliation.findOneAndUpdate(
    { classId: input.classId, reconDate: dayKey },
    {
      $setOnInsert: {
        sectionId: item.sectionId,
        academicYearId: item.academicYearId,
        ceiling: HW_DAILY_CEILING_MIN,
      },
      $set: { reconState: "open" },
      $push: {
        trimLog: {
          trimHw: item._id,
          hwId: item.hwId,
          rank,
          trimFrom,
          trimTo,
          trimMin,
          at: now,
          by: input.actorId,
        },
      },
    },
    { upsert: true, new: true },
  );

  const tally = await tallyDay(input.classId, input.date);
  return { hwId: item.hwId, rank, trimFrom, trimTo, trimMin, tally };
}

// ---------------------------------------------------------------------------
// confirmHomeworkDay (handoff §4.3/§4.5 — the gate: block over-ceiling, else issue)
// ---------------------------------------------------------------------------

export interface ConfirmHomeworkDayInput {
  classId: string;
  date: Date;
  roster: IssueRosterEntry[];
  actorId: string;
}

export interface ConfirmHomeworkDayResult {
  classId: string;
  reconDate: string;
  dayTotal: number;
  ceiling: number;
  reconState: ReconState;
  issuedItems: number;
  issuedRecords: number;
}

export async function confirmHomeworkDay(
  input: ConfirmHomeworkDayInput,
): Promise<ConfirmHomeworkDayResult> {
  // Cadence: HW-… never issues on Fri/Sat (handoff §6.1). Thursday is a normal night.
  if (isWeekend(input.date)) {
    throw new Error("HW-… cannot be issued on Fri/Sat — the weekend is blocked (handoff §6.1)");
  }

  const dayKey = reconDayKey(input.date);
  const existing = await HomeworkReconciliation.findOne({ classId: input.classId, reconDate: dayKey }).lean();
  if (existing && existing.reconState === "reconciled") {
    throw new Error("Day already reconciled");
  }

  const docs = await listDailyItems(input.classId, input.date);
  if (docs.length === 0) throw new Error("No homework declared for this day");

  const dayTotal = docs.reduce((sum, d) => sum + d.timeDecl, 0);

  // THE GATE (handoff §4.3 / T2.2): never silently issue an over-ceiling day.
  if (dayTotal > HW_DAILY_CEILING_MIN) {
    throw new Error(
      `Day total ${dayTotal} min exceeds the ${HW_DAILY_CEILING_MIN}-min ceiling — ` +
        `trim required before issuing (handoff §4.3)`,
    );
  }

  // Issue every declared item that still carries homework (zeroed subjects spawn nothing).
  let issuedItems = 0;
  let issuedRecords = 0;
  for (const d of docs) {
    if (d.status !== "declared" || d.qCount <= 0) continue;
    const res = await issueHomeworkItem(d._id.toString(), input.roster, input.actorId);
    issuedItems += 1;
    issuedRecords += res.issuedCount;
  }

  const now = new Date();
  const first = docs[0];
  await HomeworkReconciliation.findOneAndUpdate(
    { classId: input.classId, reconDate: dayKey },
    {
      $setOnInsert: {
        sectionId: first.sectionId,
        academicYearId: first.academicYearId,
      },
      $set: {
        reconState: "reconciled",
        dayTotal,
        ceiling: HW_DAILY_CEILING_MIN,
        reconBy: input.actorId,
        confirmedAt: now,
      },
    },
    { upsert: true, new: true },
  );

  return {
    classId: input.classId,
    reconDate: dayKey.toISOString(),
    dayTotal,
    ceiling: HW_DAILY_CEILING_MIN,
    reconState: "reconciled",
    issuedItems,
    issuedRecords,
  };
}
