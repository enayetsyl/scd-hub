/**
 * N-4 — the Expo push channel behind emit() (prd-notifications §8 N4.*, D-#75).
 *
 * N4.2 — a NEW row fans out one push per registered device of ITS recipient
 *        (user-owned vs guardian-owned lookups are disjoint)
 * N4.3 — dead tokens Expo reports are pruned (deactivated); the transport is
 *        best-effort (never throws) and emit() catches a channel throw — the
 *        inbox row never rolls back (asserted in notifications.test.ts)
 * N4.4 — a recipient with no registered device (every web session) is a silent
 *        no-op: no transport call at all
 * Registration — registerPushDevice() upserts by token with an exactly-one
 *        owner (staff User OR Guardian, D-#75 reconciled onto AT-4's PushDevice)
 *
 * DB-free: PushDevice + the Expo transport mocked; channel + service real.
 */
const mockPushFind = jest.fn();
const mockPushUpdateMany = jest.fn().mockResolvedValue(undefined);
const mockPushFindOneAndUpdate = jest.fn();
const mockSendExpoPush = jest.fn();

jest.mock("../modules/attendance/models/PushDevice", () => ({
  PushDevice: {
    find: (f: unknown) => ({ select: () => ({ lean: () => mockPushFind(f) }) }),
    updateMany: (f: unknown, u: unknown) => mockPushUpdateMany(f, u),
    findOneAndUpdate: (f: unknown, u: unknown, o: unknown) => mockPushFindOneAndUpdate(f, u, o),
  },
}));
jest.mock("../modules/platform/services/ExpoPush", () => ({
  ...jest.requireActual("../modules/platform/services/ExpoPush"),
  sendExpoPush: (m: unknown) => mockSendExpoPush(m),
}));

import mongoose from "mongoose";
import { expoPushChannel } from "../modules/notifications/services/pushChannel";
import type { INotification } from "../modules/notifications/models/Notification";
import {
  registerPushDevice,
  PushDeviceError,
} from "../modules/attendance/services/PushDeviceService";

const oid = () => new mongoose.Types.ObjectId();

function row(over: Partial<INotification> = {}): INotification {
  return {
    _id: oid(),
    recipientUserId: oid(),
    kind: "REVIEW_ASSIGNED",
    titleBn: "শিরোনাম",
    bodyBn: "বিস্তারিত",
    refs: { date: "2026-06-15" },
    dedupeKey: "TEST:1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as unknown as INotification;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPushFind.mockResolvedValue([]);
  mockSendExpoPush.mockResolvedValue({ okCount: 0, deadTokens: [] });
  mockPushFindOneAndUpdate.mockResolvedValue({});
});

describe("N4.2 — send-on-emit fan-out", () => {
  it("pushes the row's Bangla title/body to every active device of a USER recipient", async () => {
    const r = row();
    mockPushFind.mockResolvedValue([
      { expoPushToken: "ExponentPushToken[a]" },
      { expoPushToken: "ExponentPushToken[b]" },
    ]);
    mockSendExpoPush.mockResolvedValue({ okCount: 2, deadTokens: [] });

    await expoPushChannel.deliver(r);

    expect(mockPushFind).toHaveBeenCalledWith({ userId: r.recipientUserId, active: true });
    const messages = mockSendExpoPush.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      to: "ExponentPushToken[a]",
      title: "শিরোনাম",
      body: "বিস্তারিত",
    });
    // the tap handler routes on kind+refs (the N3.2 deep-links)
    expect(messages[0].data).toMatchObject({ kind: "REVIEW_ASSIGNED" });
  });

  it("a GUARDIAN recipient resolves guardian-owned devices (D-#75)", async () => {
    const guardianId = oid();
    const r = row({ recipientUserId: undefined, recipientGuardianId: guardianId });
    mockPushFind.mockResolvedValue([{ expoPushToken: "ExponentPushToken[g]" }]);

    await expoPushChannel.deliver(r);
    expect(mockPushFind).toHaveBeenCalledWith({ guardianId, active: true });
  });
});

describe("N4.4 — web/inbox-only recipients", () => {
  it("no registered device → no transport call at all", async () => {
    mockPushFind.mockResolvedValue([]);
    await expoPushChannel.deliver(row());
    expect(mockSendExpoPush).not.toHaveBeenCalled();
  });
});

describe("N4.3 — dead-token pruning", () => {
  it("deactivates tokens Expo reports as dead", async () => {
    mockPushFind.mockResolvedValue([{ expoPushToken: "ExponentPushToken[dead]" }]);
    mockSendExpoPush.mockResolvedValue({ okCount: 0, deadTokens: ["ExponentPushToken[dead]"] });

    await expoPushChannel.deliver(row());
    expect(mockPushUpdateMany).toHaveBeenCalledWith(
      { expoPushToken: { $in: ["ExponentPushToken[dead]"] } },
      { $set: { active: false } },
    );
  });
});

describe("registerPushDevice — exactly-one owner upsert (N4.1)", () => {
  it("staff registration sets userId and clears any guardian owner", async () => {
    await registerPushDevice({ userId: "u1" }, " ExponentPushToken[a] ", "android");
    expect(mockPushFindOneAndUpdate).toHaveBeenCalledWith(
      { expoPushToken: "ExponentPushToken[a]" },
      expect.objectContaining({
        $set: expect.objectContaining({ userId: "u1", active: true, platform: "android" }),
        $unset: { guardianId: "" },
      }),
      expect.objectContaining({ upsert: true }),
    );
  });

  it("guardian registration sets guardianId and clears any user owner", async () => {
    await registerPushDevice({ guardianId: "g1" }, "ExponentPushToken[b]");
    expect(mockPushFindOneAndUpdate).toHaveBeenCalledWith(
      { expoPushToken: "ExponentPushToken[b]" },
      expect.objectContaining({
        $set: expect.objectContaining({ guardianId: "g1" }),
        $unset: { userId: "" },
      }),
      expect.objectContaining({ upsert: true }),
    );
  });

  it("zero or two owners is rejected", async () => {
    await expect(registerPushDevice({}, "ExponentPushToken[x]")).rejects.toThrow(PushDeviceError);
    await expect(
      registerPushDevice({ userId: "u1", guardianId: "g1" }, "ExponentPushToken[x]"),
    ).rejects.toThrow(PushDeviceError);
    expect(mockPushFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("an empty token is rejected", async () => {
    await expect(registerPushDevice({ userId: "u1" }, "  ")).rejects.toThrow(PushDeviceError);
  });
});
