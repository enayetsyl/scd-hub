/**
 * Routine R-5 tests — bell-schedule trigger + class-note publish.
 *
 * R5.1 — buildBellSchedule (per-period override > whole-day duty > null) + bellSchedule
 *        computes period end times from the grid/window
 * R5.3 — publishClassNote authorization (teacher / cover / admin allowed; stranger denied)
 *        + myClassNotePrompts (slots still needing a note)
 *
 * DB-free: routine models mocked; the schedule maths + auth are real.
 */
import mongoose from "mongoose";
import { buildBellSchedule } from "../modules/routine/trigger";
import { ForbiddenError } from "../middleware/authz";

const oid = () => new mongoose.Types.ObjectId();

const mockWindowFind = jest.fn();
jest.mock("../modules/routine/models/ScheduleWindow", () => ({
  ScheduleWindow: { find: () => ({ lean: () => mockWindowFind() }) },
}));

const mockGridFindOne = jest.fn();
jest.mock("../modules/routine/models/PeriodGrid", () => ({
  PeriodGrid: { findOne: () => ({ lean: () => mockGridFindOne() }) },
}));

const mockBellFind = jest.fn();
jest.mock("../modules/routine/models/BellDutyAssignment", () => ({
  BellDutyAssignment: {
    find: () => ({ lean: () => mockBellFind() }),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
}));

const mockSlotFindById = jest.fn();
const mockSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    findById: (id: unknown) => ({ lean: () => mockSlotFindById(id) }),
    find: () => ({ sort: () => ({ lean: () => mockSlotFind() }) }),
  },
}));

const mockSubFindOne = jest.fn();
const mockSubFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: {
    findOne: () => ({ lean: () => mockSubFindOne() }),
    find: () => ({ select: () => ({ lean: () => mockSubFind() }) }),
  },
}));

const mockNoteUpdateOne = jest.fn();
const mockNoteFindOne = jest.fn();
const mockNoteFind = jest.fn();
jest.mock("../modules/routine/models/ClassNote", () => ({
  ClassNote: {
    updateOne: (f: unknown, u: unknown, o: unknown) => mockNoteUpdateOne(f, u, o),
    findOne: () => ({ lean: () => mockNoteFindOne() }),
    find: () => ({ sort: () => ({ lean: () => mockNoteFind() }), select: () => ({ lean: () => mockNoteFind() }) }),
  },
}));

// Notification emitters (N-1, D-#72) — mocked: the host-side call is under test
// here; the emitter internals are covered in notifications.test.ts.
const mockEmitClassNotePublished = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/notifications/services/emitters", () => ({
  emitClassNotePublished: (...args: unknown[]) => mockEmitClassNotePublished(...args),
}));

import { bellSchedule, publishClassNote, myClassNotePrompts } from "../modules/routine/services/RoutineTriggerService";

const DATE = new Date(2026, 5, 2, 9, 0, 0); // a 2026 date

