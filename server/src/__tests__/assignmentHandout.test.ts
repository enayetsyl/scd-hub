/**
 * AS-T7 (D-#643) — the last-period assignment handout board.
 *
 * What is pinned here is the JOIN, because every part of it already existed and
 * only the wiring is new:
 *   - the handout teacher is the section's LAST **section** period, cover-overlaid
 *     through BOTH mechanisms (RoutineSubstitution R-4 and the HR StaffCoverSlot)
 *   - a nil-declared cell is NAMED, not counted — it must not inflate the number a
 *     teacher cross-checks the paper stack against
 *   - `myHandoutSections` is delivery-day-only, and empty for a teacher who takes an
 *     earlier period of a section rather than its last
 *   - a section with expected packets and NO resolvable last period still appears,
 *     with a null teacher — that is the office's warning, not a row to drop
 *   - no year / no schedule / a throwing week yields an EMPTY board, never an error
 *
 * DB-free: models and the expected-week read are mocked; the join is real.
 */
const mockYearFindOne = jest.fn();
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: { findOne: (f: unknown) => ({ select: () => ({ lean: () => mockYearFindOne(f) }) }) },
}));

const mockScheduleFindOne = jest.fn();
jest.mock("../modules/trackers/models/AssignmentSchedule", () => ({
  AssignmentSchedule: {
    findOne: (f: unknown) => ({ select: () => ({ lean: () => mockScheduleFindOne(f) }) }),
  },
}));

const mockExpectedWeek = jest.fn();
jest.mock("../modules/trackers/services/AssignmentScheduleService", () => ({
  expectedItemsForWeek: (...a: unknown[]) => mockExpectedWeek(...a),
}));

const mockSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (f: unknown) => ({ lean: () => mockSlotFind(f) }) },
}));

const mockSubFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: { find: (f: unknown) => ({ select: () => ({ lean: () => mockSubFind(f) }) }) },
}));

const mockCoverSlotFind = jest.fn();
jest.mock("../modules/hr/models/StaffCoverSlot", () => ({
  StaffCoverSlot: { find: (f: unknown) => ({ select: () => ({ lean: () => mockCoverSlotFind(f) }) }) },
}));

const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (f: unknown) => ({ select: () => ({ lean: () => mockSectionFind(f) }) }) },
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => ({ select: () => ({ lean: () => mockUserFind(f) }) }) },
}));

const mockPrintFind = jest.fn();
jest.mock("../modules/printing/models/PrintRequest", () => ({
  PrintRequest: { find: (f: unknown) => ({ select: () => ({ lean: () => mockPrintFind(f) }) }) },
}));

const mockDayType = jest.fn();
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: unknown) => mockDayType(d),
  dayTypeAdmitsTrack: (dayType: string, track: string) =>
    dayType === "FULL" ? true : dayType === "QURAN_ONLY" ? track === "quran" : false,
}));

// The Class model is only pulled in through the module graph; keep it inert.
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: () => ({ select: () => ({ lean: () => [] }) }) },
}));

import {
  handoutBoard,
  myHandoutSections,
  packetCount,
  unprintedCount,
} from "../modules/trackers/services/AssignmentHandoutService";

/** THU 2026-07-16 is the delivery day of the week the tests run in. */
const DELIVERY = "2026-07-16";
const deliveryDate = (): Date => new Date(2026, 6, 16);

const cell = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  entryId: "e1",
  cycleWeek: 1,
  classId: "c3",
  classLevel: 3,
  sectionId: "sA",
  subject: "BAN",
  teacherId: "subjT",
  delivered: false,
  status: null,
  asItemId: null,
  asId: null,
  estMinutes: null,
  totalMarks: null,
  description: null,
  nilDeclared: false,
  nilReason: null,
  nilDeclarationId: null,
  ...over,
});

