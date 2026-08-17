/**
 * Guardian portal GP-1 tests (D-#68/#69, prd-guardian-portal §4/§7).
 *
 * RBAC      — guardian:read_child is ACTIVE (the GP-1 flip) and GUARDIAN-only.
 * Row-scope — assertGuardianOfStudent: linked PASS; unlinked DENY; staff DENY;
 *             inactive link DENY; inactive guardian DENY (Bangla ForbiddenError).
 * myChildren — linked active students w/ section + roster label + groups (J5.3).
 * childRoutine — FULL day merges section+group slots into the NARROW guardian
 *             shape (no teacher/room/cover key exists, GP-J2); Saturday returns
 *             Quran-group slots only / empty without a group (GP-J3); Friday OFF
 *             and HOLIDAY return empty + label.
 * childClassNotes — published notes + linked HW-T1 declaration.
 * childHomework — FULL lifecycle mapping + resubmission chain (GP-J4/J5).
 * childDayLoad — guardian-gated wrapper over getStudentDayLoad.
 * Source guard — the guardian module never references RoutineSubstitution /
 *             routineForDate (D-#69) and exposes no teacher/room field.
 *
 * DB-free: all models + cross-module services are mocked (house pattern).
 */
import * as fs from "fs";
import * as path from "path";
import mongoose from "mongoose";
import { roleHasPermission, isPermissionActive } from "@scd/shared";
import type { AppContext } from "../context";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Model + cross-service mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const mockGuardianFindById = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { findById: (id: unknown) => ({ lean: () => mockGuardianFindById(id) }) },
}));

const mockLinkFind = jest.fn();
const mockLinkFindOne = jest.fn();
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: {
    find: (q: unknown) => ({ lean: () => mockLinkFind(q) }),
    findOne: (q: unknown) => ({ lean: () => mockLinkFindOne(q) }),
  },
}));

const mockStudentFind = jest.fn();
const mockStudentFindById = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: {
    find: (q: unknown) => ({ lean: () => mockStudentFind(q) }),
    findById: (id: unknown) => ({ lean: () => mockStudentFindById(id) }),
  },
}));

const mockSectionFind = jest.fn();
const mockSectionFindById = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: {
    find: (q: unknown) => ({ lean: () => mockSectionFind(q) }),
    findById: (id: unknown) => ({ lean: () => mockSectionFindById(id) }),
  },
}));

const mockClassFind = jest.fn();
const mockClassFindById = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: {
    find: (q: unknown) => ({ lean: () => mockClassFind(q) }),
    findById: (id: unknown) => ({ lean: () => mockClassFindById(id) }),
  },
}));

const mockGroupFind = jest.fn();
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: (q: unknown) => ({ lean: () => mockGroupFind(q) }) },
}));

const mockMembershipFind = jest.fn();
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: { find: (q: unknown) => ({ lean: () => mockMembershipFind(q) }) },
}));

const mockHolidayFindOne = jest.fn();
const mockHolidayFind = jest.fn();
jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: {
    findOne: (q: unknown) => ({ lean: () => mockHolidayFindOne(q) }),
    // GP-9: the window read takes every overlapping holiday in ONE query.
    find: (q: unknown) => ({ lean: () => mockHolidayFind(q) }),
  },
}));

const mockWindowFind = jest.fn();
jest.mock("../modules/routine/models/ScheduleWindow", () => ({
  ScheduleWindow: { find: (q: unknown) => ({ lean: () => mockWindowFind(q) }) },
}));

const mockGridFindOne = jest.fn();
const mockGridFind = jest.fn();
jest.mock("../modules/routine/models/PeriodGrid", () => ({
  PeriodGrid: {
    findOne: (q: unknown) => ({ lean: () => mockGridFindOne(q) }),
    // GP-9: every season's grid at once, so the day loop reads nothing.
    find: (q: unknown) => ({ lean: () => mockGridFind(q) }),
  },
}));

const mockRoutineSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (q: unknown) => ({ lean: () => mockRoutineSlotFind(q) }) },
}));

const mockSlotsForDate = jest.fn();
jest.mock("../modules/routine/services/RoutineSlotService", () => ({
  slotsForDate: (gt: unknown, gid: unknown, d: unknown) => mockSlotsForDate(gt, gid, d),
}));

const mockClassNotesForDate = jest.fn();
const mockClassNotesForRange = jest.fn();
jest.mock("../modules/routine/services/RoutineTriggerService", () => ({
  classNotesForDate: (gt: unknown, gid: unknown, d: unknown) => mockClassNotesForDate(gt, gid, d),
  classNotesForRange: (gt: unknown, gid: unknown, f: unknown, t: unknown) =>
    mockClassNotesForRange(gt, gid, f, t),
}));

const mockHwItemFind = jest.fn();
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: (q: unknown) => ({ lean: () => mockHwItemFind(q) }) },
}));
// Class-note attachments are resolved for name/mime in one batched load.
const mockStoredFileFind = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: { find: (q: unknown) => ({ select: () => ({ lean: () => mockStoredFileFind(q) }) }) },
}));

const mockHwRecordFind = jest.fn();
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { find: (q: unknown) => ({ lean: () => mockHwRecordFind(q) }) },
}));

