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
 *   POST /files/chat — staff upload for a chat attachment (M-4, JWT + chat:write
 *                      + membership of `conversationId`). Multipart `file` +
 *                      field/query `conversationId`. Validates mime ∈ image/pdf/
 *                      video/audio + size ≤ 10 MB, streams to the Drive `chat`
 *                      folder, persists StoredFile (chat kind + conversationId),
 *                      returns { fileId, kind, ... }. Then `sendMessage` binds it.
 *   GET  /files/:id  — JWT-authed download. Default-deny authz FIRST, DISPATCHED
 *                      BY KIND (hw → HomeworkFile read scope / guardian link;
 *                      chat → ChatFile conversation membership), THEN the server
 *                      fetches from Drive and streams to the client.
 */
import type { Router, Request, Response } from "express";
import express, { Router as createRouter } from "express";
import multer from "multer";
import { buildContext } from "../context";
import { assertClassNoteFileReadAccess } from "../modules/routine/services/ClassNoteFileService";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../middleware/authz";
import {
  StoredFile,
  CHAT_STORED_FILE_KINDS,
  COMMENT_STORED_FILE_KINDS,
  type IStoredFile,
  type StoredFileKind,
} from "../modules/platform/models/StoredFile";
import {
  uploadToDrive,
  downloadFromDrive,
  DriveUnavailableError,
} from "../modules/platform/services/DriveStore";
import { assertFileReadAccess } from "../modules/trackers/services/HomeworkFileService";
import { assertClassTestFileReadAccess } from "../modules/trackers/services/ClassTestFileService";
import { assertAssignmentFileReadAccess } from "../modules/trackers/services/AssignmentFileService";
import {
  validateChatUpload,
  assertChatFileReadAccess,
  MAX_CHAT_ATTACHMENT_BYTES,
  CHAT_FILE_ERRORS_BN,
} from "../modules/chat/services/ChatFileService";
import { assertChatMember } from "../modules/chat/services/ChatService";
import {
  validateCommentUpload,
  assertCommentFileReadAccess,
  loadCommentForUpload,
  MAX_COMMENT_ATTACHMENT_BYTES,
  COMMENT_FILE_ERRORS_BN,
} from "../modules/comments/services/CommentFileService";
import { assertCanWrite } from "../middleware/authz";
import { StudentComment } from "../modules/comments/models/StudentComment";
import { writeAudit } from "../modules/platform/services/AuditService";

export const ALLOWED_FILE_MIMES = ["image/jpeg", "image/png", "application/pdf"] as const;
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB (prd-guardian-portal §5)

export const FILE_ERRORS_BN = {
  badMime: "শুধু JPEG, PNG বা PDF ফাইল সংযুক্ত করা যাবে",
  tooLarge: "ফাইলের আকার সর্বোচ্চ ৫ মেগাবাইট",
  driveDown: "এই মুহূর্তে ফাইলটি আপলোড করা যাচ্ছে না — পরে আবার চেষ্টা করুন",
  driveDownRead: "এই মুহূর্তে ফাইলটি খোলা যাচ্ছে না",
  forbidden: "অনুমতি নেই",
} as const;

/** multer/busboy decode the multipart filename header as latin1, so a UTF-8 Bangla
 *  filename (e.g. অধ্যায় ০৪ - পদার্থ.pdf) arrives as mojibake. Re-interpret the bytes
 *  as UTF-8. Pure ASCII round-trips unchanged, so this is safe for every filename. */
export function decodeUploadName(name: string): string {
  return Buffer.from(name, "latin1").toString("utf8");
}

/** Pure upload validation — null when OK, else the Bangla rejection. */
export function validateUpload(mime: string, sizeBytes: number): string | null {
  if (!(ALLOWED_FILE_MIMES as readonly string[]).includes(mime)) return FILE_ERRORS_BN.badMime;
  if (sizeBytes > MAX_FILE_BYTES) return FILE_ERRORS_BN.tooLarge;
  if (sizeBytes <= 0) return FILE_ERRORS_BN.badMime;
  return null;
}

// Class-note attachments (Feature: class notes get attachments) — jpeg/png/pdf ≤ 10 MB,
// up to 5 per note (the 5-file cap is enforced where attachmentIds are bound).
export const MAX_CLASSNOTE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CLASSNOTE_ATTACHMENTS = 5;
export function validateClassNoteUpload(mime: string, sizeBytes: number): string | null {
  if (!(ALLOWED_FILE_MIMES as readonly string[]).includes(mime)) return FILE_ERRORS_BN.badMime;
  if (sizeBytes > MAX_CLASSNOTE_ATTACHMENT_BYTES) return FILE_ERRORS_BN.tooLarge;
  if (sizeBytes <= 0) return FILE_ERRORS_BN.badMime;
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES + 1 }, // +1 so OUR size check produces the Bangla message
});

