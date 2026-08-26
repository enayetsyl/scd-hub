/**
 * HomeworkService — Layer-A declaration, issue (Layer-B spawn), and the 6-stage
 * lifecycle (handoff §2–§3, HW-T1).
 *
 *   generateHwId        — atomic HW-C{class}-{SUBJECT}-{nnnn}, year-continuous (D-#34)
 *   declareHomeworkItem — one common sheet per class+subject+day (validates §2.1)
 *   issueHomeworkItem   — spawn per-student Layer-B records (present→GIVEN, absent→ABSENT_REDELIVER)
 *   transitionRecord    — apply ONE legal lifecycle transition, timestamped (rejects illegal)
 *
 * Write-scope is enforced by the resolver (assertCanWrite), not here. HW-T2 will
 * gate `issueHomeworkItem` behind the daily 120-min reconciliation/confirm; the
 * spawn mechanism itself lives here.
 */
import {
  HW_SUBJECTS,
  HW_RESULTS,
  HW_DEFAULT_TIME_DECL_MIN,
  ROSTER_CLASS_LEVEL_MIN,
  ROSTER_CLASS_LEVEL_MAX,
} from "@scd/shared";
import type { HwSubject, LifecycleState, HwResult } from "@scd/shared";
import { Types } from "mongoose";
import { StoredFile } from "../../platform/models/StoredFile";
import { HomeworkItem } from "../models/HomeworkItem";
import { HomeworkStudentRecord } from "../models/HomeworkStudentRecord";
import { HomeworkSequence } from "../models/HomeworkSequence";
import { HomeworkTopic } from "../models/HomeworkTopic";
import {
  HomeworkNilDeclaration,
  HW_NIL_REASONS,
  type HwNilReason,
} from "../models/HomeworkNilDeclaration";
import { HomeworkReconciliation, reconDayKey } from "../models/HomeworkReconciliation";
import { dateKeyOf } from "../../attendance/dates";
import { Student } from "../../foundation/models/Student";
import { assertTransition, isEntryState } from "../lifecycle";
import { isSchoolDay } from "../calendar";
import { resolveHomeworkDueDate, resolveHomeworkDueDateByItem } from "../homeworkDueDate";
import { acceptClaimsForRecords, hasOpenClaim } from "./WorkClaimService";
import { emitHwParentComms, emitHwGuardianChase, emitWorkClaimResolved } from "../../notifications/services/emitters";

const GENERIC_TOPIC_LABEL_BN = "সাধারণ (নির্দিষ্ট অধ্যায় নয়)";

function genericTopicCode(subject: string, classLevel: number): string {
  return `TOP-${subject}-C${classLevel}-GEN`;
}

function genericTopicDTO(subject: string, classLevel: number): HomeworkTopicDTO {
  return {
    id: `synthetic:${genericTopicCode(subject, classLevel)}`,
    code: genericTopicCode(subject, classLevel),
    labelBn: GENERIC_TOPIC_LABEL_BN,
    classLevel,
    subject: subject as HwSubject,
    chapters: [],
    order: 9999,
  };
}

// ---------------------------------------------------------------------------
// HW_ID generation (handoff §2.1 / D-#34)
// ---------------------------------------------------------------------------

/**
 * Next HW_ID for (year × class × subject): atomic $inc on the sequence counter,
 * formatted HW-C{class}-{SUBJECT}-{nnnn} (4-digit zero-padded). Year-reset is
 * automatic — a new academicYearId is a new counter key starting at 1.
 */
