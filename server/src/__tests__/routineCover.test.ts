/**
 * Routine R-4 tests — cover/substitution + proxy-manage availability.
 *
 * R4.1 — rankAvailability (free-first, lightest-load-next) + teacherAvailability
 * R4.2 — assignCover: Section slot backs a proxy grant; SubjectGroup slot does not
 * R4.3 — cancelCover: deactivates + revokes the proxy grant
 *
 * DB-free: models + ScopeGrantService mocked; ranking is pure.
 */
import mongoose from "mongoose";
import { rankAvailability } from "../modules/routine/cover";

const oid = () => new mongoose.Types.ObjectId();

const mockSlotFindById = jest.fn();
const mockSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    findById: (id: unknown) => ({ lean: () => mockSlotFindById(id) }),
    find: (q: unknown) => ({ lean: () => mockSlotFind(q) }),
  },
}));

const mockSubCreate = jest.fn();
const mockSubUpdateOne = jest.fn();
const mockSubFindById = jest.fn();
const mockSubFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: {
    create: (d: unknown) => mockSubCreate(d),
    updateOne: (f: unknown, u: unknown) => mockSubUpdateOne(f, u),
    findById: (id: unknown) => ({ lean: () => mockSubFindById(id) }),
    find: (q: unknown) => ({ sort: () => ({ lean: () => mockSubFind(q) }), lean: () => mockSubFind(q) }),
  },
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => ({ select: () => ({ lean: () => mockUserFind(q) }) }) },
}));

// HR leave-cover slots (PXG-1) — teacherAvailability must also treat an already
// APPROVED cover assignment as busy at that period (D-#268 live-testing find).
const mockCoverSlotFind = jest.fn();
jest.mock("../modules/hr/models/StaffCoverSlot", () => ({
  StaffCoverSlot: { find: (q: unknown) => ({ select: () => ({ lean: () => mockCoverSlotFind(q) }) }) },
}));

// assignCover resolves the covered slot's subject → Subject._id for the proxy grant (D-#257).
const mockSubjectFindOne = jest.fn();
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { findOne: (q: unknown) => ({ select: () => ({ lean: () => mockSubjectFindOne(q) }) }) },
}));

const mockAssignProxy = jest.fn();
const mockRevokeProxy = jest.fn();
jest.mock("../modules/foundation/services/ScopeGrantService", () => ({
  assignProxy: (i: unknown) => mockAssignProxy(i),
  revokeProxy: (id: unknown, by: unknown) => mockRevokeProxy(id, by),
}));

// Notification emitters (N-1, D-#72) — mocked: the host-side call is under test
// here; the emitter internals are covered in notifications.test.ts.
const mockEmitCoverAssigned = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/notifications/services/emitters", () => ({
  emitCoverAssigned: (...args: unknown[]) => mockEmitCoverAssigned(...args),
}));

import { teacherAvailability, assignCover, cancelCover } from "../modules/routine/services/RoutineCoverService";

const DATE = new Date(2026, 5, 2, 9, 0, 0); // a Tuesday in June 2026

