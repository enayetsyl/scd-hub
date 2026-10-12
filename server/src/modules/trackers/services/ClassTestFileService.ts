/**
 * ClassTestFileService — the read gate for uploaded class-test question papers
 * (CT-1, prd-tracker-class-test §5.2). The bytes live in the GP-A/M-4 Drive
 * store under `SCD-Hub-Files/<year>/classtest/`; this is the `GET /files/:id`
 * default-deny gate for files whose kind is `classtest_question`.
 *
 * Gate (§5.2): the Office (`roster:manage` — the print operator who opens the
 * paper to print it) OR the requesting teacher (the file's uploader). A teacher
 * who didn't upload the paper, a guardian, and an unauthenticated caller are all
 * denied. The Drive id never reaches a client (the route streams the bytes).
 *
 * The uploader IS the requesting teacher: a class test is filed AFTER the upload
 * (the upload returns the questionFileId the request then carries), so the
 * StoredFile.uploadedBy identity is the requesting teacher without a ClassTest
 * join. No new permission — composes roster:manage + ownership (D-#94/#144).
 */
import { callerHasPermission } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertGuardianOfStudent } from "../../../middleware/authz";
import type { IStoredFile } from "../../platform/models/StoredFile";
import { ClassTestQuestionRequest } from "../models/ClassTestQuestionRequest";
import { scriptOwnerOf } from "./ClassTestScriptService";
import { assertAnchorRead } from "../classTestAnchor";

export async function assertClassTestFileReadAccess(
  ctx: AppContext,
  file: IStoredFile,
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("অনুমতি নেই");
  // Office / Principal — the print operator opens the paper to print it.
  if (callerHasPermission(ctx.auth, "roster:manage")) return;
  // The requesting teacher — the file's own uploader.
  if (file.uploadedBy.toString() === ctx.auth.userId) return;
  // CT-question flow (owner ask 2026-07-20): the OFFICE uploaded the paper; the
  // REQUESTING teacher must open it to review — any round's file of their own
  // request. A lookup failure denies (fail-closed), never 500s.
  try {
    const reviewed = await ClassTestQuestionRequest.exists({
      requestedBy: ctx.auth.userId,
      "rounds.fileId": file._id,
    });
    if (reviewed) return;
  } catch {
    // fall through to deny
  }
  throw new ForbiddenError("এই প্রশ্নপত্র দেখার অনুমতি নেই");
}

/**
 * The read gate for a scanned script page (`classtest_script`, CS-2/CS-3,
 * docs/prd-ct-scripts.md §6, D-#716). The file carries no back-reference, so the
 * gate reverse-resolves the owning ClassTestResult row:
 *  - Office / Principal (`roster:manage`) — always (they scan and tag it).
 *  - An untagged upload has no owner — Office only.
 *  - A GUARDIAN — only of that row's student, and only while the result AND the
 *    scripts are published (an unpublish of either hides it at once).
 *  - Other staff (`tracker:read`) — the test's read scope (`assertAnchorRead`).
 * A lookup failure denies (fail-closed).
 */
export async function assertClassTestScriptReadAccess(ctx: AppContext, file: IStoredFile): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("অনুমতি নেই");
  if (callerHasPermission(ctx.auth, "roster:manage")) return;
  const owner = await scriptOwnerOf(file._id);
  if (!owner) throw new ForbiddenError("অনুমতি নেই");
  if (ctx.auth.role === "GUARDIAN") {
    await assertGuardianOfStudent(ctx, owner.row.studentId.toString());
    const s = owner.test.scripts;
    if (owner.test.status !== "PRINTED" || !owner.row.publishedAt || !s?.publishedAt || s.waivedAt) {
      throw new ForbiddenError("এই খাতা এখনও প্রকাশ করা হয়নি");
    }
    return;
  }
  if (callerHasPermission(ctx.auth, "tracker:read")) {
    const t = owner.test;
    await assertAnchorRead(ctx, {
      sectionId: t.sectionId ? t.sectionId.toString() : null,
      classId: t.classId ? t.classId.toString() : null,
      subjectGroupId: t.subjectGroupId ? t.subjectGroupId.toString() : null,
      subject: t.subject,
      teacherId: (t.teacherId ?? t.requestedBy)?.toString() ?? null,
    });
    return;
  }
  throw new ForbiddenError("অনুমতি নেই");
}
