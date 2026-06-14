/**
 * HR-G1 — staff own-row self-service reads (the gaps flagged when the HR app shipped):
 * `myPayslips` and `myStaffAttendance`. Server-only, vocab-free, NO new permission — the
 * own-row reads compose existing services + the D-#103 phone-join (fail-closed on a shared
 * phone). DB-free, model-mocked (the repo's test convention).
 *
 * Covered:
 *   - payslipsForStaff: own-row only (scoped to my staffProfileId) + LOCKED-runs-only
 *     (a draft/prepared payslip is never returned).
 *   - staffAttendanceForRange: own-row only + the AT-1 ✘=ABSENT → LEAVE overlay reused.
 *   - resolveStaffProfileForUser: the resolver's own-row gate — fail-closed on a shared
 *     phone (deny) and no-StaffProfile (the resolvers map a null match to [], never
 *     another person's data).
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// --- model + dependency mocks ---------------------------------------------
const mockRunFind = jest.fn();
const mockPayslipFind = jest.fn();
const mockAttFind = jest.fn();
const mockStaffFindById = jest.fn();
const mockStaffFind = jest.fn();
const mockUserFindById = jest.fn();
const mockLoadApprovedLeaves = jest.fn();

/** A find()-chain stub: .select()/.sort() return self, .lean() resolves the value. */
const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

jest.mock("../modules/hr/models/PayrollRun", () => ({
  PayrollRun: { find: (q: unknown) => mockRunFind(q) },
}));
jest.mock("../modules/hr/models/Payslip", () => ({
  Payslip: { find: (q: unknown) => mockPayslipFind(q) },
}));
jest.mock("../modules/attendance/models/TeacherAttendanceDay", () => ({
  TeacherAttendanceDay: { find: (q: unknown) => mockAttFind(q) },
}));
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: {
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockStaffFindById(id) }) }),
    find: (q: unknown) => ({ lean: () => mockStaffFind(q) }),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockUserFindById(id) }) }) },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: jest.fn().mockResolvedValue(undefined),
}));
// normalizePhone is pure — mirror the real implementation (no DB).
jest.mock("../modules/foundation/services/credentials", () => ({
  normalizePhone: (p: string) => p.replace(/\D/g, "").replace(/^0+/, ""),
}));
// StaffLeaveService: loadApprovedLeaves is mocked; staffLeaveCovers stays the real
// (pure) predicate so the overlay flips ABSENT → LEAVE for real.
jest.mock("../modules/hr/services/StaffLeaveService", () => ({
  loadApprovedLeaves: (...a: unknown[]) => mockLoadApprovedLeaves(...a),
  staffLeaveCovers: (
    leaves: Array<{ staffProfileId: string; fromKey: string; toKey: string }>,
    staffProfileId: string,
    dateKey: string,
  ) => leaves.some((l) => l.staffProfileId === staffProfileId && l.fromKey <= dateKey && dateKey <= l.toKey),
}));

import { payslipsForStaff } from "../modules/hr/services/PayrollService";
import { staffAttendanceForRange } from "../modules/attendance/services/TeacherAttendanceService";
import { resolveStaffProfileForUser } from "../modules/hr/services/staffMatch";

beforeEach(() => jest.clearAllMocks());

