/**
 * Lesson-plan progress LP-2 (docs/prd-lesson-progress.md §3, D-#824/#826) — read-only views built
 * from the `LessonDelivery` rows LP-1 writes.
 *
 *  - `sectionTracker` — one শাখা × subject in book order: finished / started / skipped / not yet.
 *  - `progressRows` — one summary row per শাখা × subject (the Office overview, a teacher's list):
 *    finished of total, pace over the last 4 weeks, projected finish, lag behind the parallel
 *    শাখা of the same class level, notes published without an answer since marking began.
 *
 * Shows; never acts (D-#824 — corrective action is an owner decision for later).
 */
import { Types } from "mongoose";
import { callerHasPermission, LESSON_NONE_REASONS, type AccessProfile, type LessonNoneReason } from "@scd/shared";
import { AcademicYear } from "../../foundation/models/AcademicYear";
import { Class } from "../../foundation/models/Class";
import { Section } from "../../foundation/models/Section";
import { User } from "../../foundation/models/User";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { ClassNote } from "../../routine/models/ClassNote";
import { RoutineSlot } from "../../routine/models/RoutineSlot";
import { liveWindow } from "../../routine/liveWindow";
import { teachesSectionSubject } from "../../trackers/subjectTeacher";
import { dateKeyOf, parseDateKey } from "../../attendance/dates";
import { LessonDelivery, type ILessonDelivery } from "../models/LessonDelivery";
import { LessonProgressError, sessionKey, sessionPlansFor, type PlanSession } from "./LessonDeliveryService";
import { absencesByNote } from "../presence";
import { catchupsFor, openCatchupCounts } from "./LessonCatchupService";

export type Auth = AccessProfile & { userId: string; role: string };

export type SessionStatus = "FINISHED" | "STARTED" | "SKIPPED" | "NOT_YET";

export interface TrackerSession extends PlanSession {
  status: SessionStatus;
  finishedOn: string[];
  startedOn: string[];
  teacherNames: string[];
  /** LP-4 (D-#827): roster students absent on at least one day this session was taught. */
  absentCount: number;
  /** False when some teaching day had no attendance taken (the count is then a floor). */
  attendanceComplete: boolean;
}

export interface ProgressSummary {
  total: number;
  finished: number;
  pct: number;
  /** Sessions first finished in the last 28 days. */
  finishedLast4Weeks: number;
  /** finishedLast4Weeks ÷ 4, one decimal. */
  pacePerWeek: number;
  /** today + remaining ÷ pace; null when nothing was finished in 4 weeks (or nothing remains). */
  projectedFinishKey: string | null;
  lastFinishedKey: string | null;
  daysSinceLastFinished: number | null;
  skipped: number;
  reasons: Record<LessonNoneReason, number>;
  /** Notes of this শাখা × subject since its first mark, with no answer (older app build, or skipped). */
  unansweredNotes: number;
}

export interface ProgressRow extends ProgressSummary {
  sectionId: string;
  classLevel: number;
  classNameBn: string;
  sectionNameBn: string;
  subject: string;
  /** Sessions behind the furthest parallel শাখা of the same class level × subject (0 = leading / alone). */
  lagSessions: number;
  /** LP-4 (D-#827): catch-up tasks raised on this শাখা × subject that are not done yet. */
  openCatchups: number;
}

export interface CatchupView {
  id: string;
  taskId: string;
  titleBn: string;
  assigneeName: string;
  dueKey: string;
  /** TODO | DOING | DONE | CANCELLED */
  status: string;
  blockedReason: string | null;
  createdAt: string;
  snapshot: { finished: number; total: number; lagSessions: number; skipped: number };
}

export interface SectionTracker {
  row: ProgressRow;
  sessions: TrackerSession[];
  catchups: CatchupView[];
}

const DAY = 24 * 3600 * 1000;

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) / DAY);
}

function addDays(key: string, days: number): string {
  return dateKeyOf(new Date(parseDateKey(key).getTime() + days * DAY));
}

type DeliveryLite = Pick<ILessonDelivery, "noteId" | "dateKey" | "sessions" | "noneReason" | "teacherId">;

