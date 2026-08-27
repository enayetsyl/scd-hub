/**
 * Subject coverage for the review pipeline (QR-13, D-#567).
 *
 * The progress screen could say how the ASSIGNED work was going and nothing about how much
 * of the subject had been assigned at all — so a reviewer sitting at 13% looked identical
 * whether she had been handed the whole subject or a tenth of it.
 *
 * What these pin:
 *   • `assigned` and `reviewed` count DISTINCT QUESTIONS, not rounds — a question sent back
 *     for a second round must not count twice, and must never push assigned past the bank;
 *   • `notAssigned` is FLOORED at 0, because rounds outlive their question (retire,
 *     supersede) so `assigned` can legitimately exceed today's `inBank`, and a negative
 *     "not assigned" on a Principal's dashboard is worse than a zero;
 *   • the bank side excludes RETIRED and non-current rows — a retired question is not "in
 *     the bank" by any reading (D-#548/#566);
 *   • the chapter is matched in BOTH its number and string forms, because `address.number`
 *     is Mixed and older imports wrote it as a string (the D-#511 lesson, applied to a count).
 */
const mockArtifactCount = jest.fn();
jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    countDocuments: (f: unknown) => mockArtifactCount(f),
    find: () => ({ lean: async () => [] }),
    collection: { name: "contentartifacts" },
  },
}));

const mockAggregate = jest.fn();
jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    aggregate: (p: unknown) => mockAggregate(p),
    find: () => ({ lean: async () => [] }),
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

import { questionCoverage } from "../modules/questions/services/QuestionReviewService";

/** countDocuments is called twice: [0] = inBank, [1] = published. */
function bank(inBank: number, published: number): void {
  mockArtifactCount.mockReset();
  mockArtifactCount.mockResolvedValueOnce(inBank).mockResolvedValueOnce(published);
}
/** aggregate is called twice: [0] = distinct assigned, [1] = distinct reviewed. */
function rounds(assigned: number, reviewed: number): void {
  mockAggregate.mockReset();
  mockAggregate
    .mockResolvedValueOnce(assigned === 0 ? [] : [{ n: assigned }])
    .mockResolvedValueOnce(reviewed === 0 ? [] : [{ n: reviewed }]);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the arithmetic the screen shows", () => {
  test("notAssigned is the bank minus the distinct assigned questions", async () => {
    bank(3500, 415);
    rounds(3248, 428);

    const c = await questionCoverage({ subject: "BAN", classLevel: 5 });

    expect(c.inBank).toBe(3500);
    expect(c.assigned).toBe(3248);
    expect(c.notAssigned).toBe(252);
    expect(c.reviewed).toBe(428);
    expect(c.published).toBe(415);
  });

  test("nothing assigned yet → the whole bank is outstanding", async () => {
    bank(120, 0);
    rounds(0, 0);

    const c = await questionCoverage({ subject: "MATH", classLevel: 3 });
    expect(c.assigned).toBe(0);
    expect(c.notAssigned).toBe(120);
    expect(c.reviewed).toBe(0);
  });

  test("an empty aggregate counts as zero, never undefined", async () => {
    bank(10, 0);
    mockAggregate.mockReset();
    mockAggregate.mockResolvedValue([]);

    const c = await questionCoverage({});
    expect(c.assigned).toBe(0);
    expect(c.reviewed).toBe(0);
    expect(c.notAssigned).toBe(10);
  });

  test("notAssigned FLOORS at 0 when rounds outlive their questions", async () => {
    // Retiring or superseding a question leaves its rounds behind, so `assigned` can
    // exceed today's bank. A negative "not assigned" would be nonsense on a dashboard.
    bank(100, 10);
    rounds(140, 90);

    const c = await questionCoverage({ subject: "BAN", classLevel: 5 });
    expect(c.assigned).toBe(140);
    expect(c.notAssigned).toBe(0);
  });
});

describe("what counts as being in the bank", () => {
  test("retired and superseded rows are excluded, published is the same scope plus gold", async () => {
    bank(50, 20);
    rounds(10, 5);

    await questionCoverage({ subject: "BAN", classLevel: 5 });

    const inBankFilter = mockArtifactCount.mock.calls[0][0] as Record<string, unknown>;
    expect(inBankFilter.docType).toBe("question");
    expect(inBankFilter.current).toBe(true);
    expect(inBankFilter.retiredAt).toBeNull();
    expect(inBankFilter.reviewStatus).toBeUndefined();

    // `published` must be the SAME slice, only narrowed — otherwise the two numbers on the
    // strip would be describing different sets of questions.
    const publishedFilter = mockArtifactCount.mock.calls[1][0] as Record<string, unknown>;
    expect(publishedFilter.reviewStatus).toBe("gold");
    expect(publishedFilter.current).toBe(true);
    expect(publishedFilter.retiredAt).toBeNull();
    expect(publishedFilter.subject).toBe("BAN");
    expect(publishedFilter.classLevel).toBe(5);
  });

  test("the chapter is matched in BOTH number and string form", async () => {
    bank(5, 1);
    rounds(2, 1);

    await questionCoverage({ subject: "BAN", classLevel: 5, chapter: 23 });

    const f = mockArtifactCount.mock.calls[0][0] as Record<string, unknown>;
    // `address.number` is Mixed — older imports wrote "23", newer ones 23. Matching only
    // the number silently drops every older row and understates the bank.
    expect(f["address.number"]).toEqual({ $in: [23, "23"] });
  });

  test("no scope at all counts the whole question bank", async () => {
    bank(6901, 415);
    rounds(3248, 428);

    await questionCoverage({});
    const f = mockArtifactCount.mock.calls[0][0] as Record<string, unknown>;
    expect(f.subject).toBeUndefined();
    expect(f.classLevel).toBeUndefined();
    expect(f["address.number"]).toBeUndefined();
  });
});

describe("the round side counts questions, not rounds", () => {
  test("both aggregates group by qid before counting", async () => {
    bank(10, 2);
    rounds(4, 2);

    await questionCoverage({ subject: "BAN", classLevel: 5, chapter: 23 });

    for (const call of mockAggregate.mock.calls) {
      const pipeline = call[0] as Record<string, unknown>[];
      const group = pipeline.find((s) => "$group" in s);
      // Grouping on the qid is what makes a re-assigned question count once.
      expect((group!.$group as Record<string, unknown>)._id).toBe("$qid");
      expect(pipeline.some((s) => "$count" in s)).toBe(true);

      // The round carries the chapter as a STRING whatever the artifact used (QR-6).
      const match = pipeline[0].$match as Record<string, unknown>;
      expect(match.addressNumber).toBe("23");
      expect(match.subject).toBe("BAN");
    }
  });

  test("reviewed counts only rounds that actually carry a verdict", async () => {
    bank(10, 2);
    rounds(8, 3);

    await questionCoverage({ subject: "BAN" });

    const assignedMatch = (mockAggregate.mock.calls[0][0] as Record<string, unknown>[])[0].$match as Record<string, unknown>;
    const reviewedMatch = (mockAggregate.mock.calls[1][0] as Record<string, unknown>[])[0].$match as Record<string, unknown>;

    // "Assigned" is every round; "reviewed" is the subset that was ruled on.
    expect(assignedMatch.verdict).toBeUndefined();
    expect(reviewedMatch.verdict).toEqual({ $ne: null });
  });
});
