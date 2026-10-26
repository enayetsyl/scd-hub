/**
 * Parents'-meeting comment chain + brief resolvers (MC-1..MC-4,
 * docs/prd-meeting-comments.md, D-#752..#756).
 *
 * RBAC — existing permissions only:
 *   - Office/Principal (roster:manage, the meeting admin gate D-#123): open collection,
 *     refresh the roster, skip a subject, remind a teacher, the progress board, the final
 *     queue and the final comment.
 *   - Subject teacher (tracker:write): their own Today work list and their own rows —
 *     the service refuses a row whose teacher is somebody else.
 *   - Class teacher (tracker:write): their sections' summary work list. The summary write
 *     stays CM-5's `saveMeetingComment` (assertIsClassTeacher + the MC-1 gate there).
 *   - The brief: roster:manage, or the class teacher of the child's section.
 *
 * Staff-only throughout — nothing here is reachable from a guardian (D-#124).
 */
import { builder } from "../../../schema";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import {
  openCommentCollection,
  refreshCommentRoster,
  setSubjectSkipped,
  saveSubjectNote,
  mySubjectNoteWork,
  subjectNoteContext,
  mySummaryWork,
  commentProgress,
  remindTeacher,
  finalQueue,
  saveFinalComment,
  assertBriefRead,
  type RosterResult,
  type SubjectNoteShape,
  type NoteWorkMeeting,
  type NoteWorkGroup,
  type NoteWorkStudent,
  type SubjectNoteContext,
  type SummaryWorkMeeting,
  type SummaryWorkSection,
  type SummaryWorkStudent,
  type CommentProgress,
  type ProgressSection,
  type ProgressSubject,
  type ProgressTeacher,
  type FinalQueueRow,
} from "../services/MeetingChainService";
import {
  meetingBrief,
  type MeetingBrief,
  type BriefClassBest,
  type BriefNumbers,
  type BriefAttendance,
  type BriefAttendanceDay,
  type BriefClassTests,
  type BriefTestSubject,
  type BriefTest,
  type BriefTracker,
  type BriefTrackerSubject,
  type BriefMissedItem,
  type BriefNotes,
  type BriefNote,
  type BriefFinal,
  type BriefSummary,
  type BriefSubjectNote,
} from "../services/MeetingBriefService";

type Ctx = { auth: { userId?: string } | null };
const actorOf = (ctx: Ctx): string => {
  if (!ctx.auth?.userId) throw new ForbiddenError("Unauthenticated");
  return ctx.auth.userId;
};
/** `parents_meeting:view` lifts the row-teacher / class-teacher designation (any note screen, any brief; PM — was roster:manage). */
const isAdmin = (ctx: { auth: unknown }): boolean =>
  ctx.auth !== null && callerHasPermission(ctx.auth as Parameters<typeof callerHasPermission>[0], "parents_meeting:view");

// ---------------------------------------------------------------------------
// Shapes — roster / work lists
// ---------------------------------------------------------------------------

const RosterResultRef = builder.objectRef<RosterResult>("MeetingRosterResult").implement({
  fields: (t) => ({
    inserted: t.exposeInt("inserted"),
    retargeted: t.exposeInt("retargeted"),
    removed: t.exposeInt("removed"),
  }),
});

const SubjectNoteRef = builder.objectRef<SubjectNoteShape>("MeetingSubjectNote").implement({
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    studentId: t.exposeString("studentId"),
    subject: t.exposeString("subject"),
    strengths: t.exposeString("strengths"),
    concerns: t.exposeString("concerns"),
    written: t.exposeBoolean("written"),
    writtenAt: t.string({ nullable: true, resolve: (r) => r.writtenAt }),
  }),
});

const NoteWorkStudentRef = builder.objectRef<NoteWorkStudent>("MeetingNoteWorkStudent").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    written: t.exposeBoolean("written"),
    skipped: t.exposeBoolean("skipped"),
    locked: t.exposeBoolean("locked"),
  }),
});

const NoteWorkGroupRef = builder.objectRef<NoteWorkGroup>("MeetingNoteWorkGroup").implement({
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    classLevel: t.int({ nullable: true, resolve: (g) => g.classLevel }),
    classNameBn: t.exposeString("classNameBn"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    subject: t.exposeString("subject"),
    total: t.exposeInt("total"),
    written: t.exposeInt("written"),
    due: t.exposeInt("due"),
    students: t.field({ type: [NoteWorkStudentRef], resolve: (g) => g.students }),
  }),
});

