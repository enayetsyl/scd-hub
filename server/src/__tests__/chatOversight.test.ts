/**
 * Messaging M-6 — Principal oversight tests (prd-messaging §5/§6 M-6, D-#77/#111).
 *
 *   oversightConversations — returns EVERY conversation (no membership filter),
 *                            newest-activity first (the J-M5 browser).
 *   openConversationOversight — writes ONE CHAT_OVERSIGHT_OPENED audit row and
 *                            returns the conversation; unknown id rejected.
 *   oversightMessages — un-masked: a DELETED message keeps its ORIGINAL body
 *                            (the Principal "sees deleted originals"), unlike the
 *                            member read path (ChatService.listMessages masks).
 *
 * RBAC (chat:oversee = PRINCIPAL only) is enforced at the resolver + the vocab
 * verifier; these are the service-level behaviour tests. DB-free.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockConvFind = jest.fn();
const mockConvFindById = jest.fn();
jest.mock("../modules/chat/models/Conversation", () => ({
  ...jest.requireActual("../modules/chat/models/Conversation"),
  Conversation: {
    find: () => ({ sort: () => ({ lean: () => mockConvFind() }) }),
    findById: (id: unknown) => ({ lean: () => mockConvFindById(id) }),
  },
}));

const mockMsgFind = jest.fn();
let lastSort: unknown;
let lastLimit: unknown;
jest.mock("../modules/chat/models/ChatMessage", () => ({
  ChatMessage: {
    find: (f: unknown) => ({
      sort: (s: unknown) => {
        lastSort = s;
        return { limit: (l: unknown) => { lastLimit = l; return { lean: () => mockMsgFind(f) }; } };
      },
    }),
  },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import { ChatError } from "../modules/chat/services/ChatService";
import {
  oversightConversations,
  openConversationOversight,
  oversightMessages,
} from "../modules/chat/services/ChatOversightService";

const PRINCIPAL = oid().toString();
const CONV = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  lastSort = undefined;
  lastLimit = undefined;
  mockConvFind.mockResolvedValue([{ _id: CONV, kind: "DIRECT" }]);
  mockConvFindById.mockResolvedValue({ _id: CONV, kind: "DIRECT", refId: null });
  mockMsgFind.mockResolvedValue([]);
  mockWriteAudit.mockResolvedValue(undefined);
});

describe("M-6 oversightConversations", () => {
  test("returns every conversation with NO membership filter", async () => {
    const res = await oversightConversations();
    expect(res).toHaveLength(1);
    // No ConversationMember lookup happens — oversight is not membership-gated.
  });
});

describe("M-6 openConversationOversight", () => {
  test("audits CHAT_OVERSIGHT_OPENED (one row) and returns the conversation", async () => {
    const conv = await openConversationOversight(CONV, PRINCIPAL);
    expect(conv._id).toBe(CONV);
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "CHAT_OVERSIGHT_OPENED",
        actorId: PRINCIPAL,
        targetId: CONV,
        targetKind: "Conversation",
      }),
    );
  });

  test("an unknown conversation is rejected (no audit)", async () => {
    mockConvFindById.mockResolvedValue(null);
    await expect(openConversationOversight(CONV, PRINCIPAL)).rejects.toThrow(ChatError);
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});

describe("M-6 oversightMessages", () => {
  test("does NOT mask a deleted message — the Principal sees the ORIGINAL body", async () => {
    mockMsgFind.mockResolvedValue([
      { _id: oid(), conversationId: CONV, body: "secret original", deletedAt: new Date(), attachmentIds: [oid()] },
    ]);
    const msgs = await oversightMessages(CONV);
    expect(msgs[0].body).toBe("secret original"); // un-masked (member read would mask)
    expect(msgs[0].deletedAt).toBeInstanceOf(Date); // the deleted flag is still visible
    expect(lastSort).toEqual({ _id: -1 });
    expect(lastLimit).toBe(50);
  });

  test("a beforeId cursor pages older; limit clamps to 200", async () => {
    const cursor = oid().toString();
    await oversightMessages(CONV, { beforeId: cursor, limit: 9999 });
    const [filter] = mockMsgFind.mock.calls[0];
    expect(filter.conversationId).toBe(CONV);
    expect(filter._id.$lt.toString()).toBe(cursor);
    expect(lastLimit).toBe(200);
  });
});