/** Per-session state from one শাখা × subject's deliveries (date order). Pure. */
export function sessionStates(
  plan: PlanSession[],
  deliveries: DeliveryLite[],
): Array<{ key: string; status: SessionStatus; finishedOn: string[]; startedOn: string[]; teacherIds: string[] }> {
  const by = new Map<string, { finishedOn: string[]; startedOn: string[]; teacherIds: Set<string> }>();
  for (const d of [...deliveries].sort((a, b) => a.dateKey.localeCompare(b.dateKey))) {
    for (const s of d.sessions) {
      const k = sessionKey(s.chapter, s.sessionIndex);
      const st = by.get(k) ?? { finishedOn: [], startedOn: [], teacherIds: new Set<string>() };
      (s.finished ? st.finishedOn : st.startedOn).push(d.dateKey);
      st.teacherIds.add(String(d.teacherId));
      by.set(k, st);
    }
  }
  // The furthest finished session in book order: anything unfinished before it was skipped.
  let lastFinishedIdx = -1;
  plan.forEach((p, i) => {
    if ((by.get(p.key)?.finishedOn.length ?? 0) > 0) lastFinishedIdx = i;
  });
  return plan.map((p, i) => {
    const st = by.get(p.key);
    const finished = (st?.finishedOn.length ?? 0) > 0;
    const started = (st?.startedOn.length ?? 0) > 0;
    const status: SessionStatus = finished ? "FINISHED" : i < lastFinishedIdx ? "SKIPPED" : started ? "STARTED" : "NOT_YET";
    return { key: p.key, status, finishedOn: st?.finishedOn ?? [], startedOn: st?.startedOn ?? [], teacherIds: [...(st?.teacherIds ?? [])] };
  });
}

/** The summary numbers for one শাখা × subject. Pure. */
export function summarize(
  plan: PlanSession[],
  deliveries: DeliveryLite[],
  noteIdsSinceFirstMark: string[],
  todayKey: string,
): ProgressSummary {
  const states = sessionStates(plan, deliveries);
  const finished = states.filter((s) => s.status === "FINISHED");
  const firstFinish = finished.map((s) => [...s.finishedOn].sort()[0]);
  const windowStart = addDays(todayKey, -27);
  const finishedLast4Weeks = firstFinish.filter((k) => k >= windowStart && k <= todayKey).length;
  const pacePerWeek = Math.round((finishedLast4Weeks / 4) * 10) / 10;
  const remaining = plan.length - finished.length;
  const projectedFinishKey =
    remaining > 0 && finishedLast4Weeks > 0 ? addDays(todayKey, Math.ceil((remaining / finishedLast4Weeks) * 28)) : null;
  const allFinishDates = finished.flatMap((s) => s.finishedOn).sort();
  const lastFinishedKey = allFinishDates.length ? allFinishDates[allFinishDates.length - 1] : null;
  const reasons = Object.fromEntries(LESSON_NONE_REASONS.map((r) => [r, 0])) as Record<LessonNoneReason, number>;
  for (const d of deliveries) if (d.sessions.length === 0 && d.noneReason) reasons[d.noneReason] += 1;
  const answered = new Set(deliveries.map((d) => String(d.noteId)));
  return {
    total: plan.length,
    finished: finished.length,
    pct: plan.length ? Math.round((finished.length / plan.length) * 100) : 0,
    finishedLast4Weeks,
    pacePerWeek,
    projectedFinishKey,
    lastFinishedKey,
    daysSinceLastFinished: lastFinishedKey ? daysBetween(lastFinishedKey, todayKey) : null,
    skipped: states.filter((s) => s.status === "SKIPPED").length,
    reasons,
    unansweredNotes: noteIdsSinceFirstMark.filter((id) => !answered.has(id)).length,
  };
}

interface Pair {
  sectionId: string;
  subject: string;
}

interface SectionInfo {
  sectionId: string;
  classLevel: number;
  classNameBn: string;
  sectionNameBn: string;
}

