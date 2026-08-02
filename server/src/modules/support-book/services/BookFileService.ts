/**
 * BookFileService — upload validation + the read gate for book-production files
 * (SB-2, D-#409).
 *
 * Reuses the GP-A Drive store rather than growing a twin: new `book_*` kinds on
 * `StoredFile`, a nested Drive path, and this gate. `driveFileId` never leaves the
 * server — clients only ever stream through `GET /files/:id`.
 *
 * THE READ GATE IS DELIBERATELY SIMPLE: any holder of `book:read` may read any book
 * file. Book production carries no student, guardian or staff PII — it is artwork and
 * page images for a textbook — so the per-row scoping that homework and chat files
 * need (where the file IS a child's work) has nothing to scope BY here. The gate that
 * matters is the module boundary itself: `book:read` is granted per user via AC-1, so
 * a teacher with no production role sees nothing.
 */
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { callerHasPermission } from "@scd/shared";
import type { IStoredFile, StoredFileKind } from "../../platform/models/StoredFile";
import type { ArtifactStage } from "@scd/shared";

/** Per-file hard limit. Book artwork clears the DPI floor at ~2200px on the short
 *  side, which is a few MB as PNG; 25 MB leaves generous headroom for a large
 *  print-colour page without inviting a video. */
export const MAX_BOOK_IMAGE_BYTES = 25 * 1024 * 1024;
/** A rendered edition is far larger — a 54-lesson colour book with 201 images. */
export const MAX_BOOK_PDF_BYTES = 300 * 1024 * 1024;

export const BOOK_FILE_ERRORS_BN = {
  badMime: "শুধু PNG, JPEG বা PDF ফাইল আপলোড করা যাবে",
  tooLargeImage: "ছবির আকার সর্বোচ্চ ২৫ মেগাবাইট",
  tooLargePdf: "পিডিএফের আকার সর্বোচ্চ ৩০০ মেগাবাইট",
  forbidden: "অনুমতি নেই",
  badStage: "অজানা স্টেজ",
} as const;

const IMAGE_MIMES = new Set(["image/png", "image/jpeg"]);

/** Map an artifact stage to its StoredFile kind. RAW artwork and an APPROVED pick are
 *  the same bytes at different standing, so both land in `book_image_raw` until the
 *  illustrator approves one — the ASSET row carries the stage, the file kind only
 *  needs to say "this is book artwork". */
export function kindForStage(stage: ArtifactStage): StoredFileKind {
  switch (stage) {
    case "APPROVED": return "book_image_approved";
    case "COMPLIANT": return "book_image_compliant";
    default: return "book_image_raw"; // CROPPED / UPSCALED are intermediate artifacts
  }
}

/** Null when the upload is acceptable, else the Bangla rejection. */
export function validateBookUpload(mime: string, sizeBytes: number, isPdf: boolean): string | null {
  if (isPdf) {
    if (mime !== "application/pdf") return BOOK_FILE_ERRORS_BN.badMime;
    if (sizeBytes > MAX_BOOK_PDF_BYTES) return BOOK_FILE_ERRORS_BN.tooLargePdf;
    return null;
  }
  if (!IMAGE_MIMES.has(mime)) return BOOK_FILE_ERRORS_BN.badMime;
  if (sizeBytes > MAX_BOOK_IMAGE_BYTES) return BOOK_FILE_ERRORS_BN.tooLargeImage;
  return null;
}

/** The Drive path for a book artifact. The tree is what lets a file found from the
 *  Drive side identify itself; `appProperties` carries the same facts as metadata. */
export function bookDrivePath(bookId: string, stage: ArtifactStage): string {
  return `books/${bookId}/${stage.toLowerCase()}`;
}

/** `GET /files/:id` gate for a book file. */
export function assertBookFileReadAccess(ctx: AppContext, _file: IStoredFile): void {
  if (!ctx.auth || !callerHasPermission(ctx.auth, "book:read")) {
    throw new ForbiddenError(BOOK_FILE_ERRORS_BN.forbidden);
  }
}
