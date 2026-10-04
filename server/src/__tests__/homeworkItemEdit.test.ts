/**
 * D-#336 tests — updateHomeworkItem / deleteHomeworkItem (teacher edit of a
 * declared sheet; descriptive-only after issue).
 *
 *   1. declared + day unreconciled → full edit (description/topics/time/qCount) saves
 *   2. declared + day RECONCILED → rejected (trim-log/§4.5 freeze)
 *   3. issued → description/topics edit allowed (live-joined downstream)
 *   4. issued → timeDecl / qCount / poolRef / revItem rejected ("frozen")
 *   5. validation reuse: empty description, unknown topic code
 *   6. delete: declared OK; issued rejected; reconciled day rejected
 *
 * DB-free: HomeworkItem / HomeworkTopic / HomeworkReconciliation / StoredFile
 * are mocked; the tier + validation logic is real.
 */
const mockItemById = jest.fn();
const mockDeleteOne = jest.fn();
const mockTopicFind = jest.fn();
const mockReconFindOne = jest.fn();
const mockFileFind = jest.fn();
const mockItemFind = jest.fn();

jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HOMEWORK_ITEM_STATUSES: ["declared", "issued"],
  HomeworkItem: {
    findById: (id: string) => {
      const doc = mockItemById(id);
      return {
        // updateHomeworkItem awaits the query directly (thenable), deleteHomeworkItem
        // chains .lean(), the resolver chains .select().lean() — support all three.
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(doc).then(resolve, reject),
        lean: () => Promise.resolve(doc),
        select: () => ({ lean: () => Promise.resolve(doc) }),
      };
    },
    deleteOne: (q: unknown) => Promise.resolve(mockDeleteOne(q)),
    // listDailyItems — the section's own items that day (find().sort().lean()).
    find: (q: unknown) => ({ sort: () => ({ lean: () => Promise.resolve(mockItemFind(q)) }) }),
  },
}));
jest.mock("../modules/trackers/models/HomeworkTopic", () => ({
  HomeworkTopic: {
    find: (q: unknown) => ({ select: () => ({ lean: () => mockTopicFind(q) }) }),
  },
}));
jest.mock("../modules/trackers/models/HomeworkReconciliation", () => ({
  HomeworkReconciliation: {
    findOne: (q: unknown) => ({ lean: () => mockReconFindOne(q) }),
  },
  reconDayKey: (d: Date) => d,
}));
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: {
    find: (q: unknown) => ({ select: () => ({ lean: () => mockFileFind(q) }) }),
  },
}));

import { updateHomeworkItem, deleteHomeworkItem } from "../modules/trackers/services/HomeworkService";

function itemDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: { toString: () => "item-1" },
    hwId: "HW-C3-MATH-0007",
    classId: { toString: () => "class-1" },
    classLevel: 3,
    sectionId: { toString: () => "sec-1" },
    subject: "MATH",
    dateGiven: new Date("2026-07-16T00:00:00"),
    topTags: ["TOP-MATH-C3-01"],
    timeDecl: 20,
    qCount: 5,
    poolRef: undefined,
    selectedQids: [],
    revItem: false,
    description: "পুরনো বিবরণ",
    status: "declared",
    attachmentIds: [],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  mockItemById.mockReset();
  mockDeleteOne.mockReset();
  mockTopicFind.mockReset();
  mockReconFindOne.mockReset();
  mockFileFind.mockReset();
  mockItemFind.mockReset();
  mockReconFindOne.mockResolvedValue(null);
  // By default the item's OWN section has issued that day — a reconciled day is frozen.
  mockItemFind.mockReturnValue([{ status: "issued" }]);
  mockTopicFind.mockResolvedValue([{ code: "TOP-MATH-C3-02" }]);
});

test("declared + unreconciled day: full edit saves every field", async () => {
  const doc = itemDoc();
  mockItemById.mockReturnValue(doc);

  const res = await updateHomeworkItem({
    itemId: "item-1",
    description: "  নতুন বিবরণ  ",
    topTags: ["TOP-MATH-C3-02"],
    timeDecl: 30,
    qCount: 8,
    revItem: true,
    actorId: "t-1",
  });

  expect(doc.save).toHaveBeenCalled();
  expect(res.timeDecl).toBe(30);
  expect(res.qCount).toBe(8);
  expect(res.revItem).toBe(true);
  expect(res.topTags).toEqual(["TOP-MATH-C3-02"]);
  expect(doc.description).toBe("নতুন বিবরণ");
});