/** Active sections of the current academic year at class levels 1–5 (where session plans exist). */
async function currentSections(): Promise<Map<string, SectionInfo>> {
  const year = await AcademicYear.findOne({ current: true }).select("_id").lean();
  if (!year) return new Map();
  const classes = (await Class.find({ academicYearId: year._id, active: { $ne: false }, level: { $gte: 1, $lte: 5 } })
    .select("level nameBn")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; level: number; nameBn: string }>;
  const byClass = new Map(classes.map((c) => [String(c._id), c]));
  const sections = (await Section.find({ classId: { $in: classes.map((c) => c._id) }, active: { $ne: false } })
    .select("classId nameBn")
    .lean()) as unknown as Array<{ _id: Types.ObjectId; classId: Types.ObjectId; nameBn: string }>;
  const out = new Map<string, SectionInfo>();
  for (const s of sections) {
    const c = byClass.get(String(s.classId));
    if (c) out.set(String(s._id), { sectionId: String(s._id), classLevel: c.level, classNameBn: c.nameBn, sectionNameBn: s.nameBn });
  }
  return out;
}

/** Which (class level, subject) pairs have session plans at all. */
async function planSubjectsByLevel(): Promise<Map<number, Set<string>>> {
  const rows = (await ContentArtifact.aggregate([
    { $match: { docType: "session_plan", current: true, retiredAt: null } },
    { $group: { _id: { c: "$classLevel", s: "$subject" } } },
  ])) as Array<{ _id: { c: number; s: string } }>;
  const out = new Map<number, Set<string>>();
  for (const r of rows) {
    const set = out.get(r._id.c) ?? new Set<string>();
    set.add(r._id.s);
    out.set(r._id.c, set);
  }
  return out;
}