// ===========================================================================
describe("myPayslips — payslipsForStaff (own-row, locked-runs-only)", () => {
  test("returns only MY payslips, scoped to my staffProfileId and to locked runs", async () => {
    const mine = oid().toString();
    const lockedRun = oid();
    mockRunFind.mockReturnValue(leanChain([{ _id: lockedRun }]));
    const slips = [{ _id: oid(), monthKey: "2026-05" }];
    mockPayslipFind.mockReturnValue(leanChain(slips));

    const res = await payslipsForStaff(mine);

    expect(res).toBe(slips);
    // the run query is locked-only (a draft/prepared run's payslips are never reachable)
    expect(mockRunFind.mock.calls[0][0]).toEqual({ status: "approved_locked" });
    // the payslip query is scoped to MY id AND to the locked run ids only
    const q = mockPayslipFind.mock.calls[0][0] as { staffProfileId: { toString(): string }; payrollRunId: { $in: unknown[] } };
    expect(q.staffProfileId.toString()).toBe(mine);
    expect(q.payrollRunId.$in.map(String)).toEqual([lockedRun.toString()]);
  });

  test("no locked runs → empty, never even queries payslips (§4.2)", async () => {
    mockRunFind.mockReturnValue(leanChain([])); // no approved_locked run exists
    const res = await payslipsForStaff(oid().toString());
    expect(res).toEqual([]);
    expect(mockPayslipFind).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe("myStaffAttendance — staffAttendanceForRange (own-row + leave overlay)", () => {
  test("scopes the query to MY staffProfileId over the date range, oldest day first", async () => {
    const mine = oid().toString();
    mockAttFind.mockReturnValue(
      leanChain([
        { _id: oid(), staffProfileId: new mongoose.Types.ObjectId(mine), dateKey: "2026-06-12", status: "PRESENT" },
        { _id: oid(), staffProfileId: new mongoose.Types.ObjectId(mine), dateKey: "2026-06-10", status: "LATE" },
      ]),
    );
    mockStaffFindById.mockResolvedValue({ name: "Me", category: "teacher" });
    mockLoadApprovedLeaves.mockResolvedValue([]);

    const res = await staffAttendanceForRange(mine, "2026-06-01", "2026-06-30");

    const q = mockAttFind.mock.calls[0][0] as { staffProfileId: { toString(): string }; dateKey: unknown };
    expect(q.staffProfileId.toString()).toBe(mine);
    expect(q.dateKey).toEqual({ $gte: "2026-06-01", $lte: "2026-06-30" });
    expect(res.map((r) => r.dateKey)).toEqual(["2026-06-10", "2026-06-12"]); // sorted asc
    expect(res.every((r) => r.staffName === "Me")).toBe(true);
    expect(mockLoadApprovedLeaves).toHaveBeenCalledWith([mine], "2026-06-01", "2026-06-30"); // scoped to ME
  });

  test("applies the AT-1 ✘=ABSENT → LEAVE overlay for an approved leave covering the date", async () => {
    const mine = oid().toString();
    mockAttFind.mockReturnValue(
      leanChain([
        { _id: oid(), staffProfileId: new mongoose.Types.ObjectId(mine), dateKey: "2026-06-11", status: "ABSENT" },
        { _id: oid(), staffProfileId: new mongoose.Types.ObjectId(mine), dateKey: "2026-06-13", status: "ABSENT" },
      ]),
    );
    mockStaffFindById.mockResolvedValue({ name: "Me", category: "teacher" });
    // an approved leave covers the 11th only
    mockLoadApprovedLeaves.mockResolvedValue([{ staffProfileId: mine, fromKey: "2026-06-10", toKey: "2026-06-12" }]);

    const res = await staffAttendanceForRange(mine, "2026-06-01", "2026-06-30");
    const byDate = new Map(res.map((r) => [r.dateKey, r.status]));
    expect(byDate.get("2026-06-11")).toBe("LEAVE"); // flipped by the overlay
    expect(byDate.get("2026-06-13")).toBe("ABSENT"); // uncovered → stays ABSENT
  });

  test("no rows → empty (never another person's days)", async () => {
    mockAttFind.mockReturnValue(leanChain([]));
    const res = await staffAttendanceForRange(oid().toString(), "2026-06-01", "2026-06-30");
    expect(res).toEqual([]);
    expect(mockStaffFindById).not.toHaveBeenCalled();
    expect(mockLoadApprovedLeaves).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe("the own-row gate both resolvers rely on (resolveStaffProfileForUser → null ⇒ [])", () => {
  test("no StaffProfile linked to the login → null (resolver returns [], never another person's data)", async () => {
    mockUserFindById.mockResolvedValue({ phone: "1700000000" });
    mockStaffFind.mockResolvedValue([{ _id: oid(), phone: "01999999999" }]); // no phone match
    expect(await resolveStaffProfileForUser(oid().toString())).toBeNull();
  });

  test("FAIL-CLOSED when two staff share the caller's phone (no own-row masquerade, D-#103)", async () => {
    mockUserFindById.mockResolvedValue({ phone: "1700000000" });
    mockStaffFind.mockResolvedValue([
      { _id: oid(), phone: "01700000000" },
      { _id: oid(), phone: "0 1700-000000" },
    ]);
    expect(await resolveStaffProfileForUser(oid().toString())).toBeNull();
  });

  test("a clean single phone match resolves the caller's own StaffProfile", async () => {
    mockUserFindById.mockResolvedValue({ phone: "1700000000" });
    const match = { _id: oid(), phone: "0 1700-000000" };
    mockStaffFind.mockResolvedValue([{ _id: oid(), phone: "01999999999" }, match]);
    expect(await resolveStaffProfileForUser(oid().toString())).toBe(match);
  });
});
