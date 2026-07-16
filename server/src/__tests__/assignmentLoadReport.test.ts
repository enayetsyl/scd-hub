/**
 * assignmentLoadReport (D-#329) — planned (rotation) vs given (items) by subject
 * and teacher. DB-free: AssignmentSchedule / AssignmentItem / User mocked.
 */
const mockScheduleFindOne = jest.fn();
const mockItemFind = jest.fn();
const mockUserFind = jest.fn();

jest.mock("../modules/trackers/models/AssignmentSchedule", () => ({
  AssignmentSchedule: { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(mockScheduleFindOne()) }) }) },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { find: () => ({ select: () => ({ lean: () => Promise.resolve(mockItemFind()) }) }) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: () => ({ select: () => ({ lean: () => Promise.resolve(mockUserFind()) }) }) },
}));

import { assignmentLoadReport } from "../modules/trackers/services/AssignmentLoadReportService";

const YEAR = "6a00000000000000000000ff";
const T1 = "6a0000000000000000000011";
const T2 = "6a0000000000000000000022";

beforeEach(() => {
  jest.clearAllMocks();
  mockScheduleFindOne.mockReturnValue({
    entries: [
      { subject: "BAN", teacherId: { toString: () => T1 } },
      { subject: "BAN", teacherId: { toString: () => T1 } },
      { subject: "ENG", teacherId: { toString: () => T2 } },
    ],
  });
  mockItemFind.mockReturnValue([
    { subject: "BAN", teacherId: { toString: () => T1 }, status: "DRAFT" },
    { subject: "BAN", teacherId: { toString: () => T1 }, status: "ISSUED" },
    { subject: "ENG", teacherId: { toString: () => T2 }, status: "ISSUED" },
  ]);
  mockUserFind.mockReturnValue([
    { _id: { toString: () => T1 }, name: "Alpha" },
    { _id: { toString: () => T2 }, name: "Beta" },
  ]);
});

describe("assignmentLoadReport (D-#329)", () => {
  test("bySubject: planned from rotation, delivered/issued from items", async () => {
    const r = await assignmentLoadReport(YEAR);
    expect(r.bySubject).toEqual([
      { key: "BAN", label: "BAN", planned: 2, delivered: 2, issued: 1 },
      { key: "ENG", label: "ENG", planned: 1, delivered: 1, issued: 1 },
    ]);
  });

  test("byTeacher: attributed by the item's teacherId, name-resolved, sorted by name", async () => {
    const r = await assignmentLoadReport(YEAR);
    expect(r.byTeacher).toEqual([
      { key: T1, label: "Alpha", planned: 2, delivered: 2, issued: 1 },
      { key: T2, label: "Beta", planned: 1, delivered: 1, issued: 1 },
    ]);
  });

  test("no schedule → empty planned, still counts delivered items", async () => {
    mockScheduleFindOne.mockReturnValue(null);
    const r = await assignmentLoadReport(YEAR);
    expect(r.bySubject.find((x) => x.key === "BAN")).toMatchObject({ planned: 0, delivered: 2, issued: 1 });
  });
});
