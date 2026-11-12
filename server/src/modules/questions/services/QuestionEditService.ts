/**
 * QuestionEditService — correct a question in place, or retire it (QR-8, D-#548).
 *
 * The bank had no write path at all: questions arrived by envelope import and could only be
 * reviewed and published. So a reviewer's `APPROVE_WITH_CONDITION` ("the answer should be
 * বের হওয়া") had no one who could act on it — the Principal could read the condition and
 * clear it, but nobody could actually change the answer. This is the missing half.
 *
 * Three deliberate shapes:
 *
 * 1. **In place, not a new version.** `persistEnvelope` supersedes on RE-IMPORT because an
 *    import is a re-delivery of an external document. A correction by an authorised human is
 *    a different act, and versioning every typo fix would multiply the bank. The audit row
 *    carries before AND after, so "who edited what when" is answerable without a version
 *    chain. NOTE the consequence, which the UI states plainly: a later re-import of the same
 *    qid still supersedes, so an in-app edit is overwritten by the next upload of that batch.
 *
 * 2. **CONTENT and ANSWER only.** Subject, class, chapter and question_type are the
 *    question's address and its carrier shape — moving them would strand open review rounds
 *    (anchored per qid but addressed by the artifact) and change what an already-assembled
 *    set contains. A correction fixes what the question says, never where it lives.
 *
 * 3. **Retire is soft.** `AssessmentSet` items reference `artifactId` + `qid`, so a hard
 *    delete would orphan every set the question was assembled into — silently, and long
 *    after the fact. Retiring hides it from the bank, the assign picker and set assembly
 *    while leaving existing sets intact, and it is reversible.
 *
 * A GOLD question may be edited and retired (owner ruling): the common case is spotting a
 * wrong answer key after publishing. Every such edit is audited with `wasPublished: true`,
 * because a published question may already sit in a printed paper.
 *
 * Identity-plane writes (actor ids) behind the ADR-005 firewall; no corpus path added.
 */
import { Types } from "mongoose";
import { QUESTION_TYPES } from "@scd/shared";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { ReviewAssignment } from "../../content/models/ReviewAssignment";
import { writeAudit, writeAuditMany } from "../../platform/services/AuditService";
import { ReviewError, supersedeOpenRounds } from "../../content/services/ReviewService";
import { QUESTION_DOC_TYPE } from "./QuestionReviewService";
import { recordPlaceMistake } from "../../staff-mistakes/services/StaffMistakeNoteService";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface QuestionOptionInput {
  optionId?: string | null;
  text: string;
  isCorrect: boolean;
}

export interface QuestionBlankInput {
  blankNo: number;
  accepted: string[];
}

/** Every field a correction may touch. Anything absent is left exactly as it was. */
export interface QuestionPatch {
  questionText?: string | null;
  marks?: number | null;
  options?: QuestionOptionInput[] | null;
  tfAnswer?: boolean | null;
  blanks?: QuestionBlankInput[] | null;
  answerAccepted?: string[] | null;
  modelNote?: string | null;
}

export interface QuestionEditResult {
  artifactId: string;
  qid: string | null;
  changedFields: string[];
  wasPublished: boolean;
  retiredAt: string | null;
  important: boolean;
}

interface LeanArtifact {
  _id: Types.ObjectId;
  docType: string;
  subject: string;
  classLevel: number;
  reviewStatus: string;
  retiredAt?: Date | null;
  retiredBy?: Types.ObjectId | null;
  importantAt?: Date | null;
  examPoolAt?: Date | null;
  envelopeJson?: Record<string, unknown>;
}

function payloadOf(a: LeanArtifact): Record<string, unknown> {
  return (a.envelopeJson?.payload ?? {}) as Record<string, unknown>;
}