const mockGetStudentDayLoad = jest.fn();
jest.mock("../modules/trackers/services/HomeworkResubmissionService", () => ({
  getStudentDayLoad: (c: unknown, s: unknown, d: unknown) => mockGetStudentDayLoad(c, s, d),
}));

// Import AFTER mocks
import { assertGuardianOfStudent, ForbiddenError } from "../middleware/authz";
import {
  myChildren,
  childRoutine,
  childRoutineRange,
  childClassNotes,
  childClassNotesRange,
  GUARDIAN_RANGE_MAX_DAYS,
  childHomework,
  childDayLoad,
} from "../modules/guardian/services/GuardianPortalService";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GUARDIAN_ID = oid();
const STUDENT_ID = oid();
const SECTION_ID = oid();
const CLASS_ID = oid();
const QURAN_GROUP_ID = oid();
const ARABIC_GROUP_ID = oid();
const TEACHER_ID = oid();
const ROOM_ID = oid();

const TUESDAY = new Date(2026, 5, 2); // FULL school day
const FRIDAY = new Date(2026, 5, 5); // OFF
const SATURDAY = new Date(2026, 5, 6); // QURAN_ONLY

const guardianCtx = {
  auth: { userId: GUARDIAN_ID.toString(), role: "GUARDIAN" },
} as unknown as AppContext;

function studentDoc() {
  return {
    _id: STUDENT_ID,
    schoolId: "S-001",
    name: "Rahim",
    nameBn: "রহিম",
    gender: "male",
    classId: CLASS_ID,
    sectionId: SECTION_ID,
    active: true,
  };
}

const quranGroup = {
  _id: QURAN_GROUP_ID,
  track: "quran",
  level: "Hifz 1",
  gender: "boys",
  code: "Q-H1-B",
  nameBn: "হিফজ ১ (ছেলে)",
  active: true,
};
const arabicGroup = {
  _id: ARABIC_GROUP_ID,
  track: "arabic",
  level: "Book 1",
  gender: "boys",
  code: "A-B1-B",
  nameBn: "আরবি বই ১ (ছেলে)",
  active: true,
};

/** A STAFF-SHAPED slot doc — carries teacherId/roomId on purpose, so the tests
 *  prove the guardian layer strips them (D-#69). */
function staffSlot(periodNumber: number, subject: string, extra: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    groupType: "section",
    groupId: SECTION_ID,
    dayOfWeek: "TUE",
    periodNumber,
    subject,
    track: "general",
    isBreak: false,
    teacherId: TEACHER_ID,
    roomId: ROOM_ID,
    effectiveFrom: new Date(2026, 0, 1),
    active: true,
    ...extra,
  };
}

beforeEach(() => {
  mockStoredFileFind.mockResolvedValue([]);
  jest.clearAllMocks();
  mockGuardianFindById.mockResolvedValue({ _id: GUARDIAN_ID, name: "Guardian", active: true });
  mockLinkFindOne.mockResolvedValue({ guardianId: GUARDIAN_ID, studentId: STUDENT_ID });
  mockStudentFindById.mockResolvedValue(studentDoc());
  mockHolidayFindOne.mockResolvedValue(null);
  mockWindowFind.mockResolvedValue([
    {
      fromDate: new Date(2026, 0, 1),
      toDate: new Date(2026, 11, 31),
      season: "regular",
      dayStartMinutes: 420, // 07:00
    },
  ]);
  mockGridFindOne.mockResolvedValue({
    audienceKey: "class_1_5",
    classLevels: [1, 2, 3, 4, 5],
    season: "regular",
    periods: [
      { number: 1, durationMin: 45, isBreak: false, track: "quran", nameBn: "১ম" },
      { number: 2, durationMin: 45, isBreak: false, track: "quran", nameBn: "২য়" },
      { number: 3, durationMin: 40, isBreak: false, track: "arabic", nameBn: "৩য়" },
    ],
  });
  mockHolidayFind.mockResolvedValue([]);
  mockGridFind.mockResolvedValue([
    {
      audienceKey: "class_1_5",
      classLevels: [1, 2, 3, 4, 5],
      season: "regular",
      periods: [
        { number: 1, durationMin: 45, isBreak: false, track: "quran", nameBn: "১ম" },
        { number: 2, durationMin: 45, isBreak: false, track: "quran", nameBn: "২য়" },
        { number: 3, durationMin: 40, isBreak: false, track: "arabic", nameBn: "৩য়" },
      ],
    },
  ]);
  mockRoutineSlotFind.mockResolvedValue([]);
  mockMembershipFind.mockResolvedValue([]);
  mockGroupFind.mockResolvedValue([]);
  mockSlotsForDate.mockResolvedValue([]);
  mockClassNotesForDate.mockResolvedValue([]);
  mockClassFindById.mockResolvedValue({ _id: CLASS_ID, level: 2, nameBn: "দ্বিতীয়" });
});

// ===========================================================================
// RBAC — the GP-1 vocab flip (D-#68)
// ===========================================================================

