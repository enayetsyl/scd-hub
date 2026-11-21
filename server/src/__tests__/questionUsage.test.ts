/**
 * Where has this question already been used? (QU-1, D-#608; re-pointed at the QuestionUse ledger by AL-3, D-#1667)
 *
 * A teacher picking questions had no way to know one was already in three other sets, so the same question
 * could land in this week's homework and last week's class test unnoticed.
 *
 * What these pin:
 *   • the lookup is keyed on the QID, never the artifactId — a re-import creates a new artifact row for the
 *     same question, so a set assembled last term points at the OLD row and an artifactId lookup would report
 *     "never used" exactly when it matters most;
 *   • a WITHDRAWN use is not a use (a paper deleted / an issue undone before results);
 *   • a SOURCE is counted once even if it reached several শাখা or lists the question twice — the teacher's
 *     question is "how many papers", not "how many rows";
 *   • the count is split into homework / assignment / class test (the bank badge, AL-3) and carries the kind;
 *   • the date is the day it was given, newest use first;
 *   • class and section names are resolved in batched queries, never one per row.
 */
import mongoose from "mongoose";

const mockAggregate = jest.fn();
const mockUseFind = jest.fn();
jest.mock("../modules/assessment/models/QuestionUse", () => ({
  QuestionUse: {
    aggregate: (p: unknown) => mockAggregate(p),
    find: (f: unknown) => ({ select: () => ({ lean: async () => mockUseFind(f) }) }),
  },
}));

