/**
 * SyllabusTargetService (AL-11, D-#1675, docs/prd-academic-loop-2027.md §3.3, journey A, AC-A1..A6) — the Office's term
 * target dates and the "on track / N sessions behind" read built on them.
 *
 *   setSyllabusTargets   save / clear targets per class × subject × term (`lesson_progress:set_targets` — the resolver gate)
 *   syllabusTargetBoard  one class level's subjects with their plan sessions + the saved targets (the Office screen)
 *   loadPaceEnv          the term calendar, read ONCE per request: teaching-day rule + the class exam days + the targets
 *   resolveTermRead      the pace of one শাখா × subject: expected sessions today vs finished → ON_TRACK / BEHIND / NO_TARGET
 *   runLessonBehind      the weekly `LPBEHIND` family: the Principal, at `termBehindAlertWeeks`+ weeks behind
 *
 * TEACHING DAYS ONLY: a day counts when it is an open school day (`resolveDayType` = FULL, so weekends and every holiday
 * incl. Eid / Ramadan `HolidayException` are out) AND it is not an exam day of that class (the exams module's routine, any
 * term) AND no `AcademicPause` window switches off assignments or homework on it (`ASSIGNMENT_GENERATION` /
 * `HOMEWORK_REQUIRED`, D-#1655). A shorter-period season (winter, Ramadan timings) is still an ordinary teaching day —
 * the pace is counted in sessions per period, not minutes.
 *
 * With no target for a class × subject nothing changes for it (NO_TARGET, "লক্ষ্য দেওয়া নেই", no alert) — so this runs
 * regardless of the 2027 release switch (§3.6). Identity/operational plane; no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { EXAM_TERMS, ROUTINE_SUBJECT_LABELS_BN, classToken, parseClassToken, type ExamTerm } from "@scd/shared";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { Exam } from "../../exams/models/Exam";
import { ExamRoutine } from "../../exams/models/ExamRoutine";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { buildDayTypeResolver } from "../../routine/calendar";
import { loadPausePredicate } from "../../academic-pause/services/AcademicPauseService";
import { dateKeyOf, isValidDateKey, parseDateKey } from "../../attendance/dates";
import { weekStartSunday } from "../../trackers/assignmentCalendar";
import { getPolicy } from "../../mastery/services/MasteryCatalogueService";
import { principalUserIds } from "../../staff-mistakes/services/principalPrivacy";
import { emitLessonBehind } from "../../notifications/services/emitters";
import { writeAudit } from "../../platform/services/AuditService";
import { SyllabusTarget, type ISyllabusTarget } from "../models/SyllabusTarget";
import { LessonProgressError, sessionKey, sessionPlansFor, type PlanSession } from "./LessonDeliveryService";
import { progressOverview } from "./LessonProgressService";

export type TargetState = "ON_TRACK" | "BEHIND" | "NO_TARGET";

/** The on-track read added to every progress row (§3.3). */
export interface TargetRead {
  state: TargetState;
  /** The term the read is against (null with no target). */
  term: ExamTerm | null;
  /** That term's target date `YYYY-MM-DD`. */
  targetDate: string | null;
  /** Sessions (in book order, from the start of the book) the term ends at. */
  targetSessions: number;
  /** Sessions that should be finished by today. */
  expectedByToday: number;
  /** expectedByToday − finished, never below 0. */
  behindBy: number;
  /** behindBy ÷ the শাখা's periods per week for the subject (one decimal); null when it has no period for the subject. */
  weeksBehind: number | null;
}

export const NO_TARGET_READ: TargetRead = {
  state: "NO_TARGET",
  term: null,
  targetDate: null,
  targetSessions: 0,
  expectedByToday: 0,
  behindBy: 0,
  weeksBehind: null,
};

const DAY = 24 * 3600 * 1000;
const addDaysKey = (key: string, days: number): string => dateKeyOf(new Date(parseDateKey(key).getTime() + days * DAY));
/** DST-free zone (Asia/Dhaka); the +12h keeps rounding safe anyway. */
const nextKey = (key: string): string => dateKeyOf(new Date(parseDateKey(key).getTime() + DAY + 12 * 3600 * 1000));

