/**
 * Routine R-2 tests — slots + conflict engine + scope binding.
 *
 * R2.1 — weekday/track admission (Fri rejected, Sat only quran) + break has no teacher
 * R2.2 — teacher not double-booked
 * R2.3 — group not double-booked
 * R2.4 — room not double-booked (only when a room is set)
 * R2.5 — scope binding: a content section slot binds a routine teaching grant; a
 *        Quran group / non-content / break slot does not
 * R2.6 — teacher-authority warns (never blocks)
 * R2.7 — effective-dating: overlapping vs non-overlapping windows (effectiveOverlap)
 *
 * Pure helpers tested directly; the service (createRoutineSlot/deleteRoutineSlot) is
 * exercised with mocked models — DB-free, matching the repo style.
 */
import mongoose from "mongoose";
import { SUBJECTS } from "@scd/shared";

// --- pure helpers (no mocks needed) ----------------------------------------
import { effectiveOverlap, detectConflicts, hasConflict } from "../modules/routine/conflicts";
type SlotLite = Parameters<typeof detectConflicts>[0];
import { routineGrantPlan } from "../modules/routine/binding";
import { weekdayBaseDayType, dayTypeAdmitsTrack } from "../modules/routine/calendar";

// --- mock the models the service touches, BEFORE importing it --------------
const mockSlotFind = jest.fn();
const mockSlotCreate = jest.fn();
const mockSlotFindById = jest.fn();
const mockSlotFindOne = jest.fn();
const mockSlotDeleteOne = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    find: (q: unknown) => ({ lean: () => mockSlotFind(q) }),
    create: (d: unknown) => mockSlotCreate(d),
    findById: (id: unknown) => ({ lean: () => mockSlotFindById(id) }),
    findOne: (q: unknown) => ({ lean: () => mockSlotFindOne(q) }),
    deleteOne: (q: unknown) => mockSlotDeleteOne(q),
  },
}));

const mockSectionFindById = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => ({ lean: () => mockSectionFindById(id) }) },
}));

const mockGroupFindById = jest.fn();
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { findById: (id: unknown) => ({ lean: () => mockGroupFindById(id) }) },
}));

const mockSubjectFindOne = jest.fn();
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { findOne: (q: unknown) => ({ lean: () => mockSubjectFindOne(q) }) },
}));

const mockGrantFindOne = jest.fn();
const mockGrantCreate = jest.fn();
const mockGrantUpdateOne = jest.fn();
jest.mock("../modules/foundation/models/ScopeGrant", () => ({
  ScopeGrant: {
    findOne: (q: unknown) => ({ lean: () => mockGrantFindOne(q) }),
    create: (d: unknown) => mockGrantCreate(d),
    updateOne: (f: unknown, u: unknown) => mockGrantUpdateOne(f, u),
  },
}));

jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn() }));

// Chat group auto-sync (M-2) — mocked: the routine mutation is what's under test;
// its best-effort chat hook is exercised in the chat group suite, not here.
jest.mock("../modules/chat/services/ChatGroupService", () => ({
  onRoutineSlotChangedSync: jest.fn().mockResolvedValue(undefined),
}));

import { createRoutineSlot, deleteRoutineSlot } from "../modules/routine/services/RoutineSlotService";

// ---------------------------------------------------------------------------
const ACTOR = new mongoose.Types.ObjectId().toString();
const TEACHER_A = new mongoose.Types.ObjectId().toString();
const SECTION = new mongoose.Types.ObjectId().toString();
const GROUP = new mongoose.Types.ObjectId().toString();
const CLASS = new mongoose.Types.ObjectId();
const ROOM = new mongoose.Types.ObjectId().toString();
const SUBJ = new mongoose.Types.ObjectId();
const D = (s: string) => new Date(s);

function lite(over: Partial<SlotLite> = {}): SlotLite {
  return {
    id: new mongoose.Types.ObjectId().toString(),
    dayOfWeek: "TUE",
    periodNumber: 5,
    groupType: "section",
    groupId: SECTION,
    teacherId: TEACHER_A,
    roomId: ROOM,
    effectiveFrom: D("2026-01-01"),
    effectiveTo: null,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSlotFind.mockResolvedValue([]); // no conflicts by default
  mockSlotCreate.mockImplementation(async (d) => ({ _id: new mongoose.Types.ObjectId(), ...d }));
  mockSectionFindById.mockResolvedValue({ _id: SECTION, classId: CLASS });
  mockGroupFindById.mockResolvedValue({ _id: GROUP, track: "quran" });
  mockSubjectFindOne.mockResolvedValue({ _id: SUBJ, code: "BAN" });
  mockGrantFindOne.mockResolvedValue(null);
});

