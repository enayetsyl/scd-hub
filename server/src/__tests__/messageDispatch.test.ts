/**
 * Messaging M-6 — dispatch seam tests (prd-messaging §5 M-6, D-#52/#111).
 *
 * dispatchSystemMessage(userId, text) is the interface the routine triggers
 * will call. It posts into a per-user system→user DIRECT thread authored by the
 * sentinel SYSTEM sender, PRIVILEGED (bypasses membership + posting gates), and
 * makes the recipient a member so it shows in their list. Idempotent on the
 * conversation (sparse-unique directKey). Empty text rejected.
 *
 * DB-free: Conversation / ConversationMember / ChatMessage mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockConvFindOneAndUpdate = jest.fn();
const mockConvFindOne = jest.fn();
const mockConvUpdateOne = jest.fn();
jest.mock("../modules/chat/models/Conversation", () => ({
  ...jest.requireActual("../modules/chat/models/Conversation"),
  Conversation: {
    findOneAndUpdate: (f: unknown, u: unknown, o: unknown) => ({ lean: () => mockConvFindOneAndUpdate(f, u, o) }),
    findOne: (f: unknown) => ({ lean: () => mockConvFindOne(f) }),
    updateOne: (f: unknown, u: unknown) => mockConvUpdateOne(f, u),
  },
}));

const mockMemberUpdateOne = jest.fn();
jest.mock("../modules/chat/models/ConversationMember", () => ({
  ConversationMember: { updateOne: (f: unknown, u: unknown, o: unknown) => mockMemberUpdateOne(f, u, o) },
}));

const mockMsgCreate = jest.fn();
jest.mock("../modules/chat/models/ChatMessage", () => ({
  ChatMessage: { create: (d: unknown) => mockMsgCreate(d) },
}));

// M-7: the dispatch seam fires a (best-effort) chat push. Mock it here so the
// seam test stays DB-free and can assert the recipient is pushed.
const mockPushNewChatMessage = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/chat/services/ChatPushService", () => ({
  pushNewChatMessage: (m: unknown) => mockPushNewChatMessage(m),
}));

import { directKeyFor } from "../modules/chat/models/Conversation";
import { ChatError } from "../modules/chat/services/ChatService";
import { dispatchSystemMessage, SYSTEM_SENDER_ID } from "../modules/chat/services/MessageDispatchService";

const USER = oid().toString();
const SYS_CONV = oid();

beforeEach(() => {
  jest.clearAllMocks();
  mockConvFindOneAndUpdate.mockResolvedValue({ _id: SYS_CONV, kind: "DIRECT", postingPolicy: "ANNOUNCEMENT" });
  mockConvFindOne.mockResolvedValue({ _id: SYS_CONV, kind: "DIRECT" });
  mockConvUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockMemberUpdateOne.mockResolvedValue({ upsertedCount: 1 });
  mockMsgCreate.mockImplementation((d: Record<string, unknown>) => Promise.resolve({ _id: oid(), ...d, createdAt: new Date() }));
});

describe("M-6 dispatchSystemMessage", () => {
  test("creates the system thread, adds the recipient as a member, posts a SYSTEM message", async () => {
    const msg = await dispatchSystemMessage(USER, "  বেল ৫ মিনিটে  ");

    // The conversation is upserted on the sorted system↔user directKey, DIRECT + ANNOUNCEMENT.
    const [filter, update] = mockConvFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ directKey: directKeyFor(SYSTEM_SENDER_ID, USER) });
    expect(update.$setOnInsert).toMatchObject({ kind: "DIRECT", postingPolicy: "ANNOUNCEMENT" });

    // The recipient is made a member (so it shows in their list).
    const [mFilter, mUpdate, mOpts] = mockMemberUpdateOne.mock.calls[0];
    expect(mFilter.conversationId).toBe(SYS_CONV);
    expect(mUpdate.$setOnInsert).toMatchObject({ source: "auto" });
    expect(mOpts).toEqual({ upsert: true });

    // The message is authored by the SYSTEM sentinel, trimmed, in the system thread.
    expect(mockMsgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: SYS_CONV, body: "বেল ৫ মিনিটে" }),
    );
    expect(mockMsgCreate.mock.calls[0][0].senderId.toString()).toBe(SYSTEM_SENDER_ID);
    // lastMessageAt is stamped for list ordering.
    expect(mockConvUpdateOne).toHaveBeenCalledWith({ _id: SYS_CONV }, { $set: { lastMessageAt: msg.createdAt } });
    // M-7: the recipient is pushed (best-effort) with the system message.
    expect(mockPushNewChatMessage).toHaveBeenCalledWith(msg);
  });

  test("empty/whitespace text is rejected (no conversation, no message)", async () => {
    await expect(dispatchSystemMessage(USER, "   ")).rejects.toThrow(ChatError);
    expect(mockConvFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockMsgCreate).not.toHaveBeenCalled();
  });

  test("a concurrent directKey race (E11000) resolves to the existing system thread", async () => {
    mockConvFindOneAndUpdate.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    mockConvFindOne.mockResolvedValue({ _id: SYS_CONV, kind: "DIRECT" });
    const msg = await dispatchSystemMessage(USER, "hi");
    expect(msg).toBeDefined();
    expect(mockConvFindOne).toHaveBeenCalledWith({ directKey: directKeyFor(SYSTEM_SENDER_ID, USER) });
  });
});
