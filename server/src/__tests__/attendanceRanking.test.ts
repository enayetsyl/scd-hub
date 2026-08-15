/**
 * Attendance-ranking tests (AR-1 — docs/prd-attendance-ranking.md).
 *
 * What can go silently wrong here is the ARITHMETIC, not the plumbing: a window
 * that clips a day, a denominator that counts a day the section never held, a
 * student with zero absences vanishing because absent-only capture never names
 * them, or a 3-day perfect record topping a 60-day near-perfect one. Each of those
 * gets a test.
 */
const mockStudentDayFind = jest.fn();
const mockTeacherDayFind = jest.fn();
const mockStudentFind = jest.fn();
const mockSectionFind = jest.fn();
const mockClassFind = jest.fn();
const mockStaffFind = jest.fn();
const mockGroupFind = jest.fn();
const mockMembershipFind = jest.fn();

const chain = (fn: jest.Mock) => () => ({ select: () => ({ lean: async () => fn() }) });

/** `findOne().sort().select().lean()` — the last-marked-day lookup behind the
 *  self-explaining empty state. */
const lastMarkedChain = (key: string | null) => () => ({
  sort: () => ({ select: () => ({ lean: async () => (key ? { dateKey: key } : null) }) }),
});

jest.mock("../modules/attendance/models/StudentAttendanceDay", () => ({
  StudentAttendanceDay: { find: chain(mockStudentDayFind), findOne: lastMarkedChain("2026-08-13") },
}));
jest.mock("../modules/attendance/models/TeacherAttendanceDay", () => ({
  TeacherAttendanceDay: { find: chain(mockTeacherDayFind), findOne: lastMarkedChain("2026-07-31") },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: chain(mockStudentFind) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: chain(mockSectionFind) },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: chain(mockClassFind) },
}));
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: { find: chain(mockStaffFind) },
}));
/**
 * Mirrors the live shape that caused the bug: three years exist (2026 current, plus
 * future 2027 and 2029 planning rows). `findOne({current:true})` must win; the
 * `sort({startDate:-1})` fallback would hand back 2029 and empty every cumulative
 * and annual ranking.
 */
const YEARS = {
  current: { label: "2026", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") },
  newest: { label: "2029", startDate: new Date("2029-01-01"), endDate: new Date("2029-12-31") },
};
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: {
    findById: () => ({ lean: async () => YEARS.current }),
    findOne: (filter?: Record<string, unknown>) =>
      filter?.current
        ? { lean: async () => YEARS.current }
        : { sort: () => ({ lean: async () => YEARS.newest }) },
  },
}));
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: chain(mockGroupFind) },
}));
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: { find: chain(mockMembershipFind) },
}));

import {
  rankStudents,
  rankStaff,
  resolveWindow,
  weekRange,
  monthRange,
  MIN_HELD_DAYS,
} from "../modules/attendance/services/AttendanceRankingService";

const oid = (s: string) => ({ toString: () => s });

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentDayFind.mockResolvedValue([]);
  mockTeacherDayFind.mockResolvedValue([]);
  mockStudentFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([]);
  mockStaffFind.mockResolvedValue([]);
  mockGroupFind.mockResolvedValue([]);
  mockMembershipFind.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