export async function generateHwId(
  academicYearId: string,
  classLevel: number,
  subject: HwSubject,
): Promise<string> {
  const counter = await HomeworkSequence.findOneAndUpdate(
    { academicYearId, classLevel, subject },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  const n = String(counter.seq).padStart(4, "0");
  return `HW-C${classLevel}-${subject}-${n}`;
}

// ---------------------------------------------------------------------------
// declareHomeworkItem (Layer A)
// ---------------------------------------------------------------------------

export interface DeclareHomeworkItemInput {
  academicYearId: string;
  classId: string;
  classLevel: number;
  sectionId: string;
  subject: string;
  dateGiven: string | Date;
  topTags: string[];
  timeDecl?: number;
  qCount: number;
  poolRef?: string;
  selectedQids?: string[];
  revItem?: boolean;
  sessionRef?: string;
  /** D-#317: the teacher's brief "what is the homework" — required, card-visible. */
  description: string;
  /** StoredFile ids (≤5, HW_BINDABLE_FILE_KINDS) picked in the declare form. */
  attachmentIds?: string[];
  actorId: string;
}

export interface HomeworkItemResult {
  itemId: string;
  hwId: string;
  classLevel: number;
  subject: HwSubject;
  dateGiven: string;
  topTags: string[];
  timeDecl: number;
  qCount: number;
  revItem: boolean;
  status: string;
  attachmentIds: string[];
}

export const HW_MAX_ATTACHMENTS = 5;

/** The kinds a homework item may bind. `hw_question` is the declare-form upload
 *  (D-#297); `classnote_attachment` is admitted because DE-3 (D-#477) merged the
 *  surfaces — the daily-entry card has ONE picker whose files land on the note AND
 *  on the item it declares, and that picker uploads via POST /files/classnote. Both
 *  kinds are staff-uploaded, class-readable question material. What stays excluded
 *  is what the check was built for: an `hw_answer` (a child's marked work) or a chat
 *  file must never become class-readable through the item's read gate. */
const HW_BINDABLE_FILE_KINDS = ["hw_question", "classnote_attachment"] as const;

/** Validate declare-form attachments: ≤5 valid ObjectIds, every one an existing
 *  StoredFile of a bindable kind. */
async function normalizeAttachmentIds(ids: string[] | undefined): Promise<Types.ObjectId[] | undefined> {
  if (!ids || ids.length === 0) return undefined;
  if (ids.length > HW_MAX_ATTACHMENTS) {
    throw new Error(`At most ${HW_MAX_ATTACHMENTS} attachments per homework item`);
  }
  if (ids.some((id) => !Types.ObjectId.isValid(id))) {
    throw new Error("Invalid attachment file id");
  }
  const found = await StoredFile.find({ _id: { $in: ids }, kind: { $in: HW_BINDABLE_FILE_KINDS } })
    .select("_id")
    .lean();
  if (found.length !== new Set(ids.map(String)).size) {
    throw new Error("Every attachment must be an uploaded homework question file");
  }
  return ids.map((id) => new Types.ObjectId(id));
}

function assertSubject(s: string): asserts s is HwSubject {
  if (!(HW_SUBJECTS as readonly string[]).includes(s)) {
    throw new Error(`Unknown homework subject: ${s} (allowed: ${HW_SUBJECTS.join(", ")})`);
  }
}

/**
 * DE-3 (D-#477): the day's item for (class, section, subject), or null.
 *
 * Lives here because the (class, section, subject, DAY) key and its day-bounds
 * comparison are this service's rule — the composite class-note entry point uses
 * it to route a re-publish to `updateHomeworkItem` instead of tripping the D-#338
 * duplicate guard.
 */
export async function findHomeworkItemIdForDay(
  classId: string,
  sectionId: string,
  subject: string,
  dateGiven: Date,
): Promise<string | null> {
  const { start, end } = dayBoundsOf(dateGiven);
  const existing = await HomeworkItem.findOne({
    classId,
    sectionId,
    subject,
    dateGiven: { $gte: start, $lte: end },
  })
    .select("_id")
    .lean();
  return existing ? existing._id.toString() : null;
}

export async function declareHomeworkItem(
  input: DeclareHomeworkItemInput,
): Promise<HomeworkItemResult> {
  const { subject } = input;
  assertSubject(subject);

  if (
    !Number.isInteger(input.classLevel) ||
    input.classLevel < ROSTER_CLASS_LEVEL_MIN ||
    input.classLevel > ROSTER_CLASS_LEVEL_MAX
  ) {
    throw new Error("Homework is for roster classes Nursery/KG/C1–C5 only (classLevel must be -1..5)");
  }

  const dateGiven = new Date(input.dateGiven);
  if (Number.isNaN(dateGiven.getTime())) throw new Error("Invalid dateGiven");
  if (!isSchoolDay(dateGiven)) {
    throw new Error("HW-… issues on school nights only (Sun–Thu); Fri/Sat are blocked (handoff §6.1)");
  }

  await assertKnownTopTags(subject, input.classLevel, input.topTags);

  // TIME_DECL: 0–40 is the working band but a subject MAY exceed 40 on reduced-roster
  // days (handoff §2.1). >40 is NOT rejected here — it surfaces as a band warning at
  // reconciliation (T2.5); only the §4 day-sum (120) blocks. So just require int ≥ 0.
  const timeDecl = input.timeDecl ?? HW_DEFAULT_TIME_DECL_MIN;
  if (!Number.isInteger(timeDecl) || timeDecl < 0) {
    throw new Error("TIME_DECL must be a non-negative integer (minutes)");
  }
  if (!Number.isInteger(input.qCount) || input.qCount < 0) {
    throw new Error("Q_COUNT must be a non-negative integer");
  }
  if (input.poolRef) {
    const poolPattern = new RegExp(`^QP-${subject}-C${input.classLevel}-U\\d{2,}$`);
    if (!poolPattern.test(input.poolRef)) {
      throw new Error(`Malformed POOL_REF "${input.poolRef}" — expected QP-${subject}-C${input.classLevel}-U{nn}`);
    }
  }

  // D-#317: the brief "what is the homework" is MANDATORY — it is the label every
  // later step (collection, marking, checking) tells items apart by.
  const description = (input.description ?? "").trim();
  if (!description) {
    throw new Error("A brief homework description is required (D-#317)");
  }

  const attachmentIds = await normalizeAttachmentIds(input.attachmentIds);

  // D-#338: ONE common sheet per class+section+subject+day (the model header's
  // stated intent, previously unenforced) — a second declaration is a mistake;
  // the fix path for the first one is edit or delete (D-#336).
  {
    const { start, end } = dayBoundsOf(dateGiven);
    const existing = await HomeworkItem.findOne({
      classId: input.classId,
      sectionId: input.sectionId,
      subject,
      dateGiven: { $gte: start, $lte: end },
    })
      .select("hwId")
      .lean();
    if (existing) {
      throw new Error(
        `এই শ্রেণি-বিষয়ের জন্য এই দিনের বাড়ির কাজ আগেই ঘোষণা করা হয়েছে (${existing.hwId}) — প্রয়োজনে সেটি সম্পাদনা বা মুছে ফেলুন`,
      );
    }
  }

  const hwId = await generateHwId(input.academicYearId, input.classLevel, subject);

  // The findOne above is a check-then-act: two simultaneous declares can both pass
  // it before either insert lands. The unique index on the model is the real
  // enforcement, so translate its duplicate-key error into the SAME message the
  // check gives — a racing teacher must not see a raw E11000.
  const doc = await HomeworkItem.create({
    hwId,
    academicYearId: input.academicYearId,
    classId: input.classId,
    classLevel: input.classLevel,
    sectionId: input.sectionId,
    subject,
    dateGiven,
    topTags: input.topTags,
    timeDecl,
    qCount: input.qCount,
    poolRef: input.poolRef,
    selectedQids: input.selectedQids ?? [],
    revItem: input.revItem ?? false,
    sessionRef: input.sessionRef,
    description,
    status: "declared",
    declaredBy: input.actorId,
    attachmentIds,
  }).catch((err: unknown) => {
    const e = err as { code?: number; keyPattern?: Record<string, unknown> };
    if (e?.code === 11000 && e.keyPattern && "sectionId" in e.keyPattern && "subject" in e.keyPattern) {
      throw new Error(
        `এই শ্রেণি-বিষয়ের জন্য এই দিনের বাড়ির কাজ আগেই ঘোষণা করা হয়েছে — প্রয়োজনে সেটি সম্পাদনা বা মুছে ফেলুন`,
      );
    }
    throw err;
  });

  // D-#299: a real declaration supersedes a "no homework today" marker for the
  // same (class, subject, day) — the teacher changed their mind.
  await HomeworkNilDeclaration.deleteOne({
    classId: input.classId,
    subject,
    dateKey: dateKeyOf(dateGiven),
  });

  return {
    itemId: doc._id.toString(),
    hwId: doc.hwId,
    classLevel: doc.classLevel,
    subject: doc.subject,
    dateGiven: doc.dateGiven.toISOString(),
    topTags: doc.topTags,
    timeDecl: doc.timeDecl,
    qCount: doc.qCount,
    revItem: doc.revItem,
    status: doc.status,
    attachmentIds: (doc.attachmentIds ?? []).map((id) => id.toString()),
  };
}

// ---------------------------------------------------------------------------
// Edit / delete a declared item (D-#336 policy)
// ---------------------------------------------------------------------------

/** Topics are PICKED from the per-(subject, class) catalog (HomeworkTopic), not typed
 *  free-hand — every code must exist + be active for this subject+class. Shared by
 *  declare and update so the topic-touch roll-up stays on a controlled code set. */
async function assertKnownTopTags(
  subject: HwSubject,
  classLevel: number,
  topTags: string[],
): Promise<void> {
  if (!Array.isArray(topTags) || topTags.length === 0) {
    throw new Error("At least one topic is required (handoff §2.1 / REF-07 §3.5)");
  }
  const wantedTags = [...new Set(topTags)];
  const knownTopics = await HomeworkTopic.find({
    subject,
    classLevel,
    code: { $in: wantedTags },
    active: true,
  })
    .select("code")
    .lean();
  const knownCodes = new Set(knownTopics.map((t) => t.code));
  knownCodes.add(genericTopicCode(subject, classLevel));
  const unknownTags = wantedTags.filter((c) => !knownCodes.has(c));
  if (unknownTags.length > 0) {
    throw new Error(`Unknown topic(s) for ${subject} C${classLevel}: ${unknownTags.join(", ")}`);
  }
}

/** Reject writes once the item's day is reconciled — the recon report and the
 *  immutable trim log (§4.5) are frozen views of that day's declarations. */
async function assertDayUnreconciled(classId: string, dateGiven: Date): Promise<void> {
  const existing = await HomeworkReconciliation.findOne({
    classId,
    reconDate: reconDayKey(dateGiven),
  }).lean();
  if (existing && existing.reconState === "reconciled") {
    throw new Error("Day already reconciled — declared items are frozen (handoff §4.5)");
  }
}

export interface UpdateHomeworkItemInput {
  itemId: string;
  /** Omitted fields are left unchanged. */
  description?: string;
  topTags?: string[];
  timeDecl?: number;
  qCount?: number;
  /** null clears the pool ref. */
  poolRef?: string | null;
  selectedQids?: string[];
  revItem?: boolean;
  /** [] clears all attachments. */
  attachmentIds?: string[];
  actorId: string;
}

/**
 * Is a frozen field being left as it already is? Only a real difference may be refused.
 *
 * Arrays compare by content (selectedQids is rebuilt on every save, so a fresh array of
 * the same ids is not an edit), and POOL_REF normalises absent/null/"" to one value so
 * "no pool" sent three different ways never reads as a change.
 */
function sameFrozenValue(sent: unknown, stored: unknown): boolean {
  if (Array.isArray(sent) || Array.isArray(stored)) {
    const a = (Array.isArray(sent) ? sent : []).map(String);
    const b = (Array.isArray(stored) ? stored : []).map(String);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  const norm = (v: unknown): unknown => (v === null || v === undefined || v === "" ? null : v);
  return norm(sent) === norm(stored);
}

/** Tiered edit (D-#336):
 *    declared (+ day unreconciled) → every declare-form field EXCEPT the identity
 *      trio subject/classLevel/dateGiven (they are baked into hwId and, at issue,
 *      into every student record's dueDate — never editable; mis-declared identity
 *      is fixed by deleteHomeworkItem + re-declare).
 *    issued → descriptive fields only (description, topTags, attachmentIds). All
 *      downstream reads live-join the item, so these propagate cleanly; timeDecl/
 *      qCount are frozen because tallyDay recomputes live and an edit would
 *      silently rewrite the reconciled DAY_TOTAL under the 120-min ceiling gate.
 *
 *  The frozen check compares against what is STORED, so it refuses a real CHANGE
 *  rather than the mere mention of a field. It used to reject on presence, which made
 *  a whole caller impossible: the class-note bridge always passes qCount/revItem, so
 *  once a day was issued the teacher could no longer edit that note AT ALL — not even
 *  the description and attachments this very rule promises stay editable. A no-op write
 *  rewrites no DAY_TOTAL, so there was never anything to protect against. */
export async function updateHomeworkItem(input: UpdateHomeworkItemInput): Promise<HomeworkItemResult> {
  const item = await HomeworkItem.findById(input.itemId);
  if (!item) throw new Error("HomeworkItem not found");

  if (item.status !== "declared") {
    const frozen: [string, unknown, unknown][] = [
      ["TIME_DECL", input.timeDecl, item.timeDecl],
      ["Q_COUNT", input.qCount, item.qCount],
      ["POOL_REF", input.poolRef, item.poolRef ?? null],
      ["selected questions", input.selectedQids, item.selectedQids],
      ["revision flag", input.revItem, item.revItem],
    ];
    const attempted = frozen
      .filter(([, sent, stored]) => sent !== undefined && !sameFrozenValue(sent, stored))
      .map(([k]) => k);
    if (attempted.length > 0) {
      throw new Error(
        `Item is already issued — ${attempted.join(", ")} is frozen (only description, topics and attachments stay editable)`,
      );
    }
  } else {
    await assertDayUnreconciled(item.classId.toString(), item.dateGiven);
  }

  if (input.topTags !== undefined) {
    await assertKnownTopTags(item.subject, item.classLevel, input.topTags);
    item.topTags = [...new Set(input.topTags)];
  }
  if (input.description !== undefined) {
    const description = input.description.trim();
    if (!description) throw new Error("A brief homework description is required (D-#317)");
    item.description = description;
  }
  if (input.attachmentIds !== undefined) {
    item.attachmentIds = await normalizeAttachmentIds(input.attachmentIds);
  }
  if (input.timeDecl !== undefined) {
    if (!Number.isInteger(input.timeDecl) || input.timeDecl < 0) {
      throw new Error("TIME_DECL must be a non-negative integer (minutes)");
    }
    item.timeDecl = input.timeDecl;
  }
  if (input.qCount !== undefined) {
    if (!Number.isInteger(input.qCount) || input.qCount < 0) {
      throw new Error("Q_COUNT must be a non-negative integer");
    }
    item.qCount = input.qCount;
  }
  if (input.poolRef !== undefined) {
    if (input.poolRef === null || input.poolRef === "") {
      item.poolRef = undefined;
    } else {
      const poolPattern = new RegExp(`^QP-${item.subject}-C${item.classLevel}-U\\d{2,}$`);
      if (!poolPattern.test(input.poolRef)) {
        throw new Error(
          `Malformed POOL_REF "${input.poolRef}" — expected QP-${item.subject}-C${item.classLevel}-U{nn}`,
        );
      }
      item.poolRef = input.poolRef;
    }
  }
  if (input.selectedQids !== undefined) item.selectedQids = input.selectedQids;
  if (input.revItem !== undefined) item.revItem = input.revItem;

  await item.save();

  return {
    itemId: item._id.toString(),
    hwId: item.hwId,
    classLevel: item.classLevel,
    subject: item.subject,
    dateGiven: item.dateGiven.toISOString(),
    topTags: item.topTags,
    timeDecl: item.timeDecl,
    qCount: item.qCount,
    revItem: item.revItem,
    status: item.status,
    attachmentIds: (item.attachmentIds ?? []).map((id) => id.toString()),
  };
}

/** Delete a mis-declared item (D-#336) — the only fix for a wrong subject/class/
 *  date, since those are baked into hwId. Declared-only + day unreconciled; an
 *  issued item already spawned student records and can never be deleted. */
export async function deleteHomeworkItem(itemId: string): Promise<{ itemId: string; hwId: string }> {
  const item = await HomeworkItem.findById(itemId).lean();
  if (!item) throw new Error("HomeworkItem not found");
  if (item.status !== "declared") {
    throw new Error("Item is already issued — issued homework cannot be deleted");
  }
  await assertDayUnreconciled(item.classId.toString(), item.dateGiven as unknown as Date);
  await HomeworkItem.deleteOne({ _id: item._id });
  return { itemId: item._id.toString(), hwId: item.hwId };
}

// ---------------------------------------------------------------------------
// "No homework today" nil declarations (D-#299)
// ---------------------------------------------------------------------------

export interface NilDeclarationDTO {
  id: string;
  classId: string;
  sectionId: string;
  subject: string;
  dateKey: string;
  reason: HwNilReason;
  declaredBy: string;
}

function toNilDTO(d: {
  _id: { toString(): string };
  classId: { toString(): string };
  sectionId: { toString(): string };
  subject: string;
  dateKey: string;
  reason: HwNilReason;
  declaredBy: { toString(): string };
}): NilDeclarationDTO {
  return {
    id: d._id.toString(),
    classId: d.classId.toString(),
    sectionId: d.sectionId.toString(),
    subject: d.subject,
    dateKey: d.dateKey,
    reason: d.reason,
    declaredBy: d.declaredBy.toString(),
  };
}

/** Local-day bounds for an item-exists check against HomeworkItem.dateGiven. */
function dayBoundsOf(d: Date): { start: Date; end: Date } {
  return {
    start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0),
    end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999),
  };
}

