/**
 * RF-1 + RF-2 (owner 25 Nov 2026) — the four folds of a reviewer's list, and change-after-final.
 *
 *   RF-1  bucket reads (undecided / approved / changes / final) with counts, for questions AND plans,
 *         under the same filter; "final" = her superseded round whose artifact is gold, one row each.
 *   RF-2  GoldChangeRequest: request / approve (OWNER RULING A: the item leaves gold, back to draft,
 *         the comment becomes a CHANGES_REQUESTED round) / reject (nothing changes); permissions on each.
 *
 * In-memory MongoDB, real services. Emitters and the holder lookup are stubbed.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockEmitRequested = jest.fn().mockResolvedValue(undefined);
const mockEmitDecided = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/notifications/services/emitters", () => ({
  emitReviewAssigned: jest.fn().mockResolvedValue(undefined),
  emitQuestionReviewAssigned: jest.fn().mockResolvedValue(undefined),
  emitGoldChangeRequested: (...a: unknown[]) => mockEmitRequested(...a),
  emitGoldChangeDecided: (...a: unknown[]) => mockEmitDecided(...a),
}));
jest.mock("../modules/access-control/services/holders", () => ({
  holderIdsOf: jest.fn().mockResolvedValue(["principal-1"]),
}));

import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { ReviewAssignment } from "../modules/content/models/ReviewAssignment";
import { GoldChangeRequest } from "../modules/content/models/GoldChangeRequest";
import { User } from "../modules/foundation/models/User";
import {
  myReviewBucketCounts,
  listMyQuestionReviews,
  countMyQuestionReviews,
} from "../modules/questions/services/QuestionReviewService";
import { listMyPlanReviewsBucket, myPlanReviewBucketCounts } from "../modules/content/services/ReviewService";
import {
  requestGoldChange,
  decideGoldChange,
  listGoldChangeRequests,
  listMyGoldChangeRequests,
} from "../modules/content/services/GoldChangeService";

const oid = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();
const REVIEWER = oid();
const OTHER = oid();
const PRINCIPAL = oid();

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await ReviewAssignment.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([ContentArtifact.deleteMany({}), ReviewAssignment.deleteMany({}), GoldChangeRequest.deleteMany({}), User.deleteMany({})]);
  jest.clearAllMocks();
});

async function question(qid: string, reviewStatus: "draft" | "reviewed" | "gold", over: Record<string, unknown> = {}) {
  return ContentArtifact.create({
    docType: "question",
    subject: "BAN",
    classLevel: 5,
    address: { anchorWord: "পাঠ", number: 3 },
    curationTag: "KEEP_AS_IS",
    reviewStatus,
    envelopeJson: { payload: { qid, question_text: `text ${qid}`, question_type: "mcq" } },
    importedBy: PRINCIPAL,
    ...over,
  });
}

async function plan(docType: "chapter_plan" | "session_plan", number: number, reviewStatus: "draft" | "reviewed" | "gold", period?: number) {
  return ContentArtifact.create({
    docType,
    subject: "BAN",
    classLevel: 5,
    address: { anchorWord: "পাঠ", number, title: `Plan ${docType} ${number}` },
    curationTag: "KEEP_AS_IS",
    reviewStatus,
    envelopeJson: { payload: period ? { session_plan: { period_index: period } } : {} },
    importedBy: PRINCIPAL,
  });
}

async function round(
  a: { _id: mongoose.Types.ObjectId; docType: string; address: { number: unknown } },
  over: Record<string, unknown>,
  qid?: string,
) {
  return ReviewAssignment.create({
    docType: a.docType,
    subject: "BAN",
    classLevel: 5,
    anchorWord: "পাঠ",
    addressNumber: String(a.address.number),
    qid,
    artifactId: a._id,
    reviewerId: REVIEWER,
    assignedBy: PRINCIPAL,
    roundNumber: 1,
    status: "assigned",
    ...over,
  });
}

/** One question in each fold, for REVIEWER; plus noise that belongs to nobody's fold. */
async function seedQuestions(): Promise<{ finalArt: Awaited<ReturnType<typeof question>> }> {
  const u = await question("Q-U", "draft");
  await round(u, {}, "Q-U");
  const ap = await question("Q-AP", "reviewed");
  await round(ap, { status: "submitted", verdict: "APPROVE", submittedAt: new Date() }, "Q-AP");
  const cond = await question("Q-COND", "draft");
  await round(cond, { status: "submitted", verdict: "APPROVE_WITH_CONDITION", feedback: "x", submittedAt: new Date() }, "Q-COND");
  const ch = await question("Q-CH", "draft");
  await round(ch, { status: "submitted", verdict: "CHANGES_REQUESTED", submittedAt: new Date() }, "Q-CH");
  const finalArt = await question("Q-FIN", "gold");
  await round(finalArt, { status: "superseded", verdict: "APPROVE", submittedAt: new Date() }, "Q-FIN");
  // A superseded round whose artifact is NOT gold (cancelled by a new round): in no fold.
  const gone = await question("Q-GONE", "draft");
  await round(gone, { status: "superseded", verdict: "APPROVE" }, "Q-GONE");
  // Another reviewer's gold question: never in REVIEWER's folds.
  const other = await question("Q-OTH", "gold");
  await round(other, { status: "superseded", verdict: "APPROVE", reviewerId: OTHER }, "Q-OTH");
  return { finalArt };
}

