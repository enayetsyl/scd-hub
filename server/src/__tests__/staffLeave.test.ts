/**
 * HR-2 — staff leave + cover fan-out + attendance leave overlay (prd-hr §3, H2,
 * D-#22/#23). Pure helpers exercised directly; services run against mocked models
 * (DB-free, the repo's test convention).
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// --- model + dependency mocks ---------------------------------------------
const mockStaffFindById = jest.fn();
const mockStaffFind = jest.fn();
const mockUserFindById = jest.fn();
const mockUserFindOne = jest.fn();
const mockAYFindOne = jest.fn();
const mockLeaveCreate = jest.fn();
const mockLeaveFindById = jest.fn();
const mockLeaveFind = jest.fn();
const mockEntFindOne = jest.fn();
const mockEntFind = jest.fn();
const mockSlotCreate = jest.fn();
const mockSlotFindById = jest.fn();
const mockSlotFind = jest.fn();
const mockGrantFind = jest.fn();
const mockAssignProxy = jest.fn();
const mockRevokeProxy = jest.fn().mockResolvedValue(undefined);
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

/** A find()-chain stub: .select()/.sort() return self, .lean() resolves the value. */
const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: {
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockStaffFindById(id) }) }),
    find: (q: unknown) => ({ lean: () => mockStaffFind(q) }),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockUserFindById(id) }) }),
    findOne: (q: unknown) => ({ select: () => ({ lean: () => mockUserFindOne(q) }) }),
  },
}));
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: { findOne: (q: unknown) => ({ select: () => ({ lean: () => mockAYFindOne(q) }) }) },
}));
jest.mock("../modules/hr/models/StaffLeaveApplication", () => ({
  StaffLeaveApplication: {
    create: (d: unknown) => mockLeaveCreate(d),
    findById: (id: unknown) => mockLeaveFindById(id),
    find: (q: unknown) => mockLeaveFind(q),
  },
}));
jest.mock("../modules/hr/models/StaffLeaveEntitlement", () => ({
  StaffLeaveEntitlement: {
    findOne: (q: unknown) => ({ lean: () => mockEntFindOne(q) }),
    find: (q: unknown) => ({ lean: () => mockEntFind(q) }),
    findOneAndUpdate: jest.fn(),
  },
}));
jest.mock("../modules/hr/models/StaffCoverSlot", () => ({
  StaffCoverSlot: {
    create: (d: unknown) => mockSlotCreate(d),
    findById: (id: unknown) => mockSlotFindById(id),
    find: (q: unknown) => mockSlotFind(q),
  },
}));
jest.mock("../modules/foundation/models/ScopeGrant", () => ({
  ScopeGrant: { find: (q: unknown) => ({ select: () => ({ lean: () => mockGrantFind(q) }) }) },
}));
jest.mock("../modules/foundation/services/ScopeGrantService", () => ({
  assignProxy: (i: unknown) => mockAssignProxy(i),
  revokeProxy: (id: unknown, by: unknown) => mockRevokeProxy(id, by),
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));
// normalizePhone is pure — use the real one via the credentials module (no DB).
jest.mock("../modules/foundation/services/credentials", () => ({
  normalizePhone: (p: string) => p.replace(/\D/g, "").replace(/^0+/, ""),
}));

import {
  countLeaveDays,
  rangeCovers,
  LeaveError,
} from "../modules/hr/services/dates";
import {
  computeRemaining,
  proRateAllowance,
} from "../modules/hr/services/LeaveEntitlementService";
import {
  splitLeaveDays,
  staffLeaveCovers,
  applyForLeave,
  decideLeave,
} from "../modules/hr/services/StaffLeaveService";
import { fanOutCoverSlots, decideCoverSlot, revokeCoversForLeave } from "../modules/hr/services/CoverService";
import { resolveUserIdForStaff, resolveStaffProfileForUser } from "../modules/hr/services/staffMatch";
import { LEAVE_TYPE_RULES } from "@scd/shared";

const ACTOR = oid().toString();

beforeEach(() => jest.clearAllMocks());

// ===========================================================================
describe("pure leave math", () => {
  test("countLeaveDays is inclusive", () => {
    expect(countLeaveDays("2026-06-10", "2026-06-10")).toBe(1);
    expect(countLeaveDays("2026-06-10", "2026-06-12")).toBe(3);
  });
  test("countLeaveDays rejects reversed/invalid keys", () => {
    expect(() => countLeaveDays("2026-06-12", "2026-06-10")).toThrow(LeaveError);
    expect(() => countLeaveDays("nope", "2026-06-10")).toThrow(LeaveError);
  });
  test("rangeCovers (ISO string compare)", () => {
    expect(rangeCovers("2026-06-10", "2026-06-12", "2026-06-11")).toBe(true);
    expect(rangeCovers("2026-06-10", "2026-06-12", "2026-06-13")).toBe(false);
  });
  test("computeRemaining floors at 0", () => {
    expect(computeRemaining(10, 2, 5)).toBe(7);
    expect(computeRemaining(3, 0, 9)).toBe(0);
  });
  test("proRateAllowance: full year, mid-year, edges", () => {
    const ys = new Date("2026-01-01T00:00:00Z");
    const ye = new Date("2027-01-01T00:00:00Z");
    expect(proRateAllowance(12, null, ys, ye)).toBe(12);
    expect(proRateAllowance(12, new Date("2025-06-01T00:00:00Z"), ys, ye)).toBe(12); // joined before
    expect(proRateAllowance(12, new Date("2027-02-01T00:00:00Z"), ys, ye)).toBe(0);  // joined after
    const mid = proRateAllowance(12, new Date("2026-07-02T12:00:00Z"), ys, ye);      // ~half
    expect(mid).toBeGreaterThanOrEqual(5);
    expect(mid).toBeLessThanOrEqual(7);
  });
});

describe("splitLeaveDays (§3.2/§3.3 exceed-warns-not-blocks)", () => {
  test("paid type within balance → all paid, no warning", () => {
    expect(splitLeaveDays("casual", 3, 5)).toEqual({ paidDays: 3, unpaidDays: 0, exceedWarning: null });
  });
  test("paid type over balance → excess unpaid + warning (never blocks)", () => {
    const s = splitLeaveDays("casual", 5, 2);
    expect(s.paidDays).toBe(2);
    expect(s.unpaidDays).toBe(3);
    expect(s.exceedWarning).toMatch(/unpaid/i);
  });
  test("maternity is wholly unpaid (D-#23)", () => {
    expect(splitLeaveDays("maternity", 60, 999)).toEqual({ paidDays: 0, unpaidDays: 60, exceedWarning: null });
  });
  test("unpaid_lwp is wholly unpaid", () => {
    expect(splitLeaveDays("unpaid_lwp", 4, 10).paidDays).toBe(0);
  });
  test("LEAVE_TYPE_RULES table is consistent with the split", () => {
    expect(LEAVE_TYPE_RULES.casual.balanceTracked).toBe(true);
    expect(LEAVE_TYPE_RULES.maternity.paid).toBe(false);
  });
});

describe("staffLeaveCovers (attendance overlay predicate)", () => {
  const leaves = [{ staffProfileId: "s1", fromKey: "2026-06-10", toKey: "2026-06-12" }];
  test("covers a date within an approved window for that staff", () => {
    expect(staffLeaveCovers(leaves, "s1", "2026-06-11")).toBe(true);
  });
  test("does not cover a different staff or out-of-window date", () => {
    expect(staffLeaveCovers(leaves, "s2", "2026-06-11")).toBe(false);
    expect(staffLeaveCovers(leaves, "s1", "2026-06-13")).toBe(false);
  });
});

// ===========================================================================
describe("applyForLeave", () => {
  test("records an application with derived day-count + resolved year, fans out (no-op for non-teacher)", async () => {
    const staffId = oid().toString();
    mockStaffFindById.mockResolvedValue({ active: true });
    mockAYFindOne.mockResolvedValue({ _id: oid() }); // covering year
    mockUserFindById.mockResolvedValue({ phone: "1700000000" }); // unused here
    mockGrantFind.mockResolvedValue([]); // fanout finds no teaching grants
    // resolveUserIdForStaff → staff has no phone → null → fanout no-op
    mockStaffFindById.mockResolvedValueOnce({ active: true }); // applyForLeave's own check
    const created = { _id: oid() };
    mockLeaveCreate.mockResolvedValue(created);

    const res = await applyForLeave({
      staffProfileId: staffId,
      leaveType: "casual",
      fromKey: "2026-06-10",
      toKey: "2026-06-12",
      reason: "family",
      actorId: ACTOR,
    });

    expect(res).toBe(created);
    expect(mockLeaveCreate).toHaveBeenCalledTimes(1);
    expect(mockLeaveCreate.mock.calls[0][0]).toMatchObject({ days: 3, leaveType: "casual", status: "applied" });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "STAFF_LEAVE_SUBMITTED" }));
  });

  test("rejects an empty reason and unknown staff", async () => {
    mockStaffFindById.mockResolvedValue({ active: true });
    await expect(
      applyForLeave({ staffProfileId: oid().toString(), leaveType: "casual", fromKey: "2026-06-10", toKey: "2026-06-10", reason: "  ", actorId: ACTOR }),
    ).rejects.toThrow(LeaveError);

    mockStaffFindById.mockResolvedValue(null);
    await expect(
      applyForLeave({ staffProfileId: oid().toString(), leaveType: "casual", fromKey: "2026-06-10", toKey: "2026-06-10", reason: "ok", actorId: ACTOR }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("decideLeave", () => {
  function leaveDoc(over: Record<string, unknown> = {}): any {
    const d: Record<string, unknown> = {
      _id: oid(), staffProfileId: oid(), academicYearId: oid(),
      leaveType: "casual", days: 3, status: "applied", ...over,
    };
    d.save = jest.fn().mockResolvedValue(d);
    return d;
  }

  test("approve within balance → all paid, status approved, audited", async () => {
    const app = leaveDoc({ days: 3 });
    mockLeaveFindById.mockResolvedValue(app);
    mockEntFindOne.mockResolvedValue({ allowanceDays: 10, carriedOverDays: 0 });
    mockLeaveFind.mockReturnValue(leanChain([])); // no prior taken
    const res = await decideLeave(app._id.toString(), "approve", ACTOR);
    expect(res.status).toBe("approved");
    expect(res.paidDays).toBe(3);
    expect(res.unpaidDays).toBe(0);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "STAFF_LEAVE_DECIDED" }));
  });

  test("approve over balance → excess unpaid + warning (never blocks)", async () => {
    const app = leaveDoc({ days: 5 });
    mockLeaveFindById.mockResolvedValue(app);
    mockEntFindOne.mockResolvedValue({ allowanceDays: 2, carriedOverDays: 0 });
    mockLeaveFind.mockReturnValue(leanChain([]));
    const res = await decideLeave(app._id.toString(), "approve", ACTOR);
    expect(res.paidDays).toBe(2);
    expect(res.unpaidDays).toBe(3);
    expect(res.exceedWarning).toMatch(/unpaid/i);
  });

  test("approve maternity → wholly unpaid (D-#23)", async () => {
    const app = leaveDoc({ leaveType: "maternity", days: 60 });
    mockLeaveFindById.mockResolvedValue(app);
    const res = await decideLeave(app._id.toString(), "approve", ACTOR);
    expect(res.paidDays).toBe(0);
    expect(res.unpaidDays).toBe(60);
    expect(mockEntFindOne).not.toHaveBeenCalled(); // not balance-tracked
  });

  test("cancel revokes live cover grants", async () => {
    const app = leaveDoc({ status: "applied" });
    mockLeaveFindById.mockResolvedValue(app);
    const grantId = oid();
    const slot = { _id: oid(), proxyGrantId: grantId, status: "approved", save: jest.fn() };
    mockSlotFind.mockResolvedValue([slot]);
    const res = await decideLeave(app._id.toString(), "cancel", ACTOR);
    expect(res.status).toBe("cancelled");
    expect(mockRevokeProxy).toHaveBeenCalledWith(grantId.toString(), ACTOR); // captured before the service nulls it
    expect(slot.proxyGrantId).toBeNull();
  });
});

// ===========================================================================
describe("cover fan-out + proxy seam (D-#20/#22)", () => {
  test("fanOutCoverSlots: one slot per (section,subject), deduped; none when no login", async () => {
    const staffId = oid().toString();
    // no phone → no user → no slots
    mockStaffFindById.mockResolvedValueOnce(null);
    expect(await fanOutCoverSlots(oid().toString(), staffId)).toEqual([]);

    // with a resolvable user + 2 teaching grants (one dup) → 2 slots
    const userId = oid();
    mockStaffFindById.mockResolvedValueOnce({ phone: "01700000000" });
    mockUserFindOne.mockResolvedValueOnce({ _id: userId });
    const sec1 = oid(), sec2 = oid(), subj = oid();
    mockGrantFind.mockResolvedValueOnce([
      { classId: oid(), sectionId: sec1, subjectId: subj },
      { classId: oid(), sectionId: sec1, subjectId: subj }, // dup → collapsed
      { classId: oid(), sectionId: sec2, subjectId: subj },
    ]);
    mockSlotCreate.mockImplementation(async (d) => ({ _id: oid(), ...d }));
    const slots = await fanOutCoverSlots(oid().toString(), staffId);
    expect(slots).toHaveLength(2);
    expect(mockSlotCreate).toHaveBeenCalledTimes(2);
    expect(mockSlotCreate.mock.calls[0][0]).toMatchObject({ status: "needs_cover" });
  });

  test("decideCoverSlot approve → mints a proxy grant over the leave window + stores it", async () => {
    const cover = oid(), absent = oid();
    const slot: any = {
      _id: oid(), leaveApplicationId: oid(), classId: oid(), sectionId: oid(),
      proposedCoverTeacherId: cover, absentTeacherUserId: absent, status: "proposed", proxyGrantId: null,
    };
    slot.save = jest.fn().mockResolvedValue(slot);
    mockSlotFindById.mockResolvedValue(slot);
    mockLeaveFindById.mockReturnValue({ lean: async () => ({ fromKey: "2026-06-10", days: 2 }) });
    const grantId = oid().toString();
    mockAssignProxy.mockResolvedValue(grantId);

    const res = await decideCoverSlot(slot._id.toString(), true, ACTOR);
    expect(res.status).toBe("approved");
    expect(res.proxyGrantId!.toString()).toBe(grantId);
    expect(mockAssignProxy).toHaveBeenCalledWith(
      expect.objectContaining({ coveringTeacherId: cover.toString(), durationDays: 2 }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "STAFF_COVER_DECIDED", meta: expect.objectContaining({ decision: "approved" }) }),
    );
  });

  test("decideCoverSlot approve without a proposal is rejected", async () => {
    const slot: any = { _id: oid(), proposedCoverTeacherId: null, status: "needs_cover" };
    slot.save = jest.fn();
    mockSlotFindById.mockResolvedValue(slot);
    await expect(decideCoverSlot(slot._id.toString(), true, ACTOR)).rejects.toThrow(LeaveError);
    expect(mockAssignProxy).not.toHaveBeenCalled();
  });

  test("revokeCoversForLeave revokes every approved slot's grant", async () => {
    const s1 = { _id: oid(), proxyGrantId: oid(), status: "approved", save: jest.fn() };
    const s2 = { _id: oid(), proxyGrantId: oid(), status: "approved", save: jest.fn() };
    mockSlotFind.mockResolvedValue([s1, s2]);
    const n = await revokeCoversForLeave(oid().toString(), ACTOR);
    expect(n).toBe(2);
    expect(mockRevokeProxy).toHaveBeenCalledTimes(2);
    expect(s1.status).toBe("needs_cover");
    expect(s1.proxyGrantId).toBeNull();
  });
});

// ===========================================================================
describe("staffMatch (the phone-only User↔StaffProfile join)", () => {
  test("resolveUserIdForStaff matches on normalized phone", async () => {
    mockStaffFindById.mockResolvedValue({ phone: "01700000000" });
    const uid = oid();
    mockUserFindOne.mockResolvedValue({ _id: uid });
    expect(await resolveUserIdForStaff(oid().toString())).toBe(uid.toString());
    // phone arg passed to User.findOne is normalized (leading 0 stripped)
    expect(mockUserFindOne.mock.calls[0][0]).toMatchObject({ phone: "1700000000" });
  });

  test("resolveUserIdForStaff returns null when the staff has no phone", async () => {
    mockStaffFindById.mockResolvedValue({ phone: null });
    expect(await resolveUserIdForStaff(oid().toString())).toBeNull();
  });

  test("resolveStaffProfileForUser finds the staff whose normalized phone matches", async () => {
    mockUserFindById.mockResolvedValue({ phone: "1700000000" });
    const match = { _id: oid(), phone: "0 1700-000000" };
    mockStaffFind.mockResolvedValue([{ _id: oid(), phone: "01999999999" }, match]);
    const res = await resolveStaffProfileForUser(oid().toString());
    expect(res).toBe(match);
  });
});
