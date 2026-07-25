/**
 * Student profile panels — the DB-facing half of SP-1: windowing and subject
 * narrowing (prd-student-profile §5.7 / §4). The models are mocked, so what is
 * under test is the QUERY the service builds and how it joins records to items:
 *
 *   · the window axis is the ITEM's date (dateGiven / deliveryDate) — the axis the
 *     lifecycle report filters on, so the two reports can be reconciled (§12 #3);
 *   · a record whose item falls outside the window is dropped;
 *   · a narrowed caller's subject list reaches Mongo AND filters the join;
 *   · an EMPTY allow-list is a real answer (caller teaches nothing here) and must
 *     short-circuit to an empty panel WITHOUT touching the collections;
 *   · unrestricted callers send no `subject` clause at all.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockHwRecords = jest.fn();
const mockHwItems = jest.fn();
const mockAsRecords = jest.fn();
const mockAsItems = jest.fn();

const findChain = (fn: jest.Mock) => (filter: unknown) => ({
  select: () => ({ lean: async () => fn(filter) }),
});

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { find: findChain(mockHwRecords) },
}));
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { find: findChain(mockHwItems) },
}));
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: { find: findChain(mockAsRecords) },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { find: findChain(mockAsItems) },
}));

import {
  studentAssignmentPanel,
  studentHomeworkPanel,
} from "../modules/trackers/services/StudentProfileService";

const STUDENT = oid().toString();
const NOW = new Date(2026, 6, 25);
const FROM = "2026-07-01";
const TO = "2026-07-31";

const ITEM_ENG = oid();
const ITEM_MATH = oid();
const ITEM_OLD = oid();

const hwRecord = (itemId: mongoose.Types.ObjectId, hwId: string, over: Record<string, unknown> = {}) => ({
  _id: oid(),
  hwItemId: itemId,
  hwId,
  state: "RETURNED",
  stateDates: [
    { state: "GIVEN", at: new Date(2026, 6, 10) },
    { state: "DUE", at: new Date(2026, 6, 11) },
    { state: "SUBMITTED", at: new Date(2026, 6, 11) },
    { state: "CHECKED", at: new Date(2026, 6, 12) },
    { state: "RETURNED", at: new Date(2026, 6, 12) },
  ],
  dueDate: new Date(2026, 6, 11),
  chaseCount: 0,
  result: "CORRECT",
  createdAt: new Date(2026, 6, 10),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockHwRecords.mockReturnValue([]);
  mockHwItems.mockReturnValue([]);
  mockAsRecords.mockReturnValue([]);
  mockAsItems.mockReturnValue([]);
});

describe("studentHomeworkPanel — windowing", () => {
  test("day bounds: start is local midnight of fromKey, end is 23:59:59.999 of toKey", async () => {
    mockHwRecords.mockReturnValue([hwRecord(ITEM_ENG, "HW-1")]);
    mockHwItems.mockReturnValue([{ _id: ITEM_ENG, subject: "ENG", dateGiven: new Date(2026, 6, 10) }]);

    await studentHomeworkPanel(STUDENT, { fromKey: FROM, toKey: TO, now: NOW });

    const itemFilter = mockHwItems.mock.calls[0][0] as { dateGiven: { $gte: Date; $lte: Date } };
    expect(itemFilter.dateGiven.$gte).toEqual(new Date(2026, 6, 1, 0, 0, 0, 0));
    expect(itemFilter.dateGiven.$lte).toEqual(new Date(2026, 6, 31, 23, 59, 59, 999));
  });

  test("a record whose item is outside the window is dropped from the tally", async () => {
    // Two records come back for the student; only ONE item is in the window.
    mockHwRecords.mockReturnValue([hwRecord(ITEM_ENG, "HW-1"), hwRecord(ITEM_OLD, "HW-OLD")]);
    mockHwItems.mockReturnValue([{ _id: ITEM_ENG, subject: "ENG", dateGiven: new Date(2026, 6, 10) }]);

    const panel = await studentHomeworkPanel(STUDENT, { fromKey: FROM, toKey: TO, now: NOW });
    expect(panel.totals.sheets).toBe(1);
    expect(panel.items.map((i) => i.refId)).toEqual(["HW-1"]);
  });

  test("the item date — not the due date — carries the sheet's dateGiven", async () => {
    mockHwRecords.mockReturnValue([hwRecord(ITEM_ENG, "HW-1")]);
    mockHwItems.mockReturnValue([
      { _id: ITEM_ENG, subject: "ENG", dateGiven: new Date(2026, 6, 10), description: "পৃষ্ঠা ১২" },
    ]);

    const panel = await studentHomeworkPanel(STUDENT, { fromKey: FROM, toKey: TO, now: NOW });
    expect(panel.items[0].dateGiven).toBe(new Date(2026, 6, 10).toISOString());
    expect(panel.items[0].dueDate).toBe(new Date(2026, 6, 11).toISOString());
    expect(panel.items[0].description).toBe("পৃষ্ঠা ১২");
  });

  test("swapped bounds are rejected (from after to)", async () => {
    await expect(
      studentHomeworkPanel(STUDENT, { fromKey: TO, toKey: FROM, now: NOW }),
    ).rejects.toThrow(/from must not be after to/);
  });

  test("no records at all ⇒ zeroed panel, item collection never queried", async () => {
    const panel = await studentHomeworkPanel(STUDENT, { fromKey: FROM, toKey: TO, now: NOW });
    expect(panel.totals.sheets).toBe(0);
    expect(panel.bySubject).toEqual([]);
    expect(mockHwItems).not.toHaveBeenCalled();
  });
});

describe("studentHomeworkPanel — subject narrowing (§4)", () => {
  test("unrestricted (subjects: null) sends NO subject clause and reports fullView", async () => {
    mockHwRecords.mockReturnValue([hwRecord(ITEM_ENG, "HW-1")]);
    mockHwItems.mockReturnValue([{ _id: ITEM_ENG, subject: "ENG", dateGiven: new Date(2026, 6, 10) }]);

    const panel = await studentHomeworkPanel(STUDENT, {
      fromKey: FROM,
      toKey: TO,
      subjects: null,
      now: NOW,
    });
    expect(panel.fullView).toBe(true);
    expect(panel.subjectFilter).toEqual([]);
    expect(mockHwItems.mock.calls[0][0]).not.toHaveProperty("subject");
  });

  test("a narrowed caller's codes reach Mongo AND filter the join", async () => {
    mockHwRecords.mockReturnValue([hwRecord(ITEM_ENG, "HW-1"), hwRecord(ITEM_MATH, "HW-2")]);
    // Mongo would filter, but assert the join drops the unlisted subject too, so a
    // stale/loose query can never leak another teacher's subject into the counters.
    mockHwItems.mockReturnValue([{ _id: ITEM_ENG, subject: "ENG", dateGiven: new Date(2026, 6, 10) }]);

    const panel = await studentHomeworkPanel(STUDENT, {
      fromKey: FROM,
      toKey: TO,
      subjects: ["ENG"],
      now: NOW,
    });
    expect((mockHwItems.mock.calls[0][0] as { subject: unknown }).subject).toEqual({ $in: ["ENG"] });
    expect(panel.fullView).toBe(false);
    expect(panel.subjectFilter).toEqual(["ENG"]);
    expect(panel.bySubject.map((r) => r.subject)).toEqual(["ENG"]);
    expect(panel.totals.sheets).toBe(1);
  });

  test("an EMPTY allow-list yields an empty panel and queries NOTHING", async () => {
    const panel = await studentHomeworkPanel(STUDENT, {
      fromKey: FROM,
      toKey: TO,
      subjects: [],
      now: NOW,
    });
    expect(panel.fullView).toBe(false);
    expect(panel.totals.sheets).toBe(0);
    expect(mockHwRecords).not.toHaveBeenCalled();
    expect(mockHwItems).not.toHaveBeenCalled();
  });
});

describe("studentAssignmentPanel", () => {
  const asRecord = (over: Record<string, unknown> = {}) => ({
    _id: oid(),
    asItemId: ITEM_ENG,
    asId: "AS-C5-ENG-0001",
    state: "CHECKED",
    stateDates: [
      { state: "GIVEN", at: new Date(2026, 6, 12) },
      { state: "DUE", at: new Date(2026, 6, 16) },
      { state: "SUBMITTED", at: new Date(2026, 6, 16) },
      { state: "CHECKED", at: new Date(2026, 6, 17) },
    ],
    dueDate: new Date(2026, 6, 16),
    chaseCount: 1,
    result: "PARTIAL",
    marks: 15,
    feedback: "বানান ঠিক করতে হবে",
    createdAt: new Date(2026, 6, 12),
    ...over,
  });

  test("windows on deliveryDate and carries marks + feedback + totalMarks from the item", async () => {
    mockAsRecords.mockReturnValue([asRecord()]);
    mockAsItems.mockReturnValue([
      { _id: ITEM_ENG, subject: "ENG", deliveryDate: new Date(2026, 6, 12), totalMarks: 20 },
    ]);

    const panel = await studentAssignmentPanel(STUDENT, { fromKey: FROM, toKey: TO, now: NOW });
    expect(mockAsItems.mock.calls[0][0]).toHaveProperty("deliveryDate");
    expect(panel.totals.sheets).toBe(1);
    expect(panel.totals.graded).toBe(1);
    expect(panel.totals.avgMarksPct).toBe(75);
    expect(panel.totals.partial).toBe(1);
    expect(panel.totals.pendingReturn).toBe(1);
    expect(panel.totals.chased).toBe(1);
    expect(panel.items[0].marks).toBe(15);
    expect(panel.items[0].totalMarks).toBe(20);
    expect(panel.items[0].feedback).toBe("বানান ঠিক করতে হবে");
  });

  test("an item with no totalMarks grades nothing (no divide-by-zero percent)", async () => {
    mockAsRecords.mockReturnValue([asRecord({ marks: 5 })]);
    mockAsItems.mockReturnValue([{ _id: ITEM_ENG, subject: "ENG", deliveryDate: new Date(2026, 6, 12) }]);

    const panel = await studentAssignmentPanel(STUDENT, { fromKey: FROM, toKey: TO, now: NOW });
    expect(panel.totals.graded).toBe(1); // marks were awarded…
    expect(panel.totals.avgMarksPct).toBeNull(); // …but there is no ceiling to divide by
  });

  test("a nil-declared week contributes nothing (no item ⇒ no denominator, D-#355)", async () => {
    // Nil weeks never produce an AssignmentItem, so the student has no record for
    // them — the panel simply never sees the week. Pinned so a future 'exclude nil'
    // rule is not added twice.
    mockAsRecords.mockReturnValue([]);
    const panel = await studentAssignmentPanel(STUDENT, { fromKey: FROM, toKey: TO, now: NOW });
    expect(panel.totals.sheets).toBe(0);
    expect(mockAsItems).not.toHaveBeenCalled();
  });
});
