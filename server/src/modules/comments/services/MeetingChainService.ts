/**
 * MeetingChainService (MC-1/MC-2, docs/prd-meeting-comments.md, D-#752/#753/#756) — the
 * parents'-meeting comment chain:
 *
 *   3 · subject note    — every teacher the routine names for a (child × subject) writes
 *                         Strengths + Concerns (MeetingSubjectNote; the row is also the
 *                         roster entry);
 *   2 · class teacher   — the section's class teacher summarises once every subject note
 *                         of the child is written or skipped (the existing CM-5
 *                         MeetingComment row — this service only supplies its gate);
 *   1 · final           — the Principal/Office use, edit or replace the summary
 *                         (MeetingFinalComment).
 *
 * Locks run downward: a subject note freezes once the summary exists; the summary
 * freezes once the final exists. Nothing upstream is ever overwritten.
 *
 * Callers (resolvers) own the RBAC: tracker:write for subject notes (and this service
 * checks the row's own teacher), the class-teacher gate for summaries, roster:manage
 * for everything admin. Identity plane (names students) — no corpus path (ADR-005).
 */
import { Types } from "mongoose";
import { ParentMeeting, type IParentMeeting } from "../models/ParentMeeting";
import { ParentMeetingSlot } from "../models/ParentMeetingSlot";
import { MeetingComment } from "../models/MeetingComment";
import { MeetingSubjectNote, type IMeetingSubjectNote } from "../models/MeetingSubjectNote";
import { MeetingFinalComment, type MeetingFinalSource, MEETING_FINAL_SOURCES } from "../models/MeetingFinalComment";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { User } from "../../foundation/models/User";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { SubjectGroupMembership } from "../../routine/models/SubjectGroupMembership";
import { liveWindow } from "../../routine/liveWindow";
import { isValidDateKey } from "../../attendance/dates";
import { writeAudit } from "../../platform/services/AuditService";
import { emit } from "../../notifications/services/NotificationService";
import { meetingScopeFilter } from "./ParentMeetingService";
import { meetingDayKey, meetingWindow, childNumbers, previousMeetingOf, addDaysKey, subjectBn, type BriefNumbers } from "./MeetingBriefService";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { bnNum } from "../../../lib/bnNum";
import { personName } from "../../../lib/personName";

/** A refused chain action — a sentence for the person, never a fault (EXPECTED_ERROR_NAMES). */
export class MeetingChainError extends Error {}

const str = (id: unknown): string => (id == null ? "" : String(id));
const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);
/** Longest a single box may be — a paragraph, not an essay. */
export const MEETING_NOTE_MAX = 2000;

// ===========================================================================
// Pure core (no DB — unit-tested directly)
// ===========================================================================

/** subject → the teacher with the most periods of it (ties → the smaller id, so a
 *  rebuild is stable). */
