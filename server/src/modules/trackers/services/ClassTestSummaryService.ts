/**
 * ClassTestSummaryService (CT-4, prd-tracker-class-test §6/§9, J5/J6, D-#44) — the
 * READ-side aggregates over the class-test plane. Everything here is DERIVED at read
 * time (D-#85 — never stored) and takes `now`/`asOf` injected so the math is
 * deterministic (the CT-2 posture). Deadline + overdue are NOT re-derived — every
 * per-exam status reuses CT-2's `examReportStatus` (which itself rides
 * `classTestCalendar` over the ONE D-#50 calendar source).
 *
 *   reportsStatus       — per-exam submitted/pending/overdue + school-days late + a
 *                         derived report state (not_started/in_progress/complete/overdue).
 *   principalDashboard  — KPIs (logged / complete / in_progress / not_started / overdue
 *                         + completion rate) and the overdue-by-teacher breakdown (J5).
 *   classSubjectAnalysis— per-student progression + trend ↑/↓/→ (latest vs previous
 *                         percent for the same student × subject, §9).
 *   studentProfile      — one student across subjects (per-result + per-subject roll-up).
 *   overdueChaseList    — the Office chase list (J6, AS-T4 posture): per overdue-report
 *                         teacher, a rendered wa.me nudge (ADR-003). The Office chases —
 *                         the teacher never chases themselves (gated in the resolver).
 *
 * Identity-plane (names studentIds/teacherIds); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { HW_SUBJECT_LABELS_BN, ROSTER_CLASS_LABELS_BN, type RosterClassLevel } from "@scd/shared";
import { Section } from "../../foundation/models/Section";
import { bnNum } from "../../../lib/bnNum";
import { ClassTest, type IClassTest } from "../models/ClassTest";
import { ClassTestResult, type IClassTestResult } from "../models/ClassTestResult";
import { Student } from "../../foundation/models/Student";
import { SubjectGroup } from "../../routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { User } from "../../foundation/models/User";
import { deriveScore } from "../classTestScoring";
import { examReportStatus, deriveReportOwnership, type ExamReportStatus } from "./ClassTestResultService";
import { buildIsOpenDayForRange, deriveOverdue, type IsOpenDay } from "../classTestCalendar";
import { getEffectiveTemplate, interpolate, type EffectiveTemplate } from "../../templates/services/MessageTemplateService";

// ---------------------------------------------------------------------------
// Scope filter → the PRINTED-exam query (an official exam is the unit of reporting)
// ---------------------------------------------------------------------------

export interface SummaryFilter {
  academicYearId?: string;
  classLevel?: number;
  sectionId?: string;
  subject?: string;
  /** The ACCOUNTABLE subject teacher (ClassTest.teacherId, falling back to
   *  requestedBy on pre-field rows) — restricts to one teacher. */
  teacherId?: string;
  asOf?: Date;
  /** List RETIRED exams instead of live ones (CANCELLED). The drill-down uses this
   *  so a retired exam stays reachable — otherwise retiring it would be a one-way
   *  door with no restore path (owner ask 2026-08-03). */
  retired?: boolean;
}

function examQuery(filter: SummaryFilter): Record<string, unknown> {
  const q: Record<string, unknown> = { status: filter.retired ? "CANCELLED" : "PRINTED" };
  if (filter.academicYearId) q.academicYearId = new Types.ObjectId(filter.academicYearId);
  if (typeof filter.classLevel === "number") q.classLevel = filter.classLevel;
  if (filter.sectionId) q.sectionId = new Types.ObjectId(filter.sectionId);
  if (filter.subject) q.subject = filter.subject;
  if (filter.teacherId) {
    // Match the accountable teacher; rows predating `teacherId` (not yet backfilled)
    // still answer on requestedBy, so no exam falls out of the filter mid-rollout.
    const tid = new Types.ObjectId(filter.teacherId);
    q.$or = [{ teacherId: tid }, { teacherId: { $exists: false }, requestedBy: tid }];
  }
  return q;
}

async function loadPrintedExams(filter: SummaryFilter): Promise<IClassTest[]> {
  return (await ClassTest.find(examQuery(filter)).sort({ examDate: 1 }).lean()) as unknown as IClassTest[];
}

function subjectBn(subject: string): string {
  return (HW_SUBJECT_LABELS_BN as Record<string, string>)[subject] ?? subject;
}