// Chat attachments are larger (10 MB, prd §5) — a separate limit so OUR Bangla
// size check fires rather than a bare multer error.
const uploadChat = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHAT_ATTACHMENT_BYTES + 1 },
});

// Comment attachments share the chat 10 MB cap (D-#108) — a separate limit so OUR
// Bangla size check fires rather than a bare multer error.
const uploadComment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_COMMENT_ATTACHMENT_BYTES + 1 },
});

// Class-note attachments — 10 MB cap so OUR Bangla size check fires (not a bare multer error).
const uploadClassNote = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CLASSNOTE_ATTACHMENT_BYTES + 1 },
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
  if (!ctx.auth || !callerHasPermission(ctx.auth, "tracker:write")) {
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
      name: `${Date.now()}_${decodeUploadName(file.originalname)}`,
      mime: file.mimetype,
      data: file.buffer,
      year: String(new Date().getFullYear()),
    });
    const stored = await StoredFile.create({
      kind,
      mime: file.mimetype,
      sizeBytes: file.size,
      originalName: decodeUploadName(file.originalname),
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
// POST /files/chat — staff upload a chat attachment (M-4, chat:write + member)
// ---------------------------------------------------------------------------

const parseChatUpload: express.RequestHandler = (req, res, next) => {
  uploadChat.single("file")(req, res, (err: unknown) => {
    if (err) {
      res.status(422).json({ error: CHAT_FILE_ERRORS_BN.tooLarge });
      return;
    }
    next();
  });
};

filesRouter.post("/chat", parseChatUpload, async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth || !callerHasPermission(ctx.auth, "chat:write")) {
    res.status(403).json({ error: CHAT_FILE_ERRORS_BN.forbidden });
    return;
  }

  const conversationId = (req.body?.conversationId ?? req.query.conversationId) as string | undefined;
  if (!conversationId) {
    res.status(400).json({ error: "conversationId required" });
    return;
  }
  // Membership gate — you may only upload into a conversation you belong to.
  try {
    await assertChatMember(conversationId, ctx.auth.userId);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      res.status(403).json({ error: e.message || CHAT_FILE_ERRORS_BN.forbidden });
      return;
    }
    throw e;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "file field missing" });
    return;
  }
  const validation = validateChatUpload(file.mimetype, file.size);
  if (typeof validation === "string") {
    res.status(422).json({ error: validation });
    return;
  }

  try {
    // Drive FIRST — only a successful upload persists metadata (the GP-J8 posture).
    const driveFileId = await uploadToDrive({
      name: `${Date.now()}_${decodeUploadName(file.originalname)}`,
      mime: file.mimetype,
      data: file.buffer,
      year: String(new Date().getFullYear()),
      subfolder: "chat",
    });
    const stored = await StoredFile.create({
      kind: validation.storedKind,
      mime: file.mimetype,
      sizeBytes: file.size,
      originalName: decodeUploadName(file.originalname),
      driveFileId, // server-internal — NOT in the response below
      uploadedBy: ctx.auth.userId,
      conversationId,
    });
    await writeAudit({
      eventKind: "CHAT_ATTACHMENT_UPLOADED",
      actorId: ctx.auth.userId,
      targetId: stored._id,
      targetKind: "StoredFile",
      meta: { kind: validation.kind, conversationId, sizeBytes: file.size },
    });
    res.json({
      fileId: stored._id.toString(),
      kind: validation.kind,
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
// POST /files/classtest — teacher uploads their own class-test paper (CT-1,
// prd-tracker-class-test §5.2). tracker:write + jpeg/png/pdf ≤ 5 MB (GP-A cap,
// reuses validateUpload). The uploader is the requesting teacher; the returned
// fileId is then carried into createClassTestRequest as questionFileId.
// ---------------------------------------------------------------------------

filesRouter.post("/classtest", parseUpload, async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth || !callerHasPermission(ctx.auth, "tracker:write")) {
    res.status(403).json({ error: FILE_ERRORS_BN.forbidden });
    return;
  }

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
    // Drive FIRST — only a successful upload persists metadata (GP-J8 posture).
    const driveFileId = await uploadToDrive({
      name: `${Date.now()}_${decodeUploadName(file.originalname)}`,
      mime: file.mimetype,
      data: file.buffer,
      year: String(new Date().getFullYear()),
      subfolder: "classtest",
    });
    const stored = await StoredFile.create({
      kind: "classtest_question" as StoredFileKind,
      mime: file.mimetype,
      sizeBytes: file.size,
      originalName: decodeUploadName(file.originalname),
      driveFileId, // server-internal — NOT in the response below
      uploadedBy: ctx.auth.userId,
    });
    res.json({
      fileId: stored._id.toString(),
      kind: "classtest_question",
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
// POST /files/classnote — staff attach a file to a class note (≤ 10 MB, jpeg/png/pdf).
// The 5-per-note cap is enforced when attachmentIds are bound (publish/update). Read
// gate = staff routine:read. tracker/routine publisher then carries the fileId along.
// ---------------------------------------------------------------------------

const parseClassNoteUpload: express.RequestHandler = (req, res, next) => {
  uploadClassNote.single("file")(req, res, (err: unknown) => {
    if (err) {
      res.status(422).json({ error: FILE_ERRORS_BN.tooLarge });
      return;
    }
    next();
  });
};

filesRouter.post("/classnote", parseClassNoteUpload, async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth || !callerHasPermission(ctx.auth, "routine:read")) {
    res.status(403).json({ error: FILE_ERRORS_BN.forbidden });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "file field missing" });
    return;
  }
  const rejection = validateClassNoteUpload(file.mimetype, file.size);
  if (rejection) {
    res.status(422).json({ error: rejection });
    return;
  }
  try {
    const driveFileId = await uploadToDrive({
      name: `${Date.now()}_${decodeUploadName(file.originalname)}`,
      mime: file.mimetype,
      data: file.buffer,
      year: String(new Date().getFullYear()),
      subfolder: "classnote",
    });
    const stored = await StoredFile.create({
      kind: "classnote_attachment" as StoredFileKind,
      mime: file.mimetype,
      sizeBytes: file.size,
      originalName: decodeUploadName(file.originalname),
      driveFileId,
      uploadedBy: ctx.auth.userId,
    });
    res.json({
      fileId: stored._id.toString(),
      kind: "classnote_attachment",
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
// POST /files/assignment — a teacher uploads an assignment sheet/instruction file
// for the delivery pass (D-#298). Same envelope as /files/classnote: ≤ 10 MB,
// jpeg/png/pdf, Drive-first. The ≤5-per-item cap is enforced when the ids are
// bound at deliverAssignment. Upload gate = tracker:write (who may deliver).
// ---------------------------------------------------------------------------

filesRouter.post("/assignment", parseClassNoteUpload, async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth || !callerHasPermission(ctx.auth, "tracker:write")) {
    res.status(403).json({ error: FILE_ERRORS_BN.forbidden });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "file field missing" });
    return;
  }
  const rejection = validateClassNoteUpload(file.mimetype, file.size); // same 10 MB / jpeg-png-pdf envelope
  if (rejection) {
    res.status(422).json({ error: rejection });
    return;
  }
  try {
    const driveFileId = await uploadToDrive({
      name: `${Date.now()}_${decodeUploadName(file.originalname)}`,
      mime: file.mimetype,
      data: file.buffer,
      year: String(new Date().getFullYear()),
      subfolder: "assignment",
    });
    const stored = await StoredFile.create({
      kind: "assignment_attachment" as StoredFileKind,
      mime: file.mimetype,
      sizeBytes: file.size,
      originalName: decodeUploadName(file.originalname),
      driveFileId,
      uploadedBy: ctx.auth.userId,
    });
    res.json({
      fileId: stored._id.toString(),
      kind: "assignment_attachment",
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
// POST /files/print — a teacher uploads a document to send to the Office for
// printing (PQ-2, D-#281). Same envelope as /files/classnote: ≤ 10 MB, jpeg/png/pdf,
// Drive-first (a Drive failure persists nothing). The ≤5-files-per-request cap is
// enforced when the ids are bound to a PrintRequest (`validateSource`). Upload gate =
// `tracker:write`, matching who may file a request at all.
// ---------------------------------------------------------------------------

filesRouter.post("/print", parseClassNoteUpload, async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth || !callerHasPermission(ctx.auth, "tracker:write")) {
    res.status(403).json({ error: FILE_ERRORS_BN.forbidden });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "file field missing" });
    return;
  }
  const rejection = validateClassNoteUpload(file.mimetype, file.size); // same 10 MB / jpeg-png-pdf envelope
  if (rejection) {
    res.status(422).json({ error: rejection });
    return;
  }
  try {
    const driveFileId = await uploadToDrive({
      name: `${Date.now()}_${decodeUploadName(file.originalname)}`,
      mime: file.mimetype,
      data: file.buffer,
      year: String(new Date().getFullYear()),
      subfolder: "print",
    });
    const stored = await StoredFile.create({
      kind: "print_upload" as StoredFileKind,
      mime: file.mimetype,
      sizeBytes: file.size,
      originalName: decodeUploadName(file.originalname),
      driveFileId,
      uploadedBy: ctx.auth.userId,
    });
    res.json({
      fileId: stored._id.toString(),
      kind: "print_upload",
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
// POST /files/comment — teacher attaches a file to a daily student comment (CM-2,
// prd-comments-meetings §5). tracker:write + the comment's section verified
// server-side; MIME image/pdf/video/audio ≤ 10 MB (chat parity, D-#108); Drive-first
// ⇒ 503 + nothing persisted (GP-J8). The comment must exist + not yet be delivered
// (a delivered comment is immutable, §3). The file binds to the comment via
// studentCommentId + is added to the comment's attachmentIds.
// ---------------------------------------------------------------------------

const parseCommentUpload: express.RequestHandler = (req, res, next) => {
  uploadComment.single("file")(req, res, (err: unknown) => {
    if (err) {
      res.status(422).json({ error: COMMENT_FILE_ERRORS_BN.tooLarge });
      return;
    }
    next();
  });
};

filesRouter.post("/comment", parseCommentUpload, async (req: Request, res: Response) => {
  const ctx = buildContext(req, res);
  if (!ctx.auth) {
    res.status(403).json({ error: COMMENT_FILE_ERRORS_BN.forbidden });
    return;
  }

  const commentId = (req.body?.commentId ?? req.query.commentId) as string | undefined;
  if (!commentId) {
    res.status(400).json({ error: "commentId required" });
    return;
  }

  // Resolve the comment's author + delivery state, then gate: the comment AUTHOR or a
  // Principal/Office reviewer may attach, pre-delivery (mirrors editComment, D-#263/#264).
  let target: { sectionId: string; authorUserId: string; delivered: boolean };
  try {
    target = await loadCommentForUpload(commentId);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      res.status(404).json({ error: e.message || COMMENT_FILE_ERRORS_BN.notFound });
      return;
    }
    throw e;
  }
  if (target.delivered) {
    res.status(409).json({ error: "একটি ডেলিভার হওয়া মন্তব্যে ফাইল সংযুক্ত করা যাবে না" });
    return;
  }
  const isAuthor = target.authorUserId === ctx.auth.userId;
  const isReviewer = callerHasPermission(ctx.auth, "roster:manage"); // Principal/Office
  if (!isAuthor && !isReviewer) {
    res.status(403).json({ error: COMMENT_FILE_ERRORS_BN.forbidden });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "file field missing" });
    return;
  }
  const validation = validateCommentUpload(file.mimetype, file.size);
  if (typeof validation === "string") {
    res.status(422).json({ error: validation });
    return;
  }

  try {
    // Drive FIRST — only a successful upload persists metadata (the GP-J8 posture).
    const driveFileId = await uploadToDrive({
      name: `${Date.now()}_${decodeUploadName(file.originalname)}`,
      mime: file.mimetype,
      data: file.buffer,
      year: String(new Date().getFullYear()),
      subfolder: "comments",
    });
    const stored = await StoredFile.create({
      kind: validation.storedKind,
      mime: file.mimetype,
      sizeBytes: file.size,
      originalName: decodeUploadName(file.originalname),
      driveFileId, // server-internal — NOT in the response below
      uploadedBy: ctx.auth.userId,
      studentCommentId: commentId,
    });
    // Bind the file to the comment (the staff/guardian views read attachmentIds).
    await StudentComment.updateOne({ _id: commentId }, { $addToSet: { attachmentIds: stored._id } });
    res.json({
      fileId: stored._id.toString(),
      kind: validation.storedKind,
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
    // Dispatch the read gate by the file's OWN kind (not by how it's referenced),
    // so a chat message can never re-expose a homework file and vice-versa.
    if ((CHAT_STORED_FILE_KINDS as readonly string[]).includes(file.kind)) {
      await assertChatFileReadAccess(ctx, file);
    } else if ((COMMENT_STORED_FILE_KINDS as readonly string[]).includes(file.kind)) {
      await assertCommentFileReadAccess(ctx, file);
    } else if (file.kind === "classtest_question") {
      await assertClassTestFileReadAccess(ctx, file);
    } else if (file.kind === "classnote_attachment") {
      // Staff read under routine:read. A GUARDIAN may read one too, but only an
      // attachment on a note for a group their own child sits in — the file carries no
      // back-reference, so the gate reverse-resolves the owning ClassNote.
      if (!callerHasPermission(ctx.auth, "routine:read")) {
        await assertClassNoteFileReadAccess(ctx, file._id.toString());
      }
    } else if (file.kind === "assignment_attachment") {
      await assertAssignmentFileReadAccess(ctx, file);
    } else if (file.kind === "print_upload") {
      // A print upload is readable by the teacher who sent it and by the Office/Principal
      // who has to print it (PQ-2, D-#281) — nobody else.
      const isUploader = file.uploadedBy?.toString() === ctx.auth.userId;
      if (!isUploader && !callerHasPermission(ctx.auth, "roster:manage")) {
        throw new ForbiddenError(FILE_ERRORS_BN.forbidden);
      }
    } else {
      await assertFileReadAccess(ctx, file);
    }
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
