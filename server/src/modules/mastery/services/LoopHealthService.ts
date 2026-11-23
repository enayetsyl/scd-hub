/**
 * LoopHealthService (AL-13, docs/prd-academic-loop-2027.md journey L, AC-L1) - how the academic loop is running, per
 * teacher and per section x subject, for a chosen period.
 *
 *   % periods with a session marked      routine slots in the period vs the `LessonDelivery` rows that marked them
 *   % HW / AS papers confirmed by the deadline   AL-9 `paperDeadlines` (plain deadline, leave / pause not applied)
 *   % papers with at least one tick      confirmed papers where a child has a mark lost / re-work / tag. A 0 % rate over
 *                                         4 weeks is SHOWN with `zeroNotJudged` - never turned into a verdict
 *   % class tests with a linked sheet    section-anchored tests only (a group-anchored test takes no sheet, PR-C)
 *   WEAK -> IMPROVING / MASTERED moves   the section's per-child states at the start vs the end of the period
 *   re-teach actions + before / after    `MasteryAction` opened / closed in the period, the section's weak % then / now
 *
 * READS ONLY: no write, no notification, and no release-switch gate (the page is how the Principal watches the loop BEFORE
 * and after the switch). Teacher rows attribute each count to the person it belongs to (the slot's teacher, the paper's
 * owner, the test's accountable teacher); a move or a re-teach action belongs to every teacher of that section x subject.
 * Identity / operational plane; the corpus plane never imports this (ADR-005).
 */
import { Types } from "mongoose";
import { MASTERY_SUBJECTS, type MasteryClassToken, type MasterySubject } from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { pageOf, type Page, type PageArgs } from "../../../lib/paging";
import { dateKeyOf, isValidDateKey, parseDateKey } from "../../attendance/dates";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { LessonDelivery } from "../../lesson-progress/models/LessonDelivery";
import { planSubjectsByLevel, type SectionInfo } from "../../lesson-progress/services/LessonProgressService";
import { isLessonPlanQuestionOn } from "../../lesson-progress/services/LessonPlanQuestionSwitch";
import { loadTeachingCalendar } from "../../lesson-progress/services/SyllabusTargetService";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { ClassTest } from "../../trackers/models/ClassTest";
import { loadLeaveCheck, paperDeadlines } from "../../trackers/services/MarkDeadlineService";
import { MasteryAction } from "../models/MasteryAction";
import { MasteryEvidence } from "../models/MasteryEvidence";
import { MasteryPaper } from "../models/MasteryPaper";
import { MasteryResult } from "../models/MasteryResult";
import { computeSection, diagnosisPolicy, liveSectionRows } from "./MasteryDiagnosisService";
import { classTokenForLevel } from "./MasteryWorkService";

/** A 0 % tick rate is "shown, not judged" only over a window this long (AC-L1). */
export const ZERO_TICK_WINDOW_DAYS = 28;
/** The default period when none is chosen. */
export const DEFAULT_PERIOD_DAYS = 28;

const DAY_MS = 24 * 3600 * 1000;
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

export type HealthKind = "TEACHER" | "SECTION";

/** `done` of `total`; `pct` null when there is nothing to count ("no data" - never 0 %). */
export interface Rate {
  done: number;
  total: number;
  pct: number | null;
}

export interface LoopHealthRow {
  /** `T:<userId>` or `S:<sectionId>|<subject>` - stable. */
  key: string;
  kind: HealthKind;
  teacherId: string | null;
  teacherName: string | null;
  sectionId: string | null;
  className: string | null;
  sectionName: string | null;
  subject: string | null;
  periods: Rate;
  papers: Rate;
  /** Of the CONFIRMED papers, those with at least one tick. */
  ticks: Rate;
  /** A 0 % tick rate over a 4-week-or-longer period: shown as it is, never judged. */
  zeroNotJudged: boolean;
  classTests: Rate;
  weakToImproving: number;
  weakToMastered: number;
  reteachOpened: number;
  reteachClosed: number;
  /** Mean section weak % when the closed actions were planned / when they closed (null with none). */
  reteachBeforePct: number | null;
  reteachAfterPct: number | null;
}

export function rate(done: number, total: number): Rate {
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : null };
}