function baseInput(over: Record<string, unknown> = {}) {
  return {
    groupType: "section" as const,
    groupId: SECTION,
    dayOfWeek: "TUE" as const,
    periodNumber: 5,
    subject: "BAN" as const,
    track: "general" as const,
    isBreak: false,
    teacherId: TEACHER_A,
    roomId: ROOM,
    effectiveFrom: D("2026-01-01"),
    effectiveTo: null,
    createdBy: ACTOR,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// R2.1 — weekday/track admission (pure) + break rule (service)
// ---------------------------------------------------------------------------
describe("R2.1 weekday admits track", () => {
  test("Sun–Thu are FULL (all tracks); Sat is QURAN_ONLY; Fri is OFF", () => {
    expect(weekdayBaseDayType(0)).toBe("FULL"); // Sun
    expect(weekdayBaseDayType(4)).toBe("FULL"); // Thu
    expect(weekdayBaseDayType(5)).toBe("OFF"); // Fri
    expect(weekdayBaseDayType(6)).toBe("QURAN_ONLY"); // Sat
  });
  test("Saturday admits only quran", () => {
    expect(dayTypeAdmitsTrack(weekdayBaseDayType(6), "quran")).toBe(true);
    expect(dayTypeAdmitsTrack(weekdayBaseDayType(6), "general")).toBe(false);
    expect(dayTypeAdmitsTrack(weekdayBaseDayType(6), "arabic")).toBe(false);
  });
  test("Friday admits nothing", () => {
    for (const tr of ["general", "quran", "arabic"] as const)
      expect(dayTypeAdmitsTrack(weekdayBaseDayType(5), tr)).toBe(false);
  });
});

describe("R2.1 slot creation guards", () => {
  test("rejects a general slot on Friday", async () => {
    await expect(createRoutineSlot(baseInput({ dayOfWeek: "FRI" }))).rejects.toThrow(/FRI/);
  });
  test("rejects a general slot on Saturday but allows a quran slot", async () => {
    await expect(createRoutineSlot(baseInput({ dayOfWeek: "SAT" }))).rejects.toThrow(/SAT/);
    await expect(
      createRoutineSlot(baseInput({ dayOfWeek: "SAT", track: "quran", groupType: "subjectgroup", groupId: GROUP, subject: "QURAN" })),
    ).resolves.toBeTruthy();
  });
  test("rejects a break period that carries a teacher", async () => {
    await expect(createRoutineSlot(baseInput({ isBreak: true }))).rejects.toThrow(/break/i);
  });
});

// ---------------------------------------------------------------------------
// R2.2–R2.4 — conflict engine (pure)
// ---------------------------------------------------------------------------
describe("R2.7 effectiveOverlap", () => {
  test("overlapping windows", () => {
    expect(effectiveOverlap(D("2026-01-01"), D("2026-06-30"), D("2026-06-01"), D("2026-12-31"))).toBe(true);
  });
  test("non-overlapping windows", () => {
    expect(effectiveOverlap(D("2026-01-01"), D("2026-05-31"), D("2026-06-01"), null)).toBe(false);
  });
  test("open-ended windows overlap anything later", () => {
    expect(effectiveOverlap(D("2026-01-01"), null, D("2030-01-01"), null)).toBe(true);
  });
});

describe("R2.2/R2.3/R2.4 detectConflicts", () => {
  test("teacher double-booked at same day+period (overlapping window)", () => {
    const cand = lite({ groupId: "secA", roomId: "r1" });
    const other = lite({ groupId: "secB", roomId: "r2", teacherId: cand.teacherId });
    const r = detectConflicts(cand, [other]);
    expect(r.teacher).not.toBeNull();
    expect(r.group).toBeNull();
    expect(r.room).toBeNull();
  });
  test("group double-booked", () => {
    const cand = lite({ teacherId: "tA", roomId: "r1" });
    const other = lite({ teacherId: "tB", roomId: "r2", groupId: cand.groupId });
    expect(detectConflicts(cand, [other]).group).not.toBeNull();
  });
  test("room double-booked only when a room is set", () => {
    const cand = lite({ teacherId: "tA", groupId: "secA", roomId: "rShared" });
    const other = lite({ teacherId: "tB", groupId: "secB", roomId: "rShared" });
    expect(detectConflicts(cand, [other]).room).not.toBeNull();
    const noRoom = detectConflicts(lite({ teacherId: "tA", groupId: "secA", roomId: null }), [
      lite({ teacherId: "tB", groupId: "secB", roomId: null }),
    ]);
    expect(noRoom.room).toBeNull();
  });
  test("no clash at a different period or non-overlapping window", () => {
    const cand = lite();
    expect(hasConflict(detectConflicts(cand, [lite({ periodNumber: 6 })]))).toBe(false);
    // cand is open-ended from 2026; a window that closed in 2020 cannot overlap it.
    expect(
      hasConflict(
        detectConflicts(cand, [lite({ effectiveFrom: D("2020-01-01"), effectiveTo: D("2020-12-31") })]),
      ),
    ).toBe(false);
  });
  test("a slot never conflicts with itself (id match skipped)", () => {
    const cand = lite();
    expect(hasConflict(detectConflicts(cand, [cand]))).toBe(false);
  });
});

describe("R2.2 service rejects a teacher conflict", () => {
  test("createRoutineSlot throws when the teacher is already booked", async () => {
    mockSlotFind.mockResolvedValue([
      { _id: new mongoose.Types.ObjectId(), dayOfWeek: "TUE", periodNumber: 5, groupType: "section", groupId: "other", teacherId: new mongoose.Types.ObjectId(TEACHER_A), roomId: null, effectiveFrom: D("2026-01-01"), effectiveTo: null },
    ]);
    await expect(createRoutineSlot(baseInput({ groupId: "mySection" }))).rejects.toThrow(/already booked/i);
  });
});

// ---------------------------------------------------------------------------
// R2.5 — scope binding decision (pure) + service sync
// ---------------------------------------------------------------------------
describe("R2.5 routineGrantPlan (pure)", () => {
  test("section + content subject binds", () => {
    expect(routineGrantPlan({ groupType: "section", isBreak: false, teacherId: "t", subject: "BAN" }, SUBJECTS).bind).toBe(true);
  });
  test("Quran/Arabic group does not bind (no content scope)", () => {
    expect(routineGrantPlan({ groupType: "subjectgroup", isBreak: false, teacherId: "t", subject: "QURAN" }, SUBJECTS).bind).toBe(false);
  });
  test("non-content subject on a section does not bind", () => {
    expect(routineGrantPlan({ groupType: "section", isBreak: false, teacherId: "t", subject: "ARABIC" }, SUBJECTS).bind).toBe(false);
  });
  test("break or teacherless slot does not bind", () => {
    expect(routineGrantPlan({ groupType: "section", isBreak: true, teacherId: "t", subject: "BAN" }, SUBJECTS).bind).toBe(false);
    expect(routineGrantPlan({ groupType: "section", isBreak: false, teacherId: null, subject: "BAN" }, SUBJECTS).bind).toBe(false);
  });
});

describe("R2.5/R2.6 service scope binding", () => {
  test("a content section slot creates a routine teaching grant + warns when no prior authority", async () => {
    mockGrantFindOne.mockResolvedValueOnce(null); // prior authority check → none
    mockGrantFindOne.mockResolvedValueOnce(null); // existing routine grant → none
    const res = await createRoutineSlot(baseInput());
    expect(mockGrantCreate).toHaveBeenCalledTimes(1);
    const created = mockGrantCreate.mock.calls[0][0];
    expect(created).toMatchObject({ kind: "teaching", source: "routine" });
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/no prior teaching authority/i);
  });
  test("no warning when the teacher already has authority; existing routine grant is reactivated not duplicated", async () => {
    mockGrantFindOne.mockResolvedValueOnce({ _id: new mongoose.Types.ObjectId() }); // prior authority exists
    mockGrantFindOne.mockResolvedValueOnce({ _id: new mongoose.Types.ObjectId() }); // existing routine grant
    const res = await createRoutineSlot(baseInput());
    expect(res.warnings).toHaveLength(0);
    expect(mockGrantCreate).not.toHaveBeenCalled();
    expect(mockGrantUpdateOne).toHaveBeenCalledTimes(1); // reactivated
  });
  test("a Quran group slot binds no grant", async () => {
    const res = await createRoutineSlot(
      baseInput({ groupType: "subjectgroup", groupId: GROUP, subject: "QURAN", track: "quran" }),
    );
    expect(mockGrantCreate).not.toHaveBeenCalled();
    expect(res.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R2.5 — delete + orphan revoke
// ---------------------------------------------------------------------------
describe("R2.5 deleteRoutineSlot unbinds only when orphaned", () => {
  const slotDoc = {
    _id: new mongoose.Types.ObjectId(),
    groupType: "section",
    groupId: new mongoose.Types.ObjectId(SECTION),
    subject: "BAN",
    isBreak: false,
    teacherId: new mongoose.Types.ObjectId(TEACHER_A),
    classId: CLASS,
  };
  test("revokes the routine grant when no slot remains", async () => {
    mockSlotFindById.mockResolvedValue(slotDoc);
    mockSlotFindOne.mockResolvedValue(null); // no remaining slot → orphan
    mockGrantFindOne.mockResolvedValue({ _id: new mongoose.Types.ObjectId() }); // the routine grant
    await deleteRoutineSlot(slotDoc._id.toString(), ACTOR);
    expect(mockGrantUpdateOne).toHaveBeenCalledWith(expect.anything(), { $set: { active: false } });
  });
  test("keeps the grant when another slot still maps to it", async () => {
    mockSlotFindById.mockResolvedValue(slotDoc);
    mockSlotFindOne.mockResolvedValue({ _id: new mongoose.Types.ObjectId() }); // a remaining slot
    await deleteRoutineSlot(slotDoc._id.toString(), ACTOR);
    expect(mockGrantUpdateOne).not.toHaveBeenCalled();
  });
});
