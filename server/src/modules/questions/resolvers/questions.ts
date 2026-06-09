/**
 * Question + stimulus query resolvers — J2.1–J2.4.
 *
 * Questions and stimuli are ContentArtifacts (docType=question|stimulus).
 * This module adds a question-specific query surface on top of the existing
 * ContentArtifact store — no separate collection, no data duplication.
 *
 * questions() — filtered list (J2.2); tag filters applied to envelopeJson.tags
 *               and envelopeJson.payload fields (stored in the artifact).
 * question()  — single question with full payload for preview (J2.3).
 * stimuli()   — filtered list of stimulus artifacts.
 *
 * Row-scope: assertCanRead enforced per-result for TEACHERs (J2.4 — supervisory
 * read passes naturally because canRead covers supervisory extent).
 */
import { builder } from "../../../schema";
import { ContentArtifact } from "../../content/models/ContentArtifact";
import { assertCanRead, ForbiddenError } from "../../../middleware/authz";
import type { Types, FlattenMaps, FilterQuery } from "mongoose";
import type { IContentArtifact } from "../../content/models/ContentArtifact";

type LeanArtifact = FlattenMaps<IContentArtifact> & { _id: Types.ObjectId };

// ---------------------------------------------------------------------------
// Shared return shape: QuestionArtifact
// (Extends the base ContentArtifact shape with question-specific payload fields
//  exposed as structured fields for J2.2 filter chips + J2.3 preview.)
// ---------------------------------------------------------------------------

interface QuestionArtifactShape {
  _id: Types.ObjectId;
  id: string;
  docType: string;
  subject: string;
  classLevel: number;
  /** The full payload from envelopeJson.payload (question or stimulus payload). */
  payloadJson: string;
  /** Question-specific tag fields lifted from envelope tags + payload. */
  qid?: string | null;
  topicTag?: string | null;
  questionType?: string | null;
  paperRole?: string | null;
  bloomLevel?: string | null;
  difficulty?: string | null;
  marks?: number | null;
  curationTag: string;
  reviewStatus: string;
  current: boolean;
  importedAt: Date;
}