/** The period: both ends valid keys, `from <= to`, `to` never after today; the default is the last 4 weeks. */
export function resolvePeriod(from: string | null | undefined, to: string | null | undefined, now: Date = new Date()): { from: string; to: string } {
  const today = dhakaDayKey(now);
  const end = to && isValidDateKey(to) ? (to > today ? today : to) : today;
  const start = from && isValidDateKey(from) ? from : dateKeyOf(new Date(parseDateKey(end).getTime() - (DEFAULT_PERIOD_DAYS - 1) * DAY_MS + 12 * 3600 * 1000));
  return { from: start > end ? end : start, to: end };
}

interface Acc {
  periods: { done: number; total: number };
  papers: { done: number; total: number };
  confirmed: number;
  ticked: number;
  tests: { done: number; total: number };
  toImproving: number;
  toMastered: number;
  opened: number;
  closed: number;
  before: number[];
  after: number[];
}
const blank = (): Acc => ({ periods: { done: 0, total: 0 }, papers: { done: 0, total: 0 }, confirmed: 0, ticked: 0, tests: { done: 0, total: 0 }, toImproving: 0, toMastered: 0, opened: 0, closed: 0, before: [], after: [] });
const mean = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

function rowOf(base: Pick<LoopHealthRow, "key" | "kind" | "teacherId" | "teacherName" | "sectionId" | "className" | "sectionName" | "subject">, a: Acc, windowDays: number): LoopHealthRow {
  const ticks = rate(a.ticked, a.confirmed);
  return {
    ...base,
    periods: rate(a.periods.done, a.periods.total),
    papers: rate(a.papers.done, a.papers.total),
    ticks,
    zeroNotJudged: ticks.pct === 0 && windowDays >= ZERO_TICK_WINDOW_DAYS,
    classTests: rate(a.tests.done, a.tests.total),
    weakToImproving: a.toImproving,
    weakToMastered: a.toMastered,
    reteachOpened: a.opened,
    reteachClosed: a.closed,
    reteachBeforePct: mean(a.before),
    reteachAfterPct: mean(a.after),
  };
}

/**
 * The active sections of the CURRENT year, Nursery and KG included (levels -1..5). `currentSections()` of the lesson-progress
 * module stays Class 1-5 for its own callers; the health page also reads the Nursery / KG homework and class tests.
 */
async function healthSections(): Promise<{ sections: Map<string, SectionInfo>; yearStartKey: string | null; yearEndKey: string | null; yearId: Types.ObjectId | null }> {
  const year = await AcademicYear.findOne({ current: true }).select("_id startDate endDate").lean();
  if (!year) return { sections: new Map(), yearStartKey: null, yearEndKey: null, yearId: null };
  const classes = (await Class.find({ academicYearId: year._id, active: { $ne: false }, level: { $gte: -1, $lte: 5 } }).select("level nameBn").lean()) as unknown as Array<{
    _id: Types.ObjectId; level: number; nameBn: string;
  }>;
  const byClass = new Map(classes.map((c) => [String(c._id), c]));
  const rows = (await Section.find({ classId: { $in: classes.map((c) => c._id) }, active: { $ne: false } }).select("classId nameBn").lean()) as unknown as Array<{
    _id: Types.ObjectId; classId: Types.ObjectId; nameBn: string;
  }>;
  const sections = new Map<string, SectionInfo>();
  for (const sec of rows) {
    const c = byClass.get(String(sec.classId));
    if (c) sections.set(String(sec._id), { academicYearId: String(year._id), sectionId: String(sec._id), classId: String(c._id), classLevel: c.level, classNameBn: c.nameBn, sectionNameBn: sec.nameBn });
  }
  return { sections, yearStartKey: dateKeyOf(year.startDate as Date), yearEndKey: dateKeyOf(year.endDate as Date), yearId: year._id as Types.ObjectId };
}

// One computed pass per (period, day) is kept for 5 minutes and shared by both views and every page (AL-13 cost rule).
const CACHE_MS = 5 * 60 * 1000;
const passCache = new Map<string, { at: number; pass: Promise<{ SECTION: LoopHealthRow[]; TEACHER: LoopHealthRow[] }> }>();
/** Tests (and a deploy-time re-read) start from a cold cache. */
export function resetLoopHealthCache(): void {
  passCache.clear();
}

const oid = (s: string) => new Types.ObjectId(s);
const pairKey = (sectionId: string, subject: string) => `${sectionId}|${subject}`;