// ---------------------------------------------------------------------------
// Pure pace maths
// ---------------------------------------------------------------------------

/**
 * Expected sessions by today and how far behind. Cumulative from the start of the book:
 *   expected = startOffset + (endCount − startOffset) × (elapsed ÷ total teaching days of the term)
 * `startOffset` is 0 for HALF_YEARLY, the half-yearly end point for ANNUAL. Whole sessions only (floor): a teacher is never
 * "behind" by part of a session. (AC-A1: target 40, half the days gone → expected 20; 15 finished → 5 behind.)
 */
export function paceRead(i: {
  startOffset: number;
  endCount: number;
  daysTotal: number;
  daysElapsed: number;
  pastTarget: boolean;
  finished: number;
  periodsPerWeek: number;
}): { expectedByToday: number; behindBy: number; weeksBehind: number | null } {
  const termSessions = Math.max(0, i.endCount - i.startOffset);
  const fraction = i.pastTarget ? 1 : i.daysTotal > 0 ? Math.min(1, Math.max(0, i.daysElapsed / i.daysTotal)) : 0;
  const expectedByToday = Math.floor(i.startOffset + termSessions * fraction + 1e-9);
  const behindBy = Math.max(0, expectedByToday - i.finished);
  // No routine period for the subject -> no honest weeks figure (never fall back to counting sessions as weeks).
  const weeksBehind = i.periodsPerWeek > 0 ? Math.round((behindBy / i.periodsPerWeek) * 10) / 10 : null;
  return { expectedByToday, behindBy, weeksBehind };
}

/** "৫ সেশন পিছিয়ে" / "সময়মতো" / "লক্ষ্য দেওয়া নেই" are rendered by the app from `state` + `behindBy`. */

// ---------------------------------------------------------------------------
// The term calendar (one load per request)
// ---------------------------------------------------------------------------

interface TargetLite {
  targetDate: string;
  endChapter: string;
  endSessionIndex: number;
}

export interface PaceEnv {
  yearId: string;
  yearStartKey: string;
  yearEndKey: string;
  /** Open school day that no assignment / homework pause covers (the class's exam days are removed per class). */
  dayOpen: (key: string) => boolean;
  /** classId → exam days of that class (`all`: every exam term; `half`: the half-yearly exam only). */
  examDays: Map<string, { all: Set<string>; half: Set<string> }>;
  /** `<classToken>|<subject>|<term>` → target. */
  targets: Map<string, TargetLite>;
  /** Memo for `teachingDays`. */
  memo: Map<string, number>;
}

/**
 * The teaching calendar of a year over [fromKey, toKey]: `dayOpen` (open school day, no assignment / homework pause) and the
 * exam days per class (AL-13 reads the same rule for "periods expected"). One load; the callers memoise.
 */
export async function loadTeachingCalendar(
  yearId: Types.ObjectId,
  yearStartKey: string,
  yearEndKey: string,
): Promise<{ dayOpen: (key: string) => boolean; examDays: Map<string, { all: Set<string>; half: Set<string> }> }> {
  const year = { _id: yearId };
  const [resolver, paused] = await Promise.all([
    buildDayTypeResolver(parseDateKey(yearStartKey), parseDateKey(yearEndKey)),
    loadPausePredicate(yearStartKey, yearEndKey),
  ]);
  const dayOpen = (key: string): boolean =>
    resolver(parseDateKey(key)) === "FULL" && !paused("ASSIGNMENT_GENERATION", key) && !paused("HOMEWORK_REQUIRED", key);

  const examDays = new Map<string, { all: Set<string>; half: Set<string> }>();
  const exams = (await Exam.find({ academicYearId: year._id }).select("_id term").lean()) as unknown as Array<{ _id: Types.ObjectId; term: string }>;
  if (exams.length > 0) {
    const termOf = new Map(exams.map((e) => [String(e._id), e.term]));
    const routines = (await ExamRoutine.find({ examId: { $in: exams.map((e) => e._id) } })
      .select("examId slots.classId slots.dateKey")
      .lean()) as unknown as Array<{ examId: Types.ObjectId; slots: Array<{ classId: Types.ObjectId; dateKey: string }> }>;
    for (const r of routines) {
      const half = termOf.get(String(r.examId)) === "HALF_YEARLY";
      for (const s of r.slots) {
        const cur = examDays.get(String(s.classId)) ?? { all: new Set<string>(), half: new Set<string>() };
        cur.all.add(s.dateKey);
        if (half) cur.half.add(s.dateKey);
        examDays.set(String(s.classId), cur);
      }
    }
  }

  return { dayOpen, examDays };
}

