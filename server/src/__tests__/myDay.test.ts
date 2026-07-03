/**
 * UX-4 tests — myDay (the staff Today dashboard read, prd-ux-improvements.md §4.4).
 *
 *   1. a TEACHER sees their OWN slots only (teacherId-filtered query, cover overlay,
 *      day-type filter) — holiday/off dates yield an empty periods list
 *   2. homework counts equal the homeworkClassOverview sums over exactly the refs the
 *      caller can read (unreadable refs silently skipped)
 *   3. GUARDIAN / OFFICE callers get empty slots + zero counts WITHOUT error
 *   4. attendancePending mirrors myMarkingSections' unmarked state
 *
 * DB-free: models + the reused seams are mocked; the composition logic is real.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";

const mockSlotFind = jest.fn();
const mockSubFind = jest.fn();
const mockSectionFind = jest.fn();
const mockResolveDayType = jest.fn();
const mockConfirm = jest.fn();
const mockRead = jest.fn();
const mockOverview = jest.fn();
const mockMarking = jest.fn();

jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (q: unknown) => ({ sort: () => ({ lean: () => mockSlotFind(q) }) }) },
}));
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: { find: (q: unknown) => ({ lean: () => mockSubFind(q) }) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (q: unknown) => ({ select: () => ({ lean: () => mockSectionFind(q) }) }) },
}));
// Real R2.1 admit rule inline; the DB-backed holiday resolution is mocked.
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (...a: unknown[]) => mockResolveDayType(...a),
  dayTypeAdmitsTrack: (dayType: string, track: string) =>
    dayType === "FULL" ? true : dayType === "QURAN_ONLY" ? track === "quran" : false,
}));
// View enrichment is exercised by the routine suites — here it just stamps fields.
jest.mock("../modules/routine/slotView", () => ({
  enrichRoutineSlots: (slots: object[]) =>
    Promise.resolve(
      slots.map((s) => ({ ...s, teacherName: "T", coverTeacherName: null, startTime: "09:00", endTime: "09:40", groupName: "G" })),
    ),
}));
jest.mock("../middleware/authz", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  assertCanConfirmHomework: (...a: unknown[]) => mockConfirm(...a),
  assertCanRead: (...a: unknown[]) => mockRead(...a),
}));
jest.mock("../modules/trackers/services/HomeworkSummaryService", () => ({
  homeworkClassOverview: (...a: unknown[]) => mockOverview(...a),
}));
jest.mock("../modules/attendance/services/StudentAttendanceService", () => ({
  myMarkingSections: (...a: unknown[]) => mockMarking(...a),
}));

import { myDayFor } from "../modules/routine/services/MyDayService";

const oid = () => new mongoose.Types.ObjectId();
const ctxFor = (role: string, userId = "user-1"): AppContext =>
  ({ auth: { userId, role } }) as unknown as AppContext;

/** Sensible empty-world defaults; tests override what they exercise. */
beforeEach(() => {
  jest.clearAllMocks();
  mockResolveDayType.mockResolvedValue("FULL");
  mockSlotFind.mockResolvedValue([]);
  mockSubFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([]);
  mockOverview.mockResolvedValue([]);
  mockMarking.mockResolvedValue([]);
});

describe("myDay — own periods (slots)", () => {
  test("teacher: query is teacherId-filtered, covers overlay, enrichment applied", async () => {
    const s1 = { _id: oid(), track: "general", periodNumber: 1, teacherId: "user-1" };
    const s2 = { _id: oid(), track: "general", periodNumber: 3, teacherId: "user-1" };
    mockSlotFind.mockResolvedValue([s1, s2]);
    mockSubFind.mockResolvedValue([{ slotId: s2._id, coverTeacherId: oid() }]);

    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01"); // a Wednesday (FULL)
    expect(mockSlotFind).toHaveBeenCalledWith(
      expect.objectContaining({ teacherId: "user-1", dayOfWeek: "WED", isBreak: false, active: true }),
    );
    expect(r.slots).toHaveLength(2);
    expect(r.slots[0].coverTeacherId).toBeNull();
    expect(r.slots[1].coverTeacherId).not.toBeNull(); // the overlaid cover
    expect(r.slots[0].teacherName).toBe("T"); // enriched (R-3)
    expect(r.dayType).toBe("FULL");
    expect(r.date).toBe("2026-07-01");
  });

  test("holiday: day-type admits nothing → empty periods (the app's empty state)", async () => {
    mockResolveDayType.mockResolvedValue("HOLIDAY");
    mockSlotFind.mockResolvedValue([{ _id: oid(), track: "general", periodNumber: 1 }]);
    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r.dayType).toBe("HOLIDAY");
    expect(r.slots).toHaveLength(0);
  });

  test("Saturday QURAN_ONLY: only the quran track survives", async () => {
    mockResolveDayType.mockResolvedValue("QURAN_ONLY");
    mockSlotFind.mockResolvedValue([
      { _id: oid(), track: "quran", periodNumber: 1 },
      { _id: oid(), track: "general", periodNumber: 2 },
    ]);
    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-04");
    expect(r.slots).toHaveLength(1);
    expect(r.slots[0].track).toBe("quran");
  });

  test("invalid date rejects", async () => {
    await expect(myDayFor(ctxFor("TEACHER"), "not-a-date")).rejects.toThrow("Invalid date");
  });
});

