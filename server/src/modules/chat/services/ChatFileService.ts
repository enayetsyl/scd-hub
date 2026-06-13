/**
 * ChatFileService (M-4, prd-messaging §5/§9, D-#102) — chat attachments on the
 * REUSED GP-A Drive store (StoredFile + DriveStore), NOT a twin upload path.
 *
 *   validateChatUpload  — MIME whitelist per ATTACHMENT_KINDS + the 10 MB hard
 *                         cap; returns the attachment kind or a Bangla rejection.
 *   assertChatFileReadAccess — the GET /files/:id gate for a chat file: the
 *                         caller must be a member of SOME conversation that has a
 *                         LIVE (non-deleted) message referencing the file. A
 *                         deleted message's attachment therefore becomes
 *                         inaccessible (prd M-4 acceptance) while still retained
 *                         in the MESSAGE_DELETED audit.
 *   attachmentsForMessages — batch-load attachment metadata for a message page
 *                         (no driveFileId ever leaves the server).
 *
 * Identity-plane (ADR-005) — chat files name staff + conversations, no corpus
 * path. The upload route gates on chat:write + conversation membership; the
 * sendMessage binding (in ChatService) ensures only the uploader's own files,
 * uploaded FOR that conversation, can be attached.
 */
import { Types } from "mongoose";
import { ATTACHMENT_KINDS, type AttachmentKind } from "@scd/shared";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  StoredFile,
  CHAT_STORED_FILE_KINDS,
  type IStoredFile,
  type StoredFileKind,
} from "../../platform/models/StoredFile";
import { ChatMessage } from "../models/ChatMessage";
import { ConversationMember } from "../models/ConversationMember";

/** Per-file hard limit — 10 MB exactly (prd §5/§7, settled choice #7). */
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10,485,760

export const CHAT_FILE_ERRORS_BN = {
  badMime: "শুধু ছবি, পিডিএফ, ভিডিও বা অডিও ফাইল পাঠানো যাবে",
  tooLarge: "ফাইলের আকার সর্বোচ্চ ১০ মেগাবাইট",
  forbidden: "অনুমতি নেই",
  notAttached: "ফাইলটি কোনো বার্তার সাথে যুক্ত নয়",
} as const;

/** MIME → ATTACHMENT_KIND whitelist (per ATTACHMENT_KINDS = IMAGE/PDF/VIDEO/AUDIO). */
const CHAT_MIME_KIND: Record<string, AttachmentKind> = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/gif": "IMAGE",
  "image/webp": "IMAGE",
  "application/pdf": "PDF",
  "video/mp4": "VIDEO",
  "video/webm": "VIDEO",
  "video/quicktime": "VIDEO",
  "audio/mpeg": "AUDIO",
  "audio/mp4": "AUDIO",
  "audio/aac": "AUDIO",
  "audio/ogg": "AUDIO",
  "audio/wav": "AUDIO",
  "audio/x-wav": "AUDIO",
  "audio/webm": "AUDIO",
  "audio/x-m4a": "AUDIO",
};

/** The StoredFile.kind for an attachment kind: IMAGE → "chat_image", etc. */
export function storedFileKindFor(kind: AttachmentKind): StoredFileKind {
  return `chat_${kind.toLowerCase()}` as StoredFileKind;
}

/** The ATTACHMENT_KIND for a chat StoredFile.kind: "chat_image" → IMAGE, etc. */
export function attachmentKindFor(stored: StoredFileKind): AttachmentKind {
  const upper = stored.replace(/^chat_/, "").toUpperCase();
  return (ATTACHMENT_KINDS as readonly string[]).includes(upper)
    ? (upper as AttachmentKind)
    : "PDF";
}

export interface ChatUploadValidation {
  kind: AttachmentKind;
  storedKind: StoredFileKind;
}

/** Pure upload validation — the kind when OK, else the Bangla rejection. */
export function validateChatUpload(
  mime: string,
  sizeBytes: number,
): ChatUploadValidation | string {
  const kind = CHAT_MIME_KIND[mime];
  if (!kind) return CHAT_FILE_ERRORS_BN.badMime;
  if (sizeBytes <= 0) return CHAT_FILE_ERRORS_BN.badMime;
  if (sizeBytes > MAX_CHAT_ATTACHMENT_BYTES) return CHAT_FILE_ERRORS_BN.tooLarge;
  return { kind, storedKind: storedFileKindFor(kind) };
}

