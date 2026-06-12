/**
 * HomeworkFileService — attach + read-gate for homework files (GP-A, D-#70).
 *
 *   attachQuestionFile  — set HomeworkItem.questionFileId (Layer A: one per item,
 *                         shared by the class). Re-attach replaces the reference.
 *   attachAnswerFile    — set HomeworkStudentRecord.answerFileId (Layer B: per
 *                         student, per record; a resubmission may carry its own).
 *   assertFileReadAccess — the GET /files/:id default-deny gate:
 *       staff    → read scope on the owning item/record's section+class;
 *       GUARDIAN → answer file: assertGuardianOfStudent against the record's
 *                  student; question file: a linked ACTIVE child enrolled in the
 *                  item's class. Unauthenticated: never (answer files are child
 *                  PII, ADR-005).
 *
 * Write-scope for attach (subject teacher, tracker:write + assertCanWrite) is
 * enforced by the RESOLVER on the owning doc's section — no new permission.
 * Audit: HW_FILE_ATTACHED (append-only, ADR-008).
 */
import { Types } from "mongoose";
import type { AppContext } from "../../../context";
import {
  assertCanRead,
  assertGuardianOfStudent,
  ForbiddenError,
} from "../../../middleware/authz";
import { HomeworkItem, type IHomeworkItem } from "../models/HomeworkItem";
import {
  HomeworkStudentRecord,
  type IHomeworkStudentRecord,
} from "../models/HomeworkStudentRecord";
import { StoredFile, type IStoredFile } from "../../platform/models/StoredFile";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Student } from "../../foundation/models/Student";
import { writeAudit } from "../../platform/services/AuditService";

/** Load + kind-check a StoredFile for attaching. */
async function requireFile(fileId: string, kind: IStoredFile["kind"]): Promise<IStoredFile> {
  const file = (await StoredFile.findById(fileId).lean()) as unknown as IStoredFile | null;
  if (!file) throw new Error("StoredFile not found");
  if (file.kind !== kind) {
    throw new Error(`StoredFile kind mismatch: expected ${kind}, got ${file.kind}`);
  }
  return file;
}

export interface AttachResult {
  id: string;
  hwId: string;
  fileId: string;
}

/** The owning item for an attach — exported so the resolver can write-scope
 *  check the item's section BEFORE attaching. */
export async function requireItem(hwItemId: string): Promise<IHomeworkItem> {
  const item = (await HomeworkItem.findById(hwItemId).lean()) as unknown as IHomeworkItem | null;
  if (!item) throw new Error("HomeworkItem not found");
  return item;
}

export async function requireRecord(recordId: string): Promise<IHomeworkStudentRecord> {
  const rec = (await HomeworkStudentRecord.findById(
    recordId,
  ).lean()) as unknown as IHomeworkStudentRecord | null;
  if (!rec) throw new Error("HomeworkStudentRecord not found");
  return rec;
}

/** Attach (or replace) the QUESTION file on a Layer-A item (GP-A). */
export async function attachQuestionFile(
  hwItemId: string,
  fileId: string,
  actorId: string,
): Promise<AttachResult> {
  const item = await requireItem(hwItemId);
  const file = await requireFile(fileId, "hw_question");
  await HomeworkItem.updateOne(
    { _id: item._id },
    { $set: { questionFileId: new Types.ObjectId(fileId) } },
  );
  await writeAudit({
    eventKind: "HW_FILE_ATTACHED",
    actorId,
    targetId: item._id,
    targetKind: "HomeworkItem",
    meta: { kind: file.kind, hwId: item.hwId, fileId },
  });
  return { id: item._id.toString(), hwId: item.hwId, fileId };
}

/** Attach (or replace) the checked-ANSWER file on a Layer-B record (GP-A). */
export async function attachAnswerFile(
  recordId: string,
  fileId: string,
  actorId: string,
): Promise<AttachResult> {
  const rec = await requireRecord(recordId);
  const file = await requireFile(fileId, "hw_answer");
  await HomeworkStudentRecord.updateOne(
    { _id: rec._id },
    { $set: { answerFileId: new Types.ObjectId(fileId) } },
  );
  await writeAudit({
    eventKind: "HW_FILE_ATTACHED",
    actorId,
    targetId: rec._id,
    targetKind: "HomeworkStudentRecord",
    meta: { kind: file.kind, hwId: rec.hwId, fileId },
  });
  return { id: rec._id.toString(), hwId: rec.hwId, fileId };
}

/**
 * Default-deny read gate for GET /files/:id (GP-J7). Throws ForbiddenError
 * (Bangla for the guardian paths, NFR-5) unless the caller may stream the file.
 */
export async function assertFileReadAccess(ctx: AppContext, file: IStoredFile): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

  if (file.kind === "hw_answer") {
    const rec = (await HomeworkStudentRecord.findOne({
      answerFileId: file._id,
    }).lean()) as unknown as IHomeworkStudentRecord | null;
    if (!rec) throw new ForbiddenError("ফাইলটি কোনো বাড়ির কাজের সাথে যুক্ত নয়");
    if (ctx.auth.role === "GUARDIAN") {
      await assertGuardianOfStudent(ctx, rec.studentId.toString());
      return;
    }
    await assertCanRead(ctx, rec.sectionId.toString(), rec.classId.toString());
    return;
  }

  // hw_question
  const item = (await HomeworkItem.findOne({
    questionFileId: file._id,
  }).lean()) as unknown as IHomeworkItem | null;
  if (!item) throw new ForbiddenError("ফাইলটি কোনো বাড়ির কাজের সাথে যুক্ত নয়");
  if (ctx.auth.role === "GUARDIAN") {
    // A linked ACTIVE child enrolled in the item's class (prd §5 transport rule).
    const links = await GuardianLink.find({ guardianId: ctx.auth.userId }).lean();
    const activeIds = links.filter((l) => l.active !== false).map((l) => l.studentId);
    if (activeIds.length > 0) {
      const enrolled = await Student.findOne({
        _id: { $in: activeIds },
        classId: item.classId,
        active: true,
      }).lean();
      if (enrolled) return;
    }
    throw new ForbiddenError("এই শিক্ষার্থীর তথ্য দেখার অনুমতি নেই");
  }
  await assertCanRead(ctx, item.sectionId.toString(), item.classId.toString());
}
