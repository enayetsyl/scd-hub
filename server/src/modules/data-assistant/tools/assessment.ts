/**
 * class_test_status, class_test_marks, exam_results, mastery_overview, question_bank_stats,
 * monthly_report_status (docs/prd-data-assistant-mcp.md §7 tools 10–13, 23, 24).
 */
import { Types } from "mongoose";
import { z } from "zod";
import { callerHasPermission, QUESTION_TYPES, REVIEW_STATUSES } from "@scd/shared";
import { Student } from "../../foundation/models/Student";
import { assertChaseAdmin, assertDashboardAdmin, assertReportRead, CLASS_TEST_REPORT_GATE, filterFromArgs } from "../../trackers/resolvers/classTestSummary";
import { assertReadTest } from "../../trackers/resolvers/classTestResult";
import { classSubjectAnalysis, overdueChaseList, principalDashboard, reportsStatus } from "../../trackers/services/ClassTestSummaryService";
import { getClassTest } from "../../trackers/services/ClassTestService";
import { testResults } from "../../trackers/services/ClassTestResultService";
import { assertExamReader } from "../../exams/resolvers/examReportCard";
import { buildClassReportCards } from "../../exams/services/ReportCardService";
import { schoolRollup } from "../../mastery/services/MasteryRollupService";
import { countQuestionsByFilter } from "../../questions/resolvers/questions";
import { bankCoverage } from "../../mastery/services/MasteryBankCoverageService";
import { questionCoverage } from "../../questions/services/QuestionReviewService";
import { requireMonthly } from "../../reports/services/monthlyReportGate";
import { monthlyClassRollups } from "../../reports/services/MonthlyReportService";
import { monthlyPendingWork } from "../../reports/services/MonthlyPendingWorkService";
import { assertRule, gateOf } from "../gates";
import { ToolInvalid, type ToolDef } from "../types";
import { cap, checkRange, CLASS_LEVEL, DATE_KEY, MONTH_KEY, OBJECT_ID, sectionLabels, SUBJECT } from "./common";

const errToInvalid = async <T>(p: Promise<T>): Promise<T> => {
  try {
    return await p;
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "ForbiddenError" || name === "ToolDenied") throw e;
    throw new ToolInvalid((e as Error)?.message || "invalid");
  }
};

// ---------------------------------------------------------------------------
// 10 class_test_status
// ---------------------------------------------------------------------------

const CT_DASHBOARD = { anyOf: ["class_test:view_all"] } as const;
const CT_REPORTS = { anyOf: ["class_test:view", "class_test:view_all", "reports:class_test", "reports:class_test_dashboard"] } as const;
const CT_OVERDUE = { anyOf: ["class_test:remind"] } as const;