export function pickSubjectTeachers(slots: Array<{ subject: string; teacherId: string }>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const s of slots) {
    const bySubject = counts.get(s.subject) ?? counts.set(s.subject, new Map()).get(s.subject)!;
    bySubject.set(s.teacherId, (bySubject.get(s.teacherId) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [subject, byTeacher] of counts) {
    const best = [...byTeacher.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) out.set(subject, best[0]);
  }
  return out;
}

export interface ExpectedRow {
  studentId: string;
  sectionId: string;
  classId: string;
  subject: string;
  teacherId: string;
}

/** Each child's subjects: their section's routine, overridden by their Quran/Arabic
 *  group's routine (the C1–5 Quran periods live on the group, D-#278). */
export function expectedRosterOf(
  students: Array<{ id: string; sectionId: string; classId: string }>,
  sectionTeachers: Map<string, Map<string, string>>,
  groupsOf: Map<string, string[]>,
  groupTeachers: Map<string, Map<string, string>>,
): ExpectedRow[] {
  const rows: ExpectedRow[] = [];
  for (const s of students) {
    const subjects = new Map(sectionTeachers.get(s.sectionId) ?? []);
    for (const g of groupsOf.get(s.id) ?? []) for (const [sub, t] of groupTeachers.get(g) ?? []) subjects.set(sub, t);
    for (const [subject, teacherId] of subjects) rows.push({ studentId: s.id, sectionId: s.sectionId, classId: s.classId, subject, teacherId });
  }
  return rows.sort((a, b) => a.studentId.localeCompare(b.studentId) || a.subject.localeCompare(b.subject));
}

export interface ExistingRosterRow {
  id: string;
  studentId: string;
  subject: string;
  teacherId: string;
  sectionId: string;
  written: boolean;
}

export interface RosterPlan {
  insert: ExpectedRow[];
  retarget: Array<{ id: string; teacherId: string; sectionId: string; classId: string }>;
  remove: string[];
}

/** A rebuild: new pairs are added; an UNWRITTEN row follows the routine (teacher and the
 *  child's current section); an unwritten row no longer expected goes. A written row is
 *  never touched — it is somebody's words. */
export function planRoster(existing: ExistingRosterRow[], expected: ExpectedRow[]): RosterPlan {
  const key = (studentId: string, subject: string) => `${studentId}|${subject}`;
  const have = new Map(existing.map((e) => [key(e.studentId, e.subject), e]));
  const want = new Set(expected.map((e) => key(e.studentId, e.subject)));
  const plan: RosterPlan = { insert: [], retarget: [], remove: [] };
  for (const e of expected) {
    const ex = have.get(key(e.studentId, e.subject));
    if (!ex) plan.insert.push(e);
    else if (!ex.written && (ex.teacherId !== e.teacherId || ex.sectionId !== e.sectionId))
      plan.retarget.push({ id: ex.id, teacherId: e.teacherId, sectionId: e.sectionId, classId: e.classId });
  }
  for (const ex of existing) if (!ex.written && !want.has(key(ex.studentId, ex.subject))) plan.remove.push(ex.id);
  return plan;
}

export interface ChildReadiness {
  total: number;
  written: number;
  skipped: number;
  missing: Array<{ subject: string; teacherId: string }>;
  /** Every subject note is written or skipped — the class teacher may summarise. */
  ready: boolean;
}

export function readinessOf(rows: Array<{ subject: string; teacherId: unknown; writtenAt?: Date | null; skippedAt?: Date | null }>): ChildReadiness {
  const written = rows.filter((r) => !!r.writtenAt).length;
  const skipped = rows.filter((r) => !r.writtenAt && !!r.skippedAt).length;
  const missing = rows
    .filter((r) => !r.writtenAt && !r.skippedAt)
    .map((r) => ({ subject: r.subject, teacherId: str(r.teacherId) }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
  return { total: rows.length, written, skipped, missing, ready: missing.length === 0 };
}

/** The two boxes, trimmed and checked. At least one must say something. */
export function cleanBoxes(strengths: string | null | undefined, concerns: string | null | undefined): { strengths: string; concerns: string } {
  const s = (strengths ?? "").trim();
  const c = (concerns ?? "").trim();
  if (!s && !c) throw new MeetingChainError("ভালো দিক বা চিন্তার বিষয় — অন্তত একটি লিখুন।");
  if (s.length > MEETING_NOTE_MAX || c.length > MEETING_NOTE_MAX)
    throw new MeetingChainError(`প্রতিটি ঘরে সর্বোচ্চ ${bnNum(MEETING_NOTE_MAX)} অক্ষর লেখা যায়।`);
  return { strengths: s, concerns: c };
}

// ===========================================================================
// Loading helpers
// ===========================================================================

async function loadMeeting(meetingId: string): Promise<IParentMeeting> {
  if (!Types.ObjectId.isValid(meetingId)) throw new MeetingChainError("ভুল সভা আইডি");
  const m = (await ParentMeeting.findById(meetingId).lean()) as IParentMeeting | null;
  if (!m) throw new MeetingChainError("সভা পাওয়া যায়নি");
  return m;
}

function requireOpen(m: IParentMeeting): NonNullable<IParentMeeting["commentCollection"]> {
  if (!m.commentCollection) throw new MeetingChainError("এই সভার মন্তব্য সংগ্রহ এখনো শুরু হয়নি।");
  if (m.status === "closed") throw new MeetingChainError("এই সভা শেষ হয়ে গেছে।");
  return m.commentCollection;
}

async function userNames(ids: unknown[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean).map(str))];
  if (!uniq.length) return new Map();
  const users = (await User.find({ _id: { $in: uniq } }).select("name").lean()) as unknown as Array<{ _id: Types.ObjectId; name: string }>;
  return new Map(users.map((u) => [str(u._id), u.name]));
}

interface SectionInfo {
  sectionId: string;
  classId: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  classTeacherId: string | null;
}

async function sectionInfo(sectionIds: string[]): Promise<Map<string, SectionInfo>> {
  const uniq = [...new Set(sectionIds)];
  const sections = (await Section.find({ _id: { $in: uniq } }).select("classId nameBn classTeacherId").lean()) as unknown as Array<{
    _id: Types.ObjectId;
    classId: Types.ObjectId;
    nameBn: string;
    classTeacherId?: Types.ObjectId;
  }>;
  const classes = (await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("level nameBn").lean()) as unknown as Array<{
    _id: Types.ObjectId;
    level: number;
    nameBn: string;
  }>;
  const cls = new Map(classes.map((c) => [str(c._id), c]));
  return new Map(
    sections.map((s) => [
      str(s._id),
      {
        sectionId: str(s._id),
        classId: str(s.classId),
        classLevel: cls.get(str(s.classId))?.level ?? null,
        classNameBn: cls.get(str(s.classId))?.nameBn ?? "",
        sectionNameBn: s.nameBn,
        classTeacherId: s.classTeacherId ? str(s.classTeacherId) : null,
      },
    ]),
  );
}

const sectionOrder = (a: SectionInfo | undefined, b: SectionInfo | undefined): number =>
  (a?.classLevel ?? 99) - (b?.classLevel ?? 99) || (a?.sectionNameBn ?? "").localeCompare(b?.sectionNameBn ?? "");

interface ScopeStudent {
  _id: Types.ObjectId;
  name: string;
  nameBn?: string;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
}

async function scopeStudents(meeting: IParentMeeting, extra: Record<string, unknown> = {}): Promise<ScopeStudent[]> {
  return (await Student.find({ ...meetingScopeFilter(meeting), ...extra }).select("name nameBn sectionId classId").lean()) as unknown as ScopeStudent[];
}

const displayName = (s: { name: string; nameBn?: string }): string => personName(s);

/** Open (collection started, not closed) meetings whose day is today or later. */
async function openMeetings(now: Date): Promise<IParentMeeting[]> {
  const today = dhakaDayKey(now);
  const ms = (await ParentMeeting.find({ commentCollection: { $ne: null }, status: { $ne: "closed" } }).sort({ meetingDate: 1 }).lean()) as unknown as IParentMeeting[];
  return ms.filter((m) => meetingDayKey(m) >= today);
}

// ===========================================================================
// Roster — open collection / refresh (D-#753)
// ===========================================================================

async function buildExpectedRoster(meeting: IParentMeeting, on: Date): Promise<ExpectedRow[]> {
  const students = await scopeStudents(meeting);
  if (!students.length) return [];
  const sectionIds = [...new Set(students.map((s) => str(s.sectionId)))].map(oid);
  const live = { active: true, isBreak: false, teacherId: { $ne: null }, ...liveWindow(on) };
  const sectionSlots = (await RoutineSlot.find({ groupType: "section", groupId: { $in: sectionIds }, ...live })
    .select("groupId subject teacherId")
    .lean()) as unknown as Array<{ groupId: Types.ObjectId; subject: string; teacherId: Types.ObjectId }>;
  const memberships = (await SubjectGroupMembership.find({ studentId: { $in: students.map((s) => s._id) } })
    .select("studentId groupId")
    .lean()) as unknown as Array<{ studentId: Types.ObjectId; groupId: Types.ObjectId }>;
  const groupIds = [...new Set(memberships.map((m) => str(m.groupId)))].map(oid);
  const groupSlots = groupIds.length
    ? ((await RoutineSlot.find({ groupType: "subjectgroup", groupId: { $in: groupIds }, ...live })
        .select("groupId subject teacherId")
        .lean()) as unknown as Array<{ groupId: Types.ObjectId; subject: string; teacherId: Types.ObjectId }>)
    : [];

  const teachersBy = (slots: Array<{ groupId: Types.ObjectId; subject: string; teacherId: Types.ObjectId }>) => {
    const byGroup = new Map<string, Array<{ subject: string; teacherId: string }>>();
    for (const s of slots) (byGroup.get(str(s.groupId)) ?? byGroup.set(str(s.groupId), []).get(str(s.groupId))!).push({ subject: s.subject, teacherId: str(s.teacherId) });
    return new Map([...byGroup.entries()].map(([g, ss]) => [g, pickSubjectTeachers(ss)]));
  };
  const groupsOf = new Map<string, string[]>();
  for (const m of memberships) (groupsOf.get(str(m.studentId)) ?? groupsOf.set(str(m.studentId), []).get(str(m.studentId))!).push(str(m.groupId));

  return expectedRosterOf(
    students.map((s) => ({ id: str(s._id), sectionId: str(s.sectionId), classId: str(s.classId) })),
    teachersBy(sectionSlots),
    groupsOf,
    teachersBy(groupSlots),
  );
}

export interface RosterResult {
  inserted: number;
  retargeted: number;
  removed: number;
}

async function applyRoster(meeting: IParentMeeting, now: Date): Promise<RosterResult> {
  const expected = await buildExpectedRoster(meeting, now);
  const existing = (await MeetingSubjectNote.find({ meetingId: meeting._id }).select("studentId subject teacherId sectionId writtenAt").lean()) as unknown as IMeetingSubjectNote[];
  const plan = planRoster(
    existing.map((e) => ({ id: str(e._id), studentId: str(e.studentId), subject: e.subject, teacherId: str(e.teacherId), sectionId: str(e.sectionId), written: !!e.writtenAt })),
    expected,
  );
  if (plan.insert.length) {
    await MeetingSubjectNote.insertMany(
      plan.insert.map((r) => ({ meetingId: meeting._id, studentId: oid(r.studentId), sectionId: oid(r.sectionId), classId: oid(r.classId), subject: r.subject, teacherId: oid(r.teacherId) })),
      { ordered: false },
    );
  }
  if (plan.retarget.length) {
    await MeetingSubjectNote.bulkWrite(
      plan.retarget.map((r) => ({
        updateOne: { filter: { _id: oid(r.id), writtenAt: null }, update: { $set: { teacherId: oid(r.teacherId), sectionId: oid(r.sectionId), classId: oid(r.classId) } } },
      })),
    );
  }
  if (plan.remove.length) await MeetingSubjectNote.deleteMany({ _id: { $in: plan.remove.map(oid) }, writtenAt: null });
  return { inserted: plan.insert.length, retargeted: plan.retarget.length, removed: plan.remove.length };
}

export interface OpenCollectionInput {
  meetingId: string;
  subjectDueKey: string;
  summaryDueKey: string;
  actorId: string;
  now?: Date;
}

/** Open comment collection (builds the roster) — or, when already open, change the two
 *  due dates (the roster is left as it is; "Refresh teacher list" rebuilds it). */
export async function openCommentCollection(input: OpenCollectionInput): Promise<RosterResult> {
  const now = input.now ?? new Date();
  const meeting = await loadMeeting(input.meetingId);
  if (meeting.status === "closed") throw new MeetingChainError("এই সভা শেষ হয়ে গেছে।");
  if (!isValidDateKey(input.subjectDueKey) || !isValidDateKey(input.summaryDueKey)) throw new MeetingChainError("শেষ তারিখ ঠিক নেই।");
  if (input.subjectDueKey > input.summaryDueKey)
    throw new MeetingChainError("বিষয় শিক্ষকদের শেষ তারিখ শ্রেণি শিক্ষকের সারাংশের শেষ তারিখের আগে বা একই দিনে হতে হবে।");
  if (input.summaryDueKey > meetingDayKey(meeting)) throw new MeetingChainError("সারাংশের শেষ তারিখ সভার দিনের পরে হতে পারে না।");

  if (meeting.commentCollection) {
    await ParentMeeting.updateOne(
      { _id: meeting._id },
      { $set: { "commentCollection.subjectDueKey": input.subjectDueKey, "commentCollection.summaryDueKey": input.summaryDueKey } },
    );
    await writeAudit({
      eventKind: "MEETING_COMMENTS_OPENED",
      actorId: input.actorId,
      targetId: meeting._id,
      targetKind: "ParentMeeting",
      meta: { subjectDueKey: input.subjectDueKey, summaryDueKey: input.summaryDueKey, datesOnly: true },
    });
    return { inserted: 0, retargeted: 0, removed: 0 };
  }

  const result = await applyRoster(meeting, now);
  await ParentMeeting.updateOne(
    { _id: meeting._id },
    { $set: { commentCollection: { openedAt: now, openedBy: oid(input.actorId), subjectDueKey: input.subjectDueKey, summaryDueKey: input.summaryDueKey, rosterBuiltAt: now } } },
  );
  await writeAudit({
    eventKind: "MEETING_COMMENTS_OPENED",
    actorId: input.actorId,
    targetId: meeting._id,
    targetKind: "ParentMeeting",
    meta: { subjectDueKey: input.subjectDueKey, summaryDueKey: input.summaryDueKey, ...result },
  });
  return result;
}

export async function refreshCommentRoster(meetingId: string, actorId: string, now = new Date()): Promise<RosterResult> {
  const meeting = await loadMeeting(meetingId);
  requireOpen(meeting);
  const result = await applyRoster(meeting, now);
  await ParentMeeting.updateOne({ _id: meeting._id }, { $set: { "commentCollection.rosterBuiltAt": now } });
  await writeAudit({ eventKind: "MEETING_COMMENT_ROSTER_REFRESHED", actorId, targetId: meeting._id, targetKind: "ParentMeeting", meta: { ...result } });
  return result;
}

/** Skip (reason given) or un-skip (reason null) one subject for one section — every
 *  UNWRITTEN row of it. A written note is kept and counts as written either way. */
export async function setSubjectSkipped(input: { meetingId: string; sectionId: string; subject: string; reason: string | null; actorId: string }): Promise<number> {
  const meeting = await loadMeeting(input.meetingId);
  requireOpen(meeting);
  if (!Types.ObjectId.isValid(input.sectionId)) throw new MeetingChainError("ভুল শাখা আইডি");
  const filter = { meetingId: meeting._id, sectionId: oid(input.sectionId), subject: input.subject, writtenAt: null };
  const reason = input.reason?.trim() || null;
  const res = reason
    ? await MeetingSubjectNote.updateMany({ ...filter, skippedAt: null }, { $set: { skippedAt: new Date(), skippedBy: oid(input.actorId), skipReason: reason } })
    : await MeetingSubjectNote.updateMany({ ...filter, skippedAt: { $ne: null } }, { $set: { skippedAt: null, skippedBy: null, skipReason: null } });
  if (!res.modifiedCount) throw new MeetingChainError(reason ? "এই বিষয়ে বাকি কোনো মন্তব্য নেই।" : "এই বিষয়টি বাদ দেওয়া ছিল না।");
  await writeAudit({
    eventKind: "MEETING_SUBJECT_SKIPPED",
    actorId: input.actorId,
    targetId: meeting._id,
    targetKind: "ParentMeeting",
    meta: { sectionId: input.sectionId, subject: input.subject, reason, rows: res.modifiedCount, ...(reason ? {} : { undone: true }) },
  });
  return res.modifiedCount;
}

// ===========================================================================
// Layer 3 — subject notes
// ===========================================================================

export interface SubjectNoteShape {
  meetingId: string;
  studentId: string;
  subject: string;
  strengths: string;
  concerns: string;
  written: boolean;
  writtenAt: string | null;
}

export async function saveSubjectNote(input: {
  meetingId: string;
  studentId: string;
  subject: string;
  strengths?: string | null;
  concerns?: string | null;
  actorId: string;
}): Promise<SubjectNoteShape> {
  const meeting = await loadMeeting(input.meetingId);
  requireOpen(meeting);
  if (!Types.ObjectId.isValid(input.studentId)) throw new MeetingChainError("ভুল শিক্ষার্থী আইডি");
  const row = (await MeetingSubjectNote.findOne({ meetingId: meeting._id, studentId: oid(input.studentId), subject: input.subject }).lean()) as IMeetingSubjectNote | null;
  if (!row) throw new MeetingChainError("এই শিক্ষার্থীর এই বিষয়ের মন্তব্য তালিকায় নেই।");
  if (str(row.teacherId) !== input.actorId) throw new MeetingChainError("এই মন্তব্যটি অন্য শিক্ষকের লেখার কথা।");
  if (row.skippedAt && !row.writtenAt) throw new MeetingChainError("অফিস এই বিষয়টি বাদ দিয়েছে — মন্তব্য লাগবে না।");
  if (await MeetingComment.exists({ meetingId: meeting._id, studentId: row.studentId }))
    throw new MeetingChainError("শ্রেণি শিক্ষক সারাংশ লিখে ফেলেছেন — এখন আর বদলানো যাবে না।");
  const boxes = cleanBoxes(input.strengths, input.concerns);
  const now = new Date();
  await MeetingSubjectNote.updateOne(
    { _id: row._id },
    { $set: { ...boxes, writtenAt: row.writtenAt ?? now, writtenBy: oid(input.actorId) } },
  );
  await writeAudit({
    eventKind: "MEETING_SUBJECT_NOTE_SAVED",
    actorId: input.actorId,
    targetId: row._id,
    targetKind: "MeetingSubjectNote",
    meta: { meetingId: input.meetingId, studentId: input.studentId, subject: input.subject, edit: !!row.writtenAt },
  });
  return {
    meetingId: input.meetingId,
    studentId: input.studentId,
    subject: input.subject,
    ...boxes,
    written: true,
    writtenAt: (row.writtenAt ?? now).toISOString(),
  };
}

export interface NoteWorkStudent {
  studentId: string;
  name: string;
  written: boolean;
  skipped: boolean;
  /** The class teacher has summarised — the note is frozen. */
  locked: boolean;
}
export interface NoteWorkGroup {
  sectionId: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  subject: string;
  total: number;
  written: number;
  due: number;
  students: NoteWorkStudent[];
}
export interface NoteWorkMeeting {
  meetingId: string;
  instanceLabel: string;
  meetingDateKey: string;
  subjectDueKey: string;
  total: number;
  due: number;
  groups: NoteWorkGroup[];
}

/** The subject teacher's Today card: their rows in every open meeting, by class × subject. */
export async function mySubjectNoteWork(actorId: string, now = new Date()): Promise<NoteWorkMeeting[]> {
  const meetings = await openMeetings(now);
  if (!meetings.length) return [];
  const rows = (await MeetingSubjectNote.find({ meetingId: { $in: meetings.map((m) => m._id) }, teacherId: oid(actorId) }).lean()) as unknown as IMeetingSubjectNote[];
  if (!rows.length) return [];
  const students = (await Student.find({ _id: { $in: [...new Set(rows.map((r) => str(r.studentId)))].map(oid) } }).select("name nameBn").lean()) as unknown as Array<{ _id: Types.ObjectId; name: string; nameBn?: string }>;
  const nameOf = new Map(students.map((s) => [str(s._id), displayName(s)]));
  const sections = await sectionInfo(rows.map((r) => str(r.sectionId)));
  const summaries = (await MeetingComment.find({ meetingId: { $in: meetings.map((m) => m._id) }, studentId: { $in: rows.map((r) => r.studentId) } }).select("meetingId studentId").lean()) as unknown as Array<{ meetingId: Types.ObjectId; studentId: Types.ObjectId }>;
  const locked = new Set(summaries.map((s) => `${str(s.meetingId)}|${str(s.studentId)}`));

  const out: NoteWorkMeeting[] = [];
  for (const m of meetings) {
    const mine = rows.filter((r) => str(r.meetingId) === str(m._id));
    if (!mine.length) continue;
    const byGroup = new Map<string, IMeetingSubjectNote[]>();
    for (const r of mine) {
      const k = `${str(r.sectionId)}|${r.subject}`;
      (byGroup.get(k) ?? byGroup.set(k, []).get(k)!).push(r);
    }
    const groups: NoteWorkGroup[] = [...byGroup.values()].map((rs) => {
      const sec = sections.get(str(rs[0].sectionId));
      const studentsOut = rs
        .map((r) => ({
          studentId: str(r.studentId),
          name: nameOf.get(str(r.studentId)) ?? "—",
          written: !!r.writtenAt,
          skipped: !r.writtenAt && !!r.skippedAt,
          locked: locked.has(`${str(m._id)}|${str(r.studentId)}`),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const written = studentsOut.filter((s) => s.written).length;
      const due = studentsOut.filter((s) => !s.written && !s.skipped && !s.locked).length;
      return {
        sectionId: str(rs[0].sectionId),
        classLevel: sec?.classLevel ?? null,
        classNameBn: sec?.classNameBn ?? "",
        sectionNameBn: sec?.sectionNameBn ?? "",
        subject: rs[0].subject,
        total: studentsOut.length,
        written,
        due,
        students: studentsOut,
      };
    });
    groups.sort((a, b) => (a.classLevel ?? 99) - (b.classLevel ?? 99) || a.sectionNameBn.localeCompare(b.sectionNameBn) || a.subject.localeCompare(b.subject));
    out.push({
      meetingId: str(m._id),
      instanceLabel: m.instanceLabel,
      meetingDateKey: meetingDayKey(m),
      subjectDueKey: m.commentCollection!.subjectDueKey,
      total: groups.reduce((s, g) => s + g.total, 0),
      due: groups.reduce((s, g) => s + g.due, 0),
      groups,
    });
  }
  return out;
}

export interface SubjectNoteContext {
  meetingId: string;
  instanceLabel: string;
  studentId: string;
  studentName: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  subject: string;
  strengths: string;
  concerns: string;
  written: boolean;
  skipped: boolean;
  locked: boolean;
  /** Is the caller the teacher who writes this row. */
  mine: boolean;
  previousLabel: string | null;
  previousStrengths: string | null;
  previousConcerns: string | null;
  numbers: BriefNumbers;
}

/** The write screen: the row, last meeting's note for the same subject, and the child's
 *  numbers in that subject since the last meeting. Read by the row's teacher or an admin. */
export async function subjectNoteContext(meetingId: string, studentId: string, subject: string, actor: { userId: string; isAdmin: boolean }, now = new Date()): Promise<SubjectNoteContext> {
  const meeting = await loadMeeting(meetingId);
  if (!Types.ObjectId.isValid(studentId)) throw new MeetingChainError("ভুল শিক্ষার্থী আইডি");
  const row = (await MeetingSubjectNote.findOne({ meetingId: meeting._id, studentId: oid(studentId), subject }).lean()) as IMeetingSubjectNote | null;
  if (!row) throw new MeetingChainError("এই শিক্ষার্থীর এই বিষয়ের মন্তব্য তালিকায় নেই।");
  const mine = str(row.teacherId) === actor.userId;
  if (!mine && !actor.isAdmin) throw new MeetingChainError("এই মন্তব্যটি অন্য শিক্ষকের।");
  const [student, sections, summary, window, prev] = await Promise.all([
    Student.findById(row.studentId).select("name nameBn").lean() as Promise<{ name: string; nameBn?: string } | null>,
    sectionInfo([str(row.sectionId)]),
    MeetingComment.exists({ meetingId: meeting._id, studentId: row.studentId }),
    meetingWindow(meeting, now),
    previousMeetingOf(meeting),
  ]);
  const prevNote = prev
    ? ((await MeetingSubjectNote.findOne({ meetingId: prev._id, studentId: row.studentId, subject, writtenAt: { $ne: null } }).lean()) as IMeetingSubjectNote | null)
    : null;
  const sec = sections.get(str(row.sectionId));
  return {
    meetingId,
    instanceLabel: meeting.instanceLabel,
    studentId,
    studentName: student ? displayName(student) : "—",
    classLevel: sec?.classLevel ?? null,
    classNameBn: sec?.classNameBn ?? "",
    sectionNameBn: sec?.sectionNameBn ?? "",
    subject,
    strengths: row.strengths ?? "",
    concerns: row.concerns ?? "",
    written: !!row.writtenAt,
    skipped: !row.writtenAt && !!row.skippedAt,
    locked: !!summary,
    mine,
    previousLabel: prevNote ? prev!.instanceLabel : null,
    previousStrengths: prevNote?.strengths ?? null,
    previousConcerns: prevNote?.concerns ?? null,
    numbers: await childNumbers(studentId, window.fromKey, window.toKey, [subject], now),
  };
}

// ===========================================================================
// Layer 2 — class-teacher summaries (the gate; the write stays CM-5's saveMeetingComment)
// ===========================================================================

/** Throws unless the class teacher may write/edit the summary now: every subject note is
 *  written or skipped, and no final exists yet. A meeting without collection open keeps
 *  the CM-5 behaviour (no gate). */
export async function assertSummaryWritable(meetingId: string, studentId: string, boxes?: { strengths?: string | null; concerns?: string | null }): Promise<void> {
  const meeting = await loadMeeting(meetingId);
  if (!meeting.commentCollection) return;
  if (meeting.status === "closed") throw new MeetingChainError("এই সভা শেষ হয়ে গেছে।");
  if (!Types.ObjectId.isValid(studentId)) throw new MeetingChainError("ভুল শিক্ষার্থী আইডি");
  if (boxes) cleanBoxes(boxes.strengths, boxes.concerns);
  if (await MeetingFinalComment.exists({ meetingId: meeting._id, studentId: oid(studentId) }))
    throw new MeetingChainError("প্রধান শিক্ষক / অফিস চূড়ান্ত মন্তব্য লিখে ফেলেছেন — সারাংশ আর বদলানো যাবে না।");
  const rows = (await MeetingSubjectNote.find({ meetingId: meeting._id, studentId: oid(studentId) }).select("subject teacherId writtenAt skippedAt").lean()) as unknown as IMeetingSubjectNote[];
  const r = readinessOf(rows);
  if (!r.ready) {
    const names = await userNames(r.missing.map((x) => x.teacherId));
    const list = r.missing.map((x) => `${subjectBn(x.subject)} (${names.get(x.teacherId) ?? "—"})`).join(", ");
    throw new MeetingChainError(`সব বিষয় শিক্ষকের মন্তব্য এখনো আসেনি: ${list}`);
  }
}

export type SummaryState = "WAITING" | "READY" | "DONE";

export interface SummaryWorkStudent {
  studentId: string;
  name: string;
  state: SummaryState;
  total: number;
  written: number;
  skipped: number;
  missing: Array<{ subject: string; teacherName: string | null }>;
  finalDone: boolean;
}
export interface SummaryWorkSection {
  sectionId: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  ready: number;
  waiting: number;
  done: number;
  students: SummaryWorkStudent[];
}
export interface SummaryWorkMeeting {
  meetingId: string;
  instanceLabel: string;
  meetingDateKey: string;
  summaryDueKey: string;
  sections: SummaryWorkSection[];
}

/** The class teacher's Today card: their sections' children in every open meeting. */
export async function mySummaryWork(actorId: string, now = new Date()): Promise<SummaryWorkMeeting[]> {
  const sectionsMine = (await Section.find({ classTeacherId: oid(actorId), active: true }).select("_id").lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  if (!sectionsMine.length) return [];
  const meetings = await openMeetings(now);
  if (!meetings.length) return [];
  const sections = await sectionInfo(sectionsMine.map((s) => str(s._id)));
  const out: SummaryWorkMeeting[] = [];
  for (const m of meetings) {
    const kids = await scopeStudents(m, { sectionId: { $in: sectionsMine.map((s) => s._id) } });
    if (!kids.length) continue;
    const ids = kids.map((k) => k._id);
    const [rows, summaries, finals] = await Promise.all([
      MeetingSubjectNote.find({ meetingId: m._id, studentId: { $in: ids } }).select("studentId subject teacherId writtenAt skippedAt").lean() as unknown as Promise<IMeetingSubjectNote[]>,
      MeetingComment.find({ meetingId: m._id, studentId: { $in: ids } }).select("studentId").lean() as unknown as Promise<Array<{ studentId: Types.ObjectId }>>,
      MeetingFinalComment.find({ meetingId: m._id, studentId: { $in: ids } }).select("studentId").lean() as unknown as Promise<Array<{ studentId: Types.ObjectId }>>,
    ]);
    const summarised = new Set(summaries.map((s) => str(s.studentId)));
    const finalised = new Set(finals.map((s) => str(s.studentId)));
    const names = await userNames(rows.filter((r) => !r.writtenAt && !r.skippedAt).map((r) => r.teacherId));
    const bySection = new Map<string, SummaryWorkStudent[]>();
    for (const k of kids) {
      const r = readinessOf(rows.filter((x) => str(x.studentId) === str(k._id)));
      const state: SummaryState = summarised.has(str(k._id)) ? "DONE" : r.ready ? "READY" : "WAITING";
      const entry: SummaryWorkStudent = {
        studentId: str(k._id),
        name: displayName(k),
        state,
        total: r.total,
        written: r.written,
        skipped: r.skipped,
        missing: r.missing.map((x) => ({ subject: x.subject, teacherName: names.get(x.teacherId) ?? null })),
        finalDone: finalised.has(str(k._id)),
      };
      (bySection.get(str(k.sectionId)) ?? bySection.set(str(k.sectionId), []).get(str(k.sectionId))!).push(entry);
    }
    const order: Record<SummaryState, number> = { READY: 0, WAITING: 1, DONE: 2 };
    const secs: SummaryWorkSection[] = [...bySection.entries()]
      .map(([sectionId, students]) => {
        const sec = sections.get(sectionId);
        students.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
        return {
          sectionId,
          classLevel: sec?.classLevel ?? null,
          classNameBn: sec?.classNameBn ?? "",
          sectionNameBn: sec?.sectionNameBn ?? "",
          ready: students.filter((s) => s.state === "READY").length,
          waiting: students.filter((s) => s.state === "WAITING").length,
          done: students.filter((s) => s.state === "DONE").length,
          students,
        };
      })
      .sort((a, b) => sectionOrder(sections.get(a.sectionId), sections.get(b.sectionId)));
    out.push({ meetingId: str(m._id), instanceLabel: m.instanceLabel, meetingDateKey: meetingDayKey(m), summaryDueKey: m.commentCollection!.summaryDueKey, sections: secs });
  }
  return out;
}

// ===========================================================================
// Admin — progress, reminders, final
// ===========================================================================

export interface ProgressSubject {
  subject: string;
  teacherNames: string[];
  total: number;
  written: number;
  skipped: number;
  skipReason: string | null;
}
export interface ProgressSection {
  sectionId: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  classTeacherName: string | null;
  students: number;
  notesTotal: number;
  notesWritten: number;
  notesSkipped: number;
  summaryDone: number;
  summaryReady: number;
  finalDone: number;
  subjects: ProgressSubject[];
}
export interface ProgressTeacher {
  teacherId: string;
  name: string;
  left: number;
  places: string[];
}
export interface CommentProgress {
  meetingId: string;
  instanceLabel: string;
  meetingDateKey: string;
  open: boolean;
  subjectDueKey: string | null;
  summaryDueKey: string | null;
  openedAt: string | null;
  rosterBuiltAt: string | null;
  fromKey: string;
  toKey: string;
  students: number;
  notesTotal: number;
  notesWritten: number;
  notesSkipped: number;
  summaryDone: number;
  summaryReady: number;
  summaryWaiting: number;
  finalDone: number;
  finalReady: number;
  sections: ProgressSection[];
  teachers: ProgressTeacher[];
}

const placeLabel = (sec: SectionInfo | undefined): string => {
  if (!sec) return "—";
  const suffix = sec.sectionNameBn && sec.sectionNameBn !== "মূল" && sec.sectionNameBn !== "সম্মিলিত" ? ` ${sec.sectionNameBn}` : "";
  return `${sec.classNameBn}${suffix}`;
};

export async function commentProgress(meetingId: string, now = new Date()): Promise<CommentProgress> {
  const meeting = await loadMeeting(meetingId);
  const window = await meetingWindow(meeting, now);
  const kids = await scopeStudents(meeting);
  const ids = kids.map((k) => k._id);
  const [rows, summaries, finals] = await Promise.all([
    MeetingSubjectNote.find({ meetingId: meeting._id }).select("studentId sectionId subject teacherId writtenAt skippedAt skipReason").lean() as unknown as Promise<IMeetingSubjectNote[]>,
    MeetingComment.find({ meetingId: meeting._id, studentId: { $in: ids } }).select("studentId").lean() as unknown as Promise<Array<{ studentId: Types.ObjectId }>>,
    MeetingFinalComment.find({ meetingId: meeting._id, studentId: { $in: ids } }).select("studentId").lean() as unknown as Promise<Array<{ studentId: Types.ObjectId }>>,
  ]);
  const sections = await sectionInfo([...kids.map((k) => str(k.sectionId)), ...rows.map((r) => str(r.sectionId))]);
  const names = await userNames([...rows.map((r) => r.teacherId), ...[...sections.values()].map((s) => s.classTeacherId)]);
  const summarised = new Set(summaries.map((s) => str(s.studentId)));
  const finalised = new Set(finals.map((s) => str(s.studentId)));
  const rowsByStudent = new Map<string, IMeetingSubjectNote[]>();
  for (const r of rows) (rowsByStudent.get(str(r.studentId)) ?? rowsByStudent.set(str(r.studentId), []).get(str(r.studentId))!).push(r);

  const secMap = new Map<string, ProgressSection>();
  const secOf = (sectionId: string): ProgressSection => {
    let s = secMap.get(sectionId);
    if (!s) {
      const info = sections.get(sectionId);
      s = {
        sectionId,
        classLevel: info?.classLevel ?? null,
        classNameBn: info?.classNameBn ?? "",
        sectionNameBn: info?.sectionNameBn ?? "",
        classTeacherName: info?.classTeacherId ? names.get(info.classTeacherId) ?? null : null,
        students: 0,
        notesTotal: 0,
        notesWritten: 0,
        notesSkipped: 0,
        summaryDone: 0,
        summaryReady: 0,
        finalDone: 0,
        subjects: [],
      };
      secMap.set(sectionId, s);
    }
    return s;
  };

  let summaryReady = 0;
  let finalReady = 0;
  for (const k of kids) {
    const s = secOf(str(k.sectionId));
    s.students += 1;
    const id = str(k._id);
    if (summarised.has(id)) {
      s.summaryDone += 1;
      if (!finalised.has(id)) finalReady += 1;
    } else if (readinessOf(rowsByStudent.get(id) ?? []).ready && meeting.commentCollection) {
      s.summaryReady += 1;
      summaryReady += 1;
    }
    if (finalised.has(id)) s.finalDone += 1;
  }

  const subjAcc = new Map<string, { teachers: Set<string>; total: number; written: number; skipped: number; reason: string | null }>();
  const teacherLeft = new Map<string, { left: number; places: Set<string> }>();
  for (const r of rows) {
    const sectionId = str(r.sectionId);
    const s = secOf(sectionId);
    const written = !!r.writtenAt;
    const skipped = !written && !!r.skippedAt;
    s.notesTotal += 1;
    if (written) s.notesWritten += 1;
    if (skipped) s.notesSkipped += 1;
    const key = `${sectionId}|${r.subject}`;
    const acc = subjAcc.get(key) ?? subjAcc.set(key, { teachers: new Set(), total: 0, written: 0, skipped: 0, reason: null }).get(key)!;
    acc.teachers.add(str(r.teacherId));
    acc.total += 1;
    if (written) acc.written += 1;
    if (skipped) {
      acc.skipped += 1;
      acc.reason = r.skipReason ?? acc.reason;
    }
    if (!written && !skipped) {
      const t = teacherLeft.get(str(r.teacherId)) ?? teacherLeft.set(str(r.teacherId), { left: 0, places: new Set() }).get(str(r.teacherId))!;
      t.left += 1;
      t.places.add(`${placeLabel(sections.get(sectionId))} · ${subjectBn(r.subject)}`);
    }
  }
  for (const [key, acc] of subjAcc) {
    const [sectionId, subject] = key.split("|");
    secOf(sectionId).subjects.push({
      subject,
      teacherNames: [...acc.teachers].map((t) => names.get(t) ?? "—"),
      total: acc.total,
      written: acc.written,
      skipped: acc.skipped,
      skipReason: acc.reason,
    });
  }
  const sectionsOut = [...secMap.values()].sort((a, b) => sectionOrder(sections.get(a.sectionId), sections.get(b.sectionId)));
  for (const s of sectionsOut) s.subjects.sort((a, b) => a.subject.localeCompare(b.subject));
  const sum = (f: (s: ProgressSection) => number) => sectionsOut.reduce((t, s) => t + f(s), 0);
  const c = meeting.commentCollection;
  const summaryDone = sum((s) => s.summaryDone);
  return {
    meetingId,
    instanceLabel: meeting.instanceLabel,
    meetingDateKey: meetingDayKey(meeting),
    open: !!c,
    subjectDueKey: c?.subjectDueKey ?? null,
    summaryDueKey: c?.summaryDueKey ?? null,
    openedAt: c ? new Date(c.openedAt).toISOString() : null,
    rosterBuiltAt: c ? new Date(c.rosterBuiltAt).toISOString() : null,
    fromKey: window.fromKey,
    toKey: window.toKey,
    students: kids.length,
    notesTotal: sum((s) => s.notesTotal),
    notesWritten: sum((s) => s.notesWritten),
    notesSkipped: sum((s) => s.notesSkipped),
    summaryDone,
    summaryReady,
    summaryWaiting: kids.length - summaryDone - summaryReady,
    finalDone: sum((s) => s.finalDone),
    finalReady,
    sections: sectionsOut,
    teachers: [...teacherLeft.entries()]
      .map(([teacherId, t]) => ({ teacherId, name: names.get(teacherId) ?? "—", left: t.left, places: [...t.places].sort() }))
      .sort((a, b) => b.left - a.left || a.name.localeCompare(b.name)),
  };
}

/** How many notes a teacher still owes in a meeting (not written, not skipped, not
 *  frozen behind a summary). */
async function notesLeft(meetingId: Types.ObjectId, teacherId: string): Promise<number> {
  const rows = (await MeetingSubjectNote.find({ meetingId, teacherId: oid(teacherId), writtenAt: null, skippedAt: null }).select("studentId").lean()) as unknown as Array<{ studentId: Types.ObjectId }>;
  if (!rows.length) return 0;
  const frozen = new Set(
    ((await MeetingComment.find({ meetingId, studentId: { $in: rows.map((r) => r.studentId) } }).select("studentId").lean()) as unknown as Array<{ studentId: Types.ObjectId }>).map((s) => str(s.studentId)),
  );
  return rows.filter((r) => !frozen.has(str(r.studentId))).length;
}

const fmtKeyBn = (key: string): string => {
  const [, m, d] = key.split("-").map(Number);
  const months = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
  return `${bnNum(d)} ${months[m - 1]}`;
};

/** One reminder row to a subject teacher. `tag` keeps the Office's manual reminder and
 *  the morning one apart, and both are one-per-day. */
export async function emitNoteReminder(meeting: IParentMeeting, teacherId: string, left: number, dayKey: string, tag: "manual" | "auto"): Promise<boolean> {
  const res = await emit({
    recipientUserId: teacherId,
    kind: "MEETING_NOTE_REMINDER",
    titleBn: `অভিভাবক সভার মন্তব্য বাকি: ${bnNum(left)} জন`,
    bodyBn: `${meeting.instanceLabel} সভার (${fmtKeyBn(meetingDayKey(meeting))}) জন্য শিক্ষার্থীদের মন্তব্য লিখুন — শেষ তারিখ ${fmtKeyBn(meeting.commentCollection!.subjectDueKey)}। "আজ" পাতায় তালিকা আছে।`,
    refs: { parentMeetingId: str(meeting._id), date: dayKey },
    dedupeKey: `MNR:${str(meeting._id)}:${teacherId}:${dayKey}:${tag}`,
  });
  return res.created;
}

export async function remindTeacher(meetingId: string, teacherId: string, actorId: string, now = new Date()): Promise<boolean> {
  const meeting = await loadMeeting(meetingId);
  requireOpen(meeting);
  if (!Types.ObjectId.isValid(teacherId)) throw new MeetingChainError("ভুল শিক্ষক আইডি");
  const left = await notesLeft(meeting._id, teacherId);
  if (!left) throw new MeetingChainError("এই শিক্ষকের কোনো মন্তব্য বাকি নেই।");
  const created = await emitNoteReminder(meeting, teacherId, left, dhakaDayKey(now), "manual");
  if (created) {
    await writeAudit({ eventKind: "MEETING_NOTE_REMINDER_SENT", actorId, targetId: meeting._id, targetKind: "ParentMeeting", meta: { teacherId, left } });
  }
  return created;
}

export interface FinalQueueRow {
  studentId: string;
  name: string;
  classLevel: number | null;
  classNameBn: string;
  sectionNameBn: string;
  state: SummaryState;
  finalSource: MeetingFinalSource | null;
  slotTime: number | null;
  slotOrder: number | null;
}

/** Office/Principal's list: WAITING (no summary yet) / READY (summary in, no final) /
 *  DONE (final written), in slot order. `state` here is about the FINAL. */
export async function finalQueue(meetingId: string): Promise<FinalQueueRow[]> {
  const meeting = await loadMeeting(meetingId);
  const kids = await scopeStudents(meeting);
  const ids = kids.map((k) => k._id);
  const [summaries, finals, slots, sections] = await Promise.all([
    MeetingComment.find({ meetingId: meeting._id, studentId: { $in: ids } }).select("studentId").lean() as unknown as Promise<Array<{ studentId: Types.ObjectId }>>,
    MeetingFinalComment.find({ meetingId: meeting._id, studentId: { $in: ids } }).select("studentId source").lean() as unknown as Promise<Array<{ studentId: Types.ObjectId; source: MeetingFinalSource }>>,
    ParentMeetingSlot.find({ meetingId: meeting._id }).select("studentIds slotTime order").lean() as unknown as Promise<Array<{ studentIds: Types.ObjectId[]; slotTime?: number | null; order: number }>>,
    sectionInfo(kids.map((k) => str(k.sectionId))),
  ]);
  const summarised = new Set(summaries.map((s) => str(s.studentId)));
  const finalOf = new Map(finals.map((f) => [str(f.studentId), f.source]));
  const slotOf = new Map<string, { slotTime: number | null; order: number }>();
  for (const s of slots) for (const id of s.studentIds) slotOf.set(str(id), { slotTime: s.slotTime ?? null, order: s.order });
  return kids
    .map((k) => {
      const id = str(k._id);
      const sec = sections.get(str(k.sectionId));
      const source = finalOf.get(id) ?? null;
      return {
        studentId: id,
        name: displayName(k),
        classLevel: sec?.classLevel ?? null,
        classNameBn: sec?.classNameBn ?? "",
        sectionNameBn: sec?.sectionNameBn ?? "",
        state: (source ? "DONE" : summarised.has(id) ? "READY" : "WAITING") as SummaryState,
        finalSource: source,
        slotTime: slotOf.get(id)?.slotTime ?? null,
        slotOrder: slotOf.get(id)?.order ?? null,
      };
    })
    .sort((a, b) => (a.slotOrder ?? 1e9) - (b.slotOrder ?? 1e9) || (a.classLevel ?? 99) - (b.classLevel ?? 99) || a.name.localeCompare(b.name));
}

export async function saveFinalComment(input: {
  meetingId: string;
  studentId: string;
  source: string;
  strengths?: string | null;
  concerns?: string | null;
  actorId: string;
}): Promise<{ source: MeetingFinalSource; strengths: string; concerns: string }> {
  const meeting = await loadMeeting(input.meetingId);
  if (meeting.status === "closed") throw new MeetingChainError("এই সভা শেষ হয়ে গেছে।");
  if (!(MEETING_FINAL_SOURCES as readonly string[]).includes(input.source)) throw new MeetingChainError("ভুল ধরন");
  const source = input.source as MeetingFinalSource;
  if (!Types.ObjectId.isValid(input.studentId)) throw new MeetingChainError("ভুল শিক্ষার্থী আইডি");
  const inScope = await Student.exists({ ...meetingScopeFilter(meeting), _id: oid(input.studentId) });
  if (!inScope) throw new MeetingChainError("এই শিক্ষার্থী এই সভার তালিকায় নেই।");
  const summary = (await MeetingComment.findOne({ meetingId: meeting._id, studentId: oid(input.studentId) }).lean()) as { positiveText?: string; concernText?: string } | null;
  if (!summary) throw new MeetingChainError("শ্রেণি শিক্ষকের সারাংশ এখনো আসেনি।");
  const boxes = source === "AS_IS" ? cleanBoxes(summary.positiveText, summary.concernText) : cleanBoxes(input.strengths, input.concerns);
  const prior = await MeetingFinalComment.findOne({ meetingId: meeting._id, studentId: oid(input.studentId) }).select("_id source").lean();
  const doc = await MeetingFinalComment.findOneAndUpdate(
    { meetingId: meeting._id, studentId: oid(input.studentId) },
    { $set: { source, ...boxes, authorUserId: oid(input.actorId) } },
    { upsert: true, new: true },
  );
  await writeAudit({
    eventKind: "MEETING_FINAL_COMMENT_SAVED",
    actorId: input.actorId,
    targetId: doc?._id,
    targetKind: "MeetingFinalComment",
    meta: { meetingId: input.meetingId, studentId: input.studentId, source, edit: !!prior },
  });
  return { source, ...boxes };
}

/** Brief/summary read gate: roster:manage, or the class teacher of the child's section. */
export async function assertBriefRead(actor: { userId: string; isAdmin: boolean }, studentId: string): Promise<void> {
  if (actor.isAdmin) return;
  if (!Types.ObjectId.isValid(studentId)) throw new MeetingChainError("ভুল শিক্ষার্থী আইডি");
  const student = (await Student.findById(studentId).select("sectionId").lean()) as { sectionId: Types.ObjectId } | null;
  if (!student) throw new MeetingChainError("শিক্ষার্থী পাওয়া যায়নি");
  const section = (await Section.findById(student.sectionId).select("classTeacherId").lean()) as { classTeacherId?: Types.ObjectId } | null;
  if (str(section?.classTeacherId) !== actor.userId) throw new MeetingChainError("শুধু অফিস, প্রধান শিক্ষক বা এই শাখার শ্রেণি শিক্ষক এটি দেখতে পারেন।");
}

// ===========================================================================
// Morning reminders (D-#756) — run by the scheduler on school days
// ===========================================================================

/** 08:00 local. */
export const MEETING_REMINDER_MINUTES = 8 * 60;
/** Reminders start this many days before each due date. */
export const MEETING_REMINDER_LEAD_DAYS = 3;

/** PURE: is `today` inside [due − lead, meeting day]? (Overdue keeps reminding until the meeting.) */
export function reminderWindowOpen(todayKey: string, dueKey: string, meetingKey: string): boolean {
  return todayKey >= addDaysKey(dueKey, -MEETING_REMINDER_LEAD_DAYS) && todayKey <= meetingKey;
}

export async function emitMorningReminders(now = new Date()): Promise<{ notes: number; summaries: number }> {
  const today = dhakaDayKey(now);
  const meetings = await openMeetings(now);
  let notes = 0;
  let summaries = 0;
  for (const m of meetings) {
    const c = m.commentCollection!;
    const meetingKey = meetingDayKey(m);
    if (reminderWindowOpen(today, c.subjectDueKey, meetingKey)) {
      const teacherIds = (await MeetingSubjectNote.distinct("teacherId", { meetingId: m._id, writtenAt: null, skippedAt: null })) as Types.ObjectId[];
      for (const t of teacherIds) {
        const left = await notesLeft(m._id, str(t));
        if (left && (await emitNoteReminder(m, str(t), left, today, "auto"))) notes += 1;
      }
    }
    if (reminderWindowOpen(today, c.summaryDueKey, meetingKey)) {
      const cts = (await Section.find({ active: true, classTeacherId: { $ne: null } }).select("classTeacherId").lean()) as unknown as Array<{ classTeacherId: Types.ObjectId }>;
      for (const ctId of new Set(cts.map((s) => str(s.classTeacherId)))) {
        const work = (await mySummaryWork(ctId, now)).find((w) => w.meetingId === str(m._id));
        const ready = work?.sections.reduce((t, s) => t + s.ready, 0) ?? 0;
        if (!ready) continue;
        const res = await emit({
          recipientUserId: ctId,
          kind: "MEETING_SUMMARY_REMINDER",
          titleBn: `সারাংশ লেখার জন্য প্রস্তুত: ${bnNum(ready)} জন`,
          bodyBn: `${m.instanceLabel} সভার জন্য সব বিষয় শিক্ষকের মন্তব্য এসেছে — শ্রেণি শিক্ষকের সারাংশ লিখুন। শেষ তারিখ ${fmtKeyBn(c.summaryDueKey)}।`,
          refs: { parentMeetingId: str(m._id), date: today },
          dedupeKey: `MSR:${str(m._id)}:${ctId}:${today}`,
        });
        if (res.created) summaries += 1;
      }
    }
  }
  return { notes, summaries };
}