/** The current year's term calendar, or null when there is no current year. */
export async function loadPaceEnv(): Promise<PaceEnv | null> {
  const year = await AcademicYear.findOne({ current: true }).select("startDate endDate").lean();
  if (!year) return null;
  const yearStartKey = dateKeyOf(year.startDate as Date);
  const yearEndKey = dateKeyOf(year.endDate as Date);
  // Targets FIRST: a year with none (2026) costs this one query and nothing else — no calendar, holiday, pause or exam reads.
  const rows = (await SyllabusTarget.find({ academicYearId: year._id })
    .select("classToken subject term targetDate endChapter endSessionIndex")
    .lean()) as unknown as Array<ISyllabusTarget>;
  const targets = new Map<string, TargetLite>();
  for (const t of rows) targets.set(`${t.classToken}|${t.subject}|${t.term}`, t);
  if (targets.size === 0) {
    return { yearId: String(year._id), yearStartKey, yearEndKey, dayOpen: () => false, examDays: new Map(), targets, memo: new Map() };
  }
  const { dayOpen, examDays } = await loadTeachingCalendar(year._id, yearStartKey, yearEndKey);
  return { yearId: String(year._id), yearStartKey, yearEndKey, dayOpen, examDays, targets, memo: new Map() };
}

/** Teaching days of a class in [fromKey, toKey] inclusive (0 when the range is empty). AC-A5. */
export function teachingDays(env: PaceEnv, classId: string, fromKey: string, toKey: string): number {
  if (fromKey > toKey) return 0;
  const memoKey = `${classId}|${fromKey}|${toKey}`;
  const hit = env.memo.get(memoKey);
  if (hit !== undefined) return hit;
  const exam = env.examDays.get(classId)?.all;
  let n = 0;
  for (let k = fromKey; k <= toKey; k = nextKey(k)) if (env.dayOpen(k) && !exam?.has(k)) n++;
  env.memo.set(memoKey, n);
  return n;
}

/**
 * The first day the ANNUAL term counts from (AC-A6): the day after the class's last half-yearly exam day, or — with no exam
 * recorded for the class — the day after the half-yearly target date. Teaching days are counted from this day on, so the
 * "school day after" falls out of the day rule.
 */
export function annualStartKey(env: PaceEnv, classId: string, halfTargetDate: string): string {
  const half = [...(env.examDays.get(classId)?.half ?? [])].sort();
  return nextKey(half.length ? half[half.length - 1]! : halfTargetDate);
}

export interface TermReadInput {
  classId: string;
  classLevel: number;
  subject: string;
  plan: PlanSession[];
  /** Sessions finished so far (the row's `finished`). */
  finished: number;
  periodsPerWeek: number;
  todayKey: string;
  /** The year of the শাখা's class. A class outside the year the targets were read for has no on-track line. */
  academicYearId?: string;
}