const slot = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  _id: { toString: () => "slot1" },
  groupType: "section",
  groupId: { toString: () => "sA" },
  classId: { toString: () => "c3" },
  periodNumber: 8,
  subject: "MATH",
  track: "general",
  isBreak: false,
  teacherId: { toString: () => "lastT" },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockYearFindOne.mockResolvedValue({ _id: { toString: () => "y1" } });
  // termStartDate is a Sunday; 2026-07-16 lands inside a week ≥ 1.
  mockScheduleFindOne.mockResolvedValue({ termStartDate: new Date(2026, 5, 28) });
  mockExpectedWeek.mockResolvedValue({
    academicYearId: "y1",
    weekNumber: 3,
    cycleWeek: 3,
    weekStart: "2026-07-12T00:00:00.000Z",
    year: 2026,
    month: 7,
    weekOfMonth: 3,
    suspended: false,
    deliveryDate: `${DELIVERY}T00:00:00.000Z`,
    dueDate: "2026-07-19T00:00:00.000Z",
    items: [cell()],
  });
  mockDayType.mockResolvedValue("FULL");
  mockSlotFind.mockResolvedValue([slot()]);
  mockSubFind.mockResolvedValue([]);
  mockCoverSlotFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([{ _id: { toString: () => "sA" }, nameBn: "ক" }]);
  mockUserFind.mockResolvedValue([
    { _id: { toString: () => "lastT" }, name: "শেষ পিরিয়ডের শিক্ষক" },
    { _id: { toString: () => "subjT" }, name: "বিষয় শিক্ষক" },
    { _id: { toString: () => "coverT" }, name: "প্রক্সি শিক্ষক" },
  ]);
  mockPrintFind.mockResolvedValue([]);
});

describe("D-#643 handoutBoard", () => {
  test("names the section's LAST section-period teacher as the one who hands out", async () => {
    mockSlotFind.mockResolvedValue([
      slot({ _id: { toString: () => "early" }, periodNumber: 2, teacherId: { toString: () => "subjT" } }),
      slot(),
    ]);
    const board = await handoutBoard(deliveryDate());
    expect(board.isDeliveryToday).toBe(true);
    expect(board.deliveryDateKey).toBe(DELIVERY);
    expect(board.sections).toHaveLength(1);
    expect(board.sections[0]).toMatchObject({
      sectionId: "sA",
      sectionNameBn: "ক",
      lastPeriodNumber: 8,
      handoutTeacherId: "lastT",
      handoutTeacherName: "শেষ পিরিয়ডের শিক্ষক",
      isCover: false,
    });
  });

  test("only SECTION slots are considered — a cross-grade group period is not the anchor", async () => {
    await handoutBoard(deliveryDate());
    expect(mockSlotFind).toHaveBeenCalledWith(expect.objectContaining({ groupType: "section", isBreak: false }));
  });

  test("a RoutineSubstitution hands the packets to the cover teacher", async () => {
    mockSubFind.mockResolvedValue([
      { slotId: { toString: () => "slot1" }, coverTeacherId: { toString: () => "coverT" } },
    ]);
    const [sec] = (await handoutBoard(deliveryDate())).sections;
    expect(sec.handoutTeacherId).toBe("coverT");
    expect(sec.isCover).toBe(true);
  });

  test("an approved StaffCoverSlot does the same (the second cover mechanism)", async () => {
    mockCoverSlotFind.mockResolvedValue([
      { routineSlotId: { toString: () => "slot1" }, finalCoverTeacherUserId: { toString: () => "coverT" } },
    ]);
    const [sec] = (await handoutBoard(deliveryDate())).sections;
    expect(sec.handoutTeacherId).toBe("coverT");
    expect(sec.isCover).toBe(true);
  });

  test("a nil-declared subject is named separately and never counted as a packet", async () => {
    mockExpectedWeek.mockResolvedValue({
      weekNumber: 3,
      suspended: false,
      deliveryDate: `${DELIVERY}T00:00:00.000Z`,
      items: [
        cell(),
        cell({ entryId: "e2", subject: "MATH", nilDeclared: true, nilReason: "EXAM_WEEK" }),
      ],
    });
    const [sec] = (await handoutBoard(deliveryDate())).sections;
    expect(sec.packets.map((p) => p.subject)).toEqual(["BAN"]);
    expect(sec.nilPackets.map((p) => p.subject)).toEqual(["MATH"]);
    expect(packetCount([sec])).toBe(1);
  });

  test("printRequested matches (section × subject) on the delivery date only", async () => {
    mockExpectedWeek.mockResolvedValue({
      weekNumber: 3,
      suspended: false,
      deliveryDate: `${DELIVERY}T00:00:00.000Z`,
      items: [cell(), cell({ entryId: "e2", subject: "MATH" })],
    });
    mockPrintFind.mockResolvedValue([{ sectionId: { toString: () => "sA" }, subject: "BAN" }]);
    const [sec] = (await handoutBoard(deliveryDate())).sections;
    expect(sec.packets.find((p) => p.subject === "BAN")!.printRequested).toBe(true);
    expect(sec.packets.find((p) => p.subject === "MATH")!.printRequested).toBe(false);
    expect(unprintedCount([sec])).toBe(1);
    expect(mockPrintFind).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "ASSIGNMENT", neededByKey: DELIVERY }),
    );
  });

  test("a section with packets but no routine slot is KEPT, with a null teacher", async () => {
    mockSlotFind.mockResolvedValue([]);
    const [sec] = (await handoutBoard(deliveryDate())).sections;
    expect(sec.handoutTeacherId).toBeNull();
    expect(sec.lastPeriodNumber).toBeNull();
    expect(sec.packets).toHaveLength(1);
  });

  test("a suspended week yields no sections but still reports the week", async () => {
    mockExpectedWeek.mockResolvedValue({ weekNumber: 3, suspended: true, deliveryDate: null, items: [] });
    const board = await handoutBoard(deliveryDate());
    expect(board.sections).toEqual([]);
    expect(board.weekNumber).toBe(3);
    expect(board.deliveryDateKey).toBeNull();
  });

  test("no academic year at all yields an empty board", async () => {
    // BOTH lookups must miss: `current: true` defaults to false school-wide, so the
    // covering-range fallback is the one that usually answers (the D-#280 find).
    mockYearFindOne.mockResolvedValue(null);
    expect((await handoutBoard(deliveryDate())).sections).toEqual([]);
    expect(mockYearFindOne).toHaveBeenCalledTimes(2);
  });

  test("the covering-range fallback answers when no year is flagged current", async () => {
    mockYearFindOne.mockResolvedValueOnce(null);
    expect((await handoutBoard(deliveryDate())).sections).toHaveLength(1);
  });

  test("no schedule, or a throwing week, each yield an empty board rather than an error", async () => {
    mockScheduleFindOne.mockResolvedValueOnce(null);
    expect((await handoutBoard(deliveryDate())).sections).toEqual([]);

    mockExpectedWeek.mockRejectedValueOnce(new Error("No AssignmentSchedule for this academic year"));
    await expect(handoutBoard(deliveryDate())).resolves.toMatchObject({ sections: [] });
  });

  test("the board is NOT resolved on the routine of the day asked for, but of the DELIVERY day", async () => {
    // Asked on Tuesday; the slot query must still be for Thursday's routine.
    await handoutBoard(new Date(2026, 6, 14));
    expect(mockSlotFind).toHaveBeenCalledWith(expect.objectContaining({ dayOfWeek: "THU" }));
  });
});

