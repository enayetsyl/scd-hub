/**
 * AssessmentService — basket accumulation + set assembly (J3.1–J3.2, J3.5).
 *
 * createSet   — creates a draft AssessmentSet; write-scope enforced (J3.5).
 * addQuestion — appends a question artifact to the basket; emits questions_selected
 *               CorpusEvent (de-identified, corpus plane, ADR-005).
 * assembleSet — finalises the set; enforces write-scope; emits set_assembled event.
 *
 * Write-scope rule (J3.5, ADR-017):
 *   teaching grant or proxy grant for the section → write allowed.
 *   supervisory-only grant → assertCanWrite throws ForbiddenError (read-only).
 *   PRINCIPAL → allowed (assertCanWrite bypasses for PRINCIPAL).
 */
import type { Types } from "mongoose";
import { AssessmentSet } from "../models/AssessmentSet";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { CorpusEvent } from "../../corpus/models/CorpusEvent";
import type { SetType } from "@scd/shared";

export interface CreateSetInput {
  setType: SetType;
  sectionId: string;
  classId: string;
  subjectId?: string;
  /** Optional teacher-given label (trimmed; blank → unset). */
  name?: string;
  actorId: string;
}

export interface CreateSetResult {
  setId: string;
  setType: SetType;
  sectionId: string;
  classId: string;
  status: string;
}

export interface AddQuestionResult {
  setId: string;
  itemCount: number;
}

export interface AssembleInput {
  setId: string;
  actorId: string;
  /** CT only */
  durationMinutes?: number;
  /** HW / AS only — ISO date string */
  dueDate?: string;
}

export interface AssembleResult {
  setId: string;
  status: string;
  itemCount: number;
  totalMarks: number;
  assembledAt: string;
}

/** Create a new draft AssessmentSet. Write-scope is enforced by the resolver (assertCanWrite). */
export async function createSet(input: CreateSetInput): Promise<CreateSetResult> {
  const trimmedName = input.name?.trim();
  const doc = await AssessmentSet.create({
    setType: input.setType,
    name: trimmedName ? trimmedName : undefined,
    sectionId: input.sectionId,
    classId: input.classId,
    subjectId: input.subjectId,
    status: "draft",
    basketItems: [],
    createdBy: input.actorId,
  });

  return {
    setId: doc._id.toString(),
    setType: doc.setType,
    sectionId: doc.sectionId.toString(),
    classId: doc.classId.toString(),
    status: doc.status,
  };
}

/** Add a question artifact to the basket. Write-scope enforced by the resolver.
 *  Emits a de-identified questions_selected CorpusEvent (J3.1, ADR-005). */
export async function addQuestionToSet(
  setId: string,
  artifactId: string,
  actorId: string,
): Promise<AddQuestionResult> {
  const set = await AssessmentSet.findById(setId);
  if (!set) throw new Error("AssessmentSet not found");
  if (set.status !== "draft") throw new Error("Cannot add questions to an assembled set");

  // Fetch the artifact to extract qid + marks from the payload
  const artifact = await ContentArtifact.findById(artifactId).lean();
  if (!artifact) throw new Error("Question artifact not found");
  if (artifact.docType !== "question") throw new Error("Artifact is not a question");

  const env = artifact.envelopeJson as Record<string, unknown>;
  const payload = (env.payload ?? {}) as Record<string, unknown>;
  const qid = (payload.qid as string | undefined) ?? artifactId;
  const marks = typeof payload.marks === "number" ? payload.marks : 1;

  // Avoid duplicates
  const alreadyAdded = set.basketItems.some(
    (item) => item.artifactId.toString() === artifactId,
  );
  if (!alreadyAdded) {
    set.basketItems.push({
      artifactId: artifact._id as Types.ObjectId,
      qid,
      marks,
    });
    await set.save();
  }

  // De-identified corpus event — NO identity fields (ADR-005)
  const pseudoId = Buffer.from(actorId).toString("base64");
  await CorpusEvent.create({
    eventKind: "questions_selected",
    pseudoActorId: pseudoId,
    occurredAt: new Date(),
    meta: {
      setId: set._id.toString(),
      qid,
      subject: artifact.subject,
      classLevel: artifact.classLevel,
    },
  });

  return { setId: set._id.toString(), itemCount: set.basketItems.length };
}

/** Set (or clear) a set's display name. Write-scope enforced by the resolver.
 *  Allowed in ANY status — a name is just a label, not question content, so an
 *  already-assembled set can still be named/renamed for later identification. */
export async function renameSet(setId: string, name: string): Promise<void> {
  const set = await AssessmentSet.findById(setId);
  if (!set) throw new Error("AssessmentSet not found");
  const trimmed = name.trim();
  set.name = trimmed ? trimmed : undefined;
  await set.save();
}

export interface RemoveQuestionResult {
  setId: string;
  itemCount: number;
}

/** Remove a question from a DRAFT set's basket (J3 edit). Write-scope enforced by the
 *  resolver. Draft-only: an assembled set is locked (D-#set-edit), so editing it throws.
 *  Idempotent — removing an artifact not in the basket is a no-op. */
export async function removeQuestionFromSet(
  setId: string,
  artifactId: string,
): Promise<RemoveQuestionResult> {
  const set = await AssessmentSet.findById(setId);
  if (!set) throw new Error("AssessmentSet not found");
  if (set.status !== "draft") throw new Error("Cannot remove questions from an assembled set");

  const idx = set.basketItems.findIndex((item) => item.artifactId.toString() === artifactId);
  if (idx >= 0) {
    set.basketItems.splice(idx, 1);
    await set.save();
  }
  return { setId: set._id.toString(), itemCount: set.basketItems.length };
}

/** Finalise a draft set. Write-scope enforced by the resolver (assertCanWrite).
 *  Emits a de-identified set_assembled CorpusEvent (J3.2, ADR-005). */
export async function assembleSet(input: AssembleInput): Promise<AssembleResult> {
  const set = await AssessmentSet.findById(input.setId);
  if (!set) throw new Error("AssessmentSet not found");
  if (set.status !== "draft") throw new Error("Set is already assembled");
  if (set.basketItems.length === 0) throw new Error("Cannot assemble an empty set");

  const totalMarks = set.basketItems.reduce((sum, item) => sum + item.marks, 0);
  const now = new Date();

  set.status = "assembled";
  set.totalMarks = totalMarks;
  set.assembledBy = input.actorId as unknown as Types.ObjectId;
  set.assembledAt = now;

  if (set.setType === "CT" && input.durationMinutes != null) {
    set.durationMinutes = input.durationMinutes;
  }
  if ((set.setType === "HW" || set.setType === "AS") && input.dueDate) {
    set.dueDate = new Date(input.dueDate);
  }

  await set.save();

  // De-identified corpus event (ADR-005)
  const pseudoId = Buffer.from(input.actorId).toString("base64");
  await CorpusEvent.create({
    eventKind: "set_assembled",
    pseudoActorId: pseudoId,
    occurredAt: now,
    meta: {
      setId: set._id.toString(),
      setType: set.setType,
      sectionId: set.sectionId.toString(),
      itemCount: set.basketItems.length,
      totalMarks,
    },
  });

  return {
    setId: set._id.toString(),
    status: set.status,
    itemCount: set.basketItems.length,
    totalMarks,
    assembledAt: now.toISOString(),
  };
}
