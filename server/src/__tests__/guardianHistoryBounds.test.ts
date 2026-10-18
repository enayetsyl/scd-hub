/**
 * D-#761 — the guardian reads behind Today (and the Class Test / Homework tabs) are
 * bounded, while every existing call keeps its old answer when the new arg is omitted:
 *
 *   childTestResultsPage  one page of published results, newest exam first, subject filter
 *   childAssignments      outstandingOnly → just the chased / late rows, open records only
 *   childComments         limit → the newest N delivered comments
 *   childRevision         limit → the newest N delivered Saturdays
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { ClassTestResult } from "../modules/trackers/models/ClassTestResult";
import { AssignmentItem } from "../modules/trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../modules/trackers/models/AssignmentStudentRecord";
import { StudentComment } from "../modules/comments/models/StudentComment";
import { RevisionEntry } from "../modules/saturday-revision/models/RevisionEntry";
import { childTestResults, childTestResultsPage } from "../modules/trackers/services/ClassTestResultService";
import { childAssignments } from "../modules/trackers/services/AssignmentSummaryService";
import { childComments } from "../modules/comments/services/MeetingCommentService";
import { childRevision } from "../modules/saturday-revision/services/RevisionService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const student = new Types.ObjectId();
const sid = student.toString();
const day = (iso: string) => new Date(`${iso}T00:00:00`);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  // 6 published class tests (MATH/ENG alternating, one exam a week) + one unpublished.
  for (let i = 0; i < 7; i++) {
    const t = await ClassTest.collection.insertOne({
      ctId: `CT-${i}`,
      subject: i % 2 === 0 ? "MATH" : "ENG",
      testNumber: i + 1,
      examDate: day(`2026-09-${String(1 + i * 4).padStart(2, "0")}`),
      totalMarks: 20,
      passMark: 8,
      classLevel: 5,
      status: "PRINTED",
    });
    await ClassTestResult.collection.insertOne({
      testId: t.insertedId,
      studentId: student,
      status: "PRESENT",
      marks: 10 + i,
      publishedAt: i === 6 ? null : day("2026-10-01"),
    });
  }

  // Assignments: 3 returned (history), 1 chased, 1 still pending and not yet due.
  const states = ["RETURNED", "RETURNED", "RETURNED", "CHASE", "GIVEN"];
  for (let i = 0; i < states.length; i++) {
    const it = await AssignmentItem.collection.insertOne({
      // asId is uniquely indexed; raw inserts must set it or the 2nd row collides on null.
      asId: `AS-${i}`,
      subject: "ENG",
      weekNumber: i + 1,
      deliveryDate: day(`2026-09-${String(1 + i * 5).padStart(2, "0")}`),
      totalMarks: 10,
      attachmentIds: [],
    });
    await AssignmentStudentRecord.collection.insertOne({
      asItemId: it.insertedId,
      asId: `AS-${i}`,
      studentId: student,
      state: states[i],
      stateDates: [{ state: "GIVEN", at: day("2026-09-01") }],
      dueDate: i === 4 ? day("2030-01-01") : day("2026-09-20"),
      createdAt: new Date(Date.UTC(2026, 8, 1 + i)),
    });
  }

  // 4 delivered comments + 1 undelivered; 4 delivered Saturdays.
  for (let i = 0; i < 5; i++) {
    await StudentComment.collection.insertOne({
      studentId: student,
      type: "GENERAL",
      sentiment: "POSITIVE",
      text: `c${i}`,
      attachmentIds: [],
      deliveredAt: i === 4 ? null : day("2026-10-02"),
      createdAt: new Date(Date.UTC(2026, 9, 1 + i)),
    });
  }
  for (let i = 0; i < 4; i++) {
    await RevisionEntry.collection.insertOne({
      studentId: student,
      groupId: new Types.ObjectId(),
      date: new Date(Date.UTC(2026, 8, 5 + i * 7)),
      present: true,
      juzRecords: [],
      teacherUserId: new Types.ObjectId(),
      deliveredAt: day("2026-10-02"),
    });
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("D-#761 childTestResultsPage", () => {
  test("pages the published results newest exam first; total is every match", async () => {
    const all = await childTestResults(sid);
    expect(all).toHaveLength(6);
    const p1 = await childTestResultsPage(sid, null, { page: 1, pageSize: 4 });
    expect(p1.total).toBe(6);
    expect(p1.rows.map((r) => r.ctId)).toEqual(["CT-5", "CT-4", "CT-3", "CT-2"]);
    const p2 = await childTestResultsPage(sid, null, { page: 2, pageSize: 4 });
    expect(p2.rows.map((r) => r.ctId)).toEqual(["CT-1", "CT-0"]);
  });

  test("the subject filter applies before paging", async () => {
    const math = await childTestResultsPage(sid, "MATH", { page: 1, pageSize: 2 });
    expect(math.total).toBe(3);
    expect(math.rows.map((r) => r.ctId)).toEqual(["CT-4", "CT-2"]);
  });
});

describe("D-#761 childAssignments outstandingOnly", () => {
  test("only the rows still to act on; omitted = the whole history", async () => {
    const asOf = day("2026-10-18");
    expect(await childAssignments(sid, asOf)).toHaveLength(5);
    const todo = await childAssignments(sid, asOf, { outstandingOnly: true });
    expect(todo.map((a) => a.asId)).toEqual(["AS-3"]);
  });
});

describe("D-#761 guardian history limits", () => {
  test("childComments: newest N delivered; omitted = every delivered one", async () => {
    expect((await childComments(sid)).map((c) => c.text)).toEqual(["c3", "c2", "c1", "c0"]);
    expect((await childComments(sid, 2)).map((c) => c.text)).toEqual(["c3", "c2"]);
  });

  test("childRevision: newest N Saturdays; omitted = all", async () => {
    expect(await childRevision(sid)).toHaveLength(4);
    const two = await childRevision(sid, 2);
    expect(two.map((e) => e.date)).toEqual([
      new Date(Date.UTC(2026, 8, 26)).toISOString(),
      new Date(Date.UTC(2026, 8, 19)).toISOString(),
    ]);
  });
});
