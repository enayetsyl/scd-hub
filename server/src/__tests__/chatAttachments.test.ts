/**
 * Messaging M-4 tests (prd-messaging §5 M-4, §9, D-#102) — chat attachments on
 * the REUSED GP-A Drive store (StoredFile + DriveStore), not a twin path.
 *
 * Pure validation — MIME whitelist (image/pdf/video/audio) + the 10 MB cap;
 *   the kind round-trip (ATTACHMENT_KIND ⇄ chat_* StoredFile kind).
 * Read gate — assertChatFileReadAccess: member of a conversation with a LIVE
 *   message referencing the file PASS; non-member DENY; a deleted-only reference
 *   DENY (J-M6 / M-4 acceptance: a deleted message's attachment is inaccessible).
 * Send binding — resolveSendAttachments admits only the sender's OWN chat files
 *   uploaded for THIS conversation; a foreign uploader / other conversation /
 *   non-chat (hw) kind / missing file is rejected. An attachment-only message
 *   (no body) is allowed; empty body + no attachments still rejected.
 * Route — POST /files/chat: chat:write + membership gated; >10 MB + bad MIME →
 *   Bangla 422; Drive failure → 503 + NOTHING persisted; the response carries
 *   fileId + kind but NEVER driveFileId. GET dispatches the chat gate by kind.
 *
 * DB-free: Mongoose models + DriveStore + AuditService mocked; routes via supertest.
 */
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { ForbiddenError } from "../middleware/authz";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const mockUpload = jest.fn();
const mockDownload = jest.fn();
jest.mock("../modules/platform/services/DriveStore", () => {
  const actual = jest.requireActual("../modules/platform/services/DriveStore");
  return {
    DriveUnavailableError: actual.DriveUnavailableError,
    uploadToDrive: (i: unknown) => mockUpload(i),
    downloadFromDrive: (id: unknown) => mockDownload(id),
  };
});

const mockStoredCreate = jest.fn();
const mockStoredFindById = jest.fn();
const mockStoredFind = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => {
  const actual = jest.requireActual("../modules/platform/models/StoredFile");
  return {
    ...actual,
    StoredFile: {
      create: (a: unknown) => mockStoredCreate(a),
      findById: (id: unknown) => ({ lean: () => mockStoredFindById(id) }),
      find: (q: unknown) => ({
        lean: () => mockStoredFind(q),
        select: () => ({ lean: () => mockStoredFind(q) }),
      }),
    },
  };
});

const mockConvFindById = jest.fn();
const mockConvUpdateOne = jest.fn();
jest.mock("../modules/chat/models/Conversation", () => ({
  ...jest.requireActual("../modules/chat/models/Conversation"),
  Conversation: {
    findById: (id: unknown) => ({ lean: () => mockConvFindById(id) }),
    updateOne: (f: unknown, u: unknown) => mockConvUpdateOne(f, u),
  },
}));

const mockMemberFindOne = jest.fn();
jest.mock("../modules/chat/models/ConversationMember", () => ({
  ConversationMember: { findOne: (f: unknown) => ({ lean: () => mockMemberFindOne(f) }) },
}));

