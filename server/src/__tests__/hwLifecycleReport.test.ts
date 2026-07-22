/**
 * D-#350 — homeworkLifecycleReport (teacher-first redesign) + homeworkLifecyclePending
 * drill-down. Supersedes the D-#300 section×subject five-card layout.
 *
 * DB-free: models mocked (the reconReport.test pattern); the accumulation +
 * pending-bucket + waiting-days math is real. NOW is pinned to Mon 2026-07-13.
 */
const mockItemFind = jest.fn();
const mockRecFind = jest.fn();
const mockSectionFind = jest.fn();
const mockClassFind = jest.fn();
const mockUserFind = jest.fn();
const mockStudentFind = jest.fn();
const mockGuardianFind = jest.fn();
const mockLinkFind = jest.fn();
const mockSlotFind = jest.fn();

// Chain supporting find(f).lean(), .select().lean(), .select().sort().lean().
const chain = (fn: jest.Mock) => (f: unknown) => {
  const res: { lean: () => unknown; select: () => typeof res; sort: () => typeof res } = {
    lean: () => fn(f),
    select: () => res,
    sort: () => res,
  };
  return res;
};

jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: (f: unknown) => chain(mockItemFind)(f) },
}));
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { find: (f: unknown) => chain(mockRecFind)(f) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (f: unknown) => chain(mockSectionFind)(f) },
}));
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (f: unknown) => chain(mockClassFind)(f) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => chain(mockUserFind)(f) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (f: unknown) => chain(mockStudentFind)(f) },
}));
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { find: (f: unknown) => chain(mockGuardianFind)(f) },
}));
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: { find: (f: unknown) => chain(mockLinkFind)(f) },
}));
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (f: unknown) => chain(mockSlotFind)(f) },
}));

import {
  homeworkLifecycleReport,
  homeworkLifecyclePending,
} from "../modules/trackers/services/HomeworkLifecycleReportService";

const SEC = "sec-1";
const CLS = "cls-1";
const ITEM1 = "item-1";
const T1 = "teach-1";
const S1 = "stu-1";
const G1 = "guard-1";

const NOW = new Date(2026, 6, 13); // Mon 2026-07-13

const item1 = {
  _id: ITEM1,
  sectionId: SEC,
  classId: CLS,
  classLevel: 3,
  subject: "SCI",
  status: "issued",
  declaredBy: T1,
  dateGiven: new Date(2026, 6, 9), // Thu 2026-07-09
};

// Four records: a clean full pass, a stuck-SUBMITTED (backlog), a chased pre-submit, a checked-awaiting-return.
const records = [
  {
    hwItemId: ITEM1, studentId: S1, sectionId: SEC, state: "RETURNED", chaseCount: 0,
    stateDates: [
      { state: "GIVEN", at: new Date(2026, 6, 9) },
      { state: "SUBMITTED", at: new Date(2026, 6, 10) },
      { state: "CHECKED", at: new Date(2026, 6, 11) },
      { state: "RETURNED", at: new Date(2026, 6, 12) },
    ],
  },
  {
    hwItemId: ITEM1, studentId: "stu-2", sectionId: SEC, state: "SUBMITTED", chaseCount: 0,
    stateDates: [
      { state: "GIVEN", at: new Date(2026, 6, 9) },
      { state: "SUBMITTED", at: new Date(2026, 6, 10) }, // 3 days ago → backlog
    ],
  },
  {
    hwItemId: ITEM1, studentId: S1, sectionId: SEC, state: "CHASE", chaseCount: 2,
    stateDates: [
      { state: "GIVEN", at: new Date(2026, 6, 9) },
      { state: "CHASE", at: new Date(2026, 6, 11) }, // 2 days ago
    ],
  },
  {
    hwItemId: ITEM1, studentId: "stu-3", sectionId: SEC, state: "CHECKED", chaseCount: 0,
    stateDates: [
      { state: "GIVEN", at: new Date(2026, 6, 9) },
      { state: "SUBMITTED", at: new Date(2026, 6, 10) },
      { state: "CHECKED", at: new Date(2026, 6, 11) },
    ],
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockItemFind.mockResolvedValue([]);
  mockRecFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([{ _id: SEC, nameBn: "মূল", classId: CLS }]);
  mockClassFind.mockResolvedValue([{ _id: CLS, level: 3 }]);
  mockUserFind.mockResolvedValue([{ _id: T1, name: "Teacher One" }]);
  mockStudentFind.mockResolvedValue([]);
  mockGuardianFind.mockResolvedValue([]);
  mockLinkFind.mockResolvedValue([]);
  mockSlotFind.mockResolvedValue([]); // no routine → attribution falls back to declarer
});