/** The on-track read of one শাখা × subject against its class × subject targets. Pure given the env. */
export function resolveTermRead(env: PaceEnv | null, i: TermReadInput): TargetRead & { startKey: string | null } {
  if (!env) return { ...NO_TARGET_READ, startKey: null };
  if (i.academicYearId && i.academicYearId !== env.yearId) return { ...NO_TARGET_READ, startKey: null };
  const token = classToken(i.classLevel);
  const idxOf = (t: TargetLite | undefined): number => (t ? i.plan.findIndex((p) => p.key === sessionKey(t.endChapter, t.endSessionIndex)) : -1);
  const half = env.targets.get(`${token}|${i.subject}|HALF_YEARLY`);
  const ann = env.targets.get(`${token}|${i.subject}|ANNUAL`);
  const halfIdx = idxOf(half);
  const annIdx = idxOf(ann);
  const halfOk = !!half && halfIdx >= 0;
  const annOk = !!ann && annIdx >= 0;
  if (!halfOk && !annOk) return { ...NO_TARGET_READ, startKey: null };

  let term: ExamTerm;
  let target: TargetLite;
  let endCount: number;
  let startOffset: number;
  let startKey: string;
  const annStart = halfOk ? annualStartKey(env, i.classId, half!.targetDate) : env.yearStartKey;
  if (annOk && (!halfOk || i.todayKey >= annStart)) {
    term = "ANNUAL";
    target = ann!;
    endCount = annIdx + 1;
    startOffset = halfOk ? halfIdx + 1 : 0;
    startKey = annStart;
  } else {
    term = "HALF_YEARLY";
    target = half!;
    endCount = halfIdx + 1;
    startOffset = 0;
    startKey = env.yearStartKey;
  }
  const daysTotal = teachingDays(env, i.classId, startKey, target.targetDate);
  // Teaching days COMPLETED: up to yesterday, so a period still to be taught today is never counted as missed.
  const lastDone = [addDaysKey(i.todayKey, -1), target.targetDate].sort()[0]!;
  const daysElapsed = teachingDays(env, i.classId, startKey, lastDone);
  const pace = paceRead({
    startOffset,
    endCount,
    daysTotal,
    daysElapsed,
    pastTarget: i.todayKey > target.targetDate,
    finished: i.finished,
    periodsPerWeek: i.periodsPerWeek,
  });
  return {
    state: pace.behindBy > 0 ? "BEHIND" : "ON_TRACK",
    term,
    targetDate: target.targetDate,
    targetSessions: endCount,
    ...pace,
    startKey,
  };
}

// ---------------------------------------------------------------------------
// The Office screen: read + save
// ---------------------------------------------------------------------------

export interface TargetView {
  term: ExamTerm;
  targetDate: string;
  endChapter: string;
  endSessionIndex: number;
  /** "<chapter>:<sessionIndex>". */
  endKey: string;
}

export interface TargetBoardRow {
  subject: string;
  /** The plan's sessions in book order (the picker). */
  sessions: PlanSession[];
  halfYearly: TargetView | null;
  annual: TargetView | null;
}

const view = (t: TargetLite & { term: ExamTerm }): TargetView => ({
  term: t.term,
  targetDate: t.targetDate,
  endChapter: t.endChapter,
  endSessionIndex: t.endSessionIndex,
  endKey: sessionKey(t.endChapter, t.endSessionIndex),
});

/** Subjects of a class level that have current session plans. */
export async function planSubjectsOfLevel(classLevel: number): Promise<string[]> {
  const subjects = (await ContentArtifact.distinct("subject", {
    docType: "session_plan",
    classLevel,
    current: true,
    retiredAt: null,
  })) as string[];
  return subjects.filter(Boolean).sort();
}

export interface TargetYear {
  id: string;
  label: string;
  current: boolean;
  startKey: string;
  endKey: string;
}

type YearLean = { _id: Types.ObjectId; label: string; startDate: Date; endDate: Date };

/** The years targets may be set for: the current one, and the prepared NEXT one (the earliest year starting after it). */
async function allowedYears(): Promise<Array<YearLean & { current: boolean }>> {
  const cur = (await AcademicYear.findOne({ current: true }).select("label startDate endDate").lean()) as unknown as YearLean | null;
  if (!cur) return [];
  const next = (await AcademicYear.findOne({ startDate: { $gt: cur.startDate }, current: { $ne: true } })
    .sort({ startDate: 1 })
    .select("label startDate endDate")
    .lean()) as unknown as YearLean | null;
  return [{ ...cur, current: true }, ...(next ? [{ ...next, current: false }] : [])];
}

