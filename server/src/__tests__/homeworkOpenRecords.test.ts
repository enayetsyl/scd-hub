/**
 * listOpenRecords — the source for the auto-listed, date-grouped Checking queue /
 * Records screens (pending work across all dates, no manual date pick).
 *
 * DB-free: the record/item/student models' find chains are mocked.
 */
import mongoose from "mongoose";

const mockRecordFind = jest.fn();
const mockItemFind = jest.fn();
const mockStudentFind = jest.fn();

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { find: (q: unknown) => ({ lean: () => mockRecordFind(q) }) },
}));
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: (q: unknown) => ({ select: () => ({ lean: () => mockItemFind(q) }) }) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => ({ select: () => ({ lean: () => mockStudentFind(q) }) }) },
}));

import { listOpenRecords } from "../modules/trackers/services/HomeworkService";

const oid = () => new mongoose.Types.ObjectId();

beforeEach(() => jest.clearAllMocks());

describe("listOpenRecords (date-grouped pending queue source)", () => {
  test("empty states → [] without touching the DB", async () => {
    const res = await listOpenRecords("sec1", []);
    expect(res).toEqual([]);
    expect(mockRecordFind).not.toHaveBeenCalled();
  });

  test("filters by section + states; enriches subject + student name; newest given-date first", async () => {
    const item1 = oid();
    const item2 = oid();
    const stuA = oid();
    const stuB = oid();
    mockRecordFind.mockResolvedValue([
      { _id: oid(), hwItemId: item1, hwId: "HW-C5-SCI-0001", studentId: stuA, state: "SUBMITTED", chaseCount: 0, answerFileId: oid(), dueDate: new Date("2026-06-17") },
      { _id: oid(), hwItemId: item2, hwId: "HW-C5-BAN-0002", studentId: stuB, state: "SUBMITTED", chaseCount: 1 },
    ]);
    mockItemFind.mockResolvedValue([
      { _id: item1, subject: "SCI", dateGiven: new Date("2026-06-15") },
      { _id: item2, subject: "BAN", dateGiven: new Date("2026-06-16") },
    ]);
    mockStudentFind.mockResolvedValue([
      { _id: stuA, name: "Rehana" },
      { _id: stuB, name: "Unaisha" },
    ]);

    const res = await listOpenRecords("sec1", ["SUBMITTED"]);

    expect(mockRecordFind).toHaveBeenCalledWith({ sectionId: "sec1", state: { $in: ["SUBMITTED"] } });
    expect(res).toHaveLength(2);
    // item2 (06-16) is newer than item1 (06-15) → sorts first
    expect(res[0].subject).toBe("BAN");
    expect(res[0].studentName).toBe("Unaisha");
    expect(res[0].chaseCount).toBe(1);
    expect(res[0].hasAnswerFile).toBe(false);
    expect(res[1].subject).toBe("SCI");
    expect(res[1].studentName).toBe("Rehana");
    expect(res[1].hasAnswerFile).toBe(true);
    expect(res[1].dueDate).toMatch(/^2026-06-17/);
  });

  test("missing item/student → '?' subject + the id as a safe fallback", async () => {
    const orphanItem = oid();
    const orphanStu = oid();
    mockRecordFind.mockResolvedValue([
      { _id: oid(), hwItemId: orphanItem, hwId: "HW-X", studentId: orphanStu, state: "DUE", chaseCount: 0 },
    ]);
    mockItemFind.mockResolvedValue([]);
    mockStudentFind.mockResolvedValue([]);

    const res = await listOpenRecords("sec1", ["DUE"]);
    expect(res[0].subject).toBe("?");
    expect(res[0].studentName).toBe(orphanStu.toString());
  });
});
