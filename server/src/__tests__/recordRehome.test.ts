/**
 * rehomeStudentRecords (PR #935, D-#770): records follow the student on a section
 * move — homework + assignment records always, monthly reports only while unreleased.
 * DB-free: the three models' updateMany are mocked and the filters asserted.
 */
const mockHwUpdate = jest.fn();
const mockAsUpdate = jest.fn();
const mockMrUpdate = jest.fn();
const mockHwFind = jest.fn();
const mockHwBulk = jest.fn();
const mockItemFind = jest.fn();
const mockResolveDue = jest.fn();

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: {
    updateMany: (...a: unknown[]) => mockHwUpdate(...a),
    find: (...a: unknown[]) => ({ select: () => ({ lean: () => mockHwFind(...a) }) }),
    bulkWrite: (...a: unknown[]) => mockHwBulk(...a),
  },
}));
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: { updateMany: (...a: unknown[]) => mockAsUpdate(...a) },
}));
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: (...a: unknown[]) => ({ select: () => ({ lean: () => mockItemFind(...a) }) }) },
}));
jest.mock("../modules/trackers/homeworkDueDate", () => ({
  resolveHomeworkDueDate: (...a: unknown[]) => mockResolveDue(...a),
}));
jest.mock("../modules/reports/models/MonthlyReport", () => ({
  MonthlyReport: { updateMany: (...a: unknown[]) => mockMrUpdate(...a) },
}));

import { Types } from "mongoose";
import { rehomeStudentRecords, REHOMED_REPORT_STATUSES } from "../modules/trackers/services/recordRehome";

const S1 = new Types.ObjectId().toString();
const S2 = new Types.ObjectId().toString();
const TO = new Types.ObjectId().toString();

beforeEach(() => {
  mockHwUpdate.mockReset().mockResolvedValue({ modifiedCount: 5 });
  mockAsUpdate.mockReset().mockResolvedValue({ modifiedCount: 3 });
  mockMrUpdate.mockReset().mockResolvedValue({ modifiedCount: 2 });
  mockHwFind.mockReset().mockResolvedValue([]);
  mockHwBulk.mockReset().mockResolvedValue({ modifiedCount: 0 });
  mockItemFind.mockReset().mockResolvedValue([]);
  mockResolveDue.mockReset();
});

describe("rehomeStudentRecords", () => {
  it("moves homework, assignment and unreleased monthly-report rows and reports each count", async () => {
    const out = await rehomeStudentRecords([S1, S2], TO);
    expect(out).toEqual({ homework: 5, assignment: 3, monthlyReports: 2, homeworkDueReset: 0 });

    for (const fn of [mockHwUpdate, mockAsUpdate, mockMrUpdate]) {
      const [filter, update] = fn.mock.calls[0];
      expect(filter.studentId.$in.map(String)).toEqual([S1, S2]);
      expect(String(filter.sectionId.$ne)).toBe(TO);
      expect(String(update.$set.sectionId)).toBe(TO);
    }
  });

  it("leaves RELEASED / SUPERSEDED monthly reports where they were issued", async () => {
    await rehomeStudentRecords([S1], TO);
    const [filter] = mockMrUpdate.mock.calls[0];
    expect(filter.status.$in).toEqual(["DRAFT", "READY"]);
    expect(REHOMED_REPORT_STATUSES).not.toContain("RELEASED");
    expect(REHOMED_REPORT_STATUSES).not.toContain("SUPERSEDED");
    // Homework / assignment records carry no status filter — every record follows.
    expect(mockHwUpdate.mock.calls[0][0].status).toBeUndefined();
    expect(mockAsUpdate.mock.calls[0][0].status).toBeUndefined();
  });

  it("D-#771: a not-yet-due homework record re-resolves its due date on the NEW section", async () => {
    const item = new Types.ObjectId();
    const future = new Date();
    future.setDate(future.getDate() + 3);
    future.setHours(9, 0, 0, 0);
    const later = new Date(future.getTime() + 2 * 86_400_000);
    const past = new Date(Date.now() - 5 * 86_400_000);
    const r1 = { _id: new Types.ObjectId(), hwItemId: item, dueDate: future }; // moves
    const r2 = { _id: new Types.ObjectId(), hwItemId: item, dueDate: past }; // already reached — kept
    mockHwFind.mockResolvedValue([r1, r2]);
    mockItemFind.mockResolvedValue([{ _id: item, subject: "MATH", dateGiven: new Date() }]);
    mockResolveDue.mockResolvedValue(later);
    mockHwBulk.mockResolvedValue({ modifiedCount: 1 });

    const out = await rehomeStudentRecords([S1], TO);

    expect(mockHwFind.mock.calls[0][0].state).toBe("GIVEN");
    const [secArg, subjArg] = mockResolveDue.mock.calls[0];
    expect(String(secArg)).toBe(TO);
    expect(subjArg).toBe("MATH");
    const ops = mockHwBulk.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(String(ops[0].updateOne.filter._id)).toBe(String(r1._id));
    expect(ops[0].updateOne.filter.state).toBe("GIVEN");
    expect(ops[0].updateOne.update.$set.dueDate).toBe(later);
    expect(out.homeworkDueReset).toBe(1);
  });

  it("D-#771: an unchanged due date writes nothing", async () => {
    const item = new Types.ObjectId();
    const future = new Date(Date.now() + 3 * 86_400_000);
    mockHwFind.mockResolvedValue([{ _id: new Types.ObjectId(), hwItemId: item, dueDate: future }]);
    mockItemFind.mockResolvedValue([{ _id: item, subject: "ENG", dateGiven: new Date() }]);
    mockResolveDue.mockResolvedValue(new Date(future.getTime()));
    const out = await rehomeStudentRecords([S1], TO);
    expect(mockHwBulk).not.toHaveBeenCalled();
    expect(out.homeworkDueReset).toBe(0);
  });

  it("is a no-op for an empty student list", async () => {
    expect(await rehomeStudentRecords([], TO)).toEqual({ homework: 0, assignment: 0, monthlyReports: 0, homeworkDueReset: 0 });
    expect(mockHwUpdate).not.toHaveBeenCalled();
    expect(mockMrUpdate).not.toHaveBeenCalled();
  });
});
