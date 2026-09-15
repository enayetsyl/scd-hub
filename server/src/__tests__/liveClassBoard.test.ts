/**
 * Live class board (D-#674) — "who is standing in front of each class right now?"
 *
 * The rules under test are the ones the owner's ask turns on, and every one of them
 * is invisible to `tsc`:
 *   · an APPROVED cover shows the cover teacher's name          → COVERED
 *   · a cover that is only PROPOSED is NOT a cover              → UNCOVERED + the
 *     proposed name carried alongside the alert, never instead of it
 *   · an approved leave with no fan-out row is still an absence → UNCOVERED
 *   · an APPLIED (undecided) leave is NOT an absence            → ON_DUTY
 *   · a slot naming no teacher                                  → UNASSIGNED
 *   · the biometric sheet's ABSENT, when there is no leave      → UNCOVERED
 *   · phase/liveCount follow the clock, and the clock follows the DATE's schedule
 *     window (a winter 07:30 start slides the whole board — D-#55)
 *
 * DB-free: every model is mocked, the maths (computePeriodTimes, liveWindow) is real.
 */
import mongoose from "mongoose";

const oid = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();

// --- model mocks ------------------------------------------------------------
const mockSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (q: unknown) => ({ sort: () => ({ lean: () => mockSlotFind(q) }) }) },
}));

const mockSubFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: { find: (q: unknown) => ({ select: () => ({ lean: () => mockSubFind(q) }) }) },
}));

const mockGridFind = jest.fn();
jest.mock("../modules/routine/models/PeriodGrid", () => ({
  PeriodGrid: { find: (q: unknown) => ({ lean: () => mockGridFind(q) }) },
}));

const mockWindowFind = jest.fn();
jest.mock("../modules/routine/models/ScheduleWindow", () => ({
  ScheduleWindow: { find: (q: unknown) => ({ lean: () => mockWindowFind(q) }) },
}));

const mockGroupFind = jest.fn();
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: (q: unknown) => ({ select: () => ({ lean: () => mockGroupFind(q) }) }) },
}));

const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (q: unknown) => ({ select: () => ({ lean: () => mockSectionFind(q) }) }) },
}));

const mockClassFind = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (q: unknown) => ({ select: () => ({ lean: () => mockClassFind(q) }) }) },
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => ({ select: () => ({ lean: () => mockUserFind(q) }) }) },
}));

const mockStaffFind = jest.fn();
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: { find: (q: unknown) => ({ select: () => ({ lean: () => mockStaffFind(q) }) }) },
}));

jest.mock("../modules/foundation/services/credentials", () => ({
  normalizePhone: (p: string) => p,
}));

const mockCoverSlotFind = jest.fn();
jest.mock("../modules/hr/models/StaffCoverSlot", () => ({
  StaffCoverSlot: { find: (q: unknown) => ({ select: () => ({ lean: () => mockCoverSlotFind(q) }) }) },
}));

const mockTeacherAttFind = jest.fn();
jest.mock("../modules/attendance/models/TeacherAttendanceDay", () => ({
  TeacherAttendanceDay: { find: (q: unknown) => ({ select: () => ({ lean: () => mockTeacherAttFind(q) }) }) },
}));

const mockHolidayFindOne = jest.fn();
jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: { findOne: (q: unknown) => ({ lean: () => mockHolidayFindOne(q) }) },
}));

const mockUserIdsOnLeave = jest.fn();
jest.mock("../modules/hr/services/CoverService", () => ({
  userIdsOnLeave: (dateKey: unknown, period: unknown, statuses: unknown) =>
    mockUserIdsOnLeave(dateKey, period, statuses),
}));

import { liveClassBoard } from "../modules/routine/services/LiveClassBoardService";

// --- fixture ----------------------------------------------------------------
const TUESDAY = "2026-09-15"; // getDay() === 2 → "TUE"
const SATURDAY = "2026-09-19"; // getDay() === 6 → QURAN_ONLY
const at = (hhmm: string, dateKey = TUESDAY): Date => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0);
};

