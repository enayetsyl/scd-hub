/**
 * D-#471 — myAssignmentLifecycle, the assignment twin of the homework dashboard card.
 *
 * DB-free: the two models are mocked (the hwLifecycleReport.test pattern); the
 * accumulation and pending-bucket math is the real service. The point of these tests is
 * the two things a reader of the card could get wrong: cumulative totals vs
 * current-state buckets, and where CHASE is counted.
 */
const mockItemFind = jest.fn();
const mockRecFind = jest.fn();

const chain = (fn: jest.Mock) => (f: unknown) => {
  const res: { lean: () => unknown; select: () => typeof res; sort: () => typeof res } = {
    lean: () => fn(f),
    select: () => res,
    sort: () => res,
  };
  return res;
};

jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { find: (f: unknown) => chain(mockItemFind)(f) },
}));
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: { find: (f: unknown) => chain(mockRecFind)(f) },
}));

import { myAssignmentLifecycle } from "../modules/trackers/services/AssignmentLifecycleService";

const ME = "teacher-1";
const oid = (s: string) => ({ toString: () => s });
/** A record at `state`, having passed through `trail`. */
const rec = (itemId: string, state: string, trail: string[] = []) => ({
  asItemId: oid(itemId),
  state,
  stateDates: [...trail, state].map((s) => ({ state: s, at: new Date("2026-08-05T04:00:00Z") })),
});

beforeEach(() => {
  mockItemFind.mockReset();
  mockRecFind.mockReset();
});

describe("myAssignmentLifecycle (D-#471)", () => {
  test("no items in range ⇒ a zeroed row, and the records collection is never queried", async () => {
    mockItemFind.mockReturnValue([]);
    const row = await myAssignmentLifecycle(ME, "2026-08-01", "2026-08-09");
    expect(row).toEqual({
      teacherId: ME,
      deliveredItems: 0, given: 0, submitted: 0, checked: 0, returned: 0,
      pendingSubmission: 0, pendingChecking: 0, pendingReturn: 0, chasedPending: 0,
    });
    expect(mockRecFind).not.toHaveBeenCalled();
  });

  test("totals are CUMULATIVE: a returned record still counts as submitted and checked", async () => {
    mockItemFind.mockReturnValue([{ _id: oid("i1") }]);
    mockRecFind.mockReturnValue([rec("i1", "RETURNED", ["GIVEN", "SUBMITTED", "CHECKED"])]);
    const row = await myAssignmentLifecycle(ME, "2026-08-01", "2026-08-09");
    expect(row.given).toBe(1);
    expect(row.submitted).toBe(1);
    expect(row.checked).toBe(1);
    expect(row.returned).toBe(1);
    // …but it is finished, so it sits in NO pending bucket.
    expect(row.pendingSubmission + row.pendingChecking + row.pendingReturn).toBe(0);
  });

  test("pending buckets are CURRENT-state and mutually exclusive", async () => {
    mockItemFind.mockReturnValue([{ _id: oid("i1") }]);
    mockRecFind.mockReturnValue([
      rec("i1", "GIVEN"),                          // awaiting submission
      rec("i1", "DUE", ["GIVEN"]),                 // awaiting submission
      rec("i1", "ABSENT_REDELIVER", ["GIVEN"]),    // awaiting submission (redeliver rides here)
      rec("i1", "SUBMITTED", ["GIVEN"]),           // awaiting check
      rec("i1", "RESUBMIT", ["GIVEN", "SUBMITTED", "CHECKED"]), // awaiting return
      rec("i1", "CHECKED", ["GIVEN", "SUBMITTED"]),             // awaiting return
    ]);
    const row = await myAssignmentLifecycle(ME, "2026-08-01", "2026-08-09");
    expect(row.pendingSubmission).toBe(3);
    expect(row.pendingChecking).toBe(1);
    expect(row.pendingReturn).toBe(2);
    expect(row.given).toBe(6);
  });

  test("CHASE counts on its own pill AND inside awaiting-submission (owner ruling 2026-08-09)", async () => {
    mockItemFind.mockReturnValue([{ _id: oid("i1") }]);
    mockRecFind.mockReturnValue([
      rec("i1", "CHASE", ["GIVEN", "DUE"]),
      rec("i1", "GIVEN"),
    ]);
    const row = await myAssignmentLifecycle(ME, "2026-08-01", "2026-08-09");
    expect(row.chasedPending).toBe(1);
    // awaiting-submission is never smaller than the chased subset it contains
    expect(row.pendingSubmission).toBe(2);
    expect(row.pendingSubmission).toBeGreaterThanOrEqual(row.chasedPending);
  });

  test("deliveredItems counts items that reached students — a DRAFT item with no records does not inflate it", async () => {
    mockItemFind.mockReturnValue([{ _id: oid("i1") }, { _id: oid("i2") }, { _id: oid("draft") }]);
    mockRecFind.mockReturnValue([rec("i1", "GIVEN"), rec("i1", "GIVEN"), rec("i2", "SUBMITTED", ["GIVEN"])]);
    const row = await myAssignmentLifecycle(ME, "2026-08-01", "2026-08-09");
    expect(row.deliveredItems).toBe(2); // i1 + i2; the record-less draft is not a delivery
    expect(row.given).toBe(3);
  });

  test("scopes to the CALLER and to the delivery-date range", async () => {
    mockItemFind.mockReturnValue([]);
    await myAssignmentLifecycle(ME, "2026-08-01", "2026-08-09");
    const filter = mockItemFind.mock.calls[0][0] as { teacherId: string; deliveryDate: { $gte: Date; $lte: Date } };
    expect(filter.teacherId).toBe(ME);
    expect(filter.deliveryDate.$gte).toBeInstanceOf(Date);
    expect(filter.deliveryDate.$lte).toBeInstanceOf(Date);
    expect(filter.deliveryDate.$gte.getTime()).toBeLessThan(filter.deliveryDate.$lte.getTime());
  });
});