/**
 * Default-deny read gate for GET /files/:id when the file is a chat attachment.
 * Allow only if the caller is a member of SOME conversation holding a LIVE
 * message that references the file (a deleted message no longer grants access).
 */
export async function assertChatFileReadAccess(
  ctx: AppContext,
  file: IStoredFile,
): Promise<void> {
  if (!ctx.auth) throw new ForbiddenError(CHAT_FILE_ERRORS_BN.forbidden);

  // `deletedAt: null` matches both unset and null — i.e. only LIVE messages.
  const refs = (await ChatMessage.find({ attachmentIds: file._id, deletedAt: null })
    .select("conversationId")
    .lean()) as unknown as Array<{ conversationId: Types.ObjectId }>;
  if (refs.length === 0) throw new ForbiddenError(CHAT_FILE_ERRORS_BN.notAttached);

  const conversationIds = [...new Set(refs.map((m) => m.conversationId.toString()))];
  const member = await ConversationMember.findOne({
    conversationId: { $in: conversationIds.map((id) => new Types.ObjectId(id)) },
    userId: new Types.ObjectId(ctx.auth.userId),
  }).lean();
  if (!member) throw new ForbiddenError(CHAT_FILE_ERRORS_BN.forbidden);
}

export interface AttachmentView {
  fileId: string;
  kind: AttachmentKind;
  mime: string;
  sizeBytes: number;
  originalName: string;
}

function toView(f: IStoredFile): AttachmentView {
  return {
    fileId: f._id.toString(),
    kind: attachmentKindFor(f.kind),
    mime: f.mime,
    sizeBytes: f.sizeBytes,
    originalName: f.originalName,
  };
}

/** Attachment metadata for MANY messages in one query, grouped by file id —
 *  the thread resolver maps each message's attachmentIds through this. The
 *  driveFileId is never selected/returned. */
export async function attachmentsForFileIds(
  fileIds: string[],
): Promise<Map<string, AttachmentView>> {
  const byId = new Map<string, AttachmentView>();
  if (fileIds.length === 0) return byId;
  const oids = [...new Set(fileIds)].map((id) => new Types.ObjectId(id));
  const rows = (await StoredFile.find({ _id: { $in: oids } })
    .select("kind mime sizeBytes originalName")
    .lean()) as unknown as IStoredFile[];
  for (const f of rows) byId.set(f._id.toString(), toView(f));
  return byId;
}

/** Validate the attachments a member is attaching to a NEW message: each must
 *  be a CHAT file the sender uploaded FOR this conversation (the upload-time
 *  binding). Prevents attaching another user's file or a file from another
 *  conversation / another module (hw). Returns the ObjectIds to persist. */
export async function resolveSendAttachments(
  attachmentIds: string[],
  senderId: string,
  conversationId: string,
): Promise<Types.ObjectId[]> {
  const ids = [...new Set(attachmentIds)];
  if (ids.length === 0) return [];
  const files = (await StoredFile.find({
    _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
  }).lean()) as unknown as IStoredFile[];
  const byId = new Map(files.map((f) => [f._id.toString(), f]));

  const resolved: Types.ObjectId[] = [];
  for (const id of ids) {
    const f = byId.get(id);
    if (
      !f ||
      !(CHAT_STORED_FILE_KINDS as readonly string[]).includes(f.kind) ||
      f.uploadedBy.toString() !== senderId ||
      f.conversationId?.toString() !== conversationId
    ) {
      // ChatService catches this and rethrows the Bangla ChatError.
      throw new ChatAttachmentError(`invalid attachment ${id}`);
    }
    resolved.push(f._id);
  }
  return resolved;
}

/** Thrown by resolveSendAttachments; ChatService maps it to a Bangla ChatError. */
export class ChatAttachmentError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ChatAttachmentError";
  }
}
