/**
 * Messaging M-7 — staff Expo push for new chat messages (prd-messaging §5 M-7,
 * D-#116). The transient transport: a new message pushes STRAIGHT through the
 * Expo transport to the other members' registered devices — no Notification
 * inbox row, no NOTIFICATION_KINDS enum (the conversation list IS the inbox).
 *
 *   M7.1 — push goes to members EXCEPT the sender and EXCEPT the muted (the
 *          recipient/mute filter is in the membership query)
 *   M7.2 — title = group title, else the sender's name (DIRECT), else the
 *          system label; body = the message text, or an attachment preview
 *   M7.3 — a system-dispatched message (sentinel sender) titles "SCD Hub" and
 *          skips the sender-name lookup
 *   M7.4 — no members / no registered device (every web session) → NO transport
 *          call at all (graceful no-op; push unavailable on web)
 *   M7.5 — web devices are excluded from the fan-out
 *   M7.6 — dead tokens Expo reports are pruned (deactivated)
 *   M7.7 — best-effort: a model/transport failure never throws
 *
 * DB-free: ConversationMember / PushDevice / Conversation / User + the Expo
 * transport mocked; the service real. MessageDispatchService is mocked down to
 * its SYSTEM_SENDER_ID constant to break the import cycle (no ChatService graph).
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();
const SYSTEM_SENDER_ID = "000000000000000000000000";

const mockMemberFind = jest.fn();
jest.mock("../modules/chat/models/ConversationMember", () => ({
  ConversationMember: {
    find: (f: unknown) => ({ select: () => ({ lean: () => mockMemberFind(f) }) }),
  },
}));

const mockPushFind = jest.fn();
const mockPushUpdateMany = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/attendance/models/PushDevice", () => ({
  PushDevice: {
    find: (f: unknown) => ({ select: () => ({ lean: () => mockPushFind(f) }) }),
    updateMany: (f: unknown, u: unknown) => mockPushUpdateMany(f, u),
  },
}));

const mockConvFindById = jest.fn();
jest.mock("../modules/chat/models/Conversation", () => ({
  Conversation: {
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockConvFindById(id) }) }),
  },
}));

const mockUserFindById = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockUserFindById(id) }) }),
  },
}));

const mockSendExpoPush = jest.fn();
jest.mock("../modules/platform/services/ExpoPush", () => ({
  ...jest.requireActual("../modules/platform/services/ExpoPush"),
  sendExpoPush: (m: unknown) => mockSendExpoPush(m),
}));

// Break the ChatPushService ⇄ MessageDispatchService import cycle in isolation.
jest.mock("../modules/chat/services/MessageDispatchService", () => ({
  SYSTEM_SENDER_ID: "000000000000000000000000",
}));

import { pushNewChatMessage } from "../modules/chat/services/ChatPushService";
import type { IChatMessage } from "../modules/chat/models/ChatMessage";

function msg(over: Partial<IChatMessage> = {}): IChatMessage {
  return {
    _id: oid(),
    conversationId: oid(),
    senderId: oid(),
    body: "হ্যালো",
    attachmentIds: [],
    createdAt: new Date(),
    ...over,
  } as unknown as IChatMessage;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMemberFind.mockResolvedValue([{ userId: oid() }]);
  mockPushFind.mockResolvedValue([{ expoPushToken: "ExponentPushToken[a]" }]);
  mockConvFindById.mockResolvedValue(null); // DIRECT by default (no title)
  mockUserFindById.mockResolvedValue({ name: "Teacher A" });
  mockSendExpoPush.mockResolvedValue({ okCount: 1, deadTokens: [] });
});

describe("M7.1 — recipient + mute filtering", () => {
  it("queries members excluding the sender and the muted, then pushes to their devices", async () => {
    const m = msg();
    const recipient = oid();
    mockMemberFind.mockResolvedValue([{ userId: recipient }]);
    mockPushFind.mockResolvedValue([
      { expoPushToken: "ExponentPushToken[a]" },
      { expoPushToken: "ExponentPushToken[b]" },
    ]);

    await pushNewChatMessage(m);

    // Membership query excludes sender + muted rows.
    const memberFilter = mockMemberFind.mock.calls[0][0] as Record<string, any>;
    expect(memberFilter.conversationId).toBe(m.conversationId.toString());
    expect(memberFilter.userId.$ne.toString()).toBe(m.senderId.toString());
    expect(memberFilter.muted).toEqual({ $ne: true });

    // Devices looked up for the recipient ids, active, non-web.
    const pushFilter = mockPushFind.mock.calls[0][0] as Record<string, any>;
    expect(pushFilter.userId.$in).toEqual([recipient]);
    expect(pushFilter.active).toBe(true);

    // One push per device, carrying the body + chat transport data.
    const sent = mockSendExpoPush.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ to: "ExponentPushToken[a]", body: "হ্যালো" });
    expect(sent[0].data).toMatchObject({
      kind: "CHAT_MESSAGE",
      conversationId: m.conversationId.toString(),
      messageId: m._id.toString(),
    });
  });
});

describe("M7.2 — title + body preview", () => {
  it("uses the group title when the conversation has one", async () => {
    mockConvFindById.mockResolvedValue({ title: "ক্লাস ৩ ছেলে" });
    await pushNewChatMessage(msg());
    expect((mockSendExpoPush.mock.calls[0][0] as any)[0].title).toBe("ক্লাস ৩ ছেলে");
  });

  it("falls back to the sender's name for a DIRECT (untitled) thread", async () => {
    mockConvFindById.mockResolvedValue(null);
    mockUserFindById.mockResolvedValue({ name: "Teacher A" });
    await pushNewChatMessage(msg());
    expect((mockSendExpoPush.mock.calls[0][0] as any)[0].title).toBe("Teacher A");
  });

  it("uses an attachment preview when the body is empty (attachment-only)", async () => {
    await pushNewChatMessage(msg({ body: "" }));
    expect((mockSendExpoPush.mock.calls[0][0] as any)[0].body).toBe("📎 সংযুক্তি");
  });
});

describe("M7.3 — system-dispatched message", () => {
  it("titles 'SCD Hub' and never looks up a sender user", async () => {
    const m = msg({ senderId: new mongoose.Types.ObjectId(SYSTEM_SENDER_ID) });
    await pushNewChatMessage(m);
    expect(mockUserFindById).not.toHaveBeenCalled();
    expect((mockSendExpoPush.mock.calls[0][0] as any)[0].title).toBe("SCD Hub");
  });
});

describe("M7.4 — graceful no-ops", () => {
  it("no members → no device lookup, no transport call", async () => {
    mockMemberFind.mockResolvedValue([]);
    await pushNewChatMessage(msg());
    expect(mockPushFind).not.toHaveBeenCalled();
    expect(mockSendExpoPush).not.toHaveBeenCalled();
  });

  it("no registered device (every recipient web/inbox-only) → no transport call", async () => {
    mockPushFind.mockResolvedValue([]);
    await pushNewChatMessage(msg());
    expect(mockSendExpoPush).not.toHaveBeenCalled();
  });
});

describe("M7.5 — web devices excluded", () => {
  it("filters web devices out of the fan-out query", async () => {
    await pushNewChatMessage(msg());
    const pushFilter = mockPushFind.mock.calls[0][0] as Record<string, any>;
    expect(pushFilter.platform).toEqual({ $ne: "web" });
  });
});

describe("M7.6 — dead-token pruning", () => {
  it("deactivates tokens Expo reports as dead", async () => {
    mockSendExpoPush.mockResolvedValue({ okCount: 0, deadTokens: ["ExponentPushToken[dead]"] });
    await pushNewChatMessage(msg());
    expect(mockPushUpdateMany).toHaveBeenCalledWith(
      { expoPushToken: { $in: ["ExponentPushToken[dead]"] } },
      { $set: { active: false } },
    );
  });
});

describe("M7.7 — best-effort (never throws)", () => {
  it("a model failure is swallowed, not propagated", async () => {
    mockMemberFind.mockRejectedValue(new Error("db down"));
    await expect(pushNewChatMessage(msg())).resolves.toBeUndefined();
    expect(mockSendExpoPush).not.toHaveBeenCalled();
  });
});
