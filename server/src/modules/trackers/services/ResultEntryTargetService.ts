/**
 * ResultEntryTargetService (owner ask 2026-10-14, D-#739) — "how far ahead or behind is
 * this teacher on clearing their class-test result backlog by the promised day?" for the
 * teacher's own Today screen.
 *
 * An ENTRY is one ClassTestResult row (PRESENT with marks, or ABSENT) on a backlog test:
 * a PRINTED exam of the target's subject, held for one of a line's groups, on or before
 * the start day. It counts on the Dhaka day the row was first created, whoever entered
 * it. Each line counts at most `students × tests` entries (the earliest), so a bigger
 * roster on one level cannot hide another level's shortfall.
 *
 * The backlog is spread evenly over the working days from start to due (the target's
 * weekdays, minus school holidays): after the k-th of N working days the target is
 * ceil(total × k / N). Entries on a day off still count; days after the due day raise
 * nothing. Future working days up to the due day are listed too, so the plan is visible.
 *
 * Read for the caller only (`myResultEntryTarget`); no row ⇒ null ⇒ no card. Written only
 * by `setResultEntryTarget` (Principal), audited. Identity/operational plane — no corpus
 * path (ADR-005).
 */
import { Types } from "mongoose";
import { HW_SUBJECTS } from "@scd/shared";
import type { HwSubject } from "@scd/shared";
import { ResultEntryTarget } from "../models/ResultEntryTarget";
import { ClassTest } from "../models/ClassTest";
import { ClassTestResult } from "../models/ClassTestResult";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { dateKeyOf, dateKeysBetween, parseDateKey } from "../../attendance/dates";
import { buildDayTypeResolver } from "../../routine/calendar";
import { writeAudit } from "../../platform/services/AuditService";

export class ResultEntryTargetError extends Error {}

export interface EntryTargetDay {
  dateKey: string;
  /** A working day inside the start…due window raises the target. */
  working: boolean;
  entered: number;
  /** Entries from the start day through this day. */
  cumulative: number;
  /** Target from the start day through this day. */
  expected: number;
  /** cumulative − expected: negative = behind, positive = ahead. */
  diff: number;
  isToday: boolean;
  /** A planned working day still to come — only `expected` is meaningful. */
  future: boolean;
}

export interface EntryTargetLine {
  label: string;
  students: number;
  tests: number;
  total: number;
  entered: number;
  remaining: number;
  /** Backlog tests of this line found in the system (a missing one cannot take results). */
  testsFound: number;
}

export interface EntryTargetProgress {
  subject: string;
  startKey: string;
  dueKey: string;
  todayKey: string;
  total: number;
  enteredTotal: number;
  remaining: number;
  lines: EntryTargetLine[];
  /** Oldest first: working days in the window, other days with an entry, then the planned days. */
  days: EntryTargetDay[];
  enteredThroughYesterday: number;
  expectedThroughYesterday: number;
  diffThroughYesterday: number;
  todayWorking: boolean;
  todayEntered: number;
  todayTarget: number;
  /** Entries still needed today to be level with the target by tonight (0 when level or ahead). */
  neededToday: number;
  /** Working days from today through the due day, today included. */
  workingDaysLeft: number;
  /** What each remaining working day needs from now to finish on the due day. */
  perDayToFinish: number;
  done: boolean;
  overdue: boolean;
}

export interface EntryTargetLineInput {
  label: string;
  students: number;
  tests: number;
  testsFound: number;
  /** The Dhaka day each entry was first created, any order. */
  entryDays: string[];
}

