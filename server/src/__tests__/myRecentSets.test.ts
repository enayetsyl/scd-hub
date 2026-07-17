/**
 * ux-audit F7 tests — listMyRecentSets (the Today-screen "সাম্প্রতিক সেট" read).
 *
 *   1. self-scoped: the query filters on createdBy OR assembledBy = the caller
 *   2. limit defaults to 2 and is passed through to the cursor
 *   3. openTrackerId carries the NEWEST still-open tracker for a set, and stays
 *      null when no open tracker exists (guards the non-idempotent openTracker
 *      mutation from being re-fired into a duplicate TrackerRecord)
 *   4. field mapping: name null-fallback, itemCount from basketItems length
 *
 * DB-free: AssessmentSet + TrackerRecord are mocked; the mapping logic is real.
 */
import mongoose from "mongoose";

const mockSetFind = jest.fn();
const mockTrackerFind = jest.fn();

jest.mock("../modules/assessment/models/AssessmentSet", () => ({
  AssessmentSet: {
    find: (q: unknown) => ({
      sort: () => ({ limit: (n: number) => ({ lean: () => mockSetFind(q, n) }) }),
    }),
  },
}));
jest.mock("../modules/trackers/models/TrackerRecord", () => ({
  TrackerRecord: {
    find: (q: unknown) => ({
      select: () => ({ sort: () => ({ lean: () => mockTrackerFind(q) }) }),
    }),
  },
}));

import { listMyRecentSets } from "../modules/assessment/services/AssessmentService";

const oid = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();

function setDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: oid(),
    setType: "HW",
    name: "গণিত সেট",
    sectionId: oid(),
    classId: oid(),
    subjectId: undefined,
    status: "assembled",
    basketItems: [{ qid: "q1", marks: 5 }, { qid: "q2", marks: 5 }],
    totalMarks: 10,
    dueDate: undefined,
    createdAt: new Date("2026-07-15T04:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  mockSetFind.mockReset();
  mockTrackerFind.mockReset();
  mockTrackerFind.mockResolvedValue([]);
});

test("filters on createdBy OR assembledBy = caller and defaults limit to 2", async () => {
  mockSetFind.mockResolvedValue([]);
  await listMyRecentSets("user-1");
  expect(mockSetFind).toHaveBeenCalledWith(
    { $or: [{ createdBy: "user-1" }, { assembledBy: "user-1" }] },
    2,
  );
});

test("passes an explicit limit through to the cursor", async () => {
  mockSetFind.mockResolvedValue([]);
  await listMyRecentSets("user-1", 5);
  expect(mockSetFind.mock.calls[0][1]).toBe(5);
});

test("openTrackerId maps the newest open tracker; null when none", async () => {
  const a = setDoc();
  const b = setDoc();
  mockSetFind.mockResolvedValue([a, b]);

  const newer = oid();
  const older = oid();
  // Sorted newest-first by the query — first hit per set must win.
  mockTrackerFind.mockResolvedValue([
    { _id: newer, setId: (a._id as mongoose.Types.ObjectId).toString() },
    { _id: older, setId: (a._id as mongoose.Types.ObjectId).toString() },
  ]);

  const result = await listMyRecentSets("user-1");
  expect(mockTrackerFind).toHaveBeenCalledWith({
    setId: { $in: [(a._id as mongoose.Types.ObjectId).toString(), (b._id as mongoose.Types.ObjectId).toString()] },
    status: "open",
  });
  expect(result[0].openTrackerId).toBe(newer.toString());
  expect(result[1].openTrackerId).toBeNull();
});

test("maps fields: name null-fallback, itemCount, ISO dates", async () => {
  const doc = setDoc({ name: undefined, dueDate: new Date("2026-07-20T00:00:00Z") });
  mockSetFind.mockResolvedValue([doc]);

  const [item] = await listMyRecentSets("user-1");
  expect(item.name).toBeNull();
  expect(item.itemCount).toBe(2);
  expect(item.totalMarks).toBe(10);
  expect(item.status).toBe("assembled");
  expect(item.dueDate).toBe("2026-07-20T00:00:00.000Z");
  expect(item.createdAt).toBe("2026-07-15T04:00:00.000Z");
  expect(item.id).toBe((doc._id as mongoose.Types.ObjectId).toString());
});
