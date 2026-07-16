/**
 * teacherClassLoad (D-#327) — the calendar-accurate monthly teaching-load count.
 * DB-free: RoutineSlot / HolidayException / User + enrichRoutineSlots mocked; the
 * calendar day-type logic (FULL Sun–Thu, QURAN_ONLY Sat, OFF Fri) is real.
 *
 * July 2026 (term month): Jul 1 is a Wednesday, no holidays →
 *   Sun 5,12,19,26 (4) · Mon 6,13,20,27 (4) · Tue (4) · Wed 1,8,15,22,29 (5) ·
 *   Thu (5) · Fri (5, OFF) · Sat 4,11,18,25 (4).  Teaching days = 22 FULL + 4 Sat = 26.
 */
const mockSlotFind = jest.fn();
const mockHolidayFind = jest.fn();
const mockUserFind = jest.fn();

jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (q: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockSlotFind(q)) }) }) },
}));
jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: { find: (q: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockHolidayFind(q)) }) }) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => ({ select: () => ({ lean: () => Promise.resolve(mockUserFind(q)) }) }) },
}));
jest.mock("../modules/routine/slotView", () => ({
  enrichRoutineSlots: (slots: Array<Record<string, unknown>>) =>
    Promise.resolve(slots.map((s) => ({ ...s, teacherName: "T", startTime: "07:00", endTime: "07:45", groupName: "G" }))),
}));

import { teacherClassLoad } from "../modules/routine/services/TeacherClassLoadService";

const TID = "6a00000000000000000000aa";
const oldFrom = new Date(2026, 0, 1); // well before July

function slot(dayOfWeek: string, periodNumber: number, track: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    teacherId: { toString: () => TID },
    groupType: "section",
    dayOfWeek,
    periodNumber,
    subject: track === "quran" ? "QURAN" : "BAN",
    track,
    effectiveFrom: oldFrom,
    effectiveTo: null,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHolidayFind.mockResolvedValue([]);
  mockUserFind.mockResolvedValue([{ _id: { toString: () => TID }, name: "Test Teacher" }]);
});

describe("teacherClassLoad — calendar-accurate monthly count (D-#327)", () => {
  test("Saturday counts only quran-track; Fridays never count; holidays netted out", async () => {
    mockSlotFind.mockResolvedValue([
      slot("SUN", 1, "general"),
      slot("SUN", 2, "general"),
      slot("MON", 1, "general"),
      slot("SAT", 1, "quran"), // counts on the 4 Saturdays
      slot("SAT", 2, "general"), // does NOT count (Sat is QURAN_ONLY)
    ]);
    const [load] = await teacherClassLoad("2026-07", TID);
    expect(load.teacherName).toBe("Test Teacher");
    expect(load.weekTotal).toBe(5);
    expect(load.monthTeachingDays).toBe(26);
    // SUN 2×4 + MON 1×4 + SAT-quran 1×4 + SAT-general 0 = 16
    expect(load.monthTotal).toBe(16);
    const byDow = Object.fromEntries(load.perWeekday.map((w) => [w.dayOfWeek, w.count]));
    expect(byDow).toEqual({ SUN: 2, MON: 1, SAT: 2 });
  });

  test("effectiveTo mid-month truncates the monthly count for that slot", async () => {
    // MON slot ends 2026-07-15 → only Mondays 6 & 13 count (2), not 4.
    mockSlotFind.mockResolvedValue([slot("MON", 1, "general", { effectiveTo: new Date(2026, 6, 15, 23, 59, 59) })]);
    const [load] = await teacherClassLoad("2026-07", TID);
    expect(load.monthTotal).toBe(2);
    expect(load.weekTotal).toBe(1);
  });

  test("a full-month holiday range removes those teaching days", async () => {
    mockHolidayFind.mockResolvedValue([{ fromDate: new Date(2026, 6, 1), toDate: new Date(2026, 6, 31, 23, 59, 59) }]);
    mockSlotFind.mockResolvedValue([slot("SUN", 1, "general")]);
    const [load] = await teacherClassLoad("2026-07", TID);
    expect(load.monthTeachingDays).toBe(0);
    expect(load.monthTotal).toBe(0);
  });

  test("rejects a malformed month", async () => {
    await expect(teacherClassLoad("2026/07", TID)).rejects.toThrow(/YYYY-MM/);
  });
});
