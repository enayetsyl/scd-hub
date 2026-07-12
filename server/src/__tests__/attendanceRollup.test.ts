/**
 * AF-4 (D-#278) — the section ROLL-UP: capture happens per attendance unit (a Class 1–5
 * Quran group, or a Nursery/KG section), but every report still reads class → section.
 *
 *   1. absenteeReport — a Class 3 student marked absent by their Qaida Quran teacher
 *      lands under "Class 3", and no "group" concept leaks into the payload
 *   2. only students whose OWN unit was marked are counted (a half-marked day doesn't
 *      silently report un-marked kids as present)
 *   3. unmarkedSections — a section is pending while ANY unit holding its students is
 *      unmarked, and names every pending marker
 *   4. studentAttendanceHistory — reads through the student's unit, and spans the
 *      cutover (old section rows + new group rows) without a backfill
 *
 * DB-free: models are mocked; the roll-up logic is real.
 */
const mockDayFind = jest.fn();
const mockLeaveFind = jest.fn();
const mockSectionFind = jest.fn();
const mockClassFind = jest.fn();
const mockStudentFind = jest.fn();
const mockStudentFindById = jest.fn();
const mockUserFindById = jest.fn();
const mockResolveDayType = jest.fn();
const mockResolveUnits = jest.fn();
const mockMarkerForUnit = jest.fn();
const mockGroupFind = jest.fn();

jest.mock("../modules/attendance/models/StudentAttendanceDay", () => ({
  StudentAttendanceDay: { find: (f: unknown) => ({ select: () => ({ lean: () => mockDayFind(f) }), lean: () => mockDayFind(f) }) },
}));
jest.mock("../modules/attendance/models/StudentLeaveApplication", () => ({
  StudentLeaveApplication: { find: (f: unknown) => ({ lean: () => mockLeaveFind(f) }) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (f: unknown) => ({ lean: () => mockSectionFind(f) }) },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (f: unknown) => ({ select: () => ({ lean: () => mockClassFind(f) }), lean: () => mockClassFind(f) }) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: {
    find: (f: unknown) => ({ select: () => ({ lean: () => mockStudentFind(f) }) }),
    findById: (id: unknown) => ({ lean: () => mockStudentFindById(id) }),
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockUserFindById(id) }) }) },
}));
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: (d: Date) => mockResolveDayType(d),
}));
jest.mock("../modules/attendance/attendanceUnit", () => ({
  resolveUnits: (...a: unknown[]) => mockResolveUnits(...a),
  unitKey: (u: { unitType: string; unitId: string }) => `${u.unitType}:${u.unitId}`,
}));
// The chase list names the QURAN GROUP, not just the class (live-testing find).
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: (f: unknown) => ({ select: () => ({ lean: () => mockGroupFind(f) }) }) },
}));
jest.mock("../modules/attendance/services/StudentAttendanceService", () => ({
  markerForUnit: (...a: unknown[]) => mockMarkerForUnit(...a),
  AttendanceError: class AttendanceError extends Error {},
}));

import {
  absenteeReport,
  unmarkedSections,
  studentAttendanceHistory,
} from "../modules/attendance/services/AttendanceReportService";

const DATE = "2026-06-11";

// Class 3 "ALL": kid-a (Qaida group), kid-b (Najera group). KG "Main": kid-kg (section).
const SEC_3 = "sec-3";
const SEC_KG = "sec-kg";
const QAIDA = "grp-qaida";
const NAJERA = "grp-najera";

const student = (id: string, sectionId: string, classId: string) => ({
  _id: id,
  name: id,
  nameBn: null,
  rollNumber: id.toUpperCase(),
  schoolId: id.toUpperCase(),
  sectionId,
  classId,
});

const ALL_STUDENTS = [
  student("kid-a", SEC_3, "cls-3"),
  student("kid-b", SEC_3, "cls-3"),
  student("kid-kg", SEC_KG, "cls-kg"),
];

const UNITS = new Map([
  ["kid-a", { unitType: "subjectgroup", unitId: QAIDA }],
  ["kid-b", { unitType: "subjectgroup", unitId: NAJERA }],
  ["kid-kg", { unitType: "section", unitId: SEC_KG }],
]);

