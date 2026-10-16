/**
 * MeetingBriefService (MC-1/MC-2, docs/prd-meeting-comments.md §3–§4, D-#754/#755) —
 * everything the person meeting a guardian reads about one child, in one read:
 *
 *   - the comment chain, top down: the Principal's/Office's final word, the class
 *     teacher's summary, every subject teacher's note (with who wrote it);
 *   - the child's numbers SINCE THE LAST MEETING — attendance, class tests, homework,
 *     assignments, and teacher notes (the CONCERN/POSITIVE daily comments; the app has
 *     no guardian-filed complaint, D-#400) — each with the detail rows behind it.
 *
 * The numbers reuse the student-profile services UNNARROWED (subjects = null): the
 * brief's gate is roster:manage or the child's class teacher, both of whom already see
 * every subject on the profile (§4 classTeacherOversight). The subject teacher's write
 * screen asks for ONE subject's slice through `childNumbers(..., [subject])`.
 *
 * `buildBriefMarkdown` is PURE (the StudentProfileSheetService pattern) and feeds the
 * existing pdfkit + NotoSansBengali renderer. Identity plane; no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { ROUTINE_SUBJECT_LABELS_BN } from "@scd/shared";
import { ParentMeeting, type IParentMeeting } from "../models/ParentMeeting";
import { ParentMeetingSlot } from "../models/ParentMeetingSlot";
import { MeetingComment } from "../models/MeetingComment";
import { MeetingSubjectNote } from "../models/MeetingSubjectNote";
import { MeetingFinalComment, type MeetingFinalSource } from "../models/MeetingFinalComment";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { studentHomeworkPanel, studentAssignmentPanel, type StudentTrackerPanel } from "../../trackers/services/StudentProfileService";
import { studentProfileAttendance, studentProfileComments } from "../../trackers/services/StudentProfileContextService";
import { studentProfile as classTestProfile } from "../../trackers/services/ClassTestSummaryService";
import { OWED_BY_STUDENT_STATES, inStates } from "../../trackers/lifecycleBuckets";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { bnNum as bn } from "../../../lib/bnNum";

export class MeetingBriefError extends Error {}

const str = (id: unknown): string => (id == null ? "" : String(id));

/** `YYYY-MM-DD` + n days (pure, calendar arithmetic in UTC so no DST/offset drift). */
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** A meeting's own day key. Stored as `new Date("YYYY-MM-DD")` (UTC midnight), which is
 *  the same calendar day in Dhaka. */
export const meetingDayKey = (m: Pick<IParentMeeting, "meetingDate">): string => dhakaDayKey(new Date(m.meetingDate));

/** The section label beside the class name: মূল / সম্মিলিত add nothing (the app's
 *  isWholeClassSectionName rule). */
export function sectionSuffix(nameBn: string | null | undefined): string {
  return !nameBn || nameBn === "মূল" || nameBn === "সম্মিলিত" ? "" : nameBn;
}

// ===========================================================================
// Window — since the last meeting
// ===========================================================================

export interface BriefWindow {
  fromKey: string;
  toKey: string;
  previousMeetingId: string | null;
  previousLabel: string | null;
}

/** PURE: the day after the previous meeting (or the year start) → the meeting day or
 *  today, whichever is earlier. A window that would invert collapses to one day. */
export function windowOf(args: { meetingKey: string; todayKey: string; previousKey: string | null; yearStartKey: string }): { fromKey: string; toKey: string } {
  const toKey = args.meetingKey < args.todayKey ? args.meetingKey : args.todayKey;
  const fromKey = args.previousKey ? addDaysKey(args.previousKey, 1) : args.yearStartKey;
  return fromKey > toKey ? { fromKey: toKey, toKey } : { fromKey, toKey };
}

/** The meeting dated most recently BEFORE this one, school-wide (the CM-5 comparison rule). */
export async function previousMeetingOf(meeting: IParentMeeting): Promise<IParentMeeting | null> {
  return (await ParentMeeting.findOne({ _id: { $ne: meeting._id }, meetingDate: { $lt: meeting.meetingDate } })
    .sort({ meetingDate: -1 })
    .lean()) as IParentMeeting | null;
}

