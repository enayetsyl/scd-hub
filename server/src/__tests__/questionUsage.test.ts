/**
 * Where has this question already been used? (QU-1, D-#608)
 *
 * A teacher picking questions had no way to know one was already in three other sets, so the
 * same question could land in this week's homework and last week's class test unnoticed.
 *
 * What these pin:
 *   • the lookup is keyed on the QID, never the artifactId — a re-import creates a new
 *     artifact row for the same question, so a set assembled last term points at the OLD
 *     row and an artifactId lookup would report "never used" exactly when it matters most;
 *   • a SET is counted once even if it somehow lists the same qid twice — the teacher's
 *     question is "how many papers", not "how many rows";
 *   • the date is due → assembled → created, in that order, because that is the one that
 *     decides whether reuse is a problem;
 *   • class and section names are resolved in TWO batched queries, never one per row.
 */
import mongoose from "mongoose";

const mockAggregate = jest.fn();
const mockFind = jest.fn();
jest.mock("../modules/assessment/models/AssessmentSet", () => ({
  AssessmentSet: {
    aggregate: (p: unknown) => mockAggregate(p),
    find: (f: unknown) => ({ select: () => ({ lean: async () => mockFind(f) }) }),
  },
}));

// AL-3: the ledger's non-set uses are added on top of the sets (never the ledger rows of a set).
const mockUseAggregate = jest.fn();
const mockUseFind = jest.fn();
jest.mock("../modules/assessment/models/QuestionUse", () => ({
  QuestionUse: {
    aggregate: (p: unknown) => mockUseAggregate(p),
    find: (f: unknown) => ({ select: () => ({ lean: async () => mockUseFind(f) }) }),
  },
}));

const mockClassFind = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (f: unknown) => ({ select: () => ({ lean: async () => mockClassFind(f) }) }) },
}));

const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (f: unknown) => ({ select: () => ({ lean: async () => mockSectionFind(f) }) }) },
}));

import {
  questionUsage,
  questionUsageByKind,
  questionUsageCounts,
} from "../modules/assessment/services/QuestionUsageService";

const CLASS_ID = new mongoose.Types.ObjectId();
const SECTION_ID = new mongoose.Types.ObjectId();

beforeEach(() => {
  jest.clearAllMocks();
  mockAggregate.mockResolvedValue([]);
  mockUseAggregate.mockResolvedValue([]);
  mockUseFind.mockResolvedValue([]);
  mockFind.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([{ _id: CLASS_ID, nameBn: "পঞ্চম শ্রেণি", level: 5 }]);
  mockSectionFind.mockResolvedValue([{ _id: SECTION_ID, nameBn: "সম্মিলিত" }]);
});

