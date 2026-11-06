/**
 * Example data for the `notes` help guides (class notes, lesson-plan progress, routine,
 * covers, classes & শাখা, teaching assignments). LOCAL ONLY, create-only.
 *
 *   $env:MONGODB_URI='mongodb://127.0.0.1:27915/hc'; $env:TZ='Asia/Dhaka'
 *   $env:HELP_NOW='2026-11-05T10:20:00+06:00'
 *   npx tsx --require ./scripts/help/fixtures/notes-clock.cjs scripts/help/fixtures/notes.ts --reset
 *
 * Built on seedBaseSchool() (scripts/help/fixture.ts) and, wherever the app has one, the
 * app's own service, so the screens show real states:
 *   - a 2026 schedule window + the Class 1–5 period grid (7:00 start; P4 = টিফিন);
 *   - three more example teachers (science, ইসলাম শিক্ষা, কুরআন) with StaffProfiles;
 *   - one Quran group (নাজেরা) and one Arabic group (বুক ২) with the ৩য় বালক children;
 *   - the Sunday–Thursday routine of ৩য় বালক, ৩য় বালিকা and ৫ম ক through createRoutineSlot
 *     (conflict engine + teaching-grant binding run as on the real screen);
 *   - class notes for Sun–Wed (a few left unwritten, so the report has gaps) through
 *     publishClassNote, with lesson-plan sessions marked on ৩য় গণিত;
 *   - ৩য় শ্রেণির গণিত session plans (ContentArtifact rows: the lesson-plan importer has no
 *     service entry point, so they are inserted as the importer stores them);
 *   - the science teacher on an approved casual leave TODAY (applyForLeave + decideLeave),
 *     so the needs-cover list and the live class board have uncovered periods;
 *   - two holidays (one past, one coming).
 * The lesson-plan question switch is turned ON while the old notes are written and turned
 * OFF again at the end: the walk shows the Principal turning it on through the real card.
 *
 * "Today" for this data is HELP_NOW (default Thursday 2026-11-05, during period 6).
 */
import mongoose from "mongoose";
import { seedBaseSchool } from "../fixture";
import { User } from "../../../src/modules/foundation/models/User";
import { StaffProfile } from "../../../src/modules/foundation/models/StaffProfile";
import { Student } from "../../../src/modules/foundation/models/Student";
import { hashPassword } from "../../../src/modules/foundation/services/AuthService";
import { Room } from "../../../src/modules/routine/models/Room";
import { PeriodGrid } from "../../../src/modules/routine/models/PeriodGrid";
import { ScheduleWindow } from "../../../src/modules/routine/models/ScheduleWindow";
import { SubjectGroup } from "../../../src/modules/routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../../../src/modules/routine/models/SubjectGroupMembership";
import { HolidayException } from "../../../src/modules/routine/models/HolidayException";
import { ContentArtifact } from "../../../src/modules/content/models/ContentArtifact";
import { createRoutineSlot } from "../../../src/modules/routine/services/RoutineSlotService";
import { publishClassNote } from "../../../src/modules/routine/services/RoutineTriggerService";
import { recordDelivery } from "../../../src/modules/lesson-progress/services/LessonDeliveryService";
import { setLessonPlanQuestionOn } from "../../../src/modules/lesson-progress/services/LessonPlanQuestionSwitch";
import { applyForLeave, decideLeave } from "../../../src/modules/hr/services/StaffLeaveService";
import type { DayOfWeek, RoutineSubject } from "@scd/shared";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

const DAYS: DayOfWeek[] = ["SUN", "MON", "TUE", "WED", "THU"];
/** Sun..Thu of the example week; Thursday is "today". */
const WEEK: Record<DayOfWeek, string> = {
  SUN: "2026-11-01",
  MON: "2026-11-02",
  TUE: "2026-11-03",
  WED: "2026-11-04",
  THU: "2026-11-05",
  FRI: "2026-11-06",
  SAT: "2026-10-31",
};
const TODAY = WEEK.THU;