export async function meetingWindow(meeting: IParentMeeting, now = new Date()): Promise<BriefWindow> {
  const prev = await previousMeetingOf(meeting);
  const year = (await AcademicYear.findById(meeting.academicYearId).select("startDate").lean()) as { startDate: Date } | null;
  const meetingKey = meetingDayKey(meeting);
  const w = windowOf({
    meetingKey,
    todayKey: dhakaDayKey(now),
    previousKey: prev ? meetingDayKey(prev) : null,
    yearStartKey: year ? dhakaDayKey(new Date(year.startDate)) : `${meetingKey.slice(0, 4)}-01-01`,
  });
  return { ...w, previousMeetingId: prev ? str(prev._id) : null, previousLabel: prev?.instanceLabel ?? null };
}

// ===========================================================================
// Numbers
// ===========================================================================

export interface BriefAttendanceDay {
  dateKey: string;
  /** LEAVE = absent with a leave application covering it; ABSENT = without. */
  kind: "LEAVE" | "ABSENT";
  reason: string | null;
}
export interface BriefAttendance {
  markedDays: number;
  presentDays: number;
  leaveDays: number;
  absentDays: number;
  days: BriefAttendanceDay[];
}

export interface BriefTestSubject {
  subject: string;
  held: number;
  sat: number;
  missed: number;
  avgPercent: number | null;
}
export interface BriefTest {
  dateKey: string;
  subject: string;
  testNumber: number;
  present: boolean;
  percent: number | null;
}
export interface BriefClassTests {
  held: number;
  sat: number;
  missed: number;
  avgPercent: number | null;
  bySubject: BriefTestSubject[];
  tests: BriefTest[];
}

export interface BriefTrackerSubject {
  subject: string;
  received: number;
  submitted: number;
  notSubmitted: number;
}
export interface BriefMissedItem {
  dateKey: string;
  subject: string;
  description: string | null;
}
export interface BriefTracker {
  received: number;
  submitted: number;
  notSubmitted: number;
  bySubject: BriefTrackerSubject[];
  missed: BriefMissedItem[];
}

export interface BriefNote {
  dateKey: string;
  authorName: string | null;
  type: string;
  sentiment: string;
  text: string;
}
export interface BriefNotes {
  concern: number;
  positive: number;
  items: BriefNote[];
}