export async function targetYears(): Promise<TargetYear[]> {
  return (await allowedYears()).map((y) => ({ id: String(y._id), label: y.label, current: y.current, startKey: dateKeyOf(y.startDate), endKey: dateKeyOf(y.endDate) }));
}

/** The chosen year (default: current) — only the current year or the prepared next year are accepted. */
export async function chooseYear(academicYearId?: string | null): Promise<(YearLean & { current: boolean }) | null> {
  const years = await allowedYears();
  if (!academicYearId) return years[0] ?? null;
  const hit = years.find((y) => String(y._id) === academicYearId);
  if (!hit) throw new LessonProgressError("লক্ষ্য শুধু চলতি বা পরের (প্রস্তুত করা) শিক্ষাবর্ষের জন্য ঠিক করা যায়।");
  return hit;
}

/** One class level: each plan subject with its sessions and saved targets (the chosen year; default current). */
export async function syllabusTargetBoard(classLevel: number, academicYearId?: string | null): Promise<TargetBoardRow[]> {
  if (!Number.isInteger(classLevel) || classLevel < 1 || classLevel > 5) throw new LessonProgressError("ক্লাস ১–৫ এর জন্য লক্ষ্য ঠিক করা যায়।");
  const year = await chooseYear(academicYearId);
  const token = classToken(classLevel);
  const saved = year
    ? ((await SyllabusTarget.find({ academicYearId: year._id, classToken: token }).lean()) as unknown as ISyllabusTarget[])
    : [];
  const out: TargetBoardRow[] = [];
  for (const subject of await planSubjectsOfLevel(classLevel)) {
    const mine = saved.filter((t) => t.subject === subject);
    const half = mine.find((t) => t.term === "HALF_YEARLY");
    const ann = mine.find((t) => t.term === "ANNUAL");
    out.push({
      subject,
      sessions: await sessionPlansFor(classLevel, subject),
      halfYearly: half ? view(half) : null,
      annual: ann ? view(ann) : null,
    });
  }
  return out;
}

export interface TargetInput {
  classLevel: number;
  subject: string;
  term: string;
  /** Empty / null clears this term's target. */
  targetDate?: string | null;
  endChapter?: string | null;
  endSessionIndex?: number | null;
}

export interface SetTargetsResult {
  saved: number;
  cleared: number;
}

/**
 * Save / clear targets (AC-A4: the resolver is gated on `lesson_progress:set_targets` — a teacher is refused there).
 * Every row is validated first; one bad row saves nothing. HALF_YEARLY needs an end session; ANNUAL defaults to the plan's last
 * session. The annual end may not sit before the half-yearly end, nor its date before the half-yearly date.
 */
