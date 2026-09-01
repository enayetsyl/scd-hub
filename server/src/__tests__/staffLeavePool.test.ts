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
// D-#616 — the pool counts lateness charges as taken, so this model must answer.
const mockLatenessFind = jest.fn(() => [] as unknown[]);
jest.mock("../modules/hr/models/LatenessCharge", () => ({
  LatenessCharge: { find: () => ({ select: () => ({ lean: async () => mockLatenessFind() }) }) },
}));
// D-#617 — an agreed recovery credits the pool back, so takenPooledDays reads this.
const mockRecoveryFind = jest.fn(() => [] as unknown[]);
jest.mock("../modules/hr/models/LeaveBalanceRecovery", () => ({
  LeaveBalanceRecovery: {
    find: () => ({ select: () => ({ lean: async () => mockRecoveryFind() }) }),
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock("../modules/hr/models/HrPolicy", () => ({
  HrPolicy: { findOne: () => ({ lean: async () => null }) }, // absent → HR_POLICY_DEFAULTS
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: jest.fn().mockResolvedValue(undefined),
}));

import { pooledBalanceForStaff, leaveYearWindow } from "../modules/hr/services/LeaveEntitlementService";
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
  mockLatenessFind.mockReturnValue([]);
  mockRecoveryFind.mockReturnValue([]);
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

  /**
   * D-#618 retired pro-ration. It existed because the leave year was the SCHOOL'S and a
   * mid-year joiner had only part of it; the year now starts at each staff member's own
   * confirmation, so it is never partial and there is nothing to pro-rate. A probationer
   * has not started one at all, and their allowance is shown in full — it is what they
   * WILL get on confirmation, which is also when their held leave settles against it.
   */
  test("a mid-year joiner is NOT pro-rated — their leave year starts at confirmation", async () => {
    mockStaffFindById.mockResolvedValue({ joiningDate: new Date("2026-07-02"), confirmationDate: null });
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.onProbation).toBe(true);
    expect(pool.proRated).toBe(false);
    expect(pool.allowanceDays).toBe(HR_POLICY_DEFAULTS.annualLeaveDays);
    expect(pool.leaveYearStart).toBeNull();
    // One query, not two — the confirmation date came from the same document.
    expect(mockStaffFindById).toHaveBeenCalledTimes(1);
  });

  test("a confirmed staff member gets their own anniversary window (D-#618)", async () => {
    mockStaffFindById.mockResolvedValue({
      joiningDate: new Date("2024-06-24"),
      confirmationDate: new Date("2024-06-24"),
    });
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.onProbation).toBe(false);
    // Whatever today is, the window runs 24 June → 23 June and contains it.
    expect(pool.leaveYearStart).toMatch(/-06-24$/);
    expect(pool.leaveYearEnd).toMatch(/-06-23$/);
  });
});

describe("leaveYearWindow — the staff member's own year (D-#618)", () => {
  const ON = new Date("2026-08-31T00:00:00Z");

  test("the period runs anniversary → anniversary, and contains today", () => {
    expect(leaveYearWindow("2024-06-24", ON)).toEqual({ start: "2026-06-24", end: "2027-06-23", isFirst: false });
    // Confirmed 1 Jan: the window happens to match the calendar year.
    expect(leaveYearWindow("2023-01-01", ON)).toEqual({ start: "2026-01-01", end: "2026-12-31", isFirst: false });
  });

  test("before this year's anniversary the period began LAST year", () => {
    // Confirmed 30 Dec; on 31 Aug 2026 the 2026 anniversary has not arrived.
    expect(leaveYearWindow("2025-12-30", ON)).toEqual({ start: "2025-12-30", end: "2026-12-29", isFirst: true });
  });

  test("the first period starts at confirmation itself, not a year earlier", () => {
    expect(leaveYearWindow("2026-08-01", ON)).toEqual({ start: "2026-08-01", end: "2027-07-31", isFirst: true });
    // Confirmed today: the year starts today.
    expect(leaveYearWindow("2026-08-31", ON)!.start).toBe("2026-08-31");
  });

  test("the day before an anniversary is still the OLD period", () => {
    expect(leaveYearWindow("2025-09-01", ON)).toEqual({ start: "2025-09-01", end: "2026-08-31", isFirst: true });
  });

  test("no confirmation date → no period has begun", () => {
    expect(leaveYearWindow(null, ON)).toBeNull();
    expect(leaveYearWindow(undefined, ON)).toBeNull();
    expect(leaveYearWindow("not-a-date", ON)).toBeNull();
  });
});