/** What each period taught, per subject (the class-note text). */
const TAUGHT: Record<string, string[]> = {
  MATH: [
    "সংখ্যা পড়া ও লেখা: চার অঙ্কের সংখ্যা স্থানীয় মানসহ লেখা অনুশীলন করানো হয়েছে।",
    "হাতে রেখে যোগ: বই থেকে অনুশীলনী ২.১-এর ১ থেকে ৫ নম্বর করানো হয়েছে।",
    "বিয়োগ: খাড়াভাবে বিয়োগের নিয়ম বোর্ডে দেখিয়ে তিনটি অঙ্ক করানো হয়েছে।",
    "গুণের নামতা: ৬ ও ৭-এর নামতা মুখে মুখে ও খাতায় অনুশীলন।",
  ],
  BAN: [
    "‘আমাদের গ্রাম’ কবিতাটি সবাই মিলে পড়া হয়েছে, কঠিন শব্দের অর্থ বলা হয়েছে।",
    "যুক্তবর্ণ চেনা: ক্ষ, ঞ্চ, ন্ত দিয়ে শব্দ গঠন করানো হয়েছে।",
    "গল্প পড়া ও প্রশ্নোত্তর: ‘সততার পুরস্কার’ গল্পের পাঁচটি প্রশ্ন।",
    "বাক্য গঠন: দেওয়া শব্দ দিয়ে পাঁচটি বাক্য লেখা।",
  ],
  ENG: [
    "Unit 5: new words (market, buy, sell) and reading the dialogue aloud.",
    "Unit 5: answering the questions of Lesson 2 in the exercise book.",
    "Spelling practice: ten words from Units 4 and 5.",
    "Writing: five sentences about my family.",
  ],
  SCI: [
    "আমাদের পরিবেশ: জীব ও জড় বস্তুর পার্থক্য উদাহরণসহ আলোচনা।",
    "উদ্ভিদের অংশ: মূল, কাণ্ড, পাতার কাজ ছবি এঁকে দেখানো হয়েছে।",
    "পানি: পানির তিন অবস্থা পরীক্ষা করে দেখানো হয়েছে।",
  ],
  BGS: [
    "আমাদের দেশ: বিভাগের নাম ও মানচিত্রে অবস্থান চেনা।",
    "মুক্তিযুদ্ধ: জাতীয় দিবসগুলোর তালিকা তৈরি।",
  ],
  ISLAM: [
    "ওযুর নিয়ম: ধাপে ধাপে মুখে বলা ও দেখানো হয়েছে।",
    "সালাতের গুরুত্ব নিয়ে আলোচনা ও দোয়া মুখস্থ।",
  ],
};

// The routine: [period, subject, teacher key] per শাখা, Sunday–Thursday. No teacher is in
// two places at once (the conflict engine refuses that anyway).
type Cell = [number, RoutineSubject, string];
function sectionDay(day: DayOfWeek): Record<"c3Boys" | "c3Girls" | "c5", Cell[]> {
  const bgsDay = day === "MON" || day === "WED";
  return {
    c3Boys: [
      [5, "MATH", "teacher"],
      [6, "BAN", "teacher"],
      [7, "ENG", "islam"],
      [8, bgsDay ? "BGS" : "SCI", "science"],
    ],
    c3Girls: [
      [5, "ENG", "teacher2"],
      [6, "MATH", "teacher2"],
      [7, "BAN", "reviewer"],
      [8, "ISLAM", "islam"],
    ],
    // ৫ম ক has no 7th period on Sunday yet: the "add a period" guide fills it.
    c5: [
      [5, bgsDay ? "BGS" : "SCI", "science"],
      [6, "BAN", "reviewer"],
      ...(day === "SUN" ? [] : ([[7, "ENG", "teacher2"]] as Cell[])),
      [8, "MATH", "teacher"],
    ],
  };
}

