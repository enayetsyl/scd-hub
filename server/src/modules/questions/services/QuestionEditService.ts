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
import { writeAudit } from "../../platform/services/AuditService";
import { ReviewError, supersedeOpenRounds } from "../../content/services/ReviewService";
import { QUESTION_DOC_TYPE } from "./QuestionReviewService";

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
  importantAt?: Date | null;
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
 *   • `question:manage` (Principal + Office) — any question, at any time, from the bank;
 *   • `content:review` (a reviewer) — ONLY a question she currently holds an open round
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
  /** True when the caller holds `question:manage`; false for a reviewer. */
  mayManage: boolean;
}): Promise<QuestionEditResult> {
  const doc = await loadQuestionDoc(input.artifactId);
  const lean = doc.toObject() as unknown as LeanArtifact;
  const payload = payloadOf(lean);
  const qid = typeof payload.qid === "string" ? payload.qid : null;

  // A reviewer is confined to her own open rounds. Checked against the ROUND rather than a
  // permission because `content:review` is a TEACHER base permission — the check IS the
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