/** Declare "no homework today" for one (class, subject, day). Upsert — tapping
 *  again updates the reason. Rejected while a REAL item exists for the cell. */
export async function declareNoHomework(input: {
  classId: string;
  sectionId: string;
  subject: string;
  /** "YYYY-MM-DD" or ISO date. */
  date: string;
  reason: string;
  actorId: string;
}): Promise<NilDeclarationDTO> {
  const { subject } = input;
  assertSubject(subject);
  if (!(HW_NIL_REASONS as readonly string[]).includes(input.reason)) {
    throw new Error(`Unknown reason: ${input.reason} (allowed: ${HW_NIL_REASONS.join(", ")})`);
  }
  const d = new Date(input.date.length === 10 ? `${input.date}T00:00:00` : input.date);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  if (!isSchoolDay(d)) {
    throw new Error("Fri/Sat are not homework nights — nothing to declare (handoff §6.1)");
  }
  const { start, end } = dayBoundsOf(d);
  const real = await HomeworkItem.findOne({
    classId: input.classId,
    subject,
    dateGiven: { $gte: start, $lte: end },
  })
    .select("_id")
    .lean();
  if (real) {
    throw new Error("Homework IS declared for this subject today — remove is not possible via nil");
  }
  const doc = await HomeworkNilDeclaration.findOneAndUpdate(
    { classId: input.classId, subject, dateKey: dateKeyOf(d) },
    {
      $set: {
        sectionId: input.sectionId,
        reason: input.reason as HwNilReason,
        declaredBy: input.actorId,
      },
    },
    { new: true, upsert: true },
  );
  return toNilDTO(doc as unknown as Parameters<typeof toNilDTO>[0]);
}

