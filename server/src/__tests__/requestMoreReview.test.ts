/**
 * "আরও কাজ দিন" (.claude/plans/review-next-chunk.md, Slice B) - requestMoreReview.
 *
 *   gate     refused while work is open (plans above the threshold / too many questions left)
 *   chunk    gives the next `chunkChapters` parked chapters; ONE Principal notice, none for the reviewer
 *   ladder   the default is the current book, then the same subject's next classes; at the end of a book
 *            it moves on; a custom ladder wins; nothing left reports NOTHING_LEFT
 *   cap      `maxRequestsPerDay` is enforced per Dhaka day
 *   skip     a chapter whose rounds all sit with somebody else is skipped
 *   audit    every request and every settings / ladder write leaves a REVIEW_SELF_SERVE row
 *
 * In-memory MongoDB, real services; the notification emitters are counted, not sent.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mockEmitTask = jest.fn().mockResolvedValue(undefined);
const mockEmitSelfServe = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/notifications/services/emitters", () => ({
  ...jest.requireActual("../modules/notifications/services/emitters"),
  emitReviewAssigned: jest.fn().mockResolvedValue(undefined),
  emitQuestionReviewAssigned: jest.fn().mockResolvedValue(undefined),
  emitReviewTaskNotice: (...a: unknown[]) => mockEmitTask(...a),
  emitReviewSelfServeNotice: (...a: unknown[]) => mockEmitSelfServe(...a),
}));

import { User } from "../modules/foundation/models/User";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { ReviewAssignment } from "../modules/content/models/ReviewAssignment";
import { ReviewProgram } from "../modules/review-program/models/ReviewProgram";
import { ReviewTask } from "../modules/review-program/models/ReviewTask";
import { Audit } from "../modules/platform/models/Audit";
import { createProgram } from "../modules/review-program/services/ReviewProgramService";
import {
  defaultLadder,
  myReviewMoreStatus,
  releaseAllowed,
  requestMoreReview,
  selfServeOverview,
  setReviewerLadder,
  updateSelfServeSettings,
} from "../modules/review-program/services/ReviewMoreService";
import { reviewSelfServeNoticeBody } from "../modules/notifications/services/emitters";

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.allSettled(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const oid = () => new Types.ObjectId();
let PRINCIPAL: Types.ObjectId;
let ME: Types.ObjectId;
let OTHER: Types.ObjectId;
let programId: string;
const ACTOR = () => ({ id: ME.toString(), role: "TEACHER" });
const WORD = "অধ্যায়";

async function user(name: string, role = "TEACHER"): Promise<Types.ObjectId> {
  return (await User.create({ name, role, passwordHash: "x", phone: `0${Math.floor(Math.random() * 1e9)}${name.length}` }))._id;
}

/** A draft chapter of a book: one session plan + `q` questions. */
async function chapter(opts: { classLevel?: number; n: number; q?: number; status?: string; subject?: string }) {
  const classLevel = opts.classLevel ?? 1;
  const subject = opts.subject ?? "BAN";
  const status = opts.status ?? "draft";
  const plan = await ContentArtifact.create({
    docType: "session_plan", subject, classLevel,
    address: { anchorWord: WORD, number: opts.n, title: `t${opts.n}` },
    curationTag: "KEEP_AS_IS", reviewStatus: status, importedBy: oid(),
    envelopeJson: { payload: { session_plan: { period_index: 1 } } },
  });
  const questions = [];
  for (let i = 0; i < (opts.q ?? 2); i += 1) {
    questions.push(
      await ContentArtifact.create({
        docType: "question", subject, classLevel,
        address: { anchorWord: WORD, number: opts.n },
        curationTag: "KEEP_AS_IS", reviewStatus: status, importedBy: oid(),
        envelopeJson: { payload: { qid: `${subject}-C${classLevel}-U${opts.n}-Q${i + 1}` } },
      }),
    );
  }
  return { plan, questions };
}

/** The reviewer already holds a live task for a chapter (their current book). */
async function liveTask(chapterNo: string, classLevel = 1) {
  await ReviewTask.create({
    programId: new Types.ObjectId(programId), batch: 1, reviewerId: ME, kind: "PLAN_CHAPTER", subject: "BAN", classLevel, anchorWord: WORD,
    chapter: chapterNo, status: "OPEN", createdBy: PRINCIPAL,
  });
}

async function openRound(artifactId: Types.ObjectId, reviewer: Types.ObjectId, chapterNo: string, status: "assigned" | "submitted" = "assigned", classLevel = 1) {
  await ReviewAssignment.create({
    docType: "session_plan", subject: "BAN", classLevel, anchorWord: WORD, addressNumber: chapterNo, sessionIndex: 1,
    artifactId, reviewerId: reviewer, assignedBy: PRINCIPAL, roundNumber: 1, status,
    verdict: status === "submitted" ? "APPROVE" : undefined,
  });
}