describe("RBAC: guardian:read_child active + GUARDIAN-only", () => {
  test("guardian:read_child is ACTIVE (flipped from pipeline in GP-1)", () => {
    expect(isPermissionActive("guardian:read_child")).toBe(true);
  });

  test("only GUARDIAN holds guardian:read_child (staff role gate = DENY, GP-J9)", () => {
    expect(roleHasPermission("GUARDIAN", "guardian:read_child")).toBe(true);
    expect(roleHasPermission("TEACHER", "guardian:read_child")).toBe(false);
    expect(roleHasPermission("PRINCIPAL", "guardian:read_child")).toBe(false);
    expect(roleHasPermission("OFFICE", "guardian:read_child")).toBe(false);
  });
});

// ===========================================================================
// assertGuardianOfStudent — link-scoped row authz (GP-J9)
// ===========================================================================

describe("assertGuardianOfStudent", () => {
  const sid = STUDENT_ID.toString();

  test("linked active guardian PASSES", async () => {
    await expect(assertGuardianOfStudent(guardianCtx, sid)).resolves.toBeUndefined();
  });

  test("unauthenticated DENIED", async () => {
    await expect(
      assertGuardianOfStudent({ auth: null } as unknown as AppContext, sid),
    ).rejects.toThrow(ForbiddenError);
  });

  test("staff role DENIED (role gate)", async () => {
    const teacherCtx = {
      auth: { userId: TEACHER_ID.toString(), role: "TEACHER" },
    } as unknown as AppContext;
    await expect(assertGuardianOfStudent(teacherCtx, sid)).rejects.toThrow(ForbiddenError);
  });

  test("unlinked student DENIED", async () => {
    mockLinkFindOne.mockResolvedValue(null);
    await expect(assertGuardianOfStudent(guardianCtx, sid)).rejects.toThrow(
      "এই শিক্ষার্থীর তথ্য দেখার অনুমতি নেই",
    );
  });

  test("inactive link DENIED", async () => {
    mockLinkFindOne.mockResolvedValue({ guardianId: GUARDIAN_ID, studentId: STUDENT_ID, active: false });
    await expect(assertGuardianOfStudent(guardianCtx, sid)).rejects.toThrow(ForbiddenError);
  });

  test("a link with NO active field (pre-GP-1 row) still PASSES", async () => {
    mockLinkFindOne.mockResolvedValue({ guardianId: GUARDIAN_ID, studentId: STUDENT_ID });
    await expect(assertGuardianOfStudent(guardianCtx, sid)).resolves.toBeUndefined();
  });

  test("inactive guardian DENIED", async () => {
    mockGuardianFindById.mockResolvedValue({ _id: GUARDIAN_ID, active: false });
    await expect(assertGuardianOfStudent(guardianCtx, sid)).rejects.toThrow(ForbiddenError);
  });
});

// ===========================================================================
// myChildren (J5.3 / GP-J1)
// ===========================================================================

describe("myChildren", () => {
  test("returns linked ACTIVE students with section, roster label and groups", async () => {
    mockLinkFind.mockResolvedValue([
      { guardianId: GUARDIAN_ID, studentId: STUDENT_ID },
      { guardianId: GUARDIAN_ID, studentId: oid(), active: false }, // revoked → filtered
    ]);
    mockStudentFind.mockResolvedValue([studentDoc()]);
    mockSectionFind.mockResolvedValue([
      { _id: SECTION_ID, classId: CLASS_ID, code: "Main", nameBn: "মূল" },
    ]);
    mockClassFind.mockResolvedValue([{ _id: CLASS_ID, level: 2, nameBn: "দ্বিতীয়" }]);
    mockMembershipFind.mockResolvedValue([
      { groupId: QURAN_GROUP_ID, studentId: STUDENT_ID },
      { groupId: ARABIC_GROUP_ID, studentId: STUDENT_ID },
    ]);
    mockGroupFind.mockResolvedValue([quranGroup, arabicGroup]);

    const children = await myChildren(GUARDIAN_ID.toString());

    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      studentId: STUDENT_ID.toString(),
      nameBn: "রহিম",
      gender: "male",
      rosterClassLabel: "দ্বিতীয় শ্রেণি",
      sectionId: SECTION_ID.toString(),
      sectionName: "মূল",
      quranGroup: { id: QURAN_GROUP_ID.toString(), name: "হিফজ ১ (ছেলে)" },
      arabicGroup: { id: ARABIC_GROUP_ID.toString(), name: "আরবি বই ১ (ছেলে)" },
    });
  });

  test("inactive guardian account DENIED", async () => {
    mockGuardianFindById.mockResolvedValue({ _id: GUARDIAN_ID, active: false });
    await expect(myChildren(GUARDIAN_ID.toString())).rejects.toThrow(ForbiddenError);
  });

  test("no links → empty list (not an error)", async () => {
    mockLinkFind.mockResolvedValue([]);
    await expect(myChildren(GUARDIAN_ID.toString())).resolves.toEqual([]);
  });
});

// ===========================================================================
// childRoutine — narrow slots, day-types (GP-J2 / GP-J3)
// ===========================================================================

