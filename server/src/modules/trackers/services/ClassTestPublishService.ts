/**
 * ClassTestPublishService (CT-3, prd-tracker-class-test §5/§8, D-#121/#122/#160) —
 * publish / unpublish a class-test result (per-student OR whole-exam) and deliver it
 * to guardians on the existing rails.
 *
 *   publishResult / publishExam   — stamp `publishedAt = now` + **`$inc publishedVersion`**
 *                                   (the field exists from CT-2), then deliver: a wa.me
 *                                   click-to-send link for EVERY family with a phone
 *                                   (ADR-003) + an in-app Notification for login-enabled
 *                                   guardians via the emit() seam (D-#72). Contact-only
 *                                   families stay wa.me-only (D-#31).
 *   unpublishResult / unpublishExam — clear `publishedAt` (pull from the guardian card);
 *                                   `publishedVersion` is LEFT as-is, so the next publish
 *                                   bumps it again → a fresh dedupeKey → RE-notify (D-#122).
 *
 * Message bodies are NOT inline strings — they render from the merged Message-Templates
 * registry (`class_test.result.*`, built on MT-1 per D-#131). **N+1 guard** (the recorded
 * MT follow-up + the VC-4 precedent): the title renders ONCE per batch and each per-student
 * body ONCE per student; renderTemplate is NEVER called inside the per-guardian loop (the
 * emitter takes pre-rendered text).
 *
 * Write-scope (`tracker:write` + `assertCanWrite` on the result's section) is enforced by
 * the RESOLVER — this service trusts the actor. The dedupeKey carries `publishedVersion`
 * so a re-publish re-notifies. Identity-plane; NO corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { HW_SUBJECT_LABELS_BN } from "@scd/shared";
import { ClassTest, type IClassTest } from "../models/ClassTest";
import { ClassTestResult, type IClassTestResult } from "../models/ClassTestResult";
import { Student } from "../../foundation/models/Student";
import { renderTemplate } from "../../templates/services/MessageTemplateService";
import {
  emitClassTestGuardianResult,
  emitCtResultSubmitted,
  emitCtResultPublished,
} from "../../notifications/services/emitters";
import { writeAudit } from "../../platform/services/AuditService";
import { ClassTestResultError } from "./ClassTestResultService";

// ---------------------------------------------------------------------------
// Message build (rendered from the MT registry; §8 Regular / Excellent / Absent)
// ---------------------------------------------------------------------------

export type ClassTestMessageKind = "regular" | "excellent" | "absent";

/** Which §8 template a result maps to: ABSENT → absent; PRESENT with a teacher-entered
 *  weakness → regular (feedback); PRESENT with no weakness → excellent (D-#122/§8). */
export function classTestMessageKind(result: { status: string; weakness?: string | null }): ClassTestMessageKind {
  if (result.status === "ABSENT") return "absent";
  const hasWeakness = !!(result.weakness && result.weakness.trim().length > 0);
  return hasWeakness ? "regular" : "excellent";
}

