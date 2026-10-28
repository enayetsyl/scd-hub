/**
 * D-#880 — the assignment plan follows the routine.
 *
 * syncAssignmentPlanToRoutine re-points a section × subject's rotation cells at the
 * routine teacher from the change date: in place for a cell that had not started yet,
 * close-and-succeed for one with history; never when the routine has no single teacher,
 * never for a non-assignment subject, and no write when the plan already matches.
 *
 * DB-free: models + audit are mocked; the sync rule is real.
 */
import mongoose from "mongoose";

const mockSlotFind = jest.fn();
const mockSectionFindById = jest.fn();
const mockClassFindById = jest.fn();
const mockScheduleFindOne = jest.fn();
const mockAudit = jest.fn();

jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (f: unknown) => ({ select: () => ({ lean: () => mockSlotFind(f) }) }) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockSectionFindById(id) }) }) },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockClassFindById(id) }) }) },
}));
jest.mock("../modules/trackers/models/AssignmentSchedule", () => ({
  AssignmentSchedule: { findOne: (f: unknown) => mockScheduleFindOne(f) },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (...a: unknown[]) => Promise.resolve(mockAudit(...a)),
}));
// The listener registry is only exercised in routineSubjectSync.test.ts.
jest.mock("../modules/routine/services/RoutineSlotService", () => ({ onRoutineTeachersChanged: jest.fn() }));

import { syncAssignmentPlanToRoutine } from "../modules/trackers/services/AssignmentPlanSyncService";

const oid = () => new mongoose.Types.ObjectId();
const SEC = oid();
const OTHER_SEC = oid();
const JASI = oid();
const RAIAN = oid();
const ACTOR = oid().toString();
const CHANGE = new Date(2026, 9, 25); // local Sun 25 Oct

type Entry = {
  _id: mongoose.Types.ObjectId;
  cycleWeek: number;
  classId: mongoose.Types.ObjectId;
  classLevel: number;
  sectionId: mongoose.Types.ObjectId;
  subject: string;
  teacherId: mongoose.Types.ObjectId;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};
const entry = (over: Partial<Entry> = {}): Entry => ({
  _id: oid(),
  cycleWeek: 1,
  classId: oid(),
  classLevel: 3,
  sectionId: SEC,
  subject: "BAN",
  teacherId: JASI,
  effectiveFrom: "2026-10-25",
  effectiveTo: null,
  ...over,
});

function scheduleWith(entries: Entry[]) {
  const doc = { _id: oid(), entries, save: jest.fn().mockResolvedValue(undefined) };
  mockScheduleFindOne.mockResolvedValue(doc);
  return doc;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSlotFind.mockResolvedValue([{ teacherId: RAIAN }, { teacherId: RAIAN }]);
  mockSectionFindById.mockResolvedValue({ classId: oid() });
  mockClassFindById.mockResolvedValue({ academicYearId: oid() });
});

describe("syncAssignmentPlanToRoutine (D-#880)", () => {
  test("a cell that starts on the change date is corrected in place (the C3 Bangla swap)", async () => {
    const own = entry();
    const otherHalf = entry({ sectionId: OTHER_SEC, teacherId: RAIAN });
    const doc = scheduleWith([own, otherHalf]);

    const res = await syncAssignmentPlanToRoutine(SEC.toString(), "BAN", CHANGE, ACTOR);

    expect(res).toEqual({ reassigned: 1, split: 0 });
    expect(own.teacherId.toString()).toBe(RAIAN.toString());
    expect(own.effectiveTo).toBeNull();
    expect(doc.entries).toHaveLength(2); // nothing added
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "ASSIGNMENT_PLAN_FOLLOWED_ROUTINE",
        meta: expect.objectContaining({ sectionId: SEC.toString(), subject: "BAN", effectiveFrom: "2026-10-25" }),
      }),
    );
  });

  test("a cell with history is closed the day before and a successor opened — past weeks keep their teacher", async () => {
    const old = entry({ effectiveFrom: null, cycleWeek: 3 });
    const doc = scheduleWith([old]);

    const res = await syncAssignmentPlanToRoutine(SEC.toString(), "BAN", CHANGE, ACTOR);

    expect(res).toEqual({ reassigned: 0, split: 1 });
    expect(old.teacherId.toString()).toBe(JASI.toString());
    expect(old.effectiveTo).toBe("2026-10-24");
    expect(doc.entries).toHaveLength(2);
    const next = doc.entries[1];
    expect(next.teacherId.toString()).toBe(RAIAN.toString());
    expect(next).toEqual(
      expect.objectContaining({ cycleWeek: 3, subject: "BAN", effectiveFrom: "2026-10-25", effectiveTo: null }),
    );
  });

  test("an already-ended cell and other subjects / sections are left alone", async () => {
    const ended = entry({ effectiveFrom: null, effectiveTo: "2026-10-24" });
    const otherSubject = entry({ subject: "ENG" });
    const otherSection = entry({ sectionId: OTHER_SEC });
    const doc = scheduleWith([ended, otherSubject, otherSection]);

    const res = await syncAssignmentPlanToRoutine(SEC.toString(), "BAN", CHANGE, ACTOR);

    expect(res).toEqual({ reassigned: 0, split: 0 });
    expect(doc.save).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect([ended, otherSubject, otherSection].map((e) => e.teacherId.toString())).toEqual([
      JASI.toString(),
      JASI.toString(),
      JASI.toString(),
    ]);
  });

  test("two routine teachers for the cell (or none) -> plan untouched", async () => {
    const doc = scheduleWith([entry()]);
    mockSlotFind.mockResolvedValueOnce([{ teacherId: RAIAN }, { teacherId: JASI }]);
    expect(await syncAssignmentPlanToRoutine(SEC.toString(), "BAN", CHANGE, ACTOR)).toEqual({
      reassigned: 0,
      split: 0,
      skipped: "no_single_routine_teacher",
    });
    mockSlotFind.mockResolvedValueOnce([]);
    expect((await syncAssignmentPlanToRoutine(SEC.toString(), "BAN", CHANGE, ACTOR)).skipped).toBe(
      "no_single_routine_teacher",
    );
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("a subject outside the assignment axis (Quran) is never synced", async () => {
    const res = await syncAssignmentPlanToRoutine(SEC.toString(), "QURAN", CHANGE, ACTOR);
    expect(res.skipped).toBe("not_assignment_subject");
    expect(mockSlotFind).not.toHaveBeenCalled();
  });

  test("the routine query reads the slots in force on the change date", async () => {
    scheduleWith([]);
    await syncAssignmentPlanToRoutine(SEC.toString(), "BAN", CHANGE, ACTOR);
    const filter = mockSlotFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter).toEqual(
      expect.objectContaining({ groupType: "section", groupId: SEC.toString(), subject: "BAN", active: true, isBreak: false }),
    );
    expect(filter.effectiveFrom).toEqual({ $lte: new Date(2026, 9, 25, 23, 59, 59, 999) });
  });
});