describe("myDay — homework counts (homeworkClassOverview parity)", () => {
  test("sums over exactly the readable refs; unreadable refs silently skipped", async () => {
    const secA = { _id: oid(), classId: oid() };
    const secB = { _id: oid(), classId: oid() };
    const secC = { _id: oid(), classId: oid() };
    mockSectionFind.mockResolvedValue([secA, secB, secC]);
    mockConfirm.mockRejectedValue(new Error("not a confirmer"));
    mockRead.mockImplementation((_ctx, sectionId: string) => {
      if (sectionId === secC._id.toString()) return Promise.reject(new Error("out of scope"));
      return Promise.resolve();
    });
    mockOverview.mockResolvedValue([
      { classId: secA.classId.toString(), pendingChecking: 2, openResubmissions: 1, activeChases: 3 },
      { classId: secB.classId.toString(), pendingChecking: 1, openResubmissions: 0, activeChases: 2 },
    ]);

    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r.homework).toEqual({ pendingChecking: 3, openResubmissions: 1, activeChases: 5 });
    const requested = (mockOverview.mock.calls[0][0] as string[]).sort();
    expect(requested).toEqual([secA.classId.toString(), secB.classId.toString()].sort());
  });

  test("no readable refs → zeros, overview never called", async () => {
    mockSectionFind.mockResolvedValue([{ _id: oid(), classId: oid() }]);
    mockConfirm.mockRejectedValue(new Error("no"));
    mockRead.mockRejectedValue(new Error("no"));
    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r.homework).toEqual({ pendingChecking: 0, openResubmissions: 0, activeChases: 0 });
    expect(mockOverview).not.toHaveBeenCalled();
  });
});

describe("myDay — attendancePending", () => {
  test("true when a marking section is unmarked; false when all marked", async () => {
    mockMarking.mockResolvedValue([
      { sectionId: "s1", marked: true },
      { sectionId: "s2", marked: false },
    ]);
    const r1 = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r1.attendancePending).toBe(true);
    expect(mockMarking).toHaveBeenCalledWith("user-1", "2026-07-01");

    mockMarking.mockResolvedValue([{ sectionId: "s1", marked: true }]);
    const r2 = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r2.attendancePending).toBe(false);
  });
});

describe("myDay — permission degradation (guardian/office render, never error)", () => {
  test("GUARDIAN: empty slots, zero counts, no pending flag; no gated seam touched", async () => {
    const r = await myDayFor(ctxFor("GUARDIAN"), "2026-07-01");
    expect(r.slots).toHaveLength(0);
    expect(r.homework).toEqual({ pendingChecking: 0, openResubmissions: 0, activeChases: 0 });
    expect(r.attendancePending).toBe(false);
    expect(mockSlotFind).not.toHaveBeenCalled();
    expect(mockSectionFind).not.toHaveBeenCalled();
    expect(mockMarking).not.toHaveBeenCalled();
  });

  test("OFFICE: routine:read runs (own slots — none), but no tracker:read/attendance:mark seams", async () => {
    const r = await myDayFor(ctxFor("OFFICE"), "2026-07-01");
    expect(mockSlotFind).toHaveBeenCalled(); // office holds routine:read
    expect(r.slots).toHaveLength(0);
    expect(mockSectionFind).not.toHaveBeenCalled(); // no tracker:read
    expect(mockMarking).not.toHaveBeenCalled(); // no attendance:mark
    expect(r.homework).toEqual({ pendingChecking: 0, openResubmissions: 0, activeChases: 0 });
    expect(r.attendancePending).toBe(false);
  });

  test("unauthenticated rejects", async () => {
    await expect(myDayFor({ auth: null } as unknown as AppContext, "2026-07-01")).rejects.toThrow();
  });
});