describe("window resolution", () => {
  // The live register settles the week shape: across 32 marked dates on prod, Sun–Thu
  // carry rows and Fri/Sat carry ZERO. The school week is Sunday–Thursday, so a
  // Sunday-start window captures exactly one school week with the weekend at the end.
  test("the school week runs SUNDAY → SATURDAY around the anchor", () => {
    // 2026-08-12 is a Wednesday; its week starts Sunday 2026-08-09.
    expect(weekRange("2026-08-12")).toEqual({ fromKey: "2026-08-09", toKey: "2026-08-15" });
  });

  test("a Sunday anchor starts its own week", () => {
    expect(weekRange("2026-08-09")).toEqual({ fromKey: "2026-08-09", toKey: "2026-08-15" });
  });

  // THE REGRESSION (owner's screenshot, 2026-08-15): a Saturday-start week put a
  // Saturday anchor at the head of the week AHEAD, so "this week" on a day off showed
  // five unmarked future days and an empty list.
  test("a SATURDAY anchor reports the school week that just ended, not the one ahead", () => {
    expect(weekRange("2026-08-15")).toEqual({ fromKey: "2026-08-09", toKey: "2026-08-15" });
  });

  test("a Friday anchor also reports the week that just ended", () => {
    expect(weekRange("2026-08-14")).toEqual({ fromKey: "2026-08-09", toKey: "2026-08-15" });
  });

  test("a week spanning a month boundary does not clip", () => {
    expect(weekRange("2026-08-31")).toEqual({ fromKey: "2026-08-30", toKey: "2026-09-05" });
  });

  test("month covers the real last day, including February in a leap year", () => {
    expect(monthRange("2026-08-15")).toEqual({ fromKey: "2026-08-01", toKey: "2026-08-31" });
    expect(monthRange("2024-02-10")).toEqual({ fromKey: "2024-02-01", toKey: "2024-02-29" });
    expect(monthRange("2026-02-10")).toEqual({ fromKey: "2026-02-01", toKey: "2026-02-28" });
  });

  test("cumulative runs year-start → anchor; annual runs the whole year", async () => {
    await expect(resolveWindow("cumulative", "2026-08-15")).resolves.toEqual({
      fromKey: "2026-01-01",
      toKey: "2026-08-15",
    });
    await expect(resolveWindow("annual", "2026-08-15")).resolves.toEqual({
      fromKey: "2026-01-01",
      toKey: "2026-12-31",
    });
  });

  // THE REGRESSION: prod carries future-dated 2027 and 2029 planning years, so
  // "newest by startDate" resolved to 2029 and every cumulative/annual ranking came
  // back empty. The CURRENT flag is the only field that means "the year we are in".
  test("cumulative/annual follow the CURRENT year, not the newest-starting one", async () => {
    await expect(resolveWindow("annual", "2026-08-15")).resolves.toEqual({
      fromKey: "2026-01-01",
      toKey: "2026-12-31",
    });
    await expect(resolveWindow("cumulative", "2026-08-15")).resolves.toEqual({
      fromKey: "2026-01-01",
      toKey: "2026-08-15",
    });
  });

  test("a cumulative anchor BEFORE the year start clamps rather than inverting the range", async () => {
    await expect(resolveWindow("cumulative", "2025-06-01")).resolves.toEqual({
      fromKey: "2026-01-01",
      toKey: "2026-01-01",
    });
  });
});

// ---------------------------------------------------------------------------
// The student metric
// ---------------------------------------------------------------------------