const SECTIONS = [
  { _id: SEC_3, code: "ALL", nameBn: "সম্মিলিত", classId: "cls-3" },
  { _id: SEC_KG, code: "Main", nameBn: "মূল", classId: "cls-kg" },
];
const CLASSES = [
  { _id: "cls-3", level: 3, nameBn: "তৃতীয়" },
  { _id: "cls-kg", level: 0, nameBn: "কেজি" },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveDayType.mockResolvedValue("FULL");
  mockLeaveFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue(SECTIONS);
  mockClassFind.mockResolvedValue(CLASSES);
  mockStudentFind.mockResolvedValue(ALL_STUDENTS);
  mockResolveUnits.mockResolvedValue(UNITS);
  mockUserFindById.mockResolvedValue({ name: "T" });
  mockGroupFind.mockResolvedValue([
    { _id: QAIDA, nameBn: "কায়দা" },
    { _id: NAJERA, nameBn: "নাজেরা" },
  ]);
});

describe("absenteeReport — group capture rolls up to class/section", () => {
  test("a Quran-group absence surfaces under the student's own class + section", async () => {
    mockDayFind.mockResolvedValue([
      { dateKey: DATE, subjectGroupId: QAIDA, absentStudentIds: ["kid-a"] },
      { dateKey: DATE, subjectGroupId: NAJERA, absentStudentIds: [] },
      { dateKey: DATE, sectionId: SEC_KG, absentStudentIds: [] },
    ]);

    const report = await absenteeReport(DATE);
    const class3 = report.find((c) => c.classLevel === 3)!;
    expect(class3.classNameBn).toBe("তৃতীয়");
    expect(class3.absentCount).toBe(1);
    expect(class3.sections[0].sectionId).toBe(SEC_3);
    expect(class3.sections[0].absentees.map((a) => a.studentId)).toEqual(["kid-a"]);

    // No "group" concept anywhere in the payload.
    expect(JSON.stringify(report)).not.toContain(QAIDA);
    expect(JSON.stringify(report)).not.toContain("subjectGroup");
  });

  test("sections appear with zero absentees once their units are marked", async () => {
    mockDayFind.mockResolvedValue([
      { dateKey: DATE, subjectGroupId: QAIDA, absentStudentIds: [] },
      { dateKey: DATE, subjectGroupId: NAJERA, absentStudentIds: [] },
      { dateKey: DATE, sectionId: SEC_KG, absentStudentIds: [] },
    ]);
    const report = await absenteeReport(DATE);
    expect(report.map((c) => c.classLevel).sort((a, b) => a - b)).toEqual([0, 3]);
    expect(report.every((c) => c.absentCount === 0)).toBe(true);
  });

  test("a student whose unit is NOT yet marked is excluded (not silently 'present')", async () => {
    // Only Qaida marked; Najera (kid-b) and KG still pending.
    mockDayFind.mockResolvedValue([{ dateKey: DATE, subjectGroupId: QAIDA, absentStudentIds: ["kid-a"] }]);
    const report = await absenteeReport(DATE);
    expect(report).toHaveLength(1);
    const class3 = report[0];
    expect(class3.classLevel).toBe(3);
    // Section 3 shows only because kid-a's unit was marked; kid-b contributes nothing.
    expect(class3.sections[0].absentees.map((a) => a.studentId)).toEqual(["kid-a"]);
  });

  test("no day records → empty report", async () => {
    mockDayFind.mockResolvedValue([]);
    expect(await absenteeReport(DATE)).toEqual([]);
  });
});