export interface BriefNumbers {
  fromKey: string;
  toKey: string;
  attendance: BriefAttendance;
  classTests: BriefClassTests;
  homework: BriefTracker;
  assignment: BriefTracker;
  notes: BriefNotes;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const mean = (xs: number[]): number | null => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** PURE: a profile tracker panel → the brief's received/submitted/not-submitted view. */
export function trackerBrief(panel: Pick<StudentTrackerPanel, "totals" | "bySubject" | "items">): BriefTracker {
  return {
    received: panel.totals.received,
    submitted: panel.totals.submitted,
    notSubmitted: panel.totals.notSubmitted,
    bySubject: panel.bySubject
      .map((r) => ({ subject: r.subject, received: r.received, submitted: r.submitted, notSubmitted: r.notSubmitted }))
      .sort((a, b) => b.notSubmitted - a.notSubmitted || a.subject.localeCompare(b.subject)),
    // The same rule as the counters' notSubmitted: still owed by the child AND past due.
    missed: panel.items
      .filter((i) => i.overdue && inStates(i.state, OWED_BY_STUDENT_STATES))
      .map((i) => ({ dateKey: i.dateGiven.slice(0, 10), subject: i.subject, description: i.description }))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
  };
}

/** PURE: class-test results → the window's held/sat/missed/average, overall and per subject. */
export function classTestBrief(
  results: Array<{ examDate: string; subject: string; testNumber: number; status: string; percent: number | null }>,
  fromKey: string,
  toKey: string,
): BriefClassTests {
  const tests: BriefTest[] = results
    .map((r) => ({ dateKey: dhakaDayKey(new Date(r.examDate)), subject: r.subject, testNumber: r.testNumber, present: r.status === "PRESENT", percent: r.status === "PRESENT" ? r.percent : null }))
    .filter((t) => t.dateKey >= fromKey && t.dateKey <= toKey)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const bySubject = new Map<string, BriefTest[]>();
  for (const t of tests) (bySubject.get(t.subject) ?? bySubject.set(t.subject, []).get(t.subject)!).push(t);
  const pcts = (ts: BriefTest[]) => ts.filter((t) => t.present && t.percent != null).map((t) => t.percent as number);
  return {
    held: tests.length,
    sat: tests.filter((t) => t.present).length,
    missed: tests.filter((t) => !t.present).length,
    avgPercent: mean(pcts(tests)),
    bySubject: [...bySubject.entries()]
      .map(([subject, ts]) => ({ subject, held: ts.length, sat: ts.filter((t) => t.present).length, missed: ts.filter((t) => !t.present).length, avgPercent: mean(pcts(ts)) }))
      .sort((a, b) => a.subject.localeCompare(b.subject)),
    tests,
  };
}

/** PURE: the profile's attendance days + leave list → present / leave / absent + the dates. */
export function attendanceBrief(
  a: { markedDays: number; absentDays: number; absentUncoveredDays: number; days: Array<{ dateKey: string; absent: boolean; leaveCovered: boolean }>; leaves: Array<{ fromKey: string; toKey: string; reason: string }> },
): BriefAttendance {
  const reasonOn = (key: string): string | null => a.leaves.find((l) => l.fromKey <= key && key <= l.toKey)?.reason ?? null;
  return {
    markedDays: a.markedDays,
    presentDays: a.markedDays - a.absentDays,
    leaveDays: a.absentDays - a.absentUncoveredDays,
    absentDays: a.absentUncoveredDays,
    days: a.days
      .filter((d) => d.absent)
      .map((d) => ({ dateKey: d.dateKey, kind: d.leaveCovered ? ("LEAVE" as const) : ("ABSENT" as const), reason: d.leaveCovered ? reasonOn(d.dateKey) : null }))
      .sort((x, y) => x.dateKey.localeCompare(y.dateKey)),
  };
}

/**
 * One child's numbers over [fromKey, toKey]. `subjects` narrows homework/assignment/class
 * tests to those subject codes (the subject teacher's write screen); null = every subject.
 * Attendance and teacher notes are subject-free.
 */
export async function childNumbers(
  studentId: string,
  fromKey: string,
  toKey: string,
  subjects: string[] | null,
  now = new Date(),
): Promise<BriefNumbers> {
  const [attendance, homework, assignment, classTest, comments] = await Promise.all([
    studentProfileAttendance(studentId, fromKey, toKey),
    studentHomeworkPanel(studentId, { fromKey, toKey, subjects, now }),
    studentAssignmentPanel(studentId, { fromKey, toKey, subjects, now }),
    classTestProfile(studentId, subjects),
    studentProfileComments(studentId, fromKey, toKey),
  ]);
  return {
    fromKey,
    toKey,
    attendance: attendanceBrief(attendance),
    classTests: classTestBrief(classTest.results, fromKey, toKey),
    homework: trackerBrief(homework),
    assignment: trackerBrief(assignment),
    notes: {
      concern: comments.tally.concern,
      positive: comments.tally.positive,
      items: comments.comments.map((c) => ({
        dateKey: dhakaDayKey(new Date(c.createdAt)),
        authorName: c.authorName,
        type: c.type,
        sentiment: c.sentiment,
        text: c.text,
      })),
    },
  };
}

// ===========================================================================
// The brief
// ===========================================================================

export interface BriefFinal {
  source: MeetingFinalSource;
  strengths: string;
  concerns: string;
  authorName: string | null;
  updatedAt: string;
}
export interface BriefSummary {
  strengths: string;
  concerns: string;
  authorName: string | null;
  updatedAt: string;
}
export interface BriefSubjectNote {
  subject: string;
  teacherName: string | null;
  strengths: string;
  concerns: string;
  written: boolean;
  skipped: boolean;
  skipReason: string | null;
}

export interface MeetingBrief {
  meetingId: string;
  instanceLabel: string;
  meetingDateKey: string;
  studentId: string;
  studentName: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  classTeacherName: string | null;
  slotTime: number | null;
  onCall: boolean;
  previousLabel: string | null;
  final: BriefFinal | null;
  summary: BriefSummary | null;
  subjectNotes: BriefSubjectNote[];
  numbers: BriefNumbers;
}

async function namesOf(ids: Array<Types.ObjectId | string | null | undefined>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean).map(str))];
  if (!uniq.length) return new Map();
  const users = (await User.find({ _id: { $in: uniq } }).select("name").lean()) as unknown as Array<{ _id: Types.ObjectId; name: string }>;
  return new Map(users.map((u) => [str(u._id), u.name]));
}

