/**
 * Editing a class note whose homework is already ISSUED (D-#528).
 *
 * The reported failure: a teacher opened a class note for a day whose homework had been
 * issued, changed nothing but the attachments, and every save was refused with
 * "Item is already issued — TIME_DECL, Q_COUNT, revision flag is frozen". The rule the
 * error states is right; the enforcement was not. Two independent causes:
 *
 *  1. `updateHomeworkItem` rejected on the PRESENCE of a frozen field rather than on a
 *     change to it, and
 *  2. the class-note bridge always passed `qCount` and a fabricated `revItem: false`.
 *
 * Together they made an issued day's note permanently uneditable — including the
 * description, topics and attachments the same rule promises stay editable.
 *
 * The fabricated `revItem` was the worse of the two: on a still-DECLARED item there is no
 * guard to trip, so saving a note silently cleared the revision flag with no error at all.
 *
 * DB-free, matching homeworkItemEdit.test.ts: the models are mocked, the tier logic is real.
 */
const mockItemById = jest.fn();
const mockTopicFind = jest.fn();
const mockReconFindOne = jest.fn();
const mockFileFind = jest.fn();

jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HOMEWORK_ITEM_STATUSES: ["declared", "issued"],
  HomeworkItem: {
    findById: (id: string) => {
      const doc = mockItemById(id);
      return {
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(doc).then(resolve, reject),
        lean: () => Promise.resolve(doc),
        select: () => ({ lean: () => Promise.resolve(doc) }),
      };
    },
    deleteOne: () => Promise.resolve({}),
  },
}));
jest.mock("../modules/trackers/models/HomeworkTopic", () => ({
  HomeworkTopic: { find: (q: unknown) => ({ select: () => ({ lean: () => mockTopicFind(q) }) }) },
}));
jest.mock("../modules/trackers/models/HomeworkReconciliation", () => ({
  HomeworkReconciliation: { findOne: (q: unknown) => ({ lean: () => mockReconFindOne(q) }) },
  reconDayKey: (d: Date) => d,
}));
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: { find: (q: unknown) => ({ select: () => ({ lean: () => mockFileFind(q) }) }) },
}));

import { updateHomeworkItem } from "../modules/trackers/services/HomeworkService";

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
    timeDecl: 30,
    qCount: 15,
    poolRef: undefined,
    selectedQids: [],
    revItem: false,
    description: "পুরনো বিবরণ",
    status: "issued",
    attachmentIds: [],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTopicFind.mockResolvedValue([{ code: "TOP-MATH-C3-01" }]);
  mockReconFindOne.mockResolvedValue(null);
  mockFileFind.mockResolvedValue([]);
});

describe("D-#528 — an unchanged frozen field is not an edit", () => {
  test("the exact class-note payload that used to be refused now saves", async () => {
    // Verbatim the shape ClassNoteHomeworkService sends: the frozen values are RESENT
    // identically because the form always renders them, not because anyone changed them.
    const doc = itemDoc();
    mockItemById.mockReturnValue(doc);

    const res = await updateHomeworkItem({
      itemId: "item-1",
      description: "ক্লাসে বুঝিয়ে দেওয়া নিয়মানুযায়ী শীটের সংক্ষিপ্ত প্রশ্নগুলোর উত্তর লিখে নিয়ে আসা।",
      topTags: ["TOP-MATH-C3-01"],
      attachmentIds: [],
      timeDecl: 30, // same as stored
      qCount: 15, // same as stored
      revItem: false, // same as stored
      actorId: "t-1",
    });

    expect(doc.save).toHaveBeenCalled();
    expect(res.status).toBe("issued");
    expect(doc.description).toBe(
      "ক্লাসে বুঝিয়ে দেওয়া নিয়মানুযায়ী শীটের সংক্ষিপ্ত প্রশ্নগুলোর উত্তর লিখে নিয়ে আসা।",
    );
  });

  test("an empty selectedQids array against an empty stored one is not a change", async () => {
    // A fresh array of the same ids is rebuilt on every save — content, not identity.
    const doc = itemDoc({ selectedQids: ["q1", "q2"] });
    mockItemById.mockReturnValue(doc);
    await expect(
      updateHomeworkItem({ itemId: "item-1", selectedQids: ["q1", "q2"], actorId: "t-1" }),
    ).resolves.toBeDefined();
  });

  test("absent / null / empty-string all read as the SAME no-pool value", async () => {
    for (const sent of [null, ""] as const) {
      const doc = itemDoc({ poolRef: undefined });
      mockItemById.mockReturnValue(doc);
      await expect(
        updateHomeworkItem({ itemId: "item-1", poolRef: sent, actorId: "t-1" }),
      ).resolves.toBeDefined();
    }
  });
});

describe("D-#528 — a REAL change is still refused", () => {
  test.each([
    ["TIME_DECL", { timeDecl: 25 }],
    ["Q_COUNT", { qCount: 9 }],
    ["POOL_REF", { poolRef: "QP-MATH-C3-U06" }],
    ["revision flag", { revItem: true }],
    ["selected questions", { selectedQids: ["q1"] }],
  ])("%s cannot be changed after issue", async (_name, patch) => {
    // The protection the guard exists for is intact: tallyDay recomputes live, so a real
    // edit here would rewrite an already-reconciled DAY_TOTAL.
    const doc = itemDoc();
    mockItemById.mockReturnValue(doc);
    await expect(
      updateHomeworkItem({ itemId: "item-1", ...patch, actorId: "t-1" }),
    ).rejects.toThrow(/issued.*frozen/);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("the error names ONLY the field that actually differs", async () => {
    // The reported error named three fields at once, which is what made it unactionable —
    // none of them was the thing the teacher had touched.
    const doc = itemDoc();
    mockItemById.mockReturnValue(doc);
    await expect(
      updateHomeworkItem({
        itemId: "item-1",
        timeDecl: 30, // unchanged
        qCount: 99, // changed
        revItem: false, // unchanged
        actorId: "t-1",
      }),
    ).rejects.toThrow(/Q_COUNT is frozen/);
  });
});
