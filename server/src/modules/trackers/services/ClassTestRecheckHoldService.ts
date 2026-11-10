/**
 * CT-RC Option B (owner 2026-11-10) — at approval, the approver may HOLD one student's
 * result to see the paper; the rest of the class publishes as normal.
 *
 *   setRecheckHold   — hold / un-hold one submitted, unpublished row.
 *   releaseHeld      — the mark is right: publish that one row (publishResult clears the hold).
 *   correctHeld      — the mark was wrong: fix it, publish it, and leave a QUIET note in the
 *                      teacher's staff mistake record (tier 2, like a send-back — D-#953;
 *                      no warning pop-up, D-#1150).
 *   heldResults      — every held row, for the Principal's Today card.
 *
 * Kept apart from ClassTestRecheckService so the publish service can import the gates
 * without a cycle. The resolver enforces class_test:publish; this service trusts the actor.
 */
import { Types } from "mongoose";
import { HW_SUBJECT_LABELS_BN } from "@scd/shared";
import { ClassTest, type IClassTest } from "../models/ClassTest";
import { ClassTestResult, type IClassTestResult } from "../models/ClassTestResult";
import { Student } from "../../foundation/models/Student";
import { writeAudit } from "../../platform/services/AuditService";
import { recordPlaceMistake } from "../../staff-mistakes/services/StaffMistakeNoteService";
import { ClassTestResultError } from "./ClassTestResultService";
import { publishResult, type PublishResultOutcome } from "./ClassTestPublishService";
import { recheckView, type RecheckRowView } from "./ClassTestRecheckService";
import { bnNum } from "../../../lib/bnNum";

type HeldRow = Pick<IClassTestResult, "_id" | "status" | "marks" | "submittedAt" | "publishedAt" | "recheck" | "recheckHold" | "enteredBy" | "submittedBy">;

async function loadRow(testId: string, studentId: string): Promise<HeldRow> {
  const row = (await ClassTestResult.findOne({ testId: new Types.ObjectId(testId), studentId: new Types.ObjectId(studentId) })
    .select("_id status marks submittedAt publishedAt recheck recheckHold enteredBy submittedBy")
    .lean()) as HeldRow | null;
  if (!row) throw new ClassTestResultError("এই শিক্ষার্থীর কোনো ফল পাওয়া যায়নি");
  return row;
}

export async function setRecheckHold(testId: string, studentId: string, hold: boolean, actorId: string): Promise<boolean> {
  const row = await loadRow(testId, studentId);
  if (row.publishedAt) throw new ClassTestResultError("ফল প্রকাশিত হয়ে গেছে — এখন আটকে রাখা যাবে না");
  if (hold && !row.submittedAt) throw new ClassTestResultError("শিক্ষক জমা দেওয়ার পরই ফল আটকে রাখা যায়");
  await ClassTestResult.updateOne(
    { _id: row._id },
    { $set: { recheckHold: hold ? { by: new Types.ObjectId(actorId), at: new Date() } : null } },
  );
  await writeAudit({
    eventKind: "CLASS_TEST_RECHECK_HELD",
    actorId,
    targetId: row._id,
    targetKind: "ClassTestResult",
    meta: { testId, studentId, hold },
  });
  return hold;
}

/** The Principal saw the paper and the mark stands: publish that one row. */
export async function releaseHeld(testId: string, studentId: string, actorId: string): Promise<PublishResultOutcome> {
  const row = await loadRow(testId, studentId);
  if (!row.recheckHold) throw new ClassTestResultError("এই ফল আটকে রাখা নেই");
  if (row.publishedAt) throw new ClassTestResultError("ফল আগেই প্রকাশিত হয়েছে");
  return publishResult(testId, studentId, actorId);
}

