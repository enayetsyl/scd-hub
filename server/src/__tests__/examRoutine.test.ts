/**
 * D-#883 — exam routine, real services on in-memory Mongo.
 *
 *   save       one class's slots replace only that class's; bad dates/times/duplicates refused;
 *              each subject's date lands on the class's syllabus rows (written over oral)
 *   visibility a teacher sees nothing until published; the Office sees the draft
 *   guardian   the child's class only, published only, plus their own Quran sittings
 *              (published schedule only, never the examiner); another family's child refused
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { Exam } from "../modules/exams/models/Exam";
import { ExamSyllabus } from "../modules/exams/models/ExamSyllabus";
import { ExamRoutine } from "../modules/exams/models/ExamRoutine";
import { Class } from "../modules/foundation/models/Class";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { QuranExamPlan } from "../modules/quran-exam/models/QuranExamPlan";
import { QuranExamSitting } from "../modules/quran-exam/models/QuranExamSitting";
import { SubjectGroup } from "../modules/routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../modules/routine/models/SubjectGroupMembership";
import {
  examRoutine,
  guardianExamRoutine,
  publishExamRoutine,
  saveExamRoutineClass,
  syllabusDates,
} from "../modules/exams/services/ExamRoutineService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;

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
    [Exam, ExamSyllabus, ExamRoutine, Class, Student, Guardian, GuardianLink, QuranExamPlan, QuranExamSitting, SubjectGroup, SubjectGroupMembership].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

const OFFICE_PERMS = ["exam_routine:view", "exam_routine:manage", "exam_routine:publish"];
const ctxOf = (role: string, permissions: string[], userId = new Types.ObjectId().toString()): AppContext =>
  ({ auth: { userId, role, permissions } } as unknown as AppContext);

async function setup() {
  const yearId = new Types.ObjectId();
  const exam = await Exam.collection.insertOne({ academicYearId: yearId, term: "ANNUAL", name: "Annual 2026", createdBy: new Types.ObjectId() });
  const nursery = await Class.collection.insertOne({ level: -1, nameBn: "নার্সারি", academicYearId: yearId, active: true });
  const one = await Class.collection.insertOne({ level: 1, nameBn: "প্রথম শ্রেণি", academicYearId: yearId, active: true });
  for (const subject of ["BAN", "ENG"]) {
    await ExamSyllabus.collection.insertOne({ examId: exam.insertedId, classId: nursery.insertedId, subject, status: "PUBLISHED", marks: [], examDateKey: null });
  }
  const kid = await Student.collection.insertOne({ schoolId: "N-1", name: "Nura", classId: nursery.insertedId, sectionId: new Types.ObjectId(), active: true });
  const g = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: "01900000001", name: "Ma", loginEnabled: true, active: true });
  await GuardianLink.collection.insertOne({ guardianId: g.insertedId, studentId: kid.insertedId, relation: "mother", active: true });
  return {
    examId: exam.insertedId.toString(),
    nurseryId: nursery.insertedId.toString(),
    oneId: one.insertedId.toString(),
    kidId: kid.insertedId.toString(),
    guardian: ctxOf("GUARDIAN", ["guardian:read_child"], g.insertedId.toString()),
    office: ctxOf("OFFICE", OFFICE_PERMS),
    teacher: ctxOf("TEACHER", ["exam_routine:view"]),
  };
}

const NURSERY = [
  { dateKey: "2026-11-26", subject: "BAN", kind: "ORAL" },
  { dateKey: "2026-11-29", subject: "ENG", kind: "ORAL" },
  { dateKey: "2026-12-06", subject: "BAN", kind: "WRITTEN", start: "08:30", end: "10:00" },
];

describe("exam routine: save (D-#883)", () => {
  it("syllabus date = the written paper's, else the oral's", () => {
    const d = syllabusDates(NURSERY.map((s) => ({ ...s, kind: s.kind as "ORAL" | "WRITTEN" })));
    expect(Object.fromEntries(d)).toEqual({ BAN: "2026-12-06", ENG: "2026-11-29" });
  });

  it("replaces only the saved class, writes the syllabus dates, refuses bad input", async () => {
    const t = await setup();
    await saveExamRoutineClass(t.office, t.examId, t.oneId, [{ dateKey: "2026-12-01", subject: "ARABIC", kind: "WRITTEN", start: "08:00", end: "11:00", note: "আরবি দল অনুযায়ী" }]);
    const r = await saveExamRoutineClass(t.office, t.examId, t.nurseryId, NURSERY, "ইংরেজির আগে এক দিন বিরতি");
    expect(r.classes.map((c) => [c.labelBn, c.slots.length])).toEqual([["নার্সারি", 3], ["প্রথম শ্রেণি", 1]]);
    expect(r.classes[0]!.slots.map((s) => `${s.dateKey} ${s.subject} ${s.kind}`)).toEqual([
      "2026-11-26 BAN ORAL",
      "2026-11-29 ENG ORAL",
      "2026-12-06 BAN WRITTEN",
    ]);
    expect(r.noteBn).toBe("ইংরেজির আগে এক দিন বিরতি");
    const syl = await ExamSyllabus.find({ classId: new Types.ObjectId(t.nurseryId) }).lean();
    expect(Object.fromEntries(syl.map((s) => [s.subject, s.examDateKey]))).toEqual({ BAN: "2026-12-06", ENG: "2026-11-29" });

    await expect(saveExamRoutineClass(t.office, t.examId, t.nurseryId, [{ dateKey: "1 Dec", subject: "BAN", kind: "ORAL" }])).rejects.toThrow(/YYYY-MM-DD/);
    await expect(
      saveExamRoutineClass(t.office, t.examId, t.nurseryId, [{ dateKey: "2026-12-01", subject: "BAN", kind: "WRITTEN", start: "11:00", end: "08:00" }]),
    ).rejects.toThrow(/HH:mm/);
    await expect(
      saveExamRoutineClass(t.office, t.examId, t.nurseryId, [NURSERY[0]!, NURSERY[0]!]),
    ).rejects.toThrow(/দুবার/);
    // Dropping ENG clears its syllabus date.
    await saveExamRoutineClass(t.office, t.examId, t.nurseryId, [NURSERY[2]!]);
    expect((await ExamSyllabus.findOne({ subject: "ENG" }).lean())!.examDateKey).toBeNull();
  });

  it("a teacher sees nothing until published; the Office sees the draft", async () => {
    const t = await setup();
    await saveExamRoutineClass(t.office, t.examId, t.nurseryId, NURSERY);
    expect((await examRoutine(t.teacher, t.examId)).classes.every((c) => c.slots.length === 0)).toBe(true);
    expect((await examRoutine(t.office, t.examId)).classes[0]!.slots).toHaveLength(3);
    await publishExamRoutine(t.office, t.examId, true);
    const r = await examRoutine(t.teacher, t.examId);
    expect(r.published).toBe(true);
    expect(r.classes[0]!.slots).toHaveLength(3);
  });
});

describe("exam routine: guardian (D-#883)", () => {
  it("the child's class, published only, with their own Quran sittings once that schedule is published", async () => {
    const t = await setup();
    await saveExamRoutineClass(t.office, t.examId, t.nurseryId, NURSERY);
    await saveExamRoutineClass(t.office, t.examId, t.oneId, [{ dateKey: "2026-12-01", subject: "ARABIC", kind: "WRITTEN" }]);
    await QuranExamPlan.collection.insertOne({ examId: new Types.ObjectId(t.examId), status: "DRAFT", dayExaminers: [] });
    await QuranExamSitting.collection.insertOne({
      examId: new Types.ObjectId(t.examId), studentId: new Types.ObjectId(t.kidId), groupId: new Types.ObjectId(), level: "Qaida",
      dateKey: "2026-11-24", start: "07:00", end: "07:30", examinerId: new Types.ObjectId(), portionLabel: "কায়দা", status: "SCHEDULED",
    });
    let r = await guardianExamRoutine(t.guardian, t.examId, t.kidId);
    expect(r).toMatchObject({ published: false, slots: [], quranSittings: [], classLabelBn: "নার্সারি" });

    await publishExamRoutine(t.office, t.examId, true);
    await QuranExamPlan.updateOne({}, { $set: { status: "PUBLISHED" } });
    r = await guardianExamRoutine(t.guardian, t.examId, t.kidId);
    expect(r.slots.map((s) => s.subject)).toEqual(["BAN", "ENG", "BAN"]);
    expect(r.quranSittings).toEqual([{ dateKey: "2026-11-24", start: "07:00", end: "07:30", level: "Qaida", portionLabel: "কায়দা" }]);
    expect(JSON.stringify(r)).not.toMatch(/examiner/i);

    // Class one up: the Arabic paper names the child's own book (D-#888), gender suffix dropped.
    const pupil = await Student.collection.insertOne({ schoolId: "C1-1", name: "Rafi", classId: new Types.ObjectId(t.oneId), sectionId: new Types.ObjectId(), active: true });
    await GuardianLink.collection.insertOne({ guardianId: new Types.ObjectId(t.guardian.auth!.userId), studentId: pupil.insertedId, relation: "mother", active: true });
    const book = await SubjectGroup.collection.insertOne({ track: "arabic", level: "Book 2", gender: "boys", code: "AR_B2_BOYS", nameBn: "বুক ২ (বালক)", active: true });
    expect((await guardianExamRoutine(t.guardian, t.examId, pupil.insertedId.toString())).slots[0]).toMatchObject({ subject: "ARABIC", note: "" });
    await SubjectGroupMembership.collection.insertOne({ groupId: book.insertedId, studentId: pupil.insertedId, track: "arabic" });
    expect((await guardianExamRoutine(t.guardian, t.examId, pupil.insertedId.toString())).slots[0]).toMatchObject({ subject: "ARABIC", note: "বুক ২" });

    const other = await Student.collection.insertOne({ schoolId: "N-2", name: "Other", classId: new Types.ObjectId(t.oneId), sectionId: new Types.ObjectId(), active: true });
    await expect(guardianExamRoutine(t.guardian, t.examId, other.insertedId.toString())).rejects.toThrow(/অনুমতি নেই/);
  });
});