describe("childRoutine", () => {
  test("FULL day: merges section + group slots into the NARROW shape — no teacher/room/cover key exists (GP-J2/D-#69)", async () => {
    mockMembershipFind.mockResolvedValue([{ groupId: QURAN_GROUP_ID, studentId: STUDENT_ID }]);
    mockGroupFind.mockResolvedValue([quranGroup]);
    mockSlotsForDate.mockImplementation(async (groupType: string) =>
      groupType === "section"
        ? [
            staffSlot(3, "ARABIC", { track: "arabic" }),
            staffSlot(4, "BAN", { isBreak: false }),
            staffSlot(5, "TIFFIN", { isBreak: true, subject: "BAN" }), // break → dropped
          ]
        : [staffSlot(1, "QURAN", { groupType: "subjectgroup", groupId: QURAN_GROUP_ID, track: "quran" })],
    );

    const day = await childRoutine(STUDENT_ID.toString(), TUESDAY);

    expect(day.dayType).toBe("FULL");
    expect(day.slots.map((s) => s.periodNumber)).toEqual([1, 3, 4]); // sorted, break dropped
    expect(day.slots[0]).toEqual({
      subject: "QURAN",
      subjectLabelBn: "কুরআন",
      periodNumber: 1,
      startHHMM: "07:00",
      endHHMM: "07:45",
    });
    // The staff fixture slots DID carry teacherId/roomId — assert the guardian
    // shape has NO such key at all (not merely null), incl. cover (GP-J2).
    for (const slot of day.slots) {
      expect(Object.keys(slot).sort()).toEqual(
        ["endHHMM", "periodNumber", "startHHMM", "subject", "subjectLabelBn"].sort(),
      );
      expect("teacherId" in slot).toBe(false);
      expect("roomId" in slot).toBe(false);
      expect("coverTeacherId" in slot).toBe(false);
    }
  });

  test("Saturday: Quran-group slots ONLY (GP-J3)", async () => {
    mockMembershipFind.mockResolvedValue([
      { groupId: QURAN_GROUP_ID, studentId: STUDENT_ID },
      { groupId: ARABIC_GROUP_ID, studentId: STUDENT_ID },
    ]);
    mockGroupFind.mockResolvedValue([quranGroup, arabicGroup]);
    mockSlotsForDate.mockResolvedValue([
      staffSlot(1, "QURAN", { groupType: "subjectgroup", groupId: QURAN_GROUP_ID, track: "quran", dayOfWeek: "SAT" }),
    ]);

    const day = await childRoutine(STUDENT_ID.toString(), SATURDAY);

    expect(day.dayType).toBe("QURAN_ONLY");
    expect(day.slots).toHaveLength(1);
    expect(day.slots[0].subject).toBe("QURAN");
    // Only the quran group was consulted — never the section, never the arabic group.
    expect(mockSlotsForDate).toHaveBeenCalledTimes(1);
    expect(mockSlotsForDate).toHaveBeenCalledWith("subjectgroup", QURAN_GROUP_ID.toString(), SATURDAY);
  });

  test("Saturday with NO Quran group → empty (GP-J3)", async () => {
    mockMembershipFind.mockResolvedValue([{ groupId: ARABIC_GROUP_ID, studentId: STUDENT_ID }]);
    mockGroupFind.mockResolvedValue([arabicGroup]);

    const day = await childRoutine(STUDENT_ID.toString(), SATURDAY);

    expect(day.dayType).toBe("QURAN_ONLY");
    expect(day.slots).toEqual([]);
    expect(mockSlotsForDate).not.toHaveBeenCalled();
  });

  test("Friday → OFF, empty slots", async () => {
    const day = await childRoutine(STUDENT_ID.toString(), FRIDAY);
    expect(day.dayType).toBe("OFF");
    expect(day.slots).toEqual([]);
    expect(mockSlotsForDate).not.toHaveBeenCalled();
  });

  test("holiday → HOLIDAY + Bangla label, empty slots", async () => {
    mockHolidayFindOne.mockResolvedValue({ nameBn: "ঈদুল আজহা", type: "eid", active: true });
    const day = await childRoutine(STUDENT_ID.toString(), TUESDAY);
    expect(day.dayType).toBe("HOLIDAY");
    expect(day.holidayNameBn).toBe("ঈদুল আজহা");
    expect(day.slots).toEqual([]);
  });
});

// ===========================================================================
// childRoutineRange (GP-9, D-#506) — the same day, batched over a window
// ===========================================================================

