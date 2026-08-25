/**
 * The publish inbox gains filters, pagination and publish-all (QR-6, D-#538).
 *
 * The claim worth protecting is that ONE filter builder feeds the list, its count and
 * publish-all. `gold` is a one-way door — nothing in the service demotes a published
 * question — so if the three could disagree about what "all of them" means, the confirmation
 * would quote one number and a different set would publish, irreversibly.
 *
 * These assert on the QUERY, in the style of questionReviewPaging.test.ts.
 */
import mongoose from "mongoose";

const chain = {
  sort: jest.fn(), skip: jest.fn(), limit: jest.fn(), select: jest.fn(), lean: jest.fn(),
};
chain.sort.mockReturnValue(chain);
chain.skip.mockReturnValue(chain);
chain.limit.mockReturnValue(chain);
chain.select.mockReturnValue(chain);
chain.lean.mockResolvedValue([]);

const mockFind = jest.fn((_q: unknown) => chain);
const mockCount = jest.fn((_q: unknown) => Promise.resolve(0));
const mockAggregate = jest.fn((_p: unknown) => Promise.resolve([] as unknown[]));
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    find: (q: unknown) => mockFind(q),
    countDocuments: (q: unknown) => mockCount(q),
    aggregate: (p: unknown) => mockAggregate(p),
  },
}));

const mockArtifactFind = jest.fn(() => ({ lean: async () => [] }));
const mockFindById = jest.fn((_id: unknown) => Promise.resolve(null));
jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    find: () => mockArtifactFind(),
    findById: (id: unknown) => mockFindById(id),
    collection: { name: "contentartifacts" },
  },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn() }));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitQuestionReviewAssigned: jest.fn(),
}));

import {
  questionReviewInbox,
  countQuestionReviewInbox,
  publishQuestionsMatching,
  INBOX_PAGE,
  PUBLISH_ALL_MAX,
} from "../modules/questions/services/QuestionReviewService";
import { ReviewError } from "../modules/content/services/ReviewService";

const ACTOR = new mongoose.Types.ObjectId().toString();

/** Pull the $match / $lookup stages out of whatever pipeline was handed to Mongo. */
function stages(call = 0) {
  const p = mockAggregate.mock.calls[call][0] as Record<string, unknown>[];
  return {
    all: p,
    match: p.find((s) => "$match" in s) as { $match: Record<string, unknown> },
    lookup: p.find((s) => "$lookup" in s) as
      | { $lookup: { from: string; localField: string } }
      | undefined,
    joinMatch: p.filter((s) => "$match" in s)[1] as
      | { $match: Record<string, unknown> }
      | undefined,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.lean.mockResolvedValue([]);
  mockAggregate.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
});

describe("questionReviewInbox — filters", () => {
  test("the round-level axes never touch ContentArtifact", async () => {
    // subject, classLevel and the chapter are denormalised onto the round, so filtering on
    // them must stay a plain find. A needless $lookup here would join every submitted round
    // in the school to its artifact to answer a question the round already answers.
    await questionReviewInbox({ verdict: "APPROVE", subject: "BAN", classLevel: 5, chapter: 23 });
    expect(mockAggregate).not.toHaveBeenCalled();
    expect(mockFind).toHaveBeenCalledWith({
      docType: "question",
      status: "submitted",
      verdict: "APPROVE",
      subject: "BAN",
      classLevel: 5,
      addressNumber: "23",
    });
  });

  test("the chapter is matched as a STRING, the form the round stores", async () => {
    await questionReviewInbox({ chapter: 7 });
    const f = mockFind.mock.calls[0][0] as Record<string, unknown>;
    expect(f.addressNumber).toBe("7");
  });

  test("questionType reaches into the payload, so it joins — and only then", async () => {
    await questionReviewInbox({ verdict: "APPROVE", questionType: "mcq" });
    expect(mockFind).not.toHaveBeenCalled();
    const s = stages();
    expect(s.match.$match).toMatchObject({ status: "submitted", verdict: "APPROVE" });
    expect(s.lookup?.$lookup.from).toBe("contentartifacts");
    expect(s.lookup?.$lookup.localField).toBe("artifactId");
    expect(s.joinMatch?.$match).toEqual({
      "art.envelopeJson.payload.question_type": "mcq",
    });
  });

  test("search matches question text OR qid, and escapes regex metacharacters", async () => {
    await questionReviewInbox({ search: "a.b*c" });
    const or = stages().joinMatch?.$match.$or as { [k: string]: RegExp }[];
    expect(or).toHaveLength(2);
    const re = or[0]["art.envelopeJson.payload.question_text"];
    // Escaped: it must look for the literal string, not treat "." and "*" as a pattern.
    expect(re.source).toBe("a\\.b\\*c");
    expect(re.test("xxAyyB")).toBe(false);
    expect(re.test("a.b*c")).toBe(true);
  });

  test("a whitespace-only search is not a filter", async () => {
    await questionReviewInbox({ search: "   " });
    expect(mockAggregate).not.toHaveBeenCalled();
    expect(mockFind).toHaveBeenCalled();
  });

  test("an unfiltered call pins nothing but docType and status", async () => {
    await questionReviewInbox({});
    expect(mockFind).toHaveBeenCalledWith({ docType: "question", status: "submitted" });
  });

  test("an unknown verdict is refused rather than silently listing everything", async () => {
    await expect(questionReviewInbox({ verdict: "APPROVED" })).rejects.toBeInstanceOf(ReviewError);
    expect(mockFind).not.toHaveBeenCalled();
  });
});

