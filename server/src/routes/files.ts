/**
 * Homework file transport (GP-A, D-#70) — the thin HTTP surface beside /pdf
 * (ADR-003). THE SERVER IS ALWAYS IN THE MIDDLE: bytes stream through here;
 * no Drive id, URL, or redirect ever reaches any client.
 *
 *   POST /files/hw   — staff upload (JWT + tracker:write). Multipart field
 *                      `file` + field/query `kind` = question|answer. Validates
 *                      mime ∈ {jpeg,png,pdf} + size ≤ 5 MB, streams to Drive,
 *                      persists StoredFile, returns { fileId, ... }. On Drive
 *                      failure: Bangla error, NOTHING persisted (GP-J8) — the
 *                      declare/check flow is never blocked by a file.
 *   GET  /files/:id  — JWT-authed download. Default-deny authz FIRST
 *                      (HomeworkFileService.assertFileReadAccess: staff read
 *                      scope / guardian link gate), THEN the server fetches
 *                      from Drive and streams to the client.
 */
import type { Router, Request, Response } from "express";
import express, { Router as createRouter } from "express";
import multer from "multer";
import { buildContext } from "../context";
import { roleHasPermission, type Role } from "@scd/shared";
import { ForbiddenError } from "../middleware/authz";
import { StoredFile, type IStoredFile, type StoredFileKind } from "../modules/platform/models/StoredFile";
import {
  uploadToDrive,
  downloadFromDrive,
  DriveUnavailableError,
} from "../modules/platform/services/DriveStore";
import { assertFileReadAccess } from "../modules/trackers/services/HomeworkFileService";

export const ALLOWED_FILE_MIMES = ["image/jpeg", "image/png", "application/pdf"] as const;
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB (prd-guardian-portal §5)

export const FILE_ERRORS_BN = {
  badMime: "শুধু JPEG, PNG বা PDF ফাইল সংযুক্ত করা যাবে",
  tooLarge: "ফাইলের আকার সর্বোচ্চ ৫ মেগাবাইট",
  driveDown: "এই মুহূর্তে ফাইলটি আপলোড করা যাচ্ছে না — পরে আবার চেষ্টা করুন",
  driveDownRead: "এই মুহূর্তে ফাইলটি খোলা যাচ্ছে না",
  forbidden: "অনুমতি নেই",
} as const;

/** Pure upload validation — null when OK, else the Bangla rejection. */
export function validateUpload(mime: string, sizeBytes: number): string | null {
  if (!(ALLOWED_FILE_MIMES as readonly string[]).includes(mime)) return FILE_ERRORS_BN.badMime;
  if (sizeBytes > MAX_FILE_BYTES) return FILE_ERRORS_BN.tooLarge;
  if (sizeBytes <= 0) return FILE_ERRORS_BN.badMime;
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES + 1 }, // +1 so OUR size check produces the Bangla message
});

export const filesRouter: Router = createRouter();

// ---------------------------------------------------------------------------
// POST /files/hw — staff upload (teachers attach; guardians never upload, D-#70)
// ---------------------------------------------------------------------------

// Multer errors (e.g. a body far over the limit) become the Bangla 422, not a 500.
const parseUpload: express.RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      res.status(422).json({ error: FILE_ERRORS_BN.tooLarge });
      return;
    }
    next();
  });
};

filesRouter.post("/hw", parseUpload, async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth || !roleHasPermission(ctx.auth.role as Role, "tracker:write")) {
    res.status(403).json({ error: FILE_ERRORS_BN.forbidden });
    return;
  }

  const kindArg = (req.body?.kind ?? req.query.kind) as string | undefined;
  if (kindArg !== "question" && kindArg !== "answer") {
    res.status(400).json({ error: "kind must be question or answer" });
    return;
  }
  const kind: StoredFileKind = kindArg === "question" ? "hw_question" : "hw_answer";

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "file field missing" });
    return;
  }
  const rejection = validateUpload(file.mimetype, file.size);
  if (rejection) {
    res.status(422).json({ error: rejection });
    return;
  }

  try {
    // Drive FIRST — only a successful upload persists metadata (GP-J8).
    const driveFileId = await uploadToDrive({
      name: `${Date.now()}_${file.originalname}`,
      mime: file.mimetype,
      data: file.buffer,
      year: String(new Date().getFullYear()),
    });
    const stored = await StoredFile.create({
      kind,
      mime: file.mimetype,
      sizeBytes: file.size,
      originalName: file.originalname,
      driveFileId, // server-internal — NOT in the response below
      uploadedBy: ctx.auth.userId,
    });
    res.json({
      fileId: stored._id.toString(),
      kind,
      mime: stored.mime,
      sizeBytes: stored.sizeBytes,
      originalName: stored.originalName,
    });
  } catch (e) {
    if (e instanceof DriveUnavailableError) {
      res.status(503).json({ error: FILE_ERRORS_BN.driveDown });
      return;
    }
    throw e;
  }
});

// ---------------------------------------------------------------------------
// GET /files/:id — authz first, then stream from Drive (no redirect, ever)
// ---------------------------------------------------------------------------

filesRouter.get("/:id", async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(403).json({ error: FILE_ERRORS_BN.forbidden });
    return;
  }

  let file: IStoredFile | null = null;
  try {
    file = (await StoredFile.findById(req.params.id).lean()) as unknown as IStoredFile | null;
  } catch {
    file = null; // malformed id → 404 below
  }
  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  try {
    await assertFileReadAccess(ctx, file);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      res.status(403).json({ error: e.message || FILE_ERRORS_BN.forbidden });
      return;
    }
    throw e;
  }

  try {
    const data = await downloadFromDrive(file.driveFileId);
    res.setHeader("Content-Type", file.mime);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(file.originalName)}"`,
    );
    res.setHeader("Content-Length", data.byteLength);
    res.send(data);
  } catch (e) {
    if (e instanceof DriveUnavailableError) {
      res.status(503).json({ error: FILE_ERRORS_BN.driveDownRead });
      return;
    }
    throw e;
  }
});
