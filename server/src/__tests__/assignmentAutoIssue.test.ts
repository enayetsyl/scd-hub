/**
 * D-#839 — assignment-week auto-issue sweep (the D-#314 homework twin, weekly).
 *
 * The system confirms a (section × week) ONLY when nothing is left for the human:
 *   - ≥1 DRAFT whose delivery day arrived, inside the lookback window
 *   - every rotation cell expected of the section that week is delivered or nil
 *   - confirm's own gates pass (the 360-min cap, a raced confirm); any throw = defer
 *   - actor = the all-zero system sentinel
 *
 * DB-free: the item model, the expected-grid read and confirm are mocked; the
 * sweep's orchestration is real.
 */
import mongoose from "mongoose";

const mockItemFind = jest.fn();
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { find: (f: unknown) => ({ select: () => ({ lean: () => mockItemFind(f) }) }) },
}));

const mockExpected = jest.fn();
jest.mock("../modules/trackers/services/AssignmentScheduleService", () => ({
  expectedItemsForWeek: (...a: unknown[]) => mockExpected(...a),
}));

const mockConfirm = jest.fn();
jest.mock("../modules/trackers/services/AssignmentService", () => ({
  confirmAssignmentWeek: (...a: unknown[]) => mockConfirm(...a),
}));

// Import AFTER mocks
import {
  sweepAssignmentAutoIssue,
  weekCoveredForSection,
  AS_AUTO_ISSUE_ACTOR_ID,
  AS_AUTO_ISSUE_LOOKBACK_DAYS,
} from "../modules/trackers/services/AssignmentAutoIssueService";

const oid = () => new mongoose.Types.ObjectId().toString();
const YEAR = oid();
const BOYS = oid();
const GIRLS = oid();
const NOW = new Date(2026, 9, 22, 14, 0); // Thu 2026-10-22, 14:00

const draft = (sectionId: string, weekNumber = 43, academicYearId = YEAR) => ({ academicYearId, weekNumber, sectionId });
const cell = (sectionId: string, over: { delivered?: boolean; nilDeclared?: boolean } = {}) => ({
  sectionId,
  delivered: false,
  nilDeclared: false,
  ...over,
});
const week = (items: ReturnType<typeof cell>[]) => ({ academicYearId: YEAR, weekNumber: 43, items });

beforeEach(() => {
  jest.clearAllMocks();
  mockConfirm.mockResolvedValue({ itemsIssued: 1, recordsIssued: 20 });
});

describe("weekCoveredForSection", () => {
  it("needs every cell of THAT section delivered or nil — other sections never count", () => {
    const w = week([
      cell(BOYS, { delivered: true }),
      cell(BOYS, { nilDeclared: true }),
      cell(GIRLS), // girls still owe one — irrelevant to boys
    ]) as never;
    expect(weekCoveredForSection(w, BOYS)).toBe(true);
    expect(weekCoveredForSection(w, GIRLS)).toBe(false);
  });

  it("a section with no expected cells (entry retired after delivery) has nothing outstanding", () => {
    expect(weekCoveredForSection(week([cell(GIRLS)]) as never, BOYS)).toBe(true);
  });
});

describe("sweepAssignmentAutoIssue", () => {
  it("queries only DRAFTs delivered inside the lookback window, up to the end of today", async () => {
    mockItemFind.mockResolvedValue([]);
    const res = await sweepAssignmentAutoIssue(NOW);
    expect(res).toEqual({ issued: 0, deferred: 0 });
    const f = mockItemFind.mock.calls[0][0] as { status: string; deliveryDate: { $gte: Date; $lte: Date } };
    expect(f.status).toBe("DRAFT");
    expect(f.deliveryDate.$lte).toEqual(new Date(2026, 9, 22, 23, 59, 59, 999));
    expect(f.deliveryDate.$gte).toEqual(new Date(2026, 9, 22 - AS_AUTO_ISSUE_LOOKBACK_DAYS));
    expect(mockExpected).not.toHaveBeenCalled();
  });

  it("a fully covered section confirms as the system sentinel; an uncovered one defers untouched", async () => {
    mockItemFind.mockResolvedValue([draft(BOYS), draft(BOYS), draft(GIRLS)]);
    mockExpected.mockResolvedValue(
      week([cell(BOYS, { delivered: true }), cell(BOYS, { nilDeclared: true }), cell(GIRLS, { delivered: true }), cell(GIRLS)]),
    );
    const res = await sweepAssignmentAutoIssue(NOW);
    expect(res).toEqual({ issued: 1, deferred: 1 });
    expect(mockExpected).toHaveBeenCalledTimes(1); // one grid read per (year × week)
    expect(mockExpected).toHaveBeenCalledWith(YEAR, 43);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith({
      academicYearId: YEAR,
      sectionId: BOYS,
      weekNumber: 43,
      actorId: AS_AUTO_ISSUE_ACTOR_ID,
      at: NOW,
    });
    expect(AS_AUTO_ISSUE_ACTOR_ID).toBe("000000000000000000000000");
  });

  it("an over-cap (or raced) confirm defers silently — the sweep never trims, never throws", async () => {
    mockItemFind.mockResolvedValue([draft(BOYS)]);
    mockExpected.mockResolvedValue(week([cell(BOYS, { delivered: true })]));
    mockConfirm.mockRejectedValue(new Error("Week 43 total 390 min exceeds the 360-min weekly ceiling"));
    await expect(sweepAssignmentAutoIssue(NOW)).resolves.toEqual({ issued: 0, deferred: 1 });
  });

  it("a confirm that lost every claim to a racing human confirm is not counted as a system issue", async () => {
    mockItemFind.mockResolvedValue([draft(BOYS)]);
    mockExpected.mockResolvedValue(week([cell(BOYS, { delivered: true })]));
    mockConfirm.mockResolvedValue({ itemsIssued: 0, recordsIssued: 0 });
    await expect(sweepAssignmentAutoIssue(NOW)).resolves.toEqual({ issued: 0, deferred: 0 });
  });

  it("no schedule for a year defers that week's sections without blocking another week", async () => {
    mockItemFind.mockResolvedValue([draft(BOYS, 42), draft(GIRLS, 42), draft(BOYS, 43)]);
    mockExpected.mockImplementation(async (_y: string, wk: number) => {
      if (wk === 42) throw new Error("No AssignmentSchedule for this academic year");
      return week([cell(BOYS, { delivered: true })]);
    });
    const res = await sweepAssignmentAutoIssue(NOW);
    expect(res).toEqual({ issued: 1, deferred: 2 });
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ sectionId: BOYS, weekNumber: 43 }));
  });

  it("weeks are keyed per academic year too — the same week number in two years reads two grids", async () => {
    const OTHER_YEAR = oid();
    mockItemFind.mockResolvedValue([draft(BOYS, 43, YEAR), draft(BOYS, 43, OTHER_YEAR)]);
    mockExpected.mockResolvedValue(week([cell(BOYS, { delivered: true })]));
    await sweepAssignmentAutoIssue(NOW);
    expect(mockExpected).toHaveBeenCalledWith(YEAR, 43);
    expect(mockExpected).toHaveBeenCalledWith(OTHER_YEAR, 43);
    expect(mockConfirm).toHaveBeenCalledTimes(2);
  });
});