export async function setSyllabusTargets(inputs: TargetInput[], actorId: string, academicYearId?: string | null): Promise<SetTargetsResult> {
  if (!Types.ObjectId.isValid(actorId)) throw new LessonProgressError("ব্যবহারকারী পাওয়া যায়নি।");
  const year = await chooseYear(academicYearId);
  if (!year) throw new LessonProgressError("চলতি শিক্ষাবর্ষ পাওয়া যায়নি।");
  const yStart = dateKeyOf(year.startDate as Date);
  const yEnd = dateKeyOf(year.endDate as Date);

  interface Planned {
    token: string;
    level: number;
    subject: string;
    term: ExamTerm;
    clear: boolean;
    targetDate: string;
    endChapter: string;
    endSessionIndex: number;
    endIdx: number;
  }
  const planned: Planned[] = [];
  const plans = new Map<string, PlanSession[]>();
  for (const inp of inputs) {
    if (!Number.isInteger(inp.classLevel) || inp.classLevel < 1 || inp.classLevel > 5) throw new LessonProgressError("ক্লাস ১–৫ এর জন্য লক্ষ্য ঠিক করা যায়।");
    if (!(EXAM_TERMS as readonly string[]).includes(inp.term)) throw new LessonProgressError("মেয়াদ বেছে নিন: অর্ধবার্ষিক বা বার্ষিক।");
    const term = inp.term as ExamTerm;
    const pk = `${inp.classLevel}|${inp.subject}`;
    if (!plans.has(pk)) plans.set(pk, await sessionPlansFor(inp.classLevel, inp.subject));
    const plan = plans.get(pk)!;
    if (plan.length === 0) throw new LessonProgressError("এই ক্লাস ও বিষয়ের কোনো সেশন পরিকল্পনা নেই।");
    const token = classToken(inp.classLevel);
    const date = (inp.targetDate ?? "").trim();
    if (!date) {
      planned.push({ token, level: inp.classLevel, subject: inp.subject, term, clear: true, targetDate: "", endChapter: "", endSessionIndex: 0, endIdx: -1 });
      continue;
    }
    if (!isValidDateKey(date)) throw new LessonProgressError("তারিখ ঠিক নয় (বছর-মাস-দিন, যেমন ২০২৭-০৬-৩০)।");
    if (date < yStart || date > yEnd) throw new LessonProgressError("লক্ষ্য তারিখ নির্বাচিত শিক্ষাবর্ষের ভেতরে হতে হবে।");
    let endChapter = (inp.endChapter ?? "").trim();
    let endSessionIndex = inp.endSessionIndex ?? 0;
    if (!endChapter) {
      if (term !== "ANNUAL") throw new LessonProgressError("অর্ধবার্ষিকের শেষ সেশন বেছে নিন।");
      const last = plan[plan.length - 1]!;
      endChapter = last.chapter;
      endSessionIndex = last.sessionIndex;
    }
    const endIdx = plan.findIndex((p) => p.key === sessionKey(endChapter, endSessionIndex));
    if (endIdx < 0) throw new LessonProgressError("এই সেশনটি বইয়ের পরিকল্পনায় নেই।");
    planned.push({ token, level: inp.classLevel, subject: inp.subject, term, clear: false, targetDate: date, endChapter, endSessionIndex, endIdx });
  }

  // The annual end may not sit before the half-yearly end (checked against what will be saved, not what was).
  const existing = (await SyllabusTarget.find({ academicYearId: year._id }).lean()) as unknown as ISyllabusTarget[];
  const finalFor = (token: string, subject: string, term: ExamTerm): { targetDate: string; idx: number } | null => {
    const p = planned.find((x) => x.token === token && x.subject === subject && x.term === term);
    if (p) return p.clear ? null : { targetDate: p.targetDate, idx: p.endIdx };
    const e = existing.find((x) => x.classToken === token && x.subject === subject && x.term === term);
    if (!e) return null;
    const level = parseClassToken(token) ?? 0;
    const plan = plans.get(`${level}|${subject}`);
    return { targetDate: e.targetDate, idx: plan ? plan.findIndex((p) => p.key === sessionKey(e.endChapter, e.endSessionIndex)) : -1 };
  };
  for (const p of planned) {
    if (p.clear || p.term !== "ANNUAL") continue;
    const h = finalFor(p.token, p.subject, "HALF_YEARLY");
    if (h && (p.targetDate < h.targetDate || (h.idx >= 0 && p.endIdx < h.idx))) {
      throw new LessonProgressError("বার্ষিকের শেষ সেশন ও তারিখ অর্ধবার্ষিকের পরে হতে হবে।");
    }
  }
  for (const p of planned) {
    if (p.clear || p.term !== "HALF_YEARLY") continue;
    const a = finalFor(p.token, p.subject, "ANNUAL");
    if (a && (a.targetDate < p.targetDate || (a.idx >= 0 && a.idx < p.endIdx))) {
      throw new LessonProgressError("অর্ধবার্ষিকের শেষ সেশন ও তারিখ বার্ষিকের আগে হতে হবে।");
    }
  }

  const res: SetTargetsResult = { saved: 0, cleared: 0 };
  const changes: Array<Record<string, unknown>> = [];
  for (const p of planned) {
    const old = existing.find((x) => x.classToken === p.token && x.subject === p.subject && x.term === p.term);
    const was = old ? { date: old.targetDate, end: sessionKey(old.endChapter, old.endSessionIndex) } : null;
    const will = p.clear ? null : { date: p.targetDate, end: sessionKey(p.endChapter, p.endSessionIndex) };
    if (was?.date !== will?.date || was?.end !== will?.end) changes.push({ subject: p.subject, term: p.term, classLevel: p.level, from: was, to: will });
    const key = { academicYearId: year._id, classToken: p.token, subject: p.subject, term: p.term };
    if (p.clear) {
      const d = await SyllabusTarget.deleteOne(key);
      res.cleared += d.deletedCount ?? 0;
      continue;
    }
    await SyllabusTarget.updateOne(
      key,
      { $set: { targetDate: p.targetDate, endChapter: p.endChapter, endSessionIndex: p.endSessionIndex, setBy: new Types.ObjectId(actorId), setAt: new Date() } },
      { upsert: true },
    );
    res.saved++;
  }
  if (changes.length > 0) {
    await writeAudit({
      eventKind: "SYLLABUS_TARGETS_SET",
      actorId,
      targetKind: "SyllabusTarget",
      meta: { academicYearId: String(year._id), saved: res.saved, cleared: res.cleared, classLevels: [...new Set(planned.map((p) => p.level))], changes },
    });
  }
  return res;
}