export const classTestStatus: ToolDef = {
  name: "class_test_status",
  label_bn: "ক্লাস টেস্টের অবস্থা",
  label_en: "Class-test status",
  description:
    "Class-test progress (ক্লাস টেস্ট, নম্বর তোলা, প্রকাশ, দেরি). mode dashboard: school totals and overdue per teacher; mode reports: each test's " +
    "entered / submitted / published state (section_id needed unless you hold the class-test report); mode overdue: teachers with late results. " +
    "from/to filter exam dates (≤ 366 days).",
  input: {
    mode: z.enum(["dashboard", "reports", "overdue"]),
    class_level: CLASS_LEVEL.optional(),
    section_id: OBJECT_ID.optional(),
    subject: SUBJECT.optional(),
    from: DATE_KEY.optional(),
    to: DATE_KEY.optional(),
  },
  gates: [
    { mode: "dashboard", rule: CT_DASHBOARD, resolver: { file: "modules/trackers/resolvers/classTestSummary.ts", field: "classTestPrincipalDashboard" } },
    { mode: "reports", rule: CT_REPORTS, resolver: { file: "modules/trackers/resolvers/classTestSummary.ts", field: "classTestReportsStatus" } },
    { mode: "overdue", rule: CT_OVERDUE, resolver: { file: "modules/trackers/resolvers/classTestSummary.ts", field: "classTestOverdueChase" } },
  ],
  maxRows: 100,
  async run(ctx, a) {
    const args = a as { mode: "dashboard" | "reports" | "overdue"; class_level?: number; section_id?: string; subject?: string; from?: string; to?: string };
    assertRule(ctx.auth, gateOf(classTestStatus, args.mode));
    if (args.from && args.to) checkRange(args.from, args.to, 366);
    const filter = filterFromArgs({ classLevel: args.class_level, sectionId: args.section_id, subject: args.subject, examFrom: args.from, examTo: args.to });
    if (args.mode === "dashboard") {
      assertDashboardAdmin(ctx.app);
      const d = await principalDashboard(filter);
      return {
        data: {
          logged: d.logged,
          complete: d.complete,
          in_progress: d.inProgress,
          not_started: d.notStarted,
          overdue: d.overdue,
          awaiting_submit: d.awaitingSubmit,
          awaiting_publish: d.awaitingPublish,
          completion_rate_pct: d.completionRatePct,
          overdue_by_teacher: d.overdueByTeacher.slice(0, 100).map((t) => ({ teacher: t.teacherName, overdue: t.overdueCount })),
        },
        rowCount: d.overdueByTeacher.length,
      };
    }
    if (args.mode === "overdue") {
      assertChaseAdmin(ctx.app);
      const l = await overdueChaseList(filter);
      const c = cap(l.entries, 100);
      // Allow-list: the teacher's wa.me link (a phone) and the prepared message are never returned.
      return {
        data: c.rows.map((e) => ({
          teacher: e.teacherName,
          overdue: e.overdueCount,
          tests: e.exams.map((x) => ({ test_id: x.testId, subject: x.subject, test_number: x.testNumber, exam_date: x.examDate, school_days_late: x.schoolDaysLate, pending: x.pendingCount })),
        })),
        rowCount: c.rows.length,
        truncated: c.truncated,
        total: c.total,
      };
    }
    if (!(callerHasPermission(ctx.auth, "reports:class_test") || callerHasPermission(ctx.auth, "reports:class_test_dashboard"))) {
      await assertReportRead(ctx.app, args.section_id ?? null, { selfTeacherId: null, gate: CLASS_TEST_REPORT_GATE });
    }
    const rows = await reportsStatus(filter, { withScriptStages: true });
    const labels = await sectionLabels(rows.map((r) => r.sectionId ?? ""));
    const c = cap(rows, 100);
    return {
      data: c.rows.map((r) => ({
        test_id: r.testId,
        class_level: r.classLevel,
        section: r.sectionId ? labels.get(r.sectionId)?.section_label_bn ?? null : null,
        subject: r.subject,
        test_number: r.testNumber,
        exam_date: r.examDate,
        teacher: r.teacherName,
        roster: r.rosterCount,
        entered: r.enteredCount,
        absent: r.absentCount,
        pending: r.pendingCount,
        submitted: r.submittedCount,
        published: r.publishedCount,
        state: r.state,
        overdue: r.overdue,
        school_days_late: r.schoolDaysLate,
      })),
      rowCount: c.rows.length,
      truncated: c.truncated,
      total: c.total,
    };
  },
};

// ---------------------------------------------------------------------------
// 11 class_test_marks
// ---------------------------------------------------------------------------

const MARKS_SECTION = { anyOf: ["class_test:view", "class_test:view_all"] } as const;
const MARKS_TEST = { anyOf: ["class_test:view"] } as const;