describe("childRoutineRange", () => {
  // Mon 2026-06-01 .. Sat 2026-06-06: FULL Mon–Thu, Friday OFF, Saturday QURAN_ONLY.
  const MONDAY = new Date(2026, 5, 1);

  test("one entry per calendar day, newest first, with the day type resolved per day", async () => {
    const days = await childRoutineRange(STUDENT_ID.toString(), MONDAY, SATURDAY);

    expect(days.map((d) => d.dateKey)).toEqual([
      "2026-06-06",
      "2026-06-05",
      "2026-06-04",
      "2026-06-03",
      "2026-06-02",
      "2026-06-01",
    ]);
    const byKey = new Map(days.map((d) => [d.dateKey, d]));
    expect(byKey.get("2026-06-02")!.dayType).toBe("FULL");
    expect(byKey.get("2026-06-05")!.dayType).toBe("OFF"); // Friday
    expect(byKey.get("2026-06-06")!.dayType).toBe("QURAN_ONLY"); // Saturday
    // A non-teaching day carries its label and NO slots.
    expect(byKey.get("2026-06-05")!.slots).toEqual([]);
  });

  test("the whole window costs a FIXED number of queries — never one set per day (D-#476 posture)", async () => {
    mockRoutineSlotFind.mockResolvedValue([staffSlot(4, "BAN")]);

    // 14 days — the window the homework screen opens on.
    await childRoutineRange(STUDENT_ID.toString(), MONDAY, new Date(2026, 5, 14));

    expect(mockRoutineSlotFind).toHaveBeenCalledTimes(1);
    expect(mockHolidayFind).toHaveBeenCalledTimes(1);
    expect(mockWindowFind).toHaveBeenCalledTimes(1);
    expect(mockGridFind).toHaveBeenCalledTimes(1);
    // And the per-day helpers of the single-day read are not used at all.
    expect(mockSlotsForDate).not.toHaveBeenCalled();
    expect(mockHolidayFindOne).not.toHaveBeenCalled();
    expect(mockGridFindOne).not.toHaveBeenCalled();
  });

  test("a slot lands on its OWN weekday only, in the NARROW shape (D-#69)", async () => {
    mockRoutineSlotFind.mockResolvedValue([
      staffSlot(4, "BAN", { dayOfWeek: "TUE" }),
      staffSlot(2, "MATH", { dayOfWeek: "TUE" }),
      staffSlot(1, "ENG", { dayOfWeek: "WED" }),
      staffSlot(5, "TIFFIN", { dayOfWeek: "TUE", isBreak: true, subject: "BAN" }), // break → dropped
    ]);

    const days = await childRoutineRange(STUDENT_ID.toString(), MONDAY, SATURDAY);
    const byKey = new Map(days.map((d) => [d.dateKey, d]));

    // Tuesday: both TUE slots, period-sorted, break dropped.
    expect(byKey.get("2026-06-02")!.slots.map((s) => s.periodNumber)).toEqual([2, 4]);
    expect(byKey.get("2026-06-03")!.slots.map((s) => s.subject)).toEqual(["ENG"]); // Wednesday
    expect(byKey.get("2026-06-01")!.slots).toEqual([]); // Monday has none
    // The fixture slots carry teacherId/roomId — the guardian shape must not.
    for (const s of byKey.get("2026-06-02")!.slots) {
      expect(Object.keys(s).sort()).toEqual(
        ["endHHMM", "periodNumber", "startHHMM", "subject", "subjectLabelBn"].sort(),
      );
      expect("teacherId" in s).toBe(false);
      expect("roomId" in s).toBe(false);
    }
    expect(byKey.get("2026-06-02")!.slots[0]).toEqual({
      subject: "MATH",
      subjectLabelBn: "গণিত",
      periodNumber: 2,
      startHHMM: "07:45",
      endHHMM: "08:30",
    });
  });

  test("the effective window is applied PER DAY and is day-granular (D-#502)", async () => {
    // Created effective 2026-06-03, retired at the end of 2026-06-04.
    mockRoutineSlotFind.mockResolvedValue([
      staffSlot(4, "BAN", {
        dayOfWeek: "TUE",
        effectiveFrom: new Date(2026, 5, 3),
        effectiveTo: new Date(2026, 5, 4, 23, 59, 59, 999),
      }),
      staffSlot(1, "MATH", { dayOfWeek: "TUE", effectiveFrom: new Date(2026, 5, 3) }),
    ]);

    const days = await childRoutineRange(STUDENT_ID.toString(), MONDAY, new Date(2026, 5, 16));
    const subjectsOn = (k: string) =>
      days.find((d) => d.dateKey === k)!.slots.map((s) => s.subject);

    expect(subjectsOn("2026-06-02")).toEqual([]); // Tuesday BEFORE effectiveFrom
    expect(subjectsOn("2026-06-09")).toEqual(["MATH"]); // BAN retired by then, MATH still live
    expect(subjectsOn("2026-06-16")).toEqual(["MATH"]);
  });

  test("Saturday returns the Quran GROUP's slots only — never the section's (D-#50)", async () => {
    mockMembershipFind.mockResolvedValue([
      { groupId: QURAN_GROUP_ID, studentId: STUDENT_ID },
      { groupId: ARABIC_GROUP_ID, studentId: STUDENT_ID },
    ]);
    mockGroupFind.mockResolvedValue([quranGroup, arabicGroup]);
    mockRoutineSlotFind.mockResolvedValue([
      staffSlot(1, "QURAN", {
        groupType: "subjectgroup",
        groupId: QURAN_GROUP_ID,
        dayOfWeek: "SAT",
      }),
      staffSlot(2, "ARABIC", {
        groupType: "subjectgroup",
        groupId: ARABIC_GROUP_ID,
        dayOfWeek: "SAT",
      }),
      staffSlot(3, "BAN", { dayOfWeek: "SAT" }), // a section slot on Saturday
    ]);

    const sat = (await childRoutineRange(STUDENT_ID.toString(), SATURDAY, SATURDAY))[0];

    expect(sat.dayType).toBe("QURAN_ONLY");
    expect(sat.slots.map((s) => s.subject)).toEqual(["QURAN"]);
  });

  test("a holiday covering part of the window marks only those days", async () => {
    mockHolidayFind.mockResolvedValue([
      {
        nameBn: "ঈদুল আজহা",
        type: "eid",
        active: true,
        fromDate: new Date(2026, 5, 2),
        toDate: new Date(2026, 5, 3),
      },
    ]);
    mockRoutineSlotFind.mockResolvedValue([staffSlot(4, "BAN", { dayOfWeek: "TUE" })]);

    const days = await childRoutineRange(STUDENT_ID.toString(), MONDAY, SATURDAY);
    const byKey = new Map(days.map((d) => [d.dateKey, d]));

    expect(byKey.get("2026-06-02")!.dayType).toBe("HOLIDAY");
    expect(byKey.get("2026-06-02")!.holidayNameBn).toBe("ঈদুল আজহা");
    expect(byKey.get("2026-06-02")!.slots).toEqual([]); // a holiday teaches nothing
    expect(byKey.get("2026-06-03")!.dayType).toBe("HOLIDAY");
    expect(byKey.get("2026-06-01")!.dayType).toBe("FULL");
    expect(byKey.get("2026-06-01")!.holidayNameBn).toBeNull();
  });

  test("an over-long window is refused before any database read", async () => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 1 + GUARDIAN_RANGE_MAX_DAYS);
    await expect(childRoutineRange(STUDENT_ID.toString(), from, to)).rejects.toThrow(/Range too wide/);
    expect(mockRoutineSlotFind).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// childClassNotes
// ===========================================================================

describe("childClassNotes", () => {
  test("returns the section's published notes with period + linked homework", async () => {
    const slotId = oid();
    const hwItemId = oid();
    mockClassNotesForDate.mockImplementation(async (groupType: string) =>
      groupType === "section"
        ? [
            {
              _id: oid(),
              slotId,
              groupType: "section",
              groupId: SECTION_ID,
              date: TUESDAY,
              subject: "BAN",
              taughtSummaryBn: "পাঠ ৩ পড়ানো হয়েছে",
              homeworkItemId: hwItemId,
              publishedBy: TEACHER_ID,
              publishedAt: TUESDAY,
            },
          ]
        : [],
    );
    mockRoutineSlotFind.mockResolvedValue([{ _id: slotId, periodNumber: 4 }]);
    mockHwItemFind.mockResolvedValue([
      { _id: hwItemId, hwId: "HW-C2-BAN-0007", subject: "BAN", qCount: 3, timeDecl: 20 },
    ]);

    const notes = await childClassNotes(STUDENT_ID.toString(), TUESDAY);

    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual({
      subject: "BAN",
      subjectLabelBn: "বাংলা",
      periodNumber: 4,
      taughtSummaryBn: "পাঠ ৩ পড়ানো হয়েছে",
      homework: {
        hwId: "HW-C2-BAN-0007",
        subject: "BAN",
        subjectLabelBn: "বাংলা",
        qCount: 3,
        timeDecl: 20,
        // DE-6 (D-#478): the guardian read now carries WHAT the homework is;
        // null here because this fixture item predates the field.
        description: null,
      },
      attachments: [], // a note with no files carries an empty list, never undefined
    });
  });

  test("a note's attachments surface with name + mime, resolved in one batched load", async () => {
    const slotId = oid();
    const fileA = oid();
    const fileB = oid();
    mockClassNotesForDate.mockImplementation(async (groupType: string) =>
      groupType === "section"
        ? [
            {
              _id: oid(),
              slotId,
              groupType: "section",
              groupId: SECTION_ID,
              date: TUESDAY,
              subject: "BAN",
              taughtSummaryBn: "পাঠ ৩",
              attachmentIds: [fileA, fileB],
              publishedBy: TEACHER_ID,
              publishedAt: TUESDAY,
            },
          ]
        : [],
    );
    mockRoutineSlotFind.mockResolvedValue([{ _id: slotId, periodNumber: 1 }]);
    mockHwItemFind.mockResolvedValue([]);
    mockStoredFileFind.mockResolvedValue([
      { _id: fileA, originalName: "worksheet.pdf", mime: "application/pdf" },
    ]);

    const notes = await childClassNotes(STUDENT_ID.toString(), TUESDAY);
    expect(mockStoredFileFind).toHaveBeenCalledTimes(1); // batched, not per-file
    expect(notes[0].attachments).toEqual([
      { id: fileA.toString(), name: "worksheet.pdf", mime: "application/pdf" },
      // A file row that vanished still lists, so the guardian sees the note is incomplete.
      { id: fileB.toString(), name: "file", mime: "" },
    ]);
  });

  test("no notes → empty list", async () => {
    await expect(childClassNotes(STUDENT_ID.toString(), TUESDAY)).resolves.toEqual([]);
  });
});

// ===========================================================================
// childClassNotesRange (D-#476) — the history window that replaced one
// request per day. The behaviour that matters: the whole window costs a fixed
// number of group queries, days come back newest-first, and an absurd window
// is refused before it reaches the database.
// ===========================================================================

describe("childClassNotesRange", () => {
  const FROM = new Date(2026, 5, 1);
  const TO = new Date(2026, 5, 7);

  function noteOn(date: Date, subject: string, slotId: ReturnType<typeof oid>) {
    return {
      _id: oid(),
      slotId,
      groupType: "section",
      groupId: SECTION_ID,
      date,
      subject,
      taughtSummaryBn: `${subject} পড়ানো হয়েছে`,
      publishedBy: TEACHER_ID,
      publishedAt: date,
    };
  }

  test("groups the window into days, newest first, without a query per day", async () => {
    const slotId = oid();
    mockClassNotesForRange.mockImplementation(async (groupType: string) =>
      groupType === "section"
        ? [
            noteOn(new Date(2026, 5, 4), "MATH", slotId),
            noteOn(new Date(2026, 5, 2), "BAN", slotId),
            noteOn(new Date(2026, 5, 2), "ENG", slotId),
          ]
        : [],
    );
    mockRoutineSlotFind.mockResolvedValue([{ _id: slotId, periodNumber: 2 }]);
    mockHwItemFind.mockResolvedValue([]);

    const days = await childClassNotesRange(STUDENT_ID.toString(), FROM, TO);

    expect(days.map((d) => d.dateKey)).toEqual(["2026-06-04", "2026-06-02"]);
    expect(days[0].notes.map((n) => n.subject)).toEqual(["MATH"]);
    expect(days[1].notes.map((n) => n.subject)).toEqual(["BAN", "ENG"]);
    // One call per GROUP (section + the child's groups) — never one per day.
    // This is the whole reason the window can now be longer than a week.
    expect(mockClassNotesForRange).toHaveBeenCalledTimes(1);
    expect(mockClassNotesForDate).not.toHaveBeenCalled();
  });

  test("notes keep their period + Bangla labels, exactly as the single-day read shapes them", async () => {
    const slotId = oid();
    const hwItemId = oid();
    mockClassNotesForRange.mockImplementation(async (groupType: string) =>
      groupType === "section"
        ? [{ ...noteOn(new Date(2026, 5, 3), "BAN", slotId), homeworkItemId: hwItemId }]
        : [],
    );
    mockRoutineSlotFind.mockResolvedValue([{ _id: slotId, periodNumber: 4 }]);
    mockHwItemFind.mockResolvedValue([
      { _id: hwItemId, hwId: "HW-C2-BAN-0007", subject: "BAN", qCount: 3, timeDecl: 20 },
    ]);

    const days = await childClassNotesRange(STUDENT_ID.toString(), FROM, TO);

    expect(days).toHaveLength(1);
    expect(days[0].notes[0]).toEqual({
      subject: "BAN",
      subjectLabelBn: "বাংলা",
      periodNumber: 4,
      taughtSummaryBn: "BAN পড়ানো হয়েছে",
      homework: {
        hwId: "HW-C2-BAN-0007",
        subject: "BAN",
        subjectLabelBn: "বাংলা",
        qCount: 3,
        timeDecl: 20,
        // DE-6 (D-#478): the guardian read now carries WHAT the homework is;
        // null here because this fixture item predates the field.
        description: null,
      },
      attachments: [],
    });
  });

  test("an empty window is an empty list, not an error", async () => {
    mockClassNotesForRange.mockResolvedValue([]);
    await expect(childClassNotesRange(STUDENT_ID.toString(), FROM, TO)).resolves.toEqual([]);
  });

  test("a window wider than the cap is refused BEFORE any database work", async () => {
    const tooFar = new Date(2026, 5, 1);
    const end = new Date(tooFar);
    end.setDate(end.getDate() + GUARDIAN_RANGE_MAX_DAYS); // cap + 1 day inclusive

    await expect(childClassNotesRange(STUDENT_ID.toString(), tooFar, end)).rejects.toThrow(
      /Range too wide/,
    );
    expect(mockClassNotesForRange).not.toHaveBeenCalled();
  });

  test("exactly the cap is allowed — the boundary is inclusive", async () => {
    mockClassNotesForRange.mockResolvedValue([]);
    const start = new Date(2026, 5, 1);
    const end = new Date(start);
    end.setDate(end.getDate() + (GUARDIAN_RANGE_MAX_DAYS - 1));

    await expect(childClassNotesRange(STUDENT_ID.toString(), start, end)).resolves.toEqual([]);
    expect(mockClassNotesForRange).toHaveBeenCalled();
  });

  test("an inverted window is refused", async () => {
    await expect(childClassNotesRange(STUDENT_ID.toString(), TO, FROM)).rejects.toThrow(
      /from must not be after to/,
    );
    expect(mockClassNotesForRange).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// childHomework — FULL lifecycle + resubmission chain (GP-J4 / GP-J5)
// ===========================================================================

describe("childHomework", () => {
  const FROM = new Date(2026, 5, 1);
  const TO = new Date(2026, 5, 7);

  test("maps the full lifecycle: stamps, chase count, result, resubmission chain", async () => {
    const itemId = oid();
    const outsideItemId = oid();
    const originalId = oid();
    const t = (d: number, h: number) => new Date(2026, 5, d, h, 0, 0);

    mockHwRecordFind.mockResolvedValue([
      {
        _id: originalId,
        hwItemId: itemId,
        hwId: "HW-C2-MATH-0009",
        studentId: STUDENT_ID,
        state: "RESUBMIT",
        stateDates: [
          { state: "GIVEN", at: t(2, 9) },
          { state: "DUE", at: t(3, 9) },
          { state: "CHASE", at: t(3, 12) },
          { state: "SUBMITTED", at: t(4, 9) },
          { state: "CHECKED", at: t(4, 13) },
          { state: "RESUBMIT", at: t(4, 13) },
        ],
        dueDate: t(3, 0),
        chaseCount: 2,
        result: "WRONG",
        topupFlag: false,
        topupQids: [],
        issuedBy: TEACHER_ID,
      },
      {
        _id: oid(),
        hwItemId: itemId,
        hwId: "HW-C2-MATH-0009", // SAME HW_ID — the chain (GP-J5)
        studentId: STUDENT_ID,
        state: "GIVEN",
        stateDates: [{ state: "GIVEN", at: t(4, 13) }],
        dueDate: t(7, 0),
        chaseCount: 0,
        resubOf: originalId,
        topupFlag: true,
        topupQids: ["Q-MATH-C2-U01-001", "Q-MATH-C2-U01-002"],
        topupTime: 15,
        issuedBy: TEACHER_ID,
      },
      {
        _id: oid(),
        hwItemId: outsideItemId, // outside [from,to] → filtered
        hwId: "HW-C2-MATH-0001",
        studentId: STUDENT_ID,
        state: "RETURNED",
        stateDates: [],
        chaseCount: 0,
        topupFlag: false,
        topupQids: [],
        issuedBy: TEACHER_ID,
      },
    ]);
    mockHwItemFind.mockResolvedValue([
      { _id: itemId, hwId: "HW-C2-MATH-0009", subject: "MATH", dateGiven: t(2, 0), qCount: 4, timeDecl: 25 },
      { _id: outsideItemId, hwId: "HW-C2-MATH-0001", subject: "MATH", dateGiven: new Date(2026, 4, 10), qCount: 2, timeDecl: 10 },
    ]);

    const records = await childHomework(STUDENT_ID.toString(), FROM, TO);

    expect(records).toHaveLength(2); // the out-of-range record is filtered
    const [original, resub] = records; // same day → original (no resubOf) first
    expect(original).toMatchObject({
      hwId: "HW-C2-MATH-0009",
      subjectLabelBn: "গণিত",
      state: "RESUBMIT",
      stateLabelBn: "পুনঃজমা",
      chaseCount: 2,
      result: "WRONG",
      resultLabelBn: "ভুল",
      resubOf: null,
    });
    expect(original.givenAt).not.toBeNull();
    expect(original.submittedAt).not.toBeNull();
    expect(original.checkedAt).not.toBeNull();
    expect(resub).toMatchObject({
      hwId: "HW-C2-MATH-0009",
      state: "GIVEN",
      resubOf: originalId.toString(),
      topupFlag: true,
      topupQCount: 2,
      topupTimeMin: 15,
      questionFileId: null, // GP-A fills these
      answerFileId: null,
    });
  });

  test("no records → empty list", async () => {
    mockHwRecordFind.mockResolvedValue([]);
    await expect(childHomework(STUDENT_ID.toString(), FROM, TO)).resolves.toEqual([]);
  });
});

// ===========================================================================
// childDayLoad — guardian-gated wrapper (vs the LOCKED 120)
// ===========================================================================

describe("childDayLoad", () => {
  test("delegates to getStudentDayLoad with the child's class", async () => {
    const load = {
      studentId: STUDENT_ID.toString(),
      classId: CLASS_ID.toString(),
      baseMinutes: 60,
      topupMinutes: 15,
      totalMinutes: 75,
      ceiling: 120,
      overCeiling: false,
    };
    mockGetStudentDayLoad.mockResolvedValue(load);

    const result = await childDayLoad(STUDENT_ID.toString(), TUESDAY);

    expect(result).toEqual(load);
    expect(mockGetStudentDayLoad).toHaveBeenCalledWith(
      CLASS_ID.toString(),
      STUDENT_ID.toString(),
      TUESDAY,
    );
  });
});

// ===========================================================================
// Source guard — D-#69 structural assertions on the guardian module
// ===========================================================================

describe("Guardian module source guard (D-#69)", () => {
  const moduleDir = path.resolve(__dirname, "../modules/guardian");

  function guardianSources(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".ts")) out.push(full);
      }
    };
    walk(moduleDir);
    return out;
  }

  test("never IMPORTS RoutineSubstitution or the cover-overlaying routineForDate", () => {
    for (const f of guardianSources()) {
      const src = fs.readFileSync(f, "utf8");
      // Import-statement patterns only (doc comments may NAME the rule).
      expect(src).not.toMatch(/(?:from|require)\s*\(?["'][^"']*RoutineSubstitution/);
      expect(src).not.toMatch(/import\s*(?:type\s*)?\{[^}]*\broutineForDate\b[^}]*\}/s);
    }
  });

  test("no guardian source declares a teacher/room/cover field", () => {
    for (const f of guardianSources()) {
      const src = fs.readFileSync(f, "utf8");
      // A field declaration/exposure, not a comment: `teacherId: t.` / expose("roomId")
      expect(src).not.toMatch(/\b(teacherId|roomId|coverTeacherId)\s*:\s*t\./);
      expect(src).not.toMatch(/expose[A-Za-z]*\(["'](teacherId|roomId|coverTeacherId)["']/);
    }
  });
});
