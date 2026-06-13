/**
 * Messaging M-1 tests (prd-messaging §5 M-1, D-#76/#77).
 *
 *   M1.1 — openDirectConversation is idempotent: ONE DIRECT thread per pair
 *          (order-independent key; the unique-index race resolves to the one
 *          existing thread); self-DM rejected; guardians/inactive/unknown
 *          users rejected (staff-only, D-#76)
 *   M1.2 — membership is the row scope: a non-member is denied on read AND
 *          write (Bangla, no existence leak); an inactive conversation denies
 *   M1.3 — messages are newest-first + _id-cursor paginated; empty body and
 *          cross-conversation replyTo rejected; sendMessage stamps
 *          lastMessageAt for list ordering
 *   M1.5 — seen receipts: markSeen sweeps only OTHERS' messages, first-seen
 *          is preserved ($setOnInsert), the seen state is correct across two
 *          users (J-M1)
 *
 * DB-free: Mongoose models mocked, the service real.
 */
import mongoose from "mongoose";
import { ForbiddenError } from "../middleware/authz";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mock models BEFORE importing the service under test
// ---------------------------------------------------------------------------

const mockConvFindById = jest.fn();
const mockConvFindOne = jest.fn();
const mockConvFindOneAndUpdate = jest.fn();
const mockConvUpdateOne = jest.fn();
const mockConvFind = jest.fn();
jest.mock("../modules/chat/models/Conversation", () => ({
  // Keep the real exports (directKeyFor) — only the model is mocked.
  ...jest.requireActual("../modules/chat/models/Conversation"),
  Conversation: {
    findById: (id: unknown) => ({ lean: () => mockConvFindById(id) }),
    findOne: (f: unknown) => ({ lean: () => mockConvFindOne(f) }),
    findOneAndUpdate: (f: unknown, u: unknown, o: unknown) => ({
      lean: () => mockConvFindOneAndUpdate(f, u, o),
    }),
    updateOne: (f: unknown, u: unknown) => mockConvUpdateOne(f, u),
    find: (f: unknown) => ({ sort: () => ({ lean: () => mockConvFind(f) }) }),
  },
}));

const mockMemberFindOne = jest.fn();
const mockMemberFind = jest.fn();
const mockMemberUpdateOne = jest.fn();
jest.mock("../modules/chat/models/ConversationMember", () => ({
  ConversationMember: {
    findOne: (f: unknown) => ({ lean: () => mockMemberFindOne(f) }),
    find: (f: unknown) => ({
      select: () => ({ lean: () => mockMemberFind(f) }),
      lean: () => mockMemberFind(f),
    }),
    updateOne: (f: unknown, u: unknown, o: unknown) => mockMemberUpdateOne(f, u, o),
  },
}));

const mockMsgFindById = jest.fn();
const mockMsgCreate = jest.fn();
const mockMsgFind = jest.fn(); // listMessages chain: find→sort→limit→lean
const mockMsgFindIds = jest.fn(); // markSeen chain: find→select→lean
let lastMsgSort: unknown;
let lastMsgLimit: unknown;
jest.mock("../modules/chat/models/ChatMessage", () => ({
  ChatMessage: {
    findById: (id: unknown) => ({ lean: () => mockMsgFindById(id) }),
    create: (d: unknown) => mockMsgCreate(d),
    find: (f: unknown) => ({
      sort: (s: unknown) => {
        lastMsgSort = s;
        return { limit: (l: unknown) => { lastMsgLimit = l; return { lean: () => mockMsgFind(f) }; } };
      },
      select: () => ({ lean: () => mockMsgFindIds(f) }),
    }),
  },
}));

const mockReceiptBulkWrite = jest.fn();
const mockReceiptFind = jest.fn();
jest.mock("../modules/chat/models/MessageReceipt", () => ({
  MessageReceipt: {
    bulkWrite: (ops: unknown, o: unknown) => mockReceiptBulkWrite(ops, o),
    find: (f: unknown) => ({ lean: () => mockReceiptFind(f) }),
  },
}));

const mockUserFindById = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findById: (id: unknown) => ({ lean: () => mockUserFindById(id) }),
    find: () => ({ select: () => ({ lean: () => [] }) }),
  },
}));

