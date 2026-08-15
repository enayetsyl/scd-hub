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
const mockStaffFind = jest.fn();
const mockGroupFind = jest.fn();
const mockMembershipFind = jest.fn();

const chain = (fn: jest.Mock) => () => ({ select: () => ({ lean: async () => fn() }) });

jest.mock("../modules/attendance/models/StudentAttendanceDay", () => ({
  StudentAttendanceDay: { find: chain(mockStudentDayFind) },
}));
jest.mock("../modules/attendance/models/TeacherAttendanceDay", () => ({
  TeacherAttendanceDay: { find: chain(mockTeacherDayFind) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: chain(mockStudentFind) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: chain(mockSectionFind) },
}));
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: { find: chain(mockStaffFind) },
}));
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: {
    findById: () => ({ lean: async () => ({ startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") }) }),
    findOne: () => ({ sort: () => ({ lean: async () => ({ startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") }) }) }),
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
  mockStaffFind.mockResolvedValue([]);
  mockGroupFind.mockResolvedValue([]);
  mockMembershipFind.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

describe("window resolution", () => {
  test("the school week runs SATURDAY → FRIDAY around the anchor", () => {
    // 2026-08-12 is a Wednesday; its week starts Saturday 2026-08-08.
    expect(weekRange("2026-08-12")).toEqual({ fromKey: "2026-08-08", toKey: "2026-08-14" });
  });

  test("a Saturday anchor starts its own week (not the previous one)", () => {
    expect(weekRange("2026-08-08")).toEqual({ fromKey: "2026-08-08", toKey: "2026-08-14" });
  });

  test("a Friday anchor stays at the END of its week", () => {
    expect(weekRange("2026-08-14")).toEqual({ fromKey: "2026-08-08", toKey: "2026-08-14" });
  });

  test("a week spanning a month boundary does not clip", () => {
    expect(weekRange("2026-09-01")).toEqual({ fromKey: "2026-08-29", toKey: "2026-09-04" });
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

  function oneSection(days: string[][], students: { id: string; name: string }[]): void {
    mockSectionFind.mockResolvedValue([{ _id: oid(SEC), code: "Main", nameBn: "মূল" }]);
    mockStudentDayFind.mockResolvedValue(
      days.map((absent) => ({ sectionId: oid(SEC), absentStudentIds: absent.map(oid) })),
    );
    mockStudentFind.mockResolvedValue(
      students.map((s) => ({ _id: oid(s.id), name: s.name, sectionId: oid(SEC) })),
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
    mockStudentDayFind.mockResolvedValue([
      ...Array.from({ length: 3 }, () => ({ sectionId: oid("thin"), absentStudentIds: [] })),
      ...Array.from({ length: 20 }, (_, i) => ({
        sectionId: oid("thick"),
        absentStudentIds: i === 0 ? [oid("solid")] : [],
      })),
    ]);
    mockStudentFind.mockResolvedValue([
      { _id: oid("thin1"), name: "Thin", sectionId: oid("thin") },
      { _id: oid("solid"), name: "Solid", sectionId: oid("thick") },
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
    mockStudentFind.mockResolvedValue([{ _id: oid("a"), name: "Ayesha", sectionId: oid(SEC) }]);
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
      { _id: oid("a"), name: "Ayesha", nameBn: "আয়েশা", sectionId: oid(SEC) },
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
