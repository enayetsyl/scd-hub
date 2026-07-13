/**
 * sweepHomeworkDue — the automatic GIVEN → DUE overnight flip the scheduler runs
 * once per school day (replaces the manual per-record "Mark due" chore).
 *
 * DB-free: HomeworkStudentRecord.updateMany is mocked; the test pins the exact
 * filter (state GIVEN + dueDate before end-of-today, LOCAL calendar day) and the
 * update shape (state → DUE + a timestamped STATE_DATES stamp).
 */
const mockUpdateMany = jest.fn();

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { updateMany: (f: unknown, u: unknown) => mockUpdateMany(f, u) },
}));

import { sweepHomeworkDue } from "../modules/trackers/services/HomeworkDueSweepService";

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ modifiedCount: 0 });
});

describe("sweepHomeworkDue (auto GIVEN → DUE)", () => {
  test("flips only GIVEN records due on or before today's local calendar day", async () => {
    mockUpdateMany.mockResolvedValue({ modifiedCount: 3 });
    // Sunday 2026-07-12 08:00 local — a school-day morning.
    const now = new Date(2026, 6, 12, 8, 0, 0);

    const flipped = await sweepHomeworkDue(now);
    expect(flipped).toBe(3);

    const [filter, update] = mockUpdateMany.mock.calls[0] as [
      { state: string; dueDate: { $lt: Date } },
      { $set: { state: string }; $push: { stateDates: { state: string; at: Date } } },
    ];
    expect(filter.state).toBe("GIVEN");
    // End of today = local midnight starting 2026-07-13.
    expect(filter.dueDate.$lt).toEqual(new Date(2026, 6, 13, 0, 0, 0, 0));
    expect(update.$set.state).toBe("DUE");
    expect(update.$push.stateDates).toEqual({ state: "DUE", at: now });
  });

  test("a record due LATER today still flips (dueDate carries the issue clock time)", async () => {
    // Issued 14:30 → dueDate next day 14:30; the morning sweep at 08:00 must
    // still catch it: the $lt boundary is end-of-day, not `now`.
    const now = new Date(2026, 6, 12, 8, 0, 0);
    await sweepHomeworkDue(now);
    const [filter] = mockUpdateMany.mock.calls[0] as [{ dueDate: { $lt: Date } }];
    const dueLaterToday = new Date(2026, 6, 12, 14, 30, 0);
    expect(dueLaterToday.getTime()).toBeLessThan(filter.dueDate.$lt.getTime());
  });

  test("a record due TOMORROW is outside the boundary", async () => {
    const now = new Date(2026, 6, 12, 8, 0, 0);
    await sweepHomeworkDue(now);
    const [filter] = mockUpdateMany.mock.calls[0] as [{ dueDate: { $lt: Date } }];
    const dueTomorrow = new Date(2026, 6, 13, 9, 0, 0);
    expect(dueTomorrow.getTime()).toBeGreaterThanOrEqual(filter.dueDate.$lt.getTime());
  });

  test("returns 0 when nothing matched (idempotent re-run)", async () => {
    await expect(sweepHomeworkDue(new Date(2026, 6, 12, 8, 0, 0))).resolves.toBe(0);
  });
});
