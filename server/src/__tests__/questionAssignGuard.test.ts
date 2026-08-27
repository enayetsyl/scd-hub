/**
 * Assigning a question that is already spoken for (QR-14, D-#569).
 *
 * `assignQuestionReview` supersedes any open round before creating its own, so re-assigning
 * SILENTLY cancelled the previous reviewer's round: one stray tap on the per-question picker
 * discarded work in progress and her queue just quietly shrank. `assignQuestionReviewByChapter`
 * has skipped these three cases since it shipped and reports the counts; the single/bulk
 * picker showed a warning badge instead — information where a refusal belonged.
 *
 * The waiver is the delicate part. Two callers legitimately re-round a question and MUST keep
 * working:
 *   • `assignQuestionReviewByChapter`, which pre-filters into `eligible` and reports skips;
 *   • `clearQuestionCondition`, whose whole job is a fresh round on a question whose latest
 *     round is a submitted APPROVE_WITH_CONDITION.
 * A guard that broke either would be worse than the bug it fixes, so both are pinned here.
 */
import mongoose from "mongoose";

const mockFindById = jest.fn();
jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    findById: (id: unknown) => ({ lean: async () => mockFindById(id) }),
    find: () => ({ lean: async () => [] }),
    collection: { name: "contentartifacts" },
  },
}));

const mockRoundCount = jest.fn().mockResolvedValue(0);
const mockRoundCreate = jest.fn();
const mockRoundFind = jest.fn().mockReturnValue({
  sort: () => ({ limit: () => ({ lean: async () => [] }) }),
  select: () => ({ lean: async () => [] }),
  lean: async () => [],
});
const mockRoundUpdateMany = jest.fn().mockResolvedValue({});
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    countDocuments: (f: unknown) => mockRoundCount(f),
    create: (d: unknown) => mockRoundCreate(d),
    find: (f: unknown) => mockRoundFind(f),
    updateMany: (f: unknown, u: unknown) => mockRoundUpdateMany(f, u),
    aggregate: async () => [],
    collection: { name: "reviewassignments" },
  },
}));

jest.mock("../modules/foundation/models/User", () => ({
  User: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));

jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: jest.fn().mockResolvedValue(undefined),
  writeAuditMany: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../modules/notifications/services/emitters", () => ({
  emitQuestionReviewAssigned: jest.fn().mockResolvedValue(undefined),
}));

import { assignQuestionReview } from "../modules/questions/services/QuestionReviewService";
import { ReviewError } from "../modules/content/services/ReviewService";

const ARTIFACT_ID = new mongoose.Types.ObjectId();
const REVIEWER = new mongoose.Types.ObjectId().toString();
const ACTOR = new mongoose.Types.ObjectId().toString();

function question(over: Record<string, unknown> = {}) {
  return {
    _id: ARTIFACT_ID,
    docType: "question",
    subject: "BAN",
    classLevel: 5,
    address: { anchorWord: "U23", number: 23 },
    reviewStatus: "draft",
    current: true,
    envelopeJson: { payload: { qid: "QP-BAN-C5-U23-Q001" } },
    ...over,
  };
}

const call = (extra: Record<string, unknown> = {}) =>
  assignQuestionReview({
    artifactId: ARTIFACT_ID.toString(),
    reviewerId: REVIEWER,
    assignedBy: ACTOR,
    actorRole: "PRINCIPAL",
    ...extra,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRoundCount.mockResolvedValue(0);
  // A full-enough round: `decorate()` runs after create and reads these off it.
  mockRoundCreate.mockResolvedValue({
    _id: new mongoose.Types.ObjectId(),
    artifactId: ARTIFACT_ID,
    reviewerId: new mongoose.Types.ObjectId(REVIEWER),
    assignedBy: new mongoose.Types.ObjectId(ACTOR),
    qid: "QP-BAN-C5-U23-Q001",
    docType: "question",
    subject: "BAN",
    classLevel: 5,
    anchorWord: "U23",
    addressNumber: "23",
    assignedAt: new Date(),
    roundNumber: 1,
    status: "assigned",
    verdict: null,
    feedback: null,
    submittedAt: null,
  });
  mockRoundFind.mockReturnValue({
    sort: () => ({ limit: () => ({ lean: async () => [] }) }),
    select: () => ({ lean: async () => [] }),
    lean: async () => [],
  });
});

describe("a question already spoken for is refused", () => {
  test("one already assigned to a reviewer", async () => {
    mockFindById.mockResolvedValue(question());
    mockRoundCount.mockResolvedValue(1); // an open round exists

    await expect(call()).rejects.toBeInstanceOf(ReviewError);
    await expect(call()).rejects.toThrow(/already assigned/i);

    // Refused BEFORE anything is written — the existing round must survive intact.
    expect(mockRoundCreate).not.toHaveBeenCalled();
    expect(mockRoundUpdateMany).not.toHaveBeenCalled();
  });

  test("one already REVIEWED and waiting to be published", async () => {
    mockFindById.mockResolvedValue(question({ reviewStatus: "reviewed" }));

    await expect(call()).rejects.toThrow(/already been reviewed/i);
    expect(mockRoundCreate).not.toHaveBeenCalled();
    // The reviewStatus check must not even need to look for a round.
    expect(mockRoundCount).not.toHaveBeenCalled();
  });

  test("one already published", async () => {
    mockFindById.mockResolvedValue(question({ reviewStatus: "gold" }));

    await expect(call()).rejects.toThrow(/already published/i);
    expect(mockRoundCreate).not.toHaveBeenCalled();
  });

  test("the open-round lookup asks for OPEN rounds only", async () => {
    mockFindById.mockResolvedValue(question());
    mockRoundCount.mockResolvedValue(0);

    await call();

    const filter = mockRoundCount.mock.calls[0][0] as Record<string, unknown>;
    // A closed or superseded round must not keep a question hostage forever.
    expect(filter.status).toEqual({ $in: ["assigned", "submitted"] });
  });
});

describe("a free question still assigns", () => {
  test("no open round, still a draft → the round is created", async () => {
    mockFindById.mockResolvedValue(question());
    mockRoundCount.mockResolvedValue(0);

    await call();
    expect(mockRoundCreate).toHaveBeenCalledTimes(1);
    const created = mockRoundCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(String(created.reviewerId)).toBe(REVIEWER);
    expect(created.status).toBe("assigned");
  });
});

describe("the waiver keeps the two legitimate re-rounds working", () => {
  test("allowReassign bypasses an open round — the clearQuestionCondition path", async () => {
    mockFindById.mockResolvedValue(question());
    mockRoundCount.mockResolvedValue(1); // the submitted APPROVE_WITH_CONDITION round

    await expect(call({ allowReassign: true })).resolves.toBeDefined();
    expect(mockRoundCreate).toHaveBeenCalledTimes(1);
  });

  test("allowReassign bypasses a REVIEWED status too", async () => {
    // A condition-cleared question can carry `reviewed`; the re-round must still open.
    mockFindById.mockResolvedValue(question({ reviewStatus: "reviewed" }));

    await expect(call({ allowReassign: true })).resolves.toBeDefined();
    expect(mockRoundCreate).toHaveBeenCalledTimes(1);
  });

  test("without the waiver the SAME question is refused — the waiver is doing the work", async () => {
    mockFindById.mockResolvedValue(question({ reviewStatus: "reviewed" }));
    await expect(call()).rejects.toThrow(/already been reviewed/i);
  });
});