/** Remove a mistaken nil declaration (same write-scope as declaring it). */
export async function removeNoHomework(input: {
  classId: string;
  subject: string;
  date: string;
}): Promise<boolean> {
  assertSubject(input.subject);
  const d = new Date(input.date.length === 10 ? `${input.date}T00:00:00` : input.date);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  const res = await HomeworkNilDeclaration.deleteOne({
    classId: input.classId,
    subject: input.subject,
    dateKey: dateKeyOf(d),
  });
  return (res.deletedCount ?? 0) > 0;
}

/** The day's nil declarations for a class (the declare screen's state read). */
export async function listNilDeclarations(
  classId: string,
  date: string,
): Promise<NilDeclarationDTO[]> {
  const d = new Date(date.length === 10 ? `${date}T00:00:00` : date);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  const docs = await HomeworkNilDeclaration.find({ classId, dateKey: dateKeyOf(d) }).lean();
  return (docs as unknown as Parameters<typeof toNilDTO>[0][]).map(toNilDTO);
}

// ---------------------------------------------------------------------------
// Topic catalog (the picker the teacher chooses topTags from)
// ---------------------------------------------------------------------------

export interface HomeworkTopicDTO {
  id: string;
  code: string;
  labelBn: string;
  classLevel: number;
  subject: HwSubject;
  chapters: { num: number; titleBn: string }[];
  order: number;
}

