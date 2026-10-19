/**
 * D-#296 — the web-push channel + its opt-in contract.
 *
 *   1. no subscriptions → nothing sent (opt-in by construction)
 *   2. every subscription of the recipient gets the payload (title/body/kind)
 *   3. a 410 Gone response deletes that subscription (revoked permission);
 *      other errors are logged, never thrown (best-effort channel)
 *   4. registerWebPushChannel is a no-op without VAPID keys
 *   5. D-#773: a phone browser is skipped while the recipient's app is registered
 *      on that platform; desktop browsers always receive
 *
 * DB-free: the models + the web-push transport are mocked.
 */
const mockSubFind = jest.fn();
const mockDeviceFind = jest.fn();
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
jest.mock("../modules/attendance/models/PushDevice", () => ({
  PushDevice: {
    find: (f: unknown) => ({ select: () => ({ lean: () => mockDeviceFind(f) }) }),
  },
}));
jest.mock("../modules/notifications/services/NotificationService", () => ({
  registerChannel: (...a: unknown[]) => mockRegisterChannel(...a),
}));

import {
  webPushChannel,
  registerWebPushChannel,
  webPushConfigured,
  phoneBrowserPlatform,
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

const sub = (id: string, userAgent?: string) => ({
  _id: { toString: () => id },
  endpoint: `https://push.example/${id}`,
  p256dh: "k",
  auth: "a",
  userAgent,
});

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const sentEndpoints = (): string[] =>
  mockSend.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint);

beforeEach(() => {
  jest.clearAllMocks();
  mockSubFind.mockResolvedValue([]);
  mockDeviceFind.mockResolvedValue([]);
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

  test("D-#773: an Android app registration skips the recipient's Android browsers only", async () => {
    mockSubFind.mockResolvedValue([
      sub("phone", ANDROID_CHROME),
      sub("laptop", WINDOWS_CHROME),
      sub("iphone", IPHONE_SAFARI),
      sub("legacy"), // no recorded agent → always receives
    ]);
    mockDeviceFind.mockResolvedValue([{ platform: "android" }]);
    await webPushChannel.deliver(row());
    expect(mockDeviceFind).toHaveBeenCalledWith({ userId: "u1", active: true });
    expect(sentEndpoints().sort()).toEqual(
      ["https://push.example/iphone", "https://push.example/laptop", "https://push.example/legacy"],
    );
  });

  test("D-#773: no live app registration → the phone browser still receives", async () => {
    mockSubFind.mockResolvedValue([sub("phone", ANDROID_CHROME)]);
    mockDeviceFind.mockResolvedValue([]); // app logged out / uninstalled (inactive rows are not returned)
    await webPushChannel.deliver(row({ recipientUserId: null, recipientGuardianId: "g1" }));
    expect(mockDeviceFind).toHaveBeenCalledWith({ guardianId: "g1", active: true });
    expect(sentEndpoints()).toEqual(["https://push.example/phone"]);
  });

  test("D-#773: every subscription skipped → nothing sent", async () => {
    mockSubFind.mockResolvedValue([sub("phone", ANDROID_CHROME), sub("phone2", ANDROID_CHROME)]);
    mockDeviceFind.mockResolvedValue([{ platform: "android" }]);
    await webPushChannel.deliver(row());
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("phoneBrowserPlatform classifies phone browsers; desktop/unknown is null", () => {
    expect(phoneBrowserPlatform(ANDROID_CHROME)).toBe("android");
    expect(phoneBrowserPlatform(IPHONE_SAFARI)).toBe("ios");
    expect(phoneBrowserPlatform(WINDOWS_CHROME)).toBeNull();
    expect(phoneBrowserPlatform(undefined)).toBeNull();
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