const mockMsgFind = jest.fn();
const mockMsgFindById = jest.fn();
const mockMsgCreate = jest.fn();
jest.mock("../modules/chat/models/ChatMessage", () => ({
  ChatMessage: {
    find: (q: unknown) => ({ select: () => ({ lean: () => mockMsgFind(q) }) }),
    findById: (id: unknown) => ({ lean: () => mockMsgFindById(id) }),
    create: (d: unknown) => mockMsgCreate(d),
  },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import { filesRouter, FILE_ERRORS_BN } from "../routes/files";
import {
  validateChatUpload,
  storedFileKindFor,
  attachmentKindFor,
  assertChatFileReadAccess,
  resolveSendAttachments,
  ChatAttachmentError,
  MAX_CHAT_ATTACHMENT_BYTES,
  CHAT_FILE_ERRORS_BN,
} from "../modules/chat/services/ChatFileService";
import { sendMessage, ChatError } from "../modules/chat/services/ChatService";
import type { AppContext } from "../context";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const app = express();
app.use("/files", filesRouter);

const SECRET = process.env.JWT_SECRET ?? "dev-secret";
const token = (userId: string, role: string) => jwt.sign({ userId, role }, SECRET);

const ME = oid().toString();
const OTHER = oid().toString();
const CONV = oid().toString();
const OTHER_CONV = oid().toString();
const FILE_ID = oid();

const meTok = token(ME, "TEACHER");
const guardianTok = token(oid().toString(), "GUARDIAN");

const chatFile = {
  _id: FILE_ID,
  kind: "chat_image",
  mime: "image/jpeg",
  sizeBytes: 2048,
  originalName: "photo.jpg",
  driveFileId: "drive-internal-xyz",
  uploadedBy: new mongoose.Types.ObjectId(ME),
  conversationId: new mongoose.Types.ObjectId(CONV),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockConvFindById.mockResolvedValue({ _id: CONV, kind: "CUSTOM", active: true, postingPolicy: "OPEN" });
  mockConvUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockMemberFindOne.mockResolvedValue({ conversationId: CONV, userId: ME });
  mockMsgFind.mockResolvedValue([{ conversationId: new mongoose.Types.ObjectId(CONV) }]);
  mockMsgFindById.mockResolvedValue(null);
  mockMsgCreate.mockImplementation((d: Record<string, unknown>) =>
    Promise.resolve({ _id: oid(), ...d, createdAt: new Date() }),
  );
  mockUpload.mockResolvedValue("drive-internal-xyz");
  mockStoredCreate.mockImplementation(async (a: Record<string, unknown>) => ({ _id: FILE_ID, ...a }));
  mockStoredFindById.mockResolvedValue(chatFile);
  mockStoredFind.mockResolvedValue([chatFile]);
  mockWriteAudit.mockResolvedValue(undefined);
});

const ctxOf = (userId: string, role = "TEACHER"): AppContext =>
  ({ auth: { userId, role } } as unknown as AppContext);

// ===========================================================================
// validateChatUpload + kind maps (pure)
// ===========================================================================

describe("validateChatUpload", () => {
  test("accepts image/pdf/video/audio within 10 MB, mapping to the kind", () => {
    expect(validateChatUpload("image/png", 1024)).toMatchObject({ kind: "IMAGE", storedKind: "chat_image" });
    expect(validateChatUpload("application/pdf", 1024)).toMatchObject({ kind: "PDF", storedKind: "chat_pdf" });
    expect(validateChatUpload("video/mp4", 1024)).toMatchObject({ kind: "VIDEO", storedKind: "chat_video" });
    expect(validateChatUpload("audio/mpeg", 1024)).toMatchObject({ kind: "AUDIO", storedKind: "chat_audio" });
    expect(validateChatUpload("image/jpeg", MAX_CHAT_ATTACHMENT_BYTES)).toMatchObject({ kind: "IMAGE" });
  });
  test("rejects a non-whitelisted mime (Bangla)", () => {
    expect(validateChatUpload("application/zip", 1024)).toBe(CHAT_FILE_ERRORS_BN.badMime);
    expect(validateChatUpload("text/html", 1024)).toBe(CHAT_FILE_ERRORS_BN.badMime);
  });
  test("rejects > 10 MB and non-positive sizes (Bangla)", () => {
    expect(validateChatUpload("image/jpeg", MAX_CHAT_ATTACHMENT_BYTES + 1)).toBe(CHAT_FILE_ERRORS_BN.tooLarge);
    expect(validateChatUpload("image/jpeg", 0)).toBe(CHAT_FILE_ERRORS_BN.badMime);
  });
  test("the kind round-trips", () => {
    for (const k of ["IMAGE", "PDF", "VIDEO", "AUDIO"] as const) {
      expect(attachmentKindFor(storedFileKindFor(k))).toBe(k);
    }
  });
});

// ===========================================================================
// assertChatFileReadAccess — membership via a LIVE referencing message
// ===========================================================================

describe("assertChatFileReadAccess", () => {
  test("a member of a conversation with a LIVE referencing message may read", async () => {
    await expect(assertChatFileReadAccess(ctxOf(ME), chatFile as never)).resolves.toBeUndefined();
    // The reference lookup excludes deleted messages.
    expect(mockMsgFind).toHaveBeenCalledWith({ attachmentIds: chatFile._id, deletedAt: null });
  });

  test("a non-member is denied even though a live message references the file", async () => {
    mockMemberFindOne.mockResolvedValue(null);
    await expect(assertChatFileReadAccess(ctxOf(OTHER), chatFile as never)).rejects.toThrow(ForbiddenError);
  });

  test("a file referenced ONLY by deleted messages is inaccessible (M-4 acceptance)", async () => {
    mockMsgFind.mockResolvedValue([]); // no LIVE references
    await expect(assertChatFileReadAccess(ctxOf(ME), chatFile as never)).rejects.toThrow(/যুক্ত নয়/);
    expect(mockMemberFindOne).not.toHaveBeenCalled();
  });

  test("unauthenticated is denied", async () => {
    await expect(
      assertChatFileReadAccess({ auth: null } as unknown as AppContext, chatFile as never),
    ).rejects.toThrow(ForbiddenError);
  });
});

// ===========================================================================
// resolveSendAttachments — only the sender's own files, for THIS conversation
// ===========================================================================

describe("resolveSendAttachments", () => {
  test("admits the sender's own chat file uploaded for this conversation", async () => {
    const ids = await resolveSendAttachments([FILE_ID.toString()], ME, CONV);
    expect(ids.map((i) => i.toString())).toEqual([FILE_ID.toString()]);
  });

  test("rejects a file uploaded by someone else", async () => {
    mockStoredFind.mockResolvedValue([{ ...chatFile, uploadedBy: new mongoose.Types.ObjectId(OTHER) }]);
    await expect(resolveSendAttachments([FILE_ID.toString()], ME, CONV)).rejects.toThrow(ChatAttachmentError);
  });

  test("rejects a file uploaded for a DIFFERENT conversation", async () => {
    mockStoredFind.mockResolvedValue([{ ...chatFile, conversationId: new mongoose.Types.ObjectId(OTHER_CONV) }]);
    await expect(resolveSendAttachments([FILE_ID.toString()], ME, CONV)).rejects.toThrow(ChatAttachmentError);
  });

  test("rejects a non-chat (homework) file id", async () => {
    mockStoredFind.mockResolvedValue([{ ...chatFile, kind: "hw_answer" }]);
    await expect(resolveSendAttachments([FILE_ID.toString()], ME, CONV)).rejects.toThrow(ChatAttachmentError);
  });

  test("rejects a missing file id", async () => {
    mockStoredFind.mockResolvedValue([]);
    await expect(resolveSendAttachments([FILE_ID.toString()], ME, CONV)).rejects.toThrow(ChatAttachmentError);
  });
});

// ===========================================================================
// sendMessage attachment binding (integration with ChatService)
// ===========================================================================

describe("sendMessage with attachments", () => {
  test("binds valid attachments onto the created message", async () => {
    const msg = await sendMessage({ conversationId: CONV, senderId: ME, body: "দেখো", attachmentIds: [FILE_ID.toString()] });
    expect(mockMsgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONV, senderId: ME, attachmentIds: [FILE_ID] }),
    );
    expect(msg).toBeDefined();
  });

  test("an attachment-only message (no body) is allowed", async () => {
    await sendMessage({ conversationId: CONV, senderId: ME, body: "  ", attachmentIds: [FILE_ID.toString()] });
    expect(mockMsgCreate).toHaveBeenCalledWith(expect.objectContaining({ body: "", attachmentIds: [FILE_ID] }));
  });

  test("empty body AND no attachments is still rejected (Bangla)", async () => {
    await expect(sendMessage({ conversationId: CONV, senderId: ME, body: "   " })).rejects.toThrow(/খালি/);
    expect(mockMsgCreate).not.toHaveBeenCalled();
  });

  test("an invalid attachment surfaces a Bangla ChatError (not the raw error)", async () => {
    mockStoredFind.mockResolvedValue([]); // file missing → resolveSendAttachments throws
    await expect(
      sendMessage({ conversationId: CONV, senderId: ME, body: "x", attachmentIds: [FILE_ID.toString()] }),
    ).rejects.toThrow(ChatError);
    expect(mockMsgCreate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// POST /files/chat — route (chat:write + membership; Drive-first persistence)
// ===========================================================================

describe("POST /files/chat", () => {
  const attach = (tok: string | null, conv = CONV, mime = "image/jpeg", bytes = Buffer.from("img-bytes")) => {
    const req = request(app).post(`/files/chat?conversationId=${conv}`);
    if (tok) req.set("Authorization", `Bearer ${tok}`);
    return req.attach("file", bytes, { filename: "photo.jpg", contentType: mime });
  };

  test("unauthenticated → 403", async () => {
    expect((await attach(null)).status).toBe(403);
  });

  test("GUARDIAN → 403 (no chat:write)", async () => {
    const res = await attach(guardianTok);
    expect(res.status).toBe(403);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("a non-member of the conversation → 403 (nothing uploaded)", async () => {
    mockMemberFindOne.mockResolvedValue(null);
    const res = await attach(meTok);
    expect(res.status).toBe(403);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("a disallowed MIME → 422 Bangla (nothing uploaded)", async () => {
    const res = await attach(meTok, CONV, "application/zip");
    expect(res.status).toBe(422);
    expect(res.body.error).toBe(CHAT_FILE_ERRORS_BN.badMime);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("happy path: uploads to the Drive chat folder; response has fileId+kind, NEVER driveFileId", async () => {
    const res = await attach(meTok);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fileId: FILE_ID.toString(), kind: "IMAGE", mime: "image/jpeg" });
    expect(res.body.driveFileId).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("drive-internal-xyz");
    // Stored with the chat kind + conversationId; uploaded to the chat subfolder.
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ subfolder: "chat" }));
    expect(mockStoredCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "chat_image", conversationId: CONV, uploadedBy: ME }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CHAT_ATTACHMENT_UPLOADED" }));
  });

  test("Drive failure → 503 and NOTHING persisted", async () => {
    const { DriveUnavailableError } = jest.requireActual("../modules/platform/services/DriveStore");
    mockUpload.mockRejectedValue(new DriveUnavailableError());
    const res = await attach(meTok);
    expect(res.status).toBe(503);
    expect(mockStoredCreate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// GET /files/:id — chat files dispatch to the chat membership gate
// ===========================================================================

describe("GET /files/:id (chat dispatch)", () => {
  test("a member downloads a chat attachment (streamed, no driveFileId)", async () => {
    mockDownload.mockResolvedValue(Buffer.from("img-bytes"));
    const res = await request(app).get(`/files/${FILE_ID.toString()}`).set("Authorization", `Bearer ${meTok}`);
    expect(res.status).toBe(200);
    expect(mockDownload).toHaveBeenCalledWith("drive-internal-xyz");
  });

  test("a non-member is denied (403) — the chat gate, not the homework gate", async () => {
    mockMemberFindOne.mockResolvedValue(null);
    const res = await request(app).get(`/files/${FILE_ID.toString()}`).set("Authorization", `Bearer ${meTok}`);
    expect(res.status).toBe(403);
    expect(mockDownload).not.toHaveBeenCalled();
  });

  test("unauthenticated → 403", async () => {
    const res = await request(app).get(`/files/${FILE_ID.toString()}`);
    expect(res.status).toBe(403);
  });
});
