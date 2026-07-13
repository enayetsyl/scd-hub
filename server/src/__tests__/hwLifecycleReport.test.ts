/**
 * D-#300 — homeworkLifecycleReport: per subject × class lifecycle monitoring in
 * five sections (funnel, checking backlog, chase columns, declaration
 * consistency incl. D-#299 nils, teacher scorecard).
 *
 * DB-free: models mocked (the reconReport.test pattern); the accumulation +
 * latency math is real. NOW is pinned to Mon 2026-07-13.
 */
const mockItemFind = jest.fn();
const mockRecFind = jest.fn();
const mockNilFind = jest.fn();
const mockSectionFind = jest.fn();
const mockClassFind = jest.fn();
const mockUserFind = jest.fn();
const mockSlotFind = jest.fn();
const mockHolidayFind = jest.fn();

const chain = (fn: jest.Mock) => (f: unknown) => ({
  lean: () => fn(f),
  select: () => ({ lean: () => fn(f) }),
});

jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: (f: unknown) => chain(mockItemFind)(f) },
}));
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { find: (f: unknown) => chain(mockRecFind)(f) },
}));
jest.mock("../modules/trackers/models/HomeworkNilDeclaration", () => ({
  HomeworkNilDeclaration: { find: (f: unknown) => chain(mockNilFind)(f) },
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
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (f: unknown) => chain(mockSlotFind)(f) },
}));
jest.mock("../modules/routine/models/HolidayException", () => ({
  HolidayException: { find: (f: unknown) => chain(mockHolidayFind)(f) },
}));

import { homeworkLifecycleReport } from "../modules/trackers/services/HomeworkLifecycleReportService";

const SEC = "sec-1";
const CLS = "cls-1";
const ITEM1 = "item-1";
const T1 = "teach-1"; // declares SCI
const T2 = "teach-2"; // routine MATH teacher who never declares
const T3 = "teach-3"; // declares an ENG nil

const NOW = new Date(2026, 6, 13); // Mon 2026-07-13

const slot = (subject: string, dayOfWeek: string, teacherId: string) => ({
  groupId: SEC,
  dayOfWeek,
  periodNumber: 3,
  subject,
  teacherId,
  effectiveFrom: new Date(2026, 0, 1),
  effectiveTo: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockItemFind.mockResolvedValue([]);
  mockRecFind.mockResolvedValue([]);
  mockNilFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([{ _id: SEC, nameBn: "মূল", classId: CLS }]);
  mockClassFind.mockResolvedValue([{ _id: CLS, level: 3 }]);
  mockUserFind.mockResolvedValue([
    { _id: T1, name: "Teacher One" },
    { _id: T2, name: "Teacher Two" },
    { _id: T3, name: "Teacher Three" },
  ]);
  mockSlotFind.mockResolvedValue([]);
  mockHolidayFind.mockResolvedValue([]);
});