describe("questionReviewInbox — paging", () => {
  test("an old client that sends no limit gets ONE PAGE, not the whole inbox", async () => {
    // This read was unbounded. The installed APK sends neither argument and must degrade to
    // "the first 50" rather than to the response shape that froze the reviewer queue.
    await questionReviewInbox({ verdict: "APPROVE" });
    expect(chain.limit).toHaveBeenCalledWith(INBOX_PAGE);
    expect(chain.skip).toHaveBeenCalledWith(0);
  });

  test("caps the page and refuses a nonsensical one", async () => {
    await questionReviewInbox({}, { limit: 100000 });
    expect(chain.limit).toHaveBeenCalledWith(200);
    jest.clearAllMocks();
    chain.sort.mockReturnValue(chain); chain.skip.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain); chain.lean.mockResolvedValue([]);
    await questionReviewInbox({}, { limit: 0, offset: -3 });
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(chain.skip).toHaveBeenCalledWith(0);
  });

  test("sorts with a stable final key on both the joined and unjoined paths", async () => {
    await questionReviewInbox({});
    expect(chain.sort).toHaveBeenCalledWith({ submittedAt: -1, _id: 1 });
    await questionReviewInbox({ questionType: "mcq" });
    const sortStage = stages().all.find((s) => "$sort" in s) as { $sort: unknown };
    expect(sortStage.$sort).toEqual({ submittedAt: -1, _id: 1 });
  });
});

describe("countQuestionReviewInbox", () => {
  test("counts through the SAME filter the list uses", async () => {
    const filter = { verdict: "APPROVE", subject: "BAN", classLevel: 5 };
    await questionReviewInbox(filter);
    await countQuestionReviewInbox(filter);
    expect(mockCount.mock.calls[0][0]).toEqual(mockFind.mock.calls[0][0]);
  });

  test("counts through the join when the filter needs one", async () => {
    await countQuestionReviewInbox({ questionType: "mcq" });
    expect(mockCount).not.toHaveBeenCalled();
    expect(stages().all.some((s) => "$count" in s)).toBe(true);
  });
});

describe("publishQuestionsMatching", () => {
  test("refuses anything but APPROVE — an override reason is per question", async () => {
    // Publishing a rejected question needs its own written reason (D-#525), so a bulk call
    // over rejected rounds could only fail every item. Refusing says so once.
    await expect(
      publishQuestionsMatching({ filter: { verdict: "CHANGES_REQUESTED" }, actorId: ACTOR }),
    ).rejects.toBeInstanceOf(ReviewError);
    await expect(
      publishQuestionsMatching({ filter: {}, actorId: ACTOR }),
    ).rejects.toBeInstanceOf(ReviewError);
    expect(mockFind).not.toHaveBeenCalled();
  });

  test("selects through the SAME filter the confirmation counted", async () => {
    // The number quoted and the set published must come from one builder — for a one-way
    // operation, a mismatch is not a cosmetic bug.
    const filter = { verdict: "APPROVE", subject: "BAN", classLevel: 5, chapter: 23 };
    mockCount.mockResolvedValue(3);
    await publishQuestionsMatching({ filter, actorId: ACTOR });
    const selectFilter = mockFind.mock.calls[0][0];
    jest.clearAllMocks();
    chain.sort.mockReturnValue(chain); chain.skip.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain); chain.select.mockReturnValue(chain);
    chain.lean.mockResolvedValue([]);
    await questionReviewInbox(filter);
    expect(selectFilter).toEqual(mockFind.mock.calls[0][0]);
  });

  test("never publishes more than the per-call ceiling", async () => {
    await publishQuestionsMatching({ filter: { verdict: "APPROVE" }, actorId: ACTOR });
    expect(chain.limit).toHaveBeenCalledWith(PUBLISH_ALL_MAX);
  });

  test("reports what is left rather than silently stopping short", async () => {
    const ids = Array.from({ length: 4 }, () => ({ artifactId: new mongoose.Types.ObjectId() }));
    chain.lean.mockResolvedValue(ids);
    mockCount.mockResolvedValue(9);
    // Every publish fails (findById returns null → "Artifact not found"), which is fine:
    // this asserts the arithmetic, and okCount 0 means nothing was published.
    const res = await publishQuestionsMatching({ filter: { verdict: "APPROVE" }, actorId: ACTOR });
    expect(res.okCount).toBe(0);
    expect(res.failedCount).toBe(4);
    expect(res.remaining).toBe(9);
  });

  test("deduplicates artifact ids before publishing", async () => {
    const shared = new mongoose.Types.ObjectId();
    chain.lean.mockResolvedValue([{ artifactId: shared }, { artifactId: shared }]);
    mockCount.mockResolvedValue(2);
    const res = await publishQuestionsMatching({ filter: { verdict: "APPROVE" }, actorId: ACTOR });
    expect(res.okCount + res.failedCount).toBe(1);
  });
});