describe("rankStudents — present % of held days", () => {
  const SEC = "sec1";

  /**
   * A NURSERY/KG-shaped section (class level 0): those stay section-captured on every
   * date, so one section row per school day is the whole picture for them. `days[i]`
   * is the absentee list for the i-th marked date. Dates are post-cutover on purpose —
   * the legacy branch has its own tests below.
   */
  function oneSection(days: string[][], students: { id: string; name: string }[]): void {
    mockSectionFind.mockResolvedValue([{ _id: oid(SEC), code: "Main", nameBn: "মূল" }]);
    mockClassFind.mockResolvedValue([{ _id: oid("cKg"), nameBn: "কেজি", level: 0 }]);
    mockStudentDayFind.mockResolvedValue(
      days.map((absent, i) => ({
        sectionId: oid(SEC),
        dateKey: `2026-08-${String(i + 1).padStart(2, "0")}`,
        absentStudentIds: absent.map(oid),
      })),
    );
    mockStudentFind.mockResolvedValue(
      students.map((s) => ({ _id: oid(s.id), name: s.name, sectionId: oid(SEC), classId: oid("cKg") })),
    );
  }

  test("a student with NO absences still appears — and tops the list", async () => {
    // Absent-only capture never names a perfect student; they must come from the roster.
    oneSection(
      Array.from({ length: 12 }, () => ["b"]),
      [{ id: "a", name: "Ayesha" }, { id: "b", name: "Bilal" }],
    );
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "section", axisValue: SEC });
    expect(res.rows.map((r) => [r.name, r.presentPct, r.rank])).toEqual([
      ["Ayesha", 100, 1],
      ["Bilal", 0, 2],
    ]);
    expect(res.rows[0].heldDays).toBe(12);
  });

  test("the denominator is HELD days, so an unmarked day is invisible to everyone", async () => {
    // 10 marked days in a month with far more calendar days; nobody is charged for the rest.
    oneSection(
      [["a"], [], [], [], [], [], [], [], [], []],
      [{ id: "a", name: "Ayesha" }],
    );
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "section", axisValue: SEC });
    expect(res.rows[0]).toMatchObject({ heldDays: 10, absentDays: 1, presentPct: 90 });
  });

  test("present % is rounded to one decimal, not truncated to an integer", async () => {
    oneSection(
      Array.from({ length: 30 }, (_, i) => (i < 4 ? ["a"] : [])),
      [{ id: "a", name: "Ayesha" }],
    );
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "section", axisValue: SEC });
    expect(res.rows[0].presentPct).toBe(86.7); // 26/30
  });

  test("a thin record is flagged and ranked BELOW every qualifying row (owner floor)", async () => {
    // Two sections: one held 3 days (perfect student), one held 20 (near-perfect).
    mockSectionFind.mockResolvedValue([
      { _id: oid("thin"), code: "A", nameBn: "ক" },
      { _id: oid("thick"), code: "B", nameBn: "খ" },
    ]);
    mockClassFind.mockResolvedValue([{ _id: oid("cKg"), nameBn: "কেজি", level: 0 }]);
    mockStudentDayFind.mockResolvedValue([
      ...Array.from({ length: 3 }, (_, i) => ({
        sectionId: oid("thin"),
        dateKey: `2026-08-${String(i + 1).padStart(2, "0")}`,
        absentStudentIds: [],
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        sectionId: oid("thick"),
        dateKey: `2026-08-${String(i + 1).padStart(2, "0")}`,
        absentStudentIds: i === 0 ? [oid("solid")] : [],
      })),
    ]);
    mockStudentFind.mockResolvedValue([
      { _id: oid("thin1"), name: "Thin", sectionId: oid("thin"), classId: oid("cKg") },
      { _id: oid("solid"), name: "Solid", sectionId: oid("thick"), classId: oid("cKg") },
    ]);
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "school" });
    expect(res.rows[0].name).toBe("Solid"); // 95% off 20 days outranks 100% off 3
    expect(res.rows[0].belowFloor).toBe(false);
    expect(res.rows[1]).toMatchObject({ name: "Thin", presentPct: 100, belowFloor: true });
    expect(MIN_HELD_DAYS).toBe(10);
  });

  test("equal present % shares a rank, and the next rank skips (1,1,3)", async () => {
    oneSection(
      Array.from({ length: 10 }, (_, i) => (i === 0 ? ["c"] : [])),
      [{ id: "a", name: "Ayesha" }, { id: "b", name: "Bilal" }, { id: "c", name: "Chowdhury" }],
    );
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "section", axisValue: SEC });
    expect(res.rows.map((r) => [r.name, r.rank])).toEqual([
      ["Ayesha", 1],
      ["Bilal", 1],
      ["Chowdhury", 3],
    ]);
  });

  test("a student in a section that held NO day in the window is left out, not scored 0", async () => {
    mockSectionFind.mockResolvedValue([{ _id: oid(SEC), code: "Main", nameBn: "মূল" }]);
    mockStudentDayFind.mockResolvedValue([]);
    mockStudentFind.mockResolvedValue([{ _id: oid("a"), name: "Ayesha", sectionId: oid(SEC), classId: oid("cKg") }]);
    const res = await rankStudents({ window: "week", anchorKey: "2026-08-15", axis: "section", axisValue: SEC });
    expect(res.rows).toEqual([]);
    expect(res.unitCount).toBe(0);
  });

  test("the Quran axis reads the SUBJECT-GROUP register via membership, not sections", async () => {
    mockGroupFind.mockResolvedValue([{ _id: oid("g1"), nameBn: "হিফজ ১", code: "HIFZ1", track: "quran" }]);
    mockStudentDayFind.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        subjectGroupId: oid("g1"),
        absentStudentIds: i < 3 ? [oid("s1")] : [],
      })),
    );
    mockMembershipFind.mockResolvedValue([{ groupId: oid("g1"), studentId: oid("s1") }]);
    mockStudentFind.mockResolvedValue([{ _id: oid("s1"), name: "Khadija" }]);
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "track", axisValue: "quran" });
    expect(res.rows[0]).toMatchObject({ name: "Khadija", heldDays: 12, absentDays: 3, presentPct: 75 });
    expect(res.rows[0].unitLabel).toBe("হিফজ ১");
    expect(mockSectionFind).not.toHaveBeenCalled(); // registers are never mixed
  });

  test("the Bangla name is preferred when the roster carries one", async () => {
    mockSectionFind.mockResolvedValue([{ _id: oid(SEC), code: "Main", nameBn: "মূল" }]);
    mockStudentDayFind.mockResolvedValue(
      Array.from({ length: 10 }, () => ({ sectionId: oid(SEC), absentStudentIds: [] })),
    );
    mockStudentFind.mockResolvedValue([
      { _id: oid("a"), name: "Ayesha", nameBn: "আয়েশা", sectionId: oid(SEC), classId: oid("cKg") },
    ]);
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "section", axisValue: SEC });
    expect(res.rows[0].name).toBe("আয়েশা");
  });
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

