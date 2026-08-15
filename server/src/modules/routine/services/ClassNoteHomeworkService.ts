/**
 * ClassNoteHomeworkService (DE-3, D-#477) — the homework half of a class-note
 * publish.
 *
 * The three records STAY three (see D-#477): this does not invent a homework
 * store, it calls the EXISTING tracker services, so an item declared from a period
 * card is indistinguishable from one declared on the Homework screen. The 120-min
 * reconciliation, issuing, Layer-B and the chase sweeps cannot tell them apart —
 * which is the whole point of merging the surfaces and not the records.
 *
 * Scope/permission gating stays in the resolver (it needs the request context);
 * everything here is the slot-derived resolution and the declare/update/nil
 * routing, so it is unit-testable without a schema.
 */
import { Class } from "../../foundation/models/Class";
import {
  declareHomeworkItem,
  declareNoHomework,
  updateHomeworkItem,
  findHomeworkItemIdForDay,
} from "../../trackers/services/HomeworkService";
import type { IRoutineSlot } from "../models/RoutineSlot";

export interface ClassNoteHomeworkInputT {
  mode: string; // DECLARE | NIL
  topTags?: readonly string[] | null;
  description?: string | null;
  qCount?: number | null;
  timeDecl?: number | null;
  poolRef?: string | null;
  revItem?: boolean | null;
  attachmentIds?: readonly string[] | null;
  reason?: string | null; // NIL only
}

/** The slot-derived identity a homework declaration needs. Never client-supplied. */
export interface NoteHomeworkTarget {
  classId: string;
  sectionId: string;
  classLevel: number;
  academicYearId: string;
  subject: string;
}

/** "YYYY-MM-DD" in local time — the shape declareNoHomework takes. */
function dateKeyOf(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Resolve the (class, section, level, year, subject) a note's homework belongs to,
 * straight off the slot. Throws when the period cannot carry section homework.
 *
 * A subject-group period (the Quran/Arabic cross-grade groups) has no section to
 * declare against, and QURAN is out of the homework tracker entirely (D-#36). Both
 * are refused rather than silently dropped, so a mis-built client hears about it.
 */
export async function resolveNoteHomeworkTarget(slot: IRoutineSlot): Promise<NoteHomeworkTarget> {
  if (slot.groupType !== "section" || !slot.classId) {
    throw new Error("এই পিরিয়ডে বাড়ির কাজ যুক্ত করা যায় না — শুধু শাখার পিরিয়ডে সম্ভব");
  }
  if (slot.subject === "QURAN") {
    throw new Error("কুরআনের পিরিয়ডে বাড়ির কাজ ঘোষণা করা হয় না");
  }
  const cls = await Class.findById(slot.classId).select("level academicYearId").lean();
  if (!cls) throw new Error("Class not found for this slot");
  return {
    classId: slot.classId.toString(),
    sectionId: slot.groupId.toString(),
    classLevel: cls.level,
    academicYearId: cls.academicYearId.toString(),
    subject: slot.subject,
  };
}

/**
 * Declare (or nil-declare) the day's homework for a period and return the item id
 * to link on the note — null for a nil declaration.
 *
 * A second publish of the same period is an EDIT, not a duplicate: the day's item is
 * unique on (class, section, subject, day), so a blind re-declare would trip the
 * D-#338 guard. Routing to `updateHomeworkItem` is what makes the whole composite
 * safely repeatable — which is also why a partial failure self-heals on the next tap
 * instead of needing a cross-collection transaction.
 */
export async function resolveClassNoteHomework(input: {
  target: NoteHomeworkTarget;
  date: Date;
  hw: ClassNoteHomeworkInputT;
  actorId: string;
}): Promise<string | null> {
  const { target, date, hw, actorId } = input;

  if (hw.mode === "NIL") {
    if (!hw.reason) throw new Error("কারণ নির্বাচন করুন");
    await declareNoHomework({
      classId: target.classId,
      sectionId: target.sectionId,
      subject: target.subject,
      date: dateKeyOf(date),
      reason: hw.reason,
      actorId,
    });
    return null;
  }
  if (hw.mode !== "DECLARE") throw new Error(`Unknown homework mode: ${hw.mode}`);

  const topTags = [...(hw.topTags ?? [])];
  const description = (hw.description ?? "").trim();
  const qCount = hw.qCount ?? 0;
  const attachmentIds = [...(hw.attachmentIds ?? [])];

  const existing = await findHomeworkItemIdForDay(target.classId, target.sectionId, target.subject, date);
  if (existing) {
    const updated = await updateHomeworkItem({
      itemId: existing,
      description,
      topTags,
      attachmentIds,
      qCount,
      revItem: hw.revItem ?? false,
      ...(hw.timeDecl != null ? { timeDecl: hw.timeDecl } : {}),
      ...(hw.poolRef?.trim() ? { poolRef: hw.poolRef.trim() } : {}),
      actorId,
    });
    return updated.itemId;
  }

  const created = await declareHomeworkItem({
    academicYearId: target.academicYearId,
    classId: target.classId,
    classLevel: target.classLevel,
    sectionId: target.sectionId,
    subject: target.subject,
    dateGiven: date,
    topTags,
    timeDecl: hw.timeDecl ?? undefined,
    qCount,
    poolRef: hw.poolRef?.trim() || undefined,
    revItem: hw.revItem ?? false,
    description,
    attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
    actorId,
  });
  return created.itemId;
}
