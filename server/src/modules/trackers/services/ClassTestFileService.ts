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
import { ForbiddenError } from "../../../middleware/authz";
import type { IStoredFile } from "../../platform/models/StoredFile";

export async function assertClassTestFileReadAccess(
  ctx: AppContext,
  file: IStoredFile,
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError("অনুমতি নেই");
  // Office / Principal — the print operator opens the paper to print it.
  if (callerHasPermission(ctx.auth, "roster:manage")) return;
  // The requesting teacher — the file's own uploader.
  if (file.uploadedBy.toString() === ctx.auth.userId) return;
  throw new ForbiddenError("এই প্রশ্নপত্র দেখার অনুমতি নেই");
}
