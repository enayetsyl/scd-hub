/**
 * AS-T1 tests — schedule + expected items + prep reminders (prd-tracker-assignment §5).
 *
 * AJ-1 — week resolution: cycle-week mapping, §4 holiday rolls, vacation suspension
 *        (acceptance #6: rolls + suspension proven against the D-#50 calendar)
 * AJ-2 — myAssignmentPrepPrompts: Sun/Mon only, teacher-scoped, disappears on delivery
 * Plus: schedule CRUD validation (anchor weekdays, rotation dup, cycleWeek bounds).
 *
 * DB-free: models mocked; the cadence calendar + dayTypeFor are real.
 */
import mongoose from "mongoose";

const mockScheduleFindOne = jest.fn();
const mockItemFind = jest.fn();
const mockHolidayFind = jest.fn();

jest.mock("../modules/trackers/models/AssignmentSchedule", () => ({
  AssignmentSchedule: {
    findOne: (q: unknown) => mockScheduleFindOne(q),
    findOneAndUpdate: jest.fn(),
  },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { find: (q: unknown) => ({ lean: () => mockItemFind(q) }) },
}));
jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: { find: (q: unknown) => ({ lean: () => mockHolidayFind(q) }) },
}));

import {
  weekNumberFor,
  cycleWeekOf,
  anchorInWeek,
  resolveWeekDates,
} from "../modules/trackers/assignmentCalendar";
import {
  addScheduleEntry,
  expectedItemsForWeek,
  myAssignmentPrepPrompts,
  upsertAssignmentSchedule,
} from "../modules/trackers/services/AssignmentScheduleService";

const oid = () => new mongoose.Types.ObjectId();
const YEAR = oid().toString();
const TEACHER = oid().toString();

// Term anchor: Sunday 2026-01-04 (getDay 0). Week 1 = Jan 4–10.
const TERM_START = new Date(2026, 0, 4);

/** Sun–Thu open unless in `holidays` (date-only timestamps). */
function isOpenFactory(holidays: Date[] = []) {
  const set = new Set(holidays.map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()));
  return (date: Date) => {
    const dow = date.getDay();
    if (dow === 5 || dow === 6) return false;
    return !set.has(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime());
  };
}

function entry(over: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    cycleWeek: 1,
    classId: oid(),
    classLevel: 2,
    sectionId: oid(),
    subject: "BAN",
    teacherId: oid(),
    ...over,
  };
}

function schedule(entries: unknown[] = [], over: Record<string, unknown> = {}) {
  return {
    academicYearId: YEAR,
    termStartDate: TERM_START,
    deliveryDayOfWeek: 4, // THU
    dueDayOfWeek: 0, // SUN
    entries,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHolidayFind.mockResolvedValue([]);
  mockItemFind.mockResolvedValue([]);
});

// ===========================================================================
// Cadence calendar (pure) — §4 rules
// ===========================================================================

