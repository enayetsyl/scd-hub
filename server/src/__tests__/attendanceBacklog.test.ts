/**
 * D-#279 — `unmarkedMarkingDays`: the batched "which of my marking days are still
 * unmarked?" scan behind the Today dashboard's red attendance alert.
 *
 * It re-implements `markerForUnit`'s rule PURELY (after ~8 batched loads) so a 7-day
 * look-back doesn't cost 7× the per-day path. These tests pin the two behaviours that
 * must agree with `StudentAttendanceService`, plus the two bugs found in live testing:
 *
 *   1. marker rule parity — override → routine first-class teacher (cover-aware) →
 *      class-teacher fallback; a Quran group has NO class-teacher fallback
 *   2. DETERMINISM — two live slots on the same period must not flip the marker
 *      between identical requests (the "sometimes shows, sometimes not" bug)
 *   3. EMPTY UNITS are dropped — a unit with no students can never receive a day
 *      record, so it must never raise an unclearable alert (the Class 1–5 section
 *      unit is usually empty: its students live in Quran groups)
 *   4. only unmarked days are returned, oldest first
 *
 * DB-free: models are mocked; the resolution logic is real.
 */
const mockSlotFind = jest.fn();
const mockSubFind = jest.fn();
const mockSectionFind = jest.fn();
const mockAssignFind = jest.fn();
const mockDayFind = jest.fn();
const mockClassFind = jest.fn();
const mockStudentFind = jest.fn();
const mockResolveUnits = jest.fn();
const mockHrCoverFind = jest.fn();

/** These collections are queried BOTH as `.lean()` and `.select().lean()` — support both. */
const chain = (fn: jest.Mock) => (f: unknown) => ({
  lean: () => fn(f),
  select: () => ({ lean: () => fn(f) }),
});

jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (f: unknown) => chain(mockSlotFind)(f) },
}));
jest.mock("../modules/routine/models/RoutineSubstitution", () => ({
  RoutineSubstitution: { find: (f: unknown) => chain(mockSubFind)(f) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (f: unknown) => chain(mockSectionFind)(f) },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (f: unknown) => chain(mockClassFind)(f) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (f: unknown) => chain(mockStudentFind)(f) },
}));
jest.mock("../modules/attendance/models/SectionAttendanceAssignment", () => ({
  SectionAttendanceAssignment: { find: (f: unknown) => chain(mockAssignFind)(f) },
}));
jest.mock("../modules/attendance/models/StudentAttendanceDay", () => ({
  StudentAttendanceDay: { find: (f: unknown) => chain(mockDayFind)(f) },
}));
jest.mock("../modules/hr/models/StaffCoverSlot", () => ({
  StaffCoverSlot: { find: (f: unknown) => chain(mockHrCoverFind)(f) },
}));
jest.mock("../modules/attendance/attendanceUnit", () => {
  const actual = jest.requireActual("../modules/attendance/attendanceUnit");
  return {
    compareSlotOrder: actual.compareSlotOrder,
    isNurseryKg: actual.isNurseryKg,
    unitKey: actual.unitKey,
    resolveUnits: (...a: unknown[]) => mockResolveUnits(...a),
  };
});

import { unmarkedMarkingDays } from "../modules/attendance/attendanceBacklog";

const ME = "me-1";
const OTHER = "other-1";
// 2026-06-10 Wed, 2026-06-11 Thu.
const WED = "2026-06-10";
const THU = "2026-06-11";
const QURAN = "grp-qaida";
const SEC_KG = "sec-kg";

const slot = (over: Partial<Record<string, unknown>> = {}) => ({
  _id: "slot-1",
  groupType: "subjectgroup",
  groupId: QURAN,
  dayOfWeek: "THU",
  periodNumber: 1,
  track: "quran",
  isBreak: false,
  teacherId: ME,
  effectiveFrom: new Date(2026, 0, 1),
  effectiveTo: null,
  ...over,
});

/** Everyone belongs to the Quran group unless a test says otherwise. */
const populate = (unit: { unitType: string; unitId: string }): void => {
  mockStudentFind.mockResolvedValue([{ _id: "kid-1", sectionId: "sec-3", classId: "cls-3" }]);
  mockResolveUnits.mockResolvedValue(new Map([["kid-1", unit]]));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSlotFind.mockResolvedValue([]);
  mockSubFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([]);
  mockAssignFind.mockResolvedValue([]);
  mockDayFind.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([]);
  mockHrCoverFind.mockResolvedValue([]);
  populate({ unitType: "subjectgroup", unitId: QURAN });
});