describe("questionUsageCounts — the badge", () => {
  test("keys on the QID, not the artifactId", async () => {
    await questionUsageCounts(["QP-A", "QP-B"]);

    const pipeline = mockAggregate.mock.calls[0][0] as Record<string, unknown>[];
    const first = pipeline[0].$match as Record<string, unknown>;
    // The whole point: a re-import gives the same question a NEW artifactId, so the history
    // must hang off the qid or it reads as empty exactly when it matters.
    expect(first["basketItems.qid"]).toEqual({ $in: ["QP-A", "QP-B"] });
    expect(JSON.stringify(pipeline)).not.toContain("artifactId");
  });

  test("counts SETS, not rows — a qid listed twice in one set counts once", async () => {
    const pipeline = await (async () => {
      await questionUsageCounts(["QP-A"]);
      return mockAggregate.mock.calls[0][0] as Record<string, unknown>[];
    })();

    // The first $group is per (qid, setId); only the second sums. Without that, a duplicated
    // row would inflate the badge and the teacher would distrust it.
    const groups = pipeline.filter((s) => "$group" in s);
    expect(groups).toHaveLength(2);
    expect((groups[0].$group as Record<string, unknown>)._id).toEqual({
      qid: "$basketItems.qid",
      setId: "$_id",
    });
  });

  test("re-matches AFTER the unwind, so a set does not drag in its other questions", async () => {
    await questionUsageCounts(["QP-A"]);
    const pipeline = mockAggregate.mock.calls[0][0] as Record<string, unknown>[];

    // The first $match keeps whole SETS; a set holding QP-A also holds every other question
    // it was built from, and without the second $match those would be counted too.
    const matches = pipeline.filter((s) => "$match" in s);
    expect(matches).toHaveLength(2);
    const unwindAt = pipeline.findIndex((s) => "$unwind" in s);
    const secondMatchAt = pipeline.findIndex((s, i) => i > unwindAt && "$match" in s);
    expect(secondMatchAt).toBeGreaterThan(unwindAt);
  });

  test("returns a map keyed by qid", async () => {
    mockAggregate.mockResolvedValue([{ _id: "QP-A", n: 3 }, { _id: "QP-B", n: 1 }]);
    const m = await questionUsageCounts(["QP-A", "QP-B"]);
    expect(m.get("QP-A")).toBe(3);
    expect(m.get("QP-B")).toBe(1);
    // An unused question is ABSENT rather than zero — the client treats absent as none.
    expect(m.get("QP-C")).toBeUndefined();
  });

  test("an empty or junk id list never reaches the database", async () => {
    expect((await questionUsageCounts([])).size).toBe(0);
    expect((await questionUsageCounts(["", ""])).size).toBe(0);
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  test("duplicate ids in the request are de-duplicated before querying", async () => {
    await questionUsageCounts(["QP-A", "QP-A", "QP-B"]);
    const first = (mockAggregate.mock.calls[0][0] as Record<string, unknown>[])[0].$match as Record<string, unknown>;
    expect(first["basketItems.qid"]).toEqual({ $in: ["QP-A", "QP-B"] });
  });
});

describe("questionUsage — the list", () => {
  function set(over: Record<string, unknown> = {}) {
    return {
      _id: new mongoose.Types.ObjectId(),
      name: "ভগ্নাংশ অনুশীলন",
      setType: "HW",
      status: "assembled",
      classId: CLASS_ID,
      sectionId: SECTION_ID,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      ...over,
    };
  }

  test("resolves class and section names in two batched queries, not one per row", async () => {
    mockFind.mockResolvedValue([set(), set(), set()]);
    await questionUsage("QP-A");
    expect(mockClassFind).toHaveBeenCalledTimes(1);
    expect(mockSectionFind).toHaveBeenCalledTimes(1);
  });

  test("the date is due → assembled → created, in that order", async () => {
    const due = new Date("2026-08-30T00:00:00.000Z");
    const assembled = new Date("2026-08-20T00:00:00.000Z");
    const created = new Date("2026-08-01T00:00:00.000Z");

    mockFind.mockResolvedValue([set({ dueDate: due, assembledAt: assembled, createdAt: created })]);
    expect((await questionUsage("QP-A"))[0].usedOn).toBe(due.toISOString());

    mockFind.mockResolvedValue([set({ assembledAt: assembled, createdAt: created })]);
    expect((await questionUsage("QP-A"))[0].usedOn).toBe(assembled.toISOString());

    mockFind.mockResolvedValue([set({ createdAt: created })]);
    expect((await questionUsage("QP-A"))[0].usedOn).toBe(created.toISOString());
  });

  test("newest use first — the recent one decides whether to reuse", async () => {
    mockFind.mockResolvedValue([
      set({ name: "old", dueDate: new Date("2026-01-01T00:00:00.000Z") }),
      set({ name: "new", dueDate: new Date("2026-08-30T00:00:00.000Z") }),
    ]);
    const rows = await questionUsage("QP-A");
    expect(rows.map((r) => r.setName)).toEqual(["new", "old"]);
  });

  test("an unnamed set keeps its row and reports a null name", async () => {
    // `name` is optional on the model; the client falls back to the set type rather than
    // dropping a real use because nobody typed a title.
    mockFind.mockResolvedValue([set({ name: undefined }), set({ name: "   " })]);
    const rows = await questionUsage("QP-A");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.setName === null)).toBe(true);
  });

  test("a set with no date at all sorts last rather than being dropped", async () => {
    mockFind.mockResolvedValue([
      set({ name: "undated", createdAt: undefined }),
      set({ name: "dated", dueDate: new Date("2026-08-30T00:00:00.000Z") }),
    ]);
    const rows = await questionUsage("QP-A");
    expect(rows.map((r) => r.setName)).toEqual(["dated", "undated"]);
    // It is still a use, and hiding it would understate the history.
    expect(rows).toHaveLength(2);
  });

  test("the query is by qid, and a blank qid never reaches the database", async () => {
    await questionUsage("QP-A");
    expect((mockFind.mock.calls[0][0] as Record<string, unknown>)["basketItems.qid"]).toBe("QP-A");

    mockFind.mockClear();
    expect(await questionUsage("")).toEqual([]);
    expect(await questionUsage("   ")).toEqual([]);
    expect(mockFind).not.toHaveBeenCalled();
  });
});

