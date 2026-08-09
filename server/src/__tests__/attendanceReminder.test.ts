/**
 * AT-4 — reminder + escalation engine (prd-attendance §6 AT4.1–AT4.6, §9, D-#65;
 * delivery reconciled onto the D-#72 emit() seam by N-2, D-#99). Pure helpers
 * exercised directly; the orchestrator runs against mocked models (DB-free) +
 * a mocked emit seam. Covers: FULL-day gate, unmarked-only dispatch,
 * tier→audience routing, per-recipient inbox emission (push rides the N-4
 * channel BEHIND the seam — no direct transport here anymore), idempotency,
 * no-op when already marked, audit.
 */
const mockResolveDayType = jest.fn();
const mockUnmarkedSections = jest.fn();
const mockSectionFind = jest.fn();
const mockUserFind = jest.fn();
const mockDispatchFind = jest.fn();
const mockDispatchCreate = jest.fn().mockResolvedValue({});
const mockEmit = jest.fn();
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
jest.mock("../modules/attendance/models/AttendanceReminderDispatch", () => ({
  AttendanceReminderDispatch: {
    find: (f: unknown) => ({ select: () => ({ lean: () => mockDispatchFind(f) }) }),
    create: (d: unknown) => mockDispatchCreate(d),
  },
}));
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (input: unknown) => mockEmit(input),
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
  mockDispatchFind.mockResolvedValue([]);
  mockEmit.mockResolvedValue({ created: true, dedupeKey: "x" });
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
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("AT4.2 — no-op when nothing is unmarked", async () => {
    mockUnmarkedSections.mockResolvedValue([]);
    const r = await dispatchAttendanceReminders("T1210", DATE);
    expect(r.isFullDay).toBe(true);
    expect(r.unmarkedCount).toBe(0);
    expect(r.dispatchedSections).toBe(0);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockDispatchCreate).not.toHaveBeenCalled();
  });

  it("AT4.3/D-#99 — T1210 emits one ATTENDANCE_REMINDER row per recipient (marker + class teacher), records ledger + audit", async () => {
    mockUnmarkedSections.mockResolvedValue([
      { sectionId: "s1", sectionNameBn: "মূল", markerTeacherId: "t1" },
    ]);
    mockSectionFind.mockResolvedValue([{ _id: oid("s1"), classTeacherId: oid("ct1") }]);

    const r = await dispatchAttendanceReminders("T1210", DATE);

    expect(r.dispatchedSections).toBe(1);
    expect(r.recipientCount).toBe(2);
    // one seam call per recipient, idempotent per (date,tier,section,recipient)
    expect(mockEmit).toHaveBeenCalledTimes(2);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: "t1",
        kind: "ATTENDANCE_REMINDER",
        refs: expect.objectContaining({ sectionId: "s1", date: DATE, tier: "T1210" }),
        dedupeKey: `ATT:${DATE}:T1210:s1:t1`,
      }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "ct1", dedupeKey: `ATT:${DATE}:T1210:s1:ct1` }),
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

    await dispatchAttendanceReminders("T1245", DATE);
    // D-#468: recipients resolve by primary role OR added template, so an office-by-
    // template user is reached too. Asserting the filter INTENT, not a literal shape.
    expect(mockUserFind).toHaveBeenCalledWith(expect.objectContaining({ active: true, $or: [{ role: { $in: ["OFFICE"] } }, { additionalTemplates: { $in: ["OFFICE"] } }] }));
    expect(mockEmit).toHaveBeenCalledTimes(2);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "o1", dedupeKey: `ATT:${DATE}:T1245:s1:o1` }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "o2", dedupeKey: `ATT:${DATE}:T1245:s1:o2` }),
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
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockDispatchCreate).not.toHaveBeenCalled();
  });

  it("a racing ledger insert (E11000) counts the section as already dispatched", async () => {
    mockUnmarkedSections.mockResolvedValue([
      { sectionId: "s1", sectionNameBn: "মূল", markerTeacherId: "t1" },
    ]);
    mockSectionFind.mockResolvedValue([{ _id: oid("s1"), classTeacherId: null }]);
    mockDispatchCreate.mockRejectedValueOnce({ code: 11000 });

    const r = await dispatchAttendanceReminders("T1210", DATE);
    expect(r.alreadyDispatched).toBe(1);
    expect(r.dispatchedSections).toBe(0);
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});