describe("§4 cadence calendar (pure)", () => {
  test("week numbering + 4-week cycle mapping (AJ-1)", () => {
    expect(weekNumberFor(TERM_START, new Date(2026, 0, 4))).toBe(1);
    expect(weekNumberFor(TERM_START, new Date(2026, 0, 10))).toBe(1);
    expect(weekNumberFor(TERM_START, new Date(2026, 0, 11))).toBe(2);
    expect(weekNumberFor(TERM_START, new Date(2026, 0, 1))).toBe(0); // before term
    // week 15 → cycleWeek 3 (AJ-1's example)
    expect(cycleWeekOf(15)).toBe(3);
    expect(cycleWeekOf(1)).toBe(1);
    expect(cycleWeekOf(4)).toBe(4);
    expect(cycleWeekOf(5)).toBe(1);
  });

  test("normal week: THU delivery, following SUN due", () => {
    const r = resolveWeekDates(TERM_START, 1, 4, 0, isOpenFactory());
    expect(r.suspended).toBe(false);
    expect(r.deliveryDate).toEqual(new Date(2026, 0, 8)); // Thu Jan 8
    expect(r.dueDate).toEqual(new Date(2026, 0, 11)); // Sun Jan 11
  });

  test("rule 1 (AJ-3 premise): Thursday holiday rolls delivery to the PREVIOUS open day", () => {
    const r = resolveWeekDates(TERM_START, 1, 4, 0, isOpenFactory([new Date(2026, 0, 8)]));
    expect(r.deliveryDate).toEqual(new Date(2026, 0, 7)); // Wed Jan 7
    expect(r.dueDate).toEqual(new Date(2026, 0, 11)); // due unchanged
  });

  test("rule 2 (AJ-4 premise): Sunday holiday rolls due to the NEXT open day", () => {
    const r = resolveWeekDates(TERM_START, 1, 4, 0, isOpenFactory([new Date(2026, 0, 11)]));
    expect(r.deliveryDate).toEqual(new Date(2026, 0, 8));
    expect(r.dueDate).toEqual(new Date(2026, 0, 12)); // Mon Jan 12
  });

  test("rolls never land on Fri/Sat (§4 rule 4 — Saturday is Quran-only)", () => {
    // Thu 8th AND Wed 7th closed → rolls past them to Tue 6th (never Fri/Sat)
    const r = resolveWeekDates(
      TERM_START, 1, 4, 0,
      isOpenFactory([new Date(2026, 0, 8), new Date(2026, 0, 7)]),
    );
    expect(r.deliveryDate).toEqual(new Date(2026, 0, 6));
    expect(r.deliveryDate!.getDay()).not.toBe(5);
    expect(r.deliveryDate!.getDay()).not.toBe(6);
  });

  test("rule 3 (AJ-1): a vacation week (no open day) is suspended", () => {
    const wholeWeek = Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 4 + i));
    const r = resolveWeekDates(TERM_START, 1, 4, 0, isOpenFactory(wholeWeek));
    expect(r.suspended).toBe(true);
    expect(r.deliveryDate).toBeNull();
    expect(r.dueDate).toBeNull();
  });

  test("anchorInWeek finds the weekday inside a non-Sunday-anchored window", () => {
    const wedStart = new Date(2026, 0, 7); // Wed
    expect(anchorInWeek(wedStart, 4)).toEqual(new Date(2026, 0, 8)); // Thu next day
    expect(anchorInWeek(wedStart, 0)).toEqual(new Date(2026, 0, 11)); // Sun within window
  });
});

// ===========================================================================
// Schedule CRUD validation
// ===========================================================================

describe("schedule CRUD validation", () => {
  test("anchor weekdays outside Sun–Thu are rejected (D-#86)", async () => {
    await expect(
      upsertAssignmentSchedule({ academicYearId: YEAR, termStartDate: TERM_START, deliveryDayOfWeek: 5 }),
    ).rejects.toThrow(/school weekday/);
    await expect(
      upsertAssignmentSchedule({ academicYearId: YEAR, termStartDate: TERM_START, dueDayOfWeek: 6 }),
    ).rejects.toThrow(/school weekday/);
  });

  test("duplicate rotation cell (cycleWeek × section × subject) is rejected", async () => {
    const e = entry();
    mockScheduleFindOne.mockResolvedValue({ ...schedule([e]), save: jest.fn() });
    await expect(
      addScheduleEntry({
        academicYearId: YEAR,
        cycleWeek: 1,
        classId: oid().toString(),
        classLevel: 2,
        sectionId: (e.sectionId as mongoose.Types.ObjectId).toString(),
        subject: "BAN",
        teacherId: oid().toString(),
      }),
    ).rejects.toThrow(/already has BAN/);
  });

  test("cycleWeek outside 1..4 and unknown subject are rejected", async () => {
    mockScheduleFindOne.mockResolvedValue({ ...schedule(), save: jest.fn() });
    const base = {
      academicYearId: YEAR, classId: oid().toString(), classLevel: 2,
      sectionId: oid().toString(), teacherId: oid().toString(),
    };
    await expect(addScheduleEntry({ ...base, cycleWeek: 5, subject: "BAN" })).rejects.toThrow(/cycleWeek/);
    await expect(addScheduleEntry({ ...base, cycleWeek: 1, subject: "QURAN" })).rejects.toThrow(/Unknown assignment subject/);
  });
});

// ===========================================================================
// AJ-1 — expectedItemsForWeek (service, with holiday model)
// ===========================================================================

