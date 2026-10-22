/**
 * Lesson-plan progress LP-1 (docs/prd-lesson-progress.md §2, D-#820–#822).
 *
 *  - `sessionPlansFor` — a class level × subject's current session plans in book order (the plan).
 *  - `lessonPlanForSlot` — what the class-note card shows: the plan with this শাখা's state per
 *    session, the suggested next session, and this note's own marks.
 *  - `recordDelivery` — upsert the note's `LessonDelivery` (validated against the plan, roster
 *    snapshotted). Called from the publish / update resolvers AFTER the note itself is written.
 *
 * The answer is required by the app (D-#821) but NOT by the server: an older app build publishes
 * without it, and that note simply has no delivery row (LP-2 counts it as unanswered).
 */
import { Types } from "mongoose";
import type { LessonNoneReason } from "@scd/shared";
import { LESSON_NONE_REASONS } from "@scd/shared";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { Class } from "../../foundation/models/Class";
import { Student } from "../../foundation/models/Student";
import { ClassNote, type IClassNote } from "../../routine/models/ClassNote";
import { RoutineSlot, type IRoutineSlot } from "../../routine/models/RoutineSlot";
import { dateKeyOf } from "../../attendance/dates";
import { resolveUnitsForIds } from "../../attendance/attendanceUnit";
import { LessonDelivery, type ILessonDelivery } from "../models/LessonDelivery";

export class LessonProgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LessonProgressError";
  }
}

export interface PlanSession {
  /** Stable key `<chapter>:<sessionIndex>` (D-#820). */
  key: string;
  chapter: string;
  anchorWord: string;
  chapterTitle: string | null;
  sessionIndex: number;
  sessionOf: number;
  titleBn: string;
  artifactId: string;
}

export const sessionKey = (chapter: string, sessionIndex: number): string => `${chapter}:${sessionIndex}`;

/** Book order: numeric chapters first by number, then anything non-numeric by text. */
function chapterOrder(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const fa = Number.isFinite(na);
  const fb = Number.isFinite(nb);
  if (fa && fb) return na - nb;
  if (fa !== fb) return fa ? -1 : 1;
  return a.localeCompare(b);
}

interface PlanRow {
  _id: Types.ObjectId;
  address?: { anchorWord?: string; number?: unknown; title?: string };
  importedAt?: Date;
  envelopeJson?: { payload?: { session_plan?: { period_index?: number; period_of?: number; session_title?: string } } };
}

/** The current session plans of one class level × subject, in book order (chapter, session). */
export async function sessionPlansFor(classLevel: number, subject: string): Promise<PlanSession[]> {
  const rows = (await ContentArtifact.find({
    docType: "session_plan",
    classLevel,
    subject,
    current: true,
    retiredAt: null,
  })
    .select({
      address: 1,
      importedAt: 1,
      "envelopeJson.payload.session_plan.period_index": 1,
      "envelopeJson.payload.session_plan.period_of": 1,
      "envelopeJson.payload.session_plan.session_title": 1,
    })
    .lean()) as unknown as PlanRow[];

  // Two current versions of one session should not exist; if they do, the newest import wins.
  const byKey = new Map<string, PlanSession & { importedAt: number }>();
  for (const r of rows) {
    const chapter = String(r.address?.number ?? "").trim();
    if (!chapter) continue;
    const sp = r.envelopeJson?.payload?.session_plan ?? {};
    const sessionIndex = Number.isInteger(sp.period_index) && (sp.period_index as number) >= 1 ? (sp.period_index as number) : 1;
    const sessionOf = Number.isInteger(sp.period_of) && (sp.period_of as number) >= sessionIndex ? (sp.period_of as number) : sessionIndex;
    const key = sessionKey(chapter, sessionIndex);
    const importedAt = r.importedAt ? new Date(r.importedAt).getTime() : 0;
    const prev = byKey.get(key);
    if (prev && prev.importedAt >= importedAt) continue;
    const chapterTitle = r.address?.title?.trim() || null;
    byKey.set(key, {
      key,
      chapter,
      anchorWord: r.address?.anchorWord ?? "",
      chapterTitle,
      sessionIndex,
      sessionOf,
      titleBn: sp.session_title?.trim() || chapterTitle || `${chapter}`,
      artifactId: String(r._id),
      importedAt,
    });
  }
  return [...byKey.values()]
    .sort((a, b) => chapterOrder(a.chapter, b.chapter) || a.sessionIndex - b.sessionIndex)
    .map(({ importedAt: _i, ...s }) => s);
}

export interface SessionState {
  /** Date keys the session was marked finished in this শাখা (normally one). */
  finishedOn: string[];
  /** Date keys it was marked started-not-finished. */
  startedOn: string[];
}

