/**
 * PR-1 tests — plan-review/approval loop (D-#38/#39/#40).
 *
 * Pure helpers (isPlanDocType, advanceOnApprove, addressKeyOf) are exercised directly.
 * Service functions (assign/submit/cancel + reviewer read-override) run with mocked
 * Mongoose models — DB-free, like homework.test.ts.
 *
 * Journeys: R1.1 assign, R1.2 one-open-round/supersede, R1.3 read-override,
 *           R1.4 submit (assigned-reviewer-only), R1.5 APPROVE→draft→reviewed, R1.6 cancel.
 */
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Mocks (declared before importing the service under test)
// ---------------------------------------------------------------------------

const mockArtifactFindById = jest.fn();
const mockReviewCreate = jest.fn();
const mockReviewFind = jest.fn();
const mockReviewFindById = jest.fn();
const mockReviewFindOne = jest.fn();
const mockReviewUpdateOne = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    findById: (id: unknown) => mockArtifactFindById(id),
  },
}));

jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    create: (a: unknown) => mockReviewCreate(a),
    find: (f: unknown) => mockReviewFind(f),
    findById: (id: unknown) => mockReviewFindById(id),
    findOne: (f: unknown) => mockReviewFindOne(f),
    updateOne: (f: unknown, u: unknown) => mockReviewUpdateOne(f, u),
  },
}));

jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

// Import AFTER mocks
import {
  isPlanDocType,
  advanceOnApprove,
  addressKeyOf,
  assignPlanReview,
  submitPlanReview,
  cancelPlanReview,
  reviewerMayReadArtifact,
  ReviewError,
} from "../modules/content/services/ReviewService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ARTIFACT_ID = new mongoose.Types.ObjectId();
const REVIEWER_ID = new mongoose.Types.ObjectId();
const OTHER_TEACHER_ID = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();
const ASSIGNMENT_ID = new mongoose.Types.ObjectId();

function planArtifact(over: Record<string, unknown> = {}) {
  return {
    _id: ARTIFACT_ID,
    docType: "chapter_plan",
    subject: "BAN",
    classLevel: 3,
    address: { anchorWord: "পাঠ", number: 5, title: "Ch 5" },
    reviewStatus: "draft",
    ...over,
  };
}

