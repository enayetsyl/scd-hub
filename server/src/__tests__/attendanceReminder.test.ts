/**
 * AT-4 — reminder + escalation engine (prd-attendance §6 AT4.1–AT4.6, §9, D-#65).
 * Pure helpers exercised directly; the orchestrator runs against mocked models
 * (DB-free) + a mocked Expo transport. Covers: FULL-day gate, unmarked-only
 * dispatch, tier→audience routing, idempotency, no-op when already marked,
 * dead-token pruning, audit.
 */
const mockResolveDayType = jest.fn();
const mockUnmarkedSections = jest.fn();
const mockSectionFind = jest.fn();
const mockUserFind = jest.fn();
const mockPushFind = jest.fn();
const mockPushUpdateMany = jest.fn().mockResolvedValue(undefined);
const mockDispatchFind = jest.fn();
const mockDispatchCreate = jest.fn().mockResolvedValue({});
const mockSendExpoPush = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: unknown) => mockResolveDayType(d),
}));
jest.mock("../modules/attendance/services/AttendanceReportService", () => ({
  unmarkedSections: (k: unknown) => mockUnmarkedSections(k),
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (f: unknown) => ({ select: () => ({ lean: () => mockSectionFind(f) }) }) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => ({ select: () => ({ lean: () => mockUserFind(f) }) }) },
}));
jest.mock("../modules/attendance/models/PushDevice", () => ({
  PushDevice: {
    find: (f: unknown) => ({ select: () => ({ lean: () => mockPushFind(f) }) }),
    updateMany: (a: unknown, b: unknown) => mockPushUpdateMany(a, b),
  },
}));
jest.mock("../modules/attendance/models/AttendanceReminderDispatch", () => ({
  AttendanceReminderDispatch: {
    find: (f: unknown) => ({ select: () => ({ lean: () => mockDispatchFind(f) }) }),
    create: (d: unknown) => mockDispatchCreate(d),
  },
}));
jest.mock("../modules/platform/services/ExpoPush", () => ({
  ...jest.requireActual("../modules/platform/services/ExpoPush"),
  sendExpoPush: (m: unknown) => mockSendExpoPush(m),
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import {
  dispatchAttendanceReminders,
  recipientsForTier,
} from "../modules/attendance/services/AttendanceReminderService";
import { deadTokensFromTickets } from "../modules/platform/services/ExpoPush";

const DATE = "2026-06-15"; // a Monday → FULL when resolveDayType is mocked FULL
const oid = (s: string) => ({ toString: () => s });

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveDayType.mockResolvedValue("FULL");
  mockUnmarkedSections.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([]);
  mockUserFind.mockResolvedValue([]);
  mockPushFind.mockResolvedValue([]);
  mockDispatchFind.mockResolvedValue([]);
  mockSendExpoPush.mockResolvedValue({ okCount: 0, deadTokens: [] });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("recipientsForTier (AT4.3–4.5)", () => {
  const esc = { officeIds: ["o1", "o2"], principalIds: ["p1"] };

  it("T1210 = marker + class teacher, deduped, non-null", () => {
    expect(recipientsForTier("T1210", { markerTeacherId: "t1", classTeacherId: "ct1" }, esc)).toEqual(["t1", "ct1"]);
    // marker IS the class teacher → single recipient
    expect(recipientsForTier("T1210", { markerTeacherId: "t1", classTeacherId: "t1" }, esc)).toEqual(["t1"]);
    // no marker, no class teacher → empty
    expect(recipientsForTier("T1210", { markerTeacherId: null, classTeacherId: null }, esc)).toEqual([]);
  });

  it("T1245 = all Office; T1400 = all Principal", () => {
    expect(recipientsForTier("T1245", { markerTeacherId: "t1", classTeacherId: "ct1" }, esc)).toEqual(["o1", "o2"]);
    expect(recipientsForTier("T1400", { markerTeacherId: "t1", classTeacherId: "ct1" }, esc)).toEqual(["p1"]);
  });
});

describe("deadTokensFromTickets", () => {
  it("extracts only DeviceNotRegistered tokens, order-aligned", () => {
    const tokens = ["A", "B", "C"];
    const tickets = [
      { status: "ok" as const },
      { status: "error" as const, details: { error: "DeviceNotRegistered" } },
      { status: "error" as const, details: { error: "MessageTooBig" } },
    ];
    expect(deadTokensFromTickets(tokens, tickets)).toEqual(["B"]);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

describe("dispatchAttendanceReminders", () => {
  it("AT4.1 — no-op on a non-FULL day (never touches the work-list)", async () => {
    mockResolveDayType.mockResolvedValue("OFF");
    const r = await dispatchAttendanceReminders("T1210", DATE);
    expect(r.isFullDay).toBe(false);
    expect(r.dispatchedSections).toBe(0);
    expect(mockUnmarkedSections).not.toHaveBeenCalled();
    expect(mockSendExpoPush).not.toHaveBeenCalled();
  });

  it("AT4.2 — no-op when nothing is unmarked", async () => {
    mockUnmarkedSections.mockResolvedValue([]);
    const r = await dispatchAttendanceReminders("T1210", DATE);
    expect(r.isFullDay).toBe(true);
    expect(r.unmarkedCount).toBe(0);
    expect(r.dispatchedSections).toBe(0);
    expect(mockSendExpoPush).not.toHaveBeenCalled();
    expect(mockDispatchCreate).not.toHaveBeenCalled();
  });

  it("AT4.3 — T1210 pushes to marker + class teacher, records ledger + audit", async () => {
    mockUnmarkedSections.mockResolvedValue([
      { sectionId: "s1", sectionNameBn: "মূল", markerTeacherId: "t1" },
    ]);
    mockSectionFind.mockResolvedValue([{ _id: oid("s1"), classTeacherId: oid("ct1") }]);
    mockPushFind.mockResolvedValue([
      { expoPushToken: "ExponentPushToken[a]" },
      { expoPushToken: "ExponentPushToken[b]" },
    ]);
    mockSendExpoPush.mockResolvedValue({ okCount: 2, deadTokens: [] });

    const r = await dispatchAttendanceReminders("T1210", DATE);

    expect(r.dispatchedSections).toBe(1);
    expect(r.deviceCount).toBe(2);
    // recipients resolved = marker t1 + class teacher ct1
    expect(mockPushFind).toHaveBeenCalledWith(
      expect.objectContaining({ userId: { $in: ["t1", "ct1"] }, active: true }),
    );
    expect(mockSendExpoPush).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ to: "ExponentPushToken[a]" })]),
    );
    expect(mockDispatchCreate).toHaveBeenCalledWith(
      expect.objectContaining({ dateKey: DATE, tier: "T1210", sectionId: "s1" }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "ATTENDANCE_REMINDER_SENT" }),
    );
  });

  it("AT4.4/4.5 — T1245 routes to Office, T1400 to Principal", async () => {
    mockUnmarkedSections.mockResolvedValue([
      { sectionId: "s1", sectionNameBn: "মূল", markerTeacherId: "t1" },
    ]);
    mockSectionFind.mockResolvedValue([{ _id: oid("s1"), classTeacherId: oid("ct1") }]);
    mockUserFind.mockResolvedValue([{ _id: oid("o1") }, { _id: oid("o2") }]);
    mockPushFind.mockResolvedValue([{ expoPushToken: "ExponentPushToken[o]" }]);
    mockSendExpoPush.mockResolvedValue({ okCount: 1, deadTokens: [] });

    await dispatchAttendanceReminders("T1245", DATE);
    expect(mockUserFind).toHaveBeenCalledWith(expect.objectContaining({ role: "OFFICE", active: true }));
    expect(mockPushFind).toHaveBeenCalledWith(
      expect.objectContaining({ userId: { $in: ["o1", "o2"] }, active: true }),
    );
  });

  it("AT4.6 — idempotent: a section already dispatched for this date/tier is skipped", async () => {
    mockUnmarkedSections.mockResolvedValue([
      { sectionId: "s1", sectionNameBn: "মূল", markerTeacherId: "t1" },
    ]);
    mockDispatchFind.mockResolvedValue([{ sectionId: oid("s1") }]); // already sent

    const r = await dispatchAttendanceReminders("T1210", DATE);

    expect(r.alreadyDispatched).toBe(1);
    expect(r.dispatchedSections).toBe(0);
    expect(mockSendExpoPush).not.toHaveBeenCalled();
    expect(mockDispatchCreate).not.toHaveBeenCalled();
  });

  it("prunes dead tokens Expo reports", async () => {
    mockUnmarkedSections.mockResolvedValue([
      { sectionId: "s1", sectionNameBn: "মূল", markerTeacherId: "t1" },
    ]);
    mockSectionFind.mockResolvedValue([{ _id: oid("s1"), classTeacherId: null }]);
    mockPushFind.mockResolvedValue([{ expoPushToken: "ExponentPushToken[dead]" }]);
    mockSendExpoPush.mockResolvedValue({ okCount: 0, deadTokens: ["ExponentPushToken[dead]"] });

    await dispatchAttendanceReminders("T1210", DATE);
    expect(mockPushUpdateMany).toHaveBeenCalledWith(
      { expoPushToken: { $in: ["ExponentPushToken[dead]"] } },
      { $set: { active: false } },
    );
  });
});