/** Active topics for (subject, class), ordered for the declare-screen picker. */
export async function listHomeworkTopics(
  subject: string,
  classLevel: number,
): Promise<HomeworkTopicDTO[]> {
  assertSubject(subject);
  const docs = await HomeworkTopic.find({ subject, classLevel, active: true })
    .sort({ order: 1, code: 1 })
    .lean();
  if (docs.length === 0) return [genericTopicDTO(subject, classLevel)];
  return docs.map((d) => ({
    id: d._id.toString(),
    code: d.code,
    labelBn: d.labelBn,
    classLevel: d.classLevel,
    subject: d.subject,
    chapters: (d.chapters ?? []).map((c) => ({ num: c.num, titleBn: c.titleBn })),
    order: d.order,
  }));
}

/** code -> Bangla label for a set of topic codes (batched — one query). Unknown
 *  codes are omitted; callers fall back to the raw code. */
export async function topicLabelByCode(codes: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(codes)];
  if (uniq.length === 0) return new Map();
  const topics = await HomeworkTopic.find({ code: { $in: uniq } }).select("code labelBn").lean();
  const byCode = new Map(topics.map((t) => [t.code, t.labelBn]));
  for (const code of uniq) {
    if (byCode.has(code)) continue;
    if (/^TOP-[A-Z]+-C-?\d+-GEN$/.test(code)) byCode.set(code, GENERIC_TOPIC_LABEL_BN);
  }
  return byCode;
}

