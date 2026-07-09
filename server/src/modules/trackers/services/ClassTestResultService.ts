/**
 * ClassTestResultService (CT-2, prd-tracker-class-test §3.3/§4/§5, D-#121/#158) —
 * per-student class-test results + the DERIVED percent/pass-fail (never stored,
 * D-#85) + the school-day-aware deadline / overdue derivation (D-#50/#120).
 *
 *   enterResult         — upsert ONE result per (student × exam): PRESENT carries
 *                         marks (0 ≤ marks ≤ totalMarks), ABSENT clears them.
 *                         Allowed only on a PRINTED exam, on/after the exam date
 *                         (J3). Freely re-callable to edit; NO retake (D-#121).
 *   studentResult       — derived score for one student (percent/pass, ABSENT null).
 *   testResults         — derived results for every entered student on an exam.
 *   examReportStatus    — per-exam completion read (entered/present/absent/pending
 *                         over the active roster) + deadline + overdue (CT-4 owns the
 *                         cross-exam Reports-Status / dashboard aggregates).
 *
 * Write-scope (teacher `tracker:write` + `assertCanWrite` on the section) is enforced
 * by the RESOLVER — this service trusts the actor. Publish/guardian delivery is CT-3
 * (this slice never sets publishedAt/publishedVersion beyond the default).
 *
 * Identity-plane (names studentIds); NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { CLASS_TEST_ATTENDANCE_STATUSES } from "@scd/shared";
import type { ClassTestAttendanceStatus } from "@scd/shared";
import { ClassTest, type IClassTest } from "../models/ClassTest";
import { ClassTestResult, type IClassTestResult } from "../models/ClassTestResult";
import { Student } from "../../foundation/models/Student";
import { writeAudit } from "../../platform/services/AuditService";
import { deriveScore, type DerivedScore } from "../classTestScoring";
import { resolveClassTestDeadline, resolveClassTestOverdue, atMidnight } from "../classTestCalendar";

/** A surfaced service error (Bangla-friendly message), mirroring the tracker pattern. */
export class ClassTestResultError extends Error {}

// ---------------------------------------------------------------------------
// enterResult (teacher records / edits one student's result — J3)
// ---------------------------------------------------------------------------

export interface EnterResultInput {
  testId: string;
  studentId: string;
  status: string; // PRESENT | ABSENT
  /** Required + 0 ≤ marks ≤ totalMarks when PRESENT; ignored when ABSENT. */
  marks?: number;
  weakness?: string;
  teacherAction?: string;
  guardianAction?: string;
  actorId: string;
  /** Injectable for tests; defaults to the live clock. The exam-date gate (J3). */
  now?: Date;
}

export interface ClassTestResultShape extends DerivedScore {
  id: string;
  testId: string;
  studentId: string;
  weakness: string | null;
  /** INTERNAL — the resolver/guardian read must NOT expose this to a guardian (J7). */
  teacherAction: string | null;
  guardianAction: string | null;
  /** CT-8 approval state: submittedAt set + publishedAt null = pending approval. */
  submittedAt: string | null;
  sendBackReason: string | null;
  publishedAt: string | null;
  publishedVersion: number;
}

function resultShape(d: IClassTestResult, test: { totalMarks: number; passMark: number }): ClassTestResultShape {
  const score = deriveScore({
    status: d.status,
    marks: d.marks ?? null,
    totalMarks: test.totalMarks,
    passMark: test.passMark,
  });
  return {
    ...score,
    id: d._id.toString(),
    testId: d.testId.toString(),
    studentId: d.studentId.toString(),
    weakness: d.weakness ?? null,
    teacherAction: d.teacherAction ?? null,
    guardianAction: d.guardianAction ?? null,
    submittedAt: d.submittedAt ? new Date(d.submittedAt).toISOString() : null,
    sendBackReason: d.sendBackReason ?? null,
    publishedAt: d.publishedAt ? new Date(d.publishedAt).toISOString() : null,
    publishedVersion: d.publishedVersion,
  };
}

async function loadTest(testId: string): Promise<IClassTest> {
  const test = (await ClassTest.findById(testId).lean()) as IClassTest | null;
  if (!test) throw new ClassTestResultError("Class test not found");
  return test;
}