async function loadQuestionDoc(artifactId: string) {
  if (!Types.ObjectId.isValid(artifactId)) throw new ReviewError("Artifact not found");
  const doc = await ContentArtifact.findById(artifactId);
  if (!doc) throw new ReviewError("Artifact not found");
  if (doc.docType !== QUESTION_DOC_TYPE) {
    throw new ReviewError(`Only questions can be edited here (got docType=${doc.docType})`);
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Validation — the payload is a LOCKED closed schema, so a correction must leave
// it valid rather than merely leaving it different.
// ---------------------------------------------------------------------------

function trimmed(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

function validatePatch(questionType: string, patch: QuestionPatch): void {
  if (patch.questionText !== undefined && patch.questionText !== null) {
    if (trimmed(patch.questionText) === "") throw new ReviewError("Question text cannot be empty");
  }
  if (patch.marks !== undefined && patch.marks !== null) {
    if (!Number.isFinite(patch.marks) || patch.marks <= 0) {
      throw new ReviewError("Marks must be a positive number");
    }
  }
  if (patch.options !== undefined && patch.options !== null) {
    if (questionType !== "mcq") {
      throw new ReviewError(`Options belong to an mcq question, not '${questionType}'`);
    }
    const opts = patch.options;
    if (opts.length < 2) throw new ReviewError("An MCQ needs at least two options");
    if (opts.some((o) => trimmed(o.text) === "")) {
      throw new ReviewError("An option cannot be empty");
    }
    const correct = opts.filter((o) => o.isCorrect).length;
    // Exactly one, both ways round: none makes the question unanswerable, several makes
    // every downstream marker disagree about what "correct" means.
    if (correct === 0) throw new ReviewError("Mark exactly one option correct — none is");
    if (correct > 1) throw new ReviewError(`Mark exactly one option correct — ${correct} are`);
  }
  if (patch.tfAnswer !== undefined && patch.tfAnswer !== null && questionType !== "true_false") {
    throw new ReviewError(`A true/false answer belongs to a true_false question, not '${questionType}'`);
  }
  if (patch.blanks !== undefined && patch.blanks !== null) {
    if (questionType !== "fill_blank") {
      throw new ReviewError(`Blanks belong to a fill_blank question, not '${questionType}'`);
    }
    if (patch.blanks.length === 0) throw new ReviewError("A fill-in-the-blank needs at least one blank");
    if (patch.blanks.some((b) => b.accepted.filter((a) => trimmed(a) !== "").length === 0)) {
      throw new ReviewError("Every blank needs at least one accepted answer");
    }
  }
  if (patch.answerAccepted !== undefined && patch.answerAccepted !== null) {
    if (patch.answerAccepted.filter((a) => trimmed(a) !== "").length === 0) {
      throw new ReviewError("Give at least one accepted answer");
    }
  }
}

/** Apply the patch to a payload copy, returning the new payload and what actually moved. */
function applyPatch(
  payload: Record<string, unknown>,
  patch: QuestionPatch,
): { next: Record<string, unknown>; changed: string[]; before: Record<string, unknown> } {
  const next = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const changed: string[] = [];
  const before: Record<string, unknown> = {};

  const set = (key: string, value: unknown): void => {
    // A no-op re-save must not manufacture an audit row saying something changed.
    if (JSON.stringify(next[key]) === JSON.stringify(value)) return;
    before[key] = next[key] ?? null;
    next[key] = value;
    changed.push(key);
  };

  if (patch.questionText != null) set("question_text", trimmed(patch.questionText));
  if (patch.marks != null) set("marks", patch.marks);
  if (patch.options != null) {
    set(
      "options",
      patch.options.map((o, i) => ({
        // Keep the existing letter when one was sent; otherwise number them stably.
        option_id: o.optionId ?? String.fromCharCode(97 + i),
        text: trimmed(o.text),
        is_correct: o.isCorrect,
      })),
    );
  }
  if (patch.tfAnswer != null) set("tf_answer", patch.tfAnswer);
  if (patch.blanks != null) {
    set(
      "blanks",
      patch.blanks.map((b) => ({
        blank_no: b.blankNo,
        accepted: b.accepted.map(trimmed).filter((a) => a !== ""),
      })),
    );
  }
  if (patch.answerAccepted != null || patch.modelNote != null) {
    const current = (next.answer_key ?? {}) as { accepted?: string[]; model_note?: string };
    const merged: Record<string, unknown> = { ...current };
    if (patch.answerAccepted != null) {
      merged.accepted = patch.answerAccepted.map(trimmed).filter((a) => a !== "");
    }
    if (patch.modelNote != null) {
      const note = trimmed(patch.modelNote);
      if (note === "") delete merged.model_note;
      else merged.model_note = note;
    }
    set("answer_key", merged);
  }

  return { next, changed, before };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export async function updateQuestionContent(input: {
  artifactId: string;
  patch: QuestionPatch;
  actorId: string;
  actorRole?: string;
}): Promise<QuestionEditResult> {
  const doc = await loadQuestionDoc(input.artifactId);
  const lean = doc.toObject() as unknown as LeanArtifact;
  const payload = payloadOf(lean);
  const questionType = typeof payload.question_type === "string" ? payload.question_type : "";
  if (!(QUESTION_TYPES as readonly string[]).includes(questionType)) {
    throw new ReviewError(`Question has an unknown question_type ('${questionType}') and cannot be edited`);
  }

  validatePatch(questionType, input.patch);
  const { next, changed, before } = applyPatch(payload, input.patch);

  const qid = typeof payload.qid === "string" ? payload.qid : null;
  const wasPublished = lean.reviewStatus === "gold";

  // A save that changes nothing writes nothing — no audit row, no updatedAt churn. The
  // D-#531 lesson: a guard (or a log) that fires on a no-op teaches people to ignore it.
  if (changed.length === 0) {
    return {
      artifactId: doc._id.toString(),
      qid,
      changedFields: [],
      wasPublished,
      retiredAt: lean.retiredAt ? lean.retiredAt.toISOString() : null,
    important: lean.importantAt != null,
    };
  }

  doc.set("envelopeJson", { ...(lean.envelopeJson ?? {}), payload: next });
  doc.markModified("envelopeJson");
  await doc.save();

  await writeAudit({
    eventKind: "QUESTION_EDITED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: doc._id.toString(),
    targetKind: "ContentArtifact",
    meta: {
      qid,
      subject: lean.subject,
      classLevel: lean.classLevel,
      questionType,
      changed,
      before,
      after: Object.fromEntries(changed.map((k) => [k, next[k] ?? null])),
      // A published question may already sit in a printed paper, so this edit is the kind
      // somebody may need to find later. Flagged rather than refused (owner ruling).
      wasPublished,
    },
  });

  return {
    artifactId: doc._id.toString(),
    qid,
    changedFields: changed,
    wasPublished,
    retiredAt: lean.retiredAt ? lean.retiredAt.toISOString() : null,
    important: lean.importantAt != null,
  };
}

// ---------------------------------------------------------------------------
// Retire / restore
// ---------------------------------------------------------------------------

export async function retireQuestion(input: {
  artifactId: string;
  reason?: string | null;
  actorId: string;
  actorRole?: string;
}): Promise<QuestionEditResult> {
  const doc = await loadQuestionDoc(input.artifactId);
  const lean = doc.toObject() as unknown as LeanArtifact;
  if (lean.retiredAt) throw new ReviewError("Question is already retired");

  const payload = payloadOf(lean);
  const qid = typeof payload.qid === "string" ? payload.qid : null;
  const retiredAt = new Date();

  doc.set("retiredAt", retiredAt);
  doc.set("retiredBy", new Types.ObjectId(input.actorId));
  const reason = input.reason?.trim() ?? "";
  if (reason !== "") doc.set("retireReason", reason);
  await doc.save();

  // Nobody should be left holding a review round for a question that is gone — the same
  // courtesy publishing does. Their queue empties instead of showing a ghost.
  if (qid) {
    await supersedeOpenRounds(
      { docType: QUESTION_DOC_TYPE, qid },
      "question_retired",
      input.actorId,
      input.actorRole,
    );
  }

  await writeAudit({
    eventKind: "QUESTION_RETIRED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: doc._id.toString(),
    targetKind: "ContentArtifact",
    meta: {
      qid,
      subject: lean.subject,
      classLevel: lean.classLevel,
      reviewStatus: lean.reviewStatus,
      wasPublished: lean.reviewStatus === "gold",
      ...(reason !== "" ? { reason } : {}),
    },
  });

  return {
    artifactId: doc._id.toString(),
    qid,
    changedFields: ["retiredAt"],
    wasPublished: lean.reviewStatus === "gold",
    retiredAt: retiredAt.toISOString(),
    important: lean.importantAt != null,
  };
}

export async function restoreQuestion(input: {
  artifactId: string;
  actorId: string;
  actorRole?: string;
}): Promise<QuestionEditResult> {
  const doc = await loadQuestionDoc(input.artifactId);
  const lean = doc.toObject() as unknown as LeanArtifact;
  if (!lean.retiredAt) throw new ReviewError("Question is not retired");

  const payload = payloadOf(lean);
  const qid = typeof payload.qid === "string" ? payload.qid : null;

  doc.set("retiredAt", null);
  doc.set("retiredBy", undefined);
  doc.set("retireReason", undefined);
  await doc.save();

  await writeAudit({
    eventKind: "QUESTION_RESTORED",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: doc._id.toString(),
    targetKind: "ContentArtifact",
    meta: { qid, subject: lean.subject, classLevel: lean.classLevel },
  });
  // D-#1004: someone else bringing a retired question back means it should not have been
  // retired — tier 2 for whoever retired it. Undoing your own retire is nobody's mistake.
  if (lean.retiredBy && lean.retiredBy.toString() !== input.actorId) {
    await recordPlaceMistake({
      kind: "QUESTION_RESTORED",
      tier: 2,
      refKey: doc._id.toString(),
      ownerId: lean.retiredBy,
      correctedBy: input.actorId,
      at: new Date(),
      line: `বাতিল করা প্রশ্ন${qid ? ` ${qid}` : ""} আবার ফেরানো হয়েছে`,
    });
  }

  return {
    artifactId: doc._id.toString(),
    qid,
    changedFields: ["retiredAt"],
    wasPublished: lean.reviewStatus === "gold",
    retiredAt: null,
    important: lean.importantAt != null,
  };
}

// ---------------------------------------------------------------------------
// setQuestionImportant (QR-9, D-#550)
// ---------------------------------------------------------------------------

/**
 * Raise or lower the IMPORTANT mark on a question.
 *
 * Normal is the usual state and `null` is how it is stored, so “important” is a positive
 * claim somebody made rather than a default nobody chose. The mark is visible to EVERYONE
 * who can see the question, teachers included (owner ruling): it is a signal about the
 * question worth acting on when a set is assembled, not a private desk annotation.
 *
 * WHO may mark, and the one asymmetry that matters:
 *   • `question_bank:edit` (Principal + Office by default) — any question, at any time, from the bank;
 *   • `question_review:review` (a reviewer) — ONLY a question she currently holds an open round
 *     for. A reviewer marks while REVIEWING, which is exactly the set of questions she was
 *     handed; letting her flag arbitrary bank rows would hand every teacher with the review
 *     permission a write on 6,900 documents she was never assigned.
 *
 * Un-marking is open to anyone who may mark (owner ruling) — the flag is a shared signal,
 * not a personal one, so whoever sees it is wrong may lower it.
 *
 * Idempotent: setting the state it is already in writes NOTHING, so a double-tap cannot
 * produce a second audit row claiming a change that did not happen.
 */
export async function setQuestionImportant(input: {
  artifactId: string;
  important: boolean;
  actorId: string;
  actorRole?: string;
  /** True when the caller holds `question_bank:edit`; false for a reviewer. */
  mayManage: boolean;
}): Promise<QuestionEditResult> {
  const doc = await loadQuestionDoc(input.artifactId);
  const lean = doc.toObject() as unknown as LeanArtifact;
  const payload = payloadOf(lean);
  const qid = typeof payload.qid === "string" ? payload.qid : null;

  // A reviewer is confined to her own open rounds. Checked against the ROUND rather than a
  // permission because `question_review:review` is a TEACHER base permission — the check IS the
  // scope. Refused before any write, so a rejected call leaves nothing half-done.
  if (!input.mayManage) {
    if (!qid) throw new ReviewError("Question artifact has no payload.qid — it cannot be marked");
    const mine = await ReviewAssignment.countDocuments({
      docType: QUESTION_DOC_TYPE,
      qid,
      reviewerId: new Types.ObjectId(input.actorId),
      status: { $in: ["assigned", "submitted"] },
    });
    if (mine === 0) {
      throw new ReviewError(
        "Not authorized to mark this question — it is not in your review queue",
      );
    }
  }

  const was = lean.importantAt != null;
  if (was === input.important) {
    // No-op: the same posture the edit path takes (D-#548). Nothing written, nothing audited.
    return {
      artifactId: doc._id.toString(),
      qid,
      changedFields: [],
      wasPublished: lean.reviewStatus === "gold",
      retiredAt: lean.retiredAt ? lean.retiredAt.toISOString() : null,
      important: was,
    };
  }

  doc.set("importantAt", input.important ? new Date() : null);
  doc.set("importantBy", input.important ? new Types.ObjectId(input.actorId) : undefined);
  await doc.save();

  await writeAudit({
    eventKind: input.important ? "QUESTION_MARKED_IMPORTANT" : "QUESTION_UNMARKED_IMPORTANT",
    actorId: input.actorId,
    actorRole: input.actorRole,
    targetId: doc._id.toString(),
    targetKind: "ContentArtifact",
    meta: {
      qid,
      subject: lean.subject,
      classLevel: lean.classLevel,
      reviewStatus: lean.reviewStatus,
      // Whether this came from the desk or from a reviewer working her queue — the two
      // reach the mutation through different gates and mean different things.
      viaReviewQueue: !input.mayManage,
    },
  });

  return {
    artifactId: doc._id.toString(),
    qid,
    changedFields: ["importantAt"],
    wasPublished: lean.reviewStatus === "gold",
    retiredAt: lean.retiredAt ? lean.retiredAt.toISOString() : null,
    important: input.important,
  };
}

// ---------------------------------------------------------------------------
// Held for exams (PR-I, D-#1408)
// ---------------------------------------------------------------------------

export interface ExamPoolResult {
  artifactId: string;
  qid: string | null;
  /** The mark AFTER the call. */
  examPool: boolean;
  /** False when the question already held that state (nothing written, nothing audited). */
  changed: boolean;
}

export interface ExamPoolBulkResult {
  /** Questions whose state changed. */
  marked: number;
  /** qids that match no live (current, not retired) question — the first EXAM_POOL_LIST_CAP only. */
  notFound: string[];
  notFoundCount: number;
  /** qids that already held the asked state — the first EXAM_POOL_LIST_CAP only. */
  unchanged: string[];
  unchangedCount: number;
}

/** Id arrays in a response are capped here; the totals are in the *Count fields. */
export const EXAM_POOL_LIST_CAP = 200;
const capped = (l: string[]): string[] => l.slice(0, EXAM_POOL_LIST_CAP);

function examPoolAudit(on: boolean, actorId: string, actorRole: string | undefined, id: string, qid: string | null, subject: string, classLevel: number, how: string) {
  return {
    eventKind: on ? ("QUESTION_EXAM_HELD" as const) : ("QUESTION_EXAM_RELEASED" as const),
    actorId,
    actorRole,
    targetId: id,
    targetKind: "ContentArtifact",
    meta: { qid, subject, classLevel, how },
  };
}

/**
 * Hold one question for the exam papers, or release it (PR-I, D-#1408). Principal + Office
 * (`question_bank:edit` / `question_bank:delete`, gated in the resolver). Idempotent: asking for
 * the state it already holds writes and audits nothing.
 */
export async function setQuestionExamPool(input: {
  artifactId: string;
  on: boolean;
  actorId: string;
  actorRole?: string;
}): Promise<ExamPoolResult> {
  const doc = await loadQuestionDoc(input.artifactId);
  const lean = doc.toObject() as unknown as LeanArtifact;
  const qid = typeof payloadOf(lean).qid === "string" ? (payloadOf(lean).qid as string) : null;
  const was = lean.examPoolAt != null;
  if (was === input.on) return { artifactId: doc._id.toString(), qid, examPool: was, changed: false };
  doc.set("examPoolAt", input.on ? new Date() : null);
  doc.set("examPoolBy", input.on ? new Types.ObjectId(input.actorId) : undefined);
  await doc.save();
  await writeAudit(examPoolAudit(input.on, input.actorId, input.actorRole, doc._id.toString(), qid, lean.subject, lean.classLevel, "single"));
  return { artifactId: doc._id.toString(), qid, examPool: input.on, changed: true };
}

/** The most ids (or filter matches) one bulk call takes. */
export const EXAM_POOL_MAX_IDS = 5000;
const EXAM_POOL_CHUNK = 500;

/** Pasted ids -> the bank's form: trimmed, Bangla digits to ASCII, upper case. */
export function normaliseQid(q: string): string {
  return q.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).trim().toUpperCase();
}

/** Apply the mark to the given artifacts (already known to be live questions) and audit each change. */
async function applyExamPool(
  docs: { _id: Types.ObjectId; subject: string; classLevel: number; qid: string | null }[],
  on: boolean,
  actorId: string,
  actorRole: string | undefined,
  how: string,
): Promise<void> {
  if (docs.length === 0) return;
  for (let i = 0; i < docs.length; i += EXAM_POOL_CHUNK) {
    const ids = docs.slice(i, i + EXAM_POOL_CHUNK).map((d) => d._id);
    await ContentArtifact.updateMany(
      { _id: { $in: ids } },
      on
        ? { $set: { examPoolAt: new Date(), examPoolBy: new Types.ObjectId(actorId) } }
        : { $set: { examPoolAt: null }, $unset: { examPoolBy: "" } },
    );
  }
  await writeAuditMany(docs.map((d) => examPoolAudit(on, actorId, actorRole, d._id.toString(), d.qid, d.subject, d.classLevel, how)));
}

/**
 * Hold or release many questions named by their ids (`QP-…`) — the Principal pastes the list the
 * question-bank run proposed. Ids are normalised (trim, upper case, Bangla digits to ASCII) and
 * de-duplicated. ONE `$in` read for the whole list (at most EXAM_POOL_MAX_IDS), then the writes.
 * Reports marked / not found / unchanged.
 */
export async function markExamPool(input: {
  qids: string[];
  on: boolean;
  actorId: string;
  actorRole?: string;
}): Promise<ExamPoolBulkResult> {
  const wanted = [...new Set(input.qids.map(normaliseQid).filter(Boolean))];
  if (wanted.length > EXAM_POOL_MAX_IDS) {
    throw new ReviewError(`Too many ids in one go (${wanted.length}) — the limit is ${EXAM_POOL_MAX_IDS}`);
  }
  const found = new Map<string, { _id: Types.ObjectId; subject: string; classLevel: number; qid: string; held: boolean }>();
  if (wanted.length > 0) {
    const rows = await ContentArtifact.find({
      docType: QUESTION_DOC_TYPE,
      current: true,
      retiredAt: null,
      "envelopeJson.payload.qid": { $in: wanted },
    })
      .select("subject classLevel examPoolAt envelopeJson.payload.qid")
      .lean();
    for (const r of rows) {
      const qid = ((r.envelopeJson as Record<string, unknown>)?.payload as Record<string, unknown> | undefined)?.qid;
      if (typeof qid === "string") found.set(qid, { _id: r._id as Types.ObjectId, subject: r.subject, classLevel: r.classLevel, qid, held: r.examPoolAt != null });
    }
  }
  const notFound = wanted.filter((q) => !found.has(q));
  const unchanged = wanted.filter((q) => found.has(q) && found.get(q)!.held === input.on);
  const todo = wanted.filter((q) => found.has(q) && found.get(q)!.held !== input.on).map((q) => found.get(q)!);
  await applyExamPool(todo, input.on, input.actorId, input.actorRole, "id-list");
  return { marked: todo.length, notFound: capped(notFound), notFoundCount: notFound.length, unchanged: capped(unchanged), unchangedCount: unchanged.length };
}

/**
 * Hold or release every question a filter matches (PR-I). Guard rails, all checked BEFORE any write:
 *  - the filter must name a subject AND a class, so "everything" is never one tap away;
 *  - it must match at most EXAM_POOL_MAX_IDS questions;
 *  - the caller names the `expectedCount` it showed the user; a different number refuses the call.
 * The response carries counts and at most EXAM_POOL_LIST_CAP ids.
 */
export async function markExamPoolByFilter(input: {
  filter: Record<string, unknown>;
  expectedCount: number;
  on: boolean;
  actorId: string;
  actorRole?: string;
}): Promise<ExamPoolBulkResult> {
  if (!input.filter.subject || input.filter.classLevel == null) {
    throw new ReviewError("Choose a subject and a class first — a bulk hold by filter needs both");
  }
  const where = { ...input.filter, docType: QUESTION_DOC_TYPE, current: true, retiredAt: null };
  const count = await ContentArtifact.countDocuments(where);
  if (count > EXAM_POOL_MAX_IDS) {
    throw new ReviewError(`The filter matches ${count} questions — narrow it to ${EXAM_POOL_MAX_IDS} or fewer`);
  }
  if (count !== input.expectedCount) {
    throw new ReviewError(`The filter now matches ${count} questions, not ${input.expectedCount} — look again before applying`);
  }
  const rows = await ContentArtifact.find(where).select("subject classLevel examPoolAt envelopeJson.payload.qid").lean();
  const qidOf = (r: (typeof rows)[number]) => {
    const q = ((r.envelopeJson as Record<string, unknown>)?.payload as Record<string, unknown> | undefined)?.qid;
    return typeof q === "string" ? q : null;
  };
  const todo = rows
    .filter((r) => (r.examPoolAt != null) !== input.on)
    .map((r) => ({ _id: r._id as Types.ObjectId, subject: r.subject, classLevel: r.classLevel, qid: qidOf(r) }));
  const unchanged = rows.filter((r) => (r.examPoolAt != null) === input.on).map(qidOf).filter((q): q is string => q !== null);
  await applyExamPool(todo, input.on, input.actorId, input.actorRole, "filter");
  return { marked: todo.length, notFound: [], notFoundCount: 0, unchanged: capped(unchanged), unchangedCount: rows.length - todo.length };
}

/** Retired questions are hidden everywhere a question is CHOSEN — the bank, the assign
 *  picker, set assembly. Existing sets keep resolving, which is the whole point of soft. */
export const NOT_RETIRED = { retiredAt: null } as const;

/** How many open review rounds a retire would close — used to warn before it happens. */
export async function openRoundCountForQuestion(qid: string): Promise<number> {
  return ReviewAssignment.countDocuments({
    docType: QUESTION_DOC_TYPE,
    qid,
    status: { $in: ["assigned", "submitted"] },
  });
}