describe("AL-3 — the ledger adds the non-set kinds, never double counts a set", () => {
  test("the ledger part excludes rows whose source is an AssessmentSet and withdrawn rows", async () => {
    await questionUsageCounts(["QP-A"]);
    const m = (mockUseAggregate.mock.calls[0][0] as Record<string, unknown>[])[0].$match as Record<string, unknown>;
    expect(m.withdrawnAt).toBeNull();
    expect(m.sourceType).toEqual({ $ne: "ASSESSMENT_SET" });
  });

  test("counts = every set holding the qid (as before) + the ledger's non-set uses", async () => {
    mockAggregate.mockResolvedValue([{ _id: "QP-A", n: 2 }]);
    mockUseAggregate.mockResolvedValue([{ _id: { qid: "QP-A", kind: "HW" }, n: 1 }, { _id: { qid: "QP-B", kind: "AS" }, n: 1 }]);
    const m = await questionUsageCounts(["QP-A", "QP-B"]);
    expect(m.get("QP-A")).toBe(3);
    expect(m.get("QP-B")).toBe(1);
  });

  test("the badge splits sets by their type and adds homework / assignment / extra homework / CT-paper uses", async () => {
    mockAggregate.mockResolvedValue([{ _id: { qid: "QP-A", kind: "CT" }, n: 2 }, { _id: { qid: "QP-A", kind: "HW" }, n: 1 }]);
    mockUseAggregate.mockResolvedValue([
      { _id: { qid: "QP-A", kind: "EXTRA_HW" }, n: 1 }, { _id: { qid: "QP-A", kind: "AS" }, n: 1 }, { _id: { qid: "QP-A", kind: "RETEST" }, n: 1 },
    ]);
    expect((await questionUsageByKind(["QP-A"])).get("QP-A")).toEqual({ total: 6, hw: 2, as: 1, ct: 2 });
  });

  test("the list adds ledger uses with their kind and day, newest first, beside the sets", async () => {
    mockFind.mockResolvedValue([{ _id: new mongoose.Types.ObjectId(), name: "set", setType: "CT", status: "draft", classId: CLASS_ID, sectionId: SECTION_ID, createdAt: new Date("2026-08-01T00:00:00.000Z") }]);
    mockUseFind.mockResolvedValue([{ kind: "EXTRA_HW", sourceType: "MASTERY_PAPER", sourceId: new mongoose.Types.ObjectId(), sectionId: SECTION_ID, givenOn: "2026-09-01" }]);
    const rows = await questionUsage("QP-A");
    expect(rows.map((r) => r.kind)).toEqual(["EXTRA_HW", "CT"]);
    expect(rows[0]).toMatchObject({ setName: null, status: "given", usedOn: "2026-09-01T00:00:00.000Z" });
  });
});
