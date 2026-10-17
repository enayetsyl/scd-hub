/**
 * Parents'-meeting comment chain — the pure core (MC-1/MC-2, docs/prd-meeting-comments.md,
 * D-#752..#756). DB-free (the repo convention): the roster maths, the readiness gate, the
 * two-box rule, the "since the last meeting" window, the numbers' reductions, the printed
 * brief and the reminder window. The DB paths are driven end to end against an in-memory
 * Mongo in the PR's verification (see the PR body), not here.
 */
import {
  pickSubjectTeachers,
  expectedRosterOf,
  planRoster,
  readinessOf,
  cleanBoxes,
  reminderWindowOpen,
  MeetingChainError,
  MEETING_NOTE_MAX,
} from "../modules/comments/services/MeetingChainService";
import {
  addDaysKey,
  windowOf,
  classTestBrief,
  attendanceBrief,
  trackerBrief,
  buildBriefMarkdown,
  sectionSuffix,
  type MeetingBrief,
} from "../modules/comments/services/MeetingBriefService";

describe("pickSubjectTeachers", () => {
  it("picks the teacher with the most periods of each subject", () => {
    const m = pickSubjectTeachers([
      { subject: "MATH", teacherId: "b" },
      { subject: "MATH", teacherId: "a" },
      { subject: "MATH", teacherId: "b" },
      { subject: "ENG", teacherId: "c" },
    ]);
    expect(m.get("MATH")).toBe("b");
    expect(m.get("ENG")).toBe("c");
  });

  it("breaks a tie on the smaller id, so a rebuild is stable", () => {
    const m = pickSubjectTeachers([
      { subject: "QURAN", teacherId: "z" },
      { subject: "QURAN", teacherId: "k" },
    ]);
    expect(m.get("QURAN")).toBe("k");
  });
});

describe("expectedRosterOf", () => {
  const sectionTeachers = new Map([["S1", new Map([["BAN", "T1"], ["MATH", "T2"], ["QURAN", "T9"]])]]);
  const groupTeachers = new Map([["G1", new Map([["QURAN", "T3"]])]]);

  it("gives every child their section's subjects", () => {
    const rows = expectedRosterOf([{ id: "A", sectionId: "S1", classId: "C1" }], sectionTeachers, new Map(), groupTeachers);
    expect(rows.map((r) => `${r.subject}:${r.teacherId}`)).toEqual(["BAN:T1", "MATH:T2", "QURAN:T9"]);
  });

  it("lets the child's Quran group override the section (the C1–5 Quran periods live on the group)", () => {
    const rows = expectedRosterOf([{ id: "A", sectionId: "S1", classId: "C1" }], sectionTeachers, new Map([["A", ["G1"]]]), groupTeachers);
    expect(rows.find((r) => r.subject === "QURAN")?.teacherId).toBe("T3");
    expect(rows).toHaveLength(3);
  });

  it("gives a child in a section with no routine no rows", () => {
    expect(expectedRosterOf([{ id: "B", sectionId: "S2", classId: "C2" }], sectionTeachers, new Map(), groupTeachers)).toEqual([]);
  });
});

describe("planRoster", () => {
  const exp = (studentId: string, subject: string, teacherId: string, sectionId = "S1") => ({ studentId, sectionId, classId: "C1", subject, teacherId });
  const have = (id: string, studentId: string, subject: string, teacherId: string, written: boolean, sectionId = "S1") => ({ id, studentId, subject, teacherId, sectionId, written });

  it("adds new pairs and leaves matching ones alone", () => {
    const p = planRoster([have("r1", "A", "BAN", "T1", false)], [exp("A", "BAN", "T1"), exp("A", "MATH", "T2")]);
    expect(p.insert.map((r) => r.subject)).toEqual(["MATH"]);
    expect(p.retarget).toEqual([]);
    expect(p.remove).toEqual([]);
  });

  it("moves an UNWRITTEN row to the routine's new teacher, and follows a section change", () => {
    const p = planRoster([have("r1", "A", "BAN", "T1", false), have("r2", "A", "MATH", "T2", false)], [exp("A", "BAN", "T7"), exp("A", "MATH", "T2", "S9")]);
    expect(p.retarget).toEqual([
      { id: "r1", teacherId: "T7", sectionId: "S1", classId: "C1" },
      { id: "r2", teacherId: "T2", sectionId: "S9", classId: "C1" },
    ]);
  });

  it("never touches a WRITTEN row — not retargeted, not removed", () => {
    const p = planRoster([have("r1", "A", "BAN", "T1", true), have("r2", "A", "ENG", "T4", true)], [exp("A", "BAN", "T7")]);
    expect(p.retarget).toEqual([]);
    expect(p.remove).toEqual([]);
  });

  it("removes an unwritten row the routine no longer expects", () => {
    const p = planRoster([have("r1", "A", "ENG", "T4", false)], []);
    expect(p.remove).toEqual(["r1"]);
  });
});

