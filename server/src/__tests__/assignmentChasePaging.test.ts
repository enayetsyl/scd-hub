/**
 * D-#761 — the Office chase list pages on the server (assignmentChaseListPage).
 *
 * The whole CHASE set is read as `_id + dueDate` keys only, ordered most-overdue first
 * (oldest due date first, undated last, `_id` tie-break); items, students and follow-up
 * counts are joined for THIS page's records only. DB-free (mocked models).
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockRecFind = jest.fn();
const mockItemFind = jest.fn();
const mockStudentFind = jest.fn();
const mockFollowUpFind = jest.fn();

const chain = (val: () => unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.lean = async () => val();
  return o;
};

jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: { find: (q: unknown) => chain(() => mockRecFind(q)) },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { find: (q: unknown) => chain(() => mockItemFind(q)) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => chain(() => mockStudentFind(q)) },
}));
jest.mock("../modules/trackers/models/AssignmentFollowUp", () => ({
  AssignmentFollowUp: { find: (q: unknown) => chain(() => mockFollowUpFind(q)) },
}));

import { assignmentChaseList, assignmentChaseListPage } from "../modules/trackers/services/AssignmentFollowUpService";

const asOf = new Date(2026, 9, 18);
const record = (dueDay: number | null) => ({
  _id: oid(),
  asItemId: oid(),
  asId: "AS-C3-ENG-W01",
  studentId: oid(),
  sectionId: oid(),
  classId: oid(),
  dueDate: dueDay === null ? undefined : new Date(2026, 9, dueDay),
  chaseCount: 1,
});

describe("assignmentChaseListPage", () => {
  const recs = [record(15), record(null), record(3), record(10)];
  const byId = new Map(recs.map((r) => [r._id.toString(), r]));

  beforeEach(() => {
    jest.clearAllMocks();
    mockRecFind.mockImplementation((q: { state?: string; _id?: { $in: string[] } }) =>
      q.state === "CHASE" ? recs.map((r) => ({ _id: r._id, dueDate: r.dueDate })) : q._id!.$in.map((id) => byId.get(id)),
    );
    mockItemFind.mockResolvedValue([]);
    mockStudentFind.mockResolvedValue([]);
    mockFollowUpFind.mockResolvedValue([]);
  });

  test("page 1 is the most overdue; joins run for the page's records only", async () => {
    const page = await assignmentChaseListPage({ page: 1, pageSize: 2 }, asOf);
    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(page.rows.map((r) => r.daysOverdue)).toEqual([15, 8]);
    expect(page.rows.map((r) => r.recordId)).toEqual([recs[2]._id.toString(), recs[3]._id.toString()]);
    const followUpQuery = mockFollowUpFind.mock.calls[0][0] as { recordId: { $in: string[] } };
    expect(followUpQuery.recordId.$in).toHaveLength(2);
  });

  test("the last page holds the least overdue, undated last", async () => {
    const page = await assignmentChaseListPage({ page: 2, pageSize: 2 }, asOf);
    expect(page.rows.map((r) => r.recordId)).toEqual([recs[0]._id.toString(), recs[1]._id.toString()]);
    expect(page.rows[1].dueDate).toBeNull();
  });

  test("past the end → an empty page, total intact, no joins", async () => {
    const page = await assignmentChaseListPage({ page: 9, pageSize: 2 }, asOf);
    expect(page).toMatchObject({ rows: [], total: 4 });
    expect(mockItemFind).not.toHaveBeenCalled();
  });

  test("the unpaged list keeps its old order (old bundles)", async () => {
    mockRecFind.mockImplementation(() => recs);
    const all = await assignmentChaseList(asOf);
    expect(all.map((r) => r.daysOverdue)).toEqual([15, 8, 3, 0]);
  });
});
