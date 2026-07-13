/**
 * UX-4 tests — myDay (the staff Today dashboard read, prd-ux-improvements.md §4.4).
 *
 *   1. a TEACHER sees their OWN slots only (teacherId-filtered query, cover overlay,
 *      day-type filter) — holiday/off dates yield an empty periods list
 *   2. homework counts equal the homeworkClassOverview sums over exactly the refs the
 *      caller can read (unreadable refs silently skipped)
 *   3. GUARDIAN / OFFICE callers get empty slots + zero counts WITHOUT error
 *   4. attendancePending mirrors myMarkingUnits' unmarked state (D-#278 units)
 *
 * DB-free: models + the reused seams are mocked; the composition logic is real.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";

const mockSlotFind = jest.fn();
const mockCoveredSlotFind = jest.fn();
const mockSubFind = jest.fn();
const mockSectionFind = jest.fn();
const mockResolveDayType = jest.fn();
const mockConfirm = jest.fn();
const mockRead = jest.fn();
const mockOverview = jest.fn();
const mockMarking = jest.fn();
const mockCoverSlotFind = jest.fn();
const mockMySubFind = jest.fn();
const mockPendingAlerts = jest.fn();
const mockClassPresence = jest.fn();
const mockCtSectionFind = jest.fn();
const mockClassFind = jest.fn();

// RoutineSlot.find is called two different ways in MyDayService: the own-periods
// query (…sort().lean()) and the covering-periods query (…sort().lean(), same
// shape since MyDayService now sorts both) — route by whether the query has an
// `_id` filter (the covering lookup) vs `teacherId` (the own-periods lookup).
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    find: (q: { _id?: unknown }) => ({
      sort: () => ({ lean: () => (q._id ? mockCoveredSlotFind(q) : mockSlotFind(q)) }),
    }),
  },
}));
jest.mock("../modules/hr/models/StaffCoverSlot", () => ({
  StaffCoverSlot: { find: (q: unknown) => ({ select: () => ({ lean: () => mockCoverSlotFind(q) }) }) },
}));
// RoutineSubstitution.find is used two ways: the step-1 own-slot overlay (…lean())
// and the step-1c "periods I'm covering" lookup (…select().lean()) — support both.
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: {
    find: (q: { coverTeacherId?: unknown }) => ({
      lean: () => mockSubFind(q),
      select: () => ({ lean: () => (q.coverTeacherId ? mockMySubFind(q) : mockSubFind(q)) }),
    }),
  },
}));
// Section.find is used two ways: the homework-counts sweep ({active:true}) and the
// D-#290 classTeacherOf lookup ({classTeacherId}) — route by the filter.
jest.mock("../modules/foundation/models/Section", () => ({
  Section: {
    find: (q: { classTeacherId?: unknown }) => ({
      select: () => ({ lean: () => (q.classTeacherId ? mockCtSectionFind(q) : mockSectionFind(q)) }),
    }),
  },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (q: unknown) => ({ select: () => ({ lean: () => mockClassFind(q) }) }) },
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
// D-#279: the Today dashboard's backlog alerts + the manager presence snapshot are
// exercised in pendingAlerts.test.ts / attendanceRollup.test.ts; seams here.
jest.mock("../modules/routine/services/PendingAlertService", () => ({
  pendingWorkFor: (...a: unknown[]) => mockPendingAlerts(...a),
}));
jest.mock("../modules/attendance/services/AttendanceReportService", () => ({
  classPresenceForDate: (...a: unknown[]) => mockClassPresence(...a),
}));
jest.mock("../modules/attendance/services/StudentAttendanceService", () => ({
  myMarkingUnits: (...a: unknown[]) => mockMarking(...a),
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
  mockCoveredSlotFind.mockResolvedValue([]);
  mockSubFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([]);
  mockOverview.mockResolvedValue([]);
  mockMarking.mockResolvedValue([]);
  mockCoverSlotFind.mockResolvedValue([]);
  mockMySubFind.mockResolvedValue([]);
  mockPendingAlerts.mockResolvedValue({ alerts: [], assignmentPrep: null });
  mockClassPresence.mockResolvedValue([]);
  mockCtSectionFind.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([]);
});

describe("myDay — classTeacherOf (D-#290)", () => {
  test("a TEACHER's class-teacher sections are named with their class level", async () => {
    mockCtSectionFind.mockResolvedValue([{ _id: "sec-1", nameBn: "মূল", classId: "cls-1" }]);
    mockClassFind.mockResolvedValue([{ _id: "cls-1", level: -1 }]);
    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r.classTeacherOf).toEqual([{ sectionId: "sec-1", nameBn: "মূল", classLevel: -1 }]);
    expect(mockCtSectionFind).toHaveBeenCalledWith(
      expect.objectContaining({ classTeacherId: "user-1", active: true }),
    );
  });

  test("non-teacher roles never query for class-teacher sections", async () => {
    const r = await myDayFor(ctxFor("OFFICE"), "2026-07-01");
    expect(r.classTeacherOf).toEqual([]);
    expect(mockCtSectionFind).not.toHaveBeenCalled();
  });
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

describe("myDay — covering periods (PXG-1 gap fix, D-#268)", () => {
  test("no approved HR cover slots today → no covering rows added", async () => {
    mockCoverSlotFind.mockResolvedValue([]);
    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r.slots).toHaveLength(0);
    expect(mockCoveredSlotFind).not.toHaveBeenCalled();
  });

  test("an approved HR cover slot surfaces the absent teacher's period, marked isCovering", async () => {
    const own = { _id: oid(), track: "general", periodNumber: 1, teacherId: "user-1" };
    const routineSlotId = oid();
    mockSlotFind.mockResolvedValue([own]);
    mockCoverSlotFind.mockResolvedValue([{ routineSlotId }]);
    mockCoveredSlotFind.mockResolvedValue([
      { _id: routineSlotId, track: "general", periodNumber: 3, teacherId: "hamida-1", active: true },
    ]);

    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(mockCoverSlotFind).toHaveBeenCalledWith(
      expect.objectContaining({ finalCoverTeacherUserId: "user-1", dateKey: "2026-07-01", status: "approved" }),
    );
    expect(mockCoveredSlotFind).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $in: [routineSlotId] }, active: true }),
    );
    expect(r.slots).toHaveLength(2);
    // Merged + sorted by periodNumber: own period 1, then the covered period 3.
    expect(r.slots[0].isCovering).toBeFalsy();
    expect(r.slots[1].isCovering).toBe(true);
    expect(r.slots[1].periodNumber).toBe(3);
    expect(r.slots[1].teacherName).toBe("T"); // enriched — the ABSENT teacher's name
  });

  test("a cover slot referencing a since-deactivated RoutineSlot is silently skipped", async () => {
    mockCoverSlotFind.mockResolvedValue([{ routineSlotId: oid() }]);
    mockCoveredSlotFind.mockResolvedValue([]); // active:true filter excluded it
    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r.slots).toHaveLength(0);
  });

  test("a routine-module direct-assign cover (RoutineSubstitution) surfaces on Today, marked isCovering", async () => {
    const routineSlotId = oid();
    // No own periods, no HR cover — only a Cover-management substitution names me.
    mockSlotFind.mockResolvedValue([]);
    mockMySubFind.mockResolvedValue([{ slotId: routineSlotId }]);
    mockCoveredSlotFind.mockResolvedValue([
      { _id: routineSlotId, track: "general", periodNumber: 4, teacherId: "absent-1", active: true },
    ]);

    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(mockMySubFind).toHaveBeenCalledWith(
      expect.objectContaining({ coverTeacherId: "user-1", active: true }),
    );
    expect(r.slots).toHaveLength(1);
    expect(r.slots[0].isCovering).toBe(true);
    expect(r.slots[0].periodNumber).toBe(4);
  });

  test("a substitution for a period I already teach is not duplicated", async () => {
    const own = { _id: oid(), track: "general", periodNumber: 2, teacherId: "user-1" };
    mockSlotFind.mockResolvedValue([own]);
    mockMySubFind.mockResolvedValue([{ slotId: own._id }]); // same slot I own
    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r.slots).toHaveLength(1); // deduped, not doubled
    expect(mockCoveredSlotFind).not.toHaveBeenCalled();
  });

  test("a substitution on a holiday/off day admits nothing (day-type filtered)", async () => {
    mockResolveDayType.mockResolvedValue("HOLIDAY");
    mockMySubFind.mockResolvedValue([{ slotId: oid() }]);
    mockCoveredSlotFind.mockResolvedValue([
      { _id: oid(), track: "general", periodNumber: 1, teacherId: "absent-1", active: true },
    ]);
    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r.slots).toHaveLength(0);
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
  test("true when a marking unit is unmarked; false when all marked", async () => {
    mockMarking.mockResolvedValue([
      { unitType: "section", unitId: "s1", marked: true },
      { unitType: "subjectgroup", unitId: "q1", marked: false },
    ]);
    const r1 = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r1.attendancePending).toBe(true);
    expect(mockMarking).toHaveBeenCalledWith("user-1", "2026-07-01");

    mockMarking.mockResolvedValue([{ unitType: "section", unitId: "s1", marked: true }]);
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

  test("classPresence is Principal/Office only (D-#279) — a TEACHER never loads it", async () => {
    mockClassPresence.mockResolvedValue([{ classId: "c1", classLevel: 3, presentCount: 20 }]);

    const teacher = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(teacher.classPresence).toEqual([]);
    expect(mockClassPresence).not.toHaveBeenCalled(); // no attendance:manage

    const office = await myDayFor(ctxFor("OFFICE"), "2026-07-01");
    expect(office.classPresence).toHaveLength(1);
    expect(mockClassPresence).toHaveBeenCalledWith("2026-07-01");
  });

  test("alerts + the assignment-prep countdown pass through (each kind self-gates)", async () => {
    const prep = { dueAt: "2026-07-02T01:00:00.000Z", deliveryDateKey: "2026-07-02", weekNumber: 3, items: 1 };
    mockPendingAlerts.mockResolvedValue({
      alerts: [{ kind: "attendance", count: 2, oldestDateKey: "2026-06-29" }],
      assignmentPrep: prep,
    });
    const r = await myDayFor(ctxFor("TEACHER"), "2026-07-01");
    expect(r.alerts).toEqual([{ kind: "attendance", count: 2, oldestDateKey: "2026-06-29" }]);
    expect(r.assignmentPrep).toEqual(prep);
  });

  test("unauthenticated rejects", async () => {
    await expect(myDayFor({ auth: null } as unknown as AppContext, "2026-07-01")).rejects.toThrow();
  });
});