/** Pure: per-line counts, the evenly spread target and the day-by-day running totals. */
export function buildEntryTargetProgress(input: {
  subject: string;
  startKey: string;
  dueKey: string;
  todayKey: string;
  isWorking: (dateKey: string) => boolean;
  lines: EntryTargetLineInput[];
}): EntryTargetProgress {
  const { subject, startKey, dueKey, todayKey, isWorking } = input;
  const enteredByDay = new Map<string, number>();
  const lines: EntryTargetLine[] = input.lines.map((l) => {
    const total = l.students * l.tests;
    const counted = [...l.entryDays].sort().slice(0, total);
    for (const k of counted) enteredByDay.set(k, (enteredByDay.get(k) ?? 0) + 1);
    return {
      label: l.label,
      students: l.students,
      tests: l.tests,
      total,
      entered: counted.length,
      remaining: total - counted.length,
      testsFound: l.testsFound,
    };
  });
  const total = lines.reduce((s, l) => s + l.total, 0);

  const windowKeys = dueKey >= startKey ? dateKeysBetween(startKey, dueKey, 400) : [startKey];
  const workingInWindow = windowKeys.filter((k) => isWorking(k));
  const n = workingInWindow.length;
  const expectedAfter = (k: number) => (n === 0 ? total : Math.ceil((total * k) / n));

  const lastKey = todayKey > dueKey ? todayKey : dueKey;
  const keys = todayKey >= startKey ? dateKeysBetween(startKey, lastKey, 400) : [];
  const days: EntryTargetDay[] = [];
  let cumulative = 0;
  let workedSoFar = 0;
  let expectedYesterday = 0;
  let enteredThroughYesterday = 0;
  let expectedThroughYesterday = 0;
  let expectedThroughToday = 0;
  for (const k of keys) {
    const future = k > todayKey;
    const working = k <= dueKey && isWorking(k);
    if (working) workedSoFar += 1;
    const expected = expectedAfter(workedSoFar);
    if (future) {
      if (working) days.push({ dateKey: k, working, entered: 0, cumulative, expected, diff: cumulative - expected, isToday: false, future });
      continue;
    }
    const entered = enteredByDay.get(k) ?? 0;
    cumulative += entered;
    const isToday = k === todayKey;
    if (isToday) expectedThroughToday = expected;
    else {
      enteredThroughYesterday = cumulative;
      expectedThroughYesterday = expected;
      expectedYesterday = expected;
    }
    if (working || entered > 0) days.push({ dateKey: k, working, entered, cumulative, expected, diff: cumulative - expected, isToday, future });
  }

  const todayWorking = keys.length > 0 && todayKey <= dueKey && isWorking(todayKey);
  const todayEntered = enteredByDay.get(todayKey) ?? 0;
  const remaining = total - cumulative;
  const workingDaysLeft = workingInWindow.filter((k) => k >= todayKey).length;
  return {
    subject,
    startKey,
    dueKey,
    todayKey,
    total,
    enteredTotal: cumulative,
    remaining,
    lines,
    days,
    enteredThroughYesterday,
    expectedThroughYesterday,
    diffThroughYesterday: enteredThroughYesterday - expectedThroughYesterday,
    todayWorking,
    todayEntered,
    todayTarget: todayWorking ? expectedThroughToday - expectedYesterday : 0,
    neededToday: Math.max(0, expectedThroughToday - cumulative),
    workingDaysLeft,
    perDayToFinish: remaining > 0 && workingDaysLeft > 0 ? Math.ceil(remaining / workingDaysLeft) : 0,
    done: remaining === 0,
    overdue: remaining > 0 && todayKey > dueKey,
  };
}

const nextDayStart = (key: string) => {
  const d = parseDateKey(key);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
};

/** The caller's progress, or null when they have no active target (or it has not started). */
export async function resultEntryTargetProgress(userId: string, now = new Date()): Promise<EntryTargetProgress | null> {
  if (!Types.ObjectId.isValid(userId)) return null;
  const target = (await ResultEntryTarget.findOne({ userId: new Types.ObjectId(userId), active: true }).lean()) as unknown as {
    subject: HwSubject;
    lines: Array<{ label: string; subjectGroupIds: Types.ObjectId[]; students: number; tests: number }>;
    startKey: string;
    dueKey: string;
    weekdays?: number[];
  } | null;
  if (!target) return null;
  const todayKey = dateKeyOf(now);
  if (todayKey < target.startKey) return null;

  const from = parseDateKey(target.startKey);
  const groupIds = target.lines.flatMap((l) => l.subjectGroupIds);
  const tests = (await ClassTest.find({
    subject: target.subject,
    subjectGroupId: { $in: groupIds },
    status: "PRINTED",
    examDate: { $lt: nextDayStart(target.startKey) },
  })
    .select("subjectGroupId")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; subjectGroupId: Types.ObjectId }>;
  const results = (await ClassTestResult.find({
    testId: { $in: tests.map((t) => t._id) },
    createdAt: { $gte: from },
  })
    .select("testId createdAt")
    .lean()) as unknown as Array<{ testId: Types.ObjectId; createdAt: Date }>;

  const groupOfTest = new Map(tests.map((t) => [String(t._id), String(t.subjectGroupId)]));
  const lineInputs: EntryTargetLineInput[] = target.lines.map((l) => {
    const groups = new Set(l.subjectGroupIds.map(String));
    return {
      label: l.label,
      students: l.students,
      tests: l.tests,
      testsFound: tests.filter((t) => groups.has(String(t.subjectGroupId))).length,
      entryDays: results
        .filter((r) => groups.has(groupOfTest.get(String(r.testId)) ?? ""))
        .map((r) => dateKeyOf(new Date(r.createdAt))),
    };
  });

  const until = target.dueKey > todayKey ? parseDateKey(target.dueKey) : now;
  const dayType = await buildDayTypeResolver(from, until);
  const weekdays = new Set(target.weekdays?.length ? target.weekdays : [0, 1, 2, 3, 4]);
  const isWorking = (k: string) => {
    const d = parseDateKey(k);
    return weekdays.has(d.getDay()) && dayType(d) !== "HOLIDAY";
  };
  return buildEntryTargetProgress({
    subject: target.subject,
    startKey: target.startKey,
    dueKey: target.dueKey,
    todayKey,
    isWorking,
    lines: lineInputs,
  });
}

