/**
 * Messaging M-3 tests (prd-messaging §5 M-3, D-#77) — rich messaging on the
 * M-1 fields: forward, reactions, edit, hide-not-erase delete.
 *
 *   forward  — member of BOTH source + target; forwardOfId provenance set;
 *              attachment refs carried; ANNOUNCEMENT target gates non-managers;
 *              a deleted source is rejected (J-M9)
 *   edit     — own messages only (other sender denied); prior body retained in
 *              the MESSAGE_EDITED audit FIRST; editedAt stamped; empty + deleted
 *              rejected (D-#77, ADR-008)
 *   delete   — own only; original body + attachment refs retained in the
 *              MESSAGE_DELETED audit; row masked behind the removed-placeholder
 *              for every reader; re-delete is idempotent (J-M4, D-#77)
 *   react    — one per user per message: same emoji toggles OFF, a different
 *              emoji SWITCHES; deleted-message + empty rejected; membership-gated
 *   read     — listMessages masks a deleted message's body (no original leak)
 *
 * DB-free: Mongoose models + AuditService mocked, the service real.
 */
import mongoose from "mongoose";
import { ForbiddenError } from "../middleware/authz";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mock models + audit BEFORE importing the service under test
// ---------------------------------------------------------------------------

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
  ConversationMember: {
    findOne: (f: unknown) => ({ lean: () => mockMemberFindOne(f) }),
  },
}));

const mockMsgFindById = jest.fn();
const mockMsgCreate = jest.fn();
const mockMsgUpdateOne = jest.fn();
const mockMsgFind = jest.fn(); // listMessages chain: find→sort→limit→lean
jest.mock("../modules/chat/models/ChatMessage", () => ({
  ChatMessage: {
    findById: (id: unknown) => ({ lean: () => mockMsgFindById(id) }),
    create: (d: unknown) => mockMsgCreate(d),
    updateOne: (f: unknown, u: unknown) => mockMsgUpdateOne(f, u),
    find: (f: unknown) => ({
      sort: () => ({ limit: () => ({ lean: () => mockMsgFind(f) }) }),
    }),
  },
}));

const mockReactionFindOne = jest.fn();
const mockReactionDeleteOne = jest.fn();
const mockReactionUpdateOne = jest.fn();
const mockReactionFind = jest.fn();
jest.mock("../modules/chat/models/Reaction", () => ({
  Reaction: {
    findOne: (f: unknown) => ({ lean: () => mockReactionFindOne(f) }),
    deleteOne: (f: unknown) => mockReactionDeleteOne(f),
    updateOne: (f: unknown, u: unknown, o: unknown) => mockReactionUpdateOne(f, u, o),
    find: (f: unknown) => ({ lean: () => mockReactionFind(f) }),
  },
}));

jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: () => ({ lean: () => null }), find: () => ({ select: () => ({ lean: () => [] }) }) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

// Import AFTER mocks
import {
  ChatError,
  REMOVED_PLACEHOLDER,
  forwardMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  listMessages,
  getChatMessage,
} from "../modules/chat/services/ChatService";

const ME = oid().toString();
const OTHER = oid().toString();
const SRC_CONV = oid().toString();
const DST_CONV = oid().toString();
const MSG_ID = oid().toString();

/** assertChatMember(conversationId, ME) passes for any conversation in `members`. */
function memberOf(...conversationIds: string[]) {
  const set = new Set(conversationIds);
  mockMemberFindOne.mockImplementation((f: { conversationId: string }) =>
    set.has(f.conversationId.toString()) ? { conversationId: f.conversationId, userId: ME } : null,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // Both conversations exist, active, OPEN by default.
  mockConvFindById.mockImplementation((id: unknown) => ({
    _id: String(id),
    kind: String(id) === DST_CONV ? "CUSTOM" : "DIRECT",
    active: true,
    postingPolicy: "OPEN",
  }));
  memberOf(SRC_CONV, DST_CONV);
  // A live message authored by ME in SRC_CONV.
  mockMsgFindById.mockResolvedValue({
    _id: MSG_ID,
    conversationId: SRC_CONV,
    senderId: ME,
    body: "মূল বার্তা",
    attachmentIds: [],
  });
  mockMsgCreate.mockImplementation((d: Record<string, unknown>) =>
    Promise.resolve({ _id: oid(), ...d, createdAt: new Date() }),
  );
  mockMsgUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockConvUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockMsgFind.mockResolvedValue([]);
  mockReactionFindOne.mockResolvedValue(null);
  mockReactionDeleteOne.mockResolvedValue({ deletedCount: 1 });
  mockReactionUpdateOne.mockResolvedValue({ upsertedCount: 1 });
  mockReactionFind.mockResolvedValue([]);
  mockWriteAudit.mockResolvedValue(undefined);
});

// ===========================================================================
// Forward (J-M9)
// ===========================================================================