// Import AFTER mocks
import { directKeyFor } from "../modules/chat/models/Conversation";
import {
  ChatError,
  assertChatMember,
  openDirectConversation,
  sendMessage,
  listMessages,
  myConversations,
  markConversationSeen,
  receiptsForMessage,
} from "../modules/chat/services/ChatService";

const ME = oid().toString();
const OTHER = oid().toString();
const CONV_ID = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  lastMsgSort = undefined;
  lastMsgLimit = undefined;
  mockUserFindById.mockResolvedValue({ _id: OTHER, role: "TEACHER", active: true, name: "Other T" });
  mockConvFindById.mockResolvedValue({ _id: CONV_ID, kind: "DIRECT", active: true });
  mockMemberFindOne.mockResolvedValue({ conversationId: CONV_ID, userId: ME, source: "auto" });
  mockConvFindOneAndUpdate.mockImplementation((f: { directKey: string }) =>
    Promise.resolve({ _id: CONV_ID, kind: "DIRECT", directKey: f.directKey, active: true }),
  );
  mockMemberUpdateOne.mockResolvedValue({ upsertedCount: 1 });
  mockConvUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockMsgCreate.mockImplementation((d: Record<string, unknown>) =>
    Promise.resolve({ _id: oid(), ...d, createdAt: new Date() }),
  );
  mockMsgFind.mockResolvedValue([]);
  mockMsgFindIds.mockResolvedValue([]);
  mockReceiptBulkWrite.mockResolvedValue({ upsertedCount: 0 });
  mockReceiptFind.mockResolvedValue([]);
});

// ===========================================================================
// M1.1 — one DIRECT conversation per pair, idempotent, staff-only
// ===========================================================================

describe("M1.1 openDirectConversation", () => {
  test("opens THE pair thread with an order-independent key + both member rows", async () => {
    const conv = await openDirectConversation(ME, OTHER);
    expect(conv._id).toBe(CONV_ID);

    const [filter, update, opts] = mockConvFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ directKey: directKeyFor(OTHER, ME) }); // sorted — same key both directions
    expect(update.$setOnInsert).toMatchObject({ kind: "DIRECT", postingPolicy: "OPEN", active: true });
    expect(opts).toMatchObject({ upsert: true, new: true });

    // Both members upserted idempotently (source:"auto"; re-open never duplicates).
    expect(mockMemberUpdateOne).toHaveBeenCalledTimes(2);
    const memberIds = mockMemberUpdateOne.mock.calls.map((c) => c[0].userId).sort();
    expect(memberIds).toEqual([ME, OTHER].sort());
    for (const [, update2, opts2] of mockMemberUpdateOne.mock.calls) {
      expect(update2.$setOnInsert).toMatchObject({ source: "auto" });
      expect(opts2).toEqual({ upsert: true });
    }
  });

  test("a concurrent duplicate (unique-index E11000 race) resolves to the existing thread", async () => {
    mockConvFindOneAndUpdate.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    mockConvFindOne.mockResolvedValue({ _id: CONV_ID, kind: "DIRECT", active: true });
    const conv = await openDirectConversation(ME, OTHER);
    expect(conv._id).toBe(CONV_ID);
    expect(mockConvFindOne).toHaveBeenCalledWith({ directKey: directKeyFor(ME, OTHER) });
  });

  test("a self-DM is rejected", async () => {
    await expect(openDirectConversation(ME, ME)).rejects.toThrow(ChatError);
  });

  test("a GUARDIAN counterpart is rejected — guardians are never chat participants (D-#76)", async () => {
    mockUserFindById.mockResolvedValue({ _id: OTHER, role: "GUARDIAN", active: true });
    await expect(openDirectConversation(ME, OTHER)).rejects.toThrow(/স্টাফ/);
  });

  test("an inactive or unknown counterpart is rejected", async () => {
    mockUserFindById.mockResolvedValue({ _id: OTHER, role: "TEACHER", active: false });
    await expect(openDirectConversation(ME, OTHER)).rejects.toThrow(ChatError);
    mockUserFindById.mockResolvedValue(null);
    await expect(openDirectConversation(ME, OTHER)).rejects.toThrow(ChatError);
  });
});

