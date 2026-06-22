/**
 * CommentFileService (CM-2, prd-comments-meetings §5, D-#172) — daily-comment
 * attachments on the REUSED GP-A/M-4 Drive store (StoredFile + DriveStore), NOT a
 * twin upload path.
 *
 *   validateCommentUpload     — MIME whitelist (image jpeg/png/gif/webp · pdf · video
 *                               mp4/webm/quicktime · audio) + the 10 MB hard cap (chat
 *                               parity, D-#108); returns the StoredFile kind or a
 *                               Bangla rejection.
 *   assertCommentFileReadAccess — the GET /files/:id gate for a comment file: the
 *                               comment's AUTHOR (any state) OR a guardian of the child
 *                               for a DELIVERED comment (assertGuardianOfStudent, D-#68).
 *                               Other staff and unauthenticated callers are denied; an
 *                               undelivered comment's attachment is author-only.
 *
 * The file is bound to its comment by `StoredFile.studentCommentId` (set at upload),
 * so the gate resolves the child + delivery state without a scan. Identity-plane
 * (ADR-005) — comment files name a child; no corpus path. The Drive id never reaches
 * a client (the route streams the bytes).
 */
import { Types } from "mongoose";
import type { AppContext } from "../../../context";
import { ForbiddenError, assertGuardianOfStudent } from "../../../middleware/authz";
import type { IStoredFile, StoredFileKind } from "../../platform/models/StoredFile";
import { StudentComment, type IStudentComment } from "../models/StudentComment";

/** Per-file hard limit — 10 MB exactly (chat parity, D-#108 / prd §5). */
export const MAX_COMMENT_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10,485,760

export const COMMENT_FILE_ERRORS_BN = {
  badMime: "শুধু ছবি, পিডিএফ, ভিডিও বা অডিও ফাইল সংযুক্ত করা যাবে",
  tooLarge: "ফাইলের আকার সর্বোচ্চ ১০ মেগাবাইট",
  forbidden: "অনুমতি নেই",
  notFound: "মন্তব্যটি পাওয়া যায়নি",
  notReadable: "এই ফাইল দেখার অনুমতি নেই",
} as const;

/** MIME → StoredFile comment kind whitelist (§5; the chat-attachment MIME set). */
const COMMENT_MIME_KIND: Record<string, StoredFileKind> = {
  "image/jpeg": "comment_image",
  "image/png": "comment_image",
  "image/gif": "comment_image",
  "image/webp": "comment_image",
  "application/pdf": "comment_pdf",
  "video/mp4": "comment_video",
  "video/webm": "comment_video",
  "video/quicktime": "comment_video",
  "audio/mpeg": "comment_audio",
  "audio/mp4": "comment_audio",
  "audio/aac": "comment_audio",
  "audio/ogg": "comment_audio",
  "audio/wav": "comment_audio",
  "audio/x-wav": "comment_audio",
  "audio/webm": "comment_audio",
  "audio/x-m4a": "comment_audio",
};

export interface CommentUploadValidation {
  storedKind: StoredFileKind;
}

/** Pure upload validation — the stored kind when OK, else the Bangla rejection. */
export function validateCommentUpload(
  mime: string,
  sizeBytes: number,
): CommentUploadValidation | string {
  const storedKind = COMMENT_MIME_KIND[mime];
  if (!storedKind) return COMMENT_FILE_ERRORS_BN.badMime;
  if (sizeBytes <= 0) return COMMENT_FILE_ERRORS_BN.badMime;
  if (sizeBytes > MAX_COMMENT_ATTACHMENT_BYTES) return COMMENT_FILE_ERRORS_BN.tooLarge;
  return { storedKind };
}

/**
 * Default-deny read gate for GET /files/:id when the file is a comment attachment.
 * Allow the comment's AUTHOR (any state) OR a guardian of the child for a DELIVERED
 * comment (D-#68). An undelivered comment's attachment is author-only; everyone else
 * (other staff, unauthenticated) is denied.
 */
export async function assertCommentFileReadAccess(
  ctx: AppContext,
  file: IStoredFile,
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError(COMMENT_FILE_ERRORS_BN.forbidden);
  if (!file.studentCommentId) throw new ForbiddenError(COMMENT_FILE_ERRORS_BN.notReadable);

  const comment = (await StudentComment.findById(file.studentCommentId)
    .select("authorUserId studentId deliveredAt")
    .lean()) as unknown as Pick<IStudentComment, "authorUserId" | "studentId" | "deliveredAt"> | null;
  if (!comment) throw new ForbiddenError(COMMENT_FILE_ERRORS_BN.notFound);

  // The author may always read their own attachment (any delivery state).
  if (comment.authorUserId.toString() === ctx.auth.userId) return;

  // The Principal/Office reviewers (the comment-delivery authority, D-#264) may view
  // any comment attachment (so they can review what's attached before releasing it).
  if (ctx.auth.role === "PRINCIPAL" || ctx.auth.role === "OFFICE") return;

  // Otherwise: a guardian of the child, and only once the comment is DELIVERED.
  if (!comment.deliveredAt) throw new ForbiddenError(COMMENT_FILE_ERRORS_BN.notReadable);
  await assertGuardianOfStudent(ctx, comment.studentId.toString());
}

/** Resolve the comment a file is being uploaded against (the upload-route gate input):
 *  loads the comment, returns its section + author + delivery state; throws if missing. */
export async function loadCommentForUpload(
  commentId: string,
): Promise<{ sectionId: string; authorUserId: string; delivered: boolean }> {
  if (!Types.ObjectId.isValid(commentId)) throw new ForbiddenError(COMMENT_FILE_ERRORS_BN.notFound);
  const comment = (await StudentComment.findById(commentId)
    .select("sectionId authorUserId deliveredAt")
    .lean()) as unknown as { sectionId: Types.ObjectId; authorUserId: Types.ObjectId; deliveredAt?: Date } | null;
  if (!comment) throw new ForbiddenError(COMMENT_FILE_ERRORS_BN.notFound);
  return {
    sectionId: comment.sectionId.toString(),
    authorUserId: comment.authorUserId.toString(),
    delivered: !!comment.deliveredAt,
  };
}