export const classTestMarks: ToolDef = {
  name: "class_test_marks",
  label_bn: "ক্লাস টেস্টের নম্বর",
  label_en: "Class-test marks",
  description:
    "Class-test marks (নম্বর, ফলাফল, শতকরা). Either section_id + subject: each student's percentages across that subject's tests and the trend; " +
    "or test_id (from class_test_status): every student's marks in that one test with average, highest and lowest.",
  input: { section_id: OBJECT_ID.optional(), subject: SUBJECT.optional(), test_id: OBJECT_ID.optional() },
  gates: [
    { mode: "section", rule: MARKS_SECTION, resolver: { file: "modules/trackers/resolvers/classTestSummary.ts", field: "classTestClassSubjectAnalysis" } },
    { mode: "test", rule: MARKS_TEST, resolver: { file: "modules/trackers/resolvers/classTestResult.ts", field: "classTestResults" } },
  ],
  maxRows: 80,
  async run(ctx, a) {
    const args = a as { section_id?: string; subject?: string; test_id?: string };
    if (args.test_id) {
      assertRule(ctx.auth, MARKS_TEST);
      await assertReadTest(ctx.app, args.test_id);
      const test = await getClassTest(args.test_id);
      const results = await testResults(args.test_id);
      const ids = results.map((r) => r.studentId).filter((id) => Types.ObjectId.isValid(id));
      const students = (await Student.find({ _id: { $in: ids } }).select("name nameBn schoolId").lean()) as Array<{ _id: Types.ObjectId; name: string; nameBn?: string; schoolId: string }>;
      const byId = new Map(students.map((s) => [String(s._id), s]));
      const marks = results.filter((r) => r.marks != null).map((r) => r.marks as number);
      const c = cap(results, 80);
      return {
        data: {
          test_id: args.test_id,
          subject: test?.subject ?? null,
          test_number: test?.testNumber ?? null,
          exam_date: test?.examDate ?? null,
          full_marks: test?.totalMarks ?? null,
          average: marks.length ? Math.round((marks.reduce((s, m) => s + m, 0) / marks.length) * 10) / 10 : null,
          highest: marks.length ? Math.max(...marks) : null,
          lowest: marks.length ? Math.min(...marks) : null,
          results: c.rows.map((r) => ({
            student_id: r.studentId,
            name: byId.get(r.studentId)?.name ?? null,
            name_bn: byId.get(r.studentId)?.nameBn ?? null,
            status: r.status,
            marks: r.marks,
            percent: r.percent,
            pass: r.pass,
          })),
        },
        rowCount: c.rows.length,
        truncated: c.truncated,
        total: c.total,
      };
    }
    if (!args.section_id || !args.subject) throw new ToolInvalid("Give either test_id, or section_id + subject.");
    assertRule(ctx.auth, MARKS_SECTION);
    await assertReportRead(ctx.app, args.section_id, { gate: CLASS_TEST_REPORT_GATE });
    const an = await classSubjectAnalysis(args.section_id, args.subject);
    const c = cap(an.students, 80);
    const latest = an.students.map((s) => s.latestPercent).filter((p): p is number => p != null);
    return {
      data: {
        section_id: an.sectionId,
        subject: an.subject,
        tests: an.examCount,
        class_average_latest_pct: latest.length ? Math.round((latest.reduce((s, p) => s + p, 0) / latest.length) * 10) / 10 : null,
        students: c.rows.map((s) => ({ student_id: s.studentId, name: s.studentName, percents: s.percents, latest_pct: s.latestPercent, previous_pct: s.previousPercent, trend: s.trend, tests_taken: s.examsTaken })),
      },
      rowCount: c.rows.length,
      truncated: c.truncated,
      total: c.total,
    };
  },
};

// ---------------------------------------------------------------------------
// 12 exam_results
// ---------------------------------------------------------------------------

const EXAM_GATE = { anyOf: ["exam_results:view"] } as const;

export const examResults: ToolDef = {
  name: "exam_results",
  label_bn: "পরীক্ষার ফলাফল",
  label_en: "Exam results",
  description:
    "Term exam report cards for one class (পরীক্ষার ফলাফল, জিপিএ, গ্রেড, মোট নম্বর): per student each subject's marks and grade, total and GPA. " +
    "Needs exam_id and class_id; student_id narrows to one child.",
  input: { exam_id: OBJECT_ID, class_id: OBJECT_ID, student_id: OBJECT_ID.optional() },
  gates: [{ mode: "default", rule: EXAM_GATE, resolver: { file: "modules/exams/resolvers/examReportCard.ts", field: "examClassReportCards" } }],
  maxRows: 80,
  async run(ctx, a) {
    const args = a as { exam_id: string; class_id: string; student_id?: string };
    assertRule(ctx.auth, EXAM_GATE);
    assertExamReader(ctx.app);
    const cards = (await errToInvalid(buildClassReportCards(args.exam_id, args.class_id))).filter((c) => !args.student_id || c.student.id === args.student_id);
    const c = cap(cards, 80);
    return {
      data: c.rows.map((r) => ({
        exam: r.examName,
        student_id: r.student.id,
        school_id: r.student.schoolId,
        name: r.student.name,
        subjects: r.rows.map((x) => ({ subject: x.subject, marks: x.obtained, full_marks: x.fullMarks, percent: x.percent, grade: x.letter, point: x.point })),
        total: r.totals.totalObtained,
        full_marks: r.totals.totalFullMarks,
        gpa: r.totals.gpa,
        grade: r.totals.letter,
        failed_subjects: r.totals.failedSubjects,
        published: !!r.publishedAt,
      })),
      rowCount: c.rows.length,
      truncated: c.truncated,
      total: c.total,
    };
  },
};

