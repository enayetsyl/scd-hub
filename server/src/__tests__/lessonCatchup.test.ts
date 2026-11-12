/**
 * Lesson-plan progress LP-4 — the Office's catch-up task and the guardians' missed lessons
 * (docs/prd-lesson-progress.md §7, D-#827/#828).
 *
 *  - the tracker counts, per session, the roster students absent on a day it was taught
 *  - the suggestion names the routine teacher + class teacher, the skipped session and the
 *    session three children missed
 *  - createCatchup goes through the work board (a teacher cannot assign others); the overview
 *    counts the open catch-up until the task is DONE
 *  - a guardian's missed lessons: only days the child was listed absent, newest first, with the note
 *  - the 1 pm notice (GH-4): one per guardian × child covering every class marked so far, never twice;
 *    a class marked after 1 pm (or with no attendance yet) rides the next school day's 1 pm notice
 *  - GH-4: the guardian view carries the class homework and each session's home guide
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
import { User } from "../modules/foundation/models/User";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { Guardian } from "../modules/foundation/models/Guardian";
import { ClassNote } from "../modules/routine/models/ClassNote";
import { HomeworkItem } from "../modules/trackers/models/HomeworkItem";
import { LessonProgressConfig } from "../modules/lesson-progress/models/LessonProgressConfig";
import { LessonDelivery } from "../modules/lesson-progress/models/LessonDelivery";
import { assertGuardianOfStudent } from "../middleware/authz";
import { importSessionHomeGuides } from "../modules/lesson-progress/services/HomeGuideService";
import { ContentArtifact } from "../modules/content/models/ContentArtifact";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { StudentAttendanceDay } from "../modules/attendance/models/StudentAttendanceDay";
import { Notification } from "../modules/notifications/models/Notification";
import { publishClassNote } from "../modules/routine/services/RoutineTriggerService";
import { recordDelivery } from "../modules/lesson-progress/services/LessonDeliveryService";
import { progressOverview, sectionTracker } from "../modules/lesson-progress/services/LessonProgressService";
import { catchupSuggestion, createCatchup } from "../modules/lesson-progress/services/LessonCatchupService";
import { childMissedLessonsPage, dispatchLessonMissed } from "../modules/lesson-progress/services/GuardianLessonService";
import { setTaskStatus } from "../modules/workboard/services/TaskService";

jest.setTimeout(180_000);

let mongo: MongoMemoryServer;
let T = "";
let CT = "";
let OFFICE = { userId: "", role: "OFFICE" as const };
let SEC = "";
let SLOT = "";
const kid: string[] = [];
const GUARDIAN = new Types.ObjectId();
const TODAY = new Date("2027-03-08T06:00:00Z");

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"), current: true }]);
  const [cls] = await Class.create([{ level: 3, nameBn: "তৃতীয়", academicYearId: year._id }]);
  const users = await User.create([
    { email: "t@lc.test", passwordHash: "x", role: "TEACHER", name: "রুমানা", active: true },
    { email: "ct@lc.test", passwordHash: "x", role: "TEACHER", name: "সাবিনা", active: true },
    { email: "o@lc.test", passwordHash: "x", role: "OFFICE", name: "অফিস", active: true },
  ]);
  T = String(users[0]._id);
  CT = String(users[1]._id);
  OFFICE = { userId: String(users[2]._id), role: "OFFICE" };
  const [sec] = await Section.create([{ classId: cls._id, code: "A", nameBn: "সম্মিলিত", classTeacherId: users[1]._id }]);
  SEC = String(sec._id);
  for (let i = 0; i < 4; i++) {
    const [s] = await Student.create([{ schoolId: `LC-${i}`, name: `Child ${i}`, rollNumber: String(i + 1), classId: cls._id, sectionId: sec._id, active: true }]);
    kid.push(String(s._id));
  }
  await GuardianLink.create([{ guardianId: GUARDIAN, studentId: new Types.ObjectId(kid[0]), relation: "মা", active: true }]);
  for (const k of ["1:1", "1:2", "2:1"]) {
    const [ch, i] = k.split(":").map(Number);
    await ContentArtifact.create([{
      docType: "session_plan", subject: "MATH", classLevel: 3, address: { anchorWord: "অধ্যায়", number: ch, title: `ch ${ch}` },
      curationTag: "KEEP_AS_IS", reviewStatus: "reviewed", current: true, importedBy: new Types.ObjectId(),
      envelopeJson: { payload: { session_plan: { session_form: "multi_period", period_index: i, period_of: 2, session_title: `শিরোনাম ${k}` } } },
    }]);
  }
  const [slot] = await RoutineSlot.create([{
    groupType: "section", groupId: sec._id, classId: cls._id, dayOfWeek: "SUN", periodNumber: 1, subject: "MATH", track: "general",
    teacherId: users[0]._id, effectiveFrom: new Date("2027-01-01"), createdBy: users[2]._id,
  }]);
  SLOT = String(slot._id);
  await LessonProgressConfig.create({ classNoteQuestionOn: true }); // D-#952: the class note asks the lesson-plan question only while the switch is on
  const day = async (date: string, key: string, absent: number[]) => {
    await StudentAttendanceDay.create([{ sectionId: sec._id, dateKey: date, absentStudentIds: absent.map((i) => new Types.ObjectId(kid[i])), markedBy: users[2]._id, markedAt: new Date() }]);
    const note = await publishClassNote({ slotId: String(slot._id), date: new Date(date), taughtSummaryBn: `যা পড়ালাম ${date}`, actorId: T, canManage: false });
    await recordDelivery(note, { sessions: [{ key, finished: true }] }, T);
  };
  await day("2027-03-01", "1:1", [0]);
  await day("2027-03-08", "2:1", [0, 1, 2]); // 1:2 skipped
});

/** Publish the slot's class note for a date and mark one lesson-plan session taught (no attendance written). */
async function markClass(date: string, key: string): Promise<void> {
  const note = await publishClassNote({ slotId: SLOT, date: new Date(date), taughtSummaryBn: `যা পড়ালাম ${date}`, actorId: T, canManage: false });
  await recordDelivery(note, { sessions: [{ key, finished: true }] }, T);
}

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("catch-up (DB)", () => {
  it("tracker counts absentees per session; the suggestion names teachers, the skipped and the missed session", async () => {
    const t = await sectionTracker(SEC, "MATH", OFFICE, TODAY);
    expect(t.sessions.map((s) => `${s.key}:${s.status}:${s.absentCount}`)).toEqual(["1:1:FINISHED:1", "1:2:SKIPPED:0", "2:1:FINISHED:3"]);
    const sug = await catchupSuggestion(t, TODAY);
    expect(sug.assignees.map((a) => `${a.userId === T ? "T" : a.userId === CT ? "CT" : "?"}:${a.why}`)).toEqual(["T:ROUTINE", "CT:CLASS_TEACHER"]);
    expect(sug.notes).toMatch(/বাদ পড়া সেশন: .*শিরোনাম 1:2/);
    expect(sug.notes).toMatch(/অনেকে অনুপস্থিত ছিল: .*শিরোনাম 2:1 \(৩ জন\)/);
    expect(sug.sessionKeys).toEqual(["1:2", "2:1"]);
    expect(sug.dueKey).toBe("2027-03-15");
  });

  it("raised through the work board: a teacher cannot assign others; open until DONE", async () => {
    const t = await sectionTracker(SEC, "MATH", OFFICE, TODAY);
    const input = { assigneeUserId: T, titleBn: "ঘাটতি পূরণ", notes: "নোট", dueKey: "2027-03-15", sessionKeys: ["1:2", "x"] };
    await expect(createCatchup(t, input, { userId: CT, role: "TEACHER" })).rejects.toThrow(/অনুমতি/);
    const c = await createCatchup(t, input, OFFICE);
    expect(c).toMatchObject({ titleBn: "ঘাটতি পূরণ", assigneeName: "রুমানা", status: "TODO", snapshot: { finished: 2, total: 3, skipped: 1 } });
    expect((await progressOverview({}, TODAY)).find((r) => r.sectionId === SEC)?.openCatchups).toBe(1);
    expect(await Notification.countDocuments({ kind: "TASK_ASSIGNED", recipientUserId: new Types.ObjectId(T) })).toBe(1);
    await setTaskStatus({ userId: T, role: "TEACHER" } as never, c.taskId, "DONE");
    expect((await progressOverview({}, TODAY)).find((r) => r.sectionId === SEC)?.openCatchups).toBe(0);
    expect((await sectionTracker(SEC, "MATH", OFFICE, TODAY)).catchups.map((x) => x.status)).toEqual(["DONE"]);
  });
});

