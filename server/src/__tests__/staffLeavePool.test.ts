/**
 * D-#576 — the pooled balance must say WHOSE rule it is under.
 *
 * The number was already right; what was missing was the fact that a probationer
 * cannot draw it. Both own-row screens (আমার রেকর্ড, আমার ছুটি) read this one flag to
 * choose between "বাকি" and "স্থায়ী হলে পাবেন", so a wrong `onProbation` is a teacher
 * planning a week off against days that would in fact be recorded unpaid (D-#540).
 *
 * Probation is decided by `confirmationDate` ALONE — never `employmentStatus`, which
 * prod showed drifting on six profiles and which the confirmation event writes second.
 *
 * DB-free: models mocked, the repo's convention.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockStaffFindById = jest.fn();
const mockYearFindOne = jest.fn();
const mockYearFindById = jest.fn();
const mockEntFind = jest.fn(() => [] as unknown[]);
const mockAppFind = jest.fn(() => [] as unknown[]);

jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: {
    findById: (id: unknown) => ({ select: () => ({ lean: async () => mockStaffFindById(id) }) }),
  },
}));
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: {
    findOne: () => ({ lean: async () => mockYearFindOne() }),
    findById: (id: unknown) => ({ lean: async () => mockYearFindById(id) }),
  },
}));
jest.mock("../modules/hr/models/StaffLeaveEntitlement", () => ({
  StaffLeaveEntitlement: { find: () => ({ lean: async () => mockEntFind() }) },
}));
jest.mock("../modules/hr/models/StaffLeaveApplication", () => ({
  StaffLeaveApplication: { find: () => ({ select: () => ({ lean: async () => mockAppFind() }) }) },
}));
jest.mock("../modules/hr/models/HrPolicy", () => ({
  HrPolicy: { findOne: () => ({ lean: async () => null }) }, // absent → HR_POLICY_DEFAULTS
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: jest.fn().mockResolvedValue(undefined),
}));

import { pooledBalanceForStaff } from "../modules/hr/services/LeaveEntitlementService";
import { HR_POLICY_DEFAULTS } from "@scd/shared";

const YEAR = {
  _id: oid(),
  startDate: new Date("2026-01-01"),
  endDate: new Date("2026-12-31"),
  current: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockYearFindOne.mockResolvedValue(YEAR);
  mockEntFind.mockReturnValue([]);
  mockAppFind.mockReturnValue([]);
});

describe("pooledBalanceForStaff — onProbation (D-#576)", () => {
  test("no confirmationDate → onProbation, and the pool is still SHOWN (it is what she gets on confirmation)", async () => {
    mockStaffFindById.mockResolvedValue({ joiningDate: new Date("2025-01-01"), confirmationDate: null });
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.onProbation).toBe(true);
    // Not zeroed: the screens label this figure differently, they do not hide it.
    expect(pool.allowanceDays).toBe(HR_POLICY_DEFAULTS.annualLeaveDays);
    expect(pool.remainingDays).toBe(HR_POLICY_DEFAULTS.annualLeaveDays);
  });

  test("a confirmationDate clears it — this is the ONLY input, employmentStatus is never read", async () => {
    mockStaffFindById.mockResolvedValue({
      joiningDate: new Date("2025-01-01"),
      confirmationDate: new Date("2026-03-01"),
      // Deliberately contradicts the date: prod had six profiles drifted this way.
      employmentStatus: "probation",
    });
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.onProbation).toBe(false);
  });

  test("no academic year → the zeroed view, and it does not claim probation", async () => {
    mockYearFindOne.mockResolvedValue(null);
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.academicYearId).toBeNull();
    expect(pool.allowanceDays).toBe(0);
    expect(pool.onProbation).toBe(false);
  });

  test("a missing profile reads as probation — never as 'confirmed, 20 days available'", async () => {
    mockStaffFindById.mockResolvedValue(null);
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.onProbation).toBe(true);
  });

  test("the single profile read serves BOTH the probation flag and the joining-date pro-ration", async () => {
    mockStaffFindById.mockResolvedValue({ joiningDate: new Date("2026-07-02"), confirmationDate: null });
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.onProbation).toBe(true);
    expect(pool.proRated).toBe(true);
    expect(pool.allowanceDays).toBeLessThan(HR_POLICY_DEFAULTS.annualLeaveDays);
    // One query, not two — the joining date came from the same document.
    expect(mockStaffFindById).toHaveBeenCalledTimes(1);
  });
});