// ===========================================================================
// M1.2 — membership is the row scope (non-member denied, read AND write)
// ===========================================================================

describe("M1.2 membership gate", () => {
  test("a non-member is denied (Bangla ForbiddenError)", async () => {
    mockMemberFindOne.mockResolvedValue(null);
    await expect(assertChatMember(CONV_ID, ME)).rejects.toThrow(ForbiddenError);
    await expect(assertChatMember(CONV_ID, ME)).rejects.toThrow(/সদস্য নন/);
  });

  test("an unknown conversation denies identically (no existence leak)", async () => {
    mockConvFindById.mockResolvedValue(null);
    await expect(assertChatMember(CONV_ID, ME)).rejects.toThrow(/সদস্য নন/);
  });

  test("an inactive (archived) conversation denies", async () => {
    mockConvFindById.mockResolvedValue({ _id: CONV_ID, kind: "DIRECT", active: false });
    await expect(assertChatMember(CONV_ID, ME)).rejects.toThrow(ForbiddenError);
  });

  test("non-member reads and writes are all denied through the same gate", async () => {
    mockMemberFindOne.mockResolvedValue(null);
    await expect(listMessages(CONV_ID, ME)).rejects.toThrow(ForbiddenError);
    await expect(sendMessage({ conversationId: CONV_ID, senderId: ME, body: "hi" })).rejects.toThrow(ForbiddenError);
    await expect(markConversationSeen(CONV_ID, ME)).rejects.toThrow(ForbiddenError);
    expect(mockMsgCreate).not.toHaveBeenCalled();
    expect(mockReceiptBulkWrite).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// M1.3 — messages: validation, ordering, pagination
// ===========================================================================

describe("M1.3 sendMessage + listMessages", () => {
  test("a member sends; the conversation's lastMessageAt is stamped", async () => {
    const msg = await sendMessage({ conversationId: CONV_ID, senderId: ME, body: "  আসসালামু আলাইকুম  " });
    expect(mockMsgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONV_ID, senderId: ME, body: "আসসালামু আলাইকুম" }),
    );
    expect(mockConvUpdateOne).toHaveBeenCalledWith(
      { _id: CONV_ID },
      { $set: { lastMessageAt: msg.createdAt } },
    );
  });

  test("an empty / whitespace-only body is rejected (Bangla)", async () => {
    await expect(sendMessage({ conversationId: CONV_ID, senderId: ME, body: "   " })).rejects.toThrow(/খালি/);
    expect(mockMsgCreate).not.toHaveBeenCalled();
  });

  test("a replyTo pointing at another conversation's message is rejected", async () => {
    const REPLY_ID = oid().toString();
    mockMsgFindById.mockResolvedValue({ _id: REPLY_ID, conversationId: oid() }); // a DIFFERENT conversation
    await expect(
      sendMessage({ conversationId: CONV_ID, senderId: ME, body: "reply", replyToId: REPLY_ID }),
    ).rejects.toThrow(/এই কথোপকথনে নেই/);
  });

  test("a replyTo within the same conversation is accepted and persisted", async () => {
    const REPLY_ID = oid().toString();
    mockMsgFindById.mockResolvedValue({ _id: REPLY_ID, conversationId: CONV_ID });
    await sendMessage({ conversationId: CONV_ID, senderId: ME, body: "reply", replyToId: REPLY_ID });
    expect(mockMsgCreate).toHaveBeenCalledWith(expect.objectContaining({ replyToId: REPLY_ID }));
  });

  test("messages list newest-first with the default page size", async () => {
    await listMessages(CONV_ID, ME);
    expect(mockMsgFind).toHaveBeenCalledWith({ conversationId: CONV_ID });
    expect(lastMsgSort).toEqual({ _id: -1 });
    expect(lastMsgLimit).toBe(50);
  });

  test("a beforeId cursor pages strictly older messages; limit is clamped", async () => {
    const cursor = oid().toString();
    await listMessages(CONV_ID, ME, { beforeId: cursor, limit: 9999 });
    const [filter] = mockMsgFind.mock.calls[0];
    expect(filter.conversationId).toBe(CONV_ID);
    expect(filter._id.$lt.toString()).toBe(cursor);
    expect(lastMsgLimit).toBe(200);
  });
});

// ===========================================================================
// M1.4 — conversation list
// ===========================================================================

describe("M1.4 myConversations", () => {
  test("no memberships → empty list, no conversation query", async () => {
    mockMemberFind.mockResolvedValue([]);
    expect(await myConversations(ME)).toEqual([]);
    expect(mockConvFind).not.toHaveBeenCalled();
  });

  test("lists only ACTIVE conversations the caller belongs to", async () => {
    const c1 = oid(), c2 = oid();
    mockMemberFind.mockResolvedValue([{ conversationId: c1 }, { conversationId: c2 }]);
    mockConvFind.mockResolvedValue([{ _id: c1 }]);
    const res = await myConversations(ME);
    expect(res).toHaveLength(1);
    expect(mockMemberFind).toHaveBeenCalledWith({ userId: ME });
    expect(mockConvFind).toHaveBeenCalledWith({ _id: { $in: [c1, c2] }, active: true });
  });
});

// ===========================================================================
// M1.5 — seen receipts (J-M1: seen state across two users)
// ===========================================================================

describe("M1.5 markConversationSeen + receipts", () => {
  test("sweeps only OTHERS' messages — own messages never get a self-receipt", async () => {
    const m1 = oid(), m2 = oid();
    mockMsgFindIds.mockResolvedValue([{ _id: m1 }, { _id: m2 }]);
    mockReceiptBulkWrite.mockResolvedValue({ upsertedCount: 2 });

    const n = await markConversationSeen(CONV_ID, ME);
    expect(n).toBe(2);

    // The unseen lookup excludes the caller's own messages.
    expect(mockMsgFindIds).toHaveBeenCalledWith({ conversationId: CONV_ID, senderId: { $ne: ME } });

    // First-seen preserved: upsert writes seenAt only on insert.
    const [ops, opts] = mockReceiptBulkWrite.mock.calls[0];
    expect(ops).toHaveLength(2);
    expect(ops[0].updateOne.filter).toEqual({ messageId: m1, userId: ME });
    expect(ops[0].updateOne.update.$setOnInsert.seenAt).toBeInstanceOf(Date);
    expect(ops[0].updateOne.upsert).toBe(true);
    expect(opts).toEqual({ ordered: false });
  });

  test("re-marking is a no-op count (existing receipts are not rewritten)", async () => {
    mockMsgFindIds.mockResolvedValue([{ _id: oid() }]);
    mockReceiptBulkWrite.mockResolvedValue({ upsertedCount: 0 }); // all receipts already exist
    expect(await markConversationSeen(CONV_ID, ME)).toBe(0);
  });

  test("nothing to see → 0, no bulk write", async () => {
    mockMsgFindIds.mockResolvedValue([]);
    expect(await markConversationSeen(CONV_ID, ME)).toBe(0);
    expect(mockReceiptBulkWrite).not.toHaveBeenCalled();
  });

  test("J-M1: after B marks seen, A's per-message seen-by lists B with a timestamp", async () => {
    const A = ME, B = OTHER;
    const MSG_ID = oid().toString();

    // A sends...
    await sendMessage({ conversationId: CONV_ID, senderId: A, body: "salam" });

    // ...B opens the thread and marks seen...
    mockMemberFindOne.mockResolvedValue({ conversationId: CONV_ID, userId: B, source: "auto" });
    mockMsgFindIds.mockResolvedValue([{ _id: MSG_ID }]);
    mockReceiptBulkWrite.mockResolvedValue({ upsertedCount: 1 });
    expect(await markConversationSeen(CONV_ID, B)).toBe(1);
    // B's sweep targeted messages B did NOT send (i.e. A's message).
    expect(mockMsgFindIds).toHaveBeenCalledWith({ conversationId: CONV_ID, senderId: { $ne: B } });

    // ...and A's seen-by for that message now carries B + seenAt.
    const seenAt = new Date();
    mockReceiptFind.mockResolvedValue([{ messageId: MSG_ID, userId: B, seenAt }]);
    const receipts = await receiptsForMessage(MSG_ID);
    expect(mockReceiptFind).toHaveBeenCalledWith({ messageId: MSG_ID });
    expect(receipts).toEqual([{ messageId: MSG_ID, userId: B, seenAt }]);
  });
});