const myRounds = (status?: string) => ReviewAssignment.find({ reviewerId: ME, ...(status ? { status } : {}) }).lean();

beforeEach(async () => {
  jest.clearAllMocks();
  await Promise.all([User, ContentArtifact, ReviewAssignment, ReviewProgram, ReviewTask, Audit].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
  PRINCIPAL = await user("Principal", "PRINCIPAL");
  ME = await user("Reviewer");
  OTHER = await user("Other");
  programId = (await createProgram({ name: "2027", batches: [{ batch: 1, name: "Batch 1", targetDate: "2026-12-15", startAt: "2026-01-01" }], actor: { id: PRINCIPAL.toString(), role: "PRINCIPAL" } })).id;
});

describe("the gate", () => {
  test("refused while a plan is still undecided (default threshold 0) - nothing is added", async () => {
    await liveTask("1");
    const c1 = await chapter({ n: 1 });
    await openRound(c1.plan._id, ME, "1"); // undecided
    await chapter({ n: 2 });
    const res = await requestMoreReview(ACTOR());
    expect(res).toMatchObject({ outcome: "STILL_OPEN", chapters: [] });
    expect(res.status).toMatchObject({ canRequest: false, reason: "STILL_OPEN", leftPlans: 1 });
    expect(await ReviewAssignment.countDocuments({ reviewerId: ME })).toBe(1);
    expect(mockEmitSelfServe).not.toHaveBeenCalled();
  });

  test("questions: allowed at or under the percentage, refused above it", () => {
    const s = { releasePlansLeft: 0, releaseQuestionsPct: 10 };
    expect(releaseAllowed(s, { leftPlans: 0, leftQuestions: 10, totalQuestions: 100 })).toBe(true);
    expect(releaseAllowed(s, { leftPlans: 0, leftQuestions: 11, totalQuestions: 100 })).toBe(false);
    expect(releaseAllowed(s, { leftPlans: 1, leftQuestions: 0, totalQuestions: 100 })).toBe(false);
    expect(releaseAllowed(s, { leftPlans: 0, leftQuestions: 0, totalQuestions: 0 })).toBe(true);
    expect(releaseAllowed({ releasePlansLeft: 2, releaseQuestionsPct: 0 }, { leftPlans: 2, leftQuestions: 0, totalQuestions: 5 })).toBe(true);
  });

  test("the status the button reads says why it is off", async () => {
    await liveTask("1");
    const c1 = await chapter({ n: 1 });
    await openRound(c1.plan._id, ME, "1");
    expect(await myReviewMoreStatus(ME.toString())).toMatchObject({ canRequest: false, reason: "STILL_OPEN", leftPlans: 1, maxRequestsPerDay: 2, chunkChapters: 2 });
    await ReviewAssignment.updateMany({ reviewerId: ME }, { $set: { status: "submitted", verdict: "APPROVE" } });
    expect(await myReviewMoreStatus(ME.toString())).toMatchObject({ canRequest: true, reason: null });
  });

  test("the Principal can switch it off", async () => {
    await liveTask("1");
    await chapter({ n: 2 });
    await updateSelfServeSettings({ programId, enabled: false, actor: { id: PRINCIPAL.toString(), role: "PRINCIPAL" } });
    expect((await requestMoreReview(ACTOR())).outcome).toBe("NOT_ENABLED");
  });
});

describe("the chunk", () => {
  test("gives the next 2 parked chapters, ONE Principal notice and none for the reviewer, one audit row", async () => {
    // Chapter 1 is done and reviewed; chapters 2-5 are parked (draft, no open round).
    await liveTask("1");
    const c1 = await chapter({ n: 1, status: "reviewed" });
    await openRound(c1.plan._id, ME, "1", "submitted");
    for (const n of [2, 3, 4, 5]) await chapter({ n });
    await ReviewTask.create({ programId: new Types.ObjectId(programId), batch: 1, reviewerId: ME, kind: "PLAN_CHAPTER", subject: "BAN", classLevel: 1, anchorWord: WORD, chapter: "2", status: "CANCELLED", createdBy: PRINCIPAL });

    const res = await requestMoreReview(ACTOR());
    expect(res).toMatchObject({ outcome: "ADDED", chapters: ["2", "3"], addedPlans: 2, addedQuestions: 4, anchorWord: WORD });
    expect(res.bookTitleBn).toContain("প্রথম শ্রেণি");
    expect((await myRounds("assigned")).map((r) => r.addressNumber).sort()).toEqual(["2", "2", "2", "3", "3", "3"]);
    // The parked chapter 2 is re-created as a live task next to the cancelled one.
    expect(await ReviewTask.countDocuments({ reviewerId: ME, chapter: "2", status: "OPEN" })).toBe(1);
    expect(await ReviewTask.countDocuments({ reviewerId: ME, chapter: "3", status: "OPEN" })).toBe(1);

    expect(mockEmitTask).not.toHaveBeenCalled();
    expect(mockEmitSelfServe).toHaveBeenCalledTimes(1);
    expect(mockEmitSelfServe.mock.calls[0][0]).toMatchObject({ principalId: PRINCIPAL.toString(), reviewerName: "Reviewer", chapters: ["2", "3"], plans: 2, questions: 4 });
    expect(reviewSelfServeNoticeBody(mockEmitSelfServe.mock.calls[0][0])).toBe(
      "Reviewer নিজে পরের কাজ নিলেন: প্রথম শ্রেণি · বাংলা · অধ্যায় ২, ৩ (২টি পাঠ পরিকল্পনা ও ৪টি প্রশ্ন)।",
    );
    const audits = await Audit.find({ eventKind: "REVIEW_SELF_SERVE" }).lean();
    expect(audits).toHaveLength(1);
    expect(audits[0].meta).toMatchObject({ what: "requested", chapters: ["2", "3"], plans: 2, questions: 4 });
    // The new work is open, so the next request is refused until it is done.
    expect((await requestMoreReview(ACTOR())).outcome).toBe("STILL_OPEN");
  });

  test("a chapter that already sits with someone else is skipped", async () => {
    await liveTask("1");
    const c1 = await chapter({ n: 1, status: "reviewed" });
    await openRound(c1.plan._id, ME, "1", "submitted");
    const c2 = await chapter({ n: 2 });
    for (const [i, q] of c2.questions.entries()) {
      await ReviewAssignment.create({
        docType: "question", subject: "BAN", classLevel: 1, anchorWord: WORD, addressNumber: "2", qid: `BAN-C1-U2-Q${i + 1}`,
        artifactId: q._id, reviewerId: OTHER, assignedBy: PRINCIPAL, roundNumber: 1, status: "assigned",
      });
    }
    await openRound(c2.plan._id, OTHER, "2");
    await chapter({ n: 3 });
    await chapter({ n: 4 });
    const res = await requestMoreReview(ACTOR());
    expect(res).toMatchObject({ outcome: "ADDED", chapters: ["3", "4"] });
    expect(await ReviewAssignment.countDocuments({ reviewerId: OTHER, status: "assigned" })).toBe(3);
  });

  test("the chunk size is the Principal's setting", async () => {
    await liveTask("1");
    for (const n of [2, 3, 4]) await chapter({ n });
    await updateSelfServeSettings({ programId, chunkChapters: 3, actor: { id: PRINCIPAL.toString(), role: "PRINCIPAL" } });
    expect((await requestMoreReview(ACTOR())).chapters).toEqual(["2", "3", "4"]);
  });
});

describe("the ladder", () => {
  test("at the end of a book it moves on to the same subject's next class", async () => {
    await liveTask("1");
    const c1 = await chapter({ n: 1, status: "reviewed" });
    await openRound(c1.plan._id, ME, "1", "submitted");
    // Class 1 has nothing draft left; class 2 and 3 do.
    await chapter({ classLevel: 2, n: 1 });
    await chapter({ classLevel: 2, n: 2 });
    await chapter({ classLevel: 2, n: 3 });
    await chapter({ classLevel: 3, n: 1 });
    await chapter({ n: 1, status: "gold", subject: "ENG" }); // another subject: never on this ladder

    expect((await defaultLadder(ME)).map((b) => [b.subject, b.classLevel])).toEqual([["BAN", 1], ["BAN", 2], ["BAN", 3]]);
    const res = await requestMoreReview(ACTOR());
    expect(res).toMatchObject({ outcome: "ADDED", chapters: ["1", "2"] });
    expect(res.bookTitleBn).toContain("দ্বিতীয় শ্রেণি");
    // Only class 2 chapters were given: one book per request.
    expect(new Set((await myRounds("assigned")).map((r) => r.classLevel))).toEqual(new Set([2]));
  });

  test("nothing left on the ladder says so, and adds nothing", async () => {
    await liveTask("1");
    const c1 = await chapter({ n: 1, status: "reviewed" });
    await openRound(c1.plan._id, ME, "1", "submitted");
    const res = await requestMoreReview(ACTOR());
    expect(res).toMatchObject({ outcome: "NOTHING_LEFT", chapters: [] });
    expect(mockEmitSelfServe).not.toHaveBeenCalled();
    expect(await Audit.countDocuments({ eventKind: "REVIEW_SELF_SERVE" })).toBe(0);
  });

  test("a custom ladder wins over the default and is audited; resetting restores the default", async () => {
    await liveTask("1");
    await chapter({ n: 2 }); // default ladder would take this
    await chapter({ classLevel: 3, n: 1 });
    const principal = { id: PRINCIPAL.toString(), role: "PRINCIPAL" };
    const ov = await setReviewerLadder({
      programId, reviewerId: ME.toString(), books: [{ subject: "BAN", classLevel: 3, anchorWord: WORD }, { subject: "BAN", classLevel: 3, anchorWord: WORD }], actor: principal,
    });
    const mine = ov.ladders.find((l) => l.reviewerId === ME.toString())!;
    expect(mine).toMatchObject({ custom: true });
    expect(mine.books).toHaveLength(1); // a repeated book is dropped
    expect((await requestMoreReview(ACTOR())).chapters).toEqual(["1"]);
    expect((await myRounds("assigned")).every((r) => r.classLevel === 3)).toBe(true);

    const reset = await setReviewerLadder({ programId, reviewerId: ME.toString(), books: null, actor: principal });
    expect(reset.ladders.find((l) => l.reviewerId === ME.toString())).toMatchObject({ custom: false });
    const kinds = (await Audit.find({ eventKind: "REVIEW_SELF_SERVE" }).lean()).map((a) => (a.meta as { what: string }).what).sort();
    expect(kinds).toEqual(["ladder_reset", "ladder_set", "requested"]);
  });
});

describe("the daily cap", () => {
  test("the second request of the day is refused once the cap is reached", async () => {
    await liveTask("1");
    for (const n of [2, 3, 4]) await chapter({ n });
    const principal = { id: PRINCIPAL.toString(), role: "PRINCIPAL" };
    await updateSelfServeSettings({ programId, chunkChapters: 1, maxRequestsPerDay: 1, actor: principal });
    expect((await requestMoreReview(ACTOR())).outcome).toBe("ADDED");
    // Finish what was given, so only the cap can refuse.
    await ReviewAssignment.updateMany({ reviewerId: ME, status: "assigned" }, { $set: { status: "submitted", verdict: "APPROVE" } });
    const second = await requestMoreReview(ACTOR());
    expect(second).toMatchObject({ outcome: "DAILY_CAP", chapters: [] });
    expect(second.status).toMatchObject({ requestsToday: 1, maxRequestsPerDay: 1 });
    // Another reviewer has their own count.
    expect((await myReviewMoreStatus(OTHER.toString())).requestsToday).toBe(0);
  });

  test("a request from yesterday does not count", async () => {
    await liveTask("1");
    await chapter({ n: 2 });
    await Audit.create({
      eventKind: "REVIEW_SELF_SERVE", actorId: ME, eventAt: new Date(Date.now() - 2 * 24 * 3600 * 1000), meta: { what: "requested" },
    });
    expect((await myReviewMoreStatus(ME.toString())).requestsToday).toBe(0);
  });
});

describe("the Principal's settings", () => {
  const principal = () => ({ id: PRINCIPAL.toString(), role: "PRINCIPAL" });

  test("defaults, validation and an audit row per change", async () => {
    const first = await selfServeOverview(programId);
    expect(first.settings).toEqual({ enabled: true, chunkChapters: 2, releasePlansLeft: 0, releaseQuestionsPct: 10, maxRequestsPerDay: 2 });
    await expect(updateSelfServeSettings({ programId, chunkChapters: 0, actor: principal() })).rejects.toThrow(/Chapters per request/);
    await expect(updateSelfServeSettings({ programId, releaseQuestionsPct: 101, actor: principal() })).rejects.toThrow(/percent/);
    const next = await updateSelfServeSettings({ programId, chunkChapters: 4, releaseQuestionsPct: 20, actor: principal() });
    expect(next.settings).toMatchObject({ chunkChapters: 4, releaseQuestionsPct: 20, maxRequestsPerDay: 2 });
    const audits = await Audit.find({ eventKind: "REVIEW_SELF_SERVE" }).lean();
    expect(audits).toHaveLength(1);
    expect(audits[0].meta).toMatchObject({ what: "settings_updated" });
  });

  test("the overview lists the reviewers with their ladder and every book that has plans", async () => {
    await liveTask("1");
    await chapter({ n: 1 });
    await chapter({ classLevel: 2, n: 1 });
    const ov = await selfServeOverview(programId);
    expect(ov.ladders).toHaveLength(1);
    expect(ov.ladders[0]).toMatchObject({ reviewerName: "Reviewer", custom: false });
    expect(ov.ladders[0].books.map((b) => b.classLevel)).toEqual([1, 2]);
    expect(ov.availableBooks.map((b) => b.classLevel)).toEqual([1, 2]);
    await expect(setReviewerLadder({ programId, reviewerId: ME.toString(), books: [{ subject: "", classLevel: 1, anchorWord: WORD }], actor: principal() })).rejects.toThrow(/needs a subject/);
  });
});