describe("RF-1 question folds", () => {
  test("counts: undecided 1 / approved 2 (APPROVE + condition) / changes 1 / final 1", async () => {
    await seedQuestions();
    expect(await myReviewBucketCounts(REVIEWER.toString())).toEqual({ undecided: 1, approved: 2, changes: 1, final: 1 });
  });

  test("each fold lists only its own rows, and the count matches the list", async () => {
    await seedQuestions();
    const qids = async (bucket: "undecided" | "approved" | "changes" | "final") =>
      (await listMyQuestionReviews(REVIEWER.toString(), {}, { bucket })).map((r) => r.qid).sort();
    expect(await qids("undecided")).toEqual(["Q-U"]);
    expect(await qids("approved")).toEqual(["Q-AP", "Q-COND"]);
    expect(await qids("changes")).toEqual(["Q-CH"]);
    expect(await qids("final")).toEqual(["Q-FIN"]);
    expect(await countMyQuestionReviews(REVIEWER.toString(), { bucket: "approved" })).toBe(2);
    expect(await countMyQuestionReviews(REVIEWER.toString(), { bucket: "final" })).toBe(1);
  });

  test("filters apply to every fold: the counts follow the filter", async () => {
    await seedQuestions();
    const other = await question("Q-ENG", "draft", { subject: "ENG" });
    await round(other, { subject: "ENG" }, "Q-ENG");
    expect((await myReviewBucketCounts(REVIEWER.toString(), { subject: "ENG" })).undecided).toBe(1);
    expect(await myReviewBucketCounts(REVIEWER.toString(), { subject: "BAN" })).toEqual({ undecided: 1, approved: 2, changes: 1, final: 1 });
    // search reaches into the payload (artifact join) and still works inside the final fold
    expect(await myReviewBucketCounts(REVIEWER.toString(), { search: "Q-FIN" })).toEqual({ undecided: 0, approved: 0, changes: 0, final: 1 });
  });

  test("final shows one row per question even with two superseded rounds on one artifact", async () => {
    const art = await question("Q-TWO", "gold");
    await round(art, { status: "superseded", verdict: "CHANGES_REQUESTED", roundNumber: 1 }, "Q-TWO");
    await round(art, { status: "superseded", verdict: "APPROVE", roundNumber: 2 }, "Q-TWO");
    const rows = await listMyQuestionReviews(REVIEWER.toString(), {}, { bucket: "final" });
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("APPROVE");
    expect(await countMyQuestionReviews(REVIEWER.toString(), { bucket: "final" })).toBe(1);
  });

  test("a round decided on the queue moves between folds (no vanishing)", async () => {
    const a = await question("Q-MOVE", "draft");
    const r = await round(a, {}, "Q-MOVE");
    expect((await myReviewBucketCounts(REVIEWER.toString())).undecided).toBe(1);
    await ReviewAssignment.updateOne({ _id: r._id }, { status: "submitted", verdict: "APPROVE" });
    expect(await myReviewBucketCounts(REVIEWER.toString())).toEqual({ undecided: 0, approved: 1, changes: 0, final: 0 });
    await ReviewAssignment.updateOne({ _id: r._id }, { verdict: "CHANGES_REQUESTED" });
    expect(await myReviewBucketCounts(REVIEWER.toString())).toEqual({ undecided: 0, approved: 0, changes: 1, final: 0 });
  });
});