/** Every health row of the period (the caller pages it). Memoised for 5 minutes per (period, day). */
export async function loopHealthRows(kind: HealthKind, fromKey: string, toKey: string, now: Date = new Date()): Promise<LoopHealthRow[]> {
  const key = `${fromKey}|${toKey}|${dhakaDayKey(now)}`;
  const hit = passCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return (await hit.pass)[kind];
  const pass = computePass(fromKey, toKey, now);
  passCache.set(key, { at: Date.now(), pass });
  try {
    return (await pass)[kind];
  } catch (e) {
    passCache.delete(key);
    throw e;
  }
}

async function computePass(fromKey: string, toKey: string, now: Date): Promise<{ SECTION: LoopHealthRow[]; TEACHER: LoopHealthRow[] }> {
  const { sections, yearStartKey, yearEndKey, yearId } = await healthSections();
  if (sections.size === 0 || !yearStartKey || !yearEndKey || !yearId) return { SECTION: [], TEACHER: [] };
  const windowDays = Math.round((parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) / DAY_MS) + 1;
  const fromDate = new Date(`${fromKey}T00:00:00+06:00`);
  const toDate = new Date(`${toKey}T23:59:59.999+06:00`);
  const planSubjects = await planSubjectsByLevel();

  // sectionId|subject -> accumulator, and userId -> accumulator.
  const byPair = new Map<string, Acc>();
  const byTeacher = new Map<string, Acc>();
  const pairAcc = (sid: string, subject: string): Acc => {
    const k = pairKey(sid, subject);
    if (!byPair.has(k)) byPair.set(k, blank());
    return byPair.get(k)!;
  };
  const teacherAcc = (uid: string): Acc => {
    if (!byTeacher.has(uid)) byTeacher.set(uid, blank());
    return byTeacher.get(uid)!;
  };
  const teachersOfPair = new Map<string, Set<string>>();

  // ---- % periods with a session marked ------------------------------------------------------------------------------
  // Teaching days only: an open school day (no holiday, no assignment / homework pause) that is not an exam day of the class,
  // and not a day the slot's teacher was on approved leave with nobody to cover (a marked class counts whoever took it).
  const switchOn = await isLessonPlanQuestionOn(); // the session question is how a class gets marked; off = no data, never 0 %
  const cal = await loadTeachingCalendar(yearId, yearStartKey, yearEndKey);
  const slots = await RoutineSlot.find({
    groupType: "section",
    groupId: { $in: [...sections.keys()].map(oid) },
    active: true,
    isBreak: { $ne: true },
    teacherId: { $exists: true, $ne: null },
    effectiveFrom: { $lte: toDate },
    $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gte: fromDate } }],
  })
    .select("groupId dayOfWeek subject teacherId effectiveFrom effectiveTo")
    .lean(); // bounded: the school's section routine
  // A delivery that names only a reason (no session taught) is not "a session marked".
  const slotKeysDone = new Set(
    (
      await LessonDelivery.find({ dateKey: { $gte: fromKey, $lte: toKey }, sectionId: { $in: [...sections.keys()].map(oid) }, "sessions.0": { $exists: true } })
        .select("slotId dateKey")
        .lean()
    ).map((d) => `${d.slotId}|${d.dateKey}`),
  );
  const dayKeys: string[] = [];
  const lastDay = toKey > dhakaDayKey(now) ? dhakaDayKey(now) : toKey; // a day still to come cannot have been marked
  for (let k = fromKey; k <= lastDay; k = dateKeyOf(new Date(parseDateKey(k).getTime() + DAY_MS + 12 * 3600 * 1000))) {
    if (cal.dayOpen(k)) dayKeys.push(k);
  }
  const onLeave = switchOn ? await loadLeaveCheck([...new Set(slots.map((x) => String(x.teacherId)))], fromKey, lastDay) : () => false;
  for (const s of slots) {
    const info = sections.get(String(s.groupId));
    if (!info) continue;
    const uid = String(s.teacherId);
    const pk = pairKey(String(s.groupId), s.subject);
    teachersOfPair.set(pk, (teachersOfPair.get(pk) ?? new Set()).add(uid));
    if (!switchOn || !planSubjects.get(info.classLevel)?.has(s.subject)) continue; // marking is only expected where session plans exist
    const exam = cal.examDays.get(info.classId)?.all;
    const effFrom = s.effectiveFrom ? dateKeyOf(new Date(s.effectiveFrom)) : "0000-01-01";
    const effTo = s.effectiveTo ? dateKeyOf(new Date(s.effectiveTo)) : "9999-12-31";
    for (const k of dayKeys) {
      if (k < effFrom || k > effTo || DOW[parseDateKey(k).getDay()] !== s.dayOfWeek || exam?.has(k)) continue;
      const done = slotKeysDone.has(`${s._id}|${k}`) ? 1 : 0;
      if (!done && onLeave(uid, k)) continue; // on approved leave and nobody covered
      for (const a of [pairAcc(String(s.groupId), s.subject), teacherAcc(uid)]) {
        a.periods.total += 1;
        a.periods.done += done;
      }
    }
  }

  // ---- HW / AS papers: confirmed by the deadline, with a tick ---------------------------------------------------------
  const papers = await MasteryPaper.find({
    trackerLinked: true,
    extra: { $ne: true },
    source: { $in: ["HW", "AS"] },
    sectionId: { $in: [...sections.keys()].map(oid) },
    date: { $gte: fromDate, $lte: toDate },
  })
    .select("sectionId subject source entryState")
    .lean(); // bounded: one period's papers
  const deadlines = await paperDeadlines(papers.map((p) => p._id), now);
  const today = dhakaDayKey(now);
  const tickedIds = papers.length
    ? new Set(
        (
          await MasteryResult.distinct("paperId", {
            paperId: { $in: papers.filter((p) => p.entryState === "CONFIRMED").map((p) => p._id) },
            $or: [{ "items.0": { $exists: true } }, { workRework: true }, { "workTags.0": { $exists: true } }],
          })
        ).map(String),
      )
    : new Set<string>();
  for (const p of papers) {
    const d = deadlines.get(String(p._id));
    if (!d) continue; // never issued - no deadline
    const sid = String(p.sectionId);
    const targets = [pairAcc(sid, p.subject), ...d.ownerIds.map(teacherAcc)];
    if (d.confirmed) for (const a of targets) {
      a.confirmed += 1;
      if (tickedIds.has(String(p._id))) a.ticked += 1;
    }
    // AL-9 rule: on time = confirmed on or before the LATEST effective (leave- and pause-aware) deadline of its owners;
    // it counts once confirmed, or once that deadline has passed.
    const onTime = d.confirmed && d.confirmedKey !== null && (d.effectiveKey === null || d.confirmedKey <= d.effectiveKey);
    const pastDue = d.effectiveKey !== null && d.effectiveKey < today;
    if (d.confirmed || pastDue) for (const a of targets) {
      a.papers.total += 1;
      if (onTime) a.papers.done += 1;
    }
  }

  // ---- class tests with a linked sheet -----------------------------------------------------------------------------------
  const tests = await ClassTest.find({ sectionId: { $in: [...sections.keys()].map(oid) }, status: { $ne: "CANCELLED" }, examDate: { $gte: fromDate, $lte: toDate } })
    .select("sectionId subject teacherId requestedBy examDate")
    .lean(); // bounded: one period's tests
  const linked = tests.length
    ? new Set(
        (await MasteryPaper.find({ source: "CT", "links.classTestId": { $in: tests.map((t) => t._id) } }).select("links.classTestId").lean()).map((p) => String(p.links?.classTestId)),
      )
    : new Set<string>();
  for (const t of tests) {
    if (dhakaDayKey(new Date(t.examDate)) > today) continue; // not sat yet
    const hit = linked.has(String(t._id)) ? 1 : 0;
    for (const a of [pairAcc(String(t.sectionId), t.subject), teacherAcc(String(t.teacherId ?? t.requestedBy))]) {
      a.tests.total += 1;
      a.tests.done += hit;
    }
  }

  // ---- moves + re-teach, per section x subject (then handed to that pair's teachers) ---------------------------------------
  const evPairs = await MasteryEvidence.aggregate<{ _id: { s: Types.ObjectId; subject: string } }>([
    { $match: { sectionId: { $in: [...sections.keys()].map(oid) }, supersededAt: null, excludedAt: null, at: { $gte: fromDate, $lte: toDate } } },
    { $group: { _id: { s: "$sectionId", subject: "$subject" } } },
  ]);
  const startMoment = new Date(fromDate.getTime() - 1);
  for (const { _id } of evPairs) {
    const sid = String(_id.s);
    const info = sections.get(sid);
    const token = info ? classTokenForLevel(info.classLevel) : null;
    if (!info || !token || !(MASTERY_SUBJECTS as readonly string[]).includes(_id.subject)) continue;
    const subject = _id.subject as MasterySubject;
    const [rows, policy] = await Promise.all([liveSectionRows(_id.s, subject, undefined, { until: toDate }), diagnosisPolicy(token as MasteryClassToken, subject)]);
    const before = computeSection(rows.filter((r) => r.at < fromDate), policy, startMoment);
    const after = computeSection(rows, policy, toDate);
    let toImproving = 0;
    let toMastered = 0;
    for (const [lo, kids] of before.states) {
      for (const [kid, st] of kids) {
        if (st.state !== "WEAK") continue;
        const now2 = after.states.get(lo)?.get(kid)?.state;
        if (now2 === "IMPROVING") toImproving += 1;
        else if (now2 === "MASTERED") toMastered += 1;
      }
    }
    const targets = [pairAcc(sid, subject), ...[...(teachersOfPair.get(pairKey(sid, subject)) ?? [])].map(teacherAcc)];
    for (const a of targets) {
      a.toImproving += toImproving;
      a.toMastered += toMastered;
    }
  }
  const actions = await MasteryAction.find({
    sectionId: { $in: [...sections.keys()].map(oid) },
    kind: { $ne: "EXTRA_HOMEWORK" },
    $or: [{ "trigger.at": { $gte: fromDate, $lte: toDate } }, { closedAt: { $gte: fromDate, $lte: toDate } }],
  })
    .select("sectionId subject trigger.at closedAt status before after")
    .lean(); // bounded: one period's actions
  for (const x of actions) {
    const sid = String(x.sectionId);
    const opened = x.trigger?.at && new Date(x.trigger.at) >= fromDate && new Date(x.trigger.at) <= toDate;
    const closed = x.closedAt && new Date(x.closedAt) >= fromDate && new Date(x.closedAt) <= toDate && x.status === "CLOSED";
    for (const a of [pairAcc(sid, x.subject), ...[...(teachersOfPair.get(pairKey(sid, x.subject)) ?? [])].map(teacherAcc)]) {
      if (opened) a.opened += 1;
      if (closed) {
        a.closed += 1;
        if (typeof x.before?.weakPct === "number" && typeof x.after?.weakPct === "number") {
          a.before.push(x.before.weakPct);
          a.after.push(x.after.weakPct);
        }
      }
    }
  }

  // ---- shape the rows ----------------------------------------------------------------------------------------------------------
  const teacherRows: LoopHealthRow[] = [];
  const users = byTeacher.size ? await User.find({ _id: { $in: [...byTeacher.keys()].filter((k) => Types.ObjectId.isValid(k)).map(oid) } }).select("name").lean() : [];
  const nameOf = new Map(users.map((u) => [String(u._id), u.name]));
  for (const [uid, a] of byTeacher) {
    teacherRows.push(rowOf({ key: `T:${uid}`, kind: "TEACHER", teacherId: uid, teacherName: nameOf.get(uid) ?? null, sectionId: null, className: null, sectionName: null, subject: null }, a, windowDays));
  }
  teacherRows.sort((x, y) => (x.teacherName ?? "~").localeCompare(y.teacherName ?? "~", "bn"));
  const sectionRows: LoopHealthRow[] = [];
  for (const [pk, a] of byPair) {
    const [sid, subject] = pk.split("|") as [string, string];
    const info: SectionInfo | undefined = sections.get(sid);
    if (!info) continue;
    sectionRows.push(rowOf({ key: `S:${pk}`, kind: "SECTION", teacherId: null, teacherName: null, sectionId: sid, className: info.classNameBn, sectionName: info.sectionNameBn, subject }, a, windowDays));
  }
  const level = (r: LoopHealthRow) => sections.get(r.sectionId ?? "")?.classLevel ?? 99;
  sectionRows.sort((x, y) => level(x) - level(y) || (x.sectionName ?? "").localeCompare(y.sectionName ?? "", "bn") || (x.subject ?? "").localeCompare(y.subject ?? ""));
  return { SECTION: sectionRows, TEACHER: teacherRows };
}

export interface LoopHealthPage extends Page<LoopHealthRow> {
  from: string;
  to: string;
}

/** AC-L1: one page of health rows for the period (from / to default to the last 4 weeks; from never before the year starts, to never after today). */
export async function loopHealthPage(
  args: PageArgs & { kind: HealthKind; from?: string | null; to?: string | null },
  now: Date = new Date(),
): Promise<LoopHealthPage> {
  const period = resolvePeriod(args.from, args.to, now);
  const { yearStartKey } = await healthSections();
  if (yearStartKey && period.from < yearStartKey) period.from = yearStartKey <= period.to ? yearStartKey : period.to;
  const rows = await loopHealthRows(args.kind, period.from, period.to, now);
  return { ...pageOf(rows, args), ...period };
}