describe("D-#643 myHandoutSections", () => {
  test("the last-period teacher gets the section; an earlier-period teacher gets nothing", async () => {
    await expect(myHandoutSections("lastT", deliveryDate())).resolves.toHaveLength(1);
    await expect(myHandoutSections("subjT", deliveryDate())).resolves.toEqual([]);
  });

  test("empty on a day that is not the delivery day, even though the week has packets", async () => {
    const board = await handoutBoard(new Date(2026, 6, 14), { forTeacherId: "lastT" });
    expect(board.sections).toHaveLength(1); // the board still shows it (preparation)

    // …and the Today read stops BEFORE the slot/cover/name/print lookups, because it
    // would only throw the result away. This runs on every dashboard load.
    jest.clearAllMocks();
    mockYearFindOne.mockResolvedValue({ _id: { toString: () => "y1" } });
    mockScheduleFindOne.mockResolvedValue({ termStartDate: new Date(2026, 5, 28) });
    mockExpectedWeek.mockResolvedValue({
      weekNumber: 3,
      suspended: false,
      deliveryDate: `${DELIVERY}T00:00:00.000Z`,
      items: [cell()],
    });
    await expect(myHandoutSections("lastT", new Date(2026, 6, 14))).resolves.toEqual([]);
    expect(mockSlotFind).not.toHaveBeenCalled();
    expect(mockPrintFind).not.toHaveBeenCalled();
  });

  test("the cover teacher — not the absent owner — is handed the list", async () => {
    mockSubFind.mockResolvedValue([
      { slotId: { toString: () => "slot1" }, coverTeacherId: { toString: () => "coverT" } },
    ]);
    await expect(myHandoutSections("coverT", deliveryDate())).resolves.toHaveLength(1);
    await expect(myHandoutSections("lastT", deliveryDate())).resolves.toEqual([]);
  });
});