describe("what counts as TAKEN against the pool", () => {
  const CONFIRMED = { joiningDate: new Date("2023-01-01"), confirmationDate: new Date("2023-01-01") };

  /**
   * D-#616. LatenessService computed `paidFromLeave`, stored it and showed it — and
   * the pool never read it, so "1 day taken from leave" left the balance where it was.
   * Now that a charge can no longer fall through to salary, this is the only place it
   * lands: if the pool stops counting charges, lateness costs nothing at all.
   */
  test("lateness charges count as taken, not just leave applications (D-#616)", async () => {
    mockStaffFindById.mockResolvedValue(CONFIRMED);
    mockAppFind.mockReturnValue([{ paidDays: 3, days: 3 }]);
    mockLatenessFind.mockReturnValue([{ paidFromLeave: 2 }, { paidFromLeave: 1 }]);
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.takenDays).toBe(6); // 3 leave + 3 lateness
    expect(pool.remainingDays).toBe(HR_POLICY_DEFAULTS.annualLeaveDays - 6);
  });

  /**
   * D-#617. Money came off the payslip; if the balance did not move with it the same
   * days would be collected again at exit.
   */
  test("an AGREED recovery gives the days back (D-#617)", async () => {
    mockStaffFindById.mockResolvedValue(CONFIRMED);
    mockAppFind.mockReturnValue([{ paidDays: 25, days: 25 }]);
    mockRecoveryFind.mockReturnValue([{ days: 5 }]);
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.takenDays).toBe(20); // 25 taken, 5 settled from salary
    expect(pool.remainingDays).toBe(0);
  });

  test("an overdrawn pool reports a NEGATIVE balance rather than zero (D-#612)", async () => {
    mockStaffFindById.mockResolvedValue(CONFIRMED);
    mockAppFind.mockReturnValue([{ paidDays: 31, days: 31 }]);
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.remainingDays).toBe(HR_POLICY_DEFAULTS.annualLeaveDays - 31);
    expect(pool.remainingDays).toBeLessThan(0);
  });
});

describe("the FIRST leave year absorbs the probation period (D-#619)", () => {
  const CONFIRMED_AUG = { joiningDate: new Date("2026-01-01"), confirmationDate: new Date("2026-08-01") };

  test("the first window is flagged; a later anniversary is not", () => {
    expect(leaveYearWindow("2026-08-01", new Date("2026-08-31T00:00:00Z"))!.isFirst).toBe(true);
    // A year on, the same person is in their SECOND period.
    expect(leaveYearWindow("2026-08-01", new Date("2027-09-01T00:00:00Z"))!.isFirst).toBe(false);
  });

  /**
   * The real case. A teacher confirmed 1 Aug 2026 took 16 days of held probation leave
   * (dated Jan–Apr) and accrued 12 lateness charge-days. Both are dated BEFORE his
   * window opens. Under a plain window filter the settlement re-stamped the leave as
   * paid and then counted none of it — the ledger moved and the balance did not, which
   * is D-#590 arriving again through D-#618's back door.
   *
   * His letter states the intended answer outright: 28 days against 20 allowed.
   */
  test("probation leave and lateness dated BEFORE confirmation still count", async () => {
    mockStaffFindById.mockResolvedValue(CONFIRMED_AUG);
    mockAppFind.mockReturnValue([{ paidDays: 16, days: 16 }]);   // settled probation leave
    mockLatenessFind.mockReturnValue([{ paidFromLeave: 12 }]);    // Jan–Aug lateness
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.leaveYearStart).toBe("2026-08-01");
    expect(pool.takenDays).toBe(28);
    expect(pool.remainingDays).toBe(-8); // 20 − 28, exactly as his letter says
  });

  test("a LATER year keeps the closed window, so probation is not charged twice", async () => {
    // Same person, read a year on: the first period's history must not follow them.
    mockStaffFindById.mockResolvedValue({
      joiningDate: new Date("2020-01-01"),
      confirmationDate: new Date("2020-01-01"),
    });
    mockAppFind.mockReturnValue([]);
    mockLatenessFind.mockReturnValue([]);
    const pool = await pooledBalanceForStaff(oid().toString());
    expect(pool.takenDays).toBe(0);
    expect(pool.remainingDays).toBe(HR_POLICY_DEFAULTS.annualLeaveDays);
  });
});