const mockSetFind = jest.fn();
jest.mock("../modules/assessment/models/AssessmentSet", () => ({
  AssessmentSet: { find: (f: unknown) => ({ select: () => ({ lean: async () => mockSetFind(f) }) }) },
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
  mockUseFind.mockResolvedValue([]);
  mockSetFind.mockResolvedValue([]);
  mockClassFind.mockResolvedValue([{ _id: CLASS_ID, nameBn: "পঞ্চম শ্রেণি", level: 5 }]);
  mockSectionFind.mockResolvedValue([{ _id: SECTION_ID, nameBn: "সম্মিলিত", classId: CLASS_ID }]);
});

describe("questionUsageCounts — the badge", () => {
  test("keys on the QID, not the artifactId, and skips withdrawn uses", async () => {
    await questionUsageCounts(["QP-A", "QP-B"]);

    const pipeline = mockAggregate.mock.calls[0][0] as Record<string, unknown>[];
    const first = pipeline[0].$match as Record<string, unknown>;
    // The whole point: a re-import gives the same question a NEW artifactId, so the history
    // must hang off the qid or it reads as empty exactly when it matters.
    expect(first.qid).toEqual({ $in: ["QP-A", "QP-B"] });
    // A withdrawn use (paper deleted / issue undone) is not a use.
    expect(first.withdrawnAt).toBeNull();
    expect(JSON.stringify(pipeline)).not.toContain("artifactId");
  });

  test("counts SOURCES, not rows — one source listing a qid twice or reaching two শাখা counts once", async () => {
    await questionUsageCounts(["QP-A"]);
    const pipeline = mockAggregate.mock.calls[0][0] as Record<string, unknown>[];

    // The first $group is per (qid, kind, source); only the second sums.
    const groups = pipeline.filter((s) => "$group" in s);
    expect(groups).toHaveLength(2);
    expect((groups[0].$group as Record<string, unknown>)._id).toEqual({
      qid: "$qid", kind: "$kind", sourceType: "$sourceType", sourceId: "$sourceId",
    });
  });

  test("returns a map keyed by qid; an unused question is ABSENT, not zero", async () => {
    mockAggregate.mockResolvedValue([
      { _id: { qid: "QP-A", kind: "HW" }, n: 2 },
      { _id: { qid: "QP-A", kind: "CT" }, n: 1 },
      { _id: { qid: "QP-B", kind: "AS" }, n: 1 },
    ]);
    const m = await questionUsageCounts(["QP-A", "QP-B"]);
    expect(m.get("QP-A")).toBe(3);
    expect(m.get("QP-B")).toBe(1);
    expect(m.get("QP-C")).toBeUndefined();
  });

  test("AL-3: the badge splits homework (incl. extra) / assignment / class test; a re-test only moves the total", async () => {
    mockAggregate.mockResolvedValue([
      { _id: { qid: "QP-A", kind: "HW" }, n: 2 },
      { _id: { qid: "QP-A", kind: "EXTRA_HW" }, n: 1 },
      { _id: { qid: "QP-A", kind: "AS" }, n: 1 },
      { _id: { qid: "QP-A", kind: "CT" }, n: 1 },
      { _id: { qid: "QP-A", kind: "RETEST" }, n: 1 },
    ]);
    const m = await questionUsageByKind(["QP-A"]);
    expect(m.get("QP-A")).toEqual({ total: 6, hw: 3, as: 1, ct: 1 });
  });

  test("an empty or junk id list never reaches the database", async () => {
    expect((await questionUsageCounts([])).size).toBe(0);
    expect((await questionUsageCounts(["", ""])).size).toBe(0);
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  test("duplicate ids in the request are de-duplicated before querying", async () => {
    await questionUsageCounts(["QP-A", "QP-A", "QP-B"]);
    const first = (mockAggregate.mock.calls[0][0] as Record<string, unknown>[])[0].$match as Record<string, unknown>;
    expect(first.qid).toEqual({ $in: ["QP-A", "QP-B"] });
  });
});

describe("questionUsage — the list", () => {
  function use(over: Record<string, unknown> = {}) {
    return {
      kind: "HW",
      sourceType: "ASSESSMENT_SET",
      sourceId: new mongoose.Types.ObjectId(),
      sectionId: SECTION_ID,
      givenOn: "2026-08-01",
      ...over,
    };
  }

  test("resolves set, section and class names in batched queries, not one per row", async () => {
    mockUseFind.mockResolvedValue([use(), use(), use()]);
    await questionUsage("QP-A");
    expect(mockSetFind).toHaveBeenCalledTimes(1);
    expect(mockSectionFind).toHaveBeenCalledTimes(1);
    expect(mockClassFind).toHaveBeenCalledTimes(1);
  });

  test("the date is the day it was given; newest use first", async () => {
    mockUseFind.mockResolvedValue([use({ givenOn: "2026-01-01" }), use({ givenOn: "2026-08-30" })]);
    const rows = await questionUsage("QP-A");
    expect(rows.map((r) => r.usedOn)).toEqual(["2026-08-30T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
  });

  test("carries the kind; a set source shows the set's own name and type, a paper source falls back to the kind", async () => {
    const setId = new mongoose.Types.ObjectId();
    mockSetFind.mockResolvedValue([{ _id: setId, name: "ভগ্নাংশ অনুশীলন", setType: "CT", status: "assembled" }]);
    mockUseFind.mockResolvedValue([
      use({ kind: "CT", sourceId: setId, givenOn: "2026-08-30" }),
      use({ kind: "EXTRA_HW", sourceType: "MASTERY_PAPER", givenOn: "2026-08-01" }),
    ]);
    const rows = await questionUsage("QP-A");
    expect(rows[0]).toMatchObject({ kind: "CT", setName: "ভগ্নাংশ অনুশীলন", setType: "CT", status: "assembled", classLevel: 5, sectionName: "সম্মিলিত" });
    expect(rows[1]).toMatchObject({ kind: "EXTRA_HW", setName: null, setType: "EXTRA_HW", status: "given" });
  });

  test("a group-anchored test writes one row per member শাখা — two lines, one per শাখা; a repeat of the same line collapses", async () => {
    const setId = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    mockSectionFind.mockResolvedValue([
      { _id: SECTION_ID, nameBn: "ক", classId: CLASS_ID },
      { _id: other, nameBn: "খ", classId: CLASS_ID },
    ]);
    mockUseFind.mockResolvedValue([
      use({ kind: "CT", sourceId: setId }),
      use({ kind: "CT", sourceId: setId }),
      use({ kind: "CT", sourceId: setId, sectionId: other }),
    ]);
    const rows = await questionUsage("QP-A");
    expect(rows.map((r) => r.sectionName).sort()).toEqual(["ক", "খ"]);
  });

  test("the query is by qid, and a blank qid never reaches the database", async () => {
    await questionUsage("QP-A");
    expect((mockUseFind.mock.calls[0][0] as Record<string, unknown>).qid).toBe("QP-A");
    expect((mockUseFind.mock.calls[0][0] as Record<string, unknown>).withdrawnAt).toBeNull();

    mockUseFind.mockClear();
    expect(await questionUsage("")).toEqual([]);
    expect(await questionUsage("   ")).toEqual([]);
    expect(mockUseFind).not.toHaveBeenCalled();
  });
});