/** A chainable query stub whose terminal .lean() resolves to `result`. */
function query(result: unknown) {
  const c: Record<string, unknown> = {};
  c.sort = () => c;
  c.limit = () => c;
  c.select = () => c;
  c.lean = () => Promise.resolve(result);
  return c;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("pure helpers", () => {
  test("isPlanDocType — plans only", () => {
    expect(isPlanDocType("chapter_plan")).toBe(true);
    expect(isPlanDocType("session_plan")).toBe(true);
    expect(isPlanDocType("question")).toBe(false);
    expect(isPlanDocType("stimulus")).toBe(false);
    expect(isPlanDocType("question_set")).toBe(false);
  });

  test("advanceOnApprove — only draft→reviewed; reviewed/gold unchanged (R1.5)", () => {
    expect(advanceOnApprove("draft")).toBe("reviewed");
    expect(advanceOnApprove("reviewed")).toBeNull();
    expect(advanceOnApprove("gold")).toBeNull();
  });

  test("addressKeyOf — version-stable key, number stringified", () => {
    expect(addressKeyOf(planArtifact())).toEqual({
      docType: "chapter_plan",
      subject: "BAN",
      classLevel: 3,
      anchorWord: "পাঠ",
      addressNumber: "5",
    });
  });
});

// ---------------------------------------------------------------------------
// assignPlanReview (R1.1, R1.2)
// ---------------------------------------------------------------------------

describe("assignPlanReview", () => {
  function setupCreate(roundNumber = 1) {
    mockReviewCreate.mockImplementation((doc: Record<string, unknown>) =>
      Promise.resolve({
        _id: ASSIGNMENT_ID,
        assignedAt: new Date("2026-06-11T09:00:00Z"),
        verdict: undefined,
        feedback: undefined,
        submittedAt: undefined,
        ...doc,
        roundNumber,
      }),
    );
  }

  test("R1.1 happy path — creates round 1, audits REVIEW_ASSIGNED", async () => {
    mockArtifactFindById.mockReturnValue(query(planArtifact()));
    mockReviewFind.mockReturnValueOnce(query([])).mockReturnValueOnce(query([])); // no open, no prior
    setupCreate(1);

    const dto = await assignPlanReview({
      artifactId: ARTIFACT_ID.toString(),
      reviewerId: REVIEWER_ID.toString(),
      assignedBy: ADMIN_ID.toString(),
      actorRole: "PRINCIPAL",
    });

    expect(dto.roundNumber).toBe(1);
    expect(dto.status).toBe("assigned");
    expect(dto.subject).toBe("BAN");
    expect(dto.addressNumber).toBe("5");
    expect(mockReviewUpdateOne).not.toHaveBeenCalled(); // nothing to supersede
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "REVIEW_ASSIGNED" }),
    );
  });

  test("R1.2 supersedes an open round + bumps roundNumber", async () => {
    const openRound = { _id: new mongoose.Types.ObjectId(), roundNumber: 1, status: "submitted" };
    mockArtifactFindById.mockReturnValue(query(planArtifact()));
    mockReviewFind
      .mockReturnValueOnce(query([openRound])) // open rounds
      .mockReturnValueOnce(query([{ roundNumber: 1 }])); // latest
    mockReviewUpdateOne.mockResolvedValue({ acknowledged: true });
    setupCreate(2);

    const dto = await assignPlanReview({
      artifactId: ARTIFACT_ID.toString(),
      reviewerId: OTHER_TEACHER_ID.toString(),
      assignedBy: ADMIN_ID.toString(),
      actorRole: "OFFICE",
    });

    expect(mockReviewUpdateOne).toHaveBeenCalledWith(
      { _id: openRound._id },
      { $set: { status: "superseded" } },
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "REVIEW_CANCELLED", meta: { reason: "superseded_by_new_round" } }),
    );
    expect(dto.roundNumber).toBe(2);
  });

  test("rejects a non-plan docType", async () => {
    mockArtifactFindById.mockReturnValue(query(planArtifact({ docType: "question" })));
    await expect(
      assignPlanReview({
        artifactId: ARTIFACT_ID.toString(),
        reviewerId: REVIEWER_ID.toString(),
        assignedBy: ADMIN_ID.toString(),
      }),
    ).rejects.toThrow(ReviewError);
    expect(mockReviewCreate).not.toHaveBeenCalled();
  });

  test("rejects a missing artifact", async () => {
    mockArtifactFindById.mockReturnValue(query(null));
    await expect(
      assignPlanReview({
        artifactId: ARTIFACT_ID.toString(),
        reviewerId: REVIEWER_ID.toString(),
        assignedBy: ADMIN_ID.toString(),
      }),
    ).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// submitPlanReview (R1.4, R1.5)
// ---------------------------------------------------------------------------

describe("submitPlanReview", () => {
  function assignmentDoc(over: Record<string, unknown> = {}) {
    return {
      _id: ASSIGNMENT_ID,
      docType: "chapter_plan",
      subject: "BAN",
      classLevel: 3,
      anchorWord: "পাঠ",
      addressNumber: "5",
      artifactId: ARTIFACT_ID,
      reviewerId: REVIEWER_ID,
      assignedBy: ADMIN_ID,
      assignedAt: new Date("2026-06-11T09:00:00Z"),
      roundNumber: 1,
      status: "assigned",
      verdict: undefined as string | undefined,
      feedback: undefined as string | undefined,
      submittedAt: undefined as Date | undefined,
      save: jest.fn().mockResolvedValue(true),
      ...over,
    };
  }

  test("R1.5 APPROVE on a draft plan advances reviewStatus draft→reviewed", async () => {
    const assignment = assignmentDoc();
    const artifact = { ...planArtifact(), save: jest.fn().mockResolvedValue(true) };
    mockReviewFindById.mockResolvedValue(assignment);
    mockArtifactFindById.mockReturnValue(artifact); // submit path awaits the doc directly

    const dto = await submitPlanReview({
      assignmentId: ASSIGNMENT_ID.toString(),
      reviewerId: REVIEWER_ID.toString(),
      verdict: "APPROVE",
    });

    expect(artifact.reviewStatus).toBe("reviewed");
    expect(artifact.save).toHaveBeenCalled();
    expect(assignment.status).toBe("submitted");
    expect(dto.verdict).toBe("APPROVE");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "REVIEW_SUBMITTED", meta: expect.objectContaining({ advancedTo: "reviewed" }) }),
    );
  });

  test("APPROVE on an already-reviewed plan does not change status", async () => {
    const assignment = assignmentDoc();
    const artifact = { ...planArtifact({ reviewStatus: "reviewed" }), save: jest.fn() };
    mockReviewFindById.mockResolvedValue(assignment);
    mockArtifactFindById.mockReturnValue(artifact);

    await submitPlanReview({
      assignmentId: ASSIGNMENT_ID.toString(),
      reviewerId: REVIEWER_ID.toString(),
      verdict: "APPROVE",
    });

    expect(artifact.reviewStatus).toBe("reviewed");
    expect(artifact.save).not.toHaveBeenCalled();
  });

  test("CHANGES_REQUESTED records feedback, leaves reviewStatus untouched", async () => {
    const assignment = assignmentDoc();
    mockReviewFindById.mockResolvedValue(assignment);
    // artifact never loaded on a non-APPROVE verdict

    const dto = await submitPlanReview({
      assignmentId: ASSIGNMENT_ID.toString(),
      reviewerId: REVIEWER_ID.toString(),
      verdict: "CHANGES_REQUESTED",
      feedback: "Lesson 5 objectives need measurable verbs.",
    });

    expect(dto.verdict).toBe("CHANGES_REQUESTED");
    expect(dto.feedback).toMatch(/measurable verbs/);
    expect(mockArtifactFindById).not.toHaveBeenCalled();
  });

  test("R4.2 a non-assigned teacher cannot submit (FORBIDDEN)", async () => {
    mockReviewFindById.mockResolvedValue(assignmentDoc());
    await expect(
      submitPlanReview({
        assignmentId: ASSIGNMENT_ID.toString(),
        reviewerId: OTHER_TEACHER_ID.toString(), // not the assignee
        verdict: "APPROVE",
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  test("CHANGES_REQUESTED without feedback is rejected", async () => {
    mockReviewFindById.mockResolvedValue(assignmentDoc());
    await expect(
      submitPlanReview({
        assignmentId: ASSIGNMENT_ID.toString(),
        reviewerId: REVIEWER_ID.toString(),
        verdict: "CHANGES_REQUESTED",
      }),
    ).rejects.toThrow(/feedback is required/i);
  });

  test("cannot submit a round that is not open", async () => {
    mockReviewFindById.mockResolvedValue(assignmentDoc({ status: "submitted" }));
    await expect(
      submitPlanReview({
        assignmentId: ASSIGNMENT_ID.toString(),
        reviewerId: REVIEWER_ID.toString(),
        verdict: "APPROVE",
      }),
    ).rejects.toThrow(/not open/i);
  });

  test("unknown verdict is rejected", async () => {
    mockReviewFindById.mockResolvedValue(assignmentDoc());
    await expect(
      submitPlanReview({
        assignmentId: ASSIGNMENT_ID.toString(),
        reviewerId: REVIEWER_ID.toString(),
        verdict: "MAYBE",
      }),
    ).rejects.toThrow(/Unknown verdict/);
  });
});

// ---------------------------------------------------------------------------
// cancelPlanReview (R1.6) + read-override (R1.3)
// ---------------------------------------------------------------------------

describe("cancelPlanReview", () => {
  test("cancels an open round + audits", async () => {
    const assignment = {
      _id: ASSIGNMENT_ID,
      artifactId: ARTIFACT_ID,
      reviewerId: REVIEWER_ID,
      assignedBy: ADMIN_ID,
      assignedAt: new Date("2026-06-11T09:00:00Z"),
      roundNumber: 1,
      status: "assigned",
      docType: "chapter_plan",
      subject: "BAN",
      classLevel: 3,
      anchorWord: "পাঠ",
      addressNumber: "5",
      save: jest.fn().mockResolvedValue(true),
    };
    mockReviewFindById.mockResolvedValue(assignment);

    const dto = await cancelPlanReview({ assignmentId: ASSIGNMENT_ID.toString(), actorId: ADMIN_ID.toString() });

    expect(assignment.status).toBe("cancelled");
    expect(dto.status).toBe("cancelled");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "REVIEW_CANCELLED" }),
    );
  });

  test("cannot cancel an already-superseded round", async () => {
    mockReviewFindById.mockResolvedValue({ status: "superseded", save: jest.fn() });
    await expect(
      cancelPlanReview({ assignmentId: ASSIGNMENT_ID.toString(), actorId: ADMIN_ID.toString() }),
    ).rejects.toThrow(/cannot be cancelled/i);
  });
});

describe("reviewerMayReadArtifact (R1.3)", () => {
  test("true when an active round exists for this reviewer + artifact", async () => {
    mockReviewFindOne.mockReturnValue(query({ _id: ASSIGNMENT_ID }));
    expect(await reviewerMayReadArtifact(REVIEWER_ID.toString(), ARTIFACT_ID)).toBe(true);
  });

  test("false when no active round", async () => {
    mockReviewFindOne.mockReturnValue(query(null));
    expect(await reviewerMayReadArtifact(OTHER_TEACHER_ID.toString(), ARTIFACT_ID)).toBe(false);
  });
});
