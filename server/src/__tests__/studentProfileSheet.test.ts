/**
 * Student-profile printable sheet (SP-4, prd-student-profile §9, D-#360).
 *
 * `buildProfileSheetMarkdown` is pure (the clock is injected), so the BODY of a sheet
 * that will be handed to a guardian is asserted directly — no PDF needed. The two
 * rules that matter because the sheet leaves the building:
 *
 *   · a NARROWED sheet says so ON THE PAGE, and carries only the caller's subjects;
 *   · the footer names who printed it and when.
 *
 * Plus: Bangla numerals throughout (it reads like the screen), and an empty window
 * degrades to "nothing recorded" rather than a page of zeros pretending to be data.
 */
import {
  bn,
  buildProfileSheetMarkdown,
  type SheetInput,
} from "../modules/trackers/services/StudentProfileSheetService";
import type { TrackerCounters, StudentTrackerPanel } from "../modules/trackers/services/StudentProfileService";

const LABELS = { ENG: "ইংরেজি", BAN: "বাংলা", MATH: "গণিত" };

const counters = (over: Partial<TrackerCounters> = {}): TrackerCounters => ({
  sheets: 10, records: 11, received: 9, absentAtIssue: 1, notReceivedStill: 0,
  submitted: 8, notSubmitted: 1, awaiting: 0, pendingChecking: 0, pendingReturn: 0,
  chased: 2, chaseTotal: 3, checked: 8, returned: 8, resubmissions: 1,
  correct: 5, partial: 2, wrong: 1, qualityPct: 75, submissionPct: 88.9,
  graded: 0, avgMarksPct: null,
  ...over,
});

const panel = (over: Partial<StudentTrackerPanel> = {}): StudentTrackerPanel => ({
  studentId: "s1",
  fromKey: "2026-06-01",
  toKey: "2026-07-25",
  fullView: true,
  subjectFilter: [],
  totals: counters(),
  bySubject: [{ subject: "ENG", ...counters() }],
  items: [],
  ...over,
});