test("declared edit on a RECONCILED day is rejected", async () => {
  mockItemById.mockReturnValue(itemDoc());
  mockReconFindOne.mockResolvedValue({ reconState: "reconciled" });

  await expect(
    updateHomeworkItem({ itemId: "item-1", description: "x", actorId: "t-1" }),
  ).rejects.toThrow(/reconciled/);
});

test("issued: description + topics edit allowed, recon not consulted", async () => {
  const doc = itemDoc({ status: "issued" });
  mockItemById.mockReturnValue(doc);

  const res = await updateHomeworkItem({
    itemId: "item-1",
    description: "সংশোধিত বিবরণ",
    topTags: ["TOP-MATH-C3-02"],
    actorId: "t-1",
  });

  expect(doc.save).toHaveBeenCalled();
  expect(res.status).toBe("issued");
  expect(doc.description).toBe("সংশোধিত বিবরণ");
  expect(mockReconFindOne).not.toHaveBeenCalled();
});

test.each([
  ["timeDecl", { timeDecl: 25 }],
  ["qCount", { qCount: 9 }],
  ["poolRef", { poolRef: "QP-MATH-C3-U06" }],
  ["revItem", { revItem: true }],
  ["selectedQids", { selectedQids: ["q1"] }],
])("issued: %s edit is rejected as frozen", async (_name, patch) => {
  const doc = itemDoc({ status: "issued" });
  mockItemById.mockReturnValue(doc);

  await expect(
    updateHomeworkItem({ itemId: "item-1", ...patch, actorId: "t-1" }),
  ).rejects.toThrow(/issued.*frozen/);
  expect(doc.save).not.toHaveBeenCalled();
});

test("empty description rejected (D-#317)", async () => {
  mockItemById.mockReturnValue(itemDoc());
  await expect(
    updateHomeworkItem({ itemId: "item-1", description: "   ", actorId: "t-1" }),
  ).rejects.toThrow(/description is required/);
});

test("unknown topic code rejected against the catalog", async () => {
  mockItemById.mockReturnValue(itemDoc());
  mockTopicFind.mockResolvedValue([]);
  await expect(
    updateHomeworkItem({ itemId: "item-1", topTags: ["TOP-MATH-C3-99"], actorId: "t-1" }),
  ).rejects.toThrow(/Unknown topic/);
});

test("delete: declared + unreconciled day deletes", async () => {
  mockItemById.mockReturnValue(itemDoc());
  const res = await deleteHomeworkItem("item-1");
  expect(mockDeleteOne).toHaveBeenCalled();
  expect(res.hwId).toBe("HW-C3-MATH-0007");
});

test("delete: issued item rejected", async () => {
  mockItemById.mockReturnValue(itemDoc({ status: "issued" }));
  await expect(deleteHomeworkItem("item-1")).rejects.toThrow(/cannot be deleted/);
  expect(mockDeleteOne).not.toHaveBeenCalled();
});

test("delete: reconciled day rejected", async () => {
  mockItemById.mockReturnValue(itemDoc());
  mockReconFindOne.mockResolvedValue({ reconState: "reconciled" });
  await expect(deleteHomeworkItem("item-1")).rejects.toThrow(/reconciled/);
  expect(mockDeleteOne).not.toHaveBeenCalled();
});

// D-#706 follow-up (owner report 2026-10-04): the reconciliation row is per CLASS, but a
// split class's sections confirm separately. C5 Girls' auto-issue froze C5 Boys' still-
// declared English item. The day is reconciled for an item's section only once THAT
// section has issued.
test("split class: the OTHER section's confirm does not freeze this section's declared item", async () => {
  mockItemById.mockReturnValue(itemDoc());
  mockReconFindOne.mockResolvedValue({ reconState: "reconciled" });
  mockItemFind.mockReturnValue([{ status: "declared" }]); // this section has issued nothing
  const res = await deleteHomeworkItem("item-1");
  expect(mockDeleteOne).toHaveBeenCalled();
  expect(res.hwId).toBe("HW-C3-MATH-0007");
  // …and the lookup was scoped to the item's own section.
  expect(mockItemFind.mock.calls[0][0]).toMatchObject({ classId: "class-1", sectionId: "sec-1" });
});

test("split class: an edit is likewise allowed until this section has issued", async () => {
  const doc = itemDoc();
  mockItemById.mockReturnValue(doc);
  mockReconFindOne.mockResolvedValue({ reconState: "reconciled" });
  mockItemFind.mockReturnValue([{ status: "declared" }]);
  await updateHomeworkItem({ itemId: "item-1", description: "নতুন", actorId: "t-1" });
  expect(doc.description).toBe("নতুন");
});
