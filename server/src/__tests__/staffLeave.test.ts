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
const mockAYFindById = jest.fn();
const mockLeaveCreate = jest.fn();
const mockLeaveFindById = jest.fn();
const mockLeaveFind = jest.fn();
const mockEntFindOne = jest.fn();
const mockEntFind = jest.fn();
const mockSlotCreate = jest.fn();
const mockSlotFindById = jest.fn();
const mockSlotFind = jest.fn();
const mockSlotFindOne = jest.fn();
const mockGrantFind = jest.fn();
const mockAssignProxy = jest.fn();
const mockRevokeProxy = jest.fn().mockResolvedValue(undefined);
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
const mockSlotsForTeacherOnDate = jest.fn();
const mockPeriodGridFind = jest.fn();
const mockResolveDayType = jest.fn();
const mockSubjectFindOne = jest.fn();
const mockEmitHrCoverAssigned = jest.fn().mockResolvedValue(undefined);
const mockEmitStaffLeaveSubmitted = jest.fn().mockResolvedValue(undefined);

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
// `.select()` is optional on this one: resolveAcademicYearId selects, but the SH-3
// pooled balance needs startDate/endDate and so reads the whole document.
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: {
    findOne: (q: unknown) => ({
      select: () => ({ lean: () => mockAYFindOne(q) }),
      lean: () => mockAYFindOne(q),
    }),
    findById: (id: unknown) => ({
      select: () => ({ lean: () => mockAYFindById(id) }),
      lean: () => mockAYFindById(id),
    }),
  },
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
    findOne: (q: unknown) => ({ select: () => ({ lean: () => mockSlotFindOne(q) }) }),
  },
}));
// SH-3 (D-#539/#540): decideLeave now reads the HR policy and, for probation leave,
// writes a held-debt row. Both are mocked to their DEFAULTS here — an absent HrPolicy
// row reads as HR_POLICY_DEFAULTS in production too, so `findOne → null` is the real
// shape, not a stub. Probation is switched OFF for this suite (every fixture staff has
// a confirmationDate below) so the pre-existing paid/unpaid assertions still describe
// confirmed-service leave; the probation path has its own suite.
jest.mock("../modules/hr/models/HrPolicy", () => ({
  HrPolicy: {
    findOne: () => ({ lean: async () => null }),
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock("../modules/hr/models/ProbationLeaveDebt", () => ({
  ProbationLeaveDebt: {
    find: () => ({ sort: () => ({ lean: async () => [] }), select: () => ({ lean: async () => [] }), lean: async () => [] }),
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
    updateOne: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock("../modules/foundation/models/ScopeGrant", () => ({
  ScopeGrant: { find: (q: unknown) => ({ select: () => ({ lean: () => mockGrantFind(q) }) }) },
}));
jest.mock("../modules/foundation/services/ScopeGrantService", () => ({
  assignProxy: (i: unknown) => mockAssignProxy(i),
  revokeProxy: (id: unknown, by: unknown) => mockRevokeProxy(id, by),
}));
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { findOne: (q: unknown) => ({ select: () => ({ lean: () => mockSubjectFindOne(q) }) }) },
}));
jest.mock("../modules/routine/services/RoutineSlotService", () => ({
  slotsForTeacherOnDate: (t: unknown, d: unknown) => mockSlotsForTeacherOnDate(t, d),
}));
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: {
    updateOne: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock("../modules/routine/models/PeriodGrid", () => ({
  PeriodGrid: { find: (q: unknown) => ({ select: () => ({ lean: () => mockPeriodGridFind(q) }) }) },
}));
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: unknown) => mockResolveDayType(d),
}));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitHrCoverAssigned: (e: unknown) => mockEmitHrCoverAssigned(e),
  emitStaffLeaveSubmitted: (e: unknown) => mockEmitStaffLeaveSubmitted(e),
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
  roundLeaveDays,
  partialPeriodWindow,
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
import {
  fanOutCoverSlots,
  decideCoverSlot,
  revokeCoversForLeave,
  resolvePartialPeriods,
} from "../modules/hr/services/CoverService";
import { resolveUserIdForStaff, resolveStaffProfileForUser } from "../modules/hr/services/staffMatch";
import { isProbationLeave } from "../modules/hr/services/ProbationDebtService";
import { ProbationLeaveDebt } from "../modules/hr/models/ProbationLeaveDebt";
import { LEAVE_TYPE_RULES, PARTIAL_DAY_FRACTION, HR_POLICY_DEFAULTS } from "@scd/shared";

const ACTOR = oid().toString();

beforeEach(() => jest.clearAllMocks());

// ===========================================================================
describe("isProbationLeave — the date pivot (SH-3, D-#540)", () => {
  test("no confirmation date at all → every leave is probation leave", () => {
    expect(isProbationLeave("2026-06-01", null)).toBe(true);
    expect(isProbationLeave("2020-01-01", undefined)).toBe(true);
  });

  test("starts before confirmation → probation; on or after → confirmed service", () => {
    const confirmed = new Date("2026-07-01");
    expect(isProbationLeave("2026-06-30", confirmed)).toBe(true);
    expect(isProbationLeave("2026-07-01", confirmed)).toBe(false); // boundary: paid
    expect(isProbationLeave("2026-07-02", confirmed)).toBe(false);
  });

  test("the answer never changes once given — the same leave reads the same after confirmation", () => {
    // A leave in March, evaluated against a July confirmation, is STILL probation
    // leave. This is the guarantee that keeps a confirmation from retroactively
    // paying for months of leave that were decided as unpaid at the time.
    expect(isProbationLeave("2026-03-05", new Date("2026-07-01"))).toBe(true);
    expect(isProbationLeave("2026-03-05", new Date("2026-12-31"))).toBe(true);
  });
});

// ===========================================================================
describe("the shared annual pool (SH-3, D-#539)", () => {
  test("the default pool is the 20 days the appointment letter promises", () => {
    expect(HR_POLICY_DEFAULTS.annualLeaveDays).toBe(20);
  });

  test("computeRemaining floors at zero — an over-drawn pool is 0, never negative", () => {
    expect(computeRemaining(20, 0, 25)).toBe(0);
    expect(computeRemaining(20, 3, 10)).toBe(13);
  });

  test("a mid-year joiner's pool is pro-rated, not granted in full", () => {
    const start = new Date("2026-01-01");
    const end = new Date("2026-12-31");
    expect(proRateAllowance(20, new Date("2026-01-01"), start, end)).toBe(20);
    expect(proRateAllowance(20, new Date("2026-07-02"), start, end)).toBe(10);
    expect(proRateAllowance(20, null, start, end)).toBe(20);
  });
});

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
  test("a PARTIAL day never relabels a full-day ✘ as LEAVE (D-#361)", () => {
    const partial = [{ staffProfileId: "s1", fromKey: "2026-06-10", toKey: "2026-06-10", dayPart: "early_leave" as const }];
    expect(staffLeaveCovers(partial, "s1", "2026-06-10")).toBe(false);
    // ...while an explicit full-day row still does, as does a pre-D-#361 row with no dayPart.
    expect(staffLeaveCovers([{ ...partial[0], dayPart: "full" as const }], "s1", "2026-06-10")).toBe(true);
  });
});