const input = (over: Partial<SheetInput> = {}): SheetInput => ({
  header: {
    studentId: "s1",
    name: "Musa Bin Sadik",
    nameBn: "মুসা বিন সাদিক",
    rollNumber: "12",
    gender: "M",
    dob: null,
    bloodGroup: "B+",
    phone: null,
    classLevel: 5,
    sectionId: "sec1",
    sectionNameBn: "সম্মিলিত",
    classTeacherName: "Nuha Karim",
    guardians: [
      { guardianId: "g1", name: "আব্দুল করিম", relation: "father", phone: "+8801711111111", primary: true },
      { guardianId: "g2", name: "সালমা বেগম", relation: "mother", phone: null, primary: false },
    ],
    academicYear: { academicYearId: "y1", label: "২০২৬", fromKey: "2026-01-01", toKey: "2026-07-25" },
  },
  attendance: {
    studentId: "s1",
    fromKey: "2026-06-01",
    toKey: "2026-07-25",
    markedDays: 40,
    absentDays: 6,
    presentPct: 85,
    absentUncoveredDays: 4,
    absentStreakMax: 3,
    recentPresentPct: 80,
    earlierPresentPct: 90,
    trajectory: "down",
    monthly: [],
    days: [],
    leaves: [
      {
        leaveId: "l1",
        fromKey: "2026-06-10",
        toKey: "2026-06-11",
        reason: "জ্বর",
        submittedAt: "2026-06-10T04:00:00.000Z",
        daysInWindow: 2,
      },
    ],
  },
  homework: panel(),
  assignment: panel({ totals: counters({ graded: 4, avgMarksPct: 72.5 }) }),
  classTest: {
    studentId: "s1",
    studentName: "মুসা বিন সাদিক",
    results: [
      {
        testId: "t1", ctId: "CT-C5-ENG-0003", subject: "ENG", testNumber: 3,
        examDate: "2026-07-10T00:00:00.000Z", status: "PRESENT", marks: 14, totalMarks: 20,
        percent: 70, pass: true,
        weakness: "বানান দুর্বল", teacherAction: "প্রতিদিন ৫টি বানান", guardianAction: "বাসায় শোনা",
      },
    ],
    bySubject: [
      { subject: "ENG", examsTaken: 3, avgPercent: 68.3, latestPercent: 70, previousPercent: 62, trend: "up" },
    ],
    analytics: {
      examsPresent: 3, avgPercent: 68.3, consistency: 4.2, slope: 3.1, trajectory: "up",
      atRisk: false, streakKind: "pass", streakLength: 3,
      bestSubject: "ENG", weakestSubject: "MATH",
      recurringWeaknesses: [{ tag: "বানান দুর্বল", count: 2 }],
      latestRank: 2, latestRankOf: 7,
    },
  },
  comments: {
    studentId: "s1",
    fromKey: "2026-06-01",
    toKey: "2026-07-25",
    tally: { total: 3, concern: 2, positive: 1, undelivered: 1 },
    comments: [
      {
        id: "c1", studentId: "s1", sectionId: "sec1", authorUserId: "u1",
        type: "BEHAVIOUR", sentiment: "CONCERN", text: "ক্লাসে মনোযোগ কম",
        attachmentIds: [], deliveredAt: null, deliveryChannels: [],
        discardedAt: null, discardReason: null,
        createdAt: "2026-07-01T04:00:00.000Z", updatedAt: "2026-07-01T04:00:00.000Z",
        authorName: "Nuha Karim",
      },
    ],
    timeline: {
      studentId: "s1",
      meetingComments: [
        {
          id: "m1", meetingId: "mt1", instanceLabel: "১ম সভা", meetingDate: "2026-05-10T00:00:00.000Z",
          studentId: "s1", authorUserId: "u1", positiveText: "আদব ভালো", concernText: "গণিতে দুর্বল",
          createdAt: "2026-05-10T00:00:00.000Z", updatedAt: "2026-05-10T00:00:00.000Z",
        },
      ],
      rollupSinceLastMeeting: [],
      sinceMeetingId: "mt1",
      sinceMeetingDate: "2026-05-10T00:00:00.000Z",
    },
  },
  subjectLabels: LABELS,
  printedByName: "Md Enayetur Rahman",
  printedAt: new Date("2026-07-25T09:30:00.000Z"),
  fullView: true,
  subjectFilter: [],
  ...over,
});

describe("bn (Bangla numerals)", () => {
  test("converts digits inside mixed strings and passes text through", () => {
    expect(bn(2026)).toBe("২০২৬");
    expect(bn("12")).toBe("১২");
    expect(bn(88.9)).toBe("৮৮.৯");
    expect(bn(null)).toBe("—");
    expect(bn(undefined)).toBe("—");
  });
});

describe("buildProfileSheetMarkdown — identity + window", () => {
  const md = buildProfileSheetMarkdown(input());

  test("leads with the child, class, section, roll and class teacher", () => {
    expect(md).toContain("# মুসা বিন সাদিক");
    expect(md).toContain("পঞ্চম শ্রেণি");
    expect(md).toContain("শাখা সম্মিলিত");
    expect(md).toContain("রোল ১২");
    expect(md).toContain("শ্রেণি শিক্ষক: Nuha Karim");
  });

  test("names the PRIMARY guardian with their phone (the number to call)", () => {
    expect(md).toContain("অভিভাবক: আব্দুল করিম (father) · +8801711111111");
    expect(md).not.toContain("সালমা বেগম"); // one contact on a one-page sheet
  });

  test("states the window it covers", () => {
    expect(md).toContain("সময়সীমা: 2026-06-01 — 2026-07-25");
  });
});