describe("AJ-1 — expectedItemsForWeek", () => {
  test("week 15 resolves cycleWeek-3 entries with §4 dates; delivered join applied", async () => {
    const e3a = entry({ cycleWeek: 3 });
    const e3b = entry({ cycleWeek: 3, subject: "MATH" });
    const e1 = entry({ cycleWeek: 1 }); // other cycle week — excluded
    mockScheduleFindOne.mockResolvedValue(schedule([e3a, e3b, e1]));
    const itemId = oid();
    mockItemFind.mockResolvedValue([
      { _id: itemId, asId: "AS-C2-BAN-0001", scheduleEntryId: e3a._id },
    ]);

    const week = await expectedItemsForWeek(YEAR, 15);
    expect(week.cycleWeek).toBe(3);
    expect(week.suspended).toBe(false);
    // week 15 = Apr 12–18, 2026; THU = Apr 16, due SUN = Apr 19
    expect(new Date(week.deliveryDate!)).toEqual(new Date(2026, 3, 16));
    expect(new Date(week.dueDate!)).toEqual(new Date(2026, 3, 19));
    expect(week.items).toHaveLength(2);
    const ban = week.items.find((i) => i.subject === "BAN")!;
    const math = week.items.find((i) => i.subject === "MATH")!;
    expect(ban.delivered).toBe(true);
    expect(ban.asId).toBe("AS-C2-BAN-0001");
    expect(math.delivered).toBe(false);
    expect(math.asItemId).toBeNull();
  });

  test("a vacation week yields suspended items (excluded from rate denominators)", async () => {
    mockScheduleFindOne.mockResolvedValue(schedule([entry({ cycleWeek: 1 })]));
    // Week 5 = Feb 1–7, 2026 — whole window a HolidayException
    mockHolidayFind.mockResolvedValue([
      { fromDate: new Date(2026, 1, 1), toDate: new Date(2026, 1, 7, 23, 59) },
    ]);
    const week = await expectedItemsForWeek(YEAR, 5);
    expect(week.suspended).toBe(true);
    expect(week.deliveryDate).toBeNull();
    expect(week.items).toHaveLength(1); // entries listed, dates suspended
  });
});

// ===========================================================================
// AJ-2 — myAssignmentPrepPrompts (D-#89)
// ===========================================================================

describe("AJ-2 — myAssignmentPrepPrompts", () => {
  // Week 24 = Jun 14–20, 2026. Sun Jun 14 / Mon Jun 15. cycleWeek = ((24-1)%4)+1 = 4.
  const e = entry({ cycleWeek: 4, teacherId: TEACHER, subject: "BAN", classLevel: 2 });

  test("Sunday + Monday surface the teacher's undelivered items; other days are silent", async () => {
    mockScheduleFindOne.mockResolvedValue(schedule([e, entry({ cycleWeek: 4 })])); // 2nd entry: other teacher
    const sunday = new Date(2026, 5, 14, 9);
    const monday = new Date(2026, 5, 15, 9);
    const tuesday = new Date(2026, 5, 16, 9);

    const sunPrompts = await myAssignmentPrepPrompts(YEAR, TEACHER, sunday);
    expect(sunPrompts).toHaveLength(1);
    expect(sunPrompts[0].subject).toBe("BAN");
    expect(sunPrompts[0].weekNumber).toBe(24);
    // deliver Thursday (AJ-2's wording): Thu Jun 18
    expect(new Date(sunPrompts[0].deliveryDate)).toEqual(new Date(2026, 5, 18));

    expect(await myAssignmentPrepPrompts(YEAR, TEACHER, monday)).toHaveLength(1);
    expect(await myAssignmentPrepPrompts(YEAR, TEACHER, tuesday)).toHaveLength(0);
  });

  test("the prompt disappears once the item is delivered (AJ-2)", async () => {
    mockScheduleFindOne.mockResolvedValue(schedule([e]));
    mockItemFind.mockResolvedValue([
      { _id: oid(), asId: "AS-C2-BAN-0007", scheduleEntryId: e._id },
    ]);
    const prompts = await myAssignmentPrepPrompts(YEAR, TEACHER, new Date(2026, 5, 14, 9));
    expect(prompts).toHaveLength(0);
  });

  test("no schedule / before term / suspended week → empty, no crash", async () => {
    mockScheduleFindOne.mockResolvedValue(null);
    expect(await myAssignmentPrepPrompts(YEAR, TEACHER, new Date(2026, 5, 14))).toHaveLength(0);

    mockScheduleFindOne.mockResolvedValue(schedule([e]));
    expect(await myAssignmentPrepPrompts(YEAR, TEACHER, new Date(2025, 11, 7))).toHaveLength(0); // before term

    mockHolidayFind.mockResolvedValue([
      { fromDate: new Date(2026, 5, 14), toDate: new Date(2026, 5, 20, 23, 59) },
    ]);
    expect(await myAssignmentPrepPrompts(YEAR, TEACHER, new Date(2026, 5, 14))).toHaveLength(0);
  });
});
