/**
 * HR-5 — staff offboarding (prd-hr §6, H6, D-#29/#117). Pure helpers exercised
 * directly; the OffboardingService runs against mocked models + composed services
 * (DB-free, the repo's test convention). Composition is verified by asserting the
 * REUSED pieces are called (revokeAllGrantsForUser, computePayslip via real math,
 * the advance recovery commit), not by re-testing them.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();
/** A fixed LOCAL date so dateKeyOf (local Y/M/D) is deterministic across runners. */
const LWD_TODAY = new Date(2026, 5, 13); // 2026-06-13 local → dateKeyOf "2026-06-13"

// --- model + dependency mocks ----------------------------------------------
const mockCaseCreate = jest.fn();
const mockCaseFindById = jest.fn();
const mockCaseFindOne = jest.fn();
const mockCaseFind = jest.fn();
const mockStaffFindById = jest.fn();
const mockStaffUpdate = jest.fn().mockResolvedValue(undefined);
const mockUserUpdate = jest.fn().mockResolvedValue(undefined);
const mockAYFindOne = jest.fn();
const mockAdvanceFindById = jest.fn();
const mockRevokeAllGrants = jest.fn().mockResolvedValue(0);
const mockResolveUserId = jest.fn();
const mockBalancesForStaff = jest.fn().mockResolvedValue([]);
const mockActiveAdvanceByStaff = jest.fn().mockResolvedValue(new Map());
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
/** SH-3 (D-#540): held probation-leave rows. Default "nothing held" keeps every
 *  pre-existing figure in this suite unchanged. */
const mockDebtFind = jest.fn(() => [] as unknown[]);

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

