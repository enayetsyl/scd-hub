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
 *   4. assignment — undelivered items split at the DEADLINE INSTANT (07:00 on the
 *      resolved delivery date): before it a countdown (D-#280), at/after it the red
 *      overdue alert (D-#279). Delivering clears both.
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
const mockWindowFindOne = jest.fn();

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
jest.mock("../modules/routine/models/ScheduleWindow", () => ({
  ScheduleWindow: {
    findOne: (f: unknown) => ({ sort: () => ({ select: () => ({ lean: () => mockWindowFindOne(f) }) }) }),
  },
}));

import { pendingAlertsFor, pendingWorkFor, BACKLOG_DAYS } from "../modules/routine/services/PendingAlertService";
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
  mockWindowFindOne.mockResolvedValue({ dayStartMinutes: 420 }); // 07:00
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

describe("assignment: countdown then overdue, split at the 07:00 deadline (D-#279/#280)", () => {
  const withSchedule = (): void => {
    mockYearFindOne.mockResolvedValue({ _id: "yr-1" });
    mockScheduleFindOne.mockResolvedValue({ termStartDate: new Date(2026, 3, 1) });
    // Week 1 by default → weeks == [1], so one mockResolvedValue is unambiguous.
    // Tests that need a previous week bump this to 2 and use mockImplementation.
    mockWeekNumberFor.mockReturnValue(1);
  };
  const week = (deliveryDate: string | null, items: unknown[], suspended = false) =>
    Promise.resolve({ suspended, deliveryDate, items });

  test("an undelivered item PAST its deadline is the red overdue alert, counted as ITEMS", async () => {
    withSchedule();
    mockWeekNumberFor.mockReturnValue(2);
    mockExpectedItemsForWeek.mockImplementation((_yr: string, w: number) =>
      w === 2
        ? week("2026-06-09", [
            { teacherId: USER, delivered: false },
            { teacherId: USER, delivered: true },
            { teacherId: "other", delivered: false },
          ])
        : week("2026-06-02", []),
    );
    const { alerts, assignmentPrep } = await pendingWorkFor(ctxFor("TEACHER"), TODAY);
    const a = alerts.find((x) => x.kind === "assignment_entry")!;
    expect(a.count).toBe(1); // only MY undelivered item
    expect(a.oldestDateKey).toBe("2026-06-09");
    expect(assignmentPrep).toBeNull(); // past the deadline → no countdown
  });

  test("a FUTURE delivery is a countdown, not an alert — dueAt is 07:00 local on that date", async () => {
    withSchedule();
    mockExpectedItemsForWeek.mockResolvedValue(
      await week("2026-06-18", [{ teacherId: USER, delivered: false }]),
    );
    const { alerts, assignmentPrep } = await pendingWorkFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "assignment_entry")).toBeUndefined();
    expect(assignmentPrep).toEqual(
      expect.objectContaining({ deliveryDateKey: "2026-06-18", items: 1, weekNumber: 1 }),
    );
    expect(new Date(assignmentPrep!.dueAt)).toEqual(new Date(2026, 5, 18, 7, 0, 0, 0));
  });

  test("on delivery-day MORNING (before 07:00) it is still a countdown, not overdue", async () => {
    // The whole point of D-#280: the split is on the deadline INSTANT, not the date.
    withSchedule();
    mockExpectedItemsForWeek.mockResolvedValue(
      await week(TODAY_KEY, [{ teacherId: USER, delivered: false }]),
    );
    const sixAm = new Date(2026, 5, 11, 6, 0);
    const { alerts, assignmentPrep } = await pendingWorkFor(ctxFor("TEACHER"), sixAm);
    expect(alerts.find((x) => x.kind === "assignment_entry")).toBeUndefined();
    expect(assignmentPrep?.deliveryDateKey).toBe(TODAY_KEY);
  });

  test("at 07:00 exactly it flips to overdue — no dead zone", async () => {
    withSchedule();
    mockExpectedItemsForWeek.mockResolvedValue(
      await week(TODAY_KEY, [{ teacherId: USER, delivered: false }]),
    );
    const sevenAm = new Date(2026, 5, 11, 7, 0);
    const { alerts, assignmentPrep } = await pendingWorkFor(ctxFor("TEACHER"), sevenAm);
    expect(alerts.find((x) => x.kind === "assignment_entry")?.count).toBe(1);
    expect(assignmentPrep).toBeNull();
  });

  test("the school's own day-start is honoured (not a hard-coded 07:00)", async () => {
    withSchedule();
    mockWindowFindOne.mockResolvedValue({ dayStartMinutes: 480 }); // 08:00
    mockExpectedItemsForWeek.mockResolvedValue(
      await week(TODAY_KEY, [{ teacherId: USER, delivered: false }]),
    );
    const sevenThirty = new Date(2026, 5, 11, 7, 30);
    const { alerts, assignmentPrep } = await pendingWorkFor(ctxFor("TEACHER"), sevenThirty);
    expect(alerts.find((x) => x.kind === "assignment_entry")).toBeUndefined(); // not 08:00 yet
    expect(new Date(assignmentPrep!.dueAt)).toEqual(new Date(2026, 5, 11, 8, 0, 0, 0));
  });

  test("delivering the item clears BOTH the countdown and the alert at once", async () => {
    withSchedule();
    mockExpectedItemsForWeek.mockResolvedValue(
      await week("2026-06-18", [{ teacherId: USER, delivered: true }]),
    );
    const { alerts, assignmentPrep } = await pendingWorkFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "assignment_entry")).toBeUndefined();
    expect(assignmentPrep).toBeNull();
  });

  test("last week overdue + this week counting down can coexist", async () => {
    withSchedule();
    mockWeekNumberFor.mockReturnValue(2);
    mockExpectedItemsForWeek.mockImplementation((_yr: string, w: number) =>
      w === 1
        ? week("2026-06-04", [{ teacherId: USER, delivered: false }]) // past → overdue
        : week("2026-06-18", [{ teacherId: USER, delivered: false }]), // future → countdown
    );
    const { alerts, assignmentPrep } = await pendingWorkFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "assignment_entry")?.oldestDateKey).toBe("2026-06-04");
    expect(assignmentPrep?.deliveryDateKey).toBe("2026-06-18");
  });

  test("a suspended week owes nothing", async () => {
    withSchedule();
    mockExpectedItemsForWeek.mockResolvedValue(
      await week("2026-06-09", [{ teacherId: USER, delivered: false }], true),
    );
    const { alerts, assignmentPrep } = await pendingWorkFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "assignment_entry")).toBeUndefined();
    expect(assignmentPrep).toBeNull();
  });

  test("falls back to the year COVERING today when none is flagged current (live-testing bug)", async () => {
    // AcademicYear.current defaults to FALSE, so a roster where nobody flipped the flag
    // had no current year — and the countdown/alert vanished silently.
    mockYearFindOne.mockImplementation((f: { current?: boolean }) =>
      Promise.resolve(f.current ? null : { _id: "yr-covering" }),
    );
    mockScheduleFindOne.mockResolvedValue({ termStartDate: new Date(2026, 3, 1) });
    mockWeekNumberFor.mockReturnValue(1);
    mockExpectedItemsForWeek.mockResolvedValue({
      suspended: false,
      deliveryDate: "2026-06-18",
      items: [{ teacherId: USER, delivered: false }],
    });

    const { assignmentPrep } = await pendingWorkFor(ctxFor("TEACHER"), TODAY);
    expect(assignmentPrep?.deliveryDateKey).toBe("2026-06-18");
    expect(mockExpectedItemsForWeek).toHaveBeenCalledWith("yr-covering", 1);
  });

  test("no academic year at all → silent, never an error", async () => {
    const { alerts, assignmentPrep } = await pendingWorkFor(ctxFor("TEACHER"), TODAY);
    expect(alerts.find((x) => x.kind === "assignment_entry")).toBeUndefined();
    expect(assignmentPrep).toBeNull();
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
