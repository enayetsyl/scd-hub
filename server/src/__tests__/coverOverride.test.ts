/**
 * PXG-1 (D-#268) — decideCoverSlot override/direct-assign, needsCoverSlots inbox,
 * teacherAvailability's widened gate, and the HR-side COVER_ASSIGNED emit.
 * DB-free (the repo's test convention), mirroring staffLeave.test.ts's mock style.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockSlotFindById = jest.fn();
const mockSlotFind = jest.fn();
const mockSlotFindOne = jest.fn();
const mockLeaveFind = jest.fn();
const mockUserFind = jest.fn();
const mockClassFind = jest.fn();
const mockSectionFind = jest.fn();
const mockSubjectFind = jest.fn();
const mockAssignProxy = jest.fn();
const mockRevokeProxy = jest.fn().mockResolvedValue(undefined);
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
const mockEmitHrCoverAssigned = jest.fn().mockResolvedValue(undefined);

/** A find()-chain stub: .select()/.sort() return self, .lean() resolves the value
 *  (mirrors staffLeave.test.ts's leanChain convention). */
const findChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

jest.mock("../modules/hr/models/StaffCoverSlot", () => ({
  StaffCoverSlot: {
    findById: (id: unknown) => mockSlotFindById(id),
    find: (q: unknown) => findChain(mockSlotFind(q)),
    findOne: (q: unknown) => findChain(mockSlotFindOne(q)),
  },
}));
jest.mock("../modules/hr/models/StaffLeaveApplication", () => ({
  StaffLeaveApplication: {
    find: (q: unknown) => findChain(mockLeaveFind(q)),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => findChain(mockUserFind(q)) },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (q: unknown) => findChain(mockClassFind(q)) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (q: unknown) => findChain(mockSectionFind(q)) },
}));
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { find: (q: unknown) => findChain(mockSubjectFind(q)) },
}));
jest.mock("../modules/routine/services/RoutineSlotService", () => ({
  slotsForTeacherOnDate: jest.fn(async () => []),
}));
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: jest.fn(async () => "FULL"),
}));
jest.mock("../modules/foundation/services/ScopeGrantService", () => ({
  assignProxy: (i: unknown) => mockAssignProxy(i),
  revokeProxy: (id: unknown, by: unknown) => mockRevokeProxy(id, by),
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitHrCoverAssigned: (e: unknown) => mockEmitHrCoverAssigned(e),
}));

import { decideCoverSlot, needsCoverSlots } from "../modules/hr/services/CoverService";
import { LeaveError } from "../modules/hr/services/dates";

const ACTOR = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockSlotFindOne.mockResolvedValue(null); // no conflicting cover by default
});

function baseSlot(over: Record<string, unknown> = {}) {
  const slot: any = {
    _id: oid(),
    leaveApplicationId: oid(),
    classId: oid(),
    sectionId: oid(),
    subjectId: oid(),
    absentTeacherUserId: oid(),
    proposedCoverTeacherId: null,
    finalCoverTeacherUserId: null,
    status: "needs_cover",
    proxyGrantId: null,
    dateKey: "2026-06-14",
    periodNumber: 2,
    ...over,
  };
  slot.save = jest.fn().mockResolvedValue(slot);
  return slot;
}

