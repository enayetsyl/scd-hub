/**
 * D-#296 — the web-push channel + its opt-in contract.
 *
 *   1. no subscriptions → nothing sent (opt-in by construction)
 *   2. every subscription of the recipient gets the payload (title/body/kind)
 *   3. a 410 Gone response deletes that subscription (revoked permission);
 *      other errors are logged, never thrown (best-effort channel)
 *   4. registerWebPushChannel is a no-op without VAPID keys
 *
 * DB-free: the model + the web-push transport are mocked.
 */
const mockSubFind = jest.fn();
const mockSubDeleteOne = jest.fn();
const mockSend = jest.fn();
const mockSetVapid = jest.fn();
const mockRegisterChannel = jest.fn();

jest.mock("web-push", () => ({
  __esModule: true,
  default: {
    sendNotification: (...a: unknown[]) => mockSend(...a),
    setVapidDetails: (...a: unknown[]) => mockSetVapid(...a),
  },
}));
jest.mock("../modules/notifications/models/WebPushSubscription", () => ({
  WebPushSubscription: {
    find: (f: unknown) => ({ lean: () => mockSubFind(f) }),
    deleteOne: (f: unknown) => ({ catch: () => mockSubDeleteOne(f) }),
  },
}));
jest.mock("../modules/notifications/services/NotificationService", () => ({
  registerChannel: (...a: unknown[]) => mockRegisterChannel(...a),
}));

import {
  webPushChannel,
  registerWebPushChannel,
  webPushConfigured,
} from "../modules/notifications/services/webPushChannel";
import type { INotification } from "../modules/notifications/models/Notification";

const row = (over: Record<string, unknown> = {}): INotification =>
  ({
    _id: { toString: () => "n1" },
    recipientUserId: "u1",
    kind: "PRINT_REQUESTED",
    titleBn: "নতুন প্রিন্ট অনুরোধ",
    bodyBn: "বার্তা",
    refs: { printRequestId: "p1" },
    ...over,
  }) as unknown as INotification;

const sub = (id: string) => ({
  _id: { toString: () => id },
  endpoint: `https://push.example/${id}`,
  p256dh: "k",
  auth: "a",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSubFind.mockResolvedValue([]);
  mockSend.mockResolvedValue({});
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
});

describe("web-push channel (D-#296)", () => {
  test("no subscriptions → nothing sent (opt-in by construction)", async () => {
    await webPushChannel.deliver(row());
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("sends the payload to EVERY subscription of the recipient", async () => {
    mockSubFind.mockResolvedValue([sub("s1"), sub("s2")]);
    await webPushChannel.deliver(row());
    expect(mockSubFind).toHaveBeenCalledWith({ userId: "u1" });
    expect(mockSend).toHaveBeenCalledTimes(2);
    const [, payload] = mockSend.mock.calls[0] as [unknown, string];
    expect(JSON.parse(payload)).toMatchObject({
      title: "নতুন প্রিন্ট অনুরোধ",
      kind: "PRINT_REQUESTED",
      notificationId: "n1",
    });
  });

  test("guardian recipients look up by guardianId", async () => {
    mockSubFind.mockResolvedValue([]);
    await webPushChannel.deliver(row({ recipientUserId: null, recipientGuardianId: "g1" }));
    expect(mockSubFind).toHaveBeenCalledWith({ guardianId: "g1" });
  });

  test("a 410 Gone deletes the dead subscription; other errors never throw", async () => {
    mockSubFind.mockResolvedValue([sub("dead"), sub("flaky")]);
    mockSend
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockRejectedValueOnce({ statusCode: 500 });
    await expect(webPushChannel.deliver(row())).resolves.toBeUndefined();
    expect(mockSubDeleteOne).toHaveBeenCalledTimes(1);
  });

  test("registerWebPushChannel is a no-op without VAPID keys; registers with them", () => {
    expect(webPushConfigured()).toBe(false);
    registerWebPushChannel();
    expect(mockRegisterChannel).not.toHaveBeenCalled();

    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "pub";
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "priv";
    registerWebPushChannel();
    expect(mockSetVapid).toHaveBeenCalled();
    expect(mockRegisterChannel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "web-push" }),
    );
  });
});
