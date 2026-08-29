/**
 * D-#590 — the dating of a salary change, and the settlement that must debit the pool.
 *
 * Both of these were found on a PROD PAYSLIP after D-#587/#540 had shipped green, and
 * both were invisible to the tests that existed: one asserted "a row in range wins" and
 * never asked what happens before the earliest row; the other asserted the ledger was
 * ticked and never asked whether the pool moved.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockPayCount = jest.fn(async (_q?: unknown) => 0);
const mockPayCreate = jest.fn(async (d: Record<string, unknown>) => ({ ...d, _id: oid() }));
const mockDebtFind = jest.fn(() => [] as unknown[]);
const mockDebtUpdate = jest.fn().mockResolvedValue({});
const mockLeaveUpdate = jest.fn().mockResolvedValue({});

jest.mock("../modules/hr/models/StaffPayChange", () => ({
  StaffPayChange: {
    countDocuments: (q: unknown) => mockPayCount(q),
    create: (d: Record<string, unknown>) => mockPayCreate(d),
    find: () => ({ sort: () => ({ select: () => ({ lean: async () => [] }) }) }),
    findOne: () => ({ sort: () => ({ select: () => ({ lean: async () => null }) }) }),
  },
}));
jest.mock("../modules/hr/models/ProbationLeaveDebt", () => ({
  ProbationLeaveDebt: {
    find: () => ({ sort: () => ({ lean: async () => mockDebtFind() }) }),
    updateOne: (...a: unknown[]) => mockDebtUpdate(...a),
  },
}));
jest.mock("../modules/hr/models/StaffLeaveApplication", () => ({
  StaffLeaveApplication: { updateOne: (...a: unknown[]) => mockLeaveUpdate(...a) },
}));
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: { findById: () => ({ select: () => ({ lean: async () => null }) }) },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: jest.fn().mockResolvedValue(undefined),
}));

import { defaultEffectiveFrom, recordPayChange, currentMonthKey } from "../modules/hr/services/PayHistoryService";
import { settleOnConfirmation } from "../modules/hr/services/ProbationDebtService";

const ACTOR = oid().toString();
beforeEach(() => {
  jest.clearAllMocks();
  mockPayCount.mockResolvedValue(0);
  mockDebtFind.mockReturnValue([]);
});

// ===========================================================================
describe("when a salary change takes effect (D-#590)", () => {
  const NOW = currentMonthKey();

  test("the FIRST row is dated from the JOINING month, not the month it was typed", () => {
    expect(defaultEffectiveFrom(true, "2025-07")).toBe("2025-07");
  });

  test("later changes still default to the current month — a raise entered today starts today", () => {
    expect(defaultEffectiveFrom(false, "2025-07")).toBe(NOW);
  });

  test("no joining month on file falls back to the current month rather than guessing", () => {
    expect(defaultEffectiveFrom(true, null)).toBe(NOW);
    expect(defaultEffectiveFrom(true, "")).toBe(NOW);
    expect(defaultEffectiveFrom(true, "not-a-month")).toBe(NOW);
  });

  test("a FUTURE joining month is not used — a salary cannot start before it can apply", () => {
    expect(defaultEffectiveFrom(true, "2099-01")).toBe(NOW);
  });

  test("an explicit effectiveFrom always wins, first row or not", async () => {
    await recordPayChange({
      staffProfileId: oid().toString(),
      monthlySalary: 10000,
      effectiveFrom: "2026-07",
      joiningMonth: "2025-07",
      actorId: ACTOR,
    });
    expect(mockPayCreate.mock.calls[0][0]).toMatchObject({ effectiveFrom: "2026-07" });
  });

  test("the first recorded figure carries the joining month through to the row", async () => {
    mockPayCount.mockResolvedValue(0);
    await recordPayChange({
      staffProfileId: oid().toString(),
      monthlySalary: 8000,
      joiningMonth: "2025-07",
      actorId: ACTOR,
    });
    // The prod bug wrote 2026-08 here, which then outranked a raise backdated to
    // 2026-07 and paid the old salary.
    expect(mockPayCreate.mock.calls[0][0]).toMatchObject({ effectiveFrom: "2025-07" });
  });

  test("once history exists, the joining month is ignored", async () => {
    mockPayCount.mockResolvedValue(1);
    await recordPayChange({
      staffProfileId: oid().toString(),
      monthlySalary: 12000,
      joiningMonth: "2025-07",
      actorId: ACTOR,
    });
    expect(mockPayCreate.mock.calls[0][0]).toMatchObject({ effectiveFrom: NOW });
  });
});

// ===========================================================================
describe("settleOnConfirmation debits the POOL, not just the ledger (D-#590)", () => {
  const staffId = oid().toString();
  const leaveA = oid();
  const leaveB = oid();

  test("days the pool covers become PAID leave — that is what debits the pool", async () => {
    mockDebtFind.mockReturnValue([
      { _id: oid(), leaveApplicationId: leaveA, fromKey: "2026-05-01", leaveType: "casual", days: 3 },
    ]);
    const res = await settleOnConfirmation(staffId, 20, ACTOR);

    expect(res).toMatchObject({ heldDays: 3, fromPool: 3, toSalary: 0 });
    // THE ASSERTION THAT WAS MISSING: the leave itself is re-stamped. Without this the
    // pool's `taken` stays 0 and the balance never moves — the days simply vanish.
    expect(mockLeaveUpdate).toHaveBeenCalledWith(
      { _id: leaveA },
      { $set: { paidDays: 3, unpaidDays: 0, probationHeld: false } },
    );
  });

  test("what the pool cannot cover stays UNPAID with the held flag cleared, so payroll can collect it", async () => {
    mockDebtFind.mockReturnValue([
      { _id: oid(), leaveApplicationId: leaveA, fromKey: "2026-05-01", leaveType: "casual", days: 4 },
    ]);
    const res = await settleOnConfirmation(staffId, 1, ACTOR);

    expect(res).toMatchObject({ heldDays: 4, fromPool: 1, toSalary: 3 });
    expect(mockLeaveUpdate).toHaveBeenCalledWith(
      { _id: leaveA },
      { $set: { paidDays: 1, unpaidDays: 3, probationHeld: false } },
    );
  });

  test("a partially-absorbed set is settled OLDEST FIRST, and each leave is stamped its own share", async () => {
    mockDebtFind.mockReturnValue([
      { _id: oid(), leaveApplicationId: leaveA, fromKey: "2026-03-01", leaveType: "casual", days: 2 },
      { _id: oid(), leaveApplicationId: leaveB, fromKey: "2026-06-01", leaveType: "sick", days: 3 },
    ]);
    await settleOnConfirmation(staffId, 3, ACTOR);

    // Pool of 3: the March leave takes 2, the June leave takes the last 1.
    expect(mockLeaveUpdate).toHaveBeenCalledWith(
      { _id: leaveA },
      { $set: { paidDays: 2, unpaidDays: 0, probationHeld: false } },
    );
    expect(mockLeaveUpdate).toHaveBeenCalledWith(
      { _id: leaveB },
      { $set: { paidDays: 1, unpaidDays: 2, probationHeld: false } },
    );
  });

  test("EVERY settled row clears probationHeld — a settled debt must never stay excluded from payroll", async () => {
    mockDebtFind.mockReturnValue([
      { _id: oid(), leaveApplicationId: leaveA, fromKey: "2026-05-01", leaveType: "casual", days: 3 },
      { _id: oid(), leaveApplicationId: leaveB, fromKey: "2026-06-01", leaveType: "casual", days: 3 },
    ]);
    await settleOnConfirmation(staffId, 0, ACTOR);

    for (const call of mockLeaveUpdate.mock.calls) {
      expect(call[1].$set.probationHeld).toBe(false);
    }
    expect(mockLeaveUpdate).toHaveBeenCalledTimes(2);
  });

  test("nothing held → nothing written", async () => {
    mockDebtFind.mockReturnValue([]);
    const res = await settleOnConfirmation(staffId, 20, ACTOR);
    expect(res).toMatchObject({ heldDays: 0, fromPool: 0, toSalary: 0, rowsSettled: 0 });
    expect(mockLeaveUpdate).not.toHaveBeenCalled();
  });
});
