/**
 * D-#383 — per-item pipeline tallies for the workspace card headers.
 *
 * The point of the feature: the workspace fetches OPEN rows only and drops
 * RETURNED ones older than today, so a finished item's students are absent from
 * the client's data entirely. These counts therefore have to be computed server
 * side, and submitted/checked/returned must be CUMULATIVE — a student sitting in
 * RETURNED still counts as having submitted.
 *
 * DB-free: the models' find().select().lean() chain is mocked.
 */
const mockRecordFind = jest.fn();
const mockItemFind = jest.fn();

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { find: (q: unknown) => ({ select: () => ({ lean: () => mockRecordFind(q) }) }) },
}));
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: (q: unknown) => ({ select: () => ({ lean: () => mockItemFind(q) }) }) },
}));
jest.mock("../modules/trackers/models/HomeworkReconciliation", () => ({
  HomeworkReconciliation: { find: () => ({ lean: () => [] }) },
}));

import { homeworkItemTallies } from "../modules/trackers/services/HomeworkSummaryService";

/** A record whose stamp trail is derived from the states it has passed through. */
function rec(hwItemId: string, state: string, stamps: string[]) {
  return { hwItemId, state, stateDates: stamps.map((s) => ({ state: s, at: new Date() })) };
}

beforeEach(() => {
  mockRecordFind.mockReset();
  mockItemFind.mockReset();
});

describe("D-#383 — homeworkItemTallies", () => {
  it("counts submitted/checked/returned cumulatively, not by current state", async () => {
    // The screenshot case: 17 returned + 4 absent-at-issue on a 21-child roster.
    const rows = [
      ...Array.from({ length: 17 }, () => rec("i1", "RETURNED", ["GIVEN", "SUBMITTED", "CHECKED", "RETURNED"])),
      ...Array.from({ length: 4 }, () => rec("i1", "ABSENT_REDELIVER", ["ABSENT_REDELIVER"])),
    ];
    mockRecordFind.mockReturnValue(rows);

    const [t] = await homeworkItemTallies("sec1");

    expect(t.total).toBe(21);
    // The whole bug: these were 0 before, because no row was *currently* SUBMITTED.
    expect(t.submitted).toBe(17);
    expect(t.checked).toBe(17);
    expect(t.returned).toBe(17);
    expect(t.pendingSubmission).toBe(0);
    expect(t.absent).toBe(4);
  });

  it("counts GIVEN/DUE/CHASE as still owing a submission", async () => {
    mockRecordFind.mockReturnValue([
      rec("i1", "GIVEN", ["GIVEN"]),
      rec("i1", "DUE", ["GIVEN", "DUE"]),
      rec("i1", "CHASE", ["GIVEN", "DUE", "CHASE"]),
      rec("i1", "SUBMITTED", ["GIVEN", "SUBMITTED"]),
    ]);

    const [t] = await homeworkItemTallies("sec1");

    expect(t.pendingSubmission).toBe(3);
    expect(t.submitted).toBe(1);
    expect(t.checked).toBe(0);
    expect(t.returned).toBe(0);
  });

  it("stops counting a submission the D-#338 undo popped", async () => {
    // Undo pops the stamp, so the trail no longer carries SUBMITTED.
    mockRecordFind.mockReturnValue([rec("i1", "DUE", ["GIVEN", "DUE"])]);

    const [t] = await homeworkItemTallies("sec1");

    expect(t.submitted).toBe(0);
    expect(t.pendingSubmission).toBe(1);
  });

  it("splits the tally per item", async () => {
    mockRecordFind.mockReturnValue([
      rec("i1", "RETURNED", ["GIVEN", "SUBMITTED", "CHECKED", "RETURNED"]),
      rec("i2", "DUE", ["GIVEN", "DUE"]),
      rec("i2", "DUE", ["GIVEN", "DUE"]),
    ]);

    const tallies = await homeworkItemTallies("sec1");
    const byId = new Map(tallies.map((t) => [t.hwItemId, t]));

    expect(byId.get("i1")!.returned).toBe(1);
    expect(byId.get("i2")!.pendingSubmission).toBe(2);
    expect(byId.get("i2")!.returned).toBe(0);
  });

  it("restricts to the caller's readable subjects via the item lookup", async () => {
    mockItemFind.mockReturnValue([{ _id: "i1" }]);
    mockRecordFind.mockReturnValue([rec("i1", "SUBMITTED", ["GIVEN", "SUBMITTED"])]);

    const tallies = await homeworkItemTallies("sec1", new Set(["ENG"]));

    // Items are filtered by subject first, then records by those item ids —
    // a teacher must never get counts for a subject they cannot read.
    expect(mockItemFind).toHaveBeenCalledWith({ sectionId: "sec1", subject: { $in: ["ENG"] } });
    expect(mockRecordFind).toHaveBeenCalledWith({ hwItemId: { $in: ["i1"] } });
    expect(tallies).toHaveLength(1);
  });

  it("reads every record for the section when unrestricted", async () => {
    mockRecordFind.mockReturnValue([]);

    await homeworkItemTallies("sec1");

    expect(mockItemFind).not.toHaveBeenCalled();
    expect(mockRecordFind).toHaveBeenCalledWith({ sectionId: "sec1" });
  });
});
