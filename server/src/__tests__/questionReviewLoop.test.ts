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
const mockEmitQuestionReviewAssigned = jest.fn().mockResolvedValue(undefined);
const mockReviewAggregate = jest.fn().mockResolvedValue([]);

jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: {
    findById: (id: unknown) => mockArtifactFindById(id),
    find: (f: unknown) => ({ lean: () => mockReviewArtifactFind(f) }),
    updateMany: (f: unknown, u: unknown) => mockArtifactUpdateMany(f, u),
    collection: { name: "contentartifacts" },
  },
}));

const mockArtifactUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });

// Separate handle so `find` can be steered independently of `findById`.
const mockReviewArtifactFind = jest.fn().mockResolvedValue([]);

jest.mock("../modules/content/models/ReviewAssignment", () => ({
  ReviewAssignment: {
    create: (a: unknown) => mockReviewCreate(a),
    find: (f: unknown) => mockReviewFind(f),
    findById: (id: unknown) => mockReviewFindById(id),
    updateOne: (f: unknown, u: unknown) => mockReviewUpdateOne(f, u),
    updateMany: (f: unknown, u: unknown) => mockReviewUpdateMany(f, u),
    countDocuments: (f: unknown) => mockReviewCount(f),
    aggregate: (p: unknown) => mockReviewAggregate(p),
  },
}));

const mockReviewUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });
const mockReviewCount = jest.fn().mockResolvedValue(0);

jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (f: unknown) => ({ select: () => ({ lean: () => mockUserFind(f) }) }) },
}));

jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
  writeAuditMany: (rows: unknown) => mockWriteAuditMany(rows),
}));

const mockWriteAuditMany = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/notifications/services/emitters", () => ({
  emitReviewAssigned: (...args: unknown[]) => mockEmitReviewAssigned(...args),
  emitQuestionReviewAssigned: (...args: unknown[]) => mockEmitQuestionReviewAssigned(...args),
}));

