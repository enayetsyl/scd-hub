/**
 * Example data for the family help guides (students, guardians, daily comments, parents'
 * meetings, monthly reports, the progress board; and the GUARDIAN app). LOCAL runs only.
 *
 *   $env:MONGODB_URI='mongodb://127.0.0.1:<port>/hc'
 *   $env:NODE_OPTIONS='--require ./scripts/help/fixtures/family-clock.cjs'   # today = Thu 2026-11-05
 *   npx tsx scripts/help/fixtures/family.ts --reset
 *
 * Start the server with the same NODE_OPTIONS (and GEMINI_API_KEY='' so nothing calls the
 * AI). Create-only, built on seedBaseSchool(); refuses anything but a local in-memory
 * database. Every person here is an example. Rows are mostly inserted directly with fixed
 * dates (the services stamp "now"); the meeting and monthly-report steps use the real
 * services so their screens show real states.
 *
 * What the guardian (01800000001, children আরিফ ৩য় বালক and নাফিসা ৩য় বালিকা) sees:
 *   routine with times, this week's class notes, homework (one DUE = "done at home"),
 *   assignments, an upcoming class test + a published result, attendance with absences
 *   and a leave application, two sent comments (one still unread → the পড়েছি pop-up),
 *   a Saturday revision entry, mastery progress (C3 গণিত switched on), the annual exam
 *   syllabus + routine, two pop-ups (one still due → pops up at login), a meeting slot
 *   NOT yet answered (the RSVP pop-up comes first at login), and a school task for নাফিসা.
 */
import mongoose, { Types } from "mongoose";
import { seedBaseSchool } from "../fixture";
import { Student } from "../../../src/modules/foundation/models/Student";
import { Guardian } from "../../../src/modules/foundation/models/Guardian";
import { GuardianLink } from "../../../src/modules/foundation/models/GuardianLink";
import { hashPassword } from "../../../src/modules/foundation/services/AuthService";
import { RoutineSlot } from "../../../src/modules/routine/models/RoutineSlot";
import { PeriodGrid } from "../../../src/modules/routine/models/PeriodGrid";
import { ScheduleWindow } from "../../../src/modules/routine/models/ScheduleWindow";
import { ClassNote } from "../../../src/modules/routine/models/ClassNote";
import { SubjectGroup } from "../../../src/modules/routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../../src/modules/routine/models/SubjectGroupMembership";
import { HomeworkItem } from "../../../src/modules/trackers/models/HomeworkItem";
import { HomeworkStudentRecord } from "../../../src/modules/trackers/models/HomeworkStudentRecord";
import { AssignmentItem } from "../../../src/modules/trackers/models/AssignmentItem";
import { AssignmentStudentRecord } from "../../../src/modules/trackers/models/AssignmentStudentRecord";
import { ClassTest } from "../../../src/modules/trackers/models/ClassTest";
import { ClassTestResult } from "../../../src/modules/trackers/models/ClassTestResult";
import { ClassTestQuestionRequest } from "../../../src/modules/trackers/models/ClassTestQuestionRequest";
import { StudentAttendanceDay } from "../../../src/modules/attendance/models/StudentAttendanceDay";
import { StudentLeaveApplication } from "../../../src/modules/attendance/models/StudentLeaveApplication";
import { StudentComment } from "../../../src/modules/comments/models/StudentComment";
import { PopupNotice } from "../../../src/modules/popup-notices/models/PopupNotice";
import { PopupNoticeRecipient } from "../../../src/modules/popup-notices/models/PopupNoticeRecipient";
import { Exam } from "../../../src/modules/exams/models/Exam";
import { ExamSyllabus } from "../../../src/modules/exams/models/ExamSyllabus";
import { ExamRoutine } from "../../../src/modules/exams/models/ExamRoutine";
import { RevisionEntry } from "../../../src/modules/saturday-revision/models/RevisionEntry";
import { MasteryEnablement } from "../../../src/modules/mastery/models/MasteryEnablement";
import { MasteryOutcome } from "../../../src/modules/mastery/models/MasteryOutcome";
import { MasteryEvidence } from "../../../src/modules/mastery/models/MasteryEvidence";
import { ImprovementAction } from "../../../src/modules/improvement/models/ImprovementAction";
import { ImprovementTick } from "../../../src/modules/improvement/models/ImprovementTick";
import { GuardianView } from "../../../src/modules/engagement/models/GuardianView";
import { Audit } from "../../../src/modules/platform/models/Audit";
import { createParentMeeting, generateSlots, setMeetingBreaks } from "../../../src/modules/comments/services/ParentMeetingService";
import { dispatchMeetingSchedule, setSlotAttendance } from "../../../src/modules/comments/services/MeetingDispatchService";
import { respondToMeetingSlot } from "../../../src/modules/comments/services/MeetingResponseService";
import { openCommentCollection, saveSubjectNote } from "../../../src/modules/comments/services/MeetingChainService";
import { saveMeetingComment } from "../../../src/modules/comments/services/MeetingCommentService";
import { ParentMeetingSlot as MeetingSlot } from "../../../src/modules/comments/models/ParentMeetingSlot";
import { MeetingSubjectNote } from "../../../src/modules/comments/models/MeetingSubjectNote";
import {
  buildSectionMonthlyReports,
  reviewMonthlyReport,
  releaseMonthlyReport,
} from "../../../src/modules/reports/services/MonthlyReportService";
import { MonthlyReport } from "../../../src/modules/reports/models/MonthlyReport";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

type Base = Awaited<ReturnType<typeof seedBaseSchool>>;
type Sec = "c3Boys" | "c3Girls";

const TODAY = "2026-11-05";
const day = (k: string) => new Date(`${k}T00:00:00Z`); // a day-only field (06:00 Dhaka)
const at = (k: string, hhmm = "10:00") => new Date(`${k}T${hhmm}:00+06:00`); // an instant, Dhaka time

