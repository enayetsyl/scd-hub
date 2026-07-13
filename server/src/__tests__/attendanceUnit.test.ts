/**
 * D-#278 — the attendance UNIT: where a student's attendance is captured, and who
 * the routine says marks it.
 *
 *   1. resolveUnits — Class 1–5 with a Quran membership → that Quran group;
 *      Nursery/KG → their section; a 1–5 leftover with no membership → their section
 *   2. firstQuranSlotTeacher — earliest `track:"quran"` slot, covers beat the
 *      substantive teacher, breaks/non-Quran tracks skipped
 *   3. firstPeriodTeacher — earliest non-break slot, cover-aware
 *   4. rosterForUnit — a group yields its members; a section yields only the students
 *      whose OWN unit is that section (1–5 Quran kids are excluded)
 *
 * DB-free: models + `routineForDate` are mocked; the resolution logic is real.
 */
const mockRoutineForDate = jest.fn();
const mockClassFind = jest.fn();
const mockStudentFind = jest.fn();
const mockMembershipFind = jest.fn();
const mockCoverSlotFind = jest.fn();

jest.mock("../modules/routine/services/RoutineSlotService", () => ({
  routineForDate: (...a: unknown[]) => mockRoutineForDate(...a),
}));
jest.mock("../modules/hr/models/StaffCoverSlot", () => ({
  StaffCoverSlot: { find: (f: unknown) => ({ select: () => ({ lean: () => mockCoverSlotFind(f) }) }) },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (f: unknown) => ({ select: () => ({ lean: () => mockClassFind(f) }) }) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (f: unknown) => ({ select: () => ({ lean: () => mockStudentFind(f) }) }) },
}));
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: { find: (f: unknown) => ({ select: () => ({ lean: () => mockMembershipFind(f) }) }) },
}));

import {
  isNurseryKg,
  resolveUnits,
  rosterForUnit,
  firstQuranSlotTeacher,
  firstPeriodTeacher,
  unitKey,
} from "../modules/attendance/attendanceUnit";

const DATE = new Date(2026, 5, 11); // Thu

/** A lean routine slot as `routineForDate` returns it. */
const slot = (
  periodNumber: number,
  track: string,
  teacherId: string | null,
  coverTeacherId: string | null = null,
  isBreak = false,
) => ({
  _id: `slot-p${periodNumber}-${track}${isBreak ? "-brk" : ""}`,
  periodNumber,
  track,
  isBreak,
  teacherId,
  coverTeacherId,
  effectiveFrom: DATE,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRoutineForDate.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([]);
  mockStudentFind.mockResolvedValue([]);
  mockMembershipFind.mockResolvedValue([]);
  mockCoverSlotFind.mockResolvedValue([]);
});

describe("isNurseryKg", () => {
  test("Nursery (−1) and KG (0) are nursery_kg; Class 1–5 are not", () => {
    expect(isNurseryKg(-1)).toBe(true);
    expect(isNurseryKg(0)).toBe(true);
    expect(isNurseryKg(1)).toBe(false);
    expect(isNurseryKg(5)).toBe(false);
  });
});

describe("resolveUnits — where each student is captured", () => {
  const students = [
    { id: "kid-kg", sectionId: "sec-kg", classId: "cls-kg" },
    { id: "kid-3", sectionId: "sec-3", classId: "cls-3" },
    { id: "kid-3-leftover", sectionId: "sec-3", classId: "cls-3" },
  ];

  test("Class 1–5 with a Quran membership → that group; Nursery/KG → their section", async () => {
    mockClassFind.mockResolvedValue([
      { _id: "cls-kg", level: 0 },
      { _id: "cls-3", level: 3 },
    ]);
    // Only kid-3 has a Quran group; kid-kg's membership (if any) is irrelevant.
    mockMembershipFind.mockResolvedValue([{ studentId: "kid-3", groupId: "quran-najera" }]);

    const units = await resolveUnits(students);
    expect(units.get("kid-3")).toEqual({ unitType: "subjectgroup", unitId: "quran-najera" });
    expect(units.get("kid-kg")).toEqual({ unitType: "section", unitId: "sec-kg" });
    // A 1–5 student with no Quran membership falls back to their section (never unmarkable).
    expect(units.get("kid-3-leftover")).toEqual({ unitType: "section", unitId: "sec-3" });
  });

  test("a Nursery/KG student is NOT routed to a Quran group even if a membership exists", async () => {
    mockClassFind.mockResolvedValue([{ _id: "cls-kg", level: 0 }]);
    mockMembershipFind.mockResolvedValue([{ studentId: "kid-kg", groupId: "quran-qaida" }]);
    const units = await resolveUnits([students[0]]);
    expect(units.get("kid-kg")).toEqual({ unitType: "section", unitId: "sec-kg" });
  });

  test("empty input short-circuits without hitting the DB", async () => {
    expect((await resolveUnits([])).size).toBe(0);
    expect(mockClassFind).not.toHaveBeenCalled();
    expect(mockMembershipFind).not.toHaveBeenCalled();
  });
});