/** Every শাখা × subject that has plans AND a live routine slot today (the school's real pairs). */
async function schoolPairs(sections: Map<string, SectionInfo>, today: Date): Promise<Pair[]> {
  const planSubjects = await planSubjectsByLevel();
  const slots = (await RoutineSlot.find({
    groupType: "section",
    groupId: { $in: [...sections.keys()].map((id) => new Types.ObjectId(id)) },
    active: true,
    isBreak: { $ne: true },
    ...liveWindow(today),
  })
    .select("groupId subject")
    .lean()) as unknown as Array<{ groupId: Types.ObjectId; subject: string }>;
  const seen = new Set<string>();
  const out: Pair[] = [];
  for (const s of slots) {
    const info = sections.get(String(s.groupId));
    if (!info || !planSubjects.get(info.classLevel)?.has(s.subject)) continue;
    const k = `${s.groupId}|${s.subject}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ sectionId: String(s.groupId), subject: s.subject });
  }
  return out;
}

/**
 * Summary rows for the given pairs, with the lag computed across EVERY parallel শাখা of the same
 * class level × subject (not only the requested ones — a teacher's own row still knows the leader).
 */
async function rowsFor(pairs: Pair[], sections: Map<string, SectionInfo>, allPairs: Pair[], todayKey: string): Promise<ProgressRow[]> {
  const needed = new Map<string, Pair>();
  const peerKey = (p: Pair) => `${sections.get(p.sectionId)?.classLevel}|${p.subject}`;
  const wantedPeers = new Set(pairs.map(peerKey));
  for (const p of allPairs) if (wantedPeers.has(peerKey(p))) needed.set(`${p.sectionId}|${p.subject}`, p);
  for (const p of pairs) needed.set(`${p.sectionId}|${p.subject}`, p);
  const list = [...needed.values()];
  if (list.length === 0) return [];

  const deliveries = (await LessonDelivery.find({
    $or: list.map((p) => ({ sectionId: new Types.ObjectId(p.sectionId), subject: p.subject })),
  })
    .select("noteId sectionId subject dateKey sessions noneReason teacherId")
    .lean()) as unknown as Array<DeliveryLite & { sectionId: Types.ObjectId; subject: string }>;
  const byPair = new Map<string, typeof deliveries>();
  for (const d of deliveries) {
    const k = `${d.sectionId}|${d.subject}`;
    byPair.set(k, [...(byPair.get(k) ?? []), d]);
  }

  // Notes since each pair's first mark (the unanswered count only starts when marking did).
  const firstMark = new Map<string, string>();
  for (const [k, ds] of byPair) firstMark.set(k, ds.map((d) => d.dateKey).sort()[0]);
  const notes = firstMark.size
    ? ((await ClassNote.find({
        $or: [...firstMark.entries()].map(([k, from]) => {
          const [sectionId, subject] = k.split("|");
          return { groupType: "section", groupId: new Types.ObjectId(sectionId), subject, date: { $gte: parseDateKey(from) } };
        }),
      })
        .select("_id groupId subject")
        .lean()) as unknown as Array<{ _id: Types.ObjectId; groupId: Types.ObjectId; subject: string }>)
    : [];
  const notesByPair = new Map<string, string[]>();
  for (const n of notes) {
    const k = `${n.groupId}|${n.subject}`;
    notesByPair.set(k, [...(notesByPair.get(k) ?? []), String(n._id)]);
  }

  const plans = new Map<string, PlanSession[]>();
  const rows: ProgressRow[] = [];
  for (const p of list) {
    const info = sections.get(p.sectionId);
    if (!info) continue;
    const planKey = `${info.classLevel}|${p.subject}`;
    if (!plans.has(planKey)) plans.set(planKey, await sessionPlansFor(info.classLevel, p.subject));
    const k = `${p.sectionId}|${p.subject}`;
    rows.push({
      ...info,
      subject: p.subject,
      lagSessions: 0,
      openCatchups: 0,
      ...summarize(plans.get(planKey)!, byPair.get(k) ?? [], notesByPair.get(k) ?? [], todayKey),
    });
  }
  const lead = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.classLevel}|${r.subject}`;
    lead.set(k, Math.max(lead.get(k) ?? 0, r.finished));
  }
  for (const r of rows) r.lagSessions = (lead.get(`${r.classLevel}|${r.subject}`) ?? 0) - r.finished;
  const open = await openCatchupCounts(rows.map((r) => ({ sectionId: r.sectionId, subject: r.subject })));
  for (const r of rows) r.openCatchups = open.get(`${r.sectionId}|${r.subject}`) ?? 0;
  const asked = new Set(pairs.map((p) => `${p.sectionId}|${p.subject}`));
  return rows
    .filter((r) => asked.has(`${r.sectionId}|${r.subject}`))
    .sort((a, b) => b.lagSessions - a.lagSessions || a.classLevel - b.classLevel || a.sectionNameBn.localeCompare(b.sectionNameBn) || a.subject.localeCompare(b.subject));
}

/** The Office overview (`lesson_progress:view_all`), optionally narrowed to a class level / subject. */
export async function progressOverview(filter: { classLevel?: number | null; subject?: string | null }, today = new Date()): Promise<ProgressRow[]> {
  const sections = await currentSections();
  const all = await schoolPairs(sections, today);
  const pairs = all.filter(
    (p) => (filter.classLevel == null || sections.get(p.sectionId)?.classLevel === filter.classLevel) && (!filter.subject || p.subject === filter.subject),
  );
  return rowsFor(pairs, sections, all, dateKeyOf(today));
}

/** A teacher's own rows: the শাখা × subjects the routine gives them, plus every plan subject of their class-teacher শাখা. */
export async function myProgressRows(auth: Auth, today = new Date()): Promise<ProgressRow[]> {
  const sections = await currentSections();
  const all = await schoolPairs(sections, today);
  const mine = (await RoutineSlot.find({ groupType: "section", teacherId: new Types.ObjectId(auth.userId), active: true,
    isBreak: { $ne: true }, ...liveWindow(today) })
    .select("groupId subject")
    .lean()) as unknown as Array<{ groupId: Types.ObjectId; subject: string }>;
  const ownKeys = new Set(mine.map((s) => `${s.groupId}|${s.subject}`));
  const ctSections = new Set(
    ((await Section.find({ classTeacherId: new Types.ObjectId(auth.userId), active: true }).select("_id").lean()) as unknown as Array<{ _id: Types.ObjectId }>).map((s) =>
      String(s._id),
    ),
  );
  const pairs = all.filter((p) => ownKeys.has(`${p.sectionId}|${p.subject}`) || ctSections.has(p.sectionId));
  return rowsFor(pairs, sections, all, dateKeyOf(today));
}

