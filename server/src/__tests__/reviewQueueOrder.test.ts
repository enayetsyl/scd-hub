/**
 * Reviewer queues in chapter order, done items at the bottom (owner, 2026-11-18).
 *
 * Plans sort in memory (compareReviewQueueRows via listMyReviewAssignments); questions sort
 * in Mongo on every path so paging stays correct. Real services on in-memory MongoDB.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ReviewAssignment } from "../modules/content/models/ReviewAssignment";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import {
  listMyReviewAssignments,
  compareReviewQueueRows,
  chapterSortKey,
} from "../modules/content/services/ReviewService";
import { listMyQuestionReviews } from "../modules/questions/services/QuestionReviewService";

jest.setTimeout(120_000);

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
beforeEach(async () => {
  await ReviewAssignment.deleteMany({});
  await ContentArtifact.deleteMany({});
});

const REVIEWER = new Types.ObjectId();
const OTHER = new Types.ObjectId();
let tick = 0;

async function insertRounds(rows: Record<string, unknown>[]): Promise<void> {
  await ReviewAssignment.collection.insertMany(
    rows.map((r) => ({
      subject: "BAN",
      classLevel: 1,
      anchorWord: "পাঠ",
      artifactId: new Types.ObjectId(),
      reviewerId: REVIEWER,
      assignedBy: new Types.ObjectId(),
      // Later-assigned rows must NOT float to the top any more.
      assignedAt: new Date(Date.UTC(2026, 10, 1) + ++tick * 1000),
      roundNumber: 1,
      status: "assigned",
      ...r,
    })),
  );
}

const plan = (ch: string, docType: string, sessionIndex?: number, extra: Record<string, unknown> = {}) => ({
  docType,
  addressNumber: ch,
  ...(sessionIndex != null ? { sessionIndex } : {}),
  ...extra,
});

describe("plan queue order", () => {
  test("chapter plan then its sessions, chapter by chapter, submitted last, 10 after 2", async () => {
    // Inserted deliberately scrambled.
    await insertRounds([
      plan("10", "chapter_plan"),
      plan("2", "session_plan", 3),
      plan("1", "session_plan", 2),
      plan("2", "chapter_plan"),
      plan("1", "chapter_plan", undefined, { status: "submitted", verdict: "APPROVE" }),
      plan("2", "session_plan", 1),
      plan("1", "session_plan", 3),
      plan("1", "session_plan", 1),
      plan("2", "session_plan", 2),
      plan("10", "session_plan", 1),
      // another reviewer's round and a question round never appear
      { ...plan("1", "chapter_plan"), reviewerId: OTHER },
      { docType: "question", addressNumber: "1", qid: "QP-BAN-C1-U01-Q0001" },
    ]);
    const list = await listMyReviewAssignments(REVIEWER.toString());
    expect(list.map((r) => `${r.status}:${r.addressNumber}:${r.docType}:${r.sessionIndex ?? "-"}`)).toEqual([
      "assigned:1:session_plan:1",
      "assigned:1:session_plan:2",
      "assigned:1:session_plan:3",
      "assigned:2:chapter_plan:-",
      "assigned:2:session_plan:1",
      "assigned:2:session_plan:2",
      "assigned:2:session_plan:3",
      "assigned:10:chapter_plan:-",
      "assigned:10:session_plan:1",
      "submitted:1:chapter_plan:-",
    ]);
  });

  test("with every chapter-1 row undecided, the chapter plan leads its sessions", async () => {
    await insertRounds([
      plan("1", "session_plan", 1),
      plan("1", "chapter_plan"),
      plan("1", "session_plan", 2),
    ]);
    const list = await listMyReviewAssignments(REVIEWER.toString());
    expect(list.map((r) => r.docType)).toEqual(["chapter_plan", "session_plan", "session_plan"]);
  });

  test("comparator: subject then class keep a book together; non-numeric chapters go last", () => {
    const row = (o: Record<string, unknown>) =>
      ({
        _id: new Types.ObjectId(),
        status: "assigned",
        subject: "BAN",
        classLevel: 1,
        addressNumber: "1",
        docType: "chapter_plan",
        sessionIndex: null,
        ...o,
      }) as Parameters<typeof compareReviewQueueRows>[0];
    const rows = [
      row({ subject: "MATH", addressNumber: "1" }),
      row({ classLevel: 2, addressNumber: "1" }),
      row({ addressNumber: "x" }),
      row({ addressNumber: "10" }),
      row({ addressNumber: "2" }),
      row({ docType: "other_plan", addressNumber: "2" }),
    ];
    rows.sort(compareReviewQueueRows);
    expect(rows.map((r) => `${r.subject}${r.classLevel}:${r.addressNumber}:${r.docType}`)).toEqual([
      "BAN1:2:chapter_plan",
      "BAN1:2:other_plan",
      "BAN1:10:chapter_plan",
      "BAN1:x:chapter_plan",
      "BAN2:1:chapter_plan",
      "MATH1:1:chapter_plan",
    ]);
    expect(chapterSortKey("")).toBe(Number.MAX_SAFE_INTEGER);
    expect(chapterSortKey("2")).toBeLessThan(chapterSortKey("10"));
  });
});

const q = (ch: string, n: number | string, extra: Record<string, unknown> = {}) => ({
  docType: "question",
  addressNumber: ch,
  qid: `QP-BAN-C1-U${ch.padStart(2, "0")}-Q${n}`,
  ...extra,
});

async function seedQuestions(): Promise<string[]> {
  // Scrambled; question numbers are not padded evenly (Q9 vs Q10 vs Q0003).
  const rows = [
    q("10", 1),
    q("2", 10),
    q("1", 9),
    q("2", "0003"),
    q("1", 10, { status: "submitted", verdict: "APPROVE" }),
    q("2", 9),
    q("1", 2),
    q("10", 2),
    q("1", 1),
    q("2", 1, { subject: "MATH" }),
  ];
  await insertRounds(rows);
  return [
    // assigned first: BAN ch1, ch2, ch10, then MATH, then submitted
    "Q1@1",
    "Q2@1",
    "Q9@1",
    "Q0003@2",
    "Q9@2",
    "Q10@2",
    "Q1@10",
    "Q2@10",
    "Q1@2",
    "Q10@1",
  ];
}

const label = (r: { qid: string | null; addressNumber: string }) =>
  `${/Q(\d+)$/.exec(r.qid ?? "")![0]}@${r.addressNumber}`;

describe("question queue order", () => {
  test("chapter then question number, numeric; MATH after BAN; submitted last", async () => {
    const expected = await seedQuestions();
    const list = await listMyQuestionReviews(REVIEWER.toString(), { limit: 50 });
    expect(list.map(label)).toEqual(expected);
  });

  test("two pages of 3 concatenate to the full ordered list with no duplicates", async () => {
    const expected = await seedQuestions();
    const got: string[] = [];
    const ids = new Set<string>();
    for (let offset = 0; offset < 12; offset += 3) {
      const page = await listMyQuestionReviews(REVIEWER.toString(), { limit: 3, offset });
      for (const r of page) {
        expect(ids.has(r.id)).toBe(false);
        ids.add(r.id);
        got.push(label(r));
      }
    }
    expect(got).toEqual(expected);
  });

  test("the same order holds with a round-level filter", async () => {
    await seedQuestions();
    const list = await listMyQuestionReviews(REVIEWER.toString(), { limit: 50 }, { subject: "BAN" });
    expect(list.map(label)).toEqual([
      "Q1@1",
      "Q2@1",
      "Q9@1",
      "Q0003@2",
      "Q9@2",
      "Q10@2",
      "Q1@10",
      "Q2@10",
      "Q10@1",
    ]);
  });

  test("the same order holds on the artifact-join path, paged", async () => {
    await seedQuestions();
    const rounds = await ReviewAssignment.find({ reviewerId: REVIEWER, docType: "question" }).lean();
    await ContentArtifact.collection.insertMany(
      rounds.map((r) => ({
        _id: r.artifactId,
        envelopeJson: { payload: { question_type: "mcq", question_text: "x", qid: r.qid } },
      })),
    );
    const args = { questionType: "mcq", subject: "BAN" };
    const p1 = await listMyQuestionReviews(REVIEWER.toString(), { limit: 5, offset: 0 }, args);
    const p2 = await listMyQuestionReviews(REVIEWER.toString(), { limit: 5, offset: 5 }, args);
    expect([...p1, ...p2].map(label)).toEqual([
      "Q1@1",
      "Q2@1",
      "Q9@1",
      "Q0003@2",
      "Q9@2",
      "Q10@2",
      "Q1@10",
      "Q2@10",
      "Q10@1",
    ]);
    expect(p1.length + p2.length).toBe(9);
  });
});