describe("firstQuranSlotTeacher — the Class 1–5 marker", () => {
  test("takes the EARLIEST quran-track slot's teacher", async () => {
    mockRoutineForDate.mockResolvedValue([slot(1, "quran", "t-first"), slot(2, "quran", "t-second")]);
    expect(await firstQuranSlotTeacher("grp", DATE)).toBe("t-first");
    expect(mockRoutineForDate).toHaveBeenCalledWith("subjectgroup", "grp", DATE);
  });

  test("a cover on that slot hands the marking duty to the cover teacher", async () => {
    mockRoutineForDate.mockResolvedValue([slot(1, "quran", "t-absent", "t-cover")]);
    expect(await firstQuranSlotTeacher("grp", DATE)).toBe("t-cover");
  });

  test("an APPROVED HR leave-cover hands the marking duty to the covering teacher", async () => {
    // Prod finding 2026-07-13: Mahfuj covered Mumin's P1 Quran group via the HR
    // leave flow (StaffCoverSlot, no RoutineSubstitution) but got no attendance
    // option — the marker never consulted the HR cover.
    mockRoutineForDate.mockResolvedValue([slot(1, "quran", "t-mumin")]);
    mockCoverSlotFind.mockResolvedValue([
      { routineSlotId: "slot-p1-quran", finalCoverTeacherUserId: "t-mahfuj" },
    ]);
    expect(await firstQuranSlotTeacher("grp", DATE)).toBe("t-mahfuj");
    expect(mockCoverSlotFind).toHaveBeenCalledWith(
      expect.objectContaining({ dateKey: "2026-06-11", status: "approved" }),
    );
  });

  test("a RoutineSubstitution beats an HR leave-cover on the same slot", async () => {
    mockRoutineForDate.mockResolvedValue([slot(1, "quran", "t-mumin", "t-sub")]);
    mockCoverSlotFind.mockResolvedValue([
      { routineSlotId: "slot-p1-quran", finalCoverTeacherUserId: "t-mahfuj" },
    ]);
    expect(await firstQuranSlotTeacher("grp", DATE)).toBe("t-sub");
  });

  test("skips breaks, non-quran tracks, and teacherless slots", async () => {
    mockRoutineForDate.mockResolvedValue([
      slot(1, "quran", null, null, true), // break
      slot(2, "arabic", "t-arabic"), // wrong track
      slot(3, "quran", null), // no teacher
      slot(4, "quran", "t-real"),
    ]);
    expect(await firstQuranSlotTeacher("grp", DATE)).toBe("t-real");
  });

  test("null when the group has no Quran teacher that day", async () => {
    mockRoutineForDate.mockResolvedValue([slot(1, "arabic", "t-arabic")]);
    expect(await firstQuranSlotTeacher("grp", DATE)).toBeNull();
  });
});

describe("firstPeriodTeacher — the Nursery/KG marker", () => {
  test("takes the earliest non-break slot regardless of track (their P1 is general)", async () => {
    mockRoutineForDate.mockResolvedValue([
      slot(1, "general", null, null, true), // break
      slot(2, "general", "t-p2"),
      slot(3, "quran", "t-quran"),
    ]);
    expect(await firstPeriodTeacher("sec", DATE)).toBe("t-p2");
    expect(mockRoutineForDate).toHaveBeenCalledWith("section", "sec", DATE);
  });

  test("a cover on the first period wins", async () => {
    mockRoutineForDate.mockResolvedValue([slot(1, "general", "t-absent", "t-cover")]);
    expect(await firstPeriodTeacher("sec", DATE)).toBe("t-cover");
  });

  test("an APPROVED HR leave-cover on the first period wins too", async () => {
    mockRoutineForDate.mockResolvedValue([slot(1, "general", "t-absent")]);
    mockCoverSlotFind.mockResolvedValue([
      { routineSlotId: "slot-p1-general", finalCoverTeacherUserId: "t-hr-cover" },
    ]);
    expect(await firstPeriodTeacher("sec", DATE)).toBe("t-hr-cover");
  });

  test("null on an empty routine", async () => {
    expect(await firstPeriodTeacher("sec", DATE)).toBeNull();
  });
});

