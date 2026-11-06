/**
 * Example data for the `teach` help guides (homework, assignment, gift, attendance, work
 * board, trackers, vocabulary test, Saturday revision). LOCAL ONLY, create-only.
 *
 *   $env:HELP_NOW='2026-11-05T10:30:00+06:00'
 *   $env:NODE_OPTIONS='--require ./scripts/help/fixtures/teach-clock.cjs'
 *   $env:MONGODB_URI='mongodb://127.0.0.1:27911/hc'; npx tsx scripts/help/fixtures/teach.ts --reset
 *
 * The run happens "on" Thursday 2026-11-05 (teach-clock.cjs moves the clock; the spec moves
 * the browser's), because homework and the weekly assignment only exist on school days and
 * the assignment is delivered on the Thursday.
 *
 * On top of seedBaseSchool():
 *   - the routine for ৩য় বালক / বালিকা (Sun–Thu; গণিত P5 + বাংলা P6 by the class teacher,
 *     ইংরেজি P7 by teacher2), the period grid and the year's schedule window;
 *   - homework topics for ৩য় শ্রেণি গণিত / বাংলা / ইংরেজি;
 *   - yesterday's (Wed 11-04) homework for ৩য় বালক, confirmed and now due — the walk takes
 *     submission, checks and returns it;
 *   - the assignment rotation (every week: ৩য় বালক গণিত + বাংলা, ৩য় বালিকা ইংরেজি) and last
 *     week's (week 44) ৩য় বালক গণিত assignment, confirmed and now due;
 *   - one uploaded sheet (fixed id TEACH_SHEET_ID) the spec hands back for the browser's
 *     upload, because a local run has no Google Drive.
 * Everything else the guides show is made by the walk itself (specs/teach.cjs).
 */
import mongoose, { Types } from "mongoose";
import { seedBaseSchool } from "../fixture";
import { PeriodGrid } from "../../../src/modules/routine/models/PeriodGrid";
import { ScheduleWindow } from "../../../src/modules/routine/models/ScheduleWindow";
import { RoutineSlot } from "../../../src/modules/routine/models/RoutineSlot";
import { HomeworkTopic } from "../../../src/modules/trackers/models/HomeworkTopic";
import { Student } from "../../../src/modules/foundation/models/Student";
import { StoredFile } from "../../../src/modules/platform/models/StoredFile";
import { ScopeGrant } from "../../../src/modules/foundation/models/ScopeGrant";
import {
  declareHomeworkItem,
  markRecordsDue,
} from "../../../src/modules/trackers/services/HomeworkService";
import { HomeworkStudentRecord } from "../../../src/modules/trackers/models/HomeworkStudentRecord";
import { confirmHomeworkDay } from "../../../src/modules/trackers/services/HomeworkReconciliationService";
import { upsertAssignmentSchedule, addScheduleEntry } from "../../../src/modules/trackers/services/AssignmentScheduleService";
import { deliverAssignmentItem, confirmAssignmentWeek } from "../../../src/modules/trackers/services/AssignmentService";
import { AssignmentStudentRecord } from "../../../src/modules/trackers/models/AssignmentStudentRecord";
import { weekNumberFor } from "../../../src/modules/trackers/assignmentCalendar";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

/** The uploaded assignment sheet the spec returns from the browser's upload call. */
export const TEACH_SHEET_ID = "6a0000000000000000000a01";
const TERM_START = new Date("2026-01-01T00:00:00");

const at = (iso: string): Date => new Date(iso);