const NoteWorkMeetingRef = builder.objectRef<NoteWorkMeeting>("MeetingNoteWork").implement({
  description: "A subject teacher's parents'-meeting comments owed in one open meeting, by class × subject (MC-3).",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    instanceLabel: t.exposeString("instanceLabel"),
    meetingDateKey: t.exposeString("meetingDateKey"),
    subjectDueKey: t.exposeString("subjectDueKey"),
    total: t.exposeInt("total"),
    due: t.exposeInt("due"),
    groups: t.field({ type: [NoteWorkGroupRef], resolve: (m) => m.groups }),
  }),
});

const SummaryMissingRef = builder.objectRef<{ subject: string; teacherName: string | null }>("MeetingSummaryMissing").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    teacherName: t.string({ nullable: true, resolve: (m) => m.teacherName }),
  }),
});

const SummaryWorkStudentRef = builder.objectRef<SummaryWorkStudent>("MeetingSummaryWorkStudent").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    state: t.exposeString("state"),
    total: t.exposeInt("total"),
    written: t.exposeInt("written"),
    skipped: t.exposeInt("skipped"),
    missing: t.field({ type: [SummaryMissingRef], resolve: (s) => s.missing }),
    finalDone: t.exposeBoolean("finalDone"),
  }),
});

const SummaryWorkSectionRef = builder.objectRef<SummaryWorkSection>("MeetingSummaryWorkSection").implement({
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    classLevel: t.int({ nullable: true, resolve: (s) => s.classLevel }),
    classNameBn: t.exposeString("classNameBn"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    ready: t.exposeInt("ready"),
    waiting: t.exposeInt("waiting"),
    done: t.exposeInt("done"),
    students: t.field({ type: [SummaryWorkStudentRef], resolve: (s) => s.students }),
  }),
});

const SummaryWorkMeetingRef = builder.objectRef<SummaryWorkMeeting>("MeetingSummaryWork").implement({
  description: "A class teacher's summaries in one open meeting: ready / waiting (with the missing subject teachers) / done (MC-3).",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    instanceLabel: t.exposeString("instanceLabel"),
    meetingDateKey: t.exposeString("meetingDateKey"),
    summaryDueKey: t.exposeString("summaryDueKey"),
    sections: t.field({ type: [SummaryWorkSectionRef], resolve: (m) => m.sections }),
  }),
});

// ---------------------------------------------------------------------------
// Shapes — the brief and its numbers
// ---------------------------------------------------------------------------