/** Join an item's topTag codes into a single display label (catalog label, else code). */
export function joinTopicLabels(topTags: string[], labelByCode: Map<string, string>): string {
  return topTags.map((c) => labelByCode.get(c) ?? c).join(" · ");
}

// ---------------------------------------------------------------------------
// issueHomeworkItem (spawn Layer-B per-student records)
// ---------------------------------------------------------------------------

export interface IssueRosterEntry {
  studentId: string;
  /** Present at issue → GIVEN; absent → ABSENT_REDELIVER (handoff §3 step 1/2). */
  present: boolean;
}

export interface IssueHomeworkItemResult {
  itemId: string;
  hwId: string;
  issuedCount: number;
  status: string;
}

export async function issueHomeworkItem(
  itemId: string,
  roster: IssueRosterEntry[],
  actorId: string,
): Promise<IssueHomeworkItemResult> {
  const item = await HomeworkItem.findById(itemId);
  if (!item) throw new Error("HomeworkItem not found");

  const now = new Date();
  // Owner ruling 2026-08-04: due = the subject's next TEACHING day in this
  // section (routine-aware, holiday-rolled), not merely the next school day.
  const due = await resolveHomeworkDueDate(item.sectionId, item.subject, item.dateGiven);

  const records = roster.map((r) => {
    const state: LifecycleState = r.present ? "GIVEN" : "ABSENT_REDELIVER";
    return {
      hwItemId: item._id,
      hwId: item.hwId,
      studentId: r.studentId,
      sectionId: item.sectionId,
      classId: item.classId,
      state,
      stateDates: [{ state, at: now, by: new Types.ObjectId(actorId) }],
      // Absent records have no due date until re-delivered (handoff §3 stage 2).
      dueDate: r.present ? due : undefined,
      chaseCount: 0,
      topupFlag: false,
      topupQids: [],
      issuedBy: actorId,
    };
  });

  if (records.length > 0) {
    await HomeworkStudentRecord.insertMany(records);
  }

  item.status = "issued";
  item.issuedAt = now;
  await item.save();

  return {
    itemId: item._id.toString(),
    hwId: item.hwId,
    issuedCount: records.length,
    status: item.status,
  };
}

// ---------------------------------------------------------------------------
// transitionRecord (one legal lifecycle move, timestamped)
// ---------------------------------------------------------------------------

export interface TransitionRecordInput {
  recordId: string;
  toState: string;
  /** Acting user. OMITTED only for system sweeps — the stamp then carries no `by`,
   *  which the D-#338 revert gate already treats as "system" (write-scope undo). */
  actorId?: string;
  /** Required when entering CHECKED — the RESULT recorded at Checked (handoff §2.2). */
  result?: string;
  /** Override the transition timestamp (defaults to now). */
  at?: Date;
}