// ---------------------------------------------------------------------------
// 13 mastery_overview
// ---------------------------------------------------------------------------

const MASTERY_GATE = { allOf: ["mastery:view", "mastery:approve"] } as const;

export const masteryOverview: ToolDef = {
  name: "mastery_overview",
  label_bn: "দক্ষতা (মাস্টারি)",
  label_en: "Mastery",
  description:
    "The whole school's learning-outcome mastery for one subject (দক্ষতা, মাস্টারি, দুর্বল উদ্দেশ্য): per class and domain the share mastered and weak, " +
    "and up to 40 objectives per class. Counts only — no student names.",
  input: { subject: SUBJECT.optional() },
  gates: [{ mode: "default", rule: MASTERY_GATE, resolver: { file: "modules/mastery/resolvers/masteryDiagnosis.ts", field: "masterySchoolRollup" }, alsoChecked: ["mastery:approve"], note: "mastery:approve is checked inside schoolRollup." }],
  maxRows: 40,
  async run(ctx, a) {
    const args = a as { subject?: string };
    assertRule(ctx.auth, MASTERY_GATE);
    const r = await errToInvalid(schoolRollup(args.subject ?? null, ctx.auth));
    const sum = (s: { total: number; assessed: number; weak: number; mastered: number; masteredPct: number | null; weakPct: number | null }) => ({ total: s.total, assessed: s.assessed, mastered: s.mastered, weak: s.weak, mastered_pct: s.masteredPct, weak_pct: s.weakPct });
    return {
      data: {
        subject: r.subject,
        subjects: r.subjects,
        classes: r.classes.map((c) => ({
          class: c.classToken,
          sections: c.sections,
          students: c.students,
          domains: c.domains.map((d) => ({ code: d.code, label_bn: d.labelBn, ...sum(d.summary) })),
          objectives: c.objectives.slice(0, 40).map((o) => ({ code: o.code, label_bn: o.labelBn, chapter: o.chapterNumber, ...sum(o.summary) })),
        })),
      },
      rowCount: r.classes.length,
      truncated: r.classes.some((c) => c.objectives.length > 40),
    };
  },
};

// ---------------------------------------------------------------------------
// 23 question_bank_stats
// ---------------------------------------------------------------------------

const QB_COUNTS = { anyOf: ["question_bank:view"] } as const;
const QB_COVERAGE = { anyOf: ["reports:bank_coverage", "mastery:settings", "mastery:review"] } as const;
const QB_REVIEW = { anyOf: ["question_review:view_all", "reports:review_progress"] } as const;