const AttendanceDayRef = builder.objectRef<BriefAttendanceDay>("MeetingBriefAttendanceDay").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    kind: t.exposeString("kind"),
    reason: t.string({ nullable: true, resolve: (d) => d.reason }),
  }),
});
const AttendanceRef = builder.objectRef<BriefAttendance>("MeetingBriefAttendance").implement({
  fields: (t) => ({
    markedDays: t.exposeInt("markedDays"),
    presentDays: t.exposeInt("presentDays"),
    leaveDays: t.exposeInt("leaveDays"),
    absentDays: t.exposeInt("absentDays"),
    days: t.field({ type: [AttendanceDayRef], resolve: (a) => a.days }),
  }),
});
const TestSubjectRef = builder.objectRef<BriefTestSubject>("MeetingBriefTestSubject").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    held: t.exposeInt("held"),
    sat: t.exposeInt("sat"),
    missed: t.exposeInt("missed"),
    avgPercent: t.float({ nullable: true, resolve: (s) => s.avgPercent }),
  }),
});
const TestRef = builder.objectRef<BriefTest>("MeetingBriefTest").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    subject: t.exposeString("subject"),
    testNumber: t.exposeInt("testNumber"),
    present: t.exposeBoolean("present"),
    percent: t.float({ nullable: true, resolve: (s) => s.percent }),
  }),
});
const ClassTestsRef = builder.objectRef<BriefClassTests>("MeetingBriefClassTests").implement({
  fields: (t) => ({
    held: t.exposeInt("held"),
    sat: t.exposeInt("sat"),
    missed: t.exposeInt("missed"),
    avgPercent: t.float({ nullable: true, resolve: (c) => c.avgPercent }),
    bySubject: t.field({ type: [TestSubjectRef], resolve: (c) => c.bySubject }),
    tests: t.field({ type: [TestRef], resolve: (c) => c.tests }),
  }),
});
const TrackerSubjectRef = builder.objectRef<BriefTrackerSubject>("MeetingBriefTrackerSubject").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    received: t.exposeInt("received"),
    submitted: t.exposeInt("submitted"),
    notSubmitted: t.exposeInt("notSubmitted"),
  }),
});
const MissedItemRef = builder.objectRef<BriefMissedItem>("MeetingBriefMissedItem").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    subject: t.exposeString("subject"),
    description: t.string({ nullable: true, resolve: (m) => m.description }),
  }),
});
const TrackerRef = builder.objectRef<BriefTracker>("MeetingBriefTracker").implement({
  fields: (t) => ({
    received: t.exposeInt("received"),
    submitted: t.exposeInt("submitted"),
    notSubmitted: t.exposeInt("notSubmitted"),
    bySubject: t.field({ type: [TrackerSubjectRef], resolve: (r) => r.bySubject }),
    missed: t.field({ type: [MissedItemRef], resolve: (r) => r.missed }),
  }),
});
const NoteRef = builder.objectRef<BriefNote>("MeetingBriefNote").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    authorName: t.string({ nullable: true, resolve: (n) => n.authorName }),
    type: t.exposeString("type"),
    sentiment: t.exposeString("sentiment"),
    text: t.exposeString("text"),
  }),
});
const NotesRef = builder.objectRef<BriefNotes>("MeetingBriefNotes").implement({
  fields: (t) => ({
    concern: t.exposeInt("concern"),
    positive: t.exposeInt("positive"),
    items: t.field({ type: [NoteRef], resolve: (n) => n.items }),
  }),
});
const NumbersRef = builder.objectRef<BriefNumbers>("MeetingBriefNumbers").implement({
  description: "A child's numbers since the last meeting (MC-1, D-#754).",
  fields: (t) => ({
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    attendance: t.field({ type: AttendanceRef, resolve: (n) => n.attendance }),
    classTests: t.field({ type: ClassTestsRef, resolve: (n) => n.classTests }),
    homework: t.field({ type: TrackerRef, resolve: (n) => n.homework }),
    assignment: t.field({ type: TrackerRef, resolve: (n) => n.assignment }),
    notes: t.field({ type: NotesRef, resolve: (n) => n.notes }),
  }),
});

const FinalRef = builder.objectRef<BriefFinal>("MeetingBriefFinal").implement({
  fields: (t) => ({
    source: t.exposeString("source"),
    strengths: t.exposeString("strengths"),
    concerns: t.exposeString("concerns"),
    authorName: t.string({ nullable: true, resolve: (f) => f.authorName }),
    updatedAt: t.exposeString("updatedAt"),
  }),
});
const SummaryRef = builder.objectRef<BriefSummary>("MeetingBriefSummary").implement({
  fields: (t) => ({
    strengths: t.exposeString("strengths"),
    concerns: t.exposeString("concerns"),
    authorName: t.string({ nullable: true, resolve: (s) => s.authorName }),
    updatedAt: t.exposeString("updatedAt"),
  }),
});
const BriefSubjectNoteRef = builder.objectRef<BriefSubjectNote>("MeetingBriefSubjectNote").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    teacherName: t.string({ nullable: true, resolve: (s) => s.teacherName }),
    strengths: t.exposeString("strengths"),
    concerns: t.exposeString("concerns"),
    written: t.exposeBoolean("written"),
    skipped: t.exposeBoolean("skipped"),
    skipReason: t.string({ nullable: true, resolve: (s) => s.skipReason }),
  }),
});

const ClassBestRef = builder.objectRef<BriefClassBest>("MeetingBriefClassBest").implement({
  description:
    "The best figure in the child's section over the same window — bare numbers, nobody named; withheld " +
    "(all null, withheld = true) in a section below the monthly report's minSectionSizeForClassBest (D-#396/#866).",
  fields: (t) => ({
    rosterSize: t.exposeInt("rosterSize"),
    withheld: t.exposeBoolean("withheld"),
    attendancePresentDays: t.int({ nullable: true, resolve: (c) => c.attendancePresentDays }),
    classTestAvgPct: t.float({ nullable: true, resolve: (c) => c.classTestAvgPct }),
    homeworkPct: t.int({ nullable: true, resolve: (c) => c.homeworkPct }),
    assignmentPct: t.int({ nullable: true, resolve: (c) => c.assignmentPct }),
  }),
});