describe("rankStaff — LEAVE excluded, LATE counts present but breaks ties", () => {
  function register(rows: { staff: string; status: string }[], staff: { id: string; name: string }[]): void {
    mockTeacherDayFind.mockResolvedValue(rows.map((r) => ({ staffProfileId: oid(r.staff), status: r.status })));
    mockStaffFind.mockResolvedValue(staff.map((s) => ({ _id: oid(s.id), name: s.name, category: "teacher" })));
  }

  test("approved LEAVE leaves the denominator alone (owner ruling)", async () => {
    // 10 present + 5 leave ⇒ 100%, not 66.7%.
    register(
      [
        ...Array.from({ length: 10 }, () => ({ staff: "t1", status: "PRESENT" })),
        ...Array.from({ length: 5 }, () => ({ staff: "t1", status: "LEAVE" })),
      ],
      [{ id: "t1", name: "Fatima" }],
    );
    const res = await rankStaff({ window: "month", anchorKey: "2026-08-15" });
    expect(res.rows[0]).toMatchObject({ presentPct: 100, heldDays: 10, leaveDays: 5, absentDays: 0 });
  });

  test("LATE counts as present but is reported separately and loses the tie", async () => {
    register(
      [
        ...Array.from({ length: 10 }, () => ({ staff: "punctual", status: "PRESENT" })),
        ...Array.from({ length: 10 }, (_, i) => ({ staff: "late", status: i < 6 ? "LATE" : "PRESENT" })),
      ],
      [{ id: "punctual", name: "Punctual" }, { id: "late", name: "Latecomer" }],
    );
    const res = await rankStaff({ window: "month", anchorKey: "2026-08-15" });
    expect(res.rows.map((r) => r.presentPct)).toEqual([100, 100]); // both fully present
    expect(res.rows[0].name).toBe("Punctual"); // …but eleven late days is not equal
    expect(res.rows[1].lateDays).toBe(6);
  });

  test("ABSENT is what actually costs present %", async () => {
    register(
      Array.from({ length: 20 }, (_, i) => ({ staff: "t1", status: i < 3 ? "ABSENT" : "PRESENT" })),
      [{ id: "t1", name: "Rahim" }],
    );
    const res = await rankStaff({ window: "month", anchorKey: "2026-08-15" });
    expect(res.rows[0]).toMatchObject({ absentDays: 3, heldDays: 20, presentPct: 85 });
  });

  test("a staff member whose every day was leave is omitted, not scored 0", async () => {
    register(
      Array.from({ length: 4 }, () => ({ staff: "t1", status: "LEAVE" })),
      [{ id: "t1", name: "Maternity" }],
    );
    const res = await rankStaff({ window: "month", anchorKey: "2026-08-15" });
    expect(res.rows).toEqual([]);
  });

  test("an empty register returns an empty ranking rather than throwing", async () => {
    mockTeacherDayFind.mockResolvedValue([]);
    const res = await rankStaff({ window: "week", anchorKey: "2026-08-15" });
    expect(res).toMatchObject({ rows: [], unitCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// The self-explaining empty state
// ---------------------------------------------------------------------------

describe("lastMarkedKey — an empty ranking says WHY", () => {
  test("an empty window still reports the register's last marked day", async () => {
    mockSectionFind.mockResolvedValue([{ _id: oid("s"), code: "Main", nameBn: "মূল" }]);
    mockStudentDayFind.mockResolvedValue([]);
    const res = await rankStudents({ window: "week", anchorKey: "2026-08-22", axis: "school" });
    expect(res.rows).toEqual([]);
    expect(res.lastMarkedKey).toBe("2026-08-13"); // "your window is ahead of the data"
  });

  test("a populated ranking carries it too", async () => {
    mockSectionFind.mockResolvedValue([{ _id: oid("s"), code: "Main", nameBn: "মূল" }]);
    mockStudentDayFind.mockResolvedValue(
      Array.from({ length: 10 }, () => ({ sectionId: oid("s"), absentStudentIds: [] })),
    );
    mockStudentFind.mockResolvedValue([{ _id: oid("a"), name: "Ayesha", sectionId: oid("s"), classId: oid("cKg") }]);
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "school" });
    expect(res.lastMarkedKey).toBe("2026-08-13");
  });

  test("the staff ranking reports its own register's last day, not the students'", async () => {
    mockTeacherDayFind.mockResolvedValue([]);
    const res = await rankStaff({ window: "month", anchorKey: "2026-08-15" });
    expect(res.lastMarkedKey).toBe("2026-07-31");
  });
});

// ---------------------------------------------------------------------------
// Unit labels — the row must say WHICH class
// ---------------------------------------------------------------------------

describe("unitLabel — every class's default section is named the same", () => {
  test("a section row is labelled CLASS · SECTION, not just the section name", async () => {
    // Live shape: Nursery and KG both have a section called মূল, so a bare section
    // name made two different classes indistinguishable on a whole-school ranking.
    mockSectionFind.mockResolvedValue([
      { _id: oid("secNur"), code: "Main", nameBn: "মূল", classId: oid("cNur") },
      { _id: oid("secKg"), code: "Main", nameBn: "মূল", classId: oid("cKg") },
    ]);
    mockClassFind.mockResolvedValue([
      { _id: oid("cNur"), nameBn: "নার্সারি", level: -1 },
      { _id: oid("cKg"), nameBn: "কেজি", level: 0 },
    ]);
    // The live 30-vs-32 shape: Nursery marked 32 dates, KG the first 30 of them. Two
    // units, two denominators — which is exactly why the labels have to distinguish them.
    const dayKey = (i: number) => `2026-0${i < 30 ? "7" : "8"}-${String((i % 30) + 1).padStart(2, "0")}`;
    mockStudentDayFind.mockResolvedValue([
      ...Array.from({ length: 32 }, (_, i) => ({
        sectionId: oid("secNur"),
        dateKey: dayKey(i),
        absentStudentIds: [],
      })),
      ...Array.from({ length: 30 }, (_, i) => ({
        sectionId: oid("secKg"),
        dateKey: dayKey(i),
        absentStudentIds: [],
      })),
    ]);
    mockStudentFind.mockResolvedValue([
      { _id: oid("n1"), name: "Nursery Child", sectionId: oid("secNur"), classId: oid("cNur") },
      { _id: oid("k1"), name: "KG Child", sectionId: oid("secKg"), classId: oid("cKg") },
    ]);
    const res = await rankStudents({ window: "annual", anchorKey: "2026-08-15", axis: "school" });
    const labels = Object.fromEntries(res.rows.map((r) => [r.name, r.unitLabel]));
    expect(labels["Nursery Child"]).toBe("নার্সারি · মূল");
    expect(labels["KG Child"]).toBe("কেজি · মূল");
    // …and the two units keep their own denominators, which is the whole reason the
    // held-day counts legitimately differ between them.
    const held = Object.fromEntries(res.rows.map((r) => [r.name, r.heldDays]));
    expect(held["Nursery Child"]).toBe(32);
    expect(held["KG Child"]).toBe(30);
  });

  test("a section with no resolvable class still labels cleanly", async () => {
    mockSectionFind.mockResolvedValue([{ _id: oid("s"), code: "Main", nameBn: "মূল" }]);
    mockClassFind.mockResolvedValue([]);
    mockStudentDayFind.mockResolvedValue(
      Array.from({ length: 10 }, () => ({ sectionId: oid("s"), absentStudentIds: [] })),
    );
    mockStudentFind.mockResolvedValue([{ _id: oid("a"), name: "Ayesha", sectionId: oid("s"), classId: oid("cKg") }]);
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "school" });
    expect(res.rows[0].unitLabel).toBe("মূল");
  });
});

// ---------------------------------------------------------------------------
// THE REGRESSION (owner, 2026-08-15): "attendance is taken in the Quran class and
// then sorted to C1–C5". Class 1–5 attendance is captured on their cross-section
// Quran group (D-#278, live 2026-07-13), NOT on their section. A section-shaped
// ranking that counted SECTION rows therefore showed classes 1–5 with 8 held days
// and looked like they had stopped marking — they had only changed units.
// ---------------------------------------------------------------------------

describe("rankStudents — class/section axes resolve each student's attendance UNIT", () => {
  const C4 = "c4";
  const SEC4 = "sec4";
  const GRP = "hifz1";

  function classFourViaQuran(): void {
    mockSectionFind.mockResolvedValue([{ _id: oid(SEC4), code: "Main", nameBn: "মূল", classId: oid(C4) }]);
    mockClassFind.mockResolvedValue([{ _id: oid(C4), nameBn: "চতুর্থ শ্রেণি", level: 4 }]);
    mockStudentFind.mockResolvedValue([
      { _id: oid("s1"), name: "Class4 Child", sectionId: oid(SEC4), classId: oid(C4) },
    ]);
    mockMembershipFind.mockResolvedValue([{ studentId: oid("s1"), groupId: oid(GRP), track: "quran" }]);
  }

  test("a class-4 student is counted from their QURAN-GROUP rows, not their section's", async () => {
    classFourViaQuran();
    // Post-cutover: 12 group days (one absence) and NO section rows at all.
    mockStudentDayFind.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        subjectGroupId: oid(GRP),
        dateKey: `2026-08-${String(i + 1).padStart(2, "0")}`,
        absentStudentIds: i === 0 ? [oid("s1")] : [],
      })),
    );
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "class", axisValue: C4 });
    expect(res.rows).toHaveLength(1);
    // Before the fix this was 0 rows — the section register held nothing for them.
    expect(res.rows[0]).toMatchObject({ heldDays: 12, absentDays: 1, belowFloor: false });
    // …and the label still says class · section: the group is never a display axis.
    expect(res.rows[0].unitLabel).toBe("চতুর্থ শ্রেণি · মূল");
  });

  test("dates BEFORE the 2026-07-13 cutover count from the SECTION (D-#292 legacy shape)", async () => {
    classFourViaQuran();
    mockStudentDayFind.mockResolvedValue([
      // legacy: section-captured
      { sectionId: oid(SEC4), dateKey: "2026-07-06", absentStudentIds: [] },
      { sectionId: oid(SEC4), dateKey: "2026-07-07", absentStudentIds: [oid("s1")] },
      // post-cutover: group-captured
      { subjectGroupId: oid(GRP), dateKey: "2026-07-14", absentStudentIds: [] },
      // …and a post-cutover SECTION row must NOT count for a class-4 student
      { sectionId: oid(SEC4), dateKey: "2026-07-15", absentStudentIds: [oid("s1")] },
    ]);
    const res = await rankStudents({ window: "month", anchorKey: "2026-07-15", axis: "class", axisValue: C4 });
    expect(res.rows[0]).toMatchObject({ heldDays: 3, absentDays: 1 });
  });

  test("Nursery/KG stay SECTION-captured on both sides of the cutover", async () => {
    mockSectionFind.mockResolvedValue([{ _id: oid("secKg"), code: "Main", nameBn: "মূল", classId: oid("cKg") }]);
    mockClassFind.mockResolvedValue([{ _id: oid("cKg"), nameBn: "কেজি", level: 0 }]);
    mockStudentFind.mockResolvedValue([
      { _id: oid("k1"), name: "KG Child", sectionId: oid("secKg"), classId: oid("cKg") },
    ]);
    mockMembershipFind.mockResolvedValue([]); // no Quran membership
    mockStudentDayFind.mockResolvedValue([
      { sectionId: oid("secKg"), dateKey: "2026-07-06", absentStudentIds: [] },
      { sectionId: oid("secKg"), dateKey: "2026-07-14", absentStudentIds: [] },
    ]);
    const res = await rankStudents({ window: "month", anchorKey: "2026-07-15", axis: "school" });
    expect(res.rows[0]).toMatchObject({ heldDays: 2, absentDays: 0, presentPct: 100 });
  });

  test("a 1–5 student with NO Quran membership falls back to their section, never unrankable", async () => {
    mockSectionFind.mockResolvedValue([{ _id: oid(SEC4), code: "Main", nameBn: "মূল", classId: oid(C4) }]);
    mockClassFind.mockResolvedValue([{ _id: oid(C4), nameBn: "চতুর্থ শ্রেণি", level: 4 }]);
    mockStudentFind.mockResolvedValue([
      { _id: oid("orphan"), name: "No Group", sectionId: oid(SEC4), classId: oid(C4) },
    ]);
    mockMembershipFind.mockResolvedValue([]);
    mockStudentDayFind.mockResolvedValue([
      { sectionId: oid(SEC4), dateKey: "2026-08-03", absentStudentIds: [] },
    ]);
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "school" });
    expect(res.rows[0]).toMatchObject({ name: "No Group", heldDays: 1 });
  });

  test("two students in one section but different Quran groups keep their own denominators", async () => {
    mockSectionFind.mockResolvedValue([{ _id: oid(SEC4), code: "Main", nameBn: "মূল", classId: oid(C4) }]);
    mockClassFind.mockResolvedValue([{ _id: oid(C4), nameBn: "চতুর্থ শ্রেণি", level: 4 }]);
    mockStudentFind.mockResolvedValue([
      { _id: oid("a"), name: "Hifz Child", sectionId: oid(SEC4), classId: oid(C4) },
      { _id: oid("b"), name: "Qaida Child", sectionId: oid(SEC4), classId: oid(C4) },
    ]);
    mockMembershipFind.mockResolvedValue([
      { studentId: oid("a"), groupId: oid("hifz"), track: "quran" },
      { studentId: oid("b"), groupId: oid("qaida"), track: "quran" },
    ]);
    mockStudentDayFind.mockResolvedValue([
      { subjectGroupId: oid("hifz"), dateKey: "2026-08-03", absentStudentIds: [] },
      { subjectGroupId: oid("hifz"), dateKey: "2026-08-04", absentStudentIds: [] },
      { subjectGroupId: oid("qaida"), dateKey: "2026-08-03", absentStudentIds: [oid("b")] },
    ]);
    const res = await rankStudents({ window: "month", anchorKey: "2026-08-15", axis: "school" });
    const byName = Object.fromEntries(res.rows.map((r) => [r.name, r]));
    expect(byName["Hifz Child"]).toMatchObject({ heldDays: 2, absentDays: 0 });
    expect(byName["Qaida Child"]).toMatchObject({ heldDays: 1, absentDays: 1 });
    // Same section, same label — the group never surfaces as a display axis.
    expect(byName["Hifz Child"].unitLabel).toBe("চতুর্থ শ্রেণি · মূল");
    expect(byName["Qaida Child"].unitLabel).toBe("চতুর্থ শ্রেণি · মূল");
  });
});