function ddmm(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function classBn(level: number): string {
  return (ROSTER_CLASS_LABELS_BN as Record<number, string>)[level as RosterClassLevel] ?? `ক্লাস ${bnNum(level)}`;
}

// ---------------------------------------------------------------------------
// Report state (pure) — the 4-way partition the dashboard KPIs bucket on
// ---------------------------------------------------------------------------

export type ReportState = "not_started" | "in_progress" | "complete" | "overdue";

/** Mutually-exclusive bucket (priority: complete > overdue > in_progress > not_started).
 *
 *  D-#603: `complete` is now PUBLISH-complete, not entry-complete. Entering every
 *  mark used to win this race and paint the row green while guardians had still
 *  seen nothing; the finish line is release. `overdue` correspondingly means
 *  past-deadline-and-unpublished (examReportStatus), so a fully-entered but
 *  unreleased exam stays বিলম্বিত instead of flipping to সম্পূর্ণ. */
export function reportStateOf(s: { publishComplete: boolean; overdue: boolean; enteredCount: number }): ReportState {
  if (s.publishComplete) return "complete";
  if (s.overdue) return "overdue";
  if (s.enteredCount > 0) return "in_progress";
  return "not_started";
}

// ---------------------------------------------------------------------------
// 1. Reports Status — per-exam (reuses examReportStatus, no re-derivation)
// ---------------------------------------------------------------------------

export interface ReportStatusRow extends ExamReportStatus {
  subject: string;
  testNumber: number;
  /** Both null on a group-anchored exam (D-#507); `subjectGroupId` is set instead. */
  classLevel: number | null;
  sectionId: string | null;
  subjectGroupId: string | null;
  teacherId: string;
  /** D-#339: the report author's display name (drill-down rows). */
  teacherName: string;
  /** D-#339: newest result-row submittedAt (CT-8 propose-for-release) — null until proposed. */
  submittedAt: string | null;
  /** Newest result-row publishedAt (CT-3 publish/approve) — null until ≥1 result is published. */
  publishedAt: string | null;
  state: ReportState;
}

/**
 * The per-exam status math, PURE — identical to `examReportStatus`'s body with its
 * three I/O inputs (calendar, roster count, entered/present counts) passed in, so a
 * caller holding many exams computes them all without a single extra round trip.
 * `examReportStatus` remains the single-exam entry point and is unchanged.
 */
function examStatusFrom(
  exam: IClassTest,
  io: {
    now: Date;
    isOpenDay: IsOpenDay;
    rosterCount: number;
    enteredCount: number;
    presentCount: number;
    submittedCount: number;
    publishedCount: number;
  },
): ExamReportStatus {
  const { now, isOpenDay, rosterCount, enteredCount, presentCount, submittedCount, publishedCount } = io;
  const complete = rosterCount > 0 && enteredCount >= rosterCount;
  const { deadline, overdue, schoolDaysLate } = deriveOverdue(
    new Date(exam.examDate),
    exam.deadlineDays,
    now,
    isOpenDay,
  );
  const owned = deriveReportOwnership({
    rosterCount,
    submittedCount,
    publishedCount,
    pastDeadline: overdue,
    schoolDaysLate,
  });
  return {
    testId: exam._id.toString(),
    ctId: exam.ctId,
    examDate: new Date(exam.examDate).toISOString(),
    deadline: deadline.toISOString(),
    deadlineDays: exam.deadlineDays,
    rosterCount,
    enteredCount,
    presentCount,
    absentCount: enteredCount - presentCount,
    pendingCount: Math.max(0, rosterCount - enteredCount),
    complete,
    submittedCount,
    publishedCount,
    ...owned,
  };
}

/** `withTeacherNames: false` skips the User lookup — the drawer/dashboard badge
 *  counters poll every 60s and only ever tally, never render a name (D-#603). */
export async function reportsStatus(
  filter: SummaryFilter,
  opts: { withTeacherNames?: boolean } = {},
): Promise<ReportStatusRow[]> {
  const now = filter.asOf ?? new Date();
  const exams = await loadPrintedExams(filter);
  if (exams.length === 0) return [];

  // Attribute to the ACCOUNTABLE subject teacher, not whoever entered the exam —
  // a Principal/Office registration on a teacher's behalf belongs in the teacher's
  // row (the D-#351 rule, now applied to class tests).
  const accountableOf = (e: IClassTest): string =>
    (e.teacherId ?? e.requestedBy).toString();
  const teacherNames =
    opts.withTeacherNames === false
      ? new Map<string, string>()
      : await loadUserNames([...new Set(exams.map(accountableOf))]);
  // ONE pass for the CT-8 handoff state: newest submit/publish stamps AND the row
  // COUNTS the D-#603 ownership split needs. `$max` skips null/missing, so the
  // stamps are unchanged from the two filtered aggregates this replaces; the
  // counts have to see every row, which is why the $match no longer filters.
  // A row is "handed off" if submittedAt is set OR it is already published —
  // `publishExam` stamps every row, so a published row need not carry a submit.
  //
  // `$ifNull` is LOAD-BEARING (D-#614). In the QUERY language `{publishedAt:
  // {$ne: null}}` also matches a MISSING field, which is why the two `$match`-
  // filtered aggregates this replaced were correct. In an AGGREGATION EXPRESSION
  // the semantics differ: a missing field evaluates to `missing`, and
  // `{$ne: ["$publishedAt", null]}` is TRUE for it. Without the coercion every
  // never-published row counted as published, so `publishComplete` was true for
  // every exam and D-#603's whole point — a report stays বিলম্বিত until it is
  // released — silently did nothing. Measured on prod 2026-08-31: 12 of 12 rows
  // reported published on an exam with no `publishedAt` field at all.
  const notNull = (f: string) => ({ $ne: [{ $ifNull: [f, null] }, null] });
  const handoff = (await ClassTestResult.aggregate([
    { $match: { testId: { $in: exams.map((e) => e._id) } } },
    {
      $group: {
        _id: "$testId",
        submittedLatest: { $max: "$submittedAt" },
        publishedLatest: { $max: "$publishedAt" },
        submittedCount: {
          $sum: { $cond: [{ $or: [notNull("$submittedAt"), notNull("$publishedAt")] }, 1, 0] },
        },
        publishedCount: { $sum: { $cond: [notNull("$publishedAt"), 1, 0] } },
      },
    },
  ])) as Array<{
    _id: Types.ObjectId;
    submittedLatest: Date | null;
    publishedLatest: Date | null;
    submittedCount: number;
    publishedCount: number;
  }>;
  const handoffByTest = new Map(handoff.map((h) => [h._id.toString(), h]));

  // ONE calendar and ONE roster/result pass for the WHOLE exam set.
  //
  // This loop used to call `examReportStatus(exam)` per exam, and each of those
  // rebuilt a ~70-day school calendar with one DB round trip PER DAY. Measured
  // 2026-08-16 on five exams: 75s and 265 round trips, 224 of them re-reading a
  // holiday table with a single row. The per-exam status math is pure — only the
  // calendar and the counts need I/O, and both batch.
  const examDates = exams.map((e) => new Date(e.examDate).getTime());
  const isOpenDay = await buildIsOpenDayForRange(
    new Date(Math.min(...examDates)),
    new Date(Math.max(now.getTime(), Math.max(...examDates)) + 7 * 24 * 60 * 60 * 1000),
  );

  const sectionIds = [...new Set(exams.filter((e) => e.sectionId).map((e) => e.sectionId!.toString()))];
  const rosterCounts = sectionIds.length
    ? ((await Student.aggregate([
        { $match: { sectionId: { $in: sectionIds.map((id) => new Types.ObjectId(id)) }, active: true } },
        { $group: { _id: "$sectionId", n: { $sum: 1 } } },
      ])) as Array<{ _id: Types.ObjectId; n: number }>)
    : [];
  const rosterBySection = new Map(rosterCounts.map((r) => [r._id.toString(), r.n]));

  // D-#507: a group-anchored exam's denominator is its GROUP's active membership.
  // Batched exactly like the section roster above — the D-#500 property (a fixed
  // number of queries for the whole exam set) must survive this addition.
  const groupIds = [...new Set(exams.filter((e) => e.subjectGroupId).map((e) => e.subjectGroupId!.toString()))];
  const rosterByGroup = new Map<string, number>();
  if (groupIds.length) {
    const memberCounts = (await SubjectGroupMembership.aggregate([
      { $match: { groupId: { $in: groupIds.map((id) => new Types.ObjectId(id)) } } },
      {
        $lookup: {
          from: "students",
          localField: "studentId",
          foreignField: "_id",
          as: "student",
          pipeline: [{ $match: { active: true } }, { $project: { _id: 1 } }],
        },
      },
      { $match: { "student.0": { $exists: true } } },
      { $group: { _id: "$groupId", n: { $sum: 1 } } },
    ])) as Array<{ _id: Types.ObjectId; n: number }>;
    for (const r of memberCounts) rosterByGroup.set(r._id.toString(), r.n);
  }

  const statusCounts = (await ClassTestResult.aggregate([
    { $match: { testId: { $in: exams.map((e) => e._id) } } },
    { $group: { _id: { testId: "$testId", status: "$status" }, n: { $sum: 1 } } },
  ])) as Array<{ _id: { testId: Types.ObjectId; status: string }; n: number }>;
  const enteredByTest = new Map<string, number>();
  const presentByTest = new Map<string, number>();
  for (const s of statusCounts) {
    const k = s._id.testId.toString();
    enteredByTest.set(k, (enteredByTest.get(k) ?? 0) + s.n);
    if (s._id.status === "PRESENT") presentByTest.set(k, (presentByTest.get(k) ?? 0) + s.n);
  }

  const rows: ReportStatusRow[] = [];
  for (const exam of exams) {
    const ho = handoffByTest.get(exam._id.toString());
    const status = examStatusFrom(exam, {
      now,
      isOpenDay,
      rosterCount: exam.subjectGroupId
        ? rosterByGroup.get(exam.subjectGroupId.toString()) ?? 0
        : rosterBySection.get(exam.sectionId!.toString()) ?? 0,
      enteredCount: enteredByTest.get(exam._id.toString()) ?? 0,
      presentCount: presentByTest.get(exam._id.toString()) ?? 0,
      submittedCount: ho?.submittedCount ?? 0,
      publishedCount: ho?.publishedCount ?? 0,
    });
    const teacherId = accountableOf(exam);
    const sub = ho?.submittedLatest ?? null;
    const pub = ho?.publishedLatest ?? null;
    rows.push({
      ...status,
      subject: exam.subject,
      testNumber: exam.testNumber,
      classLevel: exam.classLevel ?? null,
      sectionId: exam.sectionId ? exam.sectionId.toString() : null,
      subjectGroupId: exam.subjectGroupId ? exam.subjectGroupId.toString() : null,
      teacherId,
      teacherName: teacherNames.get(teacherId) ?? "শিক্ষক",
      submittedAt: sub ? new Date(sub).toISOString() : null,
      publishedAt: pub ? new Date(pub).toISOString() : null,
      state: reportStateOf(status),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 2. Principal Dashboard — KPIs + overdue-by-teacher
// ---------------------------------------------------------------------------

export interface OverdueByTeacherRow {
  teacherId: string;
  teacherName: string;
  overdueCount: number;
}

export interface PrincipalDashboard {
  /** Total PRINTED (official) exams in scope. */
  logged: number;
  /** D-#603: PUBLISH-complete (released to guardians), not merely entry-complete —
   *  so `completionRatePct` now measures delivery, not data entry. */
  complete: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
  /** D-#603 split of `overdue` by who is answerable. The two are disjoint and
   *  sum to `overdue`: before submit it is the teacher's, after it is ours. */
  awaitingSubmit: number;
  awaitingPublish: number;
  /** complete / logged, 0–100 (null when nothing is logged). */
  completionRatePct: number | null;
  /** Only TEACHER-owned delays (`teacherOverdue`) — an exam the teacher has already
   *  submitted is waiting on Office/Principal and must not land in their column. */
  overdueByTeacher: OverdueByTeacherRow[];
}

export async function principalDashboard(filter: SummaryFilter): Promise<PrincipalDashboard> {
  const rows = await reportsStatus(filter);
  const logged = rows.length;
  let complete = 0;
  let inProgress = 0;
  let notStarted = 0;
  let overdue = 0;
  let awaitingSubmit = 0;
  let awaitingPublish = 0;
  const overdueByTeacherId = new Map<string, number>();
  for (const r of rows) {
    if (r.state === "complete") complete++;
    else if (r.state === "overdue") {
      overdue++;
      // D-#603: attribute to the stage it is actually stuck in.
      if (r.teacherOverdue) {
        awaitingSubmit++;
        overdueByTeacherId.set(r.teacherId, (overdueByTeacherId.get(r.teacherId) ?? 0) + 1);
      } else awaitingPublish++;
    } else if (r.state === "in_progress") inProgress++;
    else notStarted++;
  }

  const teacherNames = await loadUserNames([...overdueByTeacherId.keys()]);
  const overdueByTeacher: OverdueByTeacherRow[] = [...overdueByTeacherId.entries()]
    .map(([teacherId, overdueCount]) => ({
      teacherId,
      teacherName: teacherNames.get(teacherId) ?? "শিক্ষক",
      overdueCount,
    }))
    .sort((a, b) => b.overdueCount - a.overdueCount);

  return {
    logged,
    complete,
    inProgress,
    notStarted,
    overdue,
    awaitingSubmit,
    awaitingPublish,
    completionRatePct: logged === 0 ? null : Math.round((complete / logged) * 100),
    overdueByTeacher,
  };
}

// ---------------------------------------------------------------------------
// 2b. Overdue counters (D-#603) — the drawer badge, the dashboard tiles and the
//     08:00 Office/Principal digest all read THIS, so the number in the sidebar,
//     the number on the dashboard and the number in the notification can never
//     disagree. Name-free (see reportsStatus opts) because none of them show one.
// ---------------------------------------------------------------------------

export interface OverdueCounts {
  /** Past deadline and unpublished — what the বিলম্বিত chip counts. */
  overdue: number;
  /** …of which still with the teacher. */
  awaitingSubmit: number;
  /** …of which waiting on Office/Principal approval. */
  awaitingPublish: number;
}

export async function overdueCounts(filter: SummaryFilter): Promise<OverdueCounts> {
  const rows = await reportsStatus(filter, { withTeacherNames: false });
  let overdue = 0;
  let awaitingSubmit = 0;
  let awaitingPublish = 0;
  for (const r of rows) {
    if (!r.overdue) continue;
    overdue++;
    if (r.teacherOverdue) awaitingSubmit++;
    else awaitingPublish++;
  }
  return { overdue, awaitingSubmit, awaitingPublish };
}

async function loadUserNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const users = (await User.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
    .select("name")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string }>;
  return new Map(users.map((u) => [u._id.toString(), u.name]));
}

// ---------------------------------------------------------------------------
// 3. Class × Subject Analysis — per-student progression + trend (§9)
// ---------------------------------------------------------------------------

export type Trend = "up" | "down" | "flat";

/** latest vs previous percent for the same student × subject (§9). One data point ⇒ flat. */
export function trendOf(latest: number | null, previous: number | null): Trend {
  if (latest === null || previous === null) return "flat";
  if (latest > previous) return "up";
  if (latest < previous) return "down";
  return "flat";
}

export interface ClassSubjectStudentRow {
  studentId: string;
  studentName: string;
  /** PRESENT exam percents, oldest → newest (ABSENT excluded, §4). */
  percents: number[];
  latestPercent: number | null;
  previousPercent: number | null;
  trend: Trend;
  examsTaken: number;
}

export interface ClassSubjectAnalysis {
  sectionId: string;
  subject: string;
  examCount: number;
  students: ClassSubjectStudentRow[];
}

/**
 * Per-student progression for one (section × subject). Exams ordered by date; each
 * student's PRESENT-result percents are collected in that order, then latest/previous
 * → trend. ABSENT results carry no percent and are excluded from the series (§4).
 */
export async function classSubjectAnalysis(sectionId: string, subject: string): Promise<ClassSubjectAnalysis> {
  const exams = (await ClassTest.find({ status: "PRINTED", sectionId: new Types.ObjectId(sectionId), subject })
    .sort({ examDate: 1 })
    .lean()) as unknown as IClassTest[];
  if (exams.length === 0) {
    return { sectionId, subject, examCount: 0, students: [] };
  }
  const examById = new Map(exams.map((e) => [e._id.toString(), e]));
  const orderByExam = new Map(exams.map((e, i) => [e._id.toString(), i]));

  const results = (await ClassTestResult.find({ testId: { $in: exams.map((e) => e._id) } })
    .lean()) as unknown as IClassTestResult[];

  // studentId → ordered list of {order, percent} for PRESENT results.
  const byStudent = new Map<string, Array<{ order: number; percent: number }>>();
  for (const r of results) {
    if (r.status !== "PRESENT") continue; // ABSENT excluded from the trend series (§4)
    const exam = examById.get(r.testId.toString());
    if (!exam) continue;
    const score = deriveScore({ status: r.status, marks: r.marks ?? null, totalMarks: exam.totalMarks, passMark: exam.passMark });
    if (score.percent === null) continue;
    const list = byStudent.get(r.studentId.toString()) ?? [];
    list.push({ order: orderByExam.get(r.testId.toString()) ?? 0, percent: score.percent });
    byStudent.set(r.studentId.toString(), list);
  }

  const studentNames = await loadStudentNames([...byStudent.keys()]);
  const students: ClassSubjectStudentRow[] = [...byStudent.entries()]
    .map(([studentId, series]) => {
      series.sort((a, b) => a.order - b.order);
      const percents = series.map((s) => s.percent);
      const latestPercent = percents.length > 0 ? percents[percents.length - 1] : null;
      const previousPercent = percents.length > 1 ? percents[percents.length - 2] : null;
      return {
        studentId,
        studentName: studentNames.get(studentId) ?? "শিক্ষার্থী",
        percents,
        latestPercent,
        previousPercent,
        trend: trendOf(latestPercent, previousPercent),
        examsTaken: percents.length,
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName));

  return { sectionId, subject, examCount: exams.length, students };
}

async function loadStudentNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const students = (await Student.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
    .select("name nameBn")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string }>;
  return new Map(students.map((s) => [s._id.toString(), s.nameBn || s.name]));
}

// ---------------------------------------------------------------------------
// 4. Student Profile — one student across subjects
// ---------------------------------------------------------------------------

export interface StudentProfileResult {
  testId: string;
  ctId: string;
  subject: string;
  testNumber: number;
  examDate: string;
  status: string;
  marks: number | null;
  totalMarks: number;
  percent: number | null;
  pass: boolean | null;
  /** CT-7: the teacher's per-test comments, so the profile is a comment history. */
  weakness: string | null;
  teacherAction: string | null;
  guardianAction: string | null;
}

export interface StudentProfileSubjectRow {
  subject: string;
  examsTaken: number;
  /** Mean of PRESENT percents (null when no PRESENT result). */
  avgPercent: number | null;
  latestPercent: number | null;
  previousPercent: number | null;
  trend: Trend;
}

/** CT-10: derived, never-stored per-student analytics (identity plane; NO corpus). */
export interface WeaknessTally {
  tag: string;
  count: number;
}
export interface StudentProfileAnalytics {
  examsPresent: number;
  avgPercent: number | null;
  /** Std dev of PRESENT percents — lower = steadier. */
  consistency: number | null;
  /** Regression slope of percent vs exam index (>0 improving, <0 declining). */
  slope: number | null;
  /** "up" | "steady" | "down" | "na" from the slope. */
  trajectory: string;
  /** Declining slope AND the most recent PRESENT result is a fail. */
  atRisk: boolean;
  /** Current run from the newest PRESENT results: "pass" | "fail" | null. */
  streakKind: string | null;
  streakLength: number;
  bestSubject: string | null;
  weakestSubject: string | null;
  /** Weakness notes seen ≥ 2 times (normalized), most frequent first. */
  recurringWeaknesses: WeaknessTally[];
  /** Rank in the most recent PRESENT exam (by marks) among present students. */
  latestRank: number | null;
  latestRankOf: number | null;
}

export interface StudentProfile {
  studentId: string;
  studentName: string;
  results: StudentProfileResult[];
  bySubject: StudentProfileSubjectRow[];
  analytics: StudentProfileAnalytics;
}

/** One student across every subject — per-result list (newest first) + a per-subject
 *  roll-up (avg/latest/previous/trend over PRESENT results). */
const EMPTY_ANALYTICS: StudentProfileAnalytics = {
  examsPresent: 0, avgPercent: null, consistency: null, slope: null, trajectory: "na",
  atRisk: false, streakKind: null, streakLength: 0, bestSubject: null, weakestSubject: null,
  recurringWeaknesses: [], latestRank: null, latestRankOf: null,
};

/** Least-squares slope of ys against their index (0..n-1); null when < 2 points.
 *  Exported so the cross-tracker whole-picture reuses ONE trajectory primitive. */
export function regressionSlope(ys: number[]): number | null {
  const n = ys.length;
  if (n < 2) return null;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (ys[i] - my);
    den += (i - mx) ** 2;
  }
  return den === 0 ? 0 : Math.round((num / den) * 100) / 100;
}

/**
 * One student across every subject — per-result list (newest first) + a per-subject
 * roll-up + the CT-10 analytics.
 *
 * `subjects` (SP-2, D-#357): when given, the profile is narrowed to those subject
 * codes BEFORE anything is derived, so a subject teacher's averages, streak, best/
 * weakest subject and rank all describe the slice they may see — never a number
 * computed from exams hidden from them. `null`/omitted = every subject (the
 * behaviour every existing caller keeps).
 */
export async function studentProfile(
  studentId: string,
  subjects?: readonly string[] | null,
): Promise<StudentProfile> {
  const studentOid = new Types.ObjectId(studentId);
  const allDocs = (await ClassTestResult.find({ studentId: studentOid }).lean()) as unknown as IClassTestResult[];
  const names = await loadStudentNames([studentId]);
  const studentName = names.get(studentId) ?? "শিক্ষার্থী";
  const empty: StudentProfile = { studentId, studentName, results: [], bySubject: [], analytics: EMPTY_ANALYTICS };
  if (allDocs.length === 0) return empty;
  // An empty allow-list is a real answer ("teaches nothing here"), not "unrestricted".
  if (subjects && subjects.length === 0) return empty;

  const testIds = [...new Set(allDocs.map((d) => d.testId.toString()))].map((id) => new Types.ObjectId(id));
  const examQ: Record<string, unknown> = { _id: { $in: testIds }, status: "PRINTED" };
  if (subjects) examQ.subject = { $in: [...subjects] };
  const exams = (await ClassTest.find(examQ).lean()) as unknown as IClassTest[];
  const examById = new Map(exams.map((e) => [e._id.toString(), e]));
  // Drop out-of-scope results HERE so every downstream derivation (weakness tally,
  // rank, streak) sees only the permitted slice.
  const docs = allDocs.filter((d) => examById.has(d.testId.toString()));
  if (docs.length === 0) return empty;

  const results: StudentProfileResult[] = [];
  for (const d of docs) {
    const exam = examById.get(d.testId.toString());
    if (!exam) continue; // not a PRINTED exam → not in the profile
    const score = deriveScore({ status: d.status, marks: d.marks ?? null, totalMarks: exam.totalMarks, passMark: exam.passMark });
    results.push({
      testId: d.testId.toString(),
      ctId: exam.ctId,
      subject: exam.subject,
      testNumber: exam.testNumber,
      examDate: new Date(exam.examDate).toISOString(),
      status: score.status,
      marks: score.marks,
      totalMarks: score.totalMarks,
      percent: score.percent,
      pass: score.pass,
      weakness: d.weakness ?? null,
      teacherAction: d.teacherAction ?? null,
      guardianAction: d.guardianAction ?? null,
    });
  }
  results.sort((a, b) => new Date(b.examDate).getTime() - new Date(a.examDate).getTime());

  // Per-subject roll-up over PRESENT percents, ordered oldest → newest.
  const bySubjectMap = new Map<string, number[]>(); // subject → percents (oldest first)
  const oldestFirst = [...results].sort((a, b) => new Date(a.examDate).getTime() - new Date(b.examDate).getTime());
  for (const r of oldestFirst) {
    if (r.percent === null) continue;
    const list = bySubjectMap.get(r.subject) ?? [];
    list.push(r.percent);
    bySubjectMap.set(r.subject, list);
  }
  const bySubject: StudentProfileSubjectRow[] = [...bySubjectMap.entries()]
    .map(([subject, percents]) => {
      const latestPercent = percents.length > 0 ? percents[percents.length - 1] : null;
      const previousPercent = percents.length > 1 ? percents[percents.length - 2] : null;
      const avgPercent =
        percents.length === 0 ? null : Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10;
      return { subject, examsTaken: percents.length, avgPercent, latestPercent, previousPercent, trend: trendOf(latestPercent, previousPercent) };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject));

  // ---- CT-10 analytics (all DERIVED, never stored — D-#85; identity-plane) ----
  const presentOldest = [...results]
    .filter((r) => r.status === "PRESENT" && r.percent !== null)
    .sort((a, b) => new Date(a.examDate).getTime() - new Date(b.examDate).getTime());
  const percents = presentOldest.map((r) => r.percent as number);
  const avgPercent = percents.length ? Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10 : null;
  const consistency =
    percents.length > 1
      ? Math.round(Math.sqrt(percents.reduce((s, p) => s + (p - (avgPercent as number)) ** 2, 0) / percents.length) * 10) / 10
      : percents.length === 1 ? 0 : null;
  const slope = regressionSlope(percents);
  const trajectory = slope === null ? "na" : slope > 2 ? "up" : slope < -2 ? "down" : "steady";
  const newestPresent = presentOldest.length ? presentOldest[presentOldest.length - 1] : null;
  const atRisk = slope !== null && slope < 0 && newestPresent?.pass === false;

  // Pass/fail streak from the newest PRESENT results backward.
  let streakKind: string | null = null;
  let streakLength = 0;
  for (let i = presentOldest.length - 1; i >= 0; i--) {
    const kind = presentOldest[i].pass ? "pass" : "fail";
    if (streakKind === null) { streakKind = kind; streakLength = 1; }
    else if (kind === streakKind) streakLength++;
    else break;
  }

  const rankedSubjects = bySubject.filter((s) => s.avgPercent !== null).sort((a, b) => (b.avgPercent as number) - (a.avgPercent as number));
  const bestSubject = rankedSubjects.length ? rankedSubjects[0].subject : null;
  const weakestSubject = rankedSubjects.length ? rankedSubjects[rankedSubjects.length - 1].subject : null;

  // Recurring weakness notes (case-insensitive tally, keep first original spelling).
  const wm = new Map<string, WeaknessTally>();
  for (const d of docs) {
    const orig = (d.weakness ?? "").trim();
    if (!orig) continue;
    const key = orig.toLowerCase();
    const e = wm.get(key) ?? { tag: orig, count: 0 };
    e.count++;
    wm.set(key, e);
  }
  const recurringWeaknesses = [...wm.values()].filter((e) => e.count >= 2).sort((a, b) => b.count - a.count);

  // Rank in the most recent PRESENT exam, by marks, among present students (one query).
  let latestRank: number | null = null;
  let latestRankOf: number | null = null;
  if (newestPresent) {
    const cohort = (await ClassTestResult.find({ testId: new Types.ObjectId(newestPresent.testId), status: "PRESENT" })
      .select("marks")
      .lean()) as unknown as Array<{ marks?: number }>;
    const myMarks = newestPresent.marks ?? 0;
    latestRankOf = cohort.length;
    latestRank = 1 + cohort.filter((c) => (c.marks ?? 0) > myMarks).length;
  }

  const analytics: StudentProfileAnalytics = {
    examsPresent: percents.length, avgPercent, consistency, slope, trajectory,
    atRisk: !!atRisk, streakKind, streakLength, bestSubject, weakestSubject,
    recurringWeaknesses, latestRank, latestRankOf,
  };

  return { studentId, studentName, results, bySubject, analytics };
}

// ---------------------------------------------------------------------------
// 5. Office overdue-chase list (J6, AS-T4 posture) — wa.me nudge to the teacher
// ---------------------------------------------------------------------------

function waLinkFor(phone: string | undefined | null, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Apply the effective template's langMode to interpolated params (mirrors
 *  renderTemplate, but lets the caller resolve the template ONCE per batch). */
function renderFromEffective(eff: EffectiveTemplate, params: Record<string, unknown>): string {
  const bn = interpolate(eff.bnBody, params);
  const en = eff.enBody ? interpolate(eff.enBody, params) : "";
  switch (eff.langMode) {
    case "EN":
      return en;
    case "BOTH":
      return en ? `${bn}\n\n${en}` : bn;
    default:
      return bn;
  }
}

export interface OverdueChaseExam {
  testId: string;
  ctId: string;
  subject: string;
  testNumber: number;
  examDate: string;
  schoolDaysLate: number;
  pendingCount: number;
}

export interface OverdueChaseEntry {
  teacherId: string;
  teacherName: string;
  /** True when the teacher has no phone on file → the wa.me link is null. */
  unreachableByWa: boolean;
  overdueCount: number;
  exams: OverdueChaseExam[];
  messageBn: string;
  waLink: string | null;
}

export interface OverdueChaseList {
  entries: OverdueChaseEntry[];
  /** Teachers with overdue reports but no phone (wa.me unreachable). */
  unreachableCount: number;
}

/**
 * The Office chase list (J6): every teacher with ≥1 overdue class-test report, a
 * rendered Bangla wa.me nudge naming their overdue exams (ADR-003 — manual send).
 * N+1 guard: the chase template is resolved ONCE (getEffectiveTemplate) and
 * interpolated per teacher; renderTemplate/getEffectiveTemplate is never called in a
 * loop. The Office acts on this — the teacher never chases themselves (resolver-gated).
 *
 * D-#603: filters on `teacherOverdue`, NOT `state === "overdue"`. Since the chip now
 * stays red until publish, `state` also covers exams the teacher has already
 * submitted and that are sitting in OUR approval queue — nudging them for those
 * would chase the wrong person for work they cannot do.
 */
export async function overdueChaseList(filter: SummaryFilter): Promise<OverdueChaseList> {
  const rows = await reportsStatus(filter);
  const overdueRows = rows.filter((r) => r.teacherOverdue);

  // Group overdue exams by the report author (teacher).
  const byTeacher = new Map<string, ReportStatusRow[]>();
  for (const r of overdueRows) {
    const list = byTeacher.get(r.teacherId) ?? [];
    list.push(r);
    byTeacher.set(r.teacherId, list);
  }

  const teacherIds = [...byTeacher.keys()];
  const teachers = (await User.find({ _id: { $in: teacherIds.map((id) => new Types.ObjectId(id)) } })
    .select("name phone")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; phone?: string }>;
  const teacherById = new Map(teachers.map((u) => [u._id.toString(), u]));

  // N+1 guard: resolve the chase template ONCE, interpolate per teacher.
  const eff = await getEffectiveTemplate("class_test.overdue_chase.wa");

  // Section names for the exam lines (D-#373). Subject + test number alone were NOT
  // unique — two sections sitting "ইংরেজি টেস্ট ১" on the same date rendered as the SAME
  // string twice, so the teacher could not tell which two exams were meant. ONE batched
  // query (the N+1 guard above applies here too), not a lookup per exam.
  const sectionIds = [...new Set(overdueRows.map((r) => r.sectionId))].filter(
    (id): id is string => !!id,
  );
  const sections =
    sectionIds.length === 0
      ? [] // nothing overdue → don't round-trip for section names at all
      : ((await Section.find({ _id: { $in: sectionIds.map((id) => new Types.ObjectId(id)) } })
          .select("nameBn code")
          .lean()) as unknown as Array<{ _id: Types.ObjectId; nameBn?: string; code?: string }>);
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s.nameBn || s.code || ""]));

  // D-#507: a group-anchored exam has no class+section to name, so the chase line
  // names the GROUP instead ("আরবি বই ২ (মেয়ে)"). Batched like the sections above.
  const chaseGroupIds = [...new Set(overdueRows.map((r) => r.subjectGroupId))].filter(
    (id): id is string => !!id,
  );
  const chaseGroups =
    chaseGroupIds.length === 0
      ? []
      : ((await SubjectGroup.find({ _id: { $in: chaseGroupIds.map((id) => new Types.ObjectId(id)) } })
          .select("nameBn code")
          .lean()) as unknown as Array<{ _id: Types.ObjectId; nameBn?: string; code?: string }>);
  const groupById = new Map(chaseGroups.map((g) => [g._id.toString(), g.nameBn || g.code || ""]));

  const entries: OverdueChaseEntry[] = [];
  let unreachableCount = 0;
  for (const teacherId of teacherIds) {
    const teacher = teacherById.get(teacherId);
    const teacherName = teacher?.name ?? "শিক্ষক";
    const examRows = byTeacher.get(teacherId)!;
    const exams: OverdueChaseExam[] = examRows.map((r) => ({
      testId: r.testId,
      ctId: r.ctId,
      subject: r.subject,
      testNumber: r.testNumber,
      examDate: r.examDate,
      schoolDaysLate: r.schoolDaysLate,
      pendingCount: r.pendingCount,
    }));
    // One NUMBERED LINE per exam (D-#373). The old form was a comma-joined
    // "subject টেস্ট n (dd/mm)", which for two same-subject same-date exams in
    // different sections produced the identical string twice and named neither. Each
    // line now carries what the teacher needs to act: which class+section, which
    // subject/test, when it sat, HOW MANY students are still missing, how late it is,
    // and the CT id to search for. Bangla numerals throughout — a Bangla sentence with
    // ASCII digits reads half-translated.
    const examList = examRows
      .map((r, i) => {
        const section = r.sectionId ? sectionById.get(r.sectionId) : null;
        const group = r.subjectGroupId ? groupById.get(r.subjectGroupId) : null;
        const where =
          section && r.classLevel != null
            ? `${classBn(r.classLevel)} (${section})`
            : group ?? (r.classLevel != null ? classBn(r.classLevel) : subjectBn(r.subject));
        const pending = `${bnNum(r.pendingCount)}/${bnNum(r.rosterCount)} জনের ফলাফল বাকি`;
        const late = r.schoolDaysLate > 0 ? ` · ${bnNum(r.schoolDaysLate)} কর্মদিবস দেরি` : "";
        return (
          `${bnNum(i + 1)}) ${where} · ${subjectBn(r.subject)} · টেস্ট ${bnNum(r.testNumber)} · ` +
          `পরীক্ষা ${bnNum(ddmm(new Date(r.examDate)))} — ${pending}${late} [${r.ctId}]`
        );
      })
      .join("\n");
    const messageBn = renderFromEffective(eff, {
      TeacherName: teacherName,
      Count: bnNum(examRows.length),
      ExamList: examList,
    });
    const waLink = waLinkFor(teacher?.phone, messageBn);
    if (!waLink) unreachableCount++;
    entries.push({
      teacherId,
      teacherName,
      unreachableByWa: !waLink,
      overdueCount: examRows.length,
      exams,
      messageBn,
      waLink,
    });
  }
  entries.sort((a, b) => b.overdueCount - a.overdueCount);

  return { entries, unreachableCount };
}