const BriefRef = builder.objectRef<MeetingBrief>("MeetingBrief").implement({
  description:
    "Everything the person meeting a guardian reads about one child (MC-1, D-#754): the final word, the class " +
    "teacher's summary, every subject teacher's note, and the numbers since the last meeting. Staff-only.",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    instanceLabel: t.exposeString("instanceLabel"),
    meetingDateKey: t.exposeString("meetingDateKey"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    classLevel: t.int({ nullable: true, resolve: (b) => b.classLevel }),
    classNameBn: t.exposeString("classNameBn"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classTeacherName: t.string({ nullable: true, resolve: (b) => b.classTeacherName }),
    slotTime: t.int({ nullable: true, resolve: (b) => b.slotTime }),
    onCall: t.exposeBoolean("onCall"),
    previousLabel: t.string({ nullable: true, resolve: (b) => b.previousLabel }),
    final: t.field({ type: FinalRef, nullable: true, resolve: (b) => b.final }),
    summary: t.field({ type: SummaryRef, nullable: true, resolve: (b) => b.summary }),
    subjectNotes: t.field({ type: [BriefSubjectNoteRef], resolve: (b) => b.subjectNotes }),
    numbers: t.field({ type: NumbersRef, resolve: (b) => b.numbers }),
    classBest: t.field({ type: ClassBestRef, nullable: true, resolve: (b) => b.classBest }),
  }),
});

const SubjectNoteContextRef = builder.objectRef<SubjectNoteContext>("MeetingSubjectNoteContext").implement({
  description: "The subject teacher's write screen for one child (MC-3): the row, last meeting's note, the subject's numbers.",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    instanceLabel: t.exposeString("instanceLabel"),
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    classLevel: t.int({ nullable: true, resolve: (c) => c.classLevel }),
    classNameBn: t.exposeString("classNameBn"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    subject: t.exposeString("subject"),
    strengths: t.exposeString("strengths"),
    concerns: t.exposeString("concerns"),
    written: t.exposeBoolean("written"),
    skipped: t.exposeBoolean("skipped"),
    locked: t.exposeBoolean("locked"),
    mine: t.exposeBoolean("mine"),
    previousLabel: t.string({ nullable: true, resolve: (c) => c.previousLabel }),
    previousStrengths: t.string({ nullable: true, resolve: (c) => c.previousStrengths }),
    previousConcerns: t.string({ nullable: true, resolve: (c) => c.previousConcerns }),
    numbers: t.field({ type: NumbersRef, resolve: (c) => c.numbers }),
  }),
});

// ---------------------------------------------------------------------------
// Shapes — admin
// ---------------------------------------------------------------------------