export async function seedNotes() {
  const base = await seedBaseSchool();
  const { users, classes, sections, students, yearId } = base;
  const principal = users.principal.toString();

  // ── More example teachers (the base school has five staff logins) ─────────
  const passwordHash = await hashPassword("Help@123");
  const extra = [
    { key: "science", email: "science@help.test", phone: "01700000006", name: "উদাহরণ বিজ্ঞান শিক্ষক" },
    { key: "islam", email: "islam@help.test", phone: "01700000007", name: "উদাহরণ ইসলাম শিক্ষা শিক্ষক" },
    { key: "quran", email: "quran@help.test", phone: "01700000008", name: "উদাহরণ কুরআন শিক্ষক" },
  ];
  const staffIds: Record<string, string> = {};
  for (const [i, s] of extra.entries()) {
    const u = await User.create({ email: s.email, phone: s.phone, name: s.name, role: "TEACHER", passwordHash, active: true, grantedPermissions: [] });
    users[s.key] = u._id;
    const p = await StaffProfile.create({
      schoolId: `S-${String(i + 6).padStart(2, "0")}`,
      name: s.name,
      phone: s.phone,
      category: "teacher",
      employmentType: "full_time",
      employmentStatus: "confirmed",
      gender: i % 2 ? "female" : "male",
      active: true,
    });
    staffIds[s.key] = p._id.toString();
  }

  // ── Calendar: the 2026 window and the Class 1–5 period grid ──────────────
  await ScheduleWindow.create({
    academicYearId: yearId,
    fromDate: new Date("2026-01-01"),
    toDate: new Date("2026-12-31"),
    season: "regular",
    dayStartMinutes: 420,
    label: "নিয়মিত ২০২৬",
    active: true,
  });
  await PeriodGrid.create({
    audienceKey: "class_1_5",
    classLevels: [1, 2, 3, 4, 5],
    season: "regular",
    active: true,
    periods: [
      { number: 1, durationMin: 45, isBreak: false, track: "quran", nameBn: "১ম" },
      { number: 2, durationMin: 45, isBreak: false, track: "quran", nameBn: "২য়" },
      { number: 3, durationMin: 40, isBreak: false, track: "arabic", nameBn: "৩য়" },
      { number: 4, durationMin: 30, isBreak: true, track: "general", nameBn: "টিফিন" },
      { number: 5, durationMin: 35, isBreak: false, track: "general", nameBn: "৪র্থ" },
      { number: 6, durationMin: 35, isBreak: false, track: "general", nameBn: "৫ম" },
      { number: 7, durationMin: 35, isBreak: false, track: "general", nameBn: "৬ষ্ঠ" },
      { number: 8, durationMin: 35, isBreak: false, track: "general", nameBn: "৭ম" },
    ],
  });
  const rooms = await Room.create([
    { code: "R-301", nameBn: "কক্ষ ৩০১", capacity: 30, active: true },
    { code: "R-302", nameBn: "কক্ষ ৩০২", capacity: 30, active: true },
    { code: "R-501", nameBn: "কক্ষ ৫০১", capacity: 30, active: true },
  ]);
  const roomOf = { c3Boys: rooms[0]._id.toString(), c3Girls: rooms[1]._id.toString(), c5: rooms[2]._id.toString() } as const;

  // ── Quran / Arabic groups (P1–P3), with the ৩য় বালক children as members ──
  const quranGroup = await SubjectGroup.create({ track: "quran", level: "Najera", gender: "boys", code: "QURAN_NAJERA_BOYS", nameBn: "নাজেরা (বালক)", active: true });
  const arabicGroup = await SubjectGroup.create({ track: "arabic", level: "Book 2", gender: "boys", code: "ARABIC_BOOK_2_BOYS", nameBn: "বুক ২ (বালক)", active: true });
  for (const sid of students.c3Boys) {
    await SubjectGroupMembership.create({ groupId: quranGroup._id, studentId: sid, track: "quran" });
    await SubjectGroupMembership.create({ groupId: arabicGroup._id, studentId: sid, track: "arabic" });
  }

  // ── The routine, through the real service ─────────────────────────────────
  const from = new Date("2026-01-01T00:00:00");
  const slotId: Record<string, string> = {}; // `${day}|${sectionKey}|${period}` → id
  for (const day of DAYS) {
    for (const p of [1, 2]) {
      await createRoutineSlot({ groupType: "subjectgroup", groupId: quranGroup._id.toString(), dayOfWeek: day, periodNumber: p, subject: "QURAN", track: "quran", isBreak: false, teacherId: users.quran.toString(), effectiveFrom: from, createdBy: principal });
    }
    await createRoutineSlot({ groupType: "subjectgroup", groupId: arabicGroup._id.toString(), dayOfWeek: day, periodNumber: 3, subject: "ARABIC", track: "arabic", isBreak: false, teacherId: users.islam.toString(), effectiveFrom: from, createdBy: principal });
    const grid = sectionDay(day);
    for (const key of ["c3Boys", "c3Girls", "c5"] as const) {
      for (const [period, subject, teacher] of grid[key]) {
        const { slot } = await createRoutineSlot({
          groupType: "section",
          groupId: sections[key].toString(),
          dayOfWeek: day,
          periodNumber: period,
          subject,
          track: "general",
          isBreak: false,
          teacherId: users[teacher].toString(),
          roomId: roomOf[key],
          effectiveFrom: from,
          createdBy: principal,
        });
        slotId[`${day}|${key}|${period}`] = slot._id.toString();
      }
    }
  }

  // ── ৩য় শ্রেণির গণিত session plans (what the lesson-plan importer stores) ──
  const chapters: Array<[number, string, string[]]> = [
    [1, "সংখ্যা", ["চার অঙ্কের সংখ্যা", "স্থানীয় মান", "সংখ্যার তুলনা"]],
    [2, "যোগ", ["হাতে না রেখে যোগ", "হাতে রেখে যোগ"]],
    [3, "বিয়োগ", ["খাড়াভাবে বিয়োগ", "হাতে রেখে বিয়োগ"]],
  ];
  for (const [num, title, sessions] of chapters) {
    for (const [i, sTitle] of sessions.entries()) {
      await ContentArtifact.create({
        docType: "session_plan",
        subject: "MATH",
        classLevel: 3,
        address: { anchorWord: "অধ্যায়", number: num, title },
        curationTag: "KEEP_AS_IS",
        reviewStatus: "reviewed",
        current: true,
        importedBy: users.principal,
        envelopeJson: { payload: { session_plan: { session_form: "multi_period", period_index: i + 1, period_of: sessions.length, session_title: sTitle } } },
      });
    }
  }

  // ── Class notes for Sunday–Wednesday (the switch is on while they are written) ──
  await setLessonPlanQuestionOn(true, principal);
  const missing = new Set(["WED|c3Girls|7", "WED|c5|8", "TUE|c5|5", "WED|c3Boys|8"]);
  // The session each ৩য় গণিত period finished (বালক is ahead of বালিকা).
  const mathPlan: Record<string, string> = {
    "SUN|c3Boys|5": "1:1",
    "MON|c3Boys|5": "1:2",
    "TUE|c3Boys|5": "1:3",
    "WED|c3Boys|5": "2:1",
    "MON|c3Girls|6": "1:1",
    "WED|c3Girls|6": "1:2",
  };
  let n = 0;
  for (const day of ["SUN", "MON", "TUE", "WED"] as DayOfWeek[]) {
    const grid = sectionDay(day);
    for (const key of ["c3Boys", "c3Girls", "c5"] as const) {
      for (const [period, subject, teacher] of grid[key]) {
        const k = `${day}|${key}|${period}`;
        if (missing.has(k)) continue;
        const texts = TAUGHT[subject] ?? TAUGHT.BAN;
        n += 1;
        const note = await publishClassNote({
          slotId: slotId[k],
          date: new Date(WEEK[day]),
          taughtSummaryBn: texts[n % texts.length],
          actorId: users[teacher].toString(),
          canManage: false,
        });
        if (mathPlan[k]) await recordDelivery(note, { sessions: [{ key: mathPlan[k], finished: true }] }, users[teacher].toString());
      }
    }
  }
  // Today: the other teachers' morning notes are in; teacher@help.test writes theirs in the walk.
  for (const k of ["THU|c3Girls|5", "THU|c3Girls|6", "THU|c5|6"]) {
    const [, key, p] = k.split("|");
    const cell = sectionDay("THU")[key as "c3Girls" | "c5"].find((c) => c[0] === Number(p))!;
    n += 1;
    await publishClassNote({ slotId: slotId[k], date: new Date(TODAY), taughtSummaryBn: (TAUGHT[cell[1]] ?? TAUGHT.BAN)[n % 2], actorId: users[cell[2]].toString(), canManage: false });
  }
  await setLessonPlanQuestionOn(false, principal);

  // ── The science teacher is on an approved leave today → periods need a cover ──
  const leave = await applyForLeave({
    staffProfileId: staffIds.science,
    leaveType: "casual",
    fromKey: TODAY,
    toKey: TODAY,
    reason: "পারিবারিক প্রয়োজন",
    actorId: users.science.toString(),
  });
  await decideLeave(leave._id.toString(), "approve", principal);

  // ── Holidays ──────────────────────────────────────────────────────────────
  await HolidayException.create([
    { fromDate: new Date("2026-10-20"), toDate: new Date("2026-10-22"), type: "special", nameBn: "দুর্গাপূজার ছুটি", active: true },
    { fromDate: new Date("2026-12-16"), toDate: new Date("2026-12-16"), type: "govt", nameBn: "বিজয় দিবস", active: true },
  ]);

  const studentCount = await Student.countDocuments({});
  return { ...base, staffIds, quranGroupId: quranGroup._id, arabicGroupId: arabicGroup._id, notes: n, studentCount };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    const ids = await seedNotes();
    console.log(`fixture: notes (routine for 3 শাখা, ${ids.notes} class notes, 1 leave needing cover, 2 holidays)`);
    console.log(JSON.stringify({ users: ids.users, sections: ids.sections, classes: ids.classes } as Record<string, unknown>));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export type NotesIds = Awaited<ReturnType<typeof seedNotes>>;