export const questionBankStats: ToolDef = {
  name: "question_bank_stats",
  label_bn: "প্রশ্নব্যাংক",
  label_en: "Question bank",
  description:
    "Question-bank numbers (প্রশ্নব্যাংক, কতগুলো প্রশ্ন, যাচাই, কভারেজ). by total | type | review_status: question counts (within the subjects you may see); " +
    "by coverage: objective coverage for a class token (e.g. C3) + subject; by review_progress: in bank / assigned / reviewed / published.",
  input: {
    by: z.enum(["total", "type", "review_status", "coverage", "review_progress"]),
    class_level: CLASS_LEVEL.optional(),
    class_token: z.string().regex(/^(N|K|C[1-6])$/).optional(),
    subject: SUBJECT.optional(),
    chapter: z.number().int().min(0).max(60).optional(),
  },
  gates: [
    { mode: "counts", rule: QB_COUNTS, resolver: { file: "modules/questions/resolvers/questions.ts", field: "questionsCount" } },
    { mode: "coverage", rule: QB_COVERAGE, resolver: { file: "modules/mastery/resolvers/masteryBankCoverage.ts", field: "masteryBankCoverage" } },
    { mode: "review_progress", rule: QB_REVIEW, resolver: { file: "modules/questions/resolvers/questionReview.ts", field: "questionCoverage" } },
  ],
  maxRows: 200,
  async run(ctx, a) {
    const args = a as { by: "total" | "type" | "review_status" | "coverage" | "review_progress"; class_level?: number; class_token?: string; subject?: string; chapter?: number };
    if (args.by === "coverage") {
      assertRule(ctx.auth, QB_COVERAGE);
      const v = await bankCoverage(args.class_token ?? null, args.subject ?? null);
      const rows = cap(v.rows, 200);
      return {
        data: {
          class: v.classToken,
          subject: v.subject,
          totals: { rows: v.totals.rows, rows_with_no_question: v.totals.zeroRows, gold: v.totals.gold, held: v.totals.held },
          rows: rows.rows.map((r) => ({ code: r.code, label_bn: r.labelBn, chapter: r.chapterNumber, status: r.status, gold: r.goldCount, held: r.heldCount, pending: r.pendingCount })),
        },
        rowCount: rows.rows.length,
        truncated: rows.truncated,
        total: rows.total,
      };
    }
    if (args.by === "review_progress") {
      assertRule(ctx.auth, QB_REVIEW);
      const q = await questionCoverage({ subject: args.subject ?? null, classLevel: args.class_level ?? null, chapter: args.chapter ?? null });
      return { data: { in_bank: q.inBank, assigned: q.assigned, not_assigned: q.notAssigned, reviewed: q.reviewed, published: q.published }, rowCount: 1 };
    }
    assertRule(ctx.auth, QB_COUNTS);
    // countQuestionsByFilter applies the screen's publish gate and content scope itself.
    const base = { subject: args.subject ?? null, classLevel: args.class_level ?? null, chapters: args.chapter != null ? [args.chapter] : null };
    if (args.by === "total") return { data: { questions: await countQuestionsByFilter(base, ctx.app) }, rowCount: 1 };
    const values: readonly string[] = args.by === "type" ? QUESTION_TYPES : REVIEW_STATUSES;
    const out: Array<{ value: string; questions: number }> = [];
    for (const v of values) out.push({ value: v, questions: await countQuestionsByFilter(args.by === "type" ? { ...base, questionType: v } : { ...base, reviewStatus: v }, ctx.app) });
    return { data: { by: args.by, counts: out }, rowCount: out.length };
  },
};

// ---------------------------------------------------------------------------
// 24 monthly_report_status
// ---------------------------------------------------------------------------

const MONTHLY_GATE = { anyOf: ["monthly_report:view_all"] } as const;

export const monthlyReportStatus: ToolDef = {
  name: "monthly_report_status",
  label_bn: "মাসিক রিপোর্ট",
  label_en: "Monthly report",
  description:
    "The monthly student report for a month (মাসিক রিপোর্ট, প্রকাশ, বাকি মন্তব্য): per section how many reports are ready, released or awaiting review, " +
    "the averages, and the teachers' pending work. month is YYYY-MM.",
  input: { month: MONTH_KEY },
  gates: [{ mode: "default", rule: MONTHLY_GATE, resolver: { file: "modules/reports/resolvers/monthlyReport.ts", field: "monthlyClassRollups" } }],
  maxRows: 100,
  async run(ctx, a) {
    const args = a as { month: string };
    assertRule(ctx.auth, MONTHLY_GATE);
    requireMonthly(ctx.app, "monthly_report:view_all");
    const rollups = await errToInvalid(monthlyClassRollups(args.month));
    const pending = await errToInvalid(monthlyPendingWork(args.month));
    const labels = await sectionLabels(rollups.map((r) => r.sectionId));
    const c = cap(rollups, 100);
    return {
      data: {
        month: args.month,
        sections: c.rows.map((r) => ({
          ...(labels.get(r.sectionId) ?? { section_id: r.sectionId }),
          students: r.students,
          released: r.released,
          awaiting_review: r.awaitingReview,
          provisional: r.provisional,
          avg_attendance_pct: r.avgAttendancePct,
          avg_homework_submission_pct: r.avgHomeworkSubmissionPct,
          avg_class_test_pct: r.avgClassTestPct,
          attendance_declining: r.attendanceDeclining,
        })),
        pending_work: {
          totals: pending.totals,
          by_teacher: pending.byTeacher.slice(0, 50).map((t) => ({ teacher: t.key, items: t.items, to_check: t.toCheck, awaiting: t.awaiting, not_submitted: t.notSubmitted })),
        },
      },
      rowCount: c.rows.length,
      truncated: c.truncated,
      total: c.total,
    };
  },
};

