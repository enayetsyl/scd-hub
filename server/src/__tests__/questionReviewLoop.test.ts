/**
 * QR-2 tests — the question review & publish loop (D-#508).
 *
 * Journeys: Q2.1 assign (+bulk), Q2.3 accept, Q2.4 reject with an OPTIONAL reason,
 *           Q2.8 publish, Q2.9 override-publish a rejected question, Q2.10 bulk publish.
 *
 * The headline case is Q2.4: for QUESTIONS a rejection reason is optional, while
 * submitPlanReview still REQUIRES feedback on CHANGES_REQUESTED. Both are asserted here so
 * the divergence is deliberate and cannot be "unified" away by accident.
 *
 * DB-free: mocked Mongoose models, mirroring review.test.ts.
 */
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockArtifactFindById = jest.fn();
const mockReviewCreate = jest.fn();
const mockReviewFind = jest.fn();
const mockReviewFindById = jest.fn();
const mockReviewUpdateOne = jest.fn();
const mockUserFind = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
const mockEmitReviewAssigned = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    findById: (id: unknown) => mockArtifactFindById(id),
    find: (f: unknown) => ({ lean: () => mockReviewArtifactFind(f) }),
  },
}));

// Separate handle so `find` can be steered independently of `findById`.
const mockReviewArtifactFind = jest.fn().mockResolvedValue([]);

jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    create: (a: unknown) => mockReviewCreate(a),
    find: (f: unknown) => mockReviewFind(f),
    findById: (id: unknown) => mockReviewFindById(id),
    updateOne: (f: unknown, u: unknown) => mockReviewUpdateOne(f, u),
  },
}));

jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => ({ select: () => ({ lean: () => mockUserFind(f) }) }) },
}));

jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

jest.mock("../modules/notifications/services/emitters", () => ({
  emitReviewAssigned: (...args: unknown[]) => mockEmitReviewAssigned(...args),
}));

// Import AFTER mocks
import {
  assignQuestionReview,
  assignQuestionReviewBulk,
  submitQuestionReview,
  publishQuestion,
  publishQuestionBulk,
} from "../modules/questions/services/QuestionReviewService";
import { submitPlanReview, ReviewError } from "../modules/content/services/ReviewService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ARTIFACT_ID = new mongoose.Types.ObjectId();
const REVIEWER_ID = new mongoose.Types.ObjectId();
const OTHER_TEACHER_ID = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();
const ASSIGNMENT_ID = new mongoose.Types.ObjectId();
const QID = "QP-ENG-C5-U09-Q01";

/** A question artifact that answers BOTH `.lean()` (loadQuestion) and `await` (+.save()). */
function questionDoc(over: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    _id: ARTIFACT_ID,
    docType: "question",
    subject: "ENG",
    classLevel: 5,
    address: { anchorWord: "Unit", number: 9, title: "Unit 9" },
    reviewStatus: "draft",
    current: true,
    envelopeJson: { payload: { qid: QID, question_text: "কে?", marks: 1 }, tags: { topic_tag: "T1" } },
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
  doc.lean = () => Promise.resolve(doc);
  return doc;
}

function query(result: unknown) {
  const c: Record<string, unknown> = {};
  c.sort = () => c;
  c.limit = () => c;
  c.select = () => c;
  c.lean = () => Promise.resolve(result);
  return c;
}

function assignmentDoc(over: Record<string, unknown> = {}): Record<string, unknown> & {
  save: jest.Mock;
} {
  return {
    _id: ASSIGNMENT_ID,
    docType: "question",
    subject: "ENG",
    classLevel: 5,
    anchorWord: "Unit",
    addressNumber: "9",
    qid: QID,
    artifactId: ARTIFACT_ID,
    reviewerId: REVIEWER_ID,
    assignedBy: ADMIN_ID,
    assignedAt: new Date(),
    roundNumber: 1,
    status: "assigned",
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockEmitReviewAssigned.mockResolvedValue(undefined);
  mockReviewUpdateOne.mockResolvedValue({ acknowledged: true });
  mockReviewFind.mockReturnValue(query([]));
  mockUserFind.mockResolvedValue([{ _id: REVIEWER_ID, name: "Afiza" }]);
  mockReviewArtifactFind.mockResolvedValue([questionDoc()]);
});