const teacherA = oid();
const teacherB = oid();
const coverC = oid();
const classId = oid();
const sectionId = oid();
const slot1 = oid();
const slot2 = oid();

/** Class 1–5: P1 45m, P2 45m, P3 40m (the V3 shape, trimmed to what the tests need). */
const CLASS_GRID = {
  audienceKey: "class_1_5",
  season: "regular",
  periods: [
    { number: 1, durationMin: 45, isBreak: false, track: "quran", nameBn: "১ম" },
    { number: 2, durationMin: 45, isBreak: false, track: "quran", nameBn: "২য়" },
    { number: 3, durationMin: 40, isBreak: false, track: "arabic", nameBn: "৩য়" },
  ],
};
const NURSERY_GRID = {
  audienceKey: "nursery_kg",
  season: "regular",
  periods: [
    { number: 1, durationMin: 30, isBreak: false, track: "general", nameBn: "১ম" },
    { number: 2, durationMin: 30, isBreak: false, track: "general", nameBn: "২য়" },
  ],
};

const sectionSlot = (id: mongoose.Types.ObjectId, periodNumber: number, teacherId: mongoose.Types.ObjectId | null) => ({
  _id: id,
  groupType: "section",
  groupId: sectionId,
  classId,
  dayOfWeek: "TUE",
  periodNumber,
  subject: "BAN",
  track: "general",
  isBreak: false,
  ...(teacherId ? { teacherId } : {}),
  effectiveFrom: new Date("2026-01-01"),
  active: true,
});

