/**
 * Reviewer hub H-1 (.claude/plans/review-hub-and-quality.md) — myReviewHub.
 *
 *   gating   a section appears only when the caller holds that review's permission
 *   counts   plan / question rounds group by chapter; `left` = rounds still awaiting a verdict;
 *            a fully decided chapter is not listed
 *   due      the due date comes from the reviewer's program task for that chapter
 *   cards    a manual work-board card worded as a review shows up; a finished one does not
 *   scope    another reviewer's rounds never appear
 *
 * In-memory MongoDB, real service.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { Permission } from "@scd/shared";
import type { AppContext } from "../context";
import { User } from "../modules/foundation/models/User";
import { ReviewAssignment } from "../modules/content/models/ReviewAssignment";
import { ReviewTask } from "../modules/review-program/models/ReviewTask";
import { Task } from "../modules/workboard/models/Task";
import { myReviewHub } from "../modules/review-program/services/ReviewHubService";

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
const REVIEW_PERMS: Permission[] = [
  "plan_review:review",
  "question_review:review",
  "exam_papers:review",
  "mastery:review",
  "classroom_observation:review",
  "free_mixing_review:review",
  "class_test_question:prepare",
  "book_production:review",
  "winter_task:review",
];

let ME: Types.ObjectId;
let OTHER: Types.ObjectId;

function ctxFor(userId: Types.ObjectId, opts: { grant?: Permission[]; revoke?: Permission[] }): AppContext {
  return {
    auth: {
      userId: userId.toString(),
      role: "TEACHER",
      grantedPermissions: opts.grant ?? [],
      revokedPermissions: opts.revoke ?? [],
    },
  } as unknown as AppContext;
}
const asReviewer = (id: Types.ObjectId) => ctxFor(id, { grant: ["plan_review:review", "question_review:review"] });
const asNobody = (id: Types.ObjectId) => ctxFor(id, { revoke: REVIEW_PERMS });

async function round(p: {
  reviewer: Types.ObjectId;
  docType?: string;
  chapter: string;
  status: string;
  n?: number;
  subject?: string;
  classLevel?: number;
}): Promise<void> {
  for (let i = 0; i < (p.n ?? 1); i++) {
    await ReviewAssignment.create({
      docType: p.docType ?? "session_plan",
      subject: p.subject ?? "BAN",
      classLevel: p.classLevel ?? 1,
      anchorWord: "পাঠ",
      addressNumber: p.chapter,
      artifactId: oid(),
      reviewerId: p.reviewer,
      assignedBy: oid(),
      roundNumber: 1,
      status: p.status,
    });
  }
}

beforeEach(async () => {
  await Promise.all([User, ReviewAssignment, ReviewTask, Task].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
  ME = (await User.create({ name: "Me", role: "TEACHER", passwordHash: "x", phone: "01711111111" }))._id;
  OTHER = (await User.create({ name: "Other", role: "TEACHER", passwordHash: "x", phone: "01722222222" }))._id;
});

describe("myReviewHub", () => {
  test("plans and questions group by chapter; left counts only rounds awaiting a verdict", async () => {
    await round({ reviewer: ME, chapter: "3", status: "assigned", n: 2 });
    await round({ reviewer: ME, chapter: "3", status: "submitted", n: 3 });
    await round({ reviewer: ME, chapter: "5", status: "submitted", n: 4 }); // fully decided: not listed
    await round({ reviewer: ME, chapter: "3", docType: "question", status: "assigned", n: 7 });
    await round({ reviewer: OTHER, chapter: "3", status: "assigned", n: 9 }); // someone else's

    const hub = await myReviewHub(asReviewer(ME));
    const plan = hub.rows.find((r) => r.kind === "PLAN");
    const question = hub.rows.find((r) => r.kind === "QUESTION");
    expect(plan).toMatchObject({ left: 2, total: 5, tab: "ReviewTab", screen: "ReviewHome" });
    expect(plan?.titleBn).toContain("৩");
    expect(question).toMatchObject({ left: 7, total: 7, screen: "QuestionReviewQueue" });
    expect(hub.rows.filter((r) => r.kind === "PLAN")).toHaveLength(1);
    expect(hub.totalLeft).toBe(9);
  });

  test("a caller without the review permissions gets no plan or question section", async () => {
    await round({ reviewer: ME, chapter: "3", status: "assigned", n: 2 });
    await round({ reviewer: ME, chapter: "3", docType: "question", status: "assigned", n: 2 });
    const hub = await myReviewHub(asNobody(ME));
    expect(hub.rows.filter((r) => r.kind === "PLAN" || r.kind === "QUESTION")).toHaveLength(0);
    expect(hub.totalLeft).toBe(0);
  });

  test("only the plan permission: questions stay hidden", async () => {
    await round({ reviewer: ME, chapter: "3", status: "assigned" });
    await round({ reviewer: ME, chapter: "3", docType: "question", status: "assigned" });
    const hub = await myReviewHub(ctxFor(ME, { grant: ["plan_review:review"], revoke: ["question_review:review"] }));
    expect(hub.rows.map((r) => r.kind)).toEqual(["PLAN"]);
  });

  test("the due date comes from the reviewer's program task for that chapter", async () => {
    await round({ reviewer: ME, chapter: "3", status: "assigned" });
    await round({ reviewer: ME, chapter: "4", status: "assigned" });
    await ReviewTask.create({
      programId: oid(), batch: 1, reviewerId: ME, kind: "PLAN_CHAPTER", subject: "BAN", classLevel: 1,
      anchorWord: "পাঠ", chapter: "3", dueKey: "2026-11-20", status: "OPEN", createdBy: oid(),
    });
    const hub = await myReviewHub(asReviewer(ME));
    const byChapter = Object.fromEntries(hub.rows.map((r) => [r.key, r.dueKey]));
    expect(byChapter["PLAN:BAN:1:3"]).toBe("2026-11-20");
    expect(byChapter["PLAN:BAN:1:4"]).toBeNull();
    // Dated rows come first.
    expect(hub.rows[0].key).toBe("PLAN:BAN:1:3");
  });

  test("a work-board card worded as a review is listed; a done or ordinary one is not", async () => {
    const base = { assigneeUserId: ME, assignedBy: oid(), dueKey: "2026-11-19", slot: "MORNING", effortMin: 10 };
    await Task.create({ ...base, titleBn: "শ্রেণি ৩ বাংলা পর্যালোচনা", status: "TODO" });
    await Task.create({ ...base, titleBn: "রিভিউ শেষ", status: "DONE" });
    await Task.create({ ...base, titleBn: "খাতা দেখা", status: "TODO" });
    const hub = await myReviewHub(asNobody(ME));
    const cards = hub.rows.filter((r) => r.kind === "TASK");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ titleBn: "শ্রেণি ৩ বাংলা পর্যালোচনা", dueKey: "2026-11-19", tab: "WorkBoardTab", screen: "TaskDetail" });
    expect(JSON.parse(cards[0].paramsJson as string)).toHaveProperty("taskId");
  });

  test("an unauthenticated caller is refused", async () => {
    await expect(myReviewHub({ auth: null } as unknown as AppContext)).rejects.toThrow();
  });
});