describe("RF-1 plan folds", () => {
  test("chapter + session plans land in the right folds; filters and search narrow them", async () => {
    const c1 = await plan("chapter_plan", 1, "draft");
    await round(c1, {});
    const s1 = await plan("session_plan", 1, "reviewed", 2);
    await round(s1, { status: "submitted", verdict: "APPROVE", sessionIndex: 2 });
    const c2 = await plan("chapter_plan", 2, "draft");
    await round(c2, { status: "submitted", verdict: "CHANGES_REQUESTED" });
    const c3 = await plan("chapter_plan", 3, "gold");
    await round(c3, { status: "superseded", verdict: "APPROVE" });
    // a plan round on a not-gold artifact that was superseded: in no fold
    const c4 = await plan("chapter_plan", 4, "draft");
    await round(c4, { status: "superseded", verdict: "APPROVE" });

    expect(await myPlanReviewBucketCounts(REVIEWER.toString())).toEqual({ undecided: 1, approved: 1, changes: 1, final: 1 });
    expect((await listMyPlanReviewsBucket(REVIEWER.toString(), "final")).map((r) => r.addressNumber)).toEqual(["3"]);
    expect((await listMyPlanReviewsBucket(REVIEWER.toString(), "approved"))[0].docType).toBe("session_plan");
    // plan type filter
    expect(await myPlanReviewBucketCounts(REVIEWER.toString(), { docType: "session_plan" })).toEqual({ undecided: 0, approved: 1, changes: 0, final: 0 });
    // search by title / chapter number
    expect((await myPlanReviewBucketCounts(REVIEWER.toString(), { search: "chapter_plan 2" })).changes).toBe(1);
    expect((await myPlanReviewBucketCounts(REVIEWER.toString(), { chapter: "3" })).final).toBe(1);
    // paging
    expect(await listMyPlanReviewsBucket(REVIEWER.toString(), "undecided", {}, { limit: 1, offset: 1 })).toHaveLength(0);
    // another reviewer sees nothing
    expect(await myPlanReviewBucketCounts(OTHER.toString())).toEqual({ undecided: 0, approved: 0, changes: 0, final: 0 });
  });
});

const canAll = (): boolean => true;
const canNone = (): boolean => false;
const canOnly = (...perms: string[]) => (p: string): boolean => perms.includes(p);

describe("RF-2 request a change to a gold item", () => {
  test("creates an OPEN request, leaves the gold item untouched, notifies the deciders", async () => {
    const { finalArt } = await seedQuestions();
    await User.create({ name: "Rev One", phone: "01700000001", passwordHash: "x", role: "TEACHER", _id: REVIEWER }).catch(() => undefined);
    const dto = await requestGoldChange({
      artifactId: finalArt._id.toString(),
      reviewerId: REVIEWER.toString(),
      comment: "  option B is also correct  ",
      proposal: "new answer text",
      can: canOnly("question_review:review"),
    });
    expect(dto).toMatchObject({ status: "OPEN", comment: "option B is also correct", proposalJson: "new answer text", docType: "question" });
    expect(dto.questionText).toBe("text Q-FIN");
    const after = await ContentArtifact.findById(finalArt._id).lean();
    expect(after?.reviewStatus).toBe("gold");
    expect(mockEmitRequested).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: ["principal-1"], docType: "question" }));
    expect(await GoldChangeRequest.countDocuments({ status: "OPEN" })).toBe(1);
    expect(await listMyGoldChangeRequests(REVIEWER.toString())).toHaveLength(1);
  });

  test("refusals: no comment, not gold, not her item, missing permission, duplicate open", async () => {
    const { finalArt } = await seedQuestions();
    const id = finalArt._id.toString();
    const base = { artifactId: id, reviewerId: REVIEWER.toString(), can: canAll };
    await expect(requestGoldChange({ ...base, comment: "   " })).rejects.toThrow(/comment is required/);
    await expect(requestGoldChange({ ...base, comment: "x", can: canNone })).rejects.toThrow(/FORBIDDEN/);
    // a plan reviewer permission is not enough for a question
    await expect(requestGoldChange({ ...base, comment: "x", can: canOnly("plan_review:review") })).rejects.toThrow(/FORBIDDEN/);
    await expect(requestGoldChange({ ...base, comment: "x", reviewerId: OTHER.toString() })).rejects.toThrow(/did not review/);
    const draft = await question("Q-D", "draft");
    await expect(requestGoldChange({ ...base, artifactId: draft._id.toString(), comment: "x" })).rejects.toThrow(/finalised/);
    await requestGoldChange({ ...base, comment: "first" });
    await expect(requestGoldChange({ ...base, comment: "second" })).rejects.toThrow(/already waiting/);
  });

  test("a plan is asked about with plan_review:review", async () => {
    const p = await plan("chapter_plan", 7, "gold");
    await round(p, { status: "superseded", verdict: "APPROVE" });
    await expect(
      requestGoldChange({ artifactId: p._id.toString(), reviewerId: REVIEWER.toString(), comment: "fix", can: canOnly("question_review:review") }),
    ).rejects.toThrow(/FORBIDDEN/);
    const dto = await requestGoldChange({ artifactId: p._id.toString(), reviewerId: REVIEWER.toString(), comment: "fix", proposal: "ignored for plans", can: canOnly("plan_review:review") });
    expect(dto.docType).toBe("chapter_plan");
    expect(dto.proposalJson).toBeNull();
    expect(dto.title).toBe("Plan chapter_plan 7");
  });
});

