/**
 * The reviewer queue filter (QR-11, D-#559).
 *
 * One reviewer was handed 2,951 rounds with no way to narrow them while the Principal's
 * publish inbox got these axes in QR-6. What these pin:
 *
 *   • an UNFILTERED queue still takes the plain `find` it has always taken — no pipeline,
 *     no `$lookup`, so the common path cannot regress into an aggregate;
 *   • `subject`/`classLevel`/`chapter` are answered from the ROUND and never join;
 *   • `questionType`/`search`/`important` are the only axes that pay for the join;
 *   • `reviewerId` is cast to an ObjectId. `find()` casts a string against the schema and
 *     an aggregate pipeline does NOT — an uncast id matches zero rounds, which reads as
 *     "her queue is empty" rather than as a bug, and is the trap this whole slice risks;
 *   • the COUNT answers the same question the list does, or the pager says "৫০ / ২৯৫১"
 *     over a filtered list holding twelve rows.
 */
import mongoose from "mongoose";

const mockFind = jest.fn();
const mockAggregate = jest.fn().mockResolvedValue([]);
const mockCount = jest.fn().mockResolvedValue(0);

/** A chainable `find()` that records the filter it was handed. */
function chain(rows: unknown[] = []) {
  const c: Record<string, unknown> = {};
  for (const m of ["sort", "skip", "limit"]) c[m] = jest.fn(() => c);
  c.lean = jest.fn().mockResolvedValue(rows);
  return c;
}

jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    find: (f: unknown) => mockFind(f),
    aggregate: (p: unknown) => mockAggregate(p),
    countDocuments: (f: unknown) => mockCount(f),
    collection: { name: "reviewassignments" },
  },
}));

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    find: () => ({ lean: async () => [] }),
    collection: { name: "contentartifacts" },
  },
}));

jest.mock("../modules/foundation/models/User", () => ({
  User: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));

import {
  listMyQuestionReviews,
  countMyQuestionReviews,
  noReviewerFilter,
} from "../modules/questions/services/QuestionReviewService";

const REVIEWER = new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockFind.mockReturnValue(chain([]));
  mockAggregate.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
});

describe("an unfiltered queue is left exactly as it was", () => {
  test("no args → the plain find, never an aggregate", async () => {
    await listMyQuestionReviews(REVIEWER, {});
    expect(mockAggregate).not.toHaveBeenCalled();
    expect(mockFind).toHaveBeenCalledTimes(1);

    const filter = mockFind.mock.calls[0][0] as Record<string, unknown>;
    // The reviewer id stays a STRING here — mongoose casts it for find(). Changing this to
    // an ObjectId would be harmless, but the point is that this path is untouched.
    expect(filter.reviewerId).toBe(REVIEWER);
    expect(filter.status).toEqual({ $in: ["assigned", "submitted"] });
  });

  test("explicit falsey/empty args still count as unfiltered", () => {
    expect(noReviewerFilter({})).toBe(true);
    expect(noReviewerFilter({ subject: null, classLevel: null, search: "   " })).toBe(true);
    expect(noReviewerFilter({ important: false, undecided: false })).toBe(true);
  });

  test("any real axis makes it filtered", () => {
    expect(noReviewerFilter({ subject: "BAN" })).toBe(false);
    expect(noReviewerFilter({ classLevel: 5 })).toBe(false);
    expect(noReviewerFilter({ chapter: 23 })).toBe(false);
    expect(noReviewerFilter({ questionType: "mcq" })).toBe(false);
    expect(noReviewerFilter({ search: "ঢোকা" })).toBe(false);
    expect(noReviewerFilter({ important: true })).toBe(false);
    expect(noReviewerFilter({ undecided: true })).toBe(false);
  });
});

