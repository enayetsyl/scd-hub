/**
 * D-#279 — the Today dashboard's RED backlog alerts: work owed TODAY or on a previous
 * school day, over a 7-day look-back.
 *
 *   1. window + day-types — holidays are loaded ONCE (not resolveDayType per day);
 *      only FULL days can owe attendance
 *   2. attendance  — delegates to the batched `unmarkedMarkingDays`, reports pending
 *      DAY count + the oldest date
 *   3. class_note  — a period with no note owes a note, but only on a day whose
 *      day-type admits that period's track; slots outside their effective window and
 *      days on the wrong weekday never count
 *   4. assignment_entry — items past their delivery date and NOT delivered (owner
 *      ruling: "not delivered", not "not checked"); a future delivery date is silent
 *   5. permission degradation — a caller lacking a permission contributes no alert
 *
 * DB-free: models + the two delegated services are mocked; the composition is real.
 */
const mockHolidayFind = jest.fn();
const mockSlotFind = jest.fn();
const mockNoteFind = jest.fn();
const mockUnmarkedMarkingDays = jest.fn();
const mockYearFindOne = jest.fn();
const mockScheduleFindOne = jest.fn();
const mockExpectedItemsForWeek = jest.fn();
const mockWeekNumberFor = jest.fn();

jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: { find: (f: unknown) => ({ select: () => ({ lean: () => mockHolidayFind(f) }) }) },
}));
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (f: unknown) => ({ lean: () => mockSlotFind(f) }) },
}));
jest.mock("../modules/routine/models/ClassNote", () => ({
  ClassNote: { find: (f: unknown) => ({ select: () => ({ lean: () => mockNoteFind(f) }) }) },
}));
jest.mock("../modules/attendance/attendanceBacklog", () => ({
  unmarkedMarkingDays: (...a: unknown[]) => mockUnmarkedMarkingDays(...a),
}));
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: { findOne: (f: unknown) => ({ select: () => ({ lean: () => mockYearFindOne(f) }) }) },
}));
jest.mock("../modules/trackers/models/AssignmentSchedule", () => ({
  AssignmentSchedule: { findOne: (f: unknown) => ({ select: () => ({ lean: () => mockScheduleFindOne(f) }) }) },
}));
jest.mock("../modules/trackers/services/AssignmentScheduleService", () => ({
  expectedItemsForWeek: (...a: unknown[]) => mockExpectedItemsForWeek(...a),
}));
jest.mock("../modules/trackers/assignmentCalendar", () => ({
  weekNumberFor: (...a: unknown[]) => mockWeekNumberFor(...a),
}));

import { pendingAlertsFor, BACKLOG_DAYS } from "../modules/routine/services/PendingAlertService";
import type { AppContext } from "../context";

// Thu 2026-06-11. The 7-day window is 2026-06-05 (Fri) .. 2026-06-11 (Thu).
const TODAY = new Date(2026, 5, 11);
const TODAY_KEY = "2026-06-11";
const USER = "user-1";

const ctxFor = (role: string): AppContext => ({ auth: { userId: USER, role } }) as unknown as AppContext;

const slot = (id: string, dayOfWeek: string, track = "general") => ({
  _id: id,
  dayOfWeek,
  track,
  effectiveFrom: new Date(2026, 0, 1),
  effectiveTo: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockHolidayFind.mockResolvedValue([]);
  mockSlotFind.mockResolvedValue([]);
  mockNoteFind.mockResolvedValue([]);
  mockUnmarkedMarkingDays.mockResolvedValue([]);
  mockYearFindOne.mockResolvedValue(null);
  mockScheduleFindOne.mockResolvedValue(null);
  mockExpectedItemsForWeek.mockResolvedValue({ suspended: false, deliveryDate: null, items: [] });
  mockWeekNumberFor.mockReturnValue(5);
});

describe("window + day-types", () => {
  test("holidays are fetched ONCE for the whole window, not per day", async () => {
    await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    expect(mockHolidayFind).toHaveBeenCalledTimes(1);
  });

  test("only FULL days are offered to the attendance backlog (Fri/Sat excluded)", async () => {
    await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    const fullDays = mockUnmarkedMarkingDays.mock.calls[0][1] as string[];
    // Window 06-05(Fri) .. 06-11(Thu): Fri=OFF, Sat=QURAN_ONLY → 5 FULL days Sun..Thu.
    expect(fullDays).toEqual(["2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11"]);
    expect(fullDays).toHaveLength(BACKLOG_DAYS - 2);
  });

  test("a holiday covering a weekday removes it from the FULL days", async () => {
    mockHolidayFind.mockResolvedValue([{ fromDate: new Date(2026, 5, 9), toDate: new Date(2026, 5, 9) }]);
    await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    const fullDays = mockUnmarkedMarkingDays.mock.calls[0][1] as string[];
    expect(fullDays).not.toContain("2026-06-09");
  });
});

