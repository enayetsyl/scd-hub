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
const mockConflictFind = jest.fn();
const mockLeaveById = jest.fn();
const mockUserFind = jest.fn();
const mockClassFind = jest.fn();
const mockSectionFind = jest.fn();
const mockSubjectFind = jest.fn();
const mockGroupFind = jest.fn();
const mockAssignProxy = jest.fn();
const mockRevokeProxy = jest.fn().mockResolvedValue(undefined);
const mockSubUpdate = jest.fn().mockResolvedValue({});
const mockSubDelete = jest.fn().mockResolvedValue({});
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
const mockEmitHrCoverAssigned = jest.fn().mockResolvedValue(undefined);
const mockResolveUserForStaff = jest.fn();

/** A find()-chain stub: .select()/.sort() return self, .lean() resolves the value
 *  (mirrors staffLeave.test.ts's leanChain convention). */
const findChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  // revokeCoversForLeave awaits find() directly (it saves the docs) — no .lean().
  o.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(val).then(res, rej);
  return o;
};

// The cover-vs-cover conflict query (the only slot find with an `$or`) and the
// leave-liveness lookups (a leave find by `_id`) get their own mocks, so the inbox
// and userIdsOnLeave tests keep driving mockSlotFind / mockLeaveFind unchanged.
jest.mock("../modules/hr/models/StaffCoverSlot", () => ({
  StaffCoverSlot: {
    findById: (id: unknown) => mockSlotFindById(id),
    find: (q: Record<string, unknown>) => findChain(q && "$or" in q ? mockConflictFind(q) : mockSlotFind(q)),
    findOne: (q: unknown) => findChain(mockSlotFindOne(q)),
  },
}));
jest.mock("../modules/hr/models/StaffLeaveApplication", () => ({
  StaffLeaveApplication: {
    find: (q: Record<string, unknown>) => findChain(q && "_id" in q ? mockLeaveById(q) : mockLeaveFind(q)),
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
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: {
    updateOne: (f: unknown, u: unknown, o: unknown) => mockSubUpdate(f, u, o),
    deleteOne: (f: unknown) => mockSubDelete(f),
  },
}));
jest.mock("../modules/routine/services/RoutineSlotService", () => ({
  onRoutineTeachersChanged: jest.fn(),
  slotsForTeacherOnDate: jest.fn(async () => []),
}));
jest.mock("../modules/hr/services/staffMatch", () => ({
  resolveUserIdForStaff: (id: unknown) => mockResolveUserForStaff(id),
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

import {
  decideCoverSlot,
  needsCoverSlots,
  proposeCover,
  revokeCoversForLeave,
  userIdsOnLeave,
} from "../modules/hr/services/CoverService";
import { LeaveError } from "../modules/hr/services/dates";

const ACTOR = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockSlotFindOne.mockResolvedValue(null);
  mockConflictFind.mockResolvedValue([]); // no conflicting cover by default
  mockLeaveById.mockResolvedValue([{ _id: oid() }]); // every leave looked up by id is live by default
  mockGroupFind.mockResolvedValue([]);
  mockLeaveFind.mockResolvedValue([]); // userIdsOnLeave → nobody on leave by default
  mockResolveUserForStaff.mockResolvedValue(null);
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
    routineSlotId: oid(),
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
    mockConflictFind.mockResolvedValue([{ leaveApplicationId: oid() }]); // a conflicting proposed/approved slot exists

    await expect(proposeCover(slot._id.toString(), teacher.toString(), ACTOR)).rejects.toThrow(LeaveError);
    const queryArg = mockConflictFind.mock.calls[0][0] as Record<string, unknown>;
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
    mockConflictFind.mockResolvedValue([]); // the earlier slot has since been rejected

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

  test("approving a section cover ALSO upserts a RoutineSubstitution (owner 2026-07-26 bug)", async () => {
    const override = oid();
    const slot = baseSlot({ proposedCoverTeacherId: null, status: "needs_cover" });
    mockSlotFindById.mockResolvedValue(slot);
    mockAssignProxy.mockResolvedValue(oid().toString());

    await decideCoverSlot(slot._id.toString(), true, ACTOR, override.toString());

    // The class-note / homework gates key off RoutineSubstitution, not the proxy grant.
    expect(mockSubUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ slotId: slot.routineSlotId, coverTeacherId: expect.anything() }),
      expect.anything(),
      expect.objectContaining({ upsert: true }),
    );
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
    mockConflictFind.mockResolvedValue([{ leaveApplicationId: oid() }]); // a conflicting approved cover exists

    await expect(decideCoverSlot(slot._id.toString(), true, ACTOR)).rejects.toThrow(LeaveError);
    const queryArg = mockConflictFind.mock.calls[0][0] as Record<string, unknown>;
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
    mockConflictFind.mockResolvedValue([{ leaveApplicationId: oid() }]); // another leave's slot still has this teacher pending

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

  test("rejects approving a cover for a teacher who is THEMSELVES on leave that day", async () => {
    const cover = oid();
    const slot = baseSlot({ proposedCoverTeacherId: cover, status: "proposed", dateKey: "2026-06-14" });
    mockSlotFindById.mockResolvedValue(slot);
    // userIdsOnLeave("2026-06-14") → { cover }: an approved/applied leave resolves to this teacher.
    mockLeaveFind.mockResolvedValue([{ staffProfileId: oid() }]);
    mockResolveUserForStaff.mockResolvedValue(cover.toString());

    await expect(decideCoverSlot(slot._id.toString(), true, ACTOR)).rejects.toThrow(/on leave/i);
    expect(mockAssignProxy).not.toHaveBeenCalled();
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

  test("a subjectgroup cover ALSO upserts a RoutineSubstitution (owner report 2026-08-03)", async () => {
    // The regression this file previously missed: the substitution write sat INSIDE
    // the section-only branch, so a Quran/Arabic cover recorded a StaffCoverSlot and
    // nothing else. The class-note report kept naming the ABSENT teacher, and
    // publishClassNote — whose cover gate reads RoutineSubstitution — refused the
    // covering teacher outright. Only the proxy GRANT is section-only.
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

    await decideCoverSlot(slot._id.toString(), true, ACTOR);

    expect(mockSubUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, opts] = mockSubUpdate.mock.calls[0] as [
      { slotId: unknown; coverTeacherId: { toString(): string } },
      { $set: { proxyGrantId: unknown } },
      { upsert: boolean },
    ];
    expect(filter.slotId).toEqual(slot.routineSlotId);
    expect(filter.coverTeacherId.toString()).toBe(cover.toString());
    expect(opts.upsert).toBe(true);
    // Recorded, but no scope granted — a subjectgroup has none to give.
    expect(update.$set.proxyGrantId).toBeNull();
    expect(mockAssignProxy).not.toHaveBeenCalled();
  });
});

describe("cancelled/rejected leaves stop reserving cover teachers (owner report 2026-10-04)", () => {
  // Hamida's leave for 10-04 was applied three times; the first two were cancelled.
  // Jasi, still "proposed" on a cancelled copy, could not be assigned Nursery P1 on
  // the live one — "already covers (or is proposed for) another class".
  test("a proposed/approved slot on a CANCELLED leave does not block assigning the teacher", async () => {
    const jasi = oid();
    const slot = baseSlot({ status: "needs_cover", dateKey: "2026-10-04", periodNumber: 1 });
    mockSlotFindById.mockResolvedValue(slot);
    mockAssignProxy.mockResolvedValue(oid().toString());
    mockConflictFind.mockResolvedValue([{ leaveApplicationId: oid() }]); // the stale slot
    mockLeaveById.mockImplementation(async (q: { _id: unknown }) =>
      // assertLeaveLive(slot) finds this slot's own leave; the stale slot's leave is dead.
      q._id === slot.leaveApplicationId ? [{ _id: slot.leaveApplicationId }] : [],
    );

    const res = await decideCoverSlot(slot._id.toString(), true, ACTOR, jasi.toString());
    expect(res.status).toBe("approved");
    expect(res.finalCoverTeacherUserId!.toString()).toBe(jasi.toString());
    // The liveness lookup asks only for applied/approved leaves.
    expect(mockLeaveById).toHaveBeenCalledWith(
      expect.objectContaining({ status: { $in: ["applied", "approved"] } }),
    );
  });

  test("a reservation on a LIVE leave still blocks", async () => {
    const slot = baseSlot({ status: "needs_cover" });
    mockSlotFindById.mockResolvedValue(slot);
    mockConflictFind.mockResolvedValue([{ leaveApplicationId: oid() }]);
    // default mockLeaveById: every leave is live

    await expect(proposeCover(slot._id.toString(), oid().toString(), ACTOR)).rejects.toThrow(/already proposed/);
  });

  test("proposing or approving on a cancelled leave's own slot is refused", async () => {
    const slot = baseSlot({ status: "needs_cover" });
    mockSlotFindById.mockResolvedValue(slot);
    mockLeaveById.mockResolvedValue([]); // this slot's leave is cancelled

    await expect(proposeCover(slot._id.toString(), oid().toString(), ACTOR)).rejects.toThrow(/cancelled or rejected/);
    await expect(decideCoverSlot(slot._id.toString(), true, ACTOR, oid().toString())).rejects.toThrow(
      /cancelled or rejected/,
    );
    expect(slot.save).not.toHaveBeenCalled();
    expect(mockAssignProxy).not.toHaveBeenCalled();
  });
});

describe("revokeCoversForLeave — releases proposed AND approved slots", () => {
  test("resets proposed slots, revokes grants, and drops the approved cover's RoutineSubstitution", async () => {
    const eshita = oid(), jasi = oid(), grant = oid();
    const approved = baseSlot({ status: "approved", finalCoverTeacherUserId: eshita, proxyGrantId: grant, dateKey: "2026-10-04" });
    const proposed = baseSlot({ status: "proposed", proposedCoverTeacherId: jasi, dateKey: "2026-10-04" });
    // first find = the leave's slots; the second = "is anyone else live on this meeting?" → no
    mockSlotFind.mockReturnValueOnce([approved, proposed]).mockReturnValueOnce([]);

    const revoked = await revokeCoversForLeave(oid().toString(), ACTOR);

    expect(mockSlotFind.mock.calls[0][0]).toMatchObject({ status: { $in: ["proposed", "approved"] } });
    expect(revoked).toBe(1);
    expect(mockRevokeProxy).toHaveBeenCalledWith(grant.toString(), ACTOR);
    expect(approved.status).toBe("needs_cover");
    expect(proposed.status).toBe("needs_cover");
    expect(mockSubDelete).toHaveBeenCalledTimes(1);
    expect(mockSubDelete).toHaveBeenCalledWith(
      expect.objectContaining({ slotId: approved.routineSlotId, coverTeacherId: eshita }),
    );
  });

  test("keeps the RoutineSubstitution when a LIVE leave's approved slot shares it", async () => {
    const eshita = oid();
    const approved = baseSlot({ status: "approved", finalCoverTeacherUserId: eshita });
    mockSlotFind.mockReturnValueOnce([approved]).mockReturnValueOnce([{ leaveApplicationId: oid() }]);
    // default mockLeaveById: that other leave is live

    await revokeCoversForLeave(oid().toString(), ACTOR);
    expect(approved.status).toBe("needs_cover");
    expect(mockSubDelete).not.toHaveBeenCalled();
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

describe("userIdsOnLeave — who is out that day (D-#268)", () => {
  test("resolves applied|approved leaves overlapping the date to their User ids", async () => {
    const p1 = oid(), p2 = oid(), u1 = oid(), u2 = oid();
    mockLeaveFind.mockResolvedValue([{ staffProfileId: p1 }, { staffProfileId: p2 }]);
    mockResolveUserForStaff.mockImplementation(async (id: string) =>
      id === p1.toString() ? u1.toString() : u2.toString(),
    );

    const ids = await userIdsOnLeave("2026-06-14");
    expect([...ids].sort()).toEqual([u1.toString(), u2.toString()].sort());
    // both "applied" and "approved" count as out (conservative — user's choice).
    expect(mockLeaveFind.mock.calls[0][0]).toMatchObject({ status: { $in: ["applied", "approved"] } });
  });

  test("skips a leave whose staff has no linked login (resolve → null)", async () => {
    mockLeaveFind.mockResolvedValue([{ staffProfileId: oid() }]);
    mockResolveUserForStaff.mockResolvedValue(null);
    expect((await userIdsOnLeave("2026-06-14")).size).toBe(0);
  });

  test("empty when nobody is on leave", async () => {
    mockLeaveFind.mockResolvedValue([]);
    expect((await userIdsOnLeave("2026-06-14")).size).toBe(0);
  });

  test("a PARTIAL day only rules the teacher out of the periods it covers (D-#361)", async () => {
    const p1 = oid(), u1 = oid();
    mockLeaveFind.mockResolvedValue([{ staffProfileId: p1, dayPart: "late_entry", partialPeriods: [1, 2] }]);
    mockResolveUserForStaff.mockResolvedValue(u1.toString());

    expect((await userIdsOnLeave("2026-06-14", 2)).has(u1.toString())).toBe(true); // inside the window
    expect((await userIdsOnLeave("2026-06-14", 6)).size).toBe(0); // back at school by period 6
    // With no period in hand the caller gets the conservative answer: treat them as out.
    expect((await userIdsOnLeave("2026-06-14")).has(u1.toString())).toBe(true);
  });

  test("a FULL-day leave is out for every period, with or without one named", async () => {
    const p1 = oid(), u1 = oid();
    mockLeaveFind.mockResolvedValue([{ staffProfileId: p1, dayPart: "full", partialPeriods: [] }]);
    mockResolveUserForStaff.mockResolvedValue(u1.toString());
    expect((await userIdsOnLeave("2026-06-14", 6)).has(u1.toString())).toBe(true);
    expect((await userIdsOnLeave("2026-06-14")).has(u1.toString())).toBe(true);
  });
});