const ProgressSubjectRef = builder.objectRef<ProgressSubject>("MeetingProgressSubject").implement({
  fields: (t) => ({
    subject: t.exposeString("subject"),
    teacherNames: t.exposeStringList("teacherNames"),
    total: t.exposeInt("total"),
    written: t.exposeInt("written"),
    skipped: t.exposeInt("skipped"),
    skipReason: t.string({ nullable: true, resolve: (s) => s.skipReason }),
  }),
});
const ProgressSectionRef = builder.objectRef<ProgressSection>("MeetingProgressSection").implement({
  fields: (t) => ({
    sectionId: t.exposeString("sectionId"),
    classLevel: t.int({ nullable: true, resolve: (s) => s.classLevel }),
    classNameBn: t.exposeString("classNameBn"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    classTeacherName: t.string({ nullable: true, resolve: (s) => s.classTeacherName }),
    students: t.exposeInt("students"),
    notesTotal: t.exposeInt("notesTotal"),
    notesWritten: t.exposeInt("notesWritten"),
    notesSkipped: t.exposeInt("notesSkipped"),
    summaryDone: t.exposeInt("summaryDone"),
    summaryReady: t.exposeInt("summaryReady"),
    finalDone: t.exposeInt("finalDone"),
    subjects: t.field({ type: [ProgressSubjectRef], resolve: (s) => s.subjects }),
  }),
});
const ProgressTeacherRef = builder.objectRef<ProgressTeacher>("MeetingProgressTeacher").implement({
  fields: (t) => ({
    teacherId: t.exposeString("teacherId"),
    name: t.exposeString("name"),
    left: t.exposeInt("left"),
    places: t.exposeStringList("places"),
  }),
});
const ProgressRef = builder.objectRef<CommentProgress>("MeetingCommentProgress").implement({
  description: "The Office/Principal's view of a meeting's comment chain (MC-4): totals, by section, comments left by teacher.",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    instanceLabel: t.exposeString("instanceLabel"),
    meetingDateKey: t.exposeString("meetingDateKey"),
    open: t.exposeBoolean("open"),
    subjectDueKey: t.string({ nullable: true, resolve: (p) => p.subjectDueKey }),
    summaryDueKey: t.string({ nullable: true, resolve: (p) => p.summaryDueKey }),
    openedAt: t.string({ nullable: true, resolve: (p) => p.openedAt }),
    rosterBuiltAt: t.string({ nullable: true, resolve: (p) => p.rosterBuiltAt }),
    fromKey: t.exposeString("fromKey"),
    toKey: t.exposeString("toKey"),
    students: t.exposeInt("students"),
    notesTotal: t.exposeInt("notesTotal"),
    notesWritten: t.exposeInt("notesWritten"),
    notesSkipped: t.exposeInt("notesSkipped"),
    summaryDone: t.exposeInt("summaryDone"),
    summaryReady: t.exposeInt("summaryReady"),
    summaryWaiting: t.exposeInt("summaryWaiting"),
    finalDone: t.exposeInt("finalDone"),
    finalReady: t.exposeInt("finalReady"),
    sections: t.field({ type: [ProgressSectionRef], resolve: (p) => p.sections }),
    teachers: t.field({ type: [ProgressTeacherRef], resolve: (p) => p.teachers }),
  }),
});
const FinalQueueRowRef = builder.objectRef<FinalQueueRow>("MeetingFinalQueueRow").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    classNameBn: t.exposeString("classNameBn"),
    sectionNameBn: t.exposeString("sectionNameBn"),
    state: t.exposeString("state"),
    finalSource: t.string({ nullable: true, resolve: (r) => r.finalSource }),
    slotTime: t.int({ nullable: true, resolve: (r) => r.slotTime }),
    slotOrder: t.int({ nullable: true, resolve: (r) => r.slotOrder }),
  }),
});
const FinalSavedRef = builder.objectRef<{ source: string; strengths: string; concerns: string }>("MeetingFinalSaved").implement({
  fields: (t) => ({
    source: t.exposeString("source"),
    strengths: t.exposeString("strengths"),
    concerns: t.exposeString("concerns"),
  }),
});

// ---------------------------------------------------------------------------
// Admin — roster:manage
// ---------------------------------------------------------------------------

builder.mutationField("openMeetingComments", (t) =>
  t.field({
    type: RosterResultRef,
    description:
      "Open comment collection on a meeting (builds who-comments-on-whom from today's routine), or — when " +
      "already open — change the two due dates. roster:manage; audited MEETING_COMMENTS_OPENED.",
    authScopes: { hasPermission: "parents_meeting:assign" },
    args: {
      meetingId: t.arg.string({ required: true }),
      subjectDueKey: t.arg.string({ required: true }),
      summaryDueKey: t.arg.string({ required: true }),
    },
    resolve: (_r, a, ctx) => openCommentCollection({ meetingId: a.meetingId, subjectDueKey: a.subjectDueKey, summaryDueKey: a.summaryDueKey, actorId: actorOf(ctx) }),
  }),
);