describe("buildProfileSheetMarkdown — the panels", () => {
  const md = buildProfileSheetMarkdown(input());

  test("attendance carries the uncovered count and the absent run, not just the rate", () => {
    expect(md).toContain("উপস্থিতির হার **৮৫%**");
    expect(md).toContain("ছুটি ছাড়া অনুপস্থিত ৪");
    expect(md).toContain("একটানা সর্বোচ্চ ৩ দিন");
    expect(md).toContain("সাম্প্রতিক ৮০% / পূর্বের ৯০%");
  });

  test("leave applications are listed so absences read as covered", () => {
    expect(md).toContain("2026-06-10 → 2026-06-11 (২ দিন) — জ্বর");
  });

  test("both trackers render a per-subject table with the outcome mix", () => {
    expect(md).toContain("## বাড়ির কাজ");
    expect(md).toContain("## অ্যাসাইনমেন্ট");
    expect(md).toContain("| ইংরেজি |"); // subject label, not the ENG code
    expect(md).toContain("৫/২/১"); // correct/partial/wrong
    expect(md).toContain("পুনঃজমা ১");
    expect(md).toContain("গড় নম্বর ৭২.৫%"); // assignment marks only
  });

  test("class test carries the trend table AND the teacher's own words", () => {
    expect(md).toContain("## ক্লাস টেস্ট");
    expect(md).toContain("উন্নতি");
    expect(md).toContain("বার বার: বানান দুর্বল ×২");
    expect(md).toContain("লক্ষণীয় দিক: বানান দুর্বল");
    expect(md).toContain("শিক্ষকের করণীয়: প্রতিদিন ৫টি বানান");
    expect(md).toContain("অভিভাবকের করণীয়: বাসায় শোনা");
  });

  test("comments carry the tally, the text and the last meeting note", () => {
    expect(md).toContain("উদ্বেগ ২ · প্রশংসা ১ · পাঠানো হয়নি ১");
    expect(md).toContain("ক্লাসে মনোযোগ কম — Nuha Karim");
    expect(md).toContain("১ম সভা: আদব ভালো / গণিতে দুর্বল");
  });
});

describe("buildProfileSheetMarkdown — traceability + narrowing (§9)", () => {
  test("the footer stamps who printed it and when", () => {
    const md = buildProfileSheetMarkdown(input());
    expect(md).toContain("প্রিন্ট করেছেন: Md Enayetur Rahman · 2026-07-25 09:30 (UTC)");
  });

  test("a NARROWED sheet says so on the page and names the subjects", () => {
    const md = buildProfileSheetMarkdown(
      input({ fullView: false, subjectFilter: ["ENG", "MATH"] }),
    );
    expect(md).toContain("শুধু আপনার বিষয়ের তথ্য আছে (ইংরেজি, গণিত)");
  });

  test("a full-view sheet carries NO narrowing note", () => {
    expect(buildProfileSheetMarkdown(input())).not.toContain("শুধু আপনার বিষয়ের তথ্য");
  });
});

describe("buildProfileSheetMarkdown — empty windows degrade honestly", () => {
  test("no tracker data says so instead of printing a table of zeros", () => {
    const md = buildProfileSheetMarkdown(
      input({
        homework: panel({ totals: counters({ sheets: 0 }), bySubject: [] }),
        assignment: panel({ totals: counters({ sheets: 0 }), bySubject: [] }),
      }),
    );
    // Once per tracker section, and NO tracker table at all. (The class-test table
    // still renders here — it has its own data — so assert on the tracker header,
    // not on a subject label that both tables share.)
    expect(md.match(/এই সময়সীমায় কোনো তথ্য নেই।/g)).toHaveLength(2);
    expect(md).not.toContain("| বিষয় | মোট |");
  });

  test("no class-test results says so", () => {
    const base = input();
    const md = buildProfileSheetMarkdown({
      ...base,
      classTest: { ...base.classTest, results: [], bySubject: [] },
    });
    expect(md).toContain("এই সময়সীমায় কোনো ফলাফল নেই।");
  });

  test("a child with no guardian link still renders (no crash, no empty label)", () => {
    const base = input();
    const md = buildProfileSheetMarkdown({
      ...base,
      header: { ...base.header, guardians: [], classTeacherName: null },
    });
    expect(md).toContain("# মুসা বিন সাদিক");
    expect(md).not.toContain("অভিভাবক:");
  });
});