describe("marker rule parity", () => {
  test("the group's first-Quran teacher owes the mark; an unmarked day is returned", async () => {
    mockSlotFind.mockResolvedValue([slot()]);
    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([THU]);
  });

  test("a day WITH a record for that unit is not pending", async () => {
    mockSlotFind.mockResolvedValue([slot()]);
    mockDayFind.mockResolvedValue([{ subjectGroupId: QURAN, dateKey: THU }]);
    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([]);
  });

  test("a teacher who does not open the first Quran period owes nothing", async () => {
    mockSlotFind.mockResolvedValue([slot({ teacherId: OTHER })]);
    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([]);
  });

  test("a cover on the first Quran slot moves the duty to the cover teacher", async () => {
    // The substantive teacher is OTHER; I hold the cover on that date.
    mockSubFind.mockImplementation((f: { coverTeacherId?: string }) =>
      Promise.resolve(
        f.coverTeacherId === ME
          ? [{ slotId: "slot-1" }]
          : [{ slotId: "slot-1", date: new Date(2026, 5, 11), coverTeacherId: ME }],
      ),
    );
    mockSlotFind.mockResolvedValue([slot({ teacherId: OTHER })]);
    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([THU]);
  });

  test("an approved HR leave-cover moves the duty to the covering teacher (PXG-1)", async () => {
    // Prod finding 2026-07-13: the HR leave flow writes a StaffCoverSlot, not a
    // RoutineSubstitution — the backlog (and marker) must honour it too. The
    // substantive teacher is OTHER; I hold the approved cover for THU.
    mockSlotFind.mockResolvedValue([slot({ teacherId: OTHER })]);
    mockHrCoverFind.mockResolvedValue([
      { routineSlotId: "slot-1", dateKey: THU, finalCoverTeacherUserId: ME },
    ]);
    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([THU]);
  });

  test("an admin override beats the routine", async () => {
    mockSlotFind.mockResolvedValue([slot({ teacherId: OTHER })]);
    mockAssignFind.mockResolvedValue([
      { subjectGroupId: QURAN, teacherId: ME, fromKey: THU, toKey: THU, createdAt: new Date() },
    ]);
    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([THU]);
  });

  test("a Quran group has NO class-teacher fallback — a teacherless slot owes nothing", async () => {
    mockSlotFind.mockResolvedValue([slot({ teacherId: null })]);
    mockSectionFind.mockResolvedValue([]);
    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([]);
  });

  test("Nursery/KG: the first-period teacher owes it, beating the class teacher", async () => {
    populate({ unitType: "section", unitId: SEC_KG });
    mockSlotFind.mockResolvedValue([
      slot({ _id: "s-kg", groupType: "section", groupId: SEC_KG, track: "general", teacherId: ME }),
    ]);
    mockSectionFind.mockResolvedValue([{ _id: SEC_KG, classId: "cls-kg", classTeacherId: OTHER }]);
    mockClassFind.mockResolvedValue([{ _id: "cls-kg", level: 0 }]);
    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([THU]);
  });

  test("Class 1–5 section falls back to the class teacher, never the first-period teacher", async () => {
    populate({ unitType: "section", unitId: "sec-3" });
    mockSlotFind.mockResolvedValue([
      slot({ _id: "s-3", groupType: "section", groupId: "sec-3", track: "general", teacherId: OTHER }),
    ]);
    mockSectionFind.mockResolvedValue([{ _id: "sec-3", classId: "cls-3", classTeacherId: ME }]);
    mockClassFind.mockResolvedValue([{ _id: "cls-3", level: 3 }]);
    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([THU]); // ME as class teacher
  });
});

describe("determinism — the 'sometimes shows, sometimes not' bug", () => {
  test("two live slots on the same period resolve to the NEWEST, whatever order Mongo returns", async () => {
    const older = slot({ _id: "aaa", teacherId: OTHER, effectiveFrom: new Date(2026, 0, 1) });
    const newer = slot({ _id: "bbb", teacherId: ME, effectiveFrom: new Date(2026, 3, 1) });

    mockSlotFind.mockResolvedValue([older, newer]);
    const forward = await unmarkedMarkingDays(ME, [THU]);
    jest.clearAllMocks();
    beforeEachState();
    mockSlotFind.mockResolvedValue([newer, older]); // Mongo's arbitrary tie order
    const reversed = await unmarkedMarkingDays(ME, [THU]);

    expect(forward).toEqual([THU]); // the newer slot names ME
    expect(reversed).toEqual(forward); // ...and the answer does not depend on row order
  });

  /** Re-seed the defaults `jest.clearAllMocks()` wipes mid-test. */
  function beforeEachState(): void {
    mockSubFind.mockResolvedValue([]);
    mockSectionFind.mockResolvedValue([]);
    mockAssignFind.mockResolvedValue([]);
    mockDayFind.mockResolvedValue([]);
    mockClassFind.mockResolvedValue([]);
    mockHrCoverFind.mockResolvedValue([]);
    populate({ unitType: "subjectgroup", unitId: QURAN });
  }
});

describe("empty units are dropped — no unclearable alert", () => {
  test("a Class 1–5 section unit with no leftovers raises NO alert for its class teacher", async () => {
    // The only student is captured in their Quran group, so the section unit is empty.
    mockStudentFind.mockResolvedValue([{ _id: "kid-1", sectionId: "sec-3", classId: "cls-3" }]);
    mockResolveUnits.mockResolvedValue(new Map([["kid-1", { unitType: "subjectgroup", unitId: QURAN }]]));
    mockSectionFind.mockResolvedValue([{ _id: "sec-3", classId: "cls-3", classTeacherId: ME }]);
    mockClassFind.mockResolvedValue([{ _id: "cls-3", level: 3 }]);
    mockSlotFind.mockResolvedValue([]); // I teach nothing; I'm only the class teacher

    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([]);
  });

  test("a Quran group with no members raises no alert", async () => {
    mockStudentFind.mockResolvedValue([]);
    mockResolveUnits.mockResolvedValue(new Map());
    mockSlotFind.mockResolvedValue([slot()]);
    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([]);
  });
});

describe("window handling", () => {
  test("returns only the unmarked days, oldest first", async () => {
    mockSlotFind.mockResolvedValue([slot({ dayOfWeek: "WED" }), slot({ _id: "slot-2", dayOfWeek: "THU" })]);
    mockDayFind.mockResolvedValue([{ subjectGroupId: QURAN, dateKey: THU }]); // Thu marked
    expect(await unmarkedMarkingDays(ME, [THU, WED])).toEqual([WED]);
  });

  test("an empty window short-circuits", async () => {
    expect(await unmarkedMarkingDays(ME, [])).toEqual([]);
    expect(mockSlotFind).not.toHaveBeenCalled();
  });

  test("no candidate units → no queries beyond discovery", async () => {
    expect(await unmarkedMarkingDays(ME, [THU])).toEqual([]);
    expect(mockDayFind).not.toHaveBeenCalled();
  });
});