beforeEach(() => {
  jest.clearAllMocks();
  mockSubFindOne.mockResolvedValue(null);
  mockSubFind.mockResolvedValue([]);
  mockNoteFindOne.mockResolvedValue({ _id: oid(), taughtSummaryBn: "x" });
  mockNoteFind.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// R5.1 — buildBellSchedule (pure)
// ---------------------------------------------------------------------------
describe("R5.1 buildBellSchedule", () => {
  const periods = [
    { number: 2, isBreak: false, endHHMM: "08:30" },
    { number: 1, isBreak: false, endHHMM: "07:45" },
  ];
  test("per-period override beats the whole-day duty admin", () => {
    const sched = buildBellSchedule(periods, "ADMIN_DAY", { 2: "ADMIN_P2" });
    expect(sched.map((s) => s.periodNumber)).toEqual([1, 2]); // sorted
    expect(sched[0].bellAdminId).toBe("ADMIN_DAY"); // P1 → whole-day
    expect(sched[1].bellAdminId).toBe("ADMIN_P2"); // P2 → override
  });
  test("null when no duty assigned", () => {
    expect(buildBellSchedule(periods, null, {})[0].bellAdminId).toBeNull();
  });
});

describe("R5.1 bellSchedule computes period end times", () => {
  test("times derive from the window day-start + grid durations", async () => {
    const admin = oid();
    mockWindowFind.mockResolvedValue([
      { fromDate: new Date("2026-01-01"), toDate: new Date("2026-12-31"), season: "regular", dayStartMinutes: 420 },
    ]);
    mockGridFindOne.mockResolvedValue({
      periods: [
        { number: 1, durationMin: 45, isBreak: false, track: "quran", nameBn: "P1" },
        { number: 2, durationMin: 45, isBreak: false, track: "quran", nameBn: "P2" },
      ],
    });
    mockBellFind.mockResolvedValue([{ periodNumber: undefined, adminId: admin }]);
    const sched = await bellSchedule(DATE, "class_1_5");
    expect(sched[0]).toMatchObject({ periodNumber: 1, endHHMM: "07:45", bellAdminId: admin.toString() });
    expect(sched[1].endHHMM).toBe("08:30");
  });
});

// ---------------------------------------------------------------------------
// R5.3 — publishClassNote authorization
// ---------------------------------------------------------------------------
describe("R5.3 publishClassNote", () => {
  const TEACHER = oid();
  const section = { groupType: "section", groupId: oid(), subject: "BAN", teacherId: TEACHER };

  test("the slot's teacher may publish", async () => {
    mockSlotFindById.mockResolvedValue(section);
    await publishClassNote({ slotId: oid().toString(), date: DATE, taughtSummaryBn: "Taught X", actorId: TEACHER.toString(), canManage: false });
    expect(mockNoteUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockEmitClassNotePublished).toHaveBeenCalledTimes(1); // N1.3 — guardians notified on publish
    expect(mockNoteUpdateOne.mock.calls[0][2]).toMatchObject({ upsert: true });
  });

  test("a stranger (not teacher/cover/admin) is denied", async () => {
    mockSlotFindById.mockResolvedValue(section);
    mockSubFindOne.mockResolvedValue(null);
    await expect(
      publishClassNote({ slotId: oid().toString(), date: DATE, taughtSummaryBn: "x", actorId: oid().toString(), canManage: false }),
    ).rejects.toThrow(ForbiddenError);
    expect(mockNoteUpdateOne).not.toHaveBeenCalled();
  });

  test("an active cover may publish", async () => {
    mockSlotFindById.mockResolvedValue(section);
    mockSubFindOne.mockResolvedValue({ _id: oid() });
    await publishClassNote({ slotId: oid().toString(), date: DATE, taughtSummaryBn: "x", actorId: oid().toString(), canManage: false });
    expect(mockNoteUpdateOne).toHaveBeenCalledTimes(1);
  });

  test("an admin may publish", async () => {
    mockSlotFindById.mockResolvedValue(section);
    await publishClassNote({ slotId: oid().toString(), date: DATE, taughtSummaryBn: "x", actorId: oid().toString(), canManage: true });
    expect(mockNoteUpdateOne).toHaveBeenCalledTimes(1);
  });

  test("rejects a non-id homeworkItemId with a clear message (prod BSONError guard)", async () => {
    mockSlotFindById.mockResolvedValue(section);
    await expect(
      publishClassNote({
        slotId: oid().toString(), date: DATE, taughtSummaryBn: "x",
        homeworkItemId: "ঐচ্ছিক", actorId: TEACHER.toString(), canManage: true,
      }),
    ).rejects.toThrow(/valid id/);
    expect(mockNoteUpdateOne).not.toHaveBeenCalled();
  });

  test("a valid homeworkItemId is written as an ObjectId on the note", async () => {
    mockSlotFindById.mockResolvedValue(section);
    const hw = oid().toString();
    await publishClassNote({
      slotId: oid().toString(), date: DATE, taughtSummaryBn: "x",
      homeworkItemId: hw, actorId: TEACHER.toString(), canManage: true,
    });
    const set = (mockNoteUpdateOne.mock.calls[0][1] as { $set: Record<string, unknown> }).$set;
    expect(String(set.homeworkItemId)).toBe(hw);
  });
});

describe("R5.3 myClassNotePrompts", () => {
  test("returns the teacher's slots that still need a note", async () => {
    const me = oid(), s1 = oid(), s2 = oid();
    mockSlotFind.mockResolvedValue([
      { _id: s1, teacherId: me },
      { _id: s2, teacherId: me },
      { _id: oid(), teacherId: oid() }, // someone else's period
    ]);
    mockNoteFind.mockResolvedValue([{ slotId: s1 }]); // s1 already has a note
    const prompts = await myClassNotePrompts(DATE, me.toString());
    expect(prompts.map((s) => s._id.toString())).toEqual([s2.toString()]);
  });

  // COVER OVERLAY (owner report 2026-08-03) — the prompt goes to whoever taught the
  // period, so it must swap BOTH ways on a covered day. This is the single seam the
  // push ladder and the in-app prompt share.
  test("a period I covered is prompted to me, and my covered-away period is not", async () => {
    const me = oid(), other = oid(), mine = oid(), theirs = oid();
    mockSlotFind.mockResolvedValue([
      { _id: mine, teacherId: me },
      { _id: theirs, teacherId: other },
    ]);
    mockSubFind.mockResolvedValue([
      { slotId: mine, coverTeacherId: other }, // I was away — not my note
      { slotId: theirs, coverTeacherId: me }, // I stood in — mine to write
    ]);
    const prompts = await myClassNotePrompts(DATE, me.toString());
    expect(prompts.map((s) => s._id.toString())).toEqual([theirs.toString()]);
  });
});
