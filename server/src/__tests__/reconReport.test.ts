/**
 * D-#290 — reconciliationReport: the Principal/Office "who didn't reconcile?"
 * oversight read. Homework misses per (class, day) — declared items whose day was
 * never confirmed (lockstep with the pendingHomeworkSections rule); assignment
 * misses per (section, week) — delivered items still DRAFT. Rows name the
 * accountable confirmer (homework delegate ?? class teacher).
 *
 * DB-free: models are mocked; the bucketing/enrichment logic is real.
 */
const mockHwItemFind = jest.fn();
const mockHwReconFind = jest.fn();
const mockAsItemFind = jest.fn();
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
  HomeworkItem: { find: (f: unknown) => chain(mockHwItemFind)(f) },
}));
jest.mock("../modules/trackers/models/HomeworkReconciliation", () => ({
  HomeworkReconciliation: { find: (f: unknown) => chain(mockHwReconFind)(f) },
  reconDayKey: (date: Date) => {
    const d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { find: (f: unknown) => chain(mockAsItemFind)(f) },
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
// D-#299 — explicit "no homework today" markers.
const mockNilFind = jest.fn();
jest.mock("../modules/trackers/models/HomeworkNilDeclaration", () => ({
  HomeworkNilDeclaration: { find: (f: unknown) => chain(mockNilFind)(f) },
}));

import { reconciliationReport } from "../modules/trackers/services/ReconReportService";

const SEC = "sec-1";
const CLS = "cls-1";

beforeEach(() => {
  jest.clearAllMocks();
  mockHwItemFind.mockResolvedValue([]);
  mockHwReconFind.mockResolvedValue([]);
  mockAsItemFind.mockResolvedValue([]);
  mockSectionFind.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([]);
  mockUserFind.mockResolvedValue([]);
  mockSlotFind.mockResolvedValue([]);
  mockHolidayFind.mockResolvedValue([]);
  mockNilFind.mockResolvedValue([]);
});

const seedSection = (over: Record<string, unknown> = {}): void => {
  mockSectionFind.mockResolvedValue([
    { _id: SEC, nameBn: "মূল", classId: CLS, classTeacherId: "u-ct", homeworkConfirmerId: null, ...over },
  ]);
  mockClassFind.mockResolvedValue([{ _id: CLS, level: -1 }]);
  mockUserFind.mockResolvedValue([
    { _id: "u-ct", name: "Sajeda Jannat" },
    { _id: "u-del", name: "Delegate D" },
  ]);
};

describe("reconciliationReport (D-#290)", () => {
  test("empty world → empty report, range echoed back", async () => {
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r).toEqual({
      fromKey: "2026-07-07",
      toKey: "2026-07-13",
      hwMisses: [],
      asMisses: [],
      hwNotDeclared: [],
      hwNilDeclared: [],
    });
  });

  test("from after to is rejected", async () => {
    await expect(reconciliationReport("2026-07-13", "2026-07-07")).rejects.toThrow("from must not be after to");
  });

  test("declared-but-unconfirmed homework buckets per (class, day) with confirmer name", async () => {
    seedSection();
    mockHwItemFind.mockResolvedValue([
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 9), timeDecl: 60 },
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 9), timeDecl: 20 },
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 12), timeDecl: 30 },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r.hwMisses).toHaveLength(2);
    // Newest day first.
    expect(r.hwMisses[0]).toMatchObject({
      dateKey: "2026-07-12",
      sectionNameBn: "মূল",
      classLevel: -1,
      confirmerName: "Sajeda Jannat",
      declaredItems: 1,
      declaredMinutes: 30,
    });
    expect(r.hwMisses[1]).toMatchObject({ dateKey: "2026-07-09", declaredItems: 2, declaredMinutes: 80 });
  });

  test("a reconciled day drops out (lockstep with the reminder ladder)", async () => {
    seedSection();
    mockHwItemFind.mockResolvedValue([
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 9), timeDecl: 60 },
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 12), timeDecl: 30 },
    ]);
    mockHwReconFind.mockResolvedValue([{ classId: CLS, reconDate: new Date(2026, 6, 9) }]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r.hwMisses).toHaveLength(1);
    expect(r.hwMisses[0].dateKey).toBe("2026-07-12");
  });

  test("the homework delegate outranks the class teacher as the named confirmer", async () => {
    seedSection({ homeworkConfirmerId: "u-del" });
    mockHwItemFind.mockResolvedValue([
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 9), timeDecl: 60 },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r.hwMisses[0].confirmerName).toBe("Delegate D");
  });

  test("DRAFT assignment items bucket per (section, week); confirmer = class teacher", async () => {
    seedSection();
    mockAsItemFind.mockResolvedValue([
      { sectionId: SEC, weekNumber: 5, deliveryDate: new Date(2026, 6, 8), estMinutes: 40 },
      { sectionId: SEC, weekNumber: 5, deliveryDate: new Date(2026, 6, 8), estMinutes: 20 },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r.asMisses).toHaveLength(1);
    expect(r.asMisses[0]).toMatchObject({
      weekNumber: 5,
      deliveryDateKey: "2026-07-08",
      sectionNameBn: "মূল",
      confirmerName: "Sajeda Jannat",
      draftItems: 2,
      draftMinutes: 60,
    });
  });

  test("a section with NO class teacher reports a null confirmer (the report's point)", async () => {
    mockSectionFind.mockResolvedValue([
      { _id: SEC, nameBn: "মূল", classId: CLS, classTeacherId: null, homeworkConfirmerId: null },
    ]);
    mockClassFind.mockResolvedValue([{ _id: CLS, level: -1 }]);
    mockHwItemFind.mockResolvedValue([
      { classId: CLS, sectionId: SEC, dateGiven: new Date(2026, 6, 9), timeDecl: 60 },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13");
    expect(r.hwMisses[0].confirmerName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D-#293 — homework never DECLARED (routine-expected, per class × subject × day)
// ---------------------------------------------------------------------------

describe("hwNotDeclared (D-#293)", () => {
  const NOW = new Date(2026, 6, 13); // Mon 2026-07-13
  const sciSlot = (over: Record<string, unknown> = {}) => ({
    groupId: SEC,
    dayOfWeek: "THU",
    periodNumber: 5,
    subject: "SCI",
    teacherId: "u-sci",
    effectiveFrom: new Date(2026, 0, 1),
    effectiveTo: null,
    ...over,
  });

  test("a routine-expected subject with NO declaration that day is reported with its teacher", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot()]);
    mockUserFind.mockResolvedValue([{ _id: "u-sci", name: "Husne ara Rahman Fida" }]);

    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    // Thu 2026-07-09 is the only FULL day in range with a SCI period and no declaration.
    expect(r.hwNotDeclared).toHaveLength(1);
    expect(r.hwNotDeclared[0]).toMatchObject({
      dateKey: "2026-07-09",
      sectionId: SEC,
      subject: "SCI",
      teacherName: "Husne ara Rahman Fida",
      classLevel: -1,
    });
  });

  test("D-#299: an explicit nil declaration moves the cell out of the red list into hwNilDeclared", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot()]);
    mockUserFind.mockResolvedValue([{ _id: "u-sci", name: "Husne ara Rahman Fida" }]);
    mockNilFind.mockResolvedValue([
      {
        sectionId: SEC,
        classId: CLS,
        subject: "SCI",
        dateKey: "2026-07-09",
        reason: "EXAM",
        declaredBy: "u-sci",
      },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.hwNotDeclared).toEqual([]); // deliberately none — never red
    expect(r.hwNilDeclared).toHaveLength(1);
    expect(r.hwNilDeclared[0]).toMatchObject({
      dateKey: "2026-07-09",
      sectionId: SEC,
      subject: "SCI",
      reason: "EXAM",
      teacherName: "Husne ara Rahman Fida",
      classLevel: -1,
    });
  });

  test("a declaration that day clears the cell (any status)", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot()]);
    mockHwItemFind.mockResolvedValue([
      { classId: CLS, sectionId: SEC, subject: "SCI", dateGiven: new Date(2026, 6, 9), timeDecl: 30 },
    ]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.hwNotDeclared).toEqual([]);
  });

  test("non-FULL days owe nothing (a Friday period never reports)", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot({ dayOfWeek: "FRI" })]); // 2026-07-10 is a Friday
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.hwNotDeclared).toEqual([]);
  });

  test("future days are never reported", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot()]);
    // "Today" is Wed 07-08 — the Thu 07-09 period is still in the future.
    const r = await reconciliationReport("2026-07-07", "2026-07-13", new Date(2026, 6, 8));
    expect(r.hwNotDeclared).toEqual([]);
  });

  test("a teacherless slot reports the cell with a null teacher", async () => {
    seedSection();
    mockSlotFind.mockResolvedValue([sciSlot({ teacherId: null })]);
    const r = await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    expect(r.hwNotDeclared).toHaveLength(1);
    expect(r.hwNotDeclared[0].teacherName).toBeNull();
  });

  test("D-#308: ARABIC is never routine-EXPECTED — the slot query excludes it", async () => {
    seedSection();
    await reconciliationReport("2026-07-07", "2026-07-13", NOW);
    const [filter] = mockSlotFind.mock.calls[0] as [{ subject: { $in: string[] } }];
    expect(filter.subject.$in).not.toContain("ARABIC");
    // Every other HW subject stays expected.
    expect(filter.subject.$in).toEqual(expect.arrayContaining(["BAN", "ENG", "MATH", "SCI", "BGS", "ISLAM"]));
  });
});
