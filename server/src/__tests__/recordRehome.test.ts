/**
 * rehomeStudentRecords (PR #935, D-#770): records follow the student on a section
 * move — homework + assignment records always, monthly reports only while unreleased.
 * DB-free: the three models' updateMany are mocked and the filters asserted.
 */
const mockHwUpdate = jest.fn();
const mockAsUpdate = jest.fn();
const mockMrUpdate = jest.fn();

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { updateMany: (...a: unknown[]) => mockHwUpdate(...a) },
}));
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: { updateMany: (...a: unknown[]) => mockAsUpdate(...a) },
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
});

describe("rehomeStudentRecords", () => {
  it("moves homework, assignment and unreleased monthly-report rows and reports each count", async () => {
    const out = await rehomeStudentRecords([S1, S2], TO);
    expect(out).toEqual({ homework: 5, assignment: 3, monthlyReports: 2 });

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

  it("is a no-op for an empty student list", async () => {
    expect(await rehomeStudentRecords([], TO)).toEqual({ homework: 0, assignment: 0, monthlyReports: 0 });
    expect(mockHwUpdate).not.toHaveBeenCalled();
    expect(mockMrUpdate).not.toHaveBeenCalled();
  });
});