// ---------------------------------------------------------------------------
// LPBEHIND — the Principal's weekly alert
// ---------------------------------------------------------------------------

/** 08:30 on the first open school day of the week. */
export const LPBEHIND_MINUTES = 8 * 60 + 30;

const bn = (n: number | string): string => String(n).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const MONTHS_BN = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
/** "২০২৭-০২-০৪" key -> "৪ ফেব্রুয়ারি ২০২৭". */
export const dateKeyBn = (key: string | null): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? "");
  return m ? `${bn(Number(m[3]))} ${MONTHS_BN[Number(m[2]) - 1]} ${bn(m[1])}` : "";
};

export interface LessonBehindRun {
  /** শাখা × subject rows at or past the alert threshold. */
  behind: number;
  /** New notices written (a second run in the week writes none). */
  notified: number;
}

/**
 * One notice per Principal per শাখা × subject that is `termBehindAlertWeeks`+ weeks behind its term target (R14, AC-A2). A
 * class × subject with no target is never listed (AC-A3). Idempotent: the dedupe key holds the week, the শাখা × subject and
 * the recipient. Runs regardless of the 2027 switch (§3.6).
 */
export async function runLessonBehind(now: Date = new Date()): Promise<LessonBehindRun> {
  const res: LessonBehindRun = { behind: 0, notified: 0 };
  const threshold = Number((await getPolicy(null, null)).resolved.termBehindAlertWeeks ?? 2);
  const rows = (await progressOverview({}, now)).filter((r) => r.targetState === "BEHIND" && r.weeksBehind !== null && r.weeksBehind >= threshold);
  res.behind = rows.length;
  if (rows.length === 0) return res;
  const principals = await principalUserIds();
  if (principals.length === 0) return res;
  const weekKey = dateKeyOf(weekStartSunday(now));
  for (const r of rows) {
    res.notified += await emitLessonBehind({
      recipientUserIds: principals,
      sectionId: r.sectionId,
      subject: r.subject,
      weekKey,
      titleBn: "সিলেবাস লক্ষ্যের পেছনে",
      messageBn: `${r.classNameBn} · ${r.sectionNameBn} — ${(ROUTINE_SUBJECT_LABELS_BN as Record<string, string>)[r.subject] ?? r.subject}: ${bn(r.behindBy)} সেশন পিছিয়ে (প্রায় ${bn(r.weeksBehind ?? 0)} সপ্তাহ)। লক্ষ্য তারিখ: ${dateKeyBn(r.targetDate)}।`,
    });
  }
  return res;
}