// ===========================================================================
describe("partial-day leave — the period window + 1/3-day rule (D-#361)", () => {
  test("late_entry takes the first n periods; early_leave the last n of THAT day", () => {
    expect(partialPeriodWindow("late_entry", 3, 8)).toEqual([1, 2, 3]);
    expect(partialPeriodWindow("early_leave", 2, 8)).toEqual([7, 8]);
    // A nursery/KG day is 6 periods, so "2 periods early" ends at 6, not 8 (D-#57).
    expect(partialPeriodWindow("early_leave", 2, 6)).toEqual([5, 6]);
    expect(partialPeriodWindow("full", 2, 8)).toEqual([]);
  });

  test("clamps a count longer than the day, and refuses a count below 1", () => {
    expect(partialPeriodWindow("late_entry", 12, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(partialPeriodWindow("early_leave", 6, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(() => partialPeriodWindow("early_leave", 0, 8)).toThrow(LeaveError);
  });

  test("THREE partial days cost exactly ONE day of balance (the owner rule)", () => {
    const three = PARTIAL_DAY_FRACTION + PARTIAL_DAY_FRACTION + PARTIAL_DAY_FRACTION;
    expect(three).toBe(1); // holds only because the fraction is stored EXACT, not as 0.33
    expect(roundLeaveDays(three)).toBe(1);
    // The pre-rounded alternative is what this design avoids: 0.33 × 3 never reaches a day.
    expect(0.33 * 3).toBeLessThan(1);
    // A single partial day still READS as 0.33 wherever it is displayed.
    expect(roundLeaveDays(PARTIAL_DAY_FRACTION)).toBe(0.33);
    // Longer runs do drift below the exact value, which is why every read-out rounds.
    const seven = Array.from({ length: 7 }, () => PARTIAL_DAY_FRACTION).reduce((a, b) => a + b, 0);
    expect(roundLeaveDays(seven)).toBe(2.33);
  });

  test("resolvePartialPeriods anchors early_leave to the teacher's OWN last teaching period", async () => {
    const staffId = oid().toString();
    mockStaffFindById.mockResolvedValue({ phone: "01700000000" });
    mockUserFindOne.mockResolvedValue({ _id: oid() });
    mockSlotsForTeacherOnDate.mockResolvedValue([
      { _id: oid(), periodNumber: 4, isBreak: false },
      { _id: oid(), periodNumber: 6, isBreak: false },
      { _id: oid(), periodNumber: 7, isBreak: true }, // a break is not a teaching period
    ]);
    expect(await resolvePartialPeriods(staffId, "2026-06-14", "early_leave", 2)).toEqual([5, 6]);
    expect(mockPeriodGridFind).not.toHaveBeenCalled(); // routine answered it; no grid fallback
  });

  test("resolvePartialPeriods falls back to the longest active period grid with no routine", async () => {
    mockStaffFindById.mockResolvedValue(null); // no login (support staff) → no routine
    mockPeriodGridFind.mockResolvedValue([
      { periods: [{ number: 1, isBreak: false }, { number: 6, isBreak: false }] },
      { periods: [{ number: 8, isBreak: false }, { number: 9, isBreak: true }] },
    ]);
    expect(await resolvePartialPeriods(oid().toString(), "2026-06-14", "early_leave", 1)).toEqual([8]);
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
    // Owner 2026-07-26: approvers are notified on submit.
    expect(mockEmitStaffLeaveSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ leaveApplicationId: created._id.toString() }),
    );
  });

  test("a partial day stores 1/3 of a day + its resolved period window (D-#361)", async () => {
    const staffId = oid().toString();
    mockStaffFindById
      .mockResolvedValueOnce({ active: true }) // applyForLeave's own active check
      .mockResolvedValue({ phone: "01700000000" }); // then every staff→user resolution
    mockUserFindOne.mockResolvedValue({ _id: oid() });
    mockAYFindOne.mockResolvedValue({ _id: oid() });
    mockSlotsForTeacherOnDate.mockResolvedValue([
      { _id: oid(), classId: oid(), groupId: oid(), subject: "MATH", periodNumber: 1, isBreak: false },
      { _id: oid(), classId: oid(), groupId: oid(), subject: "BAN", periodNumber: 6, isBreak: false },
    ]);
    const created = { _id: oid() };
    mockLeaveCreate.mockResolvedValue(created);
    mockLeaveFindById.mockReturnValue({ lean: async () => null }); // fan-out no-ops after create

    await applyForLeave({
      staffProfileId: staffId,
      leaveType: "casual",
      fromKey: "2026-06-14",
      toKey: "2026-06-14",
      reason: "doctor",
      dayPart: "late_entry",
      partialPeriodCount: 2,
      actorId: ACTOR,
    });

    expect(mockLeaveCreate.mock.calls[0][0]).toMatchObject({
      dayPart: "late_entry",
      partialPeriodCount: 2,
      partialPeriods: [1, 2],
      days: PARTIAL_DAY_FRACTION,
    });
  });

  test("a partial day must be ONE date and must name a period count (D-#361)", async () => {
    mockStaffFindById.mockResolvedValue({ active: true });
    const base = { staffProfileId: oid().toString(), leaveType: "casual" as const, reason: "ok", actorId: ACTOR };
    await expect(
      applyForLeave({ ...base, fromKey: "2026-06-14", toKey: "2026-06-15", dayPart: "early_leave", partialPeriodCount: 2 }),
    ).rejects.toThrow(/ONE date/i);
    await expect(
      applyForLeave({ ...base, fromKey: "2026-06-14", toKey: "2026-06-14", dayPart: "early_leave" }),
    ).rejects.toThrow(/how many periods/i);
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
  const YEAR_START = new Date("2026-01-01");
  const YEAR_END = new Date("2026-12-31");

  function leaveDoc(over: Record<string, unknown> = {}): any {
    const d: Record<string, unknown> = {
      _id: oid(), staffProfileId: oid(), academicYearId: oid(),
      leaveType: "casual", fromKey: "2026-06-01", days: 3, status: "applied", ...over,
    };
    d.save = jest.fn().mockResolvedValue(d);
    return d;
  }

  /** SH-3: every fixture here is a CONFIRMED staff member joined before the year
   *  started, so these cases describe confirmed-service leave. Probation has its own
   *  block below — the two rules must not be tangled in one fixture. */
  function confirmedStaff(joining = new Date("2020-01-01")): void {
    mockStaffFindById.mockResolvedValue({
      _id: oid(), active: true, name: "X",
      confirmationDate: new Date("2021-01-01"),
      joiningDate: joining,
    });
    mockAYFindById.mockResolvedValue({ _id: oid(), startDate: YEAR_START, endDate: YEAR_END });
    mockAYFindOne.mockResolvedValue({ _id: oid(), startDate: YEAR_START, endDate: YEAR_END });
  }

  test("approve within the pool → all paid, status approved, audited", async () => {
    const app = leaveDoc({ days: 3 });
    confirmedStaff();
    mockLeaveFindById.mockResolvedValue(app);
    // A per-staff entitlement row is the D-#539 OVERRIDE of the school-wide pool.
    mockEntFind.mockResolvedValue([{ leaveType: "casual", allowanceDays: 10, carriedOverDays: 0 }]);
    mockLeaveFind.mockReturnValue(leanChain([])); // no prior taken
    const res = await decideLeave(app._id.toString(), "approve", ACTOR);
    expect(res.status).toBe("approved");
    expect(res.paidDays).toBe(3);
    expect(res.unpaidDays).toBe(0);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "STAFF_LEAVE_DECIDED" }));
  });

  test("approve over the pool → excess unpaid + warning (never blocks)", async () => {
    const app = leaveDoc({ days: 5 });
    confirmedStaff();
    mockLeaveFindById.mockResolvedValue(app);
    mockEntFind.mockResolvedValue([{ leaveType: "casual", allowanceDays: 2, carriedOverDays: 0 }]);
    mockLeaveFind.mockReturnValue(leanChain([]));
    const res = await decideLeave(app._id.toString(), "approve", ACTOR);
    expect(res.paidDays).toBe(2);
    expect(res.unpaidDays).toBe(3);
    expect(res.exceedWarning).toMatch(/unpaid/i);
  });

  /** D-#539: this is the whole point of the pool. Under the old per-type model, sick
   *  leave had its OWN 20 days, so casual days already taken were invisible to it and a
   *  teacher could take 40 paid days against a letter promising 20. */
  test("sick leave draws the SAME pool casual already drew from (D-#539)", async () => {
    const app = leaveDoc({ leaveType: "sick", days: 4 });
    confirmedStaff();
    mockLeaveFindById.mockResolvedValue(app);
    mockEntFind.mockResolvedValue([]); // no override → the school-wide 20-day pool
    // 18 days already taken as CASUAL this year. Only 2 remain, for any pooled type.
    mockLeaveFind.mockReturnValue(leanChain([{ paidDays: 18, days: 18 }]));
    const res = await decideLeave(app._id.toString(), "approve", ACTOR);
    expect(res.paidDays).toBe(2);
    expect(res.unpaidDays).toBe(2);
  });

  test("approve maternity → wholly unpaid (D-#23)", async () => {
    const app = leaveDoc({ leaveType: "maternity", days: 60 });
    confirmedStaff();
    mockLeaveFindById.mockResolvedValue(app);
    const res = await decideLeave(app._id.toString(), "approve", ACTOR);
    expect(res.paidDays).toBe(0);
    expect(res.unpaidDays).toBe(60);
    expect(mockEntFind).not.toHaveBeenCalled(); // not balance-tracked
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

  // --- SH-3 / D-#540: probation leave is HELD, not paid and not deducted -------
  describe("probation leave (D-#540)", () => {
    function probationer(confirmationDate: Date | null): void {
      mockStaffFindById.mockResolvedValue({
        _id: oid(), active: true, name: "X",
        confirmationDate,
        joiningDate: new Date("2026-01-01"),
      });
      mockAYFindById.mockResolvedValue({ _id: oid(), startDate: YEAR_START, endDate: YEAR_END });
      mockAYFindOne.mockResolvedValue({ _id: oid(), startDate: YEAR_START, endDate: YEAR_END });
      mockEntFind.mockResolvedValue([]);
      mockLeaveFind.mockReturnValue(leanChain([]));
    }

    test("no confirmationDate → 0 paid, all unpaid, and a debt row is written", async () => {
      const app = leaveDoc({ days: 3, fromKey: "2026-06-01" });
      probationer(null);
      mockLeaveFindById.mockResolvedValue(app);
      const res = await decideLeave(app._id.toString(), "approve", ACTOR);
      expect(res.paidDays).toBe(0);
      expect(res.unpaidDays).toBe(3);
      expect(ProbationLeaveDebt.findOneAndUpdate).toHaveBeenCalled();
    });

    /**
     * The rule contradicts itself without this flag. Probation leave is unpaid, and
     * payroll deducts day-rate × unpaidDays for every approved leave in the month — so
     * "recorded as unpaid, adjusted at confirmation or on the final salary" would have
     * silently become "docked this month", and then collected AGAIN by the ledger.
     */
    test("held leave is FLAGGED so payroll cannot dock it this month (D-#540)", async () => {
      const app = leaveDoc({ days: 3, fromKey: "2026-06-01" });
      probationer(null);
      mockLeaveFindById.mockResolvedValue(app);
      const res = await decideLeave(app._id.toString(), "approve", ACTOR);
      expect(res.probationHeld).toBe(true);
    });

    test("confirmed-service leave is NOT flagged, so its unpaid overflow still deducts", async () => {
      const app = leaveDoc({ days: 3, fromKey: "2026-08-01" });
      probationer(new Date("2026-07-01"));
      mockLeaveFindById.mockResolvedValue(app);
      const res = await decideLeave(app._id.toString(), "approve", ACTOR);
      expect(res.probationHeld).toBe(false);
    });

    test("re-approving after confirmation clears the flag AND the debt — the days become payable", async () => {
      const app = leaveDoc({ days: 2, fromKey: "2026-08-05", probationHeld: true });
      probationer(new Date("2026-07-01")); // now confirmed; the leave is after it
      mockLeaveFindById.mockResolvedValue(app);
      const res = await decideLeave(app._id.toString(), "approve", ACTOR);
      expect(res.probationHeld).toBe(false);
      expect(ProbationLeaveDebt.deleteOne).toHaveBeenCalled();
    });

    /** The reason the rule keys off a DATE and not employmentStatus: a leave that
     *  STARTED before confirmation stays probation leave forever, even after the
     *  person is confirmed. Otherwise confirming would retroactively pay for it. */
    test("leave STARTING before confirmationDate is still probation leave", async () => {
      const app = leaveDoc({ days: 2, fromKey: "2026-03-05" });
      probationer(new Date("2026-07-01"));
      mockLeaveFindById.mockResolvedValue(app);
      const res = await decideLeave(app._id.toString(), "approve", ACTOR);
      expect(res.paidDays).toBe(0);
      expect(res.unpaidDays).toBe(2);
    });

    test("leave starting ON the confirmation date is confirmed-service leave — paid", async () => {
      const app = leaveDoc({ days: 2, fromKey: "2026-07-01" });
      probationer(new Date("2026-07-01"));
      mockLeaveFindById.mockResolvedValue(app);
      const res = await decideLeave(app._id.toString(), "approve", ACTOR);
      expect(res.paidDays).toBe(2);
      expect(res.unpaidDays).toBe(0);
    });

    test("cancelling a probation leave clears its held debt — an absence that did not happen carries no charge", async () => {
      const app = leaveDoc({ status: "applied" });
      probationer(null);
      mockLeaveFindById.mockResolvedValue(app);
      mockSlotFind.mockResolvedValue([]);
      await decideLeave(app._id.toString(), "cancel", ACTOR);
      expect(ProbationLeaveDebt.deleteOne).toHaveBeenCalled();
    });
  });
});

// ===========================================================================
describe("cover fan-out + proxy seam (D-#20/#22)", () => {
  test("fanOutCoverSlots: one slot per actual (date,period) meeting; none when no login", async () => {
    const staffId = oid().toString();
    // no phone → no user → no slots
    mockStaffFindById.mockResolvedValueOnce(null);
    expect(await fanOutCoverSlots(oid().toString(), staffId)).toEqual([]);

    // with a resolvable user + a one-day leave with 2 real meetings that day → 2 slots
    const userId = oid();
    mockStaffFindById.mockResolvedValueOnce({ phone: "01700000000" });
    mockUserFindOne.mockResolvedValueOnce({ _id: userId });
    mockLeaveFindById.mockReturnValue({ lean: async () => ({ fromKey: "2026-06-14", toKey: "2026-06-14" }) });
    mockResolveDayType.mockResolvedValue("FULL");
    const cls = oid(), sec = oid();
    mockSlotsForTeacherOnDate.mockResolvedValue([
      { _id: oid(), classId: cls, groupId: sec, subject: "MATH", periodNumber: 2, isBreak: false },
      { _id: oid(), classId: cls, groupId: sec, subject: "BAN", periodNumber: 4, isBreak: false },
    ]);
    mockSlotFindOne.mockResolvedValue(null); // no existing slot for either meeting yet
    mockSubjectFindOne.mockResolvedValue({ _id: oid() });
    mockSlotCreate.mockImplementation(async (d) => ({ _id: oid(), ...d }));

    const slots = await fanOutCoverSlots(oid().toString(), staffId);
    expect(slots).toHaveLength(2);
    expect(mockSlotCreate).toHaveBeenCalledTimes(2);
    expect(mockSlotCreate.mock.calls[0][0]).toMatchObject({ status: "needs_cover", dateKey: "2026-06-14", periodNumber: 2 });
  });

  test("fanOutCoverSlots skips OFF/HOLIDAY days and breaks, and never re-creates an existing slot", async () => {
    const staffId = oid().toString();
    mockStaffFindById.mockResolvedValueOnce({ phone: "01700000000" });
    mockUserFindOne.mockResolvedValueOnce({ _id: oid() });
    mockLeaveFindById.mockReturnValue({ lean: async () => ({ fromKey: "2026-06-12", toKey: "2026-06-13" }) }); // Fri+Sat-ish window
    mockResolveDayType.mockResolvedValueOnce("OFF").mockResolvedValueOnce("FULL");
    mockSlotsForTeacherOnDate.mockResolvedValue([
      { _id: oid(), classId: oid(), groupId: oid(), subject: "MATH", periodNumber: 1, isBreak: true }, // break → skipped
    ]);
    const slots = await fanOutCoverSlots(oid().toString(), staffId);
    expect(slots).toEqual([]);
    expect(mockSlotCreate).not.toHaveBeenCalled();
  });

  test("fanOutCoverSlots covers ONLY the periods a partial day misses (D-#361)", async () => {
    const staffId = oid().toString();
    mockStaffFindById.mockResolvedValueOnce({ phone: "01700000000" });
    mockUserFindOne.mockResolvedValueOnce({ _id: oid() });
    // Late entry over periods 1–2: the teacher is back for their period-6 class, which
    // must NOT fan out a cover slot (they teach it themselves).
    mockLeaveFindById.mockReturnValue({
      lean: async () => ({ fromKey: "2026-06-14", toKey: "2026-06-14", dayPart: "late_entry", partialPeriods: [1, 2] }),
    });
    mockResolveDayType.mockResolvedValue("FULL");
    const cls = oid(), sec = oid();
    mockSlotsForTeacherOnDate.mockResolvedValue([
      { _id: oid(), classId: cls, groupId: sec, subject: "MATH", periodNumber: 2, isBreak: false },
      { _id: oid(), classId: cls, groupId: sec, subject: "BAN", periodNumber: 6, isBreak: false },
    ]);
    mockSlotFindOne.mockResolvedValue(null);
    mockSubjectFindOne.mockResolvedValue({ _id: oid() });
    mockSlotCreate.mockImplementation(async (d) => ({ _id: oid(), ...d }));

    const slots = await fanOutCoverSlots(oid().toString(), staffId);
    expect(slots).toHaveLength(1);
    expect(mockSlotCreate).toHaveBeenCalledTimes(1);
    expect(mockSlotCreate.mock.calls[0][0]).toMatchObject({ periodNumber: 2, status: "needs_cover" });
  });

  test("fanOutCoverSlots creates a subjectgroup slot for a Quran/Arabic meeting (no classId, no subject)", async () => {
    const staffId = oid().toString();
    mockStaffFindById.mockResolvedValueOnce({ phone: "01700000000" });
    mockUserFindOne.mockResolvedValueOnce({ _id: oid() });
    mockLeaveFindById.mockReturnValue({ lean: async () => ({ fromKey: "2026-06-14", toKey: "2026-06-14" }) });
    mockResolveDayType.mockResolvedValue("FULL");
    const grp = oid();
    mockSlotsForTeacherOnDate.mockResolvedValue([
      { _id: oid(), groupType: "subjectgroup", classId: null, groupId: grp, subject: "QURAN", periodNumber: 1, isBreak: false },
    ]);
    mockSlotFindOne.mockResolvedValue(null);
    mockSlotCreate.mockImplementation(async (d) => ({ _id: oid(), ...d }));

    const slots = await fanOutCoverSlots(oid().toString(), staffId);
    expect(slots).toHaveLength(1);
    // Subject.findOne is NOT consulted for a subjectgroup meeting (no foundation subject).
    expect(mockSubjectFindOne).not.toHaveBeenCalled();
    expect(mockSlotCreate.mock.calls[0][0]).toMatchObject({
      groupType: "subjectgroup",
      classId: null,
      sectionId: null,
      subjectId: null,
      subjectGroupId: grp,
      status: "needs_cover",
    });
  });

  test("decideCoverSlot approve (no override) → mints a one-day proxy grant for the slot's own date", async () => {
    const cover = oid(), absent = oid(), subj = oid();
    const slot: any = {
      _id: oid(), leaveApplicationId: oid(), groupType: "section", classId: oid(), sectionId: oid(), subjectId: subj,
      proposedCoverTeacherId: cover, absentTeacherUserId: absent, status: "proposed", proxyGrantId: null,
      dateKey: "2026-06-14", periodNumber: 2,
    };
    slot.save = jest.fn().mockResolvedValue(slot);
    mockSlotFindById.mockResolvedValue(slot);
    const grantId = oid().toString();
    mockAssignProxy.mockResolvedValue(grantId);

    const res = await decideCoverSlot(slot._id.toString(), true, ACTOR);
    expect(res.status).toBe("approved");
    expect(res.proxyGrantId!.toString()).toBe(grantId);
    expect(res.finalCoverTeacherUserId!.toString()).toBe(cover.toString());
    expect(mockAssignProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        coveringTeacherId: cover.toString(),
        durationDays: 1,
        subjectId: subj.toString(),
      }),
    );
    expect(mockEmitHrCoverAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ coverTeacherUserId: cover.toString(), dateKey: "2026-06-14" }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "STAFF_COVER_DECIDED",
        meta: expect.objectContaining({ decision: "approved", override: false }),
      }),
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

  test("resolveStaffProfileForUser fails CLOSED when two staff share the caller's phone (no masquerade)", async () => {
    mockUserFindById.mockResolvedValue({ phone: "1700000000" });
    // Two active StaffProfiles with the same normalized phone — ambiguous join.
    mockStaffFind.mockResolvedValue([
      { _id: oid(), phone: "01700000000" },
      { _id: oid(), phone: "0 1700-000000" },
    ]);
    expect(await resolveStaffProfileForUser(oid().toString())).toBeNull();
  });
});