/** Per stable key: when this শাখা worked on each session (all class notes, optionally minus one). */
export async function sectionSessionStates(
  sectionId: Types.ObjectId | string,
  subject: string,
  excludeNoteId?: string,
): Promise<Map<string, SessionState>> {
  const rows = (await LessonDelivery.find({
    sectionId: new Types.ObjectId(String(sectionId)),
    subject,
    ...(excludeNoteId ? { noteId: { $ne: new Types.ObjectId(excludeNoteId) } } : {}),
  })
    .select("dateKey sessions")
    .sort({ dateKey: 1 })
    .lean()) as unknown as Array<Pick<ILessonDelivery, "dateKey" | "sessions">>;
  const out = new Map<string, SessionState>();
  for (const d of rows) {
    for (const s of d.sessions) {
      const k = sessionKey(s.chapter, s.sessionIndex);
      const st = out.get(k) ?? { finishedOn: [], startedOn: [] };
      (s.finished ? st.finishedOn : st.startedOn).push(d.dateKey);
      out.set(k, st);
    }
  }
  return out;
}

/** The suggested session: one already started and not finished, else the first unfinished in book order. */
export function nextSessionKey(plan: PlanSession[], states: Map<string, SessionState>): string | null {
  const unfinished = plan.filter((p) => (states.get(p.key)?.finishedOn.length ?? 0) === 0);
  const started = unfinished.find((p) => (states.get(p.key)?.startedOn.length ?? 0) > 0);
  return (started ?? unfinished[0])?.key ?? null;
}

async function classLevelOf(slot: Pick<IRoutineSlot, "groupType" | "classId">): Promise<number | null> {
  if (slot.groupType !== "section" || !slot.classId) return null;
  const cls = await Class.findById(slot.classId).select("level").lean();
  return typeof cls?.level === "number" ? cls.level : null;
}

export interface LessonPlanSessionView extends PlanSession {
  finishedOn: string[];
  startedOn: string[];
}

export interface LessonDeliveryView {
  noteId: string;
  dateKey: string;
  sessions: Array<{ key: string; chapter: string; anchorWord: string; sessionIndex: number; sessionOf: number; titleBn: string; finished: boolean }>;
  noneReason: LessonNoneReason | null;
  noneNote: string | null;
}

export interface LessonPlanForSlot {
  /** False = this period has no lesson plan to answer to (no block, no answer needed). */
  applies: boolean;
  sessions: LessonPlanSessionView[];
  suggestedKey: string | null;
  /** This slot × date's own marks, when the note already has them. */
  delivery: LessonDeliveryView | null;
}

export function deliveryView(d: Pick<ILessonDelivery, "noteId" | "dateKey" | "sessions" | "noneReason" | "noneNote">): LessonDeliveryView {
  return {
    noteId: String(d.noteId),
    dateKey: d.dateKey,
    sessions: d.sessions.map((s) => ({
      key: sessionKey(s.chapter, s.sessionIndex),
      chapter: s.chapter,
      anchorWord: s.anchorWord ?? "",
      sessionIndex: s.sessionIndex,
      sessionOf: s.sessionOf,
      titleBn: s.titleBn,
      finished: s.finished,
    })),
    noneReason: d.noneReason ?? null,
    noneNote: d.noneNote ?? null,
  };
}

/**
 * The card's read. The caller's right to this slot is checked by the resolver (the same
 * slot-teacher / cover / edit_all rule as publishing the note).
 */
export async function lessonPlanForSlot(slot: IRoutineSlot, date: Date): Promise<LessonPlanForSlot> {
  const none: LessonPlanForSlot = { applies: false, sessions: [], suggestedKey: null, delivery: null };
  const level = await classLevelOf(slot);
  if (level == null) return none;
  const plan = await sessionPlansFor(level, slot.subject);
  if (plan.length === 0) return none;

  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000 - 1);
  const note = (await ClassNote.findOne({ slotId: slot._id, date: { $gte: dayStart, $lte: dayEnd } })
    .select("_id")
    .lean()) as unknown as { _id: Types.ObjectId } | null;
  const own = note
    ? ((await LessonDelivery.findOne({ noteId: note._id }).lean()) as unknown as ILessonDelivery | null)
    : null;
  // The suggestion is computed WITHOUT this note's own marks, so re-opening a card suggests
  // what it suggested the first time instead of the session after it.
  const states = await sectionSessionStates(slot.groupId, slot.subject, note ? String(note._id) : undefined);
  return {
    applies: true,
    sessions: plan.map((p) => ({
      ...p,
      finishedOn: states.get(p.key)?.finishedOn ?? [],
      startedOn: states.get(p.key)?.startedOn ?? [],
    })),
    suggestedKey: nextSessionKey(plan, states),
    delivery: own ? deliveryView(own) : null,
  };
}

export interface LessonPlanInput {
  sessions?: Array<{ key: string; finished: boolean }> | null;
  noneReason?: string | null;
  noneNote?: string | null;
}

interface PreparedDelivery {
  level: number;
  sessions: Array<Omit<ILessonDelivery["sessions"][number], "artifactId"> & { artifactId: Types.ObjectId }>;
  noneReason?: LessonNoneReason;
  noneNote?: string;
}

