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
const mockAsNilFind = jest.fn();
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
jest.mock("../modules/trackers/models/AssignmentNilDeclaration", () => ({
  AssignmentNilDeclaration: { find: (q: unknown) => ({ lean: () => mockAsNilFind(q) }) },
}));
jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: { find: (q: unknown) => ({ lean: () => mockHolidayFind(q) }) },
}));

import {
  weekNumberFor,
  cycleWeekOf,
  anchorInWeek,
  resolveWeekDates,
  monthWeekOf,
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
  mockAsNilFind.mockResolvedValue([]);
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
  });

  test("calendar-month week model: week-of-month + rotation wrap (D-#275)", () => {
    // Sun–Sat week containing the 1st = week 1 of that month. July 2026: the 1st is
    // a Wednesday, so the week starting Sun Jun 28 (contains Jul 1) is July week 1.
    expect(monthWeekOf(new Date(2026, 5, 28))).toEqual({ year: 2026, month: 6, weekOfMonth: 1 });
    expect(monthWeekOf(new Date(2026, 6, 5)).weekOfMonth).toBe(2); // Sun Jul 5 → July wk2
    expect(monthWeekOf(new Date(2026, 6, 12)).weekOfMonth).toBe(3); // Sun Jul 12 → July wk3
    // cycleWeek is derived from week-of-month; a 5th week wraps back to slot 1.
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

  test("D-#331: month + week + cycle key off the delivery THURSDAY, not the week's Saturday", () => {
    // Week 30 (Sun Jul 26–Sat Aug 1): the delivery Thursday is Jul 30 — the 5th
    // Thursday of JULY → July · week 5 → cycle 1 (wraps to week-1's subjects), NOT
    // "August week 1" as the old Saturday rule labelled it.
    const w30 = resolveWeekDates(TERM_START, 30, 4, 0, isOpenFactory());
    expect(w30.deliveryDate).toEqual(new Date(2026, 6, 30)); // Thu Jul 30
    expect(w30.month).toBe(6); // July
    expect(w30.weekOfMonth).toBe(5);
    expect(w30.cycleWeek).toBe(1);
    // Week 31 (Sun Aug 2–Sat Aug 8): the 1st Thursday of AUGUST → August · week 1 →
    // cycle 1. So the 5th week AND the next month's 1st week both deliver week 1's set.
    const w31 = resolveWeekDates(TERM_START, 31, 4, 0, isOpenFactory());
    expect(w31.deliveryDate).toEqual(new Date(2026, 7, 6)); // Thu Aug 6
    expect(w31.month).toBe(7); // August
    expect(w31.weekOfMonth).toBe(1);
    expect(w31.cycleWeek).toBe(1);
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

  test("Nursery (-1) and KG (0) are accepted; classLevel outside the roster range is rejected", async () => {
    mockScheduleFindOne.mockResolvedValue({ ...schedule(), save: jest.fn() });
    const base = {
      academicYearId: YEAR, cycleWeek: 1, classId: oid().toString(),
      subject: "BAN", teacherId: oid().toString(),
    };
    // Distinct sections so the (cycleWeek × section × subject) dup guard doesn't fire.
    await expect(addScheduleEntry({ ...base, sectionId: oid().toString(), classLevel: 0 })).resolves.toBeDefined(); // KG
    await expect(addScheduleEntry({ ...base, sectionId: oid().toString(), classLevel: -1 })).resolves.toBeDefined(); // Nursery
    // classLevel is validated before the schedule/dup lookup, so section reuse is irrelevant here.
    await expect(addScheduleEntry({ ...base, sectionId: oid().toString(), classLevel: -2 })).rejects.toThrow(/roster classes/);
    await expect(addScheduleEntry({ ...base, sectionId: oid().toString(), classLevel: 6 })).rejects.toThrow(/roster classes/);
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
      { _id: itemId, asId: "AS-C2-BAN-0001", sectionId: e3a.sectionId, subject: e3a.subject },
    ]);

    const week = await expectedItemsForWeek(YEAR, 15);
    expect(week.cycleWeek).toBe(3);
    expect(week.suspended).toBe(false);
    // week 15 = Apr 12–18, 2026; THU = Apr 16, due SUN = Apr 19 (date-only, tz-agnostic)
    expect(week.deliveryDate!.slice(0, 10)).toBe("2026-04-16");
    expect(week.dueDate!.slice(0, 10)).toBe("2026-04-19");
    expect(week.items).toHaveLength(2);
    const ban = week.items.find((i) => i.subject === "BAN")!;
    const math = week.items.find((i) => i.subject === "MATH")!;
    expect(ban.delivered).toBe(true);
    expect(ban.asId).toBe("AS-C2-BAN-0001");
    expect(math.delivered).toBe(false);
    expect(math.asItemId).toBeNull();
  });

  test("delivered join keys on (section × subject), not the entry _id — survives a re-added entry", async () => {
    // BUG-017: the rotation entry was removed + re-added, so its subdocument _id
    // changed, but the delivered AssignmentItem still carries the same section+
    // subject. The home grid must still read `delivered: true`.
    const e3 = entry({ cycleWeek: 3 });
    mockScheduleFindOne.mockResolvedValue(schedule([e3]));
    mockItemFind.mockResolvedValue([
      {
        _id: oid(),
        asId: "AS-C2-BAN-0001",
        sectionId: e3.sectionId,
        subject: e3.subject,
        scheduleEntryId: oid(), // STALE — a different id than e3._id
      },
    ]);
    const week = await expectedItemsForWeek(YEAR, 15);
    const ban = week.items.find((i) => i.subject === "BAN")!;
    expect(ban.delivered).toBe(true);
    expect(ban.asId).toBe("AS-C2-BAN-0001");
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
  // Week 24 = Jun 14–20, 2026 (Sun Jun 14 / Mon Jun 15). It is the 3rd calendar
  // week of June → weekOfMonth 3 → cycleWeek 3 (D-#275).
  const e = entry({ cycleWeek: 3, teacherId: TEACHER, subject: "BAN", classLevel: 2 });

  test("Sunday + Monday surface the teacher's undelivered items; other days are silent", async () => {
    mockScheduleFindOne.mockResolvedValue(schedule([e, entry({ cycleWeek: 3 })])); // 2nd entry: other teacher
    const sunday = new Date(2026, 5, 14, 9);
    const monday = new Date(2026, 5, 15, 9);
    const tuesday = new Date(2026, 5, 16, 9);

    const sunPrompts = await myAssignmentPrepPrompts(YEAR, TEACHER, sunday);
    expect(sunPrompts).toHaveLength(1);
    expect(sunPrompts[0].subject).toBe("BAN");
    expect(sunPrompts[0].weekNumber).toBe(24);
    // deliver Thursday (AJ-2's wording): Thu Jun 18 (date-only, tz-agnostic)
    expect(sunPrompts[0].deliveryDate.slice(0, 10)).toBe("2026-06-18");

    expect(await myAssignmentPrepPrompts(YEAR, TEACHER, monday)).toHaveLength(1);
    expect(await myAssignmentPrepPrompts(YEAR, TEACHER, tuesday)).toHaveLength(0);
  });

  test("the prompt disappears once the item is delivered (AJ-2)", async () => {
    mockScheduleFindOne.mockResolvedValue(schedule([e]));
    mockItemFind.mockResolvedValue([
      { _id: oid(), asId: "AS-C2-BAN-0007", sectionId: e.sectionId, subject: e.subject },
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