describe("attendance alert", () => {
  test("reports the pending DAY count and the oldest date", async () => {
    mockUnmarkedMarkingDays.mockResolvedValue(["2026-06-08", "2026-06-11"]);
    const alerts = await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    const a = alerts.find((x) => x.kind === "attendance")!;
    expect(a.count).toBe(2);
    expect(a.oldestDateKey).toBe("2026-06-08");
  });

  test("no pending days → no attendance alert at all", async () => {
    const alerts = await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "attendance")).toBeUndefined();
  });
});

describe("class_note alert", () => {
  test("a Thursday period with no note owes a note today", async () => {
    mockSlotFind.mockResolvedValue([slot("s1", "THU")]);
    const alerts = await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    const a = alerts.find((x) => x.kind === "class_note")!;
    expect(a.count).toBe(1);
    expect(a.oldestDateKey).toBe(TODAY_KEY);
  });

  test("a written note clears that day", async () => {
    mockSlotFind.mockResolvedValue([slot("s1", "THU")]);
    mockNoteFind.mockResolvedValue([{ slotId: "s1", date: TODAY }]);
    const alerts = await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "class_note")).toBeUndefined();
  });

  test("a general-track period owes nothing on Saturday (QURAN_ONLY admits only quran)", async () => {
    mockSlotFind.mockResolvedValue([slot("s1", "SAT", "general")]);
    const alerts = await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "class_note")).toBeUndefined();
  });

  test("a QURAN-track period DOES owe a note on Saturday", async () => {
    mockSlotFind.mockResolvedValue([slot("s1", "SAT", "quran")]);
    const alerts = await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    const a = alerts.find((x) => x.kind === "class_note")!;
    expect(a.count).toBe(1);
    expect(a.oldestDateKey).toBe("2026-06-06"); // the Saturday in the window
  });

  test("a slot whose effective window ended is ignored", async () => {
    mockSlotFind.mockResolvedValue([
      { ...slot("s1", "THU"), effectiveTo: new Date(2026, 4, 1) }, // ended in May
    ]);
    const alerts = await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "class_note")).toBeUndefined();
  });
});

describe("assignment_entry alert (owner ruling: NOT DELIVERED)", () => {
  const withSchedule = (): void => {
    mockYearFindOne.mockResolvedValue({ _id: "yr-1" });
    mockScheduleFindOne.mockResolvedValue({ termStartDate: new Date(2026, 3, 1) });
    mockWeekNumberFor.mockReturnValue(2);
  };

  test("an undelivered item past its delivery date is reported as an ITEM count", async () => {
    withSchedule();
    mockExpectedItemsForWeek.mockImplementation((_yr: string, week: number) =>
      Promise.resolve(
        week === 2
          ? {
              suspended: false,
              deliveryDate: "2026-06-09",
              items: [
                { teacherId: USER, delivered: false },
                { teacherId: USER, delivered: true },
                { teacherId: "other", delivered: false },
              ],
            }
          : { suspended: false, deliveryDate: "2026-06-02", items: [] },
      ),
    );
    const alerts = await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    const a = alerts.find((x) => x.kind === "assignment_entry")!;
    expect(a.count).toBe(1); // only MY undelivered item
    expect(a.oldestDateKey).toBe("2026-06-09");
  });

  test("a delivery date still in the future is silent (not yet owed)", async () => {
    withSchedule();
    mockExpectedItemsForWeek.mockResolvedValue({
      suspended: false,
      deliveryDate: "2026-06-18",
      items: [{ teacherId: USER, delivered: false }],
    });
    const alerts = await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "assignment_entry")).toBeUndefined();
  });

  test("a suspended week owes nothing", async () => {
    withSchedule();
    mockExpectedItemsForWeek.mockResolvedValue({
      suspended: true,
      deliveryDate: "2026-06-09",
      items: [{ teacherId: USER, delivered: false }],
    });
    const alerts = await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "assignment_entry")).toBeUndefined();
  });

  test("no academic year / no schedule → silent, never an error", async () => {
    const alerts = await pendingAlertsFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "assignment_entry")).toBeUndefined();
    expect(mockExpectedItemsForWeek).not.toHaveBeenCalled();
  });
});

describe("permission degradation", () => {
  test("GUARDIAN gets no alerts and touches no gated seam", async () => {
    mockUnmarkedMarkingDays.mockResolvedValue(["2026-06-11"]);
    mockSlotFind.mockResolvedValue([slot("s1", "THU")]);
    const alerts = await pendingAlertsFor(ctxFor("GUARDIAN"), TODAY);
    expect(alerts).toEqual([]);
    expect(mockUnmarkedMarkingDays).not.toHaveBeenCalled();
    expect(mockSlotFind).not.toHaveBeenCalled();
  });

  test("unauthenticated → no alerts", async () => {
    expect(await pendingAlertsFor({ auth: null } as unknown as AppContext, TODAY)).toEqual([]);
  });

  test("OFFICE holds routine:read (class notes) but not attendance:mark", async () => {
    mockUnmarkedMarkingDays.mockResolvedValue(["2026-06-11"]);
    await pendingAlertsFor(ctxFor("OFFICE"), TODAY);
    expect(mockUnmarkedMarkingDays).not.toHaveBeenCalled(); // no attendance:mark
    expect(mockSlotFind).toHaveBeenCalled(); // routine:read
  });
});
