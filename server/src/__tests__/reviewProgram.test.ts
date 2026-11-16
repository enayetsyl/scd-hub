/**
 * Review supervision, slice RS-1 (.claude/plans/review-supervision.md).
 *
 *   adopt     open rounds become tasks (reviewer x book x class x chapter); re-running creates
 *             nothing new; a moved task is not re-created from its decided leftovers
 *   progress  plans/questions done = round has a verdict; changes; weighted minutes
 *   move      untouched rounds move, decided rounds stay with who decided them, ONE notice
 *   add       plans that already have an open round are skipped; ONE summary notice
 *   cancel    untouched rounds are cancelled, decided ones are left alone
 *   board     the work board shows ONE PLAN_REVIEW card per reviewer x chapter
 *   gate      review_program:supervise / :manage are Principal-only by default
 *
 * In-memory MongoDB, real services; the notification emitters are counted, not sent.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { roleHasPermission } from "@scd/shared";

const mockEmitPlan = jest.fn().mockResolvedValue(undefined);
const mockEmitQuestion = jest.fn().mockResolvedValue(undefined);
const mockEmitTask = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/notifications/services/emitters", () => ({
  ...jest.requireActual("../modules/notifications/services/emitters"),
  emitReviewAssigned: (...a: unknown[]) => mockEmitPlan(...a),
  emitQuestionReviewAssigned: (...a: unknown[]) => mockEmitQuestion(...a),
  emitReviewTaskNotice: (...a: unknown[]) => mockEmitTask(...a),
}));

import { User } from "../modules/foundation/models/User";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { ReviewAssignment } from "../modules/content/models/ReviewAssignment";
import { ReviewProgram } from "../modules/review-program/models/ReviewProgram";
import { ReviewTask } from "../modules/review-program/models/ReviewTask";
import {
  addTask,
  adoptOpenAssignments,
  cancelTask,
  createProgram,
  moveTask,
  reviewProgramOverview,
  reviewTasks,
  setTaskDue,
  updateBatch,
  isRealDateKey,
} from "../modules/review-program/services/ReviewProgramService";
import { reviewTaskNoticeBody } from "../modules/notifications/services/emitters";
import { planReviewCards } from "../modules/workboard/services/WorkBoardService";

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const oid = () => new Types.ObjectId();
let ACTOR: { id: string; role: string };
let SAJEDA: Types.ObjectId;
let JERIN: Types.ObjectId;
let programId: string;

async function user(name: string, role = "TEACHER"): Promise<Types.ObjectId> {
  const u = await User.create({ name, role, passwordHash: "x", phone: `0${Math.floor(Math.random() * 1e9)}${name.length}` });
  return u._id;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await Promise.all([User, ContentArtifact, ReviewAssignment, ReviewProgram, ReviewTask].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
  ACTOR = { id: (await user("Owner", "PRINCIPAL")).toString(), role: "PRINCIPAL" };
  SAJEDA = await user("Sajeda");
  JERIN = await user("Jerin");
  const p = await createProgram({ name: "2027", batches: [{ batch: 1, name: "Batch 1", targetDate: "2026-12-15" }], actor: ACTOR });
  programId = p.id;
});

interface RoundSeed {
  reviewer: Types.ObjectId;
  docType?: string;
  subject?: string;
  classLevel?: number;
  anchorWord?: string;
  chapter: string;
  n?: number;
  verdict?: "APPROVE" | "CHANGES_REQUESTED" | "APPROVE_WITH_CONDITION";
}
let seq = 0;
async function rounds(s: RoundSeed): Promise<void> {
  const docs = [];
  for (let i = 0; i < (s.n ?? 1); i += 1) {
    seq += 1;
    const dt = s.docType ?? "session_plan";
    docs.push({
      docType: dt,
      subject: s.subject ?? "BAN",
      classLevel: s.classLevel ?? 1,
      anchorWord: s.anchorWord ?? "পাঠ",
      addressNumber: s.chapter,
      qid: dt === "question" ? `Q${seq}` : undefined,
      sessionIndex: dt === "session_plan" ? seq : undefined,
      artifactId: oid(),
      reviewerId: s.reviewer,
      assignedBy: oid(),
      assignedAt: new Date(),
      roundNumber: 1,
      status: s.verdict ? "submitted" : "assigned",
      verdict: s.verdict,
      submittedAt: s.verdict ? new Date() : undefined,
    });
  }
  await ReviewAssignment.insertMany(docs);
}

describe("adopt + progress", () => {
  test("groups by reviewer x chapter, is idempotent, and counts progress from the verdicts", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 3 });
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 2, verdict: "APPROVE" });
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 1, verdict: "CHANGES_REQUESTED" });
    await rounds({ reviewer: SAJEDA, chapter: "1", docType: "question", n: 10 });
    await rounds({ reviewer: SAJEDA, chapter: "1", docType: "question", n: 4, verdict: "APPROVE_WITH_CONDITION" });
    await rounds({ reviewer: SAJEDA, chapter: "2", n: 2 });
    await rounds({ reviewer: JERIN, chapter: "1", n: 2 });

    const first = await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    expect(first.created).toBe(3);
    const again = await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    expect(again).toMatchObject({ created: 0, alreadyTasks: 3 });
    expect(await ReviewTask.countDocuments({})).toBe(3);

    const tasks = await reviewTasks({ programId, batch: 1, reviewerId: SAJEDA.toString() });
    const ch1 = tasks.find((t) => t.chapter === "1")!;
    expect(ch1.progress).toMatchObject({
      plansTotal: 6, plansDone: 3, questionsTotal: 14, questionsDone: 4, changes: 5,
      minutesTotal: 6 * 10 + 14, minutesDone: 3 * 10 + 4, minutesRemaining: 3 * 10 + 10,
    });
    expect(ch1.status).toBe("OPEN");

    const ov = await reviewProgramOverview(programId, 1);
    expect(ov.targetDate).toBe("2026-12-15");
    const row = ov.reviewers.find((r) => r.reviewerName === "Sajeda")!;
    expect(row).toMatchObject({ tasks: 2, plansTotal: 8, plansDone: 3, questionsTotal: 14, questionsDone: 4 });
    expect(ov.totals.plansTotal).toBe(10);
  });

  test("a fully reviewed task reads DONE", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "3", n: 2, verdict: "APPROVE" });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    const [t] = await reviewTasks({ programId, batch: 1 });
    expect(t.status).toBe("DONE");
  });

  test("batch target date and task due date are validated and saved", async () => {
    const p = await updateBatch({ programId, batch: 1, targetDate: "2026-12-20", actor: ACTOR });
    expect(p.batches[0].targetDate).toBe("2026-12-20");
    await expect(updateBatch({ programId, batch: 1, targetDate: "20-12-2026", actor: ACTOR })).rejects.toThrow();
    await rounds({ reviewer: SAJEDA, chapter: "1" });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    const [t] = await reviewTasks({ programId, batch: 1 });
    const due = await setTaskDue({ taskId: t.id, dueKey: "2026-12-01", actor: ACTOR });
    expect(due.dueKey).toBe("2026-12-01");
  });
});

describe("moveTask", () => {
  test("untouched rounds move, decided rounds stay with the old reviewer, one notice, no re-adopt", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 3 });
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 2, verdict: "APPROVE" });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    const [t] = await reviewTasks({ programId, batch: 1 });

    const moved = await moveTask({ taskId: t.id, toReviewerId: JERIN.toString(), actor: ACTOR });
    expect(moved.reviewerId).toBe(JERIN.toString());
    expect(moved.progress).toMatchObject({ plansTotal: 3, plansDone: 0, doneByOthers: 2 });

    expect(await ReviewAssignment.countDocuments({ reviewerId: JERIN, status: "assigned" })).toBe(3);
    expect(await ReviewAssignment.countDocuments({ reviewerId: SAJEDA, status: "submitted", verdict: "APPROVE" })).toBe(2);
    expect(mockEmitPlan).not.toHaveBeenCalled();
    expect(mockEmitQuestion).not.toHaveBeenCalled();
    expect(mockEmitTask).toHaveBeenCalledTimes(1);
    expect(mockEmitTask.mock.calls[0][0]).toMatchObject({ reviewerId: JERIN.toString(), plans: 3 });
    expect(moved.history.map((h) => h.action)).toEqual(["adopted", "moved"]);

    // Sajeda's decided leftovers do not become a new task of hers.
    const again = await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    expect(again.created).toBe(0);
    expect(again.creditedLeftovers).toBe(1);

    // Credit stays with who decided: Sajeda's row still shows her 2 reviewed plans.
    const ov = await reviewProgramOverview(programId, 1);
    expect(ov.reviewers.find((r) => r.reviewerName === "Sajeda")).toMatchObject({ plansDone: 2, plansTotal: 2 });
    expect(ov.reviewers.find((r) => r.reviewerName === "Jerin")).toMatchObject({ plansDone: 0, plansTotal: 3 });
  });

  test("a task with nothing untouched cannot be moved", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 2, verdict: "APPROVE" });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    const [t] = await reviewTasks({ programId, batch: 1 });
    await expect(moveTask({ taskId: t.id, toReviewerId: JERIN.toString(), actor: ACTOR })).rejects.toThrow(/Nothing untouched/);
  });

  test("moving onto a reviewer who already holds the chapter merges the tasks", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 2 });
    await rounds({ reviewer: JERIN, chapter: "1", n: 1 });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    const sajeda = (await reviewTasks({ programId, batch: 1, reviewerId: SAJEDA.toString() }))[0];
    const merged = await moveTask({ taskId: sajeda.id, toReviewerId: JERIN.toString(), actor: ACTOR });
    expect(merged.reviewerId).toBe(JERIN.toString());
    expect(merged.progress.plansTotal).toBe(3);
    expect(await ReviewTask.countDocuments({ status: { $ne: "CANCELLED" } })).toBe(1);
  });
});

describe("cancelTask", () => {
  test("cancels untouched plan and question rounds, leaves decided ones", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 2 });
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 1, verdict: "APPROVE" });
    await rounds({ reviewer: SAJEDA, chapter: "1", docType: "question", n: 5 });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    const [t] = await reviewTasks({ programId, batch: 1 });
    const res = await cancelTask({ taskId: t.id, actor: ACTOR });
    expect(res).toEqual({ cancelledPlans: 2, cancelledQuestions: 5 });
    expect(await ReviewAssignment.countDocuments({ status: "cancelled" })).toBe(7);
    expect(await ReviewAssignment.countDocuments({ status: "submitted" })).toBe(1);
  });
});

describe("addTask", () => {
  async function plan(chapter: number, session: number, reviewStatus = "draft") {
    return ContentArtifact.create({
      docType: "session_plan", subject: "BAN", classLevel: 1,
      address: { anchorWord: "পাঠ", number: chapter, title: `t${session}` },
      curationTag: "KEEP_AS_IS", reviewStatus, importedBy: oid(),
      envelopeJson: { payload: { session_plan: { period_index: session } } },
    });
  }
  async function question(chapter: number, qid: string) {
    return ContentArtifact.create({
      docType: "question", subject: "BAN", classLevel: 1,
      address: { anchorWord: "পাঠ", number: chapter },
      curationTag: "KEEP_AS_IS", reviewStatus: "draft", importedBy: oid(),
      envelopeJson: { payload: { qid } },
    });
  }

  test("assigns draft plans with no open round + the chapter's questions, one summary notice", async () => {
    const p1 = await plan(4, 1);
    await plan(4, 2);
    await plan(4, 3, "reviewed"); // already reviewed: not draft, skipped
    await question(4, "QA");
    await question(4, "QB");
    // Plan session 1 already has an open round with Jerin: must be skipped, not superseded.
    await ReviewAssignment.create({
      docType: "session_plan", subject: "BAN", classLevel: 1, anchorWord: "পাঠ", addressNumber: "4", sessionIndex: 1,
      artifactId: p1._id, reviewerId: JERIN, assignedBy: oid(), roundNumber: 1, status: "assigned",
    });

    const res = await addTask({ programId, batch: 1, reviewerId: SAJEDA.toString(), subject: "BAN", classLevel: 1, anchorWord: "পাঠ", chapter: "4", actor: ACTOR });
    expect(res).toMatchObject({ assignedPlans: 1, skippedPlans: 1, assignedQuestions: 2 });
    expect(await ReviewAssignment.countDocuments({ reviewerId: JERIN, status: "assigned" })).toBe(1);
    expect(mockEmitPlan).not.toHaveBeenCalled();
    expect(mockEmitQuestion).not.toHaveBeenCalled();
    expect(mockEmitTask).toHaveBeenCalledTimes(1);
    expect(mockEmitTask.mock.calls[0][0]).toMatchObject({ plans: 1, questions: 2, chapter: "4" });
    expect(res.task.progress).toMatchObject({ plansTotal: 1, questionsTotal: 2 });

    // Adding again: nothing is free any more.
    await expect(
      addTask({ programId, batch: 1, reviewerId: SAJEDA.toString(), subject: "BAN", classLevel: 1, anchorWord: "পাঠ", chapter: "4", actor: ACTOR }),
    ).rejects.toThrow(/Nothing to add/);
  });
});

describe("work board", () => {
  test("one PLAN_REVIEW card per reviewer x chapter with the count", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 30 });
    await rounds({ reviewer: SAJEDA, chapter: "2", n: 5 });
    const cards = await planReviewCards([SAJEDA.toString()], "2026-11-16");
    const plan = cards.filter((c) => c.kind === "PLAN_REVIEW");
    expect(plan).toHaveLength(2);
    const big = plan.find((c) => c.effortMin > plan.reduce((m, c2) => Math.min(m, c2.effortMin), 1e9))!;
    expect(big.effortMin / plan.reduce((m, c2) => Math.min(m, c2.effortMin), 1e9)).toBe(6);
  });
});

describe("batch window, owner actions, anchor words (review fixes)", () => {
  test("rounds flipped to superseded with their verdict (owner approved / published) still count as done", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 2 });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    // The owner signs off a plan and publishes a question: the rounds leave assigned|submitted
    // but keep their verdict (D-#537).
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 1, verdict: "APPROVE" });
    await rounds({ reviewer: SAJEDA, chapter: "1", docType: "question", n: 3, verdict: "APPROVE" });
    await ReviewAssignment.updateMany({ verdict: "APPROVE" }, { $set: { status: "superseded" } });
    const [t] = await reviewTasks({ programId, batch: 1 });
    expect(t.progress).toMatchObject({ plansTotal: 3, plansDone: 1, questionsTotal: 3, questionsDone: 3 });
  });

  test("a task whose every round is decided and none open reads DONE", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "5", n: 2, verdict: "APPROVE" });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    await ReviewAssignment.updateMany({}, { $set: { status: "superseded" } });
    const [t] = await reviewTasks({ programId, batch: 1 });
    expect(t.status).toBe("DONE");
  });

  test("a re-import's new open round replaces the old superseded one (no double count)", async () => {
    const art = oid();
    const base = { docType: "session_plan", subject: "BAN", classLevel: 1, anchorWord: "পাঠ", addressNumber: "6", sessionIndex: 1, artifactId: art, assignedBy: oid() };
    await ReviewAssignment.create({ ...base, reviewerId: SAJEDA, roundNumber: 1, status: "superseded", verdict: "APPROVE" });
    await ReviewAssignment.create({ ...base, reviewerId: SAJEDA, roundNumber: 2, status: "assigned" });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    const [t] = await reviewTasks({ programId, batch: 1 });
    expect(t.progress).toMatchObject({ plansTotal: 1, plansDone: 0 });
  });

  test("the batch startAt keeps older open rounds out of adopt, progress and summary", async () => {
    await updateBatch({ programId, batch: 1, startAt: "2026-11-16T14:00:00.000Z", actor: ACTOR });
    // Old rounds (a scholarship run) assigned before the batch started.
    await rounds({ reviewer: SAJEDA, chapter: "1", docType: "question", n: 4 });
    await rounds({ reviewer: JERIN, chapter: "1", n: 2, verdict: "APPROVE" });
    await ReviewAssignment.updateMany({}, { $set: { assignedAt: new Date("2026-11-10T00:00:00Z") } });
    // Batch rounds.
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 3 });
    await ReviewAssignment.updateMany({ assignedAt: { $gt: new Date("2026-11-11") } }, { $set: { assignedAt: new Date("2026-11-16T15:00:00Z") } });
    const res = await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    expect(res.created).toBe(1);
    const [t] = await reviewTasks({ programId, batch: 1 });
    expect(t.progress).toMatchObject({ plansTotal: 3, questionsTotal: 0 });
    const ov = await reviewProgramOverview(programId, 1);
    expect(ov.reviewers.map((r) => r.reviewerName)).toEqual(["Sajeda"]);
    // An explicit assignedAfter in the future adopts nothing.
    const none = await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR, assignedAfter: new Date("2027-01-01") });
    expect(none.created).toBe(0);
  });

  test("adopt is order-independent: a decided leftover next to an active holder never becomes a task", async () => {
    // JERIN (listed first by id order or not) has only decided work; SAJEDA has open work.
    await rounds({ reviewer: JERIN, chapter: "1", n: 2, verdict: "APPROVE" });
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 2 });
    const res = await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    expect(res).toMatchObject({ created: 1, creditedLeftovers: 1 });
    const [t] = await reviewTasks({ programId, batch: 1 });
    expect(t.reviewerId).toBe(SAJEDA.toString());
  });

  test("question rounds with a different anchorWord belong to the same chapter task", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "2", n: 2, anchorWord: "পাঠ" });
    await rounds({ reviewer: SAJEDA, chapter: "2", docType: "question", n: 5, anchorWord: "Unit" });
    const res = await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    expect(res.created).toBe(1);
    const [t] = await reviewTasks({ programId, batch: 1 });
    expect(t.anchorWord).toBe("পাঠ");
    expect(t.progress).toMatchObject({ plansTotal: 2, questionsTotal: 5 });
    const moved = await moveTask({ taskId: t.id, toReviewerId: JERIN.toString(), actor: ACTOR });
    expect(moved.progress).toMatchObject({ plansTotal: 2, questionsTotal: 5 });
    expect(await ReviewAssignment.countDocuments({ reviewerId: JERIN, docType: "question" })).toBe(5);
  });

  test("two books sharing chapter 1 in one subject x class stay two tasks; questions follow their own anchorWord", async () => {
    await rounds({ reviewer: SAJEDA, subject: "ISLAM", chapter: "1", n: 2, anchorWord: "অধ্যায়" });
    await rounds({ reviewer: SAJEDA, subject: "ISLAM", chapter: "1", n: 3, anchorWord: "পাঠ" });
    await rounds({ reviewer: SAJEDA, subject: "ISLAM", chapter: "1", docType: "question", n: 4, anchorWord: "অধ্যায়" });
    await rounds({ reviewer: SAJEDA, subject: "ISLAM", chapter: "1", docType: "question", n: 5, anchorWord: "পাঠ" });
    await rounds({ reviewer: SAJEDA, subject: "ISLAM", chapter: "1", docType: "question", n: 7, anchorWord: "Other" });
    const res = await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    expect(res.created).toBe(3); // the unmatched "Other" questions get no plan-side book, so their own task
    const tasks = await reviewTasks({ programId, batch: 1 });
    const adhyay = tasks.find((t) => t.anchorWord === "অধ্যায়")!;
    const path = tasks.find((t) => t.anchorWord === "পাঠ")!;
    expect(adhyay.progress).toMatchObject({ plansTotal: 2, questionsTotal: 4 });
    expect(path.progress).toMatchObject({ plansTotal: 3, questionsTotal: 5 });
    // Moving one book's task leaves the other book's rounds alone.
    await moveTask({ taskId: adhyay.id, toReviewerId: JERIN.toString(), actor: ACTOR });
    expect(await ReviewAssignment.countDocuments({ reviewerId: JERIN, anchorWord: "অধ্যায়" })).toBe(6);
    expect(await ReviewAssignment.countDocuments({ reviewerId: JERIN, anchorWord: "পাঠ" })).toBe(0);
    expect(await ReviewAssignment.countDocuments({ reviewerId: SAJEDA, anchorWord: "পাঠ" })).toBe(8);
  });

  test("the DB refuses a second live task for the same reviewer and chapter; a cancelled one does not block", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "1", n: 1 });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    const [t] = await reviewTasks({ programId, batch: 1 });
    const dup = { programId: new Types.ObjectId(programId), batch: 1, reviewerId: SAJEDA, kind: "PLAN_CHAPTER", subject: "BAN", classLevel: 1, anchorWord: "পাঠ", chapter: "1", status: "OPEN", createdBy: oid() };
    await expect(ReviewTask.create(dup)).rejects.toMatchObject({ code: 11000 });
    await cancelTask({ taskId: t.id, actor: ACTOR });
    await expect(ReviewTask.create(dup)).resolves.toBeDefined();
  });

  test("cancelling a task writes one REVIEW_CANCELLED audit per closed question round", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "1", docType: "question", n: 3 });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    const [t] = await reviewTasks({ programId, batch: 1 });
    await cancelTask({ taskId: t.id, actor: ACTOR });
    const { Audit } = await import("../modules/platform/models/Audit");
    expect(await Audit.countDocuments({ eventKind: "REVIEW_CANCELLED", "meta.taskId": t.id })).toBe(3);
  });

  test("impossible dates are refused", async () => {
    expect(isRealDateKey("2026-02-31")).toBe(false);
    expect(isRealDateKey("2026-12-15")).toBe(true);
    await expect(updateBatch({ programId, batch: 1, targetDate: "2026-02-31", actor: ACTOR })).rejects.toThrow();
    await rounds({ reviewer: SAJEDA, chapter: "1" });
    await adoptOpenAssignments({ programId, batch: 1, actor: ACTOR });
    const [t] = await reviewTasks({ programId, batch: 1 });
    await expect(setTaskDue({ taskId: t.id, dueKey: "2026-13-01", actor: ACTOR })).rejects.toThrow();
  });

  test("the task notice reads in Bangla: ordinal class, own anchor word, Bangla digits, no zero side", () => {
    const body = reviewTaskNoticeBody({ reviewerId: "x", subject: "BAN", classLevel: 2, chapter: "13", anchorWord: "Unit", plans: 30, questions: 0, stamp: "s" });
    expect(body).toContain("দ্বিতীয় শ্রেণি");
    expect(body).toContain("Unit ১৩");
    expect(body).toContain("৩০টি পাঠ পরিকল্পনা");
    expect(body).not.toContain("প্রশ্ন");
    expect(body).not.toMatch(/[0-9]/);
  });

  test("the grouped card opens the lowest session and does not repeat পাঠ", async () => {
    await rounds({ reviewer: SAJEDA, chapter: "3", n: 3 });
    const all = await ReviewAssignment.find({}).sort({ sessionIndex: -1 });
    const lowest = (await ReviewAssignment.find({}).sort({ sessionIndex: 1 }).limit(1))[0];
    expect(all.length).toBe(3);
    const [card] = await planReviewCards([SAJEDA.toString()], "2026-11-16");
    expect(card.sourceId).toBe(lowest._id.toString());
    expect(card.titleBn).toContain("পাঠ ৩ · ৩টি পরিকল্পনা");
    expect(card.titleBn).not.toContain("পাঠ ৩ · ৩টি পাঠ");
  });
});

describe("permission gate", () => {
  test("review_program:supervise / :manage are Principal-only by default", () => {
    for (const perm of ["review_program:supervise", "review_program:manage"] as const) {
      expect(roleHasPermission("PRINCIPAL", perm)).toBe(true);
      expect(roleHasPermission("TEACHER", perm)).toBe(false);
      expect(roleHasPermission("OFFICE", perm)).toBe(false);
    }
  });
});
