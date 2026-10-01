/**
 * Leave covers follow the timetable (owner report 2026-10-01): a cover row planned against
 * a routine slot that is later retired (the C4/C5 split) must not linger on the old period.
 *
 * reconcileCoversForTeacher — DB-free, mocked models. The fan-out is exercised with every
 * leave day OFF so it creates nothing; the moved-approval path goes through decideCoverSlot
 * and was exercised against prod data by the 2026-10-01 repair (same logic).
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockResolveStaffForUser = jest.fn();
const mockLeaveFind = jest.fn();
const mockLeaveFindById = jest.fn();
const mockCoverFind = jest.fn();
const mockCoverFindOne = jest.fn();
const mockCoverDeleteOne = jest.fn();
const mockRoutineSlotFind = jest.fn();
const mockWriteAudit = jest.fn();
const mockListenerRegistered = jest.fn();

jest.mock("../modules/hr/services/staffMatch", () => ({
  resolveStaffProfileForUser: (u: unknown) => mockResolveStaffForUser(u),
  resolveUserIdForStaff: async () => "absent-user",
}));
jest.mock("../modules/hr/models/StaffLeaveApplication", () => ({
  StaffLeaveApplication: {
    find: (q: unknown) => ({ select: () => ({ lean: () => mockLeaveFind(q) }) }),
    findById: (id: unknown) => ({ lean: () => mockLeaveFindById(id) }),
  },
}));
jest.mock("../modules/hr/models/StaffCoverSlot", () => ({
  StaffCoverSlot: {
    find: (q: unknown) => ({ lean: () => mockCoverFind(q) }),
    findOne: (q: unknown) => ({ lean: () => mockCoverFindOne(q), select: () => ({ lean: () => mockCoverFindOne(q) }) }),
    deleteOne: (q: unknown) => mockCoverDeleteOne(q),
    create: jest.fn(),
    findById: jest.fn(),
  },
}));
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (q: unknown) => ({ select: () => ({ lean: () => mockRoutineSlotFind(q) }) }) },
}));
jest.mock("../modules/routine/services/RoutineSlotService", () => ({
  slotsForTeacherOnDate: async () => [],
  onRoutineTeachersChanged: (fn: unknown) => mockListenerRegistered(fn),
}));
jest.mock("../modules/routine/calendar", () => ({ resolveDayType: async () => "OFF" }));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: (p: unknown) => mockWriteAudit(p) }));
jest.mock("../modules/foundation/services/ScopeGrantService", () => ({ assignProxy: jest.fn(), revokeProxy: jest.fn() }));
jest.mock("../modules/notifications/services/emitters", () => ({ emitHrCoverAssigned: jest.fn() }));
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({ RoutineSubstitution: { deleteOne: jest.fn(), updateOne: jest.fn() } }));

import { reconcileCoversForTeacher } from "../modules/hr/services/CoverService";

const STAFF = { _id: oid() };
const LEAVE = { _id: oid(), fromKey: "2026-10-01", toKey: "2026-10-01", status: "approved" };
const RETIRED = oid();
const LIVE = oid();

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveStaffForUser.mockResolvedValue(STAFF);
  mockLeaveFind.mockResolvedValue([{ _id: LEAVE._id }]);
  mockLeaveFindById.mockResolvedValue(LEAVE);
  mockRoutineSlotFind.mockResolvedValue([
    { _id: RETIRED, effectiveTo: new Date(2026, 8, 30, 23, 59, 59) },
    { _id: LIVE, effectiveTo: null },
  ]);
  mockCoverFindOne.mockResolvedValue(null);
});

describe("reconcileCoversForTeacher", () => {
  test("registers itself as a routine-change listener when the module loads", () => {
    jest.isolateModules(() => {
      require("../modules/hr/services/CoverService");
    });
    expect(mockListenerRegistered).toHaveBeenCalledWith(expect.any(Function));
  });

  test("an UNAPPROVED row on a retired slot is deleted; a row on a live slot is kept", async () => {
    const stale = { _id: oid(), routineSlotId: RETIRED, dateKey: "2026-10-01", periodNumber: 5, status: "needs_cover" };
    const ok = { _id: oid(), routineSlotId: LIVE, dateKey: "2026-10-01", periodNumber: 5, status: "needs_cover" };
    mockCoverFind.mockResolvedValue([stale, ok]);
    const res = await reconcileCoversForTeacher("teacher-user", "2026-10-01", "actor");
    expect(res.removed).toBe(1);
    expect(mockCoverDeleteOne).toHaveBeenCalledWith({ _id: stale._id });
    expect(mockCoverDeleteOne).not.toHaveBeenCalledWith({ _id: ok._id });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ decision: "reconciled_after_routine_change", removed: 1 }) }),
    );
  });

  test("an APPROVED row on a retired slot with no replacement yet is KEPT (a split retires before it creates)", async () => {
    const approved = {
      _id: oid(), routineSlotId: RETIRED, dateKey: "2026-10-01", periodNumber: 5, status: "approved", finalCoverTeacherUserId: oid(),
    };
    mockCoverFind.mockResolvedValue([approved]);
    const res = await reconcileCoversForTeacher("teacher-user", "2026-10-01", "actor");
    expect(res).toEqual({ created: 0, moved: 0, removed: 0 });
    expect(mockCoverDeleteOne).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("a teacher with no staff profile / no live leave is a no-op", async () => {
    mockResolveStaffForUser.mockResolvedValueOnce(null);
    expect(await reconcileCoversForTeacher("nobody", "2026-10-01", "actor")).toEqual({ created: 0, moved: 0, removed: 0 });
    mockLeaveFind.mockResolvedValueOnce([]);
    expect(await reconcileCoversForTeacher("teacher-user", "2026-10-01", "actor")).toEqual({ created: 0, moved: 0, removed: 0 });
    expect(mockCoverFind).not.toHaveBeenCalled();
  });
});