describe("rosterForUnit", () => {
  test("a Quran group yields its ACTIVE members, spanning sections", async () => {
    mockMembershipFind.mockResolvedValue([
      { studentId: "kid-3", groupId: "quran-najera" },
      { studentId: "kid-4", groupId: "quran-najera" },
    ]);
    mockStudentFind.mockResolvedValue([
      { _id: "kid-3", sectionId: "sec-3", classId: "cls-3" },
      { _id: "kid-4", sectionId: "sec-4", classId: "cls-4" },
    ]);
    mockClassFind.mockResolvedValue([
      { _id: "cls-3", level: 3 },
      { _id: "cls-4", level: 4 },
    ]);

    const roster = await rosterForUnit({ unitType: "subjectgroup", unitId: "quran-najera" });
    expect(roster.map((s) => s.id).sort()).toEqual(["kid-3", "kid-4"]);
    // The group spans sections — that is exactly why display must roll up to sections.
    expect(new Set(roster.map((s) => s.sectionId)).size).toBe(2);
  });

  test("a group with no members yields an empty roster without loading students", async () => {
    mockMembershipFind.mockResolvedValue([]);
    expect(await rosterForUnit({ unitType: "subjectgroup", unitId: "grp" })).toEqual([]);
    expect(mockStudentFind).not.toHaveBeenCalled();
  });

  test("a Nursery/KG member of a Quran group is EXCLUDED — they are captured in their section", async () => {
    // Regression: without the unit-narrowing, the Quran teacher would see kid-kg on their
    // roster and could mark them absent, but the roll-up (which reads kid-kg through their
    // SECTION record) would silently drop that absence.
    mockMembershipFind.mockResolvedValue([
      { studentId: "kid-3", groupId: "quran-qaida" },
      { studentId: "kid-kg", groupId: "quran-qaida" },
    ]);
    mockStudentFind.mockResolvedValue([
      { _id: "kid-3", sectionId: "sec-3", classId: "cls-3" },
      { _id: "kid-kg", sectionId: "sec-kg", classId: "cls-kg" },
    ]);
    mockClassFind.mockResolvedValue([
      { _id: "cls-3", level: 3 },
      { _id: "cls-kg", level: 0 },
    ]);

    const roster = await rosterForUnit({ unitType: "subjectgroup", unitId: "quran-qaida" });
    expect(roster.map((s) => s.id)).toEqual(["kid-3"]);
  });

  test("a Class 1–5 section yields ONLY the leftovers — Quran-grouped kids belong to their group", async () => {
    mockStudentFind.mockResolvedValue([
      { _id: "kid-3", sectionId: "sec-3", classId: "cls-3" }, // has a Quran group
      { _id: "kid-3-leftover", sectionId: "sec-3", classId: "cls-3" }, // none
    ]);
    mockClassFind.mockResolvedValue([{ _id: "cls-3", level: 3 }]);
    mockMembershipFind.mockResolvedValue([{ studentId: "kid-3", groupId: "quran-najera" }]);

    const roster = await rosterForUnit({ unitType: "section", unitId: "sec-3" });
    expect(roster.map((s) => s.id)).toEqual(["kid-3-leftover"]);
  });

  test("a Nursery/KG section yields all its active students", async () => {
    mockStudentFind.mockResolvedValue([
      { _id: "kid-kg-1", sectionId: "sec-kg", classId: "cls-kg" },
      { _id: "kid-kg-2", sectionId: "sec-kg", classId: "cls-kg" },
    ]);
    mockClassFind.mockResolvedValue([{ _id: "cls-kg", level: 0 }]);
    const roster = await rosterForUnit({ unitType: "section", unitId: "sec-kg" });
    expect(roster.map((s) => s.id)).toEqual(["kid-kg-1", "kid-kg-2"]);
  });
});

describe("unitKey", () => {
  test("distinguishes the two shapes so a section and a group never collide", () => {
    expect(unitKey({ unitType: "section", unitId: "x" })).not.toBe(
      unitKey({ unitType: "subjectgroup", unitId: "x" }),
    );
  });
});
