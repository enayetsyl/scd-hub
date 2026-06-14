/**
 * Parents' Meeting CM-4 tests (prd-comments-meetings §4.1/§6, J-CM4/J-CM5, D-#176).
 *
 * Pure      — formatSlotTime; meetingSlotMessageBn (timed vs On-Call); meetingSlotWaLink
 *             (phone vs phone-less familyKey → wa.me or null).
 * Service   — dispatchMeetingSchedule (draft→scheduled, dispatchedAt stamped, wa.me-for-
 *             all + unreachableCount, kind-gated emit no-op → notifiedCount 0 + wa.me
 *             fallthrough, refuses a closed meeting); setSlotAttendance (present/absent +
 *             remark, draft-guard, audit); meetingAttendanceSummary (derived aggregates).
 * Emitter   — emitMeetingSchedule is a NO-OP while MEETING_SCHEDULE is unregistered
 *             (the §4.1/D-#94 path): returns [] WITHOUT touching GuardianLink.
 * RBAC      — the admin gate composes the EXISTING roster:manage permission (D-#17/#94).
 *
 * DB-free (the repo convention): models, the emit door, and audit are mocked. The REAL
 * emitMeetingSchedule runs (so the kind-gate is genuinely exercised).
 */
import mongoose from "mongoose";
import { roleHasPermission, NOTIFICATION_KINDS } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const chain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  o.exec = async () => val;
  return o;
};

const mockMeetingFindById = jest.fn();
jest.mock("../modules/comments/models/ParentMeeting", () => ({
  ParentMeeting: { findById: (id: unknown) => mockMeetingFindById(id) },
  PARENT_MEETING_STATUSES: ["draft", "scheduled", "closed"],
}));

const mockSlotFind = jest.fn();
const mockSlotFindById = jest.fn();
jest.mock("../modules/comments/models/ParentMeetingSlot", () => ({
  ParentMeetingSlot: {
    find: (q: unknown) => mockSlotFind(q),
    findById: (id: unknown) => mockSlotFindById(id),
  },
}));

// The notification door + recipient models — mocked so the kind-gate can be proven by
// asserting GuardianLink.find is NEVER reached while MEETING_SCHEDULE is unregistered.
const mockGuardianLinkFind = jest.fn();
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: { find: (q: unknown) => mockGuardianLinkFind(q) },
}));
const mockGuardianFind = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { find: (q: unknown) => mockGuardianFind(q) },
}));
const mockEmit = jest.fn();
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (e: unknown) => mockEmit(e),
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import {
  formatSlotTime,
  meetingSlotMessageBn,
  meetingSlotWaLink,
  dispatchMeetingSchedule,
  setSlotAttendance,
  meetingAttendanceSummary,
} from "../modules/comments/services/MeetingDispatchService";
import { emitMeetingSchedule } from "../modules/notifications/services/emitters";
import { ParentMeetingError } from "../modules/comments/services/ParentMeetingService";

const MEETING_OID = oid();
const ACTOR = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
});

// ===========================================================================
// Pure formatters
// ===========================================================================

describe("formatSlotTime / meetingSlotMessageBn / meetingSlotWaLink", () => {
  test("formatSlotTime renders minutes-from-midnight as HH:MM", () => {
    expect(formatSlotTime(600)).toBe("10:00");
    expect(formatSlotTime(615)).toBe("10:15");
    expect(formatSlotTime(0)).toBe("00:00");
    expect(formatSlotTime(null)).toBe("—");
  });

  test("meetingSlotMessageBn carries the slot time for a timed slot", () => {
    const msg = meetingSlotMessageBn({
      instanceLabel: "2026 — 1st",
      meetingDate: new Date("2026-07-01T00:00:00Z"),
      slotTime: 600,
      onCall: false,
    });
    expect(msg).toContain("2026 — 1st");
    expect(msg).toContain("01/07/2026");
    expect(msg).toContain("10:00");
  });

  test("meetingSlotMessageBn says On-Call (no time) for an On-Call slot (J-CM4)", () => {
    const msg = meetingSlotMessageBn({
      instanceLabel: "2026 — 1st",
      meetingDate: new Date("2026-07-01T00:00:00Z"),
      slotTime: null,
      onCall: true,
    });
    expect(msg).toContain("ডাকা হলে আসবেন");
    expect(msg).not.toMatch(/\d\d:\d\d/); // no fixed time
  });

  test("meetingSlotWaLink builds a link from a phone familyKey, null for phone-less", () => {
    const link = meetingSlotWaLink("01711000111", "hello");
    expect(link).toBe(`https://wa.me/01711000111?text=${encodeURIComponent("hello")}`);
    expect(meetingSlotWaLink("nophone:" + oid().toString(), "hi")).toBeNull();
    expect(meetingSlotWaLink("", "hi")).toBeNull();
  });
});