/** Sun–Thu school days from `from` to `to` (inclusive), as YYYY-MM-DD. */
function schoolDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = day(from); d <= day(to); d = new Date(d.getTime() + 86400000)) {
    const w = d.getUTCDay();
    if (w !== 5 && w !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export async function seedFamily(b: Base): Promise<void> {
  const P = b.users.principal;
  const T = b.users.teacher;
  const T2 = b.users.teacher2;
  const boys = b.sections.c3Boys;
  const girls = b.sections.c3Girls;
  const arif = b.students.c3Boys[0];
  const nafisa = b.students.c3Girls[0];
  const sectionOf: Record<Sec, Types.ObjectId> = { c3Boys: boys, c3Girls: girls };
  const teacherOf: Record<Sec, Types.ObjectId> = { c3Boys: T, c3Girls: T2 };

  // ── Family phones: আরিফ + নাফিসা share the guardian's phone; every other child has its own ──
  let ph = 10;
  for (const id of [...b.students.c3Boys, ...b.students.c3Girls, ...b.students.c5]) {
    ph += 1;
    await Student.updateOne({ _id: id }, { $set: { phone: `019000000${ph}` } });
  }
  await Student.updateMany({ _id: { $in: [arif, nafisa] } }, { $set: { phone: "01800000001" } });

  // Five more families with an app login (for the meeting answers and the usage report).
  const passwordHash = await hashPassword("Help@123");
  const otherGuardians: Types.ObjectId[] = [];
  const families: [Types.ObjectId, string][] = [
    [b.students.c3Boys[1], "তানভীরের মা"],
    [b.students.c3Boys[2], "রাফির বাবা"],
    [b.students.c3Girls[1], "সাদিয়ার মা"],
    [b.students.c3Girls[2], "মারিয়ার বাবা"],
    [b.students.c3Boys[3], "সাকিবের মা"],
  ];
  for (const [i, [sid, name]] of families.entries()) {
    const s = await Student.findById(sid).lean();
    const g = await Guardian.create({
      identifierKind: "phone",
      identifier: s!.phone,
      phone: s!.phone,
      name: `উদাহরণ ${name}`,
      passwordHash,
      loginEnabled: i !== 4,
      active: true,
    });
    await GuardianLink.create({ guardianId: g._id, studentId: sid, relation: i % 2 ? "বাবা" : "মা", active: true });
    otherGuardians.push(g._id);
  }

  // ── Routine (৩য় বালক + বালিকা, Sun–Thu) with clock times ──
  await PeriodGrid.create({
    audienceKey: "class_1_5",
    classLevels: [1, 2, 3, 4, 5],
    season: "regular",
    active: true,
    periods: [
      { number: 1, durationMin: 40, isBreak: false, track: "general", nameBn: "১ম পিরিয়ড" },
      { number: 2, durationMin: 40, isBreak: false, track: "general", nameBn: "২য় পিরিয়ড" },
      { number: 3, durationMin: 40, isBreak: false, track: "general", nameBn: "৩য় পিরিয়ড" },
      { number: 4, durationMin: 20, isBreak: true, track: "general", nameBn: "টিফিন" },
      { number: 5, durationMin: 40, isBreak: false, track: "general", nameBn: "৪র্থ পিরিয়ড" },
      { number: 6, durationMin: 40, isBreak: false, track: "general", nameBn: "৫ম পিরিয়ড" },
    ],
  });
  await ScheduleWindow.create({
    academicYearId: b.yearId,
    fromDate: day("2026-01-01"),
    toDate: day("2026-12-31"),
    season: "regular",
    dayStartMinutes: 450,
    label: "নিয়মিত",
    active: true,
  });
  const WEEK: Record<string, string[]> = {
    SUN: ["BAN", "MATH", "ENG", "SCI", "ISLAM"],
    MON: ["MATH", "BAN", "BGS", "ENG", "SCI"],
    TUE: ["ENG", "MATH", "BAN", "ISLAM", "BGS"],
    WED: ["BAN", "ENG", "MATH", "SCI", "BGS"],
    THU: ["MATH", "BAN", "ENG", "BGS", "ISLAM"],
  };
  const PERIODS = [1, 2, 3, 5, 6];
  const teaches = (sec: Sec, subj: string) =>
    sec === "c3Boys" ? (subj === "MATH" || subj === "BAN" ? T : T2) : subj === "ENG" || subj === "MATH" ? T2 : T;
  const slotId: Record<string, Types.ObjectId> = {};
  for (const sec of ["c3Boys", "c3Girls"] as Sec[]) {
    for (const [dow, subs] of Object.entries(WEEK)) {
      for (const [i, subject] of subs.entries()) {
        const s = await RoutineSlot.create({
          groupType: "section",
          groupId: sectionOf[sec],
          classId: b.classes.c3,
          dayOfWeek: dow,
          periodNumber: PERIODS[i],
          subject,
          track: "general",
          isBreak: false,
          teacherId: teaches(sec, subject),
          effectiveFrom: day("2026-01-01"),
          active: true,
          createdBy: P,
        });
        slotId[`${sec}:${dow}:${PERIODS[i]}`] = s._id;
      }
    }
  }

  // ── Homework ──
  let hwN = 100;
  const hwItem = (sec: Sec, subject: string, k: string, timeDecl: number, qCount: number, description: string) =>
    HomeworkItem.create({
      hwId: `HW-C3-${subject}-${String(++hwN).padStart(4, "0")}`,
      academicYearId: b.yearId,
      classId: b.classes.c3,
      classLevel: 3,
      sectionId: sectionOf[sec],
      subject,
      dateGiven: day(k),
      topTags: [`TOP-${subject}-C3-01`],
      timeDecl,
      qCount,
      revItem: false,
      description,
      status: "issued",
      declaredBy: teacherOf[sec],
      issuedAt: at(k, "11:00"),
    });
  const hwRec = (item: any, sec: Sec, studentId: Types.ObjectId, state: string, stamps: [string, string][], extra: object = {}) =>
    HomeworkStudentRecord.create({
      hwItemId: item._id,
      hwId: item.hwId,
      studentId,
      sectionId: sectionOf[sec],
      classId: b.classes.c3,
      state,
      stateDates: stamps.map(([s, when]) => ({ state: s, at: new Date(when), by: teacherOf[sec] })),
      chaseCount: state === "CHASE" ? 1 : 0,
      topupFlag: false,
      topupQids: [],
      issuedBy: teacherOf[sec],
      ...extra,
    });
  const hwFor = async (sec: Sec, studentId: Types.ObjectId) => {
    const [s1, s2] = sec === "c3Boys" ? ["MATH", "BAN"] : ["ENG", "MATH"];
    // today: two given, due Sunday
    const a = await hwItem(sec, s1, TODAY, 20, 8, s1 === "MATH" ? "অনুশীলনী ৩.২: ১–৮ নম্বর অঙ্ক" : "Unit 5: নতুন ১০টি শব্দ খাতায় লেখো");
    await hwRec(a, sec, studentId, "GIVEN", [["GIVEN", "2026-11-05T11:00:00+06:00"]], { dueDate: day("2026-11-08") });
    const a2 = await hwItem(sec, s2, TODAY, 15, 4, s2 === "BAN" ? "‘আমাদের গ্রাম’ কবিতাটি তিনবার পড়ো" : "অনুশীলনী ৩.৩: ১–৪ নম্বর");
    await hwRec(a2, sec, studentId, "GIVEN", [["GIVEN", "2026-11-05T11:00:00+06:00"]], { dueDate: day("2026-11-08") });
    // Tuesday's, due Wednesday, not handed in → DUE (the "done at home" button)
    const c = await hwItem(sec, s2, "2026-11-03", 20, 5, s2 === "BAN" ? "‘আমার পরিবার’ নিয়ে পাঁচ লাইন লেখো" : "গুণের নামতা ৬ ও ৭ খাতায় লেখো");
    await hwRec(c, sec, studentId, "DUE", [["GIVEN", "2026-11-03T11:00:00+06:00"], ["DUE", "2026-11-04T07:00:00+06:00"]], {
      dueDate: day("2026-11-04"),
    });
    // Sunday's, checked and returned
    const d = await hwItem(sec, s1, "2026-11-01", 20, 6, s1 === "MATH" ? "অনুশীলনী ৩.১: ১–৬ নম্বর অঙ্ক" : "Unit 4: প্রশ্ন ১–৬ এর উত্তর লেখো");
    await hwRec(
      d,
      sec,
      studentId,
      "RETURNED",
      [
        ["GIVEN", "2026-11-01T11:00:00+06:00"],
        ["SUBMITTED", "2026-11-02T08:00:00+06:00"],
        ["CHECKED", "2026-11-02T13:00:00+06:00"],
        ["RETURNED", "2026-11-03T08:30:00+06:00"],
      ],
      { dueDate: day("2026-11-02"), result: "CORRECT" },
    );
    return { today: a };
  };
  const hwBoys = await hwFor("c3Boys", arif);
  const hwGirls = await hwFor("c3Girls", nafisa);

  // ── Class notes, this week (both sections) ──
  const TAUGHT: Record<string, string> = {
    BAN: "‘আমাদের গ্রাম’ কবিতা — আবৃত্তি ও কঠিন শব্দের অর্থ",
    MATH: "যোগ-বিয়োগের কথার সমস্যা (পৃষ্ঠা ৪২–৪৩)",
    ENG: "Unit 5: My Family — new words and reading",
    SCI: "উদ্ভিদের অংশ — মূল, কাণ্ড ও পাতা",
    BGS: "আমাদের দেশের নদী",
    ISLAM: "সালাতের নিয়ম",
  };
  for (const sec of ["c3Boys", "c3Girls"] as Sec[]) {
    for (const k of schoolDays("2026-11-01", TODAY)) {
      const dow = DOW[day(k).getUTCDay()];
      const periods = k === TODAY ? [1, 2] : PERIODS;
      for (const p of periods) {
        const subject = WEEK[dow][PERIODS.indexOf(p)];
        const hw = k === TODAY && p === 1 ? (sec === "c3Boys" ? hwBoys.today : hwGirls.today) : null;
        await ClassNote.create({
          slotId: slotId[`${sec}:${dow}:${p}`],
          groupType: "section",
          groupId: sectionOf[sec],
          date: day(k),
          subject,
          taughtSummaryBn: TAUGHT[subject],
          homeworkItemId: hw?._id,
          publishedBy: teaches(sec, subject),
          publishedAt: at(k, "12:30"),
        });
      }
    }
  }

  // ── Assignments ──
  let asN = 10;
  const asFor = async (sec: Sec, studentId: Types.ObjectId) => {
    const subj = sec === "c3Boys" ? "MATH" : "ENG";
    const mk = (week: number, subject: string, deliver: string, due: string, description: string) =>
      AssignmentItem.create({
        asId: `AS-C3-${subject}-${String(++asN).padStart(4, "0")}`,
        academicYearId: b.yearId,
        scheduleEntryId: new Types.ObjectId(),
        weekNumber: week,
        cycleWeek: ((week - 1) % 4) + 1,
        classId: b.classes.c3,
        classLevel: 3,
        sectionId: sectionOf[sec],
        subject,
        teacherId: teacherOf[sec],
        deliveryDate: day(deliver),
        dueDate: day(due),
        estMinutes: 30,
        totalMarks: 20,
        description,
        status: "ISSUED",
        issuedAt: at(deliver, "11:00"),
        issuedBy: teacherOf[sec],
        deliveredBy: teacherOf[sec],
        deliveredAt: at(deliver, "11:00"),
      });
    const rec = (item: any, state: string, stamps: [string, string][], extra: object = {}) =>
      AssignmentStudentRecord.create({
        asItemId: item._id,
        asId: item.asId,
        studentId,
        sectionId: sectionOf[sec],
        classId: b.classes.c3,
        state,
        chaseCount: 0,
        dueDate: item.dueDate,
        issuedBy: teacherOf[sec],
        stateDates: stamps.map(([s, when]) => ({ state: s, at: at(when, "11:00") })),
        ...extra,
      });
    const done = await mk(43, subj, "2026-10-20", "2026-10-26", subj === "MATH" ? "জ্যামিতির আকৃতি চেনা — চার্ট তৈরি" : "My School — ছবি এঁকে ৫টি বাক্য");
    await rec(done, "RETURNED", [["GIVEN", "2026-10-20"], ["SUBMITTED", "2026-10-26"], ["CHECKED", "2026-10-28"], ["RETURNED", "2026-10-29"]], {
      marks: 17,
      result: "CORRECT",
      feedback: "চমৎকার কাজ, পরিষ্কার হাতের লেখা।",
    });
    const due = await mk(44, subj === "MATH" ? "BAN" : "MATH", "2026-10-27", "2026-11-02", subj === "MATH" ? "প্রিয় ফল নিয়ে অনুচ্ছেদ লেখো" : "দৈনন্দিন জীবনে যোগ-বিয়োগ — ৫টি উদাহরণ");
    await rec(due, "DUE", [["GIVEN", "2026-10-27"], ["DUE", "2026-11-02"]]);
    const open = await mk(45, subj, "2026-11-03", "2026-11-09", subj === "MATH" ? "ঘড়ি দেখে সময় বলা — কার্যপত্র" : "Unit 5: My Family — একটি পোস্টার");
    await rec(open, "GIVEN", [["GIVEN", "2026-11-03"]]);
  };
  await asFor("c3Boys", arif);
  await asFor("c3Girls", nafisa);

  // ── Class tests: three printed tests per subject (Aug–Oct) for the progress board + one upcoming ──
  const SCORES: number[][] = [
    // per student (c3Boys order), per test, out of 20
    [15, 16, 17], // আরিফ, steady
    [14, 15, 15],
    [15, 11, 6], // রাফি, falling and failed last → ঝুঁকিতে
    [12, 13, 14],
    [16, 12, 7], // নাঈম, falling and failed last → ঝুঁকিতে
    [13, 14, 16],
  ];
  const SCORES_G: number[][] = [
    [16, 17, 18], // নাফিসা
    [15, 12, 7], // সাদিয়া → ঝুঁকিতে
    [14, 15, 16],
    [12, 12, 13],
    [17, 17, 18],
    [11, 13, 14],
  ];
  let ctN = 0;
  for (const sec of ["c3Boys", "c3Girls"] as Sec[]) {
    const subjects = sec === "c3Boys" ? ["MATH", "BAN"] : ["MATH", "ENG"];
    const studs = sec === "c3Boys" ? b.students.c3Boys : b.students.c3Girls;
    const table = sec === "c3Boys" ? SCORES : SCORES_G;
    for (const [si, subject] of subjects.entries()) {
      for (const [ti, k] of ["2026-08-20", "2026-09-24", "2026-10-22"].entries()) {
        const test = await ClassTest.create({
          ctId: `CT-3${sec === "c3Boys" ? "B" : "G"}-${subject}-${ti + 1}-${++ctN}`,
          academicYearId: b.yearId,
          classLevel: 3,
          classId: b.classes.c3,
          sectionId: sectionOf[sec],
          subject,
          testNumber: ti + 1,
          examDate: day(k),
          totalMarks: 20,
          passMark: 8,
          source: "UPLOADED_PAPER",
          status: "PRINTED",
          deadlineDays: 2,
          teacherId: teacherOf[sec],
          requestedBy: teacherOf[sec],
          requestedAt: at(k, "09:00"),
          printedAt: at(k, "08:00"),
        });
        for (const [i, sid] of studs.entries()) {
          const marks = Math.max(0, Math.min(20, table[i][ti] - si));
          await ClassTestResult.create({
            testId: test._id,
            studentId: sid,
            status: "PRESENT",
            marks,
            weakness: marks < 10 ? "ধাপগুলো লিখে না" : marks < 15 ? "বানানে ভুল" : undefined,
            guardianAction: marks < 15 ? "প্রতিদিন ১০ মিনিট অনুশীলন করান" : undefined,
            enteredBy: teacherOf[sec],
            submittedAt: at(k, "14:00"),
            publishedAt: new Date(day(k).getTime() + 3 * 86400000),
            publishedVersion: 1,
          });
        }
      }
    }
    // upcoming (Tuesday 2026-11-10)
    const up = await ClassTest.create({
      ctId: `CT-3${sec === "c3Boys" ? "B" : "G"}-MATH-4-${++ctN}`,
      academicYearId: b.yearId,
      classLevel: 3,
      classId: b.classes.c3,
      sectionId: sectionOf[sec],
      subject: "MATH",
      testNumber: 4,
      examDate: day("2026-11-10"),
      totalMarks: 20,
      passMark: 8,
      source: "UPLOADED_PAPER",
      status: "PRINTED",
      deadlineDays: 2,
      teacherId: teacherOf[sec],
      requestedBy: teacherOf[sec],
      requestedAt: at("2026-11-01", "09:00"),
    });
    await ClassTestQuestionRequest.create({
      academicYearId: b.yearId,
      classLevel: 3,
      classId: b.classes.c3,
      sectionId: sectionOf[sec],
      subject: "MATH",
      chapter: "ভগ্নাংশ",
      testNumber: 4,
      totalMarks: 20,
      durationMinutes: 40,
      examDate: up.examDate,
      status: "CONFIRMED",
      confirmedAt: at("2026-11-02"),
      classTestId: up._id,
      requestedBy: teacherOf[sec],
      requestedAt: at("2026-11-01", "09:00"),
    });
  }

  // ── Attendance: every school day of October and this month, both sections ──
  const absent: Record<string, Types.ObjectId[]> = {
    "2026-10-20": [arif, nafisa],
    "2026-10-21": [arif],
    "2026-11-02": [arif, b.students.c3Boys[2]],
    "2026-10-13": [b.students.c3Boys[4]],
    "2026-10-28": [b.students.c3Girls[1]],
  };
  for (const sec of ["c3Boys", "c3Girls"] as Sec[]) {
    const studs = new Set((sec === "c3Boys" ? b.students.c3Boys : b.students.c3Girls).map(String));
    await StudentAttendanceDay.insertMany(
      schoolDays("2026-10-01", TODAY).map((k) => ({
        sectionId: sectionOf[sec],
        dateKey: k,
        absentStudentIds: (absent[k] ?? []).filter((s) => studs.has(String(s))),
        markedBy: teacherOf[sec],
        markedAt: at(k, "08:15"),
      })),
    );
  }
  await StudentLeaveApplication.create({
    studentId: arif,
    fromKey: "2026-10-20",
    toKey: "2026-10-21",
    reason: "জ্বর হয়েছিল, ডাক্তার দুই দিন বিশ্রাম নিতে বলেছেন।",
    submittedBy: b.guardianId,
    submittedAt: at("2026-10-19", "20:00"),
  });

  // ── Daily comments: two sent to আরিফ's family (one still unread), three waiting for review ──
  const cm = (studentId: Types.ObjectId, sectionId: Types.ObjectId, authorUserId: Types.ObjectId, extra: object) => ({
    studentId,
    sectionId,
    authorUserId,
    attachmentIds: [],
    deliveryChannels: [],
    ...extra,
  });
  await StudentComment.create([
    cm(arif, boys, T, {
      type: "STUDY_HOMEWORK",
      sentiment: "POSITIVE",
      text: "আজ গণিতের বাড়ির কাজ খুব সুন্দর ও পরিষ্কার করে করেছে। এভাবে চালিয়ে যাক।",
      createdAt: at("2026-11-02", "11:00"),
      deliveredAt: at("2026-11-02", "14:00"),
      deliveryChannels: ["inbox"],
      readConfirmRequired: true,
      guardianReadAt: at("2026-11-02", "19:00"),
      guardianReadBy: b.guardianId,
    }),
    cm(arif, boys, T, {
      type: "BEHAVIOUR",
      sentiment: "CONCERN",
      text: "আজ ক্লাসে মনোযোগ একটু কম ছিল। বাড়িতে রাতে সময়মতো ঘুমানোর দিকে খেয়াল রাখবেন।",
      createdAt: at("2026-11-04", "11:00"),
      deliveredAt: at("2026-11-04", "14:00"),
      deliveryChannels: ["inbox"],
      readConfirmRequired: true,
    }),
    cm(b.students.c3Boys[1], boys, T, { type: "ATTENDANCE", sentiment: "CONCERN", text: "পরপর দুই দিন দেরিতে স্কুলে এসেছে।", createdAt: at(TODAY, "09:00") }),
    cm(b.students.c3Boys[3], boys, T, { type: "STUDY_HOMEWORK", sentiment: "POSITIVE", text: "বাংলা কবিতা খুব সুন্দর আবৃত্তি করেছে।", createdAt: at(TODAY, "09:30") }),
    cm(b.students.c3Girls[1], girls, T2, { type: "GENERAL", sentiment: "POSITIVE", text: "সবার সাথে সুন্দর ব্যবহার করে, দলের কাজে সাহায্য করে।", createdAt: at(TODAY, "10:00") }),
    cm(b.students.c3Girls[2], girls, T2, {
      type: "STUDY_HOMEWORK",
      sentiment: "POSITIVE",
      text: "ইংরেজি শব্দগুলো ভালোভাবে মুখস্থ করেছে।",
      createdAt: at("2026-11-03", "11:00"),
      deliveredAt: at("2026-11-03", "14:00"),
      deliveryChannels: ["inbox"],
      readConfirmRequired: true,
    }),
  ]);

  // ── Pop-ups: one read earlier, one still due today (pops up at login) ──
  const vars = {
    name: "উদাহরণ অভিভাবক",
    childNames: ["আরিফ হোসেন", "নাফিসা রহমান"],
    classLabels: ["৩য় শ্রেণি · বালক", "৩য় শ্রেণি · বালিকা"],
    group: "৩য় শ্রেণি",
    phone: "01800000001",
  };
  const notice = async (titleBn: string, bodyBn: string, k: string, endsOn: string, read: boolean) => {
    const n = await PopupNotice.create({
      titleBn,
      bodyBn,
      tone: read ? "info" : "important",
      audience: { guardian: { classLevels: [3], sectionIds: [] }, userIds: [], studentIds: [] },
      audienceSummary: "৩য় শ্রেণির অভিভাবক",
      rules: { closeButton: true },
      actions: [{ id: "a1", kind: "ACK", labelBn: "বুঝেছি" }],
      repeat: "daily",
      startsAt: at(k, "09:00"),
      endsOn,
      status: "PUBLISHED",
      publishedAt: at(k, "09:00"),
      publishedBy: P,
      recipientCount: 1,
      createdBy: P,
      updatedBy: P,
    });
    await PopupNoticeRecipient.create({
      noticeId: n._id,
      recipientKind: "GUARDIAN",
      recipientId: b.guardianId,
      reachable: true,
      test: false,
      vars,
      ...(read ? { state: "READ", doneAt: at(k, "20:00"), closeMethod: "button" } : { state: "NOT_SEEN" }),
    });
  };
  await notice("শীতের পোশাক", "প্রিয় অভিভাবক, ১ নভেম্বর থেকে শিক্ষার্থীরা স্কুলের সোয়েটার পরে আসবে।", "2026-10-29", "2026-11-03", true);
  await notice(
    "বার্ষিক পরীক্ষার রুটিন",
    "প্রিয় অভিভাবক, বার্ষিক পরীক্ষা ২৩ নভেম্বর শুরু হবে। রুটিন অ্যাপের ‘পরীক্ষার রুটিন’ পাতায় দেখুন।",
    "2026-11-04",
    "2026-11-20",
    false,
  );

  // ── Annual exam: syllabus + routine for ৩য় শ্রেণি ──
  const exam = await Exam.create({
    academicYearId: b.yearId,
    term: "ANNUAL",
    name: "বার্ষিক পরীক্ষা ২০২৬",
    startDateKey: "2026-11-23",
    endDateKey: "2026-12-03",
    createdBy: P,
  });
  const pub = { status: "PUBLISHED", publishedAt: at("2026-11-01"), publishedBy: P, createdBy: P, updatedBy: P };
  await ExamSyllabus.create([
    {
      examId: exam._id,
      classId: b.classes.c3,
      subject: "BAN",
      fullMarks: 100,
      bodyMd: "- গদ্য: পাঠ ১–৮\n- কবিতা: ১–৫ (মুখস্থ: ‘আমাদের গ্রাম’)\n- ব্যাকরণ: বিশেষ্য, সর্বনাম",
      questionTypes: ["short_answer", "descriptive"],
      examDateKey: "2026-11-23",
      marks: [
        { seq: 1, label: "সংক্ষিপ্ত প্রশ্ন", itemType: "short_answer", count: 10, marksEach: 2, total: 20 },
        { seq: 2, label: "রচনামূলক প্রশ্ন", itemType: "descriptive", count: 8, marksEach: 10, total: 80 },
      ],
      ...pub,
    },
    {
      examId: exam._id,
      classId: b.classes.c3,
      subject: "MATH",
      fullMarks: 100,
      bodyMd: "- অধ্যায় ১–৭\n- ভগ্নাংশ, গুণ ও ভাগ, জ্যামিতির আকৃতি",
      questionTypes: ["short_answer", "descriptive"],
      examDateKey: "2026-11-25",
      marks: [
        { seq: 1, label: "সংক্ষিপ্ত প্রশ্ন", itemType: "short_answer", count: 20, marksEach: 1, total: 20 },
        { seq: 2, label: "অঙ্ক", itemType: "descriptive", count: 8, marksEach: 10, total: 80 },
      ],
      ...pub,
    },
    {
      examId: exam._id,
      classId: b.classes.c3,
      subject: "ENG",
      fullMarks: 100,
      bodyMd: "- Units 1–8\n- Grammar: noun, verb\n- Writing: a paragraph about my family",
      questionTypes: ["short_answer", "descriptive"],
      examDateKey: "2026-11-26",
      marks: [
        { seq: 1, label: "Short questions", itemType: "short_answer", count: 10, marksEach: 2, total: 20 },
        { seq: 2, label: "Writing", itemType: "descriptive", count: 8, marksEach: 10, total: 80 },
      ],
      ...pub,
    },
  ]);
  await ExamRoutine.create({
    examId: exam._id,
    noteBn: "পরীক্ষা সকাল ৭:৩০-এ শুরু। ১৫ মিনিট আগে উপস্থিত থাকবে।",
    publishedAt: at("2026-11-01"),
    publishedBy: P,
    updatedBy: P,
    slots: [
      { classId: b.classes.c3, dateKey: "2026-11-23", subject: "BAN", kind: "WRITTEN", start: "07:30", end: "10:30", note: "" },
      { classId: b.classes.c3, dateKey: "2026-11-25", subject: "MATH", kind: "WRITTEN", start: "07:30", end: "10:30", note: "" },
      { classId: b.classes.c3, dateKey: "2026-11-26", subject: "ENG", kind: "WRITTEN", start: "07:30", end: "10:30", note: "" },
    ],
  });

  // ── Saturday revision (আরিফ in a Quran group) ──
  const qg = await SubjectGroup.create({ track: "quran", level: "Hifz 1", gender: "boys", code: "Q-H1-B", nameBn: "হিফয ১ (বালক)", active: true });
  await SubjectGroupMembership.create({ groupId: qg._id, studentId: arif, track: "quran" });
  const zero = { harf: 0, ghunnah: 0, madd: 0, other: 0 };
  await RevisionEntry.create([
    {
      groupId: qg._id,
      studentId: arif,
      date: day("2026-10-31"),
      present: true,
      portions: [
        { category: "SABAQ", status: "COMPLETED", fromSurah: 78, fromAyah: 1, toSurah: 78, toAyah: 16, tanbih: 1, fath: 0, mistakes: { ...zero, harf: 1 } },
        { category: "SABQI", status: "PARTIAL", fromSurah: 79, fromAyah: 1, toSurah: 79, toAyah: 20, tanbih: 2, fath: 1, mistakes: { ...zero, madd: 1 }, note: "শেষ অংশ আবার পড়বে" },
        { category: "MANZIL", status: "COMPLETED", fromSurah: 80, fromAyah: 1, toSurah: 80, toAyah: 42, tanbih: 0, fath: 0, mistakes: zero },
      ],
      teacherComment: "মাশাআল্লাহ ভালো পড়েছে, মাদ্দের দিকে আরেকটু খেয়াল রাখবে।",
      teacherUserId: T,
      deliveredAt: at("2026-10-31", "13:00"),
      deliveryChannels: ["inapp"],
    },
    {
      groupId: qg._id,
      studentId: arif,
      date: day("2026-10-24"),
      present: true,
      portions: [
        { category: "SABAQ", status: "COMPLETED", fromSurah: 77, fromAyah: 1, toSurah: 77, toAyah: 28, tanbih: 0, fath: 0, mistakes: zero },
        { category: "SABQI", status: "COMPLETED", fromSurah: 78, fromAyah: 1, toSurah: 78, toAyah: 40, tanbih: 1, fath: 0, mistakes: zero },
        { category: "MANZIL", status: "NOT_DONE", tanbih: 0, fath: 0, mistakes: zero },
      ],
      teacherComment: "সবক ভালো হয়েছে।",
      teacherUserId: T,
      deliveredAt: at("2026-10-24", "13:00"),
      deliveryChannels: ["inapp"],
    },
  ]);

  // ── Mastery: ৩য় শ্রেণি গণিত switched on, three outcomes, evidence for আরিফ ──
  await MasteryEnablement.create({ academicYearId: b.yearId, classToken: "C3", subject: "MATH", enabled: true, changedAt: at("2026-10-01") });
  const LOS = [
    ["C3-MATH-H1", "দুটি ভগ্নাংশের মধ্যে কোনটি বড় তা বলতে পারে", "রুটি বা কাগজ ভাগ করে অর্ধেক ও চার ভাগের এক ভাগ দেখান।"],
    ["C3-MATH-H2", "গুণের নামতা (২–১০) মুখে বলতে পারে", null],
    ["C3-MATH-H3", "ত্রিভুজ, চতুর্ভুজ ও বৃত্ত চিনতে পারে", "ঘরের জিনিসে আকৃতি খুঁজে বের করতে বলুন।"],
    ["C3-MATH-H4", "ঘড়ি দেখে সময় বলতে পারে", null],
  ];
  await MasteryOutcome.create(
    LOS.map(([code, labelBn, homeTipBn], i) => ({ code, classToken: "C3", subject: "MATH", labelBn, homeTipBn, assess: "QUESTION", order: i + 1, status: "LOCKED" })),
  );
  const paper1 = new Types.ObjectId();
  const paper2 = new Types.ObjectId();
  const ev = (studentId: Types.ObjectId, loCode: string, paperId: Types.ObjectId, qid: string, earned: number, k: string, week: string) => ({
    studentId,
    sectionId: boys,
    academicYearId: b.yearId,
    classToken: "C3",
    subject: "MATH",
    loCode,
    source: "CT",
    paperId,
    qid,
    earned,
    available: 2,
    signal: "NONE",
    at: day(k),
    week,
  });
  const evid = [];
  for (const [i, sid] of b.students.c3Boys.entries()) {
    const good = i !== 2 && i !== 4;
    evid.push(
      ev(sid, "C3-MATH-H1", paper1, "q1", sid === arif ? 0 : good ? 2 : 0, "2026-10-08", "2026-W41"),
      ev(sid, "C3-MATH-H1", paper1, "q2", sid === arif ? 0.5 : good ? 1.5 : 0.5, "2026-10-08", "2026-W41"),
      ev(sid, "C3-MATH-H2", paper1, "q3", 2, "2026-10-08", "2026-W41"),
      ev(sid, "C3-MATH-H2", paper2, "q4", good ? 2 : 1, "2026-10-22", "2026-W43"),
      ev(sid, "C3-MATH-H3", paper1, "q5", sid === arif ? 0.5 : 1.5, "2026-10-08", "2026-W41"),
      ev(sid, "C3-MATH-H3", paper2, "q6", 2, "2026-10-22", "2026-W43"),
      ev(sid, "C3-MATH-H3", paper2, "q7", 2, "2026-10-29", "2026-W44"),
    );
  }
  await MasteryEvidence.create(evid);

  // ── Improvement actions (progress board) ──
  const past = schoolDays("2026-10-27", "2026-11-04");
  const future = schoolDays(TODAY, "2026-11-12");
  const rafi = b.students.c3Boys[2];
  const a1 = await ImprovementAction.create({
    scope: "STUDENT",
    sectionId: boys,
    classId: b.classes.c3,
    studentId: rafi,
    subject: "MATH",
    reason: "শেষ দুই ক্লাস টেস্টে নম্বর কমেছে; ধাপ লিখে না",
    teacherUserId: T,
    teacherTask: "ক্লাসে ৫ মিনিট আলাদা করে দুটি অঙ্ক ধাপে ধাপে করান",
    guardianTask: "বাড়িতে দুটি অঙ্ক ধাপ লিখে করান",
    repeat: "EVERY_SCHOOL_DAY",
    days: past.length + future.length,
    startKey: past[0],
    dayKeys: [...past, ...future],
    alertClassTeacher: true,
    createdBy: P,
  });
  await ImprovementTick.create(
    past.map((k, i) =>
      i === 3
        ? { actionId: a1._id, part: "TEACHER", dayKey: k, studentId: null, status: "COULDNT", reason: "STUDENT_ABSENT", markedByUserId: T }
        : { actionId: a1._id, part: "TEACHER", dayKey: k, studentId: null, status: "DONE", markedByUserId: T },
    ),
  );
  const sadia = b.students.c3Girls[1];
  const a2 = await ImprovementAction.create({
    scope: "STUDENT",
    sectionId: girls,
    classId: b.classes.c3,
    studentId: nafisa,
    subject: "ENG",
    reason: "নতুন শব্দের বানানে ভুল হচ্ছে",
    teacherUserId: T2,
    teacherTask: "ক্লাস শেষে ৫টি শব্দের বানান জিজ্ঞেস করুন",
    guardianTask: "রাতে ৫টি নতুন ইংরেজি শব্দ খাতায় লেখান",
    repeat: "EVERY_SCHOOL_DAY",
    days: past.length + future.length,
    startKey: past[0],
    dayKeys: [...past, ...future],
    alertClassTeacher: false,
    createdBy: P,
  });
  await ImprovementTick.create(
    past.slice(0, 4).map((k) => ({ actionId: a2._id, part: "GUARDIAN", dayKey: k, studentId: nafisa, status: "DONE", markedByGuardianId: b.guardianId })),
  );
  void sadia;

  // ── Guardian app usage: logins and screen views ──
  const audits = [];
  const views = [];
  const loginDays = (n: number, startAgo: number) =>
    Array.from({ length: n }, (_, i) => new Date(at(TODAY, "20:00").getTime() - (startAgo + i * 2) * 86400000));
  const usage: [Types.ObjectId, Date[]][] = [
    [b.guardianId, loginDays(12, 0)],
    [otherGuardians[0], loginDays(10, 1)],
    [otherGuardians[1], loginDays(3, 2)],
    [otherGuardians[2], loginDays(2, 45)],
  ];
  for (const [gid, dates] of usage) {
    for (const d of dates) {
      audits.push({ eventKind: "LOGIN_SUCCESS", actorRole: "GUARDIAN", actorId: gid, eventAt: d });
      for (const surface of ["HOME", "HOMEWORK", "CLASS_NOTES"]) {
        views.push({ guardianId: gid, surface, dayKey: d.toISOString().slice(0, 10), count: 2, firstAt: d, lastAt: d });
      }
    }
  }
  await Audit.insertMany(audits);
  await GuardianView.insertMany(views);

  // ── Parents' meeting: an earlier one (done), and the next one (timetable sent, notes open) ──
  const m1 = await createParentMeeting({
    instanceLabel: "২০২৬ — ১ম অভিভাবক সভা",
    meetingDate: "2026-05-16",
    slotMinutes: 10,
    dayStartMinutes: 540,
    includeClassIds: [String(b.classes.c3)],
    actorId: String(P),
  });
  await generateSlots(m1.id, String(P));
  await dispatchMeetingSchedule(m1.id, String(P));
  for (const [i, s] of (await MeetingSlot.find({ meetingId: m1.id }).sort({ order: 1 }).lean()).entries()) {
    await setSlotAttendance(String(s._id), i % 4 !== 3, undefined, String(P));
  }
  const m2 = await createParentMeeting({
    instanceLabel: "২০২৬ — ২য় অভিভাবক সভা",
    meetingDate: "2026-11-14",
    slotMinutes: 10,
    dayStartMinutes: 540,
    includeClassIds: [String(b.classes.c3)],
    actorId: String(P),
  });
  await setMeetingBreaks(m2.id, [{ startMinutes: 600, endMinutes: 615 } as never], String(P));
  await generateSlots(m2.id, String(P));
  await dispatchMeetingSchedule(m2.id, String(P));
  const slots2 = await MeetingSlot.find({ meetingId: m2.id }).lean();
  const slotOfStudent = (sid: Types.ObjectId) => slots2.find((s: any) => (s.studentIds ?? []).map(String).includes(String(sid)));
  const answer = async (gi: number, choice: string, extra: object = {}) => {
    const sid = families[gi][0];
    const slot = slotOfStudent(sid);
    if (slot) await respondToMeetingSlot({ slotId: String(slot._id), guardianId: String(otherGuardians[gi]), choice, ...extra });
  };
  await answer(0, "CONFIRMED");
  await answer(2, "CONFIRMED");
  await answer(3, "CANT_COME", { reason: "অফিসের জরুরি কাজ আছে" });
  {
    const free = slots2.filter((s: any) => !s.response && s !== slotOfStudent(families[1][0]) && s !== slotOfStudent(b.students.c3Boys[0])).slice(-1)[0];
    await answer(1, "CHANGE_REQUESTED", { preferredSlotId: free ? String(free._id) : null });
  }
  await openCommentCollection({ meetingId: m2.id, subjectDueKey: "2026-11-09", summaryDueKey: "2026-11-12", actorId: String(P) });
  // Subject notes: the class teacher of ৩য় বালিকা (teacher2) has written ENG for four girls;
  // the BAN teacher (teacher) has written BAN for three; so a few girls are ready for a summary.
  const notes = (await MeetingSubjectNote.find({ meetingId: m2.id }).lean()) as any[];
  const girlsSet = b.students.c3Girls.map(String);
  const write = async (subject: string, n: number, strengths: string, concerns: string) => {
    const rows = notes.filter((r) => r.subject === subject && girlsSet.includes(String(r.studentId))).sort((x, y) => girlsSet.indexOf(String(x.studentId)) - girlsSet.indexOf(String(y.studentId)));
    for (const r of rows.slice(0, n)) {
      await saveSubjectNote({ meetingId: m2.id, studentId: String(r.studentId), subject, strengths, concerns, actorId: String(r.teacherId) });
    }
  };
  await write("ENG", 4, "নতুন শব্দ দ্রুত শেখে, ক্লাসে উত্তর দেয়।", "লেখার সময় বানানে ভুল হয়।");
  await write("MATH", 4, "অঙ্কে আগ্রহ আছে।", "কথার সমস্যায় ধাপ বাদ দেয়।");
  await write("BAN", 4, "সুন্দর করে পড়ে।", "হাতের লেখা আরও পরিষ্কার হওয়া দরকার।");
  for (const name of ["SCI", "BGS", "ISLAM"]) await write(name, 4, "ক্লাসে মনোযোগী।", "বাড়ির পড়া নিয়মিত করা দরকার।");
  await saveMeetingComment({
    meetingId: m2.id,
    studentId: String(b.students.c3Girls[3]),
    positiveText: "সব বিষয়ে নিয়মিত, শিক্ষকদের কথা মন দিয়ে শোনে।",
    concernText: "ইংরেজি বানান ও অঙ্কের ধাপ লেখায় আরও যত্ন দরকার।",
    actorId: String(T2),
  });

  // ── Monthly report (October) for ৩য় বালক: built; drafts; two approved; আরিফ's released ──
  await buildSectionMonthlyReports(String(boys), "2026-10");
  const reports = (await MonthlyReport.find({ sectionId: boys, periodKey: "2026-10" }).lean()) as any[];
  const order = b.students.c3Boys.map(String);
  reports.sort((x, y) => order.indexOf(String(x.studentId)) - order.indexOf(String(y.studentId)));
  const para = (name: string) =>
    `${name} অক্টোবর মাসে নিয়মিত স্কুলে এসেছে এবং ক্লাস টেস্টে ভালো করেছে। বাড়ির কাজ সময়মতো জমা দেয়। বাড়িতে প্রতিদিন কিছুক্ষণ বই পড়ার অভ্যাস করালে আরও উন্নতি হবে।`;
  const names = ["আরিফ", "তানভীর", "রাফি", "সাকিব", "নাঈম", "ফাহিম"];
  for (const [i, r] of reports.entries()) {
    if (i === 5) continue; // no draft yet
    await MonthlyReport.updateOne(
      { _id: r._id },
      {
        $set: {
          commentDraft: { text: para(names[i]), source: "MODEL", model: "example", promptVersion: "example", promptHash: "-", generatedAt: at("2026-11-03"), fallback: false },
        },
      },
    );
  }
  for (const i of [0, 1, 3]) await reviewMonthlyReport(String(reports[i]._id), para(names[i]), String(T));
  await releaseMonthlyReport(String(reports[0]._id), String(P), { isPrincipal: true });
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    // --reset: start a re-shoot from an empty database (still local-only, guarded above).
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    const base = await seedBaseSchool();
    await seedFamily(base);
    console.log("fixture: family (routine, notes, homework, assignments, tests, attendance, comments, pop-ups, exam, revision, mastery, meetings, monthly report, progress board)");
    console.log(JSON.stringify(base));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