/** Set (upsert) or switch off one teacher's backlog target. Principal only — the resolver gates it. */
export async function setResultEntryTarget(input: {
  userId: string;
  subject: string;
  lines: Array<{ label: string; subjectGroupIds: string[]; students: number; tests: number }>;
  startKey: string;
  dueKey: string;
  weekdays?: number[] | null;
  active?: boolean | null;
  actorId: string;
}): Promise<void> {
  if (!Types.ObjectId.isValid(input.userId)) throw new ResultEntryTargetError("ব্যবহারকারী সঠিক নয়");
  if (!(HW_SUBJECTS as readonly string[]).includes(input.subject)) throw new ResultEntryTargetError("বিষয় সঠিক নয়");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startKey) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueKey)) {
    throw new ResultEntryTargetError("তারিখ YYYY-MM-DD আকারে দিন");
  }
  if (input.dueKey < input.startKey) throw new ResultEntryTargetError("শেষ তারিখ শুরুর তারিখের আগে হতে পারে না");
  if (!input.lines.length) throw new ResultEntryTargetError("অন্তত একটি লেভেল দিন");
  const groupIds = new Set<string>();
  for (const l of input.lines) {
    if (!l.label.trim()) throw new ResultEntryTargetError("প্রতিটি লেভেলের নাম দিন");
    if (!l.subjectGroupIds.length || l.subjectGroupIds.some((g) => !Types.ObjectId.isValid(g))) {
      throw new ResultEntryTargetError(`${l.label}: গ্রুপ সঠিক নয়`);
    }
    if (!Number.isInteger(l.students) || l.students < 1 || !Number.isInteger(l.tests) || l.tests < 1) {
      throw new ResultEntryTargetError(`${l.label}: শিক্ষার্থী ও পরীক্ষার সংখ্যা অন্তত ১ হতে হবে`);
    }
    l.subjectGroupIds.forEach((g) => groupIds.add(g));
  }
  const found = await SubjectGroup.countDocuments({ _id: { $in: [...groupIds].map((g) => new Types.ObjectId(g)) } });
  if (found !== groupIds.size) throw new ResultEntryTargetError("একটি গ্রুপ পাওয়া যায়নি");
  const weekdays = input.weekdays?.length ? [...new Set(input.weekdays)].sort() : [0, 1, 2, 3, 4];
  if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new ResultEntryTargetError("সপ্তাহের দিন ০–৬ হতে হবে");
  const active = input.active ?? true;
  const lines = input.lines.map((l) => ({
    label: l.label.trim(),
    subjectGroupIds: l.subjectGroupIds.map((g) => new Types.ObjectId(g)),
    students: l.students,
    tests: l.tests,
  }));
  await ResultEntryTarget.findOneAndUpdate(
    { userId: new Types.ObjectId(input.userId) },
    {
      $set: {
        subject: input.subject,
        lines,
        startKey: input.startKey,
        dueKey: input.dueKey,
        weekdays,
        active,
        updatedBy: new Types.ObjectId(input.actorId),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await writeAudit({
    eventKind: "RESULT_ENTRY_TARGET_SET",
    actorId: input.actorId,
    targetId: new Types.ObjectId(input.userId),
    targetKind: "User",
    meta: {
      subject: input.subject,
      startKey: input.startKey,
      dueKey: input.dueKey,
      weekdays,
      active,
      lines: lines.map((l) => ({ label: l.label, students: l.students, tests: l.tests, groups: l.subjectGroupIds.length })),
      total: lines.reduce((s, l) => s + l.students * l.tests, 0),
    },
  });
}