/** dd/mm/yyyy (the VC-4 guardian-message convention). */
export function formatDateBn(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

interface ResultLike {
  status: string;
  marks?: number | null;
  weakness?: string | null;
  guardianAction?: string | null;
}

/** Render the per-student Bangla body for a published result (once per student). */
export async function buildClassTestResultMessage(
  result: ResultLike,
  test: { subject: string; testNumber: number; examDate: Date; totalMarks: number },
  studentName: string,
): Promise<{ kind: ClassTestMessageKind; messageBn: string }> {
  const kind = classTestMessageKind(result);
  const subjectBn = (HW_SUBJECT_LABELS_BN as Record<string, string>)[test.subject] ?? test.subject;
  let messageBn: string;
  if (kind === "absent") {
    messageBn = await renderTemplate("class_test.result.absent.body", {
      StudentName: studentName,
      TestDate: formatDateBn(new Date(test.examDate)),
      Subject: subjectBn,
      TestNumber: test.testNumber,
    });
  } else if (kind === "excellent") {
    messageBn = await renderTemplate("class_test.result.excellent.body", {
      StudentName: studentName,
      Subject: subjectBn,
      TestNumber: test.testNumber,
      Marks: result.marks ?? 0,
      TotalMarks: test.totalMarks,
    });
  } else {
    messageBn = await renderTemplate("class_test.result.regular.body", {
      StudentName: studentName,
      Subject: subjectBn,
      TestNumber: test.testNumber,
      Marks: result.marks ?? 0,
      TotalMarks: test.totalMarks,
      Weakness: result.weakness ?? "",
      GuardianAction: result.guardianAction ?? "",
    });
  }
  return { kind, messageBn };
}

// ---------------------------------------------------------------------------
// wa.me link (ADR-003 — always a MANUAL click-to-send)
// ---------------------------------------------------------------------------

function waLinkFor(phone: string | undefined | null, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export interface ClassTestMessageRecipient {
  studentId: string;
  studentName: string;
  kind: ClassTestMessageKind;
  messageBn: string;
  /** wa.me link for the family phone (null when no phone on file). */
  waLink: string | null;
  /** True when the family has no phone → only the in-app inbox path applies. */
  unreachableByWa: boolean;
  /** Login-enabled guardian ids that got an in-app inbox row. */
  notifiedGuardianIds: string[];
  /** The version this publish stamped (part of the dedupeKey). */
  publishedVersion: number;
}

export interface PublishResultOutcome {
  testId: string;
  recipients: ClassTestMessageRecipient[];
  unreachableCount: number;
}

type StudentLite = { _id: Types.ObjectId; name: string; nameBn?: string; phone?: string };

/** Deliver ONE already-published result row (title pre-rendered, body rendered here once). */
async function deliverResult(
  test: IClassTest,
  doc: IClassTestResult,
  student: StudentLite | undefined,
  titleBn: string,
): Promise<ClassTestMessageRecipient> {
  const studentName = student?.nameBn || student?.name || "শিক্ষার্থী";
  const { kind, messageBn } = await buildClassTestResultMessage(
    { status: doc.status, marks: doc.marks ?? null, weakness: doc.weakness, guardianAction: doc.guardianAction },
    { subject: test.subject, testNumber: test.testNumber, examDate: test.examDate, totalMarks: test.totalMarks },
    studentName,
  );
  const waLink = waLinkFor(student?.phone, messageBn);
  const notifiedGuardianIds = await emitClassTestGuardianResult({
    testId: test._id,
    studentId: doc.studentId,
    sectionId: test.sectionId ?? null,
    publishedVersion: doc.publishedVersion,
    titleBn,
    messageBn,
  });
  return {
    studentId: doc.studentId.toString(),
    studentName,
    kind,
    messageBn,
    waLink,
    unreachableByWa: !waLink,
    notifiedGuardianIds,
    publishedVersion: doc.publishedVersion,
  };
}

async function loadPrintedTest(testId: string): Promise<IClassTest> {
  const test = (await ClassTest.findById(testId).lean()) as IClassTest | null;
  if (!test) throw new ClassTestResultError("Class test not found");
  if (test.status !== "PRINTED") {
    throw new ClassTestResultError("Only a printed (official) exam's results can be published");
  }
  return test;
}

async function loadStudents(studentIds: Types.ObjectId[]): Promise<Map<string, StudentLite>> {
  const students = (await Student.find({ _id: { $in: studentIds } })
    .select("name nameBn phone")
    .lean()) as unknown as StudentLite[];
  return new Map(students.map((s) => [s._id.toString(), s]));
}

// ---------------------------------------------------------------------------
// Publish — per-student (J4)
// ---------------------------------------------------------------------------

export async function publishResult(testId: string, studentId: string, actorId: string): Promise<PublishResultOutcome> {
  const test = await loadPrintedTest(testId);

  // Stamp + bump atomically; a non-existent result can't be published.
  const doc = (await ClassTestResult.findOneAndUpdate(
    { testId: new Types.ObjectId(testId), studentId: new Types.ObjectId(studentId) },
    { $set: { publishedAt: new Date() }, $inc: { publishedVersion: 1 } },
    { new: true },
  )) as IClassTestResult | null;
  if (!doc) throw new ClassTestResultError("No result entered for this student — nothing to publish");

  const titleBn = await renderTemplate("class_test.result.title");
  const studentById = await loadStudents([doc.studentId]);
  const recipient = await deliverResult(test, doc, studentById.get(doc.studentId.toString()), titleBn);

  await writeAudit({
    eventKind: "CLASS_TEST_RESULT_PUBLISHED",
    actorId,
    targetId: doc._id,
    targetKind: "ClassTestResult",
    meta: { mode: "student", ctId: test.ctId, testId, studentId, publishedVersion: doc.publishedVersion },
  });

  return { testId, recipients: [recipient], unreachableCount: recipient.unreachableByWa ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// Publish — whole exam, bulk (J4). Title rendered ONCE; body ONCE per student.
// ---------------------------------------------------------------------------

export async function publishExam(testId: string, actorId: string): Promise<PublishResultOutcome> {
  const test = await loadPrintedTest(testId);

  const existing = (await ClassTestResult.find({ testId: new Types.ObjectId(testId) })
    .select("_id studentId")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; studentId: Types.ObjectId }>;
  if (existing.length === 0) {
    throw new ClassTestResultError("No results entered for this exam — nothing to publish");
  }

  const titleBn = await renderTemplate("class_test.result.title"); // N+1 guard: once per batch
  const studentById = await loadStudents(existing.map((r) => r.studentId));

  const recipients: ClassTestMessageRecipient[] = [];
  let unreachableCount = 0;
  for (const row of existing) {
    // Stamp + bump each row, then deliver (body rendered once per student inside deliverResult).
    const doc = (await ClassTestResult.findByIdAndUpdate(
      row._id,
      { $set: { publishedAt: new Date() }, $inc: { publishedVersion: 1 } },
      { new: true },
    )) as IClassTestResult | null;
    if (!doc) continue;
    const recipient = await deliverResult(test, doc, studentById.get(doc.studentId.toString()), titleBn);
    if (recipient.unreachableByWa) unreachableCount++;
    recipients.push(recipient);
  }

  await writeAudit({
    eventKind: "CLASS_TEST_RESULT_PUBLISHED",
    actorId,
    targetId: test._id,
    targetKind: "ClassTest",
    meta: {
      mode: "exam",
      ctId: test.ctId,
      recipientCount: recipients.length,
      notifiedCount: recipients.reduce((n, r) => n + r.notifiedGuardianIds.length, 0),
      unreachableCount,
    },
  });

  // CT-8 notify: the exam's ACCOUNTABLE subject teacher learns the release went out
  // (not the entrant — an admin registering on a teacher's behalf must not swallow
  // the teacher's notification). Deduped on the max stamped version, so a republish
  // (bumped version) re-notifies.
  const notifyTeacherId = test.teacherId ?? test.requestedBy;
  if (notifyTeacherId && recipients.length > 0) {
    const subjectBn = (HW_SUBJECT_LABELS_BN as Record<string, string>)[test.subject] ?? test.subject;
    await emitCtResultPublished({
      testId,
      ctId: test.ctId,
      teacherUserId: notifyTeacherId.toString(),
      publishedVersion: recipients.reduce((m, r) => Math.max(m, r.publishedVersion), 0),
      titleBn: "ক্লাস টেস্টের ফলাফল প্রকাশিত হয়েছে",
      bodyBn: `আপনার ${subjectBn} ক্লাস টেস্টের (${test.ctId}) ফলাফল প্রকাশিত হয়েছে।`,
    });
  }

  return { testId, recipients, unreachableCount };
}

// ---------------------------------------------------------------------------
// Unpublish — clears publishedAt (publishedVersion is LEFT as-is so a later
// republish bumps it → fresh dedupeKey → re-notify). No guardian delivery.
// ---------------------------------------------------------------------------

export interface UnpublishOutcome {
  testId: string;
  unpublishedCount: number;
}

export async function unpublishResult(testId: string, studentId: string, actorId: string): Promise<UnpublishOutcome> {
  const test = (await ClassTest.findById(testId).lean()) as IClassTest | null;
  if (!test) throw new ClassTestResultError("Class test not found");

  // Retract to DRAFT (CT-8): clear the release AND the submission, so a corrected row
  // must be re-submitted → re-approved (no silent re-appearance on the guardian card).
  const doc = (await ClassTestResult.findOneAndUpdate(
    { testId: new Types.ObjectId(testId), studentId: new Types.ObjectId(studentId), publishedAt: { $ne: null } },
    { $set: { publishedAt: null }, $unset: { submittedAt: "", submittedBy: "" } },
    { new: true },
  )) as IClassTestResult | null;
  if (!doc) throw new ClassTestResultError("This student's result is not published");

  await writeAudit({
    eventKind: "CLASS_TEST_RESULT_UNPUBLISHED",
    actorId,
    targetId: doc._id,
    targetKind: "ClassTestResult",
    meta: { mode: "student", ctId: test.ctId, testId, studentId },
  });

  return { testId, unpublishedCount: 1 };
}

export async function unpublishExam(testId: string, actorId: string): Promise<UnpublishOutcome> {
  const test = (await ClassTest.findById(testId).lean()) as IClassTest | null;
  if (!test) throw new ClassTestResultError("Class test not found");

  const res = await ClassTestResult.updateMany(
    { testId: new Types.ObjectId(testId), publishedAt: { $ne: null } },
    { $set: { publishedAt: null }, $unset: { submittedAt: "", submittedBy: "" } },
  );
  const unpublishedCount = (res as { modifiedCount?: number }).modifiedCount ?? 0;

  await writeAudit({
    eventKind: "CLASS_TEST_RESULT_UNPUBLISHED",
    actorId,
    targetId: test._id,
    targetKind: "ClassTest",
    meta: { mode: "exam", ctId: test.ctId, unpublishedCount },
  });

  return { testId, unpublishedCount };
}

// ---------------------------------------------------------------------------
// CT-8 approval gate — teacher SUBMITS, Office/Principal APPROVES / SENDS BACK.
// Guardian visibility stays `publishedAt != null`, set only by approve (= publishExam).
// ---------------------------------------------------------------------------

export interface SubmitOutcome {
  testId: string;
  count: number;
}

/** Teacher: propose the exam's DRAFT results for release. Sets submittedAt (guardian
 *  does NOT see yet) and clears any prior send-back. PRINTED-only; needs entered rows. */
export async function submitExam(testId: string, actorId: string): Promise<SubmitOutcome> {
  const test = await loadPrintedTest(testId);
  const oid = new Types.ObjectId(testId);
  if ((await ClassTestResult.countDocuments({ testId: oid })) === 0) {
    throw new ClassTestResultError("No results entered for this exam — nothing to submit");
  }

  // D-#640: is there anything here that is actually NOT submitted yet? A row that
  // is unsubmitted, or one the office sent back for another look. If not, this
  // press changes nothing, and the work below would do two harmful things: move
  // every row's `submittedAt` forward (making the teacher look later than they
  // were, since the reports read the newest stamp), and — because the dedupe key
  // is anchored on that stamp so a genuine re-submit CAN re-notify (D-#628 lesson)
  // — put a second identical "অনুমোদন করুন" row in every approver's inbox. The
  // owner saw exactly that on prod: CT-C4-ENG-0004 twice, one minute apart, from
  // a teacher pressing a button that gave no sign the first press had landed.
  // The button now goes inert once everything is in (D-#633); this makes the
  // no-op harmless no matter what the caller does.
  const actionable = await ClassTestResult.countDocuments({
    testId: oid,
    publishedAt: null,
    $or: [{ submittedAt: null }, { sendBackAt: { $ne: null } }],
  });
  if (actionable === 0) return { testId, count: 0 };

  const submittedAt = new Date();
  const res = await ClassTestResult.updateMany(
    { testId: oid, publishedAt: null },
    {
      $set: { submittedAt, submittedBy: new Types.ObjectId(actorId) },
      $unset: { sendBackReason: "", sendBackAt: "", sendBackBy: "" },
    },
  );
  const count = (res as { modifiedCount?: number }).modifiedCount ?? 0;
  await writeAudit({
    eventKind: "CLASS_TEST_RESULT_SUBMITTED",
    actorId,
    targetId: oid,
    targetKind: "ClassTest",
    meta: { testId, count },
  });

  // CT-8 notify: every approver (active Principal/Office) learns results await
  // their review. Deduped on this submit's stamp, so a re-submit re-notifies.
  const subjectBn = (HW_SUBJECT_LABELS_BN as Record<string, string>)[test.subject] ?? test.subject;
  await emitCtResultSubmitted({
    testId,
    ctId: test.ctId,
    submittedAtMs: submittedAt.getTime(),
    titleBn: "ক্লাস টেস্টের ফলাফল জমা হয়েছে",
    bodyBn: `${subjectBn} ক্লাস টেস্ট (${test.ctId}) ফলাফল জমা হয়েছে — অনুমোদন করুন।`,
  });

  return { testId, count };
}

/** Teacher: recall a pending submission back to DRAFT so it can be edited. */
export async function recallExam(testId: string, actorId: string): Promise<SubmitOutcome> {
  const oid = new Types.ObjectId(testId);
  const res = await ClassTestResult.updateMany(
    { testId: oid, submittedAt: { $ne: null }, publishedAt: null },
    { $unset: { submittedAt: "", submittedBy: "" } },
  );
  const count = (res as { modifiedCount?: number }).modifiedCount ?? 0;
  await writeAudit({
    eventKind: "CLASS_TEST_RESULT_RECALLED",
    actorId,
    targetId: oid,
    targetKind: "ClassTest",
    meta: { testId, count },
  });
  return { testId, count };
}

/** Office/Principal: send a submission back to the teacher (→ DRAFT) with a reason. */
export async function sendBackExam(testId: string, actorId: string, reason: string): Promise<SubmitOutcome> {
  const trimmed = reason.trim();
  if (!trimmed) throw new ClassTestResultError("A send-back reason is required");
  const oid = new Types.ObjectId(testId);
  const res = await ClassTestResult.updateMany(
    { testId: oid, submittedAt: { $ne: null }, publishedAt: null },
    {
      $unset: { submittedAt: "", submittedBy: "" },
      $set: { sendBackReason: trimmed, sendBackAt: new Date(), sendBackBy: new Types.ObjectId(actorId) },
    },
  );
  const count = (res as { modifiedCount?: number }).modifiedCount ?? 0;
  if (count === 0) throw new ClassTestResultError("No submitted results to send back");
  await writeAudit({
    eventKind: "CLASS_TEST_RESULT_SENT_BACK",
    actorId,
    targetId: oid,
    targetKind: "ClassTest",
    meta: { testId, count, reason: trimmed },
  });
  return { testId, count };
}

/** Office/Principal: APPROVE = release + guardian delivery. Requires the teacher to
 *  have submitted (the gate direction); reuses publishExam for stamping + delivery. */
export async function approveExam(testId: string, actorId: string): Promise<PublishResultOutcome> {
  const oid = new Types.ObjectId(testId);
  const submitted = await ClassTestResult.countDocuments({ testId: oid, submittedAt: { $ne: null }, publishedAt: null });
  if (submitted === 0) {
    throw new ClassTestResultError("No submitted results to approve — the teacher must submit first");
  }
  return publishExam(testId, actorId);
}