describe("unmarkedSections — pending while ANY covering unit is unmarked", () => {
  test("Class 3 stays pending until BOTH its Quran groups are marked, naming each marker", async () => {
    mockDayFind.mockResolvedValue([
      { dateKey: DATE, subjectGroupId: QAIDA, absentStudentIds: [] }, // Najera missing
      { dateKey: DATE, sectionId: SEC_KG, absentStudentIds: [] },
    ]);
    mockMarkerForUnit.mockResolvedValue({ teacherId: "t-najera", source: "routine" });
    mockUserFindById.mockResolvedValue({ name: "Najera Teacher" });

    const rows = await unmarkedSections(DATE);
    expect(rows).toHaveLength(1);
    expect(rows[0].sectionId).toBe(SEC_3);
    expect(rows[0].markerName).toBe("Najera Teacher");
    expect(rows[0].pendingMarkerNames).toEqual(["Najera Teacher"]);

    // The Office must see WHICH Quran group is missing — naming only the class left them
    // unable to tell which Quran teacher to chase (live-testing find).
    expect(rows[0].pendingUnits).toEqual([
      expect.objectContaining({
        unitType: "subjectgroup",
        unitId: NAJERA,
        label: "নাজেরা",
        markerName: "Najera Teacher",
      }),
    ]);
  });

  test("all units marked → nothing pending", async () => {
    mockDayFind.mockResolvedValue([
      { dateKey: DATE, subjectGroupId: QAIDA, absentStudentIds: [] },
      { dateKey: DATE, subjectGroupId: NAJERA, absentStudentIds: [] },
      { dateKey: DATE, sectionId: SEC_KG, absentStudentIds: [] },
    ]);
    expect(await unmarkedSections(DATE)).toEqual([]);
  });

  test("non-FULL day → empty (attendance not expected, D-#50)", async () => {
    mockResolveDayType.mockResolvedValue("QURAN_ONLY");
    expect(await unmarkedSections(DATE)).toEqual([]);
    expect(mockDayFind).not.toHaveBeenCalled();
  });
});

describe("studentAttendanceHistory — reads through the unit, spans the cutover", () => {
  test("a Class 1–5 student's absences come from their Quran group's records", async () => {
    mockStudentFindById.mockResolvedValue(ALL_STUDENTS[0]); // kid-a → Qaida
    mockResolveUnits.mockResolvedValue(new Map([["kid-a", { unitType: "subjectgroup", unitId: QAIDA }]]));
    mockDayFind.mockResolvedValue([
      { dateKey: "2026-06-10", subjectGroupId: QAIDA, absentStudentIds: ["kid-a"] },
      { dateKey: "2026-06-11", subjectGroupId: QAIDA, absentStudentIds: [] },
    ]);

    const h = await studentAttendanceHistory("kid-a", "2026-06-01", "2026-06-30");
    expect(h.sectionId).toBe(SEC_3); // still reported section-wise
    expect(h.markedDays).toBe(2);
    expect(h.absentDays).toBe(1);
    expect(h.presentPct).toBe(50);
    // Both the group AND the section are queried, so pre-cutover rows still resolve.
    const filter = mockDayFind.mock.calls[0][0] as { $or: unknown[] };
    expect(filter.$or).toEqual(
      expect.arrayContaining([{ subjectGroupId: QAIDA }, { sectionId: SEC_3 }]),
    );
  });

  test("when both eras have a row for one day, the CURRENT unit's record wins", async () => {
    mockStudentFindById.mockResolvedValue(ALL_STUDENTS[0]);
    mockResolveUnits.mockResolvedValue(new Map([["kid-a", { unitType: "subjectgroup", unitId: QAIDA }]]));
    mockDayFind.mockResolvedValue([
      { dateKey: "2026-06-10", sectionId: SEC_3, absentStudentIds: ["kid-a"] }, // stale pre-cutover row
      { dateKey: "2026-06-10", subjectGroupId: QAIDA, absentStudentIds: [] }, // authoritative
    ]);
    const h = await studentAttendanceHistory("kid-a", "2026-06-01", "2026-06-30");
    expect(h.markedDays).toBe(1);
    expect(h.absentDays).toBe(0); // the group's record won
  });

  test("a Nursery/KG student queries only their section", async () => {
    mockStudentFindById.mockResolvedValue(ALL_STUDENTS[2]);
    mockResolveUnits.mockResolvedValue(new Map([["kid-kg", { unitType: "section", unitId: SEC_KG }]]));
    mockDayFind.mockResolvedValue([{ dateKey: DATE, sectionId: SEC_KG, absentStudentIds: [] }]);
    await studentAttendanceHistory("kid-kg", "2026-06-01", "2026-06-30");
    const filter = mockDayFind.mock.calls[0][0] as { $or: unknown[] };
    expect(filter.$or).toEqual([{ sectionId: SEC_KG }]); // no duplicate section entry
  });
});