describe("readinessOf — the class teacher waits for every subject note", () => {
  const at = new Date();
  it("is ready when every row is written or skipped", () => {
    const r = readinessOf([
      { subject: "BAN", teacherId: "T1", writtenAt: at },
      { subject: "SCI", teacherId: "T5", skippedAt: at },
    ]);
    expect(r).toMatchObject({ total: 2, written: 1, skipped: 1, ready: true, missing: [] });
  });

  it("lists what is missing, with the teacher", () => {
    const r = readinessOf([
      { subject: "MATH", teacherId: "T2" },
      { subject: "BAN", teacherId: "T1", writtenAt: at },
    ]);
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual([{ subject: "MATH", teacherId: "T2" }]);
  });

  it("counts a written-then-skipped row as written, not skipped", () => {
    const r = readinessOf([{ subject: "BAN", teacherId: "T1", writtenAt: at, skippedAt: at }]);
    expect(r).toMatchObject({ written: 1, skipped: 0, ready: true });
  });

  it("is ready for a child with no rows at all (no routine to ask)", () => {
    expect(readinessOf([]).ready).toBe(true);
  });
});

describe("cleanBoxes — the two boxes every layer has", () => {
  it("trims both", () => {
    expect(cleanBoxes("  ভালো  ", " চিন্তা ")).toEqual({ strengths: "ভালো", concerns: "চিন্তা" });
  });
  it("accepts one box empty", () => {
    expect(cleanBoxes("ভালো", "")).toEqual({ strengths: "ভালো", concerns: "" });
    expect(cleanBoxes(null, "চিন্তা")).toEqual({ strengths: "", concerns: "চিন্তা" });
  });
  it("refuses both empty", () => {
    expect(() => cleanBoxes("  ", null)).toThrow(MeetingChainError);
  });
  it("refuses an essay", () => {
    expect(() => cleanBoxes("x".repeat(MEETING_NOTE_MAX + 1), "")).toThrow(MeetingChainError);
  });
});