export async function seedTeach() {
  const base = await seedBaseSchool();
  const { users, classes, sections, yearId } = base;
  const P = users.principal;
  const T = users.teacher;
  const T2 = users.teacher2;

  // ── Routine ────────────────────────────────────────────────────────────────
  await ScheduleWindow.create({
    academicYearId: yearId,
    fromDate: new Date("2026-01-01"),
    toDate: new Date("2026-12-31"),
    season: "regular",
    dayStartMinutes: 450,
    label: "নিয়মিত ২০২৬",
    active: true,
  });
  const grid = [
    { number: 1, durationMin: 45, isBreak: false, track: "quran", nameBn: "১ম" },
    { number: 2, durationMin: 45, isBreak: false, track: "quran", nameBn: "২য়" },
    { number: 3, durationMin: 40, isBreak: false, track: "arabic", nameBn: "৩য়" },
    { number: 4, durationMin: 30, isBreak: true, track: "general", nameBn: "টিফিন" },
    { number: 5, durationMin: 35, isBreak: false, track: "general", nameBn: "৪র্থ" },
    { number: 6, durationMin: 35, isBreak: false, track: "general", nameBn: "৫ম" },
    { number: 7, durationMin: 35, isBreak: false, track: "general", nameBn: "৬ষ্ঠ" },
  ];
  await PeriodGrid.create({ audienceKey: "class_1_5", classLevels: [1, 2, 3, 4, 5], season: "regular", periods: grid, active: true });

  const days = ["SUN", "MON", "TUE", "WED", "THU"];
  const slotRows: Array<Record<string, unknown>> = [];
  for (const dayOfWeek of days) {
    for (const [sectionId, period, subject, teacherId] of [
      [sections.c3Boys, 5, "MATH", T],
      [sections.c3Boys, 6, "BAN", T],
      [sections.c3Boys, 7, "ENG", T2],
      [sections.c3Girls, 5, "ENG", T2],
      [sections.c3Girls, 6, "MATH", T2],
    ] as const) {
      slotRows.push({
        groupType: "section",
        groupId: sectionId,
        classId: classes.c3,
        dayOfWeek,
        periodNumber: period,
        subject,
        track: "general",
        isBreak: false,
        teacherId,
        effectiveFrom: new Date("2026-01-01"),
        active: true,
        createdBy: P,
      });
    }
  }
  await RoutineSlot.insertMany(slotRows);
  // The routine gives teacher2 ৩য় বালক ইংরেজি too (as createRoutineSlot would).
  await ScopeGrant.create({
    teacherId: T2, kind: "teaching", active: true, source: "routine", createdBy: P,
    classId: classes.c3, sectionId: sections.c3Boys, subjectId: base.subjects.ENG,
  });

  // ── Homework topics (the declare form's picker) ────────────────────────────
  const topics: Array<[string, string, string[]]> = [
    ["MATH", "গুণ", ["TOP-MATH-C3-01", "TOP-MATH-C3-02"]],
    ["MATH", "ভাগ", []],
    ["BAN", "ছড়া ও কবিতা", ["TOP-BAN-C3-01"]],
    ["BAN", "বানান", []],
    ["ENG", "Unit 3: My family", ["TOP-ENG-C3-01"]],
  ];
  let order = 0;
  const codeOf: Record<string, string> = {};
  for (const [subject, labelBn] of topics) {
    order += 1;
    const code = `TOP-${subject}-C3-${String(order).padStart(2, "0")}`;
    codeOf[`${subject}:${labelBn}`] = code;
    await HomeworkTopic.create({ classLevel: 3, subject, code, labelBn, chapters: [], order, active: true, source: "manual" });
  }

  // ── Yesterday's homework (Wed 11-04), confirmed and due today ──────────────
  const boys = await Student.find({ sectionId: sections.c3Boys }).sort({ schoolId: 1 }).lean();
  const roster = boys.map((s) => ({ studentId: String(s._id), present: true }));
  const wed = at("2026-11-04T09:00:00+06:00");
  for (const [subject, topic, description] of [
    ["MATH", "MATH:গুণ", "অনুশীলনী ৫.২ — ১ থেকে ৬ নম্বর গুণ"],
    ["BAN", "BAN:ছড়া ও কবিতা", "“আমাদের ছোট নদী” কবিতার প্রথম আট লাইন খাতায় লেখা"],
  ] as const) {
    await declareHomeworkItem({
      academicYearId: String(yearId),
      classId: String(classes.c3),
      classLevel: 3,
      sectionId: String(sections.c3Boys),
      subject,
      dateGiven: wed.toISOString(),
      topTags: [codeOf[topic]],
      timeDecl: 20,
      qCount: 6,
      description,
      actorId: String(T),
    } as never);
  }
  await declareHomeworkItemNil(String(classes.c3), String(sections.c3Boys), "2026-11-04", String(T2));
  await confirmHomeworkDay({ classId: String(classes.c3), sectionId: String(sections.c3Boys), date: wed, roster, actorId: String(T) });
  const due = await HomeworkStudentRecord.find({ sectionId: sections.c3Boys, state: "GIVEN" }).select("_id").lean();
  await markRecordsDue(String(sections.c3Boys), due.map((r) => String(r._id)));

  // ── Assignment rotation + last week's item ─────────────────────────────────
  await upsertAssignmentSchedule({ academicYearId: String(yearId), termStartDate: TERM_START.toISOString(), deliveryDayOfWeek: 4, dueDayOfWeek: 0 });
  for (let cycleWeek = 1; cycleWeek <= 4; cycleWeek++) {
    for (const [sectionId, subject, teacherId] of [
      [sections.c3Boys, "MATH", T],
      [sections.c3Boys, "BAN", T],
      [sections.c3Girls, "ENG", T2],
    ] as const) {
      await addScheduleEntry({
        academicYearId: String(yearId),
        cycleWeek,
        classId: String(classes.c3),
        classLevel: 3,
        sectionId: String(sectionId),
        subject,
        teacherId: String(teacherId),
      });
    }
  }
  await StoredFile.create({
    _id: new Types.ObjectId(TEACH_SHEET_ID),
    kind: "assignment_attachment",
    mime: "application/pdf",
    sizeBytes: 20480,
    originalName: "গণিত অ্যাসাইনমেন্ট শিট.pdf",
    driveFileId: "local-example",
    uploadedBy: T,
  });
  const lastThu = at("2026-10-29T10:00:00+06:00");
  const lastWeek = weekNumberFor(TERM_START, lastThu);
  const { AssignmentSchedule } = await import("../../../src/modules/trackers/models/AssignmentSchedule");
  const schedule = await AssignmentSchedule.findOne({ academicYearId: yearId }).lean();
  const { resolveScheduleWeek } = await import("../../../src/modules/trackers/services/AssignmentScheduleService");
  const resolved = await resolveScheduleWeek(schedule as never, lastWeek);
  const mathEntry = schedule!.entries.find(
    (e) => e.cycleWeek === resolved.cycleWeek && String(e.sectionId) === String(sections.c3Boys) && e.subject === "MATH",
  );
  const sheet2 = await StoredFile.create({
    kind: "assignment_attachment",
    mime: "application/pdf",
    sizeBytes: 20480,
    originalName: "ভগ্নাংশ অ্যাসাইনমেন্ট.pdf",
    driveFileId: "local-example-2",
    uploadedBy: T,
  });
  await deliverAssignmentItem({
    academicYearId: String(yearId),
    weekNumber: lastWeek,
    entryId: String(mathEntry!._id),
    sectionId: String(sections.c3Boys),
    roster,
    totalMarks: 10,
    description: "ভগ্নাংশের ছবি এঁকে রং করা — শিটের ১০টি প্রশ্ন",
    estMinutes: 30,
    attachmentIds: [String(sheet2._id)],
    actorId: String(T),
    at: lastThu,
  });
  await confirmAssignmentWeek({ academicYearId: String(yearId), sectionId: String(sections.c3Boys), weekNumber: lastWeek, actorId: String(T), at: lastThu });
  // Four brought it on time (Sunday 11-01) — they are the week's gift winners; রাফি and
  // সাকিব are still due, so the walk has a submission pass to take.
  const { submitPass } = await import("../../../src/modules/trackers/services/AssignmentRosterPassService");
  const recs = await AssignmentStudentRecord.find({ sectionId: sections.c3Boys }).lean();
  const onTime = recs.filter((r) => [0, 1, 4, 5].includes(boys.findIndex((b) => String(b._id) === String(r.studentId))));
  await submitPass(
    String(recs[0].asItemId),
    onTime.map((r) => ({ recordId: String(r._id), submitted: true })),
    String(T),
    at("2026-11-01T08:30:00+06:00"),
  );
  await AssignmentStudentRecord.updateMany(
    { sectionId: sections.c3Boys, state: "GIVEN" },
    { $set: { state: "DUE" }, $push: { stateDates: { state: "DUE", at: at("2026-11-01T08:00:00+06:00") } } },
  );

  return { ...base, lastWeek };
}

async function declareHomeworkItemNil(classId: string, sectionId: string, date: string, actorId: string) {
  const { declareNoHomework } = await import("../../../src/modules/trackers/services/HomeworkService");
  await declareNoHomework({ classId, sectionId, subject: "ENG", date, reason: "EXAM", actorId });
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
    const ids = await seedTeach();
    console.log("fixture: teach (routine, homework topics, a due homework day, the assignment rotation, a due assignment)");
    console.log(JSON.stringify(ids));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