export async function enterResult(input: EnterResultInput): Promise<ClassTestResultShape> {
  if (!(CLASS_TEST_ATTENDANCE_STATUSES as readonly string[]).includes(input.status)) {
    throw new ClassTestResultError("status must be PRESENT or ABSENT");
  }
  const status = input.status as ClassTestAttendanceStatus;

  const test = await loadTest(input.testId);

  // The record must be the official exam (PRINTED) — a REQUESTED/CANCELLED request
  // has no exam to score yet.
  if (test.status !== "PRINTED") {
    throw new ClassTestResultError("Results can only be entered on a printed (official) exam");
  }

  // On/after the exam date (J3). Date-only comparison (the exam day itself counts).
  const now = input.now ?? new Date();
  if (atMidnight(now).getTime() < atMidnight(new Date(test.examDate)).getTime()) {
    throw new ClassTestResultError("Results can only be entered on or after the exam date");
  }

  // Marks: required + bounded when PRESENT; cleared when ABSENT (§4).
  let marks: number | undefined;
  if (status === "PRESENT") {
    if (input.marks === undefined || input.marks === null) {
      throw new ClassTestResultError("marks are required for a PRESENT student");
    }
    if (typeof input.marks !== "number" || Number.isNaN(input.marks)) {
      throw new ClassTestResultError("marks must be a number");
    }
    if (input.marks < 0 || input.marks > test.totalMarks) {
      throw new ClassTestResultError(`marks must be between 0 and totalMarks (${test.totalMarks})`);
    }
    marks = input.marks;
  } else {
    if (input.marks !== undefined && input.marks !== null) {
      throw new ClassTestResultError("an ABSENT student carries no marks");
    }
    marks = undefined;
  }

  const testOid = new Types.ObjectId(input.testId);
  const studentOid = new Types.ObjectId(input.studentId);

  // A PUBLISHED result is locked (owner ruling): guardians have already been notified,
  // so a silent edit would change what they see with no re-notify/version bump. The
  // teacher must Unpublish first, then edit, then Re-publish. Pre-publish stays open.
  const existing = (await ClassTestResult.findOne({ testId: testOid, studentId: studentOid })
    .select("publishedAt submittedAt")
    .lean()) as { publishedAt?: Date | null; submittedAt?: Date | null } | null;
  if (existing?.publishedAt) {
    throw new ClassTestResultError(
      "This result is published — unpublish it before editing (guardians have already been notified)",
    );
  }
  if (existing?.submittedAt) {
    // CT-8: submitted for approval — recall (teacher) or send-back (office) returns it to
    // draft before it can be edited, so the approvals queue never shows a moving target.
    throw new ClassTestResultError(
      "This result is submitted for approval — recall it (or ask the office to send it back) before editing",
    );
  }

  // Upsert one row per (student × exam). $unset marks on ABSENT so an edit
  // PRESENT→ABSENT does not leave a stale score behind. publishedVersion stays
  // on its existing value (default 0; the CT-3 publish flow owns it).
  const set: Record<string, unknown> = {
    status,
    weakness: input.weakness ?? undefined,
    teacherAction: input.teacherAction ?? undefined,
    guardianAction: input.guardianAction ?? undefined,
    enteredBy: new Types.ObjectId(input.actorId),
  };
  const update: Record<string, unknown> =
    marks === undefined ? { $set: set, $unset: { marks: "" } } : { $set: { ...set, marks } };

  const doc = (await ClassTestResult.findOneAndUpdate(
    { testId: testOid, studentId: studentOid },
    update,
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )) as IClassTestResult;

  await writeAudit({
    eventKind: "CLASS_TEST_RESULT_ENTERED",
    actorId: input.actorId,
    targetId: doc._id,
    targetKind: "ClassTestResult",
    meta: { ctId: test.ctId, testId: input.testId, studentId: input.studentId, status },
  });

  return resultShape(doc, test);
}

// ---------------------------------------------------------------------------
// Derived reads (D-#85 — never stored)
// ---------------------------------------------------------------------------

export async function studentResult(testId: string, studentId: string): Promise<ClassTestResultShape | null> {
  const test = await loadTest(testId);
  const doc = (await ClassTestResult.findOne({
    testId: new Types.ObjectId(testId),
    studentId: new Types.ObjectId(studentId),
  }).lean()) as IClassTestResult | null;
  return doc ? resultShape(doc, test) : null;
}

/** Every entered result on an exam, with derived scores (basic per-exam report). */
export async function testResults(testId: string): Promise<ClassTestResultShape[]> {
  const test = await loadTest(testId);
  const docs = (await ClassTestResult.find({ testId: new Types.ObjectId(testId) })
    .sort({ createdAt: 1 })
    .lean()) as unknown as IClassTestResult[];
  return docs.map((d) => resultShape(d, test));
}

// ---------------------------------------------------------------------------
// Per-exam completion read + deadline / overdue (the CT-2 derivation helper;
// the cross-exam Reports-Status / dashboard aggregates are CT-4)
// ---------------------------------------------------------------------------

export interface ExamReportStatus {
  testId: string;
  ctId: string;
  examDate: string;
  deadline: string;
  deadlineDays: number;
  /** Active students in the section (the denominator for "complete"). */
  rosterCount: number;
  /** Students with any result row entered. */
  enteredCount: number;
  presentCount: number;
  absentCount: number;
  /** rosterCount − enteredCount (never < 0). */
  pendingCount: number;
  /** Every active student has a result row. */
  complete: boolean;
  /** Past deadline AND not complete (D-#120 clock idle until the exam date). */
  overdue: boolean;
  schoolDaysLate: number;
}