/** Default happy state: one Class-3 section, two periods, teacher A then B, nothing wrong. */
function primeDefaults(): void {
  mockHolidayFindOne.mockResolvedValue(null);
  mockWindowFind.mockResolvedValue([
    { season: "regular", dayStartMinutes: 420, fromDate: new Date("2026-01-01"), toDate: new Date("2026-11-30") },
  ]);
  mockGridFind.mockResolvedValue([CLASS_GRID, NURSERY_GRID]);
  mockSlotFind.mockResolvedValue([sectionSlot(slot1, 1, teacherA), sectionSlot(slot2, 2, teacherB)]);
  mockSectionFind.mockResolvedValue([{ _id: sectionId, nameBn: "বালক", classId }]);
  mockClassFind.mockResolvedValue([{ _id: classId, nameBn: "তৃতীয় শ্রেণি", level: 3 }]);
  mockGroupFind.mockResolvedValue([]);
  mockSubFind.mockResolvedValue([]);
  mockCoverSlotFind.mockResolvedValue([]);
  mockTeacherAttFind.mockResolvedValue([]);
  mockStaffFind.mockResolvedValue([]);
  mockUserIdsOnLeave.mockResolvedValue(new Set<string>());
  mockUserFind.mockResolvedValue([
    { _id: teacherA, name: "Hamida Akter" },
    { _id: teacherB, name: "Md Abdul Momin" },
    { _id: coverC, name: "Rubina Khanam" },
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  primeDefaults();
});

describe("liveClassBoard — who takes each period", () => {
  test("nothing against the teacher → ON_DUTY, named from the routine", async () => {
    const board = await liveClassBoard(TUESDAY, at("07:10"));
    expect(board.cells).toHaveLength(2);
    expect(board.cells[0]).toMatchObject({
      periodNumber: 1,
      status: "ON_DUTY",
      teacherName: "Hamida Akter",
      coverTeacherName: null,
      absenceReason: null,
    });
    expect(board.uncoveredTodayCount).toBe(0);
  });

  test("an APPROVED HR cover shows the cover teacher — the absent teacher stays named", async () => {
    mockCoverSlotFind.mockResolvedValue([
      { routineSlotId: slot1, status: "approved", finalCoverTeacherUserId: coverC, proposedCoverTeacherId: coverC },
    ]);
    const board = await liveClassBoard(TUESDAY, at("07:10"));
    expect(board.cells[0]).toMatchObject({
      status: "COVERED",
      teacherName: "Hamida Akter",
      coverTeacherName: "Rubina Khanam",
      absenceReason: "leave",
      coverSlotStatus: null,
    });
    expect(board.uncoveredNowCount).toBe(0);
  });

  test("a PROPOSED cover is not a cover — the class is flagged, the proposal shown beside it", async () => {
    mockCoverSlotFind.mockResolvedValue([
      { routineSlotId: slot1, status: "proposed", finalCoverTeacherUserId: null, proposedCoverTeacherId: coverC },
    ]);
    const board = await liveClassBoard(TUESDAY, at("07:10"));
    expect(board.cells[0]).toMatchObject({
      status: "UNCOVERED",
      coverTeacherName: null,
      pendingCoverTeacherName: "Rubina Khanam",
      coverSlotStatus: "proposed",
      absenceReason: "leave_pending",
    });
    expect(board.uncoveredNowCount).toBe(1);
    expect(board.uncoveredTodayCount).toBe(1);
  });

  test("a needs_cover row is flagged with no proposal to show", async () => {
    mockCoverSlotFind.mockResolvedValue([
      { routineSlotId: slot2, status: "needs_cover", finalCoverTeacherUserId: null, proposedCoverTeacherId: null },
    ]);
    const board = await liveClassBoard(TUESDAY, at("07:10"));
    const p2 = board.cells.find((c) => c.periodNumber === 2)!;
    expect(p2).toMatchObject({ status: "UNCOVERED", pendingCoverTeacherName: null, absenceReason: "leave" });
  });

  test("an approved leave with no fan-out row still flags the class", async () => {
    mockUserIdsOnLeave.mockResolvedValue(new Set([teacherA.toString()]));
    const board = await liveClassBoard(TUESDAY, at("07:10"));
    expect(board.cells[0]).toMatchObject({ status: "UNCOVERED", absenceReason: "leave" });
    // ONLY approved leaves count here — an applied one means the teacher is expected.
    for (const call of mockUserIdsOnLeave.mock.calls) expect(call[2]).toEqual(["approved"]);
  });

  test("a direct routine-module substitution counts as an approved cover", async () => {
    mockSubFind.mockResolvedValue([{ slotId: slot1, coverTeacherId: coverC }]);
    const board = await liveClassBoard(TUESDAY, at("07:10"));
    expect(board.cells[0]).toMatchObject({ status: "COVERED", coverTeacherName: "Rubina Khanam" });
  });

  test("a slot naming no teacher is UNASSIGNED, not silently fine", async () => {
    mockSlotFind.mockResolvedValue([sectionSlot(slot1, 1, null)]);
    const board = await liveClassBoard(TUESDAY, at("07:10"));
    expect(board.cells[0]).toMatchObject({ status: "UNASSIGNED", teacherName: null });
    expect(board.uncoveredTodayCount).toBe(1);
  });

  test("the biometric sheet's ABSENT flags a class nobody filed leave for", async () => {
    const staffId = oid();
    mockTeacherAttFind.mockResolvedValue([{ staffProfileId: staffId }]);
    mockStaffFind.mockResolvedValue([{ _id: staffId, phone: "01711000000" }]);
    mockUserFind
      .mockResolvedValueOnce([{ _id: teacherA }]) // the phone → user join
      .mockResolvedValueOnce([
        { _id: teacherA, name: "Hamida Akter" },
        { _id: teacherB, name: "Md Abdul Momin" },
      ]);
    const board = await liveClassBoard(TUESDAY, at("07:10"));
    expect(board.cells[0]).toMatchObject({ status: "UNCOVERED", absenceReason: "attendance_absent" });
  });

  test("an unimported biometric sheet says nothing at all", async () => {
    mockTeacherAttFind.mockResolvedValue([]);
    const board = await liveClassBoard(TUESDAY, at("07:10"));
    expect(board.cells.every((c) => c.status === "ON_DUTY")).toBe(true);
    expect(mockStaffFind).not.toHaveBeenCalled();
  });
});

describe("liveClassBoard — the clock", () => {
  test("phase follows the period times; only the running period is live", async () => {
    const board = await liveClassBoard(TUESDAY, at("08:00")); // P1 07:00–07:45, P2 07:45–08:30
    expect(board.cells.find((c) => c.periodNumber === 1)!.phase).toBe("past");
    expect(board.cells.find((c) => c.periodNumber === 2)!.phase).toBe("current");
    expect(board.liveCount).toBe(1);
    expect(board.nowHHMM).toBe("08:00");
  });

  test("before the first bell nothing is live; after the last, nothing is", async () => {
    expect((await liveClassBoard(TUESDAY, at("06:30"))).liveCount).toBe(0);
    expect((await liveClassBoard(TUESDAY, at("13:00"))).liveCount).toBe(0);
  });

  test("uncoveredNow counts only the period running now, uncoveredToday the whole day", async () => {
    mockCoverSlotFind.mockResolvedValue([
      { routineSlotId: slot1, status: "needs_cover", finalCoverTeacherUserId: null, proposedCoverTeacherId: null },
      { routineSlotId: slot2, status: "needs_cover", finalCoverTeacherUserId: null, proposedCoverTeacherId: null },
    ]);
    const board = await liveClassBoard(TUESDAY, at("08:00"));
    expect(board.uncoveredNowCount).toBe(1);
    expect(board.uncoveredTodayCount).toBe(2);
  });

  test("the DATE's schedule window sets the times — a winter 07:30 start slides the board", async () => {
    mockWindowFind.mockResolvedValue([
      { season: "winter", dayStartMinutes: 450, fromDate: new Date("2026-09-01"), toDate: new Date("2026-09-30") },
    ]);
    mockGridFind.mockResolvedValue([{ ...CLASS_GRID, season: "winter" }]);
    const board = await liveClassBoard(TUESDAY, at("07:40"));
    expect(board.season).toBe("winter");
    expect(board.dayStartHHMM).toBe("07:30");
    expect(board.cells[0]).toMatchObject({ startTime: "07:30", endTime: "08:15", phase: "current" });
    // At 07:40 the REGULAR board would already be in period 2 — the winter one is not.
    expect(board.liveCount).toBe(1);
  });

  test("a Nursery/KG row reads its OWN grid, not the class 1–5 columns", async () => {
    const kgClass = oid();
    const kgSection = oid();
    mockSlotFind.mockResolvedValue([
      { ...sectionSlot(slot1, 2, teacherA), groupId: kgSection, classId: kgClass },
    ]);
    mockSectionFind.mockResolvedValue([{ _id: kgSection, nameBn: "মূল", classId: kgClass }]);
    mockClassFind.mockResolvedValue([{ _id: kgClass, nameBn: "নার্সারি", level: -1 }]);
    const board = await liveClassBoard(TUESDAY, at("07:40"));
    // nursery P2 = 07:30–08:00 (2 × 30m), NOT the class-1-5 07:45–08:30.
    expect(board.cells[0]).toMatchObject({ startTime: "07:30", endTime: "08:00", classLevel: -1 });
    // A whole-class section contributes no sublabel — the class name stands alone.
    expect(board.rows[0]).toMatchObject({ label: "নার্সারি", sublabel: null });
  });
});

describe("liveClassBoard — the calendar decides whether there is a board at all", () => {
  test("a holiday returns an empty board, not a day full of uncovered classes", async () => {
    mockHolidayFindOne.mockResolvedValue({ _id: oid() });
    const board = await liveClassBoard(TUESDAY, at("07:10"));
    expect(board.dayType).toBe("HOLIDAY");
    expect(board.cells).toEqual([]);
    expect(board.uncoveredTodayCount).toBe(0);
    expect(mockSlotFind).not.toHaveBeenCalled();
  });

  test("Saturday admits the Quran track only (R2.1)", async () => {
    mockSlotFind.mockResolvedValue([
      { ...sectionSlot(slot1, 1, teacherA), dayOfWeek: "SAT", track: "quran", subject: "QURAN" },
      { ...sectionSlot(slot2, 2, teacherB), dayOfWeek: "SAT", track: "general" },
    ]);
    const board = await liveClassBoard(SATURDAY, at("07:10", SATURDAY));
    expect(board.dayType).toBe("QURAN_ONLY");
    expect(board.cells).toHaveLength(1);
    expect(board.cells[0].subject).toBe("QURAN");
  });
});