describe("guardians and missed lessons (DB)", () => {
  it("lists only the days the child was listed absent, newest first, with the class note", async () => {
    const p = await childMissedLessonsPage(kid[0]);
    expect(p.total).toBe(2);
    expect(p.rows.map((r) => `${r.dateKey}:${r.sessions[0].titleBn}:${r.noteBn}`)).toEqual([
      "2027-03-08:শিরোনাম 2:1:যা পড়ালাম 2027-03-08",
      "2027-03-01:শিরোনাম 1:1:যা পড়ালাম 2027-03-01",
    ]);
    expect((await childMissedLessonsPage(kid[1])).total).toBe(1);
    expect((await childMissedLessonsPage(kid[3])).total).toBe(0);
  });

  it("1 pm notice: one per guardian × child covering every marked class so far, never twice", async () => {
    // 07:05Z = 13:05 Dhaka on Monday 2027-03-08. Child 0 missed both marked classes (03-01 and 03-08).
    expect(await dispatchLessonMissed(new Date("2027-03-08T07:05:00Z"))).toBe(1);
    expect(await dispatchLessonMissed(new Date("2027-03-08T07:10:00Z"))).toBe(0);
    const n = await Notification.findOne({ kind: "LESSON_MISSED" }).lean();
    expect(n).toMatchObject({ recipientGuardianId: GUARDIAN });
    expect(n!.bodyBn).toMatch(/Child 0 .*গণিত ক্লাসে অনুপস্থিত ছিল/);
    // both classes are stamped as covered, so no later run can notice them again
    expect(await LessonDelivery.countDocuments({ missedNoticeAt: { $exists: true } })).toBe(2);
  });

  it("a class marked after 1 pm rolls into the next school day's 1 pm notice, once", async () => {
    const before = await Notification.countDocuments({ kind: "LESSON_MISSED" });
    // Tuesday 03-09: the 1 pm run finds nothing yet ...
    await StudentAttendanceDay.create([{ sectionId: SEC, dateKey: "2027-03-09", absentStudentIds: [new Types.ObjectId(kid[0])], markedBy: OFFICE.userId, markedAt: new Date() }]);
    expect(await dispatchLessonMissed(new Date("2027-03-09T07:00:00Z"))).toBe(0);
    // ... then the teacher marks the class at 2 pm
    await markClass("2027-03-09", "1:2");
    // Wednesday 03-10 1 pm: one notice, naming the 03-09 class only (03-01 and 03-08 were already covered)
    expect(await dispatchLessonMissed(new Date("2027-03-10T07:00:00Z"))).toBe(1);
    expect(await dispatchLessonMissed(new Date("2027-03-10T07:05:00Z"))).toBe(0);
    expect(await dispatchLessonMissed(new Date("2027-03-11T07:00:00Z"))).toBe(0);
    const rows = await Notification.find({ kind: "LESSON_MISSED" }).sort({ createdAt: 1 }).lean();
    expect(rows.length).toBe(before + 1);
    const latest = rows[rows.length - 1];
    expect(latest.bodyBn).toContain("শিরোনাম 1:2");
    expect(latest.bodyBn).not.toContain("শিরোনাম 2:1");
    expect(latest.bodyBn).not.toMatch(/আজ গণিত/); // an earlier day's class: not "today"
  });

  it("a class whose attendance is not taken yet is left for a later notice", async () => {
    await markClass("2027-03-14", "2:1"); // no attendance record that day
    expect(await dispatchLessonMissed(new Date("2027-03-14T07:00:00Z"))).toBe(0);
    const d = await LessonDelivery.findOne({ dateKey: "2027-03-14" }).lean();
    expect(d!.missedNoticeAt).toBeUndefined();
    await StudentAttendanceDay.create([{ sectionId: SEC, dateKey: "2027-03-14", absentStudentIds: [new Types.ObjectId(kid[0])], markedBy: OFFICE.userId, markedAt: new Date() }]);
    expect(await dispatchLessonMissed(new Date("2027-03-15T07:00:00Z"))).toBe(1);
    expect((await LessonDelivery.findOne({ dateKey: "2027-03-14" }).lean())!.missedNoticeAt).toBeDefined();
  });
});