/**
 * The per-exam completion + deadline/overdue read (CT-2). `now` is passed in (§9 —
 * deterministic). Overdue requires BOTH past-deadline and incomplete results.
 */
export async function examReportStatus(testId: string, now: Date = new Date()): Promise<ExamReportStatus> {
  const test = await loadTest(testId);

  const [rosterCount, results] = await Promise.all([
    Student.countDocuments({ sectionId: test.sectionId, active: true }),
    ClassTestResult.find({ testId: new Types.ObjectId(testId) }).select("status").lean() as Promise<
      Array<{ status: ClassTestAttendanceStatus }>
    >,
  ]);

  const enteredCount = results.length;
  const presentCount = results.filter((r) => r.status === "PRESENT").length;
  const absentCount = enteredCount - presentCount;
  const pendingCount = Math.max(0, rosterCount - enteredCount);
  const complete = rosterCount > 0 && enteredCount >= rosterCount;

  const { deadline, overdue, schoolDaysLate } = await resolveClassTestOverdue(
    new Date(test.examDate),
    test.deadlineDays,
    now,
  );

  return {
    testId,
    ctId: test.ctId,
    examDate: new Date(test.examDate).toISOString(),
    deadline: deadline.toISOString(),
    deadlineDays: test.deadlineDays,
    rosterCount,
    enteredCount,
    presentCount,
    absentCount,
    pendingCount,
    complete,
    overdue: overdue && !complete,
    schoolDaysLate: overdue && !complete ? schoolDaysLate : 0,
  };
}

/** The school-day-aware deadline for a class test (thin wrapper for callers/UI). */
export async function classTestDeadline(testId: string): Promise<string> {
  const test = await loadTest(testId);
  const deadline = await resolveClassTestDeadline(new Date(test.examDate), test.deadlineDays);
  return deadline.toISOString();
}

// ---------------------------------------------------------------------------
// Guardian read rider (CT-3, §6/J7, D-#68) — the child's PUBLISHED results.
// ---------------------------------------------------------------------------

/**
 * A class-test result as the GUARDIAN portal shows it (J7/D-#68). It carries the
 * derived score + the parent-facing fields ONLY — `teacherAction` is the internal
 * note and is **structurally absent from this shape**, so it can never leak to a
 * guardian (the resolver maps to this type, not the staff `ClassTestResultShape`).
 */
export interface GuardianClassTestResult {
  testId: string;
  ctId: string;
  subject: string;
  testNumber: number;
  examDate: string;
  classLevel: number;
  status: ClassTestAttendanceStatus;
  marks: number | null;
  totalMarks: number;
  percent: number | null;
  pass: boolean | null;
  weakness: string | null;
  guardianAction: string | null;
  publishedAt: string | null;
}

/**
 * The linked child's PUBLISHED class-test results (read-only, J7). Unpublished rows
 * (publishedAt == null) are excluded; so are results whose exam is not PRINTED
 * (defensive). Row-scope (`assertGuardianOfStudent`) is enforced by the resolver.
 * NEVER returns `teacherAction` — the shape omits it (D-#68).
 */
export async function childTestResults(studentId: string): Promise<GuardianClassTestResult[]> {
  const docs = (await ClassTestResult.find({
    studentId: new Types.ObjectId(studentId),
    publishedAt: { $ne: null },
  })
    .lean()) as unknown as IClassTestResult[];
  if (docs.length === 0) return [];

  const testIds = [...new Set(docs.map((d) => d.testId.toString()))].map((id) => new Types.ObjectId(id));
  const tests = (await ClassTest.find({ _id: { $in: testIds }, status: "PRINTED" })
    .lean()) as unknown as IClassTest[];
  const testById = new Map(tests.map((t) => [t._id.toString(), t]));

  const out: GuardianClassTestResult[] = [];
  for (const d of docs) {
    const test = testById.get(d.testId.toString());
    if (!test) continue; // exam not PRINTED / missing — not guardian-visible
    const score = deriveScore({
      status: d.status,
      marks: d.marks ?? null,
      totalMarks: test.totalMarks,
      passMark: test.passMark,
    });
    out.push({
      testId: d.testId.toString(),
      ctId: test.ctId,
      subject: test.subject,
      testNumber: test.testNumber,
      examDate: new Date(test.examDate).toISOString(),
      classLevel: test.classLevel,
      status: score.status,
      marks: score.marks,
      totalMarks: score.totalMarks,
      percent: score.percent,
      pass: score.pass,
      weakness: d.weakness ?? null,
      guardianAction: d.guardianAction ?? null,
      publishedAt: d.publishedAt ? new Date(d.publishedAt).toISOString() : null,
    });
  }
  // Newest exam first.
  out.sort((a, b) => new Date(b.examDate).getTime() - new Date(a.examDate).getTime());
  return out;
}