describe("decideCoverSlot — override + direct-assign (D-#268)", () => {
  test("override on a proposed slot mints for the OVERRIDE teacher, not the proposer's pick", async () => {
    const proposer = oid(), override = oid();
    const slot = baseSlot({ proposedCoverTeacherId: proposer, status: "proposed" });
    mockSlotFindById.mockResolvedValue(slot);
    mockAssignProxy.mockResolvedValue(oid().toString());

    const res = await decideCoverSlot(slot._id.toString(), true, ACTOR, override.toString());

    expect(mockAssignProxy).toHaveBeenCalledWith(
      expect.objectContaining({ coveringTeacherId: override.toString() }),
    );
    expect(res.proposedCoverTeacherId!.toString()).toBe(proposer.toString()); // historical proposal kept
    expect(res.finalCoverTeacherUserId!.toString()).toBe(override.toString()); // actual cover
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          override: true,
          proposedCoverTeacherId: proposer.toString(),
          finalCoverTeacherUserId: override.toString(),
        }),
      }),
    );
  });

  test("direct-assign on a needs_cover slot (no proposal) succeeds with an override", async () => {
    const override = oid();
    const slot = baseSlot({ proposedCoverTeacherId: null, status: "needs_cover" });
    mockSlotFindById.mockResolvedValue(slot);
    mockAssignProxy.mockResolvedValue(oid().toString());

    const res = await decideCoverSlot(slot._id.toString(), true, ACTOR, override.toString());
    expect(res.status).toBe("approved");
    expect(res.finalCoverTeacherUserId!.toString()).toBe(override.toString());
  });

  test("approve with neither a proposal nor an override is still rejected", async () => {
    const slot = baseSlot({ proposedCoverTeacherId: null, status: "needs_cover" });
    mockSlotFindById.mockResolvedValue(slot);
    await expect(decideCoverSlot(slot._id.toString(), true, ACTOR)).rejects.toThrow(LeaveError);
    expect(mockAssignProxy).not.toHaveBeenCalled();
  });

  test("reject is unaffected by the override param (ignored on the reject path)", async () => {
    const grantId = oid();
    const slot = baseSlot({ status: "approved", proxyGrantId: grantId });
    mockSlotFindById.mockResolvedValue(slot);
    const res = await decideCoverSlot(slot._id.toString(), false, ACTOR, oid().toString());
    expect(res.status).toBe("needs_cover");
    expect(mockRevokeProxy).toHaveBeenCalledWith(grantId.toString(), ACTOR);
  });

  test("re-approving an already-approved slot is idempotent (no double mint)", async () => {
    const slot = baseSlot({ status: "approved", proposedCoverTeacherId: oid() });
    mockSlotFindById.mockResolvedValue(slot);
    const res = await decideCoverSlot(slot._id.toString(), true, ACTOR, oid().toString());
    expect(res).toBe(slot);
    expect(mockAssignProxy).not.toHaveBeenCalled();
  });

  test("rejects approving when the teacher already covers another slot at the same (date, period)", async () => {
    const cover = oid();
    const slot = baseSlot({ proposedCoverTeacherId: cover, status: "proposed", dateKey: "2026-06-14", periodNumber: 2 });
    mockSlotFindById.mockResolvedValue(slot);
    mockSlotFindOne.mockResolvedValue({ _id: oid() }); // a conflicting approved cover exists

    await expect(decideCoverSlot(slot._id.toString(), true, ACTOR)).rejects.toThrow(LeaveError);
    const queryArg = mockSlotFindOne.mock.calls[0][0] as Record<string, unknown>;
    expect((queryArg.finalCoverTeacherUserId as { toString(): string }).toString()).toBe(cover.toString());
    expect(queryArg).toMatchObject({ dateKey: "2026-06-14", periodNumber: 2, status: "approved" });
    expect(mockAssignProxy).not.toHaveBeenCalled();
  });

  test("emitHrCoverAssigned fires once, correct recipient, per approval", async () => {
    const cover = oid();
    const slot = baseSlot({ proposedCoverTeacherId: cover, status: "proposed" });
    mockSlotFindById.mockResolvedValue(slot);
    const grantId = oid().toString();
    mockAssignProxy.mockResolvedValue(grantId);

    await decideCoverSlot(slot._id.toString(), true, ACTOR);
    expect(mockEmitHrCoverAssigned).toHaveBeenCalledTimes(1);
    expect(mockEmitHrCoverAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ slotId: slot._id.toString(), grantId, coverTeacherUserId: cover.toString(), dateKey: "2026-06-14" }),
    );
  });
});

describe("needsCoverSlots — cross-leave inbox range/status filtering", () => {
  test("empty when no approved leave overlaps the range", async () => {
    mockLeaveFind.mockResolvedValue([]);
    const rows = await needsCoverSlots("2026-06-10", "2026-06-17");
    expect(rows).toEqual([]);
    expect(mockSlotFind).not.toHaveBeenCalled();
  });

  test("only needs_cover slots from approved, overlapping leaves are returned, with resolved labels", async () => {
    const leaveId = oid();
    mockLeaveFind.mockResolvedValue([{ _id: leaveId }]);
    const absent = oid(), cls = oid(), sec = oid(), subj = oid();
    mockSlotFind.mockResolvedValue([
      {
        _id: oid(), leaveApplicationId: leaveId, absentTeacherUserId: absent,
        classId: cls, sectionId: sec, subjectId: subj, dateKey: "2026-06-14", periodNumber: 2,
      },
    ]);
    mockUserFind.mockResolvedValue([{ _id: absent, name: "করিম" }]);
    mockClassFind.mockResolvedValue([{ _id: cls, nameBn: "৫ম শ্রেণি" }]);
    mockSectionFind.mockResolvedValue([{ _id: sec, nameBn: "ক" }]);
    mockSubjectFind.mockResolvedValue([{ _id: subj, nameBn: "গণিত" }]);

    const rows = await needsCoverSlots("2026-06-10", "2026-06-17");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      absentTeacherName: "করিম", className: "৫ম শ্রেণি", sectionName: "ক", subjectName: "গণিত",
      dateKey: "2026-06-14", periodNumber: 2,
    });
    // needs_cover alone covers both "never proposed" and "rejected-back" — confirm the filter used.
    expect(mockSlotFind.mock.calls[0][0]).toMatchObject({ status: "needs_cover" });
  });
});