jest.mock("../modules/hr/models/OffboardingCase", () => ({
  OffboardingCase: {
    create: (d: unknown) => mockCaseCreate(d),
    findById: (id: unknown) => mockCaseFindById(id),
    findOne: (q: unknown) => mockCaseFindOne(q),
    find: (q: unknown) => mockCaseFind(q),
  },
}));
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: {
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockStaffFindById(id) }) }),
    findByIdAndUpdate: (id: unknown, u: unknown) => mockStaffUpdate(id, u),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { findByIdAndUpdate: (id: unknown, u: unknown) => mockUserUpdate(id, u) },
}));
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: { findOne: (q: unknown) => ({ select: () => ({ lean: () => mockAYFindOne(q) }) }) },
}));
// SH-3 (D-#540): the exit settlement now reads any HELD probation-leave debt, and
// marks it settled at RELEASE. Default here is "nothing held", so every pre-existing
// figure in this suite is unchanged; the debt-carrying case is asserted separately.
jest.mock("../modules/hr/models/ProbationLeaveDebt", () => ({
  ProbationLeaveDebt: {
    find: (..._a: unknown[]) => ({
      select: () => ({ lean: async () => mockDebtFind() }),
      sort: () => ({ lean: async () => mockDebtFind() }),
      lean: async () => mockDebtFind(),
    }),
    updateOne: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock("../modules/hr/models/AdvanceLoan", () => ({
  AdvanceLoan: { findById: (id: unknown) => mockAdvanceFindById(id) },
}));
jest.mock("../modules/foundation/services/ScopeGrantService", () => ({
  revokeAllGrantsForUser: (u: unknown, by: unknown) => mockRevokeAllGrants(u, by),
}));
jest.mock("../modules/hr/services/staffMatch", () => ({
  resolveUserIdForStaff: (id: unknown) => mockResolveUserId(id),
}));
jest.mock("../modules/hr/services/LeaveEntitlementService", () => ({
  balancesForStaff: (s: unknown, y: unknown) => mockBalancesForStaff(s, y),
}));
jest.mock("../modules/hr/services/AdvanceService", () => ({
  activeAdvanceByStaff: () => mockActiveAdvanceByStaff(),
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import {
  employmentStatusForTrigger,
  defaultClearanceItems,
  clearanceComplete,
  lastWorkingDayReached,
  OffboardingError,
} from "../modules/hr/services/offboardingMath";
import {
  initiateOffboarding,
  updateClearanceItem,
  revokeOffboardingAccess,
  runDueOffboardingRevocations,
  computeFinalSettlement,
  releaseFinalSettlement,
  cancelOffboarding,
} from "../modules/hr/services/OffboardingService";
import { ProbationLeaveDebt } from "../modules/hr/models/ProbationLeaveDebt";

beforeEach(() => {
  jest.clearAllMocks();
  mockRevokeAllGrants.mockResolvedValue(0);
  mockBalancesForStaff.mockResolvedValue([]);
  mockActiveAdvanceByStaff.mockResolvedValue(new Map());
});

// ===========================================================================
// Pure (offboardingMath)
// ===========================================================================
describe("offboardingMath — trigger→status + clearance gate (pure, H6.1/H6.2/H6.4)", () => {
  test("each H6.1 trigger maps to an employment status (D-#117)", () => {
    expect(employmentStatusForTrigger("resignation")).toBe("resigned");
    expect(employmentStatusForTrigger("termination")).toBe("terminated");
    expect(employmentStatusForTrigger("fixed_term_end")).toBe("contract_ended");
    expect(employmentStatusForTrigger("retirement")).toBe("retired");
  });

  test("defaultClearanceItems are the three §6 categories", () => {
    expect(defaultClearanceItems().map((i) => i.key)).toEqual(["asset_return", "handover", "no_dues"]);
  });

  test("clearanceComplete: empty=false, all done/waived=true, any pending=false", () => {
    expect(clearanceComplete([])).toBe(false);
    expect(clearanceComplete([{ status: "done" }, { status: "waived" }])).toBe(true);
    expect(clearanceComplete([{ status: "done" }, { status: "pending" }])).toBe(false);
  });

  test("lastWorkingDayReached compares ISO keys lexically", () => {
    expect(lastWorkingDayReached("2026-06-13", "2026-06-13")).toBe(true);
    expect(lastWorkingDayReached("2026-06-13", "2026-06-14")).toBe(true);
    expect(lastWorkingDayReached("2026-06-13", "2026-06-12")).toBe(false);
  });
});

// ===========================================================================
// initiate (H6.1)
// ===========================================================================
describe("initiateOffboarding (H6.1)", () => {
  test("opens a case, seeds the default checklist, sets employmentStatus, audits", async () => {
    mockStaffFindById.mockResolvedValue({ _id: oid(), active: true });
    mockCaseFindOne.mockReturnValue(leanChain(null)); // no open case
    mockCaseCreate.mockResolvedValue({ _id: oid(), trigger: "retirement", status: "initiated" });
    const staffId = oid().toString();
    await initiateOffboarding({ staffProfileId: staffId, trigger: "retirement", lastWorkingDayKey: "2026-12-31", actorId: oid().toString() });
    expect(mockCaseCreate).toHaveBeenCalledWith(expect.objectContaining({ status: "initiated" }));
    // the seeded checklist is the 3 defaults
    expect(mockCaseCreate.mock.calls[0][0].clearanceItems).toHaveLength(3);
    // H6.1 — trigger sets the employment status
    expect(mockStaffUpdate).toHaveBeenCalledWith(staffId, { employmentStatus: "retired" });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "OFFBOARDING_INITIATED" }));
  });

  test("refuses a second open case for the same staff", async () => {
    mockStaffFindById.mockResolvedValue({ _id: oid(), active: true });
    mockCaseFindOne.mockReturnValue(leanChain({ _id: oid() })); // already an open case
    await expect(
      initiateOffboarding({ staffProfileId: oid().toString(), trigger: "resignation", lastWorkingDayKey: "2026-12-31", actorId: oid().toString() }),
    ).rejects.toThrow(/already has an open offboarding/);
    expect(mockCaseCreate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// access revocation (H6.3) — by the system, on the last working day
// ===========================================================================
describe("revokeOffboardingAccess (H6.3)", () => {
  const makeCase = (over: Record<string, unknown> = {}): Record<string, any> => ({
    _id: oid(),
    staffProfileId: oid(),
    initiatedBy: oid(),
    status: "initiated",
    lastWorkingDayKey: "2026-06-13",
    accessRevoked: false,
    save: jest.fn(),
    ...over,
  });

  test("refuses BEFORE the last working day (lazy date gate, D-#20/#21)", async () => {
    const c = makeCase({ lastWorkingDayKey: "2026-12-31" });
    mockCaseFindById.mockResolvedValue(c);
    await expect(revokeOffboardingAccess({ caseId: c._id.toString(), now: LWD_TODAY })).rejects.toThrow(/last working day/);
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockRevokeAllGrants).not.toHaveBeenCalled();
  });

  test("on the last working day: disables login + revokes ALL grants, sets access_revoked, audits", async () => {
    const c = makeCase();
    mockCaseFindById.mockResolvedValue(c);
    const userId = oid().toString();
    mockResolveUserId.mockResolvedValue(userId);
    mockRevokeAllGrants.mockResolvedValue(3);
    await revokeOffboardingAccess({ caseId: c._id.toString(), actorId: oid().toString(), now: LWD_TODAY });
    expect(mockUserUpdate).toHaveBeenCalledWith(userId, { active: false });
    expect(mockRevokeAllGrants).toHaveBeenCalledWith(userId, expect.any(String));
    expect(c.accessRevoked).toBe(true);
    expect(c.status).toBe("access_revoked");
    expect(c.grantsRevokedCount).toBe(3);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "OFFBOARDING_ACCESS_REVOKED" }));
  });

  test("support staff (no login): loginDisabled false, 0 grants, still marks revoked", async () => {
    const c = makeCase();
    mockCaseFindById.mockResolvedValue(c);
    mockResolveUserId.mockResolvedValue(null); // no User
    await revokeOffboardingAccess({ caseId: c._id.toString(), now: LWD_TODAY });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockRevokeAllGrants).not.toHaveBeenCalled();
    expect(c.accessRevoked).toBe(true);
    expect(c.loginDisabled).toBe(false);
  });

  test("idempotent: an already-revoked case is a no-op", async () => {
    const c = makeCase({ accessRevoked: true });
    mockCaseFindById.mockResolvedValue(c);
    await revokeOffboardingAccess({ caseId: c._id.toString(), now: LWD_TODAY });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockRevokeAllGrants).not.toHaveBeenCalled();
  });

  test("runDueOffboardingRevocations sweeps every due case (the system path, H6.3)", async () => {
    const c1 = oid(), c2 = oid();
    mockCaseFind.mockReturnValue(leanChain([{ _id: c1 }, { _id: c2 }]));
    // each revoke loads its own case doc
    mockCaseFindById
      .mockResolvedValueOnce(makeCase({ _id: c1 }))
      .mockResolvedValueOnce(makeCase({ _id: c2 }));
    mockResolveUserId.mockResolvedValue(null);
    const n = await runDueOffboardingRevocations(LWD_TODAY);
    expect(n).toBe(2);
  });
});

// ===========================================================================
// final settlement (H6.4) — composed + hard-held
// ===========================================================================
describe("final settlement (H6.4, D-#29)", () => {
  test("computeFinalSettlement composes encashment + advance netting, held=true, audits", async () => {
    const c: Record<string, unknown> = {
      _id: oid(), staffProfileId: oid(), status: "initiated", settlement: null,
      clearanceItems: [{ status: "pending" }], save: jest.fn(),
    };
    mockCaseFindById.mockResolvedValue(c);
    mockStaffFindById.mockResolvedValue({ monthlySalary: 30000 });
    mockAYFindOne.mockResolvedValue({ _id: oid() });
    mockBalancesForStaff.mockResolvedValue([{ encashableDays: 5 }, { encashableDays: 0 }]);
    const advId = oid();
    mockActiveAdvanceByStaff.mockResolvedValue(new Map([[(c.staffProfileId as mongoose.Types.ObjectId).toString(), { _id: advId, balance: 4000, recoveryMode: "installments" }]]));

    await computeFinalSettlement({ caseId: (c._id as mongoose.Types.ObjectId).toString(), workingDays: 26, actorId: oid().toString() });
    const s = c.settlement as Record<string, unknown>;
    expect(s).toBeTruthy();
    expect(s.held).toBe(true);
    expect(s.leaveEncashmentDays).toBe(5);
    // advance netted in full at exit (one_shot), within the net-pay guard
    expect(s.advanceRecovered).toBe(4000);
    // net = 30000 + encashment(round(1154*5)=5770) - advance 4000 = 31770
    expect(s.netPay).toBe(31770);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "FINAL_SETTLEMENT_COMPUTED" }));
  });

  test("computeFinalSettlement refuses a staff member with no salary", async () => {
    const c: Record<string, unknown> = { _id: oid(), staffProfileId: oid(), status: "initiated", settlement: null, save: jest.fn() };
    mockCaseFindById.mockResolvedValue(c);
    mockStaffFindById.mockResolvedValue({ monthlySalary: 0 });
    await expect(computeFinalSettlement({ caseId: (c._id as mongoose.Types.ObjectId).toString(), workingDays: 26, actorId: oid().toString() })).rejects.toThrow(/no monthly salary/);
  });

  test("releaseFinalSettlement is HARD-HELD until clearance is complete (D-#29)", async () => {
    const c: Record<string, unknown> = {
      _id: oid(), status: "access_revoked",
      settlement: { held: true, advanceId: null, advanceRecovered: 0, netPay: 100 },
      clearanceItems: [{ status: "done" }, { status: "pending" }], // not complete
      save: jest.fn(), markModified: jest.fn(),
    };
    mockCaseFindById.mockResolvedValue(c);
    await expect(releaseFinalSettlement((c._id as mongoose.Types.ObjectId).toString(), oid().toString())).rejects.toThrow(/hard-held until clearance/);
  });

  test("releaseFinalSettlement commits advance recovery + completes the case when clearance done", async () => {
    const advId = oid();
    const advance = { balance: 4000, status: "active", save: jest.fn() };
    const c: Record<string, unknown> = {
      // staffProfileId is on every real case; the SH-3 exit settlement needs it to
      // settle the held probation debt at release.
      _id: oid(), staffProfileId: oid(), status: "access_revoked",
      settlement: { held: true, advanceId: advId, advanceRecovered: 4000, netPay: 31770 },
      clearanceItems: [{ status: "done" }, { status: "waived" }],
      save: jest.fn(), markModified: jest.fn(),
    };
    mockCaseFindById.mockResolvedValue(c);
    mockAdvanceFindById.mockResolvedValue(advance);
    await releaseFinalSettlement((c._id as mongoose.Types.ObjectId).toString(), oid().toString());
    expect(advance.balance).toBe(0);
    expect(advance.status).toBe("settled");
    expect((c.settlement as Record<string, unknown>).held).toBe(false);
    expect(c.status).toBe("completed");
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "FINAL_SETTLEMENT_RELEASED" }));
  });

  // --- SH-3 / D-#540: the probationer who leaves before confirmation -----------
  test("a probationer's HELD leave is deducted at day-rate from the final settlement", async () => {
    const staffId = oid();
    const c: Record<string, unknown> = {
      _id: oid(), staffProfileId: staffId, status: "access_revoked",
      clearanceItems: [{ status: "done" }],
      save: jest.fn(), markModified: jest.fn(),
    };
    mockCaseFindById.mockResolvedValue(c);
    mockStaffFindById.mockResolvedValue({ _id: staffId, monthlySalary: 30000 });
    // 6 days held from probation leave that was never paid and never deducted.
    mockDebtFind.mockReturnValue([{ _id: oid(), days: 4 }, { _id: oid(), days: 2 }]);

    await computeFinalSettlement({ caseId: (c._id as mongoose.Types.ObjectId).toString(), workingDays: 30, actorId: oid().toString() });

    const s = c.settlement as { deductions: Array<{ type: string; amount: number; days?: number }>; netPay: number };
    const held = s.deductions.find((d) => d.days === 6);
    expect(held).toBeDefined();
    expect(held!.amount).toBe(6000); // 6 × (30000/30)
    expect(s.netPay).toBe(24000);
  });

  test("computing the settlement does NOT settle the debt — only releasing it does", async () => {
    const staffId = oid();
    const c: Record<string, unknown> = {
      _id: oid(), staffProfileId: staffId, status: "access_revoked",
      clearanceItems: [{ status: "done" }],
      save: jest.fn(), markModified: jest.fn(),
    };
    mockCaseFindById.mockResolvedValue(c);
    mockStaffFindById.mockResolvedValue({ _id: staffId, monthlySalary: 30000 });
    mockDebtFind.mockReturnValue([{ _id: oid(), days: 3 }]);

    await computeFinalSettlement({ caseId: (c._id as mongoose.Types.ObjectId).toString(), workingDays: 30, actorId: oid().toString() });
    // A recompute must be able to run any number of times without consuming the debt —
    // otherwise the second computation would silently drop the deduction.
    expect(ProbationLeaveDebt.updateOne).not.toHaveBeenCalled();

    await releaseFinalSettlement((c._id as mongoose.Types.ObjectId).toString(), oid().toString());
    expect(ProbationLeaveDebt.updateOne).toHaveBeenCalled();
  });
});