/**
 * Validate an answer against the slot's plan. Null = the period has no lesson plan (the input is
 * then ignored, never an error — the plan may have been retired between opening and tapping).
 * Throws `LessonProgressError` on an unknown / duplicate session or a missing reason. The publish
 * resolver calls this BEFORE writing the note, so a bad answer never leaves a half-written period.
 */
export async function prepareDelivery(slotId: Types.ObjectId | string, input: LessonPlanInput): Promise<PreparedDelivery | null> {
  const slot = (await RoutineSlot.findById(slotId).select("groupType classId subject").lean()) as unknown as IRoutineSlot | null;
  if (!slot || slot.groupType !== "section") return null;
  const level = await classLevelOf(slot);
  if (level == null) return null;
  const plan = await sessionPlansFor(level, slot.subject);
  if (plan.length === 0) return null;

  const byKey = new Map(plan.map((p) => [p.key, p]));
  const picked = input.sessions ?? [];
  const seen = new Set<string>();
  const sessions = picked.map((s) => {
    const p = byKey.get(s.key);
    if (!p) throw new LessonProgressError("এই সেশনটি এই শ্রেণি-বিষয়ের পাঠ পরিকল্পনায় নেই।");
    if (seen.has(s.key)) throw new LessonProgressError("একই সেশন দুবার বাছাই করা হয়েছে।");
    seen.add(s.key);
    return {
      chapter: p.chapter,
      anchorWord: p.anchorWord,
      sessionIndex: p.sessionIndex,
      sessionOf: p.sessionOf,
      artifactId: new Types.ObjectId(p.artifactId),
      titleBn: p.titleBn,
      finished: !!s.finished,
    };
  });

  let noneReason: LessonNoneReason | undefined;
  if (sessions.length === 0) {
    const r = input.noneReason ?? "";
    if (!(LESSON_NONE_REASONS as readonly string[]).includes(r)) {
      throw new LessonProgressError("কোন সেশন পড়ালেন বাছাই করুন, অথবা কেন পরিকল্পনার সেশন হয়নি তা বলুন।");
    }
    noneReason = r as LessonNoneReason;
  }
  const noneNote = sessions.length === 0 ? input.noneNote?.trim() || undefined : undefined;
  return { level, sessions, noneReason, noneNote };
}

/** Write (or re-write) the delivery for a just-published / just-edited note; null = no plan applies. */
export async function recordDelivery(
  note: Pick<IClassNote, "_id" | "slotId" | "groupType" | "groupId" | "date" | "subject" | "publishedBy">,
  input: LessonPlanInput,
  actorId: string,
): Promise<ILessonDelivery | null> {
  if (note.groupType !== "section") return null;
  const prepared = await prepareDelivery(note.slotId, input);
  if (!prepared) return null;
  const { level, sessions, noneReason, noneNote } = prepared;

  const roster =(await Student.find({ sectionId: note.groupId, active: true }).select("_id").lean()) as unknown as Array<{
    _id: Types.ObjectId;
  }>;
  const set: Record<string, unknown> = {
    slotId: note.slotId,
    sectionId: note.groupId,
    classLevel: level,
    subject: note.subject,
    dateKey: dateKeyOf(new Date(note.date)),
    teacherId: note.publishedBy,
    sessions,
    rosterStudentIds: roster.map((s) => s._id),
    attendanceUnits: [...new Set([...(await resolveUnitsForIds(roster.map((s) => String(s._id)))).values()].map((u) => `${u.unitType}:${u.unitId}`))],
    updatedBy: new Types.ObjectId(actorId),
  };
  // A correction can flip sessions ⇄ reason, so the side not given is cleared.
  const unset: Record<string, 1> = {};
  if (noneReason) set.noneReason = noneReason;
  else unset.noneReason = 1;
  if (noneNote) set.noneNote = noneNote;
  else unset.noneNote = 1;
  await LessonDelivery.updateOne({ noteId: note._id }, { $set: set, $unset: unset }, { upsert: true });
  return (await LessonDelivery.findOne({ noteId: note._id }).lean()) as unknown as ILessonDelivery;
}

/** The note was deleted — its delivery goes with it. */
export async function deleteDeliveryForNote(noteId: string | Types.ObjectId): Promise<void> {
  await LessonDelivery.deleteOne({ noteId: new Types.ObjectId(String(noteId)) });
}

/** Deliveries for several notes at once (the published card shows its marks). */
export async function deliveriesForNotes(noteIds: Array<string | Types.ObjectId>): Promise<Map<string, ILessonDelivery>> {
  if (noteIds.length === 0) return new Map();
  const rows = (await LessonDelivery.find({ noteId: { $in: noteIds.map((id) => new Types.ObjectId(String(id))) } }).lean()) as unknown as ILessonDelivery[];
  return new Map(rows.map((r) => [String(r.noteId), r]));
}