/** Row rule (D-#826): view_all, or the routine gives the caller this শাখা × subject, or they are its class teacher. */
export async function assertMayViewSection(auth: Auth, sectionId: string, subject: string): Promise<void> {
  if (callerHasPermission(auth, "lesson_progress:view_all")) return;
  if (await teachesSectionSubject(auth.userId, sectionId, subject)) return;
  const sec = await Section.findById(sectionId).select("classTeacherId").lean();
  if (sec?.classTeacherId && String(sec.classTeacherId) === auth.userId) return;
  throw new LessonProgressError("এই শাখা ও বিষয়ের অগ্রগতি দেখার অনুমতি আপনার নেই।");
}

/** One শাখা × subject in book order, with its summary row. */
export async function sectionTracker(sectionId: string, subject: string, auth: Auth, today = new Date()): Promise<SectionTracker> {
  if (!Types.ObjectId.isValid(sectionId)) throw new LessonProgressError("শাখা পাওয়া যায়নি।");
  await assertMayViewSection(auth, sectionId, subject);
  const sections = await currentSections();
  let info = sections.get(sectionId);
  if (!info) {
    // A section outside the current year (or deactivated) still reads its own history.
    const sec = await Section.findById(sectionId).select("classId nameBn").lean();
    const cls = sec ? await Class.findById(sec.classId).select("level nameBn").lean() : null;
    if (!sec || !cls) throw new LessonProgressError("শাখা পাওয়া যায়নি।");
    info = { sectionId, classLevel: cls.level as number, classNameBn: cls.nameBn as string, sectionNameBn: sec.nameBn as string };
    sections.set(sectionId, info);
  }
  const all = await schoolPairs(sections, today);
  const pair = { sectionId, subject };
  const [row] = await rowsFor([pair], sections, [...all, pair], dateKeyOf(today));
  const plan = await sessionPlansFor(info.classLevel, subject);
  const deliveries = (await LessonDelivery.find({ sectionId: new Types.ObjectId(sectionId), subject })
    .select("noteId dateKey sessions noneReason teacherId rosterStudentIds attendanceUnits")
    .lean()) as unknown as Array<DeliveryLite & { rosterStudentIds: Types.ObjectId[]; attendanceUnits?: string[] }>;
  const states = sessionStates(plan, deliveries);
  const absences = await absencesByNote(deliveries);
  const absentBySession = new Map<string, { ids: Set<string>; complete: boolean }>();
  for (const d of deliveries) {
    const a = absences.get(String(d.noteId));
    for (const s of d.sessions) {
      const k = sessionKey(s.chapter, s.sessionIndex);
      const cur = absentBySession.get(k) ?? { ids: new Set<string>(), complete: true };
      for (const id of a?.absent ?? []) cur.ids.add(id);
      cur.complete = cur.complete && (a?.recorded ?? false);
      absentBySession.set(k, cur);
    }
  }
  const teacherIds = [...new Set(states.flatMap((s) => s.teacherIds))];
  const names = new Map(
    ((await User.find({ _id: { $in: teacherIds.map((id) => new Types.ObjectId(id)) } }).select("name").lean()) as unknown as Array<{ _id: Types.ObjectId; name: string }>).map(
      (u) => [String(u._id), u.name],
    ),
  );
  return {
    row,
    sessions: plan.map((p, i) => ({
      ...p,
      status: states[i].status,
      finishedOn: states[i].finishedOn,
      startedOn: states[i].startedOn,
      teacherNames: states[i].teacherIds.map((id) => names.get(id) ?? ""),
      absentCount: absentBySession.get(p.key)?.ids.size ?? 0,
      attendanceComplete: absentBySession.get(p.key)?.complete ?? true,
    })),
    catchups: await catchupsFor(sectionId, subject),
  };
}