describe("round-level axes never touch the artifact", () => {
  test("subject + class + chapter use find(), with NO join", async () => {
    await listMyQuestionReviews(REVIEWER, {}, { subject: "BAN", classLevel: 5, chapter: 23 });

    expect(mockAggregate).not.toHaveBeenCalled();
    const filter = mockFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.subject).toBe("BAN");
    expect(filter.classLevel).toBe(5);
    // The round stores the chapter as a STRING whatever the artifact used (QR-6).
    expect(filter.addressNumber).toBe("23");
  });

  test("the reviewer id is an ObjectId on the filtered path", async () => {
    await listMyQuestionReviews(REVIEWER, {}, { subject: "BAN" });
    const filter = mockFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.reviewerId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(String(filter.reviewerId)).toBe(REVIEWER);
  });

  test("undecided narrows to rounds with no verdict yet", async () => {
    await listMyQuestionReviews(REVIEWER, {}, { undecided: true });
    const filter = mockFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.status).toBe("assigned");
  });

  test("without undecided, decided rounds stay in the list", async () => {
    await listMyQuestionReviews(REVIEWER, {}, { subject: "BAN" });
    const filter = mockFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.status).toEqual({ $in: ["assigned", "submitted"] });
  });
});

describe("only the payload axes pay for a join", () => {
  test("questionType goes through the aggregate", async () => {
    await listMyQuestionReviews(REVIEWER, {}, { questionType: "mcq" });
    expect(mockAggregate).toHaveBeenCalledTimes(1);

    const pipeline = mockAggregate.mock.calls[0][0] as Record<string, unknown>[];
    const match = pipeline.find((s) => "$match" in s && "art.envelopeJson.payload.question_type" in (s.$match as object));
    expect(match).toBeDefined();
    // The reviewer id must survive into the pipeline as an ObjectId, or the $match drops
    // every row and her queue silently reads as empty.
    const first = pipeline[0].$match as Record<string, unknown>;
    expect(first.reviewerId).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  test("important filters on the artifact's mark, from the SAME join", async () => {
    await listMyQuestionReviews(REVIEWER, {}, { important: true });

    const pipeline = mockAggregate.mock.calls[0][0] as Record<string, unknown>[];
    const joined = JSON.stringify(pipeline);
    expect(joined).toContain("art.importantAt");
    // One lookup, not two — importantAt is projected alongside envelopeJson.
    expect(pipeline.filter((s) => "$lookup" in s)).toHaveLength(1);
  });

  test("search matches question text OR qid, and escapes regex metacharacters", async () => {
    await listMyQuestionReviews(REVIEWER, {}, { search: "a.b*c" });

    const pipeline = mockAggregate.mock.calls[0][0] as Record<string, unknown>[];
    const match = pipeline.find((s) => "$match" in s && "$or" in (s.$match as object));
    const or = (match!.$match as Record<string, unknown>).$or as Record<string, RegExp>[];
    expect(Object.keys(or[0])[0]).toBe("art.envelopeJson.payload.question_text");
    expect(Object.keys(or[1])[0]).toBe("art.envelopeJson.payload.qid");
    // A literal dot/star must not become a wildcard — otherwise a qid search matches half
    // the bank and the reviewer cannot find the one question she is looking for.
    expect(or[0]["art.envelopeJson.payload.question_text"].source).toBe("a\\.b\\*c");
  });
});

describe("the count answers the same question as the list", () => {
  test("unfiltered → the plain countDocuments", async () => {
    await countMyQuestionReviews(REVIEWER);
    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  test("a round-level filter is counted with the SAME match the list uses", async () => {
    await countMyQuestionReviews(REVIEWER, { subject: "BAN", undecided: true });

    const filter = mockCount.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.subject).toBe("BAN");
    expect(filter.status).toBe("assigned");
    expect(filter.reviewerId).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  test("a payload filter is counted through the join, not guessed", async () => {
    mockAggregate.mockResolvedValue([{ n: 12 }]);
    const n = await countMyQuestionReviews(REVIEWER, { important: true });

    expect(n).toBe(12);
    const pipeline = mockAggregate.mock.calls[0][0] as Record<string, unknown>[];
    expect(pipeline.some((s) => "$count" in s)).toBe(true);
  });

  test("an empty aggregate result counts as zero, not undefined", async () => {
    mockAggregate.mockResolvedValue([]);
    await expect(countMyQuestionReviews(REVIEWER, { important: true })).resolves.toBe(0);
  });
});