// ---------------------------------------------------------------------------
// Q2.1 — assign
// ---------------------------------------------------------------------------

describe("assignQuestionReview (Q2.1)", () => {
  test("creates a round carrying the qid, round 1, status assigned; audits + notifies", async () => {
    mockArtifactFindById.mockReturnValue(questionDoc());
    mockReviewCreate.mockImplementation((a: Record<string, unknown>) =>
      Promise.resolve({ ...a, _id: ASSIGNMENT_ID }),
    );

    const dto = await assignQuestionReview({
      artifactId: ARTIFACT_ID.toString(),
      reviewerId: REVIEWER_ID.toString(),
      assignedBy: ADMIN_ID.toString(),
      actorRole: "PRINCIPAL",
    });

    const created = mockReviewCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.qid).toBe(QID);
    expect(created.docType).toBe("question");
    expect(created.roundNumber).toBe(1);
    expect(created.status).toBe("assigned");
    // Address fields are still stored (they describe the item) but do not anchor it.
    expect(created.anchorWord).toBe("Unit");

    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "REVIEW_ASSIGNED", meta: expect.objectContaining({ qid: QID }) }),
    );
    expect(mockEmitReviewAssigned).toHaveBeenCalled();
    expect(dto.qid).toBe(QID);
  });

  test("round number continues that qid's own history", async () => {
    mockArtifactFindById.mockReturnValue(questionDoc());
    // Same stub answers the supersede sweep AND the round-number lookup, so the row needs
    // an _id for the supersede audit.
    mockReviewFind.mockReturnValue(query([{ _id: new mongoose.Types.ObjectId(), roundNumber: 4 }]));
    mockReviewCreate.mockImplementation((a: Record<string, unknown>) =>
      Promise.resolve({ ...a, _id: ASSIGNMENT_ID }),
    );

    await assignQuestionReview({
      artifactId: ARTIFACT_ID.toString(),
      reviewerId: REVIEWER_ID.toString(),
      assignedBy: ADMIN_ID.toString(),
    });

    expect((mockReviewCreate.mock.calls[0][0] as Record<string, unknown>).roundNumber).toBe(5);
  });

  test("a non-question artifact is refused", async () => {
    mockArtifactFindById.mockReturnValue(questionDoc({ docType: "chapter_plan" }));

    await expect(
      assignQuestionReview({
        artifactId: ARTIFACT_ID.toString(),
        reviewerId: REVIEWER_ID.toString(),
        assignedBy: ADMIN_ID.toString(),
      }),
    ).rejects.toThrow(ReviewError);
    expect(mockReviewCreate).not.toHaveBeenCalled();
  });

  test("bulk collects per-question failures instead of aborting", async () => {
    const OK_ID = new mongoose.Types.ObjectId();
    // The miss must still be a chainable query whose .lean() resolves null — that is what
    // Mongoose returns, and it is how loadQuestion reaches its "Artifact not found".
    mockArtifactFindById.mockImplementation((id: unknown) =>
      String(id) === OK_ID.toString() ? questionDoc({ _id: OK_ID }) : query(null),
    );
    mockReviewCreate.mockImplementation((a: Record<string, unknown>) =>
      Promise.resolve({ ...a, _id: ASSIGNMENT_ID }),
    );

    const res = await assignQuestionReviewBulk({
      artifactIds: [OK_ID.toString(), new mongoose.Types.ObjectId().toString()],
      reviewerId: REVIEWER_ID.toString(),
      assignedBy: ADMIN_ID.toString(),
    });

    expect(res.okCount).toBe(1);
    expect(res.failedCount).toBe(1);
    expect(res.failures[0].error).toMatch(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// Q2.3 / Q2.4 — accept & reject
// ---------------------------------------------------------------------------

describe("submitQuestionReview (Q2.3, Q2.4)", () => {
  test("APPROVE advances the question draft→reviewed", async () => {
    const assignment = assignmentDoc();
    const artifact = questionDoc({ reviewStatus: "draft" });
    mockReviewFindById.mockResolvedValue(assignment);
    mockArtifactFindById.mockReturnValue(artifact);

    await submitQuestionReview({
      assignmentId: ASSIGNMENT_ID.toString(),
      reviewerId: REVIEWER_ID.toString(),
      verdict: "APPROVE",
    });

    expect(assignment.status).toBe("submitted");
    expect(artifact.reviewStatus).toBe("reviewed");
    expect(artifact.save).toHaveBeenCalled();
  });

  test("Q2.4 — CHANGES_REQUESTED with NO reason SUCCEEDS (the divergence from plans)", async () => {
    const assignment = assignmentDoc();
    const artifact = questionDoc({ reviewStatus: "draft" });
    mockReviewFindById.mockResolvedValue(assignment);
    mockArtifactFindById.mockReturnValue(artifact);

    const dto = await submitQuestionReview({
      assignmentId: ASSIGNMENT_ID.toString(),
      reviewerId: REVIEWER_ID.toString(),
      verdict: "CHANGES_REQUESTED",
    });

    expect(assignment.status).toBe("submitted");
    expect(assignment.verdict).toBe("CHANGES_REQUESTED");
    expect(dto.feedback).toBeNull();
    // Rejection leaves a draft question at draft.
    expect(artifact.reviewStatus).toBe("draft");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ reasonGiven: false }) }),
    );
  });

  test("Q2.4 contrast — the PLAN loop still REQUIRES feedback on CHANGES_REQUESTED", async () => {
    await expect(
      submitPlanReview({
        assignmentId: ASSIGNMENT_ID.toString(),
        reviewerId: REVIEWER_ID.toString(),
        verdict: "CHANGES_REQUESTED",
      }),
    ).rejects.toThrow(/feedback is required/i);
  });

  test("an optional reason is stored when given", async () => {
    const assignment = assignmentDoc();
    mockReviewFindById.mockResolvedValue(assignment);
    mockArtifactFindById.mockReturnValue(questionDoc());

    const dto = await submitQuestionReview({
      assignmentId: ASSIGNMENT_ID.toString(),
      reviewerId: REVIEWER_ID.toString(),
      verdict: "CHANGES_REQUESTED",
      reason: "  বানান ভুল  ",
    });

    expect(dto.feedback).toBe("বানান ভুল");
  });

  test("only the ASSIGNED reviewer may submit", async () => {
    mockReviewFindById.mockResolvedValue(assignmentDoc());

    await expect(
      submitQuestionReview({
        assignmentId: ASSIGNMENT_ID.toString(),
        reviewerId: OTHER_TEACHER_ID.toString(),
        verdict: "APPROVE",
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  test("a closed round refuses a verdict", async () => {
    mockReviewFindById.mockResolvedValue(assignmentDoc({ status: "superseded" }));

    await expect(
      submitQuestionReview({
        assignmentId: ASSIGNMENT_ID.toString(),
        reviewerId: REVIEWER_ID.toString(),
        verdict: "APPROVE",
      }),
    ).rejects.toThrow(/not open for submission/i);
  });

  test("a PLAN round cannot be submitted through the question path", async () => {
    mockReviewFindById.mockResolvedValue(assignmentDoc({ docType: "chapter_plan", qid: undefined }));

    await expect(
      submitQuestionReview({
        assignmentId: ASSIGNMENT_ID.toString(),
        reviewerId: REVIEWER_ID.toString(),
        verdict: "APPROVE",
      }),
    ).rejects.toThrow(/use submitPlanReview/i);
  });
});

// ---------------------------------------------------------------------------
// Q2.8 / Q2.9 / Q2.10 — publish
// ---------------------------------------------------------------------------

describe("publishQuestion (Q2.8, Q2.9)", () => {
  test("an accepted (reviewed) question publishes to gold and closes its thread", async () => {
    const artifact = questionDoc({ reviewStatus: "reviewed" });
    mockArtifactFindById.mockReturnValue(artifact);

    const res = await publishQuestion({
      artifactId: ARTIFACT_ID.toString(),
      actorId: ADMIN_ID.toString(),
      actorRole: "PRINCIPAL",
    });

    expect(res).toEqual({ artifactId: ARTIFACT_ID.toString(), reviewStatus: "gold", override: false });
    expect(artifact.reviewStatus).toBe("gold");
    expect(artifact.approvedBy).toBeDefined();
    expect(artifact.approvalOverride).toBe(false);
    // The thread is closed by qid.
    expect(mockReviewFind).toHaveBeenCalledWith(
      expect.objectContaining({ docType: "question", qid: QID }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "QUESTION_PUBLISHED" }),
    );
  });

  test("Q2.9 — a REJECTED (draft) question is refused without an override reason", async () => {
    const artifact = questionDoc({ reviewStatus: "draft" });
    mockArtifactFindById.mockReturnValue(artifact);

    await expect(
      publishQuestion({ artifactId: ARTIFACT_ID.toString(), actorId: ADMIN_ID.toString() }),
    ).rejects.toThrow(/override reason/i);
    expect(artifact.reviewStatus).toBe("draft");
    expect(artifact.save).not.toHaveBeenCalled();
  });

  test("Q2.9 — WITH a reason it publishes, stamping the override + note", async () => {
    const artifact = questionDoc({ reviewStatus: "draft" });
    mockArtifactFindById.mockReturnValue(artifact);

    const res = await publishQuestion({
      artifactId: ARTIFACT_ID.toString(),
      actorId: ADMIN_ID.toString(),
      overrideReason: "প্রশ্নটি ঠিক আছে",
    });

    expect(res.override).toBe(true);
    expect(artifact.reviewStatus).toBe("gold");
    expect(artifact.approvalOverride).toBe(true);
    expect(artifact.approvalNote).toBe("প্রশ্নটি ঠিক আছে");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "QUESTION_PUBLISHED",
        meta: expect.objectContaining({ override: true, reason: "প্রশ্নটি ঠিক আছে" }),
      }),
    );
  });

  test("an already-published question is refused", async () => {
    mockArtifactFindById.mockReturnValue(questionDoc({ reviewStatus: "gold" }));

    await expect(
      publishQuestion({ artifactId: ARTIFACT_ID.toString(), actorId: ADMIN_ID.toString() }),
    ).rejects.toThrow(/already published/i);
  });

  test("a non-question artifact cannot be published here", async () => {
    mockArtifactFindById.mockReturnValue(questionDoc({ docType: "session_plan", reviewStatus: "reviewed" }));

    await expect(
      publishQuestion({ artifactId: ARTIFACT_ID.toString(), actorId: ADMIN_ID.toString() }),
    ).rejects.toThrow(/Only questions can be published/i);
  });

  test("Q2.10 — bulk publishes the accepted ones and reports the rest", async () => {
    const OK_ID = new mongoose.Types.ObjectId();
    const BAD_ID = new mongoose.Types.ObjectId();
    mockArtifactFindById.mockImplementation((id: unknown) =>
      String(id) === OK_ID.toString()
        ? questionDoc({ _id: OK_ID, reviewStatus: "reviewed" })
        : questionDoc({ _id: BAD_ID, reviewStatus: "draft" }),
    );

    const res = await publishQuestionBulk({
      artifactIds: [OK_ID.toString(), BAD_ID.toString()],
      actorId: ADMIN_ID.toString(),
    });

    expect(res.okCount).toBe(1);
    expect(res.failedCount).toBe(1);
    expect(res.failures[0].error).toMatch(/override reason/i);
  });
});
