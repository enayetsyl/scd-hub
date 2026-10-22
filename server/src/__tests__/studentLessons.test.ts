/**
 * Lesson-plan progress LP-3 — the student link (docs/prd-lesson-progress.md §4 + §6, D-#823/#825/#826).
 *
 *  - presenceOf (pure): PRESENT / PARTIAL / ABSENT (+ onLeave) / UNKNOWN — never assumed present
 *  - a session taught over two days: absent on day 1 only → PARTIAL
 *  - attendance not taken → UNKNOWN
 *  - a student moved to another শাখা keeps the old শাখা's lessons and does not inherit the new one's past
 *  - missedChapter: the weak students who missed a class of the chapter
 *  - the staff gate: view_all / class teacher see all subjects; a subject teacher only theirs (narrowed)
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

jest.mock("../modules/notifications/services/emitters", () => ({
  emitClassNotePublished: jest.fn(async () => undefined),
}));

import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { StudentAttendanceDay } from "../modules/attendance/models/StudentAttendanceDay";
import { publishClassNote } from "../modules/routine/services/RoutineTriggerService";
import { recordDelivery } from "../modules/lesson-progress/services/LessonDeliveryService";
import { chapterLessons, missedChapter, presenceOf, studentLessonsFor } from "../modules/lesson-progress/services/StudentLessonService";

jest.setTimeout(180_000);

describe("presenceOf (pure)", () => {
  const days = new Map([
    ["2027-03-01", { absent: false, leaveCovered: false }],
    ["2027-03-02", { absent: true, leaveCovered: false }],
    ["2027-03-03", { absent: true, leaveCovered: true }],
  ]);
  it.each([
    [["2027-03-01"], "PRESENT", false],
    [["2027-03-01", "2027-03-02"], "PARTIAL", false],
    [["2027-03-01", "2027-03-09"], "PARTIAL", false],
    [["2027-03-02"], "ABSENT", false],
    [["2027-03-03"], "ABSENT", true],
    [["2027-03-09"], "UNKNOWN", false],
  ])("%j → %s", (taughtOn, presence, onLeave) => {
    expect(presenceOf(taughtOn as string[], days)).toMatchObject({ presence, onLeave });
  });
});

let mongo: MongoMemoryServer;
const MATH_T = new Types.ObjectId().toString();
const BAN_T = new Types.ObjectId().toString();
const CT = new Types.ObjectId().toString();
const OFFICE = { userId: new Types.ObjectId().toString(), role: "OFFICE" as const };
const TEACHER = (id: string) => ({ userId: id, role: "TEACHER" as const });
let A = ""; // শাখা the mover starts in
let B = ""; // শাখা the mover moves to
const kid: Record<string, string> = {};

async function plan(subject: string, keys: string[]) {
  for (const k of keys) {
    const [ch, i] = k.split(":").map(Number);
    await ContentArtifact.create([{
      docType: "session_plan", subject, classLevel: 3, address: { anchorWord: "অধ্যায়", number: ch, title: `ch ${ch}` },
      curationTag: "KEEP_AS_IS", reviewStatus: "reviewed", current: true, importedBy: new Types.ObjectId(),
      envelopeJson: { payload: { session_plan: { session_form: "multi_period", period_index: i, period_of: 2, session_title: k } } },
    }]);
  }
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: true }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const [a] = await Section.create([{ classId: cls._id, code: "A", nameBn: "সম্মিলিত", classTeacherId: new Types.ObjectId(CT) }]);
  const [b] = await Section.create([{ classId: cls._id, code: "B", nameBn: "বালক" }]);
  A = String(a._id);
  B = String(b._id);
  for (const name of ["ruhi", "sami", "mover"]) {
    const [s] = await Student.create([{ schoolId: `SL-${name}`, name, rollNumber: "1", classId: cls._id, sectionId: a._id, active: true }]);
    kid[name] = String(s._id);
  }
  await plan("MATH", ["7:1", "7:2"]);
  await plan("BAN", ["1:1"]);
  const slot = async (sec: Types.ObjectId, subject: string, teacher: string) =>
    (await RoutineSlot.create([{
      groupType: "section", groupId: sec, classId: cls._id, dayOfWeek: "SUN", periodNumber: 1, subject, track: "general",
      teacherId: new Types.ObjectId(teacher), effectiveFrom: new Date("2027-01-01"), createdBy: new Types.ObjectId(),
    }]))[0];
  const am = await slot(a._id as Types.ObjectId, "MATH", MATH_T);
  const ab = await slot(a._id as Types.ObjectId, "BAN", BAN_T);
  const bm = await slot(b._id as Types.ObjectId, "MATH", MATH_T);
  const teach = async (slotId: Types.ObjectId, teacher: string, date: string, sessions: Array<[string, boolean]>) => {
    const note = await publishClassNote({ slotId: String(slotId), date: new Date(date), taughtSummaryBn: "x", actorId: teacher, canManage: false });
    await recordDelivery(note, { sessions: sessions.map(([key, finished]) => ({ key, finished })) }, teacher);
  };
  const absent = (sec: Types.ObjectId, dateKey: string, ids: string[]) =>
    StudentAttendanceDay.create([{ sectionId: sec, dateKey, absentStudentIds: ids.map((x) => new Types.ObjectId(x)), markedBy: new Types.ObjectId(), markedAt: new Date() }]);

  // শাখা A: chapter 7 session 1 runs over two days; session 2 on a day with no attendance taken.
  await absent(a._id as Types.ObjectId, "2027-03-01", [kid.sami, kid.mover]);
  await absent(a._id as Types.ObjectId, "2027-03-02", []);
  await teach(am._id, MATH_T, "2027-03-01", [["7:1", false]]);
  await teach(am._id, MATH_T, "2027-03-02", [["7:1", true]]);
  await teach(am._id, MATH_T, "2027-03-03", [["7:2", true]]);
  await teach(ab._id, BAN_T, "2027-03-02", [["1:1", true]]);

  // শাখা B taught 7:1 BEFORE the mover arrived; then the mover moves to B.
  await absent(b._id as Types.ObjectId, "2027-02-20", []);
  await teach(bm._id, MATH_T, "2027-02-20", [["7:1", true]]);
  await Student.updateOne({ _id: kid.mover }, { $set: { sectionId: b._id } });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("a child's lessons (DB)", () => {
  it("two-day session: absent on day 1 only → PARTIAL; no attendance taken → UNKNOWN", async () => {
    const sami = await chapterLessons(kid.sami, "MATH", "7");
    expect(sami.map((s) => `${s.key}:${s.presence}:${s.taughtOn.join(",")}`)).toEqual([
      "7:1:PARTIAL:2027-03-01,2027-03-02",
      "7:2:UNKNOWN:2027-03-03",
    ]);
    const ruhi = await chapterLessons(kid.ruhi, "MATH", "7");
    expect(ruhi.map((s) => s.presence)).toEqual(["PRESENT", "UNKNOWN"]);
  });

  it("a moved child keeps the old শাখা's lessons and does not inherit the new one's past", async () => {
    const mover = await chapterLessons(kid.mover, "MATH", "7");
    expect(mover.map((s) => `${s.key}:${s.taughtOn.join(",")}`)).toEqual(["7:1:2027-03-01,2027-03-02", "7:2:2027-03-03"]);
    // Presence still reads শাখা A's records (snapshotted units), not the new শাখা's.
    expect(mover.map((s) => s.presence)).toEqual(["PARTIAL", "UNKNOWN"]);
  });

  it("missedChapter names the weak students who missed a class of the chapter", async () => {
    expect(await missedChapter([kid.sami, kid.ruhi, kid.mover], "MATH", "7")).toEqual({ taught: true, missed: [kid.sami, kid.mover] });
    expect(await missedChapter([kid.sami], "MATH", "9")).toEqual({ taught: false, missed: [] });
  });

  it("gate: Office and the class teacher see every subject; a subject teacher only theirs; others refused", async () => {
    const all = await studentLessonsFor(kid.ruhi, OFFICE);
    expect(all.subjects.map((s) => s.subject)).toEqual(["BAN", "MATH"]);
    expect(all.subjects.find((s) => s.subject === "MATH")!.counts).toEqual({ PRESENT: 1, PARTIAL: 0, ABSENT: 0, UNKNOWN: 1 });
    expect((await studentLessonsFor(kid.ruhi, TEACHER(CT))).narrowed).toBe(false);
    const ban = await studentLessonsFor(kid.ruhi, TEACHER(BAN_T));
    expect(ban).toMatchObject({ narrowed: true });
    expect(ban.subjects.map((s) => s.subject)).toEqual(["BAN"]);
    await expect(studentLessonsFor(kid.ruhi, TEACHER(new Types.ObjectId().toString()))).rejects.toThrow(/অনুমতি/);
  });
});
