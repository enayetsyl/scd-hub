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
const mockGroupFind = jest.fn();
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
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: (q: unknown) => findChain(mockGroupFind(q)) },
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

import { decideCoverSlot, needsCoverSlots, proposeCover } from "../modules/hr/services/CoverService";
import { LeaveError } from "../modules/hr/services/dates";

const ACTOR = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockSlotFindOne.mockResolvedValue(null); // no conflicting cover by default
  mockGroupFind.mockResolvedValue([]);
});

function baseSlot(over: Record<string, unknown> = {}) {
  const slot: any = {
    _id: oid(),
    leaveApplicationId: oid(),
    groupType: "section",
    classId: oid(),
    sectionId: oid(),
    subjectId: oid(),
    subjectGroupId: null,
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

describe("proposeCover — blocks proposing an already-reserved teacher (D-#268)", () => {
  test("succeeds and records the proposal when no conflict exists", async () => {
    const teacher = oid();
    const slot = baseSlot({ status: "needs_cover" });
    mockSlotFindById.mockResolvedValue(slot);

    const res = await proposeCover(slot._id.toString(), teacher.toString(), ACTOR);
    expect(res.status).toBe("proposed");
    expect(res.proposedCoverTeacherId!.toString()).toBe(teacher.toString());
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "STAFF_COVER_PROPOSED" }));
  });

  test("rejects proposing a teacher already proposed/approved elsewhere at the same (date, period)", async () => {
    const teacher = oid();
    const slot = baseSlot({ status: "needs_cover", dateKey: "2026-06-14", periodNumber: 2 });
    mockSlotFindById.mockResolvedValue(slot);
    mockSlotFindOne.mockResolvedValue({ _id: oid() }); // a conflicting proposed/approved slot exists

    await expect(proposeCover(slot._id.toString(), teacher.toString(), ACTOR)).rejects.toThrow(LeaveError);
    const queryArg = mockSlotFindOne.mock.calls[0][0] as Record<string, unknown>;
    expect(queryArg).toMatchObject({
      dateKey: "2026-06-14",
      periodNumber: 2,
      status: { $in: ["proposed", "approved"] },
    });
    expect(slot.status).toBe("needs_cover"); // unchanged — the proposal never took
  });

  test("frees up once the earlier conflicting slot is rejected (no conflict found afterward)", async () => {
    const teacher = oid();
    const slot = baseSlot({ status: "needs_cover" });
    mockSlotFindById.mockResolvedValue(slot);
    mockSlotFindOne.mockResolvedValue(null); // the earlier slot has since been rejected

    const res = await proposeCover(slot._id.toString(), teacher.toString(), ACTOR);
    expect(res.status).toBe("proposed");
  });
});

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
    expect(queryArg).toMatchObject({
      dateKey: "2026-06-14",
      periodNumber: 2,
      status: { $in: ["proposed", "approved"] },
    });
    expect(mockAssignProxy).not.toHaveBeenCalled();
  });

  test("rejects approving when the teacher is only PROPOSED (not yet approved) elsewhere at the same (date, period)", async () => {
    const cover = oid();
    const slot = baseSlot({ proposedCoverTeacherId: cover, status: "proposed", dateKey: "2026-06-14", periodNumber: 2 });
    mockSlotFindById.mockResolvedValue(slot);
    mockSlotFindOne.mockResolvedValue({ _id: oid() }); // another leave's slot still has this teacher pending

    await expect(decideCoverSlot(slot._id.toString(), true, ACTOR)).rejects.toThrow(
      /already covers \(or is proposed for\)/,
    );
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

  test("a subjectgroup (Quran/Arabic) slot is RECORDED on approval but mints NO proxy grant", async () => {
    const cover = oid();
    const slot = baseSlot({
      groupType: "subjectgroup",
      classId: null,
      sectionId: null,
      subjectId: null,
      subjectGroupId: oid(),
      proposedCoverTeacherId: cover,
      status: "proposed",
    });
    mockSlotFindById.mockResolvedValue(slot);

    const res = await decideCoverSlot(slot._id.toString(), true, ACTOR);
    expect(res.status).toBe("approved");
    expect(res.finalCoverTeacherUserId!.toString()).toBe(cover.toString());
    expect(res.proxyGrantId).toBeNull(); // record-only, no scope granted
    expect(mockAssignProxy).not.toHaveBeenCalled();
    // still notified — dedupe key falls back to slotId when there's no grant.
    expect(mockEmitHrCoverAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ coverTeacherUserId: cover.toString(), grantId: slot._id.toString() }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ groupType: "subjectgroup", proxyGrantId: null }) }),
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

  test("resolves labels for a section row AND a subjectgroup (Quran/Arabic) row", async () => {
    const leaveId = oid();
    mockLeaveFind.mockResolvedValue([{ _id: leaveId }]);
    const absent = oid(), cls = oid(), sec = oid(), subj = oid(), grp = oid();
    mockSlotFind.mockResolvedValue([
      {
        _id: oid(), leaveApplicationId: leaveId, groupType: "section", absentTeacherUserId: absent,
        classId: cls, sectionId: sec, subjectId: subj, subjectGroupId: null, dateKey: "2026-06-14", periodNumber: 2,
      },
      {
        _id: oid(), leaveApplicationId: leaveId, groupType: "subjectgroup", absentTeacherUserId: absent,
        classId: null, sectionId: null, subjectId: null, subjectGroupId: grp, dateKey: "2026-06-14", periodNumber: 3,
      },
    ]);
    mockUserFind.mockResolvedValue([{ _id: absent, name: "করিম" }]);
    mockClassFind.mockResolvedValue([{ _id: cls, nameBn: "৫ম শ্রেণি" }]);
    mockSectionFind.mockResolvedValue([{ _id: sec, nameBn: "ক" }]);
    mockSubjectFind.mockResolvedValue([{ _id: subj, nameBn: "গণিত" }]);
    mockGroupFind.mockResolvedValue([{ _id: grp, nameBn: "কায়দা" }]);

    const rows = await needsCoverSlots("2026-06-10", "2026-06-17");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      groupType: "section", absentTeacherName: "করিম", className: "৫ম শ্রেণি", sectionName: "ক",
      subjectName: "গণিত", subjectGroupName: null,
    });
    expect(rows[1]).toMatchObject({
      groupType: "subjectgroup", className: null, sectionName: null, subjectName: null,
      subjectGroupName: "কায়দা", periodNumber: 3,
    });
    // needs_cover alone covers both "never proposed" and "rejected-back" — confirm the filter used.
    expect(mockSlotFind.mock.calls[0][0]).toMatchObject({ status: "needs_cover" });
  });
});