const QuestionArtifactRef = builder.objectRef<QuestionArtifactShape>("QuestionArtifact");
QuestionArtifactRef.implement({
  description: "A question or stimulus artifact with full payload for preview/assembly.",
  fields: (t) => ({
    id: t.exposeString("id"),
    docType: t.exposeString("docType"),
    subject: t.exposeString("subject"),
    classLevel: t.exposeInt("classLevel"),
    /** Full payload serialised as JSON string — client deserialises for rich preview. */
    payloadJson: t.exposeString("payloadJson"),
    qid: t.string({ nullable: true, resolve: (q) => q.qid ?? null }),
    topicTag: t.string({ nullable: true, resolve: (q) => q.topicTag ?? null }),
    questionType: t.string({ nullable: true, resolve: (q) => q.questionType ?? null }),
    paperRole: t.string({ nullable: true, resolve: (q) => q.paperRole ?? null }),
    bloomLevel: t.string({ nullable: true, resolve: (q) => q.bloomLevel ?? null }),
    difficulty: t.string({ nullable: true, resolve: (q) => q.difficulty ?? null }),
    marks: t.float({ nullable: true, resolve: (q) => q.marks ?? null }),
    curationTag: t.exposeString("curationTag"),
    reviewStatus: t.exposeString("reviewStatus"),
    current: t.exposeBoolean("current"),
    importedAt: t.string({ resolve: (q) => q.importedAt.toISOString() }),
  }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function docToShape(doc: LeanArtifact): QuestionArtifactShape {
  const env = doc.envelopeJson as Record<string, unknown>;
  const tags = (env.tags ?? {}) as Record<string, unknown>;
  const payload = (env.payload ?? {}) as Record<string, unknown>;

  return {
    _id: doc._id,
    id: doc._id.toString(),
    docType: doc.docType,
    subject: doc.subject,
    classLevel: doc.classLevel,
    payloadJson: JSON.stringify(env.payload ?? {}),
    qid: (payload.qid as string | undefined) ?? null,
    topicTag: (tags.topic_tag as string | undefined) ?? null,
    questionType: (payload.question_type as string | undefined) ?? null,
    paperRole: (payload.paper_role as string | undefined) ??
               (tags.paper_role as string | undefined) ?? null,
    bloomLevel: (payload.bloom_level as string | undefined) ??
                (tags.bloom_level as string | undefined) ?? null,
    difficulty: (payload.difficulty as string | undefined) ??
                (tags.difficulty as string | undefined) ?? null,
    marks: typeof payload.marks === "number" ? payload.marks : null,
    curationTag: doc.curationTag,
    reviewStatus: doc.reviewStatus,
    current: doc.current,
    importedAt: doc.importedAt,
  };
}

/** Apply TEACHER row-scope filter to a list of lean artifacts. */
async function applyScope(
  docs: LeanArtifact[],
  ctx: import("../../../context").AppContext,
): Promise<QuestionArtifactShape[]> {
  if (ctx.auth?.role === "PRINCIPAL" || ctx.auth?.role === "OFFICE") {
    return docs.map(docToShape);
  }
  const allowed: QuestionArtifactShape[] = [];
  for (const doc of docs) {
    try {
      await assertCanRead(ctx, "", doc.subject, doc.subject);
      allowed.push(docToShape(doc));
    } catch {
      // outside scope — skip
    }
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// Query: questions — J2.2 multi-tag filter
// ---------------------------------------------------------------------------

builder.queryField("questions", (t) =>
  t.field({
    type: [QuestionArtifactRef],
    description: "Filter questions by any combination of tags (J2.2). TEACHER scope enforced (J2.4).",
    authScopes: { hasPermission: "question:read" },
    args: {
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      topicTag: t.arg.string({ required: false }),
      questionType: t.arg.string({ required: false }),
      bloomLevel: t.arg.string({ required: false }),
      difficulty: t.arg.string({ required: false }),
      paperRole: t.arg.string({ required: false }),
      marksMin: t.arg.float({ required: false }),
      marksMax: t.arg.float({ required: false }),
      reviewStatus: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const filter: FilterQuery<IContentArtifact> = {
        docType: "question",
        current: true,
      };
      if (args.subject) filter.subject = args.subject;
      if (args.classLevel != null) filter.classLevel = args.classLevel;
      if (args.reviewStatus) filter.reviewStatus = args.reviewStatus;

      // Tag-level filters stored in envelopeJson.tags or envelopeJson.payload
      if (args.topicTag) filter["envelopeJson.tags.topic_tag"] = args.topicTag;
      if (args.bloomLevel) filter["envelopeJson.tags.bloom_level"] = args.bloomLevel;
      if (args.difficulty) filter["envelopeJson.tags.difficulty"] = args.difficulty;
      if (args.paperRole) filter["envelopeJson.tags.paper_role"] = args.paperRole;
      if (args.questionType) filter["envelopeJson.payload.question_type"] = args.questionType;

      // Marks range filter on payload.marks
      if (args.marksMin != null || args.marksMax != null) {
        const marksFilter: Record<string, number> = {};
        if (args.marksMin != null) marksFilter.$gte = args.marksMin;
        if (args.marksMax != null) marksFilter.$lte = args.marksMax;
        filter["envelopeJson.payload.marks"] = marksFilter;
      }

      const docs = await ContentArtifact.find(filter).lean() as LeanArtifact[];
      return applyScope(docs, ctx);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: question — single with full payload (J2.3)
// ---------------------------------------------------------------------------

builder.queryField("question", (t) =>
  t.field({
    type: QuestionArtifactRef,
    nullable: true,
    description: "Fetch a single question artifact by id with full payload (J2.3).",
    authScopes: { hasPermission: "question:read" },
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const doc = await ContentArtifact.findById(args.id).lean() as LeanArtifact | null;
      if (!doc || doc.docType !== "question") return null;
      await assertCanRead(ctx, "", doc.subject, doc.subject);
      return docToShape(doc);
    },
  }),
);

// ---------------------------------------------------------------------------
// Query: stimuli — filtered list of stimulus artifacts
// ---------------------------------------------------------------------------

builder.queryField("stimuli", (t) =>
  t.field({
    type: [QuestionArtifactRef],
    description: "Browse stimulus artifacts (shared passages/poems/audio-scripts).",
    authScopes: { hasPermission: "question:read" },
    args: {
      subject: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");

      const filter: FilterQuery<IContentArtifact> = { docType: "stimulus", current: true };
      if (args.subject) filter.subject = args.subject;
      if (args.classLevel != null) filter.classLevel = args.classLevel;

      const docs = await ContentArtifact.find(filter).lean() as LeanArtifact[];
      return applyScope(docs, ctx);
    },
  }),
);
