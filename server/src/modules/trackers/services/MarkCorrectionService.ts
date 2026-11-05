/**
 * MarkCorrectionService (D-#892/#893, docs/prd-mark-submission-guard.md §4) — the same-day
 * mark correction, detected at the three seams every path runs through:
 *
 *   HomeworkService.transitionRecord        CHASE → SUBMITTED (pass, card tap, work claim)
 *   AssignmentService.transitionAssignmentRecord   the same, for assignments
 *   Homework/AssignmentRevertService        the chase itself undone (D-#338)
 *
 * THE RULE (owner, 2026-11-02): a child the teacher marked "not brought" today who is
 * marked "brought" the same day was ALWAYS brought — "there is no way" otherwise — so the
 * guardian's chase notice was wrong and the teacher made a mistake. Excluded on purpose:
 * system chases (the 17:30 homework sweep; its stamp carries no `by`), and a chase from an
 * earlier day flipped today (a genuine late submission).
 *
 * Best-effort like the emitters: a failure here is logged and NEVER blocks the teacher's
 * correction — the guardian getting the right state matters more than the note.
 *
 * D-#936/#937: each note is also one StaffMistake for the chaser. The reason the teacher
 * picked on the submit pass rides the request (correctionReasonContext): it decides the
 * entry's status and, for LATE_DIRECT, the guardian's message (D-#938). No reason → the
 * chaser is asked to explain by the next school day.
 */
import { Types } from "mongoose";
import type { HwSubject } from "@scd/shared";
import { dhakaDayKey, isSameDhakaDay } from "../../../lib/dhakaDay";
import { personName } from "../../../lib/personName";
import {
  MarkCorrectionNote,
  type IMarkCorrectionNote,
  type MarkCorrectionTracker,
  type MarkCorrectionVia,
} from "../models/MarkCorrectionNote";
import { HomeworkItem } from "../models/HomeworkItem";
import { AssignmentItem } from "../models/AssignmentItem";
import { Student } from "../../foundation/models/Student";
import { User } from "../../foundation/models/User";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import { emitMarkCorrection, emitWorkMarkCorrected } from "../../notifications/services/emitters";
import { currentCorrectionReason } from "../../staff-mistakes/services/correctionReasonContext";
import { recordMistakeFromSource } from "../../staff-mistakes/services/StaffMistakeService";

export interface StampLike {
  state: string;
  at: Date;
  by?: Types.ObjectId | null;
}

/**
 * The record's latest CHASE stamp when a PERSON made it on the same Dhaka day as `now`;
 * otherwise null. Call it on the stamps as they stood BEFORE the correction.
 */
export function sameDayPersonChase(stamps: readonly StampLike[], now: Date): StampLike | null {
  for (let i = stamps.length - 1; i >= 0; i--) {
    const s = stamps[i]!;
    if (s.state !== "CHASE") continue;
    return s.by && isSameDhakaDay(new Date(s.at), now) ? s : null;
  }
  return null;
}

export interface MarkCorrectionInput {
  tracker: MarkCorrectionTracker;
  recordId: Types.ObjectId | string;
  itemId: Types.ObjectId | string;
  studentId: Types.ObjectId | string;
  sectionId: Types.ObjectId | string;
  /** The CHASE stamp being corrected (from sameDayPersonChase). */
  chase: StampLike;
  /** Who corrected it (may differ from the chaser; the note is the chaser's). */
  correctedBy: string;
  at: Date;
  via: MarkCorrectionVia;
}

async function itemFacts(
  tracker: MarkCorrectionTracker,
  itemId: Types.ObjectId | string,
): Promise<{ code: string; subject: HwSubject } | null> {
  if (tracker === "HOMEWORK") {
    const it = await HomeworkItem.findById(itemId).select("hwId subject").lean();
    return it ? { code: it.hwId, subject: it.subject } : null;
  }
  const it = await AssignmentItem.findById(itemId).select("asId subject").lean();
  return it ? { code: it.asId, subject: it.subject } : null;
}

/**
 * Record one corrected child on the chaser's note for the day, then tell Office +
 * Principal (once per note) and the child's guardians (once per record per day).
 * Returns true when the child was newly added to a note.
 */
