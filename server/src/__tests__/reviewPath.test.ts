/**
 * The reviewer's ONE ordered path (.claude/plans/review-next-chunk.md, Slice A) - myReviewPath.
 *
 *   order    books -> chapters in NUMBER order (2 before 10) -> items: chapter plan, session plans by
 *            session number, then ONE questions block
 *   done     a fully decided chapter sits after the undecided ones; `next` is the first undecided item
 *   label    the chapter word is always the PLAN anchorWord, even when the questions carry "Unit"
 *   open     a plan item opens ReviewSubmit; the questions block opens the queue filtered to the chapter
 *   scope    another reviewer's rounds never appear; a section needs its own review permission
 *   hub      the hub's chapter rows are in book/chapter order and a QUESTION row opens the filtered queue
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { Permission } from "@scd/shared";
import type { AppContext, AuthPayload } from "../context";
import { User } from "../modules/foundation/models/User";
import { ReviewAssignment } from "../modules/content/models/ReviewAssignment";
import { ReviewTask } from "../modules/review-program/models/ReviewTask";
import { buildReviewPath, myReviewPath } from "../modules/review-program/services/ReviewPathService";
import { myReviewHub } from "../modules/review-program/services/ReviewHubService";

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
let ME: Types.ObjectId;
let OTHER: Types.ObjectId;

const authFor = (userId: Types.ObjectId, grant: Permission[] = ["plan_review:review", "question_review:review"], revoke: Permission[] = []): AuthPayload =>
  ({ userId: userId.toString(), role: "TEACHER", grantedPermissions: grant, revokedPermissions: revoke }) as unknown as AuthPayload;

interface Seed {
  reviewer: Types.ObjectId;
  docType: "chapter_plan" | "session_plan" | "question";
  chapter: string;
  session?: number;
  anchorWord?: string;
  status?: "assigned" | "submitted";
  subject?: string;
  classLevel?: number;
  n?: number;
}
let seq = 0;
async function seed(s: Seed): Promise<void> {
  for (let i = 0; i < (s.n ?? 1); i += 1) {
    seq += 1;
    await ReviewAssignment.create({
      docType: s.docType,
      subject: s.subject ?? "BAN",
      classLevel: s.classLevel ?? 1,
      anchorWord: s.anchorWord ?? (s.docType === "question" ? "Unit" : "অধ্যায়"),
      addressNumber: s.chapter,
      qid: s.docType === "question" ? `Q${seq}` : undefined,
      sessionIndex: s.docType === "session_plan" ? s.session : undefined,
      artifactId: oid(),
      reviewerId: s.reviewer,
      assignedBy: oid(),
      roundNumber: 1,
      status: s.status ?? "assigned",
      verdict: s.status === "submitted" ? "APPROVE" : undefined,
    });
  }
}

beforeEach(async () => {
  await Promise.all([User, ReviewAssignment, ReviewTask].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
  ME = (await User.create({ name: "Me", role: "TEACHER", passwordHash: "x", phone: "01711111111" }))._id;
  OTHER = (await User.create({ name: "Other", role: "TEACHER", passwordHash: "x", phone: "01722222222" }))._id;
});

describe("myReviewPath", () => {
  test("chapters in number order; inside one: chapter plan, sessions by number, then the questions block", async () => {
    // Inserted out of order on purpose.
    await seed({ reviewer: ME, docType: "question", chapter: "10", n: 4 });
    await seed({ reviewer: ME, docType: "session_plan", chapter: "10", session: 1 });
    await seed({ reviewer: ME, docType: "question", chapter: "2", n: 3 });
    await seed({ reviewer: ME, docType: "session_plan", chapter: "2", session: 3 });
    await seed({ reviewer: ME, docType: "session_plan", chapter: "2", session: 1 });
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "2" });
    await seed({ reviewer: ME, docType: "session_plan", chapter: "2", session: 2 });
    await seed({ reviewer: OTHER, docType: "chapter_plan", chapter: "1" }); // someone else's

    const path = await myReviewPath(authFor(ME));
    expect(path.books).toHaveLength(1);
    const [book] = path.books;
    expect(book.titleBn).toContain("প্রথম শ্রেণি");
    expect(book.chapters.map((c) => c.labelBn)).toEqual(["অধ্যায় ২", "অধ্যায় ১০"]);

    const ch2 = book.chapters[0];
    expect(ch2.items.map((i) => i.kind)).toEqual(["CHAPTER_PLAN", "SESSION_PLAN", "SESSION_PLAN", "SESSION_PLAN", "QUESTIONS"]);
    expect(ch2.items.map((i) => i.titleBn)).toEqual(["অধ্যায় পরিকল্পনা", "সেশন ১", "সেশন ২", "সেশন ৩", "এই অধ্যায়ের প্রশ্ন"]);
    expect(ch2.items[4]).toMatchObject({ left: 3, total: 3, screen: "QuestionReviewQueue" });
    expect(ch2).toMatchObject({ left: 7, total: 7, chapterNo: 2 });
    expect(path.totalLeft).toBe(7 + 5);
    // `next` is the very first thing on the path: chapter 2's chapter plan.
    expect(path.next).toMatchObject({ chapterLabelBn: "অধ্যায় ২", item: { kind: "CHAPTER_PLAN", screen: "ReviewSubmit" } });
  });

  test("the chapter word is the PLAN anchorWord, even for question-only chapters ('Unit' never leaks)", async () => {
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "1" });
    await seed({ reviewer: ME, docType: "question", chapter: "1", n: 2 }); // anchorWord "Unit"
    await seed({ reviewer: ME, docType: "question", chapter: "3", n: 2 }); // chapter with questions only
    const [book] = (await myReviewPath(authFor(ME))).books;
    expect(book.chapters.map((c) => c.labelBn)).toEqual(["অধ্যায় ১", "অধ্যায় ৩"]);
    expect(book.chapters[0].items.map((i) => i.kind)).toEqual(["CHAPTER_PLAN", "QUESTIONS"]);
    expect(book.anchorWord).toBe("অধ্যায়");
  });

  test("a fully decided chapter goes after the undecided ones; next skips it", async () => {
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "1", status: "submitted" });
    await seed({ reviewer: ME, docType: "question", chapter: "1", status: "submitted", n: 2 });
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "2" });
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "10" });
    const [book] = (await myReviewPath(authFor(ME))).books;
    expect(book.chapters.map((c) => [c.chapter, c.decided])).toEqual([["2", false], ["10", false], ["1", true]]);
    expect((await myReviewPath(authFor(ME))).next?.chapterLabelBn).toBe("অধ্যায় ২");
  });

  test("within a chapter, plans already decided keep their place but `next` takes the first undecided item", async () => {
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "1", status: "submitted" });
    await seed({ reviewer: ME, docType: "session_plan", chapter: "1", session: 1, status: "submitted" });
    await seed({ reviewer: ME, docType: "session_plan", chapter: "1", session: 2 });
    await seed({ reviewer: ME, docType: "question", chapter: "1", n: 2 });
    const path = await myReviewPath(authFor(ME));
    expect(path.books[0].chapters[0].items.map((i) => i.decided)).toEqual([true, true, false, false]);
    expect(path.next?.item.titleBn).toBe("সেশন ২");
    // A decided plan reopens prefilled (the resubmit flow); an undecided one does not.
    const decided = JSON.parse(path.books[0].chapters[0].items[0].paramsJson);
    expect(decided).toMatchObject({ initialVerdict: "APPROVE", roundStatus: "submitted", fromPath: true });
  });

  test("the questions block opens the queue filtered to subject, class and chapter (undecided only while work is left)", async () => {
    await seed({ reviewer: ME, docType: "question", chapter: "4", n: 2 });
    await seed({ reviewer: ME, docType: "question", chapter: "5", n: 2, status: "submitted" });
    const [book] = (await myReviewPath(authFor(ME))).books;
    const q4 = book.chapters.find((c) => c.chapter === "4")!.items[0];
    const q5 = book.chapters.find((c) => c.chapter === "5")!.items[0];
    expect(JSON.parse(q4.paramsJson)).toEqual({ subject: "BAN", classLevel: 1, chapter: 4, undecided: true, fromPath: true });
    expect(JSON.parse(q5.paramsJson)).toEqual({ subject: "BAN", classLevel: 1, chapter: 5, fromPath: true });
  });

  test("books: the undecided one first, then by class; a decided book last", async () => {
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "1", classLevel: 1, status: "submitted" });
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "1", classLevel: 3 });
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "1", classLevel: 2 });
    const { books } = await myReviewPath(authFor(ME));
    expect(books.map((b) => b.classLevel)).toEqual([2, 3, 1]);
  });

  test("a section needs its own permission; nothing left gives an empty path", async () => {
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "1" });
    await seed({ reviewer: ME, docType: "question", chapter: "1", n: 2 });
    const plansOnly = await myReviewPath(authFor(ME, ["plan_review:review"], ["question_review:review"]));
    expect(plansOnly.books[0].chapters[0].items.map((i) => i.kind)).toEqual(["CHAPTER_PLAN"]);
    const nobody = await myReviewPath(authFor(ME, [], ["plan_review:review", "question_review:review"]));
    expect(nobody).toEqual({ books: [], next: null, totalLeft: 0 });
    const idle = await myReviewPath(authFor(OTHER));
    expect(idle).toEqual({ books: [], next: null, totalLeft: 0 });
  });

  test("the due date of a chapter comes from the reviewer's program task", async () => {
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "1" });
    await ReviewTask.create({
      programId: oid(), batch: 1, reviewerId: ME, kind: "PLAN_CHAPTER", subject: "BAN", classLevel: 1,
      anchorWord: "অধ্যায়", chapter: "1", dueKey: "2026-11-25", status: "OPEN", createdBy: oid(),
    });
    const [book] = (await myReviewPath(authFor(ME))).books;
    expect(book.chapters[0].dueKey).toBe("2026-11-25");
  });
});

describe("buildReviewPath (pure)", () => {
  test("two books of one subject x class are told apart by their word; question words map to the one plan word", () => {
    const plan = (anchorWord: string, id: string) => ({
      id, artifactId: id, docType: "chapter_plan", subject: "ISLAM", classLevel: 1, anchorWord, addressNumber: "1",
      sessionIndex: null, status: "assigned", verdict: null, feedback: null,
    });
    const path = buildReviewPath({ planRounds: [plan("অধ্যায়", "a"), plan("পাঠ", "b")], questionGroups: [] });
    expect(path.books.map((b) => b.titleBn.endsWith(b.anchorWord))).toEqual([true, true]);
  });
});

describe("hub rows", () => {
  const ctx = (id: Types.ObjectId) => ({ auth: authFor(id) }) as unknown as AppContext;

  test("chapter rows are in book/chapter number order and a QUESTION row opens the filtered queue", async () => {
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "10" });
    await seed({ reviewer: ME, docType: "chapter_plan", chapter: "2" });
    await seed({ reviewer: ME, docType: "question", chapter: "10", n: 2 });
    await seed({ reviewer: ME, docType: "question", chapter: "2", n: 2 });
    const hub = await myReviewHub(ctx(ME));
    const plans = hub.rows.filter((r) => r.kind === "PLAN");
    expect(plans.map((r) => r.titleBn.split(" · ").pop())).toEqual(["অধ্যায় ২", "অধ্যায় ১০"]);
    const questions = hub.rows.filter((r) => r.kind === "QUESTION");
    // The question rows read "অধ্যায়" too (the plan word), not "Unit".
    expect(questions.map((r) => r.titleBn.split(" · ").pop())).toEqual(["অধ্যায় ২", "অধ্যায় ১০"]);
    expect(JSON.parse(questions[0].paramsJson as string)).toEqual({ subject: "BAN", classLevel: 1, chapter: 2, undecided: true });
    expect(questions[0].screen).toBe("QuestionReviewQueue");
  });
});