export async function meetingBrief(meetingId: string, studentId: string, now = new Date()): Promise<MeetingBrief> {
  if (!Types.ObjectId.isValid(meetingId) || !Types.ObjectId.isValid(studentId)) throw new MeetingBriefError("ভুল আইডি");
  const meeting = (await ParentMeeting.findById(meetingId).lean()) as IParentMeeting | null;
  if (!meeting) throw new MeetingBriefError("সভা পাওয়া যায়নি");
  const student = (await Student.findById(studentId).select("name nameBn sectionId classId").lean()) as {
    name: string;
    nameBn?: string;
    sectionId: Types.ObjectId;
    classId: Types.ObjectId;
  } | null;
  if (!student) throw new MeetingBriefError("শিক্ষার্থী পাওয়া যায়নি");

  const [section, cls, window, slot, final, summary, notes] = await Promise.all([
    Section.findById(student.sectionId).select("nameBn classTeacherId").lean() as Promise<{ nameBn: string; classTeacherId?: Types.ObjectId } | null>,
    Class.findById(student.classId).select("level nameBn").lean() as Promise<{ level: number; nameBn: string } | null>,
    meetingWindow(meeting, now),
    ParentMeetingSlot.findOne({ meetingId: meeting._id, studentIds: new Types.ObjectId(studentId) }).select("slotTime onCall").lean() as Promise<{ slotTime?: number | null; onCall?: boolean } | null>,
    MeetingFinalComment.findOne({ meetingId: meeting._id, studentId }).lean(),
    MeetingComment.findOne({ meetingId: meeting._id, studentId }).lean(),
    MeetingSubjectNote.find({ meetingId: meeting._id, studentId }).lean(),
  ]);
  const names = await namesOf([
    section?.classTeacherId,
    final?.authorUserId,
    summary?.authorUserId,
    ...notes.map((n) => n.writtenBy ?? n.teacherId),
  ]);
  const numbers = await childNumbers(studentId, window.fromKey, window.toKey, null, now);

  return {
    meetingId,
    instanceLabel: meeting.instanceLabel,
    meetingDateKey: meetingDayKey(meeting),
    studentId,
    studentName: student.nameBn || student.name,
    classLevel: cls?.level ?? null,
    classNameBn: cls?.nameBn ?? "",
    sectionNameBn: section?.nameBn ?? "",
    classTeacherName: section?.classTeacherId ? names.get(str(section.classTeacherId)) ?? null : null,
    slotTime: slot?.slotTime ?? null,
    onCall: !!slot?.onCall,
    previousLabel: window.previousLabel,
    final: final
      ? { source: final.source, strengths: final.strengths, concerns: final.concerns, authorName: names.get(str(final.authorUserId)) ?? null, updatedAt: new Date(final.updatedAt).toISOString() }
      : null,
    summary: summary
      ? { strengths: summary.positiveText ?? "", concerns: summary.concernText ?? "", authorName: names.get(str(summary.authorUserId)) ?? null, updatedAt: new Date(summary.updatedAt).toISOString() }
      : null,
    subjectNotes: notes
      .map((n) => ({
        subject: n.subject,
        teacherName: names.get(str(n.writtenBy ?? n.teacherId)) ?? null,
        strengths: n.strengths ?? "",
        concerns: n.concerns ?? "",
        written: !!n.writtenAt,
        skipped: !!n.skippedAt && !n.writtenAt,
        skipReason: n.skipReason ?? null,
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject)),
    numbers,
  };
}

// ===========================================================================
// Print (pure) — D-#755
// ===========================================================================

export interface BriefPrintOptions {
  subjects: boolean;
  details: boolean;
  printedByName: string;
  printedAt: Date;
}

const SUBJECT_BN = ROUTINE_SUBJECT_LABELS_BN as unknown as Record<string, string>;
/** Routine subject code → Bangla (covers QURAN, which the homework labels do not). */
export const subjectBn = (code: string): string => SUBJECT_BN[code] ?? code;
/** Markdown table cells cannot hold a pipe or a line break. */
const cell = (s: string | null | undefined): string => (s ?? "").replace(/\|/g, "/").replace(/\s*\n\s*/g, " ").trim() || "—";
const pct = (n: number | null): string => (n == null ? "—" : `${bn(Math.round(n))}%`);
const fmtKey = (key: string): string => {
  const [y, m, d] = key.split("-");
  return `${bn(Number(d))}/${bn(Number(m))}/${bn(Number(y))}`;
};
const clock = (min: number): string => `${bn(Math.floor(min / 60))}:${String(min % 60).padStart(2, "0").replace(/\d/g, (x) => "০১২৩৪৫৬৭৮৯"[Number(x)])}`;
const FINAL_SOURCE_BN: Record<MeetingFinalSource, string> = {
  AS_IS: "শ্রেণি শিক্ষকের সারাংশ, যেমন ছিল",
  EDITED: "শ্রেণি শিক্ষকের সারাংশ থেকে সম্পাদিত",
  OWN: "আলাদা মন্তব্য",
};

function oneChild(b: MeetingBrief, opts: BriefPrintOptions): string[] {
  const n = b.numbers;
  const sec = sectionSuffix(b.sectionNameBn);
  const out: string[] = [
    `# ${b.studentName}`,
    `**${b.classNameBn}${sec ? ` · ${sec}` : ""}** · শ্রেণি শিক্ষক: ${b.classTeacherName ?? "—"} · অভিভাবক সভা: ${b.instanceLabel}, ${fmtKey(b.meetingDateKey)}${b.slotTime != null ? ` · সময় ${clock(b.slotTime)}` : b.onCall ? " · অন-কল" : ""}`,
    "",
    `সংখ্যাগুলো ${fmtKey(n.fromKey)} থেকে ${fmtKey(n.toKey)} পর্যন্ত${b.previousLabel ? ` (আগের সভা: ${b.previousLabel})` : ""}।`,
    "",
    "| উপস্থিতি | ক্লাস টেস্ট | বাড়ির কাজ | অ্যাসাইনমেন্ট | শিক্ষকের মন্তব্য |",
    "|---|---|---|---|---|",
    `| ${bn(n.attendance.presentDays)}/${bn(n.attendance.markedDays)} দিন উপস্থিত; ছুটি ${bn(n.attendance.leaveDays)}, অনুপস্থিত ${bn(n.attendance.absentDays)} | ${bn(n.classTests.sat)}/${bn(n.classTests.held)} দিয়েছে; গড় ${pct(n.classTests.avgPercent)} | ${bn(n.homework.submitted)}/${bn(n.homework.received)} জমা; জমা দেয়নি ${bn(n.homework.notSubmitted)} | ${bn(n.assignment.submitted)}/${bn(n.assignment.received)} জমা; জমা দেয়নি ${bn(n.assignment.notSubmitted)} | চিন্তার ${bn(n.notes.concern)}, ভালো ${bn(n.notes.positive)} |`,
    "",
    "## প্রধান শিক্ষক / অফিসের মন্তব্য",
  ];
  if (b.final) {
    out.push(`**ভালো দিক:** ${b.final.strengths || "—"}`, "", `**চিন্তার বিষয়:** ${b.final.concerns || "—"}`, "", `_${FINAL_SOURCE_BN[b.final.source]} · ${b.final.authorName ?? "—"}_`, "");
  } else out.push("এখনো লেখা হয়নি।", "");
  out.push(`## শ্রেণি শিক্ষকের সারাংশ${b.summary?.authorName ? ` · ${b.summary.authorName}` : ""}`);
  if (b.summary) out.push(`**ভালো দিক:** ${b.summary.strengths || "—"}`, "", `**চিন্তার বিষয়:** ${b.summary.concerns || "—"}`, "");
  else out.push("এখনো লেখা হয়নি।", "");

  if (opts.subjects) {
    out.push("## বিষয় শিক্ষকদের মন্তব্য");
    const rows = b.subjectNotes.filter((s) => s.written);
    if (!rows.length) out.push("কোনো মন্তব্য নেই।", "");
    else {
      out.push("| বিষয় | ভালো দিক | চিন্তার বিষয় |", "|---|---|---|");
      for (const s of rows) out.push(`| ${subjectBn(s.subject)} (${cell(s.teacherName)}) | ${cell(s.strengths)} | ${cell(s.concerns)} |`);
      out.push("");
    }
  }

  if (opts.details) {
    out.push("## বিস্তারিত");
    out.push("### উপস্থিতি");
    if (!n.attendance.days.length) out.push("কোনো অনুপস্থিতি নেই।", "");
    else {
      out.push("| তারিখ | ধরন | কারণ |", "|---|---|---|");
      for (const d of n.attendance.days) out.push(`| ${fmtKey(d.dateKey)} | ${d.kind === "LEAVE" ? "ছুটি" : "অনুপস্থিত"} | ${cell(d.reason)} |`);
      out.push("");
    }
    out.push("### ক্লাস টেস্ট (বিষয় অনুযায়ী)");
    if (!n.classTests.bySubject.length) out.push("এই সময়ে কোনো ক্লাস টেস্ট নেই।", "");
    else {
      out.push("| বিষয় | মোট | দিয়েছে | দেয়নি | গড় |", "|---|---|---|---|---|");
      for (const s of n.classTests.bySubject) out.push(`| ${subjectBn(s.subject)} | ${bn(s.held)} | ${bn(s.sat)} | ${bn(s.missed)} | ${pct(s.avgPercent)} |`);
      out.push("");
    }
    for (const [title, t] of [["বাড়ির কাজ — জমা দেয়নি", n.homework], ["অ্যাসাইনমেন্ট — জমা দেয়নি", n.assignment]] as const) {
      out.push(`### ${title}`);
      if (!t.missed.length) out.push("সব জমা দিয়েছে।", "");
      else {
        out.push("| তারিখ | বিষয় | কাজ |", "|---|---|---|");
        for (const m of t.missed) out.push(`| ${fmtKey(m.dateKey)} | ${subjectBn(m.subject)} | ${cell(m.description)} |`);
        out.push("");
      }
    }
    out.push("### শিক্ষকের মন্তব্য");
    if (!n.notes.items.length) out.push("এই সময়ে কোনো মন্তব্য নেই।", "");
    else {
      out.push("| তারিখ | শিক্ষক | ধরন | মন্তব্য |", "|---|---|---|---|");
      for (const c of n.notes.items) out.push(`| ${fmtKey(c.dateKey)} | ${cell(c.authorName)} | ${c.sentiment === "CONCERN" ? "চিন্তার" : "ভালো"} | ${cell(c.text)} |`);
      out.push("");
    }
  }
  return out;
}

/** PURE: one or more children's briefs → the printable markdown. */
export function buildBriefMarkdown(briefs: MeetingBrief[], opts: BriefPrintOptions): string {
  const parts: string[] = [];
  briefs.forEach((b, i) => {
    if (i > 0) parts.push("", "---", "");
    parts.push(...oneChild(b, opts));
  });
  const at = opts.printedAt;
  parts.push(
    "",
    "---",
    "",
    "অভিভাবকের স্বাক্ষর: ____________________     শিক্ষক / প্রধান শিক্ষক: ____________________",
    "",
    `_ছাপিয়েছেন ${opts.printedByName} · ${fmtKey(dhakaDayKey(at))}_`,
  );
  return parts.join("\n");
}