builder.mutationField("refreshMeetingCommentRoster", (t) =>
  t.field({
    type: RosterResultRef,
    description: "Rebuild the roster from today's routine; written notes are kept. roster:manage.",
    authScopes: { hasPermission: "parents_meeting:assign" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => refreshCommentRoster(a.meetingId, actorOf(ctx)),
  }),
);

builder.mutationField("setMeetingSubjectSkipped", (t) =>
  t.field({
    type: "Int",
    description: "Skip (reason given) or restore (no reason) a subject's unwritten notes for one section. roster:manage.",
    authScopes: { hasPermission: "parents_meeting:assign" },
    args: {
      meetingId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    resolve: (_r, a, ctx) => setSubjectSkipped({ meetingId: a.meetingId, sectionId: a.sectionId, subject: a.subject, reason: a.reason ?? null, actorId: actorOf(ctx) }),
  }),
);

builder.mutationField("remindMeetingTeacher", (t) =>
  t.field({
    type: "Boolean",
    description: "Send a teacher today's reminder about their meeting comments left. False = already sent today. roster:manage.",
    authScopes: { hasPermission: "parents_meeting:assign" },
    args: { meetingId: t.arg.string({ required: true }), teacherId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => remindTeacher(a.meetingId, a.teacherId, actorOf(ctx)),
  }),
);

builder.queryField("meetingCommentProgress", (t) =>
  t.field({
    type: ProgressRef,
    description: "The meeting's comment chain progress for the Office/Principal. roster:manage.",
    authScopes: { hasPermission: "parents_meeting:view" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: (_r, a) => commentProgress(a.meetingId),
  }),
);

builder.queryField("meetingFinalQueue", (t) =>
  t.field({
    type: [FinalQueueRowRef],
    description: "Every child of the meeting with where their final comment stands, in slot order. roster:manage.",
    authScopes: { hasPermission: "parents_meeting:review" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: (_r, a) => finalQueue(a.meetingId),
  }),
);

builder.mutationField("saveMeetingFinalComment", (t) =>
  t.field({
    type: FinalSavedRef,
    description:
      "The Principal's/Office's final word for a child (layer 1): AS_IS copies the class teacher's summary, " +
      "EDITED and OWN take the two boxes. The summary itself is never changed. roster:manage; audited.",
    authScopes: { hasPermission: "parents_meeting:review" },
    args: {
      meetingId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      source: t.arg.string({ required: true }),
      strengths: t.arg.string({ required: false }),
      concerns: t.arg.string({ required: false }),
    },
    resolve: (_r, a, ctx) =>
      saveFinalComment({ meetingId: a.meetingId, studentId: a.studentId, source: a.source, strengths: a.strengths, concerns: a.concerns, actorId: actorOf(ctx) }),
  }),
);

// ---------------------------------------------------------------------------
// Teachers — tracker:write (the row's own teacher / the class teacher)
// ---------------------------------------------------------------------------

builder.mutationField("saveMeetingSubjectNote", (t) =>
  t.field({
    type: SubjectNoteRef,
    description: "A subject teacher's Strengths + Concerns for one child (layer 3). Only the row's teacher; frozen once the class teacher summarises.",
    authScopes: { hasPermission: "parents_meeting:write_notes" },
    args: {
      meetingId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      strengths: t.arg.string({ required: false }),
      concerns: t.arg.string({ required: false }),
    },
    resolve: (_r, a, ctx) =>
      saveSubjectNote({ meetingId: a.meetingId, studentId: a.studentId, subject: a.subject, strengths: a.strengths, concerns: a.concerns, actorId: actorOf(ctx) }),
  }),
);

builder.queryField("myMeetingNoteWork", (t) =>
  t.field({
    type: [NoteWorkMeetingRef],
    description: "The caller's own parents'-meeting comments owed, per open meeting (the Today card). tracker:write.",
    authScopes: { hasPermission: "parents_meeting:write_notes" },
    resolve: (_r, _a, ctx) => mySubjectNoteWork(actorOf(ctx)),
  }),
);

builder.queryField("myMeetingSummaryWork", (t) =>
  t.field({
    type: [SummaryWorkMeetingRef],
    description: "The caller's class-teacher summaries per open meeting (the Today card); empty when they class-teach no section. tracker:write.",
    authScopes: { hasPermission: "parents_meeting:write_notes" },
    resolve: (_r, _a, ctx) => mySummaryWork(actorOf(ctx)),
  }),
);

builder.queryField("meetingSubjectNoteContext", (t) =>
  t.field({
    type: SubjectNoteContextRef,
    description: "The write screen for one child × subject: the row's teacher, or roster:manage.",
    authScopes: { hasAnyPermission: ["parents_meeting:write_notes", "parents_meeting:view"] },
    args: {
      meetingId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
    },
    resolve: (_r, a, ctx) => subjectNoteContext(a.meetingId, a.studentId, a.subject, { userId: actorOf(ctx), isAdmin: isAdmin(ctx) }),
  }),
);

builder.queryField("meetingBrief", (t) =>
  t.field({
    type: BriefRef,
    description: "The meeting brief for one child: roster:manage, or the class teacher of the child's section.",
    authScopes: { hasPermission: "parents_meeting:view_brief" },
    args: { meetingId: t.arg.string({ required: true }), studentId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await assertBriefRead({ userId: actorOf(ctx), isAdmin: isAdmin(ctx) }, a.studentId);
      return meetingBrief(a.meetingId, a.studentId);
    },
  }),
);
