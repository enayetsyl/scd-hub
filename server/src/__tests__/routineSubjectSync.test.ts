/**
 * D-#291 — subject-teacher assignment ⇄ routine sync.
 *
 *   1. sectionSubjectRoutineTeachers — per-subject ROUTINE teachers for a section's
 *      live slots (the Assign-subject-teacher screen's mismatch view)
 *   2. reassignRoutineSubjectTeacher — whole-or-nothing: no slots → error;
 *      the new teacher booked elsewhere at an affected (day, period) → error
 *      BEFORE any write; happy path updates every slot via the master-grid
 *      cell-edit path (updateRoutineSlot).
 *
 * DB-free: models + audit + chat sync are mocked; the sync logic is real.
 */
import mongoose from "mongoose";

const mockSlotFind = jest.fn();
const mockSlotFindById = jest.fn();
const mockSlotFindOne = jest.fn();
const mockSlotUpdateOne = jest.fn();
const mockSectionFindById = jest.fn();
const mockSubjectFindOne = jest.fn();
const mockGrantFindOne = jest.fn();
const mockGrantCreate = jest.fn();
const mockGrantUpdateOne = jest.fn();
const mockUserFind = jest.fn();
const mockChatSync = jest.fn();
const mockAudit = jest.fn();

jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    find: (f: unknown) => ({
      lean: () => mockSlotFind(f),
      select: () => ({ lean: () => mockSlotFind(f) }),
    }),
    findById: (id: unknown) => ({ lean: () => mockSlotFindById(id) }),
    findOne: (f: unknown) => ({ lean: () => mockSlotFindOne(f) }),
    updateOne: (f: unknown, u: unknown) => Promise.resolve(mockSlotUpdateOne(f, u)),
  },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => ({ lean: () => mockSectionFindById(id) }) },
}));
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { findOne: (f: unknown) => ({ lean: () => mockSubjectFindOne(f) }) },
}));
jest.mock("../modules/foundation/models/ScopeGrant", () => ({
  ScopeGrant: {
    findOne: (f: unknown) => ({ lean: () => mockGrantFindOne(f) }),
    create: (d: unknown) => Promise.resolve(mockGrantCreate(d)),
    updateOne: (f: unknown, u: unknown) => Promise.resolve(mockGrantUpdateOne(f, u)),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => ({ select: () => ({ lean: () => mockUserFind(f) }) }) },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (...a: unknown[]) => Promise.resolve(mockAudit(...a)),
}));
jest.mock("../modules/chat/services/ChatGroupService", () => ({
  onRoutineSlotChangedSync: (...a: unknown[]) => Promise.resolve(mockChatSync(...a)),
}));

import {
  sectionSubjectRoutineTeachers,
  reassignRoutineSubjectTeacher,
} from "../modules/routine/services/RoutineSlotService";

const oid = () => new mongoose.Types.ObjectId();
const SEC = oid().toString();
const NEW_T = oid().toString();
const OLD_T = oid();
const ACTOR = oid().toString();

const liveSlot = (over: Record<string, unknown> = {}) => ({
  _id: oid(),
  groupType: "section",
  groupId: { toString: () => SEC },
  dayOfWeek: "SUN",
  periodNumber: 5,
  subject: "SCI",
  track: "general",
  isBreak: false,
  teacherId: OLD_T,
  roomId: null,
  effectiveFrom: new Date(2026, 0, 1),
  effectiveTo: null,
  active: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSlotFind.mockResolvedValue([]);
  mockSlotFindById.mockResolvedValue(null);
  mockSlotFindOne.mockResolvedValue(null);
  mockSlotUpdateOne.mockResolvedValue({});
  mockSectionFindById.mockResolvedValue({ _id: SEC, classId: oid() });
  mockSubjectFindOne.mockResolvedValue({ _id: oid(), code: "SCI" });
  mockGrantFindOne.mockResolvedValue(null);
  mockGrantCreate.mockResolvedValue({});
  mockGrantUpdateOne.mockResolvedValue({});
  mockUserFind.mockResolvedValue([]);
});

describe("sectionSubjectRoutineTeachers (D-#291)", () => {
  test("groups live slots by subject, deduping teachers and resolving names", async () => {
    const t1 = oid();
    const t2 = oid();
    mockSlotFind.mockResolvedValue([
      liveSlot({ subject: "SCI", teacherId: t1 }),
      liveSlot({ subject: "SCI", teacherId: t1, dayOfWeek: "MON" }),
      liveSlot({ subject: "ENG", teacherId: t2 }),
      liveSlot({ subject: "MATH", teacherId: null }), // teacherless -> skipped
    ]);
    mockUserFind.mockResolvedValue([
      { _id: t1, name: "Husne ara Rahman Fida" },
      { _id: t2, name: "Mahmudur Rahman Tazkir" },
    ]);

    const rows = await sectionSubjectRoutineTeachers(SEC);
    expect(rows).toEqual([
      { subject: "ENG", teacherIds: [t2.toString()], teacherNames: ["Mahmudur Rahman Tazkir"] },
      { subject: "SCI", teacherIds: [t1.toString()], teacherNames: ["Husne ara Rahman Fida"] },
    ]);
  });
});

describe("reassignRoutineSubjectTeacher (D-#291)", () => {
  test("no live slots for the subject -> error, nothing written", async () => {
    await expect(reassignRoutineSubjectTeacher(SEC, "SCI", NEW_T, ACTOR)).rejects.toThrow(
      "No live routine slots",
    );
    expect(mockSlotUpdateOne).not.toHaveBeenCalled();
  });

  test("new teacher already booked at an affected period -> error BEFORE any write", async () => {
    const target = liveSlot();
    // 1st find: the target slots; 2nd find: the clash pre-check.
    mockSlotFind
      .mockResolvedValueOnce([target])
      .mockResolvedValueOnce([{ dayOfWeek: "SUN", periodNumber: 5 }]);

    await expect(reassignRoutineSubjectTeacher(SEC, "SCI", NEW_T, ACTOR)).rejects.toThrow(
      "already booked at SUN P5",
    );
    expect(mockSlotUpdateOne).not.toHaveBeenCalled();
  });

  test("happy path: every live slot is pointed at the new teacher via the cell-edit path", async () => {
    const s1 = liveSlot();
    const s2 = liveSlot({ dayOfWeek: "TUE", periodNumber: 6 });
    mockSlotFind
      .mockResolvedValueOnce([s1, s2]) // target slots
      .mockResolvedValueOnce([]) // clash pre-check -> free
      .mockResolvedValue([]); // updateRoutineSlot's own per-slot conflict queries
    mockSlotFindById.mockImplementation((id) =>
      Promise.resolve([s1, s2].find((s) => s._id === id) ?? s1),
    );

    const res = await reassignRoutineSubjectTeacher(SEC, "SCI", NEW_T, ACTOR);
    expect(res.updatedSlots).toBe(2);
    expect(mockSlotUpdateOne).toHaveBeenCalledTimes(2);
    const [, update] = mockSlotUpdateOne.mock.calls[0] as [unknown, { $set: { teacherId: { toString(): string } } }];
    expect(update.$set.teacherId.toString()).toBe(NEW_T);
    // The reused path re-syncs grants + chat like any master-grid edit.
    expect(mockChatSync).toHaveBeenCalledTimes(2);
  });
});