describe("homeworkLifecycleReport (D-#350, teacher-first)", () => {
  test("empty world → empty teachers/backlog, range + threshold echoed", async () => {
    const r = await homeworkLifecycleReport("2026-07-07", "2026-07-13", { now: NOW });
    expect(r).toMatchObject({
      fromKey: "2026-07-07",
      toKey: "2026-07-13",
      backlogThresholdDays: 2,
      teachers: [],
      backlog: [],
    });
  });

  test("from after to is rejected", async () => {
    await expect(homeworkLifecycleReport("2026-07-13", "2026-07-07", { now: NOW })).rejects.toThrow(
      "from must not be after to",
    );
  });

  test("teacher row: totals + pending buckets + backlog from one item's records", async () => {
    mockItemFind.mockResolvedValue([item1]);
    mockRecFind.mockResolvedValue(records);

    const r = await homeworkLifecycleReport("2026-07-07", "2026-07-13", { now: NOW });

    expect(r.teachers).toHaveLength(1);
    expect(r.teachers[0]).toMatchObject({
      teacherId: T1,
      teacherName: "Teacher One",
      declaredItems: 1,
      issuedItems: 1,
      given: 4,
      submitted: 3, // A, B, D ever reached SUBMITTED
      checked: 2, // A, D
      returned: 1, // A
      pendingSubmission: 1, // C (CHASE)
      pendingChecking: 1, // B (SUBMITTED)
      pendingReturn: 1, // D (CHECKED)
      chasedPending: 1, // C chased + still pre-submit
    });

    expect(r.backlog).toHaveLength(1);
    expect(r.backlog[0]).toMatchObject({
      subject: "SCI",
      sectionNameBn: "মূল",
      classLevel: 3,
      teacherName: "Teacher One",
      count: 1,
      oldestDays: 3,
    });
  });

  test("class + subject filters flow into the HomeworkItem query", async () => {
    await homeworkLifecycleReport("2026-07-07", "2026-07-13", { classLevel: 3, subject: "SCI", now: NOW });
    expect(mockItemFind).toHaveBeenCalledWith(
      expect.objectContaining({ classLevel: 3, subject: "SCI", dateGiven: expect.any(Object) }),
    );
  });

  test("attributes to the routine SUBJECT teacher, not the declarer (Principal's on-behalf entry)", async () => {
    const PRIN = "principal-1";
    mockItemFind.mockResolvedValue([{ ...item1, declaredBy: PRIN }]); // Principal declared it
    mockRecFind.mockResolvedValue([records[1]]); // one SUBMITTED record
    // Routine: Class-3 SCI on Thursday is taught by T1 (earliest period).
    mockSlotFind.mockResolvedValue([
      { groupId: SEC, subject: "SCI", dayOfWeek: "THU", periodNumber: 2, teacherId: T1, effectiveFrom: new Date(2026, 0, 1), effectiveTo: null },
    ]);
    mockUserFind.mockResolvedValue([
      { _id: T1, name: "Teacher One" },
      { _id: PRIN, name: "Principal" },
    ]);

    const r = await homeworkLifecycleReport("2026-07-07", "2026-07-13", { now: NOW });

    expect(r.teachers).toHaveLength(1);
    expect(r.teachers[0].teacherId).toBe(T1); // the subject teacher, NOT the Principal
    expect(r.teachers[0].teacherName).toBe("Teacher One");
    expect(r.teachers.some((t) => t.teacherId === PRIN)).toBe(false);
  });
});

describe("homeworkLifecyclePending (D-#350 drill-down)", () => {
  test("names the stuck students with roll, section, guardian phone, waiting days", async () => {
    mockItemFind.mockResolvedValue([item1]);
    mockRecFind.mockResolvedValue([records[2]]); // the CHASE record for S1
    mockStudentFind.mockResolvedValue([
      { _id: S1, name: "Student One", nameBn: "ছাত্র এক", rollNumber: "5", phone: "01720000000" },
    ]);
    mockLinkFind.mockResolvedValue([{ studentId: S1, guardianId: G1, createdAt: new Date(2026, 0, 1) }]);
    mockGuardianFind.mockResolvedValue([{ _id: G1, phone: "01710000000" }]);

    const rows = await homeworkLifecyclePending("2026-07-07", "2026-07-13", T1, "SUBMISSION", { now: NOW });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentId: S1,
      name: "Student One",
      nameBn: "ছাত্র এক",
      rollNumber: "5",
      sectionNameBn: "মূল",
      classLevel: 3,
      subject: "SCI",
      guardianPhone: "01710000000", // guardian preferred over student's own phone
      state: "CHASE",
      daysWaiting: 2,
      chaseCount: 2,
    });
  });

  test("falls back to the student's own phone when no guardian link", async () => {
    mockItemFind.mockResolvedValue([item1]);
    mockRecFind.mockResolvedValue([records[2]]);
    mockStudentFind.mockResolvedValue([{ _id: S1, name: "Student One", phone: "01720000000" }]);
    mockLinkFind.mockResolvedValue([]);

    const rows = await homeworkLifecyclePending("2026-07-07", "2026-07-13", T1, "SUBMISSION", { now: NOW });
    expect(rows[0].guardianPhone).toBe("01720000000");
  });

  test("no items → empty drill", async () => {
    mockItemFind.mockResolvedValue([]);
    const rows = await homeworkLifecyclePending("2026-07-07", "2026-07-13", T1, "CHECK", { now: NOW });
    expect(rows).toEqual([]);
  });
});
