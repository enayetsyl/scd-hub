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
import { setExamMinutes, setDurationMinutes } from "@scd/shared";
import type { Types } from "mongoose";
import { AssessmentSet } from "../models/AssessmentSet";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { CorpusEvent } from "../../corpus/models/CorpusEvent";
import { TrackerRecord } from "../../trackers/models/TrackerRecord";
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

/**
 * The publish gate on SELECTION (Q3.4 / D-#508). Only a published (`gold`) question may
 * enter a set. Enforced here, in the service, so the resolvers, the REST set-PDF route and
 * any future caller all inherit it rather than each re-deriving the rule.
 *
 * Note there is NO reviewer exemption: a teacher reviewing an unpublished question may READ
 * it (Q3.2) but may not put it in a paper (Q5.3).
 *
 * The message is deliberately Bangla-first — it reaches the teacher's screen verbatim.
 */
function assertPublished(artifact: {
  reviewStatus?: string;
  retiredAt?: Date | null;
  envelopeJson?: unknown;
}): void {
  // RETIRED is checked FIRST (D-#570). It is the more specific and more actionable reason:
  // a retired DRAFT told “not published yet” sends the teacher to the Principal to publish a
  // question somebody deliberately withdrew — the exact trap D-#566 avoided for gold ones and
  // left open for drafts. Order matters because only the first refusal is ever seen.
  if (artifact.retiredAt != null) {
    throw new Error("এই প্রশ্নটি বাতিল করা হয়েছে — এটি নতুন সেটে যোগ করা যাবে না।");
  }
  if (artifact.reviewStatus !== "gold") {
    throw new Error("এই প্রশ্নটি এখনও প্রকাশিত হয়নি — প্রকাশিত প্রশ্নই কেবল সেটে যোগ করা যায়।");
  }
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
  assertPublished(artifact);

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

export interface CreateSetWithQuestionsInput {
  setType: SetType;
  sectionId: string;
  classId: string;
  subjectId?: string;
  name?: string;
  /** Ordered — the resulting basketItems preserve this order (dedup keeps first occurrence). */
  artifactIds: string[];
  /** HW / AS only — ISO date string */
  dueDate?: string;
  /** CT only */
  durationMinutes?: number;
  actorId: string;
}

/** One-step transactional create: validate every artifact, then create the set
 *  directly in `assembled` status with the full ordered basket (ux-audit F6/F10).
 *  A single AssessmentSet.create() is the atomicity mechanism — nothing is
 *  written until every artifact has been verified, so a failure can never leave
 *  a half-populated draft behind (the old createSet + N×addQuestionToSet trap).
 *  Emits the same corpus events as the incremental path: one questions_selected
 *  per question + one set_assembled (ADR-005 de-identified). */
export async function createSetWithQuestions(
  input: CreateSetWithQuestionsInput,
): Promise<CreateSetResult> {
  const ids = [...new Set(input.artifactIds)];
  if (ids.length === 0) throw new Error("Cannot assemble an empty set");

  const artifacts = await ContentArtifact.find({ _id: { $in: ids } }).lean();
  const byId = new Map(artifacts.map((a) => [a._id.toString(), a]));

  const items = ids.map((artifactId) => {
    const artifact = byId.get(artifactId);
    if (!artifact) throw new Error("Question artifact not found");
    if (artifact.docType !== "question") throw new Error("Artifact is not a question");
    assertPublished(artifact);
    const env = artifact.envelopeJson as Record<string, unknown>;
    const payload = (env.payload ?? {}) as Record<string, unknown>;
    return {
      artifactId: artifact._id as Types.ObjectId,
      qid: (payload.qid as string | undefined) ?? artifactId,
      marks: typeof payload.marks === "number" ? payload.marks : 1,
      questionType: (payload.question_type as string | undefined) ?? null,
      subject: artifact.subject,
      classLevel: artifact.classLevel,
    };
  });

  const totalMarks = items.reduce((sum, item) => sum + item.marks, 0);
  /**
   * The set's time estimate, FROZEN here (QT-1, D-#574).
   *
   * Derived live everywhere else, but SNAPSHOT onto the set at assembly: a teacher who told
   * a class "45 minutes" must not have that rewritten because somebody later edited a rate.
   * Same reasoning as the frozen letter snapshot (D-#542).
   *
   * Ceiled on the SUM via the shared helper, never per question, and the APP computed the
   * figure it showed with the same function — so what was displayed is what is saved.
   */
  const examMinutes = setExamMinutes(items);
  const estimatedDuration = setDurationMinutes(input.setType, items);
  const now = new Date();
  const trimmedName = input.name?.trim();

  const doc = await AssessmentSet.create({
    setType: input.setType,
    name: trimmedName ? trimmedName : undefined,
    sectionId: input.sectionId,
    classId: input.classId,
    subjectId: input.subjectId,
    status: "assembled",
    basketItems: items.map(({ artifactId, qid, marks }) => ({ artifactId, qid, marks })),
    totalMarks,
    createdBy: input.actorId,
    assembledBy: input.actorId,
    assembledAt: now,
    examMinutes,
    // A typed CT duration is the teacher's own call and always wins; otherwise the estimate
    // stands, so a homework carries a duration without anyone having to type one.
    durationMinutes:
      input.setType === "CT" && input.durationMinutes != null
        ? input.durationMinutes
        : estimatedDuration,
    dueDate:
      (input.setType === "HW" || input.setType === "AS") && input.dueDate
        ? new Date(input.dueDate)
        : undefined,
  });

  // De-identified corpus events — same shapes as addQuestionToSet + assembleSet (ADR-005)
  const pseudoId = Buffer.from(input.actorId).toString("base64");
  await CorpusEvent.insertMany(
    items.map((item) => ({
      eventKind: "questions_selected",
      pseudoActorId: pseudoId,
      occurredAt: now,
      meta: {
        setId: doc._id.toString(),
        qid: item.qid,
        subject: item.subject,
        classLevel: item.classLevel,
      },
    })),
  );
  await CorpusEvent.create({
    eventKind: "set_assembled",
    pseudoActorId: pseudoId,
    occurredAt: now,
    meta: {
      setId: doc._id.toString(),
      setType: doc.setType,
      sectionId: doc.sectionId.toString(),
      itemCount: items.length,
      totalMarks,
    },
  });

  return {
    setId: doc._id.toString(),
    setType: doc.setType,
    sectionId: doc.sectionId.toString(),
    classId: doc.classId.toString(),
    status: doc.status,
  };
}

export interface RecentSetItem {
  id: string;
  setType: SetType;
  name: string | null;
  sectionId: string;
  classId: string;
  subjectId: string | null;
  status: string;
  itemCount: number;
  totalMarks: number | null;
  dueDate: string | null;
  createdAt: string;
  /** The newest still-open tracker for this set, if any — lets the client route
   *  straight to TrackerEntry instead of calling the NON-idempotent openTracker
   *  mutation again (which would create a duplicate TrackerRecord). */
  openTrackerId: string | null;
}

/** The caller's most recently created/assembled sets, across ALL their sections
 *  (ux-audit F7 — the Today-screen "সাম্প্রতিক সেট" shortcut back into tracking).
 *  Self-scoped: only sets the caller created or assembled — no section arg, so no
 *  assertCanRead needed beyond the set:read permission gate in the resolver. */
export async function listMyRecentSets(userId: string, limit = 2): Promise<RecentSetItem[]> {
  const docs = await AssessmentSet.find({
    $or: [{ createdBy: userId }, { assembledBy: userId }],
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const ids = docs.map((d) => d._id.toString());
  const open = await TrackerRecord.find({ setId: { $in: ids }, status: "open" })
    .select("setId createdAt")
    .sort({ createdAt: -1 })
    .lean();
  // Newest open tracker per set — first hit wins because of the sort above.
  const openBySet = new Map<string, string>();
  for (const trk of open) {
    const key = trk.setId.toString();
    if (!openBySet.has(key)) openBySet.set(key, trk._id.toString());
  }

  return docs.map((doc) => ({
    id: doc._id.toString(),
    setType: doc.setType,
    name: doc.name ?? null,
    sectionId: doc.sectionId.toString(),
    classId: doc.classId.toString(),
    subjectId: doc.subjectId?.toString() ?? null,
    status: doc.status,
    itemCount: doc.basketItems?.length ?? 0,
    totalMarks: typeof doc.totalMarks === "number" ? doc.totalMarks : null,
    dueDate: doc.dueDate ? (doc.dueDate as unknown as Date).toISOString() : null,
    createdAt: (doc.createdAt as unknown as Date).toISOString(),
    openTrackerId: openBySet.get(doc._id.toString()) ?? null,
  }));
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
}undefined