// ===========================================================================
// emitMeetingSchedule — the kind-gated no-op (§4.1 / D-#94)
// ===========================================================================

describe("emitMeetingSchedule (kind-gated)", () => {
  test("MEETING_SCHEDULE is NOT a registered kind (the vocab-locked reality)", () => {
    expect((NOTIFICATION_KINDS as readonly string[]).includes("MEETING_SCHEDULE")).toBe(false);
  });

  test("no-ops (returns []) WITHOUT touching GuardianLink while the kind is unregistered", async () => {
    const res = await emitMeetingSchedule({
      meetingId: MEETING_OID,
      slotId: oid(),
      studentIds: [oid()],
      titleBn: "t",
      messageBn: "m",
    });
    expect(res).toEqual([]);
    expect(mockGuardianLinkFind).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// dispatchMeetingSchedule
// ===========================================================================

const meetingDoc = (over: Record<string, unknown> = {}) => {
  const d: Record<string, unknown> = {
    _id: MEETING_OID,
    instanceLabel: "2026 — 1st",
    meetingDate: new Date("2026-07-01T00:00:00Z"),
    slotMinutes: 15,
    dayStartMinutes: 600,
    status: "draft",
    ...over,
  };
  d.save = jest.fn(async () => d);
  return d;
};

const slotDoc = (over: Record<string, unknown> = {}) => {
  const d: Record<string, unknown> = {
    _id: oid(),
    meetingId: MEETING_OID,
    familyKey: "01711000111",
    studentIds: [oid()],
    classLabels: ["KG"],
    order: 0,
    slotTime: 600,
    onCall: false,
    createdAt: new Date("2026-06-14T00:00:00Z"),
    updatedAt: new Date("2026-06-14T00:00:00Z"),
    ...over,
  };
  d.save = jest.fn(async () => d);
  return d;
};

describe("dispatchMeetingSchedule (J-CM5)", () => {
  test("flips draft→scheduled, stamps dispatchedAt, wa.me-for-all + unreachableCount; kind-gated emit → notifiedCount 0", async () => {
    const meeting = meetingDoc();
    const phoneSlot = slotDoc({ familyKey: "01711000111", order: 0, slotTime: 600 });
    const noPhoneSlot = slotDoc({ familyKey: "nophone:" + oid().toString(), order: 1, slotTime: 615 });
    mockMeetingFindById.mockResolvedValue(meeting);
    mockSlotFind.mockReturnValue(chain([phoneSlot, noPhoneSlot]));

    const res = await dispatchMeetingSchedule(MEETING_OID.toString(), ACTOR);

    expect(res.status).toBe("scheduled");
    expect(meeting.status).toBe("scheduled");
    expect((meeting.save as jest.Mock)).toHaveBeenCalled();
    expect(res.slotCount).toBe(2);
    expect(res.reachableCount).toBe(1);
    expect(res.unreachableCount).toBe(1);
    expect(res.notifiedCount).toBe(0); // MEETING_SCHEDULE unregistered → no inbox rows
    // dispatchedAt stamped + each slot saved
    expect((phoneSlot.save as jest.Mock)).toHaveBeenCalled();
    expect((noPhoneSlot.save as jest.Mock)).toHaveBeenCalled();
    // wa.me only for the family with a phone
    const phoneOutcome = res.outcomes.find((o) => o.familyKey === "01711000111");
    expect(phoneOutcome?.waLink).toContain("https://wa.me/01711000111");
    expect(res.outcomes.find((o) => o.familyKey.startsWith("nophone:"))?.waLink).toBeNull();
    // the kind-gate fired (no GuardianLink lookup)
    expect(mockGuardianLinkFind).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "PARENT_MEETING_SCHEDULED" }),
    );
  });

  test("On-Call slot carries the On-Call message + no time", async () => {
    const meeting = meetingDoc();
    const onCall = slotDoc({ onCall: true, slotTime: null });
    mockMeetingFindById.mockResolvedValue(meeting);
    mockSlotFind.mockReturnValue(chain([onCall]));
    const res = await dispatchMeetingSchedule(MEETING_OID.toString(), ACTOR);
    expect(res.outcomes[0].messageBn).toContain("ডাকা হলে আসবেন");
    expect(res.outcomes[0].slotTime).toBeNull();
  });

  test("refuses to dispatch a closed meeting", async () => {
    mockMeetingFindById.mockResolvedValue(meetingDoc({ status: "closed" }));
    await expect(dispatchMeetingSchedule(MEETING_OID.toString(), ACTOR)).rejects.toThrow(/closed/);
  });

  test("a missing meeting throws", async () => {
    mockMeetingFindById.mockResolvedValue(null);
    await expect(dispatchMeetingSchedule(MEETING_OID.toString(), ACTOR)).rejects.toBeInstanceOf(ParentMeetingError);
  });
});

// ===========================================================================
// setSlotAttendance
// ===========================================================================

describe("setSlotAttendance", () => {
  test("captures present + remark on a dispatched meeting; audited", async () => {
    const slot = slotDoc();
    mockSlotFindById.mockResolvedValue(slot);
    mockMeetingFindById.mockResolvedValue(meetingDoc({ status: "scheduled" }));
    const res = await setSlotAttendance((slot._id as mongoose.Types.ObjectId).toString(), true, "  came late  ", ACTOR);
    expect(slot.attended).toBe(true);
    expect(slot.attendanceRemark).toBe("came late"); // trimmed
    expect(res.attended).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "MEETING_SLOT_ATTENDANCE_SET", targetKind: "ParentMeetingSlot" }),
    );
  });

  test("an empty remark clears to undefined", async () => {
    const slot = slotDoc();
    mockSlotFindById.mockResolvedValue(slot);
    mockMeetingFindById.mockResolvedValue(meetingDoc({ status: "scheduled" }));
    await setSlotAttendance((slot._id as mongoose.Types.ObjectId).toString(), false, "   ", ACTOR);
    expect(slot.attended).toBe(false);
    expect(slot.attendanceRemark).toBeUndefined();
  });

  test("refuses attendance before the meeting is dispatched (still draft)", async () => {
    const slot = slotDoc();
    mockSlotFindById.mockResolvedValue(slot);
    mockMeetingFindById.mockResolvedValue(meetingDoc({ status: "draft" }));
    await expect(
      setSlotAttendance((slot._id as mongoose.Types.ObjectId).toString(), true, undefined, ACTOR),
    ).rejects.toThrow(/Dispatch the meeting/);
  });
});

