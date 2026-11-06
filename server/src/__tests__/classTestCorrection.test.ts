/**
 * Staff mistake record MR-4 (D-#945) on a real in-memory Mongo: a class-test result
 * re-published with different marks becomes the entrant's mistake; published scripts pulled
 * back become the publisher's.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../modules/foundation/models/User";
import { Student } from "../modules/foundation/models/Student";
import { Notification } from "../modules/notifications/models/Notification";
import { ClassTest } from "../modules/trackers/models/ClassTest";
import { ClassTestResult } from "../modules/trackers/models/ClassTestResult";
import { ClassTestCorrectionNote } from "../modules/trackers/models/ClassTestCorrectionNote";
import { StaffMistake } from "../modules/staff-mistakes/models/StaffMistake";
import { publishExam, publishResult } from "../modules/trackers/services/ClassTestPublishService";
import {
  classTestCorrectionNotesByIds,
  marksSnapshotDiff,
  recordScriptsPulledBack,
} from "../modules/trackers/services/ClassTestCorrectionService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let seq = 0;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all(
    [User, Student, Notification, ClassTest, ClassTestResult, ClassTestCorrectionNote, StaffMistake].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

async function user(name: string, role = "TEACHER"): Promise<string> {
  seq += 1;
  const r = await User.collection.insertOne({
    name, role, active: true, phone: `8801744000${seq}`, passwordHash: "x",
    // D-#1020: this suite tests the told flow (explain notice, decisions).
    grantedPermissions: ["staff_mistakes:view_own"], revokedPermissions: [], additionalTemplates: [],
  });
  return r.insertedId.toString();
}

async function printedTest(teacher: string): Promise<{ testId: string; kids: string[] }> {
  seq += 1;
  const sectionId = new Types.ObjectId();
  const t = await ClassTest.create({
    ctId: `CT-C3-MATH-${String(seq).padStart(4, "0")}`, academicYearId: new Types.ObjectId(), sectionId, subject: "MATH",
    testNumber: seq, examDate: new Date("2026-10-28"), totalMarks: 20, passMark: 8, source: "UPLOADED_PAPER",
    status: "PRINTED", requestedBy: new Types.ObjectId(teacher), teacherId: new Types.ObjectId(teacher),
  });
  const kids: string[] = [];
  for (const name of ["Ayaan Rahman", "Mariam Hossain"]) {
    seq += 1;
    const s = await Student.collection.insertOne({ schoolId: `C-${seq}`, name, sectionId, classId: new Types.ObjectId(), active: true });
    kids.push(s.insertedId.toString());
    await ClassTestResult.create({ testId: t._id, studentId: s.insertedId, status: "PRESENT", marks: 14, enteredBy: new Types.ObjectId(teacher) });
  }
  return { testId: t._id.toString(), kids };
}

describe("D-#945 — marks changed after guardians saw them", () => {
  it("the first release records nothing; a re-publish with changed marks is the entrant's mistake", async () => {
    const teacher = await user("Rashed");
    const office = await user("Kamrul", "OFFICE");
    const { testId, kids } = await printedTest(teacher);

    await publishExam(testId, office);
    expect(await ClassTestCorrectionNote.countDocuments()).toBe(0);
    const snap = await ClassTestResult.findOne({ studentId: kids[0] }).lean();
    expect(snap!.publishedSnapshot).toMatchObject({ marks: 14, status: "PRESENT" });

    // Same marks again: nothing.
    await publishExam(testId, office);
    expect(await ClassTestCorrectionNote.countDocuments()).toBe(0);

    // Office fixes one child's addition, another is found absent; re-publish.
    await ClassTestResult.updateOne({ studentId: kids[0] }, { $set: { marks: 16 } });
    await ClassTestResult.updateOne({ studentId: kids[1] }, { $set: { status: "ABSENT" }, $unset: { marks: "" } });
    await publishExam(testId, office);

    const note = await ClassTestCorrectionNote.findOne({}).lean();
    expect(note!.kind).toBe("MARKS");
    expect(String(note!.staffUserId)).toBe(teacher);
    expect(note!.changes.map((c) => [c.fromMarks, c.toMarks, c.fromStatus, c.toStatus])).toEqual([
      [14, 16, "PRESENT", "PRESENT"],
      [14, null, "PRESENT", "ABSENT"],
    ]);
    const m = await StaffMistake.findOne({}).lean();
    expect([m!.kind, String(m!.staffUserId), m!.status]).toEqual(["CLASS_TEST_MARKS", teacher, "EXPLANATION_DUE"]);

    const detail = (await classTestCorrectionNotesByIds([String(note!._id)])).get(String(note!._id))!;
    expect(detail.ctId).toMatch(/^CT-C3-MATH-/);
    expect(detail.totalMarks).toBe(20);
    expect(detail.changes.map((c) => [c.studentName, c.byName])).toEqual([
      ["Ayaan Rahman", "Kamrul"],
      ["Mariam Hossain", "Kamrul"],
    ]);
  });

  it("a single-student re-publish counts too, and joins the open episode", async () => {
    const teacher = await user("Rashed");
    const office = await user("Kamrul", "OFFICE");
    const { testId, kids } = await printedTest(teacher);
    await publishResult(testId, kids[0]!, office);
    await ClassTestResult.updateOne({ studentId: kids[0] }, { $set: { marks: 15 } });
    await publishResult(testId, kids[0]!, office);
    await ClassTestResult.updateOne({ studentId: kids[0] }, { $set: { marks: 17 } });
    await publishResult(testId, kids[0]!, office);
    const notes = await ClassTestCorrectionNote.find({}).lean();
    expect(notes).toHaveLength(1); // still waiting for an explanation → same episode
    expect(notes[0]!.changes.map((c) => [c.fromMarks, c.toMarks])).toEqual([[14, 15], [15, 17]]);
  });

  it("snapshot diff ignores a row never shown", () => {
    expect(marksSnapshotDiff({ marks: 3, status: "PRESENT", enteredBy: new Types.ObjectId(), publishedSnapshot: null })).toBeNull();
  });
});

describe("D-#945 — published scripts pulled back", () => {
  it("is the publisher's entry to explain", async () => {
    const office = await user("Shirin", "OFFICE");
    const principal = await user("Principal", "PRINCIPAL");
    const testId = new Types.ObjectId().toString();
    expect(await recordScriptsPulledBack({ testId, publishedBy: office, actorId: principal, at: new Date() })).toBe(true);
    const m = await StaffMistake.findOne({}).lean();
    expect([m!.kind, String(m!.staffUserId), m!.status]).toEqual(["CLASS_TEST_SCRIPTS", office, "EXPLANATION_DUE"]);
  });
});
