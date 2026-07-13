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
    expect(r).toEqual({ fromKey: "2026-07-07", toKey: "2026-07-13", hwMisses: [], asMisses: [] });
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