// ===========================================================================
// meetingAttendanceSummary (derived aggregates)
// ===========================================================================

describe("meetingAttendanceSummary", () => {
  test("derives present/absent/pending/onCall/dispatched/reachable/unreachable", async () => {
    mockSlotFind.mockReturnValue(
      chain([
        { attended: true, onCall: false, dispatchedAt: new Date(), familyKey: "01711000111" },
        { attended: false, onCall: false, dispatchedAt: new Date(), familyKey: "01722000222" },
        { attended: undefined, onCall: true, dispatchedAt: new Date(), familyKey: "01733000333" },
        { attended: undefined, onCall: false, dispatchedAt: undefined, familyKey: "nophone:" + oid().toString() },
      ]),
    );
    const s = await meetingAttendanceSummary(MEETING_OID.toString());
    expect(s).toMatchObject({
      total: 4,
      present: 1,
      absent: 1,
      pending: 2,
      onCall: 1,
      dispatched: 3,
      reachable: 3,
      unreachable: 1,
    });
  });
});

// ===========================================================================
// RBAC — the admin gate composes the existing roster:manage permission (D-#17/#94)
// ===========================================================================

describe("RBAC (roster:manage admin gate — no new permission)", () => {
  test("Principal + Office hold roster:manage; Teacher + Guardian do not", () => {
    expect(roleHasPermission("PRINCIPAL", "roster:manage")).toBe(true);
    expect(roleHasPermission("OFFICE", "roster:manage")).toBe(true);
    expect(roleHasPermission("TEACHER", "roster:manage")).toBe(false);
    expect(roleHasPermission("GUARDIAN", "roster:manage")).toBe(false);
  });
});