// ===========================================================================
// clearance + cancel
// ===========================================================================
describe("clearance + cancel", () => {
  test("updateClearanceItem sets the item status + audits", async () => {
    const item = { key: "no_dues", label: "x", status: "pending" as const, note: null, updatedBy: null, updatedAt: null };
    const c: Record<string, unknown> = { _id: oid(), status: "initiated", clearanceItems: [item], save: jest.fn() };
    mockCaseFindById.mockResolvedValue(c);
    await updateClearanceItem((c._id as mongoose.Types.ObjectId).toString(), "no_dues", "done", "ok", oid().toString());
    expect(item.status).toBe("done");
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "OFFBOARDING_CLEARANCE_UPDATED" }));
  });

  test("cancelOffboarding only works before access is revoked", async () => {
    const revoked: Record<string, unknown> = { _id: oid(), status: "access_revoked", save: jest.fn() };
    mockCaseFindById.mockResolvedValue(revoked);
    await expect(cancelOffboarding((revoked._id as mongoose.Types.ObjectId).toString(), oid().toString())).rejects.toThrow(OffboardingError);

    const fresh: Record<string, unknown> = { _id: oid(), status: "initiated", save: jest.fn() };
    mockCaseFindById.mockResolvedValue(fresh);
    await cancelOffboarding((fresh._id as mongoose.Types.ObjectId).toString(), oid().toString());
    expect(fresh.status).toBe("cancelled");
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "OFFBOARDING_CANCELLED" }));
  });
});