describe("homeworkLifecycleReport (D-#300)", () => {
  test("empty world → empty sections, range + threshold echoed", async () => {
    const r = await homeworkLifecycleReport("2026-07-07", "2026-07-13", NOW);
    expect(r).toMatchObject({
      fromKey: "2026-07-07",
      toKey: "2026-07-13",
      backlogThresholdDays: 2,
      funnel: [],
      backlog: [],
      consistency: [],
      scorecard: [],
    });
  });

  test("from after to is rejected", async () => {
    await expect(homeworkLifecycleReport("2026-07-13", "2026-07-07", NOW)).rejects.toThrow(
      "from must not be after to",
    );
  });

  test("funnel + backlog + chase + scorecard from one item's records", async () => {
    mockItemFind.mockResolvedValue([
      { _id: ITEM1, sectionId: SEC, classId: CLS, subject: "SCI", dateGiven: new Date(2026, 6, 9), status: "issued", declaredBy: T1 },
    ]);
    mockRecFind.mockResolvedValue([
      {
        // Full clean pass: on time, checked next day, returned the day after.
        hwItemId: ITEM1,
        state: "RETURNED",
        dueDate: new Date(2026, 6, 10),
        chaseCount: 0,
        result: "CORRECT",
        stateDates: [
          { state: "GIVEN", at: new Date(2026, 6, 9) },
          { state: "SUBMITTED", at: new Date(2026, 6, 10) },
          { state: "CHECKED", at: new Date(2026, 6, 11) },
          { state: "RETURNED", at: new Date(2026, 6, 12) },
        ],
      },
      {
        // Submitted on time, then STUCK in SUBMITTED for 3 days → backlog.
        hwItemId: ITEM1,
        state: "SUBMITTED",
        dueDate: new Date(2026, 6, 10),
        chaseCount: 0,
        stateDates: [
          { state: "GIVEN", at: new Date(2026, 6, 9) },
          { state: "SUBMITTED", at: new Date(2026, 6, 10) },
        ],
      },
      {
        // Never submitted, chased twice.
        hwItemId: ITEM1,
        state: "CHASE",
        dueDate: new Date(2026, 6, 10),
        chaseCount: 2,
        stateDates: [{ state: "GIVEN", at: new Date(2026, 6, 9) }],
      },
    ]);

    const r = await homeworkLifecycleReport("2026-07-07", "2026-07-13", NOW);

    expect(r.funnel).toHaveLength(1);
    expect(r.funnel[0]).toMatchObject({
      sectionNameBn: "মূল",
      classLevel: 3,
      subject: "SCI",
      declaredItems: 1,
      issuedItems: 1,
      given: 3,
      submitted: 2,
      checked: 1,
      returned: 1,
      onTimePct: 67, // 2 of 3 due-dated records submitted on time
      stuckSubmitted: 1,
      chasedRecords: 1,
      chases: 2,
      chaseRatePct: 33,
    });

    expect(r.backlog).toHaveLength(1);
    expect(r.backlog[0]).toMatchObject({
      subject: "SCI",
      teacherName: "Teacher One",
      count: 1,
      oldestDays: 3,
    });

    const t1 = r.scorecard.find((s) => s.teacherId === T1)!;
    expect(t1).toMatchObject({
      teacherName: "Teacher One",
      declaredItems: 1,
      onTimePct: 67,
      avgCheckLatencyDays: 1,
      avgReturnLatencyDays: 1,
      chases: 2,
      wrongRatePct: 0, // 0 WRONG of 1 resulted
    });
  });

  test("consistency: declared / nil / missed routine days, missed attributed to the routine teacher", async () => {
    mockSlotFind.mockResolvedValue([
      slot("SCI", "THU", T1), // Thu 2026-07-09 — declared
      slot("ENG", "TUE", T3), // Tue 2026-07-07 — nil-declared
      slot("MATH", "SUN", T2), // Sun 2026-07-12 — neither → missed
    ]);
    mockItemFind.mockResolvedValue([
      { _id: ITEM1, sectionId: SEC, classId: CLS, subject: "SCI", dateGiven: new Date(2026, 6, 9), status: "declared", declaredBy: T1 },
    ]);
    mockNilFind.mockResolvedValue([
      { sectionId: SEC, classId: CLS, subject: "ENG", dateKey: "2026-07-07", reason: "EXAM", declaredBy: T3 },
    ]);

    const r = await homeworkLifecycleReport("2026-07-07", "2026-07-13", NOW);

    const bySubject = new Map(r.consistency.map((c) => [c.subject, c]));
    expect(bySubject.get("SCI")).toMatchObject({ routineDays: 1, declaredDays: 1, nilDays: 0, missedDays: 0, respondedPct: 100 });
    expect(bySubject.get("ENG")).toMatchObject({ routineDays: 1, declaredDays: 0, nilDays: 1, missedDays: 0, respondedPct: 100 });
    expect(bySubject.get("MATH")).toMatchObject({ routineDays: 1, declaredDays: 0, nilDays: 0, missedDays: 1, respondedPct: 0 });

    const t2 = r.scorecard.find((s) => s.teacherId === T2)!;
    expect(t2.missedDeclarations).toBe(1);
    const t3 = r.scorecard.find((s) => s.teacherId === T3)!;
    expect(t3.nilDays).toBe(1);
    // Worst first: the teacher with the missed declaration leads.
    expect(r.scorecard[0].teacherId).toBe(T2);
  });

  test("future days never enter the consistency denominators", async () => {
    mockSlotFind.mockResolvedValue([slot("SCI", "THU", T1)]);
    // Range extends past NOW: Thu 2026-07-16 is in range but in the future.
    const r = await homeworkLifecycleReport("2026-07-13", "2026-07-19", NOW);
    expect(r.consistency).toEqual([]);
  });
});