describe("guardian view: class note, homework and the home guide (GH-4)", () => {
  it("each missed period carries the class homework and its session's guide + classwork items", async () => {
    const hw = await HomeworkItem.create({
      hwId: "HW-C3-MATH-0001", academicYearId: new Types.ObjectId(), classId: new Types.ObjectId(), classLevel: 3, sectionId: new Types.ObjectId(SEC),
      subject: "MATH", dateGiven: new Date("2027-03-08"), topTags: ["TOP-MATH-C3-01"], timeDecl: 15, qCount: 4, revItem: false, description: "অনুশীলনী ২ এর ১–৪",
      declaredBy: new Types.ObjectId(),
    });
    await ClassNote.updateOne({ date: new Date("2027-03-08") }, { $set: { homeworkItemId: hw._id } });
    await importSessionHomeGuides(
      { guides: [{ classToken: "C3", subject: "MATH", chapter: 2, sessionIndex: 1, steps: ["১", "২", "৩", "৪", "৫"], classworkItems: [{ label: "অনুশীলনী ২ক", textBn: "১ থেকে ৩ নম্বর" }], homeTimeMin: 12 }] },
      OFFICE.userId,
      { dryRun: false },
    );
    const p = await childMissedLessonsPage(kid[0]);
    const mon = p.rows.find((r) => r.dateKey === "2027-03-08")!;
    expect(mon.homework).toMatchObject({ description: "অনুশীলনী ২ এর ১–৪", qCount: 4, timeDecl: 15 });
    expect(mon.sessions[0].guide).toMatchObject({ steps: ["১", "২", "৩", "৪", "৫"], homeTimeMin: 12, classworkItems: [{ label: "অনুশীলনী ২ক", textBn: "১ থেকে ৩ নম্বর" }] });
    // a period with no linked homework / no loaded guide reads as null, not as an error
    const tue = p.rows.find((r) => r.dateKey === "2027-03-01")!;
    expect(tue.homework).toBeNull();
    expect(tue.sessions[0].guide).toBeNull();
  });

  it("a guardian sees only their own child: the link gate refuses another child, and another child's list has no foreign period", async () => {
    await Guardian.create([{ _id: GUARDIAN, identifierKind: "phone", identifier: "01700000099", name: "মা", active: true }]);
    const ctx = { auth: { userId: String(GUARDIAN), role: "GUARDIAN" } } as never;
    await expect(assertGuardianOfStudent(ctx, kid[0])).resolves.toBeUndefined();
    await expect(assertGuardianOfStudent(ctx, kid[1])).rejects.toThrow(/অনুমতি/);
    // child 1 was absent only on 03-08: the list is theirs alone and carries no other child's dates
    const p1 = await childMissedLessonsPage(kid[1]);
    expect(p1.rows.map((r) => r.dateKey)).toEqual(["2027-03-08"]);
    expect((await childMissedLessonsPage(kid[3])).rows).toEqual([]);
  });
});