// Import AFTER mocks
import {
  assignQuestionReview,
  assignQuestionReviewOne,
  assignQuestionReviewBulk,
  submitQuestionReview,
  publishQuestion,
  publishQuestionBulk,
} from "../modules/questions/services/QuestionReviewService";
import {
  submitPlanReview,
  listMyReviewAssignments,
  planReviewInbox,
  planReviewThread,
  reviewerAssignmentLoad,
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
  test("creates a round carrying the qid, round 1, status assigned; audits", async () => {
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
    // Notification is the CALLER's job now (see the bulk-notifies-once tests below).
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

  test("a BULK assign notifies ONCE, not once per question", async () => {
    const ids = [
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
    ];
    mockArtifactFindById.mockImplementation((id: unknown) => questionDoc({ _id: id }));
    mockReviewCreate.mockImplementation((a: Record<string, unknown>) =>
      Promise.resolve({ ...a, _id: new mongoose.Types.ObjectId() }),
    );

    const res = await assignQuestionReviewBulk({
      artifactIds: ids.map((i) => i.toString()),
      reviewerId: REVIEWER_ID.toString(),
      assignedBy: ADMIN_ID.toString(),
    });

    expect(res.okCount).toBe(3);
    // Three rounds, ONE push — assigning a subject slice must not spam the reviewer.
    expect(mockEmitQuestionReviewAssigned).toHaveBeenCalledTimes(1);
    expect(mockEmitQuestionReviewAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ reviewerId: REVIEWER_ID.toString(), count: 3 }),
    );
    // And never the PLAN-worded notification, which names a plan and quotes an address.
    expect(mockEmitReviewAssigned).not.toHaveBeenCalled();
  });

  test("a single assign notifies once, with count 1", async () => {
    mockArtifactFindById.mockReturnValue(questionDoc());
    mockReviewCreate.mockImplementation((a: Record<string, unknown>) =>
      Promise.resolve({ ...a, _id: ASSIGNMENT_ID }),
    );

    await assignQuestionReviewOne({
      artifactId: ARTIFACT_ID.toString(),
      reviewerId: REVIEWER_ID.toString(),
      assignedBy: ADMIN_ID.toString(),
    });

    expect(mockEmitQuestionReviewAssigned).toHaveBeenCalledTimes(1);
    expect(mockEmitQuestionReviewAssigned).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
  });

  test("assignQuestionReview alone does NOT notify (the caller owns that)", async () => {
    mockArtifactFindById.mockReturnValue(questionDoc());
    mockReviewCreate.mockImplementation((a: Record<string, unknown>) =>
      Promise.resolve({ ...a, _id: ASSIGNMENT_ID }),
    );

    await assignQuestionReview({
      artifactId: ARTIFACT_ID.toString(),
      reviewerId: REVIEWER_ID.toString(),
      assignedBy: ADMIN_ID.toString(),
    });

    expect(mockEmitQuestionReviewAssigned).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The plan surfaces must not show question rounds (regression — both loops now
// share the ReviewAssignment collection, which they did not before QR-2).
// ---------------------------------------------------------------------------

describe("plan/question separation on shared ReviewAssignment", () => {
  test("listMyReviewAssignments asks for PLAN docTypes only", async () => {
    mockReviewFind.mockReturnValue(query([]));
    await listMyReviewAssignments(REVIEWER_ID.toString());

    const filter = mockReviewFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.docType).toEqual({ $in: ["chapter_plan", "session_plan"] });
  });

  test("planReviewInbox asks for PLAN docTypes only", async () => {
    mockReviewFind.mockReturnValue(query([]));
    await planReviewInbox();

    const filter = mockReviewFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.docType).toEqual({ $in: ["chapter_plan", "session_plan"] });
    expect(filter.status).toBe("submitted");
  });

  test("reviewerAssignmentLoad counts PLAN rounds only", async () => {
    mockReviewAggregate.mockResolvedValue([]);
    await reviewerAssignmentLoad();

    const pipeline = mockReviewAggregate.mock.calls[0][0] as { $match?: Record<string, unknown> }[];
    expect(pipeline[0].$match).toEqual(
      expect.objectContaining({ docType: { $in: ["chapter_plan", "session_plan"] } }),
    );
  });

  test("planReviewThread REFUSES a question — its address key would return unit-mates", async () => {
    mockArtifactFindById.mockReturnValue(questionDoc());

    await expect(planReviewThread(ARTIFACT_ID.toString())).rejects.toThrow(
      /use questionReviewThread/i,
    );
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
    // Bulk reads its artifacts in ONE `find` rather than a findById per item (D-#549);
    // the behaviour asserted below is unchanged, only where the fixture is steered.
    const OK_ID = new mongoose.Types.ObjectId();
    const BAD_ID = new mongoose.Types.ObjectId();
    mockReviewArtifactFind.mockResolvedValue([
      questionDoc({ _id: OK_ID, reviewStatus: "reviewed" }),
      questionDoc({ _id: BAD_ID, reviewStatus: "draft" }),
    ]);
    mockReviewFind.mockReturnValue(query([]));

    const res = await publishQuestionBulk({
      artifactIds: [OK_ID.toString(), BAD_ID.toString()],
      actorId: ADMIN_ID.toString(),
    });

    expect(res.okCount).toBe(1);
    expect(res.failedCount).toBe(1);
    expect(res.failures[0].error).toMatch(/override reason/i);
  });

  test("Q2.10 — bulk does the writes in a FIXED number of queries, not one set per question", async () => {
    // The owner published 244 questions and it took minutes: the old path cost ~6 sequential
    // Atlas round trips PER question (findById, save, round read, updateOne, two audit
    // inserts) — roughly 1,500 for that one action. This pins the fix: however many
    // questions go in, the artifact write, the round write and the audit write happen ONCE.
    const ids = Array.from({ length: 25 }, () => new mongoose.Types.ObjectId());
    mockReviewArtifactFind.mockResolvedValue(
      ids.map((id) => questionDoc({ _id: id, reviewStatus: "reviewed" })),
    );
    mockReviewFind.mockReturnValue(query([]));

    const res = await publishQuestionBulk({
      artifactIds: ids.map((i) => i.toString()),
      actorId: ADMIN_ID.toString(),
    });

    expect(res.okCount).toBe(25);
    expect(mockArtifactUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditMany).toHaveBeenCalledTimes(1);
    // One audit ROW per published question still — batching the write must not lose the log.
    expect((mockWriteAuditMany.mock.calls[0][0] as unknown[]).length).toBe(25);
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  test("Q2.10 — a published question's open rounds are superseded in one write", async () => {
    const OK_ID = new mongoose.Types.ObjectId();
    const ROUND_A = new mongoose.Types.ObjectId();
    const ROUND_B = new mongoose.Types.ObjectId();
    mockReviewArtifactFind.mockResolvedValue([questionDoc({ _id: OK_ID, reviewStatus: "reviewed" })]);
    mockReviewFind.mockReturnValue(query([{ _id: ROUND_A }, { _id: ROUND_B }]));

    await publishQuestionBulk({ artifactIds: [OK_ID.toString()], actorId: ADMIN_ID.toString() });

    expect(mockReviewUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockReviewUpdateMany.mock.calls[0][1]).toEqual({ $set: { status: "superseded" } });
    // Still one REVIEW_CANCELLED row per closed round, plus the publish row.
    const rows = mockWriteAuditMany.mock.calls[0][0] as { eventKind: string }[];
    expect(rows.filter((r) => r.eventKind === "REVIEW_CANCELLED")).toHaveLength(2);
    expect(rows.filter((r) => r.eventKind === "QUESTION_PUBLISHED")).toHaveLength(1);
  });
});