describe("M-3 forwardMessage", () => {
  test("forwards into a target the sender belongs to; provenance + attachments carried", async () => {
    mockMsgFindById.mockResolvedValue({
      _id: MSG_ID,
      conversationId: SRC_CONV,
      senderId: OTHER,
      body: "মূল বার্তা",
      attachmentIds: [],
    });
    const msg = await forwardMessage({ messageId: MSG_ID, toConversationId: DST_CONV, senderId: ME });
    expect(mockMsgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: DST_CONV, senderId: ME, forwardOfId: MSG_ID, body: "মূল বার্তা" }),
    );
    // The target's list-ordering stamp is bumped.
    expect(mockConvUpdateOne).toHaveBeenCalledWith({ _id: DST_CONV }, { $set: { lastMessageAt: msg.createdAt } });
  });

  test("non-member of the SOURCE is denied (cannot read it to forward)", async () => {
    memberOf(DST_CONV); // member of target only
    await expect(
      forwardMessage({ messageId: MSG_ID, toConversationId: DST_CONV, senderId: ME }),
    ).rejects.toThrow(ForbiddenError);
    expect(mockMsgCreate).not.toHaveBeenCalled();
  });

  test("non-member of the TARGET is denied (cannot post into it)", async () => {
    memberOf(SRC_CONV); // member of source only
    await expect(
      forwardMessage({ messageId: MSG_ID, toConversationId: DST_CONV, senderId: ME }),
    ).rejects.toThrow(ForbiddenError);
    expect(mockMsgCreate).not.toHaveBeenCalled();
  });

  test("a deleted source message cannot be forwarded", async () => {
    mockMsgFindById.mockResolvedValue({ _id: MSG_ID, conversationId: SRC_CONV, senderId: ME, deletedAt: new Date() });
    await expect(
      forwardMessage({ messageId: MSG_ID, toConversationId: DST_CONV, senderId: ME }),
    ).rejects.toThrow(/মুছে ফেলা/);
  });

  test("an ANNOUNCEMENT target blocks a non-manager forward; a manager succeeds", async () => {
    mockConvFindById.mockImplementation((id: unknown) => ({
      _id: String(id),
      kind: "CUSTOM",
      active: true,
      postingPolicy: String(id) === DST_CONV ? "ANNOUNCEMENT" : "OPEN",
    }));
    await expect(
      forwardMessage({ messageId: MSG_ID, toConversationId: DST_CONV, senderId: ME, canManage: false }),
    ).rejects.toThrow(/ব্যবস্থাপক/);
    await forwardMessage({ messageId: MSG_ID, toConversationId: DST_CONV, senderId: ME, canManage: true });
    expect(mockMsgCreate).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Edit (own only; prior body retained in audit)
// ===========================================================================

describe("M-3 editMessage", () => {
  test("edits own message: prior body audited FIRST, then editedAt stamped", async () => {
    const res = await editMessage(MSG_ID, ME, "  নতুন লেখা  ");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "MESSAGE_EDITED", targetId: MSG_ID, meta: expect.objectContaining({ priorBody: "মূল বার্তা" }) }),
    );
    const [, update] = mockMsgUpdateOne.mock.calls[0];
    expect(update.$set.body).toBe("নতুন লেখা");
    expect(update.$set.editedAt).toBeInstanceOf(Date);
    expect(res.body).toBe("নতুন লেখা");
    expect(res.editedAt).toBeInstanceOf(Date);
  });

  test("editing someone else's message is denied (own only)", async () => {
    mockMsgFindById.mockResolvedValue({ _id: MSG_ID, conversationId: SRC_CONV, senderId: OTHER, body: "x" });
    await expect(editMessage(MSG_ID, ME, "hack")).rejects.toThrow(ForbiddenError);
    expect(mockMsgUpdateOne).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("an empty new body is rejected; a deleted message cannot be edited", async () => {
    await expect(editMessage(MSG_ID, ME, "   ")).rejects.toThrow(/খালি/);
    mockMsgFindById.mockResolvedValue({ _id: MSG_ID, conversationId: SRC_CONV, senderId: ME, body: "x", deletedAt: new Date() });
    await expect(editMessage(MSG_ID, ME, "new")).rejects.toThrow(/মুছে ফেলা/);
  });

  test("a non-member is denied even on their own message id", async () => {
    memberOf(); // member of nothing
    await expect(editMessage(MSG_ID, ME, "new")).rejects.toThrow(ForbiddenError);
  });
});

// ===========================================================================
// Delete (hide-not-erase; J-M4)
// ===========================================================================

describe("M-3 deleteMessage", () => {
  test("deletes own message: original retained in audit, row masked + deletedBy stamped", async () => {
    const res = await deleteMessage(MSG_ID, ME);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "MESSAGE_DELETED", meta: expect.objectContaining({ originalBody: "মূল বার্তা" }) }),
    );
    const [, update] = mockMsgUpdateOne.mock.calls[0];
    expect(update.$set.deletedAt).toBeInstanceOf(Date);
    expect(update.$set.deletedBy.toString()).toBe(ME);
    // Returned row is already masked — the original body never leaves the server.
    expect(res.body).toBe(REMOVED_PLACEHOLDER);
  });

  test("deleting someone else's message is denied", async () => {
    mockMsgFindById.mockResolvedValue({ _id: MSG_ID, conversationId: SRC_CONV, senderId: OTHER, body: "x", attachmentIds: [] });
    await expect(deleteMessage(MSG_ID, ME)).rejects.toThrow(ForbiddenError);
    expect(mockMsgUpdateOne).not.toHaveBeenCalled();
  });

  test("re-deleting is an idempotent no-op (no second audit / update)", async () => {
    mockMsgFindById.mockResolvedValue({ _id: MSG_ID, conversationId: SRC_CONV, senderId: ME, body: "x", attachmentIds: [], deletedAt: new Date() });
    const res = await deleteMessage(MSG_ID, ME);
    expect(res.body).toBe(REMOVED_PLACEHOLDER);
    expect(mockWriteAudit).not.toHaveBeenCalled();
    expect(mockMsgUpdateOne).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Read masking — a deleted message lists as the removed-placeholder
// ===========================================================================

describe("M-3 listMessages masks deleted bodies", () => {
  test("a deleted message's original body never reaches the reader", async () => {
    mockMsgFind.mockResolvedValue([
      { _id: oid(), conversationId: SRC_CONV, senderId: OTHER, body: "live one", attachmentIds: [] },
      { _id: oid(), conversationId: SRC_CONV, senderId: OTHER, body: "secret", attachmentIds: [oid()], deletedAt: new Date() },
    ]);
    const msgs = await listMessages(SRC_CONV, ME);
    expect(msgs[0].body).toBe("live one");
    expect(msgs[1].body).toBe(REMOVED_PLACEHOLDER);
    expect(msgs[1].attachmentIds).toEqual([]); // refs masked too
  });
});

// ===========================================================================
// Reactions (one per user per message; toggle / switch)
// ===========================================================================

describe("M-3 toggleReaction", () => {
  test("a fresh reaction upserts the single (message,user) row", async () => {
    const res = await toggleReaction(MSG_ID, ME, "👍");
    expect(res).toBe("👍");
    const [filter, update, opts] = mockReactionUpdateOne.mock.calls[0];
    expect(filter.messageId.toString()).toBe(MSG_ID);
    expect(filter.userId.toString()).toBe(ME);
    expect(update.$set).toEqual({ emoji: "👍" });
    expect(opts).toEqual({ upsert: true });
    expect(mockReactionDeleteOne).not.toHaveBeenCalled();
  });

  test("the SAME emoji again toggles the reaction OFF (removes the row)", async () => {
    mockReactionFindOne.mockResolvedValue({ messageId: MSG_ID, userId: ME, emoji: "👍" });
    const res = await toggleReaction(MSG_ID, ME, "👍");
    expect(res).toBeNull();
    expect(mockReactionDeleteOne).toHaveBeenCalledWith({ messageId: MSG_ID, userId: ME });
    expect(mockReactionUpdateOne).not.toHaveBeenCalled();
  });

  test("a DIFFERENT emoji SWITCHES the existing row (no duplicate)", async () => {
    mockReactionFindOne.mockResolvedValue({ messageId: MSG_ID, userId: ME, emoji: "👍" });
    const res = await toggleReaction(MSG_ID, ME, "❤️");
    expect(res).toBe("❤️");
    expect(mockReactionUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockReactionDeleteOne).not.toHaveBeenCalled();
  });

  test("an empty emoji is rejected; a deleted message cannot be reacted to", async () => {
    await expect(toggleReaction(MSG_ID, ME, "  ")).rejects.toThrow(ChatError);
    mockMsgFindById.mockResolvedValue({ _id: MSG_ID, conversationId: SRC_CONV, senderId: OTHER, deletedAt: new Date() });
    await expect(toggleReaction(MSG_ID, ME, "👍")).rejects.toThrow(/মুছে ফেলা/);
  });

  test("an over-long 'emoji' is rejected (free-form but bounded, D-#101)", async () => {
    await expect(toggleReaction(MSG_ID, ME, "x".repeat(65))).rejects.toThrow(ChatError);
    expect(mockReactionUpdateOne).not.toHaveBeenCalled();
  });

  test("a non-member cannot react", async () => {
    memberOf(); // member of nothing
    await expect(toggleReaction(MSG_ID, ME, "👍")).rejects.toThrow(ForbiddenError);
  });
});

// ===========================================================================
// getChatMessage — membership-gated single read (mutation return path)
// ===========================================================================

describe("M-3 getChatMessage", () => {
  test("returns a member's message; masks it if deleted", async () => {
    const live = await getChatMessage(MSG_ID, ME);
    expect(live.body).toBe("মূল বার্তা");
    mockMsgFindById.mockResolvedValue({ _id: MSG_ID, conversationId: SRC_CONV, senderId: ME, body: "secret", attachmentIds: [], deletedAt: new Date() });
    const dead = await getChatMessage(MSG_ID, ME);
    expect(dead.body).toBe(REMOVED_PLACEHOLDER);
  });

  test("a non-member is denied", async () => {
    memberOf();
    await expect(getChatMessage(MSG_ID, ME)).rejects.toThrow(ForbiddenError);
  });
});