beforeEach(() => {
  jest.clearAllMocks();
  mockSubFind.mockResolvedValue([]);
  mockSubCreate.mockResolvedValue({ _id: oid() });
  mockAssignProxy.mockResolvedValue(oid().toString());
  mockSubjectFindOne.mockResolvedValue({ _id: oid() });
  mockCoverSlotFind.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// R4.1 — rankAvailability (pure)
// ---------------------------------------------------------------------------
describe("R4.1 rankAvailability", () => {
  test("free teachers first, then ascending class count", () => {
    const teachers = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ];
    const ranked = rankAvailability(teachers, new Set(["a"]), { a: 2, b: 3, c: 1 });
    // a is busy → last; among free {b,c}, c (load 1) before b (load 3)
    expect(ranked.map((r) => r.teacherId)).toEqual(["c", "b", "a"]);
    expect(ranked[0]).toMatchObject({ teacherId: "c", free: true, classCount: 1 });
    expect(ranked[2]).toMatchObject({ teacherId: "a", free: false, classCount: 2 });
  });
});

describe("R4.1 teacherAvailability", () => {
  test("marks busy at the target period + counts each teacher's day load", async () => {
    const TA = oid(), TB = oid(), TC = oid();
    const s1 = oid(), s2 = oid(), s3 = oid();
    mockSlotFind.mockResolvedValue([
      { _id: s1, teacherId: TA, periodNumber: 1 },
      { _id: s2, teacherId: TA, periodNumber: 2 },
      { _id: s3, teacherId: TB, periodNumber: 1 },
    ]);
    mockUserFind.mockResolvedValue([
      { _id: TA, name: "A" },
      { _id: TB, name: "B" },
      { _id: TC, name: "C" },
    ]);
    const rows = await teacherAvailability(DATE, 1);
    // TC is free (no slots) → first; TB (load 1) before TA (load 2); both busy at P1
    expect(rows.map((r) => r.teacherId)).toEqual([TC.toString(), TB.toString(), TA.toString()]);
    expect(rows[0]).toMatchObject({ free: true, classCount: 0 });
    expect(rows.find((r) => r.teacherId === TA.toString())).toMatchObject({ free: false, classCount: 2 });
  });

  test("an approved HR leave-cover slot (PXG-1) also marks its teacher busy at that period (D-#268)", async () => {
    const TA = oid(), TB = oid();
    mockSlotFind.mockResolvedValue([]); // no substantive teaching that day
    mockUserFind.mockResolvedValue([
      { _id: TA, name: "A" },
      { _id: TB, name: "B" },
    ]);
    mockCoverSlotFind.mockResolvedValue([{ finalCoverTeacherUserId: TA, proposedCoverTeacherId: null, periodNumber: 1 }]);

    const rows = await teacherAvailability(DATE, 1);
    expect(mockCoverSlotFind).toHaveBeenCalledWith(
      expect.objectContaining({ status: { $in: ["proposed", "approved"] } }),
    );
    expect(rows.find((r) => r.teacherId === TA.toString())).toMatchObject({ free: false, classCount: 1 });
    expect(rows.find((r) => r.teacherId === TB.toString())).toMatchObject({ free: true, classCount: 0 });
  });

  test("an approved HR cover at a DIFFERENT period only adds day-load, doesn't mark busy at the target period", async () => {
    const TA = oid();
    mockSlotFind.mockResolvedValue([]);
    mockUserFind.mockResolvedValue([{ _id: TA, name: "A" }]);
    mockCoverSlotFind.mockResolvedValue([{ finalCoverTeacherUserId: TA, proposedCoverTeacherId: null, periodNumber: 5 }]);

    const rows = await teacherAvailability(DATE, 1);
    expect(rows.find((r) => r.teacherId === TA.toString())).toMatchObject({ free: true, classCount: 1 });
  });

  test("a teacher merely PROPOSED (not yet approved) for a cover also reads as busy at that period (D-#268)", async () => {
    const TA = oid();
    mockSlotFind.mockResolvedValue([]);
    mockUserFind.mockResolvedValue([{ _id: TA, name: "A" }]);
    mockCoverSlotFind.mockResolvedValue([{ finalCoverTeacherUserId: null, proposedCoverTeacherId: TA, periodNumber: 1 }]);

    const rows = await teacherAvailability(DATE, 1);
    expect(rows.find((r) => r.teacherId === TA.toString())).toMatchObject({ free: false, classCount: 1 });
  });
});

// ---------------------------------------------------------------------------
// R4.2 — assignCover
// ---------------------------------------------------------------------------
describe("R4.2 assignCover", () => {
  test("a Section slot backs the cover with a subject-scoped proxy grant", async () => {
    const subjId = oid();
    mockSubjectFindOne.mockResolvedValue({ _id: subjId });
    mockSlotFindById.mockResolvedValue({
      _id: oid(),
      groupType: "section",
      classId: oid(),
      groupId: oid(),
      teacherId: oid(),
      subject: "MATH",
    });
    await assignCover({ slotId: oid().toString(), date: DATE, coverTeacherId: oid().toString(), actorId: oid().toString() });
    expect(mockAssignProxy).toHaveBeenCalledTimes(1);
    // D-#257: the proxy carries the covered slot's subject (per-subject cover), not just the class.
    expect(mockAssignProxy.mock.calls[0][0]).toMatchObject({ durationDays: 1, subjectId: subjId.toString() });
    expect(mockSubUpdateOne).toHaveBeenCalledTimes(1); // proxyGrantId stamped
    expect(mockEmitCoverAssigned).toHaveBeenCalledTimes(1); // N1.6 — covering teacher notified
  });

  test("a SubjectGroup slot records the cover but binds no grant", async () => {
    mockSlotFindById.mockResolvedValue({ _id: oid(), groupType: "subjectgroup", groupId: oid(), teacherId: oid() });
    await assignCover({ slotId: oid().toString(), date: DATE, coverTeacherId: oid().toString(), actorId: oid().toString() });
    expect(mockSubCreate).toHaveBeenCalledTimes(1);
    expect(mockAssignProxy).not.toHaveBeenCalled();
    expect(mockSubUpdateOne).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R4.3 — cancelCover
// ---------------------------------------------------------------------------
describe("R4.3 cancelCover", () => {
  test("deactivates the substitution and revokes its proxy grant", async () => {
    const grantId = oid();
    mockSubFindById.mockResolvedValue({ _id: oid(), proxyGrantId: grantId });
    await cancelCover(oid().toString(), oid().toString());
    expect(mockSubUpdateOne).toHaveBeenCalledWith(expect.anything(), { $set: { active: false } });
    expect(mockRevokeProxy).toHaveBeenCalledWith(grantId.toString(), expect.any(String));
    expect(mockEmitCoverAssigned).not.toHaveBeenCalled(); // N1.6 — cancel emits nothing
  });

  test("no proxy grant to revoke when the cover had none (group cover)", async () => {
    mockSubFindById.mockResolvedValue({ _id: oid() });
    await cancelCover(oid().toString(), oid().toString());
    expect(mockSubUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockRevokeProxy).not.toHaveBeenCalled();
  });
});