describe("windowOf — numbers since the last meeting", () => {
  it("runs from the day after the previous meeting to the meeting day", () => {
    expect(windowOf({ meetingKey: "2026-11-01", todayKey: "2026-11-05", previousKey: "2026-07-11", yearStartKey: "2026-01-01" })).toEqual({
      fromKey: "2026-07-12",
      toKey: "2026-11-01",
    });
  });
  it("stops at today while the meeting is still ahead", () => {
    expect(windowOf({ meetingKey: "2026-11-01", todayKey: "2026-10-16", previousKey: "2026-07-11", yearStartKey: "2026-01-01" }).toKey).toBe("2026-10-16");
  });
  it("starts at the year start for the first meeting", () => {
    expect(windowOf({ meetingKey: "2026-07-11", todayKey: "2026-07-01", previousKey: null, yearStartKey: "2026-01-04" }).fromKey).toBe("2026-01-04");
  });
  it("never inverts", () => {
    const w = windowOf({ meetingKey: "2026-07-12", todayKey: "2026-07-12", previousKey: "2026-07-12", yearStartKey: "2026-01-01" });
    expect(w.fromKey <= w.toKey).toBe(true);
  });
  it("addDaysKey crosses month and year ends", () => {
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("classTestBrief", () => {
  const r = (examDate: string, subject: string, status: string, percent: number | null, testNumber = 1) => ({ examDate, subject, testNumber, status, percent });
  it("keeps the window's tests and averages only the sat ones", () => {
    const b = classTestBrief(
      [
        r("2026-07-01T04:00:00.000Z", "MATH", "PRESENT", 90), // before the window
        r("2026-08-10T04:00:00.000Z", "MATH", "PRESENT", 70),
        r("2026-09-10T04:00:00.000Z", "MATH", "ABSENT", null, 2),
        r("2026-09-12T04:00:00.000Z", "ENG", "PRESENT", 50),
      ],
      "2026-07-12",
      "2026-11-01",
    );
    expect(b).toMatchObject({ held: 3, sat: 2, missed: 1, avgPercent: 60 });
    expect(b.bySubject.find((s) => s.subject === "MATH")).toMatchObject({ held: 2, sat: 1, missed: 1, avgPercent: 70 });
  });
});

describe("attendanceBrief", () => {
  it("splits absences into leave and absent, with the leave's reason", () => {
    const a = attendanceBrief({
      markedDays: 10,
      absentDays: 3,
      absentUncoveredDays: 1,
      days: [
        { dateKey: "2026-08-03", absent: true, leaveCovered: true },
        { dateKey: "2026-08-04", absent: true, leaveCovered: true },
        { dateKey: "2026-08-19", absent: true, leaveCovered: false },
        { dateKey: "2026-08-20", absent: false, leaveCovered: false },
      ],
      leaves: [{ fromKey: "2026-08-03", toKey: "2026-08-04", reason: "জ্বর" }],
    });
    expect(a).toMatchObject({ markedDays: 10, presentDays: 7, leaveDays: 2, absentDays: 1 });
    expect(a.days).toEqual([
      { dateKey: "2026-08-03", kind: "LEAVE", reason: "জ্বর" },
      { dateKey: "2026-08-04", kind: "LEAVE", reason: "জ্বর" },
      { dateKey: "2026-08-19", kind: "ABSENT", reason: null },
    ]);
  });
});

describe("trackerBrief", () => {
  it("lists only items still owed AND past due as not submitted", () => {
    const counters = { received: 3, submitted: 1, notSubmitted: 1 };
    const t = trackerBrief({
      totals: counters as never,
      bySubject: [{ subject: "ENG", ...counters } as never],
      items: [
        { dateGiven: "2026-09-01T00:00:00.000Z", subject: "ENG", description: "Letter", state: "CHASE", overdue: true },
        { dateGiven: "2026-09-02T00:00:00.000Z", subject: "ENG", description: "Due later", state: "GIVEN", overdue: false },
        { dateGiven: "2026-09-03T00:00:00.000Z", subject: "ENG", description: "Done", state: "CHECKED", overdue: true },
      ] as never,
    });
    expect(t.missed).toEqual([{ dateKey: "2026-09-01", subject: "ENG", description: "Letter" }]);
    expect(t).toMatchObject({ received: 3, submitted: 1, notSubmitted: 1 });
  });
});

describe("buildBriefMarkdown — the printed brief", () => {
  const brief = (over: Partial<MeetingBrief> = {}): MeetingBrief => ({
    meetingId: "m",
    instanceLabel: "2026 — 2nd",
    meetingDateKey: "2026-11-01",
    studentId: "s",
    studentName: "শিক্ষার্থী ক",
    classLevel: 3,
    classNameBn: "তৃতীয় শ্রেণি",
    sectionNameBn: "মূল",
    classTeacherName: "শিক্ষক প",
    slotTime: 640,
    onCall: false,
    previousLabel: "2026 — 1st",
    final: { source: "EDITED", strengths: "ভালো পড়ে", concerns: "বাড়ির কাজ | বাকি", authorName: "প্রধান শিক্ষক", updatedAt: "" },
    summary: { strengths: "ভালো পড়ে", concerns: "বাড়ির কাজ বাকি", authorName: "শিক্ষক প", updatedAt: "" },
    subjectNotes: [
      { subject: "MATH", teacherName: "শিক্ষক দ", strengths: "নামতা পারে", concerns: "অসাবধান\nভুল", written: true, skipped: false, skipReason: null },
      { subject: "SCI", teacherName: "শিক্ষক ই", strengths: "", concerns: "", written: false, skipped: true, skipReason: "ছুটিতে" },
    ],
    numbers: {
      fromKey: "2026-07-12",
      toKey: "2026-10-31",
      attendance: { markedDays: 85, presentDays: 78, leaveDays: 3, absentDays: 4, days: [{ dateKey: "2026-08-19", kind: "ABSENT", reason: null }] },
      classTests: { held: 24, sat: 22, missed: 2, avgPercent: 71, bySubject: [{ subject: "MATH", held: 4, sat: 4, missed: 0, avgPercent: 74 }], tests: [] },
      homework: { received: 110, submitted: 96, notSubmitted: 14, bySubject: [], missed: [{ dateKey: "2026-09-14", subject: "ENG", description: "Letter" }] },
      assignment: { received: 20, submitted: 18, notSubmitted: 2, bySubject: [], missed: [] },
      notes: { concern: 2, positive: 3, items: [] },
    },
    ...over,
  });
  const opts = { subjects: true, details: false, printedByName: "অফিস", printedAt: new Date("2026-11-01T04:00:00Z") };

  it("prints the child, the numbers, both comment layers and who printed it", () => {
    const md = buildBriefMarkdown([brief()], opts);
    expect(md).toContain("# শিক্ষার্থী ক");
    expect(md).toContain("তৃতীয় শ্রেণি**"); // মূল adds nothing beside the class name
    expect(md).toContain("৭৮/৮৫ দিন উপস্থিত");
    expect(md).toContain("## প্রধান শিক্ষক / অফিসের মন্তব্য");
    expect(md).toContain("## শ্রেণি শিক্ষকের সারাংশ");
    expect(md).toContain("ছাপিয়েছেন অফিস");
  });

  it("keeps table cells one line with no stray pipes, and prints only written subject notes", () => {
    const md = buildBriefMarkdown([brief()], opts);
    expect(md).toContain("| গণিত (শিক্ষক দ) | নামতা পারে | অসাবধান ভুল |");
    expect(md).not.toContain("বিজ্ঞান (");
  });

  it("leaves the subject table and the details out unless asked", () => {
    const md = buildBriefMarkdown([brief()], { ...opts, subjects: false });
    expect(md).not.toContain("বিষয় শিক্ষকদের মন্তব্য");
    expect(md).not.toContain("## বিস্তারিত");
    expect(buildBriefMarkdown([brief()], { ...opts, details: true })).toContain("## বিস্তারিত");
  });

  it("says so when a layer is not written yet", () => {
    const md = buildBriefMarkdown([brief({ final: null, summary: null })], opts);
    expect(md.match(/এখনো লেখা হয়নি।/g)).toHaveLength(2);
  });

  it("prints a family slot one child after another", () => {
    const md = buildBriefMarkdown([brief(), brief({ studentName: "শিক্ষার্থী ম" })], opts);
    expect(md).toContain("# শিক্ষার্থী ক");
    expect(md).toContain("# শিক্ষার্থী ম");
  });

  it("sectionSuffix drops the whole-class section names", () => {
    expect(sectionSuffix("মূল")).toBe("");
    expect(sectionSuffix("সম্মিলিত")).toBe("");
    expect(sectionSuffix("বালক")).toBe("বালক");
  });
});

describe("reminderWindowOpen", () => {
  it("opens 3 days before the due date and runs until the meeting", () => {
    expect(reminderWindowOpen("2026-10-24", "2026-10-28", "2026-11-01")).toBe(false);
    expect(reminderWindowOpen("2026-10-25", "2026-10-28", "2026-11-01")).toBe(true);
    expect(reminderWindowOpen("2026-10-30", "2026-10-28", "2026-11-01")).toBe(true);
    expect(reminderWindowOpen("2026-11-02", "2026-10-28", "2026-11-01")).toBe(false);
  });
});