describe("RF-2 old versions", () => {
  test("an older version that is still gold is refused and not listed in final (questions and plans)", async () => {
    const oldQ = await question("Q-OLD", "gold", { current: false });
    await round(oldQ, { status: "superseded", verdict: "APPROVE" }, "Q-OLD");
    const retired = await question("Q-RET", "gold", { retiredAt: new Date() });
    await round(retired, { status: "superseded", verdict: "APPROVE" }, "Q-RET");
    const oldP = await plan("chapter_plan", 9, "gold");
    await ContentArtifact.updateOne({ _id: oldP._id }, { current: false });
    await round(oldP, { status: "superseded", verdict: "APPROVE" });
    expect((await myReviewBucketCounts(REVIEWER.toString())).final).toBe(0);
    expect(await listMyQuestionReviews(REVIEWER.toString(), {}, { bucket: "final" })).toHaveLength(0);
    expect((await myPlanReviewBucketCounts(REVIEWER.toString())).final).toBe(0);
    for (const a of [oldQ, retired, oldP]) {
      await expect(requestGoldChange({ artifactId: a._id.toString(), reviewerId: REVIEWER.toString(), comment: "x", can: canAll })).rejects.toThrow(/current item/);
    }
  });
});

describe("RF-2 decide", () => {
  async function openRequest(): Promise<{ requestId: string; artId: mongoose.Types.ObjectId }> {
    const { finalArt } = await seedQuestions();
    const dto = await requestGoldChange({
      artifactId: finalArt._id.toString(),
      reviewerId: REVIEWER.toString(),
      comment: "answer is wrong",
      proposal: "B",
      can: canAll,
    });
    return { requestId: dto.id, artId: finalArt._id };
  }

  test("approve (ruling A): the item leaves gold -> draft, stamps cleared, comment becomes a CHANGES_REQUESTED round", async () => {
    const { requestId, artId } = await openRequest();
    await ContentArtifact.updateOne({ _id: artId }, { approvedBy: PRINCIPAL, approvedAt: new Date(), approvalNote: "n" });
    const dto = await decideGoldChange({ requestId, approve: true, actorId: PRINCIPAL.toString(), can: canOnly("question_review:publish") });
    expect(dto.status).toBe("APPROVED");
    const art = await ContentArtifact.findById(artId).lean();
    expect(art?.reviewStatus).toBe("draft");
    expect(art?.approvedBy).toBeUndefined();
    expect(art?.approvalNote).toBeUndefined();
    const rounds = await ReviewAssignment.find({ qid: "Q-FIN" }).sort({ roundNumber: 1 }).lean();
    const last = rounds[rounds.length - 1];
    expect(last).toMatchObject({ status: "submitted", verdict: "CHANGES_REQUESTED", roundNumber: 2 });
    expect(last.reviewerId.toString()).toBe(REVIEWER.toString());
    expect(last.feedback).toContain("answer is wrong");
    expect(last.feedback).toContain("B");
    expect(mockEmitDecided).toHaveBeenCalledWith(expect.objectContaining({ approved: true, reviewerId: REVIEWER.toString() }));
    // the reviewer now sees it in her "changes" fold and no longer in "final"
    const counts = await myReviewBucketCounts(REVIEWER.toString());
    expect(counts.changes).toBe(2);
    expect(counts.final).toBe(0);
    // and the Principal's section no longer lists it as OPEN
    expect(await listGoldChangeRequests({ can: canAll })).toHaveLength(0);
    expect(await listGoldChangeRequests({ status: "APPROVED", can: canAll })).toHaveLength(1);
  });

  test("reject: nothing changes; the reviewer reads the note", async () => {
    const { requestId, artId } = await openRequest();
    const before = await ReviewAssignment.countDocuments({});
    const dto = await decideGoldChange({ requestId, approve: false, note: "the key is right", actorId: PRINCIPAL.toString(), can: canAll });
    expect(dto).toMatchObject({ status: "REJECTED", note: "the key is right" });
    expect((await ContentArtifact.findById(artId).lean())?.reviewStatus).toBe("gold");
    expect(await ReviewAssignment.countDocuments({})).toBe(before);
    expect(mockEmitDecided).toHaveBeenCalledWith(expect.objectContaining({ approved: false, note: "the key is right" }));
    const mine = await listMyGoldChangeRequests(REVIEWER.toString());
    expect(mine[0]).toMatchObject({ status: "REJECTED", note: "the key is right" });
  });

  test("permissions: deciding needs the approve/publish permission of THAT doc type", async () => {
    const { requestId } = await openRequest();
    await expect(decideGoldChange({ requestId, approve: true, actorId: PRINCIPAL.toString(), can: canNone })).rejects.toThrow(/FORBIDDEN/);
    // plan approve does not decide a question
    await expect(decideGoldChange({ requestId, approve: true, actorId: PRINCIPAL.toString(), can: canOnly("plan_review:approve") })).rejects.toThrow(/FORBIDDEN/);
    // the reviewer permission is not a decide permission
    await expect(decideGoldChange({ requestId, approve: false, actorId: PRINCIPAL.toString(), can: canOnly("question_review:review") })).rejects.toThrow(/FORBIDDEN/);
    expect((await GoldChangeRequest.findById(requestId).lean())?.status).toBe("OPEN");
    await expect(listGoldChangeRequests({ can: canNone })).rejects.toThrow(/FORBIDDEN/);
    // a question-only decider sees the question request, a plan-only decider does not
    expect(await listGoldChangeRequests({ can: canOnly("question_review:publish") })).toHaveLength(1);
    expect(await listGoldChangeRequests({ can: canOnly("plan_review:approve") })).toHaveLength(0);
  });

  test("a decided request cannot be decided twice; an approve on an item that is no longer gold is refused", async () => {
    const { requestId, artId } = await openRequest();
    await decideGoldChange({ requestId, approve: false, actorId: PRINCIPAL.toString(), can: canAll });
    await expect(decideGoldChange({ requestId, approve: true, actorId: PRINCIPAL.toString(), can: canAll })).rejects.toThrow(/already decided/);

    const { finalArt } = await (async () => {
      await GoldChangeRequest.deleteMany({});
      const art = await ContentArtifact.findById(artId);
      return { finalArt: art! };
    })();
    const again = await requestGoldChange({ artifactId: finalArt._id.toString(), reviewerId: REVIEWER.toString(), comment: "again", can: canAll });
    await ContentArtifact.updateOne({ _id: artId }, { reviewStatus: "draft" });
    const before = await ReviewAssignment.countDocuments({});
    const res = await decideGoldChange({ requestId: again.id, approve: true, actorId: PRINCIPAL.toString(), can: canAll });
    // the item had already left final: nothing is changed, and the request says so plainly
    expect(res.status).toBe("OBSOLETE");
    expect(res.note).toMatch(/আর চূড়ান্ত নেই/);
    expect(await ReviewAssignment.countDocuments({})).toBe(before);
  });

  test("approving twice writes ONE round (the request is claimed first)", async () => {
    const { requestId } = await openRequest();
    const args = { requestId, approve: true, actorId: PRINCIPAL.toString(), can: canAll };
    const results = await Promise.allSettled([decideGoldChange(args), decideGoldChange(args)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await ReviewAssignment.countDocuments({ qid: "Q-FIN", status: "submitted", verdict: "CHANGES_REQUESTED" })).toBe(1);
    await expect(decideGoldChange(args)).rejects.toThrow(/already decided/);
  });

  test("a reviewer cannot decide her own request", async () => {
    const { requestId } = await openRequest();
    await expect(decideGoldChange({ requestId, approve: true, actorId: REVIEWER.toString(), can: canAll })).rejects.toThrow(/own change request/);
  });

  test("a plan approve sends the plan back to draft with its comment on the plan thread", async () => {
    const p = await plan("session_plan", 5, "gold", 3);
    await round(p, { status: "superseded", verdict: "APPROVE", sessionIndex: 3 });
    const req = await requestGoldChange({ artifactId: p._id.toString(), reviewerId: REVIEWER.toString(), comment: "wrong period", can: canAll });
    await decideGoldChange({ requestId: req.id, approve: true, actorId: PRINCIPAL.toString(), can: canOnly("plan_review:approve") });
    expect((await ContentArtifact.findById(p._id).lean())?.reviewStatus).toBe("draft");
    const rows = await listMyPlanReviewsBucket(REVIEWER.toString(), "changes");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionIndex: 3, feedback: "wrong period", roundNumber: 2 });
  });
});