export interface TransitionRecordResult {
  recordId: string;
  hwId: string;
  state: LifecycleState;
  chaseCount: number;
  result: HwResult | null;
  dueDate: string | null;
}

export async function transitionRecord(
  input: TransitionRecordInput,
): Promise<TransitionRecordResult> {
  const record = await HomeworkStudentRecord.findById(input.recordId);
  if (!record) throw new Error("HomeworkStudentRecord not found");

  const from = record.state;
  const to = input.toState as LifecycleState;
  assertTransition(from, to); // throws on illegal/unknown

  const at = input.at ?? new Date();

  if (to === "CHECKED") {
    if (!input.result || !(HW_RESULTS as readonly string[]).includes(input.result)) {
      throw new Error("A RESULT (CORRECT/PARTIAL/WRONG) is required when checking (→ CHECKED)");
    }
    record.result = input.result as HwResult;
  }

  // CHASE_COUNT increments each time the record (re)enters CHASE (handoff §3 stage 4).
  if (to === "CHASE") {
    record.chaseCount += 1;
  }

  // Re-delivery shifts the due date to the subject's next teaching day
  // (handoff §3 stage 2 / T1.4; routine-aware per the 2026-08-04 owner ruling).
  if (from === "ABSENT_REDELIVER" && to === "GIVEN") {
    record.dueDate = await resolveHomeworkDueDateByItem(record.hwItemId, record.sectionId, at);
  }

  record.state = to;
  record.stateDates.push(
    input.actorId
      ? { state: to, at, by: new Types.ObjectId(input.actorId) }
      : { state: to, at },
  );
  await record.save();

  // D-#260: EVERY chase pushes the student's login-enabled guardians an in-app
  // reminder (in-app + push), deduped once per student+item per day inside the
  // emitter. Best-effort — a notification problem never blocks the transition.
  // D-#551 §6.4: while a guardian is waiting for an answer on THIS record, the
  // app must not push them a reminder for the very work they reported. The state
  // still advances and chaseCount still increments — the teacher's view is
  // unchanged — only the family-facing push is held.
  if (to === "CHASE" && !(await hasOpenClaim(record._id))) {
    await emitHwGuardianChase({
      hwItemId: record.hwItemId,
      hwId: record.hwId,
      studentId: record.studentId,
      sectionId: record.sectionId,
      chaseCount: record.chaseCount,
      at,
    });
  }

  // N1.4 (§7.2, D-#34/D-#45): the 3rd chase additionally prompts the class teacher
  // to contact the parents. Best-effort + deduped per student+item inside the emitter.
  if (to === "CHASE" && record.chaseCount >= 3) {
    await emitHwParentComms({
      hwItemId: record.hwItemId,
      hwId: record.hwId,
      studentId: record.studentId,
      sectionId: record.sectionId,
      chaseCount: record.chaseCount,
    });
  }

  // D-#549: the ONE homework hook. Marking a student submitted through ANY path
  // — the roster pass, the workspace card, the outcome service — closes an open
  // guardian claim as ACCEPTED. Placing it on the edge rather than in the roster
  // pass is what stops a future submit path bypassing it. Best-effort inside.
  if (to === "SUBMITTED") {
    const accepted = await acceptClaimsForRecords([record._id], input.actorId, at);
    for (const claim of accepted) await emitWorkClaimResolved(claim);
  }

  return {
    recordId: record._id.toString(),
    hwId: record.hwId,
    state: record.state,
    chaseCount: record.chaseCount,
    result: record.result ?? null,
    dueDate: record.dueDate ? record.dueDate.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// markRecordsDue (D-#313 — bulk early GIVEN → DUE)
// ---------------------------------------------------------------------------

/** Bulk GIVEN → DUE for a picked set of a section's records — the manual
 *  early-flip counterpart of the overnight auto-due sweep (same no-side-effect
 *  edge, same bulk shape). Ids outside the section or not currently GIVEN
 *  simply don't match — never an error. Returns how many flipped. */
export async function markRecordsDue(sectionId: string, recordIds: string[], actorId?: string): Promise<number> {
  if (recordIds.length === 0) return 0;
  const now = new Date();
  const stamp: { state: string; at: Date; by?: Types.ObjectId } = { state: "DUE", at: now };
  if (actorId) stamp.by = new Types.ObjectId(actorId);
  const res = await HomeworkStudentRecord.updateMany(
    { _id: { $in: recordIds }, sectionId, state: "GIVEN" },
    { $set: { state: "DUE" }, $push: { stateDates: stamp } },
  );
  return res.modifiedCount ?? 0;
}

// ---------------------------------------------------------------------------
// Read helpers (daily declaration view + lifecycle queues — handoff §8)
// ---------------------------------------------------------------------------

export async function listDailyItems(classId: string, dateGiven?: Date) {
  const filter: Record<string, unknown> = { classId };
  if (dateGiven) {
    const start = new Date(dateGiven);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    filter.dateGiven = { $gte: start, $lt: end };
  }
  return HomeworkItem.find(filter).sort({ subject: 1 }).lean();
}

export async function listStudentRecords(hwItemId: string) {
  return HomeworkStudentRecord.find({ hwItemId }).lean();
}

/** One open lifecycle record, enriched with its item's subject + given-date and the
 *  student's name — the row the date-grouped Checking queue / Records screens render. */
export interface OpenRecordDTO {
  id: string;
  hwId: string;
  /** The item's Mongo _id — the roster-pass mutations' `itemId` arg (RP-1, D-#355). */
  hwItemId: string;
  subject: string;
  /** The item's topic(s), resolved to Bangla catalog labels (joined). "" if none. */
  topicLabelBn: string;
  /** D-#317: the teacher's brief "what is the homework" — null on pre-D-#317 items. */
  description: string | null;
  dateGiven: string; // ISO (the item's given date — the grouping key)
  studentId: string;
  studentName: string;
  state: string;
  chaseCount: number;
  hasAnswerFile: boolean;
  /** The attached answer file's id — so the checking queue can OPEN what the
   *  student handed in, not merely announce that something is attached. Reading
   *  it still goes through GET /files/:id, which re-runs assertCanRead on this
   *  record's section (HomeworkFileService), so the id grants nothing on its own. */
  answerFileId: string | null;
  dueDate: string | null;
  /** The recorded RESULT (CORRECT/PARTIAL/WRONG) once checked — null before then. */
  result: string | null;
  /** D-#338: stamps on the record — আনডু is only offered when > 1 (entry stamp never pops). */
  stampCount: number;
  /** D-#338: `at` of the newest stamp (ISO) — the client's same-Dhaka-day undo hint. */
  lastStateAt: string;
  /** Set when this record is a RESUBMISSION (HW-T3) — the workspace badges it so a
   *  student redoing work isn't mistaken for a duplicate across passes (owner 2026-07-26). */
  resubOf: string | null;
}

/**
 * All of a section's lifecycle records in the given `states`, across ALL dates,
 * enriched with the item's subject + date and the student's name, newest-given-date
 * first. Powers the auto-listed, date-grouped Checking queue (states ["SUBMITTED"])
 * and Student-records screens (the open, non-terminal state set) — no manual date pick.
 * Read-scope is enforced by the resolver (assertCanRead) before this runs.
 */
export async function listOpenRecords(sectionId: string, states: LifecycleState[]): Promise<OpenRecordDTO[]> {
  if (states.length === 0) return [];
  const recs = await HomeworkStudentRecord.find({ sectionId, state: { $in: states } }).lean();
  if (recs.length === 0) return [];

  const itemIds = [...new Set(recs.map((r) => r.hwItemId.toString()))];
  const studentIds = [...new Set(recs.map((r) => r.studentId.toString()))];
  const items = await HomeworkItem.find({ _id: { $in: itemIds } })
    .select({ subject: 1, dateGiven: 1, topTags: 1, description: 1 })
    .lean();
  const students = await Student.find({ _id: { $in: studentIds } }).select({ name: 1 }).lean();
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));
  const nameMap = new Map(students.map((s) => [s._id.toString(), s.name]));
  const labelByCode = await topicLabelByCode(items.flatMap((i) => i.topTags ?? []));

  return recs
    .map((r) => {
      const it = itemMap.get(r.hwItemId.toString());
      return {
        id: r._id.toString(),
        hwId: r.hwId,
        hwItemId: r.hwItemId.toString(),
        subject: it?.subject ?? "?",
        topicLabelBn: it ? joinTopicLabels(it.topTags ?? [], labelByCode) : "",
        description: it?.description ?? null,
        dateGiven: it ? new Date(it.dateGiven as unknown as Date).toISOString() : new Date(0).toISOString(),
        studentId: r.studentId.toString(),
        studentName: nameMap.get(r.studentId.toString()) ?? r.studentId.toString(),
        state: r.state,
        chaseCount: r.chaseCount ?? 0,
        hasAnswerFile: !!r.answerFileId,
        answerFileId: r.answerFileId ? r.answerFileId.toString() : null,
        dueDate: r.dueDate ? new Date(r.dueDate as unknown as Date).toISOString() : null,
        result: r.result ?? null,
        stampCount: r.stateDates.length,
        lastStateAt: new Date(r.stateDates[r.stateDates.length - 1]!.at as unknown as Date).toISOString(),
        resubOf: r.resubOf ? r.resubOf.toString() : null,
      };
    })
    .sort((a, b) =>
      a.dateGiven < b.dateGiven ? 1 : a.dateGiven > b.dateGiven ? -1 : a.studentName.localeCompare(b.studentName),
    );
}
