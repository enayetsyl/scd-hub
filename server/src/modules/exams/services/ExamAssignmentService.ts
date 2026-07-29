/**
 * ExamAssignmentService — EX-2 (docs/prd-exams.md §6, D-#375).
 *
 * Assignment is the ONLY thing that turns a teacher's flat `exam:mark` permission into the
 * right to touch a particular paper. Every EX-3/EX-4 gate calls `assertAssignedTo` here.
 */
import { Types } from "mongoose";
import type { ExamDutyRole } from "@scd/shared";
import { ExamAssignment, type IExamAssignment } from "../models/ExamAssignment";
import { ExamPaper } from "../models/ExamPaper";
import { Exam } from "../models/Exam";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { ExamError } from "./ExamService";

/** Roles that operate on ONE paper. INVIGILATOR is the exception — it is exam-wide duty. */
const PAPER_SCOPED_ROLES: ReadonlySet<ExamDutyRole> = new Set([
  "CHECKER", "RECHECKER", "TABULATOR", "MARK_RECHECKER",
]);

/** The pair that must never be the same person: a recheck by the original checker is not a
 *  recheck. The source sheets already name two distinct teachers per subject. */
const CONFLICTING: ReadonlyArray<[ExamDutyRole, ExamDutyRole]> = [
  ["CHECKER", "RECHECKER"],
  ["TABULATOR", "MARK_RECHECKER"],
];

export interface AssignInput {
  examId: string;
  paperId?: string | null;
  userId: string;
  role: ExamDutyRole;
}

export async function assignExamDuty(input: AssignInput, actorId: string): Promise<IExamAssignment> {
  const exam = await Exam.findById(input.examId);
  if (!exam) throw new ExamError("পরীক্ষা পাওয়া যায়নি");

  const user = await User.findById(input.userId);
  if (!user) throw new ExamError("ব্যবহারকারী পাওয়া যায়নি");

  if (PAPER_SCOPED_ROLES.has(input.role) && !input.paperId) {
    throw new ExamError("এই দায়িত্বের জন্য বিষয়পত্র নির্দিষ্ট করতে হবে");
  }

  let paperId: Types.ObjectId | undefined;
  if (input.paperId) {
    const paper = await ExamPaper.findById(input.paperId);
    if (!paper) throw new ExamError("বিষয়পত্র পাওয়া যায়নি");
    if (paper.examId.toString() !== exam._id.toString()) {
      throw new ExamError("বিষয়পত্রটি এই পরীক্ষার নয়");
    }
    paperId = paper._id;
  }

  if (paperId) {
    // Already holds this exact duty — idempotent, not an error worth failing a bulk assign.
    const same = await ExamAssignment.findOne({ paperId, userId: user._id, role: input.role });
    if (same) return same;

    // THE guard (§6 EX-2): checker ≠ rechecker, tabulator ≠ mark-rechecker, on one paper.
    for (const [a, b] of CONFLICTING) {
      const other = input.role === a ? b : input.role === b ? a : null;
      if (!other) continue;
      const clash = await ExamAssignment.findOne({ paperId, userId: user._id, role: other });
      if (clash) {
        throw new ExamError(
          "একই শিক্ষক একই বিষয়পত্রে চেককারী ও রিচেককারী দুটোই হতে পারবেন না",
        );
      }
    }
  }

  const row = await ExamAssignment.create({
    examId: exam._id,
    paperId,
    userId: user._id,
    role: input.role,
    assignedBy: new Types.ObjectId(actorId),
  });

  await writeAudit({
    eventKind: "EXAM_DUTY_ASSIGNED",
    actorId,
    targetId: row._id,
    targetKind: "ExamAssignment",
    meta: {
      examId: exam._id.toString(),
      paperId: paperId?.toString() ?? null,
      userId: user._id.toString(),
      role: input.role,
    },
  });
  return row;
}

export async function revokeExamDuty(assignmentId: string, actorId: string): Promise<void> {
  const row = await ExamAssignment.findById(assignmentId);
  if (!row) throw new ExamError("দায়িত্ব পাওয়া যায়নি");
  await ExamAssignment.deleteOne({ _id: row._id });
  await writeAudit({
    eventKind: "EXAM_DUTY_REVOKED",
    actorId,
    targetId: row._id,
    targetKind: "ExamAssignment",
    meta: { examId: row.examId.toString(), userId: row.userId.toString(), role: row.role },
  });
}

/** Is this user assigned that duty on that paper? THE gate EX-3/EX-4 rely on. */
export async function isAssignedTo(
  paperId: string,
  userId: string,
  roles: readonly ExamDutyRole[],
): Promise<boolean> {
  const row = await ExamAssignment.findOne({
    paperId: new Types.ObjectId(paperId),
    userId: new Types.ObjectId(userId),
    role: { $in: roles },
  });
  return row !== null;
}

export async function assertAssignedTo(
  paperId: string,
  userId: string,
  roles: readonly ExamDutyRole[],
): Promise<void> {
  if (!(await isAssignedTo(paperId, userId, roles))) {
    throw new ExamError("এই বিষয়পত্রে আপনার দায়িত্ব নেই");
  }
}

export async function assignmentsForExam(examId: string): Promise<IExamAssignment[]> {
  return ExamAssignment.find({ examId: new Types.ObjectId(examId) }).sort({ role: 1 });
}

export async function assignmentsForPaper(paperId: string): Promise<IExamAssignment[]> {
  return ExamAssignment.find({ paperId: new Types.ObjectId(paperId) }).sort({ role: 1 });
}

/** A teacher's own duty list — "what am I on the hook for this exam". */
export async function myExamDuties(userId: string, examId?: string | null): Promise<IExamAssignment[]> {
  const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
  if (examId) filter.examId = new Types.ObjectId(examId);
  return ExamAssignment.find(filter).sort({ createdAt: -1 });
}