export async function recordMarkCorrection(ev: MarkCorrectionInput): Promise<boolean> {
  try {
    if (!ev.chase.by) return false;
    const facts = await itemFacts(ev.tracker, ev.itemId);
    if (!facts) return false;
    const dateKey = dhakaDayKey(ev.at);
    const key = {
      tracker: ev.tracker,
      itemId: new Types.ObjectId(ev.itemId.toString()),
      staffUserId: new Types.ObjectId(ev.chase.by.toString()),
      dateKey,
    };
    let note: IMarkCorrectionNote | null;
    try {
      note = await MarkCorrectionNote.findOneAndUpdate(
        key,
        {
          $setOnInsert: {
            ...key,
            itemCode: facts.code,
            sectionId: new Types.ObjectId(ev.sectionId.toString()),
            subject: facts.subject,
          },
        },
        { upsert: true, new: true },
      );
    } catch (err) {
      // Two corrections racing the upsert: the loser re-reads the winner's row.
      if ((err as { code?: number }).code !== 11000) throw err;
      note = await MarkCorrectionNote.findOne(key);
    }
    if (!note) return false;

    const recordId = new Types.ObjectId(ev.recordId.toString());
    const pushed = await MarkCorrectionNote.updateOne(
      { _id: note._id, "students.recordId": { $ne: recordId } },
      {
        $push: {
          students: {
            studentId: new Types.ObjectId(ev.studentId.toString()),
            recordId,
            chasedAt: new Date(ev.chase.at),
            correctedAt: ev.at,
            correctedBy: new Types.ObjectId(ev.correctedBy),
            via: ev.via,
          },
        },
      },
    );
    if (pushed.modifiedCount === 0) return false; // this child is already on the note

    const reason = currentCorrectionReason();
    await recordMistakeFromSource({
      kind: "MARK_CORRECTION",
      tier: 1,
      sourceId: note._id,
      staffUserId: key.staffUserId,
      correctedBy: ev.correctedBy,
      at: ev.at,
      reason,
    });
    await emitMarkCorrection({
      noteId: note._id,
      tracker: ev.tracker,
      teacherId: key.staffUserId,
      itemCode: facts.code,
      sectionId: ev.sectionId,
      subject: facts.subject,
      dateKey,
    });
    await emitWorkMarkCorrected({
      tracker: ev.tracker,
      recordId,
      itemId: ev.itemId,
      itemCode: facts.code,
      studentId: ev.studentId,
      sectionId: ev.sectionId,
      subject: facts.subject,
      at: ev.at,
      reasonCode: reason?.code ?? null,
    });
    return true;
  } catch (err) {
    console.error("[MarkCorrectionService] recording a same-day correction failed (never blocks it):", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reads — the staff file's "নম্বর জমায় ভুল" list
// ---------------------------------------------------------------------------

export interface MarkCorrectionStudentShape {
  studentId: string;
  studentName: string;
  chasedAt: Date;
  correctedAt: Date;
  correctedByName: string;
  via: MarkCorrectionVia;
}

export interface MarkCorrectionNoteShape {
  id: string;
  tracker: MarkCorrectionTracker;
  itemCode: string;
  subject: HwSubject;
  dateKey: string;
  sectionLabel: string;
  staffUserId: string;
  staffName: string;
  students: MarkCorrectionStudentShape[];
  createdAt: Date;
}

/** Newest first. `staffUserId` omitted = every staff member (the resolver gates that). */
export async function listMarkCorrectionNotes(opts: {
  staffUserId?: string | null;
  limit?: number;
}): Promise<MarkCorrectionNoteShape[]> {
  const filter = opts.staffUserId ? { staffUserId: new Types.ObjectId(opts.staffUserId) } : {};
  const notes = await MarkCorrectionNote.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 300))
    .lean();
  return hydrateNotes(notes);
}

/** The notes behind a list of staff mistakes (D-#936), keyed by note id. */
export async function markCorrectionNotesByIds(ids: readonly string[]): Promise<Map<string, MarkCorrectionNoteShape>> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return new Map();
  const notes = await MarkCorrectionNote.find({ _id: { $in: valid } }).lean();
  return new Map((await hydrateNotes(notes)).map((n) => [n.id, n]));
}

type LeanNote = Pick<
  IMarkCorrectionNote,
  "_id" | "staffUserId" | "tracker" | "itemCode" | "subject" | "dateKey" | "sectionId" | "students" | "createdAt"
>;

async function hydrateNotes(notes: LeanNote[]): Promise<MarkCorrectionNoteShape[]> {
  if (notes.length === 0) return [];

  const userIds = new Set<string>();
  const studentIds = new Set<string>();
  const sectionIds = new Set<string>();
  for (const n of notes) {
    userIds.add(String(n.staffUserId));
    sectionIds.add(String(n.sectionId));
    for (const s of n.students) {
      studentIds.add(String(s.studentId));
      userIds.add(String(s.correctedBy));
    }
  }
  const [users, students, sections] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } }).select("name nameBn").lean(),
    Student.find({ _id: { $in: [...studentIds] } }).select("name nameBn").lean(),
    Section.find({ _id: { $in: [...sectionIds] } }).select("nameBn classId").lean(),
  ]);
  const classes = await Class.find({ _id: { $in: sections.map((s) => s.classId) } }).select("nameBn").lean();
  const userName = new Map(users.map((u) => [String(u._id), personName(u)]));
  const studentName = new Map(students.map((s) => [String(s._id), personName(s)]));
  const className = new Map(classes.map((c) => [String(c._id), c.nameBn]));
  const sectionLabel = new Map(
    sections.map((s) => [String(s._id), [className.get(String(s.classId)), s.nameBn].filter(Boolean).join(" · ")]),
  );

  return notes.map((n) => ({
    id: String(n._id),
    tracker: n.tracker,
    itemCode: n.itemCode,
    subject: n.subject,
    dateKey: n.dateKey,
    sectionLabel: sectionLabel.get(String(n.sectionId)) ?? "",
    staffUserId: String(n.staffUserId),
    staffName: userName.get(String(n.staffUserId)) ?? "",
    students: n.students.map((s) => ({
      studentId: String(s.studentId),
      studentName: studentName.get(String(s.studentId)) ?? "",
      chasedAt: s.chasedAt,
      correctedAt: s.correctedAt,
      correctedByName: userName.get(String(s.correctedBy)) ?? "",
      via: s.via,
    })),
    createdAt: n.createdAt,
  }));
}