/** The Principal saw the paper and the mark was wrong: fix, publish, note it quietly. */
export async function correctHeld(
  testId: string,
  studentId: string,
  marks: number,
  actorId: string,
): Promise<PublishResultOutcome> {
  const test = (await ClassTest.findById(testId).select("_id ctId subject totalMarks teacherId requestedBy").lean()) as Pick<
    IClassTest,
    "_id" | "ctId" | "subject" | "totalMarks" | "teacherId" | "requestedBy"
  > | null;
  if (!test) throw new ClassTestResultError("Class test not found");
  const row = await loadRow(testId, studentId);
  if (!row.recheckHold) throw new ClassTestResultError("এই ফল আটকে রাখা নেই");
  if (row.publishedAt) throw new ClassTestResultError("ফল আগেই প্রকাশিত হয়েছে");
  if (row.status !== "PRESENT") throw new ClassTestResultError("অনুপস্থিত শিক্ষার্থীর নম্বর বদলানো যায় না");
  if (typeof marks !== "number" || Number.isNaN(marks) || marks < 0 || marks > test.totalMarks) {
    throw new ClassTestResultError(`নম্বর ০ থেকে ${bnNum(test.totalMarks)} এর মধ্যে দিন`);
  }
  const before = row.marks ?? null;
  // The entrant stays the teacher (enteredBy untouched): it is still their result.
  await ClassTestResult.updateOne({ _id: row._id }, { $set: { marks } });
  await writeAudit({
    eventKind: "CLASS_TEST_RESULT_ENTERED",
    actorId,
    targetId: row._id,
    targetKind: "ClassTestResult",
    meta: { ctId: test.ctId, testId, studentId, status: "PRESENT", heldCorrection: true, before, after: marks },
  });
  const outcome = await publishResult(testId, studentId, actorId);

  if (before !== marks) {
    // Whose mistake: the teacher who ticked "the mark is right", else the submitter /
    // entrant / the exam's teacher.
    const owner = row.recheck?.confirmedBy ?? row.submittedBy ?? row.enteredBy ?? test.teacherId ?? test.requestedBy;
    const subjectBn = (HW_SUBJECT_LABELS_BN as Record<string, string>)[test.subject] ?? test.subject;
    const ticked = row.recheck && row.recheck.marks === before;
    if (owner) {
      await recordPlaceMistake({
        kind: "CT_RECHECK_WRONG",
        tier: 2,
        refKey: `${testId}:${studentId}`,
        ownerId: owner.toString(),
        correctedBy: actorId,
        at: new Date(),
        line:
          `${subjectBn} ক্লাস টেস্ট (${test.ctId}): খাতা দেখে নম্বর ${bnNum(before ?? 0)} থেকে ${bnNum(marks)} করা হয়েছে` +
          (ticked ? " — শিক্ষক দ্বিতীয়বার দেখে \"ঠিক আছে\" বলেছিলেন" : ""),
      });
    }
  }
  return outcome;
}

export interface HeldResultShape extends RecheckRowView {
  testId: string;
  ctId: string;
  subject: string;
  classLevel: number | null;
  examDate: string;
}

/** Every held, still-unpublished row — the Principal's Today card. */
export async function heldResults(): Promise<HeldResultShape[]> {
  const rows = (await ClassTestResult.find({ recheckHold: { $ne: null }, publishedAt: null })
    .select("testId studentId marks recheckHold")
    .sort({ "recheckHold.at": 1 })
    .limit(200)
    .lean()) as unknown as Array<{ testId: Types.ObjectId; studentId: Types.ObjectId; marks?: number; recheckHold: { at: Date } }>;
  if (rows.length === 0) return [];
  const testIds = [...new Set(rows.map((r) => r.testId.toString()))];
  const tests = (await ClassTest.find({ _id: { $in: testIds } }).select("_id ctId subject classLevel examDate totalMarks").lean()) as unknown as Array<
    Pick<IClassTest, "_id" | "ctId" | "subject" | "classLevel" | "examDate" | "totalMarks">
  >;
  const testById = new Map(tests.map((t) => [t._id.toString(), t]));
  const out: HeldResultShape[] = [];
  for (const testId of testIds) {
    const t = testById.get(testId);
    if (!t) continue;
    const view = await recheckView(testId);
    const viewByStudent = new Map(view.rows.map((r) => [r.studentId, r]));
    for (const r of rows.filter((x) => x.testId.toString() === testId)) {
      let rv = viewByStudent.get(r.studentId.toString());
      if (!rv) {
        // Held although not flagged (the approver's own call): show it plainly.
        const s = (await Student.findById(r.studentId).select("name nameBn").lean()) as { name: string; nameBn?: string } | null;
        rv = {
          studentId: r.studentId.toString(),
          studentName: s?.nameBn || s?.name || "শিক্ষার্থী",
          marks: r.marks ?? 0,
          totalMarks: t.totalMarks,
          percent: t.totalMarks ? Math.round(((r.marks ?? 0) / t.totalMarks) * 1000) / 10 : 0,
          averagePct: null,
          basis: "NONE",
          priorCount: 0,
          kinds: [],
          confirmed: false,
          confirmedAt: null,
          confirmedByName: null,
          note: null,
          submitted: true,
          published: false,
          held: true,
          heldAt: new Date(r.recheckHold.at).toISOString(),
        };
      }
      out.push({
        ...rv,
        testId,
        ctId: t.ctId,
        subject: t.subject,
        classLevel: t.classLevel ?? null,
        examDate: new Date(t.examDate).toISOString(),
      });
    }
  }
  return out;
}
