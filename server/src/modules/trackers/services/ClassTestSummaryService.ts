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
import { HW_SUBJECT_LABELS_BN } from "@scd/shared";
import { ClassTest, type IClassTest } from "../models/ClassTest";
import { ClassTestResult, type IClassTestResult } from "../models/ClassTestResult";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { deriveScore } from "../classTestScoring";
import { examReportStatus, type ExamReportStatus } from "./ClassTestResultService";
import { getEffectiveTemplate, interpolate, type EffectiveTemplate } from "../../templates/services/MessageTemplateService";

// ---------------------------------------------------------------------------
// Scope filter → the PRINTED-exam query (an official exam is the unit of reporting)
// ---------------------------------------------------------------------------

export interface SummaryFilter {
  academicYearId?: string;
  classLevel?: number;
  sectionId?: string;
  subject?: string;
  /** The report author (ClassTest.requestedBy) — restricts to one teacher. */
  teacherId?: string;
  asOf?: Date;
}

function examQuery(filter: SummaryFilter): Record<string, unknown> {
  const q: Record<string, unknown> = { status: "PRINTED" };
  if (filter.academicYearId) q.academicYearId = new Types.ObjectId(filter.academicYearId);
  if (typeof filter.classLevel === "number") q.classLevel = filter.classLevel;
  if (filter.sectionId) q.sectionId = new Types.ObjectId(filter.sectionId);
  if (filter.subject) q.subject = filter.subject;
  if (filter.teacherId) q.requestedBy = new Types.ObjectId(filter.teacherId);
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

// ---------------------------------------------------------------------------
// Report state (pure) — the 4-way partition the dashboard KPIs bucket on
// ---------------------------------------------------------------------------

export type ReportState = "not_started" | "in_progress" | "complete" | "overdue";

/** Mutually-exclusive bucket (priority: complete > overdue > in_progress > not_started).
 *  `overdue` already means incomplete-AND-past-deadline (examReportStatus, D-#120). */
export function reportStateOf(s: { complete: boolean; overdue: boolean; enteredCount: number }): ReportState {
  if (s.complete) return "complete";
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
  classLevel: number;
  sectionId: string;
  teacherId: string;
  state: ReportState;
}

export async function reportsStatus(filter: SummaryFilter): Promise<ReportStatusRow[]> {
  const now = filter.asOf ?? new Date();
  const exams = await loadPrintedExams(filter);
  const rows: ReportStatusRow[] = [];
  for (const exam of exams) {
    const status = await examReportStatus(exam._id.toString(), now);
    rows.push({
      ...status,
      subject: exam.subject,
      testNumber: exam.testNumber,
      classLevel: exam.classLevel,
      sectionId: exam.sectionId.toString(),
      teacherId: exam.requestedBy.toString(),
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
  complete: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
  /** complete / logged, 0–100 (null when nothing is logged). */
  completionRatePct: number | null;
  overdueByTeacher: OverdueByTeacherRow[];
}

export async function principalDashboard(filter: SummaryFilter): Promise<PrincipalDashboard> {
  const rows = await reportsStatus(filter);
  const logged = rows.length;
  let complete = 0;
  let inProgress = 0;
  let notStarted = 0;
  let overdue = 0;
  const overdueByTeacherId = new Map<string, number>();
  for (const r of rows) {
    if (r.state === "complete") complete++;
    else if (r.state === "overdue") {
      overdue++;
      overdueByTeacherId.set(r.teacherId, (overdueByTeacherId.get(r.teacherId) ?? 0) + 1);
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
    completionRatePct: logged === 0 ? null : Math.round((complete / logged) * 100),
    overdueByTeacher,
  };
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

export interface StudentProfile {
  studentId: string;
  studentName: string;
  results: StudentProfileResult[];
  bySubject: StudentProfileSubjectRow[];
}

/** One student across every subject — per-result list (newest first) + a per-subject
 *  roll-up (avg/latest/previous/trend over PRESENT results). */
export async function studentProfile(studentId: string): Promise<StudentProfile> {
  const studentOid = new Types.ObjectId(studentId);
  const docs = (await ClassTestResult.find({ studentId: studentOid }).lean()) as unknown as IClassTestResult[];
  const names = await loadStudentNames([studentId]);
  const studentName = names.get(studentId) ?? "শিক্ষার্থী";
  if (docs.length === 0) return { studentId, studentName, results: [], bySubject: [] };

  const testIds = [...new Set(docs.map((d) => d.testId.toString()))].map((id) => new Types.ObjectId(id));
  const exams = (await ClassTest.find({ _id: { $in: testIds }, status: "PRINTED" })
    .lean()) as unknown as IClassTest[];
  const examById = new Map(exams.map((e) => [e._id.toString(), e]));

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

  return { studentId, studentName, results, bySubject };
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
 */
export async function overdueChaseList(filter: SummaryFilter): Promise<OverdueChaseList> {
  const rows = await reportsStatus(filter);
  const overdueRows = rows.filter((r) => r.state === "overdue");

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
    const examList = examRows
      .map((r) => `${subjectBn(r.subject)} টেস্ট ${r.testNumber} (${ddmm(new Date(r.examDate))})`)
      .join(", ");
    const messageBn = renderFromEffective(eff, {
      TeacherName: teacherName,
      Count: examRows.length,
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